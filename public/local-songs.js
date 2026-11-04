/* Songs kept only in this browser. Shared by the library and the editor; nothing here is uploaded. */
(function (scope, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else scope.LocalSongs = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const indexKey = owner => `fretphrase-local-songs:${owner || 'guest'}`;
  const songKey = (owner, id) => `fretphrase-local-song:${owner || 'guest'}:${id}`;
  const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
  const read = (key, fallback) => { try { const raw = store()?.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

  // The index stays small (no score data) so the library can list songs without parsing every file.
  function list(owner) {
    const items = read(indexKey(owner), []);
    return Array.isArray(items) ? items.filter(item => item && typeof item.id === 'string').sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) : [];
  }
  function get(owner, id) {
    const song = read(songKey(owner, id), null);
    return song && typeof song.json === 'string' ? song : null;
  }
  function put(owner, song) {
    const s = store(); if (!s) throw Error('This browser is blocking local storage.');
    const id = song.id || (globalThis.crypto?.randomUUID?.() ?? String(Date.now()));
    const entry = {id, title: String(song.title || 'Untitled').slice(0, 180), artist: String(song.artist || '').slice(0, 180), tracks: Number(song.tracks) || 0, bars: Number(song.bars) || 0, tempo: Number(song.tempo) || 0, updatedAt: new Date().toISOString()};
    try {
      s.setItem(songKey(owner, id), JSON.stringify({...entry, json: song.json}));
      s.setItem(indexKey(owner), JSON.stringify([entry, ...list(owner).filter(item => item.id !== id)]));
    } catch (e) {
      throw Error(/quota/i.test(String(e?.name) + e?.message) ? 'This browser is out of space for local songs. Save some to the cloud or your device.' : 'The song could not be saved in this browser.');
    }
    return entry;
  }
  function remove(owner, id) {
    const s = store(); if (!s) return;
    s.removeItem(songKey(owner, id));
    s.setItem(indexKey(owner), JSON.stringify(list(owner).filter(item => item.id !== id)));
  }
  // Renaming an account moves its device songs to the new name so nothing is orphaned.
  function move(from, to) {
    const s = store(); if (!s || from === to) return;
    for (const entry of list(from)) {
      const song = get(from, entry.id); if (!song) continue;
      try { s.setItem(songKey(to, entry.id), JSON.stringify(song)); } catch { return; }
    }
    try { s.setItem(indexKey(to), JSON.stringify([...list(from), ...list(to)])); } catch { return; }
    for (const entry of list(from)) s.removeItem(songKey(from, entry.id));
    s.removeItem(indexKey(from));
  }
  return {list, get, put, remove, move};
}));
