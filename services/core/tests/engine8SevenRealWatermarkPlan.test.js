import test from "node:test";
import assert from "node:assert/strict";
import {planSevenRealAccountWatermarkCutover as plan} from "../logic/trading/schwab/planSevenRealAccountWatermarks.js";

test("preserves historical account watermarks without mutating them",()=>{
 const state={accounts:{
  SCHWAB_6380:{brokerAccountLabel:"SCHWAB_6380",journalAccount:"INTRADAY",lastBrokerFillTimeSeen:"2026-10-21T19:00:00Z"},
  SCHWAB_0747:{brokerAccountLabel:"SCHWAB_0747",journalAccount:"SWING",lastBrokerFillTimeSeen:"2026-10-21T20:00:00Z"}
 }};
 const before=JSON.stringify(state);
 const result=plan(state);
 assert.equal(result.ok,true);
 assert.equal(result.accounts.length,7);
 assert.equal(result.canEnableLiveDelivery,false);
 assert.equal(result.accounts.filter(x=>x.mustPreserveExistingWatermark).length,2);
 assert.equal(result.accounts.filter(x=>x.earliestRequiredReconciliationUtc==="2026-10-22T07:00:00.000Z").length,5);
 assert.equal(JSON.stringify(state),before);
});
test("historical account relabel conflict fails closed",()=>{
 const r=plan({accounts:{SCHWAB_0747:{brokerAccountLabel:"SCHWAB_0747",journalAccount:"SUBMICRO"}}});
 assert.equal(r.ok,false);
 assert.equal(r.reason,"HISTORICAL_WATERMARK_ACCOUNT_CONFLICT");
});
test("new strategy account cannot inherit another journal account",()=>{
 const r=plan({accounts:{SCHWAB_5671:{brokerAccountLabel:"SCHWAB_5671",journalAccount:"SWING"}}});
 assert.equal(r.ok,false);
 assert.equal(r.reason,"NEW_WATERMARK_ACCOUNT_CONFLICT");
});
test("missing or damaged state does not signal activation ready",()=>{
 assert.equal(plan(null).ok,false);
 assert.equal(plan({accounts:[]}).ok,false);
});
