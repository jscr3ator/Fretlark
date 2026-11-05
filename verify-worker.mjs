import assert from 'node:assert/strict';
import worker from './cloudflare/worker.mjs';

const env={DB:{},BUCKET:{},ADMIN_EMAIL:'owner@example.invalid',ASSETS:{fetch:async request=>new Response(new URL(request.url).pathname)}};
const spoofed=new Request('https://fretline.example/api/session',{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':env.ADMIN_EMAIL}});
const session=await worker.fetch(spoofed,env);
assert.equal((await session.json()).authenticated,false,'Standalone identity headers cannot authenticate a teacher');
const home=await worker.fetch(new Request('https://fretline.example/'),env);
assert.equal(await home.text(),'/admin.html');
assert.equal(await (await worker.fetch(new Request('https://fretline.example/admin'),env)).text(),'/admin.html');
assert.equal(home.headers.get('X-Content-Type-Options'),'nosniff');
assert.equal(home.headers.get('X-Frame-Options'),'SAMEORIGIN');
assert.match(home.headers.get('Content-Security-Policy'), /frame-ancestors 'self'/);
const shared=await worker.fetch(new Request('https://fretline.example/view/'+'a'.repeat(64)),env);
assert.equal(shared.headers.get('Cache-Control'),'no-store');
assert.ok((await shared.text()).includes('/editor/player.html?share='+'a'.repeat(64)));
const demo=await worker.fetch(new Request('https://fretline.example/api/demo',{headers:{cookie:'fretline_session='+'a'.repeat(64)}}),env);
assert.equal(await demo.text(),'/editor/demo.gp','Legacy demo route uses static assets without database/session work');
console.log('PASS: standalone routes, security headers and identity boundary.');

// Exercise the actual autosave callback without initializing audio or the score renderer.
const {readFileSync}=await import('node:fs');
const {runInNewContext}=await import('node:vm');
const editor=readFileSync('public/editor/app.js','utf8');
const autosave=editor.slice(editor.indexOf('  function rememberDocument()'),editor.indexOf('  function renderDocumentTabs()')) + editor.slice(editor.indexOf('  function markDirty()'),editor.indexOf('  function mutate('));
const drafts=new Map();
const context={isViewer:false,guest:false,documentIndex:0,openedDocuments:[{}],selected:{track:0},activeTrack:0,currentString:1,displayed:new Set([0]),undo:[],redo:[],remoteLesson:null,document:{querySelector(){return null;}},draftKey:'fretline-draft:alice@example.test',score:{title:'Private A'},M:{snapshot:JSON.stringify},sessionStorage:{setItem:(k,v)=>drafts.set(k,v)},txt(){},status(){},toast(){},updateHistory(){},renderDocumentTabs(){},clearTimeout(){},setTimeout(fn){fn();},saveTimer:null};
runInNewContext(autosave+';markDirty();',context);
context.draftKey='fretline-draft:bob@example.test';context.score={title:'Private B'};
runInNewContext(autosave+';markDirty();',context);
const savedTitle=key=>JSON.parse(JSON.parse(drafts.get(key+':workspace')).documents[0].json).title;
assert.equal(savedTitle('fretline-draft:alice@example.test'),'Private A');
assert.equal(savedTitle('fretline-draft:bob@example.test'),'Private B');
context.isViewer=true;context.score={title:'Shared'};
runInNewContext(autosave+';markDirty();',context);
assert.equal(savedTitle('fretline-draft:bob@example.test'),'Private B');
assert.match(readFileSync('public/_headers','utf8'),/frame-ancestors 'self'/);
console.log('PASS: account-scoped tab autosave, no student autosave, static framing policy.');
await import('./verify-account-ui.mjs');
