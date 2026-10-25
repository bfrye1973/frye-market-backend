// Engine 22 owns structural invalidation authority.
// This additive publication MUST NOT infer boundaries from Fibonacci touches,
// owner anchors, legacy sequences, or unverified higher-degree models.
// No permissions, alerts, execution, or count mutations.
const SCHEMA = "engine22.sevenDegreeInvalidations.v1";
const DEGREES = ["submicro","micro","subminute","minute","minor","intermediate","primary"];
const reason = "STRUCTURAL_INVALIDATION_RULE_NOT_APPROVED";
const safe = value => typeof value === "string" && value.trim() ? value : null;

function unpublished(scope, reasonCodes=[reason]) {
  return {
    scope,
    status:"NOT_PUBLISHED",
    lifecycle:"NOT_PUBLISHED",
    price:null,
    comparison:null,
    trigger:null,
    timeframe:null,
    confirmedAt:null,
    evidence:null,
    ruleVersion:null,
    reasonCodes,
  };
}
function ownerRecord({degree,model,expectedVersion,waveIdentity,parentDegree,parentWave,sourcePath,scopes}) {
  const version=safe(model?.version);
  const matching=version===expectedVersion;
  return {
    degree,
    activeModel:matching?version:null,
    expectedModelVersion:expectedVersion,
    modelSource:sourcePath,
    modelStatus:matching?"OWNER_WORKING_UNCONFIRMED":"NOT_PUBLISHED",
    waveIdentity:matching?waveIdentity:null,
    direction:matching?(safe(model?.direction)||null):null,
    stage:matching?(safe(model?.stage)||null):null,
    parentDegree,
    parentWave,
    sourceCountId:null,
    countIdentityStatus:"NOT_PUBLISHED",
    modelRevision:null,
    sourceTimestamp:null,
    rules:scopes.map(scope=>unpublished(scope,matching?[reason]:["CURRENT_OWNER_MODEL_NOT_PUBLISHED",reason])),
  };
}
function higherRecord(degree,degreeStates){
  const s=degreeStates?.[degree];
  const active=s?.active===true;
  // DegreeStates is an independent producer. Existing generic invalidation
  // fields cannot be bound to a specific current count and approved trigger.
  return {
    degree,
    activeModel:null,
    expectedModelVersion:null,
    modelSource:"engine22WaveStrategy.degreeStates."+degree,
    modelStatus:active?"STRUCTURAL_CONTEXT_UNVERIFIED_INVALIDATION":"NOT_PUBLISHED",
    waveIdentity:active?safe(s.activeWave):null,
    direction:active?safe(s.direction):null,
    stage:active?safe(s.stage):null,
    parentDegree:degree==="minor"?"intermediate":degree==="intermediate"?"primary":null,
    parentWave:active?safe(s.parentWave):null,
    sourceCountId:null,
    countIdentityStatus:"NOT_PUBLISHED",
    modelRevision:null,
    sourceTimestamp:null,
    rules:[
      unpublished("DEGREE_COUNT",active?["CURRENT_DEGREE_INVALIDATION_EVIDENCE_NOT_QUALIFIED",reason]:["CURRENT_DEGREE_STATE_NOT_PUBLISHED",reason]),
      unpublished("PARENT_STRUCTURE",["PARENT_INVALIDATION_CONTRACT_NOT_PUBLISHED",reason]),
    ],
  };
}
export function buildSevenDegreeInvalidationsV1({
  currentWavelength=null,degreeStates=null,evaluationTimeMs=null,
}={}){
  const cw=currentWavelength?.degrees||{};
  const parent=cw.minute?.ownerMinuteW2Hypothesis;
  const records={
    submicro:ownerRecord({
      degree:"submicro",model:cw.submicro?.ownerSubmicroCDown,
      expectedVersion:"engine22.submicroCDownOwnerWatch.v1",
      waveIdentity:"SUBMICRO_C_DOWN",parentDegree:"micro",parentWave:"C",
      sourcePath:"engine22WaveStrategy.currentWavelength.degrees.submicro.ownerSubmicroCDown",
      scopes:["INTERNAL_LEG","DEGREE_COUNT","PARENT_STRUCTURE"],
    }),
    micro:ownerRecord({
      degree:"micro",model:cw.micro?.ownerMicroCDown,
      expectedVersion:"engine22.microCDownOwnerWatch.v1",
      waveIdentity:"MICRO_C_DOWN",parentDegree:"subminute",parentWave:"C",
      sourcePath:"engine22WaveStrategy.currentWavelength.degrees.micro.ownerMicroCDown",
      scopes:["INTERNAL_LEG","DEGREE_COUNT","PARENT_STRUCTURE"],
    }),
    subminute:{
      degree:"subminute",
      activeModel:cw.subminute?.ownerCurrentCDown?.version === "engine22.subminuteCurrentCDownReference.v1"
        ? "engine22.subminuteCurrentCDownReference.v1":null,
      expectedModelVersion:"engine22.subminuteCurrentCDownReference.v1",
      modelSource:"engine22WaveStrategy.currentWavelength.degrees.subminute.ownerCurrentCDown",
      modelStatus:cw.subminute?.ownerCurrentCDown?.version==="engine22.subminuteCurrentCDownReference.v1"
        ?"OWNER_WORKING_DEGREE_PLACEMENT_PROVISIONAL":"NOT_PUBLISHED",
      waveIdentity:cw.subminute?.ownerCurrentCDown?.version==="engine22.subminuteCurrentCDownReference.v1"?"SUBMINUTE_C_DOWN":null,
      direction:cw.subminute?.ownerCurrentCDown?.version==="engine22.subminuteCurrentCDownReference.v1"?"DOWN":null,
      stage:cw.subminute?.ownerCurrentCDown?.stage||null,
      parentDegree:"minute",parentWave:"W2",
      sourceCountId:null,countIdentityStatus:"NOT_PUBLISHED",modelRevision:null,sourceTimestamp:null,
      rules:["INTERNAL_LEG","DEGREE_COUNT","PARENT_STRUCTURE"].map(scope=>unpublished(scope)),
    },
    minute:ownerRecord({
      degree:"minute",model:parent,
      expectedVersion:"engine22.minuteW2ComplexCorrectionWatch.v1",
      waveIdentity:"MINUTE_W2_INTERNAL_C_DOWN_CANDIDATE",parentDegree:"minor",parentWave:null,
      sourcePath:"engine22WaveStrategy.currentWavelength.degrees.minute.ownerMinuteW2Hypothesis",
      scopes:["INTERNAL_C_DOWN","MINUTE_W2_DEGREE_COUNT","PARENT_STRUCTURE"],
    }),
    minor:higherRecord("minor",degreeStates),
    intermediate:higherRecord("intermediate",degreeStates),
    primary:higherRecord("primary",degreeStates),
  };
  if(records.minute.modelStatus==="OWNER_WORKING_UNCONFIRMED"){
    records.minute.direction=cw.minute?.ownerLargerCDownScenario?.version==="engine22.largerCorrectionCDownWatch.v1"?"DOWN":null;
    records.minute.largerCorrectionDirection="CORRECTIVE";
  }
  // RESEARCH ONLY: Review references are not approved structural invalidations.
  // Crucially, a corrective C-wave exceeding its B high can require a recount
  // without invalidating the entire higher-degree structure.
  // No fields in this block may be used as trade permission or a live alert.
  const positive = x=>typeof x==="number" && Number.isFinite(x) && x>0 ? x : null;
  const ownerB = (model,version)=>model?.version===version ? positive(model?.waveB?.high) : null;
  const submicroReviewHigh=ownerB(cw.submicro?.ownerSubmicroCDown,"engine22.submicroCDownOwnerWatch.v1");
  const microReviewHigh=ownerB(cw.micro?.ownerMicroCDown,"engine22.microCDownOwnerWatch.v1");
  const prerequisite=[
    "OWNER_APPROVED_COUNT_ID_AND_REVISION",
    "OWNER_APPROVED_PATTERN_SPECIFIC_INVALIDATION_RULE",
    "EXACT_ES_PRICE_AND_DIRECTION",
    "CONFIRMATION_CANDLE_TIMEFRAME_AND_CLOSE_OR_WICK_POLICY",
    "SOURCE_TIMESTAMPS_AND_COMPLETED_BAR_EVIDENCE",
    "PARENT_CHILD_SCOPE_AND_RECOUNT_POLICY",
    "REPLAY_TEST_AND_OWNER_SIGNOFF",
  ];
  const reviewPlan={
    submicro:{
      candidateReference:submicroReviewHigh,referenceType:"COMPLETED_B_HIGH",
      observation:"PRICE_ABOVE_REFERENCE_SUGGESTS_C_DOWN_RECOUNT_REVIEW_NOT_HARD_INVALIDATION",
      reviewTimeframe:"10m",reviewTrigger:"COMPLETED_10M_CLOSE_ABOVE_REFERENCE",
      timeframeStatus:"RESEARCH_PROPOSAL_NOT_APPROVED",
      parentRecountOnReview:false,
    },
    micro:{
      candidateReference:microReviewHigh,referenceType:"COMPLETED_B_HIGH",
      observation:"PRICE_ABOVE_REFERENCE_SUGGESTS_C_DOWN_RECOUNT_REVIEW_NOT_HARD_INVALIDATION",
      reviewTimeframe:"1h",reviewTrigger:"COMPLETED_1H_CLOSE_ABOVE_REFERENCE",
      timeframeStatus:"RESEARCH_PROPOSAL_NOT_APPROVED",
      parentRecountOnReview:false,
    },
    subminute:{
      candidateReference:null,referenceType:"NONE_APPROVED",
      observation:"RECONCILE_SUBMINUTE_C_DEGREE_ASSIGNMENT_WITH_MINUTE_W2_BEFORE_RULE",
      reviewTimeframe:null,reviewTrigger:null,timeframeStatus:"NOT_PROPOSED",
      parentRecountOnReview:false,
    },
    minute:{
      candidateReference:null,referenceType:"NONE_APPROVED",
      observation:"RESOLVE_MINUTE_W2_ABC_VS_ABCDE_AND_C_DEGREE_PLACEMENT_BEFORE_RULE",
      reviewTimeframe:null,reviewTrigger:null,timeframeStatus:"NOT_PROPOSED",
      parentRecountOnReview:false,
    },
    minor:{
      candidateReference:null,referenceType:"NONE_APPROVED",
      observation:"QUALIFY_CURRENT_MINOR_COUNT_AND_PARENT_WAVE_START_WITH_OWNER_EVIDENCE",
      reviewTimeframe:null,reviewTrigger:null,timeframeStatus:"NOT_PROPOSED",
      parentRecountOnReview:false,
    },
    intermediate:{
      candidateReference:null,referenceType:"NONE_APPROVED",
      observation:"QUALIFY_CURRENT_INTERMEDIATE_COUNT_AND_STRUCTURAL_FAILURE_PATTERN",
      reviewTimeframe:null,reviewTrigger:null,timeframeStatus:"NOT_PROPOSED",
      parentRecountOnReview:false,
    },
    primary:{
      candidateReference:null,referenceType:"NONE_APPROVED",
      observation:"QUALIFY_CURRENT_PRIMARY_COUNT_AND_STRUCTURAL_FAILURE_PATTERN",
      reviewTimeframe:null,reviewTrigger:null,timeframeStatus:"NOT_PROPOSED",
      parentRecountOnReview:false,
    },
  };
  for(const degree of DEGREES){
    const proposal=reviewPlan[degree];
    records[degree].invalidationReadiness={
      schema:"engine22.invalidationReadiness.v1",
      status:"OWNER_RULE_APPROVAL_REQUIRED",
      confirmedInvalidation:false,
      tradePermissionEligible:false,
      alertEligible:false,
      officialInvalidationPrice:null,
      proposedReview:proposal,
      prerequisites:prerequisite,
      approvedRules:0,
    };
  }
  const degrees=Object.fromEntries(DEGREES.map(d=>[d,records[d]]));
  return {
    schema:SCHEMA,
    mode:"READ_ONLY",
    authority:"ENGINE_22",
    evaluationTime:Number.isFinite(evaluationTimeMs)?new Date(evaluationTimeMs).toISOString():null,
    currentCountIdsVerified:false,
    warningEligible:false,
    status:"NO_APPROVED_ACTIVE_INVALIDATIONS",
    degrees,
    reasonCodes:["SEVEN_DEGREE_ACTIVE_INVALIDATION_APPROVAL_PENDING"],
  };
}
export default buildSevenDegreeInvalidationsV1;
