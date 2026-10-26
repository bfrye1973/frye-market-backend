// Engine 22A+22B combined observational wave recognition, v1.
// One public interface; pivot qualification and count interpretation remain
// separate pure functions so the package can later be split.
// Does not modify historical counts, persist anything, authorize transitions,
// or publish to legacy Engine 22/27 execution-facing snapshots.
import { detectEngine22V3SwingEvidence } from "../v3/detectSwingEvidence.js";
import { assessEngine22V3ImpulseGeometry } from "../v3/assessImpulseGeometry.js";
import { ENGINE22_V3_DEGREES, ENGINE22_V3_PARENT } from "../v3/canonicalStructure.js";

export const ENGINE22_AB_SCHEMA = "engine22.waveRecognitionShadow.v1";
const record = v => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = v => typeof v === "number" && Number.isFinite(v);
const tick = n => Math.abs(n * 4 - Math.round(n * 4)) < 1e-8;
const iso = t => typeof t === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(t) && Number.isFinite(Date.parse(t));
const refusal = (codes, other={}) => ({available:false,reasonCodes:codes,...other,noExecution:true,noPermissionCreated:true,shadowOnly:true});
const selectedDirection = n => n?.sequenceDirection === "UP" || n?.sequenceDirection === "DOWN" ? n.sequenceDirection : null;

// 22A: use existing V3 right-hand-confirmed completed-bar pivot algorithm.
// A pivot is evidence, NEVER an approved owner anchor.
export function qualifyEngine22ABPivots({bars=[],timeframe=null,left=2,right=2,expectedSource=null}={}) {
  if (!Array.isArray(bars) || bars.length===0 || typeof timeframe!=="string" || !timeframe)
    return refusal(["BARS_AND_TIMEFRAME_REQUIRED"],{pivots:[]});
  if (!bars.every(b=>record(b) && b.closed===true && b.timeframe===timeframe &&
      iso(b.sourceTimestamp) && typeof b.sourceBarId==="string" && b.sourceBarId.trim() &&
      finite(b.open) && finite(b.high) && finite(b.low) && finite(b.close) &&
      b.low>0 && b.low<=b.open && b.low<=b.close && b.high>=b.open &&
      b.high>=b.close && b.high>=b.low && [b.open,b.high,b.low,b.close].every(tick)))
    return refusal(["INVALID_OR_INCOMPLETE_ES_BAR"],{pivots:[]});
  if (bars.some((b,i)=>i>0 && (Date.parse(b.sourceTimestamp)<=Date.parse(bars[i-1].sourceTimestamp) ||
       b.sourceBarId===bars[i-1].sourceBarId)))
    return refusal(["NON_MONOTONIC_OR_REPEATED_BAR"],{pivots:[]});
  if (expectedSource && bars.some(b=>b.sourceVendor!==expectedSource.sourceVendor ||
      b.sourceSeriesId!==expectedSource.sourceSeriesId))
    return refusal(["SOURCE_CONTINUITY_MISMATCH"],{pivots:[]});
  const highs=detectEngine22V3SwingEvidence({bars,left,right,side:"HIGH"});
  const lows=detectEngine22V3SwingEvidence({bars,left,right,side:"LOW"});
  if (!highs.available || !lows.available)
    return refusal([...highs.reasonCodes,...lows.reasonCodes],{pivots:[]});
  const pivots=[...highs.candidates,...lows.candidates]
    .sort((a,b)=>Date.parse(a.sourceTimestamp)-Date.parse(b.sourceTimestamp) ||
      a.side.localeCompare(b.side))
    .map(p=>({...p,qualification:"COMPLETED_BAR_SWING_CANDIDATE",ownerApproved:false}));
  return {available:true,schema:ENGINE22_AB_SCHEMA,timeframe,pivots,reasonCodes:["PIVOT_EVIDENCE_NOT_APPROVED_ANCHORS"],noExecution:true,noPermissionCreated:true,shadowOnly:true};
}

// 22B: compare owner working count with observational alternatives.
// No inference of an approved active count, historical identity, or pattern confirmation.
export function evaluateEngine22ABStructure({degree=null,ownerCount=null,pivotEvidence=null,alternatives=[]}={}) {
  if (!ENGINE22_V3_DEGREES.includes(degree))
    return refusal(["UNKNOWN_DEGREE"],{workingCount:null,alternatives:[]});
  if (!record(ownerCount) || ownerCount.degreeId!==degree ||
      ownerCount.parentDegree!==ENGINE22_V3_PARENT[degree])
    return refusal(["APPROVED_WORKING_CONTEXT_REQUIRED"],{workingCount:null,alternatives:[]});
  if (ownerCount.countId && /^ES-V3-BASELINE-/i.test(ownerCount.countId))
    return refusal(["SYNTHETIC_V3_ID_NOT_ACTIVE_AUTHORITY"],{workingCount:null,alternatives:[]});
  if (pivotEvidence?.available!==true)
    return refusal(["QUALIFIED_PIVOT_EVIDENCE_REQUIRED"],{workingCount:null,alternatives:[]});
  const direction=selectedDirection(ownerCount);
  if (!direction)
    return refusal(["WORKING_DIRECTION_UNCONFIRMED"],{workingCount:null,alternatives:[]});
  const approvedWorking = {
    degreeId:degree,parentDegree:ENGINE22_V3_PARENT[degree],
    countId:ownerCount.countId??null,modelVersion:ownerCount.modelVersion??null,
    ownerApprovalRef:ownerCount.ownerApprovalRef??null,
    activeWave:ownerCount.activeWave??null,
    sequenceDirection:direction,anchors:ownerCount.anchors??{},
    status:"OWNER_WORKING_UNCONFIRMED",canonicalActivationAuthorized:false,
  };
  const geometry=ownerCount.patternType==="IMPULSE" ?
    assessEngine22V3ImpulseGeometry({anchors:ownerCount.anchors,direction,classification:"IMPULSE"}) : null;
  const permitted=new Set(["ABC","ABCDE","IMPULSE","UNCLASSIFIED"]);
  const candidateAlternatives=(Array.isArray(alternatives)?alternatives:[])
    .filter(a=>record(a) && permitted.has(a.patternType))
    .map((a,i)=>({
      candidateKey:typeof a.candidateKey==="string"&&a.candidateKey?a.candidateKey:"OBSERVATIONAL_"+i,
      patternType:a.patternType,
      evidenceBarIds:Array.isArray(a.evidenceBarIds)?a.evidenceBarIds.filter(x=>typeof x==="string"):[],
      status:"UNCONFIRMED_ALTERNATIVE",ownerApproved:false,activationAuthorized:false,
    }));
  return {
    available:true,schema:ENGINE22_AB_SCHEMA,degree,workingCount:approvedWorking,
    alternatives:candidateAlternatives,geometryReview:geometry?{
      valid:geometry.valid,reasonCodes:geometry.errors,
      note:"Impulse geometry check only, not Elliott count confirmation",
    }:null,
    pivotCandidateCount:pivotEvidence.pivots.length,
    reasonCodes:["WORKING_OWNER_COUNT_PRESERVED","ALTERNATIVES_OBSERVATIONAL_ONLY"],
    noExecution:true,noPermissionCreated:true,shadowOnly:true,
  };
}

// Combined entry point: returns observational work without changing anything.
export function buildEngine22ABRecognitionShadow(input={}) {
  const {bars=[],timeframe=null,degree=null,ownerCount=null,alternatives=[],left=2,right=2,expectedSource=null}=input;
  const pivotEvidence=qualifyEngine22ABPivots({bars,timeframe,left,right,expectedSource});
  const structure=evaluateEngine22ABStructure({degree,ownerCount,pivotEvidence,alternatives});
  return {schema:ENGINE22_AB_SCHEMA,degree,sourceTimeframe:timeframe,pivotEvidence,structure,
    available:pivotEvidence.available&&structure.available,
    noExecution:true,noPermissionCreated:true,shadowOnly:true,publishAuthorized:false,
    countTransitionAuthorized:false,noWaveCountMutation:true};
}
