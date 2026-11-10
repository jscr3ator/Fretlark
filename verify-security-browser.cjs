#!/usr/bin/env node
'use strict';

// Browser-side security regressions: share-settings enforcement, decompression limits and
// the viewer's track filter. Everything runs locally; no server or audio device is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const at = require('./public/editor/vendor/alphaTab.js');
const M = require('./public/editor/model.js');

const editor = fs.readFileSync('public/editor/app.js', 'utf8');

// GPX declares its decompressed size before alphaTab allocates the buffer.
{
  const bcfz = size => {
    const bytes = new Uint8Array(8);
    bytes.set([0x42, 0x43, 0x46, 0x5a]); // BCFZ
    bytes[4] = size & 255;
    bytes[5] = size >>> 8 & 255;
    bytes[6] = size >>> 16 & 255;
    bytes[7] = size >>> 24 & 255;
    return bytes;
  };
  assert.equal(M.gpxUncompressedSize(new Uint8Array([0x42, 0x43, 0x46, 0x53])), null, 'BCFS is not size-prefixed');
  assert.equal(M.gpxUncompressedSize(bcfz(1234)), 1234, 'GPX header size is read little-endian');
  assert.doesNotThrow(() => M.assertSafeScoreFile(bcfz(M.MAX_GPX_UNCOMPRESSED_BYTES)), 'the size cap is inclusive');
  assert.throws(() => M.assertSafeScoreFile(bcfz(M.MAX_GPX_UNCOMPRESSED_BYTES + 1)), /expands to more data/, 'a GPX decompression bomb is refused');
  assert.doesNotThrow(() => M.assertSafeScoreFile(new Uint8Array([1, 2, 3])), 'ordinary files are untouched');
}

// The viewer's download listener must enforce allow_download even when its button is hidden.
{
  const handlers = {};
  const toasts = [];
  let downloads = 0, exports = 0;
  const context = vm.createContext({
    isViewer: true,
    studentSettings: {allow_download: false},
    studentFile: {bytes: new Uint8Array([1]), name: 'song.gp'},
    download() { downloads++; },
    exportGp() { exports++; },
    toast(message, error) { toasts.push([message, error]); },
    listen(id, type, fn) { handlers[`${id}:${type}`] = fn; }
  });
  const viewerAllowsLine = editor.split('\n').find(line => line.includes('const viewerAllows'));
  const downloadLine = editor.split('\n').find(line => line.includes("listen('btn-download'"));
  const saveLine = editor.split('\n').find(line => line.includes("listen('btn-save'"));
  assert.ok(viewerAllowsLine && downloadLine && saveLine, 'share-settings guard and download listeners exist');
  vm.runInContext([viewerAllowsLine, downloadLine, saveLine].join('\n'), context);
  handlers['btn-download:click']();
  handlers['btn-save:click']();
  assert.equal(downloads, 0, 'hidden Download does not download when the owner turned it off');
  assert.equal(exports, 0, 'hidden Save to device does not export the GP file either');
  assert.equal(toasts.length, 2, 'both blocked actions explain why');
  context.studentSettings = {allow_download: true};
  handlers['btn-download:click']();
  handlers['btn-save:click']();
  assert.equal(downloads, 1, 'download works when the share setting allows it');
  assert.equal(exports, 1, 'GP export works when the share setting allows it');
  context.isViewer = false;
  context.studentSettings = {allow_download: false};
  handlers['btn-download:click']();
  assert.equal(downloads, 2, 'the owner editor is not limited by viewer settings');
}

// A viewer receives only the tracks selected in the share dialog, whatever the file contains.
(async () => {
  const score = await new Promise((resolve, reject) => {
    const context = vm.createContext({
      clearDigitEntry() {}, busy() {}, at, M,
      isViewer: true, studentSettings: {allowed_tracks: [1]},
      api: {settings: new at.Settings(), stop() {}, playbackRange: null, isLooping: false},
      pendingBarSeek: null, clearRange() {}, rememberDocument() {}, remoteLesson: null, localId: null,
      practiceVolumes: new Map(), score: null, currentString: 1, activeTrack: 0,
      selected: {track: 0, staff: 0, bar: 0, voice: 0, beat: 0, note: 0},
      displayed: new Set(), undo: [], redo: [], dirty: false,
      set() {}, activate() {}, addDocument() {}, syncDocumentBadge() {}, renderScore() {},
      updateHistory() {}, $: () => ({scrollTop: 0}), saveDraft() {},
      toast() {}, status() {}, quietLoad: fn => fn()
    });
    const body = editor.slice(editor.indexOf('  async function importBytes('), editor.indexOf('  async function openFile('));
    vm.runInContext(body, context);
    const bytes = new Uint8Array(fs.readFileSync('public/editor/demo.gp'));
    context.importBytes(bytes, 'demo.gp', {title: 'Demo', artist: 'Test'}).then(() => {
      if (!context.score) reject(Error('importBytes did not produce a score'));
      else resolve(context.score);
    }, reject);
  });
  assert.equal(score.tracks.length, 1, 'only the allowed track survives import');
  assert.equal(score.tracks[0].name, 'Guitar 2 (Chords)', 'the allowed track is the one that was selected');
  assert.ok(!score.tracks.some(track => /Main riff/.test(track.name)), 'a disallowed track cannot leak into the viewer');

  // A crafted GPX bomb is rejected by the same import path with an error, not a crash.
  const toastMessages = [];
  const context = vm.createContext({
    clearDigitEntry() {}, busy() {}, at, M, isViewer: true, studentSettings: {},
    api: {settings: new at.Settings(), stop() {}, playbackRange: null, isLooping: false},
    pendingBarSeek: null, clearRange() {}, rememberDocument() {}, remoteLesson: null, localId: null,
    practiceVolumes: new Map(), score: {kept: true}, currentString: 1, activeTrack: 0,
    selected: {track: 0, staff: 0, bar: 0, voice: 0, beat: 0, note: 0},
    displayed: new Set(), undo: [], redo: [], dirty: false,
    set() {}, activate() {}, addDocument() {}, syncDocumentBadge() {}, renderScore() {},
    updateHistory() {}, $: () => ({scrollTop: 0}), saveDraft() {}, status() {},
    toast(message) { toastMessages.push(String(message)); }, quietLoad: fn => fn()
  });
  const body = editor.slice(editor.indexOf('  async function importBytes('), editor.indexOf('  async function openFile('));
  vm.runInContext(body, context);
  const bomb = new Uint8Array(8);
  bomb.set([0x42, 0x43, 0x46, 0x5a]);
  const size = M.MAX_GPX_UNCOMPRESSED_BYTES + 1;
  bomb.set([size & 255, size >>> 8 & 255, size >>> 16 & 255, size >>> 24 & 255], 4);
  await context.importBytes(bomb, 'bomb.gpx');
  assert.equal(context.score.kept, true, 'a refused file leaves the previous score intact');
  assert.ok(toastMessages.some(message => /Could not open this file/.test(message)), 'the refusal is shown to the user');

  // Signing up after using the guest editor must not strand songs saved on this device.
  {
    const saved = new Map();
    const fakeStorage = {
      getItem: key => saved.has(key) ? saved.get(key) : null,
      setItem: (key, value) => saved.set(key, String(value)),
      removeItem: key => saved.delete(key)
    };
    global.localStorage = fakeStorage;
    const previousWindow = global.window;
    global.window = {};
    try {
      require('./public/local-songs.js');
      const LocalSongs = global.window.LocalSongs;
      const song = LocalSongs.put('guest', {id: 'guest-song', title: 'Guest song', json: '{}'});
      assert.equal(LocalSongs.list('guest').length, 1, 'guest song starts in the guest slot');
      const context = vm.createContext({
        query: new URLSearchParams('?continue=1'),
        location: {href: 'https://local.test/editor/index.html?continue=1'},
        URL, URLSearchParams, localStorage: fakeStorage,
        sessionStorage: {setItem() {}},
        window: {history: {replaceState() {}}, LocalSongs},
        GUEST_DRAFT: 'fretline-draft:guest', localOwner: 'new@example.com',
        draftKey: 'fretline-draft:new@example.com'
      });
      const adopt = vm.runInContext(editor.slice(editor.indexOf('  function adoptGuestWorkspace('), editor.indexOf('  function unavailable(')) + '\nadoptGuestWorkspace', context);
      assert.equal(adopt(), false, 'no guest workspace means no workspace adoption');
      assert.equal(LocalSongs.list('guest').length, 0, 'the guest slot is emptied');
      assert.equal(LocalSongs.list('new@example.com')[0]?.id, song.id, 'the new account sees the guest song');
      assert.equal(LocalSongs.get('new@example.com', song.id)?.title, 'Guest song');
    } finally {
      global.window = previousWindow;
      delete global.localStorage;
    }
  }

  // Desktop audio health: missing AudioWorklet is not proof of silence; alphaTab's fallback
  // synth can still play, so the context itself must be probed.
  // The desktop app is not part of the public export, so this check runs only where it exists.
  if (fs.existsSync('desktop/src-tauri/src/desktop.js')) {
    const desktop = fs.readFileSync('desktop/src-tauri/src/desktop.js', 'utf8');
    const source = desktop.slice(desktop.indexOf('  const waitFor ='), desktop.indexOf('  const copyCommand ='));
    const makeContext = (running, advance) => {
      class FakeAudioContext {
        constructor() { this.state = running ? 'running' : 'suspended'; this._time = 0; }
        resume() { return Promise.resolve(); }
        get currentTime() { return advance ? (this._time += 0.06) : 0; }
        close() { return Promise.resolve(); }
      }
      return vm.createContext({window: {AudioContext: FakeAudioContext}, AudioContext: FakeAudioContext, Promise, setTimeout, Date});
    };
    const healthy = makeContext(true, true);
    const healthyCheck = vm.runInContext(source + '\naudioBroken', healthy);
    assert.equal(await healthyCheck(), false, 'a running context without AudioWorklet is still healthy');
    const broken = makeContext(false, false);
    const brokenCheck = vm.runInContext(source + '\naudioBroken', broken);
    assert.equal(await brokenCheck(), true, 'a suspended context is still reported as broken');
  }

  console.log('PASS: browser security (share downloads, track filtering, GPX decompression guard, desktop audio check)');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
