// Owner-authorized provisional MICRO review count. Source is the Engine22
// Manager's five explicit ES marks. Distinct from the existing operational
// Micro count, and NOT a canonical locked count or trading authority.
import {PROPOSED_MICRO_ANCHORS} from "./proposedSevenDegreeReconciliation.js";
const m=PROPOSED_MICRO_ANCHORS.marks;
export const PROVISIONAL_MICRO_COUNT_ID="ES-MICRO-PROVISIONAL-20261001-0700-7675";
export const PROVISIONAL_MICRO_SEQUENCE_ID="ES-MICRO-UP-PROVISIONAL-20261001-0700";
const point=x=>Object.freeze({price:x.price,localTime:`${x.date} ${x.time}`});
export function buildOwnerAuthorizedProvisionalMicroCount({ownerAcceptsOverlap=false}={}){
 if(!ownerAcceptsOverlap) return {ok:false,reasonCodes:["OWNER_OVERLAP_DISPOSITION_REQUIRED"]};
 const overlapPoints=Number((m.w1High.price-m.w4Low.price).toFixed(2));
 return {ok:true,count:Object.freeze({
  schema:"engine22.microProvisionalReview.v1",
  degree:"MICRO",parentDegree:"SUBMINUTE",
  countId:PROVISIONAL_MICRO_COUNT_ID,sequenceId:PROVISIONAL_MICRO_SEQUENCE_ID,
  sequenceDirection:"UP",activeWave:"W5",
  status:"PROVISIONAL_OWNER_ACCEPTED_OVERLAP",
  source:"ENGINE22_MANAGER_REVIEW_ANCHORS_2026_10_11",
  anchors:Object.freeze({
   w1Low:point(m.w1Low),w1High:point(m.w1High),w2Low:point(m.w2Low),
   w3High:point(m.w3High),w4Low:point(m.w4Low)
  }),
  structuralReview:Object.freeze({
   w1w4OverlapPoints:overlapPoints,
   acceptedByOwnerForProvisionalCount:true,
   standardImpulseConfirmed:false,
   diagonalConfirmed:false,
   historicalOHLCVerified:false,
  }),
  publicationEligible:false,automationEligible:false,
  noPermissionCreated:true,noExecution:true,noSizing:true,
  noManagement:true,noJournalMutation:true,
 })};
}
