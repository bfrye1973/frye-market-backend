import test from "node:test";
import assert from "node:assert/strict";
import {resolveEngine10OpenPaperDirection as resolve} from "../logic/engine3/v6/resolveEngine10OpenPaperDirection.js";
const trade=(direction,other={})=>({status:"OPEN",accountMode:"PAPER",symbol:"ES",
 strategyId:"intraday_scalp@10m",direction,tradeId:"TRADE-1",qty:{remainingQty:3},...other});
test("only Engine10 OPEN PAPER matching lane can lock direction",()=>{
 assert.deepEqual(resolve({trades:[trade("SHORT")]}).lockedTradeDirection,"SHORT");
 assert.equal(resolve({trades:[trade("LONG",{accountMode:"REAL"})]}).openTradeActive,false);
 assert.equal(resolve({trades:[trade("LONG",{status:"CLOSED"})]}).openTradeActive,false);
 assert.equal(resolve({trades:[trade("LONG",{symbol:"MES"})]}).openTradeActive,false);
 assert.equal(resolve({trades:[trade("LONG",{strategyId:"OTHER"})]}).openTradeActive,false);
});
test("ambiguous open paper trades fail closed, no invented lock",()=>{
 const r=resolve({trades:[trade("LONG"),trade("SHORT")]});
 assert.equal(r.openTradeActive,false);assert.equal(r.blocker,true);
 assert.equal(resolve({trades:[trade("SIDEWAYS")]}).openTradeActive,false);
 assert.equal(resolve({trades:[trade("SHORT",{qty:{remainingQty:0}})]}).blocker,true);
 assert.equal(resolve({trades:[trade("SHORT",{tradeId:null})]}).blocker,true);
 assert.equal(resolve({trades:[trade("SHORT",{qty:null})]}).blocker,true);
 assert.equal(resolve({trades:null}).openTradeActive,false);
 assert.equal(resolve({trades:null}).blocker,true);
 assert.equal(resolve({trades:[],readSucceeded:false}).reasonCode,"ENGINE10_OPEN_TRADE_READ_UNVERIFIED");
 assert.equal(resolve({trades:[trade("LONG"),trade("LONG")]}).blocker,true);
});

const verified=(verifiedAtMs=1000000)=>({
 source:"ENGINE10_JOURNAL",symbol:"ES",strategyId:"intraday_scalp@10m",
 lockedTradeDirection:"SHORT",tradeId:"TRADE-1",remainingQty:3,verifiedAtMs,
});
test("journal failure holds recent verified lock but flags blocked/unverified",()=>{
 const r=resolve({trades:null,readSucceeded:false,priorVerifiedLock:verified(),
  evaluationTimeMs:1000000+9*60000});
 assert.equal(r.openTradeActive,true);
 assert.equal(r.lockedTradeDirection,"SHORT");
 assert.equal(r.blocker,true);
 assert.equal(r.lifecycleVerified,false);
 assert.equal(r.fallbackFromVerified,true);
});
test("ambiguous multiple OPEN trades cannot erase recent verified lock",()=>{
 const r=resolve({trades:[trade("SHORT"),trade("LONG",{tradeId:"TRADE-2"})],
  priorVerifiedLock:verified(),evaluationTimeMs:1000000+60000});
 assert.equal(r.openTradeActive,true);assert.equal(r.blocker,true);
 assert.equal(r.lockedTradeDirection,"SHORT");
});
test("expired or mismatched verified lock is not usable; no indefinite latch",()=>{
 const expired=resolve({trades:null,readSucceeded:false,priorVerifiedLock:verified(),
  evaluationTimeMs:1000000+11*60000});
 assert.equal(expired.openTradeActive,false);
 assert.equal(expired.blocker,true);
 const wrong=resolve({trades:null,readSucceeded:false,
  priorVerifiedLock:{...verified(),strategyId:"OTHER"},evaluationTimeMs:1000000+60000});
 assert.equal(wrong.openTradeActive,false);
});
test("verified empty OPEN list is distinct from an unreadable journal",()=>{
 const r=resolve({trades:[],readSucceeded:true,priorVerifiedLock:verified(),
  evaluationTimeMs:1000000+60000});
 assert.equal(r.openTradeActive,false);
 assert.equal(r.lifecycleVerified,true);
 assert.equal(r.blocker,false);
});
