/* Fretlark. Independent browser implementation, using alphaTab 1.8.4. */
(() => {
  'use strict';
  const at = window.alphaTab, M = window.ScoreModel;
  const query=new URLSearchParams(location.search), shareToken=query.get('share'), isViewer=!!shareToken||query.has('preview')||(String(location.pathname||'').endsWith('/player.html')&&query.has('lesson')), diagnosticSilent=query.get('silent')==='1', audioMuted=diagnosticSilent||query.get('mute')==='1';
  // Guests edit without an account; their workspace lives in this browser until they save to the cloud.
  let draftKey=null, guest=false, techniquesReady=false;
  const GUEST_DRAFT='fretline-draft:guest';
  // localId marks a song kept only in this browser's local library (see /local-songs.js).
  let localId=null, localOwner='guest', remoteLesson=null, cloudSaving=false, studentFile=null, studentSettings={};
  // Hi-fi playback uses SpessaSynth for audio while alphaTab keeps the score, cursor and controls.
  let hifi=null, hifiPending=false;
  const practiceVolumes=new Map(), soloLevels=new WeakMap(), soloPending=new WeakSet(), limitedOutputs=new WeakSet();
  function trackMixVolume(track){return isViewer?(practiceVolumes.get(track.index)??1):track.playbackInfo.volume/16;}
  function soloLevelGain(peak,rms){return rms>0.0001?Math.max(1,Math.min(8,0.075/rms,0.35/peak)):1;}
  function limitSoloSamples(samples){
    for(let i=0;i<samples.length;i++){
      const sample=samples[i],level=Math.abs(sample);
      if(!Number.isFinite(sample))samples[i]=0;
      else if(level>0.85)samples[i]=Math.sign(sample)*(0.85+0.13*Math.tanh((level-0.85)/0.13));
    }
  }
  function installSoloLimiter(){
    const output=api.player?.output;
    if(!isViewer||!output||limitedOutputs.has(output))return;
    const addSamples=output.addSamples.bind(output);
    output.addSamples=samples=>{if(score?.tracks.some(t=>t.playbackInfo.isSolo&&!t.playbackInfo.isMute))limitSoloSamples(samples);addSamples(samples);};
    limitedOutputs.add(output);
  }
  function trackPlaybackVolume(track){
    const gain=trackMixVolume(track);
    if(!isViewer||!track.playbackInfo.isSolo||track.playbackInfo.isMute)return gain;
    const solos=score.tracks.filter(t=>t.playbackInfo.isSolo&&!t.playbackInfo.isMute).length;
    return gain*Math.max(1,(soloLevels.get(track)??1)/Math.sqrt(solos||1));
  }
  const $ = id => document.getElementById(id);
  const listen = (id, event, fn) => $(id)?.addEventListener(event, fn);
  const val = (id, fallback = '') => $(id)?.value ?? fallback;
  const check = id => !!$(id)?.checked;
  const set = (id, value) => { if ($(id)) $(id).value = value; };
  const txt = (id, value) => { if ($(id)) $(id).textContent = value; };
  const esc = s => String(s).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
  let score, activeTrack = 0, displayed = new Set([0]), selected = {track:0, staff:0, bar:0, voice:0, beat:0, note:0};
  let undo = [], redo = [], dirty = false, loading = false, clipboard = null, saveTimer, toastTimer;
  let lastPlayedBar = -1, currentString = 1, digitBuffer = '', digitTimer, digitUndoEntry, pendingBarSeek=null, pendingEditRefresh=null, pendingEditTick=null, editRefreshVersion=0, viewportIntent=0, playbackIntent=0;
  const openedDocuments=[];let documentIndex=-1;
  // As in desktop tab editors, a newly entered or changed note sounds at once, so edits are audible even in a busy mix.
  function auditionNote(){const n=selectedNote();if(n&&!audioMuted&&api.isReadyForPlayback&&api.playerState!==1)try{if(hifi)hifi.auditionNote(n,selectedTrack());else api.playNote(n);}catch{}}
  function clearDigitEntry(){clearTimeout(digitTimer);digitBuffer='';digitUndoEntry=null;}
  // Respect a student's data-saving preference; all other devices use the richer bank.
  const compactAudio = navigator.connection?.saveData || ['slow-2g','2g'].includes(navigator.connection?.effectiveType);
  const soundBank = compactAudio ? 'sonivox.sf3' : 'FluidR3Mono_GM.sf3';
  // SpessaSynth only replaces audio; alphaTab still generates the MIDI and drives the cursor.
  const canUseHifi = !diagnosticSilent && typeof AudioWorkletNode !== 'undefined' && (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined');
  hifiPending = canUseHifi;
  const api = new at.AlphaTabApi($('alphatab'), {
    core: {scriptFile:new URL('./vendor/alphaTab.js', location.href).href, fontDirectory:new URL('./vendor/font/', location.href).href, includeNoteBounds:true, enableLazyLoading:!diagnosticSilent},
    display: {scale: .85, layoutMode:at.LayoutMode.Page, staveProfile:at.StaveProfile.ScoreTab, padding:[28,34,28,34]},
    player: {playerMode:canUseHifi?at.PlayerMode.EnabledExternalMedia:at.PlayerMode.EnabledSynthesizer, soundFont:new URL('./vendor/soundfont/' + soundBank, location.href).href,
      scrollElement:$('score-scroll'), scrollMode:isViewer?at.ScrollMode.OffScreen:at.ScrollMode.Off, scrollOffsetY:-40, enableCursor:true, enableUserInteraction:true, enableAnimatedBeatCursor:true}
  });
  // Hidden diagnostic surfaces do not receive animation frames or intersection events.
  if(diagnosticSilent){
    api.uiFacade.beginInvoke=action=>setTimeout(action,0);
    // The constructor schedules initialRender through animation frames, which hidden diagnostics may never receive.
    const initialRender=api.uiFacade.initialRender.bind(api.uiFacade);let initialized=false;
    api.uiFacade.initialRender=()=>{if(!initialized){initialized=true;initialRender();}};
    api.uiFacade.initialRender();
  }
  // Exposed for reproducible manual checks and local integrations.
  window.studio = {api, get score(){return score;}, get selected(){return {...selected};}, importBytes, exportGp, mutate};
  function toast(message, error = false) {
    const t = $('toast'); if (!t) return;
    t.textContent = message; t.classList.toggle('error', error); t.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('visible'), error ? 6500 : 3300);
  }
  function status(s) { txt('score-status', s); }
  // The score can be loaded before the hi-fi bank/MIDI are ready; keep the play button honest.
  function updatePlayReady(){
    const ready=!!api.isReadyForPlayback&&!hifiPending&&(!hifi||hifi.isReady);
    const button=$('btn-play');
    if(!button)return;
    button.disabled=!ready;
    if(ready){
      button.setAttribute('aria-label','Play');button.title='Play / pause · Space';
      const label=button.querySelector('.play-word');if(label)label.textContent='Play';
      if(score)status(`${score.masterBars.length || 0} bars · Ready to play`);
    }else if(hifiPending||(hifi&&!hifi.isReady)){
      button.setAttribute('aria-label','Loading instruments');button.title='Loading instruments';
      const label=button.querySelector('.play-word');if(label)label.textContent='Loading…';
      status('Loading instruments…');
    }
  }
  function busy(b, message) {
    loading = b;
    if ($('loading-overlay')) { $('loading-overlay').hidden = !b; $('loading-overlay').style.display = b ? 'flex' : 'none'; }
    if (message) status(message);
  }
  function preserveEditViewport(playbackPosition=api.tickPosition){
    const viewport=$('score-scroll');
    if(!pendingEditRefresh||pendingEditRefresh.intent!==viewportIntent||pendingEditRefresh.documentIndex!==documentIndex)pendingEditRefresh={top:viewport?.scrollTop||0,left:viewport?.scrollLeft||0,focusedScore:document.activeElement===$('alphatab'),intent:viewportIntent,documentIndex,version:0};
    pendingEditRefresh.version=++editRefreshVersion;
    pendingEditTick={tick:playbackPosition,documentIndex,intent:playbackIntent};
  }
  function cancelEditRefresh(){pendingEditRefresh=null;pendingEditTick=null;}
  const scoreViewport=$('score-scroll');
  scoreViewport?.addEventListener('wheel',()=>viewportIntent++,{passive:true});
  scoreViewport?.addEventListener('touchstart',()=>viewportIntent++,{passive:true});
  scoreViewport?.addEventListener('pointerdown',()=>viewportIntent++,true);
  scoreViewport?.addEventListener('keydown',e=>{if(['Home','End','PageUp','PageDown'].includes(e.key))viewportIntent++;});
  function activate(id, yes) { const button=$(id);button?.classList.toggle('active',yes);button?.setAttribute('aria-pressed',String(yes));const state=button?.querySelector('.practice-toggle-state');if(state)state.textContent=yes?(id==='btn-count-in'?'1 bar':'On'):'Off'; }
  function buttonText(id,label){const button=$(id);if(button)(button.querySelector('.button-label')||button).textContent=label;}
  function syncFullscreenButton(){const button=$('btn-fullscreen');if(!button)return;const active=!!document.fullscreenElement,label=active?'Exit fullscreen':'Fullscreen';button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',label);button.title=label;buttonText('btn-fullscreen',label);}
  document.addEventListener('fullscreenchange',syncFullscreenButton);
  syncFullscreenButton();
  function formatTime(ms) { const s = Math.floor((ms || 0)/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }
  function curBeat(ensure = false) { return score ? M.beatAt(score, selected, ensure) : null; }
  function selectedTrack() { return score?.tracks[activeTrack]; }
  function selectedNote() {
    const beat=curBeat(), staff=selectedTrack()?.staves[selected.staff];
    return staff?.isStringed&&!staff.isPercussion ? beat?.notes.find(note=>note.string===staff.tuning.length+1-currentString) : beat?.notes[selected.note];
  }
  function updateHistory() { if ($('btn-undo')) $('btn-undo').disabled = !undo.length; if ($('btn-redo')) $('btn-redo').disabled = !redo.length; }
  function updateSelectionSummary(){
    const beat=curBeat(), position=`Bar ${selected.bar+1} · Beat ${selected.beat+1}`;
    const staff=selectedTrack()?.staves[selected.staff];
    const stringed=staff?.isStringed&&!staff.isPercussion, n=stringed?beat?.notes.find(note=>note.string===staff.tuning.length+1-currentString):null;
    txt('selection-summary',stringed?`${position} · String ${currentString}${n?` · Fret ${n.fret}`:''}`:position);
  }
  function rememberDocument(){if(documentIndex>=0&&score)openedDocuments[documentIndex]={json:M.snapshot(score),title:score.title||'Untitled',dirty,selected:{...selected},activeTrack,currentString,displayed:[...displayed],undo:undo.slice(),redo:redo.slice(),remoteLesson,localId:typeof localId==='undefined'?null:localId};}
  // The badge describes the active document, not whichever document last loaded or saved.
  function syncDocumentBadge(){
    if(isViewer)return;
    const badge=$('lesson-badge');if(!badge)return;
    badge.textContent=remoteLesson?'Library song':(localId||guest)?'On this device':'Tab editor';
  }
  function saveDraft(){
    if(!draftKey||isViewer||!score||documentIndex<0)return;
    try {
      rememberDocument();
      const documents=openedDocuments.map(({json,title,dirty,selected,activeTrack,currentString,displayed,remoteLesson,localId})=>({json,title,dirty,selected,activeTrack,currentString,displayed,remoteLesson,localId}));
      const draft=JSON.stringify({version:1,documentIndex,documents});
      if(draft.length>4*1024*1024)throw Error('Workspace exceeds local recovery storage limit.');
      (guest?localStorage:sessionStorage).setItem(draftKey+':workspace',draft);
      if(typeof localId!=='undefined'&&localId&&dirty&&typeof window!=='undefined'&&window.LocalSongs)saveLocalSong();
    } catch(e) { status('Local recovery unavailable');toast('Local recovery could not be saved. Save your songs to your device or the cloud.',true); }
  }
  function restoreDraft(raw, requestedIndex){
    const draft=JSON.parse(raw);
    if(draft.version!==1||!Array.isArray(draft.documents)||!draft.documents.length||!Number.isInteger(draft.documentIndex)||!draft.documents[draft.documentIndex])throw Error('Invalid workspace draft.');
    const docs=draft.documents.map(doc=>{M.restore(doc.json);return {...doc,undo:[],redo:[]};});
    openedDocuments.splice(0,openedDocuments.length,...docs);documentIndex=requestedIndex??draft.documentIndex;
    const doc=openedDocuments[documentIndex];score=M.restore(doc.json);selected={...doc.selected};activeTrack=doc.activeTrack;currentString=doc.currentString||1;displayed=new Set(doc.displayed);dirty=doc.dirty;undo=[];redo=[];remoteLesson=doc.remoteLesson||null;localId=doc.localId||null;clearRange();syncDocumentBadge();
  }
  function renderDocumentTabs(){
    syncSaveButtons();
    const tabs=document.querySelector('.file-tabs');if(!tabs)return;
    tabs.querySelectorAll('.file-tab').forEach(el=>el.remove());
    openedDocuments.forEach((doc,i)=>{const button=document.createElement('button');button.type='button';button.className='file-tab'+(i===documentIndex?' is-active':'');button.setAttribute('role','tab');button.setAttribute('aria-selected',String(i===documentIndex));button.dataset.document=i;
      button.innerHTML=`<span class="tab-note"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M16 3v13M16 3l5 2v4l-5-2"/><ellipse cx="12" cy="17" rx="4" ry="3" fill="currentColor" stroke="none"/></svg></span><span ${i===documentIndex?'id="tab-file-title"':''}>${esc(i===documentIndex?score.title||'Untitled':doc.title)}</span><span class="tab-unsaved">${(i===documentIndex?dirty:doc.dirty)?'•':''}</span>`;tabs.insertBefore(button,tabs.querySelector('.tabs-spacer'));});
  }
  function addDocument(){openedDocuments.push({title:score.title||'Untitled'});documentIndex=openedDocuments.length-1;rememberDocument();renderDocumentTabs();}
  function switchDocument(i){if(i===documentIndex||!openedDocuments[i])return;clearTimeout(saveTimer);saveDraft();clearDigitEntry();pendingBarSeek=null;api.stop();clearRange();rememberDocument();documentIndex=i;const doc=openedDocuments[i];remoteLesson=doc.remoteLesson||null;localId=doc.localId||null;score=M.restore(doc.json);selected={...doc.selected};activeTrack=doc.activeTrack;currentString=doc.currentString||1;displayed=new Set(doc.displayed);dirty=doc.dirty;undo=doc.undo.slice();redo=doc.redo.slice();api.playbackRange=null;api.isLooping=false;activate('btn-loop',false);set('loop-start',1);set('loop-end',score.masterBars.length);renderScore();updateHistory();renderDocumentTabs();syncDocumentBadge();saveDraft();const url=new URL(location.href);if(remoteLesson)url.searchParams.set('lesson',remoteLesson.id);else url.searchParams.delete('lesson');window.history.replaceState(null,'',url);$('score-scroll').scrollTop=0;}
  function markDirty() {
    if(isViewer)return;
    dirty = true; txt('file-title', `${score.title || 'Untitled'}.gp •`); updateHistory();
    const tab=document.querySelector(`.file-tab[data-document="${documentIndex}"]`);
    if(tab){const title=tab.querySelector('#tab-file-title'),unsaved=tab.querySelector('.tab-unsaved');if(title)title.textContent=score.title||'Untitled';if(unsaved)unsaved.textContent='•';}
    else renderDocumentTabs();
    clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 700);
  }
  function mutate(fn, message = 'Song updated', render = true, coalesce, renderOptions = {}) {
    if (isViewer || !score || loading) return;
    if (coalesce === undefined) clearDigitEntry();
    const before = M.snapshot(score), selection = {...selected},selectionString=currentString, previousTrack=activeTrack, previousDisplayed=new Set(displayed);
    const preserveViewport=renderOptions.preserveViewport??true,preserveTick=renderOptions.preserveTick??true;
    const playbackPosition=preserveTick?api.tickPosition:undefined;
    try {
      api.pause(); fn(score); const updated = M.consolidate(score);
      if (M.snapshot(updated) === before) { if(JSON.stringify(selected)!==JSON.stringify(selection)){syncInspector();drawFretboard();} return null; }
      score = updated;
      const entry=coalesce && undo.at(-1)===coalesce ? coalesce : {json:before, selected:selection,currentString:selectionString};
      if(entry!==coalesce){undo.push(entry); if (undo.length > 35) undo.shift();} redo = [];
      normalizeSelection(); markDirty();
      if (render) {
        if(preserveViewport)preserveEditViewport(playbackPosition);
        renderScore(renderOptions.renderHints||{reuseViewport:true},{...renderOptions,preserveViewport});
        if(preserveTick&&Number.isFinite(playbackPosition))api.tickPosition=playbackPosition;
      } else { syncInspector(); renderMixer(); }
      // Routine note edits show in the score itself, so they skip the toast.
      if(!/^(?:(?:Song|Note|Duration|Dotted duration|Articulation|Initial tempo) updated|Beat changed to rest|Note removed)$/.test(message))toast(message);
      return entry;
    } catch(e) {
      score = M.restore(before); selected = selection; currentString=selectionString; activeTrack=previousTrack; displayed=previousDisplayed; renderScore(); toast(e.message || String(e), true);
    }
  }
  function normalizeSelection() {
    activeTrack = clamp(activeTrack, 0, score.tracks.length-1); selected.track = activeTrack;
    const t = selectedTrack(); selected.staff = clamp(selected.staff, 0, t.staves.length-1);
    selected.bar = clamp(selected.bar, 0, score.masterBars.length-1);
    const bar = t.staves[selected.staff].bars[selected.bar];
    selected.voice = clamp(selected.voice, 0, Math.max(0, bar.voices.length-1));
    selected.beat = clamp(selected.beat, 0, Math.max(0, bar.voices[selected.voice]?.beats.length-1));
    selected.note = clamp(selected.note, 0, Math.max(0, curBeat()?.notes.length-1));
    displayed = new Set([...displayed].filter(i=>score.tracks[i])); if (!displayed.size) displayed.add(activeTrack);
  }
  function renderScore(renderHints, renderOptions = {}) {
    if (!score) return;
    if(!renderOptions.preserveViewport)cancelEditRefresh();
    if(!isViewer||document.body.classList.contains('simple-player')){
      // Editable scores need a selectable bound for every written bar.
      score.stylesheet.perTrackMultiBarRest=new Set();score.stylesheet.multiTrackMultiBarRest=false;score.stylesheet.hideEmptyStaves=false;
    }
    normalizeSelection();configureViewport();api.settings.display.staveProfile=at.StaveProfile.Default;applyNotation(); api.renderScore(score, [...displayed].sort((a,b)=>a-b),renderHints);
    syncInspector(); if(!renderOptions.lightweight){renderMixer(); renderTimeline();}else markActiveMixerTrack(); drawFretboard();
  }
  function syncInspector() {
    if (!score) return;
    txt('file-title', `${score.title || 'Untitled'}.gp${dirty?' •':''}`); txt('tab-file-title',score.title || 'Untitled');
    document.querySelector('.tab-dirty')?.classList.toggle('unsaved',dirty);
    document.title = `${score.title || 'Untitled'} — Fretlark`;
    set('song-title', score.title); set('song-artist', score.artist); set('song-album', score.album);
    if(!isViewer&&!document.body.classList.contains('simple-player'))set('tempo-input', score.tempo); set('loop-start', clamp(val('loop-start',1),1,score.masterBars.length));
    if ($('loop-end') && (!$('loop-end').value || Number(val('loop-end')) > score.masterBars.length)) set('loop-end', score.masterBars.length);
    for (const id of ['loop-start','loop-end']) if ($(id)) $(id).max = score.masterBars.length;
    txt('track-count', `${score.tracks.length} tracks`);
    const t=selectedTrack(), st=t.staves[selected.staff];
    const trackSelect=$('active-track-select');
    if(trackSelect){if(trackSelect.options.length!==score.tracks.length||score.tracks.some((track,i)=>trackSelect.options[i]?.textContent!==track.name))trackSelect.innerHTML=score.tracks.map((track,i)=>`<option value="${i}">${esc(track.name)}</option>`).join('');trackSelect.value=String(activeTrack);}
    set('track-name',t.name); set('instrument-select',t.playbackInfo.program); set('track-volume',t.playbackInfo.volume); set('track-pan',t.playbackInfo.balance); set('capo-input',st.capo);
    txt('track-volume-label',Math.round(t.playbackInfo.volume/16*100)+'%');
    if(typeof syncTuningSelect==='function')syncTuningSelect(st);else{const key=Object.keys(M.tunings).find(k=>M.tunings[k].join()===st.tuning.join());set('tuning-select',!st.isStringed?'none':key||'custom');}
    if ($('tuning-select')) $('tuning-select').disabled = st.isPercussion;
    if ($('instrument-select')) $('instrument-select').disabled = st.isPercussion;
    const b=curBeat(), n=selectedNote();
    txt('selected-note', `Bar ${selected.bar+1} · Beat ${selected.beat+1} · ${t.name}`);
    set('voice-select',selected.voice); set('duration-select',b?.duration || 4); set('fret-input',n?.fret >= 0 ? n.fret : 0);
    currentString = clamp(currentString,1,st.tuning.length||6);
    const stringed=st.isStringed&&!st.isPercussion;
    txt('note-entry-help',stringed?'Click a note, then type a fret number. Use ↑ / ↓ to choose a string.':'Select a beat, then enter MIDI pitch in the inspector.');
    if(!isViewer)txt('status-help',stringed?'Click a note, then type a fret':'Select a beat, then enter MIDI pitch');
    updateSelectionSummary();
    if(api.playerState!==1)txt('lcd-bar',`${selected.bar+1}/${score.masterBars.length}`);
    set('string-input',currentString); if ($('string-input')) $('string-input').max = st.tuning.length || 6;
    set('pitch-input', st.isPercussion ? n?.percussionArticulation ?? 38 : n?.realValue ?? 60);
    for (const id of ['fret-input','string-input']) if ($(id)) $(id).disabled = !st.isStringed || st.isPercussion;
    if ($('pitch-input')) $('pitch-input').disabled = st.isStringed && !st.isPercussion;
    if ($('dotted-input')) $('dotted-input').checked = !!b?.dots;
    const props={'effect-palm':n?.isPalmMute,'effect-let-ring':n?.isLetRing,'effect-hammer':n?.isHammerPullOrigin,'effect-vibrato':!!n?.vibrato,'effect-staccato':n?.isStaccato,'effect-accent':!!n?.accentuated,'effect-dead':n?.isDead};
    for(const [id,v] of Object.entries(props)) if($(id)) $(id).checked=!!v;
    set('lyric-input',b?.lyrics?.[0] || ''); set('text-input',b?.text || ''); set('chord-input',b?.chord?.name || '');
    set('harmonic-select',n?.harmonicType || 0);set('slide-select',n?.slideOutType || 0);set('dynamics-select',b?.dynamics ?? 4);
    if($('tie-input'))$('tie-input').checked=!!n?.isTieDestination;
    if(techniquesReady){syncTechniques();syncChordShapes();syncAutomations();}
    document.querySelectorAll('[data-duration]').forEach(el=>{const active=Number(el.dataset.duration)===b?.duration;el.classList.remove('is-selected');el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});
    activate('btn-dotted',!!b?.dots);
    document.querySelectorAll('[data-effect]').forEach(el=>{const yes=!!n?.[el.dataset.effect];el.classList.toggle('active',yes);el.setAttribute('aria-pressed',String(yes));});
    const mb=score.masterBars[selected.bar]; set('bar-numerator',mb.timeSignatureNumerator); set('bar-denominator',mb.timeSignatureDenominator);
    set('key-select',st.bars[selected.bar].keySignature); set('section-input',mb.section?.text || ''); set('repeat-count',mb.repeatCount || 0);
    if($('repeat-start')) $('repeat-start').checked=mb.isRepeatStart;
    set('bar-tempo',mb.tempoAutomations.find(a=>a.ratioPosition===0)?.value??'');
    set('alternate-endings',Array.from({length:8},(_,i)=>i+1).filter(n=>mb.alternateEndings&(1<<(n-1))).join(', '));
    markSelection();
  }
  function renderMixer() {
    if (!$('track-list') || !score) return;
    if(isViewer&&document.body.classList.contains('simple-player')){
      $('track-list').innerHTML=score.tracks.map((t,i)=>`<div class="mixer-track ${i===activeTrack?'selected':''}" data-track="${i}"><label class="track-notation" title="Show or hide this track’s notation; audio is controlled by Mute and Solo"><input class="track-visible" type="checkbox" aria-label="Show ${esc(t.name)} notation" ${displayed.has(i)?'checked':''}><span>Tabs</span></label><button class="track-name-btn" title="Select ${esc(t.name)}" ${document.body.classList.contains('no-track-controls')?'disabled':''}>${esc(t.name)}</button><button class="mix-btn ${t.playbackInfo.isMute?'active':''}" data-mix="mute" aria-label="Mute ${esc(t.name)}" aria-pressed="${t.playbackInfo.isMute}">Mute</button><button class="mix-btn solo ${t.playbackInfo.isSolo?'active':''}" data-mix="solo" aria-label="Solo ${esc(t.name)}" aria-pressed="${t.playbackInfo.isSolo}">Solo</button><label class="mix-gain"><input class="mix-volume" aria-label="${esc(t.name)} volume" aria-valuetext="${Math.round(trackMixVolume(t)*100)} percent of original level" title="100% is the file’s original track level; solo balances quiet instruments automatically" type="range" min="0" max="200" step="5" value="${Math.round(trackMixVolume(t)*100)}"><output>${Math.round(trackMixVolume(t)*100)}%</output></label></div>`).join('');
      return;
    }
    $('track-list').innerHTML=score.tracks.map((t,i)=>`<div class="mixer-track ${i===activeTrack?'selected':''}" style="--track-color:${esc(t.color.rgba)}" data-track="${i}">
      <span class="track-number">${i+1}</span><input class="track-visible" type="checkbox" aria-label="Show ${esc(t.name)} on tabs" ${displayed.has(i)?'checked':''}>
      <button class="track-name-btn" title="Select ${esc(t.name)}">${esc(t.name)}</button>
      <button class="mix-btn ${t.playbackInfo.isMute?'active':''}" data-mix="mute" aria-label="Mute ${esc(t.name)}" aria-pressed="${t.playbackInfo.isMute}">M</button>
      <button class="mix-btn solo ${t.playbackInfo.isSolo?'active':''}" data-mix="solo" aria-label="Solo ${esc(t.name)}" aria-pressed="${t.playbackInfo.isSolo}">S</button>
      <input class="mix-volume" aria-label="${esc(t.name)} volume" type="range" min="0" max="16" value="${t.playbackInfo.volume}">
      <span class="track-instrument">${t.isPercussion?'Drum kit':esc(instruments[t.playbackInfo.program] || 'Instrument')}</span>
      <div class="track-spark">${t.staves[0].bars.map((b,bar)=>`<button class="measure-cell ${b.voices.some(v=>v.beats.some(beat=>beat.notes.length))?'':'empty'} ${bar===selected.bar?'current':''}" data-measure="${bar}" title="${esc(t.name)} · Bar ${bar+1}" aria-label="${esc(t.name)}, bar ${bar+1}" aria-current="${bar===selected.bar?'location':'false'}"></button>`).join('')}</div></div>`).join('');
  }
  function markActiveMixerTrack(){document.querySelectorAll('.mixer-track').forEach(row=>{const track=score.tracks[Number(row.dataset.track)];row.classList.toggle('selected',Number(row.dataset.track)===activeTrack);row.querySelectorAll('.measure-cell').forEach((cell,index)=>{const bar=track?.staves[0]?.bars[index],current=index===selected.bar;cell.classList.toggle('current',current);cell.classList.toggle('empty',!bar?.voices.some(v=>v.beats.some(beat=>beat.notes.length)));cell.setAttribute('aria-current',current?'location':'false');});});}
  function renderTimeline() {
    if (!$('timeline') || !score) return;
    $('timeline').innerHTML=score.masterBars.map((mb,i)=>`<button class="timeline-bar ${i===selected.bar?'selected':''}" data-bar="${i}" title="Bar ${i+1}${mb.section?' · '+esc(mb.section.text):''}">${mb.section?`<span>${esc(mb.section.text)}</span>`:''}${i+1}</button>`).join('');
    try{if(barRange)showRange();}catch{}
  }
  function selectBeat(beat, note) {
    if (!beat) return;
    cancelEditRefresh();playbackIntent++;
    clearDigitEntry();
    const bar=beat.voice.bar, staff=bar.staff;
    activeTrack=staff.track.index;
    selected={track:activeTrack,staff:staff.index,bar:bar.index,voice:beat.voice.index,beat:beat.index,note:note?.index || 0};
    if(note?.string>0)currentString=staff.tuning.length+1-note.string;
    syncInspector(); markActiveMixerTrack(); markSelection(); drawFretboard();
    if(note&&!isViewer&&innerWidth>1020&&!document.body.classList.contains('hide-inspector')&&!document.body.classList.contains('focus-score'))showInspector('note');
    document.querySelectorAll('.timeline-bar.selected').forEach(e=>e.classList.remove('selected'));
    document.querySelector(`[data-bar="${selected.bar}"]`)?.classList.add('selected');
    status(`Bar ${bar.index+1} / ${score.masterBars.length} · ${bar.masterBar.timeSignatureNumerator}/${bar.masterBar.timeSignatureDenominator}`);
  }
  function seekBar(index, scroll = true) {
    if(!score)return;cancelEditRefresh();playbackIntent++;selected.bar=clamp(index,0,score.masterBars.length-1); selected.beat=0;
    const b=curBeat(); if(b){selectBeat(b); api.tickPosition=api.tickCache?.getMasterBarStart(score.masterBars[selected.bar]) ?? b.absolutePlaybackStart;}
    if(scroll){const bound=api.renderer.boundsLookup?.findMasterBarByIndex(selected.bar); if(bound) $('score-scroll').scrollTo({top:Math.max(0,bound.realBounds.y-70),behavior:'smooth'});}
  }
  function findNoteNear(lookup,x,y) {
    let closest=null,distance=Infinity;
    for(const system of lookup?.staffSystems||[]){
      const row=system.realBounds;if(y<row.y-10||y>row.y+row.h+10)continue;
      for(const master of system.bars){
        const bar=master.realBounds;if(x<bar.x-10||x>bar.x+bar.w+10)continue;
        for(const staff of master.bars)for(const beat of staff.beats)for(const hit of beat.notes||[]){
          const r=hit.noteHeadBounds;
          if(x<r.x-10||x>r.x+r.w+10||y<r.y-6||y>r.y+r.h+6)continue;
          const inside=x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h;
          const gap=Math.hypot(x-r.x-r.w/2,y-r.y-r.h/2)+(inside?0:100);
          if(gap<distance){closest=hit;distance=gap;}
        }
      }
    }
    return closest;
  }
  function markSelection() {
    let marker=$('selection-marker');
    if(!marker){marker=document.createElement('div');marker.id='selection-marker';$('alphatab').appendChild(marker);}
    let notes=$('note-selection-markers');
    if(!notes){notes=document.createElement('div');notes.id='note-selection-markers';notes.setAttribute('aria-hidden','true');$('alphatab').appendChild(notes);}
    notes.replaceChildren();
    const b=curBeat(), bounds=b&&api.renderer.boundsLookup?.findBeat(b);
    if(!bounds){marker.hidden=true;return;} const r=bounds.realBounds;
    marker.hidden=false;Object.assign(marker.style,{left:`${r.x}px`,top:`${r.y}px`,width:`${Math.max(12,r.w)}px`,height:`${r.h}px`});
    if(isViewer||!check('editor-mode'))return;
    const staff=selectedTrack().staves[selected.staff],note=staff.isStringed&&!staff.isPercussion?b.notes.find(n=>n.string===staff.tuning.length+1-currentString):b.notes[selected.note];
    if(!note){
      // Classic string cursor: show where the next fret lands on an empty string.
      const tab=staff.showTablature&&staff.isStringed&&!staff.isPercussion?(api.renderer.boundsLookup.findBeats(b)||[]).at(-1):null;
      if(!tab)return;
      const lines=staff.tuning.length,bar=tab.barBounds.realBounds,gap=lines>1?bar.h/(lines-1):bar.h,y=bar.y+(currentString-1)*gap,size=Math.max(10,gap*.95);
      const cursor=document.createElement('div');cursor.className='note-selection-marker string-cursor';
      Object.assign(cursor.style,{left:`${tab.visualBounds.x+Math.max(0,tab.visualBounds.w-size)/2}px`,top:`${y-size/2}px`,width:`${size}px`,height:`${size}px`});notes.appendChild(cursor);
      return;
    }
    for(const beat of api.renderer.boundsLookup.findBeats(b)||[])for(const hit of beat.notes||[])if(hit.note.id===note.id){
      const box=hit.noteHeadBounds,highlight=document.createElement('div');highlight.className='note-selection-marker';
      Object.assign(highlight.style,{left:`${box.x-3}px`,top:`${box.y-3}px`,width:`${Math.max(6,box.w)+6}px`,height:`${Math.max(6,box.h)+6}px`});notes.appendChild(highlight);
    }
  }
  // alphaTab logs handled import failures to the console; the toast below is the user-facing report.
  function quietLoad(fn){const logger=at.Logger,level=logger?.logLevel;try{if(logger)logger.logLevel=at.LogLevel.None;return fn();}finally{if(logger)logger.logLevel=level;}}
  async function importBytes(data, name='Untitled.gp', metadata=null) {
    clearDigitEntry();
    busy(true,'Opening song…');
    try {
      let imported=quietLoad(()=>at.importer.ScoreLoader.loadScoreFromBytes(data,api.settings));
      if(metadata){imported.title=metadata.title;imported.artist=metadata.artist;}
      if(isViewer&&Array.isArray(studentSettings.allowed_tracks)){
        imported.tracks=imported.tracks.filter((track,index)=>studentSettings.allowed_tracks.includes(index));
        if(!imported.tracks.length)throw Error('No shared tracks match this file. Ask the owner to update sharing settings.');
        imported=M.consolidate(imported);
      }
      if(!imported.tracks.length || !imported.masterBars.length)throw new Error('This file contains no playable tabs.');
      api.stop();pendingBarSeek=null;clearRange();rememberDocument();remoteLesson=null;localId=null;practiceVolumes.clear(); score=imported;currentString=1;activeTrack=score.tracks.findIndex(t=>/main riff/i.test(t.name));if(activeTrack<0)activeTrack=0;
      displayed=new Set([activeTrack]);selected={track:activeTrack,staff:0,bar:0,voice:0,beat:0,note:0};undo=[];redo=[];dirty=false;
      set('loop-start',1);set('loop-end',score.masterBars.length);api.playbackRange=null;api.isLooping=false;activate('btn-loop',false);
      busy(false);addDocument();syncDocumentBadge();renderScore();updateHistory();$('score-scroll').scrollTop=0;
      if(!isViewer)saveDraft();
      if(!isViewer)toast(`Opened ${name} · ${score.tracks.length} tracks, ${score.masterBars.length} bars`);
    } catch(e){busy(false);const detail=e?.name==='TypeError'?'Unsupported or damaged file.':e.message||'Unsupported or damaged file.';toast(`Could not open this file: ${detail}`,true);if(score)status('Previous song retained');}
  }
  async function openFile(file) {
    if(isViewer||!file)return;if(file.size>30*1024*1024){toast('Please use a file smaller than 30 MB.',true);return;}
    if(/\.midi?$/i.test(file.name)){
      // MIDI has no strings or frets, so it is converted to alphaTex with guessed fingering, then opened like any other score.
      try {busy(true,'Converting MIDI…');await loadMidiImport();const {tex,warnings}=FretlarkMidiImport.toAlphaTex(new Uint8Array(await file.arrayBuffer()),{fileName:file.name});const s=quietLoad(()=>at.importer.ScoreLoader.loadAlphaTex(tex,api.settings));await importBytes(new at.exporter.Gp7Exporter().export(s),file.name.replace(/\.midi?$/i,'.gp'));if(warnings.length)toast(warnings.join(' '));else toast('MIDI opened. Strings and frets were guessed, so check the fingering.');}catch(e){busy(false);toast(`Could not open this MIDI file: ${e.message}`,true);}
    }else if(/\.atex$/i.test(file.name)){
      try {const text=await file.text(),s=quietLoad(()=>at.importer.ScoreLoader.loadAlphaTex(text,api.settings));await importBytes(new at.exporter.Gp7Exporter().export(s),file.name);}catch(e){toast(e.message,true);}
    }else await importBytes(new Uint8Array(await file.arrayBuffer()),file.name);
  }
  let midiImportReady;
  function loadMidiImport(){
    const load=src=>new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>reject(Error('The MIDI importer could not be loaded.'));document.head.appendChild(el);});
    return midiImportReady||=(async()=>{for(const src of ['./vendor/tonejs-midi.js','./midi-fingering.js','./midi-drums.js','./midi-import.js'])await load(src);})().catch(e=>{midiImportReady=null;throw e;});
  }
  async function demo() {try{const r=await fetch('/editor/demo.gp');if(!r.ok)throw Error('Demo could not be loaded');await importBytes(new Uint8Array(await r.arrayBuffer()),'Lantern Road.gp');}catch(e){toast(e.message,true);busy(false);}}
  function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  function exportGpBytes(source=score) {
    const bytes=new at.exporter.Gp7Exporter().export(source,api.settings);
    try {
      const reopened=at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes),api.settings);
      const noteCount=s=>{let count=0;for(const track of s.tracks)for(const staff of track.staves)for(const bar of staff.bars)for(const voice of bar.voices)for(const beat of voice.beats)count+=beat.notes.length;return count;};
      if(reopened.tracks.length!==source.tracks.length||reopened.masterBars.length!==source.masterBars.length||noteCount(reopened)!==noteCount(source))throw Error('Track, measure, or note counts changed.');
    } catch(e) { throw Error(`GP export failed reload verification; nothing was saved. ${e.message||''}`); }
    return bytes;
  }
  function exportGp() {
    if(!score)return;try{download(exportGpBytes(),`${score.title||'Untitled'}.gp`,'application/octet-stream');dirty=false;clearTimeout(saveTimer);saveDraft();syncInspector();renderDocumentTabs();toast('GP downloaded. Unsupported GP layout or RSE data may not be preserved.');}catch(e){toast(e.message,true);}
  }
  let exportingAudio=false, cancelAudio=false;
  function wavHeader(byteCount,channels=2,sampleRate=44100){
    const header=new ArrayBuffer(44),v=new DataView(header),write=(off,s)=>{for(let i=0;i<s.length;i++)v.setUint8(off+i,s.charCodeAt(i));};
    write(0,'RIFF');v.setUint32(4,36+byteCount,true);write(8,'WAVE');write(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*channels*2,true);v.setUint16(32,channels*2,true);v.setUint16(34,16,true);write(36,'data');v.setUint32(40,byteCount,true);
    return header;
  }
  listen('btn-wav','click',async()=>{
    if(exportingAudio){cancelAudio=true;return;}
    if(!score||!api.isReadyForPlayback){toast('Wait for the instruments to finish loading.');return;}
    const exportTitle=score.title||'Untitled';
    exportingAudio=true;cancelAudio=false;buttonText('btn-wav','Cancel export');api.pause();let exporter;
    try{
      if(hifi&&hifi.renderWav){
        status('Rendering WAV…');
        const buffer=await hifi.renderWav({
          onProgress:progress=>{if(cancelAudio)return;if(Number.isFinite(progress))status(`Rendering WAV… ${Math.round(Math.max(0,Math.min(1,progress))*100)}%`);else status('Rendering…');},
          isCancelled:()=>cancelAudio,
          masterVolume:audioMuted?0:api.masterVolume,
          range:api.isLooping&&api.playbackRange?api.playbackRange:null
        });
        if(!buffer||cancelAudio){toast('Audio export cancelled.');return;}
        const channels=Math.max(1,Math.min(2,buffer.numberOfChannels||2)),frames=buffer.length,byteCount=frames*channels*2;
        if(byteCount>250*1024*1024)throw Error('Audio exceeds 250 MB. Export a shorter loop range.');
        const pcm=new Int16Array(frames*channels);
        for(let channel=0;channel<channels;channel++){const data=buffer.getChannelData(channel);for(let i=0;i<frames;i++){const sample=Math.max(-1,Math.min(1,data[i]));pcm[i*channels+channel]=Math.round(sample*(sample<0?32768:32767));}}
        download(new Blob([wavHeader(byteCount,channels,buffer.sampleRate||44100),pcm.buffer],{type:'audio/wav'}),`${exportTitle}.wav`,'audio/wav');
        toast('Synthesized WAV audio downloaded.');
        return;
      }
      const options=new at.synth.AudioExportOptions();options.sampleRate=44100;options.masterVolume=audioMuted?0:api.masterVolume;options.metronomeVolume=0;
      if(api.isLooping&&api.playbackRange)options.playbackRange=api.playbackRange;
      const hasSolo=score.tracks.some(t=>t.playbackInfo.isSolo);
      for(const t of score.tracks)options.trackVolume.set(t.index,t.playbackInfo.isMute||(hasSolo&&!t.playbackInfo.isSolo)?0:t.playbackInfo.volume/16);
      exporter=await api.exportAudio(options);const chunks=[];let byteCount=0;
      while(!cancelAudio){const chunk=await exporter.render(1000);if(!chunk)break;
        const pcm=new Int16Array(chunk.samples.length);for(let i=0;i<pcm.length;i++){const sample=Math.max(-1,Math.min(1,chunk.samples[i]));pcm[i]=Math.round(sample*(sample<0?32768:32767));}
        chunks.push(pcm);byteCount+=pcm.byteLength;status(`Exporting WAV… ${Math.min(100,Math.round(chunk.currentTime/chunk.endTime*100))}%`);
        if(byteCount>250*1024*1024)throw Error('Audio exceeds 250 MB. Export a shorter loop range.');
      }
      if(!cancelAudio){download(new Blob([wavHeader(byteCount),...chunks],{type:'audio/wav'}),`${exportTitle}.wav`,'audio/wav');toast('Synthesized WAV audio downloaded.');}
      else toast('Audio export cancelled.');
    }catch(e){toast(`Audio export failed: ${e.message}`,true);}finally{exporter?.destroy();exportingAudio=false;buttonText('btn-wav','WAV audio');status('Ready');}
  });
  function history(back) {
    clearDigitEntry();
    if(isViewer)return;
    const from=back?undo:redo,to=back?redo:undo;if(!from.length)return;
    const playbackPosition=api.tickPosition;api.stop();to.push({json:M.snapshot(score),selected:{...selected},currentString});const entry=from.pop();score=M.restore(entry.json);selected=entry.selected;activeTrack=selected.track;displayed.add(activeTrack);currentString=entry.currentString??currentString;
    preserveEditViewport(playbackPosition);markDirty();renderScore({reuseViewport:true},{preserveViewport:true});api.tickPosition=playbackPosition;updateHistory();
  }
  function applyNote(data,coalesce){return mutate(s=>{if(!selectedNote()&&Object.keys(data).some(key=>!['fret','string','pitch','duration','dotted','dynamics','text','lyric','chord','move'].includes(key)))throw Error('Select a note first.');const position={...selected,note:selectedNote()?.index??-1},note=M.setNote(s,position,data); if(note){selected.note=note.index;if(note.string>0)currentString=selectedTrack().staves[selected.staff].tuning.length+1-note.string;}},'Note updated',true,coalesce,{renderHints:{reuseViewport:true},lightweight:true,preserveViewport:true,preserveTick:true});}
  function applyLoopRange(){
    if(!score)return;
    cancelEditRefresh();playbackIntent++;
    const [first,last]=M.loopBounds(val('loop-start',1),val('loop-end',score.masterBars.length),score.masterBars.length),start=first-1,end=last-1;
    set('loop-start',start+1);set('loop-end',end+1);
    const mb=score.masterBars[end],cache=api.tickCache,firstBar=cache?.getMasterBar(score.masterBars[start]),lastBar=cache?.getMasterBar(mb);
    const range={startTick:firstBar?.start??score.masterBars[start].start,endTick:lastBar?.end??mb.start+mb.calculateDuration()};
    // Include written repeats that remain inside the selected bar range.
    if(cache && firstBar){for(let i=cache.masterBars.indexOf(firstBar);i>=0&&i<cache.masterBars.length;i++){const played=cache.masterBars[i],bar=played.masterBar.index;if(bar<start||bar>end)break;if(bar===end)range.endTick=played.end;}}
    const position=api.tickPosition,current=api.playbackRange;
    // Assigning even an unchanged alphaTab range seeks back to its start.
    if(!current||current.startTick!==range.startTick||current.endTick!==range.endTick){api.playbackRange=range;api.tickPosition=position>=range.startTick&&position<range.endTick?position:range.startTick;}
    else if(position<range.startTick||position>=range.endTick)api.tickPosition=range.startTick;
  }
  function loop() {
    if(!score)return;const on=!api.isLooping;
    if(on){applyLoopRange();toast(`Looping bars ${val('loop-start')}–${val('loop-end')}`);}else{api.playbackRange=null;toast('Loop off');}
    api.isLooping=on;activate('btn-loop',on);
  }
  function configureViewport(){
    const viewport=$('score-scroll');if(!viewport||!viewport.clientWidth)return;
    const requested=val('zoom-select','fit');
    const mobileFit=isViewer&&requested==='fit'&&innerWidth<=760;
    const available=Math.max(1,viewport.clientWidth-(innerWidth<=760?18:32));
    const scale=mobileFit?.85:requested==='fit'?Math.max(.68,Math.min(1.1,Math.max(680,available)/1000)):Number(requested);
    const layout=val('layout-select')==='Horizontal'?at.LayoutMode.Horizontal:at.LayoutMode.Page;
    const width=mobileFit?available:Math.round(1000*scale);
    const padding=mobileFit?[16,12,16,12]:[28,34,28,34];
    const page=$('score-page'),widthChanged=parseFloat(page.style.width)!==width;
    page.style.width=width+'px';
    document.body.classList.toggle('horizontal-score',layout===at.LayoutMode.Horizontal);
    const changed=widthChanged||Math.abs(api.settings.display.scale-scale)>.002||api.settings.display.layoutMode!==layout||padding.some((value,i)=>api.settings.display.padding[i]!==value);
    api.settings.display.scale=scale;api.settings.display.layoutMode=layout;api.settings.display.padding=padding;
    if(changed)api.updateSettings();
    return changed;
  }
  function changeView() {
    if(!score)return;
    cancelEditRefresh();
    configureViewport();
    api.settings.display.staveProfile=at.StaveProfile.Default;
    applyNotation();api.updateSettings();api.renderScore(score,[...displayed].sort((a,b)=>a-b));
  }
  function applyNotation(){
    if(!score)return;const mode=val('notation-select','both');
    for(const track of score.tracks)for(const staff of track.staves){staff.showTablature=staff.isStringed&&!staff.isPercussion&&(mode==='both'||mode==='tab');staff.showStandardNotation=mode==='both'||mode==='standard'||(mode==='tab'&&(!staff.isStringed||staff.isPercussion))||(mode==='numbered'&&staff.isPercussion);staff.showSlash=mode==='slash';staff.showNumbered=mode==='numbered'&&!staff.isPercussion;}
  }
  function showInspector(which) {
    for(const key of ['song','track','note']){const panel=$('inspector-'+key);if(panel)panel.hidden=key!==which;}
    document.querySelectorAll('[data-inspector]').forEach(e=>{e.classList.remove('is-active');e.classList.toggle('active',e.dataset.inspector===which);e.setAttribute('aria-selected',String(e.dataset.inspector===which));});
  }
  const instruments=('Acoustic Grand Piano|Bright Acoustic Piano|Electric Grand Piano|Honky-tonk Piano|Electric Piano 1|Electric Piano 2|Harpsichord|Clavinet|Celesta|Glockenspiel|Music Box|Vibraphone|Marimba|Xylophone|Tubular Bells|Dulcimer|Drawbar Organ|Percussive Organ|Rock Organ|Church Organ|Reed Organ|Accordion|Harmonica|Tango Accordion|Nylon Guitar|Steel Guitar|Jazz Guitar|Clean Guitar|Muted Guitar|Overdriven Guitar|Distortion Guitar|Guitar Harmonics|Acoustic Bass|Fingered Bass|Picked Bass|Fretless Bass|Slap Bass 1|Slap Bass 2|Synth Bass 1|Synth Bass 2|Violin|Viola|Cello|Contrabass|Tremolo Strings|Pizzicato Strings|Orchestral Harp|Timpani|String Ensemble 1|String Ensemble 2|Synth Strings 1|Synth Strings 2|Choir Aahs|Voice Oohs|Synth Voice|Orchestra Hit|Trumpet|Trombone|Tuba|Muted Trumpet|French Horn|Brass Section|Synth Brass 1|Synth Brass 2|Soprano Sax|Alto Sax|Tenor Sax|Baritone Sax|Oboe|English Horn|Bassoon|Clarinet|Piccolo|Flute|Recorder|Pan Flute|Blown Bottle|Shakuhachi|Whistle|Ocarina|Square Lead|Saw Lead|Calliope Lead|Chiff Lead|Charang Lead|Voice Lead|Fifths Lead|Bass + Lead|New Age Pad|Warm Pad|Polysynth Pad|Choir Pad|Bowed Pad|Metallic Pad|Halo Pad|Sweep Pad|Rain|Soundtrack|Crystal|Atmosphere|Brightness|Goblins|Echoes|Sci-fi|Sitar|Banjo|Shamisen|Koto|Kalimba|Bagpipe|Fiddle|Shanai|Tinkle Bell|Agogo|Steel Drums|Woodblock|Taiko Drum|Melodic Tom|Synth Drum|Reverse Cymbal|Guitar Fret Noise|Breath Noise|Seashore|Bird Tweet|Telephone Ring|Helicopter|Applause|Gunshot').split('|');
  if($('instrument-select'))$('instrument-select').innerHTML=instruments.map((n,i)=>`<option value="${i}">${esc(n)}</option>`).join('');
  for(const id of ['btn-open','btn-tab-open','btn-empty-open'])listen(id,'click',()=>$('open-file').click());listen('open-file','change',e=>{openFile(e.target.files[0]);e.target.value='';});
  listen('btn-demo','click',()=>{if(!dirty||confirm('Reload the demo and discard current unsaved edits?'))demo();});
  const trackTemplates={guitar:['Acoustic Guitar',25,M.tunings.standard,false],electric:['Electric Guitar',27,M.tunings.standard,false],bass:['Electric Bass',33,M.tunings.bass,false],seven:['7-string Guitar',25,M.tunings.seven,false],piano:['Piano',0,[],false],drums:['Drums',0,[],true]};
  function newScore(options){clearDigitEntry();api.stop();api.playbackRange=null;api.isLooping=false;activate('btn-loop',false);pendingBarSeek=null;clearRange();rememberDocument();remoteLesson=null;localId=options?.local?(crypto.randomUUID?.()||String(Date.now())):null;score=M.createScore(options);currentString=1;activeTrack=0;selected={track:0,staff:0,bar:0,voice:0,beat:0,note:0};displayed=new Set([0]);undo=[];redo=[];dirty=true;addDocument();syncDocumentBadge();set('loop-start',1);set('loop-end',score.masterBars.length);markDirty();renderScore();$('score-scroll').scrollTop=0;}
  let placeholderDocument=-1;
  function openNewSong(){$('new-song-form').reset();if($('new-song-local'))$('new-song-local').checked=query.has('local')||guest;$('new-song-dialog').showModal();$('new-song-title').select();}
  listen('btn-new','click',openNewSong);
  listen('btn-close-new-song','click',()=>$('new-song-dialog').close());
  listen('btn-cancel-new-song','click',()=>$('new-song-dialog').close());
  listen('new-song-form','submit',e=>{
    e.preventDefault();
    // The blank score opened by ?new is replaced rather than left behind as an extra tab.
    if(documentIndex===placeholderDocument&&!undo.length){openedDocuments.splice(documentIndex,1);documentIndex=-1;}
    placeholderDocument=-1;
    const [numerator,denominator]=val('new-song-meter','4/4').split('/').map(Number),type=val('new-song-instrument','guitar'),template=trackTemplates[type];
    newScore({title:val('new-song-title').trim()||'Untitled',artist:val('new-song-artist').trim(),tempo:clamp(val('new-song-tempo',120),20,400),numerator,denominator,bars:clamp(val('new-song-bars',8),1,256),track:template,local:check('new-song-local')});
    $('new-song-dialog').close();toast(`New ${template[0].toLowerCase()} song · ${numerator}/${denominator} at ${clamp(val('new-song-tempo',120),20,400)} BPM`);
    $('alphatab').focus({preventScroll:true});
  });
  document.querySelector('.file-tabs')?.addEventListener('click',e=>{const button=e.target.closest('[data-document]');if(button)switchDocument(Number(button.dataset.document));});
  listen('btn-download','click',()=>{if(studentFile)download(studentFile.bytes,studentFile.name,'application/octet-stream');});
  listen('btn-save','click',exportGp);listen('btn-midi','click',()=>{if(score)try{api.downloadMidi(at.midi.MidiFileFormat.MultiTrack);}catch(e){toast(e.message,true);}});listen('btn-print','click',()=>api.print());
  listen('btn-play','click',()=>{if(!api.isReadyForPlayback){toast('Soundfont and player are still loading. Try again in a moment.');return;}if($('btn-loop')?.getAttribute('aria-pressed')==='true'){api.isLooping=true;applyLoopRange();}api.playPause();});
  listen('btn-stop','click',()=>{api.stop();seekBar(0,false);});
  listen('btn-loop','click',loop);for(const id of ['loop-start','loop-end'])listen(id,'change',()=>{if(api.isLooping){api.isLooping=false;loop();}});
  function setPracticeRange(start,end){
    if(!score)return;const [first,last]=M.loopBounds(start,end,score.masterBars.length);
    set('loop-start',first);set('loop-end',last);
    if(api.isLooping)applyLoopRange();
    for(const id of ['loop-start','loop-end'])$(id)?.dispatchEvent(new Event('input'));
  }
  listen('loop-current','click',()=>{const bar=isViewer&&lastPlayedBar>=0?lastPlayedBar:selected.bar;setPracticeRange(bar+1,bar+1);});
  listen('loop-full','click',()=>setPracticeRange(1,score?.masterBars.length));
  let dragBar=null;
  api.beatMouseDown.on(beat=>{if(isViewer){dragBar=beat.voice.bar.index;lastPlayedBar=dragBar;}});
  api.beatMouseUp.on(beat=>{if(isViewer&&beat&&dragBar!==null&&beat.voice.bar.index!==dragBar){
    setPracticeRange(Math.min(dragBar,beat.voice.bar.index)+1,Math.max(dragBar,beat.voice.bar.index)+1);
    if(!api.isLooping)loop();
  }else if(isViewer){if(api.isLooping)applyLoopRange();else api.playbackRange=null;}dragBar=null;});
  // The click is far quieter than instruments at gain 1, so metronome and count-in start well above it.
  listen('btn-metronome','click',()=>{api.metronomeVolume=audioMuted?0:api.metronomeVolume>0?0:2.8;activate('btn-metronome',api.metronomeVolume>0);});
  listen('btn-count-in','click',()=>{api.countInVolume=audioMuted?0:api.countInVolume>0?0:2.8;activate('btn-count-in',api.countInVolume>0);});
  listen('speed-select','change',()=>{api.playbackSpeed=Number(val('speed-select',1));if(hifi)hifi.setPlaybackSpeed(api.playbackSpeed);});
  for(const id of ['master-volume','dock-master-volume'])listen(id,'input',()=>{const v=audioMuted?0:clamp(val(id,75),0,100);api.masterVolume=v/100;set('master-volume',v);set('dock-master-volume',v);for(const input of [$('master-volume'),$('dock-master-volume')])if(input?.nextElementSibling)input.nextElementSibling.textContent=v+'%';});
  for(const id of ['zoom-select','layout-select','notation-select'])listen(id,'change',changeView);
  if(!document.body.classList.contains('simple-player'))listen('tempo-input','change',()=>mutate(s=>{const tempos=s.masterBars[0].tempoAutomations,tempo=tempos.find(a=>a.ratioPosition===0),value=clamp(val('tempo-input',120),20,400);if(tempo)tempo.value=value;else tempos.unshift(at.model.Automation.buildTempoAutomation(false,0,value,2));},'Initial tempo updated',true,undefined,{lightweight:true}));
  listen('btn-undo','click',()=>history(true));listen('btn-redo','click',()=>history(false));
  listen('btn-metadata','click',()=>mutate(s=>{s.title=val('song-title');s.artist=val('song-artist');s.album=val('song-album');},'Song details updated',true,undefined,{lightweight:true}));
  listen('btn-apply-track','click',()=>mutate(()=>{const t=selectedTrack(),st=t.staves[selected.staff];t.name=val('track-name')||'Track';t.shortName=t.name.slice(0,10);if(!st.isPercussion)M.setInstrument(t,Number(val('instrument-select',25)));t.playbackInfo.volume=clamp(val('track-volume',12),0,16);t.playbackInfo.balance=clamp(val('track-pan',8),0,16);const capo=clamp(val('capo-input'),0,24),tuning=typeof selectedTuning==='function'?selectedTuning():val('tuning-select')==='none'?[]:M.tunings[val('tuning-select')];if(tuning&&!st.isPercussion)M.applyTuning(st,tuning);st.capo=capo;const semitones=clamp(val('transpose-input'),-24,24);if(semitones&&!st.isPercussion){for(const bar of st.bars)for(const voice of bar.voices)for(const beat of voice.beats)for(const note of beat.notes){if(st.isStringed){if(note.fret+semitones<0||note.fret+semitones>36)throw Error('Transposition would put a note outside frets 0–36.');note.fret+=semitones;}else{const pitch=note.octave*12+note.tone+semitones;if(pitch<0||pitch>127)throw Error('Transposition would put a note outside MIDI pitches 0–127.');note.octave=Math.floor(pitch/12);note.tone=pitch%12;}}}set('transpose-input',0);},'Track settings applied'));
  listen('btn-add-track','click',()=>$('add-track-dialog').showModal());
  listen('btn-close-add-track','click',()=>$('add-track-dialog').close());
  listen('new-track-type','change',()=>{const names={guitar:'Acoustic Guitar',electric:'Electric Guitar',bass:'Electric Bass',seven:'7-string Guitar',piano:'Piano',drums:'Drums'};if(!val('new-track-name').trim()||Object.values(names).includes(val('new-track-name')))set('new-track-name',names[val('new-track-type')]);});
  listen('add-track-form','submit',e=>{e.preventDefault();const type=val('new-track-type'),name=val('new-track-name')||'Track';
    mutate(s=>{M.addTrack(s,name,...trackTemplates[type].slice(1));activeTrack=s.tracks.length-1;selected={track:activeTrack,staff:0,bar:0,voice:0,beat:0,note:0};displayed=new Set([activeTrack]);},'Track added');$('add-track-dialog').close();showInspector('track');});
  listen('btn-delete-track','click',()=>{if(!score||score.tracks.length===1){toast('Keep at least one track.',true);return;}if(confirm(`Delete ${selectedTrack().name}?`))mutate(s=>{s.tracks.splice(activeTrack,1);activeTrack=Math.max(0,activeTrack-1);displayed=new Set([activeTrack]);},'Track deleted');});
  listen('btn-add-bar','click',()=>mutate(s=>{M.addBar(s);selected.bar=s.masterBars.length-1;selected.beat=0;},'Bar added to all tracks'));
  listen('btn-insert-bar','click',()=>mutate(s=>{M.insertBar(s,selected.bar);selected.beat=0;},'Bar inserted before the cursor'));
  listen('btn-remove-bar','click',()=>{if(score&&confirm(`Delete bar ${selected.bar+1} from all tracks?`))mutate(s=>M.removeBar(s,selected.bar),'Bar deleted');});
  const noteFields={'fret-input':'fret','string-input':'string','pitch-input':'pitch','harmonic-select':'harmonic','slide-select':'slide','dynamics-select':'dynamics','tie-input':'tie','effect-palm':'isPalmMute','effect-let-ring':'isLetRing','effect-hammer':'isHammerPullOrigin','effect-staccato':'isStaccato','effect-dead':'isDead','chord-input':'chord','lyric-input':'lyric','text-input':'text'};
  function commitNoteField(id){
    const key=noteFields[id];
    const el=$(id), value=el.type==='checkbox'?el.checked:el.type==='number'||el.tagName==='SELECT'?Number(el.value):el.value;
    applyNote({[key]:value,...(key==='fret'?{string:currentString}:{}),move:true});
    if(['fret','string','pitch'].includes(key)&&typeof auditionNote==='function')auditionNote();
  }
  for(const id of Object.keys(noteFields)) listen(id,'change',()=>commitNoteField(id));
  // Standard techniques set straight on the alphaTab note, beat or measure. Each entry both applies and reads back its control.
  const E=typeof at==='object'?at.model:{}, num=v=>Number(v), bendPoints={2:[[0,0],[60,1]],3:[[0,1],[60,0]],4:[[0,0],[20,1],[40,1],[60,0]],6:[[0,1],[60,1]],7:[[0,1],[30,1],[60,2]],8:[[0,1],[60,0]]};
  function setBend(n){const amount=Number(val('bend-input',0)),type=Number(val('bend-style-select',2));n.bendPoints=null;n.bendType=amount?type:E.BendType.None;if(amount)for(const [offset,k] of bendPoints[type])n.addBendPoint(new E.BendPoint(offset,Math.min(12,amount*k)));}
  const whammy={dive1:[[0,0],[60,-2]],dive2:[[0,0],[60,-4]],dip:[[0,0],[30,-4],[60,0]],predive:[[0,-4],[60,-4]],scoop:[[0,-2],[30,0],[60,0]]};
  const techniques={
    'bend-input':{note:true,apply:setBend,read:n=>n.maxBendPoint?.value||0},
    'bend-style-select':{note:true,apply:setBend,read:n=>[2,3,4,6,7,8].includes(n.bendType)?n.bendType:2},
    'vibrato-select':{note:true,apply:(n,v)=>n.vibrato=num(v),read:n=>n.vibrato},
    'accent-select':{note:true,apply:(n,v)=>n.accentuated=num(v),read:n=>n.accentuated},
    'slide-in-select':{note:true,apply:(n,v)=>n.slideInType=num(v),read:n=>n.slideInType},
    'effect-ghost':{note:true,apply:(n,v)=>n.isGhost=v,read:n=>n.isGhost},
    'effect-lh-tap':{note:true,apply:(n,v)=>n.isLeftHandTapped=v,read:n=>n.isLeftHandTapped},
    'trill-input':{note:true,apply:(n,v)=>{n.trillValue=v===''?-1:clamp(num(v),0,36);if(n.trillValue>=0&&!n.trillSpeed)n.trillSpeed=16;},read:n=>n.trillValue>=0?n.trillValue:''},
    'trill-speed-select':{note:true,apply:(n,v)=>n.trillSpeed=num(v),read:n=>n.trillSpeed||16},
    'lh-finger-select':{note:true,apply:(n,v)=>n.leftHandFinger=num(v),read:n=>n.leftHandFinger},
    'rh-finger-select':{note:true,apply:(n,v)=>n.rightHandFinger=num(v),read:n=>n.rightHandFinger},
    'ornament-select':{note:true,apply:(n,v)=>n.ornament=num(v),read:n=>n.ornament},
    'pickstroke-select':{apply:(b,v)=>b.pickStroke=num(v),read:b=>b.pickStroke},
    'brush-select':{apply:(b,v)=>{b.brushType=num(v);b.brushDuration=0;},read:b=>b.brushType},
    'tremolo-select':{apply:(b,v)=>b.tremoloSpeed=num(v)||null,read:b=>b.tremoloSpeed||0},
    'percussive-select':{apply:(b,v)=>{b.tap=v==='tap';b.slap=v==='slap';b.pop=v==='pop';},read:b=>b.tap?'tap':b.slap?'slap':b.pop?'pop':''},
    'whammy-select':{apply:(b,v)=>{b.whammyBarPoints=null;b.whammyBarType=v?E.WhammyType.Custom:E.WhammyType.None;for(const [offset,value] of whammy[v]||[])b.addWhammyBarPoint(new E.BendPoint(offset,value));b.whammyStyle&&(b.whammyStyle=0);},read:b=>b.whammyBarType?Object.keys(whammy).find(k=>whammy[k].map(p=>p.join()).join()===(b.whammyBarPoints||[]).map(p=>p.offset+','+p.value).join())||'':''},
    'crescendo-select':{apply:(b,v)=>b.crescendo=num(v),read:b=>b.crescendo},
    'fade-select':{apply:(b,v)=>b.fade=num(v),read:b=>b.fade},
    'ottava-select':{apply:(b,v)=>b.ottava=num(v),read:b=>b.ottava},
    'rasgueado-select':{apply:(b,v)=>b.rasgueado=num(v),read:b=>b.rasgueado},
    'golpe-select':{apply:(b,v)=>b.golpe=num(v),read:b=>b.golpe},
    'wah-select':{apply:(b,v)=>b.wahPedal=num(v),read:b=>b.wahPedal},
    'slash-input':{apply:(b,v)=>b.slashed=v,read:b=>b.slashed}
  };
  for(const [id,t] of Object.entries(techniques))listen(id,'change',()=>mutate(()=>{
    const target=t.note?selectedNote():curBeat();if(!target)throw Error(t.note?'Select a note first.':'Select a beat first.');
    if(!t.note&&target.isFullBarRest&&!target.notes.length)throw Error('Add a note to this beat first.');
    const el=$(id);t.apply(target,el.type==='checkbox'?el.checked:el.value);
  },'Technique updated',true,undefined,{lightweight:true}));
  function syncTechniques(){const n=selectedNote(),b=curBeat();for(const [id,t] of Object.entries(techniques)){const el=$(id),target=t.note?n:b;if(!el)continue;const v=target?t.read(target):el.type==='checkbox'?false:'';if(el.type==='checkbox')el.checked=!!v;else el.value=String(v??'');if(!target&&el.tagName==='SELECT')el.selectedIndex=0;}
    const mb=score.masterBars[selected.bar];set('triplet-feel-select',mb.tripletFeel);set('direction-target-select',[...(mb.directions||[])].map(d=>E.Direction[d]).find(d=>d?.startsWith('Target'))||'');set('direction-jump-select',[...(mb.directions||[])].map(d=>E.Direction[d]).find(d=>d?.startsWith('Jump'))||'');
    const bar=selectedTrack().staves[selected.staff].bars[selected.bar];set('clef-select',bar.clef);set('simile-select',bar.simileMark===3?2:bar.simileMark);
    if($('double-bar-input'))$('double-bar-input').checked=mb.isDoubleBar;if($('free-time-input'))$('free-time-input').checked=mb.isFreeTime;
    set('tuplet-select',b&&b.tupletNumerator>1?b.tupletNumerator:1);set('fermata-select',M.fermataAt?M.fermataAt(score,selected)||'':'');}
  function setDirection(mb,prefix,name){const kept=[...(mb.directions||[])].filter(d=>!E.Direction[d].startsWith(prefix));mb.directions=new Set(name?[...kept,E.Direction[name]]:kept);}
  listen('triplet-feel-select','change',()=>mutate(s=>{s.masterBars[selected.bar].tripletFeel=Number(val('triplet-feel-select',0));},'Triplet feel updated'));
  listen('direction-target-select','change',()=>mutate(s=>setDirection(s.masterBars[selected.bar],'Target',val('direction-target-select')),'Sign updated'));
  listen('direction-jump-select','change',()=>mutate(s=>setDirection(s.masterBars[selected.bar],'Jump',val('direction-jump-select')),'Jump updated'));
  listen('clef-select','change',()=>mutate(s=>{s.tracks[activeTrack].staves[selected.staff].bars[selected.bar].clef=Number(val('clef-select',4));},'Clef updated'));
  // A two-bar repeat sign spans this bar and the next, as in desktop tab editors.
  listen('simile-select','change',()=>mutate(s=>{const bars=s.tracks[activeTrack].staves[selected.staff].bars,v=Number(val('simile-select',0)),bar=bars[selected.bar],next=bars[selected.bar+1];if(next&&next.simileMark===3)next.simileMark=0;if(v===2){if(!next)throw Error('Add a bar after this one for a two-bar repeat.');bar.simileMark=2;next.simileMark=3;}else bar.simileMark=v;},'Repeat sign updated'));
  // C copies the previous beat's notes onto this one, like the standard Copy Last Beat.
  function copyLastBeat(){mutate(s=>{const b=M.beatAt(s,selected,true),prev=b?.previousBeat;if(!prev||!prev.notes.length)throw Error('The previous beat has no notes.');const st=b.voice.bar.staff;for(const n of prev.notes){if(st.isStringed&&!st.isPercussion)M.setNote(s,{...selected,note:-1},{string:st.tuning.length+1-n.string,fret:n.fret});else M.setNote(s,{...selected,note:b.notes.length},{pitch:st.isPercussion?n.percussionArticulation:n.realValue});}},'Copied the last beat',true,undefined,{lightweight:true});}
  listen('double-bar-input','change',()=>mutate(s=>{s.masterBars[selected.bar].isDoubleBar=check('double-bar-input');},'Bar line updated'));
  listen('free-time-input','change',()=>mutate(s=>{s.masterBars[selected.bar].isFreeTime=check('free-time-input');},'Free time updated'));
  listen('tuplet-select','change',()=>mutate(s=>M.setTuplet(s,selected,Number(val('tuplet-select',1))),'Tuplet updated',true,undefined,{lightweight:true}));
  listen('fermata-select','change',()=>mutate(s=>M.setFermata(s,selected,val('fermata-select')||null),'Fermata updated',true,undefined,{lightweight:true}));
  techniquesReady=true;
  // Tunings: every common preset plus free entry, e.g. "D2 A2 D3 G3 B3 E4" (lowest string first).
  function buildTuningOptions(){const el=$('tuning-select');if(!el||!window.Tunings)return;const groups={};for(const p of window.Tunings.PRESETS)(groups[p.instrument]??=[]).push(p);
    el.innerHTML=Object.entries(groups).map(([g,list])=>`<optgroup label="${esc(g)}">${list.map(p=>`<option value="preset:${esc(p.id)}">${esc(p.name)} · ${esc(window.Tunings.pitchesToText(p.pitches))}</option>`).join('')}</optgroup>`).join('')+'<option value="custom">Custom…</option><option value="none">No strings (standard notation)</option>';}
  function syncTuningSelect(st){const el=$('tuning-select');if(!el)return;if(!el.querySelector('option[value^="preset:"]'))buildTuningOptions();const T=window.Tunings,preset=T&&st.isStringed?T.identify(st.tuning):null;
    el.value=!st.isStringed?'none':preset?'preset:'+preset.id:'custom';const custom=el.value==='custom';$('tuning-custom-input').hidden=!custom;if(custom&&T&&document.activeElement!==$('tuning-custom-input'))set('tuning-custom-input',st.tuning.slice().reverse().map(T.noteName).join(' '));}
  function selectedTuning(){const v=val('tuning-select'),T=window.Tunings;if(v==='none')return [];if(v.startsWith('preset:'))return T.PRESETS.find(p=>p.id===v.slice(7))?.pitches;if(v==='custom'){const parts=val('tuning-custom-input').trim().split(/[\s,]+/).filter(Boolean),pitches=parts.map(T.parsePitch);if(parts.length<1||parts.length>10||pitches.some(p=>!Number.isInteger(p)))throw Error('Enter 1–10 pitches like E2 A2 D3, lowest string first.');return pitches.reverse();}return M.tunings[v];}
  listen('tuning-select','change',()=>{$('tuning-custom-input').hidden=val('tuning-select')!=='custom';if(val('tuning-select')==='custom'&&window.Tunings)set('tuning-custom-input',selectedTrack().staves[selected.staff].tuning.slice().reverse().map(window.Tunings.noteName).join(' '));});
  // Track volume and pan automations start at the selected measure, as in desktop tab editors.
  function syncAutomations(){if(!M.trackAutomations)return;const list=M.trackAutomations(score,activeTrack).filter(a=>a.bar===selected.bar);set('auto-volume-select',list.find(a=>a.type==='volume')?.value??'');set('auto-pan-select',list.find(a=>a.type==='pan')?.value??'');}
  listen('auto-volume-select','change',()=>mutate(s=>M.setTrackAutomation(s,activeTrack,selected.bar,'volume',val('auto-volume-select')===''?null:Number(val('auto-volume-select'))),'Volume change updated'));
  listen('auto-pan-select','change',()=>mutate(s=>M.setTrackAutomation(s,activeTrack,selected.bar,'pan',val('auto-pan-select')===''?null:Number(val('auto-pan-select'))),'Pan change updated'));
  // Drum tracks get a kit pad in place of the fretboard; a hit adds or removes that piece on the selected beat.
  let drumPad=null;
  function drawDrumPad(el){if(!window.DrumPad)return false;if(!el.querySelector('.drum-pad-root')){drumPad?.destroy();el.innerHTML='<div class="drum-pad-root"></div>';
      drumPad=window.DrumPad.mount(el.firstElementChild,{isActive:midi=>!!curBeat()?.notes.some(n=>n.percussionArticulation===midi),onHit:midi=>mutate(s=>{const b=M.beatAt(s,selected,true);const hit=b.notes.find(n=>n.percussionArticulation===midi);if(hit)b.removeNote(hit);else M.setNote(s,{...selected,note:b.notes.length},{pitch:midi});},'Drum hit updated',true,undefined,{lightweight:true})});}
    drumPad?.refresh();return true;}
  // Chord diagrams come from the chord library, voiced for the current track's tuning.
  const chordShape=d=>d.frets.slice().reverse().map(f=>f<0?'x':f>9?`(${f})`:f).join('');
  function chordVoicings(){const st=selectedTrack()?.staves[selected.staff],name=val('chord-input').trim();return window.ChordLibrary&&name&&st?.isStringed&&!st.isPercussion?window.ChordLibrary.voicings(name,st.tuning):[];}
  function syncChordShapes(){const el=$('chord-shape-select');if(!el)return;const shapes=chordVoicings(),b=curBeat(),chord=b?.chord,current=chord?.showDiagram?chord.strings.join():'';
    el.innerHTML='<option value="">Name only</option>'+shapes.map((d,i)=>`<option value="${i}">${chordShape(d)}</option>`).join('');el.disabled=!shapes.length;const match=shapes.findIndex(d=>d.frets.join()===current);el.value=match>=0?String(match):'';}
  listen('chord-shape-select','change',()=>mutate(()=>{const b=curBeat(),name=val('chord-input').trim();if(!b||!name)throw Error('Type a chord name first.');const staff=b.voice.bar.staff,i=val('chord-shape-select');
    const chord=i===''?Object.assign(new at.model.Chord(),{name,showName:true,showDiagram:false}):window.ChordLibrary.toAlphaTabChord(at,name,chordVoicings()[Number(i)]);const id='chord-'+b.id+'-'+Date.now();staff.addChord(id,chord);b.chordId=id;b.isEmpty=false;},'Chord diagram updated',true,undefined,{lightweight:true}));
  listen('chord-input','input',syncChordShapes);
  // Scale overlay on the fretboard, from the theory helper.
  function applyScale(){const el=$('fretboard'),root=val('scale-root-select'),id=val('scale-type-select');const st=selectedTrack()?.staves[selected.staff];if(!el||!st)return;
    const map=root&&id&&window.Theory?window.Theory.fretboardMap(st.tuning,root,id,15):null;
    el.querySelectorAll('[data-fret]').forEach(cell=>{const hit=map?.[Number(cell.dataset.string)-1]?.find(x=>x.fret===Number(cell.dataset.fret));cell.classList.toggle('in-scale',!!hit);cell.classList.toggle('scale-root',!!hit?.isRoot);if(hit)cell.dataset.degree=hit.name;else delete cell.dataset.degree;});}
  listen('scale-root-select','change',applyScale);listen('scale-type-select','change',applyScale);
  // the standard single-key technique shortcuts drive the same inspector controls, so undo and sync stay in one place.
  function quick(id,value){const el=$(id);if(!el)return;if(el.type==='checkbox')el.checked=value;else el.value=String(value);el.dispatchEvent(new Event('change'));}
  const quickKeys={c:()=>copyLastBeat(),'%':()=>quick('simile-select',Number(val('simile-select',0))===1?0:1),o:()=>quick('effect-ghost',!check('effect-ghost')),b:()=>{if(Number(val('bend-input',0))){quick('bend-input',0);}else{set('bend-style-select',2);quick('bend-input',4);}},f:()=>quick('fermata-select',val('fermata-select')?'':'medium'),g:()=>addGrace('before'),'/':()=>quick('tuplet-select',Number(val('tuplet-select',1))===3?1:3),n:()=>quick('trill-input',val('trill-input')===''?Math.min(36,(selectedNote()?.fret??0)+2):''),':':()=>quick('accent-select',Number(val('accent-select',0))===2?0:2),'<':()=>quick('fade-select',Number(val('fade-select',0))===1?0:1),'>':()=>quick('fade-select',Number(val('fade-select',0))===2?0:2),'(':()=>quick('effect-lh-tap',!check('effect-lh-tap')),')':()=>quick('percussive-select',val('percussive-select')==='tap'?'':'tap'),'$':()=>quick('percussive-select',val('percussive-select')==='slap'?'':'slap'),'"':()=>quick('tremolo-select',Number(val('tremolo-select',0))===32?0:32),D:()=>quick('pickstroke-select',Number(val('pickstroke-select',0))===2?0:2),U:()=>quick('pickstroke-select',Number(val('pickstroke-select',0))===1?0:1),W:()=>quick('vibrato-select',Number(val('vibrato-select',0))===2?0:2)};
  // Lyrics editor: Classic syllable text for the whole track, one syllable per note.
  function loadLyricsText(){set('lyrics-text',window.LyricsTool.readLyrics(score,activeTrack,Math.max(0,Number(val('lyrics-start',1))-1),Number(val('lyrics-line',0))));}
  listen('btn-lyrics','click',()=>{if(!score||!window.LyricsTool)return;set('lyrics-start',1);loadLyricsText();$('lyrics-dialog').showModal();$('lyrics-text').focus();});
  listen('lyrics-line','change',loadLyricsText);listen('lyrics-start','change',loadLyricsText);
  listen('lyrics-apply','click',()=>{let result;mutate(s=>{result=window.LyricsTool.assignLyrics(s,activeTrack,Math.max(0,Number(val('lyrics-start',1))-1),val('lyrics-text'),Number(val('lyrics-line',0)));},'Lyrics updated');$('lyrics-dialog').close();if(result?.leftover)toast(`${result.leftover} syllables did not fit on the notes`,true);});
  listen('btn-ascii','click',()=>{if(!score||!window.AsciiTab)return;try{download(window.AsciiTab.exportAscii(score,{tracks:[activeTrack]}),`${score.title||'Untitled'}.txt`,'text/plain');toast('ASCII tab downloaded');}catch(e){toast(e.message,true);}});
  // Command palette (Ctrl/⌘+E): every action searchable by name, like desktop tab editors.
  const press=id=>()=>$(id)?.click(), editing=()=>!isViewer&&!!score;
  const askNumber=(placeholder,min,max)=>({placeholder,parse:t=>{const n=Number(t);if(!Number.isFinite(n)||n<min||n>max)throw Error(`Enter a number from ${min} to ${max}.`);return n;}});
  const askText=placeholder=>({placeholder,parse:t=>t.trim()});
  function applyMeasure(fn){fn();$('btn-apply-bar').click();}
  function buildCommands(){
    const c=[],add=(group,title,run,extra={})=>c.push({id:group+':'+title,group,title,run:v=>{try{run(v);}catch(e){toast(e.message,true);}},enabled:editing,...extra});
    add('Playback','Play / pause',press('btn-play'),{shortcut:'Space',enabled:()=>!!score});add('Playback','Stop',press('btn-stop'),{enabled:()=>!!score});add('Playback','Toggle loop',()=>loop(),{shortcut:'F9',enabled:()=>!!score});
    add('Playback','Metronome',press('btn-metronome'),{enabled:()=>!!score});add('Playback','Count-in',press('btn-count-in'),{enabled:()=>!!score});
    add('Edit','Undo',()=>history(true),{shortcut:'Ctrl+Z'});add('Edit','Redo',()=>history(false),{shortcut:'Ctrl+Y'});
    add('Edit','Copy measures',press('btn-copy-bar'),{shortcut:'Ctrl+C'});add('Edit','Paste measures',press('btn-paste-bar'),{shortcut:'Ctrl+V'});add('Edit','Paste several times',()=>pasteRepeated(),{shortcut:'Ctrl+Shift+V'});
    add('Edit','Select all measures',()=>{barRange={anchor:0,end:score.masterBars.length-1};showRange();},{shortcut:'Ctrl+A'});
    add('Edit','Transpose up a semitone',()=>transposeRange(1),{shortcut:'Alt+Shift+Up',keywords:['pitch']});add('Edit','Transpose down a semitone',()=>transposeRange(-1),{shortcut:'Alt+Shift+Down',keywords:['pitch']});
    add('Edit','Transpose by…',v=>transposeRange(v),{input:askNumber('Semitones, e.g. -2 or 5',-12,12),keywords:['key change']});
    add('Edit','Rest',press('btn-rest'),{shortcut:'R'});add('Edit','Split beat',press('btn-insert-beat'));add('Edit','Delete note',press('btn-delete-note'),{shortcut:'Backspace'});
    add('Measure','Insert measure before cursor',press('btn-insert-bar'),{shortcut:'Ins',keywords:['bar','add']});add('Measure','Add measure at end',press('btn-add-bar'),{keywords:['bar']});
    add('Measure','Delete measure',()=>mutate(s=>M.removeBar(s,selected.bar),'Bar deleted'),{shortcut:'Ctrl+Del',keywords:['bar','remove']});
    add('Measure','Time signature…',v=>applyMeasure(()=>{set('bar-numerator',v[0]);set('bar-denominator',v[1]);}),{input:{placeholder:'e.g. 3/4 or 6/8',parse:t=>{const m=t.trim().match(/^(\d{1,2})\s*\/\s*(1|2|4|8|16|32)$/);if(!m)throw Error('Use a time signature like 3/4.');return [Number(m[1]),Number(m[2])];}},keywords:['meter','bar']});
    add('Measure','Tempo…',v=>applyMeasure(()=>set('bar-tempo',v)),{input:askNumber('BPM at this measure',20,400),keywords:['bpm','speed']});
    add('Measure','Section…',v=>applyMeasure(()=>set('section-input',v)),{input:askText('e.g. Chorus (blank removes)'),keywords:['marker','rehearsal']});
    add('Measure','Key signature…',v=>applyMeasure(()=>set('key-select',v)),{input:{placeholder:'e.g. G major, D minor or -2',parse:t=>{t=t.trim();if(/^-?\d$/.test(t)&&Math.abs(Number(t))<=7)return Number(t);const m=t.match(/^([A-Ga-g][#b]?)\s*(major|minor|maj|min|m)?$/i);if(!m||!window.Theory)throw Error('Use a key like G major or D minor.');return window.Theory.keySignatureFor(m[1][0].toUpperCase()+m[1].slice(1),/^m(in(or)?)?$/i.test(m[2]||'')?'minor':'major');}}});
    add('Measure','Repeat open',()=>applyMeasure(()=>{$('repeat-start').checked=!$('repeat-start').checked;}),{shortcut:'['});
    add('Measure','Repeat close…',v=>applyMeasure(()=>set('repeat-count',v)),{input:askNumber('Times played, e.g. 2 (0 removes)',0,20),shortcut:']'});
    add('Measure','Alternate endings…',v=>applyMeasure(()=>set('alternate-endings',v)),{input:askText('e.g. 1, 2')});
    for(const [v,t] of [[0,'No triplet feel'],[2,'Triplet feel 8th'],[1,'Triplet feel 16th'],[4,'Dotted 8th feel'],[3,'Dotted 16th feel']])add('Measure',t,()=>quick('triplet-feel-select',v),{keywords:['swing','shuffle']});
    for(const [v,t] of [['TargetSegno','Segno'],['TargetSegnoSegno','Segno segno'],['TargetCoda','Coda'],['TargetDoubleCoda','Double coda'],['TargetFine','Fine']])add('Measure',t,()=>quick('direction-target-select',v),{keywords:['direction','sign']});
    for(const [v,t] of [['JumpDaCapo','Da Capo (D.C.)'],['JumpDaCapoAlCoda','D.C. al Coda'],['JumpDaCapoAlFine','D.C. al Fine'],['JumpDalSegno','Dal Segno (D.S.)'],['JumpDalSegnoAlCoda','D.S. al Coda'],['JumpDalSegnoAlFine','D.S. al Fine'],['JumpDaCoda','To Coda']])add('Measure',t,()=>quick('direction-jump-select',v),{keywords:['direction','jump']});
    add('Measure','Double bar line',()=>quick('double-bar-input',!check('double-bar-input')));add('Measure','Free time',()=>quick('free-time-input',!check('free-time-input')));
    for(const d of [[1,'Whole note'],[2,'Half note'],[4,'Quarter note'],[8,'Eighth note'],[16,'Sixteenth note'],[32,'Thirty-second note'],[64,'Sixty-fourth note']])add('Duration',d[1],()=>document.querySelector(`[data-duration="${d[0]}"]`)?.click(),{keywords:['length']});
    add('Duration','Dotted',press('btn-dotted'),{shortcut:'.'});add('Duration','Double dotted',()=>{const b=curBeat();if(b)mutate(()=>M.setDuration(curBeat(),curBeat().duration,b.dots===2?0:2),'Double dotted',true,undefined,{lightweight:true});},{shortcut:'Ctrl+.'});
    for(const [n,t] of [[3,'Triplet'],[5,'Quintuplet'],[6,'Sextuplet'],[7,'Septuplet'],[9,'Nonuplet'],[1,'Remove tuplet']])add('Duration',t,()=>quick('tuplet-select',n),{keywords:['tuplet'],shortcut:n===3?'/':undefined});
    const fx=(title,key,shortcut)=>add('Technique',title,()=>document.querySelector(`[data-effect="${key}"]`)?.click(),{shortcut});
    fx('Palm mute','isPalmMute','P');fx('Let ring','isLetRing','L');fx('Hammer-on / pull-off','isHammerPullOrigin','H');fx('Vibrato','vibrato','V');fx('Staccato','isStaccato','S');fx('Accent','accentuated','A');fx('Dead note','isDead','X');
    const q=(title,id,value,shortcut,keywords)=>add('Technique',title,()=>quick(id,typeof value==='function'?value():value),{shortcut,keywords});
    q('Wide vibrato','vibrato-select',()=>Number(val('vibrato-select',0))===2?0:2,'Shift+W');q('Heavy accent','accent-select',()=>Number(val('accent-select',0))===2?0:2,':');q('Tenuto','accent-select',()=>Number(val('accent-select',0))===3?0:3);
    q('Ghost note','effect-ghost',()=>!check('effect-ghost'),'O');q('Left-hand tapping','effect-lh-tap',()=>!check('effect-lh-tap'),'(');
    add('Technique','Bend…',v=>{set('bend-style-select',v[0]);quick('bend-input',v[1]);},{input:{placeholder:'full, half, release, prebend, bend release…',parse:t=>{t=t.toLowerCase();const amount=/quarter|¼/.test(t)?1:/half|½/.test(t)?2:/1\.5|one and/.test(t)?6:/two|2 step/.test(t)?8:4;const style=/prebend.*release/.test(t)?8:/prebend.*bend/.test(t)?7:/prebend/.test(t)?6:/bend.*release/.test(t)?4:/release/.test(t)?3:2;return [style,amount];}},shortcut:'B'});
    q('Remove bend','bend-input',0);q('Trill','trill-input',()=>val('trill-input')===''?Math.min(36,(selectedNote()?.fret??0)+2):'','N');
    add('Technique','Grace note before beat',()=>addGrace('before'),{shortcut:'G'});add('Technique','Grace note on beat',()=>addGrace('on'));
    q('Fermata','fermata-select',()=>val('fermata-select')?'':'medium','F');q('Tremolo picking','tremolo-select',()=>Number(val('tremolo-select',0))?0:32,'"');
    q('Pick stroke down','pickstroke-select',2,'Shift+D');q('Pick stroke up','pickstroke-select',1,'Shift+U');
    q('Brush down','brush-select',2,null,['strum']);q('Brush up','brush-select',1,null,['strum']);q('Arpeggio down','brush-select',4);q('Arpeggio up','brush-select',3);
    q('Tap','percussive-select','tap',')');q('Slap','percussive-select','slap','$');q('Pop','percussive-select','pop');
    q('Fade in','fade-select',1,'<');q('Fade out','fade-select',2,'>');q('Volume swell','fade-select',3);q('Crescendo','crescendo-select',1,null,['hairpin']);q('Decrescendo','crescendo-select',2,null,['hairpin','diminuendo']);
    for(const [v,t] of [[1,'Natural harmonic'],[2,'Artificial harmonic'],[3,'Pinch harmonic'],[4,'Tapped harmonic'],[5,'Semi harmonic'],[0,'Remove harmonic']])q(t,'harmonic-select',v);
    for(const [v,t] of [[1,'Shift slide'],[2,'Legato slide'],[3,'Slide out upwards'],[4,'Slide out downwards']])q(t,'slide-select',v);
    for(const [v,t] of [[1,'Slide in from below'],[2,'Slide in from above']])q(t,'slide-in-select',v);
    for(const [v,t] of [[1,'Whammy dive'],[2,'Whammy dip']])q(t,'whammy-select',v===1?'dive2':'dip');
    for(const [v,t] of [[1,'8va'],[0,'15ma'],[3,'8vb'],[4,'15mb'],[2,'Normal octave']])q(t,'ottava-select',v,null,['ottava']);
    ['ppp','pp','p','mp','mf','f','ff','fff'].forEach((d,i)=>q(`Dynamic ${d}`,'dynamics-select',i,null,['dynamics','volume']));
    add('Measure','Tempo ramp over selection…',v=>{const [a,b]=rangeBounds();if(a===b)throw Error('Select at least two measures first (Shift+→).');mutate(s=>M.setTempoRamp(s,a,b,v[0],v[1]),`Tempo ramp ${v[0]}→${v[1]} BPM`);},{input:{placeholder:'e.g. 80 to 120',parse:t=>{const m=t.match(/(\d{2,3})\D+(\d{2,3})/);if(!m)throw Error('Use two tempos, like 80 to 120.');const v=[Number(m[1]),Number(m[2])];if(v.some(x=>x<20||x>400))throw Error('Tempos must be 20–400 BPM.');return v;}},keywords:['accelerando','ritardando','speed up','slow down']});
    add('Track','Instrument change here…',v=>mutate(s=>M.setTrackAutomation(s,activeTrack,selected.bar,'instrument',v),'Instrument change added'),{input:{placeholder:'Instrument name or GM number, e.g. distortion',parse:t=>{t=t.trim().toLowerCase();if(/^\d+$/.test(t)&&Number(t)<128)return Number(t);const hit=Object.entries(instruments).find(([,n])=>n.toLowerCase().includes(t));if(!hit)throw Error('No General MIDI instrument with that name.');return Number(hit[0]);}},keywords:['program','sound']});
    add('Track','Volume from this measure…',v=>quick('auto-volume-select',Math.round(v/100*16)),{input:askNumber('Percent, 0–100',0,100)});
    add('Track','Pan from this measure…',v=>quick('auto-pan-select',Math.round(8+v/100*8)),{input:askNumber('-100 left to 100 right',-100,100)});
    add('Track','Custom tuning…',v=>{set('tuning-select','custom');$('tuning-custom-input').hidden=false;set('tuning-custom-input',v);$('btn-apply-track').click();},{input:askText('Lowest string first, e.g. D2 A2 D3 G3 B3 E4')});
    add('Edit','Copy last beat',()=>copyLastBeat(),{shortcut:'C',keywords:['duplicate']});
    q('Repeat previous bar','simile-select',1,'%',['simile']);q('Repeat two bars','simile-select',2,null,['simile']);
    q('Golpe thumb','golpe-select',1);q('Golpe finger','golpe-select',2);q('Wah open','wah-select',1);q('Wah closed','wah-select',2);q('Slash notation','slash-input',()=>!check('slash-input'),null,['rhythm']);
    add('Technique','Rasgueado…',v=>quick('rasgueado-select',v),{input:{placeholder:'e.g. ami, pmp triplet, peami',parse:t=>{const o=[...$('rasgueado-select').options].find(o=>o.textContent.toLowerCase()===t.trim().toLowerCase());if(!o)throw Error('Pick a pattern like ami or pmp triplet.');return o.value;}}});
    for(const [v,t] of [[4,'Treble clef'],[3,'Bass clef'],[2,'Tenor clef'],[1,'Alto clef']])q(t,'clef-select',v);
    add('Text','Chord…',v=>{set('chord-input',v);$('chord-input').dispatchEvent(new Event('change'));},{input:askText('e.g. Am7 or D/F#'),shortcut:'A'});
    add('Text','Beat text…',v=>{set('text-input',v);$('text-input').dispatchEvent(new Event('change'));},{input:askText('Text above this beat'),shortcut:'T'});
    add('Text','Edit lyrics',press('btn-lyrics'));
    add('Navigate','Go to measure…',v=>{clearRange();seekBar(v-1);},{input:askNumber('Measure number',1,9999),enabled:()=>!!score});
    add('Navigate','Go to section…',v=>{const i=score.masterBars.findIndex(mb=>mb.section?.text?.toLowerCase().includes(v.toLowerCase()));if(i<0)throw Error('No section with that name.');seekBar(i);},{input:askText('Section name'),enabled:()=>!!score});
    add('Navigate','First measure',()=>seekBar(0),{shortcut:'Ctrl+Home',enabled:()=>!!score});add('Navigate','Last measure',()=>seekBar(score.masterBars.length-1),{shortcut:'Ctrl+End',enabled:()=>!!score});
    add('Navigate','Next track',()=>moveTrack(1),{shortcut:'Ctrl+Down',enabled:()=>!!score});add('Navigate','Previous track',()=>moveTrack(-1),{shortcut:'Ctrl+Up',enabled:()=>!!score});
    add('Tools','Detect scale of selection',()=>{const [a,b]=rangeBounds(),st=selectedTrack().staves[selected.staff],pcs=new Set();for(let i=a;i<=b;i++)for(const v of st.bars[i].voices)for(const beat of v.beats)for(const n of beat.notes)pcs.add(n.realValue%12);const best=window.Theory?.detectScale([...pcs])?.[0];if(!best)throw Error('Add some notes first.');toast(`Sounds like ${best.root} ${window.Theory.SCALES[best.scaleId].name}`);},{keywords:['key','analyze']});
    add('Tools','Show scale on fretboard…',v=>{if(!$('fretboard-panel')||$('fretboard-panel').hidden)$('btn-fretboard')?.click();set('scale-root-select',v[0]);set('scale-type-select',v[1]);applyScale();},{input:{placeholder:'e.g. A minor pentatonic',parse:t=>{const m=t.trim().match(/^([A-Ga-g][#b]?)\s+(.+)$/);const ids=window.Theory?Object.entries(window.Theory.SCALES):[];const found=m&&ids.find(([,sc])=>sc.name.toLowerCase()===m[2].toLowerCase())||m&&ids.find(([,sc])=>sc.name.toLowerCase().includes(m[2].toLowerCase()));if(!found)throw Error('Try a root and scale, like E blues.');const roots=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'],alias={Db:'C#','D#':'Eb',Gb:'F#','G#':'Ab','A#':'Bb'};let r=m[1][0].toUpperCase()+m[1].slice(1);r=alias[r]||r;if(!roots.includes(r))throw Error('Unknown root note.');return [r,found[0]];}},enabled:()=>!!score});
    add('File','New song',press('btn-new'),{enabled:()=>!isViewer});add('File','Open file',press('btn-open'),{shortcut:'Ctrl+O',enabled:()=>!isViewer});
    add('File','Save to cloud',()=>cloudSaveAction(),{shortcut:'Ctrl+S'});add('File','Save to device (.gp)',press('btn-save'));
    add('File','Export MIDI',press('btn-midi'),{enabled:()=>!!score});add('File','Export WAV audio',press('btn-wav'),{enabled:()=>!!score});add('File','Export ASCII tab',press('btn-ascii'),{enabled:()=>!!score});add('File','Print / PDF',press('btn-print'),{enabled:()=>!!score});
    add('View','Toggle notation tools',()=>togglePanel('palette'),{shortcut:'F2',enabled:()=>true});add('View','Toggle inspector',()=>togglePanel('inspector'),{shortcut:'F5',enabled:()=>true});add('View','Toggle track mixer',()=>togglePanel('mixer'),{shortcut:'F8',enabled:()=>true});
    add('View','Fretboard',press('btn-fretboard'),{enabled:()=>true});add('View','Keyboard shortcuts',()=>$('shortcuts-dialog')?.showModal(),{shortcut:'?',enabled:()=>true});
    for(const [v,t] of [['Page','Page layout'],['Horizontal','Horizontal layout']])add('View',t,()=>{set('layout-select',v);$('layout-select').dispatchEvent(new Event('change'));},{enabled:()=>!!score});
    return c;
  }
  let palette=null;
  function openPalette(){if(!window.CommandPalette)return;palette??=window.CommandPalette.create({commands:buildCommands(),onRun:()=>{}});palette.setCommands(buildCommands());palette.open();}
  function addGrace(type){mutate(s=>{const beat=M.addGraceNote(s,{...selected,note:selectedNote()?.index??0},type);selected.beat=beat.index;selected.note=0;},'Grace note added',true,undefined,{lightweight:true});}
  listen('btn-grace-before','click',()=>addGrace('before'));listen('btn-grace-on','click',()=>addGrace('on'));
  listen('duration-select','change',()=>mutate(()=>M.setDuration(curBeat(),Number(val('duration-select'))),'Duration updated',true,undefined,{lightweight:true}));
  listen('dotted-input','change',()=>mutate(()=>M.setDuration(curBeat(),curBeat().duration,check('dotted-input')?1:0),'Dotted duration updated',true,undefined,{lightweight:true}));
  listen('btn-rest','click',()=>mutate(()=>{const b=curBeat();if(!b)return;b.notes=[];b.noteStringLookup.clear();b.noteValueLookup.clear();b.isEmpty=false;},'Beat changed to rest',true,undefined,{lightweight:true}));
  listen('btn-delete-note','click',()=>mutate(()=>{const b=curBeat(),n=selectedNote();if(n)b.removeNote(n);},'Note removed',true,undefined,{lightweight:true}));
  listen('btn-insert-beat','click',()=>mutate(s=>M.insertBeat(s,selected),'Beat split; a rest was inserted after it',true,undefined,{lightweight:true}));
  listen('btn-delete-beat','click',()=>mutate(s=>M.deleteBeat(s,selected),'Beat cleared; timing preserved',true,undefined,{lightweight:true}));
  listen('voice-select','change',()=>{clearDigitEntry();cancelEditRefresh();selected.voice=Number(val('voice-select',0));selected.beat=0;selected.note=0;if(!curBeat())mutate(()=>M.beatAt(score,selected,true),'Voice created',true,undefined,{lightweight:true});else syncInspector();if(check('editor-mode'))$('alphatab').focus({preventScroll:true});});
  function applyBarSettings(s) {
    const mb=s.masterBars[selected.bar],tempoText=val('bar-tempo').trim(),endingText=val('alternate-endings').trim();
    const tempo=tempoText?Number(tempoText):null, endings=endingText?endingText.split(',').map(n=>n.trim()):[], repeatCount=Number(val('repeat-count',0));
    if(!Number.isInteger(repeatCount)||repeatCount<0||repeatCount>20)throw Error('Repeat plays must be a whole number from 0 to 20.');
    if(tempo!==null&&(!Number.isFinite(tempo)||tempo<20||tempo>400))throw Error('Tempo must be between 20 and 400 BPM.');
    if(endings.some(n=>!/^[1-8]$/.test(n)))throw Error('Enter ending passes from 1 to 8, separated by commas.');
    M.setTimeSignature(s,selected.bar,Number(val('bar-numerator',4)),Number(val('bar-denominator',4)));
    mb.isRepeatStart=check('repeat-start');mb.repeatCount=repeatCount;
    mb.alternateEndings=endings.reduce((mask,n)=>mask|(1<<(Number(n)-1)),0);
    const opening=mb.tempoAutomations.find(a=>a.ratioPosition===0);
    if(tempo===null){if(opening)mb.tempoAutomations.splice(mb.tempoAutomations.indexOf(opening),1);}
    else if(opening)opening.value=tempo;
    else mb.tempoAutomations.unshift(at.model.Automation.buildTempoAutomation(false,0,tempo,2));
    if(val('section-input')){mb.section=new at.model.Section();mb.section.text=val('section-input');mb.section.marker='';}else mb.section=null;
    for(const t of s.tracks)for(const st of t.staves)st.bars[selected.bar].keySignature=Number(val('key-select',0));
    s.rebuildRepeatGroups();
  }
  listen('btn-apply-bar','click',()=>mutate(applyBarSettings,'Bar settings applied'));
  // Measure range: Shift+arrows or Shift+click extends it; copy, paste and transpose act on the whole range.
  let barRange=null;
  const rangeBounds=()=>barRange?[Math.min(barRange.anchor,barRange.end),Math.max(barRange.anchor,barRange.end)]:[selected.bar,selected.bar];
  function extendRange(bar){if(!score)return;bar=clamp(bar,0,score.masterBars.length-1);barRange={anchor:barRange?.anchor??selected.bar,end:bar};seekBar(bar);showRange();}
  function clearRange(){if(barRange){barRange=null;showRange();}}
  function showRange(){const [a,b]=rangeBounds();document.querySelectorAll('.timeline-bar').forEach((el,i)=>el.classList.toggle('in-range',!!barRange&&i>=a&&i<=b));if(barRange)txt('selection-summary',`Bars ${a+1}–${b+1} selected`);drawRangeOverlay();}
  // The measure range is drawn over the score itself, one rectangle per selected bar on every system.
  function drawRangeOverlay(){const host=$('alphatab');if(!host)return;host.querySelectorAll('.range-mark').forEach(n=>n.remove());if(!barRange)return;
    const [a,b]=rangeBounds(),surface=host.querySelector('.at-surface'),lookup=api.renderer?.boundsLookup;if(!surface||!lookup)return;
    const ox=surface.offsetLeft,oy=surface.offsetTop,frag=document.createDocumentFragment();
    for(const system of lookup.staffSystems)for(const mb of system.bars){if(mb.index<a||mb.index>b)continue;const r=mb.realBounds,mark=document.createElement('div');mark.className='range-mark';mark.style.cssText=`left:${ox+r.x}px;top:${oy+r.y}px;width:${r.w}px;height:${r.h}px`;frag.appendChild(mark);}
    host.appendChild(frag);}
  // Click-drag across the score selects whole measures; Shift+click extends the selection.
  let dragAnchor=null;
  function barAtPointer(e){const surface=$('alphatab')?.querySelector('.at-surface'),lookup=api.renderer?.boundsLookup;if(!surface||!lookup)return null;const r=surface.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    for(const system of lookup.staffSystems)for(const mb of system.bars){const b=mb.realBounds;if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h)return mb.index;}return null;}
  $('alphatab')?.addEventListener('pointerdown',e=>{if(e.button!==0||isViewer)return;const bar=barAtPointer(e);if(bar===null)return;if(e.shiftKey){e.preventDefault();e.stopImmediatePropagation();extendRange(bar);return;}dragAnchor={bar,x:e.clientX,y:e.clientY,moved:false};},true);
  window.addEventListener('pointermove',e=>{if(!dragAnchor||!(e.buttons&1))return;if(!dragAnchor.moved&&Math.hypot(e.clientX-dragAnchor.x,e.clientY-dragAnchor.y)<6)return;dragAnchor.moved=true;const bar=barAtPointer(e);if(bar===null)return;if(!barRange||barRange.anchor!==dragAnchor.bar||barRange.end!==bar){barRange={anchor:dragAnchor.bar,end:bar};showRange();}});
  window.addEventListener('pointerup',()=>{if(dragAnchor&&!dragAnchor.moved&&barRange&&!document.querySelector('.range-mark:hover'))clearRange();dragAnchor=null;});
  listen('btn-copy-bar','click',()=>{if(!score)return;const [a,b]=rangeBounds();clipboard=M.copyBars(score,activeTrack,selected.staff,a,b);toast(a===b?`Copied bar ${a+1} of ${selectedTrack().name}`:`Copied bars ${a+1}–${b+1} of ${selectedTrack().name}`);});
  listen('btn-paste-bar','click',()=>{if(!clipboard){toast('Copy a bar first.');return;}const count=clipboard.endBar-clipboard.startBar+1;mutate(s=>M.pasteBars(s,clipboard,{track:activeTrack,staff:selected.staff,bar:selected.bar}),count>1?`${count} bars pasted`:'Bar pasted',true,undefined,{lightweight:count===1&&selected.bar<score.masterBars.length});});
  function pasteRepeated(){if(!clipboard){toast('Copy a bar first.');return;}const times=Number(prompt('Paste how many times?','2'));if(!Number.isInteger(times)||times<1||times>64)return;const size=clipboard.endBar-clipboard.startBar+1;mutate(s=>{for(let i=0;i<times;i++)M.pasteBars(s,clipboard,{track:activeTrack,staff:selected.staff,bar:selected.bar+i*size});},`Pasted ${times}×`);}
  function transposeRange(semitones){const [a,b]=rangeBounds();mutate(s=>M.transposeNotes(s,activeTrack,selected.staff,a,b,semitones),`Transposed ${semitones>0?'up':'down'} a semitone`,true,undefined,{lightweight:true});}
  listen('track-list','click',e=>{const row=e.target.closest('[data-track]');if(!row)return;const i=Number(row.dataset.track),t=score.tracks[i];
    const cell=e.target.closest('[data-measure]');if(cell){activeTrack=i;selected={track:i,staff:0,bar:Number(cell.dataset.measure),voice:0,beat:0,note:0};displayed=new Set([i]);pendingBarSeek=selected.bar;renderScore();return;}
    if(e.target.closest('.track-name-btn')){activeTrack=i;selected={track:i,staff:0,bar:selected.bar,voice:0,beat:0,note:0};displayed=new Set([i]);renderScore();}
    const mix=e.target.closest('[data-mix]');if(mix){const key=mix.dataset.mix==='mute'?'isMute':'isSolo',before=M.snapshot(score);t.playbackInfo[key]=!t.playbackInfo[key];if(key==='isMute'){api.changeTrackMute([t],t.playbackInfo[key]);if(hifi)hifi.setTrackMute(t,t.playbackInfo[key]);}else{api.changeTrackSolo([t],t.playbackInfo[key]);if(hifi)hifi.setTrackSolo(t,t.playbackInfo[key]);}if(isViewer){applyPracticeMix();balanceSoloLevels();}undo.push({json:before,selected:{...selected},currentString});redo=[];markDirty();renderMixer();}
  });
  listen('track-list','change',e=>{const row=e.target.closest('[data-track]');if(!row)return;const i=Number(row.dataset.track),t=score.tracks[i];
    if(e.target.matches('.track-visible')){if(e.target.checked)displayed.add(i);else displayed.delete(i);if(!displayed.size)displayed.add(activeTrack);renderScore();}
    if(e.target.matches('.mix-volume')){if(isViewer){practiceVolumes.set(i,clamp(e.target.value,0,200)/100);const volume=trackPlaybackVolume(t);api.changeTrackVolume([t],volume);if(hifi)hifi.setTrackVolume(t,volume);return;}const before=M.snapshot(score);t.playbackInfo.volume=Number(e.target.value);api.changeTrackVolume([t],t.playbackInfo.volume/16);if(hifi)hifi.setTrackVolume(t,t.playbackInfo.volume/16);undo.push({json:before,selected:{...selected},currentString});redo=[];markDirty();syncInspector();}
  });
  listen('track-list','input',e=>{const row=e.target.closest('[data-track]');if(!row||!e.target.matches('.mix-volume'))return;const i=Number(row.dataset.track),value=clamp(e.target.value,0,isViewer?200:16);if(isViewer){practiceVolumes.set(i,value/100);const label=Math.round(value)+'%';e.target.setAttribute('aria-valuetext',Math.round(value)+' percent of original level');if(e.target.nextElementSibling)e.target.nextElementSibling.textContent=label;}const volume=isViewer?trackPlaybackVolume(score.tracks[i]):value/16;api.changeTrackVolume([score.tracks[i]],volume);if(api.hifi)api.hifi.setTrackVolume(score.tracks[i],volume);});
  listen('timeline','click',e=>{const button=e.target.closest('[data-bar]');if(!button)return;if(e.shiftKey)extendRange(Number(button.dataset.bar));else{clearRange();seekBar(Number(button.dataset.bar));}});
  document.addEventListener('click',e=>{const tab=e.target.closest('[data-inspector]');if(tab)showInspector(tab.dataset.inspector);
    const dur=e.target.closest('[data-duration]');if(dur){if(!curBeat())return;set('duration-select',dur.dataset.duration);mutate(()=>M.setDuration(curBeat(),Number(dur.dataset.duration)),'Duration updated',true,undefined,{lightweight:true});}
    const fx=e.target.closest('[data-effect]');if(fx)mutate(()=>{const n=selectedNote();if(!n)throw Error('Select a note first.');const key=fx.dataset.effect,flag=key==='vibrato'||key==='accentuated',on=flag?!n[key]:!n[key];
      // Marks like palm mute belong to the whole beat (or the selected bars), so every note moves together and nothing is left behind.
      const targets=[];
      if(typeof barRange!=='undefined'&&barRange){const [a,b]=rangeBounds(),staff=score.tracks[activeTrack]?.staves[selected.staff];for(let i=a;i<=b;i++)for(const voice of staff?.bars[i]?.voices||[])for(const beat of voice.beats)targets.push(...beat.notes);}
      else targets.push(...(curBeat()?.notes||[n]));
      for(const t of targets)t[key]=flag?(on?1:0):on;},'Articulation updated',true,undefined,{lightweight:true});
  });
  listen('btn-shortcuts','click',()=>$('shortcuts-dialog')?.showModal());
  listen('btn-fullscreen','click',()=>{if(document.fullscreenElement)document.exitFullscreen();else document.documentElement.requestFullscreen().catch(()=>toast('Fullscreen is unavailable in this browser.'));});
  listen('btn-fretboard','click',()=>{const p=$('fretboard-panel');if(p){p.hidden=!p.hidden;activate('btn-fretboard',!p.hidden);drawFretboard();}});
  listen('btn-dotted','click',()=>{if(curBeat())mutate(()=>M.setDuration(curBeat(),curBeat().duration,curBeat().dots?0:1),'Dotted duration updated',true,undefined,{lightweight:true});});
  function togglePanel(name){
    if(isViewer&&name!=='mixer')return;
    document.body.classList.remove('focus-score');activate('btn-focus',false);
    if(name==='palette'&&innerWidth<=760){document.body.classList.toggle('show-palette');document.body.classList.remove('show-inspector');}
    else if(name==='inspector'&&innerWidth<=1020){document.body.classList.toggle('show-inspector');document.body.classList.remove('show-palette');}
    else document.body.classList.toggle('hide-'+name);
    updatePanelButtons();
  }
  function updatePanelButtons(){
    activate('btn-toggle-palette',innerWidth<=760?document.body.classList.contains('show-palette'):!document.body.classList.contains('hide-palette'));
    activate('btn-toggle-inspector',innerWidth<=1020?document.body.classList.contains('show-inspector'):!document.body.classList.contains('hide-inspector'));
    activate('btn-toggle-mixer',!document.body.classList.contains('hide-mixer'));
  }
  listen('btn-toggle-palette','click',()=>togglePanel('palette'));
  listen('btn-toggle-inspector','click',()=>togglePanel('inspector'));
  listen('btn-toggle-mixer','click',()=>togglePanel('mixer'));
  listen('btn-focus','click',()=>{const focused=document.body.classList.toggle('focus-score');activate('btn-focus',focused);});
  listen('active-track-select','change',()=>{if(!score)return;clearDigitEntry();activeTrack=Number(val('active-track-select'));selected={track:activeTrack,staff:0,bar:selected.bar,voice:0,beat:0,note:0};displayed=new Set([activeTrack]);renderScore();});
  listen('alphatab','dblclick',()=>{if(!check('editor-mode'))return;showInspector('note');document.body.classList.remove('hide-inspector','focus-score');if(innerWidth<=1020)document.body.classList.add('show-inspector');updatePanelButtons();});
  document.addEventListener('click',e=>{if(!e.target.closest('.export-menu'))document.querySelector('.export-menu')?.removeAttribute('open');else if(e.target.closest('.menu-item'))document.querySelector('.export-menu')?.removeAttribute('open');});
  let resizeTimer, lastViewportWidth=0;
  new ResizeObserver(()=>{
    const width=$('score-scroll').clientWidth;if(Math.abs(width-lastViewportWidth)<3)return;lastViewportWidth=width;
    clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(score&&configureViewport()){cancelEditRefresh();api.render();}},120);
  }).observe($('score-scroll'));
  const dockResizer=$('dock-resizer');
  function setDockHeight(height){document.documentElement.style.setProperty('--dock-height',Math.round(Math.max(72,Math.min(innerHeight*.45,height)))+'px');}
  dockResizer?.addEventListener('pointerdown',e=>{e.preventDefault();dockResizer.setPointerCapture(e.pointerId);const startY=e.clientY,startHeight=document.querySelector('.track-dock').getBoundingClientRect().height;
    const move=event=>setDockHeight(startHeight+startY-event.clientY);
    const end=()=>{dockResizer.removeEventListener('pointermove',move);dockResizer.removeEventListener('pointerup',end);dockResizer.removeEventListener('pointercancel',end);};
    dockResizer.addEventListener('pointermove',move);dockResizer.addEventListener('pointerup',end);dockResizer.addEventListener('pointercancel',end);
  });
  dockResizer?.addEventListener('keydown',e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();e.stopPropagation();setDockHeight(document.querySelector('.track-dock').getBoundingClientRect().height+(e.key==='ArrowUp'?16:-16));}});
  updatePanelButtons();
  function drawFretboard(){drawFretboardCells();const st=score&&selectedTrack()?.staves[selected.staff],picker=document.querySelector('.scale-picker');if(picker)picker.hidden=!st||st.isPercussion||!st.isStringed;if(typeof applyScale==='function')applyScale();}
  function drawFretboardCells(){const el=$('fretboard');if(!el||!score)return;const st=selectedTrack().staves[selected.staff],b=curBeat();
    if(st.isPercussion&&typeof drawDrumPad==='function'&&drawDrumPad(el))return;
    if(!st.isStringed||st.isPercussion){drumPad?.destroy?.();drumPad=null;el.innerHTML='<p class="empty-fretboard">Fretboard is available for string instruments.</p>';return;}
    const tuning=st.tuning.join(','),existing=el.querySelector('.fretboard-grid');
    if(existing?.dataset.tuning===tuning){for(const fret of existing.querySelectorAll('[data-fret]')){const string=Number(fret.dataset.string),number=Number(fret.dataset.fret),note=b?.notes.find(n=>n.string===st.tuning.length+1-string&&n.fret===number);fret.classList.toggle('sounding',!!note);fret.textContent=note?String(number):([3,5,7,9,12,15].includes(number)&&string===Math.floor(st.tuning.length/2)+1?'·':'');}return;}
    el.innerHTML=`<div class="fretboard-grid" data-tuning="${esc(tuning)}" style="--strings:${st.tuning.length}">${st.tuning.map((pitch,idx)=>`<div class="fret-row"><span>${at.model.Tuning.getTextForTuning(pitch,false)}</span>${Array.from({length:16},(_,f)=>{const n=b?.notes.find(n=>n.string===st.tuning.length-idx&&n.fret===f);return `<button class="fret ${n?'sounding':''}" data-string="${idx+1}" data-fret="${f}" title="String ${idx+1}, fret ${f}" aria-label="String ${idx+1}, fret ${f}">${n?f:([3,5,7,9,12,15].includes(f)&&idx===Math.floor(st.tuning.length/2)?'·':'')}</button>`;}).join('')}</div>`).join('')}<div class="fret-numbers"><span></span>${Array.from({length:16},(_,f)=>`<span>${f}</span>`).join('')}</div></div>`;
  }
  listen('fretboard','click',e=>{const fret=e.target.closest('[data-fret]');if(!fret)return;set('string-input',fret.dataset.string);set('fret-input',fret.dataset.fret);const st=selectedTrack().staves[selected.staff];if(check('editor-mode')){currentString=Number(fret.dataset.string);applyNote({string:currentString,fret:Number(fret.dataset.fret)});}else{const beat=new at.model.Beat();beat.voice=curBeat().voice;const n=new at.model.Note();n.string=st.tuning.length+1-Number(fret.dataset.string);n.fret=Number(fret.dataset.fret);beat.addNote(n);if(!audioMuted&&api.isReadyForPlayback){if(hifi)hifi.auditionNote(n,selectedTrack());else api.playNote(n);}}});
  function move(delta){
    const b=curBeat();if(!b)return;const next=delta>0?b.nextBeat:b.previousBeat;
    if(next){selectBeat(next);api.tickPosition=api.tickCache?.getBeatStart(next)??next.absolutePlaybackStart;api.scrollToCursor();return;}
    // As in desktop tab editors, stepping past the final beat extends the song by one bar.
    if(delta>0&&!isViewer&&check('editor-mode')&&selected.bar===score.masterBars.length-1)mutate(s=>{M.addBar(s);selected.bar=s.masterBars.length-1;selected.beat=0;},'Bar added');
  }
  function moveBar(delta){if(score)seekBar(clamp(selected.bar+delta,0,score.masterBars.length-1));}
  function moveTrack(delta){
    if(!score||score.tracks.length<2)return;const next=clamp(activeTrack+delta,0,score.tracks.length-1);if(next===activeTrack)return;
    clearDigitEntry();activeTrack=next;selected={track:next,staff:0,bar:selected.bar,voice:0,beat:0,note:0};displayed=new Set([next]);renderScore();toast(score.tracks[next].name);
  }
  document.addEventListener('keydown',e=>{
    // Single-key articulations, matching the palette buttons.
    const effectKeys={h:'isHammerPullOrigin',l:'isLetRing',p:'isPalmMute',x:'isDead',v:'vibrato',a:'accentuated',s:'isStaccato'};
    const typing=/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)||e.target.isContentEditable;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(!isViewer)cloudSaveAction();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();if(!isViewer)$('open-file').click();return;}
    if(e.key==='Enter'&&e.target.tagName==='INPUT'&&['text','number'].includes(e.target.type)&&Object.hasOwn(noteFields,e.target.id)){e.preventDefault();commitNoteField(e.target.id);e.target.blur();$('alphatab').focus({preventScroll:true});return;}
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='e'&&!isViewer&&typeof openPalette==='function'&&!e.target.closest?.('dialog')){e.preventDefault();openPalette();return;}
    if(typing||e.target.closest?.('dialog'))return;
    if(!isViewer&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='c'){e.preventDefault();$('btn-copy-bar').click();return;}
    if(e.key==='Delete'&&(e.ctrlKey||e.metaKey)&&!isViewer&&check('editor-mode')){e.preventDefault();mutate(s=>M.removeBar(s,selected.bar),'Bar deleted');return;}
    if(!isViewer&&(e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='v'){e.preventDefault();pasteRepeated();return;}
    if(!isViewer&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='v'){e.preventDefault();$('btn-paste-bar').click();return;}
    if(!isViewer&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();history(!e.shiftKey);return;}
    if(['F2','F5','F6','F8'].includes(e.key)){e.preventDefault();togglePanel(({F2:'palette',F5:'inspector',F6:'inspector',F8:'mixer'})[e.key]);}
    else if(e.code==='Space'&&!e.target.closest?.('button,a,summary,[role="button"]')){e.preventDefault();$('btn-play').click();}
    else if(e.shiftKey&&!e.altKey&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){e.preventDefault();extendRange((barRange?.end??selected.bar)+(e.key==='ArrowRight'?1:-1));}
    else if(e.shiftKey&&e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();if(!isViewer)transposeRange(e.key==='ArrowUp'?1:-1);}
    else if(!isViewer&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();barRange={anchor:0,end:score.masterBars.length-1};showRange();}
    else if(e.key==='Escape'&&barRange){clearRange();syncInspector();}
    else if((e.ctrlKey||e.metaKey)&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){e.preventDefault();clearRange();moveBar(e.key==='ArrowRight'?1:-1);}
    else if((e.ctrlKey||e.metaKey)&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();moveTrack(e.key==='ArrowDown'?1:-1);}
    else if(e.key==='ArrowRight'){e.preventDefault();move(1);}else if(e.key==='ArrowLeft'){e.preventDefault();move(-1);}
    else if((e.ctrlKey||e.metaKey)&&(e.key==='Home'||e.key==='End')){e.preventDefault();clearRange();seekBar(e.key==='Home'?0:score.masterBars.length-1);}
    else if(e.key==='Tab'&&!e.ctrlKey&&!e.altKey&&(e.target===$('alphatab')||e.target===document.body)){e.preventDefault();moveTrack(e.shiftKey?-1:1);}
    else if(e.altKey&&!e.shiftKey&&(e.key==='ArrowRight'||e.key==='ArrowLeft')){e.preventDefault();move(e.key==='ArrowRight'?1:-1);const n=curBeat()?.notes[0];if(n&&!audioMuted&&api.isReadyForPlayback){if(hifi)hifi.auditionNote(n,selectedTrack());else api.playNote(n);}}
    else if(check('editor-mode')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key==='t'){e.preventDefault();$('text-input')?.focus();}
    else if(check('editor-mode')&&(e.ctrlKey||e.metaKey)&&e.key==='.'){e.preventDefault();const b=curBeat();if(b)mutate(()=>M.setDuration(curBeat(),curBeat().duration,b.dots===2?0:2),'Double dotted',true,undefined,{lightweight:true});}
    else if(e.key==='Home'){e.preventDefault();seekBar(selected.bar);}else if(e.key==='End'){e.preventDefault();const bs=selectedTrack().staves[selected.staff].bars[selected.bar].voices[selected.voice].beats;selectBeat(bs.at(-1));}
    else if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();const st=selectedTrack()?.staves[selected.staff];if(!st?.isStringed||st.isPercussion)return;clearDigitEntry();currentString=clamp(currentString+(e.key==='ArrowUp'?-1:1),1,st.tuning.length||6);selected.note=selectedNote()?.index??-1;syncInspector();drawFretboard();}
    else if(e.key==='F9'){e.preventDefault();loop();}
    else if(e.key==='?')$('shortcuts-dialog')?.showModal();
    else if(check('editor-mode')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&/^\d$/.test(e.key)){e.preventDefault();const st=selectedTrack()?.staves[selected.staff];if(!st?.isStringed||st.isPercussion){clearDigitEntry();toast('Use the MIDI pitch field for piano and percussion notes.');return;}const previous=digitBuffer;digitBuffer=(digitBuffer+e.key).slice(-2);if(Number(digitBuffer)>36)digitBuffer=e.key;set('fret-input',digitBuffer);set('string-input',currentString);digitUndoEntry=applyNote({string:currentString,fret:Number(digitBuffer)},previous.length===1 && digitBuffer.length===2 ? digitUndoEntry : null);if(typeof auditionNote==='function')auditionNote();clearTimeout(digitTimer);digitTimer=setTimeout(()=>{digitBuffer='';digitUndoEntry=null;},700);}
    else if(check('editor-mode')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&e.key.toLowerCase()==='r')$('btn-rest').click();
    else if(check('editor-mode')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&typeof quickKeys==='object'&&Object.hasOwn(quickKeys,e.key)&&!(e.key.length===1&&/[a-z]/.test(e.key)&&Object.hasOwn(effectKeys,e.key))){e.preventDefault();quickKeys[e.key]();}
    else if(check('editor-mode')&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&Object.hasOwn(effectKeys,e.key.toLowerCase())){e.preventDefault();document.querySelector(`[data-effect="${effectKeys[e.key.toLowerCase()]}"]`)?.click();}
    else if(check('editor-mode')&&!e.ctrlKey&&!e.metaKey&&e.key==='.'){e.preventDefault();$('btn-dotted')?.click();}
    else if(check('editor-mode')&&(e.key==='Backspace'||e.key==='Delete')){e.preventDefault();$('btn-delete-note').click();}
    else if(!isViewer&&(e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();history(false);}
    else if(e.key==='Insert'&&check('editor-mode')){$('btn-insert-bar').click();}
    else if(check('editor-mode')&&(e.key==='+'||e.key==='='||e.key==='-')){e.preventDefault();const b=curBeat();if(b){set('duration-select',clamp(b.duration*(e.key==='-'?.5:2),1,64));mutate(()=>M.setDuration(curBeat(),Number(val('duration-select'))),'Duration updated',true,undefined,{lightweight:true});}}
  });
  const drop=$('score-scroll');drop?.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag-over');});drop?.addEventListener('dragleave',()=>drop.classList.remove('drag-over'));drop?.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag-over');openFile(e.dataTransfer.files[0]);});
  window.addEventListener('beforeunload',e=>{if(!isViewer&&(dirty||openedDocuments.some((d,i)=>i!==documentIndex&&d.dirty))){clearTimeout(saveTimer);saveDraft();if(dirty||openedDocuments.some((d,i)=>i!==documentIndex&&d.dirty)){e.preventDefault();e.returnValue='';}}});
  api.error.on(e=>{cancelEditRefresh();busy(false);status('Playback engine error');toast(e.message||String(e),true);console.error(e);});
  api.renderStarted.on(()=>status('Drawing tabs…'));
  api.renderFinished.on(()=>{busy(false);status(`${score?.tracks.length || 0} tracks · ${score?.masterBars.length || 0} bars · ${api.isReadyForPlayback?'Ready':'Loading soundfont…'}`);if(pendingBarSeek!==null){const bar=pendingBarSeek;pendingBarSeek=null;seekBar(bar);}});
  api.postRenderFinished.on(()=>{try{if(barRange)drawRangeOverlay();}catch{}
    const refresh=pendingEditRefresh;
    if(!refresh){markSelection();return;}
    const version=refresh.version;
    queueMicrotask(()=>{
      if(pendingEditRefresh!==refresh||refresh.version!==version)return;
      if(refresh.documentIndex!==documentIndex){cancelEditRefresh();markSelection();return;}
      const viewport=$('score-scroll'),focus=$('alphatab'),active=document.activeElement;
      if(viewportIntent===refresh.intent&&viewport){viewport.scrollTop=refresh.top;viewport.scrollLeft=refresh.left;}
      if(refresh.focusedScore&&(!active||active===document.body||!active.isConnected))focus?.focus({preventScroll:true});
      markSelection();
    });
  });
  api.midiLoaded.on(()=>{const refresh=pendingEditTick;if(!refresh)return;if(refresh.documentIndex!==documentIndex||refresh.intent!==playbackIntent){pendingEditTick=null;return;}api.tickPosition=refresh.tick;pendingEditTick=null;});
  function applyPracticeMix(){for(const track of score.tracks){const volume=trackPlaybackVolume(track);api.changeTrackVolume([track],volume);if(api.hifi)api.hifi.setTrackVolume(track,volume);}}
  async function balanceSoloLevels(){
    if(!isViewer||!score||!api.isReadyForPlayback)return;
    const source=score;
    if(api.hifi){
      // Hi-fi: render the track alone with SpessaSynth, the same sound the listener hears.
      for(const track of source.tracks){
        if(!track.playbackInfo.isSolo||track.playbackInfo.isMute||soloLevels.has(track)||soloPending.has(track))continue;
        const firstBar=track.staves.flatMap(staff=>staff.bars).filter(bar=>bar.voices.some(voice=>voice.beats.some(beat=>beat.notes.length))).sort((a,b)=>a.index-b.index)[0];
        if(!firstBar){soloLevels.set(track,1);continue;}
        soloPending.add(track);
        try{
          const start=api.tickCache?.getMasterBarStart(firstBar.masterBar)??firstBar.masterBar.start;
          const level=await api.hifi.measureTrackLevel(track,{startTick:start,endTick:start+960*16});
          if(level&&score===source&&track.playbackInfo.isSolo&&!track.playbackInfo.isMute){soloLevels.set(track,soloLevelGain(level.peak,level.rms));applyPracticeMix();}
        }catch{if(score===source)toast('Solo is available; automatic level balancing could not finish.',true);}
        finally{soloPending.delete(track);}
      }
      return;
    }
    // Measure the loaded bank in short worker tasks, leaving playback requests room to run.
    for(const track of source.tracks){
      if(!track.playbackInfo.isSolo||track.playbackInfo.isMute||soloLevels.has(track)||soloPending.has(track))continue;
      const firstBar=track.staves.flatMap(staff=>staff.bars).filter(bar=>bar.voices.some(voice=>voice.beats.some(beat=>beat.notes.length))).sort((a,b)=>a.index-b.index)[0];
      if(!firstBar){soloLevels.set(track,1);continue;}
      soloPending.add(track);let exporter;
      try{
        const options=new at.synth.AudioExportOptions();options.sampleRate=44100;options.masterVolume=1;options.metronomeVolume=0;
        const start=api.tickCache?.getMasterBarStart(firstBar.masterBar)??firstBar.masterBar.start;
        options.playbackRange={startTick:start,endTick:start+960*64};
        for(const other of source.tracks)options.trackVolume.set(other.index,other===track?1:0);
        exporter=await api.exportAudio(options);let peak=0,energy=0,count=0;
        for(let elapsed=0;elapsed<8000;elapsed+=100){
          if(score!==source||!track.playbackInfo.isSolo||track.playbackInfo.isMute)break;
          const chunk=await exporter.render(100);if(!chunk)break;
          for(const sample of chunk.samples){peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;}count+=chunk.samples.length;
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        if(score===source&&track.playbackInfo.isSolo&&!track.playbackInfo.isMute&&count){
          soloLevels.set(track,soloLevelGain(peak,Math.sqrt(energy/count)));applyPracticeMix();
        }
      }catch{if(score===source)toast('Solo is available; automatic level balancing could not finish.',true);}
      finally{exporter?.destroy();soloPending.delete(track);}
    }
  }
  function syncPlaybackMix(){
    if(!score)return;
    api.player?.resetChannelStates();
    api.player?.applyTranspositionPitches(at.midi.MidiFileGenerator.buildTranspositionPitches(score,api.settings));
    for(const track of score.tracks){const volume=trackPlaybackVolume(track);api.changeTrackVolume([track],volume);api.changeTrackMute([track],track.playbackInfo.isMute);api.changeTrackSolo([track],track.playbackInfo.isSolo);if(api.hifi){api.hifi.setTrackVolume(track,volume);api.hifi.setTrackMute(track,track.playbackInfo.isMute);api.hifi.setTrackSolo(track,track.playbackInfo.isSolo);}}
  }
  // viewer/player.js writes api.metronomeVolume and api.playbackSpeed directly; keep Spessa in step.
  function hookHifiVolumes(){
    if(!hifi||hifi.__volumeHooked)return;
    hifi.__volumeHooked=true;
    for(const [name,method] of [['masterVolume','setMasterVolume'],['metronomeVolume','setMetronomeVolume'],['countInVolume','setCountInVolume'],['playbackSpeed','setPlaybackSpeed']]){
      try{
        let owner=api,desc=null;
        while(owner&&!(desc=Object.getOwnPropertyDescriptor(owner,name)))owner=Object.getPrototypeOf(owner);
        if(!desc?.get||!desc?.set)continue;
        Object.defineProperty(api,name,{configurable:true,enumerable:!!desc.enumerable,
          get(){return desc.get.call(api);},
          set(value){
            // Speed must reach the adapter before alphaTab seeks on the new time axis.
            if(method==='setPlaybackSpeed')try{hifi?.[method]?.(value);}catch{}
            desc.set.call(api,value);
            if(method!=='setPlaybackSpeed')try{hifi?.[method]?.(value);}catch{}
          }
        });
      }catch{}
    }
  }
  async function startHifi(){
    if(!canUseHifi)return;
    if(!api.player?.output){
      hifiPending=false;
      try{api.settings.player.playerMode=at.PlayerMode.EnabledSynthesizer;api.updateSettings();setTimeout(()=>api.loadMidiForScore(),100);}catch{}
      updatePlayReady();return;
    }
    try{
      const mod=await import('./hifi-player.js');
      const adapter=await mod.createHifiPlayer({api,at,soundFontUrl:new URL('./vendor/soundfont/'+soundBank,location.href).href,processorUrl:new URL('./vendor/spessasynth/spessasynth_processor.min.js',location.href).href});
      hifi=adapter;api.hifi=adapter;hifiPending=false;
      adapter.onReady=updatePlayReady;
      hookHifiVolumes();
      adapter.setMasterVolume(audioMuted?0:api.masterVolume);
      adapter.setMetronomeVolume(audioMuted?0:api.metronomeVolume);
      adapter.setCountInVolume(audioMuted?0:api.countInVolume);
      adapter.setPlaybackSpeed(api.playbackSpeed);
      adapter.syncFromScore(score);
      syncPlaybackMix();
      updatePlayReady();
    }catch(e){
      console.warn('Fretlark hi-fi audio unavailable; using alphaSynth.',e);
      hifi=null;api.hifi=null;hifiPending=false;
      try{api.settings.player.playerMode=at.PlayerMode.EnabledSynthesizer;api.updateSettings();setTimeout(()=>api.loadMidiForScore(),100);}catch{}
      updatePlayReady();
      toast('Hi-fi audio is unavailable in this browser. Using the standard player.',true);
    }
  }
  api.playerReady.on(()=>{if($('btn-play')){$('btn-play').setAttribute('aria-label','Play');$('btn-play').title='Play / pause · Space';const label=$('btn-play').querySelector('.play-word');if(label)label.textContent='Play';}queueMicrotask(()=>{installSoloLimiter();syncPlaybackMix();if(hifi)hifi.syncFromScore(score);balanceSoloLevels();});status(`${score?.masterBars.length || 0} bars · Ready to play`);updatePlayReady();});
  api.midiLoaded.on(()=>{if(hifi)hifi.onMidiLoaded();});
  api.soundFontLoad.on(e=>{const progress=e.total>0?` ${Math.round(e.loaded/e.total*100)}%`:'';status(`Loading instruments…${progress}`);if(!api.isReadyForPlayback&&$('btn-play'))$('btn-play').setAttribute('aria-label',`Loading instruments${progress}`);});
  api.playerStateChanged.on(e=>{if(e.state===1){playbackIntent++;cancelEditRefresh();}api.settings.player.scrollMode=e.state===1?at.ScrollMode.Continuous:at.ScrollMode.Off;activate('btn-play',e.state===1);$('btn-play')?.setAttribute('aria-label',e.state===1?'Pause':'Play');$('btn-play')?.classList.toggle('playing',e.state===1);});
  api.playerPositionChanged.on(e=>{txt('time-position',formatTime(e.currentTime));txt('time-total',formatTime(e.endTime));});
  api.playerPositionChanged.on(e=>{const played=M.playbackBarAt(api.tickCache?.masterBars||[],e.currentTick);if(!played)return;const i=played.masterBar.index;if(i===lastPlayedBar)return;lastPlayedBar=i;txt('lcd-bar',`${i+1}/${score.masterBars.length}`);document.querySelectorAll('.timeline-bar.playing').forEach(e=>e.classList.remove('playing'));const el=document.querySelector(`[data-bar="${i}"]`);el?.classList.add('playing');if(el){const container=$('timeline');if(el.offsetLeft<container.scrollLeft||el.offsetLeft>container.scrollLeft+container.clientWidth-40)container.scrollLeft=el.offsetLeft-80;}});
  api.beatMouseDown.on(b=>{$('alphatab').focus({preventScroll:true});selectBeat(b);});api.noteMouseDown.on(n=>{selectBeat(n.beat,n);if(!audioMuted&&check('editor-mode')&&api.isReadyForPlayback){if(hifi)hifi.auditionNote(n,n.beat?.voice?.bar?.staff?.track);else api.playNote(n);}});
  $('alphatab').addEventListener('mousedown',e=>{
    if(isViewer||!check('editor-mode')||e.button!==0)return;
    const surface=$('alphatab').querySelector('.at-surface');if(!surface)return;
    const rect=surface.getBoundingClientRect(),hit=findNoteNear(api.renderer.boundsLookup,e.clientX-rect.left,e.clientY-rect.top);
    if(!hit)return;
    // Native beat lookup otherwise assigns clicks just left of a tiny fret to the preceding rest.
    e.preventDefault();e.stopImmediatePropagation();$('alphatab').focus({preventScroll:true});selectBeat(hit.note.beat,hit.note);
    api.tickPosition=api.tickCache?.getBeatStart(hit.note.beat)??hit.note.beat.absolutePlaybackStart;
    if(!audioMuted&&api.isReadyForPlayback){if(hifi)hifi.auditionNote(hit.note,hit.note.beat?.voice?.bar?.staff?.track);else api.playNote(hit.note);}
  },true);
  if($('btn-play')){ $('btn-play').disabled=true; $('btn-play').setAttribute('aria-label','Loading instruments'); const label=$('btn-play').querySelector('.play-word');if(label)label.textContent='Loading…'; }
  api.masterVolume=audioMuted?0:.75;api.metronomeVolume=0;api.countInVolume=0;
  if(audioMuted)for(const id of ['master-volume','dock-master-volume']){const input=$(id);if(input){input.value='0';input.disabled=true;if(input.nextElementSibling)input.nextElementSibling.textContent='0%';}}
  if(audioMuted)for(const id of ['btn-metronome','btn-count-in']){const button=$(id);if(button){button.disabled=true;button.title='Audio is muted in this preview';const state=button.querySelector('.practice-toggle-state');if(state)state.textContent='Muted';}}
  startHifi();
  async function cloudApi(path,options={}){const response=await fetch('/api/'+path,{cache:'no-store',...options});if(!response.ok){let message='Song unavailable';try{message=(await response.json()).error||message;}catch{}throw Error(message);}return response;}
  async function saveCloud(){
    if(isViewer||!score||cloudSaving||loading)return;cloudSaving=true;$('btn-cloud-save').disabled=true;$('btn-cloud-save').textContent='Saving…';
    const sourceDocumentIndex=documentIndex, snapshot=M.snapshot(score);
    try{
      const file=new Blob([exportGpBytes(score)]);
      const metadata={file_name:`${(score.title||'Untitled').slice(0,252)}.gp`,file_size:file.size,title:(score.title||'Untitled').slice(0,180),artist:(score.artist||'').slice(0,180),track_count:score.tracks.length,bar_count:score.masterBars.length,tempo:score.tempo,version:remoteLesson?.version||0};
      const lesson=await (await cloudApi(remoteLesson?`admin/lessons/${remoteLesson.id}/file`:'admin/lessons',{method:remoteLesson?'PUT':'POST',headers:{'Content-Type':'application/octet-stream','X-Fretphrase-Metadata':encodeURIComponent(JSON.stringify(metadata))},body:file})).json();
      const savedDocument=openedDocuments[sourceDocumentIndex],isCurrentDocument=documentIndex===sourceDocumentIndex;
      if(savedDocument){savedDocument.remoteLesson=lesson;const unchanged=isCurrentDocument?snapshot===M.snapshot(score):savedDocument.json===snapshot;if(unchanged)savedDocument.dirty=false;
        // Keep the device copy when newer edits arrived while the upload was running.
        if(unchanged&&savedDocument.localId&&window.LocalSongs){window.LocalSongs.remove(localOwner,savedDocument.localId);savedDocument.localId=null;if(isCurrentDocument)localId=null;}
        if(isCurrentDocument){remoteLesson=lesson;if(unchanged)dirty=false;rememberDocument();syncInspector();}
        renderDocumentTabs();saveDraft();
        if(isCurrentDocument){const url=new URL(location.href);url.search='?lesson='+encodeURIComponent(lesson.id)+(diagnosticSilent?'&silent=1':'')+(query.get('mute')==='1'?'&mute=1':'');window.history.replaceState(null,'',url);$('lesson-badge').textContent=unchanged?'Saved to cloud':localId?'On this device':'Library song';}
        toast(lesson.student_settings.allowed_tracks?.length===0?'Shared link paused. Review and save visible tracks before sharing again.':unchanged?'Saved to cloud. Shared links will load this version.':'Saved this snapshot. Newer edits remain unsaved.');
      }
    }catch(e){toast(e.message,true);}finally{cloudSaving=false;$('btn-cloud-save').disabled=false;syncSaveButtons();}
  }
  // Songs on this device save themselves on every edit; the tab loses its unsaved dot once stored.
  function saveLocalSong(){
    try{window.LocalSongs.put(localOwner,{id:localId,title:score.title,artist:score.artist,tracks:score.tracks.length,bars:score.masterBars.length,tempo:score.tempo,json:M.snapshot(score)});
      // A cloud copy stays dirty until the cloud save actually includes these edits.
      if(!remoteLesson&&!cloudSaving){dirty=false;if(openedDocuments[documentIndex])openedDocuments[documentIndex].dirty=false;}
      txt('file-title',`${score.title||'Untitled'}.gp${dirty?' •':''}`);renderDocumentTabs();$('lesson-badge').textContent='On this device';}
    catch(e){toast(e.message,true);}
  }
  // Songs kept on this device offer "Move to cloud"; songs not in the cloud can also be kept on this device.
  function syncSaveButtons(){
    try{
      const cloud=$('btn-cloud-save'),device=$('btn-device-save');if(!cloud||!device)return;
      if(!cloudSaving)cloud.textContent=!remoteLesson&&localId?'Move to cloud':'Save to cloud';
      device.hidden=isViewer||guest||!!remoteLesson;device.classList.toggle('on',!!localId);device.textContent=localId?'Saved on device':'Save on device';
    }catch{}
  }
  if(typeof listen==='function')listen('btn-device-save','click',()=>{
    if(isViewer||!score||remoteLesson)return;
    if(!localId){localId=crypto.randomUUID?.()||String(Date.now());if(openedDocuments[documentIndex])openedDocuments[documentIndex].localId=localId;}
    saveLocalSong();syncSaveButtons();toast('Saved on this device. It never leaves this browser.');
  });
  function cloudSaveAction(){
    if(!guest)return saveCloud();
    // Keep the guest workspace in this browser, then bring it back after sign-up and save it.
    clearTimeout(saveTimer);saveDraft();location.href='/admin?signup=1&next='+encodeURIComponent('/editor/index.html?continue=1');
  }
  listen('btn-cloud-save','click',cloudSaveAction);
  function enterGuestMode(){
    guest=true;draftKey=GUEST_DRAFT;$('lesson-badge').textContent='On this device';
    const home=document.querySelector('.library-link');if(home){home.href='/';home.title='Home';home.setAttribute('aria-label','Home');const label=home.querySelector('.button-label');if(label)label.textContent='Home';}
    $('btn-cloud-save').title='Create a free account to keep this song in the cloud';
  }
  function adoptGuestWorkspace(){
    // Only the guest's own sign-up round trip moves their browser workspace into the account.
    if(!query.has('continue'))return false;
    const url=new URL(location.href);url.searchParams.delete('continue');window.history.replaceState(null,'',url);
    try{const raw=localStorage.getItem(GUEST_DRAFT+':workspace');if(!raw)return false;sessionStorage.setItem(draftKey+':workspace',raw);localStorage.removeItem(GUEST_DRAFT+':workspace');return true;}catch{return false;}
  }
  function unavailable(message){busy(false);status('Song unavailable');$('lesson-badge').textContent='Unavailable';const hint=$('score-empty-hint');hint.hidden=false;hint.style.display='flex';hint.innerHTML='<strong>Song unavailable</strong><span></span><button class="button" type="button" onclick="location.reload()">Try again</button>';hint.querySelector('span').textContent=message;}
  async function importCloud(bytes,name,metadata){
    if(/\.atex$/i.test(name)){const parsed=quietLoad(()=>at.importer.ScoreLoader.loadAlphaTex(new TextDecoder().decode(bytes),api.settings));bytes=new at.exporter.Gp7Exporter().export(parsed);}
    const before=score;await importBytes(bytes,name,metadata);if(score===before)throw Error('The file could not be opened. Ask the owner to replace the file.');
  }
  async function start(){
    busy(true,isViewer?'Opening shared song…':'Opening workspace…');
    try{
      if(isViewer){
        $('editor-mode').checked=false;$('editor-mode').disabled=true;$('tempo-input').disabled=!document.body.classList.contains('simple-player');$('lesson-badge').textContent=query.has('preview')?'Private preview':'Shared song';
        document.querySelector('.status-help').textContent='Space: play / pause · F9: loop';document.querySelector('.dock-status').textContent='Practice mix';
        const base=shareToken?`shared/${encodeURIComponent(shareToken)}`:`admin/lessons/${encodeURIComponent(query.get('lesson')||'')}`,lesson=await(await cloudApi(base)).json();
        const settings=lesson.student_settings||{};studentSettings=settings;document.body.classList.toggle('no-track-controls',settings.show_track_controls===false);
        const modes=settings.allowed_notations||['both','tab','standard','slash','numbered'];
        for(const option of [...$('notation-select').options])if(!modes.includes(option.value))option.remove();
        set('notation-select',modes.includes(settings.notation)?settings.notation:modes[0]);
        $('notation-select').disabled=modes.length===1;
        if(settings.show_track_controls===false)$('active-track-select').disabled=true;
        for(const [selector,allowed] of [['[data-student-mixer]',settings.show_mixer],['.track-control',settings.show_track_controls],['#btn-metronome',settings.metronome],['#btn-count-in',settings.count_in],['#btn-print',settings.allow_print],['#btn-download',settings.allow_download]]) {
          if(allowed===false)document.querySelectorAll(selector).forEach(element=>element.hidden=true);
        }
        const bytes=new Uint8Array(await(await cloudApi(base+'/file')).arrayBuffer());studentFile={bytes,name:lesson.file_name||lesson.title+'.'+lesson.format};await importCloud(bytes,studentFile.name,lesson);
        if(!score)throw Error('The file could not be opened. Ask the owner to replace the file.');
        $('tab-file-title').textContent=lesson.title;document.title=lesson.title+' — Shared player';
      }else{
        const session=await(await cloudApi('session')).json(),id=query.get('lesson');
        if(!session.admin&&id){location.replace('/admin');return;}
        if(session.admin)draftKey='fretline-draft:'+session.email;else enterGuestMode();
        localOwner=session.admin?session.email:'guest';
        const adopted=!guest&&adoptGuestWorkspace(),drafts=guest?localStorage:sessionStorage;
        if(id){let raw,saved;try{raw=sessionStorage.getItem(draftKey+':workspace');saved=raw&&JSON.parse(raw);}catch{}
          const match=Array.isArray(saved?.documents)?saved.documents.findIndex(doc=>doc.remoteLesson?.id===id):-1;
          if(match>=0&&saved.documents.some(doc=>doc.dirty)){restoreDraft(raw,match);busy(false);set('loop-end',score.masterBars.length);renderScore();renderDocumentTabs();updateHistory();toast('Restored your local editing session');}
          else{const lesson=await(await cloudApi(`admin/lessons/${encodeURIComponent(id)}`)).json();await importCloud(new Uint8Array(await(await cloudApi(`admin/lessons/${encodeURIComponent(id)}/file`)).arrayBuffer()),lesson.file_name,lesson);remoteLesson=lesson;rememberDocument();saveDraft();} $('lesson-badge').textContent='Library song';}
        else if(query.get('local')&&query.get('local')!=='1'&&window.LocalSongs){busy(false);const song=window.LocalSongs.get(localOwner,query.get('local'));if(!song){unavailable('This song is not saved in this browser.');return;}clearRange();score=M.restore(song.json);currentString=1;activeTrack=0;selected={track:0,staff:0,bar:0,voice:0,beat:0,note:0};displayed=new Set([0]);undo=[];redo=[];dirty=false;localId=song.id;addDocument();syncDocumentBadge();set('loop-end',score.masterBars.length);renderScore();updateHistory();}
        else if(query.has('new')){busy(false);newScore();placeholderDocument=documentIndex;openNewSong();const url=new URL(location.href);url.searchParams.delete('new');window.history.replaceState(null,'',url);}
        else{busy(false);try{const workspace=drafts.getItem(draftKey+':workspace'),session=drafts.getItem(draftKey);if(workspace){restoreDraft(workspace);set('loop-end',score.masterBars.length);renderScore();renderDocumentTabs();updateHistory();if(adopted&&score)saveCloud();else toast(guest?'Your songs are kept in this browser':'Restored your local editing session');}else if(session){clearRange();score=M.restore(session);displayed=new Set([0]);addDocument();syncDocumentBadge();renderScore();updateHistory();toast('Restored your last local editing session');}else await demo();}catch{await demo();}}
      }
    }catch(e){unavailable(e.message);}
  }
  start();
})();
