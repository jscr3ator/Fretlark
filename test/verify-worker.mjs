import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.mjs';

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
// Embed routes are the only pages other sites may frame.
const embedToken='b'.repeat(64);
const embed=await worker.fetch(new Request('https://fretline.example/embed/'+embedToken),env);
assert.equal(embed.status,200);
assert.match(embed.headers.get('Content-Security-Policy'),/frame-ancestors \*$/);
assert.equal(embed.headers.get('X-Frame-Options'),null);
assert.equal(embed.headers.get('X-Robots-Tag'),'noindex, nofollow');
assert.ok((await embed.text()).includes('/editor/player.html?share='+embedToken+'&embed=1'));
const embedPlayer=await worker.fetch(new Request('https://fretline.example/editor/player.html?share='+embedToken+'&embed=1'),env);
assert.equal(embedPlayer.status,200);
assert.match(embedPlayer.headers.get('Content-Security-Policy'),/frame-ancestors \*$/);
assert.equal(embedPlayer.headers.get('X-Frame-Options'),null);
assert.equal(embedPlayer.headers.get('X-Robots-Tag'),'noindex, nofollow');
const adminPage=await worker.fetch(new Request('https://fretline.example/admin'),env);
assert.match(adminPage.headers.get('Content-Security-Policy'),/frame-ancestors 'self'/);
assert.equal(adminPage.headers.get('X-Frame-Options'),'SAMEORIGIN');
for(const url of ['https://fretline.example/editor/player.html?lesson=x&embed=1','https://fretline.example/editor/player.html?preview=1&embed=1']){
 const preview=await worker.fetch(new Request(url),env);
 assert.match(preview.headers.get('Content-Security-Policy'),/frame-ancestors 'self'/);
 assert.equal(preview.headers.get('X-Frame-Options'),'SAMEORIGIN');
}
const demo=await worker.fetch(new Request('https://fretline.example/api/demo',{headers:{cookie:'fretline_session='+'a'.repeat(64)}}),env);
assert.equal(await demo.text(),'/editor/demo.gp','Legacy demo route uses static assets without database/session work');
console.log('PASS: standalone routes, security headers and identity boundary.');

// API rate limiting: missing and failing bindings fail open so self-hosters never lose the API.
const limitedRequest = headers => new Request('https://fretline.example/api/demo', {headers});
assert.equal((await worker.fetch(limitedRequest(), env)).status, 200, 'Missing API_LIMITER lets requests through');
const throwingLimiter = {...env, API_LIMITER: {limit: async () => { throw Error('binding offline'); }}};
assert.equal((await worker.fetch(limitedRequest(), throwingLimiter)).status, 200, 'A failed limiter check fails open');

// Requests under the threshold pass; the next one gets the friendly 429.
const keys = [];
let allowed = 0;
const countingLimiter = {limit: async ({key}) => { keys.push(key); return {success: ++allowed <= 2}; }};
const countedEnv = {...env, API_LIMITER: countingLimiter};
assert.equal((await worker.fetch(limitedRequest({'cf-connecting-ip': '203.0.113.7'}), countedEnv)).status, 200);
assert.equal((await worker.fetch(limitedRequest({'cf-connecting-ip': '203.0.113.7'}), countedEnv)).status, 200);
const over = await worker.fetch(limitedRequest({'cf-connecting-ip': '203.0.113.7'}), countedEnv);
assert.equal(over.status, 429);
assert.equal(over.headers.get('Retry-After'), '60');
assert.match(over.headers.get('Content-Type'), /application\/json/);
assert.equal(over.headers.get('X-Content-Type-Options'), 'nosniff');
assert.equal(over.headers.get('X-Frame-Options'), 'SAMEORIGIN');
assert.match(over.headers.get('Content-Security-Policy'), /frame-ancestors 'self'/);
assert.deepEqual(await over.json(), {error: 'Too many requests. Wait a moment and try again.'});
assert.ok(keys.every(key => key === '203.0.113.7'), 'Limiter keys on the client IP');
assert.equal((await worker.fetch(limitedRequest(), countedEnv)).status, 429);
assert.equal(keys.at(-1), 'unknown', 'Missing client IP uses the unknown key');

// Non-API assets never touch the IP limiter.
let exemptCalls = 0;
const denyingLimiter = {limit: async () => { exemptCalls++; return {success: false}; }};
const deniedEnv = {...env, API_LIMITER: denyingLimiter};
assert.equal((await worker.fetch(new Request('https://fretline.example/'), deniedEnv)).status, 200);
assert.equal((await worker.fetch(new Request('https://fretline.example/admin'), deniedEnv)).status, 200);
assert.equal(exemptCalls, 0, 'Static pages never call the limiter');
console.log('PASS: API rate limit passes normal use, blocks floods with headers, exempts webhooks, and fails open.');

// Exercise the actual autosave callback without initializing audio or the score renderer.
const {readFileSync}=await import('node:fs');
const {runInNewContext}=await import('node:vm');
const editor=readFileSync('public/editor/app.js','utf8');
const autosave=editor.slice(editor.indexOf('  function rememberDocument()'),editor.indexOf('  function renderDocumentTabs()')) + editor.slice(editor.indexOf('  function markDirty()'),editor.indexOf('  function mutate('));
const drafts=new Map();
const context={isViewer:false,guest:false,documentIndex:0,openedDocuments:[{}],selected:{track:0},activeTrack:0,currentString:1,displayed:new Set([0]),undo:[],redo:[],remoteLesson:null,editVersion:0,document:{querySelector(){return null;}},draftKey:'fretline-draft:alice@example.test',score:{title:'Private A'},M:{snapshot:JSON.stringify},sessionStorage:{setItem:(k,v)=>drafts.set(k,v)},txt(){},status(){},toast(){},updateHistory(){},renderDocumentTabs(){},clearTimeout(){},setTimeout(fn){fn();},saveTimer:null};
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
// Scripts are restricted everywhere: no inline scripts or handlers, no eval.
for(const policy of [home.headers.get('Content-Security-Policy'),adminPage.headers.get('Content-Security-Policy'),readFileSync('public/_headers','utf8')]){
 assert.match(policy,/script-src 'self'/);assert.doesNotMatch(policy,/script-src[^;]*'unsafe-(inline|eval)'/);
}
assert.match(home.headers.get('Content-Security-Policy'),/script-src[^;]*https:\/\/cdn\.jsdelivr\.net/,'The landing page may load its pinned script');
assert.doesNotMatch(adminPage.headers.get('Content-Security-Policy'),/cdn\.jsdelivr\.net/,'App pages cannot load scripts from jsDelivr');
const {readdirSync}=await import('node:fs');
for(const name of readdirSync('public',{recursive:true}).filter(name=>name.endsWith('.html')&&!name.includes('vendor'))){
 const html=readFileSync('public/'+name,'utf8');
 assert.doesNotMatch(html,/<script(?![^>]*\bsrc=)[^>]*>/,`${name} has an inline script the CSP would block`);
 assert.doesNotMatch(html,/<[^>]+\son[a-z]+=["']/,`${name} has an inline event handler the CSP would block`);
}
// HTTPS: only when FORCE_HTTPS is on, never for local addresses; HSTS rides on HTTPS responses.
const httpsEnv={...env,FORCE_HTTPS:'true'};
const edge=scheme=>({headers:{'cf-visitor':JSON.stringify({scheme})}});
const redirected=await worker.fetch(new Request('http://fretline.example/admin?x=1',edge('http')),httpsEnv);
assert.equal(redirected.status,301);assert.equal(redirected.headers.get('Location'),'https://fretline.example/admin?x=1');
assert.equal((await worker.fetch(new Request('http://fretline.example/api/auth/login',{method:'POST',...edge('http')}),httpsEnv)).status,308,'Non-GET requests keep their method');
assert.equal((await worker.fetch(new Request('http://localhost:8787/admin',edge('http')),httpsEnv)).status,200,'Local development is never redirected');
assert.equal((await worker.fetch(new Request('http://fretline.example/admin'),httpsEnv)).status,200,'Without Cloudflare\'s edge (wrangler dev, self-hosting) nothing is redirected');
assert.equal((await worker.fetch(new Request('http://fretline.example/admin',edge('http')),env)).status,200,'Redirects are opt-in');
assert.match((await worker.fetch(new Request('https://fretline.example/admin',edge('https')),httpsEnv)).headers.get('Strict-Transport-Security'),/max-age=\d{7,}/);
assert.equal((await worker.fetch(new Request('https://fretline.example/admin'),env)).headers.get('Strict-Transport-Security'),null);
assert.deepEqual(Object.keys(await import('../cloudflare/worker.mjs')),['default'],'The Worker module may only export its handler');
console.log('PASS: strict script CSP, no inline scripts, opt-in HTTPS redirect and HSTS.');
console.log('PASS: account-scoped tab autosave, no student autosave, static framing policy.');
await import('./verify-account-ui.mjs');
