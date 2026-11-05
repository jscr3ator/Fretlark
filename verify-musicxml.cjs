'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const at = require('./public/editor/vendor/alphaTab.js');
const { zipSync, strToU8 } = require('./public/editor/vendor/fflate.js');
const dir = path.join(__dirname, 'test/fixtures/musicxml');
fs.mkdirSync(dir, { recursive: true });
at.Logger.logLevel = at.LogLevel.None;
const settings = new at.Settings();
const load = bytes => at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes), settings);
const write = (name, data) => { fs.writeFileSync(path.join(dir, name), data); return data; };
const note = (step, octave, duration, type, extra = '') => `<note><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><type>${type}</type>${extra}</note>`;
const attrs = '<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>';
const partDef = (id, name, extra = '') => `<score-part id="${id}"><part-name>${name}</part-name>${extra}</score-part>`;
const doc = (defs, parts, title = '<work><work-title>Original Study</work-title></work><identification><creator type="composer">Test Composer</creator></identification>') => `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0">${title}<part-list>${defs}</part-list>${parts}</score-partwise>`;
const part = (id, measures) => `<part id="${id}">${measures}</part>`;
const measure = (n, content) => `<measure number="${n}">${content}</measure>`;
const defs = partDef('P1', 'Guitar');
const plain = doc(defs, part('P1', measure(1, attrs + '<direction><sound tempo="96"/></direction>' + note('C', 4, 2, 'quarter') + note('E', 4, 4, 'half'))));
const tabDetails = '<staff-details><staff-lines>6</staff-lines>' + [['E',2],['A',2],['D',3],['G',3],['B',3],['E',4]].map(([s,o],i)=>`<staff-tuning line="${i+1}"><tuning-step>${s}</tuning-step><tuning-octave>${o}</tuning-octave></staff-tuning>`).join('') + '</staff-details>';
const tab = doc(defs, part('P1', measure(1, attrs.replace('</attributes>', tabDetails + '</attributes>') + note('G', 4, 2, 'quarter', '<notations><technical><string>1</string><fret>3</fret></technical></notations>') + note('E',4,4,'half'))));
const drumsDef = '<score-instrument id="I3"><instrument-name>Snare</instrument-name></score-instrument><midi-instrument id="I3"><midi-channel>10</midi-channel><midi-unpitched>39</midi-unpitched></midi-instrument>';
const multi = doc(defs + partDef('P2','Bass') + partDef('P3','Drums',drumsDef), part('P1',measure(1,attrs+note('C',4,6,'half','<dot/>'))) + part('P2',measure(1,attrs+note('E',2,6,'half','<dot/>'))) + part('P3',measure(1,attrs.replace('<sign>G</sign><line>2</line>','<sign>percussion</sign>')+'<note><unpitched><display-step>C</display-step><display-octave>5</display-octave></unpitched><duration>6</duration><instrument id="I3"/><type>half</type><dot/></note>')));
const features = doc(defs, part('P1', measure(1, attrs + '<barline location="left"><repeat direction="forward"/></barline><direction><direction-type><dynamics><f/></dynamics></direction-type></direction>' + note('C',4,2,'quarter','<tie type="start"/><notations><tied type="start"/></notations><lyric number="1"><syllabic>single</syllabic><text>light</text></lyric>') + '<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>' + note('C',4,2,'quarter','<tie type="stop"/><notations><tied type="stop"/></notations>') + note('G',4,2,'quarter') + '<barline location="right"><repeat direction="backward" times="2"/></barline>') + measure(2,'<attributes><key><fifths>2</fifths></key></attributes>'+note('D',4,6,'half','<dot/>'))));
const plainBytes = write('standard.xml', Buffer.from(plain));
const tabBytes = write('tablature.musicxml', Buffer.from(tab));
const multiBytes = write('multipart.musicxml', Buffer.from(multi));
const featureBytes = write('features.musicxml', Buffer.from(features));
const mxl = write('compressed.mxl', zipSync({'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="scores/study.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>'), 'scores/study.musicxml': strToU8(plain)}));
const bom = write('bom-doctype.xml', Buffer.concat([Buffer.from([0xef,0xbb,0xbf]), Buffer.from(plain.replace('?><score-partwise', '?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise'))]));
const utf16 = write('utf16.xml', Buffer.concat([Buffer.from([0xff,0xfe]), Buffer.from(plain.replace('UTF-8','UTF-16'),'utf16le')]));
const beats = (s, track=0, bar=0) => s.tracks[track].staves[0].bars[bar].voices[0].beats.filter(b=>b.notes.length);
const countNotes = s => s.tracks.flatMap(t=>t.staves).flatMap(st=>st.bars).flatMap(b=>b.voices).flatMap(v=>v.beats).reduce((n,b)=>n+b.notes.length,0);
let failures = 0;
function check(name, fn) { try { fn(); console.log(`PASS ${name}`); } catch(e) { failures++; console.error(`FAIL ${name}: ${e.message}`); } }
function inspect(bytes, name) { const score=load(bytes); assert.ok(score.tracks.length && score.masterBars.length); return {title:score.title||name.replace(/\.[^.]+$/, ''),artist:score.artist||'',track_count:score.tracks.length,bar_count:score.masterBars.length,tempo:score.tempo}; }
const spaces = s => s.replace(/\u00a0/g,' ');
check('standard notation, metadata and tempo',()=>{const s=load(plainBytes); assert.equal(spaces(s.title),'Original Study'); assert.equal(spaces(s.artist),'Test Composer'); assert.equal(s.tempo,96); assert.deepEqual([s.masterBars[0].timeSignatureNumerator,s.masterBars[0].timeSignatureDenominator],[3,4]); assert.deepEqual(beats(s).map(b=>[b.notes[0].realValue,b.duration]),[[60,4],[64,2]]);});
// alphaTab numbers strings from low to high, opposite to MusicXML.
check('tablature string and fret',()=>{const s=load(tabBytes), n=beats(s)[0].notes[0]; assert.equal(s.tracks[0].staves[0].tuning.length,6); assert.deepEqual([n.string,n.fret],[6,3]); assert.equal(n.realValue,67);});
check('multipart and unpitched percussion',()=>{const s=load(multiBytes), t=s.tracks[2], n=beats(s,2)[0].notes[0]; assert.equal(s.tracks.length,3); assert.equal(t.staves[0].isPercussion,true); assert.equal(t.percussionArticulations[n.percussionArticulation].outputMidiNumber,38);});
// Known alphaTab limitation: a drum part written on a G clef imports as a pitched staff. Exporters
// normally use a percussion clef (covered above). Recorded here so a future alphaTab fix shows up.
{const s=load(Buffer.from(multi.replace('<sign>percussion</sign>','<sign>G</sign><line>2</line>'))); console.log(`INFO unpitched percussion with G clef imports as percussion: ${s.tracks[2].staves[0].isPercussion}`);}
check('compressed MXL',()=>{const s=load(mxl); assert.equal(spaces(s.title),'Original Study'); assert.deepEqual(beats(s).map(b=>b.notes[0].realValue),[60,64]);});
check('repeats',()=>{const s=load(featureBytes); assert.equal(s.masterBars[0].isRepeatStart,true); assert.equal(s.masterBars[0].repeatCount,2);});
check('ties',()=>{const s=load(featureBytes); assert.equal(beats(s)[1].notes[0].isTieDestination,true);});
check('chords',()=>{const s=load(featureBytes); assert.deepEqual(beats(s)[0].notes.map(n=>n.realValue),[60,64]);});
check('dynamics',()=>{const s=load(featureBytes); assert.equal(beats(s)[0].dynamics,at.model.DynamicValue.F);});
check('lyrics',()=>{const s=load(featureBytes); assert.equal(beats(s)[0].lyrics[0],'light');});
check('key change',()=>{const s=load(featureBytes); assert.equal(s.tracks[0].staves[0].bars[1].keySignature,2);});
check('UTF-8 BOM and DOCTYPE',()=>assert.equal(spaces(load(bom).title),'Original Study'));
check('UTF-16 LE BOM',()=>assert.equal(spaces(load(utf16).title),'Original Study'));
check('Library inspect metadata',()=>{const m=inspect(plainBytes,'standard.xml'); m.title=spaces(m.title); m.artist=spaces(m.artist); assert.deepEqual(m,{title:'Original Study',artist:'Test Composer',track_count:1,bar_count:1,tempo:96});});
check('Library search matches imported title',()=>{const m=inspect(plainBytes,'unrelated.xml'); const plain=t=>t.replace(/\s+/g,' ').toLowerCase(); assert.ok(plain(`${m.title} ${m.artist} unrelated.xml`).includes(plain('original study')), 'Library search (admin.js) normalizes non-breaking spaces');});
check('Library filename fallback',()=>{const unnamed=doc(defs,part('P1',measure(1,attrs+note('C',4,6,'half'))),''); assert.equal(inspect(Buffer.from(unnamed),'fallback.musicxml').title,'fallback');});
for (const [name, bytes] of [['standard',plainBytes],['tablature',tabBytes],['multipart',multiBytes],['features',featureBytes],['MXL',mxl]]) check(`GP save/reload ${name}`,()=>{const before=load(bytes), after=load(new at.exporter.Gp7Exporter().export(before,settings)); assert.deepEqual([after.tracks.length,after.masterBars.length,countNotes(after)],[before.tracks.length,before.masterBars.length,countNotes(before)]);});
check('GP save/reload musical details',()=>{const before=load(featureBytes), after=load(new at.exporter.Gp7Exporter().export(before,settings)); const details=s=>({repeats:s.masterBars.map(b=>[b.isRepeatStart,b.repeatCount]),bars:s.tracks[0].staves[0].bars.map(b=>({key:b.keySignature,beats:b.voices[0].beats.filter(b=>b.notes.length).map(b=>({duration:b.duration,dynamics:b.dynamics,lyrics:b.lyrics,notes:b.notes.map(n=>[n.realValue,n.isTieDestination])}))}))}); assert.deepEqual(details(after),details(before));});
check('GP save/reload drum sound',()=>{const s=load(multiBytes), r=load(new at.exporter.Gp7Exporter().export(s,settings)), t=r.tracks[2], n=beats(r,2)[0].notes[0]; assert.equal(t.percussionArticulations[n.percussionArticulation].outputMidiNumber,38);});
if (failures) { console.error(`${failures} check(s) failed`); process.exitCode=1; } else console.log('All MusicXML checks passed');
