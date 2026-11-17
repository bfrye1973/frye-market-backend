import test from "node:test";
import assert from "node:assert/strict";
import {evaluateEngine3V6Phase1 as run} from "../logic/engine3/v6/evaluateEngine3V6Phase1.js";
const p={invalidationCloses1m:2,deteriorationEvidenceCount:2,deteriorationTimeoutMs:720000};
const old=(direction)=>({canonicalDirection:direction,candidateId:"A",reactionAnchor:100});
const common={candidateId:"A",zoneId:"Z",evaluationTimeMs:1000000,policy:p};
const b=(close,ms)=>({close,closeTimeMs:ms,completed:true});
for(const d of ["SHORT","LONG"]){
 const adverse=d==="SHORT"?101:99;
 test(d+" survives one choppy bar and does not flip on opposite control",()=>{
  const result=run({...common,priorState:old(d),observedControl:d==="SHORT"?"BUYERS_CONTROL":"SELLERS_CONTROL",
   observedQuality:"STRONG",completed5m:[b(100,999000)]});
  assert.equal(result.canonicalDirection,d);
  assert.equal(result.convictionState,"HOLDING");assert.equal(result.reversedNow,false);
 });
 test(d+" invalidates only on completed anchor breaks, without same-tick opposite",()=>{
  const r=run({...common,priorState:old(d),observedControl:d==="SHORT"?"BUYERS_CONTROL":"SELLERS_CONTROL",
    observedQuality:"STRONG",completed1m:[b(adverse,900000),b(adverse,960000)]});
  assert.equal(r.canonicalDirection,"NEUTRAL");assert.equal(r.invalidatedNow,true);
  assert.equal(r.establishedNow,false);assert.equal(r.reversedNow,false);
 });
}
test("deterioration annotates held direction, expires by explicit policy",()=>{
 const prior={...old("SHORT"),deterioratingSinceMs:100000};
 const evidence={noProgress:true,highOverlap:true};
 const r=run({...common,priorState:prior,evidence, evaluationTimeMs:500000});
 assert.equal(r.canonicalDirection,"SHORT");assert.equal(r.convictionState,"DETERIORATING");
 const expired=run({...common,priorState:prior,evidence,evaluationTimeMs:1000000});
 assert.equal(expired.invalidatedNow,true);assert.equal(expired.canonicalDirection,"NEUTRAL");
});
test("open Engine10 direction lock wins over local counter reaction",()=>{
 const r=run({...common,priorState:old("SHORT"),openTradeActive:true,lockedTradeDirection:"SHORT",
   completed5m:[b(120,960000)],observedControl:"BUYERS_CONTROL"});
 assert.equal(r.canonicalDirection,"SHORT");assert.equal(r.convictionState,"OPEN_TRADE_LOCKED");
});
test("unknown candidate invalidates old thesis and never establishes opposite same tick",()=>{
 const r=run({...common,candidateId:"B",priorState:old("LONG"),observedControl:"SELLERS_CONTROL",observedQuality:"STRONG"});
 assert.equal(r.invalidatedNow,true);assert.equal(r.canonicalDirection,"NEUTRAL");
});
test("missing numeric policy and absent anchor cannot manufacture invalidation",()=>{
 const r=run({...common,priorState:old("SHORT"),policy:{},completed1m:[b(120,960000)]});
 assert.equal(r.canonicalDirection,"SHORT");
 assert.equal(r.noPermissionCreated,true);assert.equal(r.authoritativeDownstream,false);
});
