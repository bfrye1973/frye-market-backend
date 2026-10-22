import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
const cutover="2026-10-22T07:00:00.000Z";
const opening=(account,id,time)=>({brokerAccountLabel:account,brokerTransactionId:id,fillTime:time,brokerFillLegId:null});
test("offline acceptance passes for six verified scale-in fills and one MINOR fill without writing source",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine10-acceptance-"));
 try{
  const time="2026-10-22T13:42:18.000Z";
  const accounts=[["SCHWAB_0747","SWING","SUBMICRO"],["SCHWAB_6380","INTRADAY","MICRO"]];
  const trades=[],openings=[];
  for(const [label,legacy,strategy] of accounts){
   const ids=[1,2,3].map(i=>label+"-"+i);
   trades.push({tradeId:label+"-trade",accountMode:"REAL",journalAccount:legacy,brokerAccountLabel:label,entry:{time,brokerTransactionId:ids[0]},events:ids.map((id,i)=>({eventType:i===0?"REAL_ENTRY_FILL":"REAL_SCALE_IN_FILL",brokerTransactionId:id})),realBroker:{contracts:ids.map(id=>({contractId:id+"|CTR|1",status:"OPEN"}))},summary:{grossRealizedPnL:0,actualFees:0,netRealizedPnL:0}});
   for(const id of ids)openings.push(opening(label,id,time));
  }
  openings.push({...opening("SCHWAB_5671","134209487262",time),futuresContractCode:"MESZ26",positionEffect:"OPENING",direction:"LONG",side:"BUY",quantity:1,fillPrice:7730.25});
  const journal=path.join(dir,"journal.json"),evidence=path.join(dir,"evidence.json");
  fs.writeFileSync(journal,JSON.stringify(trades));fs.writeFileSync(evidence,JSON.stringify({schema:"engine8.oct22OriginalSchwabOpeningEvidence.v1",cutoverUtc:cutover,openings}));
  const original=fs.readFileSync(journal);
  const run=spawnSync(process.execPath,["services/core/engine10_oct22_offline_acceptance.mjs"],{cwd:process.cwd(),env:{...process.env,ENGINE10_JOURNAL_READ_PATH:journal,ENGINE8_OCT22_OPENINGS_FILE:evidence},encoding:"utf8"});
  assert.equal(run.status,0,run.stdout+"\n"+run.stderr);
  const report=JSON.parse(run.stdout);
  assert.equal(report.pass,true);
  assert.equal(report.plan.changes.length,2);
  assert.equal(report.minorResult.action,"ELIGIBLE_FOR_CANONICAL_INGESTION");
  assert.equal(report.accountingFieldsUnchanged,true);
  assert.deepEqual(fs.readFileSync(journal),original);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
