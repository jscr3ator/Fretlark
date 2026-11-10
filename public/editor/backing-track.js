/* Fretlark backing track: import an audio recording, show its waveform, align it to the score.
 *
 * Score alignment reuses alphaTab's own model: score.backingTrack holds the raw audio bytes
 * (round-tripped in exported GP files) and MasterBar.syncPoints holds Automation records of
 * type SyncPoint whose millisecondOffset marks the audio position of that bar. Between sync
 * points, score time maps linearly onto audio time. Playback mirrors the hi-fi synth through
 * hifi-player.js position listeners (see the BACKING-TRACK hooks there) onto an audio element.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FretlarkBackingTrack = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Pure core (unit-tested in verify-backing-track.cjs; no DOM or alphaTab needed)
  // ---------------------------------------------------------------------------

  /** Largest accepted audio import; bigger files risk OOM during decode. */
  const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
  const ACCEPTED_EXTENSIONS = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac'];
  const DB_NAME = 'fretlark-backing-track';
  const PEAK_COLUMNS = 1400;

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.max(min, Math.min(max, number));
  }

  /** Null when the file looks importable, otherwise a user-facing reason. */
  function validateAudioFile(name, size) {
    const base = String(name || '').split(/[\\/]/).pop();
    const extension = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      return `Could not import ${base || 'that file'}. Use mp3, wav, ogg or m4a/aac audio.`;
    }
    if (!Number.isFinite(Number(size)) || Number(size) <= 0) return 'That file is empty.';
    if (Number(size) > MAX_AUDIO_BYTES) return `That file is ${(Number(size) / 1048576).toFixed(0)} MB. Keep backing tracks under 60 MB.`;
    return null;
  }

  /** Storage key: cloud lesson wins, then the device song id, then the draft slot. */
  function songKeyFor({ lessonId = null, localId = null, documentIndex = 0 } = {}) {
    if (lessonId) return `lesson:${lessonId}`;
    if (localId) return `local:${localId}`;
    return `draft:${Number.isInteger(documentIndex) ? documentIndex : 0}`;
  }

  /** Flat sync-point list: [{barIndex, barOccurence, barPosition, millisecondOffset}]. */
  function readSyncPoints(masterBars) {
    const flat = [];
    for (const masterBar of masterBars || []) {
      for (const automation of masterBar?.syncPoints || []) {
        if (automation?.type !== 4) continue; // AutomationType.SyncPoint
        flat.push({
          barIndex: masterBar.index,
          barOccurence: Number(automation.syncPointValue?.barOccurence) || 0,
          barPosition: clamp(Number(automation.ratioPosition) || 0, 0, 1),
          millisecondOffset: Number(automation.syncPointValue?.millisecondOffset) || 0
        });
      }
    }
    return flat.sort((a, b) => a.barIndex - b.barIndex || a.barOccurence - b.barOccurence || a.barPosition - b.barPosition);
  }

  function normalizeFlatPoints(flat, barCount) {
    const count = Math.max(1, Math.floor(Number(barCount) || 1));
    const seen = new Set(), out = [];
    for (const point of flat || []) {
      const barIndex = clamp(Math.round(Number(point?.barIndex) || 0), 0, count - 1);
      const barOccurence = Math.max(0, Math.round(Number(point?.barOccurence) || 0));
      const barPosition = clamp(Number(point?.barPosition) || 0, 0, 1);
      const millisecondOffset = Math.max(0, Math.round(Number(point?.millisecondOffset) || 0));
      if (!Number.isFinite(millisecondOffset)) continue;
      const key = `${barIndex}:${barOccurence}:${barPosition}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ barIndex, barOccurence, barPosition, millisecondOffset });
    }
    return out.sort((a, b) => a.barIndex - b.barIndex || a.barOccurence - b.barOccurence || a.barPosition - b.barPosition);
  }

  /**
   * Replace every sync-point automation on the given master bars with the flat list.
   * atModel is alphaTab's model namespace ({Automation, AutomationType, SyncPointData}).
   */
  function writeSyncPoints(atModel, masterBars, flat) {
    if (!atModel || !masterBars) throw Error('Select a song first.');
    const bars = Array.from(masterBars);
    for (const bar of bars) bar.syncPoints = undefined;
    for (const point of normalizeFlatPoints(flat, bars.length)) {
      const bar = bars[point.barIndex];
      if (!bar) continue;
      const automation = new atModel.Automation();
      automation.type = atModel.AutomationType.SyncPoint;
      automation.isLinear = false;
      automation.ratioPosition = point.barPosition;
      automation.isVisible = false;
      const value = new atModel.SyncPointData();
      value.barOccurence = point.barOccurence;
      value.millisecondOffset = point.millisecondOffset;
      automation.syncPointValue = value;
      if (typeof bar.addSyncPoint === 'function') bar.addSyncPoint(automation);
      else (bar.syncPoints || (bar.syncPoints = [])).push(automation);
    }
    return readSyncPoints(bars);
  }

  /** Global offset = the audio position of bar 1 (bar 0, start, first occurrence). */
  function globalOffsetMs(flat) {
    const first = (flat || []).find(point => point.barIndex === 0 && point.barOccurence === 0 && point.barPosition === 0);
    return first ? first.millisecondOffset : 0;
  }

  function setGlobalOffset(flat, offsetMs) {
    const offset = Math.max(0, Math.round(Number(offsetMs) || 0));
    const rest = (flat || []).filter(point => !(point.barIndex === 0 && point.barOccurence === 0 && point.barPosition === 0));
    return [{ barIndex: 0, barOccurence: 0, barPosition: 0, millisecondOffset: offset }, ...rest]
      .sort((a, b) => a.barIndex - b.barIndex || a.barOccurence - b.barOccurence || a.barPosition - b.barPosition);
  }

  /**
   * Score-time to audio-time map. tickToSeconds maps a MIDI tick to song seconds and
   * barTickRange maps a master-bar index to {start, end} ticks (first occurrence).
   * Returns null when no point can be placed yet (caller keeps its last good map).
   */
  function buildSyncMap(flat, tickToSeconds, barTickRange) {
    const points = [];
    for (const point of flat || []) {
      const range = barTickRange ? barTickRange(point.barIndex) : null;
      if (!range || !(range.end > range.start)) continue;
      const tick = range.start + clamp(point.barPosition, 0, 1) * (range.end - range.start);
      const seconds = tickToSeconds ? tickToSeconds(tick) : null;
      if (!Number.isFinite(seconds)) continue;
      points.push({ songMs: seconds * 1000, audioMs: Math.max(0, point.millisecondOffset) });
    }
    if (!points.length) return null;
    points.sort((a, b) => a.songMs - b.songMs);
    const merged = [];
    for (const point of points) {
      const last = merged[merged.length - 1];
      if (last && last.songMs === point.songMs) merged[merged.length - 1] = point;
      else merged.push(point);
    }
    return merged;
  }

  /**
   * Linear interpolation between sync points; outside the outermost points the audio
   * runs at score speed (slope 1), so a single global offset shifts the whole song.
   */
  function audioMsForSongMs(map, songMs) {
    const time = Math.max(0, Number(songMs) || 0);
    if (!map || !map.length) return time;
    if (time <= map[0].songMs) return Math.max(0, map[0].audioMs + (time - map[0].songMs));
    for (let i = 1; i < map.length; i++) {
      if (time <= map[i].songMs) {
        const span = map[i].songMs - map[i - 1].songMs;
        if (!(span > 0)) return map[i].audioMs;
        const ratio = (time - map[i - 1].songMs) / span;
        return map[i - 1].audioMs + ratio * (map[i].audioMs - map[i - 1].audioMs);
      }
    }
    const last = map[map.length - 1];
    return Math.max(0, last.audioMs + (time - last.songMs));
  }

  /** Accumulate min/max peaks for samples in [start, end) into mins/maxs (chunk-safe). */
  function peaksForRange(channels, columns, start, end, total, mins, maxs) {
    const count = Math.max(1, Math.floor(columns));
    for (let column = 0; column < count; column++) {
      const columnStart = Math.floor(column * total / count);
      const columnEnd = Math.floor((column + 1) * total / count);
      if (columnEnd <= start || columnStart >= end) continue;
      let lo = mins[column], hi = maxs[column];
      for (let channel = 0; channel < channels.length; channel++) {
        const data = channels[channel];
        if (!data) continue;
        const from = Math.max(columnStart, start);
        const to = Math.min(columnEnd, end, data.length);
        for (let i = from; i < to; i++) {
          const sample = data[i];
          if (sample < lo) lo = sample;
          if (sample > hi) hi = sample;
        }
      }
      mins[column] = lo;
      maxs[column] = hi;
    }
    return { mins, maxs };
  }

  function newPeakBuffers(columns) {
    return { mins: new Float32Array(columns).fill(Infinity), maxs: new Float32Array(columns).fill(-Infinity) };
  }

  function finalizePeaks({ mins, maxs }) {
    for (let i = 0; i < mins.length; i++) {
      if (!Number.isFinite(mins[i])) { mins[i] = 0; maxs[i] = 0; }
    }
    return { mins, maxs };
  }

  function formatAudioTime(milliseconds) {
    const total = Math.max(0, Number(milliseconds) || 0);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    const millis = Math.floor(total % 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  }

  // ---------------------------------------------------------------------------
  // IndexedDB store (browser only; every call is failure-tolerant)
  // ---------------------------------------------------------------------------

  let dbPromise = null;
  function openDb() {
    if (typeof indexedDB === 'undefined') return Promise.reject(Error('No IndexedDB'));
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        try {
          const request = indexedDB.open(DB_NAME, 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore('meta', { keyPath: 'key' });
            request.result.createObjectStore('audio', { keyPath: 'key' });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || Error('IndexedDB unavailable'));
          request.onblocked = () => reject(Error('IndexedDB blocked'));
        } catch (error) { reject(error); }
      }).catch(error => { dbPromise = null; throw error; });
    }
    return dbPromise;
  }

  function storeOp(store, mode, run) {
    return openDb().then(db => new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(store, mode);
        const result = run(tx.objectStore(store));
        tx.oncomplete = () => resolve(result?.value);
        tx.onerror = () => reject(tx.error || Error('IndexedDB write failed'));
        tx.onabort = () => reject(tx.error || Error('IndexedDB write failed'));
      } catch (error) { reject(error); }
    }));
  }

  function getRow(store, key) {
    return storeOp(store, 'readonly', table => {
      const request = table.get(key);
      const holder = {};
      request.onsuccess = () => { holder.value = request.result || null; };
      return holder;
    });
  }

  function putRow(store, value) {
    return storeOp(store, 'readwrite', table => { table.put(value); return { value: null }; }).then(() => null);
  }

  function deleteRow(store, key) {
    return storeOp(store, 'readwrite', table => { table.delete(key); return { value: null }; }).then(() => null);
  }

  // ---------------------------------------------------------------------------
  // Browser controller
  // ---------------------------------------------------------------------------

  const isBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';
  const els = {};
  const controller = {
    key: null, bytes: null, blobUrl: null, audio: null,
    peaks: null, durationMs: 0, fileName: '', mime: '',
    volume: 0.8, muted: false, solo: false, synthMuted: false,
    hifi: null, unsubscribe: null, pendingFlat: null,
    lastFlatJson: '', loadToken: 0, decodeToken: 0, applying: false,
    saveTimer: 0, mapCache: null, synthMuteApplied: null, blockedNote: false, ready: false
  };
  let dragState = null;

  function studio() { return (typeof window !== 'undefined' && window.studio) || null; }
  function atModel() { return (typeof window !== 'undefined' && window.alphaTab && window.alphaTab.model) || null; }
  function toastStatus(message) { if (els.status) els.status.textContent = message; }

  function currentFlat() {
    if (controller.pendingFlat) return controller.pendingFlat;
    const score = studio()?.score;
    return score ? readSyncPoints(score.masterBars) : [];
  }

  function barTickRange(score, barIndex) {
    try {
      const lookup = studio()?.api?.tickCache?.masterBars || [];
      const entry = lookup.find(item => item?.masterBar?.index === barIndex) || lookup[barIndex];
      if (entry && Number.isFinite(entry.start) && Number.isFinite(entry.end) && entry.end > entry.start) {
        return { start: entry.start, end: entry.end };
      }
    } catch {}
    return null;
  }

  function buildMap(flat) {
    const score = studio()?.score;
    if (!score) return null;
    const map = buildSyncMap(flat, tick => controller.hifi?.ticksToSeconds(tick) ?? null, bar => barTickRange(score, bar));
    if (map) controller.mapCache = map;
    return map || controller.mapCache;
  }

  // -- audio element ----------------------------------------------------------

  function ensureAudio() {
    if (controller.audio || !isBrowser) return controller.audio;
    const element = document.createElement('audio');
    element.preload = 'auto';
    element.addEventListener('timeupdate', () => drawWave());
    element.addEventListener('loadedmetadata', () => {
      if (Number.isFinite(element.duration) && element.duration > 0) {
        controller.durationMs = element.duration * 1000;
        drawWave();
      }
    });
    controller.audio = element;
    applyAudioMix();
    return element;
  }

  function applyAudioMix() {
    const element = controller.audio;
    if (!element) return;
    try {
      element.volume = controller.muted ? 0 : clamp(controller.volume, 0, 1);
      element.muted = !!controller.muted;
    } catch {}
  }

  /** Muting the synth ducks the SpessaSynth master gain; the backing audio is separate. */
  function applySynthMute() {
    const hifi = controller.hifi, api = studio()?.api;
    if (!hifi || !api) return;
    const wantMuted = controller.synthMuted || controller.solo;
    const want = wantMuted ? 0 : clamp(api.masterVolume, 0, 1);
    if (controller.synthMuteApplied !== want) {
      controller.synthMuteApplied = want;
      try { hifi.setMasterVolume(want); } catch {}
    }
  }

  function onHifiPosition(event) {
    if (!isBrowser) return;
    applySynthMute();
    if (!controller.audio || !controller.bytes?.length) return;
    const score = studio()?.score;
    if (!score) return;
    const flat = currentFlat();
    const map = flat.length ? (buildMap(flat) || controller.mapCache) : null;
    const targetMs = audioMsForSongMs(map, (Number(event.songSeconds) || 0) * 1000);
    const durationSec = controller.durationMs > 0 ? controller.durationMs / 1000 : (Number(event.songEnd) || 0);
    const target = clamp(targetMs / 1000, 0, Math.max(0, durationSec));
    const element = controller.audio;
    try {
      const speed = clamp(Number(event.speed) || 1, 0.5, 4);
      if (element.playbackRate !== speed) element.playbackRate = speed;
    } catch {}
    if (!event.playing) {
      if (!element.paused) { try { element.pause(); } catch {} }
      if (Math.abs(element.currentTime - target) > 0.05) { try { element.currentTime = target; } catch {} }
      drawWave();
      return;
    }
    if (durationSec > 0 && target >= durationSec - 0.05) {
      if (!element.paused) { try { element.pause(); } catch {} }
      drawWave();
      return;
    }
    if (element.paused) {
      try { element.currentTime = target; } catch {}
      const played = element.play();
      if (played && typeof played.catch === 'function') {
        played.catch(() => {
          if (!controller.blockedNote) {
            controller.blockedNote = true;
            toastStatus('Browser blocked backing audio. Press play again to hear it.');
          }
        });
      }
    } else if (Math.abs(element.currentTime - target) > 0.15) {
      try { element.currentTime = target; } catch {}
    }
    drawWave();
  }

  // -- waveform ---------------------------------------------------------------

  function drawWave() {
    const canvas = els.wave;
    if (!canvas || !canvas.clientWidth) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight || 96;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(document.documentElement);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(127,127,127,.08)';
    ctx.fillRect(0, 0, width, height);
    const mid = height / 2, amp = height / 2 - 6;
    const duration = controller.durationMs;
    if (controller.peaks && duration > 0) {
      const { mins, maxs } = controller.peaks, columns = mins.length;
      ctx.fillStyle = style.getPropertyValue('--accent-text')?.trim() || '#64b0ff';
      const step = width / columns;
      for (let column = 0; column < columns; column++) {
        const x = Math.floor(column * step);
        const y1 = mid - (maxs[column] || 0) * amp;
        const y2 = mid - (mins[column] || 0) * amp;
        ctx.fillRect(x, Math.min(y1, y2), Math.max(1, Math.ceil(step)), Math.max(1, Math.abs(y2 - y1)));
      }
    } else {
      ctx.fillStyle = 'rgba(127,127,127,.5)';
      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(controller.bytes ? 'Decoding waveform…' : 'No backing track', width / 2, mid + 4);
    }
    if (duration > 0) {
      const flat = currentFlat();
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      for (const point of flat) {
        const x = clamp(point.millisecondOffset / duration, 0, 1) * width;
        const isGlobal = point.barIndex === 0 && point.barOccurence === 0 && point.barPosition === 0;
        ctx.strokeStyle = isGlobal ? '#30d158' : '#ffb340';
        ctx.beginPath();
        ctx.moveTo(x + .5, 0);
        ctx.lineTo(x + .5, height);
        ctx.stroke();
        ctx.fillStyle = isGlobal ? '#30d158' : '#ffb340';
        ctx.fillText(`B${point.barIndex + 1}`, Math.min(x + 3, width - 24), 11);
      }
      let playheadMs = null;
      if (controller.audio && controller.bytes) playheadMs = controller.audio.currentTime * 1000;
      if (playheadMs != null && Number.isFinite(playheadMs)) {
        const x = clamp(playheadMs / duration, 0, 1) * width;
        ctx.strokeStyle = '#ff453a';
        ctx.beginPath();
        ctx.moveTo(x + .5, 0);
        ctx.lineTo(x + .5, height);
        ctx.stroke();
      }
    }
  }

  // -- score + storage sync ----------------------------------------------------

  function commitFlat(flat, { silent = true } = {}) {
    const st = studio(), model = atModel();
    if (!st?.score || !model) return false;
    if (st.score.masterBars.length < 1) return false;
    const normalized = normalizeFlatPoints(flat, st.score.masterBars.length);
    controller.applying = true;
    try {
      st.mutate(score => { writeSyncPoints(model, score.masterBars, normalized); }, silent ? 'Song updated' : 'Backing track alignment updated');
    } catch { return false; }
    finally { controller.applying = false; }
    queueMetaSave();
    return true;
  }

  function queueMetaSave() {
    if (!isBrowser || !controller.key) return;
    clearTimeout(controller.saveTimer);
    controller.saveTimer = setTimeout(() => { saveMeta().catch(() => {}); }, 600);
  }

  function saveMeta() {
    if (!controller.key) return Promise.resolve();
    const score = studio()?.score;
    const row = {
      key: controller.key,
      name: controller.fileName || '',
      mime: controller.mime || '',
      size: controller.bytes?.length || 0,
      durationMs: Math.round(controller.durationMs) || 0,
      syncPoints: score ? readSyncPoints(score.masterBars) : [],
      volume: controller.volume,
      muted: controller.muted,
      solo: controller.solo,
      synthMuted: controller.synthMuted,
      updatedAt: new Date().toISOString()
    };
    if (!controller.bytes && !row.syncPoints.length) return Promise.resolve();
    return putRow('meta', row).catch(() => null);
  }

  function saveAudioBytes() {
    if (!controller.key || !controller.bytes?.length) return Promise.resolve();
    return putRow('audio', { key: controller.key, bytes: controller.bytes }).catch(() => null);
  }

  function refreshMarkers() {
    const score = studio()?.score;
    const flat = score ? readSyncPoints(score.masterBars) : [];
    const json = JSON.stringify(flat);
    const bytesKey = controller.bytes ? `audio:${controller.bytes.length}` : 'none';
    const changed = json !== controller.lastFlatJson || bytesKey !== controller.lastBytesKey;
    controller.lastFlatJson = json;
    controller.lastBytesKey = bytesKey;
    if (els.offset && document.activeElement !== els.offset) els.offset.value = String(globalOffsetMs(flat));
    if (els.syncHere && score) els.syncHere.textContent = `Sync bar ${(studio()?.selected?.bar ?? 0) + 1} to audio position`;
    if (els.markers && changed) {
      els.markers.replaceChildren();
      if (!flat.length) {
        const empty = document.createElement('span');
        empty.className = 'bt-empty';
        empty.textContent = controller.bytes ? 'Only the global offset is set.' : 'Import audio to align it.';
        els.markers.appendChild(empty);
      }
      for (const [index, point] of flat.entries()) {
        const row = document.createElement('div');
        row.className = 'bt-marker';
        const label = document.createElement('span');
        label.textContent = point.barIndex === 0 && point.barOccurence === 0 && point.barPosition === 0
          ? `Offset · ${formatAudioTime(point.millisecondOffset)}`
          : `Bar ${point.barIndex + 1} · ${formatAudioTime(point.millisecondOffset)}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'mini-tool bt-remove-marker';
        remove.textContent = '×';
        remove.title = 'Remove this sync point';
        remove.setAttribute('aria-label', `Remove sync point at bar ${point.barIndex + 1}`);
        remove.dataset.index = String(index);
        row.append(label, remove);
        els.markers.appendChild(row);
      }
    }
    if (changed) drawWave();
  }

  function adoptScoreBytes(score) {
    const carried = score?.backingTrack?.rawAudioFile;
    if (!controller.bytes && carried && carried.length) {
      controller.bytes = carried instanceof Uint8Array ? carried : new Uint8Array(carried);
      controller.fileName = controller.fileName || 'audio track';
      setupAudioElement();
      decodePeaksBackground();
    }
  }

  async function loadSongAudio(key, score, token) {
    clearAudioState();
    adoptScoreBytes(score);
    let meta = null, stored = null;
    try {
      meta = await getRow('meta', key);
      stored = await getRow('audio', key);
    } catch { meta = null; stored = null; }
    if (token !== controller.loadToken) return;
    if (meta) {
      controller.volume = clamp(Number(meta.volume ?? 0.8), 0, 1);
      controller.muted = !!meta.muted;
      controller.solo = !!meta.solo;
      controller.synthMuted = !!meta.synthMuted;
      if (!controller.fileName && meta.name) controller.fileName = meta.name;
      if (!controller.mime && meta.mime) controller.mime = meta.mime;
      syncControls();
    }
    if (controller.bytes) {
      if ((!readSyncPoints(score.masterBars).length) && meta?.syncPoints?.length) {
        commitFlat(meta.syncPoints);
      }
      await saveAudioBytes();
      await saveMeta();
    } else if (meta && stored?.bytes?.length) {
      const bytes = stored.bytes instanceof Uint8Array ? stored.bytes : new Uint8Array(stored.bytes);
      await setAudioBytes(bytes, { name: meta.name || 'audio track', mime: meta.mime || '', resetAlign: false });
      if (!readSyncPoints(score.masterBars).length && meta.syncPoints?.length) commitFlat(meta.syncPoints);
    }
    controller.mapCache = null;
    refreshPanel();
  }

  /** Called from app.js renderScore (BACKING-TRACK hook) after every score change. */
  function onScoreChanged(score) {
    if (!isBrowser || !controller.ready || controller.applying || !score) return;
    const st = studio();
    if (!st) return;
    const key = songKeyFor({ lessonId: st.remoteLesson?.id ?? null, localId: st.localId ?? null, documentIndex: st.documentIndex ?? 0 });
    if (key !== controller.key) {
      controller.key = key;
      const token = ++controller.loadToken;
      loadSongAudio(key, score, token).catch(() => {});
      return;
    }
    adoptScoreBytes(score);
    refreshMarkers();
    queueMetaSave();
  }

  function clearAudioState() {
    controller.decodeToken++;
    if (controller.audio) { try { controller.audio.pause(); } catch {} }
    if (controller.blobUrl) { try { URL.revokeObjectURL(controller.blobUrl); } catch {} }
    controller.blobUrl = null;
    controller.bytes = null;
    controller.peaks = null;
    controller.durationMs = 0;
    controller.fileName = '';
    controller.mime = '';
    controller.pendingFlat = null;
    controller.mapCache = null;
    controller.blockedNote = false;
  }

  // -- import / decode / remove -------------------------------------------------

  function setupAudioElement() {
    if (!controller.bytes?.length) return;
    const element = ensureAudio();
    if (controller.blobUrl) { try { URL.revokeObjectURL(controller.blobUrl); } catch {} }
    const type = controller.mime || 'audio/mpeg';
    controller.blobUrl = URL.createObjectURL(new Blob([controller.bytes], { type }));
    controller.blockedNote = false;
    try {
      element.src = controller.blobUrl;
      element.load();
    } catch {}
    applyAudioMix();
  }

  async function decodePeaksBackground() {
    const token = ++controller.decodeToken;
    const bytes = controller.bytes;
    if (!bytes?.length || typeof OfflineAudioContext === 'undefined') return;
    toastStatus('Decoding waveform…');
    try {
      const context = new OfflineAudioContext(1, 1, 8000);
      const copy = bytes.slice(0).buffer;
      const decoded = await context.decodeAudioData(copy);
      if (token !== controller.decodeToken) return;
      const data = decoded.getChannelData(0);
      const total = data.length;
      const { mins, maxs } = newPeakBuffers(PEAK_COLUMNS);
      const CHUNK = 1 << 20;
      for (let start = 0; start < total; start += CHUNK) {
        if (token !== controller.decodeToken) return;
        peaksForRange([data], PEAK_COLUMNS, start, Math.min(total, start + CHUNK), total, mins, maxs);
        toastStatus(`Decoding waveform… ${Math.round(Math.min(start + CHUNK, total) / total * 100)}%`);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (token !== controller.decodeToken) return;
      controller.peaks = finalizePeaks({ mins, maxs });
      refreshPanel();
      toastStatus(`${controller.fileName} · ${formatAudioTime(controller.durationMs)}`);
    } catch (error) {
      if (token !== controller.decodeToken) return;
      controller.peaks = null;
      drawWave();
      toastStatus(`Audio loaded, but the waveform could not be decoded: ${error?.message || error}`);
    }
  }

  async function setAudioBytes(bytes, { name = 'audio track', mime = '', resetAlign = false, prefs = null } = {}) {
    const token = ++controller.loadToken;
    clearAudioState();
    controller.key = controller.key || songKeyFor({
      lessonId: studio()?.remoteLesson?.id ?? null,
      localId: studio()?.localId ?? null,
      documentIndex: studio()?.documentIndex ?? 0
    });
    controller.bytes = bytes;
    controller.fileName = String(name || 'audio track').slice(0, 180);
    controller.mime = String(mime || '');
    if (prefs) {
      controller.volume = clamp(Number(prefs.volume ?? 0.8), 0, 1);
      controller.muted = !!prefs.muted;
      controller.solo = !!prefs.solo;
      controller.synthMuted = !!prefs.synthMuted;
    }
    setupAudioElement();
    if (resetAlign) commitFlat([]);
    await saveAudioBytes();
    await saveMeta();
    syncControls();
    refreshPanel();
    if (token !== controller.loadToken) return;
    decodePeaksBackground().catch(() => {});
  }

  async function importFile(file) {
    if (!file) return;
    const problem = validateAudioFile(file.name, file.size);
    if (problem) { toastStatus(problem); return; }
    toastStatus(`Reading ${file.name}…`);
    try {
      const buffer = await file.arrayBuffer();
      await setAudioBytes(new Uint8Array(buffer), { name: file.name, mime: file.type || '', resetAlign: true });
      toastStatus(`${file.name} · ${formatAudioTime(controller.durationMs)}`);
    } catch (error) {
      toastStatus(`Could not import that file: ${error?.message || error}`);
    }
  }

  async function removeAudio() {
    const key = controller.key;
    clearAudioState();
    controller.volume = 0.8; controller.muted = false; controller.solo = false;
    const st = studio(), model = atModel();
    if (st?.score && model) {
      controller.applying = true;
      try {
        st.mutate(score => {
          score.backingTrack = undefined;
          for (const masterBar of score.masterBars) masterBar.syncPoints = undefined;
        }, 'Song updated');
      } catch {}
      finally { controller.applying = false; }
    }
    controller.lastFlatJson = '';
    if (key) {
      try { await deleteRow('audio', key); } catch {}
      try { await deleteRow('meta', key); } catch {}
    }
    syncControls();
    refreshPanel();
    toastStatus('Backing track removed.');
  }

  // -- panel UI -----------------------------------------------------------------

  function refreshPanel() {
    const has = !!controller.bytes?.length;
    if (els.fileLabel) els.fileLabel.textContent = has ? controller.fileName : 'No audio imported';
    if (els.remove) els.remove.disabled = !has;
    if (els.syncHere) els.syncHere.disabled = !has;
    if (els.offset) els.offset.disabled = !has;
    for (const button of Object.values(els.nudges || {})) button.disabled = !has;
    if (els.wave) els.wave.classList.toggle('is-empty', !has);
    refreshMarkers();
    drawWave();
  }

  function syncControls() {
    if (els.volume) els.volume.value = String(Math.round(controller.volume * 100));
    if (els.volumeValue) els.volumeValue.textContent = `${Math.round(controller.volume * 100)}%`;
    if (els.mute) { els.mute.classList.toggle('active', controller.muted); els.mute.setAttribute('aria-pressed', String(controller.muted)); }
    if (els.solo) { els.solo.classList.toggle('active', controller.solo); els.solo.setAttribute('aria-pressed', String(controller.solo)); }
    if (els.synth) els.synth.checked = controller.synthMuted;
    applyAudioMix();
  }

  function buildPanel() {
    const host = document.getElementById('inspector-song');
    if (!host || document.getElementById('bt-panel')) return false;
    const divider = document.createElement('div');
    divider.className = 'inspector-divider';
    const title = document.createElement('div');
    title.className = 'inspector-title';
    const label = document.createElement('span');
    label.textContent = 'Backing track';
    const status = document.createElement('span');
    status.id = 'bt-status';
    status.className = 'bt-status';
    status.textContent = 'No audio';
    title.append(label, status);
    const panel = document.createElement('section');
    panel.id = 'bt-panel';
    panel.className = 'bt-panel';
    panel.setAttribute('aria-label', 'Backing track');
    panel.innerHTML = `
      <div class="bt-file-row"><strong id="bt-file-label">No audio imported</strong></div>
      <canvas id="bt-wave" class="bt-wave is-empty" height="96" title="Drag sideways to shift the global offset"></canvas>
      <div class="bt-hint">Drag the waveform to shift the offset. Markers show sync points; the red line follows playback.</div>
      <div class="bt-row">
        <button type="button" class="button button-secondary bt-btn" id="bt-import">Import audio…</button>
        <button type="button" class="mini-tool" id="bt-remove" disabled>Remove</button>
        <input type="file" id="bt-file" accept=".mp3,.wav,.ogg,.oga,.m4a,.aac,audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/x-m4a" hidden>
      </div>
      <label class="field-label" for="bt-offset">Global offset (ms, audio position of bar 1)</label>
      <div class="bt-row">
        <input id="bt-offset" class="text-input bt-offset" type="number" min="0" step="1" value="0" disabled>
        <button type="button" class="mini-tool" data-nudge="-100" title="Nudge 100 ms earlier">−100</button>
        <button type="button" class="mini-tool" data-nudge="-10" title="Nudge 10 ms earlier">−10</button>
        <button type="button" class="mini-tool" data-nudge="10" title="Nudge 10 ms later">+10</button>
        <button type="button" class="mini-tool" data-nudge="100" title="Nudge 100 ms later">+100</button>
      </div>
      <div class="bt-row"><button type="button" class="button button-secondary bt-btn" id="bt-sync-here" disabled>Sync bar 1 to audio position</button></div>
      <div class="bt-markers" id="bt-markers"></div>
      <label class="field-label" for="bt-volume">Backing volume</label>
      <div class="range-line"><input id="bt-volume" type="range" min="0" max="100" value="80" aria-label="Backing track volume"><span class="range-value" id="bt-volume-value">80%</span></div>
      <div class="bt-row">
        <button type="button" class="mini-tool" id="bt-mute" aria-pressed="false">Mute</button>
        <button type="button" class="mini-tool" id="bt-solo" aria-pressed="false" title="Solo the backing track (mutes the synth)">Solo</button>
        <label class="check-control bt-check"><input id="bt-synth" type="checkbox"><span>Mute synth</span></label>
      </div>`;
    host.append(divider, title, panel);
    els.status = status;
    els.fileLabel = panel.querySelector('#bt-file-label');
    els.wave = panel.querySelector('#bt-wave');
    els.file = panel.querySelector('#bt-file');
    els.import = panel.querySelector('#bt-import');
    els.remove = panel.querySelector('#bt-remove');
    els.offset = panel.querySelector('#bt-offset');
    els.syncHere = panel.querySelector('#bt-sync-here');
    els.markers = panel.querySelector('#bt-markers');
    els.volume = panel.querySelector('#bt-volume');
    els.volumeValue = panel.querySelector('#bt-volume-value');
    els.mute = panel.querySelector('#bt-mute');
    els.solo = panel.querySelector('#bt-solo');
    els.synth = panel.querySelector('#bt-synth');
    els.nudges = {};
    for (const button of panel.querySelectorAll('[data-nudge]')) els.nudges[button.dataset.nudge] = button;

    els.import.addEventListener('click', () => els.file.click());
    els.file.addEventListener('change', () => { importFile(els.file.files?.[0]); els.file.value = ''; });
    panel.addEventListener('dragover', event => { event.preventDefault(); panel.classList.add('bt-drop'); });
    panel.addEventListener('dragleave', () => panel.classList.remove('bt-drop'));
    panel.addEventListener('drop', event => {
      event.preventDefault();
      panel.classList.remove('bt-drop');
      const file = event.dataTransfer?.files?.[0];
      if (file) importFile(file);
    });
    els.remove.addEventListener('click', () => { removeAudio().catch(() => {}); });
    els.offset.addEventListener('change', () => {
      if (!controller.bytes) return;
      commitFlat(setGlobalOffset(currentFlat(), Number(els.offset.value) || 0));
      refreshMarkers();
      drawWave();
    });
    for (const [delta, button] of Object.entries(els.nudges)) {
      button.addEventListener('click', () => {
        if (!controller.bytes) return;
        commitFlat(setGlobalOffset(currentFlat(), globalOffsetMs(currentFlat()) + Number(delta)));
        refreshMarkers();
        drawWave();
      });
    }
    els.syncHere.addEventListener('click', () => {
      const st = studio();
      if (!st?.score || !controller.audio) return;
      const bar = clamp(st.selected?.bar ?? 0, 0, st.score.masterBars.length - 1);
      const audioMs = Math.max(0, Math.round(controller.audio.currentTime * 1000));
      const flat = currentFlat().filter(point => !(point.barIndex === bar && point.barOccurence === 0 && point.barPosition === 0));
      flat.push({ barIndex: bar, barOccurence: 0, barPosition: 0, millisecondOffset: audioMs });
      if (commitFlat(flat, { silent: false })) toastStatus(`Bar ${bar + 1} synced to ${formatAudioTime(audioMs)}.`);
      refreshMarkers();
      drawWave();
    });
    els.markers.addEventListener('click', event => {
      const button = event.target.closest('[data-index]');
      if (!button) return;
      const flat = currentFlat().slice();
      flat.splice(Number(button.dataset.index), 1);
      commitFlat(flat);
      refreshMarkers();
      drawWave();
    });
    els.volume.addEventListener('input', () => {
      controller.volume = clamp(Number(els.volume.value) || 0, 0, 100) / 100;
      if (els.volumeValue) els.volumeValue.textContent = `${Math.round(controller.volume * 100)}%`;
      applyAudioMix();
      queueMetaSave();
    });
    els.mute.addEventListener('click', () => {
      controller.muted = !controller.muted;
      syncControls();
      queueMetaSave();
    });
    els.solo.addEventListener('click', () => {
      controller.solo = !controller.solo;
      syncControls();
      applySynthMute();
      queueMetaSave();
    });
    els.synth.addEventListener('change', () => {
      controller.synthMuted = els.synth.checked;
      controller.synthMuteApplied = null;
      applySynthMute();
      queueMetaSave();
    });

    // Waveform drag shifts the global offset; the score updates once on release.
    els.wave.addEventListener('pointerdown', event => {
      if (!controller.bytes || !controller.durationMs) return;
      try { els.wave.setPointerCapture(event.pointerId); } catch {}
      dragState = { x0: event.clientX, width: els.wave.clientWidth || 1, off0: globalOffsetMs(currentFlat()) };
      event.preventDefault();
    });
    els.wave.addEventListener('pointermove', event => {
      if (!dragState || !controller.durationMs) return;
      const deltaMs = (event.clientX - dragState.x0) / dragState.width * controller.durationMs;
      controller.pendingFlat = setGlobalOffset(currentFlat(), dragState.off0 + deltaMs);
      if (els.offset) els.offset.value = String(globalOffsetMs(controller.pendingFlat));
      drawWave();
    });
    const endDrag = () => {
      if (!dragState) return;
      const flat = controller.pendingFlat;
      dragState = null;
      controller.pendingFlat = null;
      if (flat) {
        commitFlat(flat);
        refreshMarkers();
        drawWave();
      }
    };
    els.wave.addEventListener('pointerup', endDrag);
    els.wave.addEventListener('pointercancel', () => { dragState = null; controller.pendingFlat = null; drawWave(); });

    new ResizeObserver(() => drawWave()).observe(els.wave);
    return true;
  }

  /** Keep score.backingTrack attached: JSON snapshots drop the raw bytes. */
  function attachTo(score, model) {
    if (!score || !controller.bytes?.length) return;
    const BT = model?.BackingTrack || atModel()?.BackingTrack;
    if (!BT) return;
    try {
      if (!score.backingTrack || !(score.backingTrack instanceof BT)) {
        score.backingTrack = new BT();
      }
      score.backingTrack.rawAudioFile = controller.bytes;
    } catch {}
  }

  function attachHifi(adapter) {
    if (controller.unsubscribe) { try { controller.unsubscribe(); } catch {} controller.unsubscribe = null; }
    controller.hifi = adapter || null;
    controller.mapCache = null;
    controller.synthMuteApplied = null;
    if (adapter && typeof adapter.addPositionListener === 'function') {
      try { controller.unsubscribe = adapter.addPositionListener(onHifiPosition); } catch {}
    } else if (controller.audio && !controller.audio.paused) {
      try { controller.audio.pause(); } catch {}
    }
  }

  function init() {
    if (!isBrowser || controller.ready) return controller.ready;
    try {
      if (document.body?.classList.contains('viewer')) return false;
      if (!document.getElementById('inspector-song')) return false;
      if (!buildPanel()) return false;
      controller.ready = true;
      syncControls();
      refreshPanel();
      window.addEventListener('resize', () => drawWave());
      if (studio()?.score) onScoreChanged(studio().score);
    } catch { return false; }
    return controller.ready;
  }

  if (isBrowser) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }

  return {
    MAX_AUDIO_BYTES,
    ACCEPTED_EXTENSIONS,
    PEAK_COLUMNS,
    clamp,
    validateAudioFile,
    songKeyFor,
    readSyncPoints,
    normalizeFlatPoints,
    writeSyncPoints,
    globalOffsetMs,
    setGlobalOffset,
    buildSyncMap,
    audioMsForSongMs,
    peaksForRange,
    newPeakBuffers,
    finalizePeaks,
    formatAudioTime,
    // BACKING-TRACK hooks called from app.js / hifi-player.js:
    attachTo,
    attachHifi,
    onScoreChanged,
    _controller: controller
  };
});
