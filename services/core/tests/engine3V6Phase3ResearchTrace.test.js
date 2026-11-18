import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3V6ResearchTrace as trace} from "../logic/engine3/v6/buildEngine3V6ResearchTrace.js";
const now=Date.parse("2026-11-17T17:00:00Z");
const zone={low:7290,high:7348,midline:7319};
const safe={mode:"SHADOW_READ_ONLY",canonicalDirection:"SHORT",
 convictionState:"DETERIORATING",noPermissionCreated:true,
 authoritativeDownstream:false,deteriorationEvidenceVotes:2,
 deteriorationResearch:{timeoutExceeded:true},
 reasonCodes:["DIRECTION_HELD_WITH_DETERIORATION"]};
const evidence={candidateId:"C",zoneId:"Z",activationStartedAtMs:now-600000,
 activationSource:"ENGINE3_OBSERVED",activationUncertaintyMs:180000,
 completed1mEligible:[{}],completed5mEligible:[{},{}],preActivation5mCount:4,
 reactionSite:"lower",reactionAnchor:7342,anchorDirection:"SHORT",
 anchorSource:"POST_ACTIVATION_1M_EXTREME",
 geometry:{frozenAtr5m:7},
 adverseWarning:true,anchorThreatened:false,reasonCodes:["POST_ACTIVATION_ONLY"]};
const causal={qualified:true,controlGeometryEligible:true,
 controlGeometrySource:"LOWER_SITE",control:{controlState:"SELLERS_CONTROL",quality:"GOOD"},
 engine26Zone:zone,engine3ControlLens:{low:7288,high:7292,midline:7290},
 reasonCodes:["INDEPENDENT_CAUSAL_CONTROL_QUALIFIED"]};
test("trace preserves provenance, warnings, deterioration without authority",()=>{
 const result=trace({evaluationTimeMs:now,shadow:safe,phase2Evidence:evidence,
 phase2Causal:causal,engine22Alignment:{alignmentState:"FULL_BEARISH_ALIGNMENT"},
 priorShadow:{canonicalDirection:"SHORT"},phase1Comparison:{canonicalDirection:"NEUTRAL"},
 engine26:{engine3AuthorizationStartedAt:null}});
 assert.equal(result.ok,true);assert.equal(result.transition,"HOLD");
 assert.equal(result.activation.source,"ENGINE3_OBSERVED");
 assert.equal(result.reaction.geometrySource,"LOWER_SITE");
 assert.equal(result.warnings.adverseWarning,true);
 assert.equal(result.deterioration.timeoutExceeded,true);
 assert.equal(result.deterioration.timeoutHasInvalidationAuthority,false);
 assert.equal(result.structuralAlignment.authority,"DIAGNOSTIC_ONLY");
 assert.equal(result.noPermissionCreated,true);assert.equal(result.authoritativeDownstream,false);
 assert.deepEqual(result.reaction.engine26Zone,zone);
});
test("trace rejects missing shadow authority and does not manufacture a direction",()=>{
 const result=trace({evaluationTimeMs:now,shadow:{canonicalDirection:"LONG"},
 phase2Evidence:evidence,phase2Causal:causal});
 assert.equal(result.ok,false);
 assert.equal(result.currentDirection,"LONG");
 assert.ok(result.reasonCodes.includes("RESEARCH_TRACE_INPUT_UNVERIFIED"));
 assert.equal(result.noExecution,true);
});
test("trace reason-code output bounded and deduplicated",()=>{
 const reasons=Array.from({length:100},(_,i)=>"R"+i);
 const result=trace({evaluationTimeMs:now,shadow:{...safe,reasonCodes:[...reasons,...reasons]},
 phase2Evidence:evidence,phase2Causal:causal});
 assert.ok(result.reasonCodes.length<=48);
 assert.equal(new Set(result.reasonCodes).size,result.reasonCodes.length);
});
