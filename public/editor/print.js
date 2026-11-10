/* Fretlark clean sheet-music printing.
 *
 * Replaces alphaTab's popup print window (which inherits the browser's own
 * header/footer: page title on the left, full share URL on the right) with an
 * in-page print sheet:
 *
 * - Each printed page is rendered by its own offscreen alphaTab instance in
 *   Page layout at print width (display.startBar/barCount select the bars),
 *   so the on-screen player is untouched. Output is the default SVG engine,
 *   i.e. crisp vector paths in PDFs.
 * - `@page { size:auto; margin:0 }` (print.css) removes the browser header and
 *   footer in Chromium, Firefox and WebKitGTK; the readable margins live on
 *   .print-sheet inside the document instead. size:auto keeps A4 and US Letter
 *   working.
 * - Page 1 carries a title block (title, artist, tuning/capo/tempo/tracks/
 *   notation info). Every page ends with a small in-flow footer
 *   ("Title — page N of M" plus a fretlark.com mark). Page numbers are written
 *   by script because CSS page counters resolve to 0 in Chromium.
 * - Pages are packed from measured staff-system heights against the US Letter
 *   content height (the smaller common paper), so a system never splits across
 *   pages on either Letter or A4. Each rendered page is verified against the
 *   budget and split further if it overflows.
 * - Colours are forced to black on white (bar numbers dark grey) via the
 *   render resources; cursor, selection and hover overlays are disabled.
 * - Prints what the viewer currently sees: the displayed track(s) and the
 *   active notation mode. Refuses when the share settings disable printing.
 */
(() => {
  'use strict';

  // Print content width in screen pixels. At 96 CSS px/in this is ~171 mm, so
  // with the 16 mm side margins in print.css it fits both A4 (210 mm) and US
  // Letter (215.9 mm) with room to spare.
  const PRINT_WIDTH_PX = 648;
  const PRINT_SCALE = 0.95;
  const RENDER_TIMEOUT_MS = 60000;
  // Usable systems height per page in px: US Letter (279.4 mm) minus the sheet
  // top/bottom padding, minus the alphaTab display padding. Letter is the
  // smaller common paper, so pages also fit on A4.
  const PAGE_SYSTEM_BUDGET_PX = 890;
  const OVERFLOW_SLACK_PX = 10;

  let printing = false;
  let afterPrintArmed = false;
  const liveApis = [];
  const debugLog = [];
  function debug(...args) {
    try {
      debugLog.push(`${Math.round(performance.now())}ms ${args.map(String).join(' ')}`);
      if (debugLog.length > 60) debugLog.shift();
      window.__fretlarkPrintDebug = debugLog.slice();
    } catch (e) { /* ignore */ }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function note(message, isError) {
    const t = $('toast');
    if (!t) return;
    t.textContent = message;
    t.classList.toggle('error', !!isError);
    t.classList.add('visible');
    clearTimeout(note._timer);
    note._timer = setTimeout(() => t.classList.remove('visible'), isError ? 6500 : 3300);
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function notationLabel() {
    const value = $('notation-select') ? $('notation-select').value : 'both';
    return {
      both: 'Tabs + notes',
      tab: 'Tablature',
      standard: 'Standard notation',
      slash: 'Rhythm slashes',
      numbered: 'Numbered notation'
    }[value] || String(value);
  }

  function noteName(pitch) {
    try {
      const Tuning = window.alphaTab && window.alphaTab.model && window.alphaTab.model.Tuning;
      if (Tuning && typeof Tuning.getTextForTuning === 'function') return Tuning.getTextForTuning(pitch, false);
    } catch (e) { /* fall through to the local table */ }
    const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    return names[((Math.round(pitch) % 12) + 12) % 12];
  }

  function firstStaff(track) {
    return track && track.staves && track.staves[0];
  }

  function tuningText(staff) {
    if (!staff || !staff.isStringed || staff.isPercussion || !Array.isArray(staff.tuning) || !staff.tuning.length) return '';
    // Stored high string first; display low to high like a tuning peg row.
    return staff.tuning.slice().reverse().map(noteName).join(' ');
  }

  function tempoText(score) {
    const tempo = Number(score && score.tempo);
    if (!Number.isFinite(tempo) || tempo <= 0) return '';
    return `${Math.round(tempo * 10) / 10} BPM`;
  }

  // Short human summary of what is on the sheet: tuning, capo, tempo, the
  // printed tracks and the active notation mode.
  function infoLine(score, tracks) {
    const bits = [];
    if (tracks.length === 1) {
      const staff = firstStaff(tracks[0]);
      const tuning = tuningText(staff);
      if (tuning) bits.push(`Tuning ${tuning}`);
      if (staff && Number(staff.capo) > 0) bits.push(`Capo ${staff.capo}`);
    } else if (tracks.length > 1) {
      bits.push(`${tracks.length} tracks: ${tracks.map(t => t.name || `Track ${(t.index || 0) + 1}`).join(', ')}`);
      const tunings = [...new Set(tracks.map(t => tuningText(firstStaff(t))).filter(Boolean))];
      if (tunings.length === 1) bits.push(`Tuning ${tunings[0]}`);
      const capos = tracks.filter(t => Number(firstStaff(t) && firstStaff(t).capo) > 0)
        .map(t => `Capo ${firstStaff(t).capo} (${t.name || `Track ${(t.index || 0) + 1}`})`);
      bits.push(...capos);
    }
    const tempo = tempoText(score);
    if (tempo) bits.push(tempo);
    bits.push(notationLabel());
    return bits.join('  ·  ');
  }

  function printAllowed(studio) {
    if (studio && typeof studio.printAllowed === 'boolean') return studio.printAllowed;
    // Fallback without app.js support: in the audience player the button is
    // hidden exactly when the share settings disable printing.
    if (document.body.classList.contains('viewer') && $('btn-print') && $('btn-print').hidden) return false;
    return true;
  }

  function displayedTracks(studio, api, score) {
    if (studio && Array.isArray(studio.printTracks) && studio.printTracks.length) {
      const tracks = studio.printTracks.map(i => score.tracks[i]).filter(Boolean);
      if (tracks.length) return tracks;
    }
    if (api && Array.isArray(api.tracks) && api.tracks.length) return api.tracks.slice();
    if (score.tracks.length) return [score.tracks[0]];
    return [];
  }

  function baseSettings(at) {
    return {
      core: {
        scriptFile: new URL('./vendor/alphaTab.js', location.href).href,
        fontDirectory: new URL('./vendor/font/', location.href).href,
        includeNoteBounds: false,
        enableLazyLoading: false,
        // Render on the main thread: a worker per offscreen page can be asked to render
        // before it is ready and then never finish.
        useWorkers: false
      },
      display: {
        scale: PRINT_SCALE,
        layoutMode: at.LayoutMode.Page,
        staveProfile: at.StaveProfile.Default,
        padding: [16, 10, 16, 10],
        stretchForce: 1,
        resources: {
          // Pure black on white; bar numbers a quiet dark grey.
          mainGlyphColor: '#000000',
          secondaryGlyphColor: '#000000',
          barNumberColor: '#444444',
          scoreInfoColor: '#000000'
        }
      },
      notation: {
        // The title block on page 1 carries the song identity; alphaTab must
        // not repeat title/artist/tuning as score info on the sheet.
        elements: {
          scoreTitle: false,
          scoreSubTitle: false,
          scoreArtist: false,
          scoreAlbum: false,
          scoreWords: false,
          scoreMusic: false,
          scoreWordsAndMusic: false,
          guitarTuning: false
        }
      },
      player: {
        playerMode: at.PlayerMode.Disabled,
        enableCursor: false,
        enableUserInteraction: false,
        enableElementHighlighting: false,
        soundFont: null
      }
    };
  }

  // Render a bar range offscreen and resolve with the api once layout and all
  // partials are painted.
  // Notation elements alphaTab must not draw: the title block on page 1 carries them.
  const HIDDEN_ELEMENTS = ['ScoreTitle', 'ScoreSubTitle', 'ScoreArtist', 'ScoreAlbum', 'ScoreWords', 'ScoreMusic', 'ScoreWordsAndMusic', 'ScoreCopyright', 'GuitarTuning'];

  function renderRange(at, host, tracks, startBar, barCount, staveProfile, justifyLast) {
    const settings = baseSettings(at);
    delete settings.notation;
    settings.display.startBar = startBar;
    settings.display.barCount = barCount;
    if (staveProfile !== undefined) settings.display.staveProfile = staveProfile;
    // Each page is its own render, so stretch its last line to full width like the others.
    if (justifyLast) settings.display.justifyLastSystem = true;
    const printApi = new at.AlphaTabApi(host, settings);
    liveApis.push(printApi);
    // Set the hidden elements on the live settings (the JSON form is not applied by alphaTab 1.8).
    for (const name of HIDDEN_ELEMENTS) {
      if (at.NotationElement && at.NotationElement[name] !== undefined) printApi.settings.notation.elements.set(at.NotationElement[name], false);
    }
    printApi.updateSettings();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The score took too long to lay out for print.')), RENDER_TIMEOUT_MS);
      try {
        // Pieces that belong to no bar (alphaTab's "rendered by alphaTab" line and the hidden
        // score info) are dropped from the printed page.
        const unbarred = [];
        printApi.renderer.partialRenderFinished.on(e => {
          if (e && e.firstMasterBarIndex === -1 && e.renderResult) unbarred.push(e.renderResult);
        });
        printApi.renderer.postRenderFinished.on(() => {
          clearTimeout(timer);
          requestAnimationFrame(() => {
            for (const el of unbarred) { try { if (el && el.remove && el.isConnected) el.remove(); } catch (e) { /* ignore */ } }
            // With SVG output the results are markup, so also drop any drawn block holding the credit line.
            for (const block of host.querySelectorAll('.at-surface > *')) {
              if (/rendered by alphaTab/i.test(block.textContent || '')) block.remove();
            }
            resolve(printApi);
          });
        });
        printApi.renderTracks(tracks);
        debug('renderTracks called', startBar, barCount);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  function systemsOf(printApi) {
    const lookup = printApi && printApi.renderer && printApi.renderer.boundsLookup;
    const systems = (lookup && lookup.staffSystems) || [];
    return systems.map(s => {
      const bars = (s.bars || []).map(b => b.index).filter(Number.isInteger);
      return {
        y: s.realBounds.y,
        h: s.realBounds.h,
        firstBar: Math.min(...bars),
        lastBar: Math.max(...bars)
      };
    }).filter(s => Number.isFinite(s.firstBar));
  }

  // Pack consecutive systems into page bar ranges that fit the budget. The
  // first page also carries the measured title block.
  function packPages(systems, firstBudget, budget) {
    const ranges = [];
    let start = 0;
    while (start < systems.length) {
      const pageBudget = ranges.length === 0 ? firstBudget : budget;
      let end = start;
      let height = 0;
      while (end < systems.length && height + systems[end].h <= pageBudget) {
        height += systems[end].h;
        end++;
      }
      if (end === start) end = start + 1; // A single system always gets a page.
      ranges.push({ firstBar: systems[start].firstBar, lastBar: systems[end - 1].lastBar });
      start = end;
    }
    return ranges;
  }

  function destroyRoot() {
    while (liveApis.length) {
      try {
        liveApis.pop().destroy();
      } catch (e) { /* ignore */ }
    }
    const old = $('print-root');
    if (old) old.remove();
    document.body.classList.remove('printing');
    window.__fretlarkPrintReady = false;
    window.__fretlarkPrintApi = null;
  }

  function armAfterPrint() {
    if (afterPrintArmed) return;
    afterPrintArmed = true;
    window.addEventListener('afterprint', destroyRoot);
  }

  function buildTitleBlock(score, tracks) {
    const titleBlock = document.createElement('div');
    titleBlock.className = 'print-titleblock';
    const titleEl = document.createElement('h1');
    titleEl.className = 'print-title';
    titleEl.textContent = score.title || 'Untitled';
    const artistEl = document.createElement('p');
    artistEl.className = 'print-artist';
    artistEl.textContent = score.artist || '';
    const infoEl = document.createElement('p');
    infoEl.className = 'print-info';
    infoEl.textContent = infoLine(score, tracks);
    titleBlock.append(titleEl, artistEl, infoEl);
    return titleBlock;
  }

  function buildFooter(title, page, pages) {
    const footer = document.createElement('div');
    footer.className = 'print-page-footer';
    const left = document.createElement('span');
    left.className = 'print-footer-left';
    left.textContent = `${title} — page ${page} of ${pages}`;
    const brand = document.createElement('span');
    brand.className = 'print-brand';
    brand.textContent = 'fretlark.com';
    footer.append(left, brand);
    return footer;
  }

  async function settleFonts() {
    try {
      if (document.fonts && document.fonts.ready) {
        await Promise.race([document.fonts.ready, wait(4000)]);
      }
    } catch (e) { /* ignore */ }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function print() {
    if (printing) return;
    const studio = window.studio || {};
    const api = studio.api;
    const at = window.alphaTab;
    const score = studio.score;
    if (!at || !api || !score) {
      note('Open a song before printing.', true);
      return;
    }
    if (!printAllowed(studio)) {
      note('Printing is disabled for this shared song.', true);
      return;
    }
    const tracks = displayedTracks(studio, api, score);
    if (!tracks.length) {
      note('There is nothing to print.', true);
      return;
    }

    printing = true;
    try {
      destroyRoot();
      armAfterPrint();
      debug('print start');

      // The webfont for notation is shared with the on-screen instance and is
      // usually cached already; still wait briefly so glyphs cannot swap fonts
      // mid-render.
      await settleFonts();

      const root = document.createElement('div');
      root.id = 'print-root';
      root.setAttribute('aria-hidden', 'true');
      const sheet = document.createElement('div');
      sheet.className = 'print-sheet';
      root.appendChild(sheet);
      document.body.appendChild(root);

      const title = score.title || 'Untitled';
      const titleBlock = buildTitleBlock(score, tracks);

      // Measure pass: render the whole score once to learn where the staff
      // systems (which must never split) sit and which bars they hold.
      note('Preparing print…');
      const measureHost = document.createElement('div');
      measureHost.className = 'print-measure';
      root.appendChild(measureHost);
      // The title block height counts against the first page; measure it in
      // place (it is moved onto page 1 afterwards).
      const titleSizer = document.createElement('div');
      titleSizer.className = 'print-page';
      titleSizer.appendChild(titleBlock);
      sheet.appendChild(titleSizer);
      const titleHeight = titleSizer.offsetHeight;
      sheet.removeChild(titleSizer);

      const totalBars = score.masterBars.length;
      debug('score bars', totalBars, 'tracks', tracks.map(t => t.index).join(','));
      // Print the same notation the viewer sees (tab only, notes only or both).
      const staveProfile = api.settings && api.settings.display ? api.settings.display.staveProfile : undefined;
      const measureApi = await renderRange(at, measureHost, tracks, 1, -1, staveProfile);
      debug('measure rendered');
      const systems = systemsOf(measureApi);
      if (!systems.length) throw new Error('The score produced no printable systems.');
      const firstBudget = Math.max(200, PAGE_SYSTEM_BUDGET_PX - titleHeight);
      let ranges = packPages(systems, firstBudget, PAGE_SYSTEM_BUDGET_PX);
      // Keep the measure area as the offscreen staging spot for page renders; clear the full render.
      while (liveApis.length) { try { liveApis.pop().destroy(); } catch (e) { /* ignore */ } }
      measureHost.replaceChildren();

      // Page passes: one instance per bar range, verified against the budget.
      const pages = [];
      let queue = ranges.map(r => ({ ...r }));
      let guard = 0;
      while (queue.length && guard++ < 400) {
        const range = queue.shift();
        const pageIndex = pages.length;
        note(`Preparing print… page ${pageIndex + 1}`);
        const host = document.createElement('div');
        host.className = 'print-music';
        // alphaTab lays out against the container's width, so it must be in the document while
        // rendering (a detached div measures 0 and never finishes). It moves onto its page below.
        measureHost.isConnected || root.appendChild(measureHost);
        measureHost.appendChild(host);
        const pageApi = await renderRange(at, host, tracks, range.firstBar + 1, range.lastBar - range.firstBar + 1, staveProfile, range.lastBar < totalBars - 1);
        const surface = host.querySelector('.at-surface');
        const height = surface ? surface.getBoundingClientRect().height : host.getBoundingClientRect().height;
        const budget = (pageIndex === 0 ? firstBudget : PAGE_SYSTEM_BUDGET_PX) + OVERFLOW_SLACK_PX;
        if (height > budget && range.lastBar > range.firstBar) {
          // Layout shifted versus the measure pass; split and retry.
          const mid = Math.floor((range.firstBar + range.lastBar) / 2);
          host.remove();
          try { pageApi.destroy(); } catch (e) { /* ignore */ }
          const live = liveApis.indexOf(pageApi);
          if (live >= 0) liveApis.splice(live, 1);
          queue.unshift({ firstBar: range.firstBar, lastBar: mid }, { firstBar: mid + 1, lastBar: range.lastBar });
          continue;
        }
        pages.push({ host, api: pageApi });
      }
      if (queue.length) throw new Error('The score could not be paginated for print.');

      measureHost.remove();
      // Assemble: title block on page 1, explicit footers everywhere.
      const total = pages.length;
      pages.forEach((page, i) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'print-page';
        if (i === 0) wrapper.appendChild(titleBlock);
        wrapper.appendChild(page.host);
        wrapper.appendChild(buildFooter(title, i + 1, total));
        sheet.appendChild(wrapper);
      });

      await settleFonts();
      document.body.classList.add('printing');
      window.__fretlarkPrintApi = pages.length ? pages[pages.length - 1].api : null;
      window.__fretlarkPrintPages = total;
      window.__fretlarkPrintReady = true;
      note(`Print ready · ${total} page${total === 1 ? '' : 's'}`);
      try {
        window.print();
      } catch (e) { /* headless runners print via CDP instead */ }
    } catch (e) {
      debug('failed', (e && e.message) || e);
      destroyRoot();
      note(`Printing failed: ${(e && e.message) || e}`, true);
    } finally {
      printing = false;
    }
  }

  window.FretlarkPrint = { print };
})();
