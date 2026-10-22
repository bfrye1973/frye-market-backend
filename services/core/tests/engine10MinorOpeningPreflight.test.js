import test from "node:test";
import assert from "node:assert/strict";
import {preflightMinorOpening} from "../logic/journal/minorOpeningPreflight.js";
const fill={brokerAccountLabel:"SCHWAB_5671",brokerTransactionId:"134209487262",fillTime:"2026-10-22T13:42:18Z",futuresContractCode:"MESZ26",positionEffect:"OPENING",direction:"LONG",side:"BUY",quantity:1,fillPrice:7730.25};
test("MINOR verified fill eligible once when absent",()=>{
 const r=preflightMinorOpening([],fill);
 assert.equal(r.ok,true);assert.equal(r.action,"ELIGIBLE_FOR_CANONICAL_INGESTION");
});
test("MINOR verified fill already present cannot be ingested twice",()=>{
 const t={accountMode:"REAL",tradeId:"existing",events:[{brokerTransactionId:fill.brokerTransactionId}]};
 assert.equal(preflightMinorOpening([t],fill).action,"ALREADY_RECORDED");
});
test("MINOR mismatched account, quantity or price fails closed",()=>{
 for(const delta of [{brokerAccountLabel:"SCHWAB_0747"},{quantity:2},{fillPrice:7731.25}]){
  assert.equal(preflightMinorOpening([],{...fill,...delta}).action,"BLOCK");
 }
});

test("equivalent ISO timestamp formatting is accepted",()=>{
 const r=preflightMinorOpening([],{...fill,fillTime:"2026-10-22T13:42:18.000Z"});
 assert.equal(r.ok,true);assert.equal(r.action,"ELIGIBLE_FOR_CANONICAL_INGESTION");
});
test("different instant and invalid timestamps are blocked",()=>{
 for(const time of ["2026-10-22T13:42:19.000Z","not-a-date"]){
  assert.equal(preflightMinorOpening([],{...fill,fillTime:time}).action,"BLOCK");
 }
});
