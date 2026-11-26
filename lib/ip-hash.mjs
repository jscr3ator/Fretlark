// Pseudonyms for visitor IP addresses. A keyed HMAC means a database or backup copy alone
// cannot be turned back into IP addresses. The key comes from the IP_HASH_SECRET secret,
// or is derived from MFA_ENCRYPTION_KEY (HKDF, so that key itself is never exposed).
// Without either secret it falls back to a plain hash, as older versions did.
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
const keys = new Map();
function secretKey(e) {
 const secret = String(e?.IP_HASH_SECRET || ''), fallback = String(e?.MFA_ENCRYPTION_KEY || '');
 const id = secret ? 's:' + secret : fallback ? 'm:' + fallback : '';
 if (!id) return null;
 if (!keys.has(id)) keys.set(id, (async () => {
  if (secret) return crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const base = await crypto.subtle.importKey('raw', encoder.encode(fallback), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('fretlark-ip-hash'), info: encoder.encode('ip pseudonyms v1')}, base, {name: 'HMAC', hash: 'SHA-256', length: 256}, false, ['sign']);
 })());
 return keys.get(id);
}
export async function ipHash(e, value) {
 const key = await secretKey(e);
 if (!key) return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
 return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
