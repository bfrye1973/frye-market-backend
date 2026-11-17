import test from "node:test";
import assert from "node:assert/strict";
import {evaluateEngine3V6Phase1 as run} from "../logic/engine3/v6/evaluateEngine3V6Phase1.js";
const p={invalidationCloses1m:2,deteriorationEvidenceCount:2,deteriorationTimeoutMs:720000};
const old=(direction)=>({canonicalDirection:direction,candidateId:"A",reactionAnchor:100,establishedAtMs:800000});
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

test("historical bars before establishment cannot invalidate direction",()=>{
 const r=run({...common,priorState:old("SHORT"),
  completed1m:[b(125,600000),b(130,700000)],
  completed5m:[b(130,700000)]});
 assert.equal(r.canonicalDirection,"SHORT");
 assert.equal(r.invalidatedNow,false);
});
test("out-of-order Replay tick cannot rewind a held state",()=>{
 const prior={...old("LONG"),lastEvaluatedAtMs:1100000,convictionState:"DETERIORATING"};
 const r=run({...common,priorState:prior,completed5m:[b(80,900000)]});
 assert.equal(r.canonicalDirection,"LONG");
 assert.deepEqual(r.reasonCodes,["DUPLICATE_OR_REWOUND_EVALUATION_IGNORED"]);
});
test("only fresh, time-verified v5 establishment can seed Phase1",()=>{
 const seed={direction:"SHORT",reactionAnchor:107,establishedNow:true,establishedAtMs:900000};
 const r=run({...common,priorState:null,seedFromV5:seed});
 assert.equal(r.canonicalDirection,"SHORT");
 assert.equal(r.establishedNow,true);
 assert.equal(r.reactionAnchor,107);
 const noSeed=run({...common,priorState:null,seedFromV5:{...seed,establishedNow:false}});
 assert.equal(noSeed.canonicalDirection,"NEUTRAL");
 assert.equal(noSeed.establishedNow,false);
});
test("never reseed opposite direction in the same tick as invalidation",()=>{
 const seed={direction:"LONG",reactionAnchor:95,establishedNow:true,establishedAtMs:960000};
 const r=run({...common,priorState:old("SHORT"),completed5m:[b(110,960000)],seedFromV5:seed});
 assert.equal(r.canonicalDirection,"NEUTRAL");
 assert.equal(r.invalidatedNow,true);
 assert.equal(r.reversedNow,false);
});
