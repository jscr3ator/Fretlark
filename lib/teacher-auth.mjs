import {newSecret,sealSecret,openSecret,matchingStep,recoveryCodes,consumeFactor} from './two-factor.mjs';
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
export const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const MAX_JSON = 64 * 1024;
export const passwordHash = async (password, salt) => {
 const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
 // Hosted Workers cap PBKDF2 at 100,000 iterations; local workerd does not.
 return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:encoder.encode(salt), iterations:100000}, key, 256)));
};
const fail = (message, status=400) => Object.assign(new Error(message), {status});
const emailValue = value => String(value ?? '').trim().toLowerCase();
export const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 1024;
const cookie = value => `fretline_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${value ? 60*60*24*30 : 0}`;
export const clearSessionCookie = () => cookie('');
export const registrationOpen = e => e.REGISTRATION_OPEN === 'true';
const sameHash = (actual, expected) => { let mismatch=0; for(let i=0;i<64;i++) mismatch |= actual.charCodeAt(i)^expected.charCodeAt(i); return mismatch===0; };
export async function requestJson(r) {
 const length=Number(r.headers.get('content-length'));
 if(Number.isFinite(length)&&length>MAX_JSON)throw fail('Request body is too large.',413);
 const reader=r.body?.getReader();if(!reader)throw fail('Invalid request body.',400);
 const chunks=[];let size=0;
 while(true){
  let part;try{part=await reader.read();}catch{throw fail('Invalid request body.',400);}
  if(part.done)break;
  size+=part.value.byteLength;
  if(size>MAX_JSON){reader.cancel().catch(()=>{});throw fail('Request body is too large.',413);}
  chunks.push(part.value);
 }
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('Invalid JSON.',400);}
 if(!body||typeof body!=='object'||Array.isArray(body))throw fail('Invalid request body.',400);
 return body;
}
export function legacyOwner(r,e) {
 const id=r.headers.get('oai-authenticated-user-id'), email=r.headers.get('oai-authenticated-user-email');
 return id && e.ADMIN_EMAIL && email?.toLowerCase()===e.ADMIN_EMAIL.toLowerCase() ? {id,email} : null;
}
export async function account(r,e) {
 const raw = (r.headers.get('cookie') || '').match(/(?:^|;\s*)fretline_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 if (!raw || !e.DB) return null;
 return await e.DB.prepare('SELECT teachers.id, teachers.email,(teachers.recovery_hash IS NOT NULL) AS has_recovery,teacher_sessions.token_hash AS session_hash,teacher_sessions.elevated_until,(teachers.mfa_secret IS NOT NULL) AS mfa_enabled FROM teacher_sessions JOIN teachers ON teachers.id=teacher_sessions.teacher_id WHERE token_hash=? AND expires_at>? AND teachers.suspended=0 AND (teachers.mfa_secret IS NULL OR teacher_sessions.mfa_verified=1)').bind(await digest(raw),Date.now()).first();
}
async function limit(r,e,email,scope='auth') {
 const now=Date.now(), ip=r.headers.get('cf-connecting-ip') || 'unknown';
 await e.DB.prepare('DELETE FROM auth_limits WHERE expires_at<=?').bind(now).run();
 for (const key of [await digest(scope+':ip:'+ip),await digest(scope+':email:'+email)]) {
  await e.DB.prepare('INSERT INTO auth_limits (key,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END').bind(key,now+15*60*1000,now,now).run();
  const row=await e.DB.prepare('SELECT attempts FROM auth_limits WHERE key=?').bind(key).first();
  if(row.attempts>10) throw fail('Too many attempts. Try again later.',429);
 }
}
async function createSession(e,id,verified=false,expected=null) {
 const now=Date.now(),raw=random();
 await e.DB.prepare('DELETE FROM teacher_sessions WHERE expires_at<=?').bind(now).run();
 const result=await e.DB.prepare('INSERT INTO teacher_sessions (token_hash,teacher_id,expires_at,mfa_verified) SELECT ?,id,?,? FROM teachers WHERE id=? AND suspended=0 AND (mfa_secret IS NULL OR ?=1) AND (? IS NULL OR password_hash=?) AND (? IS NULL OR mfa_secret=?)').bind(await digest(raw),now+30*24*60*60*1000,verified?1:0,id,verified?1:0,expected?.password_hash??null,expected?.password_hash??null,expected?.mfa_secret??null,expected?.mfa_secret??null).run();
 if(!result.meta.changes)throw fail('Account security changed. Sign in again.',401);
 return cookie(raw);
}
export const isOwner = (current,e) => !!(current && e.OWNER_ACCOUNT_ID && current.id===e.OWNER_ACCOUNT_ID);
export async function reauthenticate(r,e,current,password,code,force=false) {
 if(!force && password===undefined && current.elevated_until>Date.now())return;
 if(typeof password!=='string'||!password)throw Object.assign(fail('Verify your identity to continue.',401),{code:'reauth_required'});
 await limit(r,e,current.email,'verify');
 const row=await e.DB.prepare('SELECT id,password_salt,password_hash,mfa_secret,mfa_recovery_codes FROM teachers WHERE id=? AND suspended=0').bind(current.id).first();
 if(!row || password.length>1024 || !sameHash(await passwordHash(password,row.password_salt),row.password_hash)) throw fail('Current password is incorrect.',401);
 if(row.mfa_secret)await consumeFactor(e,row,code);
 const result=await e.DB.prepare('UPDATE teacher_sessions SET elevated_until=? WHERE token_hash=? AND teacher_id=? AND expires_at>? AND EXISTS (SELECT 1 FROM teachers WHERE id=? AND password_hash=? AND mfa_secret IS ? AND suspended=0)').bind(Date.now()+10*60*1000,current.session_hash,current.id,Date.now(),current.id,row.password_hash,row.mfa_secret).run();
 if(!result.meta.changes)throw fail('Session changed. Sign in again.',401);
}
export async function sessionSecurity(r,e,current,method) {
 if(!current) throw fail('Sign in to manage sessions.',403);
 if(method==='GET') {const sessions=await e.DB.prepare('SELECT COUNT(*) AS active_sessions FROM teacher_sessions WHERE teacher_id=? AND expires_at>?').bind(current.id,Date.now()).first();const row=await e.DB.prepare('SELECT mfa_recovery_codes FROM teachers WHERE id=?').bind(current.id).first();return {value:{...sessions,mfa_enabled:!!current.mfa_enabled,mfa_available:!!e.MFA_ENCRYPTION_KEY,recovery_codes_remaining:JSON.parse(row.mfa_recovery_codes).length,elevated:current.elevated_until>Date.now()}};}
 const body=await requestJson(r);
 await reauthenticate(r,e,current,body.current_password,body.code);
 const raw=(r.headers.get('cookie')||'').match(/(?:^|;\s*)fretline_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(body.scope==='others') {
  await e.DB.prepare('DELETE FROM teacher_sessions WHERE teacher_id=? AND token_hash<>?').bind(current.id,await digest(raw)).run();
  return {value:{ok:true}};
 }
 if(body.scope!=='all') throw fail('Choose all or other sessions.');
 await e.DB.prepare('DELETE FROM teacher_sessions WHERE teacher_id=?').bind(current.id).run();
 return {value:{ok:true},cookie:cookie('')};
}

// Accounts are identified by a username (existing accounts keep their old email as the username).
export const validUsername = value => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(value);
const usernameValue = value => String(value ?? '').trim().toLowerCase();
const recoveryChars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// A recovery key is the only way back into an account whose password was forgotten, so it is shown once and only its hash is kept.
function newRecoveryKey() {
 const bytes = crypto.getRandomValues(new Uint8Array(20));
 const chars = Array.from(bytes, n => recoveryChars[n % recoveryChars.length]).join('');
 return chars.match(/.{5}/g).join('-');
}
const normalRecovery = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const recoveryDigest = key => digest('recovery:' + normalRecovery(key));
async function setRecoveryKey(e, id) {
 const key = newRecoveryKey();
 await e.DB.prepare('UPDATE teachers SET recovery_hash=? WHERE id=?').bind(await recoveryDigest(key), id).run();
 return key;
}
export async function authAction(r,e,action,current) {
 if(action==='verify') {
  const body=await requestJson(r);
  if(typeof body.challenge!=='string'||!/^[a-f0-9]{64}$/.test(body.challenge))throw fail('Sign-in expired. Start again.',401);
  const tokenHash=await digest(body.challenge);
  const challenge=await e.DB.prepare('SELECT auth_challenges.*,teachers.email,teachers.mfa_recovery_codes FROM auth_challenges JOIN teachers ON teachers.id=auth_challenges.teacher_id WHERE token_hash=? AND expires_at>? AND teachers.suspended=0 AND teachers.password_hash=auth_challenges.password_hash AND teachers.mfa_secret=auth_challenges.mfa_secret').bind(tokenHash,Date.now()).first();
  await limit(r,e,challenge?.teacher_id||'expired','mfa');
  if(!challenge)throw fail('Sign-in expired. Start again.',401);
  await consumeFactor(e,{...challenge,id:challenge.teacher_id},body.code);
  const used=await e.DB.prepare('DELETE FROM auth_challenges WHERE token_hash=? AND expires_at>?').bind(tokenHash,Date.now()).run();
  if(!used.meta.changes)throw fail('Sign-in expired. Start again.',401);
  return {value:{ok:true,email:challenge.email},cookie:await createSession(e,challenge.teacher_id,true,challenge)};
 }
 if(action==='elevate') {
  if(!current)throw fail('Sign in to continue.',403);
  const body=await requestJson(r);await reauthenticate(r,e,current,body.current_password,body.code,true);
  return {value:{ok:true}};
 }
 if(action==='reset') {
  const body=await requestJson(r),username=usernameValue(body.username);await limit(r,e,username,'reset');
  if(!validPassword(body.new_password))throw fail('Use a new password of 12 to 1024 characters.');
  const row=username?await e.DB.prepare('SELECT id,recovery_hash FROM teachers WHERE email=? AND suspended=0').bind(username).first():null;
  const given=await recoveryDigest(body.recovery_key),expected=row?.recovery_hash||'0'.repeat(64);
  if(!row||!row.recovery_hash||!sameHash(given,expected))throw fail('That username and recovery key do not match.',401);
  const salt=random(),hash=await passwordHash(body.new_password,salt);
  const updated=await e.DB.batch([
   e.DB.prepare('UPDATE teachers SET password_salt=?,password_hash=? WHERE id=? AND recovery_hash=?').bind(salt,hash,row.id,row.recovery_hash),
   e.DB.prepare('DELETE FROM teacher_sessions WHERE teacher_id=? AND EXISTS (SELECT 1 FROM teachers WHERE id=? AND password_hash=?)').bind(row.id,row.id,hash),
   e.DB.prepare('DELETE FROM auth_challenges WHERE teacher_id=?').bind(row.id)
  ]);
  if(!updated[0].meta.changes)throw fail('That recovery key was just used. Try again.',409);
  return {value:{ok:true,recovery_key:await setRecoveryKey(e,row.id)}};
 }
 if(action==='recovery-key') {
  if(!current)throw fail('Sign in to continue.',403);
  const body=await requestJson(r);await limit(r,e,current.email,'recovery');
  if(current.mfa_enabled)await reauthenticate(r,e,current,undefined,undefined);
  const row=await e.DB.prepare('SELECT password_salt,password_hash FROM teachers WHERE id=?').bind(current.id).first();
  const password=typeof body.current_password==='string'&&body.current_password.length<=1024?body.current_password:'';
  if(!row||!sameHash(await passwordHash(password,row.password_salt),row.password_hash))throw fail('Current password is incorrect.',401);
  return {value:{ok:true,recovery_key:await setRecoveryKey(e,current.id)}};
 }
 if(action==='username') {
  if(!current)throw fail('Sign in to continue.',403);
  const body=await requestJson(r),next=usernameValue(body.new_username);await limit(r,e,current.email,'username');
  if(!validUsername(next))throw fail('Use 3 to 30 letters, numbers, dots, dashes or underscores.');
  const row=await e.DB.prepare('SELECT password_salt,password_hash FROM teachers WHERE id=?').bind(current.id).first();
  const password=typeof body.current_password==='string'&&body.current_password.length<=1024?body.current_password:'';
  if(!row||!sameHash(await passwordHash(password,row.password_salt),row.password_hash))throw fail('Current password is incorrect.',401);
  try{await e.DB.prepare('UPDATE teachers SET email=? WHERE id=?').bind(next,current.id).run();}
  catch(err){if(String(err).includes('UNIQUE'))throw fail('That username is taken.',409);throw err;}
  return {value:{ok:true,email:next}};
 }
 if(action.startsWith('mfa-'))return mfaAction(r,e,action,current);
 if(action==='logout') {
  const raw=(r.headers.get('cookie')||'').match(/(?:^|;\s*)fretline_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(raw) await e.DB.prepare('DELETE FROM teacher_sessions WHERE token_hash=?').bind(await digest(raw)).run();
  return {value:{ok:true}, cookie:cookie('')};
 }
 if(action==='password') {
  if(!current) throw fail('Sign in before changing your password.',403);
  const body=await requestJson(r);
  if(current.mfa_enabled)await reauthenticate(r,e,current,undefined,undefined);
  await limit(r,e,current.email);
  if(!validPassword(body.new_password)) throw fail('Use a new password of 12 to 1024 characters.');
  const row=await e.DB.prepare('SELECT password_salt,password_hash,mfa_secret FROM teachers WHERE id=?').bind(current.id).first();
  const password=typeof body.current_password==='string'&&body.current_password.length<=1024?body.current_password:'';
  if(!row || !sameHash(await passwordHash(password,row.password_salt),row.password_hash)) throw fail('Current password is incorrect.',401);
  if(!!row.mfa_secret!==!!current.mfa_enabled)throw fail('Account security changed. Sign in again.',409);
  const salt=random(), hash=await passwordHash(body.new_password,salt), raw=random();
  // Changing the password and revoking older sessions must succeed together.
  const result=await e.DB.batch([
   e.DB.prepare('UPDATE teachers SET password_salt=?,password_hash=? WHERE id=? AND password_hash=? AND mfa_secret IS ? AND suspended=0').bind(salt,hash,current.id,row.password_hash,row.mfa_secret),
   e.DB.prepare('DELETE FROM teacher_sessions WHERE teacher_id=? AND EXISTS (SELECT 1 FROM teachers WHERE id=? AND password_hash=?)').bind(current.id,current.id,hash),
   e.DB.prepare('INSERT INTO teacher_sessions (token_hash,teacher_id,expires_at,mfa_verified) SELECT ?,id,?,1 FROM teachers WHERE id=? AND password_hash=?').bind(await digest(raw),Date.now()+30*24*60*60*1000,current.id,hash)
  ]);
  if(!result[0].meta.changes) throw fail('Your password changed in another window. Sign in again.',409);
  return {value:{ok:true},cookie:cookie(raw)};
 }
 if(action==='claim') {
  const legacy=legacyOwner(r,e); if(!current || !legacy) throw fail('Sign in to both the account and original owner account to migrate lessons.',403);
  const result=await e.DB.prepare('UPDATE lessons SET owner_id=? WHERE owner_id=?').bind(current.id,legacy.id).run();
  return {value:{ok:true,moved:result.meta.changes}};
 }
 if(action!=='register' && action!=='login') throw fail('Not found.',404);
 if(action==='register' && !registrationOpen(e)) throw fail('New registration is currently closed.',403);
 const body=await requestJson(r), email=usernameValue(body.email ?? body.username), password=body.password;
 await limit(r,e,email);
 if(action==='register') {
  if(!validUsername(email)) throw fail('Choose a username of 3 to 30 letters, numbers, dots, dashes or underscores.');
  if(!validPassword(password)) throw fail('Use a password of 12 to 1024 characters.');
  const id='teacher:'+crypto.randomUUID(), salt=random(), hash=await passwordHash(password,salt);
  try {await e.DB.prepare('INSERT INTO teachers (id,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?)').bind(id,email,salt,hash,new Date().toISOString()).run();}
  catch(err) {if(String(err).includes('UNIQUE')) throw fail('That username is taken.',409); throw err;}
  return {value:{ok:true,email,recovery_key:await setRecoveryKey(e,id)},cookie:await createSession(e,id)};
 }
 const row=email && email.length<=254 ? await e.DB.prepare('SELECT id,email,password_salt,password_hash,mfa_secret FROM teachers WHERE email=? AND suspended=0').bind(email).first() : null;
 const hash=await passwordHash(typeof password==='string' && password.length<=1024?password:'',row?.password_salt || '0'.repeat(64));
 const expected=row?.password_hash || '0'.repeat(64);
 if(!row || !sameHash(hash,expected)) throw fail('Invalid username or password.',401);
 if(row.mfa_secret){
  const raw=random(),now=Date.now();
  await e.DB.batch([
   e.DB.prepare('DELETE FROM auth_challenges WHERE expires_at<=? OR teacher_id=?').bind(now,row.id),
   e.DB.prepare('INSERT INTO auth_challenges (token_hash,teacher_id,password_hash,mfa_secret,expires_at) VALUES (?,?,?,?,?)').bind(await digest(raw),row.id,row.password_hash,row.mfa_secret,now+5*60*1000)
  ]);
  return {value:{mfa_required:true,challenge:raw}};
 }
 return {value:{ok:true,email:row.email},cookie:await createSession(e,row.id,false,row)};
}

async function mfaAction(r,e,action,current){
 if(!current)throw fail('Sign in to manage two-factor authentication.',403);
 const body=await requestJson(r);
 await reauthenticate(r,e,current,body.current_password,body.code);
 const row=await e.DB.prepare('SELECT id,email,mfa_secret,mfa_pending_secret,mfa_pending_expires,mfa_recovery_codes FROM teachers WHERE id=? AND suspended=0').bind(current.id).first();
 if(!row)throw fail('Account unavailable.',403);
 if(action==='mfa-start'){
  if(row.mfa_secret)throw fail('Two-factor authentication is already enabled.',409);
  const secret=newSecret(),sealed=await sealSecret(e,current.id,secret);
  const result=await e.DB.prepare('UPDATE teachers SET mfa_pending_secret=?,mfa_pending_expires=? WHERE id=? AND mfa_secret IS NULL').bind(sealed,Date.now()+10*60*1000,current.id).run();
  if(!result.meta.changes)throw fail('Security settings changed. Refresh and try again.',409);
  return {value:{secret,uri:`otpauth://totp/${encodeURIComponent('Fretlark:'+row.email)}?secret=${secret}&issuer=Fretlark&algorithm=SHA1&digits=6&period=30`}};
 }
 if(action==='mfa-confirm'){
  await limit(r,e,current.email,'mfa-setup');
  if(row.mfa_secret||!row.mfa_pending_secret||row.mfa_pending_expires<=Date.now())throw fail('Setup expired. Start again.',409);
  const step=await matchingStep(await openSecret(e,current.id,row.mfa_pending_secret),body.code);
  if(step===null)throw fail('Incorrect code. Use the six digits from your authenticator.',400);
  const recovery=await recoveryCodes();
  const result=await e.DB.batch([
   e.DB.prepare('UPDATE teachers SET mfa_secret=mfa_pending_secret,mfa_pending_secret=NULL,mfa_pending_expires=0,mfa_last_step=?,mfa_recovery_codes=? WHERE id=? AND mfa_secret IS NULL AND mfa_pending_secret=? AND mfa_pending_expires>?').bind(step,recovery.hashes,current.id,row.mfa_pending_secret,Date.now()),
   e.DB.prepare('DELETE FROM teacher_sessions WHERE teacher_id=? AND token_hash<>? AND EXISTS (SELECT 1 FROM teachers WHERE id=? AND mfa_secret=?)').bind(current.id,current.session_hash,current.id,row.mfa_pending_secret),
   e.DB.prepare('UPDATE teacher_sessions SET mfa_verified=1,elevated_until=? WHERE token_hash=? AND EXISTS (SELECT 1 FROM teachers WHERE id=? AND mfa_secret=?)').bind(Date.now()+10*60*1000,current.session_hash,current.id,row.mfa_pending_secret)
  ]);
  if(!result[0].meta.changes)throw fail('Security settings changed. Refresh and try again.',409);
  return {value:{ok:true,recovery_codes:recovery.codes}};
 }
 if(action==='mfa-disable'){
  await e.DB.batch([
   e.DB.prepare("UPDATE teachers SET mfa_secret=NULL,mfa_pending_secret=NULL,mfa_pending_expires=0,mfa_last_step=-1,mfa_recovery_codes='[]' WHERE id=?").bind(current.id),
   e.DB.prepare('DELETE FROM auth_challenges WHERE teacher_id=?').bind(current.id),
   e.DB.prepare('DELETE FROM teacher_sessions WHERE teacher_id=? AND token_hash<>?').bind(current.id,current.session_hash)
  ]);
  return {value:{ok:true}};
 }
 if(action==='mfa-recovery'){
  if(!row.mfa_secret)throw fail('Enable two-factor authentication first.');
  const recovery=await recoveryCodes();
  const result=await e.DB.prepare('UPDATE teachers SET mfa_recovery_codes=? WHERE id=? AND mfa_secret=?').bind(recovery.hashes,current.id,row.mfa_secret).run();
  if(!result.meta.changes)throw fail('Security settings changed. Refresh and try again.',409);
  return {value:{ok:true,recovery_codes:recovery.codes}};
 }
 throw fail('Not found.',404);
}
