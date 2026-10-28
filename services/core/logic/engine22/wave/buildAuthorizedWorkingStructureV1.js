import {ownerApprovedWorkingSelection,OWNER_APPROVED_SELECTION_SCHEMA} from "./ownerApprovedWorkingSelectionV1.js";
// Read-only seven-degree selection; no wave transitions or trading mutations.
import {createHash} from "node:crypto";
const order=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const string=x=>typeof x==="string"&&x.trim()?x:null;
const sha=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const ts=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?x:null;
export function buildAuthorizedWorkingStructureV1({currentWavelength,degreeStates,sevenDegreeInvalidations,publicationTime,selection=ownerApprovedWorkingSelection}={}){
const validSelection=selection?.schema===OWNER_APPROVED_SELECTION_SCHEMA&&Number.isInteger(selection.selectionRevision)&&selection.selectionRevision>0;
const configured=validSelection?selection.degrees:{};
const degrees={};
for(const degree of order){
const c=configured?.[degree];const sourcePath=c?.key?`currentWavelength.degrees.${degree}.${c.key}`:`degreeStates.${degree}`;
const m=c?.key?currentWavelength?.degrees?.[degree]?.[c.key]:c?.source==='degreeStates'?degreeStates?.[degree]:null;
const parent=c?.parentDegree&&configured?.[c.parentDegree];
const pm=parent?.key&&currentWavelength?.degrees?.[c.parentDegree]?.[parent.key];
const valid=m&&typeof m==="object"&&!Array.isArray(m)&&(!c.key||(m.version===c.modelVersion&&m.activeWave===c.activeWave&&m.direction===c.direction&&m.stage===c.stage&&(!m.parentDegree||m.parentDegree===c.parentDegree)&&(!m.parentWave||!c.parentWave||m.parentWave===c.parentWave)&&(!parent?.key||(pm?.version===parent.modelVersion))));
if(!valid){degrees[degree]={degree,available:false,sourcePath,selectionStatus:"UNAVAILABLE",reason:m?"CONFLICTING_CURRENT_AUTHORITY":"CURRENT_SOURCE_MISSING",countId:null,modelRevision:null,levels:[],officialInvalidation:null};continue;}
const readiness=sevenDegreeInvalidations?.degrees?.[degree]?.invalidationReadiness;
degrees[degree]={degree,available:true,selectionStatus:c.key?"OWNER_SELECTED_WORKING":"CANONICAL_DEGREE_STATE",sourcePath,modelVersion:c.modelVersion||string(m.version),countId:string(m.sourceCountId),modelRevision:Number.isInteger(m.revision)?m.revision:null,activeWave:c.activeWave||string(m.activeWave),direction:c.direction||string(m.direction),stage:c.stage||string(m.stage)||string(m.state),parentDegree:c.parentDegree||string(m.parentDegree),parentWave:c.parentWave||string(m.parentWave),levels:structuredClone(Array.isArray(m.levels)?m.levels:[]),review:structuredClone(readiness?.candidateZone??readiness?.proposedReview??null),officialInvalidation:readiness?.status==="APPROVED_ACTIVE"?structuredClone(readiness):null,ownerApprovalReference:string(m.ownerApprovalReference)||string(m.anchors?.provenance),approvedAt:ts(m.approvedAt),effectiveAt:ts(m.effectiveAt),priceEventAt:ts(m.priceEventAt),completionConfirmed:!c.key&&m.completionConfirmed===true,ownerEnding:structuredClone(degree==="submicro"?m.wave5?.high!=null?{price:m.wave5.high,localTime:m.wave5.highLocalTime,status:m.wave5.ownerEndingStatus||m.wave5.status}:null:degree==="micro"?m.wave3?.ownerEnding??null:null),previousModelVersion:string(m.previousModelVersion)};
}
return {schema:"engine22.authorizedWorkingStructure.v1",mode:"READ_ONLY",status:order.every(d=>degrees[d].available)?"COMPLETE_WORKING_SELECTION":"PARTIAL_UNAVAILABLE",publicationId:null,publicationRevision:validSelection?selection.selectionRevision:null,selectionApprovalReference:validSelection?selection.approvalReference:null,publishedAt:ts(publicationTime),modelFingerprint:sha(order.map(d=>{const r=degrees[d];return [validSelection?selection.selectionRevision:null,r.sourcePath,r.modelVersion,r.activeWave,r.stage,r.countId,r.modelRevision,r.parentDegree,r.parentWave,r.ownerEnding]})),evidenceFingerprint:sha(order.map(d=>[degrees[d].levels,degrees[d].review])),degreeOrder:order,degrees,pointInTimeAsOfAvailable:false,noExecution:true,noPermissionCreated:true,noWaveTransition:true};
}
