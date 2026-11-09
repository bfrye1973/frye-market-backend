import test from "node:test";
import assert from "node:assert/strict";
import {adaptEngine11OhlcForResearch,replayEngine11Research,
  inspectEngine22HistoryObservation,inspectEngine22CurrentNodes,
  buildEngine16ChartResearchPack,buildEngine16ChartHistoryPack,INSPECTOR_TFS}
  from "../logic/engine16StructuralTracker/replayAndChartContracts.js";
import {computeAbcMilestone1,replayAbcMilestone1} from "../logic/engine16StructuralTracker/abcMilestone1.js";
const values=[
  [103,106,101,104],[104,105,90,102],[102,110,101,109],
  [109,120,107,118],[118,119,108,110],[110,113,100,105],
  [105,115,104,114],[122,135,120,123],[123,126,117,119],
  [126,142,125,137],[137,139,120,125]
];
const start=Date.parse("2026-11-09T00:00:00.000Z")/1000;
const raw=values.map((x,i)=>({time:start+i*600,open:x[0],high:x[1],low:x[2],close:x[3],volume:1}));
const input=(bars=raw,mode="SIMULATED_CLOSE_CLOCKS",other={})=>
  adaptEngine11OhlcForResearch({bars,timeframe:"10m",contract:"ESZ26",
    priceBasis:"ES_PHYSICAL_UNADJUSTED",mode,...other});
const opts=b=>({bars:b,asOf:b.at(-1).knownAt,contract:"ESZ26",
  priceBasis:"ES_PHYSICAL_UNADJUSTED",timeframe:"10m",pivotStrength:1});
test("Engine11 actual endpoint UNIX seconds converted to start, close, known clock, explicitly simulated",()=>{
  const data=input();
  assert.equal(data.bars[0].time,"2026-11-09T00:00:00.000Z");
  assert.equal(data.bars[0].closeAt,"2026-11-09T00:10:00.000Z");
  assert.equal(data.bars[0].knownAt,data.bars[0].closeAt);
  assert.equal(data.noHistoricalAvailabilityClaim,true);
  assert.equal(data.evidenceClockAuthority,"SIMULATED_NOT_HISTORICALLY_OBSERVED");
  assert.equal(data.bars.length,raw.length);
});
test("Engine11 attested knowledge clock validates each candle without fabrication",()=>{
  const clocks=raw.map(x=>new Date(x.time*1000+600000+1000).toISOString());
  const data=input(raw,"ATTESTED_CLOCKS",{attestedKnownAt:clocks,sourceFingerprint:"sha256:test-source"});
  assert.equal(data.bars[0].knownAt,clocks[0]);
  assert.equal(data.noHistoricalAvailabilityClaim,false);
  const replay=replayEngine11Research({input:data});
  assert.equal(replay.historicallyVerified,true);
  assert.equal(replay.sourceFingerprint,"sha256:test-source");
  assert.throws(()=>input(raw,"ATTESTED_CLOCKS",{attestedKnownAt:clocks.slice(1)}),/ATTESTED_CLOCKS_MISSING/);
  assert.throws(()=>input(raw,"ATTESTED_CLOCKS",{attestedKnownAt:clocks.map(()=>raw[0].time)}),/ENGINE11_KNOWNAT_INVALID/);
});
test("Engine11 rejects mixed contracts, unknown timeframes, duplicate or invalid OHLC",()=>{
  assert.throws(()=>input(raw,"SIMULATED_CLOSE_CLOCKS",{attestedKnownAt:[]}),/MIXED/);
  assert.throws(()=>input(raw,"SIMULATED_CLOSE_CLOCKS",{timeframe:"4h"}),/ENGINE11_REPLAY_CONTRACT_REQUIRED/);
  assert.throws(()=>input([...raw,{...raw.at(-1)}]),/ENGINE11_BAR_INVALID/);
  assert.throws(()=>input([{...raw[0],high:90}]),/ENGINE11_BAR_INVALID/);
});
test("synthetic chronological replay is deterministic and does not assert authentic historic availability",()=>{
  const data=input();
  const a=replayEngine11Research({input:data});
  const b=replayEngine11Research({input:data});
  assert.deepEqual(a,b);
  assert.equal(a.historicallyVerified,false);
  assert.ok(a.snapshots.some(s=>s.candidates.some(c=>c.scenarioType==="ABC_B_TO_C")));
  assert.deepEqual(replayEngine11Research({input:input(raw.slice(0,8))}).snapshots,
    a.snapshots.slice(0,8));
});
test("Engine22 observed selection journal cannot be mistaken for historical approved nodes",()=>{
  const asOf="2026-11-09T12:00:00.000Z";
  const event={schema:"engine22.waveHistoryEvent.v1",revision:2,
    observedAt:"2026-11-09T11:00:00.000Z",
    content:{schema:"engine22.waveHistoryObservation.v1",historicalAsOfSupported:false,
      degrees:{micro:{available:true}}}};
  assert.equal(inspectEngine22HistoryObservation(event,{asOf}).status,"UNKNOWN");
  assert.equal(inspectEngine22HistoryObservation(event,{asOf}).reason,"ENGINE22_HISTORICAL_ASOF_NOT_SUPPORTED");
  assert.equal(inspectEngine22HistoryObservation(event,{asOf:"2026-11-09T10:00:00Z"}).reason,
    "ENGINE22_OBSERVATION_NOT_YET_KNOWN");
});
test("Engine22 current approved nodes are captured-current only, bound by physical basis and observed time",()=>{
  const n={nodeId:"micro-w2-test",degree:"micro",waveId:"micro-w2",parentWaveId:"minor-w2",
    esPrice:7362,marketAtUtc:"2026-11-08T12:00:00.000Z",
    publishedAtUtc:"2026-11-09T10:00:00.000Z",contractSymbol:"ESZ26",
    priceBasisId:"ES_PHYSICAL_UNADJUSTED",approvalStatus:"OWNER_APPROVED",lifecycle:"ACTIVE"};
  const feed={schema:"engine22.chartNodeCurrent.v1",readOnly:true,
    historicalAsOfSupported:false,latestRevision:6,records:[n,
      {...n,nodeId:"other",priceBasisId:"CONTINUOUS_ADJUSTED"},
      {...n,nodeId:"unapproved",approvalStatus:"RESEARCH"}]};
  const args={capturedAt:"2026-11-09T11:00:00.000Z",asOf:"2026-11-09T12:00:00.000Z",
    contract:"ESZ26",priceBasis:"ES_PHYSICAL_UNADJUSTED"};
  const out=inspectEngine22CurrentNodes(feed,args);
  assert.equal(out.status,"CURRENT_CONTEXT_ONLY");
  assert.equal(out.degreeRefs.length,1);
  assert.equal(out.degreeRefs[0].nodeId,"micro-w2-test");
  assert.equal(out.historicalAsOfSupported,false);
  assert.equal(inspectEngine22CurrentNodes(feed,{...args,asOf:"2026-11-09T10:30:00Z"}).status,"UNKNOWN");
  assert.equal(inspectEngine22CurrentNodes(feed,{...args,contract:"ESH27"}).status,"UNKNOWN");
});
test("Engine 2 research pack preserves distinct scenario identities and refuses plot authorization",()=>{
  const b=input().bars;const snapshot=computeAbcMilestone1(opts(b));
  const pack=buildEngine16ChartResearchPack(snapshot);
  assert.deepEqual(pack.allowedInspectorTimeframes,["1m","5m","10m","20m","30m","1h"]);
  assert.deepEqual([...INSPECTOR_TFS],pack.allowedInspectorTimeframes);
  assert.equal(pack.plotAuthorized,false);
  const abc=pack.rows.find(r=>r.scenarioType==="ABC_B_TO_C");
  const w=pack.rows.find(r=>r.scenarioType==="MICRO2_TO_W3_ALTERNATIVE");
  assert.ok(abc&&w&&abc.candidateId!==w.candidateId);
  assert.equal(w.sharedPivotId,abc.anchorRefs.B);
  assert.ok(abc.fibTargets.some(x=>x.ratio===1 && x.projectionOrigin===abc.anchorRefs.B));
  assert.ok(pack.rows.every(x=>x.plotAuthorized===false));
});
test("Engine2 timeline views only previous as-of events and projections, no later events leak",()=>{
  const b=input().bars,replay=replayAbcMilestone1(opts(b));
  const older=buildEngine16ChartHistoryPack(replay,{index:7});
  const newer=buildEngine16ChartHistoryPack(replay,{index:10});
  assert.equal(older.historicalView,true);
  assert.ok(older.eventRefs.every(e=>Date.parse(e.knownAt)<=Date.parse(older.asOf)));
  assert.ok(newer.eventRefs.length>=older.eventRefs.length);
  assert.ok(older.rows.every(x=>x.researchOnly===true));
  assert.throws(()=>buildEngine16ChartHistoryPack(replay,{index:100}),/ENGINE16_CHART_HISTORY_INVALID/);
});

test("Engine16 consumes only captured-current matching Engine22 refs; independent W3 scenario unchanged",()=>{
  const b=input().bars;const asOf=b.at(-1).knownAt;
  const capture="2026-11-09T00:20:00.000Z";
  const node={nodeId:"micro-anchor-verified",degree:"micro",parentWaveId:"minor-2",
    waveId:"micro-2",esPrice:100,marketAtUtc:"2026-11-09T00:10:00.000Z",
    publishedAtUtc:"2026-11-09T00:15:00.000Z",contractSymbol:"ESZ26",
    priceBasisId:"ES_PHYSICAL_UNADJUSTED",approvalStatus:"OWNER_APPROVED",lifecycle:"ACTIVE"};
  const current=inspectEngine22CurrentNodes({
    schema:"engine22.chartNodeCurrent.v1",readOnly:true,latestRevision:1,records:[node]
  },{capturedAt:capture,asOf,contract:"ESZ26",priceBasis:"ES_PHYSICAL_UNADJUSTED"});
  const snap=computeAbcMilestone1({...opts(b),engine22ResearchContext:current});
  const w=snap.candidates.find(c=>c.scenarioType==="MICRO2_TO_W3_ALTERNATIVE");
  assert.equal(snap.engine22Context.status,"CURRENT_CONTEXT_ONLY");
  assert.deepEqual(w.authorizedEngine22Refs,["micro-anchor-verified"]);
  assert.equal(w.interpretationStatus,"UNRESOLVED");
  const old=computeAbcMilestone1({...opts(b),engine22ResearchContext:{...current,
    capturedAt:"2026-11-10T00:00:00Z"}});
  assert.equal(old.engine22Context.status,"UNKNOWN");
  assert.deepEqual(old.candidates.find(c=>c.scenarioType==="MICRO2_TO_W3_ALTERNATIVE").authorizedEngine22Refs,[]);
});
