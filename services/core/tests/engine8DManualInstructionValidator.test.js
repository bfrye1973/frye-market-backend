import test from "node:test";
import assert from "node:assert/strict";
import {MANUAL_PAPER_DEGREES} from "../logic/trading/manualPaperAccountRegistry.js";
import {validateManualPaperInstruction as validate} from "../logic/trading/validateManualPaperInstruction.js";
const account={accountId:MANUAL_PAPER_DEGREES[3].accountId,accountMode:"PAPER",
  cashBalance:10000,marginUsed:0,positions:{}};
function request(changes={}){return {accountId:account.accountId,
  idempotencyKey:"REQUEST-VALID-ONE",action:"BUY",intent:"OPEN_LONG",
  contract:"MESZ26",qty:2,price:7850,paper:true,...changes};}
test("manual MES LONG accepts owner quantity and correct per-contract margin",()=>{
  const out=validate(request(),account);
  assert.equal(out.ok,true);
  assert.equal(out.qty,2);
  assert.equal(out.multiplier,5);
  assert.equal(out.marginRequired,3000);
  assert.equal(out.fee,2.5);
});
test("ES unaffordable on a $10K account fails closed",()=>{
  assert.equal(validate(request({contract:"ESZ26",qty:1}),account).reason,
    "INSUFFICIENT_SIMULATED_BUYING_POWER");
});
test("valid SELL to open a SHORT preserves explicit direction",()=>{
  const out=validate(request({action:"SELL",intent:"OPEN_SHORT"}),account);
  assert.equal(out.ok,true);
  assert.equal(out.side,"SHORT");
});
test("inconsistent action/intent, missing account and invalid expiration rejected",()=>{
  assert.equal(validate(request({action:"BUY",intent:"OPEN_SHORT"}),account).reason,"SIDE_AND_INTENT_CONFLICT");
  assert.equal(validate(request({accountId:"PAPER-FAKE"}),account).reason,"ACCOUNT_IDENTITY_MISMATCH");
  assert.equal(validate(request({contract:"MES"}),account).reason,"INVALID_ES_MES_EXPIRATION");
});
test("position closing never creates a replacement opening position",()=>{
  const owned={...account,positions:{MESZ26:{side:"LONG",qty:3}}};
  const partial=validate(request({action:"REDUCE",intent:"CLOSE_LONG",qty:1}),owned);
  assert.equal(partial.ok,true);
  assert.equal(partial.opening,false);
  assert.equal(validate(request({action:"CLOSE",intent:"CLOSE_LONG",qty:2}),owned).reason,
    "CLOSE_REQUIRES_FULL_QUANTITY");
  assert.equal(validate(request({action:"CLOSE",intent:"CLOSE_LONG",qty:4}),owned).reason,
    "CLOSE_QUANTITY_EXCEEDS_OWNED_POSITION");
  assert.equal(validate(request({action:"REDUCE",intent:"CLOSE_SHORT",qty:1}),owned).reason,
    "CLOSE_QUANTITY_EXCEEDS_OWNED_POSITION");
});
test("opposite exposure cannot reverse or net across contracts",()=>{
  const owned={...account,positions:{MESZ26:{side:"SHORT",qty:2}}};
  assert.equal(validate(request(),owned).reason,"POSITION_REVERSAL_FORBIDDEN");
  assert.equal(validate(request({intent:"CLOSE_SHORT",action:"BUY",contract:"MESU26",qty:1}),owned).reason,
    "CLOSE_QUANTITY_EXCEEDS_OWNED_POSITION");
});
test("invalid tick, noninteger size and REAL account modes blocked",()=>{
  assert.equal(validate(request({price:7850.1}),account).reason,"INVALID_FUTURES_TICK_PRICE");
  assert.equal(validate(request({qty:1.2}),account).reason,"INVALID_CONTRACT_QUANTITY");
  assert.equal(validate(request({accountMode:"REAL"}),account).reason,"PAPER_ONLY_ENFORCED");
});
