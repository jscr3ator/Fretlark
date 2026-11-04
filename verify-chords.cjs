const assert = require('node:assert/strict');
const at = require('./public/editor/vendor/alphaTab.js');
const chords = require('./public/editor/chords.js');
const tuning = at.model.Tuning.getDefaultTuningFor(6).tunings;
assert.deepEqual(tuning,[64,59,55,50,45,40]);
const parsedScore = at.importer.ScoreLoader.loadAlphaTex('\\chord ("C" 0 1 0 2 3 -1) . 0.6.4 |');
assert.deepEqual([...parsedScore.tracks[0].staves[0].chords.values()][0].strings,[0,1,0,2,3,-1]);
for (const quality of ['', 'm', '7', 'maj7', 'm7', 'dim', 'dim7', 'aug', 'sus2', 'sus4', '5', '6', 'm6', '9', 'add9', 'm7b5', '7sus4']) {
  assert.deepEqual(chords.parseChordName('C'+quality),{root:'C',quality,bass:null});
  assert.ok(chords.chordTones(chords.parseChordName('C'+quality)).length >= 2);
}
for (const [name,quality] of [['Cmin','m'],['C-','m'],['CM7','maj7'],['CΔ','maj7'],['Cø','m7b5'],['C°7','dim7'],['C+','aug']]) assert.equal(chords.parseChordName(name).quality,quality);
assert.deepEqual(chords.parseChordName('D/F#'),{root:'D',quality:'',bass:'F#'});
assert.equal(chords.parseChordName('Cxyz'),null);
assert.deepEqual(chords.chordTones(chords.parseChordName('Cm7b5')),[0,3,6,10]);
for (const [name,shape] of Object.entries({C:'x32010',D:'xx0232',E:'022100',G:'320003',A:'x02220',Am:'x02210',Em:'022000',Dm:'xx0231',F:'133211',B7:'x21202'})) {
  const expected = [...shape].reverse().map(x=>x==='x'?-1:Number(x));
  assert.deepEqual(chords.voicings(name,tuning)[0].frets,expected,name);
}
assert.deepEqual(chords.voicings('F',tuning)[0].barre,[1]);
assert.ok(chords.voicings('D5',[64,59,55,50,45,38]).length);
assert.ok(chords.voicings('C',[64,59,55,50,45,40,35]).length);
assert.ok(chords.voicings('C',[43,38,33,28]).length);
for (const diagram of chords.voicings('D/F#',tuning)) {
  const sounding = diagram.frets.flatMap((f,i)=>f<0?[]:[tuning[i]+f]);
  assert.equal(Math.min(...sounding)%12,6);
}
assert.ok(chords.voicings('D/F#',tuning).length);
const score = at.importer.ScoreLoader.loadAlphaTex('\\track "G" . 0.6.4 |');
const staff = score.tracks[0].staves[0], beat = staff.bars[0].voices[0].beats[0];
const diagram = chords.voicings('C',tuning)[0];
staff.addChord('test',chords.toAlphaTabChord(at,'C',diagram)); beat.chordId='test';
const reopened = at.importer.ScoreLoader.loadScoreFromBytes(new at.exporter.Gp7Exporter().export(score));
const reopenedStaff = reopened.tracks[0].staves[0], reopenedBeat = reopenedStaff.bars[0].voices[0].beats[0];
assert.deepEqual(reopenedStaff.chords.get(reopenedBeat.chordId).strings,diagram.frets);
console.log('Chord library checks passed');
