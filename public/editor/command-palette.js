(function (scope, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else scope.CommandPalette = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  let nextId = 0;
  const normalize = text => String(text || '').trim().toLowerCase();
  const isEnabled = command => !command.enabled || !!command.enabled();

  function subsequence(query, text) {
    let position = -1, score = 0;
    for (const letter of query.replace(/\s/g, '')) {
      const found = text.indexOf(letter, position + 1);
      if (found < 0) return -Infinity;
      score += 10;
      if (found === 0 || /[^\p{L}\p{N}]/u.test(text[found - 1])) score += 25;
      if (found === position + 1) score += 12;
      score -= found - position - 1;
      position = found;
    }
    if (text.startsWith(query)) score += 100;
    return score - text.length / 100;
  }

  // Higher is better; -Infinity means no match. enabled() never affects ranking.
  function score(query, command) {
    query = normalize(query);
    if (!query || query === '?') return 0;
    const title = normalize(command.title);
    if (query === normalize(command.shortcut)) return 2000;
    if (query === title) return 1000;
    return Math.max(subsequence(query, title),
      ...[...(command.keywords || []), command.group || ''].map(text =>
        subsequence(query, normalize(text)) - 40));
  }

  // Return rows without mutating commands; equal scores retain source order.
  function filter(query, commands) {
    return commands.map((command, index) => ({ command, index, score: score(query, command), disabled: !isEnabled(command) }))
      .filter(row => row.score !== -Infinity)
      .sort((a, b) => b.score - a.score || a.index - b.index);
  }

  function create({ commands, root = document.body, onRun }) {
    const doc = root.ownerDocument;
    const prefix = 'command-palette-' + (++nextId);
    let list = commands.slice(), recent = [], rows = [], selected = -1;
    let argument = null, search = '', previousFocus = null;
    const element = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const overlay = element('div', 'command-palette-overlay');
    overlay.hidden = true;
    const dialog = element('div', 'command-palette');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', prefix + '-heading');
    const heading = element('h2', 'command-palette-sr', 'Command palette');
    heading.id = prefix + '-heading';
    const field = element('div', 'command-palette-field');
    const chip = element('span', 'command-palette-chip');
    chip.hidden = true;
    const input = element('input', 'command-palette-input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', prefix + '-results');
    const error = element('p', 'command-palette-error');
    error.id = prefix + '-error';
    error.hidden = true;
    error.setAttribute('role', 'alert');
    input.setAttribute('aria-describedby', error.id);
    const results = element('div', 'command-palette-results');
    results.id = prefix + '-results';
    results.setAttribute('role', 'listbox');
    results.setAttribute('aria-label', 'Commands');
    const status = element('p', 'command-palette-status');
    status.setAttribute('role', 'status');
    status.hidden = true;
    const hint = element('div', 'command-palette-hint', '↑ ↓ Navigate · Enter Select · Esc Close · ? All commands');
    field.append(chip, input);
    dialog.append(heading, field, error, results, status, hint);
    overlay.append(dialog);
    root.append(overlay);

    function clearError() {
      error.hidden = true;
      error.textContent = '';
      input.removeAttribute('aria-invalid');
    }
    function showError(message) {
      error.textContent = message;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    }
    function select(index) {
      selected = index;
      rows.forEach((row, i) => row.node.setAttribute('aria-selected', String(i === selected)));
      if (rows[selected]) {
        input.setAttribute('aria-activedescendant', rows[selected].node.id);
        rows[selected].node.scrollIntoView?.({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }
    function render() {
      clearError();
      chip.hidden = !argument;
      chip.textContent = argument ? argument.title : '';
      input.placeholder = argument ? argument.input.placeholder : 'Search commands…';
      input.setAttribute('aria-label', argument ? argument.title + ' argument' : 'Search commands');
      input.setAttribute('aria-expanded', String(!argument));
      results.hidden = !!argument;
      results.replaceChildren();
      rows = [];
      status.hidden = true;
      hint.textContent = argument ? 'Enter Run · Esc Back' : '↑ ↓ Navigate · Enter Select · Esc Close · ? All commands';
      if (argument) { select(-1); return; }
      let matches = filter(input.value, list);
      const query = normalize(input.value);
      if (!query) {
        const rank = id => recent.includes(id) ? recent.indexOf(id) : recent.length;
        matches.sort((a, b) => rank(a.command.id) - rank(b.command.id) || a.index - b.index);
      }
      // The all-commands view groups entries without disturbing fuzzy result ranking.
      if (query === '?') {
        const groups = new Map();
        matches.forEach(row => {
          const group = row.command.group || 'Commands';
          if (!groups.has(group)) groups.set(group, []);
          groups.get(group).push(row);
        });
        matches = Array.from(groups.values()).flat();
      }
      let lastGroup;
      matches.forEach(row => {
        const group = !query && recent.includes(row.command.id) ? 'Recent' : row.command.group || 'Commands';
        if (group !== lastGroup) {
          const label = element('div', 'command-palette-group', group);
          label.setAttribute('role', 'presentation');
          results.append(label);
          lastGroup = group;
        }
        const node = element('div', 'command-palette-option');
        node.id = prefix + '-option-' + rows.length;
        node.setAttribute('role', 'option');
        node.setAttribute('aria-disabled', String(row.disabled));
        node.append(element('span', 'command-palette-title', row.command.title));
        if (row.command.shortcut) node.append(element('kbd', '', row.command.shortcut));
        const index = rows.length;
        node.addEventListener('mousedown', event => event.preventDefault());
        node.addEventListener('click', () => { select(index); activate(); });
        results.append(node);
        rows.push({ ...row, node });
      });
      if (!rows.length) {
        status.textContent = 'No commands found';
        status.hidden = false;
      }
      select(rows.length ? 0 : -1);
    }
    function close() {
      if (overlay.hidden) return;
      overlay.hidden = true;
      doc.removeEventListener('focusin', containFocus);
      input.setAttribute('aria-expanded', 'false');
      const target = previousFocus;
      previousFocus = null;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
    function activate() {
      const command = argument || rows[selected]?.command;
      if (!command) return;
      if (!isEnabled(command)) { render(); return; }
      if (!argument && command.input) {
        search = input.value;
        argument = command;
        input.value = '';
        render();
        input.focus();
        return;
      }
      let value;
      try {
        if (argument) value = command.input.parse(input.value);
      } catch (exception) {
        showError(exception.message || String(exception));
        return;
      }
      // Restore editor focus before running commands that may open another dialog.
      close();
      command.run(value);
      recent = [command.id, ...recent.filter(id => id !== command.id)].slice(0, 5);
      if (onRun) onRun(command, value);
    }
    function containFocus(event) {
      if (!overlay.hidden && !dialog.contains(event.target)) input.focus();
    }
    input.addEventListener('input', () => { if (argument) clearError(); else render(); });
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (argument) { argument = null; input.value = search; render(); }
        else close();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        activate();
      } else if (!argument && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        if (rows.length) select((selected + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        input.focus();
      }
    });
    return {
      open(prefill = '') {
        if (overlay.hidden) previousFocus = doc.activeElement;
        argument = null;
        input.value = prefill;
        overlay.hidden = false;
        render();
        doc.addEventListener('focusin', containFocus);
        input.focus();
        input.select();
      },
      close,
      isOpen: () => !overlay.hidden,
      setCommands(commands) {
        list = commands.slice();
        recent = recent.filter(id => list.some(command => command.id === id));
        argument = null;
        if (!overlay.hidden) { input.value = ''; render(); }
      }
    };
  }
  return { create, _score: score, _filter: filter };
}));
