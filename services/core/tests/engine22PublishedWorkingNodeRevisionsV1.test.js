import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {collectPublishedWorkingNodeEventsV1} from "../logic/engine22/history/collectPublishedWorkingNodeEventsV1.js";
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
