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
  const subminute=parent?.childDegreeContext?.subminute;
  const records={
    submicro:ownerRecord({
      degree:"submicro",model:cw.submicro?.ownerSubmicroADown,
      expectedVersion:"engine22.submicroADownOwnerWatch.v1",
      waveIdentity:"SUBMICRO_A_DOWN",parentDegree:"micro",parentWave:"B",
      sourcePath:"engine22WaveStrategy.currentWavelength.degrees.submicro.ownerSubmicroADown",
      scopes:["INTERNAL_LEG","DEGREE_COUNT","PARENT_STRUCTURE"],
    }),
    micro:ownerRecord({
      degree:"micro",model:cw.micro?.ownerMicroBDown,
      expectedVersion:"engine22.microBDownOwnerWatch.v1",
      waveIdentity:"MICRO_B_DOWN",parentDegree:"subminute",parentWave:"ABC_UP_INSIDE_MINUTE_D",
      sourcePath:"engine22WaveStrategy.currentWavelength.degrees.micro.ownerMicroBDown",
      scopes:["INTERNAL_LEG","DEGREE_COUNT","PARENT_STRUCTURE"],
    }),
    subminute:{
      degree:"subminute",activeModel:null,
      expectedModelVersion:null,
      modelSource:"engine22WaveStrategy.currentWavelength.degrees.minute.ownerMinuteW2Hypothesis.childDegreeContext.subminute",
      modelStatus:subminute?.currentWorkingStructure==="ABC_UP_INSIDE_MINUTE_D"?"OWNER_WORKING_CONTEXT_ONLY":"NOT_PUBLISHED",
      waveIdentity:subminute?.currentWorkingStructure==="ABC_UP_INSIDE_MINUTE_D"?"SUBMINUTE_ABC_UP":null,
      direction:subminute?.currentWorkingStructure==="ABC_UP_INSIDE_MINUTE_D"?"UP":null,
      stage:subminute?.waveRecount||null,
      parentDegree:"minute",parentWave:"D",
      sourceCountId:null,countIdentityStatus:"NOT_PUBLISHED",modelRevision:null,sourceTimestamp:null,
      rules:["INTERNAL_LEG","DEGREE_COUNT","PARENT_STRUCTURE"].map(scope=>unpublished(scope)),
    },
    minute:ownerRecord({
      degree:"minute",model:parent,
      expectedVersion:"engine22.minuteW2ComplexCorrectionWatch.v1",
      waveIdentity:"MINUTE_W2_INTERNAL_D_UP",parentDegree:"minor",parentWave:null,
      sourcePath:"engine22WaveStrategy.currentWavelength.degrees.minute.ownerMinuteW2Hypothesis",
      scopes:["INTERNAL_D_UP","MINUTE_W2_DEGREE_COUNT","PARENT_STRUCTURE"],
    }),
    minor:higherRecord("minor",degreeStates),
    intermediate:higherRecord("intermediate",degreeStates),
    primary:higherRecord("primary",degreeStates),
  };
  if(records.minute.modelStatus==="OWNER_WORKING_UNCONFIRMED"){
    records.minute.direction=parent.activeInternalLegDirection==="UP"?"UP":null;
    records.minute.largerCorrectionDirection="CORRECTIVE";
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
