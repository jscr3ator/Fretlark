'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const at = require('./public/editor/vendor/alphaTab.js');
const { trackTex } = require('./public/editor/midi-drums.js');
const settings = new at.Settings();
const bars = [{ start: 0, end: 16 }, { start: 16, end: 32 }];

function load(notes, boundaries, time = '4 4') {
  const guitarRests = boundaries.map(bar => bar.end - bar.start === 12 ? 'r.2{d} |' : 'r.1 |').join(' ');
  const tex = '\\title "t" \\tempo 120\n\\track "g" \\staff {tabs} ' +
    '\\tuning (e4 b3 g3 d3 a2 e2) \\ts (' + time + ') ' + guitarRests + '\n' +
    trackTex(notes, { stepTicks: 120, bars: boundaries });
  const score = at.importer.ScoreLoader.loadAlphaTex(tex, settings);
  const midi = new at.midi.MidiFile();
  midi.format = at.midi.MidiFileFormat.MultiTrack;
  new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(midi, true)).generate();
  const hits = midi.tracks.flatMap(track => track.events)
    .filter(event => event.channel === 9 && event.constructor.name === 'NoteOnEvent' && event.noteVelocity > 0)
    .map(event => [event.tick, event.noteKey, event.noteVelocity]);
  return { score, hits, tex };
}

const notes = [];
for (let step = 0; step < 32; step += 2) {
  const velocity = step === 2 ? 0.15 : 0.85;
  notes.push({ midi: 42, ticks: step * 120, durationTicks: 100, velocity });
  if (step % 8 === 0) notes.push({ midi: 36, ticks: step * 120, durationTicks: 100, velocity });
  if (step % 8 === 4) notes.push({ midi: 38, ticks: step * 120, durationTicks: 100, velocity });
}
const rock = load(notes, bars);
assert.equal(rock.score.tracks[1].isPercussion, true);
assert.equal(rock.score.tracks[1].staves[0].bars.length, 2);
assert.deepEqual(rock.hits.map(([tick, key]) => [tick, key]).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  notes.map(note => [note.ticks * 2, note.midi]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
assert.ok(rock.hits.find(([tick, key]) => tick === 480 && key === 42)[2] <
  rock.hits.find(([tick, key]) => tick === 0 && key === 42)[2]);
const empty = load([], bars);
assert.equal(empty.hits.length, 0);
assert.ok(empty.score.tracks[1].staves[0].bars.every(bar => bar.voices[0].beats.every(beat => beat.isRest)));
const three = load([{ midi: 38, ticks: 7 * 120, durationTicks: 1, velocity: 0.5 }], [{ start: 0, end: 12 }], '3 4');
assert.deepEqual(three.hits.map(([tick, key]) => [tick, key]), [[1680, 38]]);
assert.equal(three.score.tracks[1].staves[0].bars.length, 1);

// A long gap splits into a hit followed by rests, never repeated strikes or ties.
const sparse = load([{ midi: 49, ticks: 120, durationTicks: 1, velocity: 0.9 }], bars);
assert.deepEqual(sparse.hits.map(([tick, key]) => [tick, key]), [[240, 49]]);
const barNotes = sparse.score.tracks[1].staves[0].bars.flatMap(bar => bar.voices[0].beats.flatMap(beat => beat.notes));
assert.ok(barNotes.every(note => !note.isTieDestination));
const quantized = load([{ midi: 46, ticks: 182, durationTicks: 1, velocity: 0.3 },
  { midi: 51, ticks: 239, durationTicks: 1, velocity: 0.9 }], [bars[0]]);
assert.deepEqual(quantized.hits.map(([tick, key]) => [tick, key]).sort((a, b) => a[1] - b[1]), [[480, 46], [480, 51]]);
// Hits that share a beat keep their own strength: the soft hi-hat stays softer than the ride.
assert.ok(quantized.hits.find(hit => hit[1] === 46)[2] < quantized.hits.find(hit => hit[1] === 51)[2]);
// A kick and a much softer hi-hat on one beat: the hi-hat becomes a ghost note.
{
  const tex = trackTex([{ midi: 36, ticks: 0, velocity: 0.9 }, { midi: 42, ticks: 0, velocity: 0.5 }], { stepTicks: 120, bars: [bars[0]] });
  assert.match(tex, /\(36 42\{g\}\)/);
}
// Small velocity changes (humanized playing) give one dynamic and no per-note marks.
{
  const groove = [];
  for (let bar = 0; bar < 4; bar++) for (let step = 0; step < 16; step += 2) {
    groove.push({ midi: 42, ticks: (bar * 16 + step) * 120, velocity: 0.55 + ((bar * 16 + step) % 5) * 0.03 });
  }
  const grooveBars = Array.from({ length: 4 }, (_, i) => ({ start: i * 16, end: (i + 1) * 16 }));
  const tex = trackTex(groove, { stepTicks: 120, bars: grooveBars });
  assert.equal((tex.match(/dy /g) || []).length, 1, 'one dynamic for a steady groove');
  assert.ok(!/\{(g|ac|hac)\}/.test(tex), 'no ghost or accent marks for small changes');
}
assert.equal(trackTex([{ midi: 200, ticks: 0, velocity: 0.5 }], { stepTicks: 120, bars: [bars[0]] }).includes('(87)'), true);
let seed = 123456;
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
const many = Array.from({ length: 10000 }, () => ({ midi: 35 + Math.floor(random() * 53), ticks: Math.floor(random() * 16000) * 120, velocity: random() }));
const manyBars = Array.from({ length: 1000 }, (_, i) => ({ start: i * 16, end: (i + 1) * 16 }));
const start = performance.now();
trackTex(many, { stepTicks: 120, bars: manyBars });
assert.ok(performance.now() - start < 1000, '10,000 hits must convert in under 1 second');
console.log('PASS: midi drums');
