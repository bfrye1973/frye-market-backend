// Engine 6 Strategy 1 decision V1. Pure SHADOW evaluator: NEVER grants permission.
// Existing Phase 4 owns mandatory identity, qualification and safety evaluation.
// Engine 22 owns waves; Engine 25 owns internals; no score or sizing formula.
const upper=v=>typeof v==="string"?v.trim().toUpperCase():null;
const obj=v=>v&&typeof v==="object"&&!Array.isArray(v)?v:null;
const get=(v,...ks)=>ks.reduce((x,k)=>obj(x)?.[k],v);
const uniq=a=>[...new Set(a.filter(Boolean))];
const DIR=new Set(["LONG","SHORT"]);
const terminalCodes=new Set([
  "CANDIDATE_INVALIDATED","LOCATION_INVALIDATED","ENGINE4_HARD_BLOCKED",
  "ENGINE4_COMPLETED_ADVERSE_PARTICIPATION","CANDIDATE_ID_MISMATCH",
  "ZONE_ID_MISMATCH","SYMBOL_MISMATCH","STRATEGY_ID_MISMATCH",
  "SETUP_CLASS_MISMATCH","IDENTITY_SETUP_KEY_MISMATCH",
  "CANDIDATE_IDENTITY_VERSION_INCOMPATIBLE",
  "REACTION_PARTICIPATION_DIRECTION_MISMATCH",
  "ENGINE3_REACTION_FAILED","ENGINE3_REACTION_INVALIDATED",
  "ENGINE26_NEGOTIATED_MIDLINE_ALREADY_REACHED"
]);
const transientCodes=new Set([
  "ENGINE3_REACTION_WAITING","ENGINE3_REACTION_NOT_CONFIRMED",
  "ENGINE3_STRATEGY1_NOT_QUALIFIED","ENGINE3_EVALUATION_NOT_AUTHORIZED",
  "ENGINE4_PARTICIPATION_WAITING","ENGINE4_PARTICIPATION_NOT_CONFIRMED",
  "ENGINE26_NEUTRAL_OBSERVATION_ONLY","REACTION_DIRECTION_UNRESOLVED"
]);
export function evaluateEngine6ZoneRotationDecision({
 symbol="ES",strategyId="intraday_scalp@10m",candidate=null,reaction=null,
 participation=null,phase4=null,context=null,engine25Participation=null,
 completedTrip=null,reduceSizingAcknowledgment=null
}={}) {
 const reasons=[],warnings=[];
 const e26=obj(candidate),e3=obj(reaction),e4=obj(participation);
 const phase=obj(phase4),ctx=obj(context);
 const direction=upper(e3?.direction);
 const pDirection=upper(e4?.intendedDirection??e4?.direction);
 const id=e26?.candidateId??null, zone=e26?.zoneId??null;
 let decision="WAIT";
 const block=reason=>{reasons.push(reason);decision="BLOCK";};
 const wait=reason=>{reasons.push(reason);};
 // Active candidate must never be confused with the last completed trip.
 if(upper(symbol)!=="ES"||strategyId!=="intraday_scalp@10m")block("NOT_ES_STRATEGY1");
 if(!id||!zone)wait("CANDIDATE_IDENTITY_UNAVAILABLE");
 if(!phase || phase.applies!==true)wait("PHASE4_RESULT_UNAVAILABLE");
 if(phase?.allowed===false){
   const codes=Array.isArray(phase.blockers)?phase.blockers:[];
   for(const c of codes){
     if(terminalCodes.has(c)||/MISMATCH|CONFLICT|INVALIDATED|HARD_BLOCKED/.test(c))block(c);
     else wait(c);
   }
   if(!codes.length)wait("PHASE4_NOT_QUALIFIED");
 }
 if(phase?.allowed===true && (phase?.paperAllowed!==true||phase?.planningAllowed!==true))
    block("PHASE4_PAPER_SAFETY_FLAGS_CONFLICT");
 if(phase?.identity?.candidateId && phase.identity.candidateId!==id)block("PHASE4_CANDIDATE_MISMATCH");
 if(phase?.identity?.zoneId && phase.identity.zoneId!==zone)block("PHASE4_ZONE_MISMATCH");
 if(!DIR.has(direction))wait("ENGINE3_DIRECTION_UNQUALIFIED");
 if(DIR.has(pDirection)&&pDirection!==direction)block("ENGINE3_ENGINE4_DIRECTION_CONFLICT");
 if(e4?.hardBlocked===true)block("ENGINE4_HARD_BLOCKED");
 if(e26?.candidateInvalidated===true||e26?.locationInvalidated===true)block("ENGINE26A_INVALIDATED");
 // Active candidate and historical zone-memory records are different generations.
 // Engine26A owns lifecycle; identity plus owner-published start/provenance are evidence.
 const prior=obj(completedTrip);
 const memory=obj(e26?.zoneMemorySummary);
 const lifecycleStart=e26?.candidateLifecycleStartTime??memory?.candidateLifecycleStartTime??null;
 const currentMemoryOwner=memory?.currentCandidateId===id;
 const completionOwner=prior?.candidateId??null;
 const oldCandidateCompleted=completionOwner===id &&
   (prior?.midpointCompleted===true||["CLOSED","COMPLETED"].includes(upper(prior?.status)));
 if(oldCandidateCompleted)block("COMPLETED_TRIP_CANDIDATE_REUSED");
 const currentTerminal=["COMPLETED","INVALIDATED","CANCELLED","RETIRED"].includes(
   upper(e26?.status??e26?.candidateState)) ||
   (currentMemoryOwner && ["COMPLETED","INVALIDATED","CANCELLED","RETIRED"].includes(upper(memory?.lifecycleStatus)));
 if(currentTerminal)block("CURRENT_CANDIDATE_TERMINAL_LIFECYCLE");
 // Never treat historical objectiveCompletedAt by itself as current completion.
 if(memory?.objectiveCompletedAt && !currentMemoryOwner)
   warnings.push("HISTORICAL_ZONE_COMPLETION_NOT_CURRENT_CANDIDATE");
 if(prior?.candidateId && prior.candidateId!==id){
   const parentMatches=[e26?.priorCandidateId,e26?.parentCandidateId].includes(prior.candidateId);
   const childCurrent= currentMemoryOwner || Boolean(lifecycleStart);
   if(!parentMatches || !childCurrent)
      wait("FRESH_CANDIDATE_LIFECYCLE_PROOF_PENDING");
   else warnings.push("FRESH_CANDIDATE_AFTER_COMPLETED_TRIP");
 }
 if(e26?.promotedFromTargetCompletion===true){
   const parent=e26?.priorCandidateId??e26?.parentCandidateId;
   if(!parent || !lifecycleStart || !currentMemoryOwner ||
      (completionOwner && parent!==completionOwner))
      wait("PROMOTED_CANDIDATE_PROVENANCE_UNVERIFIED");
 }
 // Preserve Phase 4 as mandatory permission authority. Never upgrade a Phase 4 denial.
 if(phase?.allowed!==true)wait("PHASE4_MANDATORY_GATES_NOT_PASSED");
 if(ctx?.eligibleForPermissionReview===false)wait("SHADOW_CONTEXT_NOT_REVIEW_READY");
 if(ctx?.candidateId && ctx.candidateId!==id)block("SHADOW_CANDIDATE_MISMATCH");
 if(ctx?.zoneId && ctx.zoneId!==zone)block("SHADOW_ZONE_MISMATCH");
 // Wave reads are advisory. Working projections never become structural confirmation.
 const sub=ctx?.wave?.submicro,micro=ctx?.wave?.micro;
 if(!sub)warnings.push("SUBMICRO_EVIDENCE_UNAVAILABLE");
 else {
   if(sub.alignedWithReaction===false)warnings.push("SUBMICRO_WORKING_DIRECTION_CONFLICT");
   if(sub.confirmed!==true)warnings.push("SUBMICRO_OWNER_CONFIRMATION_PENDING");
 }
 if(micro?.parentConflict===true)warnings.push("MICRO_COUNTERTREND");
 if(!micro)warnings.push("MICRO_EVIDENCE_UNAVAILABLE");
 const pressure=upper(ctx?.internals?.directionalAssessment)??"UNAVAILABLE";
 const freshness=upper(get(engine25Participation,"freshness","intraday","state"));
 const validity=ctx?.internals?.timeframeValidity;
 const observed=Array.isArray(validity)?Object.fromEntries(validity.map(v=>[v.timeframe,v.available===true])):{};
 const validTactical=freshness==="FRESH" && observed["10m"] && observed["30m"] && observed["1h"];
 if(!validTactical)warnings.push("ENGINE25_TACTICAL_EVIDENCE_UNAVAILABLE");
 const backdrop=observed["4h"]===true?"AVAILABLE":"UNAVAILABLE";
 if(backdrop==="UNAVAILABLE")warnings.push("ENGINE25_4H_BACKDROP_UNAVAILABLE");
 if(pressure==="CAUTION")warnings.push("ENGINE25_OPPOSING_TACTICAL_EVIDENCE");
 if(pressure==="MIXED")warnings.push("ENGINE25_TACTICAL_EVIDENCE_MIXED");
 // Not a new safety threshold: missing evidence cannot count as support.
 // REDUCE is recommendation only, never a sizing authority or GO.
 const eligible=decision!=="BLOCK" && reasons.length===0 &&
   phase?.allowed===true && ctx?.eligibleForPermissionReview===true &&
   DIR.has(direction) && Boolean(id&&zone);
 if(eligible){
   if(!validTactical || pressure==="UNAVAILABLE" || pressure==="UNRESOLVED")
     decision="WAIT";
   else if(pressure==="CAUTION" || pressure==="MIXED" ||
       sub?.alignedWithReaction===false)
     decision="REDUCE";
   else decision="ALLOW";
 }
 // REDUCE cannot be promoted to a live GO without an exact bound Engine7 receipt.
 // This field is shadow diagnostic only and cannot create permission.
 const receipt=obj(reduceSizingAcknowledgment);
 const reducedRiskAcknowledged=decision==="REDUCE" &&
   receipt?.candidateId===id && receipt?.zoneId===zone &&
   receipt?.decision==="REDUCE" && receipt?.enforced===true &&
   Number.isInteger(receipt?.finalContracts) &&
   receipt.finalContracts>0 && receipt.finalContracts<3 &&
   receipt?.engine7SizingOwner===true;
 if(decision==="REDUCE" && !reducedRiskAcknowledged)
   warnings.push("REDUCE_NOT_ENFORCED_BY_ENGINE7");
 if(decision==="WAIT" && !reasons.length)reasons.push("CONTEXT_CONFIRMATION_PENDING");
 if(decision==="REDUCE")reasons.push("ADVERSE_CONTEXT_REDUCED_SIZE_REVIEW_ONLY");
 if(decision==="ALLOW")reasons.push("MANDATORY_GATES_PASS_CONTEXT_SUPPORTIVE");
 return {
   contract:"engine6.zoneRotationDecision.v1",mode:"READ_ONLY_SHADOW",
   decision,direction,candidateId:id,zoneId:zone,
   canCreatePermission:false,allowed:false,paperAllowed:false,
   realExecutionAllowed:false,brokerExecutionAllowed:false,
   reducedSizeEligibleForManagerReview:decision==="REDUCE",
   reduceSizingEnforcementVerified:reducedRiskAcknowledged,
   reducedPermissionActivationAllowed:false,
   sizingFormula:null,phase4MandatoryQualified:phase?.allowed===true,
   evidence:{pressure,validTactical,backdrop,
     submicroOwnerConfirmed:sub?.confirmed===true,
     submicroWorkingAligned:sub?.alignedWithReaction===true,
     microParentConflict:micro?.parentConflict===true},
   reasons:uniq(reasons),warnings:uniq(warnings),
   authority:"PHASE4_MANDATORY_ENGINE6_SHADOW_CONTEXT_ONLY"
 };
}
export default evaluateEngine6ZoneRotationDecision;
