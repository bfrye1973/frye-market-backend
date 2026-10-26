import test from "node:test";import assert from "node:assert/strict";
import {projectSnapshotMicroAccount as run} from "../positionIntelligence/projectSnapshotMicroAccount.js";
const account={accountRole:"INTRADAY",degree:"micro",
 brokerBinding:{brokerAccountLabel:"SCHWAB_6380"},position:{positionPresent:true,direction:"LONG",contracts:4,campaignCount:1},thesisState:"ENTRY_STRUCTURE_UNAVAILABLE"};
const snapshot={symbol:"ES",strategyAccountMonitoring:{version:"redline.strategyAccountMonitoring.v2",mode:"READ_ONLY",accounts:[account]}};
test("real Micro account aggregate is displayed from existing snapshot without journal export",()=>{
 const r=run(snapshot);assert.equal(r.available,true);assert.equal(r.openContracts,4);assert.equal(r.direction,"LONG");
 assert.equal(r.aggregateOnly,true);assert.equal(r.officialPlanStatus,"OFFICIAL_PLAN_UNAVAILABLE");
 assert.equal(r.noExecution,true);
});
test("missing monitoring is unavailable not flat or zero",()=>{const r=run({symbol:"ES"});assert.equal(r.available,false);assert.equal(r.openContracts,null)});
test("other Schwab account cannot masquerade as Micro",()=>{const s=structuredClone(snapshot);s.strategyAccountMonitoring.accounts[0].brokerBinding.brokerAccountLabel="SCHWAB_0747";assert.equal(run(s).available,false)});
test("two Micro rows are rejected",()=>{const s=structuredClone(snapshot);s.strategyAccountMonitoring.accounts.push(structuredClone(account));assert.equal(run(s).available,false)});
test("invalid contract aggregates fail closed",()=>{const s=structuredClone(snapshot);s.strategyAccountMonitoring.accounts[0].position.contracts=-2;assert.equal(run(s).available,false)});
test("zero verified OPEN units is distinct from unavailable",()=>{const s=structuredClone(snapshot);s.strategyAccountMonitoring.accounts[0].position={positionPresent:false,contracts:0,direction:"FLAT"};const r=run(s);assert.equal(r.available,true);assert.equal(r.openContracts,0)});
test("snapshot never altered",()=>{const s=structuredClone(snapshot);run(snapshot);assert.deepEqual(snapshot,s)});
