/* Fretlark hi-fi playback: SpessaSynth (vendored) behind alphaTab's external-media clock. */
/*
 * This module is loaded with dynamic import from app.js. Its pure helpers are exported so
 * verify-hifi-player.cjs can exercise the timing, mix and metronome maths without an audio
 * device. createHifiPlayer() is the only browser-dependent entry point.
 */

const MIN_SPEED = 0.05;
const MAX_SPEED = 4;
const WAV_SAMPLE_RATE = 44100;
const WAV_TAIL_SECONDS = 2;
const POSITION_INTERVAL_MS = 200;

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

/**
 * Frame length and start point for a WAV render. A loop range is expressed in song seconds
 * (the caller converts alphaTab ticks first); without one the whole song is rendered.
 */
export function wavRenderPlan({ songDuration = 0, range = null, sampleRate = WAV_SAMPLE_RATE, tailSeconds = WAV_TAIL_SECONDS } = {}) {
  const duration = positive(songDuration, 0);
  let startSeconds = 0;
  let endSeconds = duration;
  if (range) {
    const rawStart = Math.max(0, Number(range.startSeconds ?? range.start) || 0);
    const rawEnd = Number(range.endSeconds ?? range.end);
    if (Number.isFinite(rawEnd) && rawEnd > rawStart) {
      const upper = duration > 0 ? duration : rawEnd;
      startSeconds = Math.min(rawStart, upper);
      endSeconds = Math.max(startSeconds, Math.min(rawEnd, upper));
    }
  }
  const span = Math.max(0, endSeconds - startSeconds);
  const tail = Math.max(0, Number(tailSeconds) || 0);
  const seconds = span + tail;
  return {
    startSeconds,
    endSeconds,
    durationSeconds: span,
    tailSeconds: tail,
    seconds,
    length: Math.max(1, Math.ceil(seconds * positive(sampleRate, WAV_SAMPLE_RATE)))
  };
}

/** Mirror the live track mix onto a SpessaSynth snapshot used for offline rendering. */
export function applyMixToSnapshot(snapshot, tracks, masterVolume = 1) {
  if (!snapshot) return snapshot;
  const list = Array.from(tracks || []);
  const anySolo = list.some(state => !!state?.solo);
  for (const state of list) {
    const muted = !!state?.mute || (anySolo && !state?.solo);
    for (const channelNumber of state?.channels || []) {
      const parameters = snapshot.midiChannels?.[channelNumber]?.systemParameters;
      if (!parameters) continue;
      parameters.isMuted = muted;
      parameters.gain = clamp(state?.volume ?? 1, 0, 8);
    }
  }
  if (snapshot.systemParameters) snapshot.systemParameters.gain = 0.82 * clamp(masterVolume, 0, 1);
  return snapshot;
}

/**
 * A background-tab-safe position clock. The animation-frame clock stops in hidden tabs, so an
 * interval keeps alphaTab's external-media time and its loop/end logic moving while hidden.
 */
export function createPositionClock({
  update,
  isHidden = () => !!globalThis.document?.hidden,
  intervalMs = POSITION_INTERVAL_MS,
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval
} = {}) {
  let timer = 0;
  function tick() {
    if (isHidden()) update?.();
  }
  return {
    get running() {
      return !!timer;
    },
    tick,
    start() {
      if (!timer) timer = setIntervalFn(tick, intervalMs);
    },
    stop() {
      if (timer) clearIntervalFn(timer);
      timer = 0;
    }
  };
}

/** alphaTab's external-media clock runs in song time divided by the playback speed. */
export function alphaTabMsToSongSeconds(milliseconds, speed = 1) {
  return (Number(milliseconds) || 0) / 1000 * clamp(speed, MIN_SPEED, MAX_SPEED);
}

/** Convert a song time in seconds to the millisecond axis alphaTab's player uses. */
export function songSecondsToAlphaTabMs(seconds, speed = 1) {
  return (Number(seconds) || 0) * 1000 / clamp(speed, MIN_SPEED, MAX_SPEED);
}

/**
 * One count-in bar at the starting bar's tempo.
 * Input: { tempo, numerator, denominator }. Times are returned in song milliseconds and in
 * real time (song time divided by the playback speed).
 */
export function countInPlan(bar = {}, speed = 1) {
  const tempo = positive(bar.tempo, 120);
  const numerator = Math.max(1, Math.round(positive(bar.numerator, 4)));
  const denominator = Math.max(1, Math.round(positive(bar.denominator, 4)));
  const beatMs = (60000 / tempo) * (4 / denominator);
  const durationMs = beatMs * numerator;
  const rate = clamp(speed, MIN_SPEED, MAX_SPEED);
  const beats = [];
  for (let index = 0; index < numerator; index++) {
    beats.push({
      offsetMs: index * beatMs,
      realOffsetMs: (index * beatMs) / rate,
      key: index === 0 ? 76 : 77,
      accented: index === 0
    });
  }
  return { tempo, numerator, denominator, beatMs, durationMs, realDurationMs: durationMs / rate, beats };
}

/**
 * Build the woodblock clicks for every played bar (including repeats, if the caller supplies the
 * played-bar list). Tempo changes do not move ticks, so only the time signature matters here.
 */
export function buildMetronomeClicks(bars, division = 960, tickShift = 0) {
  const clicks = [];
  const ticksPerQuarter = Math.max(1, Math.round(Number(division) || 960));
  const shift = Math.round(Number(tickShift) || 0);
  for (const bar of bars || []) {
    const numerator = Math.max(1, Math.round(positive(bar?.numerator, 4)));
    const denominator = Math.max(1, Math.round(positive(bar?.denominator, 4)));
    const beatTicks = Math.max(1, Math.round(ticksPerQuarter * 4 / denominator));
    const startTick = Number(bar?.start) || 0;
    const endTick = Number(bar?.end);
    const start = Math.round(startTick) + shift;
    const end = Math.round(Number.isFinite(endTick) ? endTick : startTick + numerator * beatTicks) + shift;
    for (let index = 0; index < numerator; index++) {
      const tick = start + index * beatTicks;
      if (tick >= end) break;
      clicks.push({
        tick,
        key: index === 0 ? 76 : 77,
        accented: index === 0,
        bar: bar?.index ?? null
      });
    }
  }
  return clicks;
}

/** Pick a spare MIDI channel for the click track, preferring alphaTab's old metronome channel. */
// GM reverb send (CC91) used when the score carries none, as GM2 and GS synths do by default.
export const DEFAULT_REVERB_SEND = 40;

// SpessaSynth posts worklet messages in batches and handles them in one loop. When channels are
// added mid-song (MIDI ports), a voice-count update can arrive before its "channelAdded" event and
// throw, which drops the rest of the batch (including later channelAdded events) and leaves the
// main-thread channel list permanently short. Handle each message on its own and clamp voice counts.
export function guardSynthMessages(synth) {
  const port = synth?.worklet?.port;
  if (!port || typeof synth.handleMessages !== 'function') return;
  port.onmessage = event => {
    const messages = Array.isArray(event.data) ? event.data : [event.data];
    for (const message of messages) {
      if (message?.type === 'voiceCountChange') {
        const counts = message.data || [];
        const channels = synth.midiChannels || [];
        let total = 0;
        for (let index = 0; index < counts.length; index++) {
          total += counts[index];
          if (channels[index]) channels[index].voiceCount = counts[index];
        }
        synth._voiceCount = total;
        continue;
      }
      try { synth.handleMessages([message]); } catch {}
    }
  };
}

function isPercussionTrack(track) {
  return !!track?.staves?.some(staff => staff?.isPercussion);
}

/**
 * alphaTab numbers channels past 15 for big scores and may put a melodic track's second channel on
 * 9, but a MIDI file has 16 channels per port and SpessaSynth makes channel 9 of every port a drum
 * kit. Give each track its own SpessaSynth channels instead: melodic tracks avoid every x%16 == 9
 * slot and keep both channels in one port, drum tracks and the metronome take the drum slots.
 * Ports first appear in track order, which is how SpessaSynth assigns their channel offsets.
 */
export function planChannels(tracks, { metronome = false } = {}) {
  const byTrack = new Map();
  let cursor = 0, drumPort = 0;
  const nextDrum = () => 9 + 16 * drumPort++;
  const nextMelodic = count => {
    for (;;) {
      const port = Math.floor(cursor / 16), slots = [];
      let slot = cursor;
      while (slots.length < count && Math.floor(slot / 16) === port) {
        if (slot % 16 !== 9) slots.push(slot);
        slot++;
      }
      if (slots.length === count) { cursor = slot; return slots; }
      cursor = (port + 1) * 16;
    }
  };
  for (const track of tracks || []) {
    const info = track?.playbackInfo;
    if (!info || !Number.isInteger(track.index)) continue;
    if (isPercussionTrack(track)) {
      const slot = nextDrum();
      byTrack.set(track.index, { primary: slot, secondary: slot, channels: [slot] });
      continue;
    }
    const hasSecondary = Number.isInteger(info.secondaryChannel) && info.secondaryChannel !== info.primaryChannel;
    const [primary, secondary = primary] = nextMelodic(hasSecondary ? 2 : 1);
    byTrack.set(track.index, { primary, secondary, channels: primary === secondary ? [primary] : [primary, secondary] });
  }
  const metronomeSlot = metronome ? nextDrum() : null;
  const used = [...byTrack.values()].flatMap(entry => entry.channels).concat(metronomeSlot ?? []);
  return {
    byTrack,
    metronome: metronomeSlot,
    channelCount: Math.max(16, ...used.map(slot => (Math.floor(slot / 16) + 1) * 16))
  };
}

/** Rewrite an alphaTab MidiFile (one MIDI track per score track) to the planned channels and ports. */
export function applyChannelPlan(midiFile, tracks, plan, { ControlChangeEvent, reverbSend = DEFAULT_REVERB_SEND } = {}) {
  const list = Array.from(tracks || []);
  midiFile.tracks.forEach((midiTrack, index) => {
    const track = list.find(entry => entry?.index === index);
    const entry = track ? plan.byTrack.get(index) : (index === list.length && plan.metronome != null
      ? { primary: plan.metronome, secondary: plan.metronome, channels: [plan.metronome] } : null);
    if (!entry) return;
    const info = track?.playbackInfo || {};
    let touched = false;
    // GP files store drum-kit automations that are not GM kit numbers (25 would be a TR-808
    // in SpessaSynth), so drum tracks always play the standard kit.
    const percussion = track && isPercussionTrack(track);
    for (const event of midiTrack.events) {
      if (typeof event.channel !== 'number') continue;
      if (percussion && typeof event.program === 'number') event.program = 0;
      const slot = event.channel === info.secondaryChannel && event.channel !== info.primaryChannel ? entry.secondary : entry.primary;
      event.channel = slot & 15;
      touched = true;
    }
    if (!touched && track) return;
    const port = Math.floor(entry.primary / 16);
    // MIDI port meta event (FF 21 01 pp): channels below are channel + 16 * port's offset.
    midiTrack.events.unshift({ tick: 0, track: index, writeTo(stream) { stream.writeByte(0xff); stream.writeByte(0x21); stream.writeByte(1); stream.writeByte(port); } });
    if (track && ControlChangeEvent && reverbSend > 0) {
      const hasReverb = midiTrack.events.some(event => event.controller === 91);
      if (!hasReverb) for (const slot of entry.channels) midiTrack.addEvent(new ControlChangeEvent(index, 0, slot & 15, 91, reverbSend));
    }
  });
  return midiFile;
}

function trackChannels(track) {
  const info = track?.playbackInfo;
  if (!info) return [];
  const channels = [info.primaryChannel];
  if (Number.isInteger(info.secondaryChannel) && info.secondaryChannel !== info.primaryChannel) channels.push(info.secondaryChannel);
  return channels.filter(channel => Number.isInteger(channel) && channel >= 0 && channel < 16);
}

function defaultTrackState(track) {
  const info = track?.playbackInfo || {};
  return {
    channels: trackChannels(track),
    mute: !!info.isMute,
    solo: !!info.isSolo,
    volume: clamp(Number(info.volume) / 16, 0, 8)
  };
}

/**
 * Mirror alphaTab's per-track mute/solo/volume onto SpessaSynth channels.
 * Solo mutes every non-solo channel; clearing the last solo restores the stored mute state.
 */
export function createMixController(synth, channelsFor = trackChannels) {
  const tracks = new Map();

  function channel(channelNumber) {
    return synth?.midiChannels?.[channelNumber];
  }

  function ensure(track) {
    let state = tracks.get(track.index);
    if (!state) {
      state = defaultTrackState(track);
      state.channels = channelsFor(track);
      tracks.set(track.index, state);
    } else state.channels = channelsFor(track);
    return state;
  }

  function refresh() {
    const anySolo = Array.from(tracks.values()).some(state => state.solo);
    for (const state of tracks.values()) {
      const muted = state.mute || (anySolo && !state.solo);
      for (const channelNumber of state.channels) {
        const midiChannel = channel(channelNumber);
        midiChannel?.setSystemParameter?.('isMuted', muted);
        midiChannel?.setSystemParameter?.('gain', state.volume);
      }
    }
  }

  return {
    setTrackMute(track, mute) {
      if (!track || !Number.isInteger(track.index)) return;
      ensure(track).mute = !!mute;
      refresh();
    },
    setTrackSolo(track, solo) {
      if (!track || !Number.isInteger(track.index)) return;
      ensure(track).solo = !!solo;
      refresh();
    },
    setTrackVolume(track, volume) {
      if (!track || !Number.isInteger(track.index)) return;
      ensure(track).volume = clamp(volume, 0, 8);
      refresh();
    },
    sync(trackList) {
      const present = new Set();
      for (const track of trackList || []) {
        if (!Number.isInteger(track?.index)) continue;
        present.add(track.index);
        ensure(track);
      }
      for (const index of Array.from(tracks.keys())) if (!present.has(index)) tracks.delete(index);
      refresh();
    },
    reset(trackList) {
      tracks.clear();
      for (const track of trackList || []) if (Number.isInteger(track?.index)) ensure(track);
      refresh();
    },
    snapshot() {
      return Array.from(tracks.entries()).map(([index, state]) => ({ index, ...state, channels: state.channels.slice() }));
    }
  };
}

/**
 * Synth output stage: makeup gain into a gentle compressor. Raw GM playback is quiet and very
 * dynamic (rhythm parts sit far below solos), so this lifts the whole mix and keeps loud
 * passages from clipping. Playback and exports share it so they sound the same.
 */
export const OUTPUT_STAGE = { makeup: 2.2, threshold: -20, knee: 12, ratio: 4, attack: 0.008, release: 0.25 };

function createOutputStage(context) {
  const input = context.createGain();
  input.gain.value = OUTPUT_STAGE.makeup;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = OUTPUT_STAGE.threshold;
  compressor.knee.value = OUTPUT_STAGE.knee;
  compressor.ratio.value = OUTPUT_STAGE.ratio;
  compressor.attack.value = OUTPUT_STAGE.attack;
  compressor.release.value = OUTPUT_STAGE.release;
  input.connect(compressor);
  compressor.connect(context.destination);
  return input;
}

function scheduleCountInClick(context, when, accented, volume) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'square';
  oscillator.frequency.value = accented ? 1760 : 1320;
  const peak = Math.max(0.0001, Math.min(0.5, 0.16 * clamp(volume, 0, 6)));
  gain.gain.setValueAtTime(peak, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(when);
  oscillator.stop(when + 0.05);
  return { oscillator, gain };
}

/**
 * Create a SpessaSynth-backed player and adapt it to alphaTab's IExternalMediaHandler.
 * Rejects when the browser cannot run AudioWorklet audio.
 */
export async function createHifiPlayer({ api, at, soundFontUrl, processorUrl, onReady } = {}) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (typeof AudioWorkletNode === 'undefined' || !AudioContextClass) throw Error('AudioWorklet audio is unavailable');
  if (!api || !at) throw Error('Hi-fi player needs alphaTab');

  const context = new AudioContextClass({ latencyHint: 'playback' });
  const processor = processorUrl || new URL('./vendor/spessasynth/spessasynth_processor.min.js', import.meta.url).href;
  let synth, WorkletSynthesizer, Sequencer, BasicMIDI, soundBankBytes;
  try {
    await context.audioWorklet.addModule(processor);
    const module = await import('./vendor/spessasynth/spessasynth_lib.js');
    WorkletSynthesizer = module.WorkletSynthesizer;
    Sequencer = module.Sequencer;
    BasicMIDI = module.BasicMIDI;
    synth = new WorkletSynthesizer(context);
    guardSynthMessages(synth);
    synth.connect(createOutputStage(context));

    const response = await fetch(soundFontUrl);
    if (!response.ok) throw Error(`Sound bank could not be loaded (${response.status})`);
    const bank = await response.arrayBuffer();
    // addSoundBank transfers the buffer to the worklet, so keep a copy for offline renders.
    soundBankBytes = bank.slice(0);
    await synth.soundBankManager.addSoundBank(bank, 'fretlark');
    await synth.isReady;
  } catch (error) {
    try { synth?.destroy?.(); } catch {}
    try { await context.close(); } catch {}
    throw error;
  }

  const sequencer = new Sequencer(synth, { skipToFirstNoteOn: false });
  const mix = createMixController(synth, track => state.channelPlan?.byTrack.get(track.index)?.channels ?? trackChannels(track));

  const state = {
    playing: false,
    intentPlaying: false,
    countingIn: false,
    songReady: false,
    destroyed: false,
    songEnd: 0,
    speed: 1,
    masterVolume: clamp(api.masterVolume ?? 0.75, 0, 1),
    metronomeVolume: Math.max(0, Number(api.metronomeVolume) || 0),
    countInVolume: Math.max(0, Number(api.countInVolume) || 0),
    metronomeChannel: null,
    score: null,
    // BACKING-TRACK: parsed MIDI for tick-to-second mapping (backing-track.js).
    songMidi: null,
    seekSeconds: 0,
    seekTick: 0,
    lastSeconds: 0,
    wantedStart: 0,
    wantPlay: false,
    pendingSeekSeconds: null,
    pendingResume: false,
    resumeAfterReload: false,
    newScore: true,
    soundBankBytes,
    raf: 0,
    countInTimer: 0,
    countInNodes: [],
    reloadTimer: 0,
    auditionToken: 0
  };

  function midiChannel(channelNumber) {
    return synth.midiChannels?.[channelNumber];
  }

  function applyMaster() {
    if (state.destroyed) return;
    synth.setSystemParameter('gain', 0.82 * clamp(state.masterVolume, 0, 1));
  }

  function applyMetronome() {
    const channelNumber = state.metronomeChannel;
    if (channelNumber == null) return;
    const on = state.metronomeVolume > 0;
    midiChannel(channelNumber)?.setSystemParameter?.('isMuted', !on);
    if (on) {
      const controller = Math.max(1, Math.min(127, Math.round(127 * Math.min(1, state.metronomeVolume / 2.8))));
      synth.controllerChange(channelNumber, 7, controller);
    } else {
      synth.controllerChange(channelNumber, 7, 0);
    }
  }

  // BACKING-TRACK: the backing-track panel mirrors playback through these listeners.
  const positionListeners = new Set();
  function emitBackingPosition() {
    if (!positionListeners.size || state.destroyed) return;
    const event = {
      songSeconds: Math.max(0, Number(state.lastSeconds) || 0),
      playing: state.playing && !state.countingIn,
      countingIn: state.countingIn,
      speed: state.speed,
      songEnd: state.songEnd || 0
    };
    for (const listener of positionListeners) { try { listener(event); } catch {} }
  }

  function updatePosition() {
    if (!state.playing || state.destroyed) return;
    try {
      const songSeconds = Math.max(0, Math.min(state.songEnd || Infinity, Number(sequencer.currentHighResolutionTime) || 0));
      state.lastSeconds = songSeconds;
      api.player.output.updatePosition(songSecondsToAlphaTabMs(songSeconds, state.speed));
    } catch {}
    emitBackingPosition();
  }

  // The interval also covers throttled frame clocks (power saving, background iframes), so loops
  // and the song end still fire on time when frames arrive late.
  const positionClock = createPositionClock({
    update: updatePosition,
    isHidden: () => !!globalThis.document?.hidden || performance.now() - (state.lastFrameAt || 0) > 150
  });

  function stopAnimation() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = 0;
    positionClock.stop();
  }

  function animationFrame() {
    state.raf = 0;
    if (!state.playing || state.destroyed) return;
    state.lastFrameAt = performance.now();
    updatePosition();
    if (state.playing && !state.destroyed) state.raf = requestAnimationFrame(animationFrame);
  }

  function startAnimation() {
    if (state.destroyed) return;
    if (!state.raf) state.raf = requestAnimationFrame(animationFrame);
    // requestAnimationFrame is paused in hidden tabs; the interval keeps cursor/loop/end logic alive there.
    positionClock.start();
  }

  function seekSequencer(seconds) {
    if (!state.songReady) {
      state.seekSeconds = seconds;
      return;
    }
    const target = Math.max(0, Math.min(state.songEnd || seconds, Number(seconds) || 0));
    state.seekSeconds = target;
    state.lastSeconds = target;
    try {
      sequencer.currentTime = target;
      // Sequencer stores paused playback separately from the core's current time. Keep both in
      // step so a later play() resumes at the requested position rather than the old pause point.
      if (sequencer.paused) sequencer.pausedTime = target;
    } catch {}
    emitBackingPosition();
  }

  function cancelCountIn() {
    if (state.countInTimer) clearTimeout(state.countInTimer);
    state.countInTimer = 0;
    for (const node of state.countInNodes) {
      try { node.oscillator.stop(); } catch {}
      try { node.oscillator.disconnect(); } catch {}
      try { node.gain.disconnect(); } catch {}
    }
    state.countInNodes = [];
    state.countingIn = false;
  }

  function startingBar() {
    const cache = api.tickCache;
    const tick = Number(state.seekTick) || 0;
    const bars = cache?.masterBars || [];
    if (!bars.length) return { tempo: api.score?.tempo || 120, numerator: 4, denominator: 4 };
    let lookup = bars.find(bar => tick >= bar.start && tick < bar.end) || bars[0];
    const masterBar = lookup.masterBar || {};
    const changes = (lookup.tempoChanges || []).slice().sort((a, b) => a.tick - b.tick);
    let tempo = masterBar.tempo || api.score?.tempo || 120;
    for (const change of changes) if (change.tick <= tick && change.tempo > 0) tempo = change.tempo;
    return {
      tempo,
      numerator: masterBar.timeSignatureNumerator || 4,
      denominator: masterBar.timeSignatureDenominator || 4
    };
  }

  function finishCountIn(startSeconds) {
    if (!state.playing || state.destroyed) return;
    state.countingIn = false;
    state.countInNodes = [];
    // alphaTab put its own sequencer into count-in state. Seeking resets that (alphaTab.js patch)
    // and also tells our handler the exact song position to resume from.
    try { api.player.timePosition = songSecondsToAlphaTabMs(startSeconds, state.speed); } catch {}
    seekSequencer(startSeconds);
    if (sequencer.paused) { try { sequencer.play(); } catch {} }
    state.lastSeconds = startSeconds;
    startAnimation();
  }

  function startTransport(startSeconds) {
    if (state.destroyed) return;
    const target = Math.max(0, Math.min(state.songEnd || startSeconds, Number(startSeconds) || 0));
    cancelCountIn();
    state.countingIn = false;
    if (state.countInVolume > 0) {
      const plan = countInPlan(startingBar(), state.speed);
      const level = state.countInVolume * 0.82 * clamp(state.masterVolume, 0, 1);
      state.countingIn = true;
      try {
        const now = context.currentTime + 0.03;
        for (const beat of plan.beats) state.countInNodes.push(scheduleCountInClick(context, now + beat.realOffsetMs / 1000, beat.accented, level));
      } catch {}
      state.countInTarget = target;
      state.countInTimer = setTimeout(() => finishCountIn(state.countInTarget), Math.max(1, plan.realDurationMs + 30));
      emitBackingPosition();
      return;
    }
    finishCountIn(target);
  }

  function startWantedIfReady() {
    if (!state.songReady || !state.playing || !state.wantPlay) return;
    const start = state.wantedStart;
    state.wantPlay = false;
    startTransport(start);
  }

  function renderSong(includeMetronome = true) {
    const score = api.score;
    if (!score) return null;
    const midiFile = new at.midi.MidiFile();
    midiFile.format = at.midi.MidiFileFormat.MultiTrack;
    const handler = new at.midi.AlphaSynthMidiFileHandler(midiFile, true);
    const generator = new at.midi.MidiFileGenerator(score, api.settings, handler);
    generator.generate();

    const shift = handler.tickShift || 0;
    const plan = planChannels(score.tracks, { metronome: includeMetronome });
    let metronomeChannel = plan.metronome;
    if (metronomeChannel != null) {
      const division = midiFile.division || 960;
      const bars = (generator.tickLookup?.masterBars || []).map(lookup => ({
        start: lookup.start,
        end: lookup.end,
        numerator: lookup.masterBar?.timeSignatureNumerator,
        denominator: lookup.masterBar?.timeSignatureDenominator,
        index: lookup.masterBar?.index
      }));
      const clicks = buildMetronomeClicks(bars, division, shift);
      if (clicks.length) {
        const track = midiFile.tracks.length;
        const noteTicks = Math.max(1, Math.round(division / 8));
        for (const click of clicks) {
          midiFile.addEvent(new at.midi.NoteOnEvent(track, click.tick, metronomeChannel, click.key, click.accented ? 112 : 88));
          midiFile.addEvent(new at.midi.NoteOffEvent(track, click.tick + noteTicks, metronomeChannel, click.key, 0));
        }
        const lastBar = generator.tickLookup?.masterBars?.at(-1);
        const endTick = Math.max(clicks[clicks.length - 1].tick + noteTicks, (lastBar?.end || 0) + shift);
        midiFile.addEvent(new at.midi.EndOfTrackEvent(track, endTick));
      } else metronomeChannel = null;
    }
    applyChannelPlan(midiFile, score.tracks, plan, { ControlChangeEvent: at.midi.ControlChangeEvent });

    const binary = midiFile.toBinary();
    const buffer = binary.byteOffset === 0 && binary.byteLength === binary.buffer.byteLength
      ? binary.buffer
      : binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
    // BACKING-TRACK: keep the parsed MIDI so the backing-track panel can map ticks to seconds.
    // Parsed lazily (ticksToSeconds), so songs without a backing track pay nothing on each edit.
    state.songMidi = null;
    state.songMidiBuffer = buffer.slice(0);
    return { buffer, metronomeChannel, tickShift: shift, plan };
  }

  function loadRendered(rendered) {
    state.songReady = false;
    state.metronomeChannel = rendered.metronomeChannel;
    state.channelPlan = rendered.plan;
    // Big scores use more than one MIDI port; make sure the synth has the channels.
    try {
      // The main-thread list only grows when the worklet confirms, so count what was requested.
      const have = Math.max(synth.midiChannels?.length ?? 16, state.requestedChannels || 0);
      for (let i = have; i < rendered.plan.channelCount; i++) synth.addNewChannel();
      state.requestedChannels = Math.max(have, rendered.plan.channelCount);
    } catch {}
    sequencer.loadNewSongList([{ binary: rendered.buffer, fileName: 'fretlark.mid' }]);
  }

  function reloadMidi() {
    if (state.destroyed) return;
    let rendered = null;
    try { rendered = renderSong(); } catch (error) { console.warn('Fretlark hi-fi MIDI generation failed.', error); }
    if (rendered) loadRendered(rendered);
  }

  function onSongChange() {
    if (state.destroyed) return;
    state.songReady = true;
    state.songEnd = Number.isFinite(sequencer.duration) && sequencer.duration > 0 ? sequencer.duration : state.songEnd;
    if (state.metronomeChannel != null) midiChannel(state.metronomeChannel)?.setDrums?.(true);
    if (state.newScore) mix.reset(api.score?.tracks || []);
    else mix.sync(api.score?.tracks || []);
    state.newScore = false;
    state.score = api.score;
    applyMetronome();
    applyMaster();
    const target = clamp(state.pendingSeekSeconds ?? state.seekSeconds ?? 0, 0, state.songEnd);
    state.pendingSeekSeconds = null;
    seekSequencer(target);
    if (state.pendingResume) {
      state.pendingResume = false;
      queueMicrotask(() => { try { if (api.playerState !== 1) api.play(); } catch {} });
    }
    startWantedIfReady();
    try { adapter.onReady?.(adapter); } catch {}
  }

  function onSongEnded() {
    if (state.destroyed || !state.songReady) return;
    // alphaTab's end tick can be a few milliseconds past the last MIDI event; reporting its own
    // end time guarantees its finish/loop logic runs even if the two parsers round differently.
    const ownEnd = Number(api.endTime);
    const endMs = Number.isFinite(ownEnd) && ownEnd > 0
      ? Math.max(ownEnd, songSecondsToAlphaTabMs(state.songEnd, state.speed))
      : songSecondsToAlphaTabMs(state.songEnd, state.speed);
    try { api.player.output.updatePosition(endMs); } catch {}
  }

  sequencer.eventHandler.addEvent('songChange', 'fretlark-song', onSongChange);
  sequencer.eventHandler.addEvent('songEnded', 'fretlark-end', onSongEnded);

  async function renderWav({ onProgress, isCancelled, masterVolume, range, isolateTrack = null, measure = false } = {}) {
    const OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (!OfflineContext) throw Error('Offline audio rendering is unavailable in this browser.');
    if (state.destroyed || !state.soundBankBytes) throw Error('Hi-fi audio is not ready.');

    // The exported file uses the same score MIDI as playback, but never the metronome click track.
    const rendered = renderSong(false);
    if (!rendered || !BasicMIDI) throw Error('The score could not be rendered.');
    const midi = BasicMIDI.fromArrayBuffer(rendered.buffer, 'fretlark.mid');
    const songDuration = state.songEnd > 0 ? state.songEnd : (Number(midi.duration) || 0);
    const shift = rendered.tickShift || 0;

    let secondsRange = null;
    if (range) {
      const startTick = Math.max(0, Number(range.startTick) || 0) + shift;
      const endTick = Math.max(0, Number(range.endTick) || 0) + shift;
      if (endTick > startTick) {
        secondsRange = {
          startSeconds: midi.midiTicksToSeconds(startTick),
          endSeconds: midi.midiTicksToSeconds(endTick)
        };
      }
    }

    // A level measurement needs no ringing tail.
    const tailSeconds = measure ? 0 : WAV_TAIL_SECONDS;
    const renderPlan = wavRenderPlan({ songDuration, sampleRate: WAV_SAMPLE_RATE, tailSeconds });
    const clipPlan = secondsRange
      ? wavRenderPlan({ songDuration, range: secondsRange, sampleRate: WAV_SAMPLE_RATE, tailSeconds })
      : renderPlan;
    // SpessaSynth's documented offline path always starts at the MIDI's beginning. A range that
    // starts at zero can stop the context early; a later range is rendered whole and trimmed.
    const startsAtZero = !secondsRange || clipPlan.startSeconds < 0.001;
    // Rendering past the end of the range is wasted work: stop there and trim the start.
    const renderLength = startsAtZero ? clipPlan.length
      : Math.min(renderPlan.length, Math.max(1, Math.ceil((clipPlan.endSeconds + tailSeconds) * WAV_SAMPLE_RATE)));

    const offlineContext = new OfflineContext({
      numberOfChannels: 2,
      sampleRate: WAV_SAMPLE_RATE,
      length: renderLength
    });
    let offlineSynth;
    try {
      await offlineContext.audioWorklet.addModule(processor);
      offlineSynth = new WorkletSynthesizer(offlineContext, { eventsEnabled: false });
      guardSynthMessages(offlineSynth);
      // Level measurements read the raw track; exports get the same output stage as playback.
      offlineSynth.connect(measure ? offlineContext.destination : createOutputStage(offlineContext));

      if (isCancelled?.()) {
        try { offlineSynth.destroy(); } catch {}
        try { await offlineContext.close(); } catch {}
        return null;
      }
      let snapshot = null;
      try {
        snapshot = await synth.getSnapshot();
        const tracks = isolateTrack == null ? mix.snapshot()
          : mix.snapshot().map(entry => ({ ...entry, solo: false, mute: entry.index !== isolateTrack, volume: 1 }));
        applyMixToSnapshot(snapshot, tracks, masterVolume ?? state.masterVolume);
      } catch (error) {
        console.warn('Fretlark hi-fi mix snapshot unavailable for WAV export.', error);
      }
      if (isCancelled?.()) {
        try { offlineSynth.destroy(); } catch {}
        try { await offlineContext.close(); } catch {}
        return null;
      }

      await offlineSynth.startOfflineRender({
        soundBankList: [{ bankOffset: 0, soundBankBuffer: state.soundBankBytes.slice(0) }],
        midiSequence: midi,
        loopCount: 0,
        sequencerOptions: { skipToFirstNoteOn: false, initialPlaybackRate: 1 },
        ...(snapshot ? { snapshot } : {})
      });
      // The sf3 decoder finishes after the render has been handed its song; the documented
      // offline example waits for this before calling startRendering().
      await offlineSynth.isReady;

      let progressTimer = 0;
      const report = value => { try { onProgress?.(value); } catch {} };
      const progressTotal = (startsAtZero ? clipPlan : renderPlan).seconds || 1;
      if (typeof onProgress === 'function') {
        report(0);
        progressTimer = setInterval(() => {
          if (isCancelled?.()) return;
          const current = Number(offlineSynth.currentTime);
          report(Number.isFinite(current) ? Math.max(0, Math.min(1, current / progressTotal)) : null);
        }, 250);
      }

      // An offline render cannot be aborted, so Cancel stops waiting for it at once and the
      // synth is torn down, which lets the rest of the render finish silently in the background.
      let output, cancelTimer = 0;
      try {
        const cancelled = new Promise(resolve => {
          if (typeof isCancelled === 'function') cancelTimer = setInterval(() => { if (isCancelled()) resolve(null); }, 150);
        });
        output = await Promise.race([offlineContext.startRendering(), cancelled]);
      } finally {
        if (progressTimer) clearInterval(progressTimer);
        if (cancelTimer) clearInterval(cancelTimer);
        try { offlineSynth.destroy(); } catch {}
      }
      if (!output) return null;
      if (isCancelled?.()) return null;
      report(1);

      if (secondsRange && !startsAtZero) {
        const startFrame = Math.max(0, Math.min(output.length, Math.round(clipPlan.startSeconds * output.sampleRate)));
        const frames = Math.max(0, Math.min(clipPlan.length, output.length - startFrame));
        if (frames > 0 && (startFrame > 0 || frames < output.length)) {
          const cropped = offlineContext.createBuffer(output.numberOfChannels, frames, output.sampleRate);
          for (let channel = 0; channel < output.numberOfChannels; channel++) {
            cropped.copyToChannel(output.getChannelData(channel).subarray(startFrame, startFrame + frames), channel);
          }
          output = cropped;
        }
      }
      return output;
    } catch (error) {
      try { offlineSynth?.destroy(); } catch {}
      try { await offlineContext.close(); } catch {}
      throw error;
    }
  }

  const handler = {
    get backingTrackDuration() {
      return state.songReady ? songSecondsToAlphaTabMs(state.songEnd, state.speed) : 0;
    },
    get playbackRate() {
      return state.speed;
    },
    set playbackRate(value) {
      state.speed = clamp(value || 1, MIN_SPEED, MAX_SPEED);
      try { if (sequencer.playbackRate !== state.speed) sequencer.playbackRate = state.speed; } catch {}
    },
    get masterVolume() {
      return state.masterVolume;
    },
    set masterVolume(value) {
      state.masterVolume = clamp(value, 0, 1);
      applyMaster();
    },
    seekTo(milliseconds) {
      // With a count-in, alphaTab's play() reports a seek to 0 on its count-in clock. That is not a
      // song position; taking it would restart the song from the top after every pause.
      if (api.player?._instance?.sequencer?.isPlayingCountIn) return;
      const seconds = alphaTabMsToSongSeconds(milliseconds, state.speed);
      state.seekSeconds = Math.max(0, seconds);
      const tick = Number(api.tickPosition);
      if (Number.isFinite(tick)) state.seekTick = tick;
      if (!state.songReady) state.pendingSeekSeconds = state.seekSeconds;
      // A click on the score during the count-in moves where the song starts.
      if (state.countingIn) state.countInTarget = state.seekSeconds;
      if (state.songReady) {
        seekSequencer(seconds);
        if (state.playing && !state.countingIn && sequencer.paused) {
          try { sequencer.play(); } catch {}
          startAnimation();
        }
      }
    },
    play() {
      if (state.destroyed) return;
      try { context.resume(); } catch {}
      state.playing = true;
      state.intentPlaying = true;
      state.wantPlay = true;
      state.wantedStart = state.seekSeconds ?? state.lastSeconds ?? 0;
      startWantedIfReady();
      emitBackingPosition();
    },
    pause() {
      if (state.destroyed) return;
      state.playing = false;
      state.wantPlay = false;
      cancelCountIn();
      stopAnimation();
      const tick = Number(api.tickPosition);
      if (Number.isFinite(tick)) state.seekTick = tick;
      if (state.songReady) state.seekSeconds = Math.max(0, Number(sequencer.currentHighResolutionTime) || state.seekSeconds);
      try { if (!sequencer.paused) sequencer.pause(); } catch {}
      emitBackingPosition();
    }
  };

  const adapter = {
    onReady: onReady || null,
    get isReady() {
      return !state.destroyed && state.songReady;
    },
    get metronomeChannel() {
      return state.metronomeChannel;
    },
    setMasterVolume(value) {
      handler.masterVolume = value;
    },
    renderWav(options) {
      return renderWav(options);
    },
    // Read-only view of the live synth state (channel mutes, gains), for diagnostics.
    debugSnapshot() {
      return synth.getSnapshot();
    },
    // Peak and RMS of one track on its own over a tick range, used to level a quiet solo.
    async measureTrackLevel(track, range) {
      const buffer = await renderWav({ range, isolateTrack: track.index, masterVolume: 1, measure: true });
      if (!buffer) return null;
      let peak = 0, energy = 0, count = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < data.length; i++) { const v = data[i]; if (v > peak) peak = v; else if (-v > peak) peak = -v; energy += v * v; }
        count += data.length;
      }
      return { peak, rms: count ? Math.sqrt(energy / count) : 0 };
    },
    setMetronomeVolume(value) {
      state.metronomeVolume = Math.max(0, Number(value) || 0);
      applyMetronome();
    },
    setCountInVolume(value) {
      state.countInVolume = Math.max(0, Number(value) || 0);
      if (state.countInVolume <= 0 && state.countingIn) {
        cancelCountIn();
        if (state.playing) startTransport(state.wantedStart || state.seekSeconds || 0);
      }
    },
    setPlaybackSpeed(value) {
      handler.playbackRate = value;
    },
    // BACKING-TRACK: backing-track.js mirrors score playback onto an audio file.
    addPositionListener(listener) {
      if (typeof listener === 'function') { positionListeners.add(listener); emitBackingPosition(); }
      return () => positionListeners.delete(listener);
    },
    removePositionListener(listener) {
      positionListeners.delete(listener);
    },
    ticksToSeconds(tick) {
      try {
        if (!state.songMidi && state.songMidiBuffer && BasicMIDI) state.songMidi = BasicMIDI.fromArrayBuffer(state.songMidiBuffer, 'fretlark-map.mid');
        const seconds = state.songMidi?.midiTicksToSeconds(Math.max(0, Math.round(Number(tick) || 0)));
        return Number.isFinite(seconds) ? seconds : null;
      } catch { return null; }
    },
    setTrackMute(track, mute) {
      mix.setTrackMute(track, mute);
    },
    setTrackSolo(track, solo) {
      mix.setTrackSolo(track, solo);
    },
    setTrackVolume(track, volume) {
      mix.setTrackVolume(track, volume);
    },
    syncFromScore(scoreValue) {
      state.newScore = !state.score || state.score !== scoreValue;
      mix.sync(scoreValue?.tracks || []);
    },
    onMidiLoaded() {
      if (state.destroyed) return;
      // Capture resume intent before loadMidiFile's stop timeout clears it, then reload the
      // generated MIDI after alphaTab has restored its own pending tick position.
      state.pendingResume = state.resumeAfterReload === true;
      state.resumeAfterReload = false;
      const wanted = state.pendingResume
        ? state.lastSeconds
        : alphaTabMsToSongSeconds(api.player?.timePosition ?? 0, state.speed);
      state.pendingSeekSeconds = Math.max(0, Number.isFinite(wanted) ? wanted : 0);
      state.newScore = api.score !== state.score;
      clearTimeout(state.reloadTimer);
      state.reloadTimer = setTimeout(reloadMidi, 90);
    },
    auditionNote(note, track) {
      if (!note || state.destroyed) return;
      const owner = track || note.beat?.voice?.bar?.staff?.track || api.score?.tracks?.[0];
      const channelNumber = state.channelPlan?.byTrack.get(owner?.index)?.primary ?? owner?.playbackInfo?.primaryChannel ?? 0;
      const key = clamp(Number.isFinite(note.realValue) ? note.realValue : 60, 0, 127);
      try {
        synth.programChange(channelNumber, owner?.playbackInfo?.program ?? 0);
        synth.noteOn(channelNumber, key, 100);
      } catch { return; }
      const token = ++state.auditionToken;
      setTimeout(() => {
        if (token > state.auditionToken) return;
        try { synth.noteOff(channelNumber, key); } catch {}
      }, 600);
    },
    destroy() {
      if (state.destroyed) return;
      state.destroyed = true;
      cancelCountIn();
      clearTimeout(state.reloadTimer);
      stopAnimation();
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibilityChange);
      try { sequencer.pause(); } catch {}
      try { synth.destroy(); } catch {}
      try { context.close(); } catch {}
    }
  };

  const onVisibilityChange = () => {
    if (state.destroyed || !state.playing) return;
    if (globalThis.document?.hidden) {
      updatePosition();
      positionClock.start();
    }
  };
  globalThis.document?.addEventListener?.('visibilitychange', onVisibilityChange);

  // Track user intent separately from the internal stop that alphaTab performs when it reloads
  // the MIDI after an edit. A real stop is not followed by midiLoaded, so the flag is dropped.
  if (api.playerStateChanged && typeof api.playerStateChanged.on === 'function') {
    api.playerStateChanged.on(event => {
      if (event.state === 1) state.intentPlaying = true;
      else if (event.stopped) {
        if (state.intentPlaying) {
          state.resumeAfterReload = true;
          setTimeout(() => { state.resumeAfterReload = false; }, 0);
        }
        state.intentPlaying = false;
      } else {
        // A real pause (not the internal stop before a MIDI reload) clears the intent.
        state.intentPlaying = false;
      }
    });
  }

  state.speed = clamp(api.playbackSpeed ?? 1, MIN_SPEED, MAX_SPEED);
  try { sequencer.playbackRate = state.speed; } catch {}
  applyMaster();
  api.player.output.handler = handler;
  state.score = api.score;

  if (api.score) {
    const initialPosition = alphaTabMsToSongSeconds(api.player?.timePosition ?? 0, state.speed);
    state.pendingSeekSeconds = Math.max(0, initialPosition);
    state.newScore = true;
    reloadMidi();
  }

  return adapter;
}
