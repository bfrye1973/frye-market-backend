import test from "node:test";
import assert from "node:assert/strict";
import {computeAbcMilestone1,projectCFromB,replayAbcMilestone1,readOnlyEngine22Context} from "../logic/engine16StructuralTracker/abcMilestone1.js";

const values=[
  [103,106,101,104],[104,105,90,102],[102,110,101,109],
  [109,120,107,118],[118,119,108,110],[110,113,100,105],
  [105,115,104,114],[122,135,120,123],[123,126,117,119],
  [126,142,125,137],[137,139,120,125]
];
const mk=(i,v=values[i])=>{
  const at=new Date(Date.UTC(2026,10,9,0,i*2));
  return {time:at.toISOString(),closeAt:new Date(at.getTime()+60000).toISOString(),
    knownAt:new Date(at.getTime()+61000).toISOString(),
    open:v[0],high:v[1],low:v[2],close:v[3],closed:true};
};
const bars=values.map((v,i)=>mk(i,v));
const base=(list=bars,more={})=>({bars:list,asOf:list.at(-1).knownAt,
  priceBasis:"ES_PHYSICAL_UNADJUSTED",contract:"ESZ26",pivotStrength:1,...more});
const abc=s=>s.candidates.filter(x=>x.scenarioType==="ABC_B_TO_C");
test("prospective 0-A-B publishes developing C before C pivot confirms",()=>{
  const s=computeAbcMilestone1(base(bars.slice(0,7)));
  assert.ok(abc(s).length>=1);
  assert.equal(abc(s)[0].state,"C_DEVELOPING");
  assert.equal(abc(s)[0].orthodoxSubdivisionsVerified,false);
  assert.equal(abc(s)[0].childEvidence,"UNKNOWN");
  assert.equal(abc(s)[0].createdKnownAt,bars[6].knownAt);
});
test("three-anchor measured A projects from B, preserving raw and ES rounded",()=>{
  const x=projectCFromB({start:{id:"0",price:100},A:{id:"A",price:110},
    B:{id:"B",price:105},direction:"UP",priceBasis:"PHYSICAL",tickSize:0.25});
  assert.equal(x.levels.find(l=>l.ratio===1).rawPrice,115);
  assert.equal(x.levels.find(l=>l.ratio===1.618).price,121.25);
  assert.equal(x.projectionOrigin,"B");
});
test("bearish mirror 0-A-B candidate",()=>{
  const mirrored=bars.slice(0,7).map(b=>({...b,open:300-b.open,high:300-b.low,
    low:300-b.high,close:300-b.close}));
  const s=computeAbcMilestone1(base(mirrored));
  assert.ok(abc(s).some(c=>c.direction==="DOWN"));
});
test("C? is a provisional wick/reversal policy; extension revises endpoint only",()=>{
  const policy={wickFraction:0.5,minWickTicks:2,requireLaterReversal:true};
  const prior=computeAbcMilestone1(base(bars.slice(0,9),{completionPolicy:policy}));
  const later=computeAbcMilestone1(base(bars.slice(0,10),{completionPolicy:policy}));
  const candidate=abc(prior).find(c=>c.state==="C_COMPLETION_CANDIDATE");
  assert.ok(candidate);
  assert.equal(candidate.displayLabel,"C?");
  const revised=abc(later).find(c=>c.candidateId===candidate.candidateId);
  assert.ok(revised);
  assert.equal(revised.state,"C_DEVELOPING");
  assert.ok(revised.cExtreme.price>candidate.cExtreme.price);
  assert.equal(revised.structuralInvalidation.ruleStatus,"UNKNOWN");
});
test("availability clocks cannot see candles before knownAt or treat start as close",()=>{
  const target=bars[8].knownAt;
  const prefix=computeAbcMilestone1(base(bars.slice(0,9)));
  const withFuture=computeAbcMilestone1(base(bars,{asOf:target}));
  assert.deepEqual(withFuture,prefix);
  assert.throws(()=>computeAbcMilestone1(base([mk(0),{...mk(1),knownAt:mk(0).knownAt}])),
    /BAR_CLOCK_ORDER_INVALID/);
});
test("missing clock or forming bar cannot create confirmed pivots",()=>{
  assert.throws(()=>computeAbcMilestone1(base([{...mk(0),closeAt:undefined}])),/BAR_CLOCKS_REQUIRED/);
  const s=computeAbcMilestone1(base([...bars.slice(0,6),{...bars[6],closed:false}]));
  assert.equal(abc(s).length,0);
});
test("two independent scenario IDs share physical B pivot, never claim approved parent",()=>{
  const s=computeAbcMilestone1(base(bars.slice(0,7)));
  const c=abc(s)[0];
  const w=s.candidates.find(x=>x.scenarioType==="MICRO2_TO_W3_ALTERNATIVE");
  assert.ok(w && c.candidateId!==w.candidateId);
  assert.equal(w.sharesPivotId,c.anchors.B.id);
  assert.equal(w.interpretationStatus,"UNRESOLVED");
  assert.deepEqual(w.authorizedEngine22Refs,[]);
});
test("Engine22 adapter fails closed on actual non-historical chart node contract",()=>{
  const result=readOnlyEngine22Context({schema:"engine22.chartNodeCurrent.v1",
    readOnly:true,historicalAsOfSupported:false,latestRevision:10,
    records:[{degree:"micro",approvalStatus:"OWNER_APPROVED",nodeId:"example"}]},bars[7].knownAt);
  assert.equal(result.status,"UNKNOWN");
  assert.equal(result.reason,"ENGINE22_HISTORICAL_ASOF_NOT_SUPPORTED");
});
test("prefix replay is restart deterministic and prior as-of snapshots never repaint",()=>{
  const a=replayAbcMilestone1(base(bars.slice(0,9)));
  const b=replayAbcMilestone1(base(bars));
  assert.deepEqual(a,replayAbcMilestone1(base(bars.slice(0,9))));
  assert.deepEqual(a.snapshots,b.snapshots.slice(0,a.snapshots.length));
  assert.deepEqual(a.events,b.events.slice(0,a.events.length));
  assert.ok(b.events.some(e=>e.reason==="ENDPOINT_REVISED_OR_EXTENDED"));
});
test("no trade capabilities, outputs are research-only",()=>{
  const s=computeAbcMilestone1(base(bars.slice(0,7)));
  assert.equal(s.researchOnly,true);assert.equal(s.noExecution,true);
  assert.equal(s.noPermissionCreated,true);
  assert.equal("orders" in s,false);assert.equal("size" in s,false);
});

test("C? knownAt is first actually reversing successor, not preceding nonreversal",()=>{
  const sequence=[...bars.slice(0,8),mk(8,[123,134,116,125]),mk(9,[125,133,119,121])];
  const first=computeAbcMilestone1(base(sequence.slice(0,9)));
  const second=computeAbcMilestone1(base(sequence));
  const before=abc(first).find(c=>c.cExtreme?.time===bars[7].time);
  const after=abc(second).find(c=>c.candidateId===before?.candidateId);
  assert.ok(before && after);
  assert.equal(before.state,"C_DEVELOPING");
  assert.equal(after.state,"C_COMPLETION_CANDIDATE");
  assert.equal(after.cEndpointProposal.time,bars[7].time);
  assert.equal(after.cEndpointProposal.knownAt,sequence[9].knownAt);
  assert.equal(after.cEndpointProposal.reversalEvidenceId,sequence[9].time+":C_REVERSAL");
  assert.notEqual(after.cEndpointProposal.knownAt,sequence[8].knownAt);
});
test("forming candle contributes only provisional C price and wick before close",()=>{
  const prior=computeAbcMilestone1(base(bars.slice(0,7)));
  const forming={...bars[7],knownAt:new Date(Date.parse(bars[7].time)+30000).toISOString(),
    closed:false};
  const s=computeAbcMilestone1(base([...bars.slice(0,7),forming]));
  const old=abc(prior)[0],next=abc(s).find(c=>c.candidateId===old.candidateId);
  assert.ok(next);
  assert.equal(next.cExtreme.price,forming.high);
  assert.equal(next.cExtreme.knownAt,forming.knownAt);
  assert.equal(next.state,"C_DEVELOPING");
  assert.deepEqual(s.pivots,prior.pivots);
  assert.ok(Date.parse(forming.knownAt)<Date.parse(forming.closeAt));
  const exploratory=computeAbcMilestone1(base([...bars.slice(0,7),forming],{
    completionPolicy:{requireLaterReversal:false}
  }));
  const q=abc(exploratory).find(c=>c.candidateId===old.candidateId);
  assert.equal(q.state,"C_COMPLETION_CANDIDATE");
  assert.equal(q.cEndpointProposal.knownAt,forming.knownAt);
  assert.equal(q.childEvidence,"UNKNOWN");
});
test("closed candle cannot be known before its close; tick inputs must be finite",()=>{
  const invalid={...bars[7],knownAt:new Date(Date.parse(bars[7].time)+30000).toISOString()};
  assert.throws(()=>computeAbcMilestone1(base([...bars.slice(0,7),invalid])),/BAR_CLOCK_ORDER_INVALID/);
  assert.throws(()=>computeAbcMilestone1(base(bars.slice(0,7),{tickSize:Infinity})),/INVALID_PIVOT_OPTIONS/);
  assert.throws(()=>projectCFromB({start:{id:"0",price:100},A:{id:"A",price:110},
    B:{id:"B",price:105},direction:"UP",priceBasis:"ES",tickSize:Infinity}),/INVALID_C_MODEL_INPUT/);
});
test("candidate aging emits RETIRED and preserves immutable older snapshots across restarts",()=>{
  const opts={maxCandidateAgeBars:2};
  const replay=replayAbcMilestone1(base(bars,opts));
  const older=replayAbcMilestone1(base(bars.slice(0,7),opts));
  assert.ok(older.snapshots.at(-1).candidates.some(x=>x.scenarioType==="ABC_B_TO_C"));
  assert.ok(replay.events.some(e=>e.reason==="RETIRED" && e.state==="RETIRED"));
  assert.deepEqual(replay.snapshots.slice(0,older.snapshots.length),older.snapshots);
  assert.deepEqual(replay.events.slice(0,older.events.length),older.events);
  assert.deepEqual(replay,replayAbcMilestone1(base(bars,opts)));
  const retiredIds=new Set(replay.events.filter(e=>e.reason==="RETIRED").map(e=>e.candidateId));
  assert.ok([...retiredIds].some(id=>!replay.snapshots.at(-1).candidates.some(c=>c.candidateId===id)));
});
