const assert = require('node:assert/strict');
const at = require('./public/editor/vendor/alphaTab.js');
const M = require('./public/editor/model.js');
const m = at.model;
const pos = {track:0,staff:0,bar:0,voice:0,beat:0,note:0};
const reopen = score => at.importer.ScoreLoader.loadScoreFromBytes(new at.exporter.Gp7Exporter().export(M.consolidate(score)));
const ticks = (score, bar = 0) => {
  const mb=score.masterBars[bar];
  return score.tracks[0].staves[0].bars[bar].voices[0].beats.reduce((sum,b)=>sum+(b.graceType!==m.GraceType.None?0:b.isFullBarRest?3840*mb.timeSignatureNumerator/mb.timeSignatureDenominator:3840/b.duration*(b.dots===2?1.75:b.dots===1?1.5:1)*b.tupletDenominator/b.tupletNumerator),0);
};
const unchanged = (score, action, message) => {
  const before=M.snapshot(score);
  assert.throws(action,message);
  assert.equal(M.snapshot(score),before,'Rejected edit leaves score unchanged');
};

for (const numerator of [3,5,6,7,9]) {
  let score=M.createScore();
  M.setNote(score,pos,{string:1,fret:5});
  if (numerator===9) M.setDuration(M.beatAt(score,pos),8);
  const total=ticks(score), duration=M.beatAt(score,pos).duration;
  M.setTuplet(score,pos,numerator);
  assert.ok(Math.abs(ticks(score)-total)<1e-7);
  const group=M.beatAt(score,pos).voice.beats.slice(0,numerator);
  assert.equal(group.length,numerator);
  assert.ok(group.every(b=>b.duration===duration && b.tupletNumerator===numerator));
  assert.ok(group.slice(1).every(b=>b.isRest));
  assert.equal(group[0].notes[0].fret,5);
  const imported=reopen(score);
  assert.equal(M.beatAt(imported,pos).tupletNumerator,numerator);
  if ([3,5].includes(numerator)) assert.equal(ticks(imported),total);
  M.setTuplet(imported,pos,1);
  assert.equal(M.beatAt(reopen(imported),pos).tupletNumerator,-1);
  M.setTuplet(score,pos,1);
  assert.ok(Math.abs(ticks(score)-total)<1e-7);
  assert.equal(M.beatAt(score,pos).tupletNumerator,-1);
  assert.equal(M.beatAt(reopen(score),pos).notes[0].fret,5);
}
let score=M.createScore();
M.setNote(score,{...pos,beat:1},{string:1,fret:3});
unchanged(score,()=>M.setTuplet(score,pos,3),/Not enough room after this beat for a tuplet\./);
score=M.createScore();
unchanged(score,()=>M.setTuplet(score,{...pos,beat:3},3),/Not enough room/);
M.setDuration(M.beatAt(score,pos),4,1);
unchanged(score,()=>M.setTuplet(score,pos,3),/Cannot change this beat/);
score=M.createScore();
M.setTuplet(score,{...pos,beat:1},3);
M.setNote(score,{...pos,beat:2},{string:1,fret:7});
unchanged(score,()=>M.setTuplet(score,{...pos,beat:1},1),/Clear the other notes in this tuplet first\./);
M.setTuplet(score,{...pos,beat:2},1);
assert.equal(M.beatAt(score,{...pos,beat:1}).notes[0].fret,7,'Removal keeps selected member');
assert.equal(ticks(score),3840);
score=M.createScore();
M.setTuplet(score,pos,3); M.setTuplet(score,{...pos,beat:3},3);
M.setNote(score,{...pos,beat:4},{string:1,fret:8});
M.setTuplet(score,{...pos,beat:4},1);
assert.equal(M.beatAt(score,pos).tupletNumerator,3,'Removal finds second chunk of same run');
assert.equal(M.beatAt(score,{...pos,beat:3}).notes[0].fret,8);
assert.equal(ticks(score),3840);

for (const [type,graceType] of [['before',m.GraceType.BeforeBeat],['on',m.GraceType.OnBeat]]) {
  score=M.createScore();
  unchanged(score,()=>M.addGraceNote(score,pos,type),/Select a note first\./);
  M.setNote(score,pos,{string:1,fret:1});
  M.setNote(score,pos,{string:2,fret:5});
  const total=ticks(score), beat=M.addGraceNote(score,{...pos,note:1},type);
  assert.equal(beat.duration,16);
  assert.equal(beat.graceType,graceType);
  assert.equal(beat.notes[0].fret,3);
  assert.equal(beat.notes[0].string,5);
  assert.equal(ticks(score),total);
  let imported=reopen(score);
  assert.equal(M.beatAt(imported,pos).graceType,graceType);
  assert.equal(ticks(imported),total);
  M.removeGraceNote(imported,pos);
  assert.equal(ticks(imported),total);
  assert.equal(M.beatAt(reopen(imported),pos).graceType,m.GraceType.None);
  unchanged(score,()=>M.setDuration(beat,8),/Cannot change this duration safely/);
  unchanged(score,()=>M.insertBeat(score,pos),/Cannot split this duration safely/);
  unchanged(score,()=>M.setTimeSignature(score,0,3,4),/grace notes/);
  M.setDuration(M.beatAt(score,{...pos,beat:1}),8);
  assert.equal(ticks(score),total,'Duration edits next to grace keep bar length');
  score=M.consolidate(score);
  M.insertBeat(score,{...pos,beat:1});
  assert.equal(ticks(score),total);
  const dest=M.createScore();
  M.pasteBar(dest,M.snapshot(score),pos,pos);
  assert.equal(ticks(dest),total);
  assert.equal(M.beatAt(reopen(dest),pos).graceType,graceType);
}

score=M.createScore();
const fermataPos={...pos,beat:2};
for (const type of ['short','medium','long']) {
  M.setFermata(score,fermataPos,type);
  assert.equal(M.fermataAt(score,fermataPos),type);
  assert.equal(M.fermataAt(score,pos),null);
  assert.equal(score.masterBars[0].fermata.get(1920).type,{short:0,medium:1,long:2}[type]);
  score=reopen(score);
  assert.equal(M.fermataAt(score,fermataPos),type);
  M.setFermata(score,fermataPos,null);
  assert.equal(M.fermataAt(reopen(score),fermataPos),null);
}

const source=M.createScore({bars:3});
M.setTimeSignature(source,1,3,4);
for (let bar=0;bar<3;bar++) M.setNote(source,{...pos,bar},{string:1,fret:bar+5,chord:'Am'});
const clip=JSON.parse(JSON.stringify(M.copyBars(source,0,0,0,2)));
score=M.createScore({bars:2});
M.pasteBars(score,clip,{track:0,staff:0,bar:1});
assert.equal(score.masterBars.length,4);
for (const current of [score,reopen(score)]) {
  for (let bar=1;bar<4;bar++) {
    assert.equal(M.beatAt(current,{...pos,bar}).notes[0].fret,bar+4);
    assert.equal(current.masterBars[bar].timeSignatureNumerator,bar===2?3:4);
    assert.equal(ticks(current,bar),bar===2?2880:3840);
    const beat=M.beatAt(current,{...pos,bar});
    assert.equal(beat.voice.bar.staff.chords.get(beat.chordId).name,'Am');
  }
}
const ids={bar:[],voice:[],beat:[],note:[]};
for (const bar of score.tracks[0].staves[0].bars) {
  ids.bar.push(bar.id);
  for (const voice of bar.voices) {
    ids.voice.push(voice.id);
    for (const beat of voice.beats) { ids.beat.push(beat.id); ids.note.push(...beat.notes.map(n=>n.id)); }
  }
}
for (const values of Object.values(ids)) assert.equal(new Set(values).size,values.length);

score=M.createScore();
M.setNote(score,pos,{string:1,fret:5});
M.setNote(score,{...pos,bar:1},{string:1,fret:7});
M.setNote(score,{...pos,bar:2},{string:1,fret:9});
M.transposeNotes(score,0,0,0,1,2);
assert.equal(M.beatAt(reopen(score),pos).notes[0].fret,7);
assert.equal(M.beatAt(score,{...pos,bar:1}).notes[0].fret,9);
assert.equal(M.beatAt(score,{...pos,bar:2}).notes[0].fret,9,'Range excludes later bars');
M.transposeNotes(score,0,0,0,1,-2);
assert.equal(M.beatAt(reopen(score),pos).notes[0].fret,5);
M.setNote(score,{...pos,bar:1},{string:1,fret:24});
unchanged(score,()=>M.transposeNotes(score,0,0,0,1,1),/A note would go off the fretboard\./);
score=M.createScore();
M.setNote(score,pos,{string:2,fret:24});
M.setNote(score,{...pos,beat:1},{string:2,fret:24,tie:true});
score=M.consolidate(score);
M.transposeNotes(score,0,0,0,0,1);
let imported=reopen(score);
assert.equal(M.beatAt(imported,pos).notes[0].fret,20);
assert.equal(M.beatAt(imported,pos).notes[0].string,6);
assert.equal(M.beatAt(imported,{...pos,beat:1}).notes[0].isTieDestination,true);
assert.equal(M.beatAt(imported,{...pos,beat:1}).notes[0].fret,20);
score=M.createScore();
M.setNote(score,pos,{string:1,fret:0});
M.transposeNotes(score,0,0,0,0,-1);
assert.equal(M.beatAt(reopen(score),pos).notes[0].fret,4);
assert.equal(M.beatAt(score,pos).notes[0].string,5);
score=M.createScore();
M.setNote(score,pos,{string:1,fret:5});
M.setNote(score,pos,{string:2,fret:24});
unchanged(score,()=>M.transposeNotes(score,0,0,0,0,1),/off the fretboard/);

score=M.createScore({track:['Piano',0,[]]});
M.setNote(score,pos,{pitch:60});
M.addGraceNote(score,pos,'before');
assert.equal(M.beatAt(reopen(score),pos).notes[0].realValue,60);
M.removeGraceNote(score,pos);
M.transposeNotes(score,0,0,0,0,12);
assert.equal(M.beatAt(reopen(score),pos).notes[0].realValue,72);
M.transposeNotes(score,0,0,0,0,-12);
assert.equal(M.beatAt(reopen(score),pos).notes[0].realValue,60);
M.setNote(score,pos,{pitch:127}); M.transposeNotes(score,0,0,0,0,1);
assert.equal(M.beatAt(score,pos).notes[0].octave*12+M.beatAt(score,pos).notes[0].tone,127);
score=M.createScore({track:['Drums',0,[],true]});
M.setNote(score,pos,{pitch:38});
const before=M.snapshot(score);
M.transposeNotes(score,0,0,0,0,12);
assert.equal(M.snapshot(score),before);
console.log('PASS editor notation checks');
{
 // Insert before the cursor keeps the displaced bar's meter and existing content order.
 let s=M.createScore();M.addBar(s);M.setTimeSignature(s,1,3,4);M.setNote(s,{track:0,staff:0,bar:1,voice:0,beat:0,note:0},{string:1,fret:7});
 const before=s.masterBars.length;M.insertBar(s,1);s=M.consolidate(s);
 assert.equal(s.masterBars.length,before+1);
 assert.equal(s.masterBars[1].timeSignatureNumerator,3);
 assert.equal(M.beatAt(s,{track:0,staff:0,bar:2,voice:0,beat:0,note:0}).notes[0].fret,7);
 assert.ok(M.beatAt(s,{track:0,staff:0,bar:1,voice:0,beat:0,note:0}).isRest);
 console.log('PASS insert bar before cursor');
}
