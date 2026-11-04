'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const filename = path.join(__dirname, 'public/editor/command-palette.js');
const { _score, _filter } = require(filename);
const commands = [
  { id: 'release', title: 'Bend release', group: 'Techniques' },
  { id: 'bend', title: 'Bend', group: 'Techniques', shortcut: 'B' },
  { id: 'palm', title: 'Palm mute', group: 'Techniques', keywords: ['dampen'] },
  { id: 'track', title: 'Add track', group: 'Tracks', enabled: () => false },
  { id: 'substring', title: 'Append', group: 'Edit' }
];
assert.equal(_filter('bend', commands)[0].command.id, 'bend');
assert.equal(_filter(' B ', commands)[0].command.id, 'bend');
assert.equal(_filter('pm', commands)[0].command.id, 'palm');
assert.ok(_score('ad', { title: 'Add duration' }) > _score('ad', { title: 'Azzd' }));
assert.ok(_score('bend', commands[0]) > _score('bend', { title: 'Unbend' }));
assert.equal(_filter('dampen', commands)[0].command.id, 'palm');
assert.equal(_filter('tracks', commands)[0].command.id, 'track');
assert.equal(_filter('?', commands).length, commands.length);
assert.equal(_filter('', commands).length, commands.length);
assert.equal(_filter('?', commands).find(row => row.command.id === 'track').disabled, true);
assert.equal(_filter('xyz', commands).length, 0);
assert.equal(_score('xyz', commands[0]), -Infinity);
assert.deepEqual(_filter('?', commands).map(row => row.command), commands);

// Only DOM operations used by the palette; events bubble to exercise real handlers.
class Element {
  constructor(tag, doc) {
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.hidden = false;
    this.value = '';
    this.textContent = '';
  }
  get isConnected() { return this === this.ownerDocument.body || !!this.parent?.isConnected; }
  append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
  replaceChildren() { this.children.forEach(node => { node.parent = null; }); this.children = []; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) { (this.listeners[type] ||= new Set()).add(fn); }
  removeEventListener(type, fn) { this.listeners[type]?.delete(fn); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  focus() { this.ownerDocument.activeElement = this; this.ownerDocument.emit('focusin', { target: this }); }
  select() {}
  scrollIntoView() {}
  emit(type, properties = {}) {
    const event = { target: this, preventDefault() {}, stopPropagation() { this.stopped = true; }, ...properties };
    for (let node = this; node; node = event.stopped ? null : node.parent) {
      for (const listener of node.listeners[type] || []) listener(event);
    }
  }
}
const doc = new Element('document', null);
doc.ownerDocument = doc;
doc.createElement = tag => new Element(tag, doc);
doc.body = doc.createElement('body');
doc.activeElement = doc.body;
const context = { window: {}, document: doc };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
assert.equal(typeof context.window.CommandPalette.create, 'function');
const previous = doc.createElement('button');
doc.body.append(previous);
previous.focus();
let enabled = false;
const calls = [], notifications = [];
const list = [
  ...Array.from({ length: 7 }, (_, i) => ({ id: String(i), title: 'Command ' + i, group: i % 2 ? 'Odd' : 'Even', run: value => calls.push([i, value]) })),
  { id: 'disabled', title: 'Disabled', group: 'Other', enabled: () => enabled, run: () => calls.push('disabled') },
  { id: 'tempo', title: '<Tempo & BPM>', group: 'Score', input: {
    placeholder: '20–400 BPM',
    parse(text) { const value = Number(text); if (!Number.isInteger(value) || value < 20 || value > 400) throw Error('Use 20–400 BPM'); return value; }
  }, run: value => calls.push(['tempo', value]) }
];
const palette = context.window.CommandPalette.create({ commands: list, onRun: (command, value) => notifications.push([command.id, value]) });
const overlay = doc.body.children.at(-1), dialog = overlay.children[0];
const field = dialog.children[1], chip = field.children[0], input = field.children[1];
const error = dialog.children[2], results = dialog.children[3], status = dialog.children[4];
const options = () => results.children.filter(node => node.attributes.role === 'option');
const key = (key, extra) => input.emit('keydown', { key, ...extra });
const type = value => { input.value = value; input.emit('input'); };
const selected = () => options().findIndex(node => node.attributes['aria-selected'] === 'true');
assert.equal(palette.isOpen(), false);
assert.equal(dialog.attributes.role, 'dialog');
assert.equal(dialog.attributes['aria-modal'], 'true');
assert.equal(dialog.attributes['aria-labelledby'], dialog.children[0].id);
palette.open();
assert.equal(doc.activeElement, input);
assert.equal(options().length, list.length);
assert.equal(selected(), 0);
key('ArrowUp'); assert.equal(selected(), list.length - 1);
key('ArrowDown'); assert.equal(selected(), 0);
assert.equal(input.attributes['aria-activedescendant'], options()[0].id);
key('Tab'); assert.equal(doc.activeElement, input);
previous.focus(); assert.equal(doc.activeElement, input);
type('xyz'); assert.equal(options().length, 0); assert.equal(status.hidden, false);
key('Enter'); assert.equal(palette.isOpen(), true);
type('Disabled');
assert.equal(options()[0].attributes['aria-disabled'], 'true');
key('Enter'); assert.equal(calls.length, 0); assert.equal(palette.isOpen(), true);
enabled = true;
type('Disabled'); enabled = false; // Recheck enabled() at activation, not just render time.
options()[0].emit('click'); assert.equal(calls.length, 0);
type('Tempo'); key('Enter');
assert.equal(chip.textContent, '<Tempo & BPM>');
assert.equal(input.placeholder, '20–400 BPM');
assert.equal(results.hidden, true);
type('bad'); key('Enter');
assert.equal(error.hidden, false);
assert.equal(error.textContent, 'Use 20–400 BPM');
assert.equal(input.attributes['aria-invalid'], 'true');
assert.equal(palette.isOpen(), true);
type('120'); assert.equal(error.hidden, true);
key('Enter', { isComposing: true }); assert.equal(palette.isOpen(), true);
key('Enter');
assert.deepEqual(calls.at(-1), ['tempo', 120]);
assert.deepEqual(notifications.at(-1), ['tempo', 120]);
assert.equal(palette.isOpen(), false); assert.equal(doc.activeElement, previous);
palette.open('Tempo'); key('Enter'); key('Escape');
assert.equal(palette.isOpen(), true); assert.equal(input.value, 'Tempo'); assert.equal(chip.hidden, true);
key('Escape'); assert.equal(palette.isOpen(), false);
palette.open('Command 2'); options()[0].emit('click');
assert.deepEqual(calls.at(-1), [2, undefined]);
palette.open();
assert.equal(options()[0].children[0].textContent, 'Command 2');
assert.equal(options()[1].children[0].textContent, '<Tempo & BPM>');
overlay.emit('click', { target: input }); assert.equal(palette.isOpen(), true);
overlay.emit('click'); assert.equal(palette.isOpen(), false); assert.equal(doc.activeElement, previous);
for (let i = 0; i < 7; i++) { palette.open('Command ' + i); key('Enter'); }
palette.open();
assert.deepEqual(options().slice(0, 5).map(node => node.children[0].textContent), [6, 5, 4, 3, 2].map(i => 'Command ' + i));
assert.notEqual(options()[5].children[0].textContent, 'Command 1');
palette.open('?');
assert.deepEqual(results.children.filter(node => node.className === 'command-palette-group').map(node => node.textContent), ['Even', 'Odd', 'Other', 'Score']);
palette.open('Tempo'); key('Enter');
palette.setCommands([list[0]]);
assert.equal(chip.hidden, true); assert.equal(options().length, 1);
palette.close();
palette.setCommands([]); palette.open();
assert.equal(options().length, 0); key('ArrowDown'); key('Enter');
assert.equal(calls.length, 9);
palette.close();
assert.equal(doc.listeners.focusin.size, 0);
console.log('Command palette: helper and fake DOM checks passed.');
