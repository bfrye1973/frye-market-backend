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
  assert.equal(packet.degrees.minute.nodes.length,0);
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

test("owner corrected Sheet W2 differs from current Engine22 Strategy; never silently substitute",()=>{
  const packet=buildEngine22WorkingWaveNodesV1({currentWavelength:source()});
  const recorded=packet.degrees.micro.nodes.find(n=>n.label==="W2 research anchor");
  assert.equal(recorded.marketAtUtc,"2026-11-08T23:00:00.000Z");
  // Nov 9 owner sheet correction was 16:00 Arizona = 23:00Z.
  assert.notEqual(recorded.marketAtUtc,"2026-11-08T23:00:00.000Z");
});
