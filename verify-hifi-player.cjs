#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function close(actual, expected, message, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message}: expected ${expected}, got ${actual}`);
}

function fakeSynth(channelCount = 16) {
  const midiChannels = Array.from({ length: channelCount }, () => ({
    parameters: {},
    setSystemParameter(name, value) {
      this.parameters[name] = value;
    }
  }));
  return { midiChannels };
}

function track(index, primaryChannel, secondaryChannel = primaryChannel, extra = {}) {
  return {
    index,
    playbackInfo: {
      primaryChannel,
      secondaryChannel,
      volume: 12,
      isMute: false,
      isSolo: false,
      ...extra
    }
  };
}

(async () => {
  // public/editor/package.json marks .js as CommonJS for Node tooling, so import the browser
  // module through a data URL rather than changing the shipped file or its directory metadata.
  const modulePath = path.join(__dirname, 'public/editor/hifi-player.js');
  const source = fs.readFileSync(modulePath, 'utf8');
  const hifi = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

  // alphaTab time axis -> song seconds -> alphaTab time axis at every supported speed.
  for (const speed of [0.5, 1, 1.5, 2]) {
    close(hifi.songSecondsToAlphaTabMs(4, speed), 4000 / speed, `4 s at ${speed}x speed`);
    close(hifi.alphaTabMsToSongSeconds(4000 / speed, speed), 4, `round trip at ${speed}x speed`);
  }
  close(hifi.alphaTabMsToSongSeconds(1000, 2), 2, '1 s on alphaTab axis is 2 s of song at 2x');
  close(hifi.songSecondsToAlphaTabMs(2, 2), 1000, '2 s of song is 1 s on alphaTab axis at 2x');

  // Mute / solo / volume mirroring.
  const synth = fakeSynth();
  const mix = hifi.createMixController(synth);
  const guitar = track(0, 0);
  const bass = track(1, 1);
  const piano = track(2, 2);
  mix.sync([guitar, bass, piano]);

  mix.setTrackMute(guitar, true);
  assert.equal(synth.midiChannels[0].parameters.isMuted, true, 'mute reaches the primary channel');
  assert.equal(synth.midiChannels[1].parameters.isMuted, false, 'other channels stay audible');

  mix.setTrackSolo(bass, true);
  assert.equal(synth.midiChannels[0].parameters.isMuted, true, 'solo keeps an explicitly muted track muted');
  assert.equal(synth.midiChannels[1].parameters.isMuted, false, 'the solo channel is audible');
  assert.equal(synth.midiChannels[2].parameters.isMuted, true, 'solo mutes non-solo tracks');

  mix.setTrackSolo(bass, false);
  assert.equal(synth.midiChannels[2].parameters.isMuted, false, 'clearing solo restores non-muted tracks');
  assert.equal(synth.midiChannels[0].parameters.isMuted, true, 'clearing solo preserves the stored mute');
  mix.setTrackMute(guitar, false);
  assert.equal(synth.midiChannels[0].parameters.isMuted, false, 'unmute restores the track');

  mix.setTrackVolume(bass, 0.5);
  assert.equal(synth.midiChannels[1].parameters.gain, 0.5, 'track volume becomes channel gain');
  const stereo = track(3, 3, 4, { volume: 8 });
  mix.sync([guitar, bass, piano, stereo]);
  mix.setTrackVolume(stereo, 0.25);
  assert.equal(synth.midiChannels[3].parameters.gain, 0.25, 'primary channel receives volume');
  assert.equal(synth.midiChannels[4].parameters.gain, 0.25, 'secondary channel receives volume');

  // WAV render span: whole song plus a tail, or the loop range plus a tail.
  const fullWav = hifi.wavRenderPlan({ songDuration: 10 });
  close(fullWav.startSeconds, 0, 'a full-song WAV starts at zero');
  close(fullWav.endSeconds, 10, 'a full-song WAV ends at the song duration');
  close(fullWav.seconds, 12, 'a full-song WAV adds the two-second tail');
  assert.equal(fullWav.length, Math.ceil(12 * 44100), 'full-song WAV frame count at 44.1 kHz');

  const loopWav = hifi.wavRenderPlan({ songDuration: 10, range: { startSeconds: 2, endSeconds: 5 } });
  close(loopWav.startSeconds, 2, 'loop WAV starts at the range start');
  close(loopWav.endSeconds, 5, 'loop WAV ends at the range end');
  close(loopWav.durationSeconds, 3, 'loop WAV spans only the range');
  close(loopWav.seconds, 5, 'loop WAV adds the tail to the range');
  assert.equal(loopWav.length, Math.ceil(5 * 44100), 'loop WAV frame count at 44.1 kHz');

  const shortWav = hifi.wavRenderPlan({ songDuration: 10, range: { start: 8, end: 20 } });
  close(shortWav.endSeconds, 10, 'a range past the song end is clamped');
  close(shortWav.seconds, 4, 'clamped range still adds the tail');
  const fastWav = hifi.wavRenderPlan({ songDuration: 10, range: { startSeconds: 2, endSeconds: 5 }, sampleRate: 22050, tailSeconds: 1 });
  close(fastWav.seconds, 4, 'custom tail length is honoured');
  assert.equal(fastWav.length, Math.ceil(4 * 22050), 'custom sample rate is honoured');
  const invalidWav = hifi.wavRenderPlan({ songDuration: 10, range: { startSeconds: 5, endSeconds: 5 } });
  close(invalidWav.startSeconds, 0, 'an empty range falls back to the whole song');
  close(invalidWav.seconds, 12, 'an empty range keeps the full-song tail');

  // The offline render snapshot carries the live mute/solo/gain state and master volume.
  const snapshot = {
    midiChannels: Array.from({ length: 16 }, () => ({ systemParameters: { isMuted: false, gain: 1 } })),
    systemParameters: { gain: 1 }
  };
  hifi.applyMixToSnapshot(snapshot, [
    { channels: [0], mute: false, solo: false, volume: 0.5 },
    { channels: [1, 2], mute: false, solo: true, volume: 0.25 },
    { channels: [3], mute: true, solo: false, volume: 1 }
  ], 0.5);
  assert.equal(snapshot.midiChannels[0].systemParameters.isMuted, true, 'solo mutes non-solo channels in the render snapshot');
  assert.equal(snapshot.midiChannels[0].systemParameters.gain, 0.5, 'track volume reaches the render snapshot');
  assert.equal(snapshot.midiChannels[1].systemParameters.isMuted, false, 'the solo channel stays audible');
  assert.equal(snapshot.midiChannels[1].systemParameters.gain, 0.25, 'solo channel volume is applied');
  assert.equal(snapshot.midiChannels[2].systemParameters.isMuted, false, 'secondary channels follow the same track');
  assert.equal(snapshot.midiChannels[3].systemParameters.isMuted, true, 'an explicit mute survives in the render snapshot');
  close(snapshot.systemParameters.gain, 0.41, 'master volume is scaled like live playback');

  // Hidden-tab clock: only the interval fires while hidden, and stop clears it.
  let updates = 0, hidden = true, intervalCallback = null, intervalDelay = 0, cleared = 0, registrations = 0;
  const clock = hifi.createPositionClock({
    update: () => updates++,
    isHidden: () => hidden,
    setIntervalFn: (callback, delay) => { registrations++; intervalCallback = callback; intervalDelay = delay; return 7; },
    clearIntervalFn: id => { cleared = id; intervalCallback = null; }
  });
  clock.start();
  clock.start();
  assert.equal(registrations, 1, 'starting the clock twice registers one interval');
  assert.equal(intervalDelay, 200, 'the hidden-tab clock ticks every 200 ms');
  assert.equal(clock.running, true);
  intervalCallback();
  assert.equal(updates, 1, 'the interval updates the position while hidden');
  hidden = false;
  intervalCallback();
  assert.equal(updates, 1, 'the interval steps aside while a visible frame clock is running');
  hidden = true;
  clock.stop();
  assert.equal(cleared, 7, 'stopping the clock clears the interval');
  assert.equal(clock.running, false);

  // Metronome click track: 4/4 then 3/4 at a tempo change, ticks only care about signatures.
  const clicks = hifi.buildMetronomeClicks([
    { start: 0, end: 3840, numerator: 4, denominator: 4, tempo: 120 },
    { start: 3840, end: 6720, numerator: 3, denominator: 4, tempo: 90 }
  ], 960);
  assert.equal(clicks.length, 7, '4/4 has 4 clicks and 3/4 has 3');
  assert.deepEqual(clicks.map(click => click.key), [76, 77, 77, 77, 76, 77, 77], 'downbeats use the accented woodblock');
  assert.deepEqual(clicks.map(click => click.tick), [0, 960, 1920, 2880, 3840, 4800, 5760], 'clicks sit on every beat');
  assert.deepEqual(clicks.map(click => click.accented), [true, false, false, false, true, false, false]);
  const shifted = hifi.buildMetronomeClicks([{ start: 0, end: 3840, numerator: 4, denominator: 4 }], 960, 120);
  assert.deepEqual(shifted.map(click => click.tick), [120, 1080, 2040, 3000], 'grace-note tick shift moves the clicks');

  // Count-in timing: one bar of clicks, scaled by playback speed.
  const fourFour = hifi.countInPlan({ tempo: 120, numerator: 4, denominator: 4 }, 1);
  close(fourFour.durationMs, 2000, '4/4 at 120 BPM is one 2 s bar');
  close(fourFour.realDurationMs, 2000, 'count-in duration at 1x');
  assert.deepEqual(fourFour.beats.map(beat => beat.offsetMs), [0, 500, 1000, 1500]);
  assert.deepEqual(fourFour.beats.map(beat => beat.key), [76, 77, 77, 77]);
  const fast = hifi.countInPlan({ tempo: 120, numerator: 4, denominator: 4 }, 1.5);
  close(fast.realDurationMs, 2000 / 1.5, 'count-in follows 150% speed');
  close(fast.beats[3].realOffsetMs, 1500 / 1.5, 'count-in click spacing follows speed');
  const threeFour = hifi.countInPlan({ tempo: 90, numerator: 3, denominator: 4 }, 1);
  close(threeFour.beatMs, 60000 / 90, '3/4 beat length at 90 BPM');
  close(threeFour.durationMs, 3 * 60000 / 90, '3/4 count-in is three beats');
  assert.equal(threeFour.beats.length, 3);

  // Channel plan: big scores get their own channels across MIDI ports, melodic tracks never land
  // on a drum slot (x % 16 == 9), and each track keeps both channels in one port.
  const drums = Object.assign(track(14, 9, 9), { staves: [{ isPercussion: true }] });
  const big = Array.from({ length: 14 }, (_, index) => track(index, index * 2 + (index * 2 >= 9 ? 1 : 0), index * 2 + 1 + (index * 2 + 1 >= 9 ? 1 : 0))).concat([drums]);
  const plan = hifi.planChannels(big, { metronome: true });
  const melodicSlots = big.slice(0, 14).flatMap(entry => plan.byTrack.get(entry.index).channels);
  assert.equal(new Set(melodicSlots).size, 28, 'every melodic channel is unique');
  assert.ok(melodicSlots.every(slot => slot % 16 !== 9), 'no melodic channel on a drum slot');
  for (const entry of big.slice(0, 14)) {
    const { primary, secondary } = plan.byTrack.get(entry.index);
    assert.equal(Math.floor(primary / 16), Math.floor(secondary / 16), 'both channels of a track share a port');
  }
  assert.deepEqual(plan.byTrack.get(14).channels, [9], 'drums stay on channel 9');
  assert.equal(plan.metronome % 16, 9, 'metronome uses a drum slot');
  assert.ok(!melodicSlots.includes(plan.metronome) && plan.metronome !== 9);
  assert.equal(plan.channelCount, 32, "14 pairs fit two ports");
  // A melodic track whose second channel alphaTab put on 9 is moved off it.
  const small = hifi.planChannels([track(0, 8, 9)]);
  assert.deepEqual(small.byTrack.get(0).channels, [0, 1]);

  // Rewriting a real alphaTab MIDI: the right channel nibbles, a port event per track, a reverb send.
  const at = require('./public/editor/vendor/alphaTab.js');
  const settings = new at.Settings();
  const score = at.importer.ScoreLoader.loadScoreFromBytes(fs.readFileSync(path.join(__dirname, 'public/editor/demo.gp')), settings);
  const midiFile = new at.midi.MidiFile();
  midiFile.format = at.midi.MidiFileFormat.MultiTrack;
  new at.midi.MidiFileGenerator(score, settings, new at.midi.AlphaSynthMidiFileHandler(midiFile, true)).generate();
  const demoPlan = hifi.planChannels(score.tracks);
  hifi.applyChannelPlan(midiFile, score.tracks, demoPlan, { ControlChangeEvent: at.midi.ControlChangeEvent });
  const binary = midiFile.toBinary();
  assert.ok(binary.length > 100);
  score.tracks.forEach((scoreTrack, index) => {
    const events = midiFile.tracks[index].events;
    const allowed = new Set(demoPlan.byTrack.get(index).channels.map(slot => slot & 15));
    const notes = events.filter(event => event.type === 128);
    assert.ok(notes.every(event => allowed.has(event.channel)), `${scoreTrack.name}: notes on planned channels`);
    if (!scoreTrack.staves.some(staff => staff.isPercussion)) assert.ok(notes.every(event => event.channel !== 9), `${scoreTrack.name}: no melodic notes on the drum channel`);
    assert.equal(typeof events[0].writeTo, 'function');
    assert.ok(events.some(event => event.controller === 91), `${scoreTrack.name}: reverb send`);
  });

  console.log('PASS: hifi player');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
