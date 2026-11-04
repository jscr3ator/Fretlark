const assert=require('node:assert/strict');
const H=require('./public/editor/hand-position.js'),M=require('./public/editor/model.js');
const at=require('./public/editor/vendor/alphaTab.js');
const score=M.createScore(),track=score.tracks[0],pos={track:0,staff:0,bar:0,voice:0,beat:0,note:0};
const beat=M.beatAt(score,pos);
M.setNote(score,pos,{string:1,fret:5});M.setNote(score,pos,{string:2,fret:7});
let f=H.frame(track,[beat]);
assert.deepEqual(f.notes.map(n=>[n.string,n.fret,n.finger,n.suggested]),[[6,5,'1',true],[5,7,'3',true]]);
beat.notes[0].leftHandFinger=at.model.Fingers.Thumb;
f=H.frame(track,[beat]);assert.equal(f.notes[0].finger,'T');assert.equal(f.notes[0].suggested,false);
beat.notes[1].fret=31;f=H.frame(track,[beat]);assert.equal(f.notes[1].finger,'?','Do not invent finger for impossible stretch');
assert.ok(f.start<=5&&f.start+f.count>31,'All frets stay inside diagram');
beat.notes[0].fret=0;f=H.frame(track,[beat]);assert.equal(f.notes.length,1,'Open strings have no finger marker');assert.equal(f.notes[0].fret,31);
const openOnly=H.frame(track,[{...beat,notes:[{string:6,fret:0,leftHandFinger:-2}]}]);
assert.equal(openOnly.notes.length,0);assert.equal(openOnly.hasNotes,true,'Open notes stay distinct from rests without drawing markers');
beat.notes[0].isDead=true;beat.notes[0].fret=-1;f=H.frame(track,[beat]);assert.equal(f.notes[0].finger,'×');assert.equal(f.notes[0].fret,0);
assert.equal(H.frame(track,[beat,beat]).notes.length,2,'Repeated active beat cannot duplicate markers');
assert.equal(H.frame(track,[track.staves[0].bars[1].voices[0].beats[0]],10).notes.length,0,'Rest clears fingers');
assert.equal(H.frame(track,[],10).start,10,'Rest keeps fret window stable');
const bass=M.addTrack(score,'Bass',33,M.tunings.bass);M.setNote(score,{...pos,track:1},{string:4,fret:24});
assert.equal(H.frame(track,[bass.staves[0].bars[0].voices[0].beats[0]]).notes.length,0,'Other tracks cannot leak markers');
f=H.frame(bass,[bass.staves[0].bars[0].voices[0].beats[0]]);assert.equal(f.notes[0].string,1);assert.ok(f.start+f.count>24);
const piano=M.addTrack(score,'Piano',0,[]);assert.equal(H.frame(piano,[]).available,false);
track.staves[0].capo=3;assert.equal(H.frame(track,[beat]).capo,3);
// Generated playback lookup follows repeats and rests, using the same source as the guide.
score.masterBars[0].isRepeatStart=true;score.masterBars[1].repeatCount=2;
const generated=M.consolidate(score),settings=new at.Settings(),midi=new at.midi.MidiFile(),handler=new at.midi.AlphaSynthMidiFileHandler(midi);
const generator=new at.midi.MidiFileGenerator(generated,settings,handler);generator.generate();
const cache=generator.tickLookup;
const bar0=cache.masterBars[0],bar1=cache.masterBars[1],repeat=cache.masterBars[2];
assert.equal(repeat.masterBar.index,0);
for(const [played,hasNotes] of [[bar0,true],[bar1,false],[repeat,true]]){
 const lookup=cache.findBeat(new Set([0]),played.start);
 const rendered=H.frame(generated.tracks[0],lookup.beatLookup.highlightedBeats.map(i=>i.beat));
 assert.equal(rendered.notes.length>0,hasNotes);
}


// Nearby notes keep the camera still; only genuine hand shifts move the window.
{
 const s=M.createScore(),t=s.tracks[0],b=M.beatAt(s,pos);
 M.setNote(s,pos,{string:1,fret:5});
 const first=H.frame(t,[b]);b.notes[0].fret=6;
 const nearby=H.frame(t,[b],first.start,first.count);
 assert.equal(nearby.start,first.start,'Adjacent fret does not rebuild the diagram');
 b.notes[0].fret=24;const shifted=H.frame(t,[b],nearby.start,nearby.count);
 assert.ok(shifted.start<=24&&shifted.start+shifted.count>24);
 assert.equal(H.frame(t,[],shifted.start,shifted.count).start,shifted.start);
 const one={string:6,fret:5,finger:'1'},three={string:5,fret:7,finger:'3'};
 assert.deepEqual(H.matchContacts([one,three],[three,{...one,string:4}]),[1,0],'Chord order cannot swap finger identity');
 assert.deepEqual(H.matchContacts([one],[{...one,finger:'2'}]),[-1],'Changing fingers creates a new contact instead of morphing the label');
 assert.deepEqual(H.matchContacts([{...one,finger:'?'}],[{...one,fret:6,finger:'?'}]),[-1]);
}

// Exercise retained SVG markers and instant note targets, independently from animation timing.
{
 const node=()=>({style:{},attrs:{},text:{textContent:''},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},querySelector(){return this.text;}});
 let writes=0,markers=[],targets=[];
 const host={dataset:{},set innerHTML(html){writes++;const count=[...html.matchAll(/class="hand-marker"/g)].length;markers=Array.from({length:count},node);targets=Array.from({length:count},node);},querySelectorAll(selector){return selector==='.hand-marker'?markers:selector==='.hand-note-target'?targets:[];}};
 const view=H.create({host,status:{},detail:{},noteName:()=> 'E'}),s=M.createScore(),t=s.tracks[0],b=M.beatAt(s,pos);
 M.setNote(s,pos,{string:1,fret:5});b.notes[0].leftHandFinger=1;
 view.update(t,[b]);const original=markers.find(n=>n.attrs.visibility==='visible');const firstPosition=original.style.transform;
 b.notes[0].fret=6;view.update(t,[b],{animate:true,duration:90});
 assert.equal(writes,1,'Nearby note changes retain the SVG and animation state');
 assert.equal(markers.find(n=>n.attrs.visibility==='visible'),original);
 assert.notEqual(original.style.transform,firstPosition);assert.match(original.style.transition,/90ms/);
 assert.ok(targets.some(n=>n.attrs.visibility==='visible'&&n.attrs.transform.includes('288')),'Current-note target updates in the same call');
 view.update(t,[b],{animate:false});assert.equal(original.style.transition,'none','Seek snaps immediately even when the note is unchanged');
 b.notes[0].fret=7;view.update(t,[b],{animate:true,duration:5});assert.match(original.style.transition,/5ms/,'Fast notes cannot queue a long glide');
 const previousMedia=global.matchMedia;try{global.matchMedia=()=>({matches:true});b.notes[0].fret=6;view.update(t,[b],{animate:true});assert.equal(original.style.transition,'none','Reduced motion disables gliding');}finally{if(previousMedia)global.matchMedia=previousMedia;else delete global.matchMedia;}

 view.update(t,[],{animate:true});assert.ok(markers.every(n=>n.attrs.visibility==='hidden'));
 assert.ok(targets.every(n=>n.attrs.visibility==='hidden'),'Rests clear targets immediately');
}

// Context keeps the hand still across a run and ignores impossible stretches.
{
 const notes=fret=>[{fret,string:1}];
 assert.deepEqual(H.planHand([notes(5),notes(7),notes(5),notes(8)]),[5,5,5,5],'A run stays in one position');
 assert.deepEqual(H.planHand([notes(3),[],notes(12)]),[3,null,12],'Distant notes move the hand; rests are skipped');
 assert.equal(H.planHand([[{fret:1,string:1},{fret:9,string:2}]])[0],null,'A stretch wider than four frets has no position');
 assert.equal(H.planHand([[{fret:7,string:1,leftHandFinger:3}],notes(5)])[1],5,'Written fingering anchors the hand for neighbours');
 const s=M.createScore(),t=s.tracks[0],staffBeats=t.staves[0].bars[0].voices[0].beats;
 [[0,5],[1,7],[2,5],[3,8]].forEach(([i,fret])=>M.setNote(s,{...pos,beat:i},{string:1,fret}));
 const last=staffBeats[3],alone=H.frame(t,[last]);
 assert.equal(alone.notes[0].finger,'1','Without context the lowest note takes the index finger');
 const planned=H.frame(t,[last],null,5,{before:staffBeats.slice(0,3),after:[]});
 assert.equal(planned.notes[0].finger,'4','Context places fret 8 under the little finger in the fret-5 position');
 M.setNote(s,{...pos,beat:0},{string:1,fret:0});
 const withOpen=H.frame(t,[staffBeats[0]]);assert.deepEqual(withOpen.open,[6],'Open strings are reported separately from fingered notes');
 const chord=M.createScore(),ct=chord.tracks[0],cb=M.beatAt(chord,pos);
 [1,2,3].forEach(string=>M.setNote(chord,pos,{string,fret:3}));
 const barreFrame=H.frame(ct,[cb]);assert.deepEqual(barreFrame.barre&&[barreFrame.barre.fret,barreFrame.barre.finger],[3,'1'],'One finger across strings is a barre');
}

// A song-wide plan gives each beat one finger regardless of where playback starts, and previews the next note.
{
 H.invalidate();
 const s=M.createScore(),tr=s.tracks[0],beats=tr.staves[0].bars[0].voices[0].beats;
 [[0,5],[1,7],[2,5],[3,8]].forEach(([i,fret])=>M.setNote(s,{...pos,beat:i},{string:1,fret}));
 const plan=H.planStaff(tr.staves[0]);
 assert.deepEqual(beats.map(b=>plan.get(b)),[5,5,5,5],'Every beat in the run shares one hand position');
 const fingers=beats.map(b=>H.frame(tr,[b],null,5,{plan:true}).notes[0].finger);
 assert.deepEqual(fingers,['1','3','1','4'],'Planned fingers do not depend on where playback starts');
 const preview=H.frame(tr,[beats[0]],null,5,{plan:true,after:[beats[1],beats[2]]});
 assert.deepEqual(preview.next,[{string:6,fret:7}],'The next different note is previewed');
 assert.deepEqual(H.frame(tr,[beats[1]],null,5,{plan:true,after:[beats[2]]}).next,[{string:6,fret:5}]);
}

console.log('PASS: hand positions, stable camera, finger identity, immediate targets, adaptive motion, seeks, rests, repeats and reduced motion.');
