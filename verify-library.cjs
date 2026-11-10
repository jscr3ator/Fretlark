const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/admin.js','utf8');
function setup(){
 const controls=new Map(),messages=[],calls=[],closed=[];
 const element=id=>{if(!controls.has(id))controls.set(id,{disabled:false,open:false,querySelectorAll(){return [];}});return controls.get(id);};
 const a={id:'a',title:'First'},b={id:'b',title:'Second'};
 const context=vm.createContext({lessons:[a,b],selected:null,librarySelectedId:'a',savingDetails:false,window:{appConfirm:async()=>true},$:element,api:async(path,options)=>{calls.push([path,options.method]);},render(){},toast:message=>messages.push(message),status:(id,message)=>messages.push(message),closeDialog:id=>closed.push(id)});
 vm.runInContext(source.slice(source.indexOf('  async function deleteLesson('),source.indexOf('  const notationNames=')),context);
 return {context,a,b,controls,messages,calls,closed};
}
(async()=>{
 let t=setup();t.context.window.appConfirm=async()=>false;await t.context.deleteLesson(t.a);assert.equal(t.calls.length,0);assert.equal(t.context.lessons.length,2,'Cancel preserves song');
 t=setup();await t.context.deleteLesson(t.a);assert.deepEqual(t.calls,[['admin/lessons/a','DELETE']]);assert.equal(t.context.lessons[0].id,'b');assert.equal(t.context.librarySelectedId,'b');assert.equal(t.closed.length,0,'Direct deletion needs no settings dialog');assert.equal(t.controls.get('selected-delete').disabled,false);
 t=setup();t.context.selected=t.a;await t.context.deleteLesson(t.a);assert.deepEqual(t.closed,['details-dialog']);assert.equal(t.context.selected,null);
 t=setup();t.context.api=async()=>{throw Error('Network unavailable');};await t.context.deleteLesson(t.a);assert.equal(t.context.lessons.length,2);assert.equal(t.messages[0],'Network unavailable');assert.equal(t.context.savingDetails,false,'Failure restores controls');
 t=setup();let release;t.context.api=()=>new Promise(resolve=>{release=resolve;});const deleting=t.context.deleteLesson(t.a);await new Promise(resolve=>setImmediate(resolve));assert.equal(t.context.savingDetails,true);await t.context.deleteLesson(t.b);t.context.librarySelectedId='b';t.context.selected=t.b;release();await deleting;assert.equal(t.context.lessons.length,1);assert.equal(t.context.lessons[0].id,'b');assert.equal(t.context.selected.id,'b','Selection changes cannot delete wrong song');assert.equal(t.context.librarySelectedId,'b');
 console.log('PASS: direct library deletion, confirmation, failure recovery, duplicate prevention and selection changes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
