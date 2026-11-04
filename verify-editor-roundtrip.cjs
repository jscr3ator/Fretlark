const assert = require('node:assert/strict');
const at = require('./public/editor/vendor/alphaTab.js');
const M = require('./public/editor/model.js');
const pos = (track,bar,beat=0) => ({track,staff:0,bar,voice:0,beat,note:0});
const score = M.createScore();
score.title = 'Roundtrip fixture';
M.addTrack(score,'Piano',0,[]);
M.addTrack(score,'Drums',0,[],true);
M.setNote(score,pos(0,0),{string:1,fret:5,chord:'Am',lyric:'sing',text:'hello',isPalmMute:true});
M.setNote(score,pos(0,0),{string:2,fret:5});
M.setNote(score,pos(0,0,1),{string:1,fret:7,bend:4});
M.setNote(score,pos(1,0),{pitch:60});
M.setNote(score,pos(2,0),{pitch:38});
const dotted = M.beatAt(score,pos(0,1));
dotted.duration=4; dotted.dots=1;
M.beatAt(score,pos(0,1,1)).duration=8;
M.setNote(score,pos(0,1),{string:1,fret:3});
M.setNote(score,pos(0,1,1),{string:1,fret:3,tie:true});
M.setNote(score,pos(0,3),{string:1,fret:12,harmonic:at.model.HarmonicType.Natural,vibrato:true,isLetRing:true});
const voice=score.tracks[0].staves[0].bars[2].voices[0];
for (const beat of voice.beats.slice(0,3)) { beat.duration=8; beat.tupletNumerator=3; beat.tupletDenominator=2; }
for (let i=0;i<3;i++) M.setNote(score,pos(0,2,i),{string:1,fret:i+1});
// Fill the remaining three beats after the triplet with a dotted half rest.
voice.beats[3].duration=2; voice.beats[3].dots=1;
score.masterBars[0].isRepeatStart=true;
score.masterBars[1].repeatCount=2;
score.masterBars[1].alternateEndings=1;
score.masterBars[2].alternateEndings=2;
score.masterBars[1].tempoAutomations.push(at.model.Automation.buildTempoAutomation(false,0,97,2));
const before=M.consolidate(score);
const after=at.importer.ScoreLoader.loadScoreFromBytes(new at.exporter.Gp7Exporter().export(before));
const select=s=>{
  const chordBeat=M.beatAt(s,pos(0,0)), note=chordBeat.notes[0];
  const bend=M.beatAt(s,pos(0,0,1)).notes[0];
  const d=M.beatAt(s,pos(0,1));
  return {
    tracks:s.tracks.length, bars:s.masterBars.length, title:s.title,
    musicalContent:s.tracks.map(t=>t.staves.map(st=>st.bars.map(bar=>bar.voices.map(v=>v.beats.map(b=>({duration:b.duration,dots:b.dots,rest:b.isRest,notes:b.notes.map(n=>st.isPercussion?n.percussionArticulation:n.realValue)})))))),
    notes:chordBeat.notes.map(n=>[n.string,n.fret]),
    chord:chordBeat.voice.bar.staff.chords.get(chordBeat.chordId)?.name,
    lyric:chordBeat.lyrics?.[0], text:chordBeat.text, palmMute:note.isPalmMute,
    bend:bend.bendPoints?.map(p=>[p.offset,p.value]),
    dotted:[d.duration,d.dots],
    tie:M.beatAt(s,pos(0,1,1)).notes[0].isTieDestination,
    harmonic:[M.beatAt(s,pos(0,3)).notes[0].harmonicType,M.beatAt(s,pos(0,3)).notes[0].vibrato,M.beatAt(s,pos(0,3)).notes[0].isLetRing],
    triplet:M.beatAt(s,pos(0,2)).voice.beats.slice(0,3).map(b=>[b.duration,b.tupletNumerator,b.tupletDenominator,b.notes[0]?.fret]),
    rest:M.beatAt(s,pos(0,2,3)).isRest,
    repeats:s.masterBars.map(b=>[b.isRepeatStart,b.repeatCount,b.alternateEndings]),
    tempos:s.masterBars.map(b=>b.tempoAutomations.map(a=>[a.value,a.ratioPosition])),
    piano:M.beatAt(s,pos(1,0)).notes[0].realValue,
    drum:M.beatAt(s,pos(2,0)).notes[0].percussionArticulation
  };
};
const expected=select(before), actual=select(after);
assert.deepEqual(expected.notes,[[6,5],[5,5]],'Fixture includes a two-note chord');
assert.equal(expected.tie,true,'Fixture includes a tie');
assert.equal(expected.rest,true,'Fixture includes a rest');
assert.equal(expected.harmonic[0],at.model.HarmonicType.Natural,'Fixture includes a harmonic');
assert.equal(expected.drum,38,'Fixture includes a snare');
for (const key of Object.keys(expected)) {
  try { assert.deepEqual(actual[key],expected[key]); }
  catch { console.error(`${key}: before=${JSON.stringify(expected[key])} after=${JSON.stringify(actual[key])}`); process.exitCode=1; }
}
if (!process.exitCode) console.log('GP export/reopen musical fields passed');
