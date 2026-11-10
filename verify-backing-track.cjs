#!/usr/bin/env node
'use strict';

// Backing track: validation, song keys, sync-point model, score<->audio mapping,
// chunked peaks, and GP round-trip of the audio bytes plus sync points.
const assert = require('node:assert/strict');
const at = require('./public/editor/vendor/alphaTab.js');
const M = require('./public/editor/model.js');
const bt = require('./public/editor/backing-track.js');
const m = at.model;

// File validation.
assert.equal(bt.validateAudioFile('take.mp3', 1024), null, 'mp3 accepted');
assert.equal(bt.validateAudioFile('TAKE.WAV', 1024), null, 'extension case ignored');
assert.equal(bt.validateAudioFile('take.ogg', 1024), null, 'ogg accepted');
assert.equal(bt.validateAudioFile('take.m4a', 1024), null, 'm4a accepted');
assert.equal(bt.validateAudioFile('take.aac', 1024), null, 'aac accepted');
assert.equal(bt.validateAudioFile('take.flac', 1024) === null, false, 'flac is out of scope');
assert.equal(bt.validateAudioFile('notes.txt', 1024) === null, false, 'text rejected');
assert.equal(bt.validateAudioFile('noextension', 1024) === null, false, 'extension required');
assert.equal(bt.validateAudioFile('take.mp3', 0) === null, false, 'empty file rejected');
assert.equal(bt.validateAudioFile('take.mp3', 60 * 1024 * 1024), null, 'exactly 60 MB accepted');
assert.equal(bt.validateAudioFile('take.mp3', 60 * 1024 * 1024 + 1) === null, false, 'over 60 MB rejected');

// Storage keys.
assert.equal(bt.songKeyFor({ lessonId: 'abc' }), 'lesson:abc', 'cloud lesson wins');
assert.equal(bt.songKeyFor({ lessonId: 'abc', localId: 'x' }), 'lesson:abc', 'lesson beats local id');
assert.equal(bt.songKeyFor({ localId: 'x' }), 'local:x', 'device song id');
assert.equal(bt.songKeyFor({ documentIndex: 3 }), 'draft:3', 'draft slot fallback');

// Sync-point model on a real score.
let score = M.createScore({ bars: 4 });
assert.deepEqual(bt.readSyncPoints(score.masterBars), [], 'no sync points initially');
const written = bt.writeSyncPoints(m, score.masterBars, [
  { barIndex: 2, barOccurence: 0, barPosition: 0, millisecondOffset: 3250 },
  { barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 250 },
  { barIndex: 99, barOccurence: 0, barPosition: 0, millisecondOffset: 9999 }
]);
assert.deepEqual(written, [
  { barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 250 },
  { barIndex: 2, barOccurence: 0, barPosition: 0, millisecondOffset: 3250 },
  { barIndex: 3, barOccurence: 0, barPosition: 0, millisecondOffset: 9999 }
], 'points sort by bar and clamp to the song');
assert.deepEqual(bt.readSyncPoints(score.masterBars), written, 'points live on the master bars');
assert.equal(bt.globalOffsetMs(written), 250, 'global offset is the bar-1 point');
assert.equal(bt.globalOffsetMs([]), 0, 'missing offset reads as zero');
const nudged = bt.setGlobalOffset(written, 300);
assert.equal(bt.globalOffsetMs(nudged), 300, 'offset replaced, not duplicated');
assert.equal(nudged.filter(p => p.barIndex === 0).length, 1, 'single bar-1 point');
assert.equal(bt.setGlobalOffset(written, -50)[0].millisecondOffset, 0, 'offset clamps at zero');
bt.writeSyncPoints(m, score.masterBars, [{ barIndex: 1, barOccurence: 0, barPosition: 0, millisecondOffset: 1000 }]);
assert.deepEqual(bt.readSyncPoints(score.masterBars).map(p => p.barIndex), [1], 'rewrite clears stale points');
assert.throws(() => bt.writeSyncPoints(null, score.masterBars, []), 'model namespace required');

// Score time <-> audio time with stub MIDI timing (960 ticks per beat at 120 BPM).
score = M.createScore({ bars: 4, tempo: 120 });
bt.writeSyncPoints(m, score.masterBars, [
  { barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 250 },
  { barIndex: 2, barOccurence: 0, barPosition: 0, millisecondOffset: 3250 }
]);
const ranges = new Map([[0, { start: 0, end: 3840 }], [2, { start: 7680, end: 11520 }]]);
const toSeconds = tick => tick / 960 / 2; // 960 ticks per beat at 120 BPM
const map = bt.buildSyncMap(bt.readSyncPoints(score.masterBars), toSeconds, bar => ranges.get(bar) || null);
assert.deepEqual(map, [{ songMs: 0, audioMs: 250 }, { songMs: 4000, audioMs: 3250 }], 'map places sync points in song time');
assert.equal(bt.audioMsForSongMs(map, 0), 250, 'exact hit on first point');
assert.equal(bt.audioMsForSongMs(map, 4000), 3250, 'exact hit on second point');
assert.equal(bt.audioMsForSongMs(map, 2000), 1750, 'linear interpolation between points');
assert.equal(bt.audioMsForSongMs(map, 8000), 7250, 'past the last point audio runs at score speed');
assert.equal(bt.audioMsForSongMs(null, 1234), 1234, 'no map is the identity');
assert.equal(bt.audioMsForSongMs([], 1234), 1234, 'empty map is the identity');
assert.equal(bt.buildSyncMap(bt.readSyncPoints(score.masterBars), () => null, () => null), null, 'unmappable points keep the last good map');
assert.equal(bt.buildSyncMap(bt.readSyncPoints(score.masterBars), tick => tick / 480, () => null), null, 'missing bar ranges keep the last good map');

// Single global offset shifts the whole song.
const offsetOnly = bt.buildSyncMap(
  bt.normalizeFlatPoints([{ barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 500 }], 4),
  tick => tick / 960 * 500, () => ({ start: 0, end: 3840 }));
assert.equal(bt.audioMsForSongMs(offsetOnly, 0), 500, 'offset at song start');
assert.equal(bt.audioMsForSongMs(offsetOnly, 4000), 4500, 'offset shifts every position equally');

// Chunked peaks equal a single pass.
const channels = [new Float32Array(100003), new Float32Array(100003)];
let seed = 42;
for (const data of channels) for (let i = 0; i < data.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; data[i] = seed / 0x7fffffff * 2 - 1; }
const full = bt.newPeakBuffers(64);
bt.peaksForRange(channels, 64, 0, channels[0].length, channels[0].length, full.mins, full.maxs);
bt.finalizePeaks(full);
const chunked = bt.newPeakBuffers(64);
for (let start = 0; start < channels[0].length; start += 30000) {
  bt.peaksForRange(channels, 64, start, Math.min(channels[0].length, start + 30000), channels[0].length, chunked.mins, chunked.maxs);
}
bt.finalizePeaks(chunked);
assert.deepEqual(Array.from(chunked.mins), Array.from(full.mins), 'chunked minimums match');
assert.deepEqual(Array.from(chunked.maxs), Array.from(full.maxs), 'chunked maximums match');
for (let i = 0; i < 64; i++) assert.ok(full.maxs[i] >= full.mins[i], 'peak pair ordered');
const empty = bt.finalizePeaks(bt.newPeakBuffers(4));
assert.deepEqual(Array.from(empty.mins), [0, 0, 0, 0], 'uncovered columns read as silence');

assert.equal(bt.formatAudioTime(0), '0:00.000', 'zero formats');
assert.equal(bt.formatAudioTime(65325), '1:05.325', 'minutes and millis format');

// GP round-trip: audio bytes and sync points survive export and re-import.
const bytes = new Uint8Array(44100);
for (let i = 0; i < bytes.length; i++) bytes[i] = i & 255;
let song = M.createScore({ bars: 4 });
song.backingTrack = new m.BackingTrack();
song.backingTrack.rawAudioFile = bytes;
bt.writeSyncPoints(m, song.masterBars, [
  { barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: 250 },
  { barIndex: 2, barOccurence: 0, barPosition: 0, millisecondOffset: 3250 }
]);
// Consolidation (undo/redo/drafts) drops the raw bytes, like the editor's JSON snapshots do.
const dropped = M.consolidate(song);
assert.equal(dropped.backingTrack?.rawAudioFile?.length || 0, 0, 'JSON snapshots drop raw audio (editor reattaches it)');
bt._controller.bytes = bytes;
bt.attachTo(dropped, m);
assert.deepEqual(Array.from(dropped.backingTrack.rawAudioFile), Array.from(bytes), 'reattach restores bytes after a snapshot');
bt._controller.bytes = null;
const exported = new at.exporter.Gp7Exporter().export(song);
const reopened = at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(exported));
assert.ok(reopened.backingTrack, 'backing track node parsed');
assert.deepEqual(Array.from(reopened.backingTrack.rawAudioFile), Array.from(bytes), 'audio bytes identical after GP round-trip');
assert.deepEqual(bt.readSyncPoints(reopened.masterBars), bt.readSyncPoints(song.masterBars), 'sync points identical after GP round-trip');
const again = at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(new at.exporter.Gp7Exporter().export(reopened)));
assert.deepEqual(Array.from(again.backingTrack.rawAudioFile), Array.from(bytes), 'second GP round-trip is stable');
assert.deepEqual(bt.readSyncPoints(again.masterBars), bt.readSyncPoints(song.masterBars), 'sync points stable across exports');

// Hooks the editor wires up exist.
for (const name of ['attachTo', 'attachHifi', 'onScoreChanged']) assert.equal(typeof bt[name], 'function', `${name} hook exported`);

console.log('PASS backing-track checks');
