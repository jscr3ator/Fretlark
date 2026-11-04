const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('./public/editor/model.js');

(async () => {
const editor = fs.readFileSync('public/editor/app.js', 'utf8');
const lines = editor.split('\n');
const line = text => lines.find(item => item.includes(text));
assert.ok(line("const query=new URLSearchParams(location.search)"), 'Editor query state exists');

// A near miss on a 6px fret must select the note, not the preceding rest.
{
  const upper={id:1,beat:{absolutePlaybackStart:480}}, lower={id:2,beat:{absolutePlaybackStart:480}};
  const hits=[{note:upper,noteHeadBounds:{x:200,y:80,w:6,h:10}},{note:lower,noteHeadBounds:{x:200,y:92,w:6,h:10}}];
  const lookup={staffSystems:[{realBounds:{x:0,y:0,w:500,h:150},bars:[{realBounds:{x:100,y:0,w:300,h:150},bars:[{beats:[{notes:hits}]}]}]}]};
  const context=vm.createContext({});
  vm.runInContext(editor.slice(editor.indexOf('  function findNoteNear('),editor.indexOf('  function markSelection()')),context);
  assert.equal(context.findNoteNear(lookup,193,85),hits[0],'Seven pixels left of the digit selects intended note');
  assert.equal(context.findNoteNear(lookup,203,97),hits[1],'Chord selection uses closest string');
  assert.equal(context.findNoteNear(lookup,203,92),hits[1],'An actual note hit beats padding around another note');
  assert.equal(context.findNoteNear(lookup,150,85),null,'Rest center still uses native rest selection');
  assert.equal(context.findNoteNear(lookup,203,130),null,'Other strings do not select a distant note');
  assert.equal(context.findNoteNear(null,203,85),null);
  let handler,selected,prevented=false,stopped=false,capture=false;
  const root={querySelector:()=>({getBoundingClientRect:()=>({left:100,top:40})}),focus(){},addEventListener(type,fn,useCapture){handler=fn;capture=useCapture;}};
  Object.assign(context,{isViewer:false,audioMuted:true,check:()=>true,$:()=>root,selectBeat(beat,note){selected=note;},api:{renderer:{boundsLookup:lookup},tickCache:{getBeatStart:()=>480},isReadyForPlayback:true,playNote(){throw Error('Muted check must not audition');}}});
  const start=editor.indexOf("  $('alphatab').addEventListener('mousedown'");
  vm.runInContext(editor.slice(start,editor.indexOf("  if($('btn-play'))",start)),context);
  handler({button:0,clientX:293,clientY:125,preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;}});
  assert.equal(capture,true,'Selection runs before alphaTab beat lookup');
  assert.equal(selected,upper);assert.equal(context.api.tickPosition,480);
  assert.equal(prevented&&stopped,true,'Native preceding-rest selection cannot overwrite note selection');
  context.isViewer=true;selected=null;
  handler({button:0});assert.equal(selected,null,'Student practice interaction is unchanged');
}

function audioContext(search = '?mute=1') {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {value: '0', disabled: false, handlers: {}, nextElementSibling: {textContent: ''}, classList: {toggle() {}}, setAttribute() {}, addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }});
    return elements.get(id);
  };
  const context = vm.createContext({
    URLSearchParams, location: {search}, window: {},
    $: element,
    listen(id, type, fn) { element(id).addEventListener(type, fn); },
    set(id, value) { element(id).value = value; },
    val(id, fallback = '') { return element(id).value ?? fallback; },
    clamp: (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0)),
    activate() {}, api: {masterVolume: .75, metronomeVolume: 0, countInVolume: 0},
  });
  vm.runInContext(line("const query=new URLSearchParams(location.search)"), context);
  return {context, element};
}

// mute=1 silences output while leaving the normal renderer path active.
{
  const {context, element} = audioContext('?mute=1');
  assert.equal(vm.runInContext('diagnosticSilent', context), false);
  assert.equal(vm.runInContext('audioMuted', context), true);
  assert.match(line('enableLazyLoading:!diagnosticSilent'), /enableLazyLoading:!diagnosticSilent/);
  const init = [line('api.masterVolume=audioMuted?0:.75'), line('if(audioMuted)for(const id')].join('\n');
  vm.runInContext(init, context);
  assert.equal(context.api.masterVolume, 0);
  assert.equal(element('master-volume').disabled, true);
  const volumeBinding = line("for(const id of ['master-volume','dock-master-volume'])listen");
  vm.runInContext(volumeBinding, context);
  element('master-volume').value = '100';
  element('master-volume').handlers.input[0]({target: element('master-volume')});
  assert.equal(context.api.masterVolume, 0, 'Volume slider cannot unmute mute=1');
  assert.equal(element('dock-master-volume').value, 0, 'Linked slider remains muted');
  for (const id of ['btn-metronome', 'btn-count-in']) {
    vm.runInContext(line(`listen('${id}','click'`), context);
    element(id).handlers.click[0]();
  }
  assert.equal(context.api.metronomeVolume, 0);
  assert.equal(context.api.countInVolume, 0);
  assert.match(line("api.noteMouseDown.on(n=>"), /!audioMuted/);
  assert.match(line("listen('fretboard','click'"), /!audioMuted/);
  assert.match(line('const options=new at.synth.AudioExportOptions()'), /masterVolume=audioMuted\?0:api\.masterVolume/);
  assert.match(line("url.search='?lesson='"), /query\.get\('mute'\)==='1'\?'&mute=1'/);
}

// Visible labels distinguish disabled metronome from an armed one-bar count-in.
{
  const buttons=new Map();
  const context=vm.createContext({$:id=>{if(!buttons.has(id))buttons.set(id,{classList:{toggle(){}},setAttribute(){},state:{textContent:''},querySelector(){return this.state;}});return buttons.get(id);}});
  vm.runInContext(editor.slice(editor.indexOf('  function activate('),editor.indexOf('  function buttonText(')),context);
  context.activate('btn-metronome',true);assert.equal(buttons.get('btn-metronome').state.textContent,'On');
  context.activate('btn-metronome',false);assert.equal(buttons.get('btn-metronome').state.textContent,'Off');
  context.activate('btn-count-in',true);assert.equal(buttons.get('btn-count-in').state.textContent,'1 bar');
  context.activate('btn-count-in',false);assert.equal(buttons.get('btn-count-in').state.textContent,'Off');
}

// Clicking a note focuses score and selects clicked note before keyboard fret entry.
{
  const actions = [], listeners = {};
  const event = () => ({on(fn) { this.fn = fn; }, trigger(value) { this.fn(value); }});
  const api = {beatMouseDown: event(), noteMouseDown: event(), isReadyForPlayback: true, playNote() { actions.push('preview'); }};
  const context = vm.createContext({
    api, audioMuted: true, check: () => true,
    $: id => ({focus() { actions.push(`focus:${id}`); }}),
    selectBeat(beat, note) { actions.push(note ? `note:${note.index}` : 'beat'); },
    document: {addEventListener(type, fn) { listeners[type] = fn; }},
  });
  vm.runInContext(line('api.beatMouseDown.on(b=>'), context);
  api.beatMouseDown.trigger({id: 'beat'});
  api.noteMouseDown.trigger({index: 2, beat: {id: 'beat'}});
  assert.deepEqual(actions, ['focus:alphatab', 'beat', 'note:2']);

  const keyboard = editor.slice(editor.indexOf("  document.addEventListener('keydown',e=>{"), editor.indexOf('  const drop=', editor.indexOf("  document.addEventListener('keydown',e=>{")));
  const noteActions = [];
  Object.assign(context, {
    selected: {track: 0, staff: 0, bar: 0, voice: 0, beat: 0, note: 0}, currentString: 1, digitBuffer: '', digitTimer: null,
    selectedTrack: () => ({staves: [{isStringed: true, isPercussion: false, tuning: [64, 59, 55, 50, 45, 40]}]}),
    clearDigitEntry() {}, applyNote(data) { noteActions.push(data); return {}; },
    set() {}, toast() {}, check: () => true, isViewer: false, setTimeout: () => 1, clearTimeout() {},
  });
  context.selectBeat = (beat, note) => { context.selected.note = note?.index || 0; context.currentString = note ? 7 - note.string : 1; };
  api.beatMouseDown.trigger({id: 'beat'});
  api.noteMouseDown.trigger({index: 1, string: 5, beat: {id: 'beat'}});
  vm.runInContext(keyboard, context);
  const key = {key: '7', code: 'Digit7', target: {tagName: 'DIV', isContentEditable: false, closest: () => null}, preventDefault() { this.prevented = true; }};
  listeners.keydown(key);
  assert.equal(key.prevented, true);
  assert.equal(noteActions.length, 1);
  assert.equal(noteActions[0].string, 2);
  assert.equal(noteActions[0].fret, 7);

  let guidance = '';
  context.selectedTrack = () => ({staves: [{isStringed: false, isPercussion: false, tuning: []}]});
  context.toast = message => { guidance = message; };
  const pianoKey = {key: '6', code: 'Digit6', target: key.target, preventDefault() { this.prevented = true; }};
  listeners.keydown(pianoKey);
  assert.equal(pianoKey.prevented, true);
  assert.equal(noteActions.length, 1, 'Piano digit does not create a default-pitch note');
  assert.equal(guidance, 'Use the MIDI pitch field for piano and percussion notes.');
}

// Fret field commit on an empty secondary voice uses the selected UI string.
{
  const score = M.createScore(), selected = {track: 0, staff: 0, bar: 0, voice: 1, beat: 0, note: 0};
  const field = {type: 'number', tagName: 'INPUT', value: '3'};
  const context = vm.createContext({
    noteFields: {'fret-input': 'fret'}, currentString: 2, selected, score, M,
    $: id => id === 'fret-input' ? field : null,
    applyNote(data) { M.setNote(score, selected, data); },
  });
  vm.runInContext(editor.slice(editor.indexOf('  function commitNoteField('), editor.indexOf('  for(const id of Object.keys(noteFields))')), context);
  context.commitNoteField('fret-input');
  const note = M.beatAt(score, selected).notes[0];
  assert.equal(note.string, 5, 'UI string 2 maps to alphaTab string 5');
  assert.equal(note.fret, 3);
}

// Selecting a new voice resets stale note indices and returns keyboard focus to the score.
{
  const score = M.createScore(), handlers = {};
  const selected = {track: 0, staff: 0, bar: 0, voice: 0, beat: 2, note: 3};
  let focused = false;
  const context = vm.createContext({
    M, score, selected, check: () => true, clearDigitEntry() {}, cancelEditRefresh() {},
    val: () => '1', curBeat: () => M.beatAt(score, selected), mutate(fn) { fn(score); }, syncInspector() {},
    listen(id, type, fn) { handlers[id] = fn; }, $: () => ({focus() { focused = true; }}),
  });
  vm.runInContext(line("listen('voice-select','change'"), context);
  handlers['voice-select']();
  assert.deepEqual([selected.voice, selected.beat, selected.note], [1, 0, 0]);
  assert.ok(M.beatAt(score, selected), 'Changing to empty voice creates its first beat');
  assert.equal(focused, true);
}

// Track apply preserves old pitches while changing tuning and capo, and rejects MIDI overflow.
function trackBinding({staff, capo = '5', tuning = 'seven', transpose = '0'}) {
  let tuningSawCapo;
  const values = {'track-name': 'Part', 'instrument-select': '25', 'track-volume': '12', 'track-pan': '8', 'capo-input': capo, 'tuning-select': tuning, 'transpose-input': transpose};
  const handlers = {};
  const track = {name: '', shortName: '', playbackInfo: {program: 25, volume: 12, balance: 8}, staves: [staff]};
  const context = vm.createContext({
    selected: {staff: 0}, M: {tunings: {seven: [64, 59, 55, 50, 45, 40, 35]}, setInstrument() {}, applyTuning(st) { tuningSawCapo = st.capo; }},
    selectedTrack: () => track, val: (id, fallback = '') => values[id] ?? fallback, set(id, value) { values[id] = value; },
    clamp: (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0)),
    mutate(fn) { fn(); }, listen(id, type, fn) { handlers[id] = fn; },
  });
  vm.runInContext(line("listen('btn-apply-track','click'"), context);
  return {context, handlers, track, values, get tuningSawCapo() { return tuningSawCapo; }};
}
{
  const staff = {isPercussion: false, isStringed: true, capo: 0, bars: []};
  const binding = trackBinding({staff});
  binding.handlers['btn-apply-track']();
  assert.equal(binding.tuningSawCapo, 0, 'Tuning remap captures pitch before applying new capo');
  assert.equal(staff.capo, 5);

  for (const [octave, tone, semitones] of [[10, 7, 1], [0, 0, -1]]) {
    const piano = {isPercussion: false, isStringed: false, capo: 0, bars: [{voices: [{beats: [{notes: [{octave, tone}]}]}]}]};
    const binding = trackBinding({staff: piano, capo: '0', tuning: 'none', transpose: String(semitones)});
    assert.throws(() => binding.handlers['btn-apply-track'](), /Transposition would put a note outside MIDI pitches 0–127\./);
    assert.deepEqual([piano.bars[0].voices[0].beats[0].notes[0].octave, piano.bars[0].voices[0].beats[0].notes[0].tone], [octave, tone], 'Rejected transpose leaves note unchanged');
  }
}

// New score resets loop playback state; editing shows every empty written bar.
{
  assert.match(line("function newScore("), /api\.playbackRange=null;api\.isLooping=false/);
  assert.match(editor, /if\(!isViewer\|\|document\.body\.classList\.contains\('simple-player'\)\)/);
  const wavExport = editor.slice(editor.indexOf("listen('btn-wav','click',async()=>"), editor.indexOf('  function history('));
  assert.match(wavExport, /const exportTitle=score\.title\|\|'Untitled'/);
  assert.match(wavExport, /\$\{exportTitle\}\.wav/);
}

// String summary reports note on keyboard target string, not previous selected string.
{
  let summary = '';
  const beat = {notes: [{string: 6, fret: 5}, {string: 5, fret: 7}]};
  const context = vm.createContext({
    selected: {staff: 0, bar: 0, beat: 0, note: 0}, currentString: 2,
    curBeat: () => beat, selectedTrack: () => ({staves: [{isStringed: true, isPercussion: false, tuning: [64, 59, 55, 50, 45, 40]}]}),
    txt(_id, value) { summary = value; },
  });
  vm.runInContext(editor.slice(editor.indexOf('  function updateSelectionSummary()'), editor.indexOf('  function rememberDocument()')), context);
  context.updateSelectionSummary();
  assert.equal(summary, 'Bar 1 · Beat 1 · String 2 · Fret 7');
  context.currentString = 3;
  context.updateSelectionSummary();
  assert.equal(summary, 'Bar 1 · Beat 1 · String 3', 'Empty target string has no stale fret number');
}

// Recovery preserves every open document, active selection, and previous draft on quota failure.
{
  const storage = new Map();
  let failure = false, warning = '';
  const context = vm.createContext({
    draftKey:'draft', guest:false, isViewer:false, documentIndex:0, score:{title:'Edited A'}, dirty:true,
    selected:{track:0,staff:0,bar:0,voice:0,beat:0,note:0}, activeTrack:0, currentString:1,
    displayed:new Set([0]), undo:[], redo:[], remoteLesson:{id:'a'},
    openedDocuments:[{}, {json:'B',title:'B',dirty:true,selected:{track:0},activeTrack:0,currentString:1,displayed:[0],remoteLesson:null}],
    M:{snapshot:score=>score.title, restore:json=>({title:json})},
    sessionStorage:{setItem(key,value){if(failure)throw Error('quota');storage.set(key,value);}},
    status(message){warning=message;}, toast() {},
  });
  vm.runInContext(editor.slice(editor.indexOf('  function rememberDocument()'),editor.indexOf('  function renderDocumentTabs()')),context);
  context.saveDraft();
  const saved=storage.get('draft:workspace');
  assert.deepEqual(JSON.parse(saved).documents.map(doc=>doc.json),['Edited A','B']);
  context.documentIndex=1; context.score={title:'Edited B'}; context.saveDraft();
  const latest=storage.get('draft:workspace');
  context.openedDocuments.length=0;
  context.restoreDraft(latest);
  assert.equal(context.documentIndex,1);
  assert.equal(context.score.title,'Edited B');
  assert.deepEqual(Array.from(context.openedDocuments,doc=>doc.json),['Edited A','Edited B']);
  failure=true; context.score.title='Unsaved B'; context.saveDraft();
  assert.equal(storage.get('draft:workspace'),latest,'Quota error keeps previous recoverable workspace');
  assert.equal(warning,'Local recovery unavailable');
  context.restoreDraft(latest,0);
  assert.equal(context.score.title,'Edited A','Library link selects requested recovered song');
}

// Local GP export flushes pending autosave so immediate reload cannot restore stale draft.
{
  let saved = null, cleared = false;
  const score = {title: 'Song'};
  const context = vm.createContext({
    score, dirty: true, saveTimer: 8, draftKey: 'draft',
    exportGpBytes: () => new Uint8Array([1]), download() {},
    clearTimeout() { cleared = true; }, saveDraft() { saved = 'latest'; },
    syncInspector() {}, renderDocumentTabs() {}, toast() {},
  });
  vm.runInContext(editor.slice(editor.indexOf('  function exportGp() {'), editor.indexOf('  let exportingAudio=')), context);
  context.exportGp();
  assert.equal(context.dirty, false);
  assert.equal(cleared, true);
  assert.equal(saved, 'latest');
}

// Async cloud save attaches returned lesson to the source tab without overwriting a switched document.
{
  const lesson = {id: 'saved', student_settings: {allowed_tracks: [0]}};
  let finishRequest, currentUrl = 'https://local.test/editor?mute=1';
  const source = {snapshot: 'before', title: 'Source', artist: '', tempo: 120, tracks: [{}], masterBars: [{}]};
  const other = {snapshot: 'other', title: 'Other'};
  const sourceDoc = {json: 'before', dirty: true, remoteLesson: null};
  const otherLesson = {id: 'other'};
  const context = vm.createContext({
    isViewer: false, score: source, dirty: true, loading: false, cloudSaving: false, documentIndex: 0,
    openedDocuments: [sourceDoc, {json: 'other', dirty: false, remoteLesson: otherLesson}], remoteLesson: null,
    M: {snapshot: value => value.snapshot}, exportGpBytes: () => new Uint8Array([1]), Blob,
    $: () => ({disabled: false, textContent: ''}),
    cloudApi: () => new Promise(resolve => { finishRequest = () => resolve({json: async () => lesson}); }),
    rememberDocument() {}, saveDraft() {}, syncInspector() {}, renderDocumentTabs() {}, toast(message) { context.lastToast = message; },
    location: {get href() { return currentUrl; }}, URL,
    window: {history: {replaceState(_state, _title, url) { currentUrl = String(url); }}},
    query: new URLSearchParams('?mute=1'), diagnosticSilent: false,
  });
  vm.runInContext(editor.slice(editor.indexOf('  async function saveCloud(){'), editor.indexOf("  listen('btn-cloud-save'")), context);
  const pending = context.saveCloud();
  source.snapshot = 'newer';
  sourceDoc.json = 'newer'; sourceDoc.dirty = true;
  context.score = other; context.documentIndex = 1; context.remoteLesson = otherLesson;
  finishRequest();
  await pending;
  assert.equal(sourceDoc.remoteLesson, lesson, 'Saved lesson stays attached to source document');
  assert.equal(sourceDoc.dirty, true, 'Changes made after save started remain dirty');
  assert.equal(context.remoteLesson, otherLesson, 'Switching documents during save keeps active lesson');
  assert.equal(currentUrl, 'https://local.test/editor?mute=1', 'Late save does not rewrite switched document URL');
}

// A save started before an edit keeps later edits dirty and adds the mute flag to its route.
{
  const lesson = {id: 'saved', student_settings: {allowed_tracks: [0]}};
  let currentUrl = 'https://local.test/editor?mute=1';
  const source = {snapshot: 'before', title: 'Song', artist: '', tempo: 120, tracks: [{}], masterBars: [{}]};
  const sourceDoc = {json: 'before', dirty: true, remoteLesson: null};
  const context = vm.createContext({
    isViewer: false, score: source, dirty: true, loading: false, cloudSaving: false, documentIndex: 0,
    openedDocuments: [sourceDoc], remoteLesson: null,
    M: {snapshot: value => value.snapshot}, exportGpBytes: () => new Uint8Array([1]), Blob,
    $: () => ({disabled: false, textContent: ''}),
    cloudApi: async () => ({json: async () => lesson}),
    rememberDocument() {}, saveDraft() {}, syncInspector() {}, renderDocumentTabs() {}, toast() {},
    location: {get href() { return currentUrl; }}, URL,
    window: {history: {replaceState(_state, _title, url) { currentUrl = String(url); }}},
    query: new URLSearchParams('?mute=1'), diagnosticSilent: false,
  });
  vm.runInContext(editor.slice(editor.indexOf('  async function saveCloud(){'), editor.indexOf("  listen('btn-cloud-save'")), context);
  const pending = context.saveCloud();
  context.score = {...source, snapshot: 'after-edit'};
  context.dirty = true;
  await pending;
  assert.equal(context.dirty, true, 'Edits made while cloud save waits remain unsaved');
  assert.equal(context.remoteLesson, lesson, 'Created lesson becomes target for next save');
  assert.match(currentUrl, /\?lesson=saved&mute=1$/);
}

// String navigation must retarget note operations, including empty strings.
{
  const score=M.createScore(),selected={track:0,staff:0,bar:0,voice:0,beat:0,note:0},handlers={};
  M.setNote(score,selected,{string:1,fret:5});M.setNote(score,selected,{string:2,fret:7});
  const context=vm.createContext({score,selected,M,currentString:2,
    selectedTrack:()=>score.tracks[0],curBeat:()=>M.beatAt(score,selected),
    mutate(fn){return fn(score);},listen(id,type,fn){handlers[id]=fn;},
  });
  vm.runInContext(editor.slice(editor.indexOf('  function selectedNote()'),editor.indexOf('  function updateHistory()')),context);
  vm.runInContext(editor.slice(editor.indexOf('  function applyNote('),editor.indexOf('  function applyLoopRange()')),context);
  assert.equal(context.selectedNote().fret,7,'Current string overrides stale note index');
  context.applyNote({isPalmMute:true});
  assert.equal(M.beatAt(score,selected).notes.find(n=>n.string===5).isPalmMute,true);
  assert.equal(M.beatAt(score,selected).notes.find(n=>n.string===6).isPalmMute,false);
  vm.runInContext(line("listen('btn-delete-note','click'"),context);
  handlers['btn-delete-note']();
  assert.equal(M.beatAt(score,selected).notes.length,1);
  assert.equal(M.beatAt(score,selected).notes[0].fret,5,'Delete removed only current-string note');
  context.currentString=3;
  handlers['btn-delete-note']();
  assert.equal(M.beatAt(score,selected).notes.length,1,'Empty string delete cannot remove another note');
  assert.throws(()=>context.applyNote({isPalmMute:true}),/Select a note/);
  context.applyNote({string:3,fret:9,move:true});
  assert.deepEqual(M.beatAt(score,selected).notes.map(n=>[n.string,n.fret]),[[6,5],[4,9]],'Inspector entry adds on empty string instead of moving old chord tone');
}

// Undo restores the selected string together with the score and selected note.
{
  const score=M.createScore(),selected={track:0,staff:0,bar:0,voice:0,beat:0,note:0};
  M.setNote(score,selected,{string:1,fret:5});
  const context=vm.createContext({M,score,selected,currentString:2,isViewer:false,displayed:new Set([0]),
    undo:[{json:M.snapshot(score),selected:{...selected},currentString:1}],redo:[],
    api:{tickPosition:0,stop(){}},clearDigitEntry(){},preserveEditViewport(){},markDirty(){},renderScore(){},updateHistory(){},toast(){}
  });
  vm.runInContext(editor.slice(editor.indexOf('  function history('),editor.indexOf('  function applyNote(')),context);
  context.history(true);assert.equal(context.currentString,1);assert.equal(context.redo[0].currentString,2);
  context.history(false);assert.equal(context.currentString,2);
}

// Bar controls preserve mid-measure tempos and validate alternate-ending passes.
{
  const at=require('./public/editor/vendor/alphaTab.js'),score=M.createScore(),selected={bar:1};
  const values={'bar-tempo':'90','alternate-endings':'1, 3','bar-numerator':'3','bar-denominator':'4','repeat-count':'2','section-input':'Verse','key-select':'0'};
  const later=at.model.Automation.buildTempoAutomation(false,.5,110,2);
  score.masterBars[1].tempoAutomations.push(later);
  const context=vm.createContext({at,M,score,selected,val:(id,fallback='')=>values[id]??fallback,check:()=>true,clamp:(v,min,max)=>Math.max(min,Math.min(max,Number(v)||0))});
  vm.runInContext(editor.slice(editor.indexOf('  function applyBarSettings('),editor.indexOf("  listen('btn-apply-bar'")),context);
  context.applyBarSettings(score);
  const bar=score.masterBars[1];
  assert.equal(bar.timeSignatureNumerator,3);assert.equal(bar.alternateEndings,5);assert.equal(bar.repeatCount,2);
  assert.deepEqual(bar.tempoAutomations.map(a=>[a.ratioPosition,a.value]),[[0,90],[.5,110]]);
  values['bar-tempo']='';context.applyBarSettings(score);
  assert.deepEqual(bar.tempoAutomations.map(a=>[a.ratioPosition,a.value]),[[.5,110]],'Clear only opening tempo, preserve later automation');
  const before=M.snapshot(score);values['alternate-endings']='1,,2';
  assert.throws(()=>context.applyBarSettings(score),/ending passes/);assert.equal(M.snapshot(score),before);
  values['alternate-endings']='';values['repeat-count']='2.5';
  assert.throws(()=>context.applyBarSettings(score),/Repeat plays/);assert.equal(M.snapshot(score),before);
  values['repeat-count']='2';values['bar-tempo']='500';
  assert.throws(()=>context.applyBarSettings(score),/Tempo must/);assert.equal(M.snapshot(score),before);
}

console.log('PASS: mute rendering/audio separation; note click fret entry; empty-voice string; track capo/transpose; new-score loop state; export draft flush; async document save state.');
})().catch(error => { console.error(error); process.exitCode = 1; });
