(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.Theory=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SCALES={
    major:{name:'Major',intervals:[0,2,4,5,7,9,11]}, naturalMinor:{name:'Natural minor',intervals:[0,2,3,5,7,8,10]}, harmonicMinor:{name:'Harmonic minor',intervals:[0,2,3,5,7,8,11]}, melodicMinor:{name:'Melodic minor',intervals:[0,2,3,5,7,9,11]},
    majorPentatonic:{name:'Major pentatonic',intervals:[0,2,4,7,9]}, minorPentatonic:{name:'Minor pentatonic',intervals:[0,3,5,7,10]}, blues:{name:'Blues',intervals:[0,3,5,6,7,10]},
    dorian:{name:'Dorian',intervals:[0,2,3,5,7,9,10]}, phrygian:{name:'Phrygian',intervals:[0,1,3,5,7,8,10]}, lydian:{name:'Lydian',intervals:[0,2,4,6,7,9,11]}, mixolydian:{name:'Mixolydian',intervals:[0,2,4,5,7,9,10]}, locrian:{name:'Locrian',intervals:[0,1,3,5,6,8,10]}, wholeTone:{name:'Whole tone',intervals:[0,2,4,6,8,10]}, chromatic:{name:'Chromatic',intervals:[0,1,2,3,4,5,6,7,8,9,10,11]}
  };
  const sharp=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'], flat=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  const letters=['C','D','E','F','G','A','B'], natural={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
  const keySig={C:0,G:1,D:2,A:3,E:4,B:5,'F#':6,'C#':7,F:-1,Bb:-2,Eb:-3,Ab:-4,Db:-5,Gb:-6,Cb:-7};
  const mod=n=>(n%12+12)%12;
  function pcOf(note){if(Number.isInteger(note))return mod(note);const m=/^([A-Ga-g])([#b]?)$/.exec(String(note));if(!m)throw new Error('Invalid note: '+note);return mod(natural[m[1].toUpperCase()]+(m[2]==='#'?1:m[2]==='b'?-1:0));}
  function scaleNotes(root,id){const s=SCALES[id];if(!s)throw new Error('Unknown scale: '+id);const base=pcOf(root);return s.intervals.map(i=>mod(base+i));}
  function noteName(pc,preferFlats=false){return (preferFlats?flat:sharp)[mod(pc)];}
  function spellScale(root,id){
    const pcs=scaleNotes(root,id), name=typeof root==='number'?noteName(root):String(root), m=/^([A-Ga-g])([#b]?)$/.exec(name);
    if(!m||SCALES[id].intervals.length===12||SCALES[id].intervals.length===6&&SCALES[id].intervals.every((x,i)=>i===0||x-SCALES[id].intervals[i-1]===2))return pcs.map(pc=>noteName(pc,/b/.test(name)));
    const start=letters.indexOf(m[1].toUpperCase());
    return pcs.map((pc,i)=>{const l=letters[(start+i)%7], delta=mod(pc-natural[l]);const a=delta===0?'':delta===1?'#':delta===11?'b':null;return a===null?noteName(pc,/b/.test(name)):l+a;});
  }
  function keySignatureFor(root,mode='major') {const n=typeof root==='number'?noteName(root):root;const tonic=pcOf(n);if(mode==='major'){if(keySig[n]===undefined)throw new Error('Unsupported key: '+n);return keySig[n];}if(mode==='minor'){const rel=mod(tonic+3);for(const candidate of ['C','G','D','A','E','B','F#','C#','F','Bb','Eb','Ab','Db','Gb','Cb'])if(pcOf(candidate)===rel)return keySig[candidate];}throw new Error('Mode must be major or minor.');}
  function fretboardMap(tuning,root,id,frets=24){const pcs=new Set(scaleNotes(root,id)),rootPc=pcOf(root),spelled=spellScale(root,id),degreeMap=new Map(scaleNotes(root,id).map((pc,i)=>[pc,i+1]));return tuning.map(midi=>Array.from({length:frets+1},(_,f)=>{const pc=mod(midi+f);if(!pcs.has(pc))return null;return {fret:f,pc,isRoot:pc===rootPc,degree:degreeMap.get(pc),name:spelled[scaleNotes(root,id).indexOf(pc)]};}).filter(Boolean));}
  function transposeName(name,semitones,preferFlats=false){const m=/^([A-Ga-g])([#b]?)(.*?)(?:\/([A-Ga-g][#b]?))?$/.exec(String(name));if(!m)throw new Error('Invalid chord name: '+name);const root=pcOf(m[1]+m[2]),next=noteName(root+semitones,preferFlats),bass=m[4]?'/'+noteName(pcOf(m[4])+semitones,preferFlats):'';return next+m[3]+bass;}
  function detectScale(pitchClasses){const pcs=new Set(Array.from(pitchClasses,pcOf));if(!pcs.size)return [];return Object.keys(SCALES).map(scaleId=>Array.from({length:12},(_,root)=>{const notes=scaleNotes(root,scaleId),hits=notes.filter(n=>pcs.has(n)).length,extra=[...pcs].filter(n=>!notes.includes(n)).length;return {root:noteName(root),scaleId,score:(hits/notes.length)*0.7+(hits/pcs.size)*0.3-extra*0.05};})).flat().sort((a,b)=>b.score-a.score).slice(0,5);}
  return {SCALES,scaleNotes,fretboardMap,noteName,spellScale,keySignatureFor,transposeName,detectScale};
});
