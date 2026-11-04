const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const at=require('./public/editor/vendor/alphaTab.js'),M=require('./public/editor/model.js');
const source=fs.readFileSync('public/admin.js','utf8');
function setup(){
 const score=M.createScore({title:'Brand New City',artist:'Mitski'});M.setNote(score,{track:0,staff:0,bar:0,voice:0,beat:0,note:0},{string:1,fret:7});
 const song={id:'device',title:'Brand New City',artist:'Mitski',json:M.snapshot(score)},data=new Map([['device',song]]),calls=[],messages=[],rows=[];
 const c=vm.createContext({File,Uint8Array,window:{alphaTab:at,ScoreModel:M,LocalSongs:{get(owner,id){assert.equal(owner,'owner');return data.get(id);},remove(owner,id){assert.equal(owner,'owner');data.delete(id);}}},localOwner:'owner',localCloudSaves:new Set(),librarySelectedId:'local:device',render(){},toast:(...args)=>messages.push(args),updateLesson:row=>rows.push(row),api:async(path,options)=>{calls.push({path,options});return {id:'cloud',title:'Brand New City'};}});
 vm.runInContext(source.slice(source.indexOf('  async function inspect('),source.indexOf('  function setUploadBusy')),c);
 vm.runInContext(source.slice(source.indexOf('  async function saveLocalToCloud('),source.indexOf('  // Moves a cloud song')),c);
 return {c,song,data,calls,messages,rows,row:{id:'local:device',local_id:'device'}};
}
(async()=>{
 let t=setup();await t.c.saveLocalToCloud(t.row);assert.equal(t.calls.length,1);assert.equal(t.calls[0].path,'admin/lessons');assert.equal(t.calls[0].options.method,'POST');assert.equal(t.data.size,0,'Remove local source only after successful cloud upload');assert.equal(t.c.librarySelectedId,'cloud');
 const file=t.calls[0].options.body,score=at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(await file.arrayBuffer()));assert.equal(score.title,'Brand New City');assert.equal(score.artist,'Mitski');assert.equal(score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].fret,7);
 const metadata=JSON.parse(decodeURIComponent(t.calls[0].options.headers['X-Fretphrase-Metadata']));assert.equal(metadata.file_size,file.size);
 t=setup();t.c.api=async()=>{throw Error('Cloud storage is full.');};await t.c.saveLocalToCloud(t.row);assert.ok(t.data.has('device'));assert.equal(t.c.localCloudSaves.size,0);assert.equal(t.rows.length,0);
 t=setup();let release;t.c.api=async(path,options)=>{t.calls.push({path,options});return new Promise(resolve=>release=resolve);};const saving=t.c.saveLocalToCloud(t.row);await new Promise(resolve=>setImmediate(resolve));await t.c.saveLocalToCloud(t.row);assert.equal(t.calls.length,1,'Ignore duplicate save clicks');
 t.data.set('device',{...t.song,json:t.song.json+' '});t.c.librarySelectedId='other';release({id:'cloud'});await saving;assert.ok(t.data.has('device'),'Keep newer local edits');assert.equal(t.c.librarySelectedId,'other','Do not steal a newer selection');
 t=setup();t.c.window.LocalSongs.remove=()=>{throw Error('Storage blocked');};await t.c.saveLocalToCloud(t.row);assert.equal(t.rows.length,1);assert.ok(t.data.has('device'));assert.match(t.messages.at(-1)[0],/copy was kept/);
 t=setup();t.data.set('device',{...t.song,json:'broken'});await t.c.saveLocalToCloud(t.row);assert.equal(t.calls.length,0);assert.ok(t.data.has('device'));
 t=setup();t.c.api=async()=>{t.c.localOwner='different';return {id:'cloud'};};await t.c.saveLocalToCloud(t.row);assert.equal(t.rows.length,0,'Account switch cannot display another account cloud row');assert.ok(t.data.has('device'));
 console.log('PASS: library cloud save GP roundtrip, metadata, success, quota/network failure, duplicate prevention, newer edits, selection race, cleanup failure and account switch.');
})().catch(error=>{console.error(error);process.exitCode=1;});
