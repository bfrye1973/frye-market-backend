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
