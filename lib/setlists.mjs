// Setlists: a signed-in owner groups songs into an ordered list and can share it with one link.
// A setlist link never grants song access; every song still uses its own share link.
import {requestJson} from './teacher-auth.mjs';
import {violationCount, VIOLATION_LIMIT} from './reports.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const json = (value, status = 200) => Response.json(value, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[\u00a0\u2007\u202f]/g, ' ').trim().slice(0, max);
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const DEFAULT_TITLE = 'Untitled setlist';
const MAX_SETLISTS = 50, MAX_SONGS = 100;
const UNAVAILABLE = 'This setlist link is unavailable or has been revoked.';
const missingTable = error => /no such table/i.test(String(error?.message || error));

// Cleanup helpers stay safe on older local snapshots that predate the setlist migration.
export async function setlistCleanupStatements(e, owner) {
  try {
    const rows = await e.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('setlists','setlist_items')").all();
    const names = new Set((rows.results || []).map(row => row.name));
    if (!names.has('setlists') || !names.has('setlist_items')) return [];
  } catch { return []; }
  return [
    e.DB.prepare('DELETE FROM setlist_items WHERE setlist_id IN (SELECT id FROM setlists WHERE owner_id=?)').bind(owner),
    e.DB.prepare('DELETE FROM setlist_items WHERE lesson_id IN (SELECT id FROM lessons WHERE owner_id=?)').bind(owner),
    e.DB.prepare('DELETE FROM setlists WHERE owner_id=?').bind(owner)
  ];
}

export async function removeLessonFromSetlists(e, id) {
  try { await e.DB.prepare('DELETE FROM setlist_items WHERE lesson_id=?').bind(id).run(); }
  catch (error) { if (!missingTable(error)) throw error; }
}

const columns = 'id,title,notes,shared,share_token';
async function detail(e, owner, id) {
  const row = await e.DB.prepare(`SELECT ${columns} FROM setlists WHERE id=? AND owner_id=?`).bind(id, owner).first();
  if (!row) throw fail('Setlist not found.', 404);
  const songs = await e.DB.prepare(`SELECT l.id,l.title,l.artist,l.shared FROM setlist_items i JOIN lessons l ON l.id=i.lesson_id WHERE i.setlist_id=? AND l.owner_id=? ORDER BY i.position`).bind(id, owner).all();
  return {id: row.id, title: row.title, notes: row.notes, shared: row.shared, share_token: row.share_token, songs: songs.results || []};
}

async function listSetlists(e, owner) {
  const rows = await e.DB.prepare(`SELECT s.id,s.title,s.shared,s.share_token,s.updated_at,(SELECT COUNT(*) FROM setlist_items i WHERE i.setlist_id=s.id) AS song_count FROM setlists s WHERE s.owner_id=? ORDER BY s.updated_at DESC,s.rowid DESC`).bind(owner).all();
  return {setlists: (rows.results || []).map(row => ({id: row.id, title: row.title, song_count: row.song_count, shared: row.shared, share_token: row.share_token, updated_at: row.updated_at}))};
}

// Keep the requested order, drop duplicates, and reject anything not in the caller's library.
async function orderedLessonIds(e, owner, value) {
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' || !id)) throw fail('Choose songs from your library.');
  const ids = [...new Set(value)];
  if (ids.length > MAX_SONGS) throw fail(`A setlist can hold up to ${MAX_SONGS} songs.`);
  if (!ids.length) return [];
  // One owner-scoped read avoids D1's 100-parameter limit when all 100 slots are used.
  const rows = await e.DB.prepare('SELECT id FROM lessons WHERE owner_id=?').bind(owner).all();
  const owned = new Set((rows.results || []).map(row => row.id));
  if (ids.some(id => !owned.has(id))) throw fail('Choose songs from your library.');
  return ids;
}

export async function handleSetlists(r, e, path, method, owner) {
  if (path.length === 2) {
    if (method === 'GET') return json(await listSetlists(e, owner));
    if (method === 'POST') {
      const body = await requestJson(r), title = clean(body.title, 120) || DEFAULT_TITLE, now = Date.now(), id = crypto.randomUUID();
      const result = await e.DB.prepare('INSERT INTO setlists (id,owner_id,title,notes,shared,created_at,updated_at) SELECT ?,?,?,?,0,?,? WHERE (SELECT COUNT(*) FROM setlists WHERE owner_id=?)<?').bind(id, owner, title, '', now, now, owner, MAX_SETLISTS).run();
      if (!result.meta.changes) throw fail(`You can keep up to ${MAX_SETLISTS} setlists.`);
      return json(await detail(e, owner, id), 201);
    }
    throw fail('Method not allowed.', 405);
  }
  const id = path[2];
  if (!id) throw fail('Not found.', 404);
  const row = await e.DB.prepare(`SELECT ${columns} FROM setlists WHERE id=? AND owner_id=?`).bind(id, owner).first();
  if (!row) throw fail('Setlist not found.', 404);
  if (path.length === 3) {
    if (method === 'GET') return json(await detail(e, owner, id));
    if (method === 'PATCH') {
      const body = await requestJson(r);
      const title = body.title === undefined ? row.title : clean(body.title, 120) || DEFAULT_TITLE;
      const notes = body.notes === undefined ? row.notes : clean(body.notes, 1000);
      const ids = body.lesson_ids === undefined ? null : await orderedLessonIds(e, owner, body.lesson_ids);
      // One batch keeps the visible order in sync even if two windows save at once.
      const statements = [e.DB.prepare('UPDATE setlists SET title=?,notes=?,updated_at=? WHERE id=? AND owner_id=?').bind(title, notes, Date.now(), id, owner)];
      if (ids) {
        statements.push(e.DB.prepare('DELETE FROM setlist_items WHERE setlist_id=?').bind(id));
        ids.forEach((lessonId, position) => statements.push(e.DB.prepare('INSERT INTO setlist_items (setlist_id,lesson_id,position) VALUES (?,?,?)').bind(id, lessonId, position)));
      }
      await e.DB.batch(statements);
      return json(await detail(e, owner, id));
    }
    if (method === 'DELETE') {
      await e.DB.batch([
        e.DB.prepare('DELETE FROM setlist_items WHERE setlist_id=?').bind(id),
        e.DB.prepare('DELETE FROM setlists WHERE id=? AND owner_id=?').bind(id, owner)
      ]);
      return json({deleted: true});
    }
    throw fail('Method not allowed.', 405);
  }
  if (path.length === 4 && path[3] === 'share') {
    if (method === 'POST') {
      const body = await requestJson(r);
      if (await violationCount(e, owner) >= VIOLATION_LIMIT) throw fail('Sharing is turned off for this account after repeated violations.', 403);
      const next = body.rotate === true || !row.share_token || !row.shared ? token() : row.share_token;
      await e.DB.prepare('UPDATE setlists SET share_token=?,shared=1,updated_at=? WHERE id=? AND owner_id=?').bind(next, Date.now(), id, owner).run();
      return json(await detail(e, owner, id));
    }
    if (method === 'DELETE') {
      await e.DB.prepare('UPDATE setlists SET shared=0,updated_at=? WHERE id=? AND owner_id=?').bind(Date.now(), id, owner).run();
      return json(await detail(e, owner, id));
    }
    throw fail('Method not allowed.', 405);
  }
  throw fail('Not found.', 404);
}

// Public read-only view: only songs whose own link is on, and never owner ids, lesson ids or emails.
export async function publicSetlist(r, e, path, method) {
  if (method !== 'GET') throw fail('Method not allowed.', 405);
  const shareToken = path[1];
  if (path.length !== 2 || !/^[a-f0-9]{64}$/.test(shareToken || '')) throw fail(UNAVAILABLE, 404);
  const row = await e.DB.prepare(`SELECT s.title,s.notes FROM setlists s WHERE s.share_token=? AND s.shared=1 AND NOT EXISTS (SELECT 1 FROM teachers WHERE teachers.id=s.owner_id AND teachers.suspended=1)`).bind(shareToken).first();
  if (!row) throw fail(UNAVAILABLE, 404);
  const songs = await e.DB.prepare(`SELECT l.title,l.artist,l.share_token FROM setlist_items i JOIN lessons l ON l.id=i.lesson_id JOIN setlists s ON s.id=i.setlist_id WHERE s.share_token=? AND l.owner_id=s.owner_id AND l.shared=1 AND l.share_token IS NOT NULL ORDER BY i.position`).bind(shareToken).all();
  return json({title: row.title, notes: row.notes, songs: (songs.results || []).map(song => ({title: song.title, artist: song.artist, share_token: song.share_token}))});
}
