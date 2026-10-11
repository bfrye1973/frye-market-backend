// Engine22 V3 — evidence-only canonical lifecycle reconciliation.
// Produces an immutable proposal and refuses to publish without a complete,
// unique structural evidence identity and monotonic observation.
import {validateEngine22V3Canonical,validateEngine22V3Transition} from "./canonicalStructure.js";
import {evaluateEngine22V3WaveTransition} from "./evaluateWaveTransition.js";
const clone=x=>structuredClone(x);
const valid=x=>typeof x==="string"&&x.trim().length>0;
export function proposeEngine22V3CanonicalObservation({
 canonical=null,degree=null,evidence=null,approvedRecountIds=[],
}={}){
 const check=validateEngine22V3Canonical(canonical);
 if(!check.ok)return {ok:false,reasonCodes:check.errors,proposedCanonical:null};
 const source=canonical.degrees?.[degree];
 if(!source)return {ok:false,reasonCodes:["DEGREE_NOT_PRESENT"],proposedCanonical:null};
 if(!evidence || !valid(evidence.sourceTimestamp)||!valid(evidence.sourceBarId)||
    !valid(evidence.sourceTimeframe)||evidence.completed!==true)
  return {ok:false,reasonCodes:["COMPLETE_UNIQUE_SOURCE_EVIDENCE_REQUIRED"],proposedCanonical:null};
 const transition=evaluateEngine22V3WaveTransition({degreeState:source,evidence});
 if(!transition.ok)return {ok:false,reasonCodes:transition.reasonCodes,proposedCanonical:null};
 const proposed=clone(canonical);
 proposed.degrees[degree]={...proposed.degrees[degree],...transition.proposal};
 const after=validateEngine22V3Transition(canonical,proposed,{approvedRecountIds});
 if(!after.ok)return {ok:false,reasonCodes:after.errors,proposedCanonical:null};
 return {ok:true,reasonCodes:transition.reasonCodes,proposedCanonical:proposed,
   publishAuthorized:false,shadowOnly:true,noExecution:true,noPermissionCreated:true};
}
