import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {handleApi} from './lib/lessons.mjs';

globalThis.FixedLengthStream = class {
  constructor(size) { let count = 0; const stream = new TransformStream({transform(chunk, controller) { count += chunk.byteLength; if (count > size) throw new Error('Length mismatch'); controller.enqueue(chunk); }, flush() { if (count !== size) throw new Error('Length mismatch'); }}); this.readable = stream.readable; this.writable = stream.writable; }
};
const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
crypto.subtle.deriveBits = (algorithm, ...args) => {
  if (algorithm.name === 'PBKDF2') assert.ok(algorithm.iterations <= 100000, 'Workers PBKDF2 iteration limit exceeded');
  return deriveBits(algorithm, ...args);
};

const sql = new DatabaseSync(':memory:');
for (const name of readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort()) sql.exec(readFileSync(`drizzle/${name}`, 'utf8'));

const objects = new Map();
const env = {REGISTRATION_OPEN: 'true', ADMIN_EMAIL: 'teacher@example.test', DB: {
  async batch(statements) { sql.exec('BEGIN'); try { const result = []; for (const statement of statements) result.push(/^SELECT/i.test(statement.query) ? await statement.all() : await statement.run()); sql.exec('COMMIT'); return result; } catch (error) { sql.exec('ROLLBACK'); throw error; } },
  prepare(query) { let values = []; return {query, bind(...args) { values = args; return this; }, async first() { return sql.prepare(query).get(...values) || null; }, async all() { return {results: sql.prepare(query).all(...values)}; }, async run() { const result = sql.prepare(query).run(...values); return {meta: {changes: Number(result.changes)}}; }}; }
}, BUCKET: {async put(key, body) { objects.set(key, new Uint8Array(await new Response(body).arrayBuffer())); }, async get(key) { const bytes = objects.get(key); return bytes ? {body: bytes, size: bytes.length} : null; }, async delete(key) { objects.delete(key); }}};
env.ASSETS = {async fetch(request) { return new Response(new URL(request.url).pathname); }};

async function call(path, {method = 'GET', body, headers = {}} = {}) {
  const response = await handleApi(new Request('https://scores.test/api/' + path, {method, headers: {...(method !== 'GET' ? {origin: 'https://scores.test'} : {}), ...headers, ...(body && !(body instanceof FormData) ? {'Content-Type': 'application/json'} : {})}, body: body instanceof FormData || typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined}), env);
  return {status: response.status, data: await response.json()};
}
let ip = 40;
// Register via handleApi directly to capture the session cookie header.
async function registerWithCookie(name) {
  const response = await handleApi(new Request('https://scores.test/api/auth/register', {method: 'POST', headers: {origin: 'https://scores.test', 'Content-Type': 'application/json', 'cf-connecting-ip': `192.0.2.${ip++}`}, body: JSON.stringify({username: name, password: `${name} strong password`})}), env);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return {cookie};
}

const owner = await registerWithCookie('repowner');
const uploader = await registerWithCookie('repuploader');
const ownerId = sql.prepare('SELECT id FROM teachers WHERE email=?').get('repowner').id;
const uploaderId = sql.prepare('SELECT id FROM teachers WHERE email=?').get('repuploader').id;
env.OWNER_ACCOUNT_ID = ownerId;

// Uploader creates a song and shares it.
sql.prepare('INSERT INTO lessons (id,owner_id,title,artist,notes,file_name,file_key,file_size,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
  .run('song-takedown', uploaderId, 'Takedown Test', 'Artist', '', 'song.gp', 'scores/song-takedown', 10, '2026-01-01', '2026-01-01');
let shared = await call('admin/lessons/song-takedown/share', {method: 'POST', headers: uploader, body: {}});
assert.equal(shared.status, 200);
const token1 = shared.data.share_token;
assert.match(token1, /^[a-f0-9]{64}$/);

// A visitor reports the song.
const reported = await call(`shared/${token1}/report`, {method: 'POST', headers: {'cf-connecting-ip': '198.51.100.21'}, body: {reason: 'copyright', details: 'This copies my published book.'}});
assert.equal(reported.status, 201);

// Report card shows the song as live.
let list = await call('owner/reports', {headers: owner});
assert.equal(list.status, 200);
const reportId = list.data.reports.find(r => r.share_token === token1).id;
assert.ok(reportId, 'report is visible to the owner');
assert.equal(list.data.reports.find(r => r.id === reportId).link_state, 'live');

// The uploader rotates the link AFTER the report. The song must still read as live,
// or the owner would believe it is already offline while the new link serves the content.
const rotated = await call('admin/lessons/song-takedown/share', {method: 'POST', headers: uploader, body: {rotate: true}});
assert.equal(rotated.status, 200);
const token2 = rotated.data.share_token;
assert.notEqual(token2, token1);
list = await call('owner/reports', {headers: owner});
assert.equal(list.data.reports.find(r => r.id === reportId).link_state, 'live', 'rotating the link must not fake link_state off while the song is live');

// Takedown must silence the song under BOTH the old and the rotated token.
const taken = await call(`owner/reports/${reportId}/disable-link`, {method: 'POST', headers: owner, body: {violation: true}});
assert.equal(taken.status, 200);
assert.equal(taken.data.open, 0);
assert.equal(sql.prepare('SELECT shared FROM lessons WHERE id=?').get('song-takedown').shared, 0, 'disable-link turns the song off even after rotation');
assert.equal((await call(`shared/${token1}`, {headers: {}})).status, 404, 'old token is revoked');
assert.equal((await call(`shared/${token2}`, {headers: {}})).status, 404, 'rotated token is revoked by the takedown');
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM account_violations WHERE lesson_id=?').get('song-takedown').n, 1, 'strike is recorded');
// A taken-down song cannot simply be re-shared.
assert.equal((await call('admin/lessons/song-takedown/share', {method: 'POST', headers: uploader, body: {}})).status, 403);
console.log('PASS: report takedown survives link rotation and revokes every token.');

// The desktop app is not part of the public export, so its checks run only where it exists.
if (existsSync('desktop/src-tauri/src/server.rs')) {
  // Desktop: switching accounts must drop the previous account's offline cache,
  // otherwise the next account can read the first account's library while offline.
  const serverSrc = readFileSync('desktop/src-tauri/src/server.rs', 'utf8');
  assert.match(serverSrc, /different account/i, 'session change clears the offline cache');
  assert.ok(serverSrc.includes('remove_dir_all(st.data_dir.join("cache"))'), 'cache directory is dropped on account change');
  const remember = serverSrc.slice(serverSrc.indexOf('fn remember_cookie'));
  assert.match(remember, /changed/, 'remember_cookie tracks session changes');
  assert.ok(remember.indexOf('remove_dir_all') !== -1, 'remember_cookie invalidates the cache');
  console.log('PASS: desktop offline cache is invalidated on account change.');
} else console.log('SKIP: desktop app not present');
