import { fromBase64, toBase64 } from '../shared/envelope.js';
import { HttpError } from './http.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const PASSWORD_ITERATIONS = 100000;

export function privateJwk(env) {
  if (!env.AUTH_PRIVATE_KEY || !env.PERSONAL_DATA_KEY) {
    throw new HttpError(503, 'Account security is not configured. Ask the coach to configure the authentication keys.');
  }
  return JSON.parse(env.AUTH_PRIVATE_KEY);
}

export function publicJwk(env) {
  const { kty, n, e } = privateJwk(env);
  return { kty, n, e, alg: 'RSA-OAEP-256', ext: true, key_ops: ['encrypt'] };
}

async function dataKey(env) {
  privateJwk(env);
  return crypto.subtle.importKey('raw', fromBase64(env.PERSONAL_DATA_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptField(env, value, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: encoder.encode(context),
  }, await dataKey(env), encoder.encode(value));
  return `v1.${toBase64(iv)}.${toBase64(ciphertext)}`;
}

export async function decryptField(env, value, context) {
  const [version, iv, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !ciphertext) throw new Error('Invalid encrypted profile field');
  return decoder.decode(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: fromBase64(iv), additionalData: encoder.encode(context),
  }, await dataKey(env), fromBase64(ciphertext)));
}

export async function lookup(env, value, context) {
  privateJwk(env);
  const material = await crypto.subtle.importKey('raw', fromBase64(env.PERSONAL_DATA_KEY), 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('elite-availability-v1'), info: encoder.encode(context),
  }, material, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  return toBase64(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function digest(value) {
  return toBase64(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export function equal(a, b) {
  const left = fromBase64(a);
  const right = fromBase64(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ (right[i] ?? 0);
  return diff === 0;
}

export async function passwordHash(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return toBase64(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: fromBase64(salt), iterations,
  }, key, 256));
}

export async function readEncrypted(request, env) {
  const jwk = privateJwk(env);
  const text = await request.text();
  if (text.length > 20000) throw new HttpError(413, 'Encrypted request is too large');
  let payload;
  try {
    const body = JSON.parse(text);
    const privateKey = await crypto.subtle.importKey('jwk', jwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, fromBase64(body.key));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(body.iv) },
      key, fromBase64(body.ciphertext));
    payload = JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new HttpError(400, 'Invalid encrypted request. Reload the page and try again.');
  }
  if (payload.path !== new URL(request.url).pathname ||
      typeof payload.issuedAt !== 'number' || Math.abs(Date.now() - payload.issuedAt) > 300000 ||
      typeof payload.nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(payload.nonce) ||
      !payload.data || typeof payload.data !== 'object') {
    throw new HttpError(400, 'Expired or invalid encrypted request. Check the device clock and try again.');
  }
  const used = await env.DB.prepare(
    'INSERT INTO auth_requests(nonce, expires_at) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING nonce'
  ).bind(payload.nonce, Date.now() + 600000).first();
  if (!used) throw new HttpError(409, 'This request has already been used. Please try again.');
  return payload.data;
}

export async function rateLimit(request, env, action, limit = 30) {
  const window = Math.floor(Date.now() / 900000);
  const bucket = await lookup(env, `${action}:${request.headers.get('CF-Connecting-IP') || 'local'}:${window}`, 'rate-limit');
  const result = await env.DB.prepare(
    `INSERT INTO auth_attempts(bucket, attempts, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`
  ).bind(bucket, (window + 1) * 900000).first();
  if (result.attempts > limit) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
}

export const normalizeName = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
export const normalizeUsername = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';

export function validateUsername(username) {
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new HttpError(400, 'Username must be 3–32 characters: letters, numbers, dots, underscores or hyphens.');
  }
}

export async function protectPeople(env) {
  privateJwk(env);
  const { results } = await env.DB.prepare('SELECT id, name FROM people WHERE name_lookup IS NULL').all();
  for (const person of results) {
    const name = normalizeName(person.name);
    await env.DB.prepare('UPDATE people SET name = ?, name_lookup = ? WHERE id = ? AND name_lookup IS NULL')
      .bind(await encryptField(env, name, 'person-name'), await lookup(env, name.toLowerCase(), 'person-name'), person.id)
      .run();
  }
}

export async function readPeople(env, sql = 'SELECT id, name FROM people') {
  const { results } = await env.DB.prepare(sql).all();
  const people = await Promise.all(results.map(async (person) => ({
    ...person, name: await decryptField(env, person.name, 'person-name'),
  })));
  return people.sort((a, b) => a.name.localeCompare(b.name));
}
