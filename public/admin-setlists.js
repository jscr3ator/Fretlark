/* Setlists: group Library songs, order them, and share the list with one link. */
(() => {
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  let setlists = [], detail = null, lessons = null, search = '', busy = false, listLoading = false;

  async function api(path, method = 'GET', body) {
    const response = await fetch(path, {method, cache: 'no-store', credentials: 'same-origin',
      headers: body ? {'Content-Type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(data.error || `Request failed (${response.status}).`);
    return data;
  }
  const call = (path, method, body) => api(`/api/admin/setlists${path}`, method, body);
  const status = (message, error = false) => {
    const node = $('setlists-status');
    node.textContent = message;
    node.classList.toggle('error', error);
  };

  function songRow(song, index, total) {
    const title = esc(song.title || 'Untitled song');
    return `<div class="setlist-song" data-song="${esc(song.id)}">
      <span class="setlist-song-index">${index + 1}</span>
      <span class="setlist-song-copy"><strong>${title}</strong>${song.artist ? `<small>${esc(song.artist)}</small>` : ''}</span>
      ${song.shared ? '' : '<span class="status-badge">Link off</span>'}
      <span class="setlist-song-actions">
        <button class="icon-button setlist-move" type="button" data-setlist-move="up" aria-label="Move ${title} up" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-button setlist-move" type="button" data-setlist-move="down" aria-label="Move ${title} down" ${index === total - 1 ? 'disabled' : ''}>↓</button>
        <button class="icon-button danger-icon" type="button" data-setlist-remove="${esc(song.id)}" aria-label="Remove ${title}"><svg class="icon"><use href="#i-close"/></svg></button>
      </span>
    </div>`;
  }

  function addRow(lesson) {
    return `<button class="setlist-add-row" type="button" data-setlist-add="${esc(lesson.id)}"><span><strong>${esc(lesson.title || 'Untitled song')}</strong>${lesson.artist ? `<small>${esc(lesson.artist)}</small>` : ''}</span><span aria-hidden="true">+</span></button>`;
  }

  function renderList() {
    $('setlists-content').innerHTML = `<div class="setlists-toolbar"><span class="field-hint">Your setlists</span><button class="button primary" type="button" data-setlists-new>New setlist</button></div>
      <form id="setlist-create-form" class="setlist-create" hidden><input id="setlist-create-title" type="text" maxlength="120" placeholder="Setlist name" aria-label="Setlist name"><button class="button primary" type="submit">Create</button><button class="button" type="button" data-setlists-create-cancel>Cancel</button></form>
      <div id="setlists-list" class="setlists-list" aria-live="polite"></div>`;
    const list = $('setlists-list');
    if (listLoading) { list.innerHTML = '<p class="setlists-empty">Loading…</p>'; return; }
    list.innerHTML = setlists.length ? setlists.map(setlist => `<button class="setlist-row" type="button" data-setlist-open="${esc(setlist.id)}">
      <span class="setlist-row-copy"><strong>${esc(setlist.title || 'Untitled setlist')}</strong><small>${plural(setlist.song_count, 'song')} · ${setlist.shared ? 'Shared' : 'Private'}</small></span>
      <span class="setlist-row-badges"><span class="status-badge ${setlist.shared ? 'is-on' : ''}">${setlist.shared ? 'Link on' : 'Private'}</span><svg class="icon" aria-hidden="true"><use href="#i-chevron"/></svg></span>
    </button>`).join('') : '<div class="setlists-empty"><strong>No setlists yet</strong><span>Group songs for a lesson, rehearsal or gig.</span></div>';
  }

  async function refreshList() {
    listLoading = true;
    renderList();
    try {
      setlists = (await call('')).setlists || [];
    } catch (error) {
      status(error.message, true);
    } finally {
      listLoading = false;
      renderList();
    }
  }

  function showList() {
    detail = null; search = ''; status('');
    renderList();
    refreshList();
  }

  function renderAddList() {
    const node = $('setlist-add-list');
    if (!node || !detail) return;
    const query = search.trim().toLowerCase();
    const addable = (lessons || []).filter(lesson => !detail.songs.some(song => song.id === lesson.id)
      && (!query || `${lesson.title || ''} ${lesson.artist || ''}`.toLowerCase().includes(query)));
    node.innerHTML = addable.length ? addable.map(addRow).join('')
      : `<p class="setlist-hint">${query ? 'No songs match your search.' : (detail.songs.length ? 'Every song is already in this setlist.' : 'No songs in your Library yet.')}</p>`;
  }

  function renderEditor() {
    const d = detail, songs = d.songs || [], off = songs.filter(song => !song.shared);
    const shared = Boolean(d.shared && d.share_token), shareUrl = shared ? `${location.origin}/set/${d.share_token}` : '';
    $('setlists-content').innerHTML = `<button class="text-button users-back" type="button" data-setlists-back>‹ All setlists</button>
      <div class="setlist-editor-head"><input id="setlist-title" type="text" maxlength="120" value="${esc(d.title || '')}" aria-label="Setlist title"><button class="icon-button danger-icon" type="button" data-setlist-delete aria-label="Delete setlist" title="Delete setlist"><svg class="icon"><use href="#i-trash"/></svg></button></div>
      <label class="field-label" for="setlist-notes">Notes</label>
      <textarea id="setlist-notes" class="setlist-notes" maxlength="1000" placeholder="Optional notes for this setlist">${esc(d.notes || '')}</textarea>
      <div class="setlist-share-row">
        <label class="link-toggle" for="setlist-share"><span class="link-toggle-icon" aria-hidden="true"><svg class="icon"><use href="#i-link"/></svg></span><span class="link-toggle-copy"><strong>Share setlist</strong><small>${shared ? 'Anyone with the link can see the songs whose links are on.' : 'Turn on a link to share this setlist.'}</small></span><input id="setlist-share" type="checkbox" role="switch" ${shared ? 'checked' : ''}></label>
        ${shared ? `<div class="setlist-link-field"><input id="setlist-url" readonly value="${esc(shareUrl)}" aria-label="Setlist link"><button class="button primary" type="button" data-setlist-copy><svg class="icon"><use href="#i-copy"/></svg>Copy</button></div><div class="link-meta"><span>Each song still needs its own link on.</span><span class="link-actions"><a class="text-button" href="${esc(shareUrl)}" target="_blank" rel="noopener">Open<svg class="icon"><use href="#i-external"/></svg></a><button class="text-button" type="button" data-setlist-rotate>Reset link</button></span></div>` : ''}
      </div>
      <div class="setlist-songs-head"><h3>Songs</h3><span class="panel-count">${songs.length}</span></div>
      <div class="setlist-songs">${songs.length ? songs.map((song, index) => songRow(song, index, songs.length)).join('') : '<p class="setlist-empty">No songs yet. Add some from your library below.</p>'}</div>
      ${off.length ? '<p class="setlist-hint">Only songs with their link on appear in the shared setlist.</p><button class="button" type="button" data-setlist-turn-on>Turn on links</button>' : ''}
      <details class="setlist-add" open><summary>Add songs</summary><div class="setlist-add-body"><input id="setlist-song-search" type="search" placeholder="Search your songs" value="${esc(search)}" aria-label="Search your songs"><div id="setlist-add-list" class="setlist-add-list"></div></div></details>`;
    renderAddList();
  }

  async function openSetlist(id) {
    status('');
    try {
      if (!lessons) lessons = ((await api('/api/admin/lessons')).lessons || []);
      detail = await call(`/${encodeURIComponent(id)}`);
      search = '';
      renderEditor();
    } catch (error) {
      status(error.message, true);
    }
  }

  async function patchSongs(ids) {
    if (busy || !detail) return;
    busy = true;
    try {
      detail = await call(`/${encodeURIComponent(detail.id)}`, 'PATCH', {lesson_ids: ids});
      renderEditor();
      status('Saved.');
    } catch (error) {
      status(error.message, true);
    } finally { busy = false; }
  }

  async function turnOnLinks(button) {
    const off = detail.songs.filter(song => !song.shared);
    if (!off.length) return;
    busy = true; button.disabled = true; status('Turning on links…');
    const failures = [];
    for (const song of off) {
      try {
        const response = await fetch(`/api/admin/lessons/${encodeURIComponent(song.id)}/share`, {method: 'POST', cache: 'no-store', credentials: 'same-origin',
          headers: {'Content-Type': 'application/json'}, body: JSON.stringify({rotate: false})});
        const data = await response.json().catch(() => ({}));
        if (!response.ok) failures.push(`${song.title || 'Untitled song'}: ${data.error || `Request failed (${response.status}).`}`);
      } catch (error) {
        failures.push(`${song.title || 'Untitled song'}: ${error.message}`);
      }
    }
    try {
      detail = await call(`/${encodeURIComponent(detail.id)}`);
      renderEditor();
      status(failures.length ? `Some links could not be turned on. ${failures.join(' ')}` : 'Links turned on. They now appear in the shared setlist.', failures.length > 0);
    } catch (error) {
      status(error.message, true);
    } finally { busy = false; }
  }

  function open() {
    const account = $('account-dialog');
    if (account?.open) account.close();
    const dialog = $('setlists-dialog');
    if (!dialog.open) dialog.showModal();
    lessons = null; // pick up songs added since the dialog was last open
    showList();
  }

  document.addEventListener('click', async event => {
    if (event.target.closest('[data-setlists-open]')) { open(); return; }
    const dialog = $('setlists-dialog');
    if (!dialog?.open) return;
    if (event.target.closest('[data-setlists-back]')) { showList(); return; }
    if (event.target.closest('[data-setlists-new]')) { const form = $('setlist-create-form'); if (form) { form.hidden = false; $('setlist-create-title')?.focus(); } return; }
    if (event.target.closest('[data-setlists-create-cancel]')) { const form = $('setlist-create-form'); if (form) form.hidden = true; return; }
    const op = event.target.closest('[data-setlist-open]');
    if (op) { openSetlist(op.dataset.setlistOpen); return; }
    if (!detail || busy) return;
    const action = event.target.closest('[data-setlist-delete],[data-setlist-copy],[data-setlist-rotate],[data-setlist-add],[data-setlist-remove],[data-setlist-move],[data-setlist-turn-on]');
    if (!action) return;
    if (action.matches('[data-setlist-delete]')) {
      if (!confirm('Delete this setlist? This cannot be undone.')) return;
      busy = true;
      try { await call(`/${encodeURIComponent(detail.id)}`, 'DELETE'); detail = null; showList(); }
      catch (error) { status(error.message, true); }
      finally { busy = false; }
      return;
    }
    if (action.matches('[data-setlist-copy]')) {
      try { await navigator.clipboard.writeText($('setlist-url').value); status('Link copied.'); }
      catch { $('setlist-url').select(); status('Select the link and copy it manually.', true); }
      return;
    }
    if (action.matches('[data-setlist-rotate]')) {
      busy = true;
      try { detail = await call(`/${encodeURIComponent(detail.id)}/share`, 'POST', {rotate: true}); renderEditor(); status('New link created. The old link no longer works.'); }
      catch (error) { status(error.message, true); }
      finally { busy = false; }
      return;
    }
    if (action.matches('[data-setlist-add]')) {
      const id = action.dataset.setlistAdd;
      if (!detail.songs.some(song => song.id === id)) await patchSongs([...detail.songs.map(song => song.id), id]);
      return;
    }
    if (action.matches('[data-setlist-remove]')) {
      await patchSongs(detail.songs.filter(song => song.id !== action.dataset.setlistRemove).map(song => song.id));
      return;
    }
    if (action.matches('[data-setlist-move]')) {
      const row = action.closest('[data-song]'), ids = detail.songs.map(song => song.id), index = ids.indexOf(row?.dataset.song), next = index + (action.dataset.setlistMove === 'up' ? -1 : 1);
      if (index < 0 || next < 0 || next >= ids.length) return;
      [ids[index], ids[next]] = [ids[next], ids[index]];
      await patchSongs(ids);
      return;
    }
    if (action.matches('[data-setlist-turn-on]')) await turnOnLinks(action);
  });

  document.addEventListener('submit', async event => {
    if (event.target.id !== 'setlist-create-form') return;
    event.preventDefault();
    if (busy) return;
    const title = $('setlist-create-title').value.trim();
    busy = true;
    try {
      const created = await call('', 'POST', {title});
      if (!lessons) lessons = ((await api('/api/admin/lessons')).lessons || []);
      setlists = [created, ...setlists];
      detail = created;
      search = '';
      status('');
      renderEditor();
    } catch (error) {
      status(error.message, true);
    } finally { busy = false; }
  });

  document.addEventListener('change', async event => {
    const dialog = $('setlists-dialog');
    if (!dialog?.open || !detail || busy) return;
    if (event.target.id === 'setlist-title' || event.target.id === 'setlist-notes') {
      busy = true;
      try {
        detail = await call(`/${encodeURIComponent(detail.id)}`, 'PATCH', {[event.target.id === 'setlist-title' ? 'title' : 'notes']: event.target.value});
        event.target.value = event.target.id === 'setlist-title' ? detail.title : detail.notes;
        status('Saved.');
      } catch (error) { status(error.message, true); }
      finally { busy = false; }
    } else if (event.target.id === 'setlist-share') {
      const on = event.target.checked;
      busy = true;
      try {
        detail = await call(`/${encodeURIComponent(detail.id)}/share`, on ? 'POST' : 'DELETE', on ? {rotate: false} : undefined);
        renderEditor();
        status(on ? 'Setlist link is on.' : 'Setlist link is off.');
      } catch (error) {
        event.target.checked = !on;
        status(error.message, true);
      } finally { busy = false; }
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id !== 'setlist-song-search' || !detail) return;
    search = event.target.value;
    renderAddList();
  });
})();
