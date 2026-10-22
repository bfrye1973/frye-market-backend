import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRealCampaignAtEntry,
  brokerIdentityPartition,
  REAL_ACCOUNT_REGISTRY,
  REAL_STRATEGY_CUTOVER_UTC
} from "../logic/journal/realAccountClassification.js";

test("seven unique authorized broker partitions",()=>{
  assert.equal(REAL_ACCOUNT_REGISTRY.length,7);
  assert.equal(new Set(REAL_ACCOUNT_REGISTRY.map(x=>x.brokerAccountLabel)).size,7);
  for(const a of REAL_ACCOUNT_REGISTRY)assert.equal(brokerIdentityPartition(a.brokerAccountLabel),a.brokerAccountLabel);
  assert.equal(brokerIdentityPartition("SCHWAB_UNKNOWN"),null);
});

test("existing legacy campaigns remain locked across cutover",()=>{
  const t={journalAccount:"SWING",brokerAccountLabel:"SCHWAB_0747"};
  assert.equal(classifyRealCampaignAtEntry({brokerAccountLabel:"SCHWAB_0747",entryTime:"2026-10-23T00:00:00Z",existingCampaign:t}).classification,"SWING");
  const i={journalAccount:"INTRADAY",brokerAccountLabel:"SCHWAB_6380"};
  assert.equal(classifyRealCampaignAtEntry({entryTime:"2026-10-23T00:00:00Z",existingCampaign:i}).classification,"INTRADAY");
});

test("before cutover historical; at cutover strategy",()=>{
  assert.equal(REAL_STRATEGY_CUTOVER_UTC,"2026-10-22T07:00:00.000Z");
  assert.equal(classifyRealCampaignAtEntry({brokerAccountLabel:"SCHWAB_0747",entryTime:"2026-10-22T06:59:59Z"}).classification,"SWING");
  assert.equal(classifyRealCampaignAtEntry({brokerAccountLabel:"SCHWAB_0747",entryTime:"2026-10-22T07:00:00Z"}).classification,"SUBMICRO");
  assert.equal(classifyRealCampaignAtEntry({brokerAccountLabel:"SCHWAB_6380",entryTime:"2026-10-22T07:00:00Z"}).classification,"MICRO");
});

test("new account cannot produce fictitious historical campaigns",()=>{
  assert.equal(classifyRealCampaignAtEntry({brokerAccountLabel:"SCHWAB_5671",entryTime:"2026-10-21T00:00:00Z"}).ok,false);
  assert.equal(classifyRealCampaignAtEntry({brokerAccountLabel:"SCHWAB_5671",entryTime:"2026-10-22T13:42:18Z"}).classification,"MINOR");
});

test("unknown account and missing timestamps fail closed",()=>{
  assert.equal(classifyRealCampaignAtEntry({brokerAccountLabel:"SCHWAB_UNKNOWN",entryTime:"2026-10-22T13:42:18Z"}).ok,false);
  assert.equal(classifyRealCampaignAtEntry({brokerAccountLabel:"SCHWAB_5671",entryTime:null}).ok,false);
});
