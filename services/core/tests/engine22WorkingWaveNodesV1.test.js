import test from "node:test";
import assert from "node:assert/strict";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {
  SCHEMA,DEGREE_ORDER,arizonaMarketTimeUtc,buildEngine22WorkingWaveNodesV1,
} from "../logic/engine22/wave/buildEngine22WorkingWaveNodesV1.js";
const source=()=>buildCurrentWavelength({symbol:"ES",currentPrice:7460,microBars5m:[]});

test("same Engine22 Strategy models supply selected Micro/Submicro research anchors",()=>{
  const wave=source();
  const packet=buildEngine22WorkingWaveNodesV1({currentWavelength:wave,symbol:"ES"});
  assert.equal(packet.schema,SCHEMA);
  assert.deepEqual(packet.degreeOrder,DEGREE_ORDER);
  assert.equal(packet.historyAvailable,false,"append-only history is a separate release gate");
  assert.equal(packet.ownerCountPromotion,false);
  const micro=packet.degrees.micro.nodes,submicro=packet.degrees.submicro.nodes;
  assert.deepEqual(micro.map(n=>[n.label,n.price,n.marketAtUtc]),[
    ["W1 Low",7324,"2026-11-05T22:20:00.000Z"],
    ["W1 High",7469,"2026-11-06T14:40:00.000Z"],
    ["W2 research anchor",7362,"2026-11-08T23:00:00.000Z"],
  ]);
  assert.deepEqual(submicro.map(n=>[n.label,n.price,n.marketAtUtc]),[
    ["W1 Low",7390.25,"2026-11-09T08:00:00.000Z"],
    ["W1 High",7476,"2026-11-09T13:00:00.000Z"],
    ["W2 research anchor",7449.25,"2026-11-09T13:20:00.000Z"],
  ]);
  assert.ok([...micro,...submicro].every(n=>n.plotAllowed===false &&
    n.approvalStatus==="RESEARCH"&&n.waveCompletionConfirmed===false&&n.noExecution));
  assert.ok([...micro,...submicro].every(n=>n.presentationAllowed===true));
  assert.equal(packet.degrees.primary.nodes.length,0);
  assert.deepEqual(packet.degrees.minute.nodes.map(n=>[n.label,n.price,n.marketAtUtc]),[
    ["W1 Low",7419.5,"2026-07-30T19:00:00.000Z"],
    ["W1 High",7908.75,"2026-08-13T16:00:00.000Z"],
  ]);
  assert.deepEqual(packet.degrees.subminute.nodes.map(n=>[n.label,n.price,n.marketAtUtc]),[
    ["A starting high",7901,"2026-08-14T12:00:00.000Z"],
    ["A ending wick low",7558.75,"2026-09-16T18:00:00.000Z"],
  ]);
  assert.ok(packet.degrees.minute.nodes.every(n=>n.ownerArizonaTime&&n.sourceFieldPath&&n.plotAllowed===false));
});

test("fingerprint remains unchanged on price/touch updates, changes on corrected anchor",()=>{
  const w=source(),original=buildEngine22WorkingWaveNodesV1({currentWavelength:w});
  const updated=structuredClone(w);
  updated.degrees.micro.ownerMicroW3Nov9ReclassifiedResearch.levels[0].status="TOUCHED";
  updated.currentPrice=7650;
  assert.equal(buildEngine22WorkingWaveNodesV1({currentWavelength:updated}).fingerprint,
    original.fingerprint,"a Fib touch is not a new wave pivot");
  updated.degrees.micro.ownerMicroW3Nov9ReclassifiedResearch.anchors.w1High=7468.75;
  const revised=buildEngine22WorkingWaveNodesV1({currentWavelength:updated});
  assert.notEqual(revised.fingerprint,original.fingerprint);
  assert.equal(revised.degrees.micro.nodes[1].nodeId,original.degrees.micro.nodes[1].nodeId);
  assert.notEqual(revised.degrees.micro.nodes[1].sourceRevision,
    original.degrees.micro.nodes[1].sourceRevision);
  assert.equal(original.degrees.micro.nodes[1].price,7469,"no mutation of earlier record");
});

test("old scenarios are retained but never silently displayed or promoted",()=>{
  const packet=buildEngine22WorkingWaveNodesV1({currentWavelength:source()});
  assert.ok(packet.degrees.micro.models.length>=2);
  assert.ok(packet.degrees.submicro.models.length>=2);
  const microOld=packet.degrees.micro.models.find(m=>!m.selectedForResearchDisplay);
  assert.equal(microOld.anchors.length>0,true);
  assert.ok(microOld.anchors.every(n=>n.presentationAllowed===false));
  assert.ok(packet.degrees.submicro.nodes.every(n=>n.sourcePath.endsWith(
    ".ownerSubmicroW3Nov9InternalResearch")));
});

test("unknown, malformed or conflicting times never authorize a chart node",()=>{
  const wave=source();
  const model=wave.degrees.submicro.ownerSubmicroW3Nov9InternalResearch;
  model.anchors.w1LowLocalTime="UNKNOWN";
  const a=buildEngine22WorkingWaveNodesV1({currentWavelength:wave});
  assert.equal(a.degrees.submicro.nodes[0].marketAtUtc,null);
  assert.equal(a.degrees.submicro.nodes[0].presentationAllowed,false);
  model.anchors.w1HighAtUtc="2026-11-09T12:00:00Z"; // disagrees with 06:00 AZ
  const b=buildEngine22WorkingWaveNodesV1({currentWavelength:wave});
  assert.equal(b.degrees.submicro.nodes[1].sourceTimestampConflict,true);
  assert.equal(b.degrees.submicro.nodes[1].presentationAllowed,false);
  model.anchors.w2Low=null;
  const c=buildEngine22WorkingWaveNodesV1({currentWavelength:wave});
  assert.equal(c.degrees.submicro.nodes.some(n=>n.label==="W2 research anchor"),false);
  assert.equal(arizonaMarketTimeUtc("2026-11-09 06:20 AZ"),"2026-11-09T13:20:00.000Z");
});

test("corrected owner Micro W2 and superseded old time remain distinguishable",()=>{
  const packet=buildEngine22WorkingWaveNodesV1({currentWavelength:source()});
  const recorded=packet.degrees.micro.nodes.find(n=>n.label==="W2 research anchor");
  assert.equal(recorded.marketAtUtc,"2026-11-08T23:00:00.000Z");
  // The old 15:00 AZ / 22:00Z source remains explicitly superseded.
  const prior=source().degrees.micro.ownerMicroW3Nov9ReclassifiedResearch.anchors.priorAnchorRevision;
  assert.equal(prior.w2LowAtUtc,"2026-11-08T22:00:00Z");
  assert.notEqual(recorded.marketAtUtc,prior.w2LowAtUtc.replace("Z",".000Z"));

});


test("higher canonical degree-state marks require exact source times, no invented anchors",()=>{
 const wave=source();
 const degrees={
  primary:{degree:"primary",active:true,marks:{W1:{price:3200,time:"2020-04-02 08:00 AZ"},W2:{price:4306,time:"UNKNOWN"}}},
  intermediate:{degree:"intermediate",active:true,marks:{W1:{price:5188.5,time:"2025-04-08T14:00:00Z"}}},
  minor:{degree:"minor",active:true,marks:{W1:{price:6485,time:"2026-04-30 17:00 AZ"},W2:{price:7325,time:"UNKNOWN"}}}
 };
 const packet=buildEngine22WorkingWaveNodesV1({currentWavelength:wave,degreeStates:degrees});
 assert.deepEqual(packet.degrees.primary.nodes.map(n=>[n.label,n.marketAtUtc]),[["W1","2020-04-02T15:00:00.000Z"]]);
 assert.equal(packet.degrees.intermediate.nodes.length,1);
 assert.equal(packet.degrees.minor.nodes.length,1);
 assert.equal(packet.degrees.minor.nodes.some(n=>n.label==="W2"),false);
 assert.ok(packet.degrees.primary.nodes.every(n=>n.sourcePath==="degreeStates.primary"&&n.noExecution));
});

test("selected minute and subminute anchor corrections change fingerprint, not node IDs",()=>{
 const wave=source();
 const first=buildEngine22WorkingWaveNodesV1({currentWavelength:wave});
 const revised=structuredClone(wave);
 revised.degrees.minute.ownerMinuteW2Retracement.anchors.w1Low=7419.75;
 const next=buildEngine22WorkingWaveNodesV1({currentWavelength:revised});
 assert.notEqual(next.fingerprint,first.fingerprint);
 assert.equal(next.degrees.minute.nodes[0].nodeId,first.degrees.minute.nodes[0].nodeId);
 assert.notEqual(next.degrees.minute.nodes[0].sourceRevision,first.degrees.minute.nodes[0].sourceRevision);
 assert.equal(first.degrees.minute.nodes[0].price,7419.5);
});
