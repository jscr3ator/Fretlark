const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/admin.js','utf8');
const block=source.slice(source.indexOf('  const coverResults='),source.indexOf('  // Songs without verified artwork'));
const artwork={url:'https://is1-ssl.mzstatic.com/cover/600x600bb.jpg',fallbackUrl:'https://is1-ssl.mzstatic.com/cover/100x100bb.jpg',album:'Album',artist:'Artist',source:'Apple Music'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 const nodes=[],requests=[],timers=[],events={};let now=0;
 const ctx={addEventListener(type,fn){events[type]=fn;},clearTimeout(){},$(){return nodes[0];},URL,Date:{now:()=>now},IntersectionObserver:class{observe(){}unobserve(){}},document:{querySelectorAll:()=>nodes},setTimeout(fn,delay){const timer={fn,delay};timers.push(timer);return timer;},api(path){return new Promise((resolve,reject)=>requests.push({path,resolve,reject}));}};
 vm.createContext(ctx);vm.runInContext(block,ctx);
 function node(id='one',title='Title'){
  const image={},classes=new Set();const n={dataset:{coverId:id,coverKey:JSON.stringify([id,title,'Artist'])},querySelector:()=>image,classList:{add:v=>classes.add(v),remove:v=>classes.delete(v)},removeAttribute(k){delete this[k];},image,classes};nodes.push(n);return n;
 }
 return {ctx,nodes,requests,timers,events,node,advance:ms=>now+=ms};
}
(async()=>{
 const t=setup(),n=t.node(),other=t.node();t.ctx.queueCover(n);t.ctx.queueCover(other);assert.equal(t.requests.length,1,'Matching cards share one pending lookup');
 t.requests[0].reject(Object.assign(Error('Temporary failure'),{status:503}));await flush();assert.equal(t.ctx.hasCover(n.dataset.coverKey),false,'Temporary failure is not a permanent browser miss');
 assert.equal(t.timers[0].delay,5000);t.timers[0].fn();assert.equal(t.requests.length,2);
 t.requests[1].resolve({artwork});await flush();assert.equal(n.image.src,artwork.url);assert.equal(other.image.src,artwork.url);
 n.image.onerror();assert.equal(n.image.src,artwork.fallbackUrl);n.image.onload();assert.ok(n.classes.has('has-cover'));
 const stale=n.image.onload;n.dataset.coverKey='changed';n.classes.clear();stale();assert.equal(n.classes.size,0,'Old image handlers cannot mark a different song as loaded');
 const miss=setup(),m=miss.node();miss.ctx.queueCover(m);miss.requests[0].resolve({artwork:null});await flush();miss.ctx.queueCover(m);assert.equal(miss.requests.length,1);
 miss.advance(3600001);miss.ctx.queueCover(m);assert.equal(miss.requests.length,2,'Confirmed misses expire during a long library session');miss.requests[1].resolve({artwork});await flush();
 const bounded=setup(),b=bounded.node();bounded.ctx.queueCover(b);
 for(let i=0;i<3;i++){bounded.requests[i].reject(Error('Offline'));await flush();if(i<2)bounded.timers[i].fn();}
 assert.equal(bounded.timers.length,2,'Automatic lookup retries are bounded');assert.equal(bounded.timers[1].delay,65000);bounded.events.online();assert.equal(bounded.requests.length,4,'Reconnection retries the selected cover');bounded.requests[3].resolve({artwork});await flush();
 const denied=setup();denied.ctx.queueCover(denied.node());denied.requests[0].reject(Object.assign(Error('Forbidden'),{status:403}));await flush();assert.equal(denied.timers.length,0);
 const images=setup(),i=images.node();images.ctx.applyCover(i,artwork);i.image.onerror();i.image.onerror();assert.equal(i.image.src,'/admin-assets/doc.svg');assert.equal(images.timers.length,1);images.timers[0].fn();assert.equal(images.requests.length,1,'Failed image can retry safely');images.requests[0].resolve({artwork});await flush();
 const invalid=setup(),iv=invalid.node();invalid.ctx.applyCover(iv,{...artwork,fallbackUrl:'https://attacker.example/cover'});iv.image.onerror();assert.equal(iv.image.src,'/admin-assets/doc.svg','Untrusted fallback is never loaded');
 const local=setup(),loc=local.node('local:device','A & B');local.ctx.queueCover(loc);assert.equal(local.requests[0].path,'admin/artwork?title=A%20%26%20B&artist=Artist');local.requests[0].resolve({artwork:null});await flush();
 const limit=setup();for(let i=0;i<3;i++)limit.ctx.queueCover(limit.node(String(i)));assert.equal(limit.requests.length,2,'Only two concurrent requests');limit.requests[0].resolve({artwork:null});await flush();assert.equal(limit.requests.length,3);limit.requests[1].resolve({artwork:null});limit.requests[2].resolve({artwork:null});await flush();
 console.log('PASS: library artwork deduplication, transient retries and bounds, miss expiry, image fallback, stale handlers, safe URLs, device lookup and concurrency.');
})().catch(error=>{console.error(error);process.exitCode=1;});
