import test from "node:test";
import assert from "node:assert/strict";
import {planOctober22Classification,applyClassificationPlanToCopy} from "../logic/journal/oct22ClassificationMigration.js";
const make=(id,label,group,tx,time)=>({tradeId:id,accountMode:"REAL",journalAccount:group,brokerAccountLabel:label,entry:{time,brokerTransactionId:tx},events:[{eventType:"REAL_ENTRY_FILL",brokerTransactionId:tx}],realBroker:{contracts:[{contractId:id+"|CTR|1",entryPrice:7730.25}]},summary:{netRealizedPnL:25}});
test("six existing Oct 22 fills migrate by broker identity without touching accounting",()=>{
 const time="2026-10-22T13:42:18Z";
 const trades=[...Array.from({length:3},(_,i)=>make("s"+i,"SCHWAB_0747","SWING","s-tx-"+i,time)),...Array.from({length:3},(_,i)=>make("i"+i,"SCHWAB_6380","INTRADAY","i-tx-"+i,time))];
 const openings=trades.map(t=>({brokerAccountLabel:t.brokerAccountLabel,brokerTransactionId:t.entry.brokerTransactionId,fillTime:time}));
 const plan=planOctober22Classification(trades,openings);
 assert.equal(plan.ok,true);assert.equal(plan.changes.length,6);
 const next=applyClassificationPlanToCopy(trades,plan);
 assert.equal(next.filter(t=>t.performanceGroup==="SUBMICRO").length,3);
 assert.equal(next.filter(t=>t.performanceGroup==="MICRO").length,3);
 next.forEach((t,i)=>{assert.equal(t.tradeId,trades[i].tradeId);assert.deepEqual(t.events,trades[i].events);assert.deepEqual(t.realBroker,trades[i].realBroker);assert.deepEqual(t.summary,trades[i].summary)});
 assert.equal(planOctober22Classification(next,openings).changes.length,0);
});
test("precutover and mismatched broker identity fail closed",()=>{
 const time="2026-10-21T13:42:18Z",t=make("old","SCHWAB_0747","SWING","tx",time);
 assert.equal(planOctober22Classification([t],[{brokerAccountLabel:"SCHWAB_0747",brokerTransactionId:"tx",fillTime:time}]).ok,false);
 assert.equal(planOctober22Classification([t],[{brokerAccountLabel:"SCHWAB_6380",brokerTransactionId:"tx",fillTime:time}]).ok,false);
});
