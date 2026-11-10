(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/alphaTab.js'),require('./vendor/fflate.js'));
  else root.ScoreModel = factory(root.alphaTab,root.fflate);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (at,zip) {
  'use strict';
  const m = at.model;
  const settings = new at.Settings();
  // AlphaTab's GPX decoder trusts the uncompressed length in the file. Cap it before import
  // so a tiny crafted .gpx cannot make the browser allocate gigabytes.
  const MAX_GPX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
  function gpxUncompressedSize(data) {
    if (!data || data.length < 8) return null;
    if (data[0] !== 0x42 || data[1] !== 0x43 || data[2] !== 0x46 || data[3] !== 0x5a) return null;
    return ((data[7] << 24) | (data[6] << 16) | (data[5] << 8) | data[4]) >>> 0;
  }
  function assertSafeScoreFile(data) {
    const size = gpxUncompressedSize(data);
    if (size !== null && size > MAX_GPX_UNCOMPRESSED_BYTES) {
      throw Error('This GPX file expands to more data than Fretlark can open safely.');
    }
    return data;
  }
  const tunings = {
    standard: [64, 59, 55, 50, 45, 40], dropd: [64, 59, 55, 50, 45, 38],
    dadgad: [62, 57, 55, 50, 45, 38], openg: [62, 59, 55, 50, 43, 38],
    bass: [43, 38, 33, 28], seven: [64, 59, 55, 50, 45, 40, 35]
  };
  function snapshot(score) {
    const bytes=zip.zlibSync(zip.strToU8(at.model.JsonConverter.scoreToJson(score)),{level:1});
    const binary=zip.strFromU8(bytes,true);
    return 'z:'+(typeof btoa==='function'?btoa(binary):Buffer.from(bytes).toString('base64'));
  }
  function restore(json) {
    if(json.startsWith('z:')){
      const data=typeof atob==='function'?zip.strToU8(atob(json.slice(2)),true):new Uint8Array(Buffer.from(json.slice(2),'base64'));
      json=zip.strFromU8(zip.unzlibSync(data));
    }
    return at.model.JsonConverter.jsonToScore(json, settings);
  }
  function fingerprint(score) {
    // Fast change detector for mutate()'s no-op check (see app.js). It must differ when the
    // score differs; any field missed here only falls back to a full snapshot comparison,
    // so misses cost time but never correctness.
    let hash = 2166136261;
    const mix = n => { hash ^= (n | 0); hash = Math.imul(hash, 16777619); };
    const mixStr = s => { s = String(s ?? ''); mix(s.length); for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); };
    mix(score.masterBars.length); mix(score.tracks.length);
    for (const mb of score.masterBars) {
      mix(mb.timeSignatureNumerator * 64 + mb.timeSignatureDenominator);
      mix(mb.keySignature || 0); mix(mb.tripletFeel || 0);
      mix(mb.repeatCount || 0); mix(mb.alternateEndings || 0);
      mix(mb.isRepeatStart ? 1 : 0); mix(mb.isDoubleBar ? 2 : 0); mix(mb.isFreeTime ? 4 : 0);
      mixStr(mb.section?.text); mix(mb.directions?.size || 0); mix(mb.fermata?.size || 0);
      if (mb.tempoAutomations) for (const t of mb.tempoAutomations) { mix((t.value * 4) | 0); mix((t.ratioPosition * 997) | 0); }
      if (mb.syncPoints) for (const s of mb.syncPoints) { mix(s.type || 0); mix((s.ratioPosition * 997) | 0); }
    }
    for (const track of score.tracks) {
      const info = track.playbackInfo || {};
      mixStr(track.name); mix(info.program || 0); mix(info.primaryChannel || 0); mix(info.secondaryChannel || 0);
      mix(info.volume || 0); mix(info.balance || 0);
      mix(info.isMute ? 1 : 0); mix(info.isSolo ? 2 : 0);
      for (const staff of track.staves) {
        mix(staff.isPercussion ? 1 : 0); mix(staff.capo || 0);
        const tuning = staff.tuning || [];
        mix(tuning.length);
        for (const pitch of tuning) mix(pitch);
        mix(staff.showTablature ? 1 : 0); mix(staff.showStandardNotation ? 2 : 0);
        for (const bar of staff.bars) {
          mix(bar.clef || 0); mix(bar.keySignature || 0); mix(bar.simileMark || 0);
          mix(bar.voices.length);
          for (const voice of bar.voices) {
            mix(voice.beats.length);
            for (const beat of voice.beats) {
              mix(beat.duration || 0); mix(beat.dots || 0);
              mix(beat.tupletNumerator || 0); mix(beat.tupletDenominator || 0);
              mix(beat.graceType || 0); mix(beat.dynamics ?? 0);
              mix(beat.isEmpty ? 1 : 0);
              mix(beat.pickStroke || 0); mix(beat.brushType || 0); mix(beat.tremoloSpeed || 0);
              mix((beat.tap ? 1 : 0) | (beat.slap ? 2 : 0) | (beat.pop ? 4 : 0) | (beat.slashed ? 8 : 0));
              mix(beat.ottava || 0); mix(beat.crescendo || 0); mix(beat.fade || 0);
              mix(beat.whammyBarType || 0); mix(beat.whammyBarPoints?.length || 0);
              mix(beat.barreFret ?? -1); mix(beat.fermata ? 1 : 0);
              mixStr(beat.text); mixStr(beat.lyrics?.join?.('\x1f'));
              mixStr(beat.chordId);
              if (beat.automations) for (const a of beat.automations) { mix(a.type || 0); mix((Number(a.value) * 4) || 0); }
              mix(beat.notes.length);
              for (const note of beat.notes) {
                mix(note.string ?? -1); mix(note.fret ?? -1);
                mix(note.octave ?? 0); mix(note.tone ?? 0); mix(note.percussionArticulation ?? -1);
                mix((note.isPalmMute ? 1 : 0) | (note.isLetRing ? 2 : 0) | (note.isHammerPullOrigin ? 4 : 0)
                  | (note.isStaccato ? 8 : 0) | (note.isDead ? 16 : 0) | (note.isGhost ? 32 : 0)
                  | (note.isLeftHandTapped ? 64 : 0) | (note.isTieDestination ? 128 : 0));
                mix(note.vibrato || 0); mix(note.accentuated || 0);
                mix(note.bendType || 0);
                if (note.bendPoints) { mix(note.bendPoints.length); for (const p of note.bendPoints) { mix(p.offset || 0); mix(p.value || 0); } }
                mix(note.harmonicType || 0); mix(note.slideOutType || 0); mix(note.slideInType || 0);
                mix(note.trillValue ?? -1); mix(note.trillSpeed || 0);
                mix(note.leftHandFinger ?? -1); mix(note.rightHandFinger ?? -1);
                mix(note.ornament ?? -1);
              }
            }
          }
        }
      }
    }
    return hash | 0;
  }
  function consolidate(score, options = {}) {
    // Serialization reconstructs index maps and linked beat chains after structural edits.
    const added=[];
    for (const track of score.tracks) for (const staff of track.staves) {
      const count = Math.max(0, ...staff.bars.map(bar=>bar.voices.length));
      for (const bar of staff.bars) while (bar.voices.length < count) {
        const voice = new m.Voice(); voice.addBeat(rest(1)); bar.addVoice(voice); added.push(voice);
      }
    }
    assignIds(score,'voice',added); assignIds(score,'beat',added.flatMap(voice=>voice.beats));
    const notes = score.tracks.flatMap(t=>t.staves.flatMap(s=>s.bars.flatMap(b=>b.voices.flatMap(v=>v.beats.flatMap(beat=>beat.notes)))));
    const live = new Set(notes);
    for (const note of notes) {
      if (note.tieOrigin && !live.has(note.tieOrigin)) clearIncomingTie(note);
      if (note.slurOrigin && !live.has(note.slurOrigin)) { note.slurOrigin = null; note.isSlurDestination = false; }
      for (const key of ['tieDestination','slurDestination','hammerPullOrigin','hammerPullDestination','slideOrigin','slideTarget']) {
        if (note[key] && !live.has(note[key])) note[key] = null;
      }
    }
    if (options.lightweight) {
      // Note-value edits leave bars, beats and timing intact: rebuild the derived lookup
      // maps and playback positions directly instead of a full JSON round-trip.
      score.finish(settings);
      return score;
    }
    return at.model.JsonConverter.jsonToScore(at.model.JsonConverter.scoreToJson(score),settings);
  }
  function rest(duration = 4) {
    const b = new m.Beat(); b.duration = duration; b.isEmpty = false; return b;
  }
  function fillBar(staff, numerator = 4, denominator = 4) {
    const bar = new m.Bar();
    const voice = new m.Voice();
    for (let i = 0; i < numerator; i++) voice.addBeat(rest(denominator));
    bar.addVoice(voice); staff.addBar(bar); return bar;
  }
  function assignIds(score, kind, incoming) {
    if (!incoming.length) return;
    const types={bar:m.Bar,voice:m.Voice,beat:m.Beat,note:m.Note};
    const added=new Set(incoming), used=new Set();
    for (const track of score.tracks) for (const staff of track.staves) for (const bar of staff.bars) {
      if (kind==='bar' && !added.has(bar)) used.add(bar.id);
      for (const voice of bar.voices) {
        if (kind==='voice' && !added.has(voice)) used.add(voice.id);
        for (const beat of voice.beats) {
          if (kind==='beat' && !added.has(beat)) used.add(beat.id);
          if (kind==='note') for (const note of beat.notes) if (!added.has(note)) used.add(note.id);
        }
      }
    }
    for (const item of incoming) {
      while (used.has(item.id)) item.id=new types[kind]().id;
      used.add(item.id);
    }
  }
  function assignBarIds(score, bars) {
    const voices=bars.flatMap(bar=>bar.voices), beats=voices.flatMap(voice=>voice.beats);
    assignIds(score,'bar',bars); assignIds(score,'voice',voices); assignIds(score,'beat',beats);
  }
  function nextChannels(score) {
    const used = new Set(score.tracks.flatMap(t => [t.playbackInfo.primaryChannel, t.playbackInfo.secondaryChannel]));
    const free = Array.from({length:16}, (_,i)=>i).filter(i=>i !== 9 && !used.has(i));
    if (!free.length) throw new Error('All 15 melodic MIDI channels are in use. Remove a track to add another.');
    return [free[0], free[1] ?? free[0]];
  }
  function addTrack(score, name = 'Acoustic Guitar', program = 25, tuning = tunings.standard, percussion = false) {
    const track = new m.Track(); track.name = name; track.shortName = name.slice(0, 10);
    track.playbackInfo.program = program;
    const channels = percussion ? [9, 9] : nextChannels(score);
    track.playbackInfo.primaryChannel = channels[0]; track.playbackInfo.secondaryChannel = channels[1];
    track.playbackInfo.volume = 12; track.playbackInfo.balance = 8;
    const staff = new m.Staff(); staff.isPercussion = percussion;
    staff.stringTuning = new m.Tuning('Custom', percussion ? [] : tuning.slice());
    staff.showTablature = !percussion && tuning.length > 0; staff.showStandardNotation = true;
    track.addStaff(staff); score.addTrack(track);
    for (const mb of score.masterBars) fillBar(staff, mb.timeSignatureNumerator, mb.timeSignatureDenominator);
    assignBarIds(score,staff.bars);
    return track;
  }
  function setInstrument(track, program) {
    if (track.isPercussion) return;
    const value = Math.max(0, Math.min(127, Math.floor(Number(program) || 0)));
    track.playbackInfo.program = value;
    // finish() writes an opening program automation; keep it in sync with the editor.
    // Later intentional instrument changes remain part of the imported song.
    for (const staff of track.staves) for (const voice of staff.bars[0]?.voices || []) {
      const beat = voice.beats[0];
      for (const automation of beat?.automations || []) {
        if (automation.type === m.AutomationType.Instrument && automation.ratioPosition === 0) automation.value = value;
      }
    }
  }
  function createScore(options = {}) {
    const {title = 'Untitled', artist = '', tempo = 120, numerator = 4, denominator = 4, bars = 4, track = []} = options;
    const score = new m.Score(); score.title = title; score.artist = artist;
    for (let i = 0; i < bars; i++) {
      const bar = new m.MasterBar(); bar.timeSignatureNumerator = numerator; bar.timeSignatureDenominator = denominator;
      if (i === 0) bar.tempoAutomations.push(m.Automation.buildTempoAutomation(false, 0, tempo, 2));
      score.addMasterBar(bar);
    }
    addTrack(score, ...track); score.finish(settings); return score;
  }
  function beatAt(score, pos, ensure = false) {
    const staff = score.tracks[pos.track]?.staves[pos.staff || 0];
    const bar = staff?.bars[pos.bar]; if (!bar) return null;
    const added=[];
    if (ensure) for (const current of staff.bars) while (current.voices.length <= pos.voice) {
      const v = new m.Voice();
      if (current === bar) {
        const mb = current.masterBar;
        for (let i=0;i<mb.timeSignatureNumerator;i++) v.addBeat(rest(mb.timeSignatureDenominator));
      } else v.addBeat(rest(1));
      current.addVoice(v); added.push(v);
    }
    if (ensure && bar.voices[pos.voice]?.isEmpty) {
      const v=bar.voices[pos.voice], mb=bar.masterBar;
      v.beats=[];
      for (let i=0;i<mb.timeSignatureNumerator;i++) v.addBeat(rest(mb.timeSignatureDenominator));
      assignIds(score,'beat',v.beats);
    }
    assignIds(score,'voice',added); assignIds(score,'beat',added.flatMap(v=>v.beats));
    return bar.voices[pos.voice]?.beats[pos.beat] || null;
  }
  function addBar(score) {
    const prev = score.masterBars.at(-1), bar = new m.MasterBar();
    bar.timeSignatureNumerator = prev.timeSignatureNumerator; bar.timeSignatureDenominator = prev.timeSignatureDenominator;
    score.addMasterBar(bar);
    const added=[];
    for (const t of score.tracks) for (const staff of t.staves) {
      const b = fillBar(staff, bar.timeSignatureNumerator, bar.timeSignatureDenominator);
      added.push(b);
      const p = staff.bars.at(-2); if (p) { b.clef = p.clef; b.keySignature = p.keySignature; b.keySignatureType = p.keySignatureType; }
    }
    assignBarIds(score,added);
  }
  // the standard Insert key adds a bar before the cursor, matching the meter and key of the bar it displaces.
  function insertBar(score, index) {
    index=Math.max(0,Math.min(score.masterBars.length,index));
    addBar(score);
    if (index===score.masterBars.length-1) return;
    score.masterBars.splice(index,0,score.masterBars.pop());
    for (const t of score.tracks) for (const s of t.staves) { const b=s.bars.pop(); s.bars.splice(index,0,b); const next=s.bars[index+1]; if (next) { b.clef=next.clef; b.keySignature=next.keySignature; b.keySignatureType=next.keySignatureType; } }
    const next=score.masterBars[index+1];
    setTimeSignature(score,index,next.timeSignatureNumerator,next.timeSignatureDenominator);
  }
  function removeBar(score, index) {
    if (score.masterBars.length < 2) throw new Error('Keep at least one bar in the song.');
    if (index === 0 && !score.masterBars[1].tempoAutomations.some(a=>a.ratioPosition===0)) {
      const prior = score.masterBars[0].tempoAutomations.reduce((last,a)=>!last || a.ratioPosition>last.ratioPosition ? a : last,null);
      if (prior) { prior.ratioPosition=0; score.masterBars[1].tempoAutomations.unshift(prior); }
    }
    score.masterBars.splice(index, 1);
    for (const t of score.tracks) for (const s of t.staves) s.bars.splice(index, 1);
  }
  const durationFactor=d=>d===2?1.75:d===1?1.5:1;
  function beatTicks(beat, mb) {
    if (beat.graceType !== m.GraceType.None) return 0;
    return beat.isFullBarRest ? 3840*mb.timeSignatureNumerator/mb.timeSignatureDenominator : 3840/beat.duration*durationFactor(beat.dots)*beat.tupletDenominator/beat.tupletNumerator;
  }
  function plainRest(b, tuplet = false) {
    return b.isRest && !b.isEmpty && !b.text && !b.lyrics && !b.chordId && !b.automations.length && !b.graceType && (tuplet || b.tupletNumerator===-1 || b.tupletNumerator===1) && !b.fade && !b.pop && !b.slap && !b.tap && !b.slashed && !b.deadSlapped && !b.brushType && !b.whammyBarType && !b.whammyBarPoints && !b.vibrato && !b.pickStroke && b.tremoloPicking===undefined && b.overrideDisplayDuration===undefined && !b.invertBeamDirection && b.preferredBeamDirection===null && !b.beamingMode && !b.crescendo && !b.golpe && !b.wahPedal && !b.rasgueado && !b.showTimer && b.timer===null && !b.style && !b.isLetRing && !b.isPalmMute && !b.isEffectSlurOrigin && !b.effectSlurOrigin && !b.effectSlurDestination && b.barreFret===-1 && !b.barreShape && b.dynamics===m.DynamicValue.F;
  }
  function makeRests(length) {
    const options=[];
    for (const d of [1,2,4,8,16,32,64]) for (const n of [0,1,2]) options.push({duration:d,dots:n,ticks:3840/d*durationFactor(n)});
    options.sort((a,b)=>b.ticks-a.ticks);
    const result=[];
    for (const option of options) while (length+1e-7>=option.ticks) {
      const b=rest(option.duration); b.dots=option.dots; result.push(b); length-=option.ticks;
    }
    if (Math.abs(length)>1e-7) throw Error('That duration cannot be represented with supported rests.');
    return result;
  }
  function setDuration(beat, duration, dots = beat.dots) {
    const voice=beat.voice, mb=voice.bar.masterBar;
    const ticks=b=>beatTicks(b,mb);
    const target=3840/duration*durationFactor(dots), old=ticks(beat), delta=target-old;
    if (![1,2,4,8,16,32,64].includes(duration) || ![0,1,2].includes(dots) || beat.graceType || beat.overrideDisplayDuration !== undefined || (beat.tupletNumerator !== -1 && beat.tupletNumerator !== 1)) throw Error('Cannot change this duration safely.');
    const index=voice.beats.indexOf(beat);
    let remove=0, replacement=[];
    if (delta>0) {
      let needed=delta;
      while (needed>1e-7 && plainRest(voice.beats[index+1+remove] || {})) {
        const length=ticks(voice.beats[index+1+remove]); remove++;
        if (length>needed) { replacement=makeRests(length-needed); needed=0; }
        else needed-=length;
      }
      const total=voice.beats.reduce((sum,b)=>sum+ticks(b),0);
      if (needed>1e-7 && (index+1+remove<voice.beats.length || total+needed>3840*mb.timeSignatureNumerator/mb.timeSignatureDenominator+1e-7)) throw Error('That duration overfills this bar. Shorten or remove another beat first.');
    } else if (delta<0) replacement=makeRests(-delta);
    assignIds(voice.bar.staff.track.score,'beat',replacement);
    beat.duration=duration; beat.dots=dots;
    for (const b of replacement) b.voice=voice;
    voice.beats.splice(index+1,remove,...replacement);
  }
  function setTuplet(score, pos, numerator) {
    const beat=beatAt(score,pos); if (!beat) throw Error('Select a beat first.');
    const denominators={3:2,5:4,6:4,7:4,9:8}, voice=beat.voice, mb=voice.bar.masterBar;
    if (![1,3,5,6,7,9].includes(numerator)) throw Error('Invalid tuplet numerator.');
    const index=voice.beats.indexOf(beat), count=beat.tupletNumerator;
    let start=index, remove=1, replacement=[];
    if (numerator===1) {
      if (count===-1 || count===1) return;
      const same=b=>b && b.tupletNumerator===count && b.tupletDenominator===beat.tupletDenominator && b.duration===beat.duration;
      while (start>0 && same(voice.beats[start-1])) start--;
      start+=Math.floor((index-start)/count)*count;
      const group=voice.beats.slice(start,start+count);
      if (group.length!==count || !group.every(same) || group.some(b=>b!==beat && !plainRest(b,true))) throw Error('Clear the other notes in this tuplet first.');
      replacement=makeRests(group.reduce((sum,b)=>sum+beatTicks(b,mb),0)-3840/beat.duration*durationFactor(beat.dots));
      remove=count;
    } else {
      if (beat.graceType || beat.dots || beat.isFullBarRest || beat.overrideDisplayDuration!==undefined || (count!==-1 && count!==1)) throw Error('Cannot change this beat to a tuplet safely.');
      let needed=(denominators[numerator]-1)*3840/beat.duration;
      while (needed>1e-7 && plainRest(voice.beats[index+remove] || {})) {
        const length=beatTicks(voice.beats[index+remove],mb); remove++;
        if (length>needed) { replacement=makeRests(length-needed); needed=0; }
        else needed-=length;
      }
      if (needed>1e-7) throw Error('Not enough room after this beat for a tuplet.');
      replacement.unshift(...Array.from({length:numerator-1},()=>{
        const b=rest(beat.duration); b.tupletNumerator=numerator; b.tupletDenominator=denominators[numerator]; return b;
      }));
    }
    assignIds(score,'beat',replacement);
    beat.tupletNumerator=numerator===1?-1:numerator; beat.tupletDenominator=numerator===1?-1:denominators[numerator];
    for (const b of replacement) b.voice=voice;
    voice.beats.splice(start,remove,beat,...replacement);
  }
  function addGraceNote(score, pos, type) {
    const selected=beatAt(score,pos), note=selected?.notes[pos.note || 0];
    if (!note) throw Error('Select a note first.');
    if (!['before','on'].includes(type)) throw Error('Invalid grace type.');
    const beat=rest(16), added=new m.Note(), staff=selected.voice.bar.staff;
    beat.graceType=type==='before'?m.GraceType.BeforeBeat:m.GraceType.OnBeat;
    added.string=note.string; added.fret=Math.max(0,note.fret-2);
    added.tone=note.tone; added.octave=note.octave; added.percussionArticulation=note.percussionArticulation;
    if (!staff.isStringed) added.fret=note.fret;
    assignIds(score,'beat',[beat]); assignIds(score,'note',[added]); beat.addNote(added);
    beat.voice=selected.voice;
    selected.voice.beats.splice(selected.voice.beats.indexOf(selected),0,beat);
    return beat;
  }
  function removeGraceNote(score, pos) {
    const beat=beatAt(score,pos);
    if (beat && beat.graceType!==m.GraceType.None) beat.voice.beats.splice(beat.voice.beats.indexOf(beat),1);
  }
  function setFermata(score, pos, type) {
    const beat=beatAt(score,pos); if (!beat) throw Error('Select a beat first.');
    const types={short:m.FermataType.Short,medium:m.FermataType.Medium,long:m.FermataType.Long};
    if (type!==null && !Object.hasOwn(types,type)) throw Error('Invalid fermata type.');
    const mb=beat.voice.bar.masterBar, offset=beat.playbackStart;
    const fermata=type===null?null:new m.Fermata();
    if (fermata) { fermata.type=types[type]; mb.addFermata(offset,fermata); }
    else mb.fermata?.delete(offset);
    for (const track of score.tracks) for (const staff of track.staves) for (const voice of staff.bars[pos.bar].voices) {
      for (const b of voice.beats) if (b.playbackStart===offset) b.fermata=fermata;
    }
  }
  function fermataAt(score, pos) {
    const beat=beatAt(score,pos), fermata=beat?.voice.bar.masterBar.fermata?.get(beat.playbackStart);
    return fermata ? ['short','medium','long'][fermata.type] ?? null : null;
  }
  function deleteBeat(score, pos) {
    const beat=beatAt(score,pos); if (!beat) throw Error('Select a beat first.');
    beat.notes=[]; beat.noteStringLookup.clear(); beat.noteValueLookup.clear(); beat.isEmpty=false;
  }
  function setTimeSignature(score, index, numerator, denominator) {
    const mb=score.masterBars[index];
    if (!mb || !Number.isInteger(numerator) || numerator<1 || numerator>32 || ![1,2,4,8,16,32,64].includes(denominator)) throw Error('Invalid time signature.');
    if (mb.timeSignatureNumerator===numerator && mb.timeSignatureDenominator===denominator) return;
    const target=3840*numerator/denominator, changes=[];
    for (const track of score.tracks) for (const staff of track.staves) for (const voice of staff.bars[index].voices) {
      if (voice.isEmpty || (voice.beats.length===1 && voice.beats[0].isFullBarRest)) continue;
      if (voice.beats.some(b=>b.graceType || b.overrideDisplayDuration!==undefined)) throw Error('Cannot safely change the time signature of a measure with grace notes or overridden durations.');
      let total=voice.beats.reduce((sum,b)=>sum+beatTicks(b,mb),0), remove=0;
      while (total>target+1e-7 && remove<voice.beats.length && plainRest(voice.beats[voice.beats.length-1-remove])) {
        total-=beatTicks(voice.beats[voice.beats.length-1-remove],mb); remove++;
      }
      if (total>target+1e-7) throw Error('Time signature change would remove notes or annotated rests.');
      const replacement=makeRests(target-total);
      changes.push({voice,remove,replacement});
    }
    assignIds(score,'beat',changes.flatMap(change=>change.replacement));
    for (const {voice,remove,replacement} of changes) {
      for (const beat of replacement) beat.voice=voice;
      voice.beats.splice(voice.beats.length-remove,remove,...replacement);
    }
    mb.timeSignatureNumerator=numerator; mb.timeSignatureDenominator=denominator;
  }
  function clearIncomingTie(note) {
    // Clearing the flag alone leaves serialized links that restore the old pitch.
    if (note.tieOrigin?.tieDestination === note) note.tieOrigin.tieDestination = null;
    if (note.bendOrigin === note.tieOrigin) note.bendOrigin = null;
    note.tieOrigin = null;
    note.isTieDestination = false;
  }
  function setNote(score, pos, data) {
    const beat = beatAt(score, pos, true); if (!beat) throw new Error('Select a beat first.');
    const staff = beat.voice.bar.staff;
    if (beat.isFullBarRest && !('duration' in data || 'dotted' in data) && ('fret' in data || 'string' in data || 'pitch' in data)) {
      const mb=beat.voice.bar.masterBar, length=mb.timeSignatureNumerator/mb.timeSignatureDenominator;
      const choices=[];
      for (const duration of [1,2,4,8,16,32,64]) for (const dots of [0,1,2]) {
        const value=(dots===2?1.75:dots===1?1.5:1)/duration;
        if (value<=length) choices.push({duration,dots,value});
      }
      choices.sort((a,b)=>b.value-a.value);
      if (!choices.length) throw Error('This measure is too short for a supported note duration.');
      setDuration(beat,choices[0].duration,choices[0].dots);
    }
    beat.isEmpty = false;
    if ('duration' in data || 'dotted' in data) setDuration(beat, Number(data.duration || beat.duration), 'dotted' in data ? (data.dotted ? 1 : 0) : beat.dots);
    if ('dynamics' in data) beat.dynamics = Number(data.dynamics);
    if ('text' in data) beat.text = data.text || null;
    if ('lyric' in data) beat.lyrics = data.lyric ? [data.lyric] : null;
    if ('chord' in data) {
      if (!data.chord) beat.chordId = null;
      else {
        const chord = new m.Chord(); chord.name = data.chord; chord.showDiagram = false; chord.showName = true;
        const id = 'chord-' + beat.id; staff.addChord(id, chord); beat.chordId = id;
      }
    }
    if (Object.keys(data).every(key => ['dynamics','text','lyric','chord','move'].includes(key))) return null;
    if (!beat.notes.length && !('fret' in data || 'string' in data || 'pitch' in data)) throw new Error('Select a note first.');
    let note;
    if (staff.isPercussion || !staff.isStringed) {
      note = beat.notes[pos.note || 0];
      if (!note) { note = new m.Note(); assignIds(score,'note',[note]); beat.addNote(note); }
      if ('pitch' in data) {
        const pitch = Math.max(0, Math.min(127, Number(data.pitch)));
        if (pitch !== (staff.isPercussion ? note.percussionArticulation : note.octave * 12 + note.tone)) clearIncomingTie(note);
        if (staff.isPercussion) note.percussionArticulation = pitch;
        else { note.string = -1; note.octave = Math.floor(pitch / 12); note.tone = pitch % 12; }
      }
    } else {
      // UI string 1 is the high E; alphaTab numbers from the lowest string.
      const selected = beat.notes[pos.note || 0];
      const str = 'string' in data ? staff.tuning.length + 1 - Math.max(1, Math.min(staff.tuning.length, Number(data.string || 1))) : selected?.string ?? staff.tuning.length;
      const occupied = beat.notes.find(n => n.string === str);
      if (data.move && selected && occupied && occupied !== selected) throw new Error('That string already has a note.');
      note = data.move && selected ? selected : occupied;
      if (!note) { note = new m.Note(); assignIds(score,'note',[note]); beat.addNote(note); }
      const fret = 'fret' in data ? Math.max(0, Math.min(36, Number(data.fret || 0))) : Math.max(0, note.fret);
      if (note.string !== str || note.fret !== fret) clearIncomingTie(note);
      note.string = str;
      note.fret = fret;
    }
    for (const key of ['isPalmMute','isLetRing','isHammerPullOrigin','isStaccato','isDead']) if (key in data) note[key] = !!data[key];
    if ('vibrato' in data) note.vibrato = data.vibrato ? m.VibratoType.Slight : m.VibratoType.None;
    if ('accent' in data) note.accentuated = data.accent ? m.AccentuationType.Normal : m.AccentuationType.None;
    if ('bend' in data) {
      const bend = Number(data.bend);
      note.bendPoints = null; note.bendType = bend ? m.BendType.Bend : m.BendType.None;
      if (bend) { note.addBendPoint(new m.BendPoint(0, 0)); note.addBendPoint(new m.BendPoint(60, bend)); }
    }
    if ('harmonic' in data) { note.harmonicType = Number(data.harmonic); note.harmonicValue = 12; }
    if ('slide' in data) note.slideOutType = Number(data.slide);
    if ('tie' in data) {
      if (data.tie) note.isTieDestination = true;
      else clearIncomingTie(note);
    }
    return note;
  }
  function insertBeat(score, pos) {
    const b = beatAt(score, pos, true); if (!b) throw new Error('Select a beat first.');
    if (b.graceType || b.overrideDisplayDuration !== undefined || ![1,2,4,8,16,32,64].includes(b.duration)) throw new Error('Cannot split this duration safely.');
    if (b.isFullBarRest) {
      const mb = b.voice.bar.masterBar;
      const half = mb.timeSignatureNumerator / mb.timeSignatureDenominator / 2;
      let split;
      for (const duration of [1,2,4,8,16,32,64]) for (const dots of [0,1,2]) {
        if (Math.abs((dots === 2 ? 1.75 : dots === 1 ? 1.5 : 1) / duration - half) < 1e-9) split = {duration, dots};
      }
      if (!split) throw new Error('This full-bar rest cannot be split evenly into two supported durations.');
      b.duration = split.duration; b.dots = split.dots;
      const added = rest(split.duration); added.dots = split.dots;
      assignIds(score,'beat',[added]);
      b.voice.insertBeat(b, added);
      return;
    }
    if (b.duration >= 64) throw new Error('The smallest inserted duration is a 64th note.');
    b.duration *= 2;
    const added = rest(b.duration); added.dots = b.dots;
    added.tupletNumerator = b.tupletNumerator; added.tupletDenominator = b.tupletDenominator;
    assignIds(score,'beat',[added]);
    b.voice.insertBeat(b, added);
  }
  function applyTuning(staff, tuning) {
    const beats=staff.bars.flatMap(b=>b.voices.flatMap(v=>v.beats));
    const allNotes=beats.flatMap(b=>b.notes);
    const pitches=new Map(allNotes.map(n=>[n,n.realValue]));
    const wasStringed=staff.isStringed, changedCount=staff.tuning.length!==tuning.length;
    const assignments=new Map();
    if(tuning.length && (!wasStringed||changedCount)) for(const beat of beats){
      if(beat.notes.length>tuning.length)throw Error('Some notes cannot be represented in that tuning. Keep the current tuning or transpose first.');
      const choices=beat.notes.map(note=>({note,options:tuning.map((pitch,idx)=>({string:tuning.length-idx,fret:pitches.get(note)-pitch-staff.capo})).filter(x=>x.fret>=0&&x.fret<=36 && (!assignments.has(note.tieOrigin) || x.string===assignments.get(note.tieOrigin).string)).sort((a,b)=>a.fret-b.fret)})).sort((a,b)=>a.options.length-b.options.length);
      const used=new Set();
      const assign=i=>{
        if(i===choices.length)return true;
        for(const option of choices[i].options)if(!used.has(option.string)){
          used.add(option.string);assignments.set(choices[i].note,option);
          if(assign(i+1))return true;
          used.delete(option.string);assignments.delete(choices[i].note);
        }
        return false;
      };
      if(!assign(0))throw Error('Some notes cannot be represented in that tuning. Keep the current tuning or transpose first.');
    }
    staff.stringTuning=new m.Tuning('Custom',tuning.slice());
    staff.showTablature=tuning.length>0;staff.showStandardNotation=true;
    allNotes.forEach(note=>{
      if(!tuning.length){note.string=-1;note.octave=Math.floor(pitches.get(note)/12);note.tone=pitches.get(note)%12;}
      else if(assignments.has(note))Object.assign(note,assignments.get(note));
    });
  }
  function pasteBar(score, json, sourcePos, targetPos) {
    const sourceScore = restore(json);
    const source = sourceScore.tracks[sourcePos.track]?.staves[sourcePos.staff];
    const dest = score.tracks[targetPos.track]?.staves[targetPos.staff];
    const bar = source?.bars[sourcePos.bar];
    if (!bar || !dest?.bars[targetPos.bar]) throw new Error('Select a measure to copy and a measure to paste into.');
    if (source.tuning.length !== dest.tuning.length || source.isPercussion !== dest.isPercussion) {
      throw new Error('Paste into a track with the same instrument/string layout.');
    }
    const sourceMeter = sourceScore.masterBars[sourcePos.bar], targetMeter = score.masterBars[targetPos.bar];
    if (sourceMeter.timeSignatureNumerator !== targetMeter.timeSignatureNumerator || sourceMeter.timeSignatureDenominator !== targetMeter.timeSignatureDenominator) {
      throw new Error('Paste into a measure with the same time signature.');
    }

    const used = {bar:new Set(),voice:new Set(),beat:new Set(),note:new Set()};
    for (const track of score.tracks) for (const staff of track.staves) for (const existing of staff.bars) {
      used.bar.add(existing.id);
      for (const voice of existing.voices) {
        used.voice.add(voice.id);
        for (const beat of voice.beats) {
          used.beat.add(beat.id);
          for (const note of beat.notes) used.note.add(note.id);
        }
      }
    }
    const freshId = (Type, ids) => {
      let id;
      do { id = new Type().id; } while (ids.has(id));
      ids.add(id);
      return id;
    };
    bar.id = freshId(m.Bar, used.bar);
    const chordIds = new Map();
    for (const voice of bar.voices) {
      voice.id = freshId(m.Voice, used.voice);
      for (const beat of voice.beats) {
        beat.id = freshId(m.Beat, used.beat);
        for (const note of beat.notes) note.id = freshId(m.Note, used.note);
        if (beat.chordId) {
          const chord = source.chords?.get(beat.chordId);
          if (!chord) beat.chordId = null;
          else {
            if (!chordIds.has(beat.chordId)) {
              let id = `paste-${beat.id}`;
              while (dest.chords?.has(id)) id += '-copy';
              chordIds.set(beat.chordId, id);
              dest.addChord(id, chord);
            }
            beat.chordId = chordIds.get(beat.chordId);
          }
        }
      }
    }
    bar.staff = dest; bar.index = targetPos.bar;
    dest.bars[targetPos.bar] = bar;
  }
  function copyBars(score, trackIndex, staffIndex, startBar, endBar) {
    const staff=score.tracks[trackIndex]?.staves[staffIndex];
    if (!Number.isInteger(startBar) || !Number.isInteger(endBar) || startBar<0 || endBar<startBar || !staff?.bars[endBar]) throw Error('Select measures to copy.');
    return {json:snapshot(score),track:trackIndex,staff:staffIndex,startBar,endBar};
  }
  function pasteBars(score, clip, target) {
    const source=restore(clip.json), staff=source.tracks[clip.track]?.staves[clip.staff];
    const dest=score.tracks[target.track]?.staves[target.staff];
    if (!dest || !staff || !Number.isInteger(target.bar) || target.bar<0 || !Number.isInteger(clip.startBar) || !Number.isInteger(clip.endBar) || clip.startBar<0 || clip.endBar<clip.startBar || !staff.bars[clip.endBar]) throw Error('Select measures to paste.');
    if (staff.tuning.length!==dest.tuning.length || staff.isPercussion!==dest.isPercussion) throw Error('Paste into a track with the same instrument/string layout.');
    for (let index=clip.startBar;index<=clip.endBar;index++) {
      const bar=target.bar+index-clip.startBar, mb=source.masterBars[index];
      while (score.masterBars.length<=bar) addBar(score);
      setTimeSignature(score,bar,mb.timeSignatureNumerator,mb.timeSignatureDenominator);
      pasteBar(score,clip.json,{track:clip.track,staff:clip.staff,bar:index},{...target,bar});
      const added=dest.bars[bar];
      assignBarIds(score,[added]); assignIds(score,'note',added.voices.flatMap(v=>v.beats.flatMap(b=>b.notes)));
    }
  }
  function transposeNotes(score, trackIndex, staffIndex, startBar, endBar, semitones) {
    const staff=score.tracks[trackIndex]?.staves[staffIndex];
    if (!staff || !Number.isInteger(startBar) || !Number.isInteger(endBar) || startBar<0 || endBar<startBar || !staff.bars[endBar]) throw Error('Select measures to transpose.');
    if (!Number.isInteger(semitones) || !semitones || Math.abs(semitones)>12) throw Error('Invalid transposition.');
    if (staff.isPercussion) return;
    const changes=new Map();
    for (const bar of staff.bars.slice(startBar,endBar+1)) for (const voice of bar.voices) for (const beat of voice.beats) {
      if (!staff.isStringed) {
        for (const note of beat.notes) {
          const pitch=Math.max(0,Math.min(127,note.octave*12+note.tone+semitones));
          changes.set(note,{octave:Math.floor(pitch/12),tone:pitch%12});
        }
        continue;
      }
      const choices=beat.notes.map(note=>{
        const fret=note.fret+semitones, pitch=staff.tuning[staff.tuning.length-note.string]+fret;
        const strings=fret>=0 && fret<=24?[note.string]:[note.string-1,note.string+1];
        const options=strings.filter(string=>string>=1 && string<=staff.tuning.length).map(string=>({string,fret:pitch-staff.tuning[staff.tuning.length-string]})).filter(x=>x.fret>=0 && x.fret<=24 && (!changes.has(note.tieOrigin) || x.string===changes.get(note.tieOrigin).string));
        return {note,options};
      }).sort((a,b)=>a.options.length-b.options.length);
      const used=new Set();
      const assign=i=>{
        if (i===choices.length) return true;
        const {note,options}=choices[i];
        for (const option of options) if (!used.has(option.string)) {
          used.add(option.string); changes.set(note,option);
          if (assign(i+1)) return true;
          used.delete(option.string); changes.delete(note);
        }
        return false;
      };
      if (!assign(0)) throw Error('A note would go off the fretboard.');
    }
    for (const [note,change] of changes) Object.assign(note,change);
  }
  function replaceBar(score, track, staff, index, json) {
    pasteBar(score,json,{track:0,staff:0,bar:0},{track,staff,bar:index});
  }
  function playbackBarAt(masterBars, tick) {
    if (!masterBars.length) return null;
    let low = 0, high = masterBars.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1, bar = masterBars[mid];
      if (tick < bar.start) high = mid - 1;
      else if (tick >= bar.end) low = mid + 1;
      else return bar;
    }
    return masterBars[Math.max(0, Math.min(masterBars.length - 1, low))];
  }
  function loopBounds(start, end, count) {
    const limit = Math.max(1, Math.floor(Number(count) || 1));
    const first = Math.max(1, Math.min(limit, Math.floor(Number(start) || 1)));
    return [first, Math.max(first, Math.min(limit, Math.floor(Number(end) || first)))];
  }
  const trackAutomationTypes={volume:m.AutomationType.Volume,pan:m.AutomationType.Balance,instrument:m.AutomationType.Instrument};
  function setTrackAutomation(score, trackIndex, barIndex, type, value) {
    if (!Object.hasOwn(trackAutomationTypes,type)) throw Error('Invalid track automation type.');
    if (value!==null && (!Number.isInteger(value) || value<0 || value>(type==='instrument'?127:16))) throw Error('Invalid track automation value.');
    const track=score.tracks[trackIndex], beat=beatAt(score,{track:trackIndex,bar:barIndex,voice:0,beat:0});
    if (!Number.isInteger(trackIndex) || !Number.isInteger(barIndex) || !beat) throw Error('Select a track and bar first.');
    const automationType=trackAutomationTypes[type];
    for (const staff of track.staves) for (const voice of staff.bars[barIndex]?.voices || []) for (const b of voice.beats) {
      b.automations=b.automations.filter(a=>a.type!==automationType);
    }
    if (value===null) return;
    const automation=new m.Automation();
    automation.type=automationType; automation.value=value;
    beat.automations.push(automation);
  }
  function trackAutomations(score, trackIndex) {
    const track=score.tracks[trackIndex];
    if (!Number.isInteger(trackIndex) || !track) throw Error('Select a track first.');
    const result=[];
    for (const staff of track.staves) for (const [barIndex,bar] of staff.bars.entries()) for (const voice of bar.voices) for (const beat of voice.beats) {
      for (const automation of beat.automations) {
        const type=Object.keys(trackAutomationTypes).find(type=>trackAutomationTypes[type]===automation.type);
        if (type) result.push({bar:barIndex,type,value:automation.value});
      }
    }
    return result.sort((a,b)=>a.bar-b.bar || a.type.localeCompare(b.type));
  }
  function setTempoRamp(score, startBar, endBar, fromBpm, toBpm) {
    if (!Number.isInteger(startBar) || !Number.isInteger(endBar) || startBar<0 || endBar<startBar || endBar>=score.masterBars.length) throw Error('Invalid tempo ramp range.');
    if (!Number.isFinite(fromBpm) || !Number.isFinite(toBpm) || fromBpm<=0 || toBpm<=0) throw Error('Invalid tempo ramp BPM.');
    for (let bar=startBar;bar<=endBar;bar++) {
      const mb=score.masterBars[bar], value=fromBpm+(toBpm-fromBpm)*(bar-startBar)/Math.max(1,endBar-startBar);
      mb.tempoAutomations=mb.tempoAutomations.filter(a=>a.ratioPosition!==0);
      mb.tempoAutomations.unshift(m.Automation.buildTempoAutomation(false,0,value,2));
    }
    return endBar-startBar+1;
  }
  // section clipboard lives in section-clipboard.js; load it lazily for direct model users.
  const sectionApi=()=>{if(typeof globalThis!=='undefined'&&globalThis.SectionClipboard)return globalThis.SectionClipboard;if(typeof module==='object'&&module.exports)return require('./section-clipboard.js');throw Error('Section clipboard is unavailable.');};
  const section=(name)=>(...args)=>sectionApi()[name](...args);
  return {setTrackAutomation, trackAutomations, setTempoRamp, insertBar, setTuplet, addGraceNote, removeGraceNote, setFermata, fermataAt, copyBars, pasteBars, transposeNotes, setInstrument, playbackBarAt, loopBounds, tunings, snapshot, restore, fingerprint, consolidate, createScore, addTrack, addBar, removeBar, beatAt, setDuration, deleteBeat, setTimeSignature, setNote, insertBeat, applyTuning, pasteBar, replaceBar, settings, gpxUncompressedSize, assertSafeScoreFile, MAX_GPX_UNCOMPRESSED_BYTES, copySection:section('copySection'), pasteSection:section('pasteSection'), cutSection:section('cutSection'), cutTrackBars:section('cutTrackBars')};
});
