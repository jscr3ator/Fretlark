(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    let fingering = null;
    let drums = null;
    try { fingering = require('./midi-fingering.js'); } catch (e) { /* optional dependency */ }
    try { drums = require('./midi-drums.js'); } catch (e) { /* optional dependency */ }
    module.exports = factory(require('./vendor/tonejs-midi.js').Midi, fingering, drums);
  } else {
    root.FretlarkMidiImport = factory(
      root.Midi && (root.Midi.Midi || root.Midi),
      root.FretlarkFingering,
      root.FretlarkMidiDrums
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (MidiCtor, Fingering, Drums) {
  'use strict';

  const GUITAR = [64, 59, 55, 50, 45, 40];
  const BASS = [43, 38, 33, 28];
  const BASS5 = [43, 38, 33, 28, 23];
  const GUITAR7 = [64, 59, 55, 50, 45, 40, 35];
  const MAX_FRET = 24;
  const MAX_TRACKS = 16;
  const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  // alphaTab's dynamic velocities: ppp=15, pp=31, p=47, mp=63, mf=79, f=95, ff=111, fff=127.
  const DYNAMIC_NAMES = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

  function escapeTex(value) {
    return String(value == null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, ' ');
  }

  function midiToTexName(pitch) {
    const value = Math.round(pitch);
    return NOTE_NAMES[((value % 12) + 12) % 12] + (Math.floor(value / 12) - 1);
  }

  function tuningTextOf(tuning) {
    return tuning.map(midiToTexName).join(' ');
  }

  function durationOf(steps) { return 32 / steps; }

  function isPercussion(track) {
    return !!track.instrument.percussion || track.channel === 9;
  }

  function tempoAt(map, step) {
    let bpm = 120;
    for (const item of map) { if (item.step > step) break; bpm = item.bpm; }
    return bpm;
  }

  function timeSignatureAt(map, step) {
    let signature = { numerator: 4, denominator: 4 };
    for (const item of map) { if (item.step > step) break; signature = item; }
    return signature;
  }

  function buildBars(stepTicks, maxStep, timeSignatures, warnings) {
    const bars = [];
    let start = 0;
    while (start < maxStep) {
      const ts = timeSignatureAt(timeSignatures, start);
      const length = Math.max(1, Math.round(32 * ts.numerator / ts.denominator));
      bars.push({ start, end: start + length, numerator: ts.numerator, denominator: ts.denominator });
      start += length;
    }
    if (!bars.length) bars.push({ start: 0, end: 32, numerator: 4, denominator: 4 });
    for (const change of timeSignatures) {
      if (change.step === 0) continue;
      if (!bars.some(function (bar) { return bar.start === change.step; })) {
        warnings.push('Time signature change at tick ' + Math.round(change.step * stepTicks) + ' is not on a bar line; applied on the next bar.');
      }
    }
    return bars;
  }

  function firstControl(track, id) {
    const changes = track.controlChanges && track.controlChanges[id];
    if (!changes || !changes.length) return null;
    return changes[0].value;
  }

  function mixOf(track) {
    const volumeCC = firstControl(track, 7);
    const expression = firstControl(track, 11);
    const pan = firstControl(track, 10);
    const volume = volumeCC == null ? 100 / 127 : volumeCC;
    const expressive = expression == null ? 1 : expression;
    const effective = Math.max(0, Math.min(1, volume * expressive));
    return {
      volume: Math.max(0, Math.min(16, Math.round(effective * 16))),
      balance: pan == null ? 8 : Math.max(0, Math.min(16, Math.round(pan * 16)))
    };
  }

  function sustainIntervals(track, stepTicks, endStep) {
    const changes = track.controlChanges && track.controlChanges[64];
    if (!changes || !changes.length) return [];
    const intervals = [];
    let down = null;
    for (const change of changes) {
      const step = Math.round(change.ticks / stepTicks);
      if (change.value >= 0.5) {
        if (down == null) down = step;
      } else if (down != null) {
        if (step > down) intervals.push({ start: down, end: step });
        down = null;
      }
    }
    if (down != null && endStep > down) intervals.push({ start: down, end: endStep });
    return intervals;
  }

  function applySustain(notes, intervals) {
    if (!intervals.length) return;
    for (const note of notes) {
      for (const interval of intervals) {
        if (note.start < interval.end && note.end > interval.start) {
          if (interval.end > note.end) note.end = interval.end;
          note.letRing = true;
        }
      }
    }
  }

  // A single dynamic per beat, based on the loudest note of the chord.
  // Small velocity wobbles keep the previous dynamic, so the score does not
  // flicker between mp and mf on every beat of a humanised performance.
  function dynamicFor(velocity, previous) {
    const midiVelocity = Math.max(1, Math.min(127, Math.round((velocity == null ? 0.5 : velocity) * 127)));
    const level = (midiVelocity - 15) / 16;
    if (previous != null && Math.abs(level - previous) < 1.1) return previous;
    return Math.max(0, Math.min(7, Math.round(level)));
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values)).sort(function (a, b) { return a - b; });
  }

  // Quantize note onsets onto the readable 16th grid (even 32nd steps) and note
  // ends onto the finer 32nd grid, keeping ends so short notes are not stretched
  // to the next onset. Sustain pedal is applied after the song length (and
  // therefore the bars) is known.
  function quantizeNotes(track, stepTicks) {
    const sixteenthTicks = stepTicks * 2;
    const notes = track.notes.map(function (note) {
      const ticks = Math.max(0, note.ticks);
      const nearestStep = Math.round(ticks / stepTicks);
      const evenStep = Math.round(ticks / sixteenthTicks) * 2;
      // Keep onsets on the 16th grid unless the original sits far enough away
      // (over 40% of a 16th) that a 32nd onset is closer to the real timing.
      const start = Math.abs(nearestStep - evenStep) > 0.8 ? nearestStep : evenStep;
      // Longer notes end on the 16th (or 8th) grid so the score reads cleanly;
      // only short notes keep 32nd ends, where the difference is audible.
      const rawEnd = (note.ticks + note.durationTicks) / stepTicks;
      const grid = rawEnd - start >= 12 ? 4 : rawEnd - start >= 4 ? 2 : 1;
      return {
        start,
        end: Math.max(start + 1, Math.round(rawEnd / grid) * grid),
        pitch: Math.round(note.midi),
        velocity: Number.isFinite(note.velocity) ? note.velocity : 0.5,
        letRing: false,
        originalTicks: ticks
      };
    });

    // Fast runs can put two different pitches on the same 16th onset even though
    // they were most of a 16th apart. Keep the later note as a separate 32nd
    // onset (or the next free step) so the run stays melodic instead of becoming
    // a false chord. True chords (notes close together in time) are untouched.
    const occupied = new Map();
    for (const note of notes) occupied.set(note.start, (occupied.get(note.start) || 0) + 1);
    const byStart = new Map();
    for (const note of notes) {
      if (!byStart.has(note.start)) byStart.set(note.start, []);
      byStart.get(note.start).push(note);
    }
    const starts = Array.from(byStart.keys()).sort(function (a, b) { return a - b; });
    for (const start of starts) {
      const group = byStart.get(start).slice().sort(function (a, b) {
        return a.originalTicks - b.originalTicks || a.pitch - b.pitch;
      });
      for (let i = 1; i < group.length; i++) {
        const note = group[i];
        let collision = false;
        for (let j = 0; j < i; j++) {
          const other = group[j];
          if (other.start !== note.start) continue;
          if (other.pitch !== note.pitch && note.originalTicks - other.originalTicks > sixteenthTicks * 0.4) {
            collision = true;
            break;
          }
        }
        if (!collision) continue;
        occupied.set(note.start, occupied.get(note.start) - 1);
        let candidate = Math.round(note.originalTicks / stepTicks);
        if (candidate <= note.start) candidate = note.start + 1;
        while (occupied.get(candidate)) candidate++;
        note.start = candidate;
        note.end = Math.max(note.end, candidate + 1);
        occupied.set(candidate, 1);
      }
    }
    return notes;
  }

  // Build onset groups. Notes starting together but ending at different times are
  // split into at most two groups so the track can be written with two voices.
  function makeGroups(notes) {
    const byStart = new Map();
    for (const note of notes) {
      if (!byStart.has(note.start)) byStart.set(note.start, []);
      byStart.get(note.start).push(note);
    }
    const groups = [];
    for (const start of Array.from(byStart.keys()).sort(function (a, b) { return a - b; })) {
      // A chord whose notes are released a little apart is still one chord:
      // give its near-equal ends the longest one instead of splitting voices.
      const chordEnds = new Map();
      let clusterEnd = null;
      for (const end of uniqueSorted(byStart.get(start).map(function (note) { return note.end; })).reverse()) {
        if (clusterEnd == null || clusterEnd - end > Math.max(2, Math.round((clusterEnd - start) / 4))) clusterEnd = end;
        chordEnds.set(end, clusterEnd);
      }
      const byEnd = new Map();
      for (const original of byStart.get(start)) {
        const note = Object.assign({}, original, { end: chordEnds.get(original.end) });
        if (!byEnd.has(note.end)) byEnd.set(note.end, new Map());
        const pitches = byEnd.get(note.end);
        const old = pitches.get(note.pitch);
        if (!old || note.velocity > old.velocity) {
          pitches.set(note.pitch, { velocity: note.velocity, letRing: note.letRing });
        } else if (note.letRing) {
          old.letRing = true;
        }
      }
      const ends = Array.from(byEnd.keys()).sort(function (a, b) { return a - b; });
      let output = ends.map(function (end) {
        const pitches = byEnd.get(end);
        return {
          start,
          end,
          notes: Array.from(pitches.keys()).sort(function (a, b) { return a - b; }).map(function (pitch) {
            const info = pitches.get(pitch);
            return { pitch, velocity: info.velocity, letRing: info.letRing };
          })
        };
      });
      if (output.length > 2) {
        // Keep the shortest ending notes as their own group, and let the rest of
        // the chord ring to the longest end. This preserves every pitch when two
        // voices cannot carry more than two different releases.
        const merged = output[output.length - 1];
        for (let i = 1; i < output.length - 1; i++) {
          for (const note of output[i].notes) merged.notes.push(note);
        }
        merged.notes.sort(function (a, b) { return a.pitch - b.pitch; });
        output = [output[0], merged];
      }
      groups.push.apply(groups, output);
    }
    return groups;
  }

  function tuningFits(tuning, pitches, polyphony) {
    if (!tuning.length || tuning.length < polyphony) return false;
    for (const pitch of pitches) {
      let reachable = false;
      for (const open of tuning) {
        const fret = pitch - open;
        if (fret >= 0 && fret <= MAX_FRET) { reachable = true; break; }
      }
      if (!reachable) return false;
    }
    return true;
  }

  function customTuning(minPitch, maxPitch, polyphony) {
    const count = Math.max(polyphony, 4, Math.ceil((maxPitch - minPitch) / 5) + 1);
    const tuning = [];
    for (let i = 0; i < count; i++) tuning.push(maxPitch - i * 5);
    // Ensure the lowest open string is at or below the lowest note.
    while (tuning[tuning.length - 1] > minPitch) tuning.push(tuning[tuning.length - 1] - 5);
    return tuning;
  }

  function chooseTuning(program, notes) {
    if (!notes.length) return { tuning: GUITAR, text: tuningTextOf(GUITAR) };
    const pitches = uniqueSorted(notes.map(function (note) { return note.pitch; }));
    const minPitch = pitches[0];
    const maxPitch = pitches[pitches.length - 1];
    const byStart = new Map();
    for (const note of notes) {
      if (!byStart.has(note.start)) byStart.set(note.start, new Set());
      byStart.get(note.start).add(note.pitch);
    }
    let polyphony = 1;
    for (const set of byStart.values()) polyphony = Math.max(polyphony, set.size);

    const bassProgram = program >= 32 && program <= 39;
    const bases = bassProgram
      ? [{ tuning: BASS }, { tuning: BASS5 }, { tuning: GUITAR }, { tuning: GUITAR7 }]
      : [{ tuning: GUITAR }, { tuning: GUITAR7 }, { tuning: BASS }, { tuning: BASS5 }];
    const seen = new Set();
    const candidates = [];
    for (const shift of [0, -12, 12, -24, 24, -36, 36]) {
      for (const base of bases) {
        const tuning = base.tuning.map(function (pitch) { return pitch + shift; });
        const key = tuning.join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(tuning);
      }
    }
    for (const tuning of candidates) {
      if (tuningFits(tuning, pitches, polyphony)) return { tuning, text: tuningTextOf(tuning) };
    }
    const tuning = customTuning(minPitch, maxPitch, polyphony);
    return { tuning, text: tuningTextOf(tuning) };
  }

  function assignmentMatches(notes, pitches, tuning) {
    if (!Array.isArray(notes) || notes.length !== pitches.length) return false;
    const remaining = new Set(pitches);
    const used = new Set();
    for (const note of notes) {
      if (!note || !Number.isInteger(note.string) || note.string < 1 || note.string > tuning.length) return false;
      if (!Number.isFinite(note.fret) || note.fret < 0 || note.fret > MAX_FRET) return false;
      if (used.has(note.string)) return false;
      const pitch = tuning[note.string - 1] + note.fret;
      if (!remaining.has(pitch)) return false;
      remaining.delete(pitch);
      used.add(note.string);
    }
    return remaining.size === 0;
  }

  // Exact fallback assignment: never octave-shift a pitch just because it does not
  // fit the chosen tuning. The tuning is picked to make this succeed.
  function exactAssign(pitches, tuning) {
    const wanted = uniqueSorted(pitches).sort(function (a, b) { return b - a; });
    const choices = wanted.map(function (pitch) {
      const options = [];
      for (let string = 1; string <= tuning.length; string++) {
        const fret = pitch - tuning[string - 1];
        if (fret >= 0 && fret <= MAX_FRET) options.push({ pitch, string, fret });
      }
      options.sort(function (a, b) { return a.fret - b.fret || a.string - b.string; });
      return options;
    });
    const used = new Set();
    const chosen = [];
    function search(index) {
      if (index === wanted.length) return true;
      for (const option of choices[index]) {
        if (used.has(option.string)) continue;
        used.add(option.string);
        chosen[index] = option;
        if (search(index + 1)) return true;
        used.delete(option.string);
      }
      return false;
    }
    if (search(0)) return chosen.slice();
    // If a chord has more notes than distinct strings can carry, keep as many
    // exact pitches as possible (highest notes first).
    const result = [];
    const taken = new Set();
    for (const options of choices) {
      for (const option of options) {
        if (taken.has(option.string)) continue;
        taken.add(option.string);
        result.push(option);
        break;
      }
    }
    return result.sort(function (a, b) { return a.pitch - b.pitch; });
  }

  function chooseAssignments(groups, tuning, assign) {
    const pitchGroups = groups.map(function (group) {
      return uniqueSorted(group.notes.map(function (note) { return note.pitch; }));
    });
    let assigned = [];
    if (assign) {
      try { assigned = assign(pitchGroups, tuning, { maxFret: MAX_FRET, maxSpan: 4 }) || []; }
      catch (e) { assigned = []; }
    }
    if (!Array.isArray(assigned) || assigned.length !== pitchGroups.length) assigned = [];
    return pitchGroups.map(function (pitches, index) {
      const notes = assigned[index];
      if (assignmentMatches(notes, pitches, tuning)) {
        return notes.map(function (note) {
          return { pitch: tuning[note.string - 1] + note.fret, string: note.string, fret: note.fret };
        });
      }
      return exactAssign(pitches, tuning);
    });
  }

  // Players hold notes slightly into the next one (legato). Such small overlaps
  // are cut at the next onset, so only truly held notes need a second voice.
  function trimOverlaps(groups) {
    const starts = uniqueSorted(groups.map(function (group) { return group.start; }));
    let index = 0;
    for (const group of groups.slice().sort(function (a, b) { return a.start - b.start; })) {
      while (index < starts.length && starts[index] <= group.start) index++;
      const next = starts[index];
      if (next != null && group.end > next && group.end - next <= Math.max(2, Math.floor((group.end - group.start) / 4))) group.end = next;
    }
    return groups;
  }

  function assignVoices(groups, maxVoices) {
    trimOverlaps(groups);
    const voices = [];
    const sorted = groups.slice().sort(function (a, b) {
      return a.start - b.start || b.end - a.end;
    });
    for (const group of sorted) {
      let placed = false;
      for (const voice of voices) {
        const overlaps = voice.some(function (event) {
          return event.start < group.end && group.start < event.end;
        });
        if (!overlaps) {
          voice.push({ start: group.start, end: group.end, notes: group.notes });
          placed = true;
          break;
        }
      }
      if (!placed && voices.length < maxVoices) {
        voices.push([{ start: group.start, end: group.end, notes: group.notes }]);
        placed = true;
      }
      if (!placed) {
        // Both voices are busy. Shorten the note which would be cut off least,
        // then start the new group there; all onsets still keep their pitches.
        let bestVoice = 0;
        let bestIndex = 0;
        let bestEnd = Infinity;
        for (let v = 0; v < voices.length; v++) {
          for (let i = 0; i < voices[v].length; i++) {
            const event = voices[v][i];
            if (event.start < group.end && group.start < event.end && event.end < bestEnd) {
              bestEnd = event.end;
              bestVoice = v;
              bestIndex = i;
            }
          }
        }
        const event = voices[bestVoice][bestIndex];
        if (event && event.start < group.start) {
          event.end = group.start;
          voices[bestVoice].push({ start: group.start, end: group.end, notes: group.notes });
        } else if (event) {
          event.end = Math.max(event.end, group.end);
          for (const note of group.notes) event.notes.push(note);
        }
      }
    }
    const result = voices.filter(function (voice) {
      return voice.some(function (event) { return event.end > event.start && event.notes.length; });
    });
    // The busier voice is the main part and goes first (drawn in full black);
    // the occasional held or overlapping notes go to the lighter second voice.
    if (result.length === 2) {
      const noteCount = function (voice) {
        return voice.reduce(function (sum, event) { return sum + event.notes.length; }, 0);
      };
      if (noteCount(result[1]) > noteCount(result[0])) result.reverse();
    }
    return result;
  }

  // Fill the short release gaps players naturally leave before the next note.
  // Only longer notes benefit; stretching a short note would double its length.
  function closeGaps(events) {
    events.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
    for (let i = 0; i + 1 < events.length; i++) {
      const event = events[i];
      const next = events[i + 1];
      const gap = next.start - event.end;
      const duration = event.end - event.start;
      if (gap > 0 && duration >= 8 && gap <= Math.max(1, Math.floor(duration / 8))) {
        event.end = next.start;
      }
    }
  }

  // Biggest readable value that fits at this spot in the bar (sizes in 32nds; dotted values included).
  // Halves and dotted halves start on a beat, quarters and dotted quarters on an eighth, so syncopation stays legible.
  const SIZES = [[32, 32], [24, 8], [16, 8], [12, 4], [8, 4], [6, 2], [4, 2], [3, 1], [2, 1], [1, 1]];
  function pickSize(offset, room, barLength) {
    for (const [size, align] of SIZES) {
      if (size > room || offset % align) continue;
      if (size === 32 && (offset || barLength !== 32)) continue;
      return size;
    }
    return 1;
  }

  function splitSegment(segment, bars, isRest) {
    const events = [];
    let first = true;
    for (const bar of bars) {
      const start = Math.max(segment.start, bar.start);
      const end = Math.min(segment.end, bar.end);
      if (start >= end) continue;
      let pos = start;
      while (pos < end) {
        const size = pickSize(pos - bar.start, end - pos, bar.end - bar.start);
        events.push({
          start: pos, end: pos + size, notes: isRest ? [] : segment.notes,
          tie: !isRest && !first, rest: isRest,
          dynamic: segment.dynamic == null ? null : segment.dynamic
        });
        pos += size;
        first = false;
      }
    }
    return events;
  }

  function timelineSegments(events, endStep) {
    const segments = [];
    let cursor = 0, dynamic = null;
    for (const event of events) {
      if (event.start > cursor) {
        segments.push({ start: cursor, end: event.start, notes: null, dynamic: null });
      }
      const start = Math.max(cursor, event.start);
      const end = Math.max(start, event.end);
      if (end > start) {
        const velocity = event.notes.reduce(function (max, note) {
          return Math.max(max, note.velocity == null ? 0 : note.velocity);
        }, 0);
        segments.push({
          start, end, notes: event.notes,
          dynamic: (dynamic = dynamicFor(velocity, dynamic))
        });
        cursor = end;
      }
    }
    if (cursor < endStep) segments.push({ start: cursor, end: endStep, notes: null, dynamic: null });
    return segments;
  }

  function buildVoiceBars(events, bars, endStep) {
    closeGaps(events);
    const perBar = bars.map(function () { return []; });
    for (const segment of timelineSegments(events, endStep)) {
      const split = splitSegment(segment, bars, !segment.notes);
      for (const event of split) {
        let barIndex = 0;
        while (barIndex < bars.length && event.start >= bars[barIndex].end) barIndex++;
        if (barIndex < perBar.length) perBar[barIndex].push(event);
      }
    }
    return perBar;
  }

  function noteTex(fingerings, tie) {
    const values = fingerings.map(function (note) {
      const effects = [];
      if (note.letRing) effects.push('lr');
      if (tie) effects.push('-');
      return note.fret + '.' + note.string + (effects.length ? '{' + effects.join(' ') + '}' : '');
    });
    return values.length === 1 ? values[0] : '(' + values.join(' ') + ')';
  }

  function beatTex(event, state) {
    const steps = event.end - event.start, dotted = steps === 3 || steps === 6 || steps === 12 || steps === 24;
    const effects = [];
    if (dotted) effects.push('d');
    if (!event.rest && event.dynamic != null && event.dynamic !== state.lastDynamic) {
      effects.push('dy ' + DYNAMIC_NAMES[event.dynamic]);
      state.lastDynamic = event.dynamic;
    }
    const value = '.' + durationOf(dotted ? steps / 1.5 : steps)
      + (effects.length ? '{' + effects.join(' ') + '}' : '');
    const notes = event.rest ? 'r' : noteTex(event.notes, event.tie);
    return notes + value;
  }

  function ratioText(value) {
    return String(Number(value.toFixed(6)));
  }

  function barPrefix(bar, tempoMap, tempoState, signatureState) {
    let prefix = '';
    if (signatureState.last === null || signatureState.last.numerator !== bar.numerator || signatureState.last.denominator !== bar.denominator) {
      prefix += '\\ts (' + bar.numerator + ' ' + bar.denominator + ') ';
      signatureState.last = { numerator: bar.numerator, denominator: bar.denominator };
    }
    const startBpm = tempoAt(tempoMap, bar.start);
    if (startBpm !== tempoState.bpm) {
      prefix += '\\tempo ' + startBpm + ' ';
      tempoState.bpm = startBpm;
    }
    for (const change of tempoMap) {
      if (change.step < bar.start) continue;
      if (change.step >= bar.end) break;
      if (change.bpm === tempoState.bpm) continue;
      if (change.step === bar.start) {
        prefix += '\\tempo ' + change.bpm + ' ';
      } else {
        prefix += '\\tempo (' + change.bpm + ' ' + ratioText((change.step - bar.start) / (bar.end - bar.start)) + ') ';
      }
      tempoState.bpm = change.bpm;
    }
    return prefix;
  }

  function buildTrackLines(track, trackIndex, bars, tempoMap, tempoState, signatureState) {
    const lines = [];
    lines.push('\\track "' + escapeTex(track.name) + '" {instrument (' + track.program
      + ') volume ' + track.volume + ' balance ' + track.balance + '}');
    lines.push('\\staff {score tabs}');
    lines.push('\\tuning (' + track.tuningText + ')');

    const hasVoice2 = track.voices.length > 1 && track.voices[1].some(function (bar) {
      return bar.some(function (event) { return !event.rest && event.notes.length; });
    });
    if (hasVoice2) lines.push('\\voice');

    // alphaTab starts every track at forte.
    const state = { lastDynamic: 5 };
    for (let barIndex = 0; barIndex < bars.length; barIndex++) {
      const prefix = trackIndex === 0 ? barPrefix(bars[barIndex], tempoMap, tempoState, signatureState) : '';
      const beats = (track.voices[0][barIndex] || []).map(function (event) {
        return beatTex(event, state);
      }).join(' ');
      lines.push(prefix + beats + ' |');
    }

    if (hasVoice2) {
      lines.push('\\voice');
      for (let barIndex = 0; barIndex < bars.length; barIndex++) {
        const barEvents = track.voices[1][barIndex] || [];
        const hasNotes = barEvents.some(function (event) { return !event.rest && event.notes.length; });
        if (!hasNotes) {
          lines.push('|');
          continue;
        }
        const beats = barEvents.map(function (event) { return beatTex(event, state); }).join(' ');
        lines.push(beats + ' |');
      }
    }
    return lines;
  }

  function toAlphaTex(bytes, options) {
    options = options || {};
    if (!MidiCtor) throw new Error('The MIDI parser is unavailable.');
    let midi;
    try { midi = new MidiCtor(bytes); } catch (e) { throw new Error('This file is not a valid MIDI file.'); }
    const selected = [];
    const drumTracks = [];
    const warnings = [];
    let totalNotes = 0;

    for (const track of midi.tracks) totalNotes += track.notes.length;
    if (!totalNotes) throw new Error('This MIDI file has no notes.');

    midi.tracks.forEach(function (track, index) {
      if (!track.notes.length) return;
      if (isPercussion(track)) {
        drumTracks.push({ track, index });
        return;
      }
      selected.push({ track, index });
    });

    const drumModule = Drums || (typeof globalThis !== 'undefined' && globalThis.FretlarkMidiDrums) || null;
    const canImportDrums = !!(drumModule && typeof drumModule.trackTex === 'function');
    if (drumTracks.length && !canImportDrums) {
      warnings.push(drumTracks.length === 1
        ? 'The drum track was skipped.'
        : drumTracks.length + ' drum tracks were skipped.');
    }
    if (!selected.length && !(canImportDrums && drumTracks.length)) {
      throw new Error('This MIDI file has no guitar or bass parts (drum tracks are not imported yet).');
    }
    if (selected.length > MAX_TRACKS) {
      warnings.push('Only the first ' + MAX_TRACKS + ' tracks were imported; ' + (selected.length - MAX_TRACKS) + ' tracks were skipped.');
      selected.length = MAX_TRACKS;
    }
    const ppq = midi.header.ppq || 480;
    const stepTicks = ppq / 8;

    // Only mention the 16th grid when many notes sit well between grid lines (triplets or loose playing).
    let offGrid = 0, checked = 0;
    const onsetTicks = stepTicks * 2;
    for (const item of selected) for (const note of item.track.notes) {
      const r = note.ticks % onsetTicks; checked++;
      if (Math.min(r, onsetTicks - r) > onsetTicks / 4) offGrid++;
    }
    if (offGrid > checked * 0.2) warnings.push('Some notes did not fit a 16th-note grid (triplets or loose timing), so rhythms may need fixing.');

    const tempos = (midi.header.tempos || []).slice().sort(function (a, b) { return a.ticks - b.ticks; });
    const timeSignatures = (midi.header.timeSignatures || []).slice().sort(function (a, b) { return a.ticks - b.ticks; });
    const tempoMap = [];
    for (const tempo of tempos) {
      const step = Math.round(tempo.ticks / stepTicks);
      const bpm = Math.round(tempo.bpm * 100) / 100;
      const previous = tempoMap[tempoMap.length - 1];
      if (previous && previous.step === step) previous.bpm = bpm;
      else tempoMap.push({ step, bpm });
    }
    if (!tempoMap.length || tempoMap[0].step > 0) tempoMap.unshift({ step: 0, bpm: 120 });
    const tsMap = [];
    for (const signature of timeSignatures) {
      tsMap.push({
        step: Math.round(signature.ticks / stepTicks),
        numerator: signature.timeSignature[0],
        denominator: signature.timeSignature[1]
      });
    }
    if (!tsMap.length || tsMap[0].step > 0) tsMap.unshift({ step: 0, numerator: 4, denominator: 4 });

    const quantized = selected.map(function (item) {
      return { item, notes: quantizeNotes(item.track, stepTicks) };
    });
    // The song ends where the quantized notes end (drum hits count by onset), so a
    // note released a hair after the last bar line does not add an empty bar.
    let maxStep = 1;
    for (const entry of quantized) for (const note of entry.notes) maxStep = Math.max(maxStep, note.end);
    for (const track of midi.tracks) if (isPercussion(track)) {
      // Drums are rendered on 16ths, so measure the hit the same way.
      for (const note of track.notes) maxStep = Math.max(maxStep, (Math.round(note.ticks / (stepTicks * 2)) + 1) * 2);
    }
    // A held pedal keeps the last notes ringing, so the song lasts until it lifts.
    for (const entry of quantized) {
      for (const interval of sustainIntervals(entry.item.track, stepTicks, maxStep)) {
        if (entry.notes.some(function (note) { return note.start < interval.end && note.end > interval.start; })) {
          maxStep = Math.max(maxStep, interval.end);
        }
      }
    }

    const bars = buildBars(stepTicks, maxStep, tsMap, warnings);
    const endStep = bars[bars.length - 1].end;
    // Sustain intervals need the final song length, so apply them now.
    for (const entry of quantized) {
      applySustain(entry.notes, sustainIntervals(entry.item.track, stepTicks, endStep));
    }
    const assign = (options.fingering && options.fingering.assign)
      || (Fingering && Fingering.assign)
      || (typeof globalThis !== 'undefined' && globalThis.FretlarkFingering && globalThis.FretlarkFingering.assign);
    const usingFallback = !assign;

    // Preserve the original order (percussion and empty tracks were filtered out above).
    const tracks = quantized.map(function (entry) {
      const track = entry.item.track;
      const program = Math.max(0, Math.min(127, Math.round(track.instrument.number || 0)));
      const mix = mixOf(track);
      const tuning = chooseTuning(program, entry.notes);
      const groups = makeGroups(entry.notes);
      const voices = assignVoices(groups, 2);
      const allGroups = [];
      for (const voice of voices) for (const event of voice) {
        allGroups.push({ start: event.start, end: event.end, notes: event.notes });
      }
      const fingerings = chooseAssignments(allGroups, tuning.tuning, assign);
      let index = 0;
      const voiceBars = voices.map(function (voice) {
        for (const event of voice) {
          const assigned = fingerings[index++] || [];
          const byPitch = new Map();
          for (const note of event.notes) {
            if (!byPitch.has(note.pitch)) byPitch.set(note.pitch, { velocity: note.velocity, letRing: false });
            const info = byPitch.get(note.pitch);
            info.velocity = Math.max(info.velocity, note.velocity);
            if (note.letRing) info.letRing = true;
          }
          event.notes = assigned.map(function (note) {
            const info = byPitch.get(note.pitch);
            return {
              pitch: note.pitch,
              string: note.string,
              fret: note.fret,
              velocity: info ? info.velocity : 0,
              letRing: !!(info && info.letRing)
            };
          });
        }
        return buildVoiceBars(voice, bars, endStep);
      });
      return {
        name: track.name || (track.instrument && track.instrument.name ? track.instrument.name.replace(/^./, function (c) { return c.toUpperCase(); }) : 'Track ' + (entry.item.index + 1)),
        program,
        tuning: tuning.tuning,
        tuningText: tuning.text,
        volume: mix.volume,
        balance: mix.balance,
        voices: voiceBars
      };
    });

    if (usingFallback) warnings.push('Fingering helper unavailable; exact-pitch fallback fingering was used.');

    const tempoState = { bpm: tempoAt(tempoMap, 0) };
    const signatureState = { last: null };
    // Drum tracks are appended last through the optional drum importer.
    const drumLines = [];
    let drumNotes = 0;
    if (canImportDrums) {
      // The drum importer still works in 16th steps; bars are always on beats so
      // halving the 32nd-step boundaries is exact.
      const drumBars = bars.map(function (bar) {
        return {
          start: Math.round(bar.start / 2),
          end: Math.round(bar.end / 2),
          numerator: bar.numerator,
          denominator: bar.denominator
        };
      });
      for (const entry of drumTracks) {
        try {
          const mix = mixOf(entry.track);
          const tex = drumModule.trackTex(entry.track.notes, {
            stepTicks: ppq / 4,
            bars: drumBars,
            name: entry.track.name || (drumTracks.length > 1 ? 'Drums ' + (drumTracks.indexOf(entry) + 1) : 'Drums'),
            volume: mix.volume,
            balance: mix.balance,
            // With no melodic track, the first drum track carries meter and tempo.
            barPrefix: !tracks.length && !drumLines.length ? function (index) {
              return barPrefix(bars[index], tempoMap, tempoState, signatureState);
            } : null
          });
          if (tex && String(tex).trim()) {
            drumLines.push(String(tex));
            drumNotes += entry.track.notes.length;
          }
        } catch (e) {
          warnings.push('Could not import drum track "' + (entry.track.name || entry.index + 1) + '".');
        }
      }
    }

    let title = midi.header.name;
    if (!title) {
      title = String(options.fileName || 'MIDI import').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
    }
    if (!title) title = 'MIDI import';

    const lines = ['\\title "' + escapeTex(title) + '"', '\\tempo ' + tempoAt(tempoMap, 0)];
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
      lines.push.apply(lines, buildTrackLines(tracks[trackIndex], trackIndex, bars, tempoMap, tempoState, signatureState));
    }
    lines.push.apply(lines, drumLines);

    return {
      tex: lines.join('\n'),
      warnings,
      stats: {
        tracks: tracks.length,
        bars: bars.length,
        notes: selected.reduce(function (sum, item) { return sum + item.track.notes.length; }, 0) + drumNotes
      }
    };
  }

  return { toAlphaTex };
});
