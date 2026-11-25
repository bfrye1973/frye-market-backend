import test from "node:test";
import assert from "node:assert/strict";
import {
 verifyEngine10RealFillIdentity,
 OCT23_ACK_REPAIR_IDS
} from "../logic/trading/schwab/engine8RealAckVerification.js";
import {
 reconcileDurablePendingRealFills,selectDurablePendingRealFills
} from "../logic/trading/schwab/reconcileDurablePendingRealFills.js";
const fill=(id="134078717961")=>({
 broker:"SCHWAB",brokerAccountLabel:"SCHWAB_6380",journalAccount:"INTRADAY",
 brokerTransactionId:id,brokerFillLegId:null,brokerFillIdentity:null,
 fillTime:"2026-10-22T13:42:18+0000",fillPrice:7730.25,quantity:1,
 futuresContractCode:"MESZ26",positionEffect:"OPENING",side:"BUY"
});
const journal=f=>[{
 tradeId:"ORIGINAL-TRADE",accountMode:"REAL",journalAccount:"INTRADAY",
 brokerAccountLabel:f.brokerAccountLabel,
 events:[{broker:"SCHWAB",brokerTransactionId:f.brokerTransactionId,
  eventType:"REAL_ENTRY_FILL",ts:"2026-10-22T13:42:18Z",price:f.fillPrice,
  fillQuantity:f.quantity,positionEffect:f.positionEffect,side:f.side,
  futuresContractCode:f.futuresContractCode}]
}];
const record=f=>({dedupeKey:"KEY-"+f.brokerTransactionId,
 normalizedFill:f,delivered:false,deliveryStatus:"ENGINE10_NOT_ACKNOWLEDGED",
 attemptCount:0});
test("three named acknowledgement repairs are never replayed",async()=>{
 assert.equal(OCT23_ACK_REPAIR_IDS.length,3);
 let requests=0;const updates=[];
 const state={observations:Object.fromEntries(OCT23_ACK_REPAIR_IDS.map(id=>["KEY-"+id,record(fill(id))]))};
 const j=OCT23_ACK_REPAIR_IDS.flatMap(id=>journal(fill(id)));
 const out=await reconcileDurablePendingRealFills({
  stateReader:()=>state,journalReader:()=>j,
  update:(k,p)=>updates.push({key:k,patch:p}),
  deliver:async()=>{requests++;throw Error("SHOULD_NEVER_POST")}
 });
 assert.equal(out.journalVerified,3);
 assert.equal(requests,0);
 assert.equal(updates.length,3);
 assert.ok(updates.every(x=>x.patch.deliveryStatus==="ENGINE10_ACKNOWLEDGED"));
 assert.equal(out.watermarksChanged,false);
});
test("three named identities stay pending when exact Journal evidence absent",async()=>{
 let posts=0;
 const state={observations:{"x":record(fill("134080532535"))}};
 const out=await reconcileDurablePendingRealFills({
  stateReader:()=>state,journalReader:()=>[],
  update:()=>{throw Error("SHOULD_NOT_MARK")},
  deliver:async()=>{posts++}
 });
 assert.equal(posts,0);assert.equal(out.heldForExactAudit,1);
});
test("same broker parent but mismatched fill price does not prove Journal receipt",()=>{
 const f=fill();const j=journal(f);j[0].events[0].price=9999;
 assert.equal(verifyEngine10RealFillIdentity(j,f).confirmed,false);
});
test("broker physical account identity must match",()=>{
 const f=fill();const j=journal(f);j[0].brokerAccountLabel="SCHWAB_0747";
 assert.equal(verifyEngine10RealFillIdentity(j,f).confirmed,false);
});
test("ordinary persisted missing fill is retried using original payload, no watermark update",async()=>{
 const f=fill("DIFFERENT-ID"),state={observations:{abc:{...record(f),dedupeKey:"abc"}}};
 const updates=[];let actual;
 const out=await reconcileDurablePendingRealFills({
  stateReader:()=>state,journalReader:()=>[],
  update:(k,p)=>updates.push({k,p}),
  deliver:async delivered=>{actual=delivered;return {httpOk:true,body:{ok:true,
   journalCompleted:true,brokerTransactionId:f.brokerTransactionId,tradeId:"ENGINE10-ACK"}}}
 });
 assert.deepEqual(actual,f);assert.equal(out.retried,1);assert.equal(out.acknowledged,1);
 assert.equal(updates[0].p.engine10TradeId,"ENGINE10-ACK");
 assert.equal(out.watermarksChanged,false);
});
test("ambiguous Engine 10 identity never triggers replay",async()=>{
 const f=fill("TEST"),j=[...journal(f),...journal(f)];
 let attempts=0;
 const out=await reconcileDurablePendingRealFills({
  stateReader:()=>({observations:{test:record(f)}}),
  journalReader:()=>j,update:()=>{},deliver:async()=>{attempts++;}
 });
 assert.equal(out.pending,1);assert.equal(attempts,0);
});
test("backoff prevents repeated rapid retries",()=>{
 const candidate=record(fill("RAPID"));candidate.lastAttemptAt="2026-10-23T17:00:00Z";
 candidate.attemptCount=3;
 const state={observations:{x:candidate}};
 assert.equal(selectDurablePendingRealFills(state,new Date("2026-10-23T17:00:05Z")).length,0);
});
