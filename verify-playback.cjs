const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const playerCss = fs.readFileSync('public/player.css', 'utf8');
assert.doesNotMatch(playerCss, /(?:^|})\s*svg\s*\{/, 'Player icon styling must not apply to notation SVGs');
assert.match(playerCss, /\.practice-toolbar-inner\{[^}]*contain:layout/, 'Scrollable practice toolbar does not widen the phone viewport');
const playerHtml = fs.readFileSync('public/editor/player.html', 'utf8');
assert.match(playerHtml, /id="btn-print"/, 'Player exposes print when the lesson allows it');
assert.match(playerHtml, /id="btn-download"/, 'Player exposes download when the lesson allows it');
assert.match(playerHtml, /id="open-mixer"[^>]*aria-label="Track mix"/, 'Icon-only mobile mixer button keeps an accessible name');
assert.match(playerHtml, /id="toggle-hand-guide"[^>]*aria-label="Fingering"/, 'Icon-only mobile fingering button keeps an accessible name');
const editorCss=fs.readFileSync('public/editor/styles.css','utf8');
for(const rule of editorCss.matchAll(/[^{}]*\.at-cursor-beat[^{}]*\{([^}]*)\}/g)) {
  assert.doesNotMatch(rule[1],/(?:^|;)\s*(?:width|height|transform|scale|min-width|max-width)\s*:/,'Cursor geometry belongs to alphaTab; a 2px width override becomes 0.02px after its native scaling');
}
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: '', options: [], dataset: {}, style: {setProperty() {}},
    handlers: {}, addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }, click() { this.clickCount = (this.clickCount || 0) + 1; },
    dispatch(type) { for (const fn of this.handlers[type] || []) fn({target: this}); },
    getAttribute() { return 'false'; }, setAttribute() {}, querySelector() { return null; },
    appendChild(option) { this.options.push(option); }, before() {}, after() {}, append() {},
  });
  return elements.get(id);
}
const score = {tempo: 120, masterBars: [{tempoAutomations: [{ratioPosition: 0, value: 120}, {ratioPosition: .5, value: 140}]}]};
const event = () => ({listeners: [], on(fn) {this.listeners.push(fn);}, trigger(value) {for(const fn of this.listeners) fn(value);}});
const api = {playbackSpeed: 1, playerPositionChanged: event(), playerStateChanged: event(), beatMouseDown: event(), renderFinished: event(), scoreLoaded: event(), activeBeatsChanged:event(), midiLoaded:event(), playerFinished:event(), midiEventsPlayed:event()};
const document = {body: {classList: {contains: name => name === 'simple-player'}}, getElementById: element, handlers: {}, addEventListener(type, fn) { this.handlers[type] = fn; }, querySelector: element, querySelectorAll() { return []; }, createElement() { return {dataset: {}}; }, createComment() { return {after() {}}; }};
const context = {document, window: {addEventListener() {},studio: {api, score},HandPosition:require('./public/editor/hand-position.js'),alphaTab:require('./public/editor/vendor/alphaTab.js')}, location: {search: ''}, URLSearchParams, MutationObserver: class {observe() {}}, matchMedia: () => ({matches: false, addEventListener() {}}), setTimeout, clearTimeout, cancelEditRefresh(){}, playbackIntent:0,
  listen: (id, type, fn) => element(id).addEventListener(type, fn), mutate: fn => fn(score), val: id => element(id).value,
  clamp: (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0))};
vm.createContext(context);
const editor = fs.readFileSync('public/editor/app.js', 'utf8');
// Hidden diagnostics may never run the constructor's queued animation frame.
let initialRenders=0;
const diagnosticContext={diagnosticSilent:true,api:{uiFacade:{initialRender(){initialRenders++;}}},setTimeout};
vm.createContext(diagnosticContext);
vm.runInContext(editor.slice(editor.indexOf('  if(diagnosticSilent){'),editor.indexOf('  // Exposed for reproducible')),diagnosticContext);
diagnosticContext.api.uiFacade.initialRender();
assert.equal(initialRenders,1,'Diagnostic renderer initializes once even if its scheduled callback later runs');
const binding = editor.split('\n').find(line => line.includes("listen('tempo-input','change'"));
assert.ok(binding, 'Editor tempo binding exists');
vm.runInContext(binding, context);
vm.runInContext(fs.readFileSync('public/player.js', 'utf8'), context);
let flashes=0;
const metroButton=element('btn-metronome'),originalQuery=metroButton.querySelector;
metroButton.querySelector=()=>({animate(){flashes++;}});
api.metronomeVolume=0;api.midiEventsPlayed.trigger({events:[{isMetronome:true}]});assert.equal(flashes,0,'Disabled metronome cannot flash');
api.metronomeVolume=.6;api.midiEventsPlayed.trigger({events:[{isMetronome:false}]});assert.equal(flashes,0);
api.midiEventsPlayed.trigger({events:[{isMetronome:true}]});assert.equal(flashes,1,'Flash follows actual metronome event');
metroButton.querySelector=originalQuery;api.metronomeVolume=0;
element('tempo-input').value = '60';
element('tempo-input').dispatch('change');
assert.equal(api.playbackSpeed, .5);
assert.deepEqual(score.masterBars[0].tempoAutomations, [{ratioPosition: 0, value: 120}, {ratioPosition: .5, value: 140}]);
document.body.classList.contains = () => false;
vm.runInContext(binding, context);
element('tempo-input').value = '100';
element('tempo-input').handlers.change.at(-1)();
assert.deepEqual(score.masterBars[0].tempoAutomations, [{ratioPosition: 0, value: 100}, {ratioPosition: .5, value: 140}]);
context.window.ScoreModel = {playbackBarAt: () => null};
api.playerPositionChanged.trigger({currentTick: 12000, endTick: 23040, currentTime: 6250, endTime: 12000});
api.tickPosition = 3840; // Native pause snaps to the first occurrence of this beat.
api.playerStateChanged.trigger({state: 0, stopped: false});
assert.equal(api.tickPosition, 12000, 'Pause preserves the current repeat pass');
api.tickPosition = 0;
api.playerStateChanged.trigger({state: 0, stopped: true});
assert.equal(api.tickPosition, 0, 'Stop still resets playback');
// Exercise the app's range binding with alphaTab's seek-on-assignment behavior.
const at = require('./public/editor/vendor/alphaTab.js');
const M = require('./public/editor/model.js');
const repeated = M.createScore();
repeated.masterBars[0].isRepeatStart = true;
repeated.masterBars[1].repeatCount = 2;
repeated.rebuildRepeatGroups();
const midi = new at.midi.MidiFile();
const generator = new at.midi.MidiFileGenerator(repeated, new at.Settings(), new at.midi.AlphaSynthMidiFileHandler(midi));
generator.generate();
let range = null, rangeWrites = 0;
const loopApi = {tickCache: generator.tickLookup, tickPosition: 8000,
  get playbackRange() { return range; },
  set playbackRange(value) { range = value; rangeWrites++; this.tickPosition = value.startTick; },
};
Object.assign(context, {score: repeated, M, api: loopApi, set: (id, value) => {element(id).value = value;}});
element('loop-start').value = '1'; element('loop-end').value = '2';
vm.runInContext(editor.slice(editor.indexOf('  function applyLoopRange()'), editor.indexOf('  function loop()')), context);
context.applyLoopRange();
assert.deepEqual([range.startTick, range.endTick], [0, 15360], 'Section includes both written repeat passes');
assert.equal(loopApi.tickPosition, 8000, 'Enabling repeat preserves a position inside the range');
context.applyLoopRange();
assert.equal(rangeWrites, 1, 'Pause/resume must not assign the same range again');
assert.equal(loopApi.tickPosition, 8000);
loopApi.tickPosition = 20000; context.applyLoopRange();
assert.equal(loopApi.tickPosition, 0, 'Starting outside the section seeks to its start');
// Saved mix applies to all tracks without losing the native pitch map.
M.addTrack(repeated, 'Muted piano', 0, []);
repeated.tracks[0].staves[0].transpositionPitch = 12;
repeated.tracks[0].playbackInfo.isSolo = true;
repeated.tracks[1].playbackInfo.isMute = true;
const mixCalls = [], nativePitches = new Map();
const mixApi = {settings: new at.Settings(), player: {
  resetChannelStates() { nativePitches.clear(); },
  applyTranspositionPitches(pitches) { for (const [channel, pitch] of pitches) nativePitches.set(channel, pitch); },
}};
for (const method of ['changeTrackVolume','changeTrackMute','changeTrackSolo']) mixApi[method] = (tracks, value) => mixCalls.push([method, tracks[0].index, value]);
Object.assign(context, {api: mixApi, at,trackPlaybackVolume:track=>track.playbackInfo.volume/16});
vm.runInContext(editor.slice(editor.indexOf('  function syncPlaybackMix()'), editor.indexOf('  api.playerReady.on(')), context);
context.syncPlaybackMix();
assert.deepEqual(nativePitches, at.midi.MidiFileGenerator.buildTranspositionPitches(repeated, mixApi.settings));
assert.ok(mixCalls.some(call => call[0] === 'changeTrackMute' && call[1] === 1 && call[2] === true));
assert.ok(mixCalls.some(call => call[0] === 'changeTrackSolo' && call[1] === 0 && call[2] === true));
assert.equal(mixCalls.filter(call => call[0] === 'changeTrackVolume').length, repeated.tracks.length);
// Diagnostic silent mode starts muted and refuses slider attempts to raise master volume.
Object.assign(context, {api: {}, diagnosticSilent: true, audioMuted: true, $: id => element(id)});
const masterInit = editor.split('\n').filter(line => line.includes('api.masterVolume=') || line.includes('if(audioMuted)for')).join('\n');
const masterBinding = editor.split('\n').find(line => line.includes("for(const id of ['master-volume','dock-master-volume'])listen"));
assert.ok(masterBinding, 'Master volume binding exists');
vm.runInContext(masterInit, context);
vm.runInContext(masterBinding, context);
assert.equal(context.api.masterVolume, 0);
assert.equal(element('master-volume').value, '0');
assert.equal(element('dock-master-volume').disabled, true);
element('master-volume').value = '100'; element('master-volume').dispatch('input');
assert.equal(context.api.masterVolume, 0, 'The inspector slider cannot unmute diagnostic mode');
assert.equal(Number(element('dock-master-volume').value), 0, 'Both master sliders stay muted');

// Copy/paste measures use standard shortcuts outside text fields, preserving native text editing.
context.isViewer = false;
const keyboard = editor.slice(editor.indexOf("  document.addEventListener('keydown',e=>{"), editor.indexOf('  const drop=', editor.indexOf("  document.addEventListener('keydown',e=>{")));
vm.runInContext(keyboard, context);
const keyEvent = (key, target = {tagName: 'DIV', isContentEditable: false, closest: () => null}) => ({key, code: '', ctrlKey: true, metaKey: false, shiftKey: false, target, preventDefault() { this.defaultPrevented = true; }});
const copyKey = keyEvent('c'); document.handlers.keydown(copyKey);
assert.equal(copyKey.defaultPrevented, true); assert.equal(element('btn-copy-bar').clickCount, 1);
const pasteKey = keyEvent('v'); document.handlers.keydown(pasteKey);
assert.equal(pasteKey.defaultPrevented, true); assert.equal(element('btn-paste-bar').clickCount, 1);
const textCopy = keyEvent('c', {tagName: 'INPUT', isContentEditable: false, closest: () => null}); document.handlers.keydown(textCopy);
assert.equal(textCopy.defaultPrevented, undefined); assert.equal(element('btn-copy-bar').clickCount, 1);
context.noteFields={'fret-input':'fret'};
let committedField;
context.commitNoteField=id=>{committedField=id;};
context.$=element;
let blurred=false, focused=false;
element('alphatab').focus=()=>{focused=true;};
const enterField=keyEvent('Enter',{tagName:'INPUT',type:'number',id:'fret-input',blur(){blurred=true;},closest:()=>null});
enterField.ctrlKey=false;document.handlers.keydown(enterField);
assert.equal(enterField.defaultPrevented,true);assert.equal(committedField,'fret-input');assert.equal(blurred,true);assert.equal(focused,true,'Enter commits field and returns focus to score');
// alphaTab prevents the mousedown default, so clicking a beat must explicitly leave an inspector field.
const mouseApi={beatMouseDown:event(),noteMouseDown:event()};
const mouseActions=[];
const mouseContext={api:mouseApi,$:()=>({focus(){mouseActions.push('focus');}}),selectBeat(){mouseActions.push('select');},diagnosticSilent:true,check:()=>true};
vm.createContext(mouseContext);
vm.runInContext(editor.split('\n').find(line=>line.includes('api.beatMouseDown.on(b=>')),mouseContext);
mouseApi.beatMouseDown.trigger({});
assert.deepEqual(mouseActions,['focus','select'],'Score click commits the focused field before selecting another beat');
context.check = () => true;
const eraseKey = keyEvent('Backspace'); eraseKey.ctrlKey = false; document.handlers.keydown(eraseKey);
assert.equal(element('btn-delete-note').clickCount, 1, 'Backspace shortcut deletes selected note');
const spaceEvent = target => ({key: ' ', code: 'Space', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target, preventDefault() { this.defaultPrevented = true; }});
const playsBefore = element('btn-play').clickCount || 0;
const scoreSpace = spaceEvent({tagName: 'DIV', isContentEditable: false, closest: () => null});
document.handlers.keydown(scoreSpace);
assert.equal(scoreSpace.defaultPrevented, true);
assert.equal(element('btn-play').clickCount, playsBefore + 1, 'Space on the score starts playback');
const buttonSpace = spaceEvent({tagName: 'BUTTON', isContentEditable: false, closest: selector => String(selector).includes('button')});
document.handlers.keydown(buttonSpace);
assert.equal(buttonSpace.defaultPrevented, undefined, 'Space on a focused button stays native');
assert.equal(element('btn-play').clickCount, playsBefore + 1, 'Space on a focused button does not also start playback');
const nameBinding=editor.split('\n').find(line=>line.includes("listen('new-track-type','change'"));
vm.runInContext(nameBinding,context);
element('new-track-name').value='My bass part';element('new-track-type').value='bass';element('new-track-type').dispatch('change');
assert.equal(element('new-track-name').value,'My bass part','Instrument changes preserve a custom track name');

// Exercise the actual editor mutation routine with score snapshots and history.
const historyContext={M, score:M.createScore(), selected:{track:0,staff:0,bar:0,voice:0,beat:0,note:0},
  undo:[],redo:[],isViewer:false,loading:false,activeTrack:0,displayed:new Set([0]),api:{pause(){}},clearTimeout,
  digitTimer:null,digitBuffer:'',digitUndoEntry:null,currentString:1,normalizeSelection(){},markDirty(){this.dirtyCount=(this.dirtyCount||0)+1;},
  renderScore(){},preserveEditViewport(){},syncInspector(){},renderMixer(){},drawFretboard(){},toast(){}};
vm.createContext(historyContext);
vm.runInContext(editor.split('\n').find(line=>line.includes('function clearDigitEntry()')),historyContext);
vm.runInContext(editor.slice(editor.indexOf('  function mutate('),editor.indexOf('  function normalizeSelection()')),historyContext);
historyContext.mutate(()=>{});
assert.equal(historyContext.undo.length,0,'No-op mutations do not create history');
const entry=historyContext.mutate(s=>M.setNote(s,historyContext.selected,{string:1,fret:1}),'Note',true,null);
historyContext.mutate(s=>M.setNote(s,historyContext.selected,{string:1,fret:12}),'Note',true,entry);
assert.equal(historyContext.undo.length,1,'Two fret digits share one undo entry');
assert.equal(M.beatAt(M.restore(historyContext.undo[0].json),historyContext.selected).notes.length,0);
historyContext.mutate(s=>M.setNote(s,historyContext.selected,{string:1,fret:5}));
historyContext.mutate(s=>M.setNote(s,historyContext.selected,{string:1,fret:6}),'Note',true,entry);
assert.equal(historyContext.undo.length,3,'Intervening changes cannot coalesce with an older entry');
historyContext.$=element;
historyContext.listen=(id,type,fn)=>element(id).addEventListener(type,fn);
historyContext.val=id=>element(id).value;
historyContext.curBeat=()=>M.beatAt(historyContext.score,historyContext.selected);
historyContext.selectedTrack=()=>historyContext.score.tracks[0];
vm.runInContext(editor.slice(editor.indexOf("  function selectedNote()"),editor.indexOf("  function updateHistory()")),historyContext);
historyContext.check=id=>!!element(id).checked;
vm.runInContext(editor.slice(editor.indexOf('  function applyNote('),editor.indexOf('  function applyLoopRange()')),historyContext);
vm.runInContext(editor.slice(editor.indexOf('  const noteFields='),editor.indexOf("  listen('btn-rest'")),historyContext);
element('fret-input').type='number';element('fret-input').tagName='INPUT';element('fret-input').value='7';
element('fret-input').dispatch('change');
assert.equal(M.beatAt(historyContext.score,historyContext.selected).notes[0].fret,7,'Actual field change updates selected note');
assert.equal(historyContext.undo.length,4,'Field change creates one undo step');
element('fret-input').dispatch('change');
assert.equal(historyContext.undo.length,4,'Repeated field change is a no-op');
element('duration-select').value='8';element('duration-select').dispatch('change');
assert.equal(M.beatAt(historyContext.score,historyContext.selected).duration,8,'Duration change updates beat');
element('new-track-name').value='Acoustic Guitar';element('new-track-type').dispatch('change');
assert.equal(element('new-track-name').value,'Electric Bass');
// AudioWorklet setup is asynchronous while play/pause are synchronous. A pause during the
// worklet load must not leave stale continuations connected and must not start a later play's
// source twice; otherwise playback reports Playing but the position never advances.
(async () => {
  const atSource = fs.readFileSync('public/editor/vendor/alphaTab.js', 'utf8');
  const classStart = atSource.indexOf('\tvar AlphaSynthAudioWorkletOutput = class');
  const classEnd = atSource.indexOf('\n\t//#endregion', classStart);
  assert.ok(classStart > 0 && classEnd > classStart, 'Audio worklet output class is present');
  const sources = [], nodes = [], loads = [];
  class Base {
    static BufferSize = 4096;
    constructor() {
      this.context = {
        state: 'running', sampleRate: 44100, destination: {},
        createBuffer() { return {}; },
        createBufferSource() {
          const source = { buffer: null, loop: false, started: 0, stopped: 0, connect() {}, disconnect() {}, start() { this.started++; }, stop() { this.stopped++; } };
          sources.push(source);
          return source;
        },
      };
    }
    activate() {}
    open() {}
    play() { this.activate(); this.buffer = {}; this.source = this.context.createBufferSource(); }
    pause() { this.pauses = (this.pauses || 0) + 1; if (this.source) { this.source.stop(0); this.source.disconnect(); this.source = null; } }
    destroy() { this.destroyed = true; }
    onReady() {}
    onSamplesPlayed() {}
    onSampleRequest() {}
  }
  class FakeWorkletNode {
    constructor() {
      this.connected = false; this.disconnected = false; this.messages = [];
      this.port = {
        addEventListener() {}, removeEventListener() {}, start() {},
        postMessage(message) { this.owner.messages.push(message); },
      };
      this.port.owner = this;
      nodes.push(this);
    }
    connect() { this.connected = true; }
    disconnect() { this.disconnected = true; }
  }
  const sandbox = {
    AlphaSynthWebAudioOutputBase: Base,
    AudioWorkletNode: FakeWorkletNode,
    BrowserUiFacade: {
      createAlphaSynthAudioWorklet() { return new Promise((resolve, reject) => loads.push({ resolve, reject })); },
    },
    Logger: { error(message) { sandbox.errors.push(message); } },
    Environment: { prepareForPostMessage: value => value },
    AbortController,
    errors: [],
  };
  vm.createContext(sandbox);
  vm.runInContext(atSource.slice(classStart, classEnd), sandbox);
  const output = new sandbox.AlphaSynthAudioWorkletOutput({});
  output.open(100);
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
  output.play();
  output.pause();
  output.play();
  await flush();
  assert.equal(loads.length, 1, 'A second play waits for the first worklet setup instead of racing it');
  loads[0].resolve();
  await flush();
  assert.equal(loads.length, 2, 'After the first worklet settles, the queued play starts its own setup');
  loads[1].resolve();
  await flush();
  assert.equal(nodes.filter(node => node.connected && !node.disconnected).length, 1, 'Only the current worklet stays connected');
  assert.equal(sources.filter(source => source.started && !source.stopped).length, 1, 'Only the current source keeps playing');
  assert.ok(sources.every(source => source.started <= 1), 'A stale setup cannot start a later play source twice');
  assert.equal(output._worklet, nodes[1], 'The latest worklet is the active output');
  assert.deepEqual(sandbox.errors, [], 'Rapid play/pause does not raise worklet lifecycle errors');
  console.log('PASS: practice/editor tempo; written repeat range; pause/resume position; saved mix and instrument transposition; silent diagnostics; measure and delete shortcuts; serialized audio worklet lifecycle.');
})().catch(error => { console.error(error); process.exit(1); });
