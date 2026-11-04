const assert = require('node:assert/strict');
const fs = require('node:fs');
const a = require('./public/editor/vendor/alphaTab.js');
const M = require('./public/editor/model.js');
const settings = new a.Settings();
const read = data => a.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(data));
const original = read(Buffer.from(require('fs').readFileSync('lib/reference-score.mjs','utf8').split("'")[1], 'base64'));
const exported = read(new a.exporter.Gp7Exporter().export(original));
assert.deepEqual([exported.title,exported.artist,exported.tempo,exported.tracks.length,exported.masterBars.length],['Knives Out','Radiohead',138,8,142]);
// Editing a real imported note must survive the same consolidate/export/reopen path as library saves.
let importedEdit = M.restore(M.snapshot(original));
const importedPos = {track:2,staff:0,bar:0,voice:0,beat:1,note:0};
const importedNote = M.beatAt(importedEdit,importedPos).notes[0];
M.setNote(importedEdit,importedPos,{string:importedEdit.tracks[2].staves[0].tuning.length+1-importedNote.string,fret:5});
importedEdit = M.consolidate(importedEdit);
assert.equal(M.beatAt(read(new a.exporter.Gp7Exporter().export(importedEdit,settings)),importedPos).notes[0].fret,5,'Imported note edit survives save/reopen');
assert.ok(M.snapshot(original).length < 1000000, 'History and autosave must fit reasonably in browser storage');
assert.deepEqual(M.loopBounds(4, 2, 8), [4, 4]);
assert.deepEqual(M.loopBounds(-3, 99, 8), [1, 8]);
assert.deepEqual(M.loopBounds(3.8, 5.9, 8), [3, 5]);
let score = M.createScore();
const pos = {track:0,staff:0,bar:0,voice:0,beat:0,note:0};
const before = M.snapshot(score);
// Explicit edits of tied destinations must survive consolidation and GP save/reopen.
let tied = M.createScore();
const tiedPos = {...pos,beat:1}, sustainedPos = {...pos,beat:2};
M.setNote(tied,pos,{string:1,fret:4});
M.setNote(tied,tiedPos,{string:1,fret:4,tie:true,isPalmMute:true});
M.setNote(tied,sustainedPos,{string:1,fret:4,tie:true});
tied = M.consolidate(tied);
const tiedBefore = M.snapshot(tied);
M.setNote(tied,tiedPos,{string:1,fret:4,isStaccato:true});
assert.equal(M.beatAt(M.consolidate(tied),tiedPos).notes[0].isTieDestination,true,'No-op pitch/effect edits preserve ties');
M.setNote(tied,tiedPos,{string:1,fret:12});
assert.equal(M.beatAt(tied,pos).notes[0].tieDestination,null,'Old origin no longer points to the edited note');
for (const edited of [tied,M.consolidate(tied),read(new a.exporter.Gp7Exporter().export(M.consolidate(tied)))]) {
  const note = M.beatAt(edited,tiedPos).notes[0];
  assert.equal(note.fret,12);
  assert.equal(note.isTieDestination,false);
  assert.equal(note.tieOrigin,null);
  assert.equal(note.isPalmMute,true);
}
const tiedReopened = read(new a.exporter.Gp7Exporter().export(M.consolidate(tied)));
assert.equal(M.beatAt(tiedReopened,pos).notes[0].fret,4,'Original note unchanged');
assert.equal(M.beatAt(tiedReopened,sustainedPos).notes[0].fret,12,'Following sustain follows edited origin');
assert.equal(M.beatAt(M.restore(tiedBefore),tiedPos).notes[0].isTieDestination,true,'Undo restores original tie');
const untied = M.restore(tiedBefore);
M.setNote(untied,tiedPos,{tie:false});
assert.equal(M.beatAt(M.consolidate(untied),tiedPos).notes[0].tieOrigin,null,'Tie toggle clears serialized links');
const pianoTie = M.createScore();
M.addTrack(pianoTie,'Piano',0,[]);
const pianoPos = {...pos,track:1}, pianoDestination = {...pianoPos,beat:1};
M.setNote(pianoTie,pianoPos,{pitch:60});
M.setNote(pianoTie,pianoDestination,{pitch:60,tie:true});
const pianoLinked = M.consolidate(pianoTie);
M.setNote(pianoLinked,pianoDestination,{pitch:64});
assert.equal(M.beatAt(read(new a.exporter.Gp7Exporter().export(M.consolidate(pianoLinked))),pianoDestination).notes[0].realValue,64);
// Direct edits preserve other strings and effects, while inspector string changes move a note.
let direct = M.createScore();
M.setNote(direct,pos,{string:1,fret:5,bend:4,isPalmMute:true});
M.setNote(direct,pos,{string:2,fret:7});
M.setNote(direct,{...pos,note:0},{string:1,fret:12});
assert.deepEqual(M.beatAt(direct,pos).notes.map(n=>n.fret),[12,7]);
assert.equal(M.beatAt(direct,pos).notes[0].maxBendPoint.value,4);
assert.throws(()=>M.setNote(direct,pos,{string:2,move:true}),/already has a note/);
M.setNote(direct,pos,{string:3,move:true});
direct=M.consolidate(direct);
assert.deepEqual(M.beatAt(direct,pos).notes.map(n=>n.string),[4,5]);
assert.equal(M.beatAt(direct,pos).notes[0].isPalmMute,true);
const restPos={...pos,beat:1};
M.setNote(direct,restPos,{text:'Quiet',move:true});
assert.equal(M.beatAt(direct,restPos).notes.length,0);
assert.equal(M.beatAt(direct,restPos).text,'Quiet');
const directRound=read(new a.exporter.Gp7Exporter().export(direct));
assert.equal(M.beatAt(directRound,pos).notes[0].fret,12);
assert.equal(M.beatAt(directRound,pos).notes[0].maxBendPoint.value,4);
M.setNote(score,pos,{fret:5,string:1,duration:4,bend:4,harmonic:2,slide:1,dynamics:5,lyric:'Hello',chord:'Am',isPalmMute:true});
score = M.consolidate(score);
assert.equal(M.beatAt(score,pos).notes[0].realValue,81); // A4 plus artificial harmonic octave.
assert.equal(M.restore(before).tracks[0].staves[0].bars[0].voices[0].beats[0].notes.length,0);
M.insertBeat(score,pos); score = M.consolidate(score);
assert.equal(M.beatAt(score,pos).voice.calculateDuration(),3840, 'Splitting must preserve measure length');
M.addBar(score); M.addTrack(score,'Piano',0,[]); M.addTrack(score,'Drums',0,[],true);
score = M.consolidate(score);
M.setNote(score,{...pos,track:1},{pitch:60,duration:4});
M.setNote(score,{...pos,track:2},{pitch:38,duration:4});
M.removeBar(score,1); score = M.consolidate(score);
assert.equal(score.masterBars.length,4);
for(const track of score.tracks) assert.equal(track.staves[0].bars.length,4);
const round = read(new a.exporter.Gp7Exporter().export(score));
const editedBeat = M.beatAt(round,pos);
assert.equal(editedBeat.notes[0].fret,5);
assert.equal(editedBeat.notes[0].maxBendPoint.value,4);
assert.equal(editedBeat.chord.name,'Am');
assert.equal(editedBeat.lyrics[0],'Hello');
assert.equal(M.beatAt(round,{...pos,track:1}).notes[0].realValue,60);
assert.equal(M.beatAt(round,{...pos,track:2}).notes[0].realValue,38);
// Written repeats expand MIDI ticks; score offsets after the repeat are not playback positions.
const repeated = M.createScore();
repeated.masterBars[0].isRepeatStart=true; repeated.masterBars[1].repeatCount=2; repeated.rebuildRepeatGroups();
const repeatMidi=new a.midi.MidiFile();
const repeatGenerator=new a.midi.MidiFileGenerator(repeated,settings,new a.midi.AlphaSynthMidiFileHandler(repeatMidi)); repeatGenerator.generate();
const lookup=repeatGenerator.tickLookup, afterRepeat=repeated.tracks[0].staves[0].bars[2].voices[0].beats[0];
assert.deepEqual(lookup.masterBars.map(b=>b.masterBar.index),[0,1,0,1,2,3]);
assert.equal(lookup.getBeatStart(afterRepeat),15360);
assert.equal(lookup.masterBars.at(-1).end,23040);
assert.equal(M.playbackBarAt([],0),null);
for(const bar of lookup.masterBars){
  assert.equal(M.playbackBarAt(lookup.masterBars,bar.start),bar);
  assert.equal(M.playbackBarAt(lookup.masterBars,bar.end-1),bar);
}
assert.equal(M.playbackBarAt(lookup.masterBars,-1),lookup.masterBars[0]);
assert.equal(M.playbackBarAt(lookup.masterBars,23040),lookup.masterBars.at(-1));
const midi = new a.midi.MidiFile(); midi.format=a.midi.MidiFileFormat.MultiTrack;
new a.midi.MidiFileGenerator(round,settings,new a.midi.AlphaSynthMidiFileHandler(midi,true)).generate();
assert.equal(Buffer.from(midi.toBinary().slice(0,4)).toString(),'MThd');
assert.ok(midi.tracks.flatMap(t=>t.events).some(e=>e instanceof a.midi.NoteOnEvent));
// Actual synthesizer + bundled SF3. Output is a headless sink; test generated samples, not physical speakers.
const evt = () => ({listeners:[],on(fn){this.listeners.push(fn)},off(){},trigger(value){this.listeners.forEach(fn=>fn(value))}});
const sink={sampleRate:44100,ready:evt(),samplesPlayed:evt(),sampleRequest:evt(),open(){this.ready.trigger()},play(){},pause(){},destroy(){},addSamples(){},resetSamples(){},activate(){}};
const synth = new a.synth.AlphaSynth(sink,500);
const synthMidi = new a.midi.MidiFile();
new a.midi.MidiFileGenerator(original,settings,new a.midi.AlphaSynthMidiFileHandler(synthMidi)).generate();
synth.loadMidiFile(synthMidi);
synth.loadSoundFont(new Uint8Array(fs.readFileSync('public/editor/vendor/soundfont/sonivox.sf3')),false);
const options=new a.synth.AudioExportOptions(); options.playbackRange={startTick:0,endTick:3840};
const audio=synth.exportAudio(options,synthMidi,[],new Map()).render(1800);
assert.ok(audio.samples.length>44100);
const peak=audio.samples.reduce((peak,x)=>Math.max(peak,Math.abs(x)),0);
assert.ok(peak>.001 && Number.isFinite(peak)); synth.destroy();

// Editor repro: pasted bars must get fresh model IDs and survive save/reopen after undo/redo and track add.
let editorScore=M.createScore();
let editorSelection={track:0,staff:0,bar:0,voice:0,beat:0,note:0};
const editorUndo=[],editorRedo=[];
function editEditorScore(fn){
  const previous={json:M.snapshot(editorScore),selected:{...editorSelection}};
  fn(editorScore);editorScore=M.consolidate(editorScore);editorUndo.push(previous);editorRedo.length=0;
}
function editorHistory(back){
  const from=back?editorUndo:editorRedo,to=back?editorRedo:editorUndo;
  to.push({json:M.snapshot(editorScore),selected:{...editorSelection}});
  const entry=from.pop();editorScore=M.restore(entry.json);editorSelection=entry.selected;
}
editEditorScore(s=>{s.title='Teacher test';s.artist='QA';s.album='Editor';});
editEditorScore(s=>M.setNote(s,editorSelection,{fret:5,string:1,duration:8,chord:'Am',lyric:'Practice',isPalmMute:true}));
const editorClipboard={json:M.snapshot(editorScore),selected:{...editorSelection}};
editorSelection={...editorSelection,bar:1};
editEditorScore(s=>M.pasteBar(s,editorClipboard.json,editorClipboard.selected,{track:0,staff:0,bar:1}));
let copiedBeat=M.beatAt(editorScore,editorSelection);
assert.equal(copiedBeat.notes[0].fret,5);
assert.equal(copiedBeat.chord.name,'Am');
assert.equal(copiedBeat.lyrics[0],'Practice');
assert.equal(copiedBeat.notes[0].isPalmMute,true);
for(const [key,items] of [
  ['bar',editorScore.tracks.flatMap(t=>t.staves.flatMap(st=>st.bars))],
  ['voice',editorScore.tracks.flatMap(t=>t.staves.flatMap(st=>st.bars.flatMap(b=>b.voices)))],
  ['beat',editorScore.tracks.flatMap(t=>t.staves.flatMap(st=>st.bars.flatMap(b=>b.voices.flatMap(v=>v.beats))))],
  ['note',editorScore.tracks.flatMap(t=>t.staves.flatMap(st=>st.bars.flatMap(b=>b.voices.flatMap(v=>v.beats.flatMap(bt=>bt.notes)))))],
])assert.equal(new Set(items.map(item=>item.id)).size,items.length,`Pasted ${key} IDs must remain unique`);
editEditorScore(s=>{M.addBar(s);editorSelection.bar=s.masterBars.length-1;});
editorHistory(true);editorHistory(false);
assert.equal(editorScore.masterBars.length,5);
editEditorScore(s=>{M.addTrack(s,'Electric Bass',33,M.tunings.bass,false);editorSelection={track:1,staff:0,bar:0,voice:0,beat:0,note:0};});
const editorBytes=new a.exporter.Gp7Exporter().export(editorScore,settings);
const editorRoundTrip=read(editorBytes);
assert.deepEqual([editorRoundTrip.tracks.length,editorRoundTrip.masterBars.length], [2,5]);
assert.equal(editorRoundTrip.tracks[1].name,'Electric Bass');
assert.equal(editorRoundTrip.tracks[1].playbackInfo.program,33);
assert.equal(M.beatAt(editorRoundTrip,{track:0,staff:0,bar:1,voice:0,beat:0}).notes[0].fret,5);
assert.equal(M.beatAt(editorRoundTrip,{track:0,staff:0,bar:1,voice:0,beat:0}).chord.name,'Am');
assert.equal(M.beatAt(editorRoundTrip,{track:0,staff:0,bar:1,voice:0,beat:0}).lyrics[0],'Practice');
M.addTrack(editorScore,'Second guitar',25,M.tunings.standard,false);
assert.equal(editorScore.tracks[2].staves[0].chords,null);
M.pasteBar(editorScore,editorClipboard.json,editorClipboard.selected,{track:2,staff:0,bar:0});
editorScore=M.consolidate(editorScore);
const crossTrack=read(new a.exporter.Gp7Exporter().export(editorScore,settings));
assert.equal(M.beatAt(crossTrack,{track:2,staff:0,bar:0,voice:0,beat:0}).chord.name,'Am','Paste supports a destination without a chord map');
console.log('PASS: GP8 reference import/export; note/effect/chord/lyric roundtrip; beat timing; melodic/drum editing; track/bar structure; multitrack MIDI; actual SF3 synthesis; copied-bar ID uniqueness and editor save/reopen repro.');
