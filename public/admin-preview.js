(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const host = $('score-preview');
  let renderer = null;
  let score = null;
  let lesson = null;
  let localOwner = null;
  let identity = null;
  let controller = null;
  let generation = 0;
  let lastWidth = 0;
  let resizeFrame = 0;

  function message(value, error = false) {
    $('preview-status').textContent = value;
    $('preview-status').hidden = !value;
    $('preview-status').classList.toggle('error', error);
    $('preview-retry').hidden = !error;
  }

  function render() {
    if (!score || host.clientWidth < 1) return;
    const at = window.alphaTab;
    const narrow = host.clientWidth < 560;
    const bars = Math.min(narrow ? 4 : 8, score.masterBars.length);
    const track = score.tracks[Number($('preview-track').value)] || score.tracks[0];
    for (const staff of track.staves) {
      staff.showTablature = staff.isStringed && !staff.isPercussion;
      staff.showStandardNotation = !staff.showTablature;
      staff.showSlash = false;
      staff.showNumbered = false;
    }
    const profile = at.StaveProfile.Default;
    $('preview-scope').textContent = `Preview · ${bars === 1 ? 'Bar 1' : `Bars 1–${bars}`}`;
    if (!renderer) {
      const elements = {};
      for (const key of ['ScoreTitle', 'ScoreSubTitle', 'ScoreArtist', 'ScoreAlbum', 'ScoreWords', 'ScoreMusic', 'ScoreWordsAndMusic', 'ScoreCopyright', 'GuitarTuning', 'TrackNames', 'ChordDiagrams']) elements[key] = false;
      const renderGeneration = generation;
      renderer = new at.AlphaTabApi(host, {
        core: {
          scriptFile: new URL('/editor/vendor/alphaTab.js', location.origin).href,
          fontDirectory: new URL('/editor/vendor/font/', location.origin).href,
          useWorkers: false,
          enableLazyLoading: false
        },
        display: {layoutMode: at.LayoutMode.Page, staveProfile: profile, scale: .9, padding: [0, 12, 0, 12]},
        notation: {elements},
        player: {playerMode: at.PlayerMode.Disabled, enableCursor: false, enableUserInteraction: false}
      });
      renderer.renderFinished.on(() => {
        if (renderGeneration !== generation) return;
        host.style.visibility = '';
        message('');
      });
      renderer.error.on(() => {
        if (renderGeneration !== generation) return;
        host.style.visibility = 'hidden';
        message('Preview unavailable. Open the tab editor to view this file.', true);
      });
    }
    renderer.settings.display.barCount = bars;
    renderer.settings.display.barsPerRow = narrow ? 2 : 4;
    renderer.settings.display.staveProfile = profile;
    renderer.updateSettings();
    renderer.renderScore(score, [track.index]);
    lastWidth = host.clientWidth;
  }

  async function load(row, force = false, owner = null) {
    lesson = row;
    localOwner = owner;
    // Settings and sharing changes do not change file bytes. Replacement explicitly clears this cache.
    const nextIdentity = row.local_id ? `${row.id}:${row.updated_at}` : `${row.id}:${row.version}:${row.file_name}:${row.file_size}`;
    if (!force && identity === nextIdentity && score) return;
    identity = nextIdentity;
    const request = ++generation;
    renderer?.destroy();
    renderer = null;
    controller?.abort();
    controller = new AbortController();
    score = null;
    $('preview-track').disabled = true;
    $('preview-track').replaceChildren(new Option('Loading track…', ''));
    $('preview-tempo').textContent = '';
    $('preview-scope').textContent = 'Preview';
    host.style.visibility = 'hidden';
    message('Loading preview…');
    try {
      const at = window.alphaTab;
      let parsed;
      if (row.local_id) {
        const song = window.LocalSongs?.get(owner, row.local_id);
        if (!song) throw new Error('This song is no longer saved locally.');
        parsed = window.ScoreModel.restore(song.json);
      } else {
        const response = await fetch(`/api/admin/lessons/${encodeURIComponent(row.id)}/file`, {credentials: 'same-origin', cache: 'no-store', signal: controller.signal});
        if (!response.ok) {
          let detail;
          try { detail = await response.json(); } catch { /* Non-JSON gateway response. */ }
          throw new Error(detail?.error || 'Could not load the song file.');
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (request !== generation) return;
        window.ScoreModel?.assertSafeScoreFile?.(bytes);
        const settings = new at.Settings();
        parsed = /\.atex$/i.test(row.file_name)
          ? at.importer.ScoreLoader.loadAlphaTex(new TextDecoder().decode(bytes), settings)
          : at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
      }
      if (!parsed.tracks.length || !parsed.masterBars.length) throw new Error('No notation available in this file.');
      score = parsed;
      $('preview-track').replaceChildren(...score.tracks.map(track => new Option(track.name || `Track ${track.index + 1}`, String(track.index))));
      const guitar = score.tracks.find(track => /guitar/i.test(track.name) && !track.isPercussion && track.staves.some(staff => staff.tuning?.length));
      $('preview-track').value = String((guitar || score.tracks[0]).index);
      $('preview-track').disabled = false;
      const firstBar = score.masterBars[0];
      $('preview-tempo').textContent = `♩ = ${Math.round(score.tempo || row.tempo || 120)}  ${firstBar.timeSignatureNumerator}/${firstBar.timeSignatureDenominator}`;
      render();
    } catch (error) {
      if (request !== generation || error.name === 'AbortError') return;
      identity = null;
      message(error.message || 'Could not load the preview.', true);
    }
  }

  function clear() {
    ++generation;
    controller?.abort();
    renderer?.destroy();
    renderer = null;
    score = null;
    lesson = null;
    localOwner = null;
    identity = null;
    lastWidth = 0;
    host.replaceChildren();
    message('');
  }

  $('preview-track').addEventListener('change', render);
  $('preview-retry').addEventListener('click', () => { if (lesson) load(lesson, true, localOwner); });
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      if (host.clientWidth > 0 && Math.abs(host.clientWidth - lastWidth) > 1) render();
    });
  }).observe(host);
  window.FretphrasePreview = {load, clear};
})();
