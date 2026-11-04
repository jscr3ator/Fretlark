import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {validateBackup,encryptBackup,decryptBackup} from './scripts/backup.mjs';
import {backupLibrary} from './lib/library-backup.mjs';

// Count each SQL statement conservatively, plus every R2 read/write, against the hosted Free limit.
function scheduledFixture(scores,teachers=1) {
 const previous='snapshots/previous/manifest.json',objects=new Map([[previous,'previous snapshot']]);
 let calls=0,reads=0;
 const count=()=>{assert.ok(++calls<=1000,'Scheduled backup exceeded Free Workers internal subrequest budget');};
 const env={DB:{prepare(query){return query;},async batch(queries){
  queries.forEach(count);
  return queries.map(query=>({results:query.includes('sqlite_master')?[]:Array.from({length:Math.min(query.includes('teachers')?teachers:scores,Number(query.match(/LIMIT (\d+)/)?.[1]))},(_,i)=>query.includes('teachers')?{id:'teacher-'+i}:{file_key:'scores/'+i,file_size:bytes.length})}));
 }},BUCKET:{async get(){count();reads++;return {size:bytes.length,body:bytes};}},BACKUP_BUCKET:{async put(key,body){count();objects.set(key,body);}}};
 return {env,objects,previous,get calls(){return calls;},get reads(){return reads;}};
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
const boundary=scheduledFixture(400);
const completed=await backupLibrary(boundary.env);
assert.equal(completed.scores,400);
assert.equal(boundary.calls,804);
assert.equal(boundary.objects.size,402,'400 copies, new manifest and earlier snapshot survive');
assert.ok([...boundary.objects.keys()].at(-1).endsWith('/manifest.json'),'Complete manifest publishes last');
for(const fixture of [scheduledFixture(401),scheduledFixture(1,1001)]) {
 await assert.rejects(()=>backupLibrary(fixture.env),/Backup capacity exceeded/);
 assert.equal(fixture.reads,0,'Over-capacity backup fails before copying any score');
 assert.deepEqual([...fixture.objects],[[fixture.previous,'previous snapshot']],'Earlier snapshot unchanged; no incomplete writes');
}
console.log('PASS: encrypted backup roundtrip, tamper rejection, restored SQL and referenced score integrity; scheduled backup boundary and Free subrequest budget.');
