import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import worker from './index.js';
import { encryptRequest } from '../shared/envelope.js';
import { publicJwk } from './privacy.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const pair = await crypto.subtle.generateKey({
  name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
}, true, ['encrypt', 'decrypt']);
const secrets = {
  AUTH_PRIVATE_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
  PERSONAL_DATA_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
};

export function fixture(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const migration of ['0001_init.sql', '0002_notifications.sql', '0003_player_accounts.sql', '0004_student_plans.sql']) {
    db.exec(readFileSync(new URL(`../migrations/${migration}`, import.meta.url), 'utf8'));
  }
  t.after(() => db.close());
  const env = {
    ...secrets, TIMEZONE: 'Asia/Kolkata', ADMIN_PASSWORD: 'test-password', SESSION_SECRET: 'test-session-secret',
    DB: {
      prepare(sql) {
        let args = [];
        return {
          bind(...values) { args = values; return this; },
          async first() { return db.prepare(sql).get(...args) ?? null; },
          async all() { return { results: db.prepare(sql).all(...args) }; },
          async run() { return { success: true, meta: db.prepare(sql).run(...args) }; },
        };
      },
      async batch(statements) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.all());
          db.exec('COMMIT');
          return results;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      },
    },
  };
  const request = async (path, body, cookie, headers = {}, encrypted = false, method = body === undefined ? 'GET' : 'POST') => {
    const data = body !== undefined && encrypted ? await encryptRequest(publicJwk(env), path, body) : body;
    return worker.fetch(new Request(`https://camp.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(data) }),
    }), env);
  };
  const sensitive = (path, body, cookie, headers, method) => request(path, body, cookie, headers, true, method);
  let adminCookie;
  const admin = async () => {
    if (adminCookie) return adminCookie;
    const response = await sensitive('/api/admin/login', { password: env.ADMIN_PASSWORD });
    assert.equal(response.status, 200, await response.clone().text());
    adminCookie = response.headers.get('Set-Cookie').split(';')[0];
    return adminCookie;
  };
  const register = async (username = 'player.test', name = 'Test Player') => {
    const response = await sensitive('/api/auth/register', { username, name, password: 'a long test password' });
    assert.equal(response.status, 201, await response.clone().text());
    return db.prepare('SELECT id FROM user_accounts ORDER BY id DESC LIMIT 1').get().id;
  };
  const approvedPlayer = async (username = 'player.test', name = 'Test Player', personId = null) => {
    const id = await register(username, name);
    const response = await request(`/api/admin/registrations/${id}/approve`, { personId }, await admin());
    assert.equal(response.status, 200, await response.clone().text());
    const login = await sensitive('/api/auth/login', { username, password: 'a long test password' });
    assert.equal(login.status, 200, await login.clone().text());
    return { cookie: login.headers.get('Set-Cookie').split(';')[0], user: (await login.json()).user, accountId: id };
  };
  return { db, env, request, sensitive, admin, register, approvedPlayer };
}
