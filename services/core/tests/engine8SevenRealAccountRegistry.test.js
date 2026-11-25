import test from "node:test";
import assert from "node:assert/strict";
import {
  SCHWAB_REAL_ACCOUNT_REGISTRY,
  SCHWAB_REAL_STRATEGY_CUTOVER_UTC,
  getSchwabRealCutoverHint,
} from "../logic/trading/schwab/engine8RealAccountRegistry.js";
import {selectApprovedSchwabRealAccounts as select} from "../logic/trading/schwab/selectApprovedSchwabRealAccounts.js";

const discovered=SCHWAB_REAL_ACCOUNT_REGISTRY.map(x=>({
  maskedAccountNumber:"****"+x.last4,accountHash:"fake-"+x.last4
}));

test("seven named Schwab strategy accounts have unique stable broker identities",()=>{
  assert.equal(discovered.length,7);
  assert.equal(new Set(SCHWAB_REAL_ACCOUNT_REGISTRY.map(x=>x.last4)).size,7);
  assert.deepEqual(SCHWAB_REAL_ACCOUNT_REGISTRY.map(x=>x.strategy),
    ["SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"]);
});

test("production two-account default remains intact",()=>{
  const r=select(discovered);
  assert.equal(r.ok,true);
  assert.equal(r.approved.length,2);
  assert.equal(r.skippedCount,5);
  assert.deepEqual(r.approved.map(x=>x.identity.journalAccount).sort(),["INTRADAY","SWING"]);
});

test("seven-account discovery is explicit and all seven hashes required",()=>{
  const r=select(discovered,{accountScope:"SEVEN_STRATEGIES"});
  assert.equal(r.ok,true);
  assert.equal(r.approved.length,7);
  assert.equal(r.skippedCount,0);
  assert.equal(r.approved.filter(x=>x.identity.journalAccount===null).length,5);
});

test("missing, repeated, or hashless approved accounts fail closed",()=>{
  assert.equal(select(discovered.slice(0,6),{accountScope:"SEVEN_STRATEGIES"}).ok,false);
  assert.equal(select([...discovered,discovered[1]],{accountScope:"SEVEN_STRATEGIES"}).ok,false);
  assert.equal(select(discovered.map((x,i)=>i===3?{...x,accountHash:""}:x),{accountScope:"SEVEN_STRATEGIES"}).ok,false);
});

test("unrelated Schwab accounts cannot become strategy accounts",()=>{
  const r=select([...discovered,{maskedAccountNumber:"****9999",accountHash:"test"}],{accountScope:"SEVEN_STRATEGIES"});
  assert.equal(r.ok,true);
  assert.equal(r.skippedCount,1);
  assert.equal(r.approved.length,7);
});

test("classification hint honors Arizona midnight UTC but is not accounting authority",()=>{
  assert.equal(SCHWAB_REAL_STRATEGY_CUTOVER_UTC,"2026-10-22T07:00:00.000Z");
  const before=getSchwabRealCutoverHint("****0747","2026-10-22T06:59:59Z");
  const after=getSchwabRealCutoverHint("****0747","2026-10-22T07:00:00Z");
  assert.equal(before.proposedPerformanceGroup,"SWING");
  assert.equal(after.proposedPerformanceGroup,"SUBMICRO");
  assert.equal(after.authoritative,false);
  assert.equal(getSchwabRealCutoverHint("****5671","not-a-date"),null);
});
