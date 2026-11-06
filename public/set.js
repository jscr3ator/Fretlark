/* Public setlist player: one link lists shared songs and plays each song's own player. */
(() => {
  const $ = id => document.getElementById(id);
  const token = (location.pathname.match(/^\/set\/([a-f0-9]{64})\/?$/) || [])[1];
  const state = {songs: [], index: 0};

  function setVisible(node, visible) {
    node.hidden = !visible;
  }

  function showEmpty(title, detail) {
    $('set-empty-title').textContent = title;
    $('set-empty-detail').textContent = detail || '';
    $('set-empty-detail').hidden = !detail;
    setVisible($('set-empty'), true);
  }

  function renderSongs() {
    const list = $('set-songs');
    list.textContent = '';
    state.songs.forEach((song, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'set-song';
      button.dataset.index = String(index);
      if (index === state.index) button.setAttribute('aria-current', 'true');
      const number = document.createElement('span');
      number.className = 'set-song-number';
      number.textContent = String(index + 1);
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
    $('set-position').textContent = `Song ${state.index + 1} of ${state.songs.length}`;
    $('set-prev').disabled = state.index === 0;
    $('set-next').disabled = state.index === state.songs.length - 1;
    $('set-songs').querySelectorAll('.set-song').forEach((node, i) => {
      if (i === state.index) node.setAttribute('aria-current', 'true');
      else node.removeAttribute('aria-current');
    });
    if (window.matchMedia('(max-width: 767px)').matches) $('set-list').open = false;
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
      const notes = String(data.notes || '').trim();
      $('set-notes').textContent = notes;
      setVisible($('set-notes'), Boolean(notes));
      state.songs = Array.isArray(data.songs) ? data.songs.filter(song => song && /^[a-f0-9]{64}$/.test(song.share_token || '')) : [];
      setVisible($('set-loading'), false);
      if (!state.songs.length) {
        setVisible($('set-list'), false);
        setVisible($('set-player'), false);
        $('set-position').textContent = '';
        $('set-prev').disabled = $('set-next').disabled = true;
        showEmpty('No songs in this setlist are available right now.', 'The owner may have turned off the links to these songs.');
        return;
      }
      setVisible($('set-list'), true);
      renderSongs();
      select(0);
    } catch (error) {
      setVisible($('set-loading'), false);
      setVisible($('set-player'), false);
      setVisible($('set-list'), false);
      showEmpty(error.message || 'This setlist link is unavailable or has been revoked.', '');
    }
  }

  $('set-prev').addEventListener('click', () => select(state.index - 1));
  $('set-next').addEventListener('click', () => select(state.index + 1));
  $('set-songs').addEventListener('click', event => {
    const button = event.target.closest('[data-index]');
    if (button) select(Number(button.dataset.index));
  });
  document.addEventListener('keydown', event => {
    if (!event.altKey || !state.songs.length) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); select(state.index - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); select(state.index + 1); }
  });
  load();
})();
