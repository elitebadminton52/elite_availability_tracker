import { toBase64 } from '../shared/envelope.js';
import { HttpError, json, readJson } from './http.js';
import {
  decryptField, digest, encryptField, equal, lookup, normalizeName, normalizeUsername,
  passwordHash, PASSWORD_ITERATIONS, publicJwk, rateLimit, readEncrypted, readPeople, validateUsername,
} from './privacy.js';

const COOKIE = 'player_session';
const SESSION_SECONDS = 60 * 60 * 24 * 400;

function cookie(value, maxAge = SESSION_SECONDS) {
  return `${COOKIE}=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function sessionToken(request) {
  return (request.headers.get('Cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
}

export async function currentPlayer(request, env) {
  const token = sessionToken(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare(
    `SELECT a.id AS account_id, a.person_id, p.name, a.username
     FROM user_sessions s JOIN user_accounts a ON a.id = s.account_id JOIN people p ON p.id = a.person_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'approved'`
  ).bind(await digest(token), Date.now()).first();
}

export async function playerProfile(env, player) {
  return {
    id: player.person_id,
    name: await decryptField(env, player.name, 'person-name'),
    username: await decryptField(env, player.username, 'account-username'),
  };
}

export async function authRoute(request, env, pathname) {
  const method = request.method;
  if (pathname === '/api/auth/key' && method === 'GET') return json({ publicKey: publicJwk(env) });
  if (pathname === '/api/auth/me' && method === 'GET') {
    const player = await currentPlayer(request, env);
    if (!player) throw new HttpError(401, 'Please sign in');
    await env.DB.prepare('UPDATE user_sessions SET expires_at = ? WHERE token_hash = ?')
      .bind(Date.now() + SESSION_SECONDS * 1000, await digest(sessionToken(request))).run();
    return json({ user: await playerProfile(env, player) }, 200, { 'Set-Cookie': cookie(sessionToken(request)) });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const token = sessionToken(request);
    if (token) await env.DB.prepare('DELETE FROM user_sessions WHERE token_hash = ?').bind(await digest(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
  }
  if (method !== 'POST' || !['/api/auth/username', '/api/auth/register', '/api/auth/login'].includes(pathname)) {
    throw new HttpError(404, 'Not found');
  }
  await rateLimit(request, env, pathname, pathname.endsWith('/username') ? 60 : 20);
  const body = await readEncrypted(request, env);
  const username = normalizeUsername(body.username);
  validateUsername(username);
  const usernameLookup = await lookup(env, username, 'username');

  if (pathname === '/api/auth/username') {
    const account = await env.DB.prepare('SELECT id FROM user_accounts WHERE username_lookup = ?').bind(usernameLookup).first();
    return json({ available: !account });
  }
  const password = body.password;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new HttpError(400, 'Password must be 12–128 characters');
  }
  if (pathname === '/api/auth/register') {
    const name = normalizeName(body.name);
    if (!name || name.length > 80) throw new HttpError(400, 'Name is required (max 80 characters)');
    const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
    const account = await env.DB.prepare(
      `INSERT INTO user_accounts(name, username, username_lookup, password_hash, password_salt, password_iterations)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(username_lookup) DO NOTHING RETURNING id`
    ).bind(await encryptField(env, name, 'account-name'), await encryptField(env, username, 'account-username'),
      usernameLookup, await passwordHash(password, salt), salt, PASSWORD_ITERATIONS).first();
    if (!account) throw new HttpError(409, 'Username is already taken. Choose another username.');
    return json({ ok: true, message: 'Registration submitted. You can sign in once the coach approves your account.' }, 201);
  }

  const account = await env.DB.prepare('SELECT * FROM user_accounts WHERE username_lookup = ?').bind(usernameLookup).first();
  const candidate = await passwordHash(password, account?.password_salt || toBase64(new Uint8Array(16)),
    account?.password_iterations || PASSWORD_ITERATIONS);
  if (!account || !equal(candidate, account.password_hash)) throw new HttpError(401, 'Incorrect username or password');
  if (account.status === 'pending') throw new HttpError(403, 'Your registration is awaiting approval from the coach.');
  if (account.status !== 'approved') throw new HttpError(403, 'Your registration was not approved. Contact the coach.');
  const person = await env.DB.prepare('SELECT id, name FROM people WHERE id = ?').bind(account.person_id).first();
  if (!person) throw new HttpError(403, 'Your camp membership is no longer active. Contact the coach.');
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  await env.DB.prepare('INSERT INTO user_sessions(token_hash, account_id, expires_at) VALUES (?, ?, ?)')
    .bind(await digest(token), account.id, Date.now() + SESSION_SECONDS * 1000).run();
  return json({ user: await playerProfile(env, { ...account, name: person.name }) }, 200, { 'Set-Cookie': cookie(token) });
}

export async function approvalRoute(request, env, pathname) {
  if (pathname === '/api/admin/registrations' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      "SELECT id, name, username, created_at FROM user_accounts WHERE status = 'pending' ORDER BY created_at, id"
    ).all();
    const registrations = await Promise.all(results.map(async (account) => ({
      ...account,
      name: await decryptField(env, account.name, 'account-name'),
      username: await decryptField(env, account.username, 'account-username'),
    })));
    const people = await readPeople(env,
      'SELECT id, name FROM people WHERE id NOT IN (SELECT person_id FROM user_accounts WHERE person_id IS NOT NULL)');
    return json({ registrations, people });
  }
  const match = pathname.match(/^\/api\/admin\/registrations\/(\d+)\/(approve|reject)$/);
  if (!match || request.method !== 'POST') throw new HttpError(404, 'Not found');
  const id = Number(match[1]);
  if (match[2] === 'reject') {
    const account = await env.DB.prepare(
      "UPDATE user_accounts SET status = 'rejected' WHERE id = ? AND status = 'pending' RETURNING id"
    ).bind(id).first();
    if (!account) throw new HttpError(409, 'This request has already been processed. Refresh the list.');
    return json({ ok: true });
  }
  const body = await readJson(request);
  const account = await env.DB.prepare("SELECT * FROM user_accounts WHERE id = ? AND status = 'pending'").bind(id).first();
  if (!account) throw new HttpError(409, 'This request has already been processed. Refresh the list.');
  const statements = [];
  let nameLookup;
  if (body.personId === null) {
    const name = await decryptField(env, account.name, 'account-name');
    nameLookup = await lookup(env, name.toLowerCase(), 'person-name');
    const existing = await env.DB.prepare('SELECT id FROM people WHERE name_lookup = ?').bind(nameLookup).first();
    if (existing) throw new HttpError(409, 'A camp player with this name exists. Link the existing player instead.');
    statements.push(env.DB.prepare(
      `INSERT INTO people(name, name_lookup) SELECT ?, ?
       WHERE EXISTS(SELECT 1 FROM user_accounts WHERE id = ? AND status = 'pending')
       ON CONFLICT(name_lookup) DO NOTHING`
    ).bind(await encryptField(env, name, 'person-name'), nameLookup, id));
  } else {
    if (!Number.isSafeInteger(body.personId) || body.personId < 1) throw new HttpError(400, 'Select an existing player or create a new player');
    const existing = await env.DB.prepare('SELECT id FROM people WHERE id = ?').bind(body.personId).first();
    if (!existing) throw new HttpError(404, 'Camp player not found');
  }
  statements.push(env.DB.prepare(
    `UPDATE user_accounts SET status = 'approved', person_id = ${nameLookup ?
      '(SELECT id FROM people WHERE name_lookup = ?)' : '?'}
     WHERE id = ? AND status = 'pending'
     AND NOT EXISTS(SELECT 1 FROM user_accounts WHERE person_id = ${nameLookup ?
      '(SELECT id FROM people WHERE name_lookup = ?)' : '?'}) RETURNING id`
  ).bind(nameLookup || body.personId, id, nameLookup || body.personId));
  const results = await env.DB.batch(statements);
  if (!results.at(-1).results.length) throw new HttpError(409, 'This request was already processed or that player already has an account. Refresh the list.');
  return json({ ok: true });
}
