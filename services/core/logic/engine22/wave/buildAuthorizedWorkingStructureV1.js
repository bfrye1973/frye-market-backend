// Read-only seven-degree selection; no wave transitions or trading mutations.
import {createHash} from "node:crypto";
const choices={
submicro:["ownerSubmicroFiveUp","engine22.submicroFiveUpOct27OwnerWatch.v1","W5","UP","PROJECTED_W5_WATCH","micro","W3"],
micro:["ownerMicroW3Up","engine22.microW3UpOct27Owner.v1","W3","UP","DEVELOPING_CANDIDATE","subminute","D"],
subminute:["ownerCurrentDUp","engine22.subminuteDUpOwnerWorking.v1","D","UP","DEVELOPING_CANDIDATE","minute","W2"],
minute:["ownerMinuteW2Retracement","engine22.minuteW2RetracementOwner.v1","W2","DOWN","DEVELOPING","minor",null]};
const order=["submicro","micro","subminute","minute","minor","intermediate","primary"];
const string=x=>typeof x==="string"&&x.trim()?x:null;
const sha=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const ts=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?x:null;
export function buildAuthorizedWorkingStructureV1({currentWavelength,degreeStates,sevenDegreeInvalidations,publicationTime}={}){
const degrees={};
for(const degree of order){
const c=choices[degree];const sourcePath=c?`currentWavelength.degrees.${degree}.${c[0]}`:`degreeStates.${degree}`;
const m=c?currentWavelength?.degrees?.[degree]?.[c[0]]:degreeStates?.[degree];
const parent=c&&choices[c[5]];
const pm=parent&&currentWavelength?.degrees?.[c[5]]?.[parent[0]];
const valid=m&&typeof m==="object"&&!Array.isArray(m)&&(!c||(m.version===c[1]&&m.activeWave===c[2]&&m.direction===c[3]&&m.stage===c[4]&&(!m.parentDegree||m.parentDegree===c[5])&&(!m.parentWave||!c[6]||m.parentWave===c[6])&&(!parent||(pm?.version===parent[1]))));
if(!valid){degrees[degree]={degree,available:false,sourcePath,selectionStatus:"UNAVAILABLE",reason:m?"CONFLICTING_CURRENT_AUTHORITY":"CURRENT_SOURCE_MISSING",countId:null,modelRevision:null,levels:[],officialInvalidation:null};continue;}
const readiness=sevenDegreeInvalidations?.degrees?.[degree]?.invalidationReadiness;
degrees[degree]={degree,available:true,selectionStatus:c?"OWNER_SELECTED_WORKING":"CANONICAL_DEGREE_STATE",sourcePath,modelVersion:c?.[1]||string(m.version),countId:string(m.sourceCountId),modelRevision:Number.isInteger(m.revision)?m.revision:null,activeWave:c?.[2]||string(m.activeWave),direction:c?.[3]||string(m.direction),stage:c?.[4]||string(m.stage)||string(m.state),parentDegree:c?.[5]||string(m.parentDegree),parentWave:c?.[6]||string(m.parentWave),levels:structuredClone(Array.isArray(m.levels)?m.levels:[]),review:structuredClone(readiness?.candidateZone??readiness?.proposedReview??null),officialInvalidation:readiness?.status==="APPROVED_ACTIVE"?structuredClone(readiness):null,ownerApprovalReference:string(m.ownerApprovalReference)||string(m.anchors?.provenance),approvedAt:ts(m.approvedAt),effectiveAt:ts(m.effectiveAt),priceEventAt:ts(m.priceEventAt),completionConfirmed:!c&&m.completionConfirmed===true,previousModelVersion:string(m.previousModelVersion)};
}
return {schema:"engine22.authorizedWorkingStructure.v1",mode:"READ_ONLY",status:order.every(d=>degrees[d].available)?"COMPLETE_WORKING_SELECTION":"PARTIAL_UNAVAILABLE",publicationId:null,publicationRevision:null,publishedAt:ts(publicationTime),modelFingerprint:sha(order.map(d=>{const r=degrees[d];return [r.sourcePath,r.modelVersion,r.activeWave,r.stage,r.countId,r.modelRevision,r.parentDegree,r.parentWave]})),evidenceFingerprint:sha(order.map(d=>[degrees[d].levels,degrees[d].review])),degreeOrder:order,degrees,pointInTimeAsOfAvailable:false,noExecution:true,noPermissionCreated:true,noWaveTransition:true};
}
