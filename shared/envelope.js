export function toBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

export function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function encryptRequest(publicJwk, path, data) {
  const publicKey = await crypto.subtle.importKey('jwk', publicJwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = JSON.stringify({ path, data, issuedAt: Date.now(), nonce: crypto.randomUUID() });
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(payload));
  const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey,
    await crypto.subtle.exportKey('raw', key));
  return { iv: toBase64(iv), key: toBase64(wrappedKey), ciphertext: toBase64(ciphertext) };
}
