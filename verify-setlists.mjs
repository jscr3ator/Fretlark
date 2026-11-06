import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync} from 'node:fs';
import {handleApi} from './lib/lessons.mjs';
import worker from './cloudflare/worker.mjs';

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

async function call(path, {method = 'GET', body, headers = {}, raw = false} = {}) {
  const response = await handleApi(new Request('https://scores.test/api/' + path, {method, headers: {...(method !== 'GET' ? {origin: 'https://scores.test'} : {}), ...headers, ...(body && !(body instanceof FormData) ? {'Content-Type': 'application/json'} : {})}, body: body instanceof FormData || typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined}), env);
  return {status: response.status, cookie: response.headers.get('set-cookie'), data: raw ? new Uint8Array(await response.arrayBuffer()) : await response.json()};
}
const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
let ip = 10;
async function register(name) {
  const result = await call('auth/register', {method: 'POST', headers: {'cf-connecting-ip': `192.0.2.${ip++}`}, body: {username: name, password: `${name} strong password`}});
  assert.equal(result.status, 200, `${name} can register`);
  return {cookie: result.cookie.split(';')[0]};
}
const idOf = email => sql.prepare('SELECT id FROM teachers WHERE email=?').get(email).id;
let lessonSeq = 0;
function addLesson(ownerId, title, {shared = 0, shareToken = null, id = `lesson-${++lessonSeq}`} = {}) {
  sql.prepare('INSERT INTO lessons (id,owner_id,title,artist,notes,file_name,file_key,file_size,share_token,shared,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, ownerId, title, 'Artist', '', 'song.gp', `scores/${id}`, 1, shareToken, shared, '2026-01-01', '2026-01-01');
  return id;
}
const unavailable = 'This setlist link is unavailable or has been revoked.';

const alice = await register('alice'), bob = await register('bob');
const aliceId = idOf('alice'), bobId = idOf('bob');
const tokenA = hex(), tokenB = hex(), tokenC = hex();
const a1 = addLesson(aliceId, 'Alpha', {shared: 1, shareToken: tokenA});
const a2 = addLesson(aliceId, 'Beta');
const a3 = addLesson(aliceId, 'Gamma', {shared: 1, shareToken: tokenB});
const b1 = addLesson(bobId, 'Bob song', {shared: 1, shareToken: tokenC});

assert.deepEqual((await call('admin/setlists', {headers: alice})).data, {setlists: []});
assert.equal((await call('admin/setlists', {headers: {}})).status, 403, 'Setlists require a signed-in owner');
assert.equal((await call('admin/setlists', {method: 'POST', headers: {}, body: {title: 'No'}})).status, 403);

let created = await call('admin/setlists', {method: 'POST', headers: alice, body: {title: '  Week 3 lessons  '}});
assert.equal(created.status, 201);
let main = created.data;
assert.equal(main.title, 'Week 3 lessons');
assert.deepEqual(main.songs, []);
assert.equal(main.shared, 0);
const emptyDefault = await call('admin/setlists', {method: 'POST', headers: alice, body: {}});
assert.equal(emptyDefault.data.title, 'Untitled setlist');

let list = (await call('admin/setlists', {headers: alice})).data.setlists;
assert.equal(list.length, 2);
const mainRow = list.find(row => row.id === main.id);
assert.equal(mainRow.song_count, 0);
assert.equal(mainRow.shared, 0);
assert.equal(typeof mainRow.updated_at, 'number');

let changed = await call(`admin/setlists/${main.id}`, {method: 'PATCH', headers: alice, body: {title: 'Saturday gig', notes: 'Soundcheck at 6.', lesson_ids: [a3, a1, a3]}});
assert.equal(changed.status, 200);
assert.equal(changed.data.title, 'Saturday gig');
assert.equal(changed.data.notes, 'Soundcheck at 6.');
assert.deepEqual(changed.data.songs.map(song => song.id), [a3, a1], 'duplicates are removed and order is kept');
changed = await call(`admin/setlists/${main.id}`, {method: 'PATCH', headers: alice, body: {lesson_ids: [a1, a3]}});
assert.deepEqual(changed.data.songs.map(song => song.id), [a1, a3]);
assert.deepEqual(changed.data.songs.map(song => song.title), ['Alpha', 'Gamma']);
let detail = (await call(`admin/setlists/${main.id}`, {headers: alice})).data;
assert.deepEqual(detail.songs.map(song => song.id), [a1, a3], 'GET returns position order');
changed = await call(`admin/setlists/${main.id}`, {method: 'PATCH', headers: alice, body: {title: 'x'.repeat(200), notes: 'n'.repeat(1200)}});
assert.equal(changed.data.title.length, 120, 'titles cap at 120 characters');
assert.equal(changed.data.notes.length, 1000, 'notes cap at 1000 characters');

assert.equal((await call(`admin/setlists/${main.id}`, {headers: bob})).status, 404, 'another account cannot read a setlist');
assert.equal((await call(`admin/setlists/${main.id}`, {method: 'PATCH', headers: bob, body: {title: 'Hacked'}})).status, 404);
assert.equal((await call(`admin/setlists/${main.id}/share`, {method: 'POST', headers: bob, body: {}})).status, 404);
assert.equal((await call(`admin/setlists/${main.id}`, {method: 'DELETE', headers: bob})).status, 404);
assert.equal((await call(`admin/setlists/${main.id}`, {headers: alice})).status, 200);
assert.deepEqual((await call('admin/setlists', {headers: bob})).data.setlists, []);

const beforeCrossLesson = (await call(`admin/setlists/${main.id}`, {headers: alice})).data.songs;
assert.equal((await call(`admin/setlists/${main.id}`, {method: 'PATCH', headers: alice, body: {lesson_ids: [a1, b1]}})).status, 400, 'songs from another account are rejected');
assert.equal((await call(`admin/setlists/${main.id}`, {method: 'PATCH', headers: alice, body: {lesson_ids: 'nope'}})).status, 400);
assert.deepEqual((await call(`admin/setlists/${main.id}`, {headers: alice})).data.songs, beforeCrossLesson);

for (let i = 0; i < 101; i++) addLesson(aliceId, `Bulk ${i}`, {id: `bulk-${i}`});
const bulkIds = Array.from({length: 101}, (_, i) => `bulk-${i}`);
const hundred = await call(`admin/setlists/${main.id}`, {method: 'PATCH', headers: alice, body: {lesson_ids: bulkIds.slice(0, 100)}});
assert.equal(hundred.status, 200, 'a setlist accepts 100 songs');
assert.equal(hundred.data.songs.length, 100);
assert.equal((await call(`admin/setlists/${main.id}`, {method: 'PATCH', headers: alice, body: {lesson_ids: bulkIds}})).status, 400, 'a setlist holds at most 100 songs');

for (let i = 0; i < 48; i++) assert.equal((await call('admin/setlists', {method: 'POST', headers: alice, body: {title: `Extra ${i}`}})).status, 201);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM setlists WHERE owner_id=?').get(aliceId).n, 50);
assert.equal((await call('admin/setlists', {method: 'POST', headers: alice, body: {title: 'Too many'}})).status, 400, 'an account keeps at most 50 setlists');

changed = await call(`admin/setlists/${main.id}`, {method: 'PATCH', headers: alice, body: {title: 'Saturday gig', notes: '', lesson_ids: [a1, a2, a3]}});
assert.deepEqual(changed.data.songs.map(song => song.id), [a1, a2, a3]);

let shared = await call(`admin/setlists/${main.id}/share`, {method: 'POST', headers: alice, body: {}});
assert.equal(shared.status, 200);
assert.equal(shared.data.shared, 1);
let setToken = shared.data.share_token;
assert.match(setToken, /^[a-f0-9]{64}$/, 'setlist links use a 64-hex token');
let publicList = await call(`shared-set/${setToken}`, {headers: {}});
assert.equal(publicList.status, 200);
assert.equal(publicList.data.title, 'Saturday gig');
assert.equal(publicList.data.notes, '');
assert.equal((await call(`shared/${setToken}`, {headers: {}})).status, 404, 'a setlist token cannot open a song');
assert.deepEqual(publicList.data.songs.map(song => song.title), ['Alpha', 'Gamma'], 'public view lists only songs with their own link on');
assert.deepEqual(publicList.data.songs.map(song => song.share_token), [tokenA, tokenB]);
assert.deepEqual(Object.keys(publicList.data).sort(), ['notes', 'songs', 'title']);
for (const song of publicList.data.songs) assert.deepEqual(Object.keys(song).sort(), ['artist', 'share_token', 'title']);
assert.equal(JSON.stringify(publicList.data).includes(aliceId), false, 'owner ids never leak');
assert.equal(JSON.stringify(publicList.data).includes('alice'), false, 'emails never leak');

let missing = await call(`shared-set/${'0'.repeat(64)}`, {headers: {}});
assert.equal(missing.status, 404);
assert.equal(missing.data.error, unavailable);
assert.equal((await call(`shared-set/${setToken}`, {method: 'POST', headers: {}, body: {}})).status, 405);

sql.prepare('UPDATE teachers SET suspended=1 WHERE id=?').run(aliceId);
assert.equal((await call(`shared-set/${setToken}`, {headers: {}})).status, 404, 'a suspended owner hides the setlist');
sql.prepare('UPDATE teachers SET suspended=0 WHERE id=?').run(aliceId);

const rotated = await call(`admin/setlists/${main.id}/share`, {method: 'POST', headers: alice, body: {rotate: true}});
assert.notEqual(rotated.data.share_token, setToken, 'rotate creates a new token');
assert.equal((await call(`shared-set/${setToken}`, {headers: {}})).status, 404);
assert.equal((await call(`shared-set/${rotated.data.share_token}`, {headers: {}})).status, 200);
setToken = rotated.data.share_token;
const off = await call(`admin/setlists/${main.id}/share`, {method: 'DELETE', headers: alice});
assert.equal(off.data.shared, 0);
assert.equal((await call(`shared-set/${setToken}`, {headers: {}})).status, 404, 'turning the link off revokes it');
const again = await call(`admin/setlists/${main.id}/share`, {method: 'POST', headers: alice, body: {rotate: false}});
assert.notEqual(again.data.share_token, setToken, 'turning the link back on revokes the old token');
setToken = again.data.share_token;
assert.equal((await call(`shared-set/${setToken}`, {headers: {}})).status, 200);

for (let i = 0; i < 3; i++) sql.prepare('INSERT INTO account_violations (id,teacher_id,lesson_id,title,reason,created_at) VALUES (?,?,?,?,?,?)').run(`violation-${i}`, aliceId, `lesson-${i}`, 'Strike', 'copyright', Date.now());
const blocked = await call(`admin/setlists/${main.id}/share`, {method: 'POST', headers: alice, body: {}});
assert.equal(blocked.status, 403);
assert.equal(blocked.data.error, 'Sharing is turned off for this account after repeated violations.');
sql.prepare('DELETE FROM account_violations WHERE teacher_id=?').run(aliceId);
assert.equal((await call(`admin/setlists/${main.id}/share`, {method: 'POST', headers: alice, body: {}})).status, 200);
setToken = (await call(`admin/setlists/${main.id}`, {headers: alice})).data.share_token;

assert.equal((await call(`admin/lessons/${a1}`, {method: 'DELETE', headers: alice})).status, 200);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM setlist_items WHERE lesson_id=?').get(a1).n, 0, 'deleting a lesson removes it from setlists');
detail = (await call(`admin/setlists/${main.id}`, {headers: alice})).data;
assert.equal(detail.songs.some(song => song.id === a1), false);
assert.equal((await call(`shared-set/${setToken}`, {headers: {}})).data.songs.some(song => song.title === 'Alpha'), false);

assert.equal((await call('admin/setlists', {method: 'POST', headers: {...alice, origin: 'https://attacker.test'}, body: {title: 'Evil'}})).status, 403, 'cross-site create is rejected');
assert.equal((await call(`admin/setlists/${main.id}`, {method: 'PATCH', headers: {...alice, origin: 'https://attacker.test'}, body: {title: 'Evil'}})).status, 403);
assert.equal((await call(`admin/setlists/${main.id}`, {method: 'DELETE', headers: {...alice, origin: 'https://attacker.test'}})).status, 403);
assert.equal((await call(`admin/setlists/${main.id}/share`, {method: 'POST', headers: {...alice, origin: 'https://attacker.test'}, body: {}})).status, 403);

const carol = await register('carol');
const carolId = idOf('carol');
const carolLesson = addLesson(carolId, 'Carol song');
const carolSet = (await call('admin/setlists', {method: 'POST', headers: carol, body: {title: 'Carol list'}})).data;
assert.equal((await call(`admin/setlists/${carolSet.id}`, {method: 'PATCH', headers: carol, body: {lesson_ids: [carolLesson]}})).status, 200);
assert.equal((await call('auth/delete-account', {method: 'POST', headers: carol, body: {confirm: 'carol', current_password: 'carol strong password'}})).status, 200);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM setlists WHERE owner_id=?').get(carolId).n, 0, 'self-delete removes setlists');
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM setlist_items WHERE setlist_id=?').get(carolSet.id).n, 0, 'self-delete removes setlist items');

const dave = await register('dave');
const daveId = idOf('dave');
const daveSet = (await call('admin/setlists', {method: 'POST', headers: dave, body: {title: 'Dave list'}})).data;
env.OWNER_ACCOUNT_ID = aliceId;
assert.equal((await call('owner/users', {method: 'POST', headers: alice, body: {action: 'delete', id: daveId, confirm_email: 'dave', current_password: 'alice strong password'}})).status, 200);
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM setlists WHERE owner_id=?').get(daveId).n, 0, 'owner delete removes setlists');
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM setlist_items WHERE setlist_id=?').get(daveSet.id).n, 0, 'owner delete removes setlist items');
delete env.OWNER_ACCOUNT_ID;

const page = await worker.fetch(new Request(`https://scores.test/set/${'a'.repeat(64)}`), env);
assert.equal(await page.text(), '/set.html', '/set/<token> serves the setlist page');
assert.match(page.headers.get('X-Robots-Tag') || '', /noindex/, 'setlist pages are noindex');

assert.match(sql.prepare('EXPLAIN QUERY PLAN SELECT id FROM setlists WHERE owner_id=? ORDER BY updated_at DESC').all('x').map(row => row.detail).join(' '), /setlists_owner_updated/);
assert.match(sql.prepare('EXPLAIN QUERY PLAN SELECT setlist_id FROM setlist_items WHERE lesson_id=?').all('x').map(row => row.detail).join(' '), /setlist_items_lesson/);
console.log('PASS: setlist create/list/rename/reorder, ownership isolation, limits, sharing, revoke/rotate, public filtering, suspension, violations, lesson/account cleanup, CSRF and the /set page.');
