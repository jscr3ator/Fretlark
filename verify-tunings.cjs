const assert = require('node:assert/strict');
const T = require('./public/editor/tunings.js');

assert(T.PRESETS.length >= 30);
assert.equal(T.identify([64,59,55,50,45,38]).id,'guitar-drop-d');
for (const [pitch,canonical] of [['C#3','C#3'],['Bb4','A#4'],['E-1','E-1'],['G9','G9']]) assert.equal(T.noteName(T.parsePitch(pitch)),canonical);
assert.equal(T.pitchesToText([64,59,55,50,45,40]),'E A D G B E');
assert.deepEqual(T.PRESETS.find(p=>p.id==='ukulele-standard').pitches,[67,64,60,55]);
assert.deepEqual(T.refret([{string:1,fret:0},{string:2,fret:3}], [64,59,55,50,45,40], [64,59,55,50,45,38]), {
  notes:[{string:1,fret:2},{string:2,fret:3}],moved:0,dropped:0
});
assert.deepEqual(T.refret([{string:1,fret:100}], [64,59,55,50,45,40], [64,59,55,50,45,38]), {notes:[],moved:0,dropped:1});
console.log('Tuning helper checks passed');
