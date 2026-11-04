const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const at = require('./public/editor/vendor/alphaTab.js');

const sampleRate = 44100;
const bank = fs.readFileSync(path.join(__dirname, 'public/editor/vendor/soundfont/FluidR3Mono_GM.sf3'));
const midi = new at.midi.MidiFile();
const programs = [0, 24, 33, 40, 56, 73, 104, 112];
const noteTicks = midi.division;
const barTicks = noteTicks * 4;
for (const [index, program] of programs.entries()) {
  const tick = index * barTicks;
  midi.addEvent(new at.midi.ProgramChangeEvent(0, tick, 0, program));
  midi.addEvent(new at.midi.NoteOnEvent(0, tick, 0, 69, 100));
  midi.addEvent(new at.midi.NoteOffEvent(0, tick + noteTicks, 0, 69, 0));
}

// This sink discards samples; test never opens an audio device or reaches speakers.
const event = () => ({listeners: [], on(fn) { this.listeners.push(fn); }, trigger(value) { for (const fn of this.listeners) fn(value); }});
const sink = {sampleRate, ready: event(), samplesPlayed: event(), sampleRequest: event(), open() { this.ready.trigger(); }, play() {}, pause() {}, destroy() {}, addSamples() {}, resetSamples() {}, activate() {}};
const synth = new at.synth.AlphaSynth(sink, 500);
try {
  synth.loadMidiFile(midi);
  synth.loadSoundFont(new Uint8Array(bank), false);
  const options = new at.synth.AudioExportOptions();
  options.sampleRate = sampleRate;
  options.masterVolume = 1;
  options.trackVolume.set(0, 1);
  const audio = synth.exportAudio(options, midi, [], new Map()).render(20000);
  const samples = audio.samples;
  assert.equal(samples.length % 2, 0, 'Output must contain interleaved stereo samples');

  let peak = 0;
  for (const sample of samples) {
    assert.ok(Number.isFinite(sample), 'Output contains only finite samples');
    peak = Math.max(peak, Math.abs(sample));
  }
  assert.ok(peak > .001, 'Bank must produce audible samples');
  assert.ok(peak < 1, `Output must not clip (peak ${peak})`);

  const secondsPerTick = .5 / midi.division; // MIDI default tempo: 120 BPM.
  const duration = samples.length / 2 / sampleRate;
  const expectedDuration = (programs.length - 1) * barTicks * secondsPerTick + noteTicks * secondsPerTick;
  assert.ok(Math.abs(duration - expectedDuration) < .02, `Expected ${expectedDuration}s, rendered ${duration}s`);

  // First event is MIDI A4 on acoustic grand piano. Estimate its fundamental from autocorrelation.
  const mono = [];
  const first = Math.floor(.05 * sampleRate) * 2;
  const last = Math.floor(.25 * sampleRate) * 2;
  for (let i = first; i + 1 < last; i += 2) mono.push((samples[i] + samples[i + 1]) / 2);
  const expectedLag = sampleRate / 440;
  let best = {lag: 0, correlation: -Infinity};
  for (let lag = Math.floor(expectedLag * .97); lag <= Math.ceil(expectedLag * 1.03); lag++) {
    let correlation = 0, leftEnergy = 0, rightEnergy = 0;
    for (let i = 0; i < mono.length - lag; i++) {
      const left = mono[i], right = mono[i + lag];
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
    correlation /= Math.sqrt(leftEnergy * rightEnergy) || 1;
    if (correlation > best.correlation) best = {lag, correlation};
  }
  const frequency = sampleRate / best.lag;
  assert.ok(Math.abs(frequency - 440) < 8, `Expected A4 near 440 Hz, measured ${frequency} Hz`);

  for (const [index, program] of programs.entries()) {
    const start = Math.floor((index * barTicks * secondsPerTick + .05) * sampleRate) * 2;
    const end = Math.floor((index * barTicks * secondsPerTick + .45) * sampleRate) * 2;
    let energy = 0;
    for (let i = start; i < end; i++) energy += samples[i] * samples[i];
    const rms = Math.sqrt(energy / (end - start));
    assert.ok(rms > .0001, `GM program ${program} rendered no useful signal`);
  }

  console.log(`PASS: FluidR3Mono GM ${programs.length} representative programs; ${duration.toFixed(2)} s; A4 ${frequency.toFixed(1)} Hz; peak ${peak.toFixed(3)}; finite, unclipped stereo.`);
} finally {
  synth.destroy();
}
