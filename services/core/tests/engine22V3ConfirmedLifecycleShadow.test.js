import test from "node:test";
import assert from "node:assert/strict";
import {replayConfirmedEngine22V3LifecycleShadow as replay} from "../logic/engine22/v3/replayConfirmedLifecycleShadow.js";
import {buildEngine22V3IndependentNodeShadow,DEGREE_CANDLE_TIMEFRAMES} from "../logic/engine22/v3/buildIndependentNodeShadow.js";
const waves=["W1","W2","W3","W4","W5"];
const vals=[100,102,104,110,107,105,104,102,100,96,100,103,105,110,114,122,118,116,115,114,112,108,112,115,117,120,124,132,128,126,125];
const pivotIndexes=[3,9,15,21,27],confirmIndexes=[4,10,16,22,28];
const make=(degree="MICRO",dir="UP",tf="10m")=>{
 const origin=Date.UTC(2026,9,9), step=600000;
 const bars=vals.map((v,i)=>{
   const price=dir==="UP"?v:300-v;
   return {sourceBarId:`${degree}:${tf}:${i}`,
     sourceTimestamp:new Date(origin+step*i).toISOString(),timeframe:tf,
     high:price+1,low:price-1,close:price,closed:true};
 });
 const state={degreeId:degree,countId:degree+"-COUNT",activeWave:"W1",
   lifecycle:"DEVELOPING",sequenceDirection:dir,anchors:{},
   waveStartTimestamp:bars[0].sourceTimestamp};
 const rulesByWave=Object.fromEntries(waves.map((wave,i)=>[wave,{
   id:degree+"-"+wave+"-RULE",passed:true,countId:state.countId,wave,
   evidenceBarId:bars[confirmIndexes[i]].sourceBarId,
   reversalBarId:bars[confirmIndexes[i]].sourceBarId,
 }]));
 return {state,bars,rulesByWave};
};
for(const direction of ["UP","DOWN"]){
 test(direction+" W1 to W5 has candidate and verified reversal for every wave",()=>{
   const {state,bars,rulesByWave}=make("MICRO",direction);
   const original=structuredClone(state);
   const r=replay({degreeState:state,bars,rulesByWave});
   assert.equal(r.ok,true,JSON.stringify(r.reasonCodes));
   assert.deepEqual(r.events.filter(e=>e.kind==="COMPLETION_CANDIDATE").map(e=>e.wave),waves);
   assert.deepEqual(r.events.filter(e=>e.kind==="STRUCTURAL_WAVE_CONFIRMED").map(e=>e.waveBefore),waves);
   assert.equal(r.finalState.activeWave,"W5");
   assert.equal(r.finalState.parentTransitionReviewRequired,true);
   assert.equal(r.finalState.lifecycle,"CONFIRMED");
   assert.equal(r.events.filter(e=>e.kind==="STRUCTURAL_WAVE_CONFIRMED").length,5);
   assert.equal(r.shadowOnly,true);assert.equal(r.publishAuthorized,false);
   assert.equal(r.officialFibAuthorityChanged,false);assert.equal(r.noExecution,true);
   assert.deepEqual(state,original);
   const anchors=direction==="UP"?["W1_HIGH","W2_LOW","W3_HIGH","W4_LOW","W5_HIGH"]:
     ["W1_HIGH","W2_LOW","W3_HIGH","W4_LOW","W5_HIGH"];
   assert.equal(anchors.every(k=>r.finalState.anchors[k]?.status==="CONFIRMED"),true);
 });
}
test("candidate without independently passed structural rule remains candidate; no invented completion",()=>{
 const {state,bars}=make();
 const r=replay({degreeState:state,bars,rulesByWave:{}});
 assert.equal(r.ok,true);
 assert.equal(r.finalState.activeWave,"W1");
 assert.equal(r.finalState.lifecycle,"COMPLETION_CANDIDATE");
 assert.equal(r.events.some(e=>e.kind==="STRUCTURAL_WAVE_CONFIRMED"),false);
});
test("invalidated/recount/locked lifecycle cannot advance",()=>{
 for(const lifecycle of ["LOCKED","RECOUNT_REQUIRED","INVALIDATED"]){
   const {state,bars,rulesByWave}=make();
   state.lifecycle=lifecycle;
   const r=replay({degreeState:state,bars,rulesByWave});
   assert.equal(r.finalState.activeWave,"W1");
   assert.equal(r.events.length,0);
 }
});
test("locked W1 high cannot be repainted by a different completed pivot",()=>{
 const {state,bars,rulesByWave}=make();
 state.anchors.W1_HIGH={price:999,time:bars[3].sourceTimestamp,status:"LOCKED",lockApprovalId:"OWNER"};
 const r=replay({degreeState:state,bars,rulesByWave});
 assert.equal(r.ok,false);
 assert.ok(r.reasonCodes.includes("LOCKED_ANCHOR_NO_REPAINT"));
 assert.equal(state.anchors.W1_HIGH.price,999);
 assert.equal(r.finalState.anchors.W1_HIGH.price,999);
});
test("incomplete or duplicate candles fail closed before replay",()=>{
 const {state,bars,rulesByWave}=make();
 assert.equal(replay({degreeState:state,bars:bars.map((b,i)=>i===5?{...b,closed:false}:b),rulesByWave}).ok,false);
 assert.equal(replay({degreeState:state,bars:[...bars,{...bars.at(-1)}],rulesByWave}).ok,false);
});
test("all seven degrees have separate replay identity; unavailable Engine11 weekly/monthly do not gate others",()=>{
 const degrees=Object.keys(DEGREE_CANDLE_TIMEFRAMES);
 const results=degrees.map(degree=>{
   const {state,bars,rulesByWave}=make(degree,"UP",DEGREE_CANDLE_TIMEFRAMES[degree]);
   return {degree,proof:replay({degreeState:state,bars,rulesByWave})};
 });
 assert.equal(results.every(x=>x.proof.ok&&x.proof.finalState.parentTransitionReviewRequired),true);
 assert.equal(new Set(results.map(x=>x.proof.finalState.countId)).size,7);
 const canonical={degrees:Object.fromEntries(degrees.map(degree=>{
   const {state}=make(degree);
   return [degree,{...state,anchors:{W1_LOW:{price:99,time:state.waveStartTimestamp},
     W1_HIGH:{price:111,time:state.waveStartTimestamp}}}];
 }))};
 const input=make("MICRO").bars.map(b=>({...b,time:Date.parse(b.sourceTimestamp)/1000}));
 const evidence=buildEngine22V3IndependentNodeShadow({canonical,
   barsByTf:{"10m":input},evaluationTimeMs:Date.UTC(2026,9,20)});
 assert.equal(evidence.degrees.micro.nodeEvidenceAvailable,true);
 for(const d of ["intermediate","primary"]){
   assert.equal(evidence.degrees[d].nodeEvidenceAvailable,false);
   assert.ok(evidence.degrees[d].reasonCodes.includes("SOURCE_HISTORY_UNAVAILABLE"));
 }
});
