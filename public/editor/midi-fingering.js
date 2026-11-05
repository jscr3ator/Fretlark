(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FretlarkFingering = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function assign(groups, tuning, options = {}) {
    const maxFret = options.maxFret ?? 24, maxSpan = options.maxSpan ?? 4;
    if (!Array.isArray(groups) || !Array.isArray(tuning) || !tuning.length ||
        !tuning.every(Number.isInteger) || !Number.isInteger(maxFret) || maxFret < 0 ||
        !Number.isFinite(maxSpan) || maxSpan < 0) throw new RangeError('Invalid tuning or options');
    const low = Math.min(...tuning), high = Math.max(...tuning) + maxFret;
    const cache = new Map(), steps = [], result = groups.map(() => []);

    function candidates(group) {
      if (!Array.isArray(group) || !group.every(Number.isInteger)) throw new TypeError('Invalid group');
      let pitches = [...new Set(group)];
      if (pitches.length > tuning.length) {
        pitches.sort((a, b) => a - b);
        const kept = [];
        for (let left = 0, right = pitches.length - 1; kept.length < tuning.length;) {
          kept.push(pitches[left++]);
          if (kept.length < tuning.length) kept.push(pitches[right--]);
        }
        pitches = kept.sort((a, b) => a - b);
      }
      pitches = pitches.map(pitch => {
        if (pitch < low) pitch += 12 * Math.ceil((low - pitch) / 12);
        if (pitch > high) pitch -= 12 * Math.ceil((pitch - high) / 12);
        return pitch;
      });
      const key = pitches.join(',');
      if (cache.has(key)) return cache.get(key);
      const choices = pitches.map(pitch => tuning.flatMap((open, i) => {
        const fret = pitch - open;
        return fret >= 0 && fret <= maxFret ? [{ pitch, string: i + 1, fret }] : [];
      }));
      const order = choices.map((_, i) => i).sort((a, b) => choices[a].length - choices[b].length || a - b);
      let bestSpan = Infinity, found = [];
      const notes = [], used = new Set();
      function search(depth, min, max, sum, fretted) {
        const span = fretted ? max - min : 0;
        if (span > maxSpan && span > bestSpan) return;
        if (depth === order.length) {
          if (span > maxSpan) {
            if (span > bestSpan) return;
            if (span < bestSpan) found = [];
          } else if (bestSpan > maxSpan) found = [];
          bestSpan = Math.min(bestSpan, span);
          const position = fretted ? sum / fretted : 0;
          found.push({ notes: notes.slice(), position, cost: sum * 0.12 + span * 0.8 - (pitches.length - fretted) * 0.15 });
          return;
        }
        const index = order[depth];
        for (const note of choices[index]) {
          if (used.has(note.string)) continue;
          used.add(note.string); notes[index] = note;
          const fret = note.fret;
          search(depth + 1, fret ? Math.min(min, fret) : min, fret ? Math.max(max, fret) : max,
            sum + fret, fretted + (fret > 0 ? 1 : 0));
          used.delete(note.string);
        }
      }
      search(0, Infinity, 0, 0, 0);
      // Notes that compete for the same string (e.g. E2 and F2): drop an inner note and try again, keeping bass and melody.
      if (!found.length) return candidates(pitches.filter((_, i) => i !== (pitches.length > 2 ? 1 : pitches.length - 1)));
      found.sort((a, b) => a.cost - b.cost);
      found = found.slice(0, 40);
      cache.set(key, found);
      return found;
    }

    // Rests preserve the previous hand position.
    for (let index = 0; index < groups.length; index++) {
      const group = groups[index];
      if (!Array.isArray(group)) throw new TypeError('Invalid group');
      if (!group.length) continue;
      const current = candidates(group), previous = steps[steps.length - 1];
      const costs = [], back = [];
      for (let i = 0; i < current.length; i++) {
        let best = Infinity, bestIndex = 0;
        if (!previous) best = 0;
        else for (let j = 0; j < previous.candidates.length; j++) {
          const cost = previous.costs[j] + Math.abs(current[i].position - previous.candidates[j].position);
          if (cost < best) { best = cost; bestIndex = j; }
        }
        costs.push(best + current[i].cost); back.push(bestIndex);
      }
      steps.push({ index, candidates: current, costs, back });
    }
    if (steps.length) {
      let choice = 0, last = steps[steps.length - 1];
      for (let i = 1; i < last.costs.length; i++) if (last.costs[i] < last.costs[choice]) choice = i;
      for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        result[step.index] = step.candidates[choice].notes.map(note => ({ ...note }));
        choice = step.back[choice];
      }
    }
    return result;
  }
  return { assign };
});
