const assert = require('node:assert/strict');
const M = require('./public/editor/model.js');
const {exportAscii} = require('./public/editor/ascii-tab.js');
const pos = {track:0,staff:0,bar:0,voice:0,beat:0};
const score = M.createScore({title:'Example',artist:'Artist',bars:2});
for (const [bar,beat,fret] of [[0,0,5],[0,1,7],[0,2,9],[0,3,12],[1,0,7]]) {
  M.setNote(score,{...pos,bar,beat},{string:1,fret});
}
const bars = score.tracks[0].staves[0].bars;
const beat = (bar, index) => bars[bar].voices[0].beats[index];
beat(0,0).notes[0].isHammerPullOrigin = true;
beat(0,0).notes[0].isPalmMute = true;
beat(0,1).notes[0].slideOutType = 1;
beat(1,0).notes[0].bendPoints = [{value:0},{value:4}];
assert.equal(exportAscii(score), `Example
Artist

Acoustic Guitar
Tuning: E A D G B E
Tempo: 120

  PM----
e|5h----7/----9----12----|7b9----------------|
B|-----------------------|-------------------|
G|-----------------------|-------------------|
D|-----------------------|-------------------|
A|-----------------------|-------------------|
E|-----------------------|-------------------|`);
const wrapped = exportAscii(score,{width:40,header:false});
assert.equal(wrapped.split('\n').filter(line => line.startsWith('e|')).length,2);
for (const system of wrapped.split('\n\n')) {
  const lines = system.split('\n').filter(line => /^[eBGDAE]\|/.test(line));
  assert.equal(new Set(lines.map(line => line.length)).size,1);
}
score.masterBars[0].isRepeatStart = true;
score.masterBars[1].repeatCount = 3;
const repeated = exportAscii(score,{header:false});
assert.match(repeated,/e\|\|:/);
assert.match(repeated,/:\|\|x3/);
const short = M.createScore({bars:1});
M.setNote(short,pos,{string:1,fret:5});
M.setDuration(M.beatAt(short,pos),8);
assert.match(exportAscii(short,{header:false}),/^e\|5--/m);
M.addTrack(short,'Drums',0,[],true);
assert.match(exportAscii(short,{tracks:[1],header:false}),/\(standard notation track omitted\)/);
const effects = M.createScore({bars:1});
for (const [index,fret] of [[0,9],[1,5],[2,12],[3,7]]) M.setNote(effects,{...pos,beat:index},{string:1,fret});
const effectBeats = effects.tracks[0].staves[0].bars[0].voices[0].beats;
effectBeats[0].notes[0].isHammerPullOrigin = true;
effectBeats[1].notes[0].slideOutType = 1;
effectBeats[2].notes[0].harmonicType = 1;
effectBeats[3].notes[0].isGhost = true;
effectBeats[3].notes[0].vibrato = 1;
effectBeats[3].notes[0].bendPoints = [{value:0},{value:4},{value:0}];
assert.match(exportAscii(effects,{header:false}),/9p----5\/----<12>----\(7\)b9r~/);
const vm = require('node:vm');
const fs = require('node:fs');
const browser = {};
vm.runInNewContext(fs.readFileSync('public/editor/ascii-tab.js','utf8'),browser);
assert.equal(browser.AsciiTab.exportAscii(score),exportAscii(score));
console.log('ASCII tab checks passed');
