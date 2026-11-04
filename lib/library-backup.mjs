// Only the scheduled handler uses BACKUP_BUCKET; no public route can read it.
export async function backupLibrary(env) {
 const [schema,teachers,lessons]=await env.DB.batch([
  env.DB.prepare("SELECT sql FROM sqlite_master WHERE tbl_name IN ('teachers','lessons','teacher_sessions','auth_limits') AND sql IS NOT NULL ORDER BY type DESC,name"),
  env.DB.prepare('SELECT * FROM teachers LIMIT 1001'),
  env.DB.prepare('SELECT * FROM lessons LIMIT 401')
 ]);
 // shortcut: 400 copies leave headroom under Free Workers' 1,000 internal subrequests; batch before raising this cap.
 if(teachers.results.length>1000||lessons.results.length>400)throw Error('Backup capacity exceeded (400 songs or 1,000 teachers). Upgrade snapshot batching.');
 const created_at=new Date().toISOString(),prefix='snapshots/'+created_at.replace(/[:.]/g,'-')+'-'+crypto.randomUUID();
 const files=[];
 for(const [index,lesson]of lessons.results.entries()){
  const file=await env.BUCKET.get(lesson.file_key);
  if(!file||file.size!==lesson.file_size)throw Error('A song file changed during backup or is missing. No complete snapshot was published.');
  const backup_key=prefix+'/score-'+index;
  await env.BACKUP_BUCKET.put(backup_key,file.body,{httpMetadata:{contentType:'application/octet-stream'}});
  files.push({key:lesson.file_key,backup_key,size:file.size});
 }
 const snapshot={version:1,created_at,schema:schema.results.map(row=>row.sql),teachers:teachers.results,lessons:lessons.results,files};
 // Publish the manifest last so incomplete copies can never be selected for recovery.
 await env.BACKUP_BUCKET.put(prefix+'/manifest.json',JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'}});
 const result={snapshot:prefix,teachers:snapshot.teachers.length,scores:snapshot.lessons.length};
 console.log(JSON.stringify({event:'backup_complete',...result}));
 return result;
}

export function snapshotSql(snapshot) {
 const quoted=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
 const identifier=value=>'"'+value.replaceAll('"','""')+'"';
 // Older snapshots omitted these empty tables; include them so account login works after recovery.
 const authSchema=[
  'CREATE TABLE IF NOT EXISTS teacher_sessions (token_hash TEXT PRIMARY KEY NOT NULL,teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL,mfa_verified INTEGER NOT NULL DEFAULT 0,elevated_until INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS teacher_sessions_teacher_id ON teacher_sessions(teacher_id)',
  'CREATE INDEX IF NOT EXISTS teacher_sessions_expires_at ON teacher_sessions(expires_at)',
  'CREATE TABLE IF NOT EXISTS auth_limits (key TEXT PRIMARY KEY NOT NULL,attempts INTEGER NOT NULL,expires_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS auth_limits_expires_at ON auth_limits(expires_at)'
 ];
 const securitySchema=snapshot.schema.some(statement=>/CREATE TABLE[^;]*["`]?teachers["`]?\s*\(/i.test(statement)&&/\bsuspended\b/.test(statement))?[]:['ALTER TABLE teachers ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0'];
 const mfaSchema=[
  'CREATE TABLE IF NOT EXISTS auth_challenges (token_hash TEXT PRIMARY KEY NOT NULL,teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,password_hash TEXT NOT NULL,mfa_secret TEXT NOT NULL,expires_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS auth_challenges_expiry ON auth_challenges(expires_at)',
  'CREATE INDEX IF NOT EXISTS auth_challenges_teacher ON auth_challenges(teacher_id)'
 ];
 for(const [table,columns] of Object.entries({teachers:{mfa_secret:'TEXT',mfa_pending_secret:'TEXT',mfa_pending_expires:'INTEGER NOT NULL DEFAULT 0',mfa_last_step:'INTEGER NOT NULL DEFAULT -1',mfa_recovery_codes:"TEXT NOT NULL DEFAULT '[]'"},teacher_sessions:{mfa_verified:'INTEGER NOT NULL DEFAULT 0',elevated_until:'INTEGER NOT NULL DEFAULT 0'}})){
  const definition=snapshot.schema.find(statement=>new RegExp('^CREATE TABLE (?:IF NOT EXISTS )?["`]?'+table+'["`]?\\s*\\(','i').test(statement));
  if(definition)for(const [column,type] of Object.entries(columns))if(!new RegExp('\\b'+column+'\\b').test(definition))mfaSchema.push(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
 }
 return [...snapshot.schema,...authSchema,...securitySchema,...mfaSchema].join(';\n')+';\n'+['teachers','lessons'].flatMap(table=>snapshot[table].map(row=>
  `INSERT INTO ${identifier(table)} (${Object.keys(row).map(identifier).join(',')}) VALUES (${Object.values(row).map(quoted).join(',')});`
 )).join('\n');
}
