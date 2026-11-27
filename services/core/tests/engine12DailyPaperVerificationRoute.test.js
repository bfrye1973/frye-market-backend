import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import {makeTradeInvestigatorRouter} from "../routes/tradeInvestigator.js";
import {buildPrivatePaperReceipt} from "../logic/trading/engine8PrivatePaperReceipt.js";

const KEY="k".repeat(40),auth={"X-Trade-Investigator-Access":KEY};
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e12-route-")),paperDir=path.join(root,"paper"),journalDir=path.join(root,"journal"),receiptDir=path.join(root,"receipts"),replayRoot=path.join(root,"replay");
 fs.mkdirSync(paperDir,{mode:0o700});fs.mkdirSync(journalDir,{mode:0o700});fs.mkdirSync(receiptDir,{mode:0o700});fs.mkdirSync(replayRoot,{mode:0o700});
 const write=(n,v)=>fs.writeFileSync(path.join(paperDir,n),JSON.stringify(v));
 write("paper-orders.json",[]);write("paper-executions.json",[]);write("engine8-paper-execution-state.json",{});write("paper-idempotency-ledger.json",{});write("engine8-paper-acceptance-state.json",{});
 fs.writeFileSync(path.join(journalDir,"trade-journal.json"),"[]");
 return {root,paperDir,journalDir,receiptDir,replayRoot,write};
}
async function serve(sc){
 const app=express();app.use("/api/v1",makeTradeInvestigatorRouter({settings:{TRADE_INVESTIGATOR_ENABLED:"true",TRADE_INVESTIGATOR_ACCESS_KEY:KEY,ENGINE8_PAPER_DATA_DIR:sc.paperDir,TRADE_JOURNAL_DIR:sc.journalDir,TRADE_INVESTIGATOR_REPLAY_ROOT:sc.replayRoot,ENGINE8_PAPER_VERIFICATION_DIR:sc.receiptDir},log:()=>{}}));
 const server=await new Promise(r=>{const s=app.listen(0,"127.0.0.1",()=>r(s));});return {base:"http://127.0.0.1:"+server.address().port+"/api/v1/trade-investigator",close:()=>new Promise(r=>server.close(r))};
}
function saveReceipt(sc,receipt){
 const name="2026-11-27-"+crypto.createHash("sha256").update(receipt.cycleId).digest("hex")+".json";
 fs.writeFileSync(path.join(sc.receiptDir,name),JSON.stringify(receipt),{mode:0o600});
}
test("daily/latest require same private auth",async()=>{const sc=fixture(),srv=await serve(sc);assert.equal((await fetch(srv.base+"/daily?date=2026-11-27")).status,401);assert.equal((await fetch(srv.base+"/latest?date=2026-11-27",{headers:{"X-Trade-Investigator-Access":"bad".repeat(20)}})).status,403);await srv.close();fs.rmSync(sc.root,{recursive:true,force:true});});
test("empty stores remain UNKNOWN and no-store",async()=>{const sc=fixture(),srv=await serve(sc);const r=await fetch(srv.base+"/daily?date=2026-11-27",{headers:auth});assert.equal(r.status,200);assert.equal(r.headers.get("cache-control"),"no-store");const b=await r.json();assert.equal(b.verdict,"UNKNOWN");assert.equal(b.counts.verifiedFills,0);await srv.close();fs.rmSync(sc.root,{recursive:true,force:true});});
test("latest exposes reported approved candidate blocker without inventing fill",async()=>{
 const sc=fixture(),created="2026-11-27T15:01:01.000Z";
 const receipt=buildPrivatePaperReceipt({mode:"PAPER",cycleId:"cycle-1",approvalSnapshotTime:"2026-11-27T15:00:00.000Z",approvalSnapshotHash:"a".repeat(64),cycleTime:"2026-11-27T15:01:00.000Z",strategyId:"intraday_scalp@10m",candidateId:"C1",planId:"P1",engine6Permission:true,engine8Eligible:null,engine8Executable:false,executorInvoked:false,skipReason:"PAPER_ACCEPTANCE_STATE_UNAVAILABLE",rejectReason:null,blockers:["PAPER_ACCEPTANCE_STATE_UNAVAILABLE"],orderCreated:false,orderId:null,executionId:null,tradeId:null,fillStatus:null,filledQuantity:null,fillPrice:null,fillTime:null,journalAckStatus:"UNKNOWN"},created);
 saveReceipt(sc,receipt);const srv=await serve(sc);
 const b=await (await fetch(srv.base+"/latest?date=2026-11-27",{headers:auth})).json();
 assert.equal(b.status,"APPROVAL_REPORTED_SKIPPED");assert.equal(b.reported.skipReason,"PAPER_ACCEPTANCE_STATE_UNAVAILABLE");assert.equal(b.independent.fill,null);assert.equal(b.dailyVerdict,"UNKNOWN");
 await srv.close();fs.rmSync(sc.root,{recursive:true,force:true});
});
test("verified durable fill still produces YES",async()=>{
 const sc=fixture(),t="2026-11-27T15:10:00.000Z";
 sc.write("paper-orders.json",[{paper:true,orderId:"O1",strategyId:"intraday_scalp@10m",action:"NEW_ENTRY",idempotencyKey:"I1",status:"FILLED",filledQty:3,avgPrice:6000,filledAt:t,sourceSignal:{candidateId:"C1",planId:"P1",executionId:"X1"}}]);
 sc.write("paper-executions.json",[{orderId:"O1",strategyId:"intraday_scalp@10m",action:"NEW_ENTRY",idempotencyKey:"I1",status:"FILLED",filledQty:3,avgPrice:6000,ts:t,sourceSignal:{candidateId:"C1",planId:"P1",executionId:"X1"}}]);
 fs.writeFileSync(path.join(sc.journalDir,"trade-journal.json"),JSON.stringify([{tradeId:"T1",accountMode:"PAPER",strategyId:"intraday_scalp@10m",status:"OPEN",identity:{candidateId:"C1",planId:"P1",orderId:"O1",openingExecutionId:"X1",idempotencyKey:"I1"},orderLink:{orderId:"O1",executionId:"X1",idempotencyKey:"I1"},entry:{time:t,price:6000,qty:3},qty:{originalQty:3,remainingQty:3},events:[]}]));
 const srv=await serve(sc),b=await (await fetch(srv.base+"/daily?date=2026-11-27",{headers:auth})).json();assert.equal(b.verdict,"YES");assert.equal(b.counts.verifiedFills,1);await srv.close();fs.rmSync(sc.root,{recursive:true,force:true});
});
