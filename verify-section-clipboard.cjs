'use strict';
const assert = require('node:assert/strict');
const at = require('./public/editor/vendor/alphaTab.js');
const M = require('./public/editor/model.js');
const S = require('./public/editor/section-clipboard.js');

const pos = (track, bar, beat = 0, staff = 0) => ({ track, staff, bar, voice: 0, beat, note: 0 });
const reopen = score => at.importer.ScoreLoader.loadScoreFromBytes(new at.exporter.Gp7Exporter().export(M.consolidate(score)));
const notes = (score, track, bar, staff = 0) => score.tracks[track].staves[staff].bars[bar].voices.flatMap(voice => voice.beats.flatMap(beat => beat.notes));
const pitches = (score, track, bar, staff = 0) => notes(score, track, bar, staff).map(note => score.tracks[track].staves[staff].isPercussion ? note.percussionArticulation : note.fret);

function addStaff(track, score) {
  const staff = new at.model.Staff();
  staff.stringTuning = new at.model.Tuning('Custom', M.tunings.standard.slice());
  staff.showTablature = true;
  staff.showStandardNotation = true;
  track.addStaff(staff);
  for (const masterBar of score.masterBars) {
    const bar = new at.model.Bar(), voice = new at.model.Voice();
    for (let i = 0; i < masterBar.timeSignatureNumerator; i++) {
      const beat = new at.model.Beat();
      beat.duration = masterBar.timeSignatureDenominator;
      beat.isEmpty = false;
      voice.addBeat(beat);
    }
    bar.addVoice(voice);
    staff.addBar(bar);
  }
  return staff;
}

function makeScore() {
  const score = M.createScore({ bars: 5, tempo: 120 });
  M.addTrack(score, 'Drums', 0, [], true);
  return score;
}
function fillSection(score) {
  M.setTimeSignature(score, 0, 3, 4);
  M.setTimeSignature(score, 1, 5, 4);
  M.setNote(score, pos(0, 0), { string: 1, fret: 5 });
  M.setNote(score, pos(0, 1), { string: 2, fret: 7 });
  M.setNote(score, pos(0, 2), { string: 3, fret: 9 });
  M.setNote(score, pos(1, 0), { pitch: 38 });
  M.setNote(score, pos(1, 1), { pitch: 42 });
  for (const track of score.tracks) for (const staff of track.staves) {
    staff.bars[0].keySignature = 2;
    staff.bars[1].keySignature = -1;
  }
  const first = score.masterBars[0], second = score.masterBars[1];
  first.tripletFeel = at.model.TripletFeel.Triplet8th;
  first.isRepeatStart = true;
  second.repeatCount = 2;
  second.alternateEndings = 1;
  second.tempoAutomations.push(at.model.Automation.buildTempoAutomation(false, 0, 97, 2));
  second.section = new at.model.Section();
  second.section.text = 'Verse';
  score.rebuildRepeatGroups();
  return score;
}
function assertShape(score) {
  for (const track of score.tracks) for (const staff of track.staves) {
    assert.equal(staff.bars.length, score.masterBars.length, 'every staff has one bar per master bar');
    for (const bar of staff.bars) for (const voice of bar.voices) assert.ok(voice.beats.length > 0 || voice.isEmpty);
  }
}

// Insert mode copies every track and keeps the later arrangement.
{
  let score = fillSection(makeScore());
  const clip = M.copySection(score, 0, 1);
  assert.equal(clip.kind, 'section');
  assert.equal(clip.size, 2);
  assert.deepEqual(clip.tracks, [1, 1]);
  M.pasteSection(score, clip, 2, { insert: true });
  score = M.consolidate(score);
  assert.equal(score.masterBars.length, 7);
  assertShape(score);
  assert.deepEqual(pitches(score, 0, 2), [5], 'guitar bar 1 pasted on every track');
  assert.deepEqual(pitches(score, 0, 3), [7], 'guitar bar 2 pasted on every track');
  assert.deepEqual(pitches(score, 0, 4), [9], 'later bars shifted right');
  assert.deepEqual(pitches(score, 1, 2), [38], 'percussion track pasted');
  assert.deepEqual(pitches(score, 1, 3), [42], 'percussion track keeps articulations');
  assert.equal(score.masterBars[2].timeSignatureNumerator, 3, 'first time signature carried');
  assert.equal(score.masterBars[3].timeSignatureNumerator, 5, 'second time signature carried');
  assert.equal(score.masterBars[2].tripletFeel, at.model.TripletFeel.Triplet8th, 'triplet feel carried');
  assert.equal(score.masterBars[2].isRepeatStart, true, 'repeat start carried');
  assert.equal(score.masterBars[3].repeatCount, 2, 'repeat count carried');
  assert.equal(score.masterBars[3].alternateEndings, 1, 'alternate ending carried');
  assert.equal(score.masterBars[3].tempoAutomations[0].value, 97, 'tempo change carried');
  assert.equal(score.masterBars[3].section.text, 'Verse', 'section marker carried');
  for (const track of score.tracks) for (const staff of track.staves) {
    assert.equal(staff.bars[2].keySignature, 2, 'key signature carried');
    assert.equal(staff.bars[3].keySignature, -1, 'later key signature carried');
  }
  const beforeUndo = M.snapshot(score);
  const restored = M.restore(beforeUndo);
  assert.equal(M.snapshot(restored), beforeUndo, 'snapshot round-trips after a section paste');
  const exported = reopen(score);
  assert.equal(exported.masterBars.length, 7, 'GP keeps the inserted bars');
  assert.deepEqual(pitches(exported, 0, 2), [5], 'GP keeps pasted notes');
  assert.deepEqual(pitches(exported, 1, 2), [38], 'GP keeps percussion notes');
  assert.equal(exported.masterBars[3].repeatCount, 2, 'GP keeps repeats');
  assert.equal(exported.masterBars[3].section.text, 'Verse', 'GP keeps section markers');
}

// Overwrite mode replaces bars without changing the song length.
{
  let score = fillSection(makeScore());
  M.setNote(score, pos(0, 2), { string: 4, fret: 12 });
  M.setNote(score, pos(0, 4), { string: 4, fret: 14 });
  const clip = M.copySection(score, 0, 1);
  M.pasteSection(score, clip, 2, { insert: false });
  score = M.consolidate(score);
  assert.equal(score.masterBars.length, 5, 'overwrite keeps the bar count');
  assert.deepEqual(pitches(score, 0, 2), [5], 'overwritten bar comes from the clip');
  assert.deepEqual(pitches(score, 0, 3), [7], 'second overwritten bar comes from the clip');
  assert.deepEqual(pitches(score, 0, 4), [14], 'bars after the target are untouched');
  assert.equal(score.masterBars[2].timeSignatureNumerator, 3);
  assert.equal(score.masterBars[3].timeSignatureNumerator, 5);
  assert.equal(score.masterBars[3].repeatCount, 2);
  assert.equal(score.masterBars[3].section.text, 'Verse');
  assertShape(score);
  const exported = reopen(score);
  assert.deepEqual(pitches(exported, 0, 2), [5], 'GP keeps overwritten notes');
  assert.equal(exported.masterBars[3].timeSignatureNumerator, 5, 'GP keeps overwritten meter');
}

// Cut removes the bars from every track and keeps a usable clipboard.
{
  let score = fillSection(makeScore());
  M.setNote(score, pos(0, 3), { string: 4, fret: 10 });
  M.setNote(score, pos(1, 3), { pitch: 44 });
  const clip = M.cutSection(score, 1, 2);
  score = M.consolidate(score);
  assert.equal(clip.kind, 'section');
  assert.equal(clip.startBar, 1);
  assert.equal(clip.endBar, 2);
  assert.equal(score.masterBars.length, 3);
  assertShape(score);
  assert.deepEqual(pitches(score, 0, 1), [10], 'cut shifted the following bar left');
  assert.deepEqual(pitches(score, 1, 1), [44], 'cut shifted the following drum bar left');
  const before = M.snapshot(score);
  assert.throws(() => M.cutSection(score, 0, score.masterBars.length - 1), /at least one bar/);
  assert.equal(M.snapshot(score), before, 'cutting every bar is refused atomically');

  // A single-track cut leaves the arrangement aligned and only blanks that staff.
  score = fillSection(makeScore());
  const trackClip = M.cutTrackBars(score, 0, 0, 1, 1);
  assert.equal(trackClip.kind, 'track');
  assert.equal(score.masterBars.length, 5);
  assert.deepEqual(pitches(score, 0, 1), [], 'selected staff is cleared');
  assert.deepEqual(pitches(score, 1, 1), [42], 'other tracks are untouched');
  score = M.consolidate(score);
  assert.equal(score.tracks[0].staves[0].bars[1].calculateDuration(), 4800, 'cut bar keeps its meter');
  assertShape(score);
}

// Tracks with extra or missing staves are handled without corrupting either side.
{
  let score = makeScore();
  M.setNote(score, pos(0, 0), { string: 1, fret: 3 });
  addStaff(score.tracks[0], score);
  M.setNote(score, pos(0, 0, 0, 1), { string: 1, fret: 8 });
  const clip = M.copySection(score, 0, 1);
  score.tracks[0].staves.splice(1, 1);
  M.pasteSection(score, clip, 4, { insert: true });
  score = M.consolidate(score);
  assert.equal(score.tracks[0].staves.length, 1, 'missing destination staff is skipped');
  assert.equal(score.masterBars.length, 7);
  assertShape(score);
  assert.deepEqual(pitches(score, 0, 4), [3], 'the available staff still pastes');

  score = makeScore();
  M.setNote(score, pos(0, 0), { string: 1, fret: 3 });
  const single = M.copySection(score, 0, 1);
  addStaff(score.tracks[0], score);
  M.pasteSection(score, single, 4, { insert: true });
  score = M.consolidate(score);
  assert.equal(score.tracks[0].staves.length, 2, 'extra destination staff survives');
  assert.equal(score.tracks[0].staves[1].bars.length, 7, 'extra staff receives the inserted bars');
  assert.equal(score.tracks[0].staves[1].bars[4].voices[0].beats.every(beat => beat.isRest), true, 'extra staff stays as rests');
  assert.deepEqual(pitches(score, 0, 4), [3], 'the copied staff is pasted');
  assertShape(score);
}

// A failed paste never leaves a half-edited score behind.
{
  let score = makeScore();
  const before = M.snapshot(score);
  assert.throws(() => M.pasteSection(score, { kind: 'section', json: 'bad', startBar: 0, endBar: 0 }, 1));
  assert.equal(M.snapshot(score), before);
  const clip = M.copySection(score, 0, 0);
  const broken = { ...clip, startBar: 9, endBar: 9 };
  assert.throws(() => M.pasteSection(score, broken, 1));
  assert.equal(M.snapshot(score), before);
}

console.log('PASS verify-section-clipboard');
