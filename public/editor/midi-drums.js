(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FretlarkMidiDrums = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const keys = Array.from({ length: 53 }, (_, i) => i + 35);
  const dynamics = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
  const sizes = [[16, 16, 1], [12, 4, 2], [8, 4, 2], [6, 2, 4],
    [4, 2, 4], [3, 1, 8], [2, 1, 8], [1, 1, 16]];

  const level = velocity => Math.max(0, Math.min(7, Math.round((velocity * 127 - 15) / 16)));

  function trackTex(notes, ctx) {
    const grouped = new Map();
    for (const note of notes) {
      if (!Number.isFinite(note.ticks) || !Number.isFinite(note.midi)) continue;
      const step = Math.round(note.ticks / ctx.stepTicks);
      const key = Math.max(35, Math.min(87, Math.round(note.midi)));
      let beat = grouped.get(step);
      if (!beat) grouped.set(step, beat = { keys: new Map(), velocity: 0 });
      const velocity = Number.isFinite(note.velocity) ? note.velocity : 0;
      const articulation = keys[key - 35];
      beat.keys.set(articulation, Math.max(beat.keys.get(articulation) || 0, velocity));
      beat.velocity = Math.max(beat.velocity, velocity);
    }
    const steps = Array.from(grouped.keys()).sort((a, b) => a - b);
    const name = String(ctx.name || 'Drums').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ');
    const value = (n, fallback) => Number.isFinite(n) ? Math.max(0, Math.min(16, Math.round(n))) : fallback;
    const lines = ['\\track "' + name + '" {instrument percussion volume ' + value(ctx.volume, 12) + ' balance ' + value(ctx.balance, 8) + '}', '\\staff {score}'];
    let index = 0, lastDynamic = null, pendingDynamic = null;
    for (let barIndex = 0; barIndex < ctx.bars.length; barIndex++) {
      const bar = ctx.bars[barIndex];
      while (index < steps.length && steps[index] < bar.start) index++;
      let pos = bar.start;
      const output = [];
      // The bar's dynamic is its 75th-percentile hit level; it only changes when that moves by
      // two or more levels, or one level for two bars running, so marks do not flicker.
      const barLevels = [];
      for (let i = index; i < steps.length && steps[i] < bar.end; i++) {
        for (const velocity of grouped.get(steps[i]).keys.values()) barLevels.push(level(velocity));
      }
      let dynamic = lastDynamic ?? 4;
      if (barLevels.length) {
        barLevels.sort((a, b) => a - b);
        const target = barLevels[Math.min(barLevels.length - 1, Math.floor(barLevels.length * 0.5))];
        if (lastDynamic == null || Math.abs(target - lastDynamic) >= 2 || (target !== lastDynamic && target === pendingDynamic)) dynamic = target;
        pendingDynamic = target !== dynamic ? target : null;
      }
      while (pos < bar.end) {
        const hit = steps[index] === pos ? grouped.get(steps[index++]) : null;
        const end = Math.min(bar.end, index < steps.length ? steps[index] : bar.end);
        let first = true;
        while (pos < end) {
          const offset = pos - bar.start, room = end - pos;
          const size = sizes.find(([length, align]) => length <= room && offset % align === 0 &&
            (length !== 16 || (offset === 0 && bar.end - bar.start === 16)));
          const [length, , duration] = size;
          const effects = [];
          if (length === 12 || length === 6 || length === 3) effects.push('d');
          let symbol = 'r';
          if (hit && first) {
            // One dynamic per bar (set by its louder hits). Only clearly softer hits become ghost
            // notes and only clearly louder ones get accents, so the page stays readable while a
            // soft hi-hat under a hard kick still plays softer.
            const hitKeys = Array.from(hit.keys.keys()).sort((a, b) => a - b).map(articulation => {
              const offset = level(hit.keys.get(articulation)) - dynamic;
              return articulation + (offset <= -3 ? '{g}' : offset >= 3 ? '{hac}' : offset === 2 ? '{ac}' : '');
            });
            symbol = '(' + hitKeys.join(' ') + ')';
            if (dynamic !== lastDynamic) effects.push('dy ' + dynamics[dynamic]);
            lastDynamic = dynamic;
          }
          output.push(symbol + '.' + duration + (effects.length ? '{' + effects.join(' ') + '}' : ''));
          pos += length;
          first = false;
        }
      }
      lines.push((ctx.barPrefix ? ctx.barPrefix(barIndex) : '') + output.join(' ') + ' |');
    }
    return lines.join('\n');
  }
  return { trackTex };
});
