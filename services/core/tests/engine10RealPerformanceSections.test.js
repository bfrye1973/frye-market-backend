import test from "node:test";
import assert from "node:assert/strict";
import {buildRealPerformanceSections,realCampaignPerformanceGroup} from "../logic/journal/realPerformanceSections.js";
const trade=(id,group,net,mode="REAL")=>({tradeId:id,accountMode:mode,performanceGroup:group,journalAccount:group,summary:{grossRealizedPnL:net+2.6,actualFees:2.6,netRealizedPnL:net},realBroker:{contracts:[{contractId:id+"|CTR|1",status:"CLOSED",netRealizedPnL:net}]}});
test("nine independent sections and ALL REAL are disjoint",()=>{
 const trades=["SWING","INTRADAY","SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"].map((g,i)=>trade(String(i),g,10));
 trades.push(trade("paper","MINOR",1000,"PAPER"));
 const r=buildRealPerformanceSections(trades);
 assert.equal(Object.keys(r.sections).length,9);
 assert.equal(r.allReal.campaigns,9);
 assert.equal(r.allReal.closedContracts,9);
 assert.equal(r.allReal.netRealized,90);
 assert.equal(r.unknownRealCampaigns.length,0);
 for(const section of Object.values(r.sections))assert.equal(section.campaigns,1);
});
test("unmigrated legacy SWING remains historical despite post-cutover entry",()=>{
 const t={accountMode:"REAL",journalAccount:"SWING",brokerAccountLabel:"SCHWAB_0747",entry:{time:"2026-10-22T13:42:18Z"}};
 assert.equal(realCampaignPerformanceGroup(t),"SWING");
});
test("explicit migrated campaign is SUBMICRO",()=>{
 const t={accountMode:"REAL",journalAccount:"SWING",performanceGroup:"SUBMICRO",brokerAccountLabel:"SCHWAB_0747",entry:{time:"2026-10-22T13:42:18Z"}};
 assert.equal(realCampaignPerformanceGroup(t),"SUBMICRO");
});
