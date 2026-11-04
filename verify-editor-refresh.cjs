const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const editor = fs.readFileSync('public/editor/app.js', 'utf8');
const alphaTab = require('./public/editor/vendor/alphaTab.js');
const midiGetter = Object.getOwnPropertyDescriptor(alphaTab.synth.AlphaSynthWebWorkerApi.prototype,'loadedMidiInfo').get;
const loadedInfo = {endTick:3840};
assert.equal(midiGetter.call({_loadedMidiInfo:loadedInfo}),loadedInfo,'Registering midiLoaded must read backing value, not recurse');
const section = (start, end) => editor.slice(editor.indexOf(start), editor.indexOf(end, editor.indexOf(start)));

// No-op edits must retain the score instance currently held by alphaTab.
{
  const M = require('./public/editor/model.js');
  const score = M.createScore();
  const context = vm.createContext({
    M, score, isViewer: false, loading: false, selected: {track:0, staff:0, bar:0, voice:0, beat:0, note:0}, currentString: 1, activeTrack: 0, displayed: new Set([0]),
    api: {tickPosition: 0, pause() {}}, clearDigitEntry() {}, syncInspector() {}, drawFretboard() {},
  });
  vm.runInContext(section('  function mutate(', '  function normalizeSelection()'), context);
  vm.runInContext('mutate(() => {})', context);
  assert.equal(context.score, score, 'No-op must not detach editor score from renderer');
  context.renderScore = () => {}; context.toast = () => {};
  vm.runInContext('mutate(() => { activeTrack = 1; displayed = new Set([1]); throw Error("failed"); })', context);
  assert.equal(context.activeTrack, 0, 'Failed edit restores active track');
  assert.deepEqual([...context.displayed], [0], 'Failed edit restores visible tracks');
}

// Undo and redo reveal the track containing the restored selection.
{
  const original = {name:'original'}, restored = {name:'restored'};
  const context = vm.createContext({
    isViewer:false, score:original, selected:{track:1}, activeTrack:1, currentString:1, displayed:new Set([1]),
    undo:[{json:'previous',selected:{track:0},currentString:2}], redo:[],
    M:{snapshot:()=> 'current',restore:()=>restored}, api:{tickPosition:10,stop(){}},
    clearDigitEntry(){}, preserveEditViewport(){}, markDirty(){}, renderScore(){}, updateHistory(){}, toast(){},
  });
  vm.runInContext(section('  function history(', '  function applyNote('), context);
  vm.runInContext('history(true)', context);
  assert.equal(context.activeTrack, 0);
  assert.ok(context.displayed.has(0), 'Undo reveals restored selection');
  vm.runInContext('history(false)', context);
  assert.equal(context.activeTrack, 1);
  assert.ok(context.displayed.has(1), 'Redo reveals restored selection');
}

// Note edits use alphaTab's live-edit hint and avoid rebuilding stable sidebars.
{
  const calls = [], counts = {mixer: 0, timeline: 0, fretboard: 0, mixerSync: 0};
  const score = {stylesheet: {}};
  const context = vm.createContext({
    score, isViewer: false, displayed: new Set([0]),
    document: {body: {classList: {contains: () => false}}},
    at: {StaveProfile: {Default: 'default'}},
    normalizeSelection() {}, configureViewport() {}, applyNotation() {}, syncInspector() {}, cancelEditRefresh() {},
    renderMixer() { counts.mixer++; }, renderTimeline() { counts.timeline++; }, drawFretboard() { counts.fretboard++; }, markActiveMixerTrack() { counts.mixerSync++; },
    api: {settings: {display: {}}, renderScore(...args) { calls.push(args); }},
  });
  vm.runInContext(section('  function renderScore(', '  function syncInspector()'), context);
  vm.runInContext('renderScore({reuseViewport:true},{lightweight:true})', context);
  assert.equal(calls[0][0], score);
  assert.equal(calls[0][2].reuseViewport, true);
  assert.deepEqual(counts, {mixer: 0, timeline: 0, fretboard: 1, mixerSync: 1});
  vm.runInContext('renderScore()', context);
  assert.deepEqual(counts, {mixer: 1, timeline: 1, fretboard: 2, mixerSync: 1}, 'Full render keeps normal refresh behavior');
}

// Every fret edit preserves viewport and MIDI tick, including two-digit coalescing.
{
  let args;
  const note = {index: 2};
  const context = vm.createContext({
    selectedNote: () => null, selected: {note: 0}, M: {setNote(_score, _selected, data) { assert.equal(data.fret, 12); return note; }},
    mutate(...values) { args = values; return 'undo-entry'; },
  });
  vm.runInContext(section('  function applyNote(', '  function applyLoopRange()'), context);
  assert.equal(vm.runInContext("applyNote({fret:12},'undo-entry')", context), 'undo-entry');
  args[0]({});
  assert.equal(context.selected.note, 2);
  assert.equal(args[3], 'undo-entry');
  assert.equal(args[4].renderHints.reuseViewport, true);
  assert.equal(args[4].preserveViewport, true);
  assert.equal(args[4].preserveTick, true);
  assert.equal(args[4].lightweight, true);
}

// Scroll restore runs after alphaTab cursor work, skips user scroll, and waits for latest render.
{
  const microtasks = [], focusCalls = [];
  const viewport = {scrollTop: 830, scrollLeft: 210};
  const scoreElement = {focus(options) { focusCalls.push(options); }};
  const body = {};
  let selections = 0;
  const api = {postRenderFinished: {on(fn) { this.fn = fn; }}, midiLoaded: {on() {}}};
  const context = vm.createContext({
    api, pendingEditRefresh: {top: 240, left: 30, focusedScore: true, intent: 4, documentIndex: 0, version: 1}, viewportIntent: 4, documentIndex: 0,
    document: {body, activeElement: body}, queueMicrotask(fn) { microtasks.push(fn); }, markSelection() { selections++; },
    cancelEditRefresh() { this.pendingEditRefresh = null; this.pendingEditTick = null; },
    $: id => id === 'score-scroll' ? viewport : scoreElement,
  });
  vm.runInContext(section('  api.postRenderFinished.on(()=>{', '  function syncPlaybackMix()'), context);
  api.postRenderFinished.fn();
  microtasks.shift()();
  assert.equal(selections, 1);
  assert.notEqual(context.pendingEditRefresh, null, 'Current edit context remains valid for later renderer callbacks');
  assert.deepEqual([viewport.scrollTop, viewport.scrollLeft], [240, 30]);
  assert.equal(focusCalls.length, 1);
  assert.equal(focusCalls[0].preventScroll, true);

  const userScrolled = {scrollTop: 710, scrollLeft: 0};
  context.$ = id => id === 'score-scroll' ? userScrolled : scoreElement;
  context.pendingEditRefresh = {top: 240, left: 30, focusedScore: true, intent: 4, documentIndex: 0, version: 2};
  context.viewportIntent = 5;
  context.document.activeElement = {isConnected: true};
  api.postRenderFinished.fn();
  microtasks.shift()();
  assert.equal(userScrolled.scrollTop, 710, 'A later user scroll wins');
  assert.equal(focusCalls.length, 1, 'A focus change to another element wins');

  context.$ = id => id === 'score-scroll' ? viewport : scoreElement;
  context.pendingEditRefresh = {top: 180, left: 20, focusedScore: false, intent: 5, documentIndex: 0, version: 3};
  context.viewportIntent = 5;
  api.postRenderFinished.fn();
  microtasks.shift()();
  assert.equal(selections, 3, 'Latest render refreshes note bounds');
  assert.equal(viewport.scrollTop, 180);

  context.pendingEditRefresh = {top: 20, left: 10, focusedScore: false, intent: 5, documentIndex: 0, version: 4};
  api.postRenderFinished.fn();
  context.pendingEditRefresh.version++;
  microtasks.shift()();
  assert.equal(viewport.scrollTop, 180, 'Older async render cannot restore a newer edit anchor');

  context.pendingEditRefresh = {top: 20, left: 10, focusedScore: false, intent: 5, documentIndex: 0, version: 6};
  context.documentIndex = 1;
  api.postRenderFinished.fn();
  microtasks.shift()();
  assert.equal(viewport.scrollTop, 180, 'A document switch cancels stale viewport restoration');
}

// A later edit after user scroll captures new viewport anchor and current MIDI tick.
{
  const viewport = {scrollTop: 690, scrollLeft: 0};
  const context = vm.createContext({
    $: () => viewport, api: {tickPosition: 720}, document: {activeElement: null},
    pendingEditRefresh: {top: 240, left: 30, focusedScore: true, intent: 4, documentIndex: 0, version: 1},
    pendingEditTick: {tick: 480, documentIndex: 0, intent: 2}, viewportIntent: 5, documentIndex: 0,
    editRefreshVersion: 1, playbackIntent: 7,
  });
  vm.runInContext(section('  function preserveEditViewport(', '  function cancelEditRefresh()'), context);
  vm.runInContext('preserveEditViewport()', context);
  assert.equal(context.pendingEditRefresh.top, 690);
  assert.equal(context.pendingEditRefresh.intent, 5);
  assert.equal(context.pendingEditRefresh.version, 2);
  assert.deepEqual([context.pendingEditTick.tick, context.pendingEditTick.documentIndex, context.pendingEditTick.intent], [720, 0, 7]);
}

// MIDI regeneration restores preserved tick unless user selects or starts playback elsewhere.
{
  let tick = 0;
  const api = {midiLoaded: {on(fn) { this.fn = fn; }}, get tickPosition() { return tick; }, set tickPosition(value) { tick = value; }};
  const context = vm.createContext({api, documentIndex: 3, playbackIntent: 8, pendingEditTick: {tick: 1440, documentIndex: 3, intent: 8}});
  vm.runInContext(section('  api.midiLoaded.on(()=>{', '  function syncPlaybackMix()'), context);
  api.midiLoaded.fn();
  assert.equal(tick, 1440);
  assert.equal(context.pendingEditTick, null);
  context.pendingEditTick = {tick: 960, documentIndex: 3, intent: 8};
  context.playbackIntent = 9;
  api.midiLoaded.fn();
  assert.equal(tick, 1440, 'Later MIDI load cannot overwrite newer user playback intent');
  assert.equal(context.pendingEditTick, null);
}

// Dirty state updates current tab text in place instead of replacing its node.
{
  const title = {textContent: ''}, unsaved = {textContent: ''};
  let rebuilds = 0;
  const tab = {querySelector(selector) { return selector === '#tab-file-title' ? title : unsaved; }};
  const context = vm.createContext({
    isViewer: false, dirty: false, documentIndex: 0, saveTimer: null, draftKey: null, score: {title: 'Song'},
    document: {querySelector() { return tab; }}, txt() {}, updateHistory() {},
    clearTimeout() {}, setTimeout() { return 1; }, saveDraft() {}, renderDocumentTabs() { rebuilds++; },
  });
  vm.runInContext(section('  function markDirty() {', '  function mutate('), context);
  vm.runInContext('markDirty()', context);
  context.score.title = 'Renamed';
  vm.runInContext('markDirty()', context);
  assert.equal(title.textContent, 'Renamed');
  assert.equal(unsaved.textContent, '•');
  assert.equal(rebuilds, 0);
}

console.log('Editor refresh regression checks passed');
