const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('public/player.js','utf8');
const block=code.slice(code.indexOf('// The same server-side catalog matcher'),code.indexOf('const handGuide='));
const artwork={url:'https://is1-ssl.mzstatic.com/image/thumb/Music/cover.jpg/100x100bb.jpg',album:'Room for Squares',artist:'John Mayer',source:'Apple Music'};
function setup(search='?share=valid'){
 const classes=new Set(),image={src:'/admin-assets/brand.svg?v=4',alt:'Fretlark',classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},removeAttribute(name){delete this[name];}};
 let requests=[],preloads=[],timers=[],events={};
 const ctx={window:{addEventListener(type,fn){events[type]=fn;},studio:{score:{title:'Neon',artist:'John Mayer'}}},$:()=>image,params:new URLSearchParams(search),URL,AbortController,setTimeout(fn,delay){const timer={fn,delay};timers.push(timer);return timer;},clearTimeout(){},
 fetch(url,options){return new Promise(resolve=>requests.push({url,options,resolve}));},Image:class{constructor(){preloads.push(this);}}};
 vm.createContext(ctx);vm.runInContext(block,ctx);return {ctx,image,classes,requests,preloads,timers,events};
}
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));};
(async()=>{
 const t=setup();t.ctx.syncCover();assert.equal(t.requests[0].url,'/api/shared/valid/artwork');assert.equal(t.image.src,'/admin-assets/brand.svg?v=4');
 t.requests[0].resolve({ok:true,json:async()=>({title:'Neon',artist:'John Mayer',artwork})});await flush();
 assert.equal(t.image.src,'/admin-assets/brand.svg?v=4','Keep logo until image has loaded');assert.equal(t.preloads.length,1);
 t.preloads[0].onload();assert.equal(t.image.src,artwork.url);assert.ok(t.classes.has('album-cover'));
 t.image.onerror();assert.equal(t.image.src,'/admin-assets/brand.svg?v=4');assert.equal(t.image.alt,'Fretlark');assert.equal(t.image.title,undefined);
 t.ctx.syncCover();assert.equal(t.requests.length,1,'Re-rendering notation does not repeatedly search');
 const race=setup();race.ctx.syncCover();race.ctx.window.studio.score={title:'Other',artist:'Artist'};race.ctx.syncCover();
 assert.equal(race.requests[0].options.signal.aborted,true);
 race.requests[0].resolve({ok:true,json:async()=>({title:'Neon',artist:'John Mayer',artwork})});await flush();assert.equal(race.preloads.length,0,'Discard stale catalog response');
 race.requests[1].resolve({ok:true,json:async()=>({title:'Neon',artist:'John Mayer',artwork})});await flush();assert.equal(race.preloads.length,0,'Server metadata must match displayed song');
 for(const payload of [null,{title:'Neon',artist:'John Mayer',artwork:null},{title:'Neon',artist:'John Mayer',artwork:{...artwork,url:'https://attacker.example/image.jpg'}}]){
  const x=setup();x.ctx.syncCover();x.requests[0].resolve({ok:true,json:async()=>payload});await flush();assert.equal(x.image.src,'/admin-assets/brand.svg?v=4');assert.equal(x.preloads.length,0);
 }
 const late=setup();late.ctx.syncCover();late.requests[0].resolve({ok:true,json:async()=>({title:'Neon',artist:'John Mayer',artwork})});await flush();late.ctx.window.studio.score={title:'Exercise',artist:''};late.ctx.syncCover();late.preloads[0].onload();assert.equal(late.image.src,'/admin-assets/brand.svg?v=4','Discard stale image load');assert.equal(late.requests.length,1,'No artist means no lookup');
 const preview=setup('?preview=1&lesson=owned');preview.ctx.syncCover();assert.equal(preview.requests[0].url,'/api/admin/lessons/owned/artwork');
 const local=setup('');local.ctx.syncCover();assert.equal(local.requests.length,0);
 const deezer=setup();deezer.ctx.syncCover();deezer.requests[0].resolve({ok:true,json:async()=>({title:'Neon',artist:'John Mayer',artwork:{...artwork,source:'Deezer',url:'https://cdn-images.dzcdn.net/images/cover/known/1000x1000.jpg'}})});await flush();assert.equal(deezer.preloads.length,1);deezer.preloads[0].onload();assert.ok(deezer.classes.has('album-cover'));
 const denied=setup();denied.ctx.syncCover();denied.requests[0].resolve({ok:false});await flush();assert.equal(denied.image.src,'/admin-assets/brand.svg?v=4');
 const fallback=setup();fallback.ctx.syncCover();fallback.requests[0].resolve({ok:true,json:async()=>({title:'Neon',artist:'John Mayer',artwork:{...artwork,fallbackUrl:'https://is1-ssl.mzstatic.com/cover/100x100bb.jpg'}})});await flush();
 fallback.preloads[0].onerror();assert.equal(fallback.preloads[0].src,'https://is1-ssl.mzstatic.com/cover/100x100bb.jpg');fallback.preloads[0].onload();assert.equal(fallback.image.src,fallback.preloads[0].src,'Player displays original image when larger rendition fails');
 const temporary=setup();temporary.ctx.syncCover();temporary.requests[0].resolve({ok:false,status:503});await flush();assert.equal(temporary.timers[0].delay,5000);temporary.timers[0].fn();assert.equal(temporary.requests.length,2);
 temporary.requests[1].resolve({ok:false,status:503});await flush();assert.equal(temporary.timers[1].delay,65000);temporary.timers[1].fn();temporary.requests[2].resolve({ok:false,status:503});await flush();assert.equal(temporary.timers.length,2,'Player automatic retries are bounded');temporary.events.online();assert.equal(temporary.requests.length,4,'Reconnection recovers after exhausted automatic retries');
 const cancelled=setup();cancelled.ctx.syncCover();cancelled.requests[0].resolve({ok:false,status:503});await flush();cancelled.ctx.window.studio.score={title:'Other',artist:'Artist'};cancelled.ctx.syncCover();cancelled.timers[0].fn();assert.equal(cancelled.requests.length,2,'Old retry cannot replace newer song artwork');
 const broken=setup();broken.ctx.syncCover();broken.requests[0].resolve({ok:true,json:async()=>({title:'Neon',artist:'John Mayer',artwork})});await flush();broken.preloads[0].onerror();assert.equal(broken.timers.length,1,'Failed image preload is retryable');
 assert.equal(denied.timers.length,0,'Authorization errors do not trigger retry');
 console.log('PASS: player artwork identity, preview/shared routes, preload, broken images, misses, invalid URLs, stale responses and stale image loads.');
})().catch(e=>{console.error(e);process.exitCode=1;});
