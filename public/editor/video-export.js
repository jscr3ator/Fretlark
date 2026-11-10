// Scrolling-tab video export for library songs (signed-in owner only).
// alphaTab renders the score as one long strip and synthesizes the audio offline; the audio's
// time/tick pairs drive the scroll, WebCodecs encodes H.264 (+ AAC where available, PCM otherwise),
// and video-mux.js packages the file. Runs entirely in the browser, faster than real time.
(() => {
  const $ = id => document.getElementById(id);
  const at = window.alphaTab, Mux = window.FretlarkVideoMux;
  const lessonId = new URLSearchParams(location.search).get('lesson') || '';
  const FPS = 30, SAMPLE_RATE = 44100, MAX_SECONDS = 600; // whole songs up to 10 minutes
  const FORMATS = {
    reel: {w: 1080, h: 1920, name: 'Reel'},
    square: {w: 1080, h: 1080, name: 'Square'},
    wide: {w: 1920, h: 1080, name: 'Landscape'}
  };
  // alphaTab scale per format and staff choice, so the strip renders at roughly 1:1 in the video.
  const SCALES = {reel: {tab: 3.6, both: 2.2}, square: {tab: 2.8, both: 1.7}, wide: {tab: 4.2, both: 2.5}};
  const THEMES = {
    light: {bg: '#ffffff', paper: '#ffffff', ink: '#111114', sub: '#6e6e73', faint: 'rgba(0,0,0,.08)', accent: '#0a84ff', glyph: null},
    dark: {bg: '#0e0e11', paper: '#0e0e11', ink: '#f5f5f7', sub: '#98989f', faint: 'rgba(255,255,255,.12)', accent: '#0a84ff', glyph: '#f5f5f7'}
  };

  let lesson = null, fileBytes = null, score = null, api = null, art = null;
  let partials = [], strip = {w: 0, h: 0}, renderToken = 0, rendering = null;
  let renderedPartials = [];
  let renderQueue = Promise.resolve();
  let artPromise = null, fontsReady = null;
  let busy = false, cancelled = false;
  const opts = () => ({
    format: $('opt-format').value, staff: $('opt-staff').value, theme: $('opt-theme').value,
    track: Number($('opt-track').value) || 0, length: $('opt-length').value
  });
  const say = (text, error = false) => { $('status').textContent = text; $('status').classList.toggle('error', error); };
  const progress = value => { $('progress').hidden = value == null; if (value != null) $('progress-bar').style.width = `${Math.round(value * 100)}%`; };
  const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const safeName = s => (s || 'Song').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'Song';

  async function api_(path, binary = false) {
    const response = await fetch(`/api/admin/lessons/${encodeURIComponent(lessonId)}${path}`, {credentials: 'same-origin', cache: 'no-store'});
    if (response.status === 401 || response.status === 403 || response.status === 404) throw Object.assign(Error('Sign in to the account that owns this song.'), {signin: true});
    if (!response.ok) throw Error(`Could not load the song (${response.status}).`);
    return binary ? new Uint8Array(await response.arrayBuffer()) : response.json();
  }

  function loadImage(url) {
    return new Promise(resolve => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // ---------- alphaTab ----------
  function createApi() {
    api = new at.AlphaTabApi($('score-host'), {
      core: {scriptFile: new URL('./vendor/alphaTab.js', location.href).href, fontDirectory: new URL('./vendor/font/', location.href).href,
        engine: 'html5', useWorkers: false, enableLazyLoading: false},
      display: {layoutMode: at.LayoutMode.Horizontal, staveProfile: at.StaveProfile.Tab, scale: 2, padding: [24, 60, 24, 60]},
      player: {playerMode: at.PlayerMode.EnabledSynthesizer, soundFont: new URL('./vendor/soundfont/GeneralUser-GS.sf3', location.href).href,
        enableCursor: true, enableUserInteraction: false, scrollMode: at.ScrollMode.Off}
    });
    const hide = ['ScoreTitle', 'ScoreSubTitle', 'ScoreArtist', 'ScoreAlbum', 'ScoreWords', 'ScoreMusic', 'ScoreWordsAndMusic', 'ScoreCopyright', 'GuitarTuning', 'TrackNames', 'ChordDiagrams'];
    for (const name of hide) if (at.NotationElement[name] !== undefined) api.settings.notation.elements.set(at.NotationElement[name], false);
    api.renderStarted.on(() => { renderedPartials = []; });
    api.renderer.partialRenderFinished.on(result => {
      if (result.firstMasterBarIndex >= 0 && result.renderResult) renderedPartials.push({
        el: result.renderResult, x: result.x, y: result.y, w: result.width, h: result.height
      });
    });
    api.playerReady.on(() => {
      playerReady = true; readyWaiters.splice(0).forEach(fn => fn());
      if (!busy && partials.length) preview();
    });
    api.postRenderFinished.on(() => { rendering?.resolve(); });
    api.error.on(error => {
      console.error(error); say(`Couldn’t prepare this track: ${error.message || error}`, true);
      rendering?.reject(error);
    });
  }
  let playerReady = false; const readyWaiters = [];
  const whenPlayerReady = () => playerReady ? Promise.resolve() : new Promise(resolve => readyWaiters.push(resolve));
  // Export waits on the player before synthesizing; cancelling must interrupt that wait,
  // otherwise the page sits on "Loading instruments…" with no way out when the soundfont stalls.
  const cancelWaiters = [];
  const cancelError = () => Object.assign(Error('cancelled'), {cancelled: true});
  const whenCancellable = () => new Promise((_, reject) => cancelWaiters.push(() => reject(cancelError())));

  function prepareVideoScore(score) {
    // Expand imported multi-bar rests in this export-only copy so each silent bar
    // has geometry. The library file and its print settings stay unchanged.
    score.stylesheet.multiTrackMultiBarRest = false;
    score.stylesheet.perTrackMultiBarRest?.clear();
    // Simile bars contain placeholder rests; show the repeat symbol without a rest over it.
    for (const track of score.tracks) for (const staff of track.staves) for (const bar of staff.bars) {
      if (bar.simileMark === at.model.SimileMark.None) continue;
      for (const voice of bar.voices) for (const beat of voice.beats) if (beat.isRest) {
        beat.style ||= new at.model.BeatStyle();
        for (const part of ['GuitarTabRests', 'StandardNotationRests']) beat.style.colors.set(at.model.BeatSubElement[part], at.model.Color.fromJson('#00000000'));
      }
    }
  }

  function applyTheme(theme) {
    const res = api.settings.display.resources, t = THEMES[theme];
    const color = value => at.model.Color.fromJson(value);
    const ink = t.glyph || '#000000';
    for (const key of ['mainGlyphColor', 'secondaryGlyphColor', 'scoreInfoColor']) if (key in res) res[key] = color(ink);
    if ('staffLineColor' in res) res.staffLineColor = color(theme === 'dark' ? '#5a5a62' : '#a5a5a5');
    if ('barSeparatorColor' in res) res.barSeparatorColor = color(theme === 'dark' ? '#8a8a92' : '#222222');
    if ('barNumberColor' in res) res.barNumberColor = color(theme === 'dark' ? '#ff6961' : '#c8102e');
  }

  async function renderScore() {
    const o = opts();
    api.settings.display.scale = SCALES[o.format][o.staff];
    // Tracks without tab (vocals, drums, piano) can't be drawn as "Tab only"; show their notation instead.
    const track = score.tracks[o.track];
    const hasTab = !!track && !track.isPercussion && track.staves.some(st => st.showTablature && st.tuning?.length);
    api.settings.display.staveProfile = !hasTab ? at.StaveProfile.Default : o.staff === 'tab' ? at.StaveProfile.Tab : at.StaveProfile.ScoreTab;
    $('opt-staff').disabled = !hasTab;
    $('staff-note').hidden = hasTab;
    applyTheme(o.theme);
    api.updateSettings();
    // The frames are a fixed size, so the screen's pixel ratio would only make the tiles bigger.
    // At 2-3x (high-DPI screens) a tile passes Firefox's 32767 px canvas limit and drawing fails.
    if (at.Environment) at.Environment.highDpiFactor = 1;
    const done = new Promise((resolve, reject) => { rendering = {resolve, reject}; });
    try { api.renderScore(score, [o.track]); await done; }
    finally { rendering = null; }
    collectPartials();
    if (!partials.length) throw Error('No tab could be drawn for this track.');
    beatHint = null;
    return true;
  }

  function collectPartials() {
    // The offscreen DOM may retain old canvases until its UI callbacks run. Capture
    // only this render's score tiles, with geometry supplied by the renderer itself.
    partials = renderedPartials.filter(p => p.w > 0 && p.h > 0);
    strip = {w: Math.max(0, ...partials.map(p => p.x + p.w)), h: Math.max(0, ...partials.map(p => p.y + p.h))};
  }

  // Tick -> x on the strip, interpolated between the current beat and the next one.
  let beatHint = null, lastTickCache = null;
  function xForTick(tick, track) {
    const lookup = api.tickCache, bounds = api.boundsLookup;
    if (!lookup || !bounds) return 0;
    if (lookup !== lastTickCache) { beatHint = null; lastTickCache = lookup; }
    // Playback ticks are already unfolded through repeats. Locate the played bar even
    // when the selected track is silent or its MIDI beats refer to a simile source bar.
    const bars = lookup.masterBars;
    if (!bars.length) return 0;
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (tick >= bars[mid].end) lo = mid + 1; else hi = mid;
    }
    const bar = bars[lo], barBounds = bounds.findMasterBarByIndex(bar.masterBar.index);
    if (!barBounds) return 0;
    const endX = barBounds.realBounds.x + barBounds.realBounds.w;
    const found = lookup.findBeat(new Set([track]), tick, beatHint);
    beatHint = found;
    const bb = found && found.masterBar === bar && found.beat.voice.bar.index === bar.masterBar.index
      ? bounds.findBeat(found.beat) : null;
    const x0 = bb ? bb.onNotesX : barBounds.realBounds.x;
    const nextBeat = found?.nextBeat;
    const sequential = nextBeat && (nextBeat.masterBar === bar || nextBeat.masterBar.masterBar.index === bar.masterBar.index + 1);
    const next = bb && sequential ? bounds.findBeat(nextBeat.beat) : null;
    const x1 = next && next.onNotesX > x0 ? next.onNotesX : endX;
    const start = bb ? found.start : bar.start;
    const span = bb ? found.tickDuration : bar.end - bar.start;
    const f = Math.max(0, Math.min(1, (tick - start) / (span || 1)));
    return x0 + (x1 - x0) * f;
  }

  // ---------- drawing ----------
  function layout(format) {
    const {w, h} = FORMATS[format];
    if (format === 'reel') return {w, h, pad: 72, artSize: 300, artY: 210, titleY: 600, titleSize: 64, artistSize: 40, stripTop: 760, stripBottom: 1560, footerY: 1700};
    if (format === 'square') return {w, h, pad: 64, artSize: 150, artY: 70, titleY: 120, titleSize: 50, artistSize: 32, stripTop: 280, stripBottom: 900, footerY: 990, inline: true};
    return {w, h, pad: 80, artSize: 150, artY: 70, titleY: 120, titleSize: 54, artistSize: 34, stripTop: 280, stripBottom: 920, footerY: 1000, inline: true};
  }

  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function fitText(ctx, text, max) { if (ctx.measureText(text).width <= max) return text; let s = text; while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1); return s + '…'; }
  const FONT = 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  function drawFrame(ctx, o, x, t, total) {
    const L = layout(o.format), T = THEMES[o.theme];
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, L.w, L.h);
    // Header: artwork, title, artist.
    let textX = L.pad, textMax = L.w - L.pad * 2;
    if (L.inline) {
      if (art) { ctx.save(); roundRect(ctx, L.pad, L.artY, L.artSize, L.artSize, 18); ctx.clip(); ctx.drawImage(art, L.pad, L.artY, L.artSize, L.artSize); ctx.restore(); textX = L.pad + L.artSize + 36; textMax = L.w - textX - L.pad; }
      ctx.fillStyle = T.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = `700 ${L.titleSize}px ${FONT}`; ctx.fillText(fitText(ctx, lesson.title || 'Untitled song', textMax), textX, L.titleY + 20);
      ctx.fillStyle = T.sub; ctx.font = `500 ${L.artistSize}px ${FONT}`; ctx.fillText(fitText(ctx, lesson.artist || '', textMax), textX, L.titleY + 20 + L.artistSize + 18);
    } else {
      const cx = L.w / 2;
      if (art) { ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16; roundRect(ctx, cx - L.artSize / 2, L.artY, L.artSize, L.artSize, 28); ctx.fillStyle = T.bg; ctx.fill(); ctx.restore();
        ctx.save(); roundRect(ctx, cx - L.artSize / 2, L.artY, L.artSize, L.artSize, 28); ctx.clip(); ctx.drawImage(art, cx - L.artSize / 2, L.artY, L.artSize, L.artSize); ctx.restore(); }
      const y = art ? L.titleY : L.titleY - 160;
      ctx.textAlign = 'center'; ctx.fillStyle = T.ink; ctx.font = `700 ${L.titleSize}px ${FONT}`; ctx.fillText(fitText(ctx, lesson.title || 'Untitled song', textMax), cx, y);
      ctx.fillStyle = T.sub; ctx.font = `500 ${L.artistSize}px ${FONT}`; ctx.fillText(fitText(ctx, lesson.artist || '', textMax), cx, y + L.artistSize + 22);
    }
    // Score strip, centred vertically in its band, scrolled so the playhead sits on the current beat.
    const band = L.stripBottom - L.stripTop;
    const k = strip.h ? Math.min(1, band / strip.h) : 1;
    const top = L.stripTop + (band - strip.h * k) / 2;
    const playhead = Math.round(L.w * 0.3);
    const offset = playhead - x * k;
    ctx.save(); ctx.beginPath(); ctx.rect(0, L.stripTop, L.w, band); ctx.clip();
    for (const p of partials) {
      const dx = offset + p.x * k, dw = p.w * k;
      if (dx + dw < 0 || dx > L.w) continue;
      ctx.drawImage(p.el, 0, 0, p.el.width, p.el.height, dx, top + p.y * k, dw, p.h * k);
    }
    // Soft edges so notes fade in and out instead of being cut off.
    for (const [x0, x1, from] of [[0, L.pad * 1.6, true], [L.w - L.pad * 1.6, L.w, false]]) {
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(from ? 0 : 1, T.bg); g.addColorStop(from ? 1 : 0, T.bg + '00');
      ctx.fillStyle = g; ctx.fillRect(x0, L.stripTop, x1 - x0, band);
    }
    ctx.fillStyle = T.accent; ctx.globalAlpha = .9; roundRect(ctx, playhead - 3, top - 18, 6, strip.h * k + 36, 3); ctx.fill(); ctx.globalAlpha = 1;
    ctx.restore();
    // Footer: progress, time and the wordmark.
    const barY = L.footerY, barW = L.w - L.pad * 2;
    ctx.fillStyle = T.faint; roundRect(ctx, L.pad, barY, barW, 8, 4); ctx.fill();
    ctx.fillStyle = T.accent; roundRect(ctx, L.pad, barY, Math.max(8, barW * Math.min(1, total ? t / total : 0)), 8, 4); ctx.fill();
    ctx.font = `500 30px ${FONT}`; ctx.fillStyle = T.sub; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText(clock(t), L.pad, barY + 26);
    ctx.textAlign = 'right'; ctx.fillText(clock(total), L.w - L.pad, barY + 26);
    ctx.textAlign = 'center'; ctx.font = `600 30px ${FONT}`; ctx.fillStyle = T.ink; ctx.globalAlpha = .55; ctx.fillText(location.hostname.replace(/^www\./, ''), L.w / 2, barY + 26); ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  function preview() {
    if (!score || !partials.length) return;
    const o = opts(), L = layout(o.format), canvas = $('preview');
    canvas.width = L.w; canvas.height = L.h;
    canvas.style.aspectRatio = `${L.w} / ${L.h}`;
    beatHint = null;
    drawFrame(canvas.getContext('2d'), o, xForTick(0, o.track) || 0, 0, previewTotal());
  }
  function songSeconds() {
    let seconds = 0;
    for (const bar of api.tickCache?.masterBars || []) {
      const changes = bar.tempoChanges;
      for (let i = 0; i < changes.length; i++) {
        const end = changes[i + 1]?.tick ?? bar.end;
        seconds += (end - changes[i].tick) / 960 * 60 / changes[i].tempo;
      }
    }
    return seconds;
  }
  const previewTotal = () => { const o = opts(); const s = songSeconds(); return o.length === 'full' ? Math.min(MAX_SECONDS, s) : Math.min(Number(o.length), s); };

  // ---------- audio ----------
  async function renderAudio(limitSeconds, onProgress) {
    if (!playerReady) await Promise.race([whenPlayerReady(), whenCancellable()]);
    const options = new at.synth.AudioExportOptions();
    options.sampleRate = SAMPLE_RATE; options.masterVolume = 1; options.metronomeVolume = 0;
    const solo = score.tracks.some(t => t.playbackInfo.isSolo);
    for (const t of score.tracks) options.trackVolume.set(t.index, t.playbackInfo.isMute || (solo && !t.playbackInfo.isSolo) ? 0 : t.playbackInfo.volume / 16);
    const exporter = await api.exportAudio(options);
    const chunks = [], map = [{time: 0, tick: 0}];
    let frames = 0, cutShort = false;
    try {
      while (!cancelled) {
        const chunk = await exporter.render(100);
        if (!chunk) break;
        chunks.push(chunk.samples); frames += chunk.samples.length / 2;
        // currentTick is where this chunk ends; time it by the samples rendered so far (currentTime is the chunk's start).
        map.push({time: frames / SAMPLE_RATE, tick: chunk.currentTick});
        onProgress?.(Math.min(1, chunk.currentTime / (Math.min(chunk.endTime, limitSeconds * 1000) || 1)));
        if (frames / SAMPLE_RATE >= limitSeconds) { cutShort = true; break; }
      }
    } finally { exporter.destroy?.(); }
    const total = Math.min(frames, Math.round(limitSeconds * SAMPLE_RATE));
    const pcm = new Float32Array(total * 2);
    let at_ = 0;
    for (const c of chunks) { const n = Math.min(c.length, pcm.length - at_); if (n <= 0) break; pcm.set(c.subarray(0, n), at_); at_ += n; }
    // Fade the last half second only when the clip is cut short, so a length-limited
    // export doesn't end on a click. A song that played to its end keeps its own decay.
    if (cutShort) {
      const fade = Math.min(total, Math.round(SAMPLE_RATE * .5));
      for (let i = 0; i < fade; i++) { const g = i / fade, j = (total - 1 - i) * 2; pcm[j] *= g; pcm[j + 1] *= g; }
    }
    return {pcm, frames: total, map, cutShort};
  }

  function tickAt(map, seconds, hint) {
    let i = hint.i;
    while (i < map.length - 2 && map[i + 1].time <= seconds) i++;
    hint.i = i;
    const a = map[i], b = map[i + 1];
    if (!b || b.time <= a.time) return a.tick;
    if (b.tick < a.tick) { // repeat jump inside this chunk: keep moving at the previous rate
      const prev = map[i - 1];
      const rate = prev && a.time > prev.time ? (a.tick - prev.tick) / (a.time - prev.time) : 0;
      return a.tick + rate * (seconds - a.time);
    }
    return a.tick + (b.tick - a.tick) * (seconds - a.time) / (b.time - a.time);
  }

  const AAC_CONFIG = {codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: 2, bitrate: 192000};
  let aacSupport = null;
  const aacSupported = () => aacSupport ||= (typeof AudioEncoder === 'undefined' ? Promise.resolve(false)
    : AudioEncoder.isConfigSupported(AAC_CONFIG).then(result => !!result.supported).catch(() => false));

  async function encodeAudio(pcm, frames, aacOk) {
    if (aacOk === undefined) aacOk = await aacSupported();
    if (!aacOk) {
      const out = new Uint8Array(frames * 4), view = new DataView(out.buffer);
      for (let i = 0; i < frames * 2; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); view.setInt16(i * 2, s < 0 ? s * 32768 : s * 32767, true); }
      return {codec: 'pcm', sampleRate: SAMPLE_RATE, channels: 2, pcm: out};
    }
    const samples = []; let description = null, failure = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => { if (meta?.decoderConfig?.description) description = new Uint8Array(meta.decoderConfig.description); const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); samples.push(b); },
      error: e => { failure = e; }
    });
    encoder.configure(AAC_CONFIG);
    const block = 4096;
    for (let f = 0; f < frames; f += block) {
      const n = Math.min(block, frames - f);
      const data = new AudioData({format: 'f32', sampleRate: SAMPLE_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(f / SAMPLE_RATE * 1e6), data: pcm.slice(f * 2, (f + n) * 2)});
      encoder.encode(data); data.close();
    }
    await encoder.flush(); encoder.close();
    if (failure) throw failure;
    if (!description) description = Uint8Array.from([0x12, 0x10]); // AAC-LC, 44.1 kHz, stereo
    return {codec: 'aac', sampleRate: SAMPLE_RATE, channels: 2, bitrate: 192000, description, samples};
  }

  // Some encoders (Firefox) switch SPS/PPS ids mid-stream and report a new avcC each time.
  // Keep every parameter set in one avcC so all frames decode.
  function parseAvcC(b) {
    const sps = [], pps = []; let at = 6;
    for (let n = b[5] & 31; n--; ) { const len = b[at] << 8 | b[at + 1]; sps.push(b.slice(at + 2, at + 2 + len)); at += 2 + len; }
    for (let n = b[at++]; n--; ) { const len = b[at] << 8 | b[at + 1]; pps.push(b.slice(at + 2, at + 2 + len)); at += 2 + len; }
    return {head: b.slice(0, 5), sps, pps, tail: b.slice(at)};
  }
  function mergeAvcC(previous, next) {
    if (!previous) return next;
    try {
      const a = parseAvcC(previous), b = parseAvcC(next), key = x => x.join(',');
      const sps = [...a.sps, ...b.sps.filter(x => !a.sps.some(y => key(y) === key(x)))];
      const pps = [...a.pps, ...b.pps.filter(x => !a.pps.some(y => key(y) === key(x)))];
      const parts = [a.head, Uint8Array.of(0xe0 | sps.length), ...sps.flatMap(x => [Uint8Array.of(x.length >> 8, x.length & 255), x]), Uint8Array.of(pps.length), ...pps.flatMap(x => [Uint8Array.of(x.length >> 8, x.length & 255), x]), a.tail];
      const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let at = 0;
      for (const x of parts) { out.set(x, at); at += x.length; }
      return out;
    } catch { return next; }
  }

  // Firefox's avcC repeats each NAL header byte (67 67 64… instead of 67 64…). When keyframes carry
  // their own SPS/PPS (Firefox does), rebuild the avcC from those; otherwise drop the doubled byte.
  function repairAvcC(desc, samples) {
    const found = {7: [], 8: []}, key = x => x.join(',');
    for (const sample of samples.filter(x => x.key).slice(0, 50)) {
      const d = sample.data;
      for (let at = 0; at + 4 < d.length;) {
        const len = (d[at] << 24 | d[at + 1] << 16 | d[at + 2] << 8 | d[at + 3]) >>> 0, type = d[at + 4] & 31;
        if (!len || at + 4 + len > d.length) break;
        if (type === 7 || type === 8) { const nal = d.slice(at + 4, at + 4 + len); if (!found[type].some(x => key(x) === key(nal))) found[type].push(nal); }
        at += 4 + len;
      }
    }
    const build = (sps, pps, tail = new Uint8Array(0)) => {
      const parts = [Uint8Array.of(1, sps[0][1], sps[0][2], sps[0][3], 0xff, 0xe0 | sps.length), ...sps.flatMap(x => [Uint8Array.of(x.length >> 8, x.length & 255), x]),
        Uint8Array.of(pps.length), ...pps.flatMap(x => [Uint8Array.of(x.length >> 8, x.length & 255), x]), tail];
      const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let at = 0;
      for (const x of parts) { out.set(x, at); at += x.length; }
      return out;
    };
    if (found[7].length && found[8].length) return build(found[7], found[8]);
    if (!desc) return desc;
    try {
      const a = parseAvcC(desc), fix = list => list.map(x => x.length > 1 && x[0] === x[1] && [7, 8].includes(x[0] & 31) ? x.slice(1) : x);
      return build(fix(a.sps), fix(a.pps), a.tail);
    } catch { return desc; }
  }

  async function pickVideoCodec(w, h) {
    // Probe every profile at once instead of paying one round-trip per codec.
    const configs = ['avc1.640028', 'avc1.4d4028', 'avc1.42e028', 'avc1.640033'].map(codec =>
      ({codec, width: w, height: h, bitrate: 8_000_000, framerate: FPS, avc: {format: 'avc'}}));
    const support = await Promise.all(configs.map(config => VideoEncoder.isConfigSupported(config).catch(() => null)));
    const index = support.findIndex(result => result?.supported);
    return index < 0 ? null : configs[index];
  }

  // Yield to the event loop without the 1-4 ms delay of a timer, so status text still repaints.
  const yieldChannel = new MessageChannel(), yieldQueue = [];
  yieldChannel.port1.onmessage = () => yieldQueue.shift()?.();
  const yieldTask = () => new Promise(resolve => { yieldQueue.push(resolve); yieldChannel.port2.postMessage(0); });

  // Wait until the encoder has drained a slot, using its dequeue event instead of polling with timers.
  function waitForEncoder(encoder, limit) {
    if (encoder.encodeQueueSize <= limit || cancelled) return Promise.resolve();
    if (!('ondequeue' in encoder)) return new Promise(resolve => setTimeout(resolve, 4));
    return new Promise(resolve => {
      const check = () => {
        if (encoder.encodeQueueSize > limit && !cancelled) return;
        encoder.removeEventListener('dequeue', check);
        resolve();
      };
      encoder.addEventListener('dequeue', check);
      check();
    });
  }

  // ---------- export ----------
  async function exportVideo() {
    if (busy) { cancelled = true; cancelWaiters.splice(0).forEach(fn => fn()); return; }
    if (rendering || $('export').disabled) return;
    busy = true; cancelled = false; setBusy(true);
    $('result').hidden = true;
    try {
      const o = opts(), L = layout(o.format);
      // Fast path: WebCodecs. Browsers without it (e.g. Firefox for Android) record and convert instead.
      const forceFallback = new URLSearchParams(location.search).get('encoder') === 'fallback';
      const webCodecs = !forceFallback && typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
      // Probe encoder support while the audio renders instead of before it.
      const configPromise = webCodecs ? pickVideoCodec(L.w, L.h) : Promise.resolve(null);
      const aacPromise = webCodecs ? aacSupported() : Promise.resolve(false);
      const artSettled = (artPromise || Promise.resolve(null)).then(image => { if (image) art = image; });
      const limit = o.length === 'full' ? MAX_SECONDS : Number(o.length);
      say('Loading instruments…'); progress(0);
      const audio = await renderAudio(limit, p => { say('Rendering audio…'); progress(p * (webCodecs ? .25 : .05)); });
      const [config, aacOk] = await Promise.all([configPromise, aacPromise]);
      if (cancelled) throw Object.assign(Error('cancelled'), {cancelled: true});
      await artSettled;
      if (cancelled) throw Object.assign(Error('cancelled'), {cancelled: true});
      if (!config) { await exportByFrames(o, L, audio); return; }
      const seconds = audio.frames / SAMPLE_RATE;
      const totalFrames = Math.max(1, Math.round(seconds * FPS));
      const canvas = document.createElement('canvas'); canvas.width = L.w; canvas.height = L.h;
      const ctx = canvas.getContext('2d', {alpha: false});
      // Native AAC can be encoded while the frames are drawn. Without it (Chrome), build the WAV once,
      // then let ffmpeg encode the AAC in the background while the video encoder works.
      const audioEncoding = aacOk ? encodeAudio(audio.pcm, audio.frames, true) : null;
      const wavBytes = aacOk ? null : wav(audio.pcm, audio.frames);
      if (wavBytes) audio.pcm = null;
      const converterWork = aacOk ? null : (async () => {
        await job('load', {}, null);
        await job('audio', {audio: wavBytes});
        return true;
      })().catch(() => null);
      const samples = []; let description = null, failure = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => { if (meta?.decoderConfig?.description) description = mergeAvcC(description, new Uint8Array(meta.decoderConfig.description)); const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); samples.push({data: b, key: chunk.type === 'key', pts: Math.round(chunk.timestamp * FPS / 1e6)}); },
        error: e => { failure = e; }
      });
      encoder.configure(config);
      beatHint = null; const hint = {i: 0};
      for (let i = 0; i < totalFrames; i++) {
        if (cancelled) break;
        if (failure) throw failure;
        const t = i / FPS;
        drawFrame(ctx, o, xForTick(tickAt(audio.map, t, hint), o.track), t, seconds);
        const frame = new VideoFrame(canvas, {timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS)});
        encoder.encode(frame, {keyFrame: i % (FPS * 2) === 0}); frame.close();
        while (encoder.encodeQueueSize > 8 && !failure && !cancelled) await waitForEncoder(encoder, 8);
        if (i % 30 === 0) { say(`Making video… ${Math.round(i / totalFrames * 100)}%`); progress(.25 + .7 * i / totalFrames); await yieldTask(); }
      }
      if (cancelled) { encoder.close(); throw Object.assign(Error('cancelled'), {cancelled: true}); }
      await encoder.flush(); encoder.close();
      if (failure) throw failure;
      description = repairAvcC(description, samples);
      if (!description) throw Error('The video encoder did not return its settings.');
      say('Finishing…'); progress(.97);
      if (aacOk) {
        const encodedAudio = await audioEncoding;
        audio.pcm = null;
        const blob = Mux.mux({video: {width: L.w, height: L.h, fps: FPS, description, samples}, audio: encodedAudio});
        deliver(blob, o, 'mp4');
        return;
      }
      // This browser can't encode AAC itself; the PCM .mov is the fallback if conversion fails.
      const blob = Mux.mux({video: {width: L.w, height: L.h, fps: FPS, description, samples},
        audio: {codec: 'pcm', sampleRate: SAMPLE_RATE, channels: 2, pcm: new Uint8Array(wavBytes, 44)}});
      try {
        say('Adding the audio…');
        const audioReady = await converterWork;
        if (!audioReady) throw Error('The audio converter was not available.');
        const video = await blob.arrayBuffer();
        const result = await job('muxPre', {video}, p => progress(.97 + .02 * p), [video]);
        deliver(new Blob([result.mp4], {type: 'video/mp4'}), o, 'mp4');
      } catch (error) {
        if (error?.cancelled) throw error;
        try {
          const video = await blob.arrayBuffer();
          const result = await job('remux', {video, audio: wavBytes}, p => progress(.97 + .02 * p), [video, wavBytes]);
          deliver(new Blob([result.mp4], {type: 'video/mp4'}), o, 'mp4');
        } catch (fallbackError) {
          if (fallbackError?.cancelled) throw fallbackError;
          console.warn('MP4 audio conversion failed; saving .mov instead.', fallbackError);
          deliver(blob, o, 'mov');
        }
      }
    } catch (error) {
      progress(null);
      if (error?.cancelled) say('Export cancelled.');
      else { console.error(error); say(`Couldn’t make the video: ${error?.message || error}`, true); }
    } finally { busy = false; cancelWaiters.length = 0; setBusy(false); }
  }

  function deliver(blob, o, ext) {
    const name = `${safeName(lesson.title)} - ${FORMATS[o.format].name}.${ext}`;
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {href: url, download: name});
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
    progress(1);
    say(`Saved ${name} (${(blob.size / 1048576).toFixed(1)} MB).`);
    $('result').hidden = false;
    $('result-video').src = url;
  }

  function wav(pcm, frames) {
    const out = new ArrayBuffer(44 + frames * 4), v = new DataView(out);
    const text = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
    text(0, 'RIFF'); v.setUint32(4, 36 + frames * 4, true); text(8, 'WAVE'); text(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, SAMPLE_RATE, true);
    v.setUint32(28, SAMPLE_RATE * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, frames * 4, true);
    for (let i = 0; i < frames * 2; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); v.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true); }
    return out;
  }

  // Fallback for browsers without WebCodecs (e.g. Firefox for Android): draw every frame exactly, send them as
  // JPEGs in 8-second batches to ffmpeg (WebAssembly), then join the segments with the full audio.
  // Nothing depends on real-time playback, so a dimmed screen or a long song can't cut the video short.
  async function exportByFrames(o, L, audio) {
    // 720p keeps encoding quick on phones; Instagram shows 720p and 1080p the same.
    const s = 720 / Math.min(L.w, L.h);
    const width = Math.round(L.w * s / 2) * 2, height = Math.round(L.h * s / 2) * 2;
    // A page canvas, not OffscreenCanvas: Firefox's OffscreenCanvas doesn't see the page's web fonts.
    const canvas = Object.assign(document.createElement('canvas'), {width, height});
    const ctx = canvas.getContext('2d', {alpha: false});
    const seconds = audio.frames / SAMPLE_RATE, total = Math.max(1, Math.round(seconds * FPS)), batch = FPS * 8;
    // Async canvas blob encoding is heavily throttled in background tabs. Encode
    // these 720p frames directly, yielding between frames for progress and cancellation.
    const encodeJpeg = () => {
      const url = canvas.toDataURL('image/jpeg', .92);
      if (!url.startsWith('data:image/jpeg;base64,')) throw Error('Could not capture a frame.');
      return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), c => c.charCodeAt(0)).buffer;
    };
    let wakeLock = null;
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    try {
      // Download the converter while the first frames are drawn.
      job('load', {}, () => {}).catch(() => {});
      beatHint = null; const hint = {i: 0};
      let nextFrame = 0;
      const take = async () => {
        const from = nextFrame, to = Math.min(total, from + batch), frames = [];
        for (let f = from; f < to; f++) {
          if (cancelled) throw Object.assign(Error('cancelled'), {cancelled: true});
          const t = f / FPS;
          ctx.setTransform(s, 0, 0, s, 0, 0);
          drawFrame(ctx, o, xForTick(tickAt(audio.map, t, hint), o.track), t, seconds);
          frames.push(encodeJpeg());
          if (f % 10 === 0) await yieldTask();
        }
        nextFrame = to;
        return frames;
      };
      // Capture the next batch while ffmpeg encodes the current one.
      let frames = await take(), segments = 0;
      while (frames.length) {
        const index = segments++, captured = nextFrame, count = frames.length;
        const next = nextFrame < total ? take() : null;
        next?.catch(() => {});
        const done = captured / total;
        say(`Making video… ${Math.round(done * 100)}%`);
        await job('segment', {index, frames}, p => { progress(.05 + .88 * (done - (1 - p) * count / total)); }, frames);
        progress(.05 + .88 * done);
        frames = next ? await next : [];
      }
      say('Adding the audio…');
      const wavBytes = wav(audio.pcm, audio.frames);
      audio.pcm = null;
      const result = await job('finish', {segments, audio: wavBytes}, p => progress(.93 + .06 * p), [wavBytes]);
      deliver(new Blob([result.mp4], {type: 'video/mp4'}), o, 'mp4');
    } finally { try { await wakeLock?.release(); } catch {} }
  }

  // Talks to video-convert-worker.js; one job at a time (later jobs queue behind earlier ones,
  // so the converter download can start before the first frames are ready).
  let convertWorker = null, jobId = 0, jobChain = Promise.resolve();
  function runJob(name, payload, onProgress, transfer) {
    convertWorker ||= new Worker('./video-convert-worker.js');
    const id = ++jobId;
    return new Promise((resolve, reject) => {
      const watch = setInterval(() => { if (cancelled) { convertWorker?.terminate(); convertWorker = null; clearInterval(watch); reject(Object.assign(Error('cancelled'), {cancelled: true})); } }, 250);
      convertWorker.onmessage = ({data}) => {
        if (data.type === 'stage') { say('Downloading the MP4 converter (32 MB, first time only)…'); return; }
        if (data.id !== id) return;
        if (data.type === 'progress') onProgress?.(data.progress);
        else if (data.type === 'done') { clearInterval(watch); resolve(data); }
        else if (data.type === 'error') { clearInterval(watch); reject(Error(data.message)); }
      };
      convertWorker.onerror = event => { clearInterval(watch); convertWorker = null; reject(Error(event.message || 'The MP4 converter failed to load. Check your connection and try again.')); };
      convertWorker.postMessage({id, job: name, ...payload}, transfer);
    });
  }
  function job(name, payload, onProgress, transfer = []) {
    const run = jobChain.then(() => runJob(name, payload, onProgress, transfer));
    jobChain = run.then(() => {}, () => {});
    return run;
  }

  function setBusy(on) {
    $('export').textContent = on ? 'Cancel' : 'Export video';
    $('export').classList.toggle('primary', !on);
    document.querySelectorAll('#options select').forEach(s => { s.disabled = on; });
    if (!on && !$('staff-note').hidden) $('opt-staff').disabled = true;
  }

  // ---------- startup ----------
  async function rerender() {
    const token = ++renderToken;
    $('export').disabled = true;
    say('Updating preview…');
    // Serialize renders so a quick track/format change cannot mix old canvases with new bounds.
    renderQueue = renderQueue.catch(() => {}).then(() => token === renderToken && renderScore());
    try {
      if (await renderQueue && token === renderToken) { preview(); say(''); $('export').disabled = false; }
    } catch (error) { if (token === renderToken) say(`Couldn’t draw this track: ${error.message}`, true); }
  }

  async function start() {
    if (!lessonId) { showGate('Open this page from a song in your library.'); return; }
    // Everything independent starts at once: the song metadata, the score bytes, the artwork
    // lookup (which can be slow because it hits a music service) and the UI font.
    const lessonRequest = api_('');
    const fileRequest = api_('/file', true);
    const artworkRequest = api_('/artwork').then(async response => {
      const found = response?.artwork;
      return await loadImage(found?.url) || await loadImage(found?.fallbackUrl);
    }).catch(() => null);
    artPromise = artworkRequest;
    fontsReady = Promise.all([document.fonts.load('700 64px Inter'), document.fonts.load('500 40px Inter')]).catch(() => {});
    try {
      const [loadedLesson, loadedFile] = await Promise.all([lessonRequest, fileRequest]);
      lesson = loadedLesson; fileBytes = loadedFile;
    } catch (error) {
      showGate(error.message); return;
    }
    document.title = `Video · ${lesson.title || 'Song'} — Fretlark`;
    $('song-title').textContent = lesson.title || 'Untitled song';
    $('song-artist').textContent = lesson.artist || '';
    createApi();
    try {
      const settings = api.settings;
      window.ScoreModel?.assertSafeScoreFile?.(fileBytes);
      score = /\.atex$/i.test(lesson.file_name || '') ? at.importer.ScoreLoader.loadAlphaTex(new TextDecoder().decode(fileBytes), settings) : at.importer.ScoreLoader.loadScoreFromBytes(fileBytes, settings);
      prepareVideoScore(score);
    } catch (error) { say(`Couldn’t open this song: ${error.message}`, true); return; }
    const select = $('opt-track');
    select.innerHTML = score.tracks.map((t, i) => `<option value="${i}">${(t.name || `Track ${i + 1}`).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))}</option>`).join('');
    // Default to the first track that actually has tab, preferring one named like a guitar.
    const tabbed = score.tracks.filter(t => !t.isPercussion && t.staves.some(st => st.showTablature && st.tuning?.length));
    const pick = tabbed.find(t => /guitar|gtr/i.test(t.name || '')) || tabbed[0] || score.tracks[0];
    select.value = String(pick ? pick.index : 0);
    // Listeners attach before the first render so a quick option change during
    // "Rendering…" queues a proper rerender instead of exporting stale geometry.
    $('options').addEventListener('change', event => { if (event.target.id === 'opt-length') preview(); else rerender(); });
    $('export').addEventListener('click', exportVideo);
    // The first preview does not wait for the artwork, the soundfont or the player.
    await fontsReady;
    await rerender();
    // The artwork and its lookup finish whenever they finish; redraw once it is available.
    artworkRequest.then(image => {
      art = image;
      if (!busy && score) preview();
    });
  }

  // ?debug=1 exposes internals for checking sync by hand.
  if (new URLSearchParams(location.search).has('debug')) window.__fretlarkVideo = {get api() { return api; }, get score() { return score; }, renderAudio, tickAt, xForTick};

  function showGate(message) {
    $('app').hidden = true; $('gate').hidden = false; $('gate-message').textContent = message;
  }

  start();
})();
