// Engine22 read-only seven-degree projection for acceptance tests.
// Does not alter existing six-degree production contracts or count ownership.
import {E22_DEGREE_ORDER} from "./validateSevenDegreeCanonicalPublication.js";
const clone=x=>x==null?null:JSON.parse(JSON.stringify(x));
export function buildSevenDegreeShadowProjection({
 legacyDegreeStates=null, microCount=null, submicroCandidate=null,
 review=null
}={}){
 const existing=legacyDegreeStates&&typeof legacyDegreeStates==="object"?legacyDegreeStates:{};
 const structural=Object.fromEntries(E22_DEGREE_ORDER.map(d=>[d.toLowerCase(),null]));
 for(const degree of ["subminute","minute","minor","intermediate","primary"])
   structural[degree]=clone(existing[degree]);
 const microValid=microCount?.degree==="MICRO"&&!!microCount.countId;
 const subValid=submicroCandidate?.degree==="SUBMICRO"&&
   submicroCandidate?.parentContext?.degree==="MICRO"&&
   submicroCandidate?.parentContext?.countId===microCount?.countId &&
   submicroCandidate?.countId!==microCount?.countId &&
   submicroCandidate?.sequenceId!==microCount?.sequenceId;
 if(microValid) structural.micro=clone(microCount);
 if(subValid && microValid) structural.submicro=clone(submicroCandidate);
 return {
   schema:"engine22.sevenDegreeShadowProjection.v1",
   degreeOrder:[...E22_DEGREE_ORDER],degrees:structural,
   status:microValid&&subValid?"READ_ONLY_STRUCTURAL_SHADOW":"INCOMPLETE",
   reasonCodes:[
     ...(!microValid?["CANONICAL_MICRO_COUNT_REQUIRED"]:[]),
     ...(!subValid?["SUBMICRO_PARENT_OR_IDENTITY_INVALID"]:[]),
     ...(review?.reasonCodes||[])
   ],
   publicationEligible:false,automationEligible:false,noExecution:true,
   noPermissionCreated:true
 };
}
