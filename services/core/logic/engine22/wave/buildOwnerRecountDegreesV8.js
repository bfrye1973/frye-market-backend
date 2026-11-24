// Owner-requested current-wave recount (Nov 23 AZ). This module NEVER erases
// earlier versioned models, touch records, history, or trading permissions.
// Only a research working selection; no automatic wave-completion inference.
export const OWNER_RECOUNT_V8_VERSION="engine22.ownerRecountNov23.v8";
export function buildOwnerRecountDegreesV8(roadmap){
  if(roadmap?.schema!=="engine22.ownerWaveRoadmap.v1" ||
      roadmap.noExecution!==true || roadmap.noPermissionCreated!==true)
    return null;
  const model=(degree,activeWave,direction,stage,parentDegree,parentWave,details={})=>({
    version:`${OWNER_RECOUNT_V8_VERSION}.${degree}`,
    degree,activeWave,direction,stage,parentDegree,parentWave,
    selectionStatus:"RESEARCH_ONLY",levels:[],
    ownerApprovalReference:"OWNER_20261123_CLEAR_OUT_MINOR_MINUTE_SUBMINUTE_RECOUNT_MICRO_SUBMICRO",
    effectiveAt:roadmap.effectiveAtUtc,
    completionConfirmed:false,reviewOnly:true,
    noExecution:true,noPermissionCreated:true,noWaveTransition:true,
    historyPreserved:true,...details
  });
  const minor=model("minor","RECOUNT","NEUTRAL","CURRENT_COUNT_CLEARED_RECOUNT_PENDING",
    "intermediate","W1",{
      priorOwnerW2Low:6900,priorOwnerW2DateAz:"2026-11-20",
      note:"Prior owner W3-UP hypothesis retained in history; current Minor structure awaiting consistent lower-degree recount."
    });
  const minute=model("minute","RECOUNT","NEUTRAL","CURRENT_COUNT_CLEARED_RECOUNT_PENDING",
    "minor","RECOUNT");
  const subminute=model("subminute","RECOUNT","NEUTRAL","CURRENT_COUNT_CLEARED_RECOUNT_PENDING",
    "minute","RECOUNT");
  const micro=model("micro","W1","UP","W1_UP_CANDIDATE_UNCONFIRMED",
    "subminute","RECOUNT",{
      candidateHigh:roadmap.micro.observedReferenceHigh,
      startLow:null,endHigh:null,completionConfirmed:false,
      alternative:"MICRO_W2_MAY_HAVE_STARTED",
      note:"Research UP candidate only; no same-degree completed pivot or W2 Fibonacci allowed."
    });
  const submicro=model("submicro","UNRESOLVED","NEUTRAL","CONSOLIDATION_UNRESOLVED",
    "micro","W1",{
      alternatives:["INTERNAL_W4_BEFORE_UP_CONTINUATION","MICRO_W2_CORRECTION_START"],
      note:"No confirmed internal count or authorized zone; no Fibonacci projection."
    });
  return {minor,minute,subminute,micro,submicro};
}
