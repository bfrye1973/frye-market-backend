import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3V6Phase1Shadow as build} from "../logic/engine3/v6/buildEngine3V6Phase1Shadow.js";
const bar=(start,high,low,close)=>({time:start,open:close,high,low,close});
const t=Date.parse("2026-11-17T17:00:00Z");
const prev=Math.floor((t-300000)/1000);
const v5={stateMachine:{establishedNow:true},validation:{valid:true},
 canonical:{canonical:{direction:"SHORT"},authoritativeDownstream:true},
 evidence:{priceAction:{controlState:"SELLERS_CONTROL",quality:"STRONG"}}};
test("real completed 5m bar can seed a separate v6 shadow only",()=>{
 const out=build({v5,candidateId:"A",zoneId:"Z",evaluationTimeMs:t,
   bars5m:[bar(prev,7353,7336,7338)]});
 assert.equal(out.canonicalDirection,"SHORT");assert.equal(out.establishedNow,true);
 assert.equal(out.reactionAnchor,7353);assert.equal(out.noEngine6Authority,true);
});
test("forming bar cannot become a reaction anchor",()=>{
 const out=build({v5,candidateId:"A",evaluationTimeMs:t,
   bars5m:[bar(Math.floor((t-60000)/1000),7400,7300,7360)]});
 assert.equal(out.canonicalDirection,"NEUTRAL");assert.equal(out.establishedNow,false);
});
test("v5 unconfirmed or invalid cannot seed shadow",()=>{
 const out=build({v5:{...v5,validation:{valid:false}},candidateId:"A",
  evaluationTimeMs:t,bars5m:[bar(prev,7353,7336,7338)]});
 assert.equal(out.canonicalDirection,"NEUTRAL");
});
test("one-minute input cannot manufacture fresh direction",()=>{
 const out=build({candidateId:"A",evaluationTimeMs:t,
  bars1m:[bar(Math.floor((t-60000)/1000),7410,7390,7400)],
  bars5m:[],v5:null});
 assert.equal(out.canonicalDirection,"NEUTRAL");
});

const completed1m=(startMinute,prices)=>prices.map((p,i)=>{
 const start=Math.floor((t-(startMinute-i)*60000)/1000);
 return bar(start,p.high,p.low,p.close);
});
for(const [direction,bias] of [["SHORT","UP"],["LONG","DOWN"]]){
 test("canonical v5 1m "+bias+" reaction votes opposite held "+direction,()=>{
  const held={schema:"engine3.v6.phase1.shadow.v1",mode:"SHADOW_READ_ONLY",
    canonicalDirection:direction,candidateId:"A",reactionAnchor:7353,
    establishedAtMs:t-5*60000,lastEvaluatedAtMs:t-60000};
  const input=completed1m(3,[
   {high:7353,low:7345,close:7350},
   {high:7355,low:7346,close:7351},
   {high:7357,low:7348,close:7352},
  ]);
  const result=build({priorState:held,candidateId:"A",zoneId:"Z",evaluationTimeMs:t,
    bars1m:input,v5:{...v5,stateMachine:{establishedNow:false},
      evidence:{priceAction:{controlState:"CONTESTED",quality:"WEAK"},
        oneMinute:{completed:{reaction:{reactionBias:bias}}}}}});
  assert.equal(result.deteriorationEvidenceDiagnostics.completed1mReactionBias,bias);
  assert.equal(result.deteriorationEvidenceDiagnostics.opposingReaction,true);
  assert.equal(result.canonicalDirection,direction);
 });
}
test("non-opposing actual v5 1m NONE and MIXED never cast opposing vote",()=>{
 const held={canonicalDirection:"SHORT",candidateId:"A",reactionAnchor:7353,
  establishedAtMs:t-5*60000,lastEvaluatedAtMs:t-60000};
 for(const bias of ["NONE","MIXED","DOWN"]){
  const result=build({priorState:held,candidateId:"A",evaluationTimeMs:t,
   bars1m:completed1m(3,[
    {high:7353,low:7345,close:7350},
    {high:7355,low:7346,close:7351},
    {high:7357,low:7348,close:7352}
   ]),v5:{...v5,stateMachine:{establishedNow:false},
    evidence:{priceAction:{controlState:"NO_CONTROL"},
      oneMinute:{completed:{reaction:{reactionBias:bias}}}}}});
  assert.equal(result.deteriorationEvidenceDiagnostics.opposingReaction,false);
 }
});
test("overlap uses canonical v5 intersection over smaller candle range, not envelope",()=>{
 const held={canonicalDirection:"SHORT",candidateId:"A",reactionAnchor:7400,
  establishedAtMs:t-5*60000,lastEvaluatedAtMs:t-60000};
 const result=build({priorState:held,candidateId:"A",evaluationTimeMs:t,
  bars1m:completed1m(3,[
   {high:102,low:100,close:101},
   {high:103,low:101,close:102},
   {high:104,low:102,close:103}
  ]),v5:{...v5,stateMachine:{establishedNow:false}}});
 assert.equal(result.deteriorationEvidenceDiagnostics.overlapFormula,
  "CANONICAL_V5_INTERSECTION_OVER_SMALLER_RANGE");
 assert.equal(result.deteriorationEvidenceDiagnostics.oneMinuteOverlapRatio,0.5);
});
