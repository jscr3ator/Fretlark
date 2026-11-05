'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const at = require('./public/editor/vendor/alphaTab.js');
const { Midi } = require('./public/editor/vendor/tonejs-midi.js');
const midiImport = require('./public/editor/midi-import.js');

const settings = new at.Settings();
const fixtures = path.join(__dirname, 'test', 'fixtures', 'midi');
fs.mkdirSync(fixtures, { recursive: true });

// Small, deterministic fallback for FretlarkFingering.assign if the parallel
// module is not available. When it is present, use the real implementation.
const fallbackFingering = {
  assign(groups, tuning) {
    return groups.map((pitches) => {
      if (!pitches.length) return [];
      const used = new Set();
      const result = [];
      const sorted = pitches.slice().sort((a, b) => b - a);
      for (const pitch of sorted) {
        let found = null;
        for (const shift of [0, 12, -12, 24, -24]) {
          for (let string = 1; string <= tuning.length && !found; string++) {
            if (used.has(string)) continue;
            const fret = pitch + shift - tuning[string - 1];
            if (fret >= 0 && fret <= 24) found = { pitch: pitch + shift, string, fret };
          }
          if (found) break;
        }
        if (found) {
          used.add(found.string);
          result.push(found);
        }
      }
      return result;
    });
  }
};

let assignCalls = 0;
let hasRealFingering = false;
let fingering = fallbackFingering;
try {
  const realFingering = require('./public/editor/midi-fingering.js');
  hasRealFingering = true;
  fingering = {
    assign(groups, tuning, options) {
      assignCalls++;
      return realFingering.assign(groups, tuning, options);
    }
  };
} catch (e) { /* use the fallback above */ }

function buildMidi({ tempos = [[0, 120]], timeSignatures = [[0, [4, 4]]], tracks = [] }) {
  const midi = new Midi();
  for (const [ticks, bpm] of tempos) midi.header.tempos.push({ ticks, bpm });
  for (const [ticks, timeSignature] of timeSignatures) {
    midi.header.timeSignatures.push({ ticks, timeSignature, measures: 0 });
  }
  for (const spec of tracks) {
    const track = midi.addTrack();
    if (spec.name) track.name = spec.name;
    track.channel = spec.channel == null ? 0 : spec.channel;
    track.instrument.number = spec.program == null ? 0 : spec.program;
    for (const note of spec.notes) {
      if (Array.isArray(note)) {
        track.addNote({ midi: note[0], ticks: note[1], durationTicks: note[2], velocity: 64 / 127 });
      } else {
        track.addNote({
          midi: note.midi,
          ticks: note.ticks,
          durationTicks: note.durationTicks,
          velocity: note.velocity == null ? 64 / 127 : note.velocity
        });
      }
    }
    for (const change of spec.cc || []) {
      track.addCC({ number: change.number, ticks: change.ticks, value: change.value });
    }
  }
  return midi.toArray();
}

let hasDrumImporter = false;
try {
  hasDrumImporter = typeof require('./public/editor/midi-drums.js').trackTex === 'function';
} catch (e) { /* drums are optional */ }

function fixture(name, spec) {
  const bytes = buildMidi(spec);
  assert.ok(bytes.length < 20 * 1024, name + ' fixture must stay under 20 KB');
  fs.writeFileSync(path.join(fixtures, name), bytes);
  return fs.readFileSync(path.join(fixtures, name));
}

function convert(bytes, fileName) {
  return midiImport.toAlphaTex(bytes, { fileName, fingering });
}

function load(tex) {
  return at.importer.ScoreLoader.loadAlphaTex(tex, settings);
}

function beatsOf(score, trackIndex) {
  const beats = [];
  const staff = score.tracks[trackIndex].staves[0];
  for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) beats.push(beat);
  return beats;
}

function notesOf(score, trackIndex) {
  const notes = [];
  const staves = score.tracks[trackIndex].staves;
  for (const staff of staves) for (const bar of staff.bars) for (const voice of bar.voices) {
    for (const beat of voice.beats) for (const note of beat.notes) {
      notes.push({ pitch: note.realValue, string: note.string, fret: note.fret, beat });
    }
  }
  return notes;
}

function barTempo(score, index) {
  const masterBar = score.masterBars[index];
  const automations = masterBar.tempoAutomations || [];
  return automations.length ? automations[automations.length - 1].value : score.tempo;
}

// ---------------------------------------------------------------------------
// 1. One-track C major scale, quarter notes, 100 BPM, 4/4.
const scaleMidi = fixture('c-scale.mid', {
  tempos: [[0, 100]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [{
    name: 'Scale', program: 25, channel: 0,
    notes: [60, 62, 64, 65, 67, 69, 71, 72].map((pitch, i) => [pitch, i * 480, 480])
  }]
});
{
  const result = convert(scaleMidi, 'c-scale.mid');
  const score = load(result.tex);
  assert.equal(result.stats.tracks, 1);
  assert.equal(result.stats.bars, 2);
  assert.equal(result.stats.notes, 8);
  assert.equal(score.tracks.length, 1);
  assert.equal(score.masterBars.length, 2);
  assert.equal(barTempo(score, 0), 100);
  const notes = notesOf(score, 0);
  assert.deepEqual(notes.map((note) => note.pitch), [60, 62, 64, 65, 67, 69, 71, 72]);
  assert.equal(beatsOf(score, 0).length, 8);
  for (const beat of beatsOf(score, 0)) assert.equal(beat.duration, 4);
}

// ---------------------------------------------------------------------------
// 2. Three-note chords start together and become one beat on three strings.
const chordMidi = fixture('chords.mid', {
  tempos: [[0, 120]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [{
    name: 'Chords', program: 25, channel: 0,
    notes: [
      [60, 0, 480], [64, 0, 480], [67, 0, 480],
      [62, 480, 480], [65, 480, 480], [69, 480, 480],
      [64, 960, 480], [67, 960, 480], [72, 960, 480]
    ]
  }]
});
{
  const result = convert(chordMidi, 'chords.mid');
  const score = load(result.tex);
  const beats = beatsOf(score, 0);
  assert.equal(beats.length, 4);
  for (let i = 0; i < 3; i++) {
    assert.equal(beats[i].notes.length, 3);
    assert.equal(new Set(beats[i].notes.map((note) => note.string)).size, 3);
    assert.equal(beats[i].duration, 4);
  }
  assert.ok(beats[3].isRest);
  assert.deepEqual(
    notesOf(score, 0).slice(0, 3).map((note) => note.pitch).sort((a, b) => a - b),
    [60, 64, 67]
  );
}

// ---------------------------------------------------------------------------
// 3. A humanized melody quantizes to exactly the same alphaTex as the clean one.
const humanizedMidi = fixture('c-scale-humanized.mid', {
  tempos: [[0, 100]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [{
    name: 'Scale', program: 25, channel: 0,
    notes: [60, 62, 64, 65, 67, 69, 71, 72].map((pitch, i) => ({
      midi: pitch,
      ticks: i * 480 + [2, -1, 3, -2, 1, -3, 2, -1][i],
      durationTicks: 480
    }))
  }]
});
{
  const clean = convert(scaleMidi, 'same.mid');
  const humanized = convert(humanizedMidi, 'same.mid');
  assert.equal(humanized.tex, clean.tex);
}

// ---------------------------------------------------------------------------
// 4. A note crossing a bar line becomes two tied notes.
const crossingMidi = fixture('cross-bar.mid', {
  tempos: [[0, 120]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [{
    name: 'Crossing', program: 25, channel: 0,
    notes: [[60, 0, 480], [67, 1440, 960]]
  }]
});
{
  const result = convert(crossingMidi, 'cross-bar.mid');
  const score = load(result.tex);
  assert.equal(score.masterBars.length, 2);
  const crossing = notesOf(score, 0).filter((note) => note.pitch === 67);
  assert.equal(crossing.length, 2);
  assert.ok(crossing[0].beat.notes.find((note) => note.realValue === 67).tieDestination);
  assert.ok(crossing[1].beat.notes.find((note) => note.realValue === 67).tieOrigin);
  assert.equal(crossing[0].string, crossing[1].string);
  assert.equal(crossing[0].fret, crossing[1].fret);
  assert.equal(crossing[0].beat.duration + crossing[1].beat.duration, 8);
}

// Dotted values replace tied pairs: dotted quarter + eighth, eighth-quarter-eighth syncopation, dotted half + quarter.
{
  const bytes = buildMidi({ tracks: [{ name: 'Dots', program: 25, notes: [
    [60, 0, 720], [62, 720, 240], [64, 960, 240], [65, 1200, 480], [67, 1680, 240],
    [69, 1920, 1440], [71, 3360, 480]
  ] }] });
  const score = load(convert(bytes, 'dots.mid').tex);
  const beats = beatsOf(score, 0);
  assert.deepEqual(beats.map((beat) => [beat.duration, beat.dots]), [[4, 1], [8, 0], [8, 0], [4, 0], [8, 0], [2, 1], [4, 0]]);
  assert.ok(beats.every((beat) => beat.notes.every((note) => !note.isTieDestination)), 'No ties needed');
}

// Short notes keep their real length: a 16th on an 8th pulse is a 16th + 16th rest,
// not a stretched 8th or a gap absorbed by the next note.
{
  const shortMidi = fixture('short-notes.mid', {
    tempos: [[0, 120]],
    timeSignatures: [[0, [4, 4]]],
    tracks: [{
      name: 'Short', program: 33, channel: 0,
      notes: Array.from({ length: 8 }, (_, i) => [60 + (i % 3), i * 240, 120])
    }]
  });
  const result = convert(shortMidi, 'short-notes.mid');
  const score = load(result.tex);
  const beats = beatsOf(score, 0);
  assert.equal(beats.length, 16);
  for (let i = 0; i < 8; i++) {
    assert.equal(beats[i * 2].notes.length, 1, 'short note ' + i + ' stays a single note');
    assert.equal(beats[i * 2].duration, 16, '16th note stays a 16th');
    assert.equal(beats[i * 2].dots, 0);
    assert.ok(beats[i * 2 + 1].isRest, 'the gap after short note ' + i + ' is a rest');
    assert.equal(beats[i * 2 + 1].duration, 16, 'the gap stays a 16th rest');
  }
}

// A 32nd stab stays short instead of being rounded up to a 16th.
{
  const stabMidi = fixture('32nd-stab.mid', {
    tempos: [[0, 120]],
    timeSignatures: [[0, [4, 4]]],
    tracks: [{
      name: 'Stab', program: 56, channel: 0,
      notes: [[60, 0, 60], [62, 480, 60], [64, 960, 60]]
    }]
  });
  const result = convert(stabMidi, '32nd-stab.mid');
  const score = load(result.tex);
  const sounded = beatsOf(score, 0).filter((beat) => !beat.isRest && beat.notes.length);
  assert.deepEqual(sounded.map((beat) => beat.duration), [32, 32, 32]);
  assert.ok(sounded.every((beat) => beat.dots === 0));
}

// Fast runs stay melodic: notes about 0.8 of a 16th apart must not collapse into
// false chords on one 16th onset.
{
  const runMidi = fixture('fast-run.mid', {
    tempos: [[0, 120]],
    timeSignatures: [[0, [4, 4]]],
    tracks: [{
      name: 'Run', program: 73, channel: 0,
      notes: [60, 62, 64, 66, 68].map((pitch, i) => ({
        midi: pitch,
        ticks: i * 96,
        durationTicks: 96
      }))
    }]
  });
  const result = convert(runMidi, 'fast-run.mid');
  const score = load(result.tex);
  const sounded = beatsOf(score, 0).filter((beat) => !beat.isRest && beat.notes.length);
  assert.deepEqual(sounded.map((beat) => beat.notes.map((note) => note.realValue)), [[60], [62], [64], [66], [68]]);
  assert.ok(sounded.every((beat) => beat.notes.length === 1), 'the run stays a run, never a chord');
  const onsets = sounded.map((beat) => beat.playbackStart);
  assert.equal(new Set(onsets).size, onsets.length, 'every run note keeps its own onset');
}

// ---------------------------------------------------------------------------
// 5. 3/4 time signature and a tempo change at bar 4.
const waltzMidi = fixture('waltz-tempo.mid', {
  tempos: [[0, 90], [4320, 120]],
  timeSignatures: [[0, [3, 4]]],
  tracks: [{
    name: 'Waltz', program: 25, channel: 0,
    notes: Array.from({ length: 18 }, (_, i) => [60 + (i % 3), i * 480, 480])
  }]
});
{
  const result = convert(waltzMidi, 'waltz-tempo.mid');
  const score = load(result.tex);
  assert.equal(score.masterBars.length, 6);
  for (const masterBar of score.masterBars) {
    assert.equal(masterBar.timeSignatureNumerator, 3);
    assert.equal(masterBar.timeSignatureDenominator, 4);
  }
  assert.equal(barTempo(score, 0), 90);
  assert.equal(barTempo(score, 3), 120);
  const beats = beatsOf(score, 0);
  assert.equal(beats.length, 18);
  for (const beat of beats) assert.equal(beat.duration, 4);
}

// A tempo change in the middle of a bar keeps its ratio position.
const midBarTempoMidi = fixture('mid-bar-tempo.mid', {
  tempos: [[0, 120], [960, 180]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [{
    name: 'Mid tempo', program: 25, channel: 0,
    notes: Array.from({ length: 8 }, (_, i) => [60 + (i % 3), i * 480, 480])
  }]
});
{
  const result = convert(midBarTempoMidi, 'mid-bar-tempo.mid');
  const score = load(result.tex);
  const automation = score.masterBars[0].tempoAutomations.find((item) => item.ratioPosition === 0.5);
  assert.ok(automation, 'mid-bar tempo automation at ratio 0.5');
  assert.equal(automation.value, 180);
}

// ---------------------------------------------------------------------------
// 6. Bass gets four-string bass tuning; percussion is skipped with a warning.
const bassMidi = fixture('bass-drums.mid', {
  tempos: [[0, 110]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [
    {
      name: 'Bass', program: 33, channel: 1,
      notes: [[28, 0, 480], [33, 480, 480], [38, 960, 480], [43, 1440, 480]]
    },
    {
      name: 'Drums', program: 0, channel: 9,
      notes: [[36, 0, 480], [38, 480, 480], [42, 960, 480]]
    }
  ]
});
{
  const result = convert(bassMidi, 'bass-drums.mid');
  assert.equal(result.stats.tracks, 1);
  const score = load(result.tex);
  assert.deepEqual(score.tracks[0].staves[0].stringTuning.tunings, [43, 38, 33, 28]);
  assert.deepEqual(notesOf(score, 0).map((note) => note.pitch), [28, 33, 38, 43]);
  if (hasDrumImporter) {
    // Drum tracks are appended last through FretlarkMidiDrums.
    assert.equal(score.tracks.length, 2);
    assert.ok(score.tracks[1].staves[0].isPercussion, 'drum track should be percussion');
    assert.ok(!result.warnings.some((warning) => /drum track was skipped/.test(warning)));
  } else {
    assert.equal(score.tracks.length, 1);
    assert.ok(result.warnings.some((warning) => /drum track was skipped/.test(warning)));
  }
}

// ---------------------------------------------------------------------------
// 7. Velocity becomes beat dynamics (the loudest note of a chord wins).
const dynamicsMidi = fixture('dynamics.mid', {
  tempos: [[0, 120]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [{
    name: 'Dynamics', program: 25, channel: 0,
    notes: [
      { midi: 60, ticks: 0, durationTicks: 480, velocity: 10 / 127 },
      { midi: 64, ticks: 0, durationTicks: 480, velocity: 120 / 127 },
      { midi: 62, ticks: 480, durationTicks: 480, velocity: 10 / 127 },
      { midi: 65, ticks: 960, durationTicks: 480, velocity: 110 / 127 }
    ]
  }]
});
{
  const result = convert(dynamicsMidi, 'dynamics.mid');
  const score = load(result.tex);
  const beats = beatsOf(score, 0);
  assert.equal(beats[0].dynamics, at.model.DynamicValue.FFF, 'loudest note of chord -> loud dynamic');
  assert.equal(beats[1].dynamics, at.model.DynamicValue.PPP, 'quiet note -> soft dynamic');
  assert.ok(beats[2].dynamics >= at.model.DynamicValue.FF, 'loud note -> loud dynamic');
  assert.ok(new Set(beats.map((beat) => beat.dynamics)).size > 1, 'dynamics should vary');
}

// ---------------------------------------------------------------------------
// 8. CC7 volume and CC10 pan become playbackInfo volume/balance; CC11 folds into volume.
const ccMidi = fixture('cc-mix.mid', {
  tempos: [[0, 120]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [
    {
      name: 'Half', program: 25, channel: 0,
      notes: [[60, 0, 480]],
      cc: [
        { number: 7, ticks: 0, value: 0.5 },
        { number: 11, ticks: 0, value: 0.5 },
        { number: 10, ticks: 0, value: 0.75 }
      ]
    },
    {
      name: 'Loud right', program: 25, channel: 1,
      notes: [[62, 0, 480]],
      cc: [
        { number: 7, ticks: 0, value: 0.75 },
        { number: 10, ticks: 0, value: 0.25 }
      ]
    }
  ]
});
{
  const result = convert(ccMidi, 'cc-mix.mid');
  const score = load(result.tex);
  assert.equal(score.tracks.length, 2);
  assert.equal(score.tracks[0].playbackInfo.volume, 4, 'CC7 0.5 * CC11 0.5 -> volume 4/16');
  assert.equal(score.tracks[0].playbackInfo.balance, 12, 'CC10 0.75 -> balance 12/16');
  assert.equal(score.tracks[1].playbackInfo.volume, 12, 'CC7 0.75 -> volume 12/16');
  assert.equal(score.tracks[1].playbackInfo.balance, 4, 'CC10 0.25 -> balance 4/16');
  assert.notEqual(score.tracks[0].playbackInfo.volume, score.tracks[1].playbackInfo.volume);
}

// ---------------------------------------------------------------------------
// 9. A held note under a moving line stays sounding for its full length (voice 2).
const heldMidi = fixture('held-under-line.mid', {
  tempos: [[0, 120]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [{
    name: 'Held', program: 25, channel: 0,
    notes: [
      { midi: 60, ticks: 0, durationTicks: 1920, velocity: 100 / 127 },
      { midi: 67, ticks: 480, durationTicks: 480, velocity: 80 / 127 },
      { midi: 69, ticks: 960, durationTicks: 480, velocity: 60 / 127 }
    ]
  }]
});
{
  const result = convert(heldMidi, 'held-under-line.mid');
  const score = load(result.tex);
  const notes = notesOf(score, 0);
  const held = notes.filter((note) => note.pitch === 60);
  assert.equal(held.length, 1);
  assert.equal(held[0].beat.duration, 1, 'held note lasts a whole bar, not one onset');
  assert.ok(score.tracks[0].staves[0].bars[0].voices.length >= 2, 'moving line is a second voice');
  assert.equal(held[0].beat.voice.index, 1, 'sustained note is written in voice 2');
  assert.equal(new Set(notes.map((note) => note.beat.voice.index)).size, 2);
}

// A played keyboard part: chord notes released a little apart, held a little into
// the next chord, with small velocity wobbles. It stays one clean voice and one dynamic.
const padMidi = fixture('humanized-pads.mid', {
  tracks: [{
    name: 'Pads', program: 4, channel: 0,
    notes: [0, 1, 2, 3].flatMap((chord) => [60, 64, 67].map((midi, i) => ({
      midi: midi + (chord % 2) * 2, ticks: chord * 960 + i * 6, durationTicks: 960 + 40 - i * 50, velocity: (70 + ((chord + i) % 3) * 3) / 127
    })))
  }]
});
{
  const score = load(convert(padMidi, 'humanized-pads.mid').tex);
  const voices = score.tracks[0].staves[0].bars.map((bar) => bar.voices.filter((voice) => voice.beats.some((beat) => !beat.isRest)).length);
  assert.deepEqual(voices, [1, 1], 'humanized chords do not need a second voice');
  const chords = beatsOf(score, 0).filter((beat) => !beat.isRest);
  assert.equal(chords.length, 4, 'each chord is one half-note beat, no ties');
  assert.ok(chords.every((beat) => beat.notes.length === 3 && beat.duration === 2));
  assert.equal(new Set(chords.map((beat) => beat.dynamics)).size, 1, 'small velocity wobbles keep one dynamic');
}

// Sustain pedal keeps notes ringing (and marks them let-ring).
const pedalMidi = fixture('sustain.mid', {
  tempos: [[0, 120]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [{
    name: 'Pedal', program: 25, channel: 0,
    notes: [
      { midi: 60, ticks: 0, durationTicks: 480, velocity: 90 / 127 },
      { midi: 67, ticks: 960, durationTicks: 480, velocity: 90 / 127 }
    ],
    cc: [
      { number: 64, ticks: 0, value: 1 },
      { number: 64, ticks: 1440, value: 0 }
    ]
  }]
});
{
  const result = convert(pedalMidi, 'sustain.mid');
  const score = load(result.tex);
  const notes = notesOf(score, 0);
  const sustained = notes.filter((note) => note.pitch === 60);
  assert.ok(sustained.length >= 1);
  assert.ok(sustained[0].beat.notes.find((note) => note.realValue === 60).isLetRing, 'pedal note is let-ring');
  assert.equal(sustained[0].beat.duration, 2, 'pedal extends the note past its MIDI note-off');
}

// ---------------------------------------------------------------------------
// 10. A high string part (70-92) keeps every exact pitch by picking a wider tuning.
const highMidi = fixture('high-strings.mid', {
  tempos: [[0, 120]],
  timeSignatures: [[0, [4, 4]]],
  tracks: [{
    name: 'Strings', program: 48, channel: 1,
    notes: Array.from({ length: 23 }, (_, i) => [70 + i, i * 240, 240])
  }]
});
{
  const result = convert(highMidi, 'high-strings.mid');
  const score = load(result.tex);
  const pitches = notesOf(score, 0).map((note) => note.pitch);
  assert.deepEqual(pitches, Array.from({ length: 23 }, (_, i) => 70 + i));
  const tuning = score.tracks[0].staves[0].stringTuning.tunings;
  assert.ok(Math.min(...tuning) <= 70);
  assert.ok(Math.max(...tuning) + 24 >= 92);
}

// ---------------------------------------------------------------------------
// 11. Real pop MIDI: every original pitch survives, volumes and dynamics vary.
// Optional: point FRETLARK_REAL_MIDI at a real-world .mid file to run this check.
const realMidi = process.env.FRETLARK_REAL_MIDI;
if (realMidi && fs.existsSync(realMidi)) {
  const bytes = fs.readFileSync(realMidi);
  const parsed = new Midi(bytes);
  const originalTracks = parsed.tracks.filter((track) => track.notes.length && !(track.instrument.percussion || track.channel === 9));
  const result = convert(bytes, 'Never-Gonna-Give-You-Up-1.mid');
  const score = load(result.tex);
  assert.equal(result.stats.tracks, originalTracks.length);
  assert.ok(score.tracks.length >= originalTracks.length);
  for (let i = 0; i < originalTracks.length; i++) {
    const original = new Set(originalTracks[i].notes.map((note) => Math.round(note.midi)));
    const imported = new Set(notesOf(score, i).map((note) => note.pitch));
    const missing = [...original].filter((pitch) => !imported.has(pitch));
    const extra = [...imported].filter((pitch) => !original.has(pitch));
    assert.deepEqual(missing, [], originalTracks[i].name + ': missing pitches');
    assert.deepEqual(extra, [], originalTracks[i].name + ': octave-shifted pitches');
  }
  const volumes = originalTracks.map((_, i) => score.tracks[i].playbackInfo.volume);
  assert.ok(new Set(volumes).size > 1, 'track volumes should differ');
  const dynamics = new Set();
  for (let i = 0; i < originalTracks.length; i++) {
    for (const beat of beatsOf(score, i)) dynamics.add(beat.dynamics);
  }
  assert.ok(dynamics.size > 1, 'dynamics should vary');
  const whistle = score.tracks.find((track) => /whistle/i.test(track.name));
  if (whistle) assert.ok(whistle.playbackInfo.volume < 8, 'WHISTLE should not play at full volume');
  console.log(`real MIDI: ${originalTracks.length} pitched tracks, ${score.tracks.length} score tracks, ${dynamics.size} dynamics, volumes ${volumes.join(',')}`);
}

// ---------------------------------------------------------------------------
// 12. Real round trip through the demo song and alphaTab's own MIDI exporter.
{
  const demoScore = at.importer.ScoreLoader.loadScoreFromBytes(
    new Uint8Array(fs.readFileSync(path.join(__dirname, 'public', 'editor', 'demo.gp'))), settings
  );
  const midiFile = new at.midi.MidiFile();
  midiFile.format = at.midi.MidiFileFormat.MultiTrack;
  const handler = new at.midi.AlphaSynthMidiFileHandler(midiFile, true);
  new at.midi.MidiFileGenerator(demoScore, settings, handler).generate();
  const bytes = midiFile.toBinary();

  const parsed = new Midi(bytes);
  const quartersPerBar = 4;
  let maxTick = 0;
  for (const track of parsed.tracks) for (const note of track.notes) maxTick = Math.max(maxTick, note.ticks + note.durationTicks);
  const midiBars = Math.ceil(maxTick / (parsed.header.ppq * quartersPerBar));

  assignCalls = 0;
  const result = convert(bytes, 'demo.gp.mid');
  const score = load(result.tex);
  const originalTracks = demoScore.tracks.filter((track) => track.playbackInfo.primaryChannel !== 9 && !track.percussion);
  const midiDrumTracks = parsed.tracks.filter((track) => track.notes.length && (track.instrument.percussion || track.channel === 9));
  assert.equal(score.tracks.length, originalTracks.length + (hasDrumImporter ? midiDrumTracks.length : 0));
  if (hasRealFingering) assert.equal(assignCalls, result.stats.tracks);
  assert.ok(Math.abs(score.masterBars.length - midiBars) <= 1, `bars ${score.masterBars.length} vs MIDI ${midiBars}`);

  for (let i = 0; i < originalTracks.length; i++) {
    const original = notesOf(demoScore, demoScore.tracks.indexOf(originalTracks[i]));
    const imported = notesOf(score, i);
    const importedPitches = new Set(imported.map((note) => note.pitch));
    let present = 0;
    for (const note of original) if (importedPitches.has(note.pitch)) present++;
    const ratio = original.length ? present / original.length : 1;
    assert.ok(ratio >= 0.95, `${originalTracks[i].name}: only ${(ratio * 100).toFixed(1)}% of pitches survived`);
  }
  console.log(`round trip: ${score.tracks.length} tracks (${originalTracks.length} pitched), ${score.masterBars.length} bars (MIDI playback ${midiBars}, source score ${demoScore.masterBars.length})`);
}

// ---------------------------------------------------------------------------
// 12. Drum-only files keep their meter and tempo changes, and a hit that rounds
// onto the next bar line still gets its bar.
if (hasDrumImporter) {
  const drumOnly = convert(fixture('drums-only-waltz.mid', {
    tempos: [[0, 100], [1440, 140]],
    timeSignatures: [[0, [3, 4]]],
    tracks: [{ name: 'Drums', channel: 9, notes: [[36, 0, 120], [38, 480, 120], [36, 1440, 120], [38, 1920, 120]] }]
  }), 'drums-only-waltz.mid');
  const score = load(drumOnly.tex);
  assert.equal(score.masterBars[0].timeSignatureNumerator, 3);
  assert.equal(barTempo(score, 0), 100);
  assert.equal(barTempo(score, 1), 140);

  const lateHit = convert(fixture('drums-late-hit.mid', {
    tracks: [{ name: 'Drums', channel: 9, notes: [[36, 1860, 60]] }]
  }), 'drums-late-hit.mid');
  const lateScore = load(lateHit.tex);
  assert.equal(notesOf(lateScore, 0).length, 1, 'the last drum hit must survive');
}

// 13. A held pedal past the last note keeps the song going until it lifts.
{
  const pedal = convert(fixture('pedal-tail.mid', {
    tracks: [{
      name: 'Piano', program: 0, channel: 0, notes: [[60, 0, 480]],
      cc: [{ number: 64, ticks: 0, value: 1 }, { number: 64, ticks: 4800, value: 0 }]
    }]
  }), 'pedal-tail.mid');
  assert.equal(load(pedal.tex).masterBars.length, 3);
}

// ---------------------------------------------------------------------------
// 8. Empty MIDI throws the clear error.
const emptyMidi = fixture('empty.mid', { tracks: [] });
assert.throws(() => convert(emptyMidi, 'empty.mid'), /This MIDI file has no notes/);

console.log('PASS: midi import');
