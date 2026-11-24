import test from "node:test";
import assert from "node:assert/strict";
import {evaluateEngine3V6Phase1 as evaluate} from "../logic/engine3/v6/evaluateEngine3V6Phase1.js";

// Synthetic, source-completed Phase C contracts only. These are NOT original
// November 24 Replay bars and must never be reported as backtest results.
const at=Date.parse("2026-11-24T15:25:00.000Z"), m=60000;
const bar=(open,close,offset=0,high=Math.max(open,close)+1,low=Math.min(open,close)-1)=>
  ({completed:true,open,close,high,low,closeTimeMs:at+offset});
const prior=(direction,edge)=>({
  candidateId:"E26C-TEST",zoneId:"E26Z-TEST",canonicalDirection:direction,
  reactionAnchor:direction==="LONG"?7150:7290,
  establishedAtMs:at-10*m,lastEvaluatedAtMs:at-m,
  breakoutContext:{direction,edge,source:"COMPLETED_5M_FULL_BODY_BREAK"},
});
const run=(priorState,completed5m,evaluationTimeMs=at,extra={})=>
  evaluate({priorState,candidateId:"E26C-TEST",zoneId:"E26Z-TEST",
   evaluationTimeMs,completed5m,completed1m:[],observedControl:"NO_CONTROL",
   policy:{invalidationCloses1m:2,deteriorationEvidenceCount:2},
   ...extra});

test("Nov24-shaped completed full-body LONG reclaim cancels breakout direction",()=>{
 const x=run(prior("LONG",7210.75),[bar(7209.5,7206)]);
 assert.equal(x.canonicalDirection,"NEUTRAL");
 assert.equal(x.invalidatedNow,true);
 assert.equal(x.reversedNow,false);
 assert.equal(x.breakoutContext,null);
 assert.ok(x.reasonCodes.includes("BREAKOUT_RECLAIM_CANCELS_COMPLETED_5M"));
});
test("mirror SHORT full-body reclaim cancels breakout",()=>{
 const x=run(prior("SHORT",7138),[bar(7139,7142)]);
 assert.equal(x.canonicalDirection,"NEUTRAL");
 assert.ok(x.reasonCodes.includes("BREAKOUT_RECLAIM_CANCELS_COMPLETED_5M"));
});
test("wick through edge with body outside is NOT a reclaim",()=>{
 const x=run(prior("LONG",7210.75),[bar(7214,7212,0,7215,7209)]);
 assert.equal(x.canonicalDirection,"LONG");
 assert.equal(x.invalidatedNow,false);
});
test("partial-body crossing boundary is not the full-body reclaim rule",()=>{
 const x=run(prior("LONG",7210.75),[bar(7212,7208)]);
 assert.equal(x.canonicalDirection,"LONG");
 assert.equal(x.invalidatedNow,false);
});
test("future and incomplete bars cannot cancel state",()=>{
 const x=run(prior("LONG",7210.75),[
   bar(7208,7206,5*m),{...bar(7208,7206),completed:false}]);
 assert.equal(x.canonicalDirection,"LONG");
});
test("bar before establishment cannot cancel newly established LONG",()=>{
 const x=run(prior("LONG",7210.75),[bar(7208,7206,-11*m)]);
 assert.equal(x.canonicalDirection,"LONG");
});
test("candidate change invalidates without inheriting old breakout metadata",()=>{
 const x=run(prior("LONG",7210.75),[bar(7220,7223)],at,{candidateId:"OTHER"});
 assert.equal(x.canonicalDirection,"NEUTRAL");
 assert.equal(x.breakoutContext,null);
 assert.ok(x.reasonCodes.includes("CANDIDATE_IDENTITY_CHANGED"));
});
test("do not manufacture breakout reclaim without attested metadata",()=>{
 const x=run({...prior("LONG",7210.75),breakoutContext:null},[bar(7208,7206)]);
 assert.equal(x.canonicalDirection,"LONG");
 assert.equal(x.breakoutBodyReclaimedNow,false);
});
test("same evaluation never reverses LONG directly to SHORT",()=>{
 const x=run(prior("LONG",7210.75),[bar(7208,7206)],at,
  {observedControl:"SELLERS_CONTROL",observedQuality:"STRONG"});
 assert.equal(x.canonicalDirection,"NEUTRAL");
 assert.equal(x.reversedNow,false);
});
test("duplicate evaluation cannot rewind direction",()=>{
 const p=prior("LONG",7210.75);p.lastEvaluatedAtMs=at;
 const x=run(p,[bar(7208,7206)]);
 assert.equal(x.canonicalDirection,"LONG");
 assert.ok(x.reasonCodes.includes("DUPLICATE_OR_REWOUND_EVALUATION_IGNORED"));
});
test("attested breakout context can be seeded without changing v5",()=>{
 const x=run(null,[],at,{seedFromPhase2:{
   postActivationVerified:true,establishedNow:true,direction:"LONG",
   reactionAnchor:7190,establishedAtMs:at-m,
  },breakoutContext:{direction:"LONG",edge:7210.75,
   source:"COMPLETED_5M_FULL_BODY_BREAK"}});
 assert.equal(x.canonicalDirection,"LONG");
 assert.equal(x.breakoutContext?.edge,7210.75);
 assert.equal(x.noPermissionCreated,true);
 assert.equal(x.authoritativeDownstream,false);
});
