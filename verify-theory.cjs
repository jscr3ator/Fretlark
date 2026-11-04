const assert = require('node:assert/strict');
const T = require('./public/editor/theory.js');

for (const [root,id,expected] of [
  ['C','major',['C','D','E','F','G','A','B']],
  ['F','major',['F','G','A','Bb','C','D','E']],
  ['Bb','major',['Bb','C','D','Eb','F','G','A']],
  ['E','major',['E','F#','G#','A','B','C#','D#']],
  ['F#','major',['F#','G#','A#','B','C#','D#','E#']],
  ['A','naturalMinor',['A','B','C','D','E','F','G']],
  ['C#','naturalMinor',['C#','D#','E','F#','G#','A','B']]
]) assert.deepEqual(T.spellScale(root,id),expected,`${root} ${id}`);

for (const [root,mode,sig] of [['C','major',0],['G','major',1],['D','major',2],['F','major',-1],['Bb','major',-2],['E','major',4],['A','minor',0],['D','minor',-1],['E','minor',1],['C#','minor',4]]) assert.equal(T.keySignatureFor(root,mode),sig);
const board=T.fretboardMap([64,59,55,50,45,40],'A','minorPentatonic');
assert.deepEqual(board[5].find(n=>n.fret===5),{fret:5,pc:9,isRoot:true,degree:1,name:'A'});
for (const [name,shift,expected] of [['F#m7',2,'G#m7'],['D/F#',-2,'C/E'],['Bbmaj7',2,'Cmaj7']]) assert.equal(T.transposeName(name,shift),expected);
const cMajor=T.detectScale([0,2,4,5,7,9,11]);
assert(cMajor.slice(0,2).some(x=>x.root==='C'&&x.scaleId==='major'));
assert(cMajor.slice(0,2).some(x=>x.root==='A'&&x.scaleId==='naturalMinor'));
assert(T.detectScale(['E','G','A','B','D']).some(x=>x.root==='E'&&x.scaleId==='minorPentatonic'));
console.log('Theory helper checks passed');
