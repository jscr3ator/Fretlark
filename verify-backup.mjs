import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {validateBackup,encryptBackup,decryptBackup} from './scripts/backup.mjs';
import {backupLibrary} from './lib/library-backup.mjs';

// A fake D1 + two R2 buckets that count every internal request against the Paid plan budget.
function scheduledFixture(scores,{teachers=1,missing=[],deleteMissing=true}={}) {
 const db={teachers:Array.from({length:teachers},(_,i)=>({id:'teacher-'+i})),
  lessons:Array.from({length:scores},(_,i)=>({id:'lesson-'+i,file_key:'scores/'+i,file_size:bytes.length})),
  setlists:[{id:'set-0',owner_id:'teacher-0'}],setlist_items:Array.from({length:Math.min(scores,3)},(_,i)=>({setlist_id:'set-0',lesson_id:'lesson-'+i,position:i}))};
 let calls=0,reads=0,clock=new Date('2026-11-01T11:00:00Z');
 const count=()=>{assert.ok(++calls<=10000,'Scheduled backup exceeded the Paid Workers internal request budget');};
 const statement=query=>({query,args:[],bind(...args){this.args=args;return this;},async all(){count();return run(query);},async first(){count();return query.includes('SELECT 1')?(db.lessons.some(row=>row.id===this.args[0]&&row.file_key===this.args[1])?{n:1}:null):null;}});
 const run=query=>{
  if(query.includes("type='table'"))return {results:Object.keys(db).map(name=>({name}))};
  if(query.includes('sqlite_master'))return {results:[{sql:'CREATE TABLE teachers (id TEXT PRIMARY KEY)'}]};
  const table=query.match(/FROM (\w+)/)[1];return {results:db[table].map(row=>({...row}))};
 };
 const bucket=()=>{const objects=new Map();return {objects,
  async put(key,body){count();objects.set(key,{body:typeof body==='string'?body:bytes,size:typeof body==='string'?body.length:bytes.length,uploaded:new Date(clock)});},
  async get(key){count();const o=objects.get(key);return o?{size:o.size,body:o.body,async text(){return String(o.body);}}:null;},
  async delete(keys){count();for(const key of [].concat(keys))objects.delete(key);},
  async list({prefix,cursor}){count();const all=[...objects.entries()].filter(([key])=>key.startsWith(prefix)).map(([key,o])=>({key,size:o.size,uploaded:o.uploaded}));const start=Number(cursor||0),page=all.slice(start,start+1000);return {objects:page,truncated:start+1000<all.length,cursor:String(start+1000)};}};};
 const backup=bucket(),files={async get(key){count();reads++;if(missing.includes(key)){if(deleteMissing)db.lessons=db.lessons.filter(row=>row.file_key!==key);return null;}return {size:bytes.length,body:bytes};}};
 const env={DB:{prepare:statement,async batch(list){return Promise.all(list.map(item=>item.all()));}},BUCKET:files,BACKUP_BUCKET:backup};
 return {env,db,backup:backup.objects,run:()=>backupLibrary(env,new Date(clock)),advance(days){clock=new Date(clock.getTime()+days*864e5);},resetCalls(){calls=0;},get calls(){return calls;},get reads(){return reads;}};
}

const bytes=Buffer.from('score fixture');
const bundle={sql:`
 CREATE TABLE teacher_sessions (teacher_id TEXT REFERENCES teachers(id));
 INSERT INTO teacher_sessions VALUES ('teacher');
 CREATE TABLE teachers (id TEXT PRIMARY KEY);
 INSERT INTO teachers VALUES ('teacher');
 CREATE TABLE lessons (file_key TEXT,file_size INTEGER);
 INSERT INTO lessons VALUES ('scores/fixture',${bytes.length});
`,objects:[{key:'scores/fixture',size:bytes.length,base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')}]};
assert.deepEqual(validateBackup(bundle),{teachers:1,scores:1,objects:1});
const key=randomBytes(32),encrypted=encryptBackup(bundle,key);
assert.deepEqual(decryptBackup(encrypted,key),bundle);
assert.throws(()=>decryptBackup(encrypted,randomBytes(32)));
const tampered=Buffer.from(encrypted);tampered[tampered.length-1]^=1;
assert.throws(()=>decryptBackup(tampered,key));
assert.throws(()=>validateBackup({...bundle,objects:[]}),/missing/);
assert.throws(()=>validateBackup({...bundle,objects:[{...bundle.objects[0],sha256:'bad'}]}),/checksum/);
assert.throws(()=>validateBackup({...bundle,sql:bundle.sql+"DELETE FROM teachers;"}),/foreign-key/);
// Large libraries back up with no song cap; only new songs are copied after the first run.
const big=scheduledFixture(1500);
const first=await big.run();
assert.equal(first.scores,1500);assert.equal(first.copied,1500);assert.equal(first.setlists,1);
const keys=[...big.backup.keys()];
assert.ok(keys.at(-1).endsWith('/manifest.json'),'Complete manifest publishes last');
assert.equal(keys.filter(key=>key.startsWith('files/')).length,1500,'One stored copy per song');
const manifest=JSON.parse(big.backup.get(keys.at(-1)).body);
assert.equal(manifest.files[0].backup_key,'files/scores/0');assert.equal(manifest.setlist_items.length,3);
big.advance(1);big.resetCalls();
const second=await big.run();
assert.equal(second.copied,0,'Unchanged songs are not copied again');
assert.ok(big.calls<20,'A day with no new songs costs a handful of internal requests');

// A deleted song's copy stays while a recent snapshot needs it, then is cleaned up.
big.db.lessons=big.db.lessons.filter(lesson=>lesson.id!=='lesson-1499');
big.advance(3);assert.equal((await big.run()).removed,0,'Still referenced by recent snapshots');
big.advance(40);const late=await big.run();
assert.equal(late.removed,1,'Copy no snapshot in the retention window uses is removed');
assert.ok(!big.backup.has('files/scores/1499'));

// A file missing for a song that still exists is a storage fault: nothing is published.
const broken=scheduledFixture(5,{missing:['scores/2'],deleteMissing:false});
await assert.rejects(()=>broken.run(),/missing/);
assert.ok(![...broken.backup.keys()].some(key=>key.endsWith('manifest.json')),'No snapshot with a missing song');

// A song deleted mid-backup is left out, together with its setlist entries.
const gone=scheduledFixture(5,{missing:['scores/1']});
const partialSet=await gone.run();
assert.equal(partialSet.scores,4);assert.equal(partialSet.skipped,1);
const goneManifest=JSON.parse([...gone.backup.values()].at(-1).body);
assert.ok(!goneManifest.setlist_items.some(item=>item.lesson_id==='lesson-1'),'No setlist entry points at a missing song');

// More new songs than one run may copy: progress is kept, no snapshot is published until complete.
const flood=scheduledFixture(4100);
const firstPass=await flood.run();
assert.equal(firstPass.partial,true);
assert.ok(![...flood.backup.keys()].some(key=>key.endsWith('manifest.json')),'No snapshot with missing songs');
flood.advance(1);const caughtUp=await flood.run();
assert.equal(caughtUp.copied,100);assert.equal(caughtUp.scores,4100);

console.log('PASS: encrypted backup roundtrip, tamper rejection, restored SQL and referenced score integrity; incremental scheduled backups (no song cap, copy-once, cleanup, mid-run deletes, multi-run catch-up) within the Paid request budget.');
