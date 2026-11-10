const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = {}, frames = new Map(), requests = [];
let frameId = 0, focused, fail = false, resolveSave;
const classes = () => ({add(){},remove(){},toggle(){}});
const scroll = {scrollTop:0,getBoundingClientRect:()=>({top:0,bottom:350})};
let rows;
function row(id) {
  const value = {dataset:{song:id},style:{},classList:classes(),isConnected:true,
    getBoundingClientRect(){return {top:100+list.children.indexOf(this)*60-scroll.scrollTop+(parseFloat(this.style.transform?.slice(11))||0),height:60};},
    querySelector(s){return s==='.setlist-drag'?handle:s==='.setlist-song-index'?number:s.includes('"up"')?up:down;},
    closest(s){return s==='.users-content'?scroll:this;}};
  const number={textContent:''},up={disabled:false},down={disabled:false};
  const handle={disabled:false,closest:()=>value,focus(){focused=id;},setPointerCapture(){this.captured=true;},hasPointerCapture(){return this.captured;},releasePointerCapture(){this.captured=false;}};
  value.handle=handle;
  return value;
}
const list={children:[],classList:classes(),
  insertBefore(value,before){assert.ok(!value.handle.captured,'never move captured element in DOM');if(value===before)return;this.children=this.children.filter(r=>r!==value);const i=before?this.children.indexOf(before):this.children.length;this.children.splice(i,0,value);},
  append(...values){for(const value of values)this.insertBefore(value,null);},
  set innerHTML(html){this.children=[...html.matchAll(/data-song="([^"]+)"/g)].map(m=>row(m[1]));this.children.forEach(r=>r.parentElement=this);},
};
const status={textContent:'',classList:classes()};
const dialog={open:true};
const document={getElementById:id=>id==='setlists-dialog'?dialog:id==='setlists-status'?status:{querySelector:()=>list},
  addEventListener(type,fn){(listeners[type]??=[]).push(fn);}};
const window={matchMedia:()=>({matches:false}),addEventListener(type,fn){(listeners[type]??=[]).push(fn);}};
const context=vm.createContext({window,document,console,requestAnimationFrame(fn){const id=++frameId;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},
  fetch:async(path,options)=>{const body=JSON.parse(options.body);requests.push({path,...body});await new Promise(r=>resolveSave=r);return {ok:!fail,status:fail?503:200,json:async()=>fail?{error:'Save failed'}:{id:'set',songs:body.lesson_ids.map(id=>({id,title:id,shared:1}))}};}});
const source=fs.readFileSync('public/admin-setlists.js','utf8');
vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.dragTest={setDetail(value){detail=value;},getDetail(){return detail;},songRow,numberSongs,patchSongs};})();'),context);
const test=window.dragTest;
function reset(){scroll.scrollTop=0;fail=false;requests.length=0;dialog.open=true;rows=['a','b','c'].map(row);list.children=rows;rows.forEach(r=>r.parentElement=list);test.setDetail({id:'set',songs:rows.map(r=>({id:r.dataset.song,title:r.dataset.song,shared:1}))});test.numberSongs(list);}
const ids=()=>list.children.map(r=>r.dataset.song);
async function fire(type,values={}){const e={pointerId:7,button:0,isPrimary:true,preventDefault(){this.prevented=true;},...values};for(const fn of listeners[type]||[])await fn(e);return e;}
const start=(index=0,extra={})=>fire('pointerdown',{target:{closest:()=>rows[index].handle},clientY:130+index*60,...extra});
const move=y=>fire('pointermove',{clientY:y});
const settle=async()=>{resolveSave();await new Promise(setImmediate);};
(async()=>{
  reset();await start();await move(250);assert.deepEqual(ids(),['a','b','c'],'DOM stays stable throughout drag');assert.equal(rows[1].style.transform,'translateY(-60px)','neighbour slides into gap');assert.equal(rows[0].handle.captured,true);await fire('pointerup');assert.deepEqual(requests[0].lesson_ids,['b','c','a']);await settle();assert.equal(list.children[2],rows[0],'successful save keeps animated DOM');assert.equal(focused,'a','focus restored after save');assert.match(status.textContent,/Position 3 of 3/);assert.deepEqual(Array.from(test.getDetail().songs,s=>s.id),['b','c','a']);
  reset();await start(2,{pointerType:'touch'});await move(105);await fire('pointerup');assert.deepEqual(requests[0].lesson_ids,['c','a','b'],'same pointer flow supports touch upward drag');await settle();
  reset();await start();await move(250);await fire('pointercancel');assert.deepEqual(ids(),['a','b','c']);assert.equal(requests.length,0,'cancel never saves');assert.equal(frames.size,0,'cancel stops autoscroll');
  reset();await start();await move(250);const escape=await fire('keydown',{key:'Escape'});assert.equal(escape.prevented,true);assert.deepEqual(ids(),['a','b','c']);assert.equal(requests.length,0);
  reset();await start();await move(250);await fire('lostpointercapture');assert.deepEqual(ids(),['a','b','c']);assert.equal(requests.length,0);
  reset();await start();await move(133);await fire('pointerup');assert.equal(requests.length,0,'handle click/small movement does not save');
  reset();await start();await move(250);fail=true;await fire('pointerup');await settle();assert.deepEqual(ids(),['a','b','c'],'failed save restores saved order');assert.equal(status.textContent,'Save failed');assert.equal(focused,'a');
  reset();await start();await move(250);await fire('pointerup');test.setDetail(null);await settle();assert.equal(test.getDetail(),null,'late save cannot reopen navigated setlist');
  reset();await start();await move(345);assert.equal(frames.size,1);const callback=[...frames.values()][0];frames.clear();callback();assert.ok(scroll.scrollTop>0,'holding near edge scrolls list');await fire('blur');assert.equal(frames.size,0);assert.equal(requests.length,0);
  reset();await start();await fire('pointermove',{pointerId:9,clientY:250});assert.deepEqual(ids(),['a','b','c'],'second touch cannot move captured row');await fire('pointerup');assert.equal(requests.length,0);
  reset();await start(0,{isPrimary:false});await move(250);await fire('pointerup');assert.equal(requests.length,0);
  reset();const keyboard=fire('keydown',{key:'ArrowDown',target:{closest:()=>rows[0].handle}});await Promise.resolve();await Promise.resolve();assert.deepEqual(requests[0].lesson_ids,['b','a','c'],'arrow key on handle saves new order');resolveSave();await keyboard;assert.equal(focused,'a');
  assert.match(test.songRow({id:'x',title:'<img onerror="x">',shared:1},0,2),/Drag to reorder &lt;img onerror=&quot;x&quot;&gt;/,'drag labels escape song titles');
  console.log('PASS: setlist mouse/touch reorder, single save, focus, cancellation, rollback, stale responses, edge scroll and escaped labels.');
})().catch(e=>{console.error(e);process.exitCode=1;});
