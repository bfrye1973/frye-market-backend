// Engine 22 V3: deterministic wave lifecycle proposal, never a publication command.
// A new completed observation and structural confirmation are both required.
const WAVES = ["W1","W2","W3","W4","W5"];
const STATES = ["DEVELOPING","COMPLETION_CANDIDATE","CONFIRMED","LOCKED","INVALIDATED","RECOUNT_REQUIRED"];
const copy=x=>structuredClone(x);
export function evaluateEngine22V3WaveTransition({degreeState=null,evidence=null}={}) {
  if (!degreeState || !WAVES.includes(degreeState.activeWave))
    return {ok:false,reasonCodes:["ACTIVE_WAVE_REQUIRED"],proposal:null};
  if (!evidence || evidence.completed !== true || !evidence.sourceTimestamp ||
      !evidence.sourceBarId || !evidence.sourceTimeframe)
    return {ok:false,reasonCodes:["COMPLETED_SOURCE_EVIDENCE_REQUIRED"],proposal:null};
  const prior=degreeState.lastEvaluatedEvidenceTimestamp;
  const next=Date.parse(evidence.sourceTimestamp),old=prior ? Date.parse(prior) : -Infinity;
  if (!Number.isFinite(next) || !Number.isFinite(old) && old!==-Infinity)
    return {ok:false,reasonCodes:["INVALID_EVIDENCE_TIME"],proposal:null};
  if (next<=old)
    return {ok:false,reasonCodes:["DUPLICATE_OR_OLDER_OBSERVATION"],proposal:null};
  const proposal=copy(degreeState);
  proposal.lastEvaluatedEvidenceTimestamp=evidence.sourceTimestamp;
  proposal.lastEvaluatedEvidenceId=evidence.sourceBarId;
  proposal.lastEvaluatedTimeframe=evidence.sourceTimeframe;
  const lifecycle=String(degreeState.lifecycle || "DEVELOPING");
  if (!STATES.includes(lifecycle)) return {ok:false,reasonCodes:["INVALID_LIFECYCLE"],proposal:null};
  if (lifecycle==="LOCKED") return {ok:false,reasonCodes:["MANUAL_LOCK_PROTECTED"],proposal:null};
  if (lifecycle==="RECOUNT_REQUIRED" || lifecycle==="INVALIDATED")
    return {ok:false,reasonCodes:["AUTHORIZED_RECOUNT_REQUIRED"],proposal:null};
  if (evidence.invalidationConfirmed === true) {
    proposal.lifecycle="RECOUNT_REQUIRED";
    return {ok:true,reasonCodes:["CANONICAL_INVALIDATION_EVIDENCE"],proposal,
      advanceProposed:false,publishAuthorized:false};
  }
  if (evidence.completionCandidate===true && lifecycle==="DEVELOPING") {
    proposal.lifecycle="COMPLETION_CANDIDATE";
    return {ok:true,reasonCodes:["COMPLETION_CANDIDATE_OBSERVED"],proposal,
      advanceProposed:false,publishAuthorized:false};
  }
  if (evidence.completionConfirmed===true &&
      (lifecycle==="COMPLETION_CANDIDATE" || lifecycle==="CONFIRMED") &&
      evidence.structuralRuleId && evidence.independentConfirmation===true) {
    const index=WAVES.indexOf(degreeState.activeWave);
    if (index===4) {
      proposal.lifecycle="CONFIRMED";
      proposal.parentTransitionReviewRequired=true;
      return {ok:true,reasonCodes:["W5_CONFIRMED_PARENT_REVIEW_REQUIRED"],proposal,
        advanceProposed:false,publishAuthorized:false};
    }
    proposal.previousWave=degreeState.activeWave;
    proposal.activeWave=WAVES[index+1];
    proposal.lifecycle="DEVELOPING";
    return {ok:true,reasonCodes:["WAVE_TRANSITION_PROPOSED"],proposal,
      advanceProposed:true,publishAuthorized:false};
  }
  return {ok:true,reasonCodes:["NO_VERIFIED_TRANSITION"],proposal,
    advanceProposed:false,publishAuthorized:false};
}
