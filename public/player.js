(()=>{'use strict';
const $=id=>document.getElementById(id),api=window.studio.api,params=new URLSearchParams(location.search);
// The same server-side catalog matcher supplies teacher and student artwork.
const coverImage=$('player-cover');
let coverIdentity='',coverGeneration=0,coverController=null,coverRetryTimer=null,coverRetries=0;
function resetCover(){
 if(!coverImage)return;
 coverImage.onerror=null;coverImage.src='/admin-assets/brand.svg?v=4';coverImage.alt='Fretlark';
 coverImage.classList.remove('album-cover');coverImage.removeAttribute('title');hideCoverCredit();
}
function coverCreditUrl(value){
 try{const url=new URL(value);return url.protocol==='https:'&&['music.apple.com','deezer.com','www.deezer.com'].includes(url.hostname)&&!url.port&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
function hideCoverCredit(){
 if(typeof document==='undefined')return;const credit=document.getElementById('player-cover-credit');if(credit){credit.hidden=true;credit.removeAttribute('href');}
}
function setCoverCredit(artwork){
 if(typeof document==='undefined')return;
 const url=coverCreditUrl(artwork?.sourceUrl),label=artwork?.source==='Deezer'?'Deezer':artwork?.source==='Apple Music'?'Apple Music':null;
 if(!url||!label){hideCoverCredit();return;}
 const credit=document.getElementById('player-cover-credit');
 if(!credit)return;
 credit.href=url;
 const text=credit.querySelector('.cover-credit-text');
 if(text)text.textContent=`Artwork · ${label}`;else credit.textContent=`Artwork · ${label}`;
 credit.setAttribute('aria-label',`Album artwork from ${label} (opens in a new tab)`);credit.title=`Album artwork from ${label}`;credit.hidden=false;
}
function retryCover(generation,delay){
 if(generation!==coverGeneration||coverRetries>=2||coverRetryTimer)return;
 const wait=delay||(coverRetries?65000:5000);coverRetries++;
 coverRetryTimer=setTimeout(()=>{coverRetryTimer=null;if(generation===coverGeneration)syncCover(true);},wait);
}
function syncCover(retry=false){
 const song=window.studio.score;
 const identity=JSON.stringify([song?.title||'',song?.artist||'']);
 if(identity===coverIdentity&&!retry)return;
 clearTimeout(coverRetryTimer);coverRetryTimer=null;if(identity!==coverIdentity)coverRetries=0;
 coverIdentity=identity;const generation=++coverGeneration;
 coverController?.abort();resetCover();
 if(!coverImage||!song?.title?.trim()||!song?.artist?.trim())return;
 const token=params.get('share'),lesson=params.get('lesson');
 const base=token?'shared/'+encodeURIComponent(token):params.has('preview')&&lesson?'admin/lessons/'+encodeURIComponent(lesson):null;
 if(!base)return;
 const controller=new AbortController();coverController=controller;
 fetch('/api/'+base+'/artwork',{credentials:'same-origin',cache:'no-store',signal:controller.signal})
 .then(response=>{if(response.status===429)throw Object.assign(Error('Artwork unavailable'),{retryDelay:(Number(response.headers.get('Retry-After'))||60)*1000});if(response.status>=500)throw Error('Artwork unavailable');return response.ok?response.json():null;}).then(data=>{
  if(generation!==coverGeneration||!data?.artwork||JSON.stringify([data.title,data.artist])!==identity)return;
  const artwork=data.artwork;let url;try{url=new URL(artwork.url);}catch{return;}
  if(url.protocol!=='https:'||!/^(?:is\d+-ssl\.mzstatic\.com|(?:e-cdns|cdn)-images\.dzcdn\.net)$/.test(url.hostname)||url.port||url.username||url.password)return;
  // Preload before changing the visible icon. Misses and failed images keep the logo.
  const preload=new Image();preload.referrerPolicy='no-referrer';
  let fallback;try{const candidate=new URL(artwork.fallbackUrl);if(candidate.protocol==='https:'&&/^(?:is\d+-ssl\.mzstatic\.com|(?:e-cdns|cdn)-images\.dzcdn\.net)$/.test(candidate.hostname)&&!candidate.port&&!candidate.username&&!candidate.password&&candidate.href!==url.href)fallback=candidate.href;}catch{}
  preload.onerror=()=>{if(generation!==coverGeneration)return;if(fallback){const next=fallback;fallback=null;preload.src=next;}else retryCover(generation);};
  preload.onload=()=>{
   if(generation!==coverGeneration)return;
   coverImage.onerror=()=>{if(generation===coverGeneration){resetCover();retryCover(generation);}};
   coverImage.referrerPolicy='no-referrer';coverImage.alt='';coverImage.src=preload.src;
   coverImage.classList.add('album-cover');
   const label=artwork.source==='Deezer'?'Deezer':artwork.source==='Apple Music'?'Apple Music':null;
   coverImage.title=label?`Album artwork from ${label}`:`${artwork.album} · ${artwork.artist}`;setCoverCredit(artwork);
  };
  preload.src=url.href;
 }).catch(error=>retryCover(generation,error?.retryDelay));
}
window.addEventListener('online',()=>{coverRetries=0;syncCover(true);});
const handGuide=window.HandPosition.create({host:$('hand-board'),status:$('hand-status'),chord:$('hand-chord'),detail:$('hand-detail'),noteName:pitch=>window.alphaTab.model.Tuning.getTextForTuning(pitch,false)});
let handBeats=[],handVisible=false;
function guideTrack(){return window.studio.score?.tracks[Number($('active-track-select').value)||0];}
// Notes just before and after the current beat show which hand position the passage sits in.
function handContext(track,beats){
 const base=beats.find(b=>b?.voice?.bar?.staff?.track===track);if(!base)return null;
 const before=[],after=[];
 for(let b=base.previousBeat;b&&before.length<3;b=b.previousBeat)before.unshift(b);
 for(let b=base.nextBeat;b&&after.length<6;b=b.nextBeat)after.push(b);
 return {before,after,plan:true};
}
function updateHand(beats=handBeats,animate=false){
 handBeats=beats;if(!handVisible)return;
 const track=guideTrack(),lookup=animate&&track&&api.tickCache?.findBeat(new Set([track.index]),api.tickPosition),duration=Math.min(140,(lookup?.duration||300)/(api.playbackSpeed||1)*.4);
 const frame=handGuide.update(track,beats,{animate,duration,context:handContext(track,beats)});
 $('hand-caption').textContent=frame?.capo?'Capo '+frame.capo:'';$('hand-caption').hidden=!frame?.capo;
}
function handAtCursor(){
 const track=guideTrack(),lookup=track&&api.tickCache?.findBeat(new Set([track.index]),api.tickPosition);
 updateHand(lookup?.beatLookup.highlightedBeats.map(item=>item.beat)||[]);
}
function showHand(show){
 handVisible=show;$('hand-guide').hidden=!show;document.body.classList.toggle('hand-guide-open',show);
 $('toggle-hand-guide').setAttribute('aria-expanded',String(show));$('toggle-hand-guide').setAttribute('aria-pressed',String(show));
 if(show)handAtCursor();
 // Resize through the existing alphaTab observer; score scroll remains independent.
}
$('toggle-hand-guide').addEventListener('click',()=>showHand(!handVisible));
$('close-hand-guide').addEventListener('click',()=>{showHand(false);$('toggle-hand-guide').focus();});
api.activeBeatsChanged.on(e=>updateHand(e.activeBeats,true));
api.beatMouseDown.on(beat=>updateHand([beat]));
api.renderFinished.on(handAtCursor);
api.midiLoaded.on(handAtCursor);
api.playerPositionChanged.on(()=>{if(handVisible&&api.playerState!==1)handAtCursor();});
$('active-track-select').addEventListener('change',handAtCursor);
api.playerFinished.on(()=>updateHand([]));
$('btn-stop').addEventListener('click',()=>queueMicrotask(handAtCursor));
api.midiEventsPlayedFilter=[...new Set([...(api.midiEventsPlayedFilter||[]),window.alphaTab.midi.MidiEventType.AlphaTabMetronome])];
api.midiEventsPlayed.on(e=>{
 if(api.metronomeVolume<=0||!e.events.some(event=>event.isMetronome))return;
 $('btn-metronome').querySelector('.tool-indicator')?.animate?.([{opacity:1,backgroundColor:'#155cc2'},{opacity:.35,backgroundColor:'#155cc2'},{opacity:1}],{duration:180});
});
// Metronome volume: while the metronome is on, the slider appears on hover/focus (mouse, keyboard) or press-and-hold (touch) and
// closes itself when the pointer leaves. Only transform/opacity animate; layout is read once per open.
{
 const button=$('btn-metronome'),pop=$('metro-pop'),slider=$('metro-volume'),readout=$('metro-volume-value');
 let hideTimer,holdTimer,held=false,dragging=false,volume=60,isOpen=false;
 const place=()=>{const r=button.getBoundingClientRect(),w=pop.offsetWidth;pop.style.top=r.bottom+8+'px';pop.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left+r.width/2-w/2))+'px';pop.style.setProperty('--tip',Math.max(14,Math.min(w-14,r.left+r.width/2-parseFloat(pop.style.left)))+'px');};
 const setOpen=yes=>{
  if(yes===isOpen)return;
  if(yes&&(button.hidden||button.disabled||!(api.metronomeVolume>0)))return;
  isOpen=yes;clearTimeout(hideTimer);
  if(yes)place();
  pop.classList.toggle('open',yes);pop.setAttribute('aria-hidden',String(!yes));
  button.classList.toggle('volume-open',yes);
 };
 const show=()=>{clearTimeout(hideTimer);setOpen(true);};
 const hide=(delay=160)=>{clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(!dragging)setOpen(false);},delay);};
 const apply=()=>{readout.textContent=volume;slider.value=volume;slider.style.setProperty('--fill',volume+'%');if(api.metronomeVolume>0)api.metronomeVolume=volume/100;};
 button.addEventListener('click',e=>{
  if(held){held=false;e.stopImmediatePropagation();return;}
  queueMicrotask(()=>{if(api.metronomeVolume>0){apply();if(button.matches(':hover'))show();}else setOpen(false);});
 },true);
 // Capture-phase handler above runs before app.js toggles; the microtask applies the chosen level afterwards.
 slider.addEventListener('input',()=>{
  volume=Number(slider.value);apply();
 });
 slider.addEventListener('pointerdown',()=>{dragging=true;clearTimeout(hideTimer);});
 const endDrag=e=>{if(!dragging)return;dragging=false;if(e.pointerType==='mouse'&&!pop.matches(':hover')&&!button.matches(':hover'))hide(120);};
 window.addEventListener?.('pointerup',endDrag);
 for(const el of [button,pop]){
  el.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')show();});
  el.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse')hide();});
 }
 button.addEventListener('focus',show);
 button.addEventListener('blur',()=>{if(!pop.matches(':hover'))hide(250);});
 pop.addEventListener('focusout',e=>{if(!pop.contains(e.relatedTarget)&&e.relatedTarget!==button&&!pop.matches(':hover'))hide(120);});
 button.addEventListener('pointerdown',e=>{
  if(e.pointerType==='mouse')return;
  held=false;clearTimeout(holdTimer);holdTimer=setTimeout(()=>{held=true;show();},420);
 });
 for(const type of ['pointerup','pointercancel','pointerleave'])button.addEventListener(type,()=>clearTimeout(holdTimer));
 button.addEventListener('contextmenu',e=>{if(held||holdTimer)e.preventDefault();});
 document.addEventListener('pointerdown',e=>{if(isOpen&&!pop.contains(e.target)&&!button.contains(e.target))setOpen(false);});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen)setOpen(false);});
 window.addEventListener?.('resize',()=>{if(isOpen)place();});
 button.closest?.('.practice-toolbar')?.addEventListener('scroll',()=>{if(isOpen)place();},{passive:true});
 apply();
}
let originalTempo=120,lastPosition=null,scrubbing=false,bpmDraft=null,tempoTimer;
const fmt=ms=>{const s=Math.max(0,Math.floor((ms||0)/1000));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
function syncPace(){
 const speed=api.playbackSpeed||1,selector=$('speed-select');
 if(!Array.from(selector.options).some(o=>Math.abs(Number(o.value)-speed)<.00001)){
  selector.querySelector('[data-custom]')?.remove();const option=document.createElement('option');option.value=String(speed);option.textContent=Math.round(speed*100)+'%';option.dataset.custom='true';selector.appendChild(option);
 }
 selector.value=Array.from(selector.options).find(o=>Math.abs(Number(o.value)-speed)<.00001)?.value||String(speed);
 if(bpmDraft===null&&document.activeElement!==$('tempo-input'))$('tempo-input').value=String(Math.round(originalTempo*speed*10)/10);
}
function setBar(index){const song=window.studio.score;if(song){$('playback-bar-position').textContent=`${index+1} / ${song.masterBars.length}`;$('playback-bar-position').setAttribute('aria-label',`Bar ${index+1} of ${song.masterBars.length}`);}}
function syncSong(){const song=window.studio.score;if(!song)return;syncCover();$('player-artist').textContent=song.artist||'';if(!lastPosition)originalTempo=song.tempo||120;syncPace();if(!lastPosition)setBar(0);}
if(params.has('preview')){$('back-library').hidden=window.self!==window.top;$('lesson-badge').textContent='Private preview';}
$('track-mix-panel').addEventListener('toggle',e=>{$('open-mixer').setAttribute('aria-expanded',String(e.newState==='open'));});
document.addEventListener('fullscreenchange',()=>{const label=document.fullscreenElement?'Exit fullscreen':'Fullscreen';$('btn-fullscreen').setAttribute('aria-label',label);$('btn-fullscreen').title=label;});
$('btn-loop').addEventListener('click',()=>{const enabled=$('btn-loop').getAttribute('aria-pressed')==='true';$('repeat-range').hidden=!enabled;$('btn-loop').setAttribute('aria-expanded',String(enabled));});
function syncRepeat(){const enabled=$('btn-loop').getAttribute('aria-pressed')==='true';$('edit-repeat-range').hidden=!enabled;$('edit-repeat-range').textContent=$('loop-start').value+'–'+$('loop-end').value;}
new MutationObserver(syncRepeat).observe($('btn-loop'),{attributes:true,attributeFilter:['aria-pressed']});
for(const id of ['loop-start','loop-end']){for(const event of ['input','change'])$(id).addEventListener(event,syncRepeat);}
$('edit-repeat-range').addEventListener('click',()=>{$('repeat-range').hidden=!$('repeat-range').hidden;$('btn-loop').setAttribute('aria-expanded',String(!$('repeat-range').hidden));});
$('close-range').addEventListener('click',()=>{$('repeat-range').hidden=true;$('btn-loop').setAttribute('aria-expanded','false');});
document.addEventListener('click',e=>{if(!e.target.closest('.repeat-wrap')){$('repeat-range').hidden=true;$('btn-loop').setAttribute('aria-expanded','false');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('repeat-range').hidden=true;$('btn-loop').setAttribute('aria-expanded','false');}});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.close();}});
$('speed-select').addEventListener('change',syncPace);
function applyTempo(){
 clearTimeout(tempoTimer);const requested=bpmDraft??Number($('tempo-input').value);bpmDraft=null;
 if(!Number.isFinite(requested)||requested<20||requested>400){syncPace();return;}
 api.playbackSpeed=Math.max(.125,Math.min(3,requested/(originalTempo||120)));syncPace();
}
$('tempo-input').addEventListener('input',()=>{bpmDraft=Number($('tempo-input').value);clearTimeout(tempoTimer);tempoTimer=setTimeout(applyTempo,350);});
$('tempo-input').addEventListener('change',applyTempo);
$('tempo-input').addEventListener('blur',syncPace);
$('tempo-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyTempo();$('tempo-input').blur();}});
const seek=$('seek-position');
seek.addEventListener('pointerdown',()=>{scrubbing=true;});
for(const event of ['pointerup','pointercancel','blur'])seek.addEventListener(event,()=>{scrubbing=false;});
seek.addEventListener('input',()=>{if(!lastPosition?.endTick)return;const fraction=Number(seek.value)/1000;api.tickPosition=Math.round(lastPosition.endTick*fraction);seek.style.setProperty('--position',fraction*100+'%');api.scrollToCursor();});
// Speed trainer: each completed repeat of the section nudges the speed up toward 100%.
function trainerStep(previous,e){
 const range=api.playbackRange;if(!$('speed-trainer').checked||!api.isLooping||!range||!previous||scrubbing||api.playerState!==1)return;
 const span=range.endTick-range.startTick,wrapped=previous.currentTick>=range.endTick-span*.25&&e.currentTick<=range.startTick+span*.25;
 if(!wrapped||api.playbackSpeed>=1)return;
 api.playbackSpeed=Math.min(1,Math.round((api.playbackSpeed+.05)*100)/100);syncPace();
 const toast=$('toast');toast.textContent=`Speed ${Math.round(api.playbackSpeed*100)}%`;toast.classList.remove('error');toast.classList.add('visible');clearTimeout(trainerStep.timer);trainerStep.timer=setTimeout(()=>toast.classList.remove('visible'),1600);
}
$('speed-trainer').addEventListener('change',()=>{if($('speed-trainer').checked&&api.playbackSpeed>=1){api.playbackSpeed=.6;syncPace();}});
api.playerPositionChanged.on(e=>{trainerStep(lastPosition,e);const played=window.ScoreModel.playbackBarAt(api.tickCache?.masterBars||[],e.currentTick);if(played)setBar(played.masterBar.index);lastPosition=e;if(e.originalTempo>0)originalTempo=e.originalTempo;syncPace();if(!scrubbing){const progress=e.endTick>0?Math.max(0,Math.min(1,e.currentTick/e.endTick)):0;seek.value=String(Math.round(progress*1000));seek.style.setProperty('--position',progress*100+'%');}seek.setAttribute('aria-valuetext',fmt(e.currentTime)+' of '+fmt(e.endTime));});
api.scoreLoaded.on(song=>{lastPosition=null;originalTempo=song.tempo||120;bpmDraft=null;syncPace();setBar(0);});
// alphaTab snaps pause to the beat's first occurrence, even on a later repeat pass.
api.playerStateChanged.on(e=>{if(e.state===0&&!e.stopped&&lastPosition)api.tickPosition=lastPosition.currentTick;});
api.beatMouseDown.on(beat=>setBar(beat.voice.bar.index));
$('btn-stop').addEventListener('click',()=>{if(api.isLooping&&api.playbackRange){api.tickPosition=api.playbackRange.startTick;setBar(Math.max(0,Number($('loop-start').value)-1));}else setBar(0);});
api.renderFinished.on(()=>{syncSong();syncRepeat();});

// While Repeat is on, clicking a bar loops it and the hovered bar is outlined. With Repeat off, clicks just move the playhead.
(function(){
 const host=$('alphatab');if(!host)return;
 const hover=document.createElement('div'),tip=document.createElement('span');if(typeof hover.appendChild!=='function'||typeof host.addEventListener!=='function'||typeof host.querySelectorAll!=='function')return;hover.className='bar-hover';hover.hidden=true;tip.className='bar-hover-tip';hover.appendChild(tip);
 function boxes(){const surface=host.querySelector('.at-surface'),lookup=api.renderer?.boundsLookup;return surface&&lookup?{surface,list:lookup.staffSystems.flatMap(system=>system.bars)}:null;}
 function barAt(e){const b=boxes();if(!b)return null;const r=b.surface.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;return b.list.find(m=>{const c=m.realBounds;return x>=c.x&&x<=c.x+c.w&&y>=c.y&&y<=c.y+c.h;})||null;}
 function place(node,m,b){const c=m.realBounds;node.style.cssText=`left:${b.surface.offsetLeft+c.x}px;top:${b.surface.offsetTop+c.y}px;width:${c.w}px;height:${c.h}px`;}
 function looping(){return $('btn-loop').getAttribute('aria-pressed')==='true';}
 function range(){return [Number($('loop-start').value)-1,Number($('loop-end').value)-1];}
 function whole(){const [a,z]=range();return a<=0&&z>=(window.studio?.score?.masterBars.length||1)-1;}
 let picked=false,hint=null;
 function drawLoop(){host.querySelectorAll('.loop-mark').forEach(n=>n.remove());const on=looping(),showMarks=on&&(picked||!whole());if(!on)picked=false;
  if(on&&!showMarks){if(!hint){hint=document.createElement('p');hint.className='bar-hint';hint.textContent='Select the measure you want to repeat';document.body.appendChild(hint);}}else if(hint){hint.remove();hint=null;}
  const b=boxes();if(!b||!showMarks)return;const [a,z]=range(),frag=document.createDocumentFragment();
  for(const m of b.list){if(m.index<a||m.index>z)continue;const n=document.createElement('div');n.className='loop-mark';place(n,m,b);frag.appendChild(n);}host.appendChild(frag);}
 host.addEventListener('pointermove',e=>{const m=looping()?barAt(e):null,b=boxes();if(!m||!b){hover.hidden=true;host.classList.remove('bar-clickable');return;}
  tip.textContent=`Click to repeat bar ${m.index+1}`;
  place(hover,m,b);if(hover.parentNode!==host)host.appendChild(hover);hover.hidden=false;host.classList.add('bar-clickable');});
 host.addEventListener('pointerleave',()=>{hover.hidden=true;});
 let down=null;
 host.addEventListener('pointerdown',e=>{down=e.button===0&&looping()?{x:e.clientX,y:e.clientY,bar:barAt(e)}:null;});
 host.addEventListener('pointerup',e=>{const start=down;down=null;if(!start?.bar||Math.hypot(e.clientX-start.x,e.clientY-start.y)>6)return;
  const bar=start.bar.index,[a,z]=range();hover.hidden=true;picked=true;
  if(a===bar&&z===bar){drawLoop();return;}
  $('loop-start').value=bar+1;$('loop-end').value=bar+1;for(const id of ['loop-start','loop-end'])for(const type of ['input','change'])$(id).dispatchEvent(new Event(type,{bubbles:true}));
  setTimeout(drawLoop,0);});
 const redraw=()=>setTimeout(drawLoop,0);
 api.renderFinished.on(redraw);new MutationObserver(redraw).observe($('btn-loop'),{attributes:true,attributeFilter:['aria-pressed']});
 for(const id of ['loop-start','loop-end'])for(const type of ['input','change'])$(id).addEventListener(type,redraw);
})();

// After picking something, leave the control so Space plays and pauses instead of reopening it.
(function(){
 let mouse=false;if(typeof document.addEventListener!=='function')return;
 document.addEventListener('pointerdown',()=>{mouse=true;},true);document.addEventListener('keydown',()=>{mouse=false;},true);
 document.addEventListener('change',e=>{if(mouse&&e.target.matches?.('select,input[type=checkbox],input[type=range]'))e.target.blur();});
 document.addEventListener('click',e=>{const b=e.target.closest?.('button');if(b&&e.detail>0)setTimeout(()=>{if(document.activeElement===b)b.blur();},0);});
})();

})();
