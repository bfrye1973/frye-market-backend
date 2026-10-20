// Isolated, deterministic preflight assembly. No file I/O, snapshot wiring,
// structural promotion, trade permission, or execution.
import {PROPOSED_MICRO_ANCHORS,auditProposedStructuralDegrees} from "./proposedSevenDegreeReconciliation.js";
import {buildSubmicroMigrationCandidate} from "./buildSubmicroMigrationCandidate.js";
import {reviewMicroW4Overlap} from "./reviewMicroW4Overlap.js";
import {validateSevenDegreeCanonicalPublication} from "./validateSevenDegreeCanonicalPublication.js";
import {verifyProposedMicroAnchorsAgainstBars} from "./verifyProposedMicroAnchorsAgainstBars.js";
export function buildSevenDegreeMigrationPreflight({
 legacyMicroCanonicalState=null, parentMicroCountId=null, completed4hBars=[],
 historicalAnchorBars=[],historicalSourceIdentity=null,historicalTimeZoneVerified=false,
 managerImplementationApproved=false, historicalBarsValidated=false,
 replayValidated=false, ownerAcceptsOverlap=false, microExecutionContext=null
}={}) {
 const reviewed=auditProposedStructuralDegrees();
 const historicalAnchorProof=verifyProposedMicroAnchorsAgainstBars({
  bars:historicalAnchorBars,sourceIdentity:historicalSourceIdentity,
  timeZoneVerified:historicalTimeZoneVerified
 });
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
   historicalBarsValidated:historicalBarsValidated && historicalAnchorProof.verified,
   replayValidated,executionContext:microExecutionContext
 });
 const blockers=[...new Set([...gate.reasonCodes,
   ...historicalAnchorProof.reasonCodes,
   ...(!submicro.ok?submicro.reasonCodes:[]),
   ...(overlap.classification==="STANDARD_IMPULSE_OVERLAP_REVIEW_REQUIRED" && !ownerAcceptsOverlap
     ?["MICRO_W1_W4_OVERLAP_REQUIRES_APPROVED_ALTERNATE_CLASSIFICATION"]:[])
 ])];
 return {
   schema:"engine22.sevenDegreeMigrationPreflight.v1",
   status:blockers.length?"BLOCKED":"READY_FOR_MANAGER_REVIEW",
   publicationEligible:false, // Never grants publication, even if external flags are passed.
   reasonCodes:blockers,overlap,historicalAnchorProof,
   ownerOverlapDisposition:ownerAcceptsOverlap?"ACCEPTED_FOR_PROVISIONAL_REVIEW_NOT_STANDARD_IMPULSE":"REVIEW_REQUIRED",
   proposedMicro:PROPOSED_MICRO_ANCHORS,
   submicroCandidate:submicro.ok?submicro.candidate:null,
   preliminaryAudit:reviewed,
   noExecution:true,noPermissionCreated:true
 };
}
