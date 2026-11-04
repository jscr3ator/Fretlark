const assert=require('node:assert/strict');
const at=require('./public/editor/vendor/alphaTab.js');
const M=require('./public/editor/model.js');
const L=require('./public/editor/lyrics.js');
const reopen=score=>at.importer.ScoreLoader.loadScoreFromBytes(new at.exporter.Gp7Exporter().export(M.consolidate(score)));

assert.deepEqual(L.parseLyrics('won-der-ful a+bit [hidden words]\nnow'),['won-','der-','ful','a bit','now']);
assert.deepEqual(L.parseLyrics('la -- la'),['la','','la']);
assert.deepEqual(L.parseLyrics('one  two'),['one','two']);

let score=M.createScore({bars:2});
const pos=(bar,beat)=>({track:0,staff:0,bar,voice:0,beat});
for(const [bar,beat] of [[0,0],[0,2],[0,3],[1,0],[1,1],[1,2],[1,3]])M.setNote(score,pos(bar,beat),{string:1,fret:3});
M.setNote(score,pos(0,3),{string:2,fret:3});
for(const note of score.tracks[0].staves[0].bars[0].voices[0].beats[3].notes)note.isTieDestination=true;
let beats=score.tracks[0].staves[0].bars.flatMap(b=>b.voices[0].beats);
assert.deepEqual(L.assignLyrics(score,0,0,'one two three four five six seven'),{assigned:6,leftover:1});
assert.deepEqual(beats.filter(b=>b.notes.length&&!b.notes.every(n=>n.isTieDestination)).map(b=>b.lyrics?.[0]),['one','two','three','four','five','six']);
L.assignLyrics(score,0,0,'line two words',1);
assert.equal(beats.find(b=>b.lyrics?.[0]==='one').lyrics[0],'one');
assert.equal(beats.find(b=>b.lyrics?.[0]==='one').lyrics[1],'line');
assert.equal(L.readLyrics(score,0,0,0),'one two three four five six');

score=M.createScore();
for(let i=0;i<4;i++)M.setNote(score,pos(0,i),{string:1,fret:3});
score=M.consolidate(score);
L.assignLyrics(score,0,0,'won-der-ful today');
assert.equal(L.readLyrics(score,0,0),'won-der-ful today');
assert.deepEqual(reopen(score).tracks[0].staves[0].bars[0].voices[0].beats.map(b=>b.lyrics?.[0]),['won-','der-','ful','today']);
console.log('Lyrics checks passed');
