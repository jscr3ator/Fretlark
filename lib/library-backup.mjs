// Only the scheduled handler uses BACKUP_BUCKET; no public route can read it.
//
// Incremental snapshots. Song files never change in place (a replacement gets a new key), so each
// file is copied into BACKUP_BUCKET once, under files/<its key>. Every daily snapshot is a manifest
// listing the database rows and which stored copies they need; the manifest is published last, so
// an interrupted run never leaves a snapshot that points at missing files. Copies that no snapshot
// from the retention window uses any more are deleted, so storage stays about one copy per song.
const RETENTION_DAYS=36;      // the bucket's lifecycle rule drops snapshots/ after 35 days
const MAX_COPIES_PER_RUN=4000; // 2 internal requests each, well under the Paid plan's 10,000
const TABLES=['teachers','lessons','setlists','setlist_items'];

async function listAll(bucket,options) {
 const objects=[];let cursor;
 do{const page=await bucket.list({...options,cursor});objects.push(...page.objects);cursor=page.truncated?page.cursor:undefined;}while(cursor);
 return objects;
}

export async function backupLibrary(env,now=new Date()) {
 const present=new Set((await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(row=>row.name));
 const tables=TABLES.filter(table=>present.has(table));
 const [schema,...rows]=await env.DB.batch([
  env.DB.prepare(`SELECT sql FROM sqlite_master WHERE tbl_name IN (${[...tables,'teacher_sessions','auth_limits'].map(()=>'?').join(',')}) AND sql IS NOT NULL ORDER BY type DESC,name`).bind(...tables,'teacher_sessions','auth_limits'),
  ...tables.map(table=>env.DB.prepare(`SELECT * FROM ${table}`))
 ]);
 const data=Object.fromEntries(tables.map((table,index)=>[table,rows[index].results]));
 const created_at=now.toISOString(),prefix='snapshots/'+created_at.replace(/[:.]/g,'-')+'-'+crypto.randomUUID();

 // What is already stored, so only new songs are copied.
 const stored=new Map((await listAll(env.BACKUP_BUCKET,{prefix:'files/'})).map(object=>[object.key,object]));
 const files=[],lessons=[],skipped=[];let copied=0;
 for(const lesson of data.lessons||[]){
  const backup_key='files/'+lesson.file_key;
  if(stored.get(backup_key)?.size!==lesson.file_size){
   if(copied>=MAX_COPIES_PER_RUN){
    // Keep what was copied (the next run carries on) but publish no snapshot missing songs.
    const result={partial:true,copied,remaining:(data.lessons.length-lessons.length-skipped.length)};
    console.log(JSON.stringify({event:'backup_partial',...result}));
    return result;
   }
   const file=await env.BUCKET.get(lesson.file_key);
   if(!file||file.size!==lesson.file_size){
    // Deleted or replaced since the rows were read: leave that song out of this snapshot. A file
    // missing for a song that still exists is a storage problem, so publish nothing.
    const still=await env.DB.prepare('SELECT 1 AS n FROM lessons WHERE id=? AND file_key=?').bind(lesson.id,lesson.file_key).first();
    if(still)throw Error('A song file is missing or changed during backup. No complete snapshot was published.');
    skipped.push(lesson.id);continue;
   }
   await env.BACKUP_BUCKET.put(backup_key,file.body,{httpMetadata:{contentType:'application/octet-stream'}});
   stored.set(backup_key,{key:backup_key,size:lesson.file_size,uploaded:now});
   copied++;
  }
  files.push({key:lesson.file_key,backup_key,size:lesson.file_size});
  lessons.push(lesson);
 }
 if(data.lessons)data.lessons=lessons;
 if(data.setlist_items&&skipped.length){const kept=new Set(lessons.map(lesson=>lesson.id));data.setlist_items=data.setlist_items.filter(item=>kept.has(item.lesson_id));}

 const snapshot={version:2,created_at,schema:schema.results.map(row=>row.sql),...data,files};
 // Publish the manifest last so incomplete copies can never be selected for recovery.
 await env.BACKUP_BUCKET.put(prefix+'/manifest.json',JSON.stringify(snapshot),{httpMetadata:{contentType:'application/json'}});

 // Drop stored copies that no snapshot inside the retention window still needs. Copies made in
 // the last two days are kept even if unreferenced (a partial run may be catching up).
 let removed=0;
 try{
  const cutoff=now.getTime()-RETENTION_DAYS*864e5,fresh=now.getTime()-2*864e5,needed=new Set(files.map(file=>file.backup_key));
  const manifests=(await listAll(env.BACKUP_BUCKET,{prefix:'snapshots/'})).filter(object=>object.key.endsWith('/manifest.json')&&object.key!==prefix+'/manifest.json'&&new Date(object.uploaded).getTime()>=cutoff);
  for(const manifest of manifests){const body=await env.BACKUP_BUCKET.get(manifest.key);if(!body)continue;for(const file of (JSON.parse(await body.text()).files||[]))needed.add(file.backup_key);}
  const unused=[...stored.values()].filter(object=>!needed.has(object.key)&&new Date(object.uploaded).getTime()<fresh).map(object=>object.key);
  for(let i=0;i<unused.length;i+=1000){await env.BACKUP_BUCKET.delete(unused.slice(i,i+1000));removed+=Math.min(1000,unused.length-i);}
 }catch(err){console.error(JSON.stringify({event:'backup_cleanup_failed',message:String(err?.message||err)}));}

 const result={snapshot:prefix,teachers:(data.teachers||[]).length,scores:lessons.length,setlists:(data.setlists||[]).length,copied,skipped:skipped.length,removed};
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
 return [...snapshot.schema,...authSchema,...securitySchema,...mfaSchema].join(';\n')+';\n'+['teachers','lessons','setlists','setlist_items'].filter(table=>Array.isArray(snapshot[table])).flatMap(table=>snapshot[table].map(row=>
  `INSERT INTO ${identifier(table)} (${Object.keys(row).map(identifier).join(',')}) VALUES (${Object.values(row).map(quoted).join(',')});`
 )).join('\n');
}
