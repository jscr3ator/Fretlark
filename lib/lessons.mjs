import {manageUsers} from './user-management.mjs';
import {findArtwork} from './artwork.mjs';
// Only server-authorized teachers may write. Share tokens grant read access only.
import {account, authAction, clearSessionCookie, legacyOwner, reauthenticate, requestJson, registrationOpen, isOwner, sessionSecurity} from './teacher-auth.mjs';
import {planFor} from './plans.mjs';
import {accountPaymentStatements} from './plans.mjs';
const MAX=30*1024*1024;
const storage = (db,owner) => db.prepare('SELECT COUNT(*) AS songs,COALESCE(SUM(file_size),0) AS used_bytes FROM lessons WHERE owner_id=?').bind(owner).first();
const quotaError = plan => new Failure(`Your cloud storage is full (${plan.limit_bytes/1048576} MB or ${plan.limit_songs} songs). Remove a song or save it to your device.`,507);
const pricing = () => ({});
const fields='id,owner_id,title,artist,notes,file_name,file_key,file_size,track_count,bar_count,tempo,share_token,shared,version,created_at,updated_at,student_settings';
const json=(value,status=200,extra={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
class Failure extends Error {constructor(message,status=400){super(message);this.status=status;}}
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const num=(v,max=10000)=>Math.max(0,Math.min(max,Math.round(Number(v)||0)));
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const defaults={notation:'both',show_mixer:true,show_track_controls:true,metronome:true,count_in:true,allow_print:true,allow_download:true};
const notationModes = ["both", "standard", "tab", "slash", "numbered"];
function settings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !(k in defaults) && !["allowed_tracks", "allowed_notations"].includes(k)) || !notationModes.includes(value.notation) || Object.keys(defaults).filter((k) => k !== "notation").some((k) => typeof value[k] !== "boolean")) throw new Failure("Invalid viewer settings.");
  const tracks = value.allowed_tracks ?? null, modes = value.allowed_notations ?? notationModes;
  if (tracks !== null && (!Array.isArray(tracks) || !tracks.length || tracks.length > 256 || tracks.some((i) => !Number.isInteger(i) || i < 0 || i > 255))) throw new Failure("Choose at least one valid track.");
  if (!Array.isArray(modes) || !modes.length || modes.some((m) => !notationModes.includes(m)) || !modes.includes(value.notation)) throw new Failure("Choose a starting notation from the allowed views.");
  return { ...value, allowed_tracks: tracks === null ? null : [...new Set(tracks)], allowed_notations: [...new Set(modes)] };
}
const parsedSettings = (r) => {
  const v = JSON.parse(r.student_settings);
  return { ...v, allowed_tracks: v.allowed_tracks ?? null, allowed_notations: v.allowed_notations ?? notationModes };
};
const publicLesson=r=>({format:r.file_name.split('.').pop().toLowerCase(),title:r.title,artist:r.artist,track_count:r.track_count,bar_count:r.bar_count,tempo:r.tempo,updated_at:r.updated_at,student_settings:parsedSettings(r)});
const adminLesson=r=>{const {file_key,owner_id,...safe}=r;return {...safe,student_settings:parsedSettings(r)};};
function sameOrigin(r){const origin=r.headers.get('origin');if(origin!==new URL(r.url).origin || r.headers.get('sec-fetch-site')==='cross-site')throw new Failure('This action must start in Fretlark.',403);}
async function deleteAccount(r,e,current){
 if(!current)throw new Failure('Sign in to delete your account.',403);
 if(isOwner(current,e))throw new Failure('The owner account cannot be deleted. Hand over ownership first.',403);
 const body=await requestJson(r);
 if(body.confirm!==current.email)throw new Failure('Type your username to confirm deletion.');
 await reauthenticate(r,e,current,body.current_password,body.code,true);
 const files=await e.DB.prepare('SELECT file_key FROM lessons WHERE owner_id=?').bind(current.id).all();
 // Account access and every related row disappear together; file cleanup is best-effort afterwards.
 await e.DB.batch([
  e.DB.prepare('DELETE FROM lesson_views WHERE lesson_id IN (SELECT id FROM lessons WHERE owner_id=?)').bind(current.id),
  e.DB.prepare('DELETE FROM auth_challenges WHERE teacher_id=?').bind(current.id),
  e.DB.prepare('DELETE FROM email_tokens WHERE teacher_id=?').bind(current.id),
  e.DB.prepare('DELETE FROM teacher_sessions WHERE teacher_id=?').bind(current.id),
  e.DB.prepare('DELETE FROM lessons WHERE owner_id=?').bind(current.id),
  ...accountPaymentStatements(e.DB,current.id),
  e.DB.prepare('DELETE FROM teachers WHERE id=?').bind(current.id)
 ]);
 for(const file of files.results){try{await e.BUCKET.delete(file.file_key);}catch{console.error(JSON.stringify({event:'account-file-cleanup-failed',key:file.file_key}));}}
 console.log(JSON.stringify({event:'account-self-delete',actor:current.id}));
 return {value:{ok:true},cookie:clearSessionCookie()};
}
async function upload(r) {
  const type = r.headers.get("content-type") || "";
  let data, file, stream, size, name;
  if (type.toLowerCase().startsWith("application/octet-stream")) {
    const header = r.headers.get("x-fretphrase-metadata") || r.headers.get("x-phraseloft-metadata") || r.headers.get("x-fretline-metadata");
    if (!header || header.length > 12e4) throw new Failure("Invalid upload metadata.", 400);
    try {
      data = JSON.parse(decodeURIComponent(header));
    } catch {
      throw new Failure("Invalid upload metadata.", 400);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Failure("Invalid upload metadata.", 400);
    name = typeof data.file_name === "string" ? data.file_name : "";
    size = data.file_size;
    if (!Number.isSafeInteger(size) || size < 1) throw new Failure("Choose a file.");
    if (size > MAX) throw new Failure("Use a file smaller than 30 MB.", 413);
    const length = r.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) !== size)) throw new Failure("Upload size does not match the file.", 400);
    if (!r.body) throw new Failure("Choose a file.");
    stream = r.body;
  } else {
    const limit2 = 1024 * 1024;
    if (Number(r.headers.get("content-length") || 0) > limit2) throw new Failure("Please refresh Fretlark to upload this file.", 413);
    if (!r.body) throw new Failure("Choose a file.");
    let count = 0;
    const body = r.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
      count += chunk.byteLength;
      if (count > limit2) throw new Failure("Please refresh Fretlark to upload this file.", 413);
      controller.enqueue(chunk);
    } }));
    let form;
    try {
      form = await new Response(body, { headers: { "Content-Type": type } }).formData();
    } catch (err) {
      if (err.status) throw err;
      throw new Failure("Choose a file.");
    }
    file = form.get("file");
    if (!file || typeof file.stream !== "function" || !file.size) throw new Failure("Choose a file.");
    data = Object.fromEntries(form);
    name = file.name;
    size = file.size;
    stream = file.stream();
  }
  if (!/\.(gp|gp3|gp4|gp5|gp6|gp7|gp8|gpx|xml|musicxml|mxl|atex)$/i.test(name)) throw new Failure("Choose a GP, MusicXML or alphaTex file.");
  return { data, stream, size, name, title: clean(data.title || name.replace(/\.[^.]+$/, "")) || "Untitled", artist: clean(data.artist), notes: clean(data.notes, 1e4), tracks: num(data.track_count, 256), bars: num(data.bar_count), tempo: num(data.tempo, 400) || 120 };
}
async function putUpload(bucket, key, u) {
  const fixed = new FixedLengthStream(u.size);
  const abort = new AbortController();
  const pipe = u.stream.pipeTo(fixed.writable, { signal: abort.signal });
  const put = bucket.put(key, fixed.readable, { httpMetadata: { contentType: "application/octet-stream" } }).catch((err) => {
    abort.abort(err);
    throw err;
  });
  const results = await Promise.allSettled([pipe, put]);
  if (results.some((result) => result.status === "rejected")) {
    await bucket.delete(key);
    throw new Failure("Upload size does not match the file or the upload was interrupted.", 400);
  }
}
async function fileResponse(row,e){const file=await e.BUCKET.get(row.file_key);if(!file)throw new Failure('Song file is unavailable. Ask the owner to upload it again.',404);return new Response(file.body,{headers:{'Content-Type':'application/octet-stream','Content-Length':String(file.size),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
const demoResponse=(r,e)=>e.ASSETS.fetch(new Request(new URL('/editor/demo.gp',r.url)));
export async function handleApi(r,e){
 try{
  const path=new URL(r.url).pathname.replace(/^\/api\//,'').split('/').filter(Boolean),method=r.method;
  if(path[0]==='demo' && path.length===1 && method==='GET')return demoResponse(r,e);
  const current=await account(r,e), legacy=legacyOwner(r,e);
  if(path[0]==='session'&&method==='GET'){
   const legacyMigrationAvailable=!!(legacy&&e.DB&&await e.DB.prepare('SELECT 1 FROM lessons WHERE owner_id=? LIMIT 1').bind(legacy.id).first());
   return json({...pricing(e),owner:isOwner(current,e),registrationOpen:registrationOpen(e),authenticated:!!(current||legacy),hasRecoveryKey:current?!!current.has_recovery:null,admin:!!(current||legacy),email:current?.email||legacy?.email||null,authType:current?'password':legacy?'legacy':null,legacyMigrationAvailable});
  }
  if(!e.DB||!e.BUCKET)throw new Failure('Song storage is not configured.',503);
  if(path[0]==='auth' && path[1]==='delete-account' && path.length===2 && method==='POST'){sameOrigin(r);const result=await deleteAccount(r,e,current);return json(result.value,200,result.cookie?{'Set-Cookie':result.cookie}:{});}
  if(path[0]==='auth' && path.length===2 && method==='POST') {sameOrigin(r);const result=await authAction(r,e,path[1],current);return json(result.value,200,result.cookie?{'Set-Cookie':result.cookie}:{});}
  if(path[0]==='security' && path.length===1 && ['GET','POST'].includes(method)){if(method!=='GET')sameOrigin(r);const result=await sessionSecurity(r,e,current,method);return json(result.value,200,result.cookie?{'Set-Cookie':result.cookie}:{});}
  if(path[0]==='owner' && path[1]==='users' && path.length===2){if(!isOwner(current,e))throw new Failure('Owner access required.',403);if(method!=='GET')sameOrigin(r);return json(await manageUsers(r,e,current));}
  if(path[0]==='shared'){
   if(method!=='GET')throw new Failure('Shared songs are read-only.',405);
   if(!/^[a-f0-9]{64}$/.test(path[1]||''))throw new Failure('This song link is unavailable or has been revoked.',404);
   const row=await e.DB.prepare(`SELECT ${fields} FROM lessons WHERE share_token=? AND shared=1 AND NOT EXISTS (SELECT 1 FROM teachers WHERE teachers.id=lessons.owner_id AND teachers.suspended=1)`).bind(path[1]).first();if(!row)throw new Failure('This song link is unavailable or has been revoked.',404);
   if(path.length===2)return json(publicLesson(row));if(path.length===3&&path[2]==='file')return fileResponse(row,e);if(path.length===3&&path[2]==='artwork')return json({title:row.title,artist:row.artist,artwork:await findArtwork(row.title,row.artist)});throw new Failure('Not found.',404);
  }
  if(path[0]!=='admin')throw new Failure('Not found.',404);
  if(!current && !legacy)throw new Failure('Sign in to manage your songs.',403);
  if(method!=='GET')sameOrigin(r);const owner=current?.id || legacy.id;
  if(path[1]==='storage' && path.length===2 && method==='GET')return json({...await storage(e.DB,owner),...await planFor(e,owner,!current&&legacy),...pricing(e)});
  if(path[1]==='demo'&&method==='GET'){const response=await demoResponse(r,e);const result=new Response(response.body,response);result.headers.set('Cache-Control','private, no-store');return result;}
  if(path[1]==='artwork'&&path.length===2&&method==='GET'){const q=new URL(r.url).searchParams,title=String(q.get('title')||'').trim().slice(0,180);if(!title)return json({artwork:null});return json({artwork:await findArtwork(title,String(q.get('artist')||'').trim().slice(0,180))});}
  if(path[1]!=='lessons')throw new Failure('Not found.',404);
  if(path.length===2){
   if(method==='GET'){const result=await e.DB.prepare(`SELECT ${fields} FROM lessons WHERE owner_id=? ORDER BY updated_at DESC`).bind(owner).all();return json({lessons:result.results.map(adminLesson)});}
   if(method==='POST'){
    const u=await upload(r),usage=await storage(e.DB,owner),plan=await planFor(e,owner,!current&&legacy);
    if(usage.songs>=plan.limit_songs || usage.used_bytes+u.size>plan.limit_bytes)throw quotaError(plan);
    const id=crypto.randomUUID(),key=`scores/${id}/${crypto.randomUUID()}`,now=new Date().toISOString();await putUpload(e.BUCKET,key,u);
    try{const result=await e.DB.prepare('INSERT INTO lessons (id,owner_id,title,artist,notes,file_name,file_key,file_size,track_count,bar_count,tempo,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM lessons WHERE owner_id=?)<? AND (SELECT COALESCE(SUM(file_size),0) FROM lessons WHERE owner_id=?)+?<=?').bind(id,owner,u.title,u.artist,u.notes,clean(u.name,255),key,u.size,u.tracks,u.bars,u.tempo,now,now,owner,plan.limit_songs,owner,u.size,plan.limit_bytes).run();if(!result.meta.changes)throw quotaError(plan);}catch(err){await e.BUCKET.delete(key);throw err;}
    return json(adminLesson(await e.DB.prepare(`SELECT ${fields} FROM lessons WHERE id=?`).bind(id).first()),201);
   }
  }
  const id=path[2];if(!id)throw new Failure('Not found.',404);
  const row=await e.DB.prepare(`SELECT ${fields} FROM lessons WHERE id=? AND owner_id=?`).bind(id,owner).first();if(!row)throw new Failure('Song not found.',404);
  if(path.length===4 && path[3]==='artwork' && method==='GET')return json({artwork:await findArtwork(row.title,row.artist)});
  if(path.length===3){
   if(method==='GET')return json(adminLesson(row));
   if(method==='DELETE'){const result=await e.DB.prepare('DELETE FROM lessons WHERE id=? AND owner_id=? AND version=?').bind(id,owner,row.version).run();if(!result.meta.changes)throw new Failure('This song changed. Refresh and try again.',409);try{await e.BUCKET.delete(row.file_key);}catch(err){console.error('Could not remove deleted song file:',err);}return json({deleted:true});}
   if(method==='PATCH'){
    const body=await requestJson(r);if(Number(body.version)!==row.version)throw new Failure('This song changed in another window. Refresh before saving.',409);
    const studentSettings=body.student_settings===undefined?row.student_settings:JSON.stringify(settings(body.student_settings));
    const result=await e.DB.prepare('UPDATE lessons SET title=?,artist=?,notes=?,student_settings=?,version=version+1,updated_at=? WHERE id=? AND owner_id=? AND version=?').bind(clean(body.title)||row.title,clean(body.artist),clean(body.notes,10000),studentSettings,new Date().toISOString(),id,owner,row.version).run();if(!result.meta.changes)throw new Failure('This song changed. Refresh and try again.',409);
    return json(adminLesson(await e.DB.prepare(`SELECT ${fields} FROM lessons WHERE id=?`).bind(id).first()));
   }
  }
  if(path[3]==='file'&&path.length===4){
   if(method==='GET')return fileResponse(row,e);
   if(method==='PUT'){
    const u=await upload(r);if(Number(u.data.version)!==row.version)throw new Failure('This song changed in another window. Reload before replacing it.',409);
    const plan=await planFor(e,owner,!current&&legacy),fits=async()=>u.size<=row.file_size||(await storage(e.DB,owner)).used_bytes-row.file_size+u.size<=plan.limit_bytes;
    if(!await fits())throw quotaError(plan);
    const key=`scores/${id}/${crypto.randomUUID()}`;await putUpload(e.BUCKET,key,u);let result;
    const previousSettings=parsedSettings(row),reviewTracks=previousSettings.allowed_tracks!==null;
    const nextSettings=reviewTracks?JSON.stringify({...previousSettings,allowed_tracks:[]}):row.student_settings;
    try{result=await e.DB.prepare('UPDATE lessons SET title=?,artist=?,file_name=?,file_key=?,file_size=?,track_count=?,bar_count=?,tempo=?,student_settings=?,shared=?,version=version+1,updated_at=? WHERE id=? AND owner_id=? AND version=? AND (?<=file_size OR (SELECT COALESCE(SUM(file_size),0) FROM lessons WHERE owner_id=?)-file_size+?<=?)').bind(u.title,u.artist,clean(u.name,255),key,u.size,u.tracks,u.bars,u.tempo,nextSettings,reviewTracks?0:row.shared,new Date().toISOString(),id,owner,row.version,u.size,owner,u.size,plan.limit_bytes).run();}catch(err){await e.BUCKET.delete(key);throw err;}
    if(!result.meta.changes){await e.BUCKET.delete(key);if(!await fits())throw quotaError(plan);throw new Failure('This song changed. Reload before saving.',409);}try{await e.BUCKET.delete(row.file_key);}catch(err){console.error('Could not remove replaced song file:',err);}
    return json(adminLesson(await e.DB.prepare(`SELECT ${fields} FROM lessons WHERE id=?`).bind(id).first()));
   }
  }
  if(path[3]==='share'&&path.length===4){
   let result;
   if(method==='POST'){const body=await requestJson(r);if(parsedSettings(row).allowed_tracks?.length===0)throw new Failure('Review and save the visible tracks before enabling the shared link.');result=await e.DB.prepare('UPDATE lessons SET share_token=?,shared=1,version=version+1,updated_at=? WHERE id=? AND owner_id=? AND version=?').bind(body.rotate||!row.share_token||!row.shared?token():row.share_token,new Date().toISOString(),id,owner,row.version).run();}
   else if(method==='DELETE')result=await e.DB.prepare('UPDATE lessons SET shared=0,version=version+1,updated_at=? WHERE id=? AND owner_id=? AND version=?').bind(new Date().toISOString(),id,owner,row.version).run();else throw new Failure('Method not allowed.',405);
   if(!result.meta.changes)throw new Failure('This song changed. Refresh and try again.',409);
   return json(adminLesson(await e.DB.prepare(`SELECT ${fields} FROM lessons WHERE id=?`).bind(id).first()));
  }
  throw new Failure('Method not allowed.',405);
 }catch(err){
  if(!err.status)console.error('Fretlark API failed:',err);
  const action=new URL(r.url).pathname.split('/')[3];
  const authError={register:'Your account could not be created. Please try again.',login:'You could not be signed in. Please try again.',logout:'You could not be signed out. Please try again.',password:'Your password could not be changed. Please try again.','delete-account':'Your account could not be deleted. Please try again.',claim:'Your older songs could not be moved. Please try again.'};
  const fallback=new URL(r.url).pathname.startsWith('/api/auth/')?authError[action]||'Account request failed. Please try again.':'The song could not be saved. Please try again.';
  return json({error:err.status?err.message:fallback,...(err.code==='reauth_required'?{code:err.code}:{})},err.status||500);
 }
}

