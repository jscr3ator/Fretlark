'use strict';
const assert = require('node:assert/strict');
const {KIT, SHORTCUTS, byMidi, search, shortcutFor, mount} = require('./public/editor/drum-pad.js');
assert.deepEqual(KIT.map(piece => piece.midi).sort((a,b) => a-b), Array.from({length:47},(_,i) => i+35));
assert.match(byMidi(38).name,/snare/i);
assert.deepEqual(search('crash').map(piece => piece.midi),[49,57]);
assert.ok(search('clsd ht').some(piece => piece.midi === 42));
assert.equal(search('').length,47);
assert.equal(Object.keys(SHORTCUTS).length,12);
for (const [key,midi] of Object.entries(SHORTCUTS)) {
  assert.ok(byMidi(midi)); assert.equal(shortcutFor(key.toUpperCase()),midi);
}
assert.equal(shortcutFor('toString'),undefined);
class Element {
  constructor(tag,doc) { this.tagName=tag.toUpperCase(); this.ownerDocument=doc; this.children=[]; this.attributes={}; this.listeners={}; }
  append(...nodes) { for (const node of nodes) { node.parent=this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this),1); this.parent=null; }
  setAttribute(key,value) { this.attributes[key]=String(value); }
  addEventListener(type,fn) { (this.listeners[type] ||= new Set()).add(fn); }
  removeEventListener(type,fn) { this.listeners[type]?.delete(fn); }
  emit(type,props={}) {
    const event={target:this,preventDefault() { this.prevented=true; },...props};
    for (let node=this;node;node=node.parent) for (const fn of node.listeners[type] || []) fn(event);
    return event;
  }
}
const doc={createElement(tag) { return new Element(tag,doc); }};
const container=doc.createElement('div'), existing=doc.createElement('p'); container.append(existing);
let active=38; const hits=[];
const view=mount(container,{onHit:(...args) => hits.push(args),isActive:midi => midi===active});
const root=container.children[1], buttons=root.children.flatMap(group => group.children[1].children);
assert.equal(buttons.length,47);
const snare=buttons.find(button => button.attributes['aria-label']==='Acoustic Snare, MIDI 38');
assert.equal(snare.attributes['aria-pressed'],'true');
snare.emit('click'); assert.deepEqual(hits.pop(),[38,'Acoustic Snare']);
active=36; view.refresh(); assert.equal(snare.attributes['aria-pressed'],'false');
const kick=buttons.find(button => button.attributes['aria-label']==='Bass Drum 1, MIDI 36');
assert.equal(kick.attributes['aria-pressed'],'true');
assert.equal(kick.emit('keydown',{key:'K'}).prevented,true); assert.deepEqual(hits.pop(),[36,'Bass Drum 1']);
kick.emit('keydown',{key:'k',ctrlKey:true}); assert.equal(hits.length,0);
view.destroy(); assert.deepEqual(container.children,[existing]);
assert.equal(root.listeners.keydown.size,0);
console.log('PASS drum-pad');
