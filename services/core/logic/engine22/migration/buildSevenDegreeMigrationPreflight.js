// Isolated, deterministic preflight assembly. No file I/O, snapshot wiring,
// structural promotion, trade permission, or execution.
import {PROPOSED_MICRO_ANCHORS,auditProposedStructuralDegrees} from "./proposedSevenDegreeReconciliation.js";
import {buildSubmicroMigrationCandidate} from "./buildSubmicroMigrationCandidate.js";
import {reviewMicroW4Overlap} from "./reviewMicroW4Overlap.js";
import {validateSevenDegreeCanonicalPublication} from "./validateSevenDegreeCanonicalPublication.js";
export function buildSevenDegreeMigrationPreflight({
 legacyMicroCanonicalState=null, parentMicroCountId=null, completed4hBars=[],
 managerImplementationApproved=false, historicalBarsValidated=false,
 replayValidated=false, microExecutionContext=null
}={}) {
 const reviewed=auditProposedStructuralDegrees();
 const marks=PROPOSED_MICRO_ANCHORS.marks;
 const overlap=reviewMicroW4Overlap({w1High:marks.w1High.price,
   w4Low:marks.w4Low.price,completed4hBars});
 const submicro=buildSubmicroMigrationCandidate({
   sourceMicroState:legacyMicroCanonicalState,parentMicroCountId});
 // This remains a reference-only Micro candidate; no durable Micro count
 // can be constructed until manager authorizes the structural interpretation.
 const proposedMicro={degree:"MICRO",parentDegree:"SUBMINUTE",
   countId:parentMicroCountId,sequenceId:null};
 const gate=validateSevenDegreeCanonicalPublication({
   micro:proposedMicro,submicro:submicro.ok?{
     ...submicro.candidate,parentDegree:submicro.candidate.parentContext.degree
   }:null,managerImplementationApproved,
   historicalBarsValidated,replayValidated,executionContext:microExecutionContext
 });
 const blockers=[...new Set([...gate.reasonCodes,
   ...(!submicro.ok?submicro.reasonCodes:[]),
   ...(overlap.classification==="STANDARD_IMPULSE_OVERLAP_REVIEW_REQUIRED"
     ?["MICRO_W1_W4_OVERLAP_REQUIRES_APPROVED_ALTERNATE_CLASSIFICATION"]:[])
 ])];
 return {
   schema:"engine22.sevenDegreeMigrationPreflight.v1",
   status:blockers.length?"BLOCKED":"READY_FOR_MANAGER_REVIEW",
   publicationEligible:false, // Never grants publication, even if external flags are passed.
   reasonCodes:blockers,overlap,
   proposedMicro:PROPOSED_MICRO_ANCHORS,
   submicroCandidate:submicro.ok?submicro.candidate:null,
   preliminaryAudit:reviewed,
   noExecution:true,noPermissionCreated:true
 };
}
