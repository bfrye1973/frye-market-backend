import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3V6Phase1Shadow} from "../logic/engine3/v6/buildEngine3V6Phase1Shadow.js";
const minute=60000,now=Date.parse("2026-11-17T17:00:00Z");
const candle=(closeMs,dur,high,low,close)=>({startMs:closeMs-dur,closeTimeMs:closeMs,open:close,high,low,close});
const raw=b=>({time:b.startMs/1000,open:b.open,high:b.high,low:b.low,close:b.close});
const five=[
 candle(now-5*minute,5*minute,110,100,102),
 candle(now,5*minute,108,98,100)
];
const one=[
 candle(now-3*minute,minute,105,99,101),
 candle(now-2*minute,minute,103,98,100),
 candle(now-minute,minute,104,97,99)
];
const v5={stateMachine:{establishedNow:false},validation:{valid:true},
 canonical:{canonical:{direction:"NEUTRAL"},authoritativeDownstream:true},
 evidence:{priceAction:{controlState:"BUYERS_CONTROL",quality:"STRONG"},
  oneMinute:{completed:{reaction:{reactionBias:"UP"}}}}};
const causal={qualified:true,observedDirection:"SHORT",
 control:{controlState:"SELLERS_CONTROL",quality:"GOOD"},
 observation1m:{completed:{reaction:{reactionBias:"DOWN"}}}};
const base={candidateId:"NEW-ZONE",zoneId:"Z2",evaluationTimeMs:now,v5,causalControl:causal,
 bars1m:[raw(candle(now-9*minute,minute,140,120,130)),...one.map(raw)],
 bars5m:[raw(candle(now-10*minute,5*minute,150,120,140)),...five.map(raw)],
 policy:{invalidationCloses1m:2,deteriorationEvidenceCount:2,deteriorationTimeoutMs:720000}};
const p2={eligible:true,activationStartedAtMs:now-10*minute,
 completed1mEligible:one,completed5mEligible:five,
 shadowSeedEvidenceEligible:true,reactionAnchor:105};
test("Nov17-like new-zone preactivation BUYERS cannot override causal postactivation SELLERS",()=>{
 const out=buildEngine3V6Phase1Shadow({...base,priorState:null,phase2Evidence:p2});
 assert.equal(out.canonicalDirection,"SHORT");
 assert.equal(out.establishedNow,true);
 assert.equal(out.reactionAnchor,105);
 assert.equal(out.sourceControlRecalculated,true);
 assert.equal(out.causalControlSource,"POST_ACTIVATION_5M_INDEPENDENT");
 assert.equal(out.deteriorationEvidenceDiagnostics.completed1mReactionBias,"DOWN");
});
test("deferred postactivation seed can establish after v5 one-shot already passed",()=>{
 const first=buildEngine3V6Phase1Shadow({...base,priorState:null,
   phase2Evidence:{...p2,completed5mEligible:five.slice(0,1),
    shadowSeedEvidenceEligible:false}});
 assert.equal(first.canonicalDirection,"NEUTRAL");
 const second=buildEngine3V6Phase1Shadow({...base,priorState:first,phase2Evidence:p2,
   evaluationTimeMs:now+minute});
 assert.equal(second.canonicalDirection,"SHORT");
 assert.equal(second.establishedNow,true);
});
test("preactivation opposing closes cannot invalidate an already held SHORT",()=>{
 const prior={schema:"engine3.v6.phase1.shadow.v1",canonicalDirection:"SHORT",
  candidateId:"NEW-ZONE",zoneId:"Z2",reactionAnchor:105,establishedAtMs:now-10*minute,
  lastEvaluatedAtMs:now-minute};
 const safeOne=[candle(now-3*minute,minute,104,100,101),
    candle(now-2*minute,minute,103,99,100)];
 const result=buildEngine3V6Phase1Shadow({...base,priorState:prior,
  phase2Evidence:{...p2,completed1mEligible:safeOne,
    completed5mEligible:five.map(b=>({...b,close:100}))}});
 assert.equal(result.canonicalDirection,"SHORT");
 assert.equal(result.invalidatedNow,false);
});
