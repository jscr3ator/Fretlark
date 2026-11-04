(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DrumPad = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const groups = ['Kicks & snares', 'Toms', 'Cymbals', 'Hi-hat', 'Percussion'];
  const KIT = [
    [35,'Acoustic Bass Drum','Bass Drum',0], [36,'Bass Drum 1','Kick',0],
    [37,'Side Stick','Side Stick',0], [38,'Acoustic Snare','Snare',0],
    [39,'Hand Clap','Clap',0], [40,'Electric Snare','Elec Snare',0],
    [41,'Low Floor Tom','Floor Tom',1], [42,'Closed Hi-Hat','Closed Hat',3],
    [43,'High Floor Tom','High Floor Tom',1], [44,'Pedal Hi-Hat','Pedal Hat',3],
    [45,'Low Tom','Low Tom',1], [46,'Open Hi-Hat','Open Hat',3],
    [47,'Low-Mid Tom','Low-Mid Tom',1], [48,'Hi-Mid Tom','Hi-Mid Tom',1],
    [49,'Crash Cymbal 1','Crash 1',2], [50,'High Tom','High Tom',1],
    [51,'Ride Cymbal 1','Ride 1',2], [52,'Chinese Cymbal','China',2],
    [53,'Ride Bell','Ride Bell',2], [54,'Tambourine','Tambourine',4],
    [55,'Splash Cymbal','Splash',2], [56,'Cowbell','Cowbell',4],
    [57,'Crash Cymbal 2','Crash 2',2], [58,'Vibraslap','Vibraslap',4],
    [59,'Ride Cymbal 2','Ride 2',2], [60,'Hi Bongo','Hi Bongo',4],
    [61,'Low Bongo','Low Bongo',4], [62,'Mute Hi Conga','Mute Conga',4],
    [63,'Open Hi Conga','Open Conga',4], [64,'Low Conga','Low Conga',4],
    [65,'High Timbale','High Timbale',4], [66,'Low Timbale','Low Timbale',4],
    [67,'High Agogo','High Agogo',4], [68,'Low Agogo','Low Agogo',4],
    [69,'Cabasa','Cabasa',4], [70,'Maracas','Maracas',4],
    [71,'Short Whistle','Short Whistle',4], [72,'Long Whistle','Long Whistle',4],
    [73,'Short Guiro','Short Guiro',4], [74,'Long Guiro','Long Guiro',4],
    [75,'Claves','Claves',4], [76,'Hi Wood Block','Hi Woodblock',4],
    [77,'Low Wood Block','Low Woodblock',4], [78,'Mute Cuica','Mute Cuica',4],
    [79,'Open Cuica','Open Cuica',4], [80,'Mute Triangle','Mute Triangle',4],
    [81,'Open Triangle','Open Triangle',4]
  ].map(([midi,name,short,group]) => ({midi,name,short,group:groups[group]}));
  const SHORTCUTS = {k:36,s:38,h:42,o:46,c:49,r:51,'1':50,'2':48,'3':45,'4':41,p:44,b:53};
  function byMidi(midi) { return KIT.find(piece => piece.midi === midi); }
  function search(text) {
    const query = String(text || '').trim().toLowerCase();
    function matches(value) {
      let i = 0;
      for (const char of value.toLowerCase()) if (char === query[i]) i++;
      return i === query.length;
    }
    return KIT.filter(piece => matches(piece.name) || matches(piece.short));
  }
  function shortcutFor(key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(SHORTCUTS,key.toLowerCase()) ? SHORTCUTS[key.toLowerCase()] : undefined;
  }
  function mount(container, {onHit, isActive}) {
    const doc = container.ownerDocument, root = doc.createElement('div'), pads = [];
    root.className = 'drum-pad';
    for (const group of groups) {
      const section = doc.createElement('section'), heading = doc.createElement('h3'), grid = doc.createElement('div');
      section.className = 'drum-pad-group'; heading.className = 'drum-pad-heading'; heading.textContent = group;
      grid.className = 'drum-pad-grid'; section.append(heading,grid); root.append(section);
      for (const piece of KIT.filter(item => item.group === group)) {
        const button = doc.createElement('button'), label = doc.createElement('span'), number = doc.createElement('span');
        button.type = 'button'; button.className = 'drum-pad-button';
        button.setAttribute('aria-label',piece.name + ', MIDI ' + piece.midi);
        label.className = 'drum-pad-name'; label.textContent = piece.short;
        number.className = 'drum-pad-number'; number.textContent = String(piece.midi);
        button.append(label,number);
        const key = Object.keys(SHORTCUTS).find(key => SHORTCUTS[key] === piece.midi);
        if (key) { const chip = doc.createElement('kbd'); chip.textContent = key; button.append(chip); }
        button.addEventListener('click',() => onHit(piece.midi,piece.name));
        grid.append(button); pads.push({button,piece});
      }
    }
    function refresh() { for (const {button,piece} of pads) button.setAttribute('aria-pressed',String(!!isActive(piece.midi))); }
    function keydown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.isComposing || event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
      const midi = shortcutFor(event.key), piece = byMidi(midi);
      if (piece) { event.preventDefault(); onHit(piece.midi,piece.name); }
    }
    root.addEventListener('keydown',keydown); container.append(root); refresh();
    return {refresh, destroy() { root.removeEventListener('keydown',keydown); root.remove(); }};
  }
  return {KIT, SHORTCUTS, byMidi, search, shortcutFor, mount};
});
