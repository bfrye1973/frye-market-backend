import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {collectExistingOwnerNodesV1} from "../logic/engine22/history/collectExistingOwnerNodesV1.js";
import {appendWaveHistoryObservation} from "../logic/engine22/history/waveHistoryJournalV1.js";
import {pageEngine22NodeHistory,latestEngine22NodeHistory} from "../logic/engine22/history/chartNodeHistoryFeedV1.js";
const obs={ok:true,observedAt:"2026-11-08T21:30:00Z",content:{schema:"engine22.waveHistoryObservation.v1",symbol:"ES",
 selectionRevision:6,degreeOrder:["primary","intermediate","minor","minute","subminute","micro","submicro"],
 publishedAt:"2026-11-08T21:25:00Z",degrees:{},historicalAsOfSupported:false}};
const withDir=fn=>{const d=mkdtempSync(join(tmpdir(),"e22-real-source-"));try{return fn(d);}finally{rmSync(d,{recursive:true,force:true});}};
test("existing owner source produces real permanent feed entries for all seven degrees",()=>withDir(directory=>{
 const nodes=collectExistingOwnerNodesV1({directory,publishedAt:obs.observedAt});
 assert.ok(nodes.length>=25,"real source records ingested");
 const degrees=new Set(nodes.map(n=>n.degree));
 assert.deepEqual([...degrees].sort(),["primary","intermediate","minor","minute","subminute","micro","submicro"].sort());
 assert.ok(nodes.every(n=>n.nodeId&&n.eventId&&n.approvalStatus==="RESEARCH"&&n.priceBasisId==="UNVERIFIED_ES_CONTINUOUS"));
 assert.equal(appendWaveHistoryObservation({directory,observation:obs,nodeEvents:nodes}).status,"APPENDED");
 const page=pageEngine22NodeHistory({directory});
 assert.equal(page.records.length,nodes.length);
 const current=latestEngine22NodeHistory({directory});
 assert.equal(current.records.length,nodes.length);
 assert.equal(page.nextRevision,1);
 assert.ok(page.records.every(n=>n.plotAllowed===false));
}));
test("second matching publication cannot duplicate imported history or events",()=>withDir(directory=>{
 const first=collectExistingOwnerNodesV1({directory,publishedAt:obs.observedAt});
 appendWaveHistoryObservation({directory,observation:obs,nodeEvents:first});
 const retry=collectExistingOwnerNodesV1({directory,publishedAt:"2026-11-08T21:45:00Z"});
 assert.equal(retry.length,0);
 const result=appendWaveHistoryObservation({directory,observation:{...obs,observedAt:"2026-11-08T21:45:00Z"},nodeEvents:retry});
 assert.equal(result.status,"UNCHANGED");
 assert.equal(latestEngine22NodeHistory({directory}).records.length,first.length);
}));
test("unknown timestamps are preserved as nonplottable real node records",()=>withDir(directory=>{
 const nodes=collectExistingOwnerNodesV1({directory,publishedAt:obs.observedAt});
 const minor=nodes.find(n=>n.label==="W2 observed low candidate"&&n.degree==="minor");
 const micro=nodes.find(n=>n.label==="W1 ending high"&&n.degree==="micro");
 assert.equal(minor.marketAt,null);
 assert.equal(micro.marketAt,null);
 appendWaveHistoryObservation({directory,observation:obs,nodeEvents:nodes});
 assert.equal(pageEngine22NodeHistory({directory}).records.find(n=>n.nodeId===minor.nodeId).plotReason,"MISSING_MARKET_TIMESTAMP");
}));
test("Arizona source time is correctly UTC+7 and publication is not backdated",()=>withDir(directory=>{
 const nodes=collectExistingOwnerNodesV1({directory,publishedAt:obs.observedAt});
 const low=nodes.find(n=>n.degree==="micro"&&n.label==="W1 starting low");
 assert.equal(low.marketAt,"2026-11-05T23:00:00.000Z");
 assert.equal(low.publishedAt,obs.observedAt);
 assert.notEqual(low.marketAt,low.publishedAt);
}));
