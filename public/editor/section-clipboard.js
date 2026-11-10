/* Section clipboard: copy, cut and paste every track at once.
   Loaded after model.js; adds M.copySection / M.pasteSection / M.cutSection
   and the matching per-track cut helper. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/alphaTab.js'), require('./model.js'));
  else root.SectionClipboard = factory(root.alphaTab, root.ScoreModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (at, M) {
  'use strict';
  const m = at.model;

  function validateRange(score, startBar, endBar) {
    if (!Number.isInteger(startBar) || !Number.isInteger(endBar) || startBar < 0 || endBar < startBar || !score.masterBars[endBar]) {
      throw Error('Select bars to copy.');
    }
  }
  function usedIds(score) {
    const used = { bar: new Set(), voice: new Set(), beat: new Set(), note: new Set() };
    for (const track of score.tracks) for (const staff of track.staves) for (const bar of staff.bars) {
      used.bar.add(bar.id);
      for (const voice of bar.voices) {
        used.voice.add(voice.id);
        for (const beat of voice.beats) {
          used.beat.add(beat.id);
          for (const note of beat.notes) used.note.add(note.id);
        }
      }
    }
    return used;
  }
  function freshId(Type, ids) {
    let id;
    do { id = new Type().id; } while (ids.has(id));
    ids.add(id);
    return id;
  }
  function cloneAutomation(source) {
    const copy = new m.Automation();
    copy.isLinear = source.isLinear;
    copy.type = source.type;
    copy.value = source.value;
    copy.ratioPosition = source.ratioPosition;
    copy.text = source.text;
    copy.isVisible = source.isVisible;
    if (source.syncPointValue) copy.syncPointValue = source.syncPointValue;
    return copy;
  }
  function copyMasterBar(source, destination) {
    destination.timeSignatureNumerator = source.timeSignatureNumerator;
    destination.timeSignatureDenominator = source.timeSignatureDenominator;
    destination.timeSignatureCommon = source.timeSignatureCommon;
    destination.alternateEndings = source.alternateEndings;
    destination.isRepeatStart = source.isRepeatStart;
    destination.repeatCount = source.repeatCount;
    destination.isFreeTime = source.isFreeTime;
    destination.tripletFeel = source.tripletFeel;
    destination.isDoubleBar = source.isDoubleBar;
    destination.isAnacrusis = source.isAnacrusis;
    destination.displayScale = source.displayScale;
    destination.displayWidth = source.displayWidth;
    destination.section = source.section ? Object.assign(new m.Section(), { marker: source.section.marker, text: source.section.text }) : null;
    destination.tempoAutomations = source.tempoAutomations.map(cloneAutomation);
  }
  function restBar(bar, masterBar, used) {
    bar.voices = [];
    const voice = new m.Voice();
    voice.id = freshId(m.Voice, used.voice);
    for (let i = 0; i < masterBar.timeSignatureNumerator; i++) {
      const beat = new m.Beat();
      beat.id = freshId(m.Beat, used.beat);
      beat.duration = masterBar.timeSignatureDenominator;
      beat.isEmpty = false;
      voice.addBeat(beat);
    }
    bar.addVoice(voice);
  }
  function cloneBar(bar, sourceStaff, destinationStaff, index, used, chordIds) {
    bar.id = freshId(m.Bar, used.bar);
    for (const voice of bar.voices) {
      voice.id = freshId(m.Voice, used.voice);
      for (const beat of voice.beats) {
        beat.id = freshId(m.Beat, used.beat);
        for (const note of beat.notes) note.id = freshId(m.Note, used.note);
        if (beat.chordId) {
          const chord = sourceStaff.chords?.get(beat.chordId);
          if (!chord) beat.chordId = null;
          else {
            if (!chordIds.has(beat.chordId)) {
              let id = `section-${beat.id}`;
              while (destinationStaff.chords?.has(id)) id += '-copy';
              chordIds.set(beat.chordId, id);
              destinationStaff.addChord(id, chord);
            }
            beat.chordId = chordIds.get(beat.chordId);
          }
        }
      }
    }
    bar.staff = destinationStaff;
    bar.index = index;
    bar.nextBar = null;
    bar.previousBar = null;
  }
  function rebuild(score) {
    if (typeof score.rebuildRepeatGroups === 'function') score.rebuildRepeatGroups();
  }

  function copySection(score, startBar, endBar) {
    validateRange(score, startBar, endBar);
    return {
      kind: 'section',
      json: M.snapshot(score),
      startBar,
      endBar,
      size: endBar - startBar + 1,
      tracks: score.tracks.map(track => track.staves.length)
    };
  }

  function pasteSection(score, clip, atBar, options = {}) {
    if (!clip || clip.kind !== 'section' || !clip.json) throw Error('Copy a section first.');
    if (!Number.isInteger(atBar) || atBar < 0) throw Error('Select a bar to paste into.');
    if (!Number.isInteger(clip.startBar) || !Number.isInteger(clip.endBar) || clip.startBar < 0 || clip.endBar < clip.startBar) throw Error('Copy a section first.');
    const source = M.restore(clip.json);
    if (!source.masterBars[clip.endBar]) throw Error('Copy a section first.');
    const start = clip.startBar;
    const size = clip.endBar - clip.startBar + 1;
    const insert = !!options.insert;
    const target = insert ? Math.min(atBar, score.masterBars.length) : atBar;

    if (insert) for (let i = 0; i < size; i++) M.insertBar(score, target);
    else while (score.masterBars.length < target + size) M.addBar(score);

    for (let offset = 0; offset < size; offset++) {
      const sourceIndex = start + offset, destinationIndex = target + offset;
      copyMasterBar(source.masterBars[sourceIndex], score.masterBars[destinationIndex]);
    }

    const used = usedIds(score), mappedStaves = new Set();
    for (let trackIndex = 0; trackIndex < Math.min(source.tracks.length, score.tracks.length); trackIndex++) {
      const sourceTrack = source.tracks[trackIndex], destinationTrack = score.tracks[trackIndex];
      for (let staffIndex = 0; staffIndex < Math.min(sourceTrack.staves.length, destinationTrack.staves.length); staffIndex++) {
        const sourceStaff = sourceTrack.staves[staffIndex], destinationStaff = destinationTrack.staves[staffIndex];
        // A changed instrument or string layout is skipped instead of corrupting the target track.
        if (sourceStaff.tuning.length !== destinationStaff.tuning.length || sourceStaff.isPercussion !== destinationStaff.isPercussion) continue;
        const chordIds = new Map();
        for (let offset = 0; offset < size; offset++) {
          const sourceIndex = start + offset, destinationIndex = target + offset;
          const sourceBar = sourceStaff.bars[sourceIndex], destinationBar = destinationStaff.bars[destinationIndex];
          if (!sourceBar || !destinationBar) continue;
          cloneBar(sourceBar, sourceStaff, destinationStaff, destinationIndex, used, chordIds);
          destinationStaff.bars[destinationIndex] = sourceBar;
          mappedStaves.add(destinationStaff);
        }
      }
    }

    // Tracks or staves that have no counterpart in the clip still need full bars after an insert.
    if (insert) {
      for (const track of score.tracks) for (const staff of track.staves) {
        if (mappedStaves.has(staff)) continue;
        for (let offset = 0; offset < size; offset++) {
          const bar = staff.bars[target + offset];
          if (bar) restBar(bar, score.masterBars[target + offset], used);
        }
      }
    }

    rebuild(score);
    return { startBar: target, endBar: target + size - 1, size };
  }

  function cutSection(score, startBar, endBar) {
    const clip = copySection(score, startBar, endBar);
    const size = endBar - startBar + 1;
    if (score.masterBars.length - size < 1) throw Error('Keep at least one bar in the song.');
    for (let i = 0; i < size; i++) M.removeBar(score, startBar);
    rebuild(score);
    return clip;
  }

  function cutTrackBars(score, trackIndex, staffIndex, startBar, endBar) {
    const clip = M.copyBars(score, trackIndex, staffIndex, startBar, endBar);
    clip.kind = 'track';
    const staff = score.tracks[trackIndex]?.staves[staffIndex];
    const used = usedIds(score);
    for (let index = startBar; index <= endBar; index++) restBar(staff.bars[index], score.masterBars[index], used);
    return clip;
  }

  const api = { copySection, pasteSection, cutSection, cutTrackBars };
  if (M && typeof M === 'object') Object.assign(M, api);
  return api;
});
