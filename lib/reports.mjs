// Song reports: anyone with a share link can flag a song; the instance owner reviews them in the library.
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const digest = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
export const REPORT_REASONS = ['copyright', 'inappropriate', 'broken', 'other'];
const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
const PER_IP_PER_HOUR = 5, OPEN_PER_SONG = 50;
// At this many violations an account's share links all turn off and it cannot create new ones.
export const VIOLATION_LIMIT = 3;
export const violationCount = async (e, teacherId) => (await e.DB.prepare('SELECT COUNT(*) AS n FROM account_violations WHERE teacher_id=?').bind(teacherId).first()).n;
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const validContact = value => !value || (value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));

// body comes from requestJson; row is the shared lesson the token resolved to.
export async function createReport(r, e, row, body) {
  const reason = String(body.reason || '');
  if (!REPORT_REASONS.includes(reason)) throw fail('Choose a reason for the report.');
  const details = clean(body.details, 1000), contact = clean(body.contact, 254);
  if (!validContact(contact)) throw fail('Enter a valid email address, or leave it empty.');
  if ((reason === 'copyright' || reason === 'other') && details.length < 10) throw fail('Add a few words so the report can be reviewed.');
  const now = Date.now(), ip = r.headers.get('cf-connecting-ip') || 'unknown';
  const ipHash = await digest('report:' + ip);
  const recent = await e.DB.prepare('SELECT COUNT(*) AS n FROM song_reports WHERE ip_hash=? AND created_at>?').bind(ipHash, now - HOUR).first();
  if (recent.n >= PER_IP_PER_HOUR) throw fail('Too many reports. Try again later.', 429);
  // A repeat report of the same song from the same visitor within a day is accepted but not stored twice.
  const duplicate = await e.DB.prepare('SELECT 1 FROM song_reports WHERE ip_hash=? AND lesson_id=? AND created_at>? LIMIT 1').bind(ipHash, row.id, now - DAY).first();
  if (duplicate) return {ok: true};
  const open = await e.DB.prepare("SELECT COUNT(*) AS n FROM song_reports WHERE lesson_id=? AND status='open'").bind(row.id).first();
  if (open.n >= OPEN_PER_SONG) return {ok: true};
  const id = hex(crypto.getRandomValues(new Uint8Array(16)));
  await e.DB.prepare('INSERT INTO song_reports (id,lesson_id,owner_id,share_token,title,artist,reason,details,contact,ip_hash,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, row.id, row.owner_id, row.share_token, clean(row.title, 180), clean(row.artist, 180), reason, details, contact, ipHash, 'open', now).run();
  return {ok: true};
}

const listQuery = `SELECT r.id,r.lesson_id,r.share_token,r.title,r.artist,r.reason,r.details,r.contact,r.status,r.created_at,r.resolved_at,
  t.email AS uploader, (SELECT COUNT(*) FROM account_violations v WHERE v.teacher_id=r.owner_id) AS violations, CASE WHEN l.id IS NULL THEN 'deleted' WHEN l.shared=1 AND l.share_token=r.share_token THEN 'live' ELSE 'off' END AS link_state
  FROM song_reports r LEFT JOIN lessons l ON l.id=r.lesson_id LEFT JOIN teachers t ON t.id=r.owner_id`;

// Owner-only. path is ['owner','reports', id?, action?].
export async function manageReports(r, e, path, method, readBody) {
  if (path.length === 2 && method === 'GET') {
    const status = new URL(r.url).searchParams.get('status') === 'all' ? 'all' : 'open';
    const rows = await e.DB.prepare(`${listQuery} ${status === 'open' ? "WHERE r.status='open'" : ''} ORDER BY r.created_at DESC LIMIT 200`).all();
    const open = await e.DB.prepare("SELECT COUNT(*) AS n FROM song_reports WHERE status='open'").first();
    return {reports: rows.results || [], open: open.n};
  }
  const id = path[2];
  if (!/^[a-f0-9]{32}$/.test(id || '')) throw fail('Report not found.', 404);
  const report = await e.DB.prepare('SELECT id,lesson_id,owner_id,share_token,title,reason FROM song_reports WHERE id=?').bind(id).first();
  if (!report) throw fail('Report not found.', 404);
  const now = Date.now();
  if (path.length === 3 && method === 'PATCH') {
    const status = (await readBody()).status;
    if (!['open', 'resolved'].includes(status)) throw fail('Invalid status.');
    await e.DB.prepare('UPDATE song_reports SET status=?,resolved_at=? WHERE id=?').bind(status, status === 'resolved' ? now : null, id).run();
  } else if (path.length === 3 && method === 'DELETE') {
    await e.DB.prepare('DELETE FROM song_reports WHERE id=?').bind(id).run();
  } else if (path.length === 4 && path[3] === 'disable-link' && method === 'POST') {
    // Turns the reported link off (same as the uploader revoking it) and resolves every open report on that link.
    // With violation: true the uploader's account also gets a strike; that song cannot be shared again while it stands.
    const body = await readBody();
    const statements = [
      e.DB.prepare('UPDATE lessons SET shared=0 WHERE id=? AND share_token=?').bind(report.lesson_id, report.share_token),
      e.DB.prepare("UPDATE song_reports SET status='resolved',resolved_at=? WHERE lesson_id=? AND share_token=? AND status='open'").bind(now, report.lesson_id, report.share_token)
    ];
    const uploader = await e.DB.prepare('SELECT id FROM teachers WHERE id=?').bind(report.owner_id).first();
    const strike = body.violation === true && uploader && uploader.id !== e.OWNER_ACCOUNT_ID
      && !await e.DB.prepare('SELECT 1 FROM account_violations WHERE lesson_id=? LIMIT 1').bind(report.lesson_id).first();
    if (strike) statements.push(e.DB.prepare('INSERT INTO account_violations (id,teacher_id,lesson_id,title,reason,report_id,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(hex(crypto.getRandomValues(new Uint8Array(16))), report.owner_id, report.lesson_id, report.title, report.reason, report.id, now));
    await e.DB.batch(statements);
    if (strike && await violationCount(e, report.owner_id) >= VIOLATION_LIMIT)
      await e.DB.prepare('UPDATE lessons SET shared=0 WHERE owner_id=? AND shared=1').bind(report.owner_id).run();
  } else throw fail('Not found.', 404);
  const row = await e.DB.prepare(`${listQuery} WHERE r.id=?`).bind(id).first();
  const open = await e.DB.prepare("SELECT COUNT(*) AS n FROM song_reports WHERE status='open'").first();
  return {report: row || null, open: open.n};
}
