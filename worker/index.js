import { sessionDates } from './dates.js';
import { authRoute, approvalRoute, currentPlayer, playerProfile } from './accounts.js';
import { HttpError, json, readJson } from './http.js';
import { adminNotifications, playerNotifications } from './notifications.js';
import { decryptField, encryptField, lookup, normalizeName, protectPeople, rateLimit, readEncrypted, readPeople } from './privacy.js';

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours
const STATUSES = new Set(['available', 'not_available']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        const origin = request.headers.get('Origin');
        if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
          throw new HttpError(403, 'Cross-site requests are not allowed');
        }
      }
      const dates = sessionDates(env);
      await env.DB.prepare('DELETE FROM availability WHERE session_date NOT IN (?, ?)')
        .bind(dates.today, dates.tomorrow)
        .run();
      await env.DB.prepare('DELETE FROM notifications WHERE notification_date < ?')
        .bind(dates.today)
        .run();
      for (const table of ['user_sessions', 'auth_requests', 'auth_attempts']) {
        await env.DB.prepare(`DELETE FROM ${table} WHERE expires_at <= ?`).bind(Date.now()).run();
      }
      await protectPeople(env);
      return await route(request, env, url, dates);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('API request failed', url.pathname, err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
};

async function route(request, env, url, dates) {
  const { pathname } = url;
  const method = request.method;
  if (pathname.startsWith('/api/auth/')) return authRoute(request, env, pathname);
  const admin = await isAdmin(request, env);
  let player = null;
  if (!pathname.startsWith('/api/admin/')) {
    player = await currentPlayer(request, env);
    if (!player && !admin) throw new HttpError(401, 'Please sign in');
  }

  // ---------- Public API ----------
  if (pathname === '/api/notifications' && method === 'GET') {
    return playerNotifications(env, dates, player);
  }

  if (pathname === '/api/people' && method === 'GET') {
    if (!admin) throw new HttpError(403, 'Only the coach can manage camp players');
    return json({ people: await readPeople(env) });
  }

  if (pathname === '/api/availability/me' && method === 'GET') {
    if (!player) throw new HttpError(403, 'Sign in as a player to view your availability');
    const response = await env.DB.prepare('SELECT status FROM availability WHERE person_id = ? AND session_date = ?')
      .bind(player.person_id, dates.tomorrow).first();
    return json({ date: dates.tomorrow, status: response?.status ?? null });
  }

  if (pathname === '/api/availability' && method === 'GET') {
    if (!admin) throw new HttpError(403, 'Only the coach can view the availability dashboard');
    const day = url.searchParams.get('day') ?? 'tomorrow';
    if (day !== 'today' && day !== 'tomorrow') {
      return json({ error: 'day must be today or tomorrow' }, 400);
    }
    const date = dates[day];
    const { results } = await env.DB.prepare(
      `SELECT p.id, p.name, a.status, a.updated_at
         FROM availability a JOIN people p ON p.id = a.person_id
        WHERE a.session_date = ?
        ORDER BY p.name COLLATE NOCASE`
    )
      .bind(date)
      .all();
    const records = await Promise.all(results.map(async (record) => ({
      ...record, name: await decryptField(env, record.name, 'person-name'),
    })));
    records.sort((a, b) => a.name.localeCompare(b.name));
    const { total } = await env.DB.prepare('SELECT COUNT(*) AS total FROM people').first();
    return json({
      date,
      available: records.filter((r) => r.status === 'available'),
      notAvailable: records.filter((r) => r.status === 'not_available'),
      totalPeople: total,
    });
  }

  if (pathname === '/api/availability' && method === 'POST') {
    const body = await readJson(request);
    if (!player) throw new HttpError(401, 'Sign in as a player to mark your availability');
    const personId = player.person_id;
    const status = body?.status;
    if ('personId' in (body || {}) || !STATUSES.has(status)) {
      return json({ error: 'Send only a valid availability status for your own account' }, 400);
    }
    const person = await playerProfile(env, player);

    const date = dates.tomorrow;
    await env.DB.prepare(
      `INSERT INTO availability (person_id, session_date, status, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT (person_id, session_date)
       DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
    )
      .bind(personId, date, status)
      .run();
    return json({ ok: true, date, name: person.name, status });
  }

  // ---------- Admin auth ----------
  if (pathname === '/api/admin/login' && method === 'POST') {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      return json({ error: 'Admin login is not configured on the server' }, 500);
    }
    await rateLimit(request, env, 'admin-login');
    const body = await readEncrypted(request, env);
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!(await safeEqual(password, env.ADMIN_PASSWORD))) {
      return json({ error: 'Invalid password' }, 401);
    }
    const token = await signSession(env.SESSION_SECRET);
    return json({ ok: true }, 200, {
      'Set-Cookie': `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`,
    });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    return json({ ok: true }, 200, {
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    });
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!admin) return json({ error: 'Unauthorized' }, 401);
    if (pathname.startsWith('/api/admin/registrations')) return approvalRoute(request, env, pathname);
    if (pathname === '/api/admin/notifications' || pathname.startsWith('/api/admin/notifications/')) {
      return adminNotifications(request, env, pathname, dates);
    }

    if (pathname === '/api/admin/me' && method === 'GET') {
      return json({ ok: true });
    }

    if (pathname === '/api/admin/people' && method === 'POST') {
      const body = await readEncrypted(request, env);
      const name = normalizeName(body?.name);
      if (!name || name.length > 80) {
        return json({ error: 'Name is required (max 80 characters)' }, 400);
      }
      const nameLookup = await lookup(env, name.toLowerCase(), 'person-name');
      const person = await env.DB.prepare(
        'INSERT INTO people (name, name_lookup) VALUES (?, ?) ON CONFLICT(name_lookup) DO NOTHING RETURNING id'
      )
        .bind(await encryptField(env, name, 'person-name'), nameLookup)
        .first();
      if (!person) return json({ error: `"${name}" is already in the list` }, 409);
      return json({ person: { id: person.id, name } }, 201);
    }

    const match = pathname.match(/^\/api\/admin\/people\/(\d+)$/);
    if (match && method === 'DELETE') {
      const id = Number(match[1]);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM availability WHERE person_id = ?').bind(id),
        env.DB.prepare('DELETE FROM people WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
  }

  return json({ error: 'Not found' }, 404);
}

// ---------- Helpers ----------

const encoder = new TextEncoder();

function base64url(bytes) {
  let str = '';
  for (const b of new Uint8Array(bytes)) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return base64url(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
}

// Compares HMACs of both values so the comparison time doesn't leak the secret.
async function safeEqual(a, b) {
  const key = 'compare';
  const [ha, hb] = await Promise.all([hmac(key, a), hmac(key, b)]);
  let diff = ha.length ^ hb.length;
  for (let i = 0; i < Math.min(ha.length, hb.length); i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

async function signSession(secret) {
  const payload = base64url(encoder.encode(JSON.stringify({ exp: Date.now() + SESSION_TTL_SECONDS * 1000 })));
  return `${payload}.${await hmac(secret, payload)}`;
}

async function isAdmin(request, env) {
  if (!env.SESSION_SECRET) return false;
  const cookie = request.headers.get('Cookie') || '';
  const token = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;

  const [payload, sig] = token.split('.');
  if (!payload || !sig || !(await safeEqual(sig, await hmac(env.SESSION_SECRET, payload)))) return false;
  try {
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}
