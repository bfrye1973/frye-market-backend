import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {appendWaveHistoryObservation,readWaveHistory} from "../logic/engine22/history/waveHistoryJournalV1.js";
import {NODE_EVENT_SCHEMA} from "../logic/engine22/history/nodeIdentityLedgerV1.js";

const moduleUri=pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)),"../logic/engine22/history/waveHistoryJournalV1.js")).href;
const source={
 ok:true,observedAt:"2026-11-08T20:00:00Z",
 content:{schema:"engine22.waveHistoryObservation.v1",symbol:"ES",
  degreeOrder:["primary","intermediate","minor","minute","subminute","micro","submicro"],
  selectionRevision:6,publishedAt:"2026-11-08T19:59:00Z",degrees:{},
  historicalAsOfSupported:false,noExecution:true}
};
const node={schema:NODE_EVENT_SCHEMA,type:"NODE_RECORDED",eventId:"persistent-node-event-1",
 nodeId:"persistent-node-1",waveId:"micro-w1",countId:"micro-w1-research-20261106",
 modelVersion:"research.v1",degree:"micro",parentWaveId:null,
 sourceReference:"sheet:Micro W1-W2 Proposed!A2:F3",sourceFingerprint:"owner-20261106",
 priceBasisId:"UNVERIFIED_ES",contractSymbol:"ES",label:"W1 START",
 marketAt:"2026-11-05T23:00:00Z",publishedAt:"2026-11-08T20:00:00Z",
 price:7321.75,approvalStatus:"RESEARCH",lifecycle:"DEVELOPING",
 revision:1,supersedesEventId:null,supersedesNodeId:null};
const subprocess=(directory,operation,payload=null)=>{
 const code=`
import {appendWaveHistoryObservation,readWaveHistory,pageWaveHistory} from ${JSON.stringify(moduleUri)};
const directory=process.argv[1],op=process.argv[2];
const payload=process.argv[3]?JSON.parse(process.argv[3]):null;
if(op==="append")process.stdout.write(JSON.stringify(appendWaveHistoryObservation({directory,...payload})));
else if(op==="read")process.stdout.write(JSON.stringify(readWaveHistory({directory})));
else if(op==="page")process.stdout.write(JSON.stringify(pageWaveHistory({directory,afterRevision:0,limit:10})));
else throw Error("INVALID_OPERATION");
`;
 return JSON.parse(execFileSync(process.execPath,["--input-type=module","-e",code,directory,operation,...(payload?[JSON.stringify(payload)]:[])],{encoding:"utf8"}));
};
test("journal and node revision survive separate Node.js process startups",()=>{
 const directory=mkdtempSync(join(tmpdir(),"engine22-restart-proof-"));
 try{
  const original=appendWaveHistoryObservation({directory,observation:source,nodeEvents:[node]});
  assert.equal(original.revision,1);
  const processB=subprocess(directory,"read");
  assert.equal(processB[0].eventHash,original.eventHash);
  assert.equal(processB[0].nodeEvents[0].nodeId,node.nodeId);
  const processC=subprocess(directory,"append",{observation:source,nodeEvents:[node]});
  assert.equal(processC.status,"UNCHANGED");
  const next={...node,eventId:"persistent-node-event-2",type:"NODE_STATUS_CHANGED",
   revision:2,supersedesEventId:node.eventId,approvalStatus:"SUPERSEDED",lifecycle:"SUPERSEDED",
   publishedAt:"2026-11-08T21:00:00Z"};
  const revised={...source,observedAt:"2026-11-08T21:00:00Z"};
  const processD=subprocess(directory,"append",{observation:revised,nodeEvents:[next]});
  assert.equal(processD.revision,2);
  const processE=subprocess(directory,"page");
  assert.equal(processE.totalRevisions,2);
  assert.equal(processE.items[0].nodeEvents[0].approvalStatus,"RESEARCH");
  assert.equal(processE.items[1].nodeEvents[0].approvalStatus,"SUPERSEDED");
  assert.equal(readWaveHistory({directory}).length,2);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test("corrupted journal rejects subsequent subprocess writes and retains identical bytes",()=>{
 const directory=mkdtempSync(join(tmpdir(),"engine22-restart-integrity-"));
 try{
  appendWaveHistoryObservation({directory,observation:source,nodeEvents:[node]});
  const file=join(directory,"wave-history.v1.jsonl");
  const corrupted=readFileSync(file,"utf8").replace('"price":7321.75','"price":7321.5');
  writeFileSync(file,corrupted);
  const before=readFileSync(file);
  assert.throws(()=>subprocess(directory,"append",{observation:source,nodeEvents:[]}),/JOURNAL_INTEGRITY_FAILURE/);
  assert.deepEqual(readFileSync(file),before);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
