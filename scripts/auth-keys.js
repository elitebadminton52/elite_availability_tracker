import { webcrypto } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const production = process.argv.includes('--production');
const target = resolve(production ? '.auth-secrets.json' : '.dev.vars');
let existing = '';
try {
  existing = await readFile(target, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if ((production && existing) || /^(AUTH_PRIVATE_KEY|PERSONAL_DATA_KEY)=/m.test(existing)) {
  throw new Error(`Keys already exist in ${target}. Do not regenerate keys used to encrypt existing data.`);
}
const pair = await webcrypto.subtle.generateKey({
  name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256',
}, true, ['encrypt', 'decrypt']);
const secrets = {
  AUTH_PRIVATE_KEY: JSON.stringify(await webcrypto.subtle.exportKey('jwk', pair.privateKey)),
  PERSONAL_DATA_KEY: Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64'),
};
if (production) {
  await writeFile(target, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' });
} else {
  const values = Object.entries(secrets).map(([name, value]) => `${name}='${value}'`).join('\n');
  await writeFile(target, `${existing.trimEnd()}\n${values}\n`, { mode: 0o600 });
}
console.log(`Authentication keys saved to ${target}. Keep a secure backup; never commit this file.`);
