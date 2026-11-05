import {requestJson,reauthenticate,validEmail,validUsername,validPassword,passwordHash,random} from './teacher-auth.mjs';
import {accountPaymentStatements} from './plans.mjs';
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
export async function manageUsers(r,e,current) {
 if(r.method==='GET') {
  const query=(new URL(r.url).searchParams.get('q')||'').trim().toLowerCase().slice(0,254);
  const page=Math.max(0,Math.min(100000,Number.parseInt(new URL(r.url).searchParams.get('page'),10)||0));
  const rows=await e.DB.prepare('SELECT id,email,created_at,suspended,(SELECT COUNT(*) FROM lessons WHERE owner_id=teachers.id) AS songs FROM teachers WHERE instr(email,?)>0 ORDER BY created_at DESC,id LIMIT 51 OFFSET ?').bind(query,page*50).all();
  return {users:rows.results.slice(0,50).map(row=>({...row,owner:row.id===e.OWNER_ACCOUNT_ID})),has_more:rows.results.length>50};
 }
 if(r.method!=='POST')throw fail('Method not allowed.',405);
 const body=await requestJson(r);
 await reauthenticate(r,e,current,body.current_password,body.code);
 if(body.action==='create') {
  const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
  if(!(validUsername(email)||validEmail(email))||!validPassword(body.password))throw fail('Enter a username (3 to 30 letters or numbers) and a password of 12 to 1024 characters.');
  const salt=random(),hash=await passwordHash(body.password,salt);
  try {await e.DB.prepare('INSERT INTO teachers (id,email,password_salt,password_hash,created_at) VALUES (?,?,?,?,?)').bind('teacher:'+crypto.randomUUID(),email,salt,hash,new Date().toISOString()).run();}
  catch(error){if(String(error).includes('UNIQUE'))throw fail('An account with this email already exists.',409);throw error;}
 } else {
  if(typeof body.id!=='string')throw fail('Choose an account.');
  const target=await e.DB.prepare('SELECT id,email FROM teachers WHERE id=?').bind(body.id).first();
  if(!target)throw fail('Account not found.',404);
  if(['suspend','delete','revoke-sessions'].includes(body.action)&&target.id===e.OWNER_ACCOUNT_ID)throw fail('Owner account is protected. Use your security settings to manage your own sessions.',403);
  if(body.action==='suspend') {
   await e.DB.batch([e.DB.prepare('UPDATE teachers SET suspended=1 WHERE id=?').bind(target.id),e.DB.prepare('DELETE FROM teacher_sessions WHERE teacher_id=?').bind(target.id)]);
  } else if(body.action==='restore') {
   await e.DB.prepare('UPDATE teachers SET suspended=0 WHERE id=?').bind(target.id).run();
  } else if(body.action==='revoke-sessions') {
   await e.DB.prepare('DELETE FROM teacher_sessions WHERE teacher_id=?').bind(target.id).run();
  } else if(body.action==='delete') {
   if(body.confirm_email!==target.email)throw fail('Type the account email to confirm deletion.');
   const files=await e.DB.prepare('SELECT file_key FROM lessons WHERE owner_id=?').bind(target.id).all();
   // Remove access atomically before deleting files; failed R2 cleanup leaves no public route.
   await e.DB.batch([
    e.DB.prepare('DELETE FROM lesson_views WHERE lesson_id IN (SELECT id FROM lessons WHERE owner_id=?)').bind(target.id),
    e.DB.prepare('DELETE FROM auth_challenges WHERE teacher_id=?').bind(target.id),
    e.DB.prepare('DELETE FROM lessons WHERE owner_id=?').bind(target.id),
    e.DB.prepare('DELETE FROM email_tokens WHERE teacher_id=?').bind(target.id),
    e.DB.prepare('DELETE FROM teacher_sessions WHERE teacher_id=?').bind(target.id),
    ...accountPaymentStatements(e.DB,target.id),
    e.DB.prepare('DELETE FROM teachers WHERE id=?').bind(target.id)
   ]);
   for(const file of files.results){try{await e.BUCKET.delete(file.file_key);}catch{console.error(JSON.stringify({event:'account-file-cleanup-failed',key:file.file_key}));}}
  } else throw fail('Unknown account action.');
 }
 console.log(JSON.stringify({event:'owner-user-action',actor:current.id,target:body.id||null,action:body.action}));
 return {ok:true};
}
