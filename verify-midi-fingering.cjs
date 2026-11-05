const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { assign } = require('./public/editor/midi-fingering.js');
const tuning = [64, 59, 55, 50, 45, 40];

function check(group, pitches, strings = tuning, maxFret = 24) {
  assert.equal(group.length, pitches.length);
  assert.deepEqual(group.map(note => note.pitch).sort((a, b) => a - b), pitches.slice().sort((a, b) => a - b));
  assert.equal(new Set(group.map(note => note.string)).size, group.length);
  for (const note of group) {
    assert.ok(note.string >= 1 && note.string <= strings.length);
    assert.ok(note.fret >= 0 && note.fret <= maxFret);
    assert.equal(strings[note.string - 1] + note.fret, note.pitch);
  }
}
function span(group) {
  const frets = group.map(note => note.fret).filter(Boolean);
  return frets.length ? Math.max(...frets) - Math.min(...frets) : 0;
}

const singles = Array.from({ length: 49 }, (_, i) => [40 + i]);
assign(singles, tuning).forEach((group, i) => check(group, singles[i]));
const chord = [40, 47, 52, 56, 59, 64];
const [eMajor] = assign([chord], tuning);
check(eMajor, chord);
assert.ok(span(eMajor) <= 4);
const scale = [52, 54, 56, 57, 59, 61, 63, 64];
const positions = assign(scale.map(pitch => [pitch]), tuning).map(group => group[0].fret);
assert.ok(Math.max(...positions) - Math.min(...positions) <= 5);
const shifted = assign([[28], [100]], tuning);
check(shifted[0], [40]);
check(shifted[1], [88]);
const crowded = [40, 45, 50, 52, 55, 57, 59, 64];
check(assign([crowded], tuning)[0], [40, 45, 50, 57, 59, 64]);
const bass = [43, 38, 33, 28];
check(assign([[28, 35, 43]], bass)[0], [28, 35, 43], bass);
assert.deepEqual(assign([[], [40], []], tuning).map(group => group.length), [0, 1, 0]);
// Duplicate pitches collapse; notes fighting for one string drop an inner note instead of failing.
assert.deepEqual(assign([[40, 40]], tuning)[0].map(note => note.pitch), [40]);
assert.deepEqual(assign([[40, 41, 64]], tuning)[0].map(note => note.pitch), [40, 64]);
assert.ok(span(assign([[40, 54]], tuning, { maxSpan: 1 })[0]) <= 1);
assert.equal(span(assign([[41, 47]], [40, 42], { maxSpan: 1 })[0]), 4);
const browser = {};
vm.runInNewContext(readFileSync('./public/editor/midi-fingering.js', 'utf8'), browser);
assert.equal(browser.FretlarkFingering.assign([[40]], tuning)[0][0].pitch, 40);
assert.deepEqual(assign([[52], [57]], tuning), assign([[52], [57]], tuning));

let seed = 1234567;
function random(n) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; }
const groups = Array.from({ length: 5000 }, () => {
  const count = 1 + random(3), strings = [0, 1, 2, 3, 4, 5], group = [];
  for (let i = 0; i < count; i++) {
    const index = random(strings.length), string = strings.splice(index, 1)[0];
    group.push(tuning[string] + random(13));
  }
  return group;
});
const start = performance.now();
const output = assign(groups, tuning);
const elapsed = performance.now() - start;
assert.ok(elapsed < 1000, `5000 groups took ${elapsed.toFixed(1)} ms`);
output.forEach((group, i) => check(group, [...new Set(groups[i])]));
console.log('PASS: midi fingering');
