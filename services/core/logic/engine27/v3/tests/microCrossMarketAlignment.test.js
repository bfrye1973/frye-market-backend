import test from "node:test";import assert from "node:assert/strict";
import {createMicroCrossMarketAlignment} from "../marketAlignment/createMicroCrossMarketAlignment.js";
const start=Date.parse("2026-10-26T15:00:00Z");let now=start;
const watcher=()=>createMicroCrossMarketAlignment({clock:()=>now});
function pair(w){
 for(const [s,a,b] of [["ES",7698,7732],["QQQ",712.2,715.5],["VIX",18.8,17.9]]){
  now=start;assert.equal(w.ingest(s,a,now),true);
  now=start+30000;assert.equal(w.ingest(s,b,now),true);
 }
}
test("bullish environment recognized independently from Micro DOWN Elliott ownership",()=>{
 const w=watcher();pair(w);
 const r=w.assess({microDirection:"DOWN",engine25Qualified:false,engine29Qualified:false});
 assert.equal(r.marketAligned,true);
 assert.equal(r.fullQualified,false);
 assert.equal(r.state,"BULLISH_CROSS_MARKET_ALIGNMENT");
 assert.equal(r.alertEligible,true);
 assert.ok(r.reasons.includes("ENGINE22_MICRO_DIRECTION_NOT_LONG"));
 assert.ok(r.reasons.includes("ENGINE29_NOT_QUALIFIED"));
 assert.equal(r.executionAuthorized,false);assert.equal(r.noExecution,true);
});
test("qualified owner context is distinct and never grants execution",()=>{
 const w=watcher();pair(w);
 const r=w.assess({microDirection:"LONG",engine25Qualified:true,engine29Qualified:true});
 assert.equal(r.fullQualified,true);
 assert.equal(r.state,"BULLISH_CONTEXT_AND_OWNERS_ALIGNED");
 assert.equal(r.executionAuthorized,false);
});
test("mixed market moves and insufficient windows must not generate an alert",()=>{
 const w=watcher();now=start;w.ingest("ES",7700,now);w.ingest("QQQ",714,now);w.ingest("VIX",18,now);
 assert.equal(w.assess({microDirection:"LONG"}).alertEligible,false);
 now=start+30000;
 w.ingest("ES",7710,now);w.ingest("QQQ",713,now);w.ingest("VIX",17.8,now);
 assert.equal(w.assess({microDirection:"LONG"}).alertEligible,false);
});
test("drops stale signals instead of retaining previous bullish alert",()=>{
 const w=watcher();pair(w);
 assert.equal(w.assess({microDirection:"DOWN"}).marketAligned,true);
 now=start+240000;
 const r=w.assess({microDirection:"DOWN"});
 assert.equal(r.marketAligned,false);
 assert.equal(r.latestAlert,null);
});
test("dense ES trades retain a 20-second comparison anchor",()=>{
 const w=watcher();now=start;w.ingest("ES",7700,now);
 for(let i=1;i<6000;i++){now=start+i*10;w.ingest("ES",7700+i*.01,now)}
 const r=w.assess();
 assert.equal(r.evidence.ES.state,"UP");
 assert.ok(r.evidence.ES.intervalSeconds>=20);
 assert.ok(w.diagnostics().ES<=180);
});
