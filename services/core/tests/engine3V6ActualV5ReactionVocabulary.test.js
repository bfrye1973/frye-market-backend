import test from "node:test";
import assert from "node:assert/strict";
import {evaluateReaction} from "../logic/engine3/v5/zone/evaluateReaction.js";
import {buildEngine3V6Phase1Shadow} from "../logic/engine3/v6/buildEngine3V6Phase1Shadow.js";
const now=Date.parse("2026-11-17T17:00:00Z");
const zone={id:"Z",zoneId:"Z",low:100,high:110,midline:105};
const normalized=(open,high,low,close)=>({valid:true,open,high,low,close,rangeSize:high-low});
for(const [held,bars,expected] of [
 ["SHORT",[normalized(98,99,97,98),normalized(99,107,98,105)],"UP"],
 ["LONG",[normalized(112,114,111,113),normalized(113,113,103,105)],"DOWN"]
]){
 test("actual v5 evaluateReaction "+expected+" feeds v6 opposing vote against "+held,()=>{
  const reaction=evaluateReaction({zone,normalizedBars:bars,
   contact:{contactObserved:true,contactState:"ZONE_CONTACT"},lookback:5});
  assert.equal(reaction.reactionBias,expected);
  const priorState={canonicalDirection:held,candidateId:"A",reactionAnchor:held==="SHORT"?110:100,
   establishedAtMs:now-5*60000,lastEvaluatedAtMs:now-60000};
  const prices=[
   {time:Math.floor((now-3*60000)/1000),open:104,high:108,low:102,close:105},
   {time:Math.floor((now-2*60000)/1000),open:105,high:109,low:103,close:106},
   {time:Math.floor((now-60000)/1000),open:106,high:109,low:103,close:105},
  ];
  const v5={stateMachine:{establishedNow:false},canonical:{canonical:{direction:held}},
   evidence:{priceAction:{controlState:"CONTESTED",quality:"WEAK"},
    oneMinute:{completed:{reaction}}}};
  const out=buildEngine3V6Phase1Shadow({priorState,v5,candidateId:"A",zoneId:"Z",
   bars1m:prices,evaluationTimeMs:now});
  assert.equal(out.deteriorationEvidenceDiagnostics.opposingReaction,true);
  assert.equal(out.canonicalDirection,held);
  assert.equal(out.noEngine6Authority,true);
 });
}
