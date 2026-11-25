// Owner-approved higher-degree research anchors. NOT a live price feed, current
// trade direction or a replacement for Engine22's authorized seven-degree selection.
// Published only from the latest owner-review point forward (never backfilled into Replay).
export const OWNER_WAVE_ROADMAP_SCHEMA="engine22.ownerWaveRoadmap.v1";
const ratiosRetracement=[0.236,0.382,0.5,0.618,0.786,1];
const ratiosExtension=[0.618,1,1.272,1.618,2,2.618];
const tick=x=>Math.round(x*4)/4;
const levels=(ratios,calc,type)=>ratios.map(ratio=>({
  key:(type==="UP_EXTENSION"?"e":"r")+String(Math.round(ratio*1000)).padStart(4,"0"),
  ratio,label:ratio.toFixed(3),price:tick(calc(ratio)),
  status:"WATCH",provisional:true,touchEvidenceAvailable:false,
  touchEvidenceType:null,levelType:type,notWaveEnding:true
}));
export function buildOwnerWaveRoadmapV1({symbol="ES",evaluationTimeMs=null}={}){
  // This timestamp is the original November 23 AZ owner review's GitHub evidence
  // (issue #378 creation). Never expose today's research in earlier Replay snapshots.
  const effectiveAtUtc="2026-11-24T06:10:31Z";
  const t=Number(evaluationTimeMs);
  if(String(symbol).toUpperCase()!=="ES"||!Number.isFinite(t)||
     t<Date.parse(effectiveAtUtc))return null;
  const w1Low=2440,w1High=4806,w4Low=6899,w3High=7885;
  const primaryW1Length=w1High-w1Low;
  const precedingW4Length=w3High-w4Low;
  return {
    schema:OWNER_WAVE_ROADMAP_SCHEMA,
    publicationType:"OWNER_WORKING_RESEARCH_ONLY",
    effectiveAtUtc,
    observedAtUtc:null,pointInTimeSourceVerified:false,priceBasisVerified:false,
    source:"OWNER_SELECTED_PIVOTS_2026_11_23_AND_ISSUE_378",
    primary:{
      activeWave:"W5",direction:"UP",stage:"OWNER_WORKING_UNCONFIRMED",
      priorW3High:{price:w3High,dateAz:"2026-10-07",timeAz:null},
      ownerMarkedW4Low:{price:w4Low,dateAz:"2026-11-20",timeAz:null},
      w1:{low:w1Low,high:w1High,length:primaryW1Length},
      fibMethod:"W5_UP_W4_LOW_PLUS_ORIGINAL_W1_LENGTH_TIMES_RATIO",
      levels:levels(ratiosExtension,r=>w4Low+primaryW1Length*r,"UP_EXTENSION")
    },
    intermediate:{
      activeWave:"W1",direction:"UP",stage:"W1_UP_DEVELOPING_CANDIDATE",
      parentDegree:"primary",parentWave:"W5",
      originLowCandidate:{price:w4Low,dateAz:"2026-11-20",timeAz:null},
      priorCorrectionHigh:{price:w3High,dateAz:"2026-10-07",timeAz:null},
      fibMethod:"NEW_W1_PRIOR_CORRECTION_RETRACEMENT_REFERENCE",
      levels:levels(ratiosRetracement,r=>w4Low+precedingW4Length*r,"UP_PRIOR_CORRECTION_RETRACEMENT"),
      firstW1EndHigh:null,completionConfirmed:false
    },
    micro:{
      activeWave:"W1",direction:"UP",stage:"W1_UP_HIGH_CANDIDATE_UNCONFIRMED",
      parentContext:"LOWER_DEGREE_UP_SWING_INSIDE_PRIMARY_W5",
      observedReferenceHigh:{price:7313.25,dateAz:"2026-11-23",timeAz:null,verified:false},
      startingLow:null,endingHigh:null,completionConfirmed:false,
      alternatives:["W1_STILL_DEVELOPING","W2_DOWN_CORRECTIVE_STRUCTURE_STARTED"],
      levels:[],fibStatus:"WITHHELD_UNTIL_LOW_AND_CONFIRMED_HIGH_VALIDATED"
    },
    submicro:{direction:"NEUTRAL",stage:"CONSOLIDATION_UNRESOLVED",
      alternatives:["INTERNAL_W4","MICRO_W2_START"],levels:[]},
    noExecution:true,noPermissionCreated:true,noWaveTransition:true,
    engine6ApprovalUnchanged:true,historicalRevisionsPreserved:true
  };
}
