const assert = require('node:assert/strict');
const at = require('./public/editor/vendor/alphaTab.js');
const M = require('./public/editor/model.js');
const m = at.model;
const pos = {track:0,staff:0,bar:1,voice:0,beat:0};
const reopen = score => at.importer.ScoreLoader.loadScoreFromBytes(new at.exporter.Gp7Exporter().export(M.consolidate(score)));
const unchanged = (score, action) => {
  const before=M.snapshot(score);
  assert.throws(action);
  assert.equal(M.snapshot(score),before,'Rejected edit leaves score unchanged');
};

let score=M.createScore({bars:5});
M.addTrack(score,'Second guitar');
score=M.consolidate(score);
const initial=M.trackAutomations(score,0);
assert.deepEqual(initial,[{bar:0,type:'instrument',value:25}],'alphaTab adds an opening instrument automation');
for (const [type,automationType,max] of [['volume',m.AutomationType.Volume,16],['pan',m.AutomationType.Balance,16],['instrument',m.AutomationType.Instrument,127]]) {
  const beat=M.beatAt(score,pos);
  M.setTrackAutomation(score,0,1,type,0);
  let automations=beat.automations.filter(a=>a.type===automationType);
  assert.equal(automations.length,1);
  assert.ok(automations[0] instanceof m.Automation);
  assert.equal(automations[0].value,0);
  assert.equal(automations[0].ratioPosition,0);
  const duplicate=new m.Automation(); duplicate.type=automationType; duplicate.value=0;
  M.beatAt(score,{...pos,beat:1}).automations.push(duplicate);
  M.setTrackAutomation(score,0,1,type,max);
  automations=beat.automations.filter(a=>a.type===automationType);
  assert.equal(automations.length,1,'Replace without duplicates');
  assert.equal(automations[0].value,max);
  assert.equal(M.beatAt(score,{...pos,beat:1}).automations.length,0,'Replacement clears imported changes elsewhere in the bar');
  assert.deepEqual(M.trackAutomations(score,0),[...initial,{bar:1,type,value:max}]);
  for (const value of [-1,max+1,1.5,NaN,Infinity,'8',undefined]) unchanged(score,()=>M.setTrackAutomation(score,0,1,type,value));
  M.setTrackAutomation(score,0,1,type,null);
  M.setTrackAutomation(score,0,1,type,null);
  assert.deepEqual(M.trackAutomations(score,0),initial,'Remove is idempotent');
  assert.equal(beat.automations.filter(a=>a.type===automationType).length,0);
}
for (const [track,bar,type] of [[-1,1,'volume'],[0,-1,'volume'],[2,1,'volume'],[0,5,'volume'],[0,.5,'volume'],[0,1,'balance'],[0,1,'toString']]) {
  unchanged(score,()=>M.setTrackAutomation(score,track,bar,type,8));
}
assert.throws(()=>M.trackAutomations(score,2));
M.setTrackAutomation(score,0,3,'pan',8);
M.setTrackAutomation(score,0,1,'volume',12);
M.setTrackAutomation(score,0,1,'pan',0);
M.setTrackAutomation(score,0,1,'instrument',40);
M.setTrackAutomation(score,1,2,'volume',4);
const expected=[...initial,{bar:1,type:'instrument',value:40},{bar:1,type:'pan',value:0},{bar:1,type:'volume',value:12},{bar:3,type:'pan',value:8}];
assert.deepEqual(M.trackAutomations(score,0),expected,'Sorted by bar, then type');
assert.deepEqual(M.trackAutomations(score,1),[{bar:0,type:'instrument',value:25},{bar:2,type:'volume',value:4}]);
assert.deepEqual(M.trackAutomations(M.restore(M.snapshot(score)),0),expected);
assert.deepEqual(M.trackAutomations(M.consolidate(score),0),expected);
M.setTrackAutomation(score,0,1,'pan',null);
assert.equal(M.beatAt(score,pos).automations.length,2,'Removal preserves unrelated types');

// Meter edits must not consume rests carrying automation.
unchanged(score,()=>M.setTimeSignature(score,1,1,8));
assert.equal(M.beatAt(score,pos).isRest,true);

const middle=m.Automation.buildTempoAutomation(false,.5,135,2);
score.masterBars[2].tempoAutomations.push(middle,m.Automation.buildTempoAutomation(false,0,60,2));
score.masterBars[2].tempoAutomations.push(m.Automation.buildTempoAutomation(false,0,70,2));
assert.equal(M.setTempoRamp(score,0,4,80,120),5);
assert.deepEqual(score.masterBars.map(bar=>bar.tempoAutomations.filter(a=>a.ratioPosition===0).map(a=>a.value)),[[80],[90],[100],[110],[120]]);
assert.ok(score.masterBars[2].tempoAutomations.includes(middle),'Mid-bar tempo remains intact');
assert.equal(M.setTempoRamp(score,0,4,80,120),5,'Repeated ramp replaces opening tempos');
assert.ok(score.masterBars.every(bar=>bar.tempoAutomations.filter(a=>a.ratioPosition===0).length===1));
for (const args of [[-1,4,80,120],[0,5,80,120],[3,2,80,120],[0,.5,80,120],[0,4,0,120],[0,4,80,Infinity],[0,4,NaN,120],[0,4,'80',120]]) {
  unchanged(score,()=>M.setTempoRamp(score,...args));
}
const single=M.createScore({bars:3});
assert.equal(M.setTempoRamp(single,1,1,97,120),1);
assert.equal(single.masterBars[1].tempoAutomations[0].value,97,'Single bar uses starting BPM');
assert.equal(single.masterBars[0].tempoAutomations[0].value,120,'Outside range unchanged');
assert.equal(single.masterBars[2].tempoAutomations.length,0);
M.setTempoRamp(single,0,2,120,80);
assert.deepEqual(single.masterBars.map(bar=>bar.tempoAutomations[0].value),[120,100,80]);
M.setTempoRamp(single,0,2,80,81);
assert.deepEqual(single.masterBars.map(bar=>bar.tempoAutomations[0].value),[80,80.5,81]);

const imported=reopen(score);
const tempos=s=>s.masterBars.map(bar=>bar.tempoAutomations.map(a=>[a.ratioPosition,a.value]));
assert.deepEqual(tempos(imported),tempos(score),'GP7 preserves ramp and mid-bar tempos');
for (const track of [0,1]) {
  assert.deepEqual(M.trackAutomations(imported,track).filter(a=>a.type==='instrument'),M.trackAutomations(score,track).filter(a=>a.type==='instrument'),'GP7 preserves instrument changes');
}
// Required acceptance check: stock alphaTab 1.8.4 currently drops volume and pan.
assert.deepEqual(imported.tracks.map((_,i)=>M.trackAutomations(imported,i)),score.tracks.map((_,i)=>M.trackAutomations(score,i)),'GP7 must preserve volume, pan and instrument automations');
console.log('PASS automation checks');
