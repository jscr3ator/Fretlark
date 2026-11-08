const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const at = require('./public/editor/vendor/alphaTab.js');

// The fingering panel maps a beat in a simile (%) bar back to the repeated bar's
// beat playing at the same offset within the bar. player.js implements this in the
// plain top-level function repeatedBeats(beats, offset), wired up in updateHand.
const code = fs.readFileSync('public/player.js', 'utf8');
function block(name, next) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists in player.js');
  const end = code.indexOf('function ' + next + '(', start);
  assert.ok(end > start, next + ' follows ' + name + ' in player.js');
  return code.slice(start, end);
}
const repeatedSrc = block('repeatedBeats', 'updateHand');
const repeatedBeats = new Function(repeatedSrc + '; return repeatedBeats;')();

const load = tex => at.importer.ScoreLoader.loadAlphaTex(tex);
const staffOf = score => score.tracks[0].staves[0];
const firstBeats = bar => bar.voices[0].beats;

// A Simple simile bar after a bar of chords maps to the previous bar's beats:
// offset 0 picks the first beat, a mid-bar offset picks the beat whose
// playbackStart is the last one <= offset (the beat actually playing there).
{
  const staff = staffOf(load('3.3.4 3.3.4 1.3.4 1.3.4 | \\simile Simple . |'));
  assert.equal(staff.bars[1].simileMark, at.model.SimileMark.Simple);
  const src = firstBeats(staff.bars[0]), placeholder = firstBeats(staff.bars[1])[0];
  assert.ok(placeholder.isEmpty || placeholder.isRest, 'simile bar holds a placeholder beat');
  assert.deepEqual(src.map(b => b.playbackStart), [0, 960, 1920, 2880]);
  assert.equal(repeatedBeats([placeholder], 0)[0], src[0], 'offset 0 maps to the first repeated beat');
  assert.equal(repeatedBeats([placeholder], src[1].playbackStart)[0], src[1], 'exact beat boundary maps to that beat');
  const mid = src[2].playbackStart + 10;
  const mapped = repeatedBeats([placeholder], mid)[0];
  assert.equal(mapped, src[2], 'mid-bar offset maps to the beat playing at that offset');
  assert.ok(mapped.notes.length > 0, 'mapped beat carries the repeated notes (panel shows fingers, not Rest)');
}

// FirstOfDouble / SecondOfDouble map to the bar two before (the two bars repeat
// the two bars before them, so the first repeat bar replays bar i-2 and so does
// the second from its own position).
{
  const staff = staffOf(load('3.3.4 | 2.3.4 | \\simile FirstOfDouble . | \\simile SecondOfDouble . |'));
  assert.deepEqual(staff.bars.map(b => b.simileMark), [0, 0, 2, 3]);
  const a = firstBeats(staff.bars[0]), b = firstBeats(staff.bars[1]);
  const first = firstBeats(staff.bars[2])[0], second = firstBeats(staff.bars[3])[0];
  assert.equal(repeatedBeats([first], 0)[0], a[0], 'FirstOfDouble maps two bars back');
  assert.equal(repeatedBeats([second], 0)[0], b[0], 'SecondOfDouble maps two bars back');
}

// A simile bar after another simile bar follows the chain back to real notes.
{
  const staff = staffOf(load('3.3.4 | \\simile Simple . | \\simile Simple . |'));
  const real = firstBeats(staff.bars[0]);
  for (const index of [1, 2]) {
    const placeholder = firstBeats(staff.bars[index])[0];
    assert.equal(repeatedBeats([placeholder], 0)[0], real[0], 'chained simile bar ' + index + ' resolves to real notes');
  }
}

// Normal beats pass through untouched, including a real written rest.
{
  const staff = staffOf(load('3.3.4 r.2 1.3.4 | 2.3.4 |'));
  for (const beat of firstBeats(staff.bars[0])) {
    assert.equal(repeatedBeats([beat], 9999)[0], beat, 'normal beat is returned unchanged');
  }
  const rest = firstBeats(staff.bars[0])[1];
  assert.ok(rest.isRest && !rest.isEmpty && rest.notes.length === 0, 'fixture has a real written rest');
  assert.equal(repeatedBeats([rest], 0)[0], rest, 'a real written rest stays a rest');
}

// A simile bar at the very start of a staff has nothing to repeat: the original
// beat comes back, with no crash. Built the way the task describes for scores
// that cannot come from alphaTex: set simileMark directly, then finish().
{
  const score = load('. | 3.3.4 |');
  staffOf(score).bars[0].simileMark = at.model.SimileMark.Simple;
  score.finish(new at.Settings());
  const placeholder = firstBeats(staffOf(score).bars[0])[0];
  assert.ok(placeholder.isEmpty || placeholder.isRest, 'leading simile bar holds a placeholder beat');
  assert.equal(repeatedBeats([placeholder], 0)[0], placeholder, 'nothing to repeat returns the original beat');
}

// updateHand wiring: the offset is ticks since the highlighted beat started
// (api.tickPosition minus the lookup's absolute start), i.e. the position within
// the repeated bar. A bar-relative beatLookup.start must not leak in, or every
// mid-bar position maps to the last beat of the repeated bar.
{
  const score = load('3.3.4 3.3.4 1.3.4 1.3.4 | \\simile Simple . |');
  const staff = staffOf(score), track = score.tracks[0];
  const settings = new at.Settings();
  const generator = new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(new at.midi.MidiFile()));
  generator.generate();
  const cache = generator.tickLookup;
  const barStart = cache.masterBars[1].start;
  assert.ok(barStart > 0, 'simile bar starts after the first bar');
  const src = firstBeats(staff.bars[0]);
  const sandbox = {
    handVisible: true,
    api: { tickCache: cache, tickPosition: 0, playbackSpeed: 1 },
    guideTrack: () => track,
    handGuide: { update(t, beats) { sandbox.captured = beats; return null; } },
    handContext: () => null,
    captured: null,
    simileBeat: firstBeats(staff.bars[1])[0],
    $: () => ({ textContent: '', hidden: true }),
  };
  vm.createContext(sandbox);
  vm.runInContext(repeatedSrc + '\n' + block('updateHand', 'handAtCursor'), sandbox);
  const updateAt = tick => {
    sandbox.api.tickPosition = tick;
    sandbox.captured = null;
    vm.runInContext('updateHand([simileBeat]);', sandbox);
    return sandbox.captured;
  };
  assert.equal(updateAt(barStart)[0], src[0], 'bar start shows the first repeated beat');
  const midTick = barStart + src[2].playbackStart + 10;
  assert.equal(updateAt(midTick)[0], src[2], 'mid-bar position shows the beat playing at that offset, not the last beat');
}

console.log('PASS: simile bars map to the repeated beats at offset 0 and mid-bar, doubles map two back, chains resolve, rests pass through, leading simile is safe, updateHand offsets within the bar.');
