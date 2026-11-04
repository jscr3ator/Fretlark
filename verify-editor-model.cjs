const assert = require('node:assert/strict');
const at = require('./public/editor/vendor/alphaTab.js');
const M = require('./public/editor/model.js');
const pos = {track:0,staff:0,bar:0,voice:0,beat:0,note:0};
const reopen = score => at.importer.ScoreLoader.loadScoreFromBytes(new at.exporter.Gp7Exporter().export(M.consolidate(score)));

let score = M.createScore();
M.setNote(score,pos,{string:1,fret:5});
const undo=M.snapshot(score);
M.setDuration(M.beatAt(score,pos),2);
score=M.consolidate(score);
assert.deepEqual(M.beatAt(score,pos).voice.beats.map(b=>b.duration),[2,4,4]);
assert.equal(M.beatAt(reopen(score),pos).notes[0].fret,5);
assert.equal(M.beatAt(M.restore(undo),pos).duration,4);
M.setDuration(M.beatAt(score,pos),8);
score=M.consolidate(score);
assert.equal(M.beatAt(score,pos).voice.calculateDuration(),3840);
assert.equal(M.beatAt(reopen(score),pos).duration,8);

for (const annotation of [false,true]) {
  score=M.createScore();
  if(annotation) M.setNote(score,{...pos,beat:1},{text:'Keep'});
  else M.setNote(score,{...pos,beat:1},{string:1,fret:3});
  const before=M.snapshot(score);
  assert.throws(()=>M.setDuration(M.beatAt(score,pos),2),/overfills/);
  assert.equal(M.snapshot(score),before,'Blocked duration edit must be atomic');
}
score=M.createScore();
M.beatAt(score,{...pos,beat:1}).beamingMode=1;
assert.throws(()=>M.setDuration(M.beatAt(score,pos),2),/overfills/);
assert.equal(M.beatAt(score,{...pos,beat:1}).beamingMode,1);
assert.equal(M.beatAt(score,pos).duration,4);
score = M.createScore();
assert.throws(()=>M.setNote(score,pos,{isPalmMute:true}),/Select a note first/);
assert.equal(M.beatAt(score,pos).notes.length,0);
M.setNote(score,pos,{string:1});
assert.equal(M.beatAt(reopen(score),pos).notes[0].fret,0);

score = M.createScore();
const next={...pos,beat:1};
M.setNote(score,pos,{string:1,fret:4});
M.setNote(score,next,{string:1,fret:4,tie:true});
score=M.consolidate(score);
const first=M.beatAt(score,pos);
first.removeNote(first.notes[0]);
score=M.consolidate(score);
assert.equal(M.beatAt(score,next).notes[0].isTieDestination,false);
assert.equal(M.beatAt(reopen(score),next).notes[0].fret,4);

for (const [originKey,destinationKey] of [['hammerPullOrigin','hammerPullDestination'],['slurOrigin','slurDestination'],['slideOrigin','slideTarget']]) {
  score=M.createScore();
  M.setNote(score,pos,{string:1,fret:4}); M.setNote(score,next,{string:1,fret:7});
  const origin=M.beatAt(score,pos).notes[0], destination=M.beatAt(score,next).notes[0];
  origin[destinationKey]=destination; destination[originKey]=origin;
  M.beatAt(score,pos).removeNote(origin);
  score=M.consolidate(score);
  assert.equal(M.beatAt(score,next).notes[0][originKey],null,`${originKey} detached`);
  assert.equal(M.beatAt(reopen(score),next).notes[0].fret,7);
}
score=M.createScore();
M.setNote(score,pos,{string:1,fret:4}); M.setNote(score,next,{string:1,fret:4,tie:true});
score=M.consolidate(score);
const last=M.beatAt(score,next); last.removeNote(last.notes[0]);
score=M.consolidate(score);
assert.equal(M.beatAt(score,pos).notes[0].tieDestination,null);
assert.equal(M.beatAt(reopen(score),pos).notes[0].fret,4);
score=M.createScore();
const barNext={...pos,bar:1};
M.setNote(score,{...pos,beat:3},{string:1,fret:4});
M.setNote(score,barNext,{string:1,fret:4,tie:true});
score=M.consolidate(score); M.removeBar(score,0); score=M.consolidate(score);
assert.equal(M.beatAt(reopen(score),pos).notes[0].isTieDestination,false);

score=M.createScore();
const voice2={...pos,voice:1};
M.setNote(score,voice2,{string:1,fret:3});
assert.equal(M.beatAt(reopen(score),voice2).notes[0].fret,3);
score=M.consolidate(score);
M.addBar(score);
assert.equal(M.beatAt(reopen(score),voice2).notes[0].fret,3);

function fullBarRest(numerator, denominator) {
  let score = M.createScore();
  const bar = score.masterBars[0];
  bar.timeSignatureNumerator = numerator; bar.timeSignatureDenominator = denominator;
  const voice = M.beatAt(score,pos).voice;
  voice.beats = [voice.beats[0]]; voice.beats[0].duration = 1;
  return M.consolidate(score);
}
for (const [numerator, denominator] of [[3,4],[6,8],[4,4],[2,4]]) {
  score = fullBarRest(numerator,denominator);
  const duration = M.beatAt(score,pos).voice.calculateDuration();
  M.insertBeat(score,pos);
  for (const current of [M.consolidate(score), reopen(score)]) {
    const voice = M.beatAt(current,pos).voice;
    assert.equal(voice.beats.length,2);
    assert.equal(voice.calculateDuration(),duration,`${numerator}/${denominator} split retains length`);
  }
}
for (const [numerator,denominator] of [[3,4],[6,8]]) {
  score=fullBarRest(numerator,denominator);
  M.setDuration(M.beatAt(score,pos),4);
  assert.equal(M.beatAt(reopen(score),pos).voice.calculateDuration(),2880);
}
for (const [numerator,denominator,ticks] of [[3,4,2880],[6,8,2880],[5,4,4800]]) {
  score=fullBarRest(numerator,denominator);
  M.beatAt(score,pos).text='Keep';
  M.setNote(score,pos,{string:1,fret:5});
  const voice=M.beatAt(reopen(score),pos).voice;
  assert.equal(voice.calculateDuration(),ticks);
  assert.equal(voice.beats[0].notes[0].fret,5);
  assert.equal(voice.beats[0].text,'Keep');
}
score = fullBarRest(5,4);
assert.throws(()=>M.insertBeat(score,pos),/cannot be split evenly/);
assert.equal(M.beatAt(score,pos).voice.beats.length,1);
score = M.createScore();
M.setNote(score,pos,{string:1,fret:0});
M.setNote(score,pos,{string:2,fret:5});
M.setNote(score,next,{string:2,fret:5,tie:true});
score = M.consolidate(score);
M.applyTuning(score.tracks[0].staves[0],M.tunings.seven);
for (const current of [M.consolidate(score),reopen(score)]) {
  const notes=M.beatAt(current,pos).notes;
  assert.deepEqual(notes.map(n=>n.realValue),[64,64]);
  assert.equal(new Set(notes.map(n=>n.string)).size,2,'Chord notes must occupy separate strings');
  assert.equal(M.beatAt(current,next).notes[0].string,notes[1].string,'Ties stay on the origin string');
}
const staff=score.tracks[0].staves[0];
assert.throws(()=>M.applyTuning(staff,[64]),/cannot be represented/);
assert.deepEqual(staff.tuning,M.tunings.seven,'Failed tuning leaves staff unchanged');

score=M.createScore();
M.setNote(score,pos,{string:1,fret:5,chord:'Am'});
const clipboard=M.snapshot(score);
score.masterBars[1].timeSignatureNumerator=3;
const beforePaste=M.snapshot(score);
assert.throws(()=>M.pasteBar(score,clipboard,pos,{...pos,bar:1}),/same time signature/);
assert.equal(M.snapshot(score),beforePaste,'Rejected paste leaves score unchanged');
score.masterBars[1].timeSignatureNumerator=4;
M.pasteBar(score,clipboard,pos,{...pos,bar:1});
const pasted=M.beatAt(reopen(score),{...pos,bar:1});
assert.equal(pasted.notes[0].fret,5);
assert.equal(pasted.voice.bar.staff.chords.get(pasted.chordId).name,'Am');

for (const [key,value] of [['graceType',1],['overrideDisplayDuration',8]]) {
  score=M.createScore();
  const beat=M.beatAt(score,pos);
  beat[key]=value;
  assert.throws(()=>M.insertBeat(score,pos),/Cannot split this duration safely/);
  assert.equal(beat.duration,4);
  assert.equal(beat.voice.beats.length,4);
}
score=M.createScore();
M.setNote(score,pos,{string:1,fret:5});
M.setNote(score,next,{string:1,fret:7});
M.deleteBeat(score,pos);
assert.equal(M.beatAt(score,pos).isRest,true);
assert.equal(M.beatAt(score,pos).voice.calculateDuration(),3840);
assert.equal(M.beatAt(reopen(score),next).notes[0].fret,7);

score=M.createScore();
M.addTrack(score,'Second');
M.setNote(score,pos,{string:1,fret:5});
M.setTimeSignature(score,0,3,4);
for (const track of reopen(score).tracks) assert.equal(track.staves[0].bars[0].voices[0].calculateDuration(),2880);
M.setTimeSignature(score,0,5,4);
for (const track of reopen(score).tracks) assert.equal(track.staves[0].bars[0].voices[0].calculateDuration(),4800);
M.setNote(score,{...pos,track:1,beat:3},{string:1,fret:3});
const beforeMeter=M.snapshot(score);
assert.throws(()=>M.setTimeSignature(score,0,3,4),/would remove notes/);
assert.equal(M.snapshot(score),beforeMeter,'Rejected meter edit leaves every track unchanged');
score=fullBarRest(4,4);
M.setTimeSignature(score,0,3,4);
assert.equal(M.beatAt(reopen(score),pos).voice.calculateDuration(),2880);

score=M.createScore();
score.masterBars[0].tempoAutomations.push(at.model.Automation.buildTempoAutomation(false,0.5,140,2));
score.masterBars[1].tempoAutomations.push(at.model.Automation.buildTempoAutomation(false,0.5,160,2));
M.removeBar(score,0);
assert.deepEqual(score.masterBars[0].tempoAutomations.map(a=>[a.ratioPosition,a.value]),[[0,140],[0.5,160]],'Deleting opening bar keeps inherited tempo and later changes');
score=M.createScore();
score.masterBars[1].tempoAutomations.push(at.model.Automation.buildTempoAutomation(false,0,150,2));
M.removeBar(score,0);
assert.equal(score.masterBars[0].tempoAutomations[0].value,150,'Explicit new opening tempo wins');

score=M.createScore();
M.setNote(score,pos,{string:1,fret:3});
score=M.restore(M.snapshot(score));
// Importing another score resets alphaTab's process-wide ID counters.
at.model.Score.resetIds();
M.setNote(score,pos,{string:2,fret:7});
M.setNote(score,next,{string:1,fret:10});
at.model.Score.resetIds();
M.addTrack(score,'Second');
at.model.Score.resetIds();
M.addBar(score);
at.model.Score.resetIds();
M.setNote(score,voice2,{string:1,fret:5});
const idSets={bar:[],voice:[],beat:[],note:[]};
for (const track of score.tracks) for (const staff of track.staves) for (const bar of staff.bars) {
  idSets.bar.push(bar.id);
  for (const voice of bar.voices) {
    idSets.voice.push(voice.id);
    for (const beat of voice.beats) {
      idSets.beat.push(beat.id);
      for (const note of beat.notes) idSets.note.push(note.id);
    }
  }
}
for (const [kind,ids] of Object.entries(idSets)) assert.equal(new Set(ids).size,ids.length,`${kind} IDs stay unique after importer resets`);
const imported=reopen(score);
assert.deepEqual(M.beatAt(imported,pos).notes.map(note=>note.fret),[3,7]);
assert.equal(M.beatAt(imported,next).notes[0].fret,10);
assert.equal(M.beatAt(imported,voice2).notes[0].fret,5);
assert.equal(imported.tracks.length,2);
assert.equal(imported.masterBars.length,5);
console.log('Editor model regression checks passed');
