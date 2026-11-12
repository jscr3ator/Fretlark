/* Public setlist player: one link lists shared songs and plays each song's own player. */
(() => {
  const $ = id => document.getElementById(id);
  const all = selector => document.querySelectorAll(selector);
  const token = (location.pathname.match(/^\/set\/([a-f0-9]{64})\/?$/) || [])[1];
  const state = {songs: [], index: 0};
  const phone = window.matchMedia('(max-width: 767px)');
  const COLLAPSE_KEY = 'fretlark-set-sidebar-collapsed', HINT_KEY = 'fretlark-set-list-hint';
  const PLAYING_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="6" width="2.6" height="8" rx="1.1"/><rect x="6.7" y="2" width="2.6" height="12" rx="1.1"/><rect x="11.4" y="8" width="2.6" height="6" rx="1.1"/></svg>';
  let opener = null;

  function setVisible(node, visible) {
    node.hidden = !visible;
  }

  function showEmpty(title, detail) {
    $('set-empty-title').textContent = title;
    $('set-empty-detail').textContent = detail || '';
    $('set-empty-detail').hidden = !detail;
    setVisible($('set-empty'), true);
  }

  // Desktop: the panel collapses to a rail and the choice is remembered.
  function setCollapsed(collapsed, remember = true) {
    document.body.classList.toggle('set-collapsed', collapsed);
    $('set-toggle').setAttribute('aria-expanded', String(!collapsed));
    $('set-expand').setAttribute('aria-expanded', String(!collapsed));
    if (remember) try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) {}
  }

  // Phone: the panel is a bottom sheet over the player.
  function setSheet(open) {
    document.body.classList.toggle('set-sheet-open', open);
    $('set-open').setAttribute('aria-expanded', String(open));
    const sheet = $('set-list');
    if (open) {
      opener = document.activeElement;
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-modal', 'true');
      requestAnimationFrame(() => (sheet.querySelector('[aria-current="true"]') || $('set-toggle')).focus({preventScroll: false}));
    } else {
      sheet.removeAttribute('role');
      sheet.removeAttribute('aria-modal');
      if (opener && document.contains(opener)) opener.focus();
      opener = null;
    }
  }

  // First visit on a phone: point at the song list button once, then never again.
  function hideHint() {
    const hint = $('set-hint');
    if (hint.hidden || hint.classList.contains('is-leaving')) return;
    hint.classList.add('is-leaving');
    setTimeout(() => { hint.hidden = true; hint.classList.remove('is-leaving'); }, 260);
    try { localStorage.setItem(HINT_KEY, '1'); } catch (e) {}
  }
  function maybeShowHint() {
    if (!phone.matches || state.songs.length < 2) return;
    try { if (localStorage.getItem(HINT_KEY) === '1') return; } catch (e) {}
    $('set-hint').hidden = false;
    setTimeout(hideHint, 6000);
    document.addEventListener('pointerdown', hideHint, {once: true});
  }

  function renderSongs() {
    const list = $('set-songs');
    list.textContent = '';
    state.songs.forEach((song, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'set-song';
      button.dataset.index = String(index);
      const number = document.createElement('span');
      number.className = 'set-song-number';
      const digits = document.createElement('span');
      digits.textContent = String(index + 1);
      number.append(digits);
      number.insertAdjacentHTML('beforeend', PLAYING_ICON);
      const copy = document.createElement('span');
      copy.className = 'set-song-copy';
      const title = document.createElement('strong');
      title.textContent = song.title || 'Untitled song';
      copy.append(title);
      if (song.artist) {
        const artist = document.createElement('small');
        artist.textContent = song.artist;
        copy.append(artist);
      }
      button.append(number, copy);
      list.append(button);
    });
    const count = state.songs.length;
    $('set-list-count').textContent = count ? `${count} song${count === 1 ? '' : 's'}` : '';
  }

  function select(index) {
    if (!state.songs.length) return;
    state.index = Math.max(0, Math.min(state.songs.length - 1, index));
    const song = state.songs[state.index], frame = $('set-player');
    const src = `/editor/player.html?share=${encodeURIComponent(song.share_token)}`;
    frame.title = `${song.title || 'Song'} player`;
    if (frame.getAttribute('src') !== src) frame.setAttribute('src', src);
    setVisible(frame, true);
    setVisible($('set-empty'), false);
    const count = state.songs.length;
    all('[data-pos]').forEach(node => { node.textContent = `Song ${state.index + 1} of ${count}`; });
    all('[data-pos-short]').forEach(node => { node.textContent = `${state.index + 1}/${count}`; });
    all('[data-nav="-1"]').forEach(node => { node.disabled = state.index === 0; });
    all('[data-nav="1"]').forEach(node => { node.disabled = state.index === count - 1; });
    $('set-songs').querySelectorAll('.set-song').forEach((node, i) => {
      if (i === state.index) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    });
    if (phone.matches && document.body.classList.contains('set-sheet-open')) setSheet(false);
  }

  function disableNav() {
    all('[data-nav]').forEach(node => { node.disabled = true; });
    all('[data-pos], [data-pos-short]').forEach(node => { node.textContent = ''; });
  }

  async function load() {
    if (!token) {
      setVisible($('set-loading'), false);
      setVisible($('set-player'), false);
      showEmpty('This setlist link is unavailable or has been revoked.', '');
      return;
    }
    try {
      const response = await fetch(`/api/shared-set/${token}`, {cache: 'no-store', credentials: 'omit'});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || 'This setlist link is unavailable or has been revoked.');
      const title = data.title || 'Setlist';
      document.title = `${title} — Fretlark`;
      $('set-title').textContent = title;
      $('set-bar-title').textContent = title;
      const notes = String(data.notes || '').trim();
      $('set-notes').textContent = notes;
      setVisible($('set-notes'), Boolean(notes));
      state.songs = Array.isArray(data.songs) ? data.songs.filter(song => song && /^[a-f0-9]{64}$/.test(song.share_token || '')) : [];
      setVisible($('set-loading'), false);
      if (!state.songs.length) {
        setVisible($('set-songs'), false);
        setVisible($('set-player'), false);
        disableNav();
        showEmpty('No songs in this setlist are available right now.', 'The owner may have turned off the links to these songs.');
        return;
      }
      renderSongs();
      select(0);
      setTimeout(maybeShowHint, 700);
    } catch (error) {
      setVisible($('set-loading'), false);
      setVisible($('set-player'), false);
      setVisible($('set-songs'), false);
      disableNav();
      showEmpty(error.message || 'This setlist link is unavailable or has been revoked.', '');
    }
  }

  try { if (localStorage.getItem(COLLAPSE_KEY) === '1') setCollapsed(true, false); } catch (e) {}

  all('[data-nav]').forEach(node => node.addEventListener('click', () => select(state.index + Number(node.dataset.nav))));
  $('set-toggle').addEventListener('click', () => (phone.matches ? setSheet(false) : setCollapsed(true)));
  $('set-expand').addEventListener('click', () => setCollapsed(false));
  $('set-open').addEventListener('click', () => { hideHint(); setSheet(true); });
  $('set-scrim').addEventListener('click', () => setSheet(false));
  phone.addEventListener('change', () => { if (!phone.matches) setSheet(false); });
  const toggleNotes = () => { const open = $('set-notes').classList.toggle('is-open'); $('set-notes').setAttribute('aria-expanded', String(open)); };
  $('set-notes').addEventListener('click', toggleNotes);
  $('set-notes').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleNotes(); } });
  $('set-songs').addEventListener('click', event => {
    const button = event.target.closest('[data-index]');
    if (button) select(Number(button.dataset.index));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('set-sheet-open')) { setSheet(false); return; }
    if (!event.altKey || !state.songs.length) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); select(state.index - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); select(state.index + 1); }
  });
  load();
})();
