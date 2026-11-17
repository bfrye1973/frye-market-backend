import test from "node:test";
import assert from "node:assert/strict";
import {ES_PAPER_RISK_CONFIG as risk} from "../config/paperRiskConfig.js";
import {buildEngine7ProposedSizingPreview} from "../logic/engine7/v2/buildProposedSizingPreview.js";
function geometry(distance,direction="SHORT"){
 const entry=7600;
 return {strategyId:"intraday_scalp@10m",symbol:"ES",direction,candidateId:"MES-ACCEPTANCE-ONLY",zoneId:"ZONE-TEST",proposedEntryPrice:entry,proposedStopPrice:direction==="SHORT"?entry+distance:entry-distance,proposedStopDistancePoints:distance,proposedTargets:[],snapshotTime:"2026-11-16T21:00:00Z"};
}
test("Owner MES PAPER setting is three micros while keeping ES analytics identity",()=>{
 assert.equal(risk.instrument,"MES");
 assert.equal(risk.dollarsPerPoint,5);
 assert.equal(risk.maximumContracts,3);
 assert.equal(risk.paperOnly,true);
 assert.equal(risk.riskBudgetDollars,1000);
});
for (const direction of ["SHORT","LONG"]) {
 for(const [stop,expected] of [[10,3],[20,3],[40,3],[66,2],[201,0]]){
  test(`Engine7 production-risk MES ${direction} stop ${stop}pts => ${expected} contracts`,()=>{
   const old=process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION;
   process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION="0";
   try{
    const x=buildEngine7ProposedSizingPreview({engine26ProposedGeometry:geometry(stop,direction),riskConfig:risk});
    assert.equal(x.finalContracts,expected,JSON.stringify({stop,direction,expected,actual:x.finalContracts,blockers:x.blockers,status:x.status}));
    if(expected===3){assert.equal(x.finalSizingMode,"PRODUCTION_RISK");assert.equal(x.dollarsPerPoint,5);}
   }finally{if(old===undefined)delete process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION;else process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION=old;}
  });
 }
}
test("MES config is not hardcoded to December contract month",()=>{
 assert.equal(risk.instrument,"MES");
 assert.equal(Object.hasOwn(risk,"contractSymbol"),false);
});
