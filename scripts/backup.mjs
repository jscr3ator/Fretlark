import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {homedir} from 'node:os';
import {snapshotSql} from '../lib/library-backup.mjs';

const digest=data=>createHash('sha256').update(data).digest('hex');
const magic=Buffer.from('FRETLINE1');
const root=resolve(process.env.FRETLINE_BACKUP_DIR||join(homedir(),'.local/share/fretlark-backups'));
const MAX=512*1024*1024;

export function validateBackup(bundle) {
 const db=new DatabaseSync(':memory:',{enableForeignKeyConstraints:false});
 try {
  db.exec(bundle.sql);
  if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Database integrity check failed.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database foreign-key check failed.');
  const files=new Map();
  for(const file of bundle.objects){
   const bytes=Buffer.from(file.base64,'base64');
   if(bytes.length!==file.size || digest(bytes)!==file.sha256)throw Error('Backup file checksum failed.');
   files.set(file.key,bytes.length);
  }
  const lessons=db.prepare('SELECT file_key,file_size FROM lessons').all();
  for(const lesson of lessons)if(files.get(lesson.file_key)!==lesson.file_size)throw Error('A score referenced by the database is missing or has a different size. Retry the backup when uploads are idle.');
  return {teachers:db.prepare('SELECT COUNT(*) AS n FROM teachers').get().n,scores:lessons.length,objects:files.size};
 } finally {db.close();}
}

export function encryptBackup(bundle,key) {
 const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
 const payload=Buffer.concat([cipher.update(gzipSync(JSON.stringify(bundle))),cipher.final()]);
 return Buffer.concat([magic,nonce,cipher.getAuthTag(),payload]);
}

export function decryptBackup(bytes,key) {
 if(!bytes.subarray(0,magic.length).equals(magic))throw Error('Invalid backup format.');
 const offset=magic.length,decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(offset,offset+12));
 decipher.setAuthTag(bytes.subarray(offset+12,offset+28));
 return JSON.parse(gunzipSync(Buffer.concat([decipher.update(bytes.subarray(offset+28)),decipher.final()]),{maxOutputLength:MAX*2}));
}

async function key() {
 if(process.env.FRETLINE_BACKUP_KEY){
  if(!/^[a-f0-9]{64}$/i.test(process.env.FRETLINE_BACKUP_KEY))throw Error('FRETLINE_BACKUP_KEY must be 64 hexadecimal characters.');
  return Buffer.from(process.env.FRETLINE_BACKUP_KEY,'hex');
 }
 await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
 const file=join(root,'backup.key');
 try {await writeFile(file,randomBytes(32),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
 await chmod(file,0o600);
 const data=await readFile(file);if(data.length!==32)throw Error('Invalid local backup key.');return data;
}

async function limitedBytes(response) {
 if(!response.ok)throw Error(`Backup download failed (${response.status}).`);
 const chunks=[];let length=0;
 for await(const chunk of response.body){length+=chunk.length;if(length>MAX)throw Error('Backup exceeds the 512 MB capture limit. Use a streaming backup for this library.');chunks.push(chunk);}
 return Buffer.concat(chunks);
}

async function captureRemote(snapshotPrefix) {
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const token=process.env.CLOUDFLARE_API_TOKEN;
 if(!token)throw Error('Set CLOUDFLARE_API_TOKEN with D1 Read and Workers R2 Storage Read permissions, or use --capture with the connected Cloudflare tool.');
 const account=process.env.CLOUDFLARE_ACCOUNT_ID||config.account_id;
 const base=`https://api.cloudflare.com/client/v4/accounts/${account}`;
 const database=config.d1_databases.find(binding=>binding.binding==='DB').database_id;
 const bucket=config.r2_buckets.find(binding=>binding.binding==='BUCKET').bucket_name;
 const api=async(path,body)=>{
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const json=await response.json();if(!response.ok||!json.success)throw Error(`Cloudflare backup API failed (${response.status}).`);return json;
 };
 if(snapshotPrefix){
  const backupBucket=config.r2_buckets.find(binding=>binding.binding==='BACKUP_BUCKET').bucket_name;
  const download=async name=>limitedBytes(await fetch(`${base}/r2/buckets/${backupBucket}/objects/${encodeURIComponent(name)}`,{headers:{Authorization:`Bearer ${token}`}}));
  const snapshot=JSON.parse(await download(snapshotPrefix+'/manifest.json')),objects=[];
  let total=0;
  for(const file of snapshot.files){total+=file.size;if(total>MAX)throw Error('Backup exceeds 512 MB.');const bytes=await download(file.backup_key);objects.push({key:file.key,size:file.size,base64:bytes.toString('base64')});}
  return {sql:snapshotSql(snapshot),objects};
 }
 let task=(await api(`/d1/database/${database}/export`,{output_format:'polling'})).result;
 const deadline=Date.now()+180000;
 while(task.status==='active'){
  if(Date.now()>deadline)throw Error('Database export timed out.');
  await new Promise(done=>setTimeout(done,1000));
  task=(await api(`/d1/database/${database}/export`,{output_format:'polling',current_bookmark:task.at_bookmark})).result;
 }
 if(task.status!=='complete'||!task.result?.signed_url)throw Error('Database export did not complete.');
 const sql=(await limitedBytes(await fetch(task.result.signed_url))).toString('utf8');
 const objects=[];let cursor,total=0;
 do {
  const page=await api(`/r2/buckets/${bucket}/objects?per_page=1000${cursor?'&cursor='+encodeURIComponent(cursor):''}`);
  for(const object of page.result){
   total+=object.size;if(total>MAX)throw Error('Backup exceeds 512 MB. Use a streaming backup.');
   const bytes=await limitedBytes(await fetch(`${base}/r2/buckets/${bucket}/objects/${encodeURIComponent(object.key)}`,{headers:{Authorization:`Bearer ${token}`}}));
   objects.push({key:object.key,size:object.size,base64:bytes.toString('base64')});
  }
  cursor=page.result_info?.is_truncated?page.result_info.cursor:null;
  if(page.result_info?.is_truncated&&!cursor)throw Error('Cloudflare did not return a pagination cursor.');
 }while(cursor);
 return {sql,objects};
}

async function main() {
 const args=process.argv.slice(2),secret=await key();
 if(args[0]==='--verify'||args[0]==='--extract'){
  const bundle=decryptBackup(await readFile(args[1]),secret),summary=validateBackup(bundle);
  if(args[0]==='--extract'){
   if(!args[2])throw Error('Supply a new recovery directory.');
   const destination=resolve(args[2]);await mkdir(destination,{mode:0o700});
   await writeFile(join(destination,'database.sql'),bundle.sql,{flag:'wx',mode:0o600});
   const manifest=[];
   for(const [index,file]of bundle.objects.entries()){
    const name=`score-${index}.bin`;await writeFile(join(destination,name),Buffer.from(file.base64,'base64'),{flag:'wx',mode:0o600});
    manifest.push({file:name,key:file.key,sha256:file.sha256});
   }
   await writeFile(join(destination,'objects.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
  }
  console.log(JSON.stringify({verified:true,...summary}));return;
 }
 let source;
 if(args[0]==='--capture'){
  const chunks=[];let size=0;for await(const chunk of process.stdin){size+=chunk.length;if(size>MAX*2)throw Error('Capture input is too large.');chunks.push(chunk);if(chunk.includes(10))break;}
  source=JSON.parse(Buffer.concat(chunks));
  if(source.database_url)source.sql=(await limitedBytes(await fetch(source.database_url))).toString('utf8');
 }else source=await captureRemote(args[0]==='--snapshot'?args[1]:undefined);
 const bundle={version:1,created_at:new Date().toISOString(),sql:source.sql,objects:source.objects.map(file=>({...file,sha256:digest(Buffer.from(file.base64,'base64'))}))};
 const summary=validateBackup(bundle),bytes=encryptBackup(bundle,secret);
 validateBackup(decryptBackup(bytes,secret));
 await mkdir(root,{recursive:true,mode:0o700});
 const file=join(root,bundle.created_at.replace(/[:.]/g,'-')+'.fretline-backup');
 await writeFile(file,bytes,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({backup:file,verified:true,...summary}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
