const assert=require('node:assert/strict'),fs=require('node:fs');
const at=require('./public/editor/vendor/alphaTab.js'),M=require('./public/editor/model.js');
let bank;
const score=M.createScore(),midi=new at.midi.MidiFile();
new at.midi.MidiFileGenerator(score,new at.Settings(),new at.midi.AlphaSynthMidiFileHandler(midi)).generate();
const event=()=>({listeners:[],on(fn){this.listeners.push(fn);},trigger(value){for(const fn of this.listeners)fn(value);}});
function render(metronome,countIn,change){
 let batch=[],chunks=[],frames=0;
 // No audio device: synthesized samples are measured in memory and discarded.
 const sink={sampleRate:44100,ready:event(),samplesPlayed:event(),sampleRequest:event(),open(){this.ready.trigger();},play(){},pause(){},destroy(){},resetSamples(){},activate(){},addSamples(samples){batch.push(samples);chunks.push(samples);}};
 const synth=new at.synth.AlphaSynth(sink,100);
 try{
  synth.loadMidiFile(midi);synth.loadSoundFont(bank,false);synth.masterVolume=.75;synth.metronomeVolume=metronome;synth.countInVolume=countIn;synth.play();
  let changed=false;
  for(let i=0;i<1500&&synth.state===1;i++){
   if(change&&!changed&&frames/44100>=change.at){synth.metronomeVolume=change.volume;changed=true;}
   batch=[];sink.sampleRequest.trigger();for(const samples of batch){frames+=samples.length/2;sink.samplesPlayed.trigger(samples.length/2);}
  }
  assert.equal(synth.state,0,'Playback finishes instead of sticking in count-in');
  const peak=(start=0,end=Infinity)=>{let frame=0,result=0;for(const samples of chunks)for(let i=0;i<samples.length;i+=2){const t=frame++/44100;if(t>=start&&t<end)result=Math.max(result,Math.abs(samples[i]),Math.abs(samples[i+1]));}return result;};
  return {seconds:frames/44100,peak:peak(),early:peak(0,.8),late:peak(2.6),volume:synth.metronomeVolume};
 }finally{synth.destroy();}
}
for(const bankName of ['FluidR3Mono_GM.sf3','sonivox.sf3']){
 bank=new Uint8Array(fs.readFileSync('public/editor/vendor/soundfont/'+bankName));
const off=render(0,0),metro=render(.6,0),count=render(0,.7),both=render(.6,.7),disabled=render(.6,0,{at:2,volume:0}),enabled=render(0,0,{at:1,volume:.6});
assert.equal(off.peak,0,'Both off produces no clicks on a rest-only score');
assert.ok(metro.early>.001&&metro.late>.001,'Metronome clicks throughout playback');
assert.ok(count.early>.001);assert.equal(count.late,0,'Count-in is silent after its one-bar introduction');
assert.ok(Math.abs(count.seconds-off.seconds-2)<.02,'4/4 at 120 BPM adds one 2-second bar');
assert.ok(both.early>.001&&both.late>.001);assert.ok(Math.abs(both.seconds-count.seconds)<.02);
assert.ok(disabled.early>.001);assert.equal(disabled.late,0,'Turning metronome off during playback silences later clicks');assert.equal(disabled.volume,0);
assert.equal(enabled.early,0);assert.ok(enabled.late>.001,'Turning metronome on during playback begins clicks');
}
console.log('PASS: both SoundFonts; offline sample measurement confirms metronome on/off, live toggles and one-bar count-in; no audio device opened.');
