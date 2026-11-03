import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './sqlite-fixture.js';
import { encryptRequest } from '../shared/envelope.js';
import { decryptField, publicJwk } from './privacy.js';
import worker from './index.js';
import { sessionDates } from './dates.js';

test('registration encrypts personal fields, salts password hashes, reserves normalized usernames and requires approval', async (t) => {
  const f = fixture(t);
  const body = { name: 'Private Person', username: 'Private.User', password: 'a long test password' };
  const envelope = await encryptRequest(publicJwk(f.env), '/api/auth/register', body);
  assert.ok(!JSON.stringify(envelope).includes(body.password));
  assert.ok(!JSON.stringify(envelope).includes(body.name));
  assert.equal((await f.request('/api/auth/register', envelope)).status, 201);
  const account = f.db.prepare('SELECT * FROM user_accounts').get();
  assert.notEqual(account.password_hash, body.password);
  assert.ok(!JSON.stringify(account).includes('Private'));
  assert.ok(!JSON.stringify(account).includes('private.user'));
  assert.equal(await decryptField(f.env, account.name, 'account-name'), body.name);
  assert.equal(await decryptField(f.env, account.username, 'account-username'), 'private.user');
  assert.equal((await f.sensitive('/api/auth/register', body)).status, 409);
  assert.equal((await (await f.sensitive('/api/auth/username', { username: 'PRIVATE.USER' })).json()).available, false);
  assert.equal((await (await f.sensitive('/api/auth/username', { username: 'unused.name' })).json()).available, true);
  const pending = await f.sensitive('/api/auth/login', body);
  assert.equal(pending.status, 403);
  assert.match((await pending.json()).error, /awaiting approval/);
  await f.register('second.user', 'Second Person');
  const second = f.db.prepare('SELECT * FROM user_accounts WHERE id != ?').get(account.id);
  assert.notEqual(account.password_salt, second.password_salt);
  assert.notEqual(account.password_hash, second.password_hash);
  assert.equal((await f.request('/api/admin/registrations')).status, 401);
});

test('approval links existing IDs/history, encrypts legacy names, and prevents linking an occupied player', async (t) => {
  const f = fixture(t);
  const id = Number(f.db.prepare("INSERT INTO people(name) VALUES ('Existing Player')").run().lastInsertRowid);
  const date = sessionDates(f.env).today;
  f.db.prepare('INSERT INTO availability(person_id, session_date, status) VALUES (?, ?, ?)')
    .run(id, date, 'available');
  const registration = await f.register('linked.player', 'Registration Name');
  const admin = await f.admin();
  const pending = await (await f.request('/api/admin/registrations', undefined, admin)).json();
  assert.equal(pending.people[0].name, 'Existing Player');
  const stored = f.db.prepare('SELECT name, name_lookup FROM people WHERE id = ?').get(id);
  assert.ok(stored.name.startsWith('v1.'));
  assert.ok(stored.name_lookup);
  assert.equal((await f.request(`/api/admin/registrations/${registration}/approve`, { personId: id }, admin)).status, 200);
  const login = await f.sensitive('/api/auth/login', { username: 'linked.player', password: 'a long test password' });
  assert.equal(login.status, 200);
  assert.deepEqual((await login.json()).user, { id, name: 'Existing Player', username: 'linked.player' });
  const other = await f.register('other.player', 'Other Player');
  assert.equal((await f.request(`/api/admin/registrations/${other}/approve`, { personId: id }, admin)).status, 409);
  assert.equal((await f.request(`/api/admin/registrations/${registration}/approve`, { personId: id }, admin)).status, 409);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM people').get().n, 1);
  assert.equal(f.db.prepare('SELECT status FROM availability WHERE person_id = ? AND session_date = ?').get(id, date).status, 'available');
  assert.equal(f.db.prepare('SELECT status FROM user_accounts WHERE id = ?').get(other).status, 'pending');
});

test('approval creates new people, duplicate names require linking, and rejection blocks login', async (t) => {
  const f = fixture(t);
  const player = await f.approvedPlayer();
  assert.ok(f.db.prepare('SELECT name FROM people WHERE id = ?').get(player.user.id).name.startsWith('v1.'));
  const second = await f.register('same.name', 'Test Player');
  const admin = await f.admin();
  assert.equal((await f.request(`/api/admin/registrations/${second}/approve`, { personId: null }, admin)).status, 409);
  assert.equal((await f.request(`/api/admin/registrations/${second}/reject`, {}, admin)).status, 200);
  assert.equal((await f.sensitive('/api/auth/login', { username: 'same.name', password: 'a long test password' })).status, 403);
  assert.equal((await f.request(`/api/admin/registrations/${second}/approve`, { personId: null }, admin)).status, 409);
});

test('sessions survive reload, renew persistent HttpOnly cookies, and logout revokes server access', async (t) => {
  const f = fixture(t);
  const player = await f.approvedPlayer();
  const response = await f.request('/api/auth/me', undefined, player.cookie);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).user, player.user);
  const cookie = response.headers.get('Set-Cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=34560000']) assert.ok(cookie.includes(flag));
  const token = player.cookie.split('=')[1];
  assert.notEqual(f.db.prepare('SELECT token_hash FROM user_sessions').get().token_hash, token);
  assert.equal((await f.request('/api/auth/me', undefined, player.cookie)).status, 200);
  assert.equal((await f.request('/api/people', undefined, player.cookie)).status, 403);
  assert.equal((await f.request('/api/auth/logout', {}, player.cookie)).status, 200);
  assert.equal((await f.request('/api/auth/me', undefined, player.cookie)).status, 401);
  assert.equal((await f.request('/api/availability', { status: 'available' }, player.cookie)).status, 401);
  assert.equal((await f.request('/api/auth/me', undefined, 'player_session=forged')).status, 401);
});

test('configuration and database errors are explicit instead of succeeding silently', async (t) => {
  const f = fixture(t);
  delete f.env.AUTH_PRIVATE_KEY;
  const key = await f.request('/api/auth/key');
  assert.equal(key.status, 503);
  assert.match((await key.json()).error, /security is not configured/);
  const original = f.env.DB.prepare;
  const failure = new Error('test DB failure');
  f.env.DB.prepare = (sql) => {
    if (sql.startsWith('DELETE FROM notifications')) return { bind() { return this; }, async run() { throw failure; } };
    return original(sql);
  };
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const response = await f.request('/api/auth/me');
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'Internal server error');
  assert.equal(logs.length, 1);
});

test('wrong passwords, bad input, plaintext, tampered, replayed and cross-origin auth requests are rejected', async (t) => {
  const f = fixture(t);
  await f.register();
  assert.equal((await f.sensitive('/api/auth/login', { username: 'player.test', password: 'incorrect password' })).status, 401);
  for (const body of [
    { name: '', username: 'valid.name', password: 'a long test password' },
    { name: 'Valid', username: 'bad space', password: 'a long test password' },
    { name: 'Valid', username: 'valid.name', password: 'short' },
  ]) assert.equal((await f.sensitive('/api/auth/register', body)).status, 400);
  assert.equal((await f.request('/api/auth/login', { username: 'player.test', password: 'a long test password' })).status, 400);
  const envelope = await encryptRequest(publicJwk(f.env), '/api/auth/username', { username: 'valid.name' });
  assert.equal((await f.request('/api/auth/username', envelope)).status, 200);
  assert.equal((await f.request('/api/auth/username', envelope)).status, 409);
  assert.equal((await f.request('/api/auth/register', envelope)).status, 400);
  assert.equal((await f.request('/api/auth/username', { ...envelope, ciphertext: 'invalid' })).status, 400);
  assert.equal((await f.sensitive('/api/auth/login', {}, undefined, { Origin: 'https://evil.test' })).status, 403);
  const key = await (await f.request('/api/auth/key')).json();
  assert.ok(!key.publicKey.d);
  assert.deepEqual(key.publicKey.key_ops, ['encrypt']);
});

test('rate limiting persists across requests without storing IP addresses', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 21; i++) {
    const response = await f.request('/api/auth/login', {});
    assert.equal(response.status, i === 20 ? 429 : 400);
  }
  const row = f.db.prepare('SELECT * FROM auth_attempts').get();
  assert.equal(row.attempts, 21);
  assert.ok(!row.bucket.includes('local'));
});

test('expired encrypted requests are rejected', async (t) => {
  const f = fixture(t);
  const envelope = await encryptRequest(publicJwk(f.env), '/api/auth/username', { username: 'clock.test' });
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 600000);
  const response = await f.request('/api/auth/username', envelope);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Expired/);
});

test('removing a camp player revokes their account and every session', async (t) => {
  const f = fixture(t);
  const player = await f.approvedPlayer();
  const response = await worker.fetch(new Request(`https://camp.test/api/admin/people/${player.user.id}`, {
    method: 'DELETE', headers: { Cookie: await f.admin() },
  }), f.env);
  assert.equal(response.status, 200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_accounts').get().n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 0);
  assert.equal((await f.request('/api/auth/me', undefined, player.cookie)).status, 401);
});
