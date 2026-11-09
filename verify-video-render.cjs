// Real alphaTab layout + MIDI regressions; synthesis uses a silent sink, never speakers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const at = require('./public/editor/vendor/alphaTab.js');
const nodes = new Map();
const element = id => {
  if (!nodes.has(id)) nodes.set(id, {value: {'opt-format':'wide','opt-staff':'tab','opt-theme':'light','opt-track':'0','opt-length':'full'}[id], disabled:false, hidden:true, style:{}, classList:{toggle(){}}, getContext(){return new Proxy({}, {get:(_,key)=>key==='measureText'?()=>({width:0}):key==='createLinearGradient'?()=>({addColorStop(){}}):()=>{}});}});
  return nodes.get(id);
};
const context = vm.createContext({window:{alphaTab:{...at}},document:{getElementById:element},location:{search:'',hostname:'example.test',href:'https://example.test/editor/video.html'},URL,URLSearchParams,console,Set,Map,Float32Array,Uint8Array,Math,Promise,MessageChannel:class{port1={};port2={postMessage(){}};}});
const source = fs.readFileSync('public/editor/video-export.js','utf8');
vm.runInContext(source.replace('  start();', `window.testVideo={prepareVideoScore,xForTick,tickAt,renderAudio,rerender,songSeconds,createApi,collectPartials,waitForEncoder,getPartials(){return partials;},
  setApi(value){api=value;}, setScore(value){score=value;lesson={title:'Regression'};}, ready(){playerReady=true;},
  setPartials(value){partials=value;strip={w:4000,h:400};}, setRender(value){renderScore=value;},
  setCancelled(value){cancelled=value; if(value)cancelWaiters.splice(0).forEach(fn=>fn());},
  isBusy(){return busy;}, exportVideo};`), context);
const video = context.window.testVideo;
function setup(tex, {track=0,scale=4.2,profile=at.StaveProfile.Tab,grouped=false}={}) {
  const settings=new at.Settings();settings.core.engine='svg';settings.core.enableLazyLoading=false;
  settings.display.layoutMode=at.LayoutMode.Horizontal;settings.display.staveProfile=profile;settings.display.scale=scale;settings.display.barCountPerPartial=3;
  const score=at.importer.ScoreLoader.loadAlphaTex(tex,settings);
  score.stylesheet.perTrackMultiBarRest=grouped?new Set([track]):null;
  video.prepareVideoScore(score);
  const renderer=new at.rendering.ScoreRenderer(settings);renderer.width=4000;
  renderer.error.on(error=>{throw error;});renderer.renderScore(score,[track]);
  const midi=new at.midi.MidiFile(), generator=new at.midi.MidiFileGenerator(score,settings,new at.midi.AlphaSynthMidiFileHandler(midi));generator.generate();
  const api={tickCache:generator.tickLookup,boundsLookup:renderer.boundsLookup};
  video.setApi(api);video.setScore(score);
  return {score,settings,renderer,midi,api,track};
}
function checkPath(fixture) {
  const {api,track}=fixture;let previousIndex=-1,previousX=-Infinity;
  for(const bar of api.tickCache.masterBars) {
    const bounds=api.boundsLookup.findMasterBarByIndex(bar.masterBar.index);
    let first;
    for(let tick=bar.start;tick<bar.end;tick+=120) {
      const x=video.xForTick(tick,track);
      assert.ok(Number.isFinite(x) && x>0,`bar ${bar.masterBar.index}: valid position through silence`);
      if(first===undefined)first=x;
      if(bar.masterBar.index>=previousIndex)assert.ok(x>=previousX-.001,`no rewind except written repeats: ${x} < ${previousX}`);
      assert.ok(x>=bounds.realBounds.x && x<=bounds.realBounds.x+bounds.realBounds.w+500,'cursor stays near played bar');
      previousX=x;previousIndex=bar.masterBar.index;
    }
    assert.ok(previousX>first,`bar ${bar.masterBar.index} keeps moving`);
  }
  const final=api.tickCache.masterBars.at(-1), bounds=api.boundsLookup.findMasterBarByIndex(final.masterBar.index);
  assert.equal(video.xForTick(final.end+960,track),bounds.realBounds.x+bounds.realBounds.w,'tail stays at end, never restarts');
}
(async()=>{
  const signal=()=>({on(fn){this.fn=fn;},trigger(value){this.fn?.(value);}});
  let fake;
  context.window.alphaTab.AlphaTabApi=class {constructor(){fake=this;this.settings=new at.Settings();this.renderStarted=signal();this.playerReady=signal();this.postRenderFinished=signal();this.error=signal();this.renderer={partialRenderFinished:signal()};}};
  video.createApi();
  fake.renderStarted.trigger();fake.renderer.partialRenderFinished.trigger({firstMasterBarIndex:0,renderResult:{old:true},x:0,y:0,width:4000,height:600});
  video.collectPartials();assert.equal(video.getPartials().length,1);
  fake.renderStarted.trigger();fake.renderer.partialRenderFinished.trigger({firstMasterBarIndex:0,renderResult:{current:true},x:0,y:0,width:2000,height:400});
  fake.renderer.partialRenderFinished.trigger({firstMasterBarIndex:-1,renderResult:{credit:true},x:0,y:400,width:200,height:20});
  video.collectPartials();assert.equal(video.getPartials().length,1,'new render excludes old canvases and credit tiles');assert.equal(video.getPartials()[0].el.current,true);assert.equal(video.getPartials()[0].w,2000);
  const tex='\\tempo 120 . r.1 | r.1 | 3.3.4 r.4 5.3.4 r.4 | . | \\ro 7.3.4 5.3.4 3.3.4 2.3.4 | \\rc 2 r.1 | \\simile Simple . | r.1 | 3.3.1';
  for(const scale of [1.7,2.2,2.5,2.8,3.6,4.2])for(const profile of [at.StaveProfile.Tab,at.StaveProfile.ScoreTab]) {
    const fixture=setup(tex,{scale,profile,grouped:true});checkPath(fixture);
    assert.equal(fixture.score.stylesheet.perTrackMultiBarRest.size,0,'imported grouped rests expanded');
    const bar=fixture.api.tickCache.masterBars[2], beat=fixture.score.tracks[0].staves[0].bars[2].voices[0].beats[0];
    assert.equal(video.xForTick(bar.start,0),fixture.api.boundsLookup.findBeat(beat).onNotesX,'playhead aligns with fret center');
    // Player initialization can regenerate MIDI after the first preview.
    const next=new at.midi.MidiFileGenerator(fixture.score,fixture.settings,new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile()));next.generate();fixture.api.tickCache=next.tickLookup;
    assert.equal(video.xForTick(bar.start,0),fixture.api.boundsLookup.findBeat(beat).onNotesX,'stale beat hints cannot move cursor to bar edge');
  }
  checkPath(setup(Array(35).fill('3.3.4 r.2 5.3.4').join(' | ')));
  checkPath(setup('\\track "Guitar" . r.1 | . | 3.3.1 | r.1 \\track "Bass" \\tuning G2 D2 A1 E1 . 3.3.1 | 5.3.1 | 7.3.1 | 3.3.1'));
  checkPath(setup('r.1 | r.1 | r.1'));
  checkPath(setup('3.3.4 5.3.4 7.3.4 9.3.4 | \\simile Simple . | \\simile Simple . | r.1'));
  checkPath(setup('\\ro 3.3.1 | \\ae 1 \\rc 2 r.1 | \\ae 2 5.3.1 | r.1'));
  checkPath(setup('\\track \"Piano\" \\staff{score} . c4.1 | r.1 | e4.1',{profile:at.StaveProfile.Default}));
  setup('\\tempo 120 . 3.3.1 | \\tempo 60 r.1');
  assert.equal(video.songSeconds(),6,'preview clock includes tempo changes');
  const fixture=setup(tex,{grouped:true});
  assert.equal(video.songSeconds(),22,'preview clock includes repeats');
  const simile=fixture.score.tracks[0].staves[0].bars[6].voices[0].beats[0];
  assert.equal(simile.style.colors.get(at.model.BeatSubElement.GuitarTabRests).rgba,'rgba(0,0,0,0)','simile placeholder cannot overlap repeat symbol');
  const event=()=>({on(){},trigger(){}});
  const sink={sampleRate:44100,ready:event(),samplesPlayed:event(),sampleRequest:event(),open(){},play(){},pause(){},destroy(){},addSamples(){},resetSamples(){},activate(){}};
  // Cancelling while the instruments are still loading must abort the export, not hang on "Loading instruments…".
  const waiting = video.renderAudio(30);
  video.setCancelled(true);
  await assert.rejects(waiting, /cancelled/);
  video.setCancelled(false);
  const synth=new at.synth.AlphaSynth(sink,500);
  try {
    synth.loadMidiFile(fixture.midi);
    synth.loadSoundFont(new Uint8Array(fs.readFileSync('public/editor/vendor/soundfont/GeneralUser-GS.sf3')),false);
    fixture.api.exportAudio=options=>synth.exportAudio(options,fixture.midi,[],new Map());
    video.ready();
    const audio=await video.renderAudio(30);
    assert.ok(Math.abs(audio.frames/44100-22)<.1,'repeated bars and silence retain full duration');
    assert.equal(audio.cutShort,false,'a song that plays to its end keeps its own decay');
    const hint={i:0};let prev=-Infinity;
    for(let seconds=0;seconds<21.9;seconds+=1/30){const tick=video.tickAt(audio.map,seconds,hint);assert.ok(tick>=prev,'offline clock never rewinds in silence/repeats');prev=tick;assert.ok(Math.abs(tick-seconds*1920)<30,'audio/video sync stays within a frame');}
  } finally {synth.destroy();}
  // Only a length-limited cut fades its tail; a natural ending is untouched. Stubbed
  // exporter with known samples (the bundled node synth renders silence, timing only).
  const fakeExporter = chunks => {
    let i = 0;
    return {render: async ms => {
      if (i >= chunks) return null;
      const start = i++;
      return {samples: new Float32Array(4410 * 2).fill(.5), currentTime: start * 100, endTime: chunks * 100, currentTick: (start + 1) * 192};
    }, destroy(){}};
  };
  fixture.api.exportAudio = () => Promise.resolve(fakeExporter(10));
  const whole = await video.renderAudio(30);
  assert.equal(whole.cutShort, false);
  assert.ok(whole.pcm.every(v => v === .5), 'natural ending is not faded');
  fixture.api.exportAudio = () => Promise.resolve(fakeExporter(100));
  const cut = await video.renderAudio(5);
  assert.equal(cut.cutShort, true, 'length limit cuts the audio short');
  assert.equal(cut.frames, 5 * 44100, 'cut keeps only the requested audio');
  assert.equal(cut.pcm[0], .5, 'cut keeps the head untouched');
  assert.ok(Math.abs(cut.pcm[(cut.frames - 11025) * 2] - .25) < .01, 'cut fades the last half second');
  assert.equal(cut.pcm[(cut.frames - 1) * 2], 0, 'cut fades the tail to zero');
  assert.equal(cut.pcm[(cut.frames - 1) * 2 + 1], 0, 'cut fades the tail to zero');
  // A stalled video encoder must not swallow cancellation.
  video.setCancelled(true);
  await Promise.race([video.waitForEncoder({encodeQueueSize: 99, ondequeue: null, addEventListener(){}, removeEventListener(){}}, 8),
    new Promise((_, reject) => setTimeout(() => reject(Error('waitForEncoder ignored cancel')), 1000))]);
  video.setCancelled(false);
  // Two option changes while the first render is pending must never overlap.
  let running=0,maxRunning=0,calls=0,release;
  video.setRender(async()=>{calls++;maxRunning=Math.max(maxRunning,++running);if(calls===1)await new Promise(r=>release=r);running--;return true;});
  video.setPartials([{el:{},x:0,y:0,w:4000,h:400}]);
  const first=video.rerender();await Promise.resolve();await Promise.resolve();
  const second=video.rerender(),third=video.rerender();
  assert.equal(element('export').disabled,true,'export locked while geometry changes');
  await video.exportVideo();assert.equal(video.isBusy(),false,'cannot start export during a redraw');
  release();await Promise.all([first,second,third]);assert.equal(maxRunning,1);assert.equal(calls,2,'skip superseded render');assert.equal(element('export').disabled,false);
  video.setRender(async()=>{throw Error('render failed');});await video.rerender();assert.equal(element('export').disabled,true,'failed render cannot export stale geometry');
  console.log('PASS: video rests, empty/simile bars, repeats, end position, fret alignment, all format scales, multi-tile layout, silent offline sync, load-cancel, cut-only fade and render races.');
})().catch(e=>{console.error(e);process.exitCode=1;});
