(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AsciiTab = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const pitchName = pitch => names[((pitch % 12) + 12) % 12];
  function length(beat, master) {
    if (beat.isFullBarRest) return 16 * master.timeSignatureNumerator / master.timeSignatureDenominator;
    const dots = 2 - Math.pow(0.5, beat.dots || 0);
    const tuplet = beat.tupletNumerator > 0 && beat.tupletDenominator > 0 ? beat.tupletDenominator / beat.tupletNumerator : 1;
    return 16 / (beat.duration || 4) * dots * tuplet;
  }
  function nextNote(staff, barIndex, voiceIndex, beatIndex, string) {
    for (let b = barIndex; b < staff.bars.length; b++) {
      const beats = staff.bars[b].voices[voiceIndex]?.beats || [];
      for (let i = b === barIndex ? beatIndex + 1 : 0; i < beats.length; i++) {
        const note = beats[i].notes.find(n => n.string === string);
        if (note) return note;
      }
    }
    return null;
  }
  function noteText(note, next) {
    let text = note.isDead ? 'x' : String(note.fret);
    if (note.isGhost) text = '(' + text + ')';
    if (note.harmonicType === 1) text = '<' + text + '>';
    if (note.isHammerPullOrigin || note.hammerPullDestination) text += next && next.fret < note.fret ? 'p' : 'h';
    if (note.slideOutType || note.slideTarget) {
      const target = note.slideTarget || next;
      text += target ? (target.fret < note.fret ? '\\' : '/') : ([4,5].includes(note.slideOutType) ? '\\' : '/');
    }
    const points = note.bendPoints || [];
    if (points.length) {
      const values = points.map(p => p.value), max = Math.max(...values);
      if (max > 0) text += 'b' + (note.fret + max / 2);
      if (values.some((v, i) => i > 0 && v < values[i - 1])) text += 'r';
    }
    if (note.vibrato || note.beat?.vibrato) text += '~';
    return text;
  }
  function renderStaff(score, staff, width) {
    const tuning = staff.tuning;
    const labels = tuning.map((pitch, i) => i === 0 && tuning.length === 6 && tuning.join(',') === '64,59,55,50,45,40' ? 'e' : pitchName(pitch));
    const labelWidth = Math.max(...labels.map(s => s.length));
    const prefix = labelWidth;
    const bars = staff.bars.map((bar, barIndex) => {
      const master = score.masterBars[barIndex];
      const events = new Map();
      bar.voices.forEach((voice, voiceIndex) => {
        let time = 0;
        voice.beats.forEach((beat, beatIndex) => {
          const key = Math.round(time * 1000000);
          if (!events.has(key)) events.set(key, []);
          events.get(key).push({beat, voiceIndex, beatIndex});
          time += length(beat, master);
        });
      });
      const times = [...events.keys()].sort((a,b) => a-b);
      const end = Math.max(0, ...bar.voices.map(v => v.beats.reduce((sum, beat) => sum + length(beat, master), 0)));
      const start = master.isRepeatStart ? '||:' : '|';
      const finish = master.repeatCount > 0 ? ':||' + (master.repeatCount > 2 ? 'x' + master.repeatCount : '') : '';
      const lines = labels.map(() => start);
      let pm = ' '.repeat(start.length);
      times.forEach((time, i) => {
        const entries = events.get(time), texts = labels.map(() => '');
        let muted = false;
        entries.forEach(({beat, voiceIndex, beatIndex}) => {
          muted ||= beat.isPalmMute || beat.notes.some(n => n.isPalmMute);
          beat.notes.forEach(note => {
            if (note.string >= 1 && note.string <= labels.length) texts[labels.length - note.string] = noteText(note, note.hammerPullDestination || nextNote(staff, barIndex, voiceIndex, beatIndex, note.string));
          });
        });
        const duration = (i + 1 < times.length ? times[i + 1] / 1000000 : end) - time / 1000000;
        const column = Math.max(1, Math.round(duration)) + Math.max(0, ...texts.map(t => t.length));
        lines.forEach((line, n) => { lines[n] += texts[n].padEnd(column, '-'); });
        pm += muted ? '-'.repeat(column) : ' '.repeat(column);
      });
      lines.forEach((line, n) => { lines[n] += finish; });
      pm += ' '.repeat(finish.length);
      const section = master.section ? [master.section.marker, master.section.text].filter(Boolean).join(' ') : '';
      return {lines, pm, section, repeatEnd: master.repeatCount > 0};
    });
    const systems = []; let group = [], size = prefix + 1;
    function flush() {
      if (!group.length) return;
      const total = group.reduce((n,b) => n + b.lines[0].length, 0) + 1;
      let sections = '', offset = 0;
      for (const bar of group) {
        if (bar.section) { sections = sections.padEnd(offset, ' ') + bar.section; }
        offset += bar.lines[0].length;
      }
      if (sections) systems.push(' '.repeat(prefix) + sections);
      const muted = group.map(b => b.pm).join('') + ' ';
      if (muted.includes('-')) {
        const first = muted.indexOf('-');
        systems.push((' '.repeat(prefix) + muted.slice(0, first) + 'PM' + muted.slice(first + 2)).trimEnd());
      }
      labels.forEach((label, i) => systems.push(label.padStart(labelWidth) + group.map(b => b.lines[i]).join('') + (group[group.length - 1].repeatEnd ? '' : '|')));
      group = []; size = prefix + 1;
    }
    for (const bar of bars) {
      if (group.length && size + bar.lines[0].length > width) { flush(); systems.push(''); }
      group.push(bar); size += bar.lines[0].length;
    }
    flush();
    return systems.join('\n');
  }
  function exportAscii(score, options = {}) {
    const {tracks = [0], width = 80, header = true} = options;
    const output = [];
    if (header) { if (score.title) output.push(score.title); if (score.artist) output.push(score.artist); }
    for (const index of tracks) {
      const track = score.tracks[index];
      if (!track) continue;
      if (output.length) output.push('');
      if (header) output.push(track.name || 'Track ' + (index + 1));
      for (const staff of track.staves) {
        if (staff.isPercussion || !staff.tuning?.length) { output.push('(standard notation track omitted)'); continue; }
        if (header) {
          output.push('Tuning: ' + staff.tuning.slice().reverse().map(pitchName).join(' '));
          if (staff.capo > 0) output.push('Capo: ' + staff.capo);
          output.push('Tempo: ' + (score.masterBars[0]?.tempoAutomations[0]?.value ?? score.tempo));
          output.push('');
        }
        output.push(renderStaff(score, staff, Math.max(1, Number(width) || 80)));
      }
    }
    return output.join('\n');
  }
  return {exportAscii};
});
