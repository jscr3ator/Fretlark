const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const at = require('./public/editor/vendor/alphaTab.js');
const M = require('./public/editor/model.js');
const source = fs.readFileSync('public/admin.js','utf8');
const previewSource = fs.readFileSync('public/admin-preview.js','utf8');
const owner = 'preview@example.test';
const local = {id:'device-song',title:'Device song',artist:'',tracks:1,bars:4,tempo:120,updatedAt:'2026-11-03T00:00:00Z'};
const cloud = {id:'cloud-song',title:'Cloud song',track_count:1,bar_count:4,tempo:120,version:1,file_name:'song.gp',file_size:100};
function dom(){
 const nodes=new Map();
 function element(id){
  if(!nodes.has(id))nodes.set(id,{id,hidden:false,value:'',clientWidth:800,dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},attributes:{},children:[],textContent:'',innerHTML:'',setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},querySelector(s){return element(id+' '+s);},replaceChildren(...children){this.children=children;},addEventListener(type,handler){(this.handlers??={})[type]=handler;},focus(){this.focused=true;}});
  return nodes.get(id);
 }
 return {nodes,element,document:{getElementById:element,querySelector:element,querySelectorAll(){return [];}}};
}
function library(){
 const d=dom(),loads=[];
 const context=vm.createContext({$:d.element,document:d.document,window:{LocalSongs:{list(key){assert.equal(key,owner);return [local];}},FretphrasePreview:{load(...args){loads.push(args);},clear(){}},matchMedia(){return {matches:false};}},lessons:[cloud],localCloudSaves:new Set(),localOwner:owner,librarySelectedId:cloud.id,previewKey:null,filter:'all',storageCount:1,coverResults:new Map(),hasCover(){return false;},queueCover(){},coverObserver:{observe(){},disconnect(){}},coverStyle(){return '';},paintCover(){},coverHtml(){return '';},esc:s=>s,loadStorage:async()=>{},renderOverview(){}});
 vm.runInContext(source.slice(source.indexOf('  const localCoverSource'),source.indexOf('  function coverHtml')),context);
 vm.runInContext(source.slice(source.indexOf('  function render()'),source.indexOf('  function openStudentPreview')),context);
 vm.runInContext(source.slice(source.indexOf('  function onLessonAction'),source.indexOf('  function setFilter')),context);
 return {...d,context,loads};
}
(async()=>{
 const l=library();l.context.render();
 assert.match(l.element('lesson-list').innerHTML,/<div[^>]*role="button"[^>]*data-id="local:device-song"/,'Device row selects preview rather than navigating');
 assert.equal(l.element('result-count').textContent,'2','Library count includes device songs');
 l.context.onLessonAction({target:{closest(){return {dataset:{id:'local:device-song'}};}}});
 assert.equal(l.element('selected-title').textContent,'Device song');
 assert.equal(l.element('selected-edit').href,'/editor/index.html?local=device-song');
 assert.equal(l.element('selected-state').textContent,'Local');assert.equal(l.element('selected-cloud-save').hidden,false);
 assert.equal(l.loads.at(-1)[0].local_id,local.id);assert.equal(l.loads.at(-1)[2],owner);
 assert.equal(l.element('detail-share').hidden,true,'Device preview cannot invoke cloud sharing');
 l.context.onLessonAction({target:{closest(){return {dataset:{id:cloud.id}};}}});
 assert.equal(l.element('selected-cloud-save').hidden,true);assert.equal(l.element('selected-edit').href,'/editor/index.html?lesson=cloud-song');assert.equal(l.element('detail-share').hidden,false);
 l.context.lessons=[];l.context.librarySelectedId=null;l.context.render();
 assert.equal(l.element('selected-title').textContent,'Device song','A device-only library starts with a preview');
 assert.match(l.element('lesson-list').innerHTML,/aria-pressed="true"/);

 const d=dom(),renders=[],fetches=[];let pending,stored;
 let score=M.createScore();score.title=local.title;M.setNote(score,{track:0,staff:0,bar:0,voice:0,beat:0,note:0},{string:1,fret:7});stored=M.snapshot(score);
 class Renderer{
  constructor(host,settings){assert.equal(settings.player.playerMode,at.PlayerMode.Disabled);this.settings=settings;this.renderFinished={on:fn=>this.finished=fn};this.error={on(){}};}
  updateSettings(){}destroy(){}renderScore(value,tracks){renders.push({score:value,tracks});this.finished();}
 }
 const previewWindow={alphaTab:{...at,AlphaTabApi:Renderer},ScoreModel:M,LocalSongs:{get(key,id){assert.equal(key,owner);assert.equal(id,local.id);return stored===null?null:{json:stored};}}};
 const c=vm.createContext({window:previewWindow,document:d.document,location:{origin:'http://localhost'},URL,AbortController,Uint8Array,TextDecoder,Option:class{constructor(text,value){this.text=text;this.value=value;}},ResizeObserver:class{observe(){}},cancelAnimationFrame(){},requestAnimationFrame(){},fetch(url){fetches.push(url);return new Promise(resolve=>pending=resolve);}});
 vm.runInContext(previewSource,c);
 const row={...local,id:'local:'+local.id,local_id:local.id,updated_at:local.updatedAt};
 const p=previewWindow.FretphrasePreview;
 await p.load(row,false,owner);
 assert.equal(fetches.length,0,'Device notation never fetches or uploads song data');
 assert.equal(renders.at(-1).score.tracks[0].staves[0].bars[0].voices[0].beats[0].notes[0].fret,7);
 assert.equal(d.element('preview-status').textContent,'');
 const count=renders.length;await p.load(row,false,owner);assert.equal(renders.length,count,'Unchanged device preview reuses rendered score');
 score.title='Edited device song';stored=M.snapshot(score);await p.load({...row,updated_at:'later'},false,owner);assert.equal(renders.at(-1).score.title,score.title);
 const waiting=p.load(cloud,false,owner);await p.load(row,false,owner);
 pending({ok:true,arrayBuffer:async()=>new at.exporter.Gp7Exporter().export(M.createScore()).buffer});await waiting;
 assert.equal(renders.at(-1).score.title,score.title,'Slow cloud result cannot replace newer device selection');
 stored=null;await p.load(row,true,owner);assert.match(d.element('preview-status').textContent,/no longer saved/);assert.equal(d.element('preview-retry').hidden,false);
 stored=M.snapshot(score);await d.element('preview-retry').handlers.click();assert.equal(d.element('preview-status').textContent,'','Retry preserves local account owner');
 stored='broken json';await p.load(row,true,owner);assert.equal(d.element('preview-retry').hidden,false,'Corrupt device data fails visibly');
 p.clear();
 const last=p.load(cloud,false,owner);const bytes=new at.exporter.Gp7Exporter().export(score);pending({ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});await last;
 assert.equal(renders.at(-1).score.title,score.title,'Cloud preview still imports GP bytes');
 assert.equal(d.element('preview-status').textContent,'');
 console.log('PASS: device/cloud library selection, editor links, device-only library, counts, local notation without network, refresh, stale cloud responses, missing/corrupt files and retry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
