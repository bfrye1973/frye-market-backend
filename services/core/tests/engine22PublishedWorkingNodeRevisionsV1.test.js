import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {collectPublishedWorkingNodeEventsV1} from "../logic/engine22/history/collectPublishedWorkingNodeEventsV1.js";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildEngine22WorkingWaveNodesV1} from "../logic/engine22/wave/buildEngine22WorkingWaveNodesV1.js";
import {appendWaveHistoryObservation} from "../logic/engine22/history/waveHistoryJournalV1.js";
import {pageEngine22NodeHistory} from "../logic/engine22/history/chartNodeHistoryFeedV1.js";

const publishedAt="2026-11-09T17:15:00.000Z";
const observation={ok:true,observedAt:publishedAt,
 content:{schema:"engine22.waveHistoryObservation.v1",symbol:"ES",
 publishedAt,selectionRevision:6,degrees:{},historicalAsOfSupported:false}};
const node=(price=7449.25,fingerprint="anchor-r1")=>({
 nodeId:"node-submicro-w2",waveId:"wave-submicro-w3",countId:"model-submicro-w3",
 modelVersion:"model-submicro-w3",degree:"submicro",label:"W2 research anchor",
 sourcePath:"currentWavelength.degrees.submicro.ownerSubmicroW3Nov9InternalResearch",
 anchorField:"w2Low",price,marketAtUtc:"2026-11-09T13:20:00.000Z",
 sourceRevision:fingerprint,approvalStatus:"RESEARCH",plotAllowed:false,
 noExecution:true,waveCompletionConfirmed:false,sourceTimestampConflict:false,
});
const packet=(price=7449.25,revision="anchor-r1")=>({
 schema:"engine22.workingWaveNodes.v1",authority:"ENGINE22",
 readOnly:true,noExecution:true,ownerCountPromotion:false,
 symbol:"ES",available:true,
 degrees:{
  submicro:{degree:"submicro",models:[{degree:"submicro",
   scenarioStatus:"RESEARCH_ONLY",anchors:[node(price,revision)]}]},
 }
});
const withDir=fn=>{const dir=mkdtempSync(join(tmpdir(),"engine22-working-revisions-"));
 try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}};

test("initial publication, repeated no-op, corrected anchor: permanent immutable revisions",()=>withDir(directory=>{
 const first=collectPublishedWorkingNodeEventsV1({directory,packet:packet(),publishedAt});
 assert.equal(first.length,1);
 assert.equal(first[0].type,"NODE_RECORDED");
 assert.equal(first[0].revision,1);
 assert.equal(first[0].approvalStatus,"RESEARCH");
 assert.equal(first[0].marketAt,"2026-11-09T13:20:00.000Z");
 assert.equal(first[0].priceBasisId,"UNVERIFIED_ES_CONTINUOUS");
 assert.equal(appendWaveHistoryObservation({directory,observation,nodeEvents:first}).status,"APPENDED");
 assert.deepEqual(collectPublishedWorkingNodeEventsV1({directory,packet:packet(),publishedAt}),[]);
 const newRevision=collectPublishedWorkingNodeEventsV1({directory,
   packet:packet(7449.50,"anchor-r2"),publishedAt:"2026-11-09T17:35:00.000Z"});
 assert.equal(newRevision.length,1);
 assert.equal(newRevision[0].type,"NODE_REVISED");
 assert.equal(newRevision[0].revision,2);
 assert.equal(newRevision[0].supersedesEventId,first[0].eventId);
 appendWaveHistoryObservation({directory,
   observation:{...observation,observedAt:"2026-11-09T17:35:00.000Z"},nodeEvents:newRevision});
 const all=pageEngine22NodeHistory({directory,afterRevision:0,limit:50});
 assert.equal(all.records.length,2);
 assert.deepEqual(all.records.map(x=>x.esPrice),[7449.25,7449.5]);
 assert.equal(all.nextRevision,2);
 assert.equal(all.historicalAsOfSupported,false);
 assert.ok(all.records.every(x=>x.plotAllowed===false&&x.approvalStatus==="RESEARCH"));
 const missed=pageEngine22NodeHistory({directory,afterRevision:1,limit:50});
 assert.equal(missed.records.length,1);
 assert.equal(missed.records[0].sourceRevision,2);
}));

test("no Engine22 packet means no invented node events, malformed authority fails closed",()=>withDir(directory=>{
 assert.deepEqual(collectPublishedWorkingNodeEventsV1({directory,publishedAt}),[]);
 assert.throws(()=>collectPublishedWorkingNodeEventsV1({directory,publishedAt,packet:{
   ...packet(),ownerCountPromotion:true
 }}),/SCHEMA_MISMATCH/);
 const invalid=packet();invalid.degrees.submicro.models[0].anchors[0].price=7449.1;
 assert.throws(()=>collectPublishedWorkingNodeEventsV1({directory,publishedAt,packet:invalid}),
   /EVENT_UNSAFE/);
}));

test("owner corrected Micro W2 history preserves 15:00 and publishes 16:00 in separate immutable records",()=>withDir(directory=>{
 const source=buildCurrentWavelength({symbol:"ES",currentPrice:7540,microBars5m:[]});
 const packet=buildEngine22WorkingWaveNodesV1({currentWavelength:source,symbol:"ES"});
 const live=packet.degrees.micro.nodes.find(n=>n.anchorField==="w2Low");
 assert.equal(live.marketAtUtc,"2026-11-08T23:00:00.000Z");
 assert.equal(live.price,7362);
 assert.equal(packet.degrees.micro.nodes.some(n=>n.label.includes("superseded")),false);
 const old=packet.degrees.micro.models.flatMap(m=>m.historicalAnchors??[]);
 assert.equal(old.length,1);
 assert.equal(old[0].marketAtUtc,"2026-11-08T22:00:00.000Z");
 assert.equal(old[0].approvalStatus,"SUPERSEDED");
 assert.equal(old[0].presentationAllowed,false);
 const events=collectPublishedWorkingNodeEventsV1({directory,packet,publishedAt});
 const oldEvent=events.find(e=>e.nodeId===old[0].nodeId);
 const newEvent=events.find(e=>e.nodeId===live.nodeId);
 assert.equal(oldEvent.marketAt,"2026-11-08T22:00:00.000Z");
 assert.equal(oldEvent.approvalStatus,"SUPERSEDED");
 assert.equal(oldEvent.lifecycle,"SUPERSEDED");
 assert.equal(newEvent.marketAt,"2026-11-08T23:00:00.000Z");
 assert.equal(newEvent.approvalStatus,"RESEARCH");
 assert.ok(events.every(e=>e.noExecution===true));
 const appended=appendWaveHistoryObservation({directory,observation,nodeEvents:events});
 assert.equal(appended.status,"APPENDED");
 assert.equal(collectPublishedWorkingNodeEventsV1({directory,packet,publishedAt}).length,0);
 const page=pageEngine22NodeHistory({directory,afterRevision:0,limit:50});
 const archived=page.records.find(n=>n.nodeId===old[0].nodeId);
 const current=page.records.find(n=>n.nodeId===live.nodeId);
 assert.equal(archived.marketAtUtc,"2026-11-08T22:00:00.000Z");
 assert.equal(current.marketAtUtc,"2026-11-08T23:00:00.000Z");
 assert.equal(archived.plotAllowed,false);
 assert.equal(current.plotAllowed,false);
}));

test("real initial Micro W2 15:00 publication revises to 16:00 and journal replays both states",()=>withDir(directory=>{
 const oldWave=buildCurrentWavelength({symbol:"ES",currentPrice:7525,microBars5m:[]});
 const oldMicro=oldWave.degrees.micro.ownerMicroW3Nov9ReclassifiedResearch.anchors;
 oldMicro.w2LowLocalTime="2026-11-08 15:00 AZ";
 oldMicro.w2LowAtUtc="2026-11-08T22:00:00Z";
 delete oldMicro.priorAnchorRevision;
 const firstPacket=buildEngine22WorkingWaveNodesV1({currentWavelength:oldWave,symbol:"ES"});
 const olderNode=firstPacket.degrees.micro.nodes.find(n=>n.anchorField==="w2Low");
 assert.equal(olderNode.marketAtUtc,"2026-11-08T22:00:00.000Z");
 const firstEvents=collectPublishedWorkingNodeEventsV1({directory,packet:firstPacket,publishedAt});
 assert.equal(firstEvents.find(n=>n.nodeId===olderNode.nodeId).revision,1);
 assert.equal(appendWaveHistoryObservation({directory,observation,nodeEvents:firstEvents}).status,"APPENDED");
 const latestWave=buildCurrentWavelength({symbol:"ES",currentPrice:7525,microBars5m:[]});
 const latestPacket=buildEngine22WorkingWaveNodesV1({currentWavelength:latestWave,symbol:"ES"});
 assert.notEqual(firstPacket.fingerprint,latestPacket.fingerprint);
 const correctedNode=latestPacket.degrees.micro.nodes.find(n=>n.anchorField==="w2Low");
 assert.equal(correctedNode.nodeId,olderNode.nodeId,"stable node identity across owner correction");
 assert.equal(correctedNode.marketAtUtc,"2026-11-08T23:00:00.000Z");
 const nextEvents=collectPublishedWorkingNodeEventsV1({
   directory,packet:latestPacket,publishedAt:"2026-11-09T18:00:00.000Z"
 });
 const revision=nextEvents.find(n=>n.nodeId===olderNode.nodeId);
 assert.equal(revision.type,"NODE_REVISED");
 assert.equal(revision.revision,2);
 assert.equal(revision.marketAt,"2026-11-08T23:00:00.000Z");
 assert.equal(revision.supersedesEventId,firstEvents.find(n=>n.nodeId===olderNode.nodeId).eventId);
 const oldSource=nextEvents.find(n=>n.label==="W2 superseded source anchor");
 assert.equal(oldSource.marketAt,"2026-11-08T22:00:00.000Z");
 assert.equal(oldSource.approvalStatus,"SUPERSEDED");
 appendWaveHistoryObservation({directory,
   observation:{...observation,observedAt:"2026-11-09T18:00:00.000Z"},nodeEvents:nextEvents});
 const full=pageEngine22NodeHistory({directory,afterRevision:0,limit:50});
 const w2=full.records.filter(n=>n.nodeId===olderNode.nodeId);
 assert.deepEqual(w2.map(n=>[n.sourceRevision,n.marketAtUtc]),[
   [1,"2026-11-08T22:00:00.000Z"],
   [2,"2026-11-08T23:00:00.000Z"]
 ]);
 const replay=pageEngine22NodeHistory({directory,afterRevision:1,limit:50});
 assert.equal(replay.records.find(n=>n.nodeId===olderNode.nodeId).sourceRevision,2);
 assert.equal(replay.records.find(n=>n.label==="W2 superseded source anchor").plotAllowed,false);
 assert.ok(full.records.every(n=>n.plotAllowed===false),"no research promotion on replay");
}));
