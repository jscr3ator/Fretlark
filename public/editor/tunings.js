(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tunings = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PRESETS = [
    ['guitar-standard','Guitar','Standard',[64,59,55,50,45,40]],
    ['guitar-half-step-down','Guitar','Half-step down',[63,58,54,49,44,39]],
    ['guitar-full-step-down','Guitar','Full-step down',[62,57,53,48,43,38]],
    ['guitar-drop-d','Guitar','Drop D',[64,59,55,50,45,38]],
    ['guitar-drop-c-sharp','Guitar','Drop C#',[63,58,54,49,44,37]],
    ['guitar-drop-c','Guitar','Drop C',[62,57,53,48,43,36]],
    ['guitar-drop-b','Guitar','Drop B',[61,56,52,47,42,35]],
    ['guitar-double-drop-d','Guitar','Double Drop D',[62,59,55,50,45,38]],
    ['guitar-dadgad','Guitar','DADGAD',[62,57,55,50,45,38]],
    ['guitar-open-d','Guitar','Open D',[62,57,54,50,45,38]],
    ['guitar-open-e','Guitar','Open E',[64,59,56,52,47,40]],
    ['guitar-open-g','Guitar','Open G',[62,59,55,50,43,38]],
    ['guitar-open-a','Guitar','Open A',[64,61,57,52,45,40]],
    ['guitar-open-c','Guitar','Open C',[64,60,55,48,43,36]],
    ['guitar-open-dm','Guitar','Open Dm',[62,57,53,50,45,38]],
    ['guitar-c-standard','Guitar','C standard',[60,55,51,46,41,36]],
    ['guitar-b-standard','Guitar','B standard',[59,54,50,45,40,35]],
    ['guitar-nashville','Guitar','Nashville',[76,71,67,62,57,52]],
    ['guitar-7-standard','7-string guitar','Standard',[64,59,55,50,45,40,35]],
    ['guitar-7-drop-a','7-string guitar','Drop A',[64,59,55,50,45,40,33]],
    ['guitar-8-standard','8-string guitar','F# standard',[64,59,55,50,45,40,35,30]],
    ['guitar-8-drop-e','8-string guitar','Drop E',[64,59,55,50,45,40,35,28]],
    ['bass-4-standard','Bass','4-string standard',[43,38,33,28]],
    ['bass-drop-d','Bass','Drop D',[43,38,33,26]],
    ['bass-5-standard','Bass','5-string standard',[43,38,33,28,23]],
    ['bass-6-standard','Bass','6-string standard',[48,43,38,33,28,23]],
    ['bass-half-step-down','Bass','Half-step down',[42,37,32,27]],
    ['ukulele-standard','Ukulele','Standard (high G)',[67,64,60,55]],
    ['ukulele-baritone','Ukulele','Baritone',[62,57,53,48]],
    ['mandolin-standard','Mandolin','Standard',[76,69,62,55]],
    ['banjo-open-g','Banjo','Open G 5-string',[62,59,55,50,67]],
    ['violin-standard','Violin','Standard',[76,69,62,55]],
    ['viola-standard','Viola','Standard',[69,62,55,48]],
    ['cello-standard','Cello','Standard',[57,50,43,36]]
  ].map(([id,instrument,name,pitches])=>({id,instrument,name,pitches}));
  const NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  function noteName(midi) {
    if (!Number.isInteger(midi)) throw new TypeError('MIDI pitch must be an integer.');
    return NAMES[((midi%12)+12)%12]+(Math.floor(midi/12)-1);
  }
  function parsePitch(text) {
    const match=/^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(text).trim());
    if (!match) throw new TypeError('Invalid pitch: '+text);
    const letter=match[1].toUpperCase(), octave=Number(match[3]);
    if (octave < -1 || octave > 9) throw new RangeError('Pitch octave must be -1..9.');
    const base={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[letter]+(match[2]==='#'?1:match[2]==='b'?-1:0);
    return (octave+1)*12+base;
  }
  function pitchesToText(pitches) { return pitches.slice().reverse().map(p=>noteName(p).replace(/\d+$/,'')).join(' '); }
  function identify(pitches) { return PRESETS.find(p=>p.pitches.length===pitches.length && p.pitches.every((n,i)=>n===pitches[i])) || null; }
  function refret(notes, oldPitches, newPitches, mode='keep-pitch') {
    if (!['keep-frets','keep-pitch'].includes(mode)) throw new TypeError("mode must be 'keep-frets' or 'keep-pitch'.");
    const result=[]; let moved=0,dropped=0;
    for (const note of notes) {
      const index=oldPitches.length-note.string;
      if (!Number.isInteger(index) || index<0 || index>=oldPitches.length || note.fret<0) { dropped++; continue; }
      if (mode==='keep-frets') { result.push({...note}); continue; }
      const target=oldPitches[index]+note.fret, fret=target-newPitches[index];
      if (fret>=0 && fret<=24) result.push({...note,fret});
      else {
        const replacement=newPitches.findIndex(p=>target-p>=0 && target-p<=24);
        if (replacement<0) { dropped++; continue; }
        result.push({...note,string:newPitches.length-replacement,fret:target-newPitches[replacement]}); moved++;
      }
    }
    return {notes:result,moved,dropped};
  }
  return {PRESETS,noteName,parsePitch,pitchesToText,identify,refret};
});
