import { sessionDates } from './dates.js';

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
      const dates = sessionDates(env);
      await env.DB.prepare('DELETE FROM availability WHERE session_date NOT IN (?, ?)')
        .bind(dates.today, dates.tomorrow)
        .run();
      return await route(request, env, url, dates);
    } catch (err) {
      console.error(err);
      return json({ error: 'Internal server error' }, 500);
    }
  },
};

async function route(request, env, url, dates) {
  const { pathname } = url;
  const method = request.method;

  // ---------- Public API ----------
  if (pathname === '/api/people' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, name FROM people ORDER BY name COLLATE NOCASE').all();
    return json({ people: results });
  }

  if (pathname === '/api/availability' && method === 'GET') {
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
    const { total } = await env.DB.prepare('SELECT COUNT(*) AS total FROM people').first();
    return json({
      date,
      available: results.filter((r) => r.status === 'available'),
      notAvailable: results.filter((r) => r.status === 'not_available'),
      totalPeople: total,
    });
  }

  if (pathname === '/api/availability' && method === 'POST') {
    const body = await readJson(request);
    const personId = Number(body?.personId);
    const status = body?.status;
    if (!Number.isInteger(personId) || !STATUSES.has(status)) {
      return json({ error: 'personId and a valid status are required' }, 400);
    }
    const person = await env.DB.prepare('SELECT id, name FROM people WHERE id = ?').bind(personId).first();
    if (!person) return json({ error: 'Person not found' }, 404);

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
    const body = await readJson(request);
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
    if (!(await isAdmin(request, env))) return json({ error: 'Unauthorized' }, 401);

    if (pathname === '/api/admin/me' && method === 'GET') {
      return json({ ok: true });
    }

    if (pathname === '/api/admin/people' && method === 'POST') {
      const body = await readJson(request);
      const name = typeof body?.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
      if (!name || name.length > 80) {
        return json({ error: 'Name is required (max 80 characters)' }, 400);
      }
      const existing = await env.DB.prepare('SELECT id FROM people WHERE name = ?').bind(name).first();
      if (existing) return json({ error: `"${name}" is already in the list` }, 409);

      const person = await env.DB.prepare('INSERT INTO people (name) VALUES (?) RETURNING id, name')
        .bind(name)
        .first();
      return json({ person }, 201);
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

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

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
