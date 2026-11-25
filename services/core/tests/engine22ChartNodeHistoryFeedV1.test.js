import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {appendWaveHistoryObservation} from "../logic/engine22/history/waveHistoryJournalV1.js";
import {NODE_EVENT_SCHEMA} from "../logic/engine22/history/nodeIdentityLedgerV1.js";
import {pageEngine22NodeHistory,latestEngine22NodeHistory} from "../logic/engine22/history/chartNodeHistoryFeedV1.js";
const observation={ok:true,observedAt:"2026-11-08T20:00:00Z",
 content:{schema:"engine22.waveHistoryObservation.v1",publishedAt:"2026-11-08T19:59:00Z",
 symbol:"ES",selectionRevision:6,degrees:{},historicalAsOfSupported:false}};
const base={schema:NODE_EVENT_SCHEMA,type:"NODE_RECORDED",eventId:"n-event-1",
 nodeId:"micro-node-1",waveId:"micro-w1",countId:"micro-research",
 modelVersion:"micro.v1",degree:"micro",parentWaveId:null,
 sourceReference:"sheet:Micro W1-W2 Proposed!A2:E2",sourceFingerprint:"owner",
 priceBasisId:"UNVERIFIED_ES",contractSymbol:"ES",label:"W1 START",
 marketAt:"2026-11-05T23:00:00Z",publishedAt:"2026-11-08T20:00:00Z",
 price:7321.75,approvalStatus:"RESEARCH",lifecycle:"DEVELOPING",revision:1,
 supersedesEventId:null,supersedesNodeId:null};
const withDirectory=fn=>{const directory=mkdtempSync(join(tmpdir(),"e22-node-feed-"));try{return fn(directory);}finally{rmSync(directory,{recursive:true,force:true});}};
test("revision cursor emits node records and keeps research unplottable",()=>withDirectory(directory=>{
 appendWaveHistoryObservation({directory,observation,nodeEvents:[base]});
 const page=pageEngine22NodeHistory({directory});
 assert.equal(page.schema,"engine22.chartNodeHistoryPage.v1");
 assert.equal(page.nextRevision,1);
 assert.equal(page.records.length,1);
 assert.equal(page.records[0].esPrice,7321.75);
 assert.equal(page.records[0].plotReason,"UNAPPROVED_WAVE");
 assert.equal(page.records[0].plotAllowed,false);
 assert.equal(page.historicalAsOfSupported,false);
 assert.equal(pageEngine22NodeHistory({directory,afterRevision:1}).records.length,0);
}));
test("journal-only revisions still advance cursor safely",()=>withDirectory(directory=>{
 appendWaveHistoryObservation({directory,observation});
 const page=pageEngine22NodeHistory({directory});
 assert.equal(page.records.length,0);
 assert.equal(page.nextRevision,1);
}));
test("revised node preserved in paged event feed and latest view",()=>withDirectory(directory=>{
 appendWaveHistoryObservation({directory,observation,nodeEvents:[base]});
 const revised={...base,type:"NODE_STATUS_CHANGED",eventId:"n-event-2",revision:2,
 supersedesEventId:"n-event-1",approvalStatus:"SUPERSEDED",lifecycle:"SUPERSEDED",
 publishedAt:"2026-11-08T21:00:00Z"};
 appendWaveHistoryObservation({directory,observation:{...observation,observedAt:"2026-11-08T21:00:00Z"},nodeEvents:[revised]});
 const page=pageEngine22NodeHistory({directory,afterRevision:1});
 assert.equal(page.records.length,1);
 assert.equal(page.records[0].sourceRevision,2);
 assert.equal(page.records[0].publicationRevision,2);
 const current=latestEngine22NodeHistory({directory});
 assert.equal(current.records.length,1);
 assert.equal(current.records[0].approvalStatus,"SUPERSEDED");
 assert.equal(current.latestRevision,2);
 assert.equal(current.plotAllowed,false);
}));
test("even approved node with exact time cannot plot without verified ES basis",()=>withDirectory(directory=>{
 appendWaveHistoryObservation({directory,observation,nodeEvents:[{...base,approvalStatus:"OWNER_APPROVED",lifecycle:"CONFIRMED"}]});
 const record=pageEngine22NodeHistory({directory}).records[0];
 assert.equal(record.plotAllowed,false);
 assert.equal(record.plotReason,"ENGINE11_PRICE_BASIS_AND_ASOF_VERIFICATION_PENDING");
}));
test("missing timestamp stays available for review but never plotted",()=>withDirectory(directory=>{
 appendWaveHistoryObservation({directory,observation,nodeEvents:[{...base,marketAt:null}]});
 const record=pageEngine22NodeHistory({directory}).records[0];
 assert.equal(record.marketAtUtc,null);
 assert.equal(record.plotReason,"MISSING_MARKET_TIMESTAMP");
}));
test("reject invalid paging values including negative or fractional revisions",()=>withDirectory(directory=>{
 for(const afterRevision of [-1,1.5,NaN,Infinity])
  assert.throws(()=>pageEngine22NodeHistory({directory,afterRevision}),/INVALID_HISTORY_PAGINATION/);
 assert.throws(()=>pageEngine22NodeHistory({directory,limit:101}),/INVALID_HISTORY_PAGINATION/);
}));
