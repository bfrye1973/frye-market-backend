// Pure Engine 22 V3 canonical-derived snapshot bundle. Never reads or writes
// persistence, and never replaces a live contract. All projections share one count.
import {validateEngine22V3Canonical, ENGINE22_V3_DEGREES} from "./canonicalStructure.js";
import {projectEngine22V3DegreeFib} from "./projectDegreeFib.js";
import {buildEngine22V3CrossDegreeWatch} from "./buildCrossDegreeWatch.js";
import {proposeEngine22V3CanonicalObservation} from "./proposeCanonicalObservation.js";
const clone=x=>structuredClone(x);
export function buildEngine22V3ShadowSnapshot({canonical=null,evidenceByDegree=null}={}){
 const v=validateEngine22V3Canonical(canonical);
 if(!v.ok)return {available:false,reasonCodes:v.errors,shadowOnly:true};
 let effective=canonical;
 const observed=[];
 if(evidenceByDegree!==null){
   if(!evidenceByDegree || typeof evidenceByDegree!=="object" || Array.isArray(evidenceByDegree))
     return {available:false,reasonCodes:["INVALID_EVIDENCE_MAP"],shadowOnly:true};
   for(const degree of ENGINE22_V3_DEGREES){
     if(!Object.prototype.hasOwnProperty.call(evidenceByDegree,degree))continue;
     const result=proposeEngine22V3CanonicalObservation({
       canonical:effective,degree,evidence:evidenceByDegree[degree],
     });
     if(!result.ok)return {available:false,reasonCodes:[degree,...result.reasonCodes],shadowOnly:true};
     effective=result.proposedCanonical;
     observed.push({degree,reasonCodes:result.reasonCodes});
   }
 }
 const degreeStates={}, wavelengthDegrees={}, displayDegrees={};
 for(const d of ENGINE22_V3_DEGREES){
  const state=effective.degrees[d],key=d.toLowerCase();
  const fib=projectEngine22V3DegreeFib({canonical:effective,degree:d});
  degreeStates[key]={
   degree:d,sourceCountId:state.countId,sequenceId:state.sequenceId,
   parentDegree:state.parentDegree,parentWave:state.parentWave,
   activeWave:state.activeWave,lifecycle:state.lifecycle,
   anchors:clone(state.anchors),invalidation:clone(state.invalidation),
   sourceTimestamp:canonical.sourceTimestamp??null,
  };
  wavelengthDegrees[key]={
   degree:d,sourceCountId:state.countId,activeWave:state.activeWave,
   lifecycle:state.lifecycle,fibModel:fib,
  };
  displayDegrees[key]={
   degree:key,label:d.replace(/_/g," "),active:state.activeWave!==null,
   badge:state.lifecycle,rows:Object.entries(state.anchors).map(([wave,a])=>({
    label:wave,value:a.price===null?"Unknown":String(a.price),
    status:a.status,sourceCountId:state.countId,
   })),levels:fib.available?clone(fib.levels):[],
   noPermissionCreated:true,noExecution:true,
  };
 }
 const watch=buildEngine22V3CrossDegreeWatch({canonical:effective});
 return {
  available:true,shadowOnly:true,automationEligible:false,
  sourceSchema:effective.schema,sourceTimestamp:effective.sourceTimestamp??null,
  observed,
  degreeStates:{degrees:degreeStates},
  currentWavelength:{degrees:wavelengthDegrees},
  engine22Display:{degreeOrder:ENGINE22_V3_DEGREES.map(d=>d.toLowerCase()),degrees:displayDegrees},
  crossDegreeWatch:watch,
  // Micro timing context is deliberately NOT repurposed until legacy consumer
  // identity migration is accepted; no competing machine authority.
  microExecutionContext:null,
  reasonCodes:["V3_CANONICAL_SHADOW_ONLY","DOWNSTREAM_NOT_PUBLISHED"],
  noPermissionCreated:true,noExecution:true,
 };
}
