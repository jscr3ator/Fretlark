(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.HandPosition=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const fretted=n=>n.fret>0&&!n.isDead&&Number.isInteger(n.fret)&&n.fret<=36;
  const authored=n=>Number.isInteger(n.leftHandFinger)&&n.leftHandFinger>=1&&n.leftHandFinger<=4;
  // Choose where the index finger sits for each group of notes. Looking at the notes around the
  // current one keeps the hand still across a run instead of re-guessing every beat.
  // groups: arrays of notes. Returns one position (fret under finger 1) per group, or null.
  function planHand(groups){
    const states=groups.map(notes=>{
      const frets=notes.filter(fretted).map(n=>n.fret);
      if(!frets.length)return null;
      const low=Math.min(...frets),high=Math.max(...frets);
      if(high-low>3)return {low,candidates:null};
      const written=notes.find(n=>fretted(n)&&authored(n));
      if(written)return {low,candidates:[Math.max(1,written.fret-written.leftHandFinger+1)]};
      const candidates=[];for(let p=Math.max(1,high-3);p<=low;p++)candidates.push(p);
      return {low,candidates};
    });
    const live=states.map((state,index)=>state?.candidates?index:-1).filter(index=>index>=0);
    const result=groups.map(()=>null);if(!live.length)return result;
    // Shifting the hand costs more the further it moves; sitting the index finger under the lowest note is preferred.
    const place=(state,p)=>.2*(state.low-p),move=(from,to)=>{const d=Math.abs(from-to);return Math.min(d,4)*.8+(d>3?1:0);};
    let table=states[live[0]].candidates.map(p=>({p,cost:place(states[live[0]],p),back:null}));const rows=[table];
    for(const index of live.slice(1)){
      const next=states[index].candidates.map(p=>{let best=null;for(const prior of table){const cost=prior.cost+move(prior.p,p);if(!best||cost<best.cost)best={cost,back:prior};}return {p,cost:best.cost+place(states[index],p),back:best.back};});
      rows.push(next);table=next;
    }
    let end=table.reduce((a,b)=>b.cost<a.cost?b:a);
    for(let i=rows.length-1;i>=0;i--){result[live[i]]=end.p;end=end.back;}
    return result;
  }
  // Planning the whole staff once means a note always shows the same finger, wherever playback starts.
  let plans=new WeakMap();
  function planStaff(staff){
    let plan=plans.get(staff);if(plan)return plan;
    plan=new Map();
    const voices=staff.bars.reduce((most,bar)=>Math.max(most,bar.voices.length),0);
    for(let v=0;v<voices;v++){
      const beats=staff.bars.flatMap(bar=>bar.voices[v]?.beats||[]);
      planHand(beats.map(b=>b.notes.filter(n=>Number.isInteger(n.string)&&n.string>0&&n.string<=staff.tuning.length))).forEach((position,i)=>{if(position!==null)plan.set(beats[i],position);});
    }
    plans.set(staff,plan);return plan;
  }
  function frame(track,beats,previousStart=null,previousCount=5,context=null){
    const staff=track?.staves.find(s=>s.isStringed&&!s.isPercussion);
    if(!staff)return {available:false,notes:[],start:1,count:5};
    const active=beats.filter(b=>b.voice.bar.staff===staff),hasNotes=active.some(b=>b.notes.length);
    const raw=active.flatMap(b=>b.notes)
      .filter(n=>(n.fret>0||n.isDead)&&Number.isInteger(n.string)&&n.string>0&&n.string<=staff.tuning.length&&Number.isInteger(n.fret)&&(n.fret>=0||n.isDead)&&n.fret<=36);
    const notes=[...new Map(raw.map(n=>[`${n.string}:${n.fret}`,n])).values()];
    const frets=notes.filter(n=>n.fret>0&&!n.isDead).map(n=>n.fret),min=frets.length?Math.min(...frets):(previousStart||1),max=frets.length?Math.max(...frets):min;
    const count=Math.max(5,previousCount,max-min+1),fits=previousStart!==null&&min>=previousStart&&max<previousStart+count;
    const desired=previousStart===null||min<previousStart?min-1:max-count+2;
    const start=frets.length&&!fits?Math.max(1,Math.min(min,Math.max(max-count+1,desired))):(previousStart||1);
    // Neighbouring beats on the same staff tell us which hand position this beat belongs to.
    const near=list=>(list||[]).filter(b=>b?.voice?.bar?.staff===staff).map(b=>b.notes.filter(n=>Number.isInteger(n.string)&&n.string>0&&n.string<=staff.tuning.length));
    const groups=[...near(context?.before),notes,...near(context?.after)],here=near(context?.before).length;
    // The song-wide plan wins when available; the nearby-notes plan covers anything it has not seen.
    const lead=context?.plan?active.find(b=>planStaff(staff).has(b)):null;
    const position=lead?planStaff(staff).get(lead):planHand(groups)[here];
    const markers=notes.map(n=>{
      const written=Number.isInteger(n.leftHandFinger)&&n.leftHandFinger>=0&&n.leftHandFinger<=4;
      const guess=position&&n.fret>=position&&n.fret<=position+3?String(n.fret-position+1):'?';
      const finger=n.isDead?'×':written?(n.leftHandFinger===0?'T':String(n.leftHandFinger)):n.fret>0?guess:'?';
      return {string:n.string,fret:Math.max(0,n.fret),finger,suggested:n.fret>0&&!n.isDead&&!written};
    });
    // Open strings ring at the nut; one finger across several strings of a fret is a barre.
    const open=[...new Set(active.flatMap(b=>b.notes).filter(n=>n.fret===0&&!n.isDead&&Number.isInteger(n.string)&&n.string>0&&n.string<=staff.tuning.length).map(n=>n.string))];
    let barre=null;
    for(const finger of ['1','2','3','4']){
      const group=markers.filter(m=>m.finger===finger&&m.fret>0);
      if(group.length>1&&new Set(group.map(m=>m.fret)).size===1){const strings=group.map(m=>m.string);barre={finger,fret:group[0].fret,from:Math.min(...strings),to:Math.max(...strings)};break;}
    }
    // A faint ring previews where the hand goes next, so the move is anticipated rather than sudden.
    const following=(context?.after||[]).find(b=>b?.voice?.bar?.staff===staff&&b.notes.some(n=>n.fret>0&&!n.isDead&&Number.isInteger(n.string)&&n.string>0&&n.string<=staff.tuning.length));
    const next=following?following.notes.filter(n=>n.fret>0&&!n.isDead&&Number.isInteger(n.string)&&n.string>0&&n.string<=staff.tuning.length&&!notes.some(c=>c.string===n.string&&c.fret===n.fret)).map(n=>({string:n.string,fret:n.fret})):[];
    const pitches=active.flatMap(b=>b.notes).filter(n=>!n.isDead&&Number.isInteger(n.string)&&n.string>0&&n.string<=staff.tuning.length&&Number.isInteger(n.fret)&&n.fret>=0).map(n=>staff.tuning[staff.tuning.length-n.string]+n.fret+(staff.capo||0));
    return {available:true,staff,hasNotes,pitches,notes:markers,open,barre,next,start,count,capo:staff.capo||0,suggested:markers.some(n=>n.suggested)};
  }
  function matchContacts(previous,next){
    const used=new Set(),result=next.map(note=>{
      const index=previous.findIndex((old,i)=>!used.has(i)&&old&&old.string===note.string&&old.fret===note.fret&&old.finger===note.finger);
      if(index>=0)used.add(index);return index;
    });
    next.forEach((note,i)=>{
      if(result[i]>=0||!['T','1','2','3','4'].includes(note.finger))return;
      let best=-1,distance=Infinity;
      previous.forEach((old,index)=>{if(!old||used.has(index)||old.finger!==note.finger)return;const d=Math.abs(old.fret-note.fret)+Math.abs(old.string-note.string)*.6;if(d<distance){distance=d;best=index;}});
      if(best>=0){result[i]=best;used.add(best);}
    });
    return result;
  }
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Names the chord when the sounding notes spell one exactly (a fifth may be left out of larger chords).
  const chordNames=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
  const chordShapes=[['',[0,4,7]],['m',[0,3,7]],['7',[0,4,7,10]],['maj7',[0,4,7,11]],['m7',[0,3,7,10]],['m(maj7)',[0,3,7,11]],['dim',[0,3,6]],['dim7',[0,3,6,9]],['m7b5',[0,3,6,10]],['aug',[0,4,8]],['sus2',[0,2,7]],['sus4',[0,5,7]],['7sus4',[0,5,7,10]],['6',[0,4,7,9]],['m6',[0,3,7,9]],['add9',[0,2,4,7]],['madd9',[0,2,3,7]],['9',[0,2,4,7,10]],['maj9',[0,2,4,7,11]],['m9',[0,2,3,7,10]],['5',[0,7]]];
  function detectChord(pitches){
    if(!Array.isArray(pitches)||!pitches.length)return null;
    const bass=Math.min(...pitches),classes=new Set(pitches.map(p=>((p%12)+12)%12));
    if(classes.size<2)return null;
    let best=null;
    for(let root=0;root<12;root++)for(const [quality,shape] of chordShapes){
      const tones=new Set(shape.map(i=>(root+i)%12));
      const missing=[...tones].filter(t=>!classes.has(t)),extra=[...classes].filter(c=>!tones.has(c));
      if(extra.length||missing.length>(shape.length>=4&&missing.every(t=>t===(root+7)%12)?1:0))continue;
      if(classes.size<3&&quality!=='5')continue;
      const score=(missing.length?1:0)*2+(((bass%12)+12)%12===root?0:1);
      if(!best||score<best.score)best={score,root,quality};
    }
    if(!best)return null;
    const bassClass=((bass%12)+12)%12;
    return chordNames[best.root]+best.quality+(bassClass===best.root?'':'/'+chordNames[bassClass]);
  }
  function create({host,status,detail,noteName,chord}){
    let start=1,count=5,layout='',signature='',openSignature='',markers=[],targets=[],opens=[],ghosts=[],barreEl=null,contacts=[],staff=null,positioned=false;
    function update(track,beats,{animate=false,duration=120,context=null}={}){
      const currentStaff=track?.staves.find(s=>s.isStringed&&!s.isPercussion);
      if(staff!==currentStaff){start=1;count=5;layout='';contacts=[];staff=currentStaff;positioned=false;}
      const f=frame(track,beats,positioned?start:null,count,context);start=f.start;count=f.count;
      if(f.notes.some(note=>note.fret>0))positioned=true;
      if(!f.available){host.innerHTML='<p class="hand-empty">Choose a guitar or bass track.</p>';status.textContent='No fretboard';opens=[];ghosts=[];barreEl=null;detail.textContent='Finger positions are available for fretted instruments.';layout='';signature='';return;}
      const strings=f.staff.tuning.length,key=JSON.stringify([f.staff.tuning,f.start,f.count,f.capo,Math.max(strings*4,f.notes.length)]);
      const x=fret=>fret===0?31:66+(fret-f.start+.5)*((510-66)/f.count),y=string=>30+(strings-string)*(110/Math.max(1,strings-1));
      const layoutChanged=layout!==key;
      if(layoutChanged){
        layout=key;signature='';openSignature='';
        const slots=Math.max(strings*4,f.notes.length),fretX=i=>66+i*444/f.count;
        const fretLines=Array.from({length:f.count+1},(_,i)=>`<rect x="${64.5+i*444/f.count}" y="18" width="3" height="134" rx="1.4" fill="url(#hand-metal)" class="hand-fret"/>`).join('');
        const fretNumbers=Array.from({length:f.count},(_,i)=>`<text x="${x(f.start+i)}" y="174" class="hand-fret-number">${f.start+i}</text>`).join('');
        const inlays=Array.from({length:f.count},(_,i)=>f.start+i).filter(fret=>[3,5,7,9,12,15,17,19,21,24].includes(fret)).map(fret=>[12,24].includes(fret)?`<circle cx="${x(fret)}" cy="63" r="3.7" fill="url(#hand-pearl)"/><circle cx="${x(fret)}" cy="107" r="3.7" fill="url(#hand-pearl)"/>`:`<circle cx="${x(fret)}" cy="85" r="3.7" fill="url(#hand-pearl)"/>`).join('');
        const stringLines=f.staff.tuning.map((pitch,i)=>{const lineY=y(strings-i),wound=strings<=4||i>=2,width=wound?1.4+i*.32:1+i*.2;return `<text x="9" y="${lineY+4}" class="hand-string-name">${escape(noteName(pitch))}</text><line x1="22" y1="${lineY+1}" x2="510" y2="${lineY+1}" stroke="#170e09" stroke-opacity=".45" stroke-width="${width+1}"/><line x1="22" y1="${lineY}" x2="510" y2="${lineY}" stroke="url(#${wound?'hand-bronze':'hand-steel'})" stroke-width="${width}" class="hand-string"/>${wound?`<line x1="22" y1="${lineY}" x2="510" y2="${lineY}" stroke="#64411f" stroke-width="${width}" stroke-dasharray=".6 1.3" stroke-opacity=".3"/>`:''}`;}).join('');
        const nextRings=Array.from({length:strings},()=>'<circle class="hand-next" r="11" visibility="hidden"/>').join('');
        const openRings=Array.from({length:strings},(_,i)=>`<circle class="hand-open" cx="45" cy="${y(i+1)}" r="5.5" visibility="hidden"/>`).join('');
        host.innerHTML=`<svg viewBox="0 0 530 186" role="img" aria-label="Acoustic guitar fretboard. High string at top. Frets are counted from the capo."><defs>
          <linearGradient id="hand-wood" x2="0" y2="1"><stop stop-color="#80533a"/><stop offset=".35" stop-color="#593625"/><stop offset=".8" stop-color="#68412c"/><stop offset="1" stop-color="#3c241b"/></linearGradient>
          <linearGradient id="hand-metal"><stop stop-color="#7d7469"/><stop offset=".25" stop-color="#f6f0e5"/><stop offset=".6" stop-color="#c5bdae"/><stop offset="1" stop-color="#716b63"/></linearGradient>
          <linearGradient id="hand-steel" gradientUnits="userSpaceOnUse" x1="22" y1="0" x2="510" y2="0"><stop stop-color="#f4f0e9"/><stop offset="1" stop-color="#a59d90"/></linearGradient>
          <linearGradient id="hand-bronze" gradientUnits="userSpaceOnUse" x1="22" y1="0" x2="510" y2="0"><stop stop-color="#edd4a2"/><stop offset=".5" stop-color="#c49a55"/><stop offset="1" stop-color="#8a612e"/></linearGradient>
          <radialGradient id="hand-pearl"><stop stop-color="#fff9e6"/><stop offset="1" stop-color="#beb19a"/></radialGradient>
          <pattern id="hand-grain" width="110" height="28" patternUnits="userSpaceOnUse"><path d="M0 4Q25 0 55 5T110 4M0 14Q40 19 75 12T110 15M0 25Q25 19 60 24T110 23" fill="none" stroke="#bf8c59" stroke-width=".7" opacity=".27"/><path d="M0 8Q30 12 65 7T110 9M0 22Q45 16 80 21T110 19" fill="none" stroke="#29190f" stroke-width=".6" opacity=".3"/></pattern>
        </defs><rect x="20" y="16" width="492" height="138" rx="8" fill="#ccb18b" stroke="#755039" stroke-width="1"/><rect x="22" y="18" width="488" height="134" rx="6" fill="url(#hand-wood)"/><rect x="22" y="18" width="488" height="134" rx="6" fill="url(#hand-grain)"/>${inlays}${fretLines}${f.start===1?'<rect x="61" y="18" width="6" height="134" rx="1" fill="#e8ddc3" stroke="#baab90" stroke-width=".6"/>':''}${stringLines}${fretNumbers}${openRings}<rect class="hand-barre" rx="14" visibility="hidden"/>${nextRings}<g class="hand-targets">${Array.from({length:Math.max(strings*4,f.notes.length)},()=>'<circle class="hand-note-target" r="16" visibility="hidden"/>').join('')}</g><g class="hand-markers">${Array.from({length:Math.max(strings*4,f.notes.length)},()=>'<g class="hand-marker" visibility="hidden"><circle r="13"/><text y="4"></text></g>').join('')}</g></svg>`;
        markers=[...host.querySelectorAll('.hand-marker')];targets=[...host.querySelectorAll('.hand-note-target')];opens=[...host.querySelectorAll('.hand-open')];ghosts=[...host.querySelectorAll('.hand-next')];barreEl=host.querySelectorAll('.hand-barre')[0]||null;contacts=[];
      }
      const openNow=f.open.join(',')+'|'+JSON.stringify(f.barre)+'|'+JSON.stringify(f.next)+'|'+f.start+'|'+f.count;
      if(openSignature!==openNow){
        openSignature=openNow;
        opens.forEach((ring,i)=>ring.setAttribute('visibility',f.open.includes(i+1)?'visible':'hidden'));
        const upcoming=f.next.filter(n=>n.fret>=f.start&&n.fret<f.start+f.count);
        ghosts.forEach((ring,i)=>{const n=upcoming[i];if(n){ring.setAttribute('cx',String(x(n.fret)));ring.setAttribute('cy',String(y(n.string)));ring.setAttribute('visibility','visible');}else ring.setAttribute('visibility','hidden');});
        if(barreEl){
          if(f.barre){const top=y(f.barre.to)-13,bottom=y(f.barre.from)+13;barreEl.setAttribute('x',String(x(f.barre.fret)-13));barreEl.setAttribute('y',String(top));barreEl.setAttribute('width','26');barreEl.setAttribute('height',String(bottom-top));barreEl.setAttribute('visibility','visible');}
          else barreEl.setAttribute('visibility','hidden');
        }
      }
      const next=JSON.stringify(f.notes);
      if(signature!==next||!animate){
        signature=next;
        const assignment=matchContacts(contacts,f.notes),used=new Set(assignment.filter(index=>index>=0)),nextContacts=markers.map(()=>null);
        const motion=animate&&!layoutChanged&&!(typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches);
        f.notes.forEach((note,i)=>{
          let index=assignment[i];const existing=index>=0;
          if(index<0){index=markers.findIndex((_,j)=>!used.has(j)&&!contacts[j]);if(index<0)index=markers.findIndex((_,j)=>!used.has(j));used.add(index);}
          const marker=markers[index],target=targets[index],position=`translate(${x(note.fret)}px, ${y(note.string)}px)`;
          marker.style.transition=motion&&existing?`transform ${Math.max(0,Math.min(140,duration))}ms cubic-bezier(.2,.75,.25,1)`:'none';
          marker.style.transform=position;marker.setAttribute('visibility','visible');
          marker.classList.toggle('suggested',note.suggested);marker.querySelector('text').textContent=note.finger;
          target.setAttribute('transform',`translate(${x(note.fret)} ${y(note.string)})`);target.setAttribute('visibility','visible');
          nextContacts[index]=note;
        });
        markers.forEach((marker,index)=>{if(!nextContacts[index]){marker.style.transition='none';marker.setAttribute('visibility','hidden');targets[index].setAttribute('visibility','hidden');}});
        contacts=nextContacts;
      }
      status.textContent=f.notes.length?(f.suggested?'Suggested':'From file'):f.hasNotes?'':'Rest';
      detail.textContent=f.notes.length?f.notes.map(n=>`String ${strings+1-n.string}, fret ${n.fret}${n.finger==='×'?' · muted':` · ${n.suggested?'suggested ':''}finger ${n.finger}`}`).join('; '):f.hasNotes?'No fretted notes.':'No notes on this beat.';
      if(chord){const name=detectChord(f.pitches);chord.textContent=name||'';chord.hidden=!name;}
      host.dataset.capo=String(f.capo);
      return f;
    }
    return {update};
  }
  return {frame,detectChord,planHand,planStaff,invalidate:()=>{plans=new WeakMap();},matchContacts,create};
});
