(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChordLibrary = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const notes = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
  const intervals = {'':[0,4,7],m:[0,3,7],'7':[0,4,7,10],maj7:[0,4,7,11],m7:[0,3,7,10],dim:[0,3,6],dim7:[0,3,6,9],aug:[0,4,8],sus2:[0,2,7],sus4:[0,5,7],'5':[0,7],'6':[0,4,7,9],m6:[0,3,7,9],'9':[0,4,7,10,14],add9:[0,4,7,14],m7b5:[0,3,6,10],'7sus4':[0,5,7,10]};
  function pitch(note) { return (notes[note[0]] + (note[1] === '#' ? 1 : note[1] === 'b' ? -1 : 0) + 12) % 12; }
  function parseChordName(name) {
    if (typeof name !== 'string') return null;
    const match = /^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/.exec(name.trim());
    if (!match) return null;
    let quality = match[2];
    quality = quality.replace(/^min/, 'm').replace(/^-/, 'm').replace(/^M7$/, 'maj7').replace(/^Δ7?$/, 'maj7').replace(/^ø7?$/, 'm7b5').replace(/^°/, 'dim').replace(/^\+$/, 'aug');
    return Object.hasOwn(intervals, quality) ? {root:match[1], quality, bass:match[3] || null} : null;
  }
  function chordTones(parsed) {
    if (!parsed || !Object.hasOwn(intervals, parsed.quality) || !/^[A-G][#b]?$/.test(parsed.root)) return [];
    return intervals[parsed.quality].map(n => (pitch(parsed.root) + n) % 12);
  }
  // alphaTab tuning and Chord.strings both start with the highest string.
  const standard = '64,59,55,50,45,40';
  const openShapes = {C:'x32010',D:'xx0232',E:'022100',G:'320003',A:'x02220',Am:'x02210',Em:'022000',Dm:'xx0231',F:'133211',B7:'x21202'};
  function voicings(name, tuning, options = {}) {
    const parsed = parseChordName(name);
    if (!parsed || !Array.isArray(tuning) || !tuning.length || !tuning.every(Number.isInteger)) return [];
    const tones = chordTones(parsed), bass = pitch(parsed.bass || parsed.root);
    const allowed = new Set([...tones, bass]);
    const required = tones.filter((n, i) => !(tones.length >= 4 && intervals[parsed.quality][i] === 7));
    const results = [], seen = new Set(), frets = Array(tuning.length).fill(-1);
    function collect() {
      const sounding = frets.map((f,i) => f < 0 ? null : tuning[i]+f).filter(n => n !== null);
      if (!sounding.length || (Math.min(...sounding) % 12 + 12) % 12 !== bass || !required.every(t => sounding.some(n => (n % 12 + 12) % 12 === t))) return;
      const key = frets.join(','); if (seen.has(key)) return; seen.add(key);
      const pressed = frets.filter(f => f > 0), barre = [];
      for (const f of new Set(pressed)) {
        const indices = frets.map((v,i) => v === f ? i : -1).filter(i => i >= 0);
        if (indices.length > 1 && (indices.length > 2 || indices.at(-1) - indices[0] > 1) && frets.slice(indices[0], indices.at(-1)+1).every(v => v >= f)) barre.push(f);
      }
      const fingers = pressed.length - barre.reduce((n,f) => n + frets.filter(v => v === f).length - 1, 0);
      if (fingers > 4) return;
      const firstFret = pressed.length && Math.max(...pressed) > 4 ? Math.min(...pressed) : 1;
      const opens = frets.filter(f => f === 0).length;
      const score = fingers * 10 + firstFret * 2 - opens * 3 + frets.filter(f => f < 0).length;
      results.push({diagram:{frets:frets.slice(), firstFret, barre}, score});
    }
    for (let start = 1; start <= 15; start++) {
      const choices = tuning.map(note => [-1, ...Array.from({length:Math.min(4,16-start)}, (_,i) => start+i), 0].filter(f => f < 0 || allowed.has(((note+f)%12+12)%12)));
      function search(i, state) {
        if (i === tuning.length) { collect(); return; }
        for (const f of choices[i]) {
          if (f >= 0 && state === 2) continue;
          frets[i] = f; search(i+1, f < 0 ? (state === 1 ? 2 : state) : 1);
        }
      }
      search(0,0);
    }
    const preferred = tuning.join(',') === standard && !parsed.bass && openShapes[parsed.root + parsed.quality];
    const preferredKey = preferred && [...preferred].reverse().map(c => c === 'x' ? -1 : Number(c)).join(',');
    results.sort((a,b) => (a.diagram.frets.join(',') === preferredKey ? -1 : b.diagram.frets.join(',') === preferredKey ? 1 : a.score-b.score) || a.diagram.frets.join(',').localeCompare(b.diagram.frets.join(',')));
    const limit = Number.isInteger(options.limit) ? Math.max(0, Math.min(6, options.limit)) : 6;
    return results.slice(0,limit).map(x => x.diagram);
  }
  function toAlphaTabChord(at, name, diagram) {
    const chord = new at.model.Chord();
    chord.name = name; chord.firstFret = diagram.firstFret; chord.strings = diagram.frets.slice();
    chord.barreFrets = diagram.barre.slice(); chord.showDiagram = true; chord.showName = true;
    return chord;
  }
  return {parseChordName, chordTones, voicings, toAlphaTabChord};
});
