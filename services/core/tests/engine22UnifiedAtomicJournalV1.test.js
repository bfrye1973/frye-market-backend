import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {appendWaveHistoryObservation,readWaveHistory,pageWaveHistory} from "../logic/engine22/history/waveHistoryJournalV1.js";
import {NODE_EVENT_SCHEMA} from "../logic/engine22/history/nodeIdentityLedgerV1.js";
const observation={ok:true,observedAt:"2026-11-08T20:00:00Z",content:{
 schema:"engine22.waveHistoryObservation.v1",publishedAt:"2026-11-08T19:58:00Z",
 symbol:"ES",degreeOrder:["primary","intermediate","minor","minute","subminute","micro","submicro"],
 selectionRevision:6,degrees:{},noExecution:true,historicalAsOfSupported:false
}};
const node={schema:NODE_EVENT_SCHEMA,type:"NODE_RECORDED",eventId:"node-event-1",
 nodeId:"historical-micro-1",waveId:"micro-w1",countId:"micro-research-nov6",
 modelVersion:"engine22.microW2Nov6Research.v1",degree:"micro",parentWaveId:null,
 sourceReference:"sheet:Micro W1-W2 Proposed!A2:F3",sourceFingerprint:"owner-20261106",
 priceBasisId:"UNVERIFIED_ES",contractSymbol:"ES",label:"W1 START",
 marketAt:"2026-11-05T23:00:00Z",publishedAt:"2026-11-08T20:00:00Z",
 price:7321.75,approvalStatus:"RESEARCH",lifecycle:"DEVELOPING",revision:1,
 supersedesEventId:null,supersedesNodeId:null};
const withDirectory=fn=>{const d=mkdtempSync(join(tmpdir(),"engine22-unified-node-journal-"));
 try{return fn(d);}finally{rmSync(d,{force:true,recursive:true});}};
test("one atomic journal revision stores both observation and individual node events",()=>withDirectory(directory=>{
 const a=appendWaveHistoryObservation({directory,observation,nodeEvents:[node]});
 assert.equal(a.status,"APPENDED");assert.equal(a.revision,1);
 const events=readWaveHistory({directory});
 assert.equal(events.length,1);
 assert.deepEqual(events[0].nodeEvents,[node]);
 assert.equal(events[0].content.symbol,"ES");
 assert.equal(pageWaveHistory({directory,afterRevision:0}).items[0].nodeEvents[0].nodeId,node.nodeId);
 assert.equal(appendWaveHistoryObservation({directory,observation,nodeEvents:[node]}).status,"UNCHANGED");
 assert.equal(readWaveHistory({directory}).length,1);
}));
test("second node revision retains the original and survives re-opening journal file",()=>withDirectory(directory=>{
 appendWaveHistoryObservation({directory,observation,nodeEvents:[node]});
 const revised={...node,type:"NODE_STATUS_CHANGED",eventId:"node-event-2",revision:2,
 supersedesEventId:"node-event-1",approvalStatus:"SUPERSEDED",lifecycle:"SUPERSEDED",
 publishedAt:"2026-11-08T21:00:00Z"};
 assert.equal(appendWaveHistoryObservation({directory,observation:{...observation,observedAt:"2026-11-08T21:00:00Z"},nodeEvents:[revised]}).revision,2);
 const restarted=readWaveHistory({directory});
 assert.equal(restarted[0].nodeEvents[0].approvalStatus,"RESEARCH");
 assert.equal(restarted[1].nodeEvents[0].approvalStatus,"SUPERSEDED");
 assert.equal(pageWaveHistory({directory,afterRevision:1}).items.length,1);
}));
test("invalid node revision fails before any append; previous journal bytes unchanged",()=>withDirectory(directory=>{
 appendWaveHistoryObservation({directory,observation,nodeEvents:[node]});
 const file=join(directory,"wave-history.v1.jsonl"),before=readFileSync(file);
 const invalid={...node,eventId:"node-event-2",type:"NODE_STATUS_CHANGED",revision:2,
 supersedesEventId:"node-event-1",price:7500.25};
 assert.throws(()=>appendWaveHistoryObservation({directory,observation,nodeEvents:[invalid]}),/STATUS_REWROTE_ANCHOR/);
 assert.deepEqual(readFileSync(file),before);
 assert.equal(readWaveHistory({directory}).length,1);
}));
test("tampered embedded node event is rejected by journal hash integrity validation",()=>withDirectory(directory=>{
 appendWaveHistoryObservation({directory,observation,nodeEvents:[node]});
 const file=join(directory,"wave-history.v1.jsonl");
 const tampered=readFileSync(file,"utf8").replace('"price":7321.75','"price":7321.5');
 writeFileSync(file,tampered);
 assert.throws(()=>readWaveHistory({directory}),/JOURNAL_INTEGRITY_FAILURE/);
}));
test("legacy journal observation without nodeEvents remains backward-compatible",()=>withDirectory(directory=>{
 const first=appendWaveHistoryObservation({directory,observation});
 assert.equal(first.status,"APPENDED");
 const r=readWaveHistory({directory});
 assert.equal(r.length,1);
 assert.equal(Object.hasOwn(r[0],"nodeEvents"),false);
}));
