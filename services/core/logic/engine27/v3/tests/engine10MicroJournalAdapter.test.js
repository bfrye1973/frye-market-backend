import test from "node:test";import assert from "node:assert/strict";
import {projectEngine10MicroJournal as read,summarizeEngine10Micro as sum} from "../positionIntelligence/projectEngine10MicroJournal.js";
const one={accountMode:"REAL",brokerAccountLabel:"SCHWAB_6380",status:"OPEN",
 tradeId:"T-1",symbol:"/MESZ26:XCME",direction:"LONG",strategyId:"schwab_real@broker",
 structuralContextAtEntry:null,realBroker:{contracts:[{status:"OPEN",contractId:"C-1",
 entryPrice:7681.25,openingFillTime:"2026-10-26T13:00:00Z",
 futuresContractCode:"MESZ26",openingBrokerTransactionId:"TX-1",
 openingBrokerFillLegId:"LEG-1",brokerAccountLabel:"SCHWAB_6380"}]}};
test("authorized real campaign retained even with broker-import strategy ID",()=>{
 const out=read({ok:true,trades:[one]});assert.equal(out.ok,true);
 assert.equal(out.trades.length,1);assert.equal(out.trades[0].tradeId,"T-1");
});
test("account isolation and OPEN status",()=>{
 const closed={...one,status:"CLOSED"};
 const other={...one,brokerAccountLabel:"SCHWAB_0747"};
 const out=read({ok:true,trades:[closed,other]});assert.equal(out.ok,true);assert.equal(out.trades.length,0);
});
test("missing source fails closed instead of claiming no open positions",()=>{
 const out=read(null);assert.equal(out.ok,false);assert.deepEqual(out.trades,[]);
});
test("contract provenance and duplicate open IDs are required",()=>{
 const invalid=structuredClone(one);delete invalid.realBroker.contracts[0].openingBrokerFillLegId;
 assert.equal(read({ok:true,trades:[invalid]}).ok,false);
 const duplicate=structuredClone(one);duplicate.realBroker.contracts.push({...duplicate.realBroker.contracts[0]});
 assert.equal(read({ok:true,trades:[duplicate]}).ok,false);
});
test("no journal mutation or synthetic official plan",()=>{
 const original=structuredClone(one);const out=read({ok:true,trades:[one]});
 assert.deepEqual(one,original);assert.equal(out.noExecution,true);
 const s=sum({available:true,state:"OPEN_POSITIONS_UNMANAGED",
  positions:[{direction:"LONG",officialManagement:null}]},
  {positions:[{available:false,state:"ENTRY_STRUCTURE_UNAVAILABLE"}]});
 assert.equal(s.openContracts,1);assert.equal(s.officialPlanStatus,"OFFICIAL_PLAN_UNAVAILABLE");
 assert.equal(s.entryThesisStatus,"ENTRY_STRUCTURE_UNAVAILABLE");
});
