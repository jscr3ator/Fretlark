const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const at=require('./public/editor/vendor/alphaTab.js'),M=require('./public/editor/model.js');
const app=fs.readFileSync('public/editor/app.js','utf8');
const score=M.createScore(),track=score.tracks[0],pos={track:0,staff:0,bar:0,voice:0,beat:0,note:0};
M.setNote(score,pos,{string:1,fret:5});track.playbackInfo.volume=8;
const context=vm.createContext({isViewer:true});
vm.runInContext(app.slice(app.indexOf('  const practiceVolumes='),app.indexOf('  const $ =')),context);
assert.equal(context.trackMixVolume(track),1,'Viewer starts at the original MIDI level rather than reducing it again');
vm.runInContext('practiceVolumes.set(0,1.5)',context);assert.equal(context.trackMixVolume(track),1.5);
context.isViewer=false;assert.equal(context.trackMixVolume(track),.5,'Editor volume behavior is unchanged');
context.isViewer=true;
let binding,applied,output={textContent:''};
const input={value:'150',nextElementSibling:output,matches:s=>s==='.mix-volume',setAttribute(name,value){this[name]=value;},closest:()=>({dataset:{track:'0'}})};
Object.assign(context,{score,listen(id,event,fn){binding=fn;},api:{changeTrackVolume(tracks,gain){applied={tracks,gain};}},clamp:(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0))});
vm.runInContext(app.split('\n').find(line=>line.includes("listen('track-list','input'")),context);
binding({target:input});assert.equal(applied.gain,1.5);assert.equal(output.textContent,'150%');assert.equal(input['aria-valuetext'],'150 percent of original level');
assert.equal(track.playbackInfo.volume,8,'Student practice gain cannot overwrite authored track volume');
input.value='0';binding({target:input});assert.equal(applied.gain,0);
input.value='200';binding({target:input});assert.equal(applied.gain,2);
vm.runInContext('practiceVolumes.clear()',context);assert.equal(context.trackMixVolume(track),1);

// Audio is synthesized into memory only. Compare the native file level with the old extra attenuation.
const event=()=>({listeners:[],on(fn){this.listeners.push(fn);},trigger(v){for(const fn of this.listeners)fn(v);}});
const sink={sampleRate:44100,ready:event(),samplesPlayed:event(),sampleRequest:event(),open(){this.ready.trigger();},play(){},pause(){},destroy(){},addSamples(){},resetSamples(){},activate(){}};
const synth=new at.synth.AlphaSynth(sink,100);
try{
 const bank=new Uint8Array(fs.readFileSync('public/editor/vendor/soundfont/GeneralUser-GS.sf3'));
 const midi=new at.midi.MidiFile();new at.midi.MidiFileGenerator(score,new at.Settings(),new at.midi.AlphaSynthMidiFileHandler(midi)).generate();synth.loadMidiFile(midi);synth.loadSoundFont(bank,false);
 const render=gain=>{const options=new at.synth.AudioExportOptions();options.sampleRate=44100;options.masterVolume=.75;options.trackVolume.set(track.playbackInfo.primaryChannel,gain);options.trackVolume.set(track.playbackInfo.secondaryChannel,gain);const exporter=synth.exportAudio(options,midi,[],new Map());const samples=exporter.render(2500).samples;let peak=0,energy=0;for(const n of samples){assert.ok(Number.isFinite(n));peak=Math.max(peak,Math.abs(n));energy+=n*n;}return {peak,rms:Math.sqrt(energy/samples.length)};};
 const old=render(.5),original=render(1),boosted=render(1.5),off=render(0);
 assert.ok(original.rms>.0001);assert.ok(Math.abs(original.rms/old.rms-2)<.01,'Removing double attenuation restores the file level');
 assert.ok(Math.abs(boosted.rms/original.rms-1.5)<.01,'Practice gain is linear and independently adjustable');assert.equal(off.peak,0);
 assert.ok(boosted.peak<1,'Representative single-track fixture does not clip at 150%');
 console.log(`PASS: original track volume preserved; viewer 0–200% gain, slider labels and zero output; removing duplicate attenuation measured +${(20*Math.log10(original.rms/old.rms)).toFixed(2)} dB at saved level 8/16. No audio device opened.`);
}finally{synth.destroy();}

async function verifySolo(){
 // Exercise the real async balance path, including cancellation, cached gains and cleanup.
 let destroyed=0,exports=0,optionsSeen;
 Object.assign(context,{setTimeout,toast(){throw Error('Unexpected solo balance failure');},api:{isReadyForPlayback:true,tickCache:{getMasterBarStart:()=>0},changeTrackVolume(tracks,gain){applied={tracks,gain};},async exportAudio(options){exports++;optionsSeen=options;return {async render(){return {samples:new Float32Array([.01,-.01])};},destroy(){destroyed++;}};}},at});
 vm.runInContext(app.slice(app.indexOf('  function applyPracticeMix(){'),app.indexOf('  function syncPlaybackMix(){')),context);
 let delivered;
 context.api.player={output:{addSamples(samples){delivered=samples;}}};
 context.installSoloLimiter();context.installSoloLimiter();
 track.playbackInfo.isSolo=false;context.api.player.output.addSamples(new Float32Array([.2,1.3]));assert.ok(delivered[1]>1,'Full mix bypasses solo limiter');
 track.playbackInfo.isSolo=true;context.api.player.output.addSamples(new Float32Array([.2,1.3,-1.3,NaN]));assert.equal(delivered[0],Math.fround(.2));assert.ok(delivered[1]<1&&delivered[2]>-1);assert.equal(delivered[3],0);
 track.playbackInfo.isSolo=true;await context.balanceSoloLevels();
 assert.ok(Math.abs(context.trackPlaybackVolume(track)-7.5)<1e-5,'Quiet solo receives measured gain');
 assert.equal(optionsSeen.masterVolume,1,'Analysis cannot depend on master volume or silent diagnostics');
 assert.equal(optionsSeen.trackVolume.get(0),1);assert.equal(optionsSeen.playbackRange.startTick,0);
 assert.equal(destroyed,1);await context.balanceSoloLevels();assert.equal(exports,1,'Measured tracks are cached');
 input.value='200';binding({target:input});assert.ok(Math.abs(applied.gain-15)<1e-5,'Slider retains full range with solo compensation');
 input.value='0';binding({target:input});assert.equal(applied.gain,0,'Zero stays silent during solo');
 track.playbackInfo.isSolo=false;input.value='100';binding({target:input});assert.equal(applied.gain,1,'Leaving solo restores full mix exactly');
 assert.equal(context.soloLevelGain(.8,.2),1,'Already loud instruments are never boosted');
 assert.equal(context.soloLevelGain(0,0),1,'Silent tracks cannot receive extreme gain');
 assert.ok(Math.abs(context.soloLevelGain(.1,.001)-3.5)<1e-10,'Peak headroom caps quiet transient-heavy tracks');
 track.playbackInfo.isSolo=true;const second=M.addTrack(score,'Second guitar');second.playbackInfo.isSolo=true;
 assert.ok(Math.abs(context.trackPlaybackVolume(track)-7.5/Math.sqrt(2))<1e-5,'Multiple solos share gain headroom');second.playbackInfo.isMute=true;
 assert.ok(Math.abs(context.trackPlaybackVolume(track)-7.5)<1e-5,'Muted solos do not reduce audible solo gain');
 track.playbackInfo.isSolo=false;second.playbackInfo.isSolo=false;
 vm.runInContext('soloLevels.delete(score.tracks[0])',context);
 context.api.exportAudio=async()=>({async render(){track.playbackInfo.isSolo=false;return {samples:new Float32Array([.01,-.01])};},destroy(){destroyed++;}});
 track.playbackInfo.isSolo=true;await context.balanceSoloLevels();assert.equal(context.trackPlaybackVolume(track),1,'Cancelled analysis cannot change restored mix');assert.equal(destroyed,2);
 // Real imported song and both deployed banks, synthesized into memory only.
 const reference=at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(Buffer.from(fs.readFileSync('lib/reference-score.mjs','utf8').split("'")[1],'base64')));
 for(const bankName of ['GeneralUser-GS.sf3','sonivox.sf3']){
  const engine=new at.synth.AlphaSynth(sink,100);
  try{
   const midi=new at.midi.MidiFile();new at.midi.MidiFileGenerator(reference,new at.Settings(),new at.midi.AlphaSynthMidiFileHandler(midi)).generate();engine.loadMidiFile(midi);engine.loadSoundFont(new Uint8Array(fs.readFileSync('public/editor/vendor/soundfont/'+bankName)),false);
   const riff=reference.tracks.find(track=>/main riff/i.test(track.name));
   function render(gain,milliseconds,master=1){const options=new at.synth.AudioExportOptions();options.sampleRate=44100;options.masterVolume=master;for(const t of reference.tracks){const v=t===riff?gain:0;options.trackVolume.set(t.playbackInfo.primaryChannel,v);options.trackVolume.set(t.playbackInfo.secondaryChannel,v);}const exporter=engine.exportAudio(options,midi,[],new Map());let energy=0,peak=0,count=0;for(let elapsed=0;elapsed<milliseconds;elapsed+=100){const chunk=exporter.render(100);if(!chunk)break;if(gain>1)context.limitSoloSamples(chunk.samples);for(const sample of chunk.samples){assert.ok(Number.isFinite(sample));energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}count+=chunk.samples.length;}return {peak,rms:Math.sqrt(energy/count)};}
   const original=render(1,8000),gain=context.soloLevelGain(original.peak,original.rms),solo=render(gain,8000),max=render(gain*2,300000);
   assert.ok(gain>=1,'Solo balancing never attenuates the reference riff');assert.ok(solo.rms>=original.rms,'Solo output keeps at least the original energy');assert.ok(max.peak<1,'Entire reference riff remains unclipped at 200% and master 100%');
   console.log(`PASS: ${bankName} real main riff solo +${(20*Math.log10(gain)).toFixed(1)} dB; reference riff peak at 200% / master 100% ${max.peak.toFixed(3)}.`);
  }finally{engine.destroy();}
 }
 console.log('PASS: solo balancing, cache, slider, zero, mute, multi-solo, cancellation and restored full mix. No audio device opened.');
}
verifySolo().catch(error=>{console.error(error);process.exitCode=1;});
