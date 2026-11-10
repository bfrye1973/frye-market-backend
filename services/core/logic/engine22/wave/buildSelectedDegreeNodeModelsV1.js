// Engine22: read-only current owner-selection / degree-state chart node adapter.
// This is an extension of workingWaveNodes.v1, NOT a second data source.
// Unknown or ambiguous source timestamps/ES prices never become chart markers.
import {createHash} from "node:crypto";
import {ownerApprovedWorkingSelection} from "./ownerApprovedWorkingSelectionV1.js";
import {readFileSync} from "node:fs";

// One-time reconciliation of an existing Engine22 history record against a
// CURRENT Strategy-card price AND date. Never override either value. No new
// data feed or runtime spreadsheet request is introduced.
const ownerHistory=JSON.parse(readFileSync(
  new URL("../history/fixtures/ownerSheetAnchorsNov8V1.json",import.meta.url),"utf8"));
const historicalTimes=Object.freeze(Object.fromEntries(
  ["primary","intermediate"].map(degree=>[degree,
    ownerHistory.tabs.filter(t=>t.title.toLowerCase()===degree)
      .flatMap(t=>t.rows).filter(row=>
        typeof row[3]==="string"&&typeof row[4]==="string"&&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(row[4])&&
        Number.isFinite(Number(row[5])))
      .map(row=>({date:row[3],time:row[4],price:Number(row[5])}))
  ])
));
export function approvedTimeForCardMark(degree,mark){
  if(typeof mark?.time!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(mark.time))return mark?.time;
  const matches=(historicalTimes[degree]??[]).filter(row=>
    row.date===mark.time && row.price===mark.price);
  // Two historical matches or conflicting price/time evidence fail closed.
  return matches.length===1 ? matches[0].date+" "+matches[0].time+" AZ" : mark.time;
}
const sha=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const tick=x=>typeof x==="number"&&Number.isFinite(x)&&x>0&&
  Math.abs(x*4-Math.round(x*4))<1e-8;
const isoUtc=x=>typeof x==="string"&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)&&
  Number.isFinite(Date.parse(x));
function exactArizonaTime(raw){
  if(typeof raw!=="string")return null;
  const m=/^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):([0-5]\d)(?: AZ)?$/.exec(raw);
  if(!m)return null;
  const date=new Date(m[1]+"T"+m[2]+":"+m[3]+":00-07:00");
  if(!Number.isFinite(date.getTime()))return null;
  // Check actual wall-clock roundtrip; invalid calendar dates cannot roll over.
  const midnight=Date.parse(m[1]+"T00:00:00Z");
  if(!Number.isFinite(midnight)||new Date(midnight).toISOString().slice(0,10)!==m[1])return null;
  return date.toISOString();
}
function parseSourceTime(raw){
  if(typeof raw!=="string")return null;
  const az=exactArizonaTime(raw);
  if(az)return {marketAtUtc:az,ownerArizonaTime:raw,sourceTimestampConflict:false};
  if(isoUtc(raw))return {marketAtUtc:new Date(raw).toISOString(),ownerArizonaTime:null,sourceTimestampConflict:false};
  // Offset timestamp is accepted only if the source explicitly carries -07:00.
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?-07:00$/.test(raw)&&Number.isFinite(Date.parse(raw)))
    return {marketAtUtc:new Date(raw).toISOString(),ownerArizonaTime:raw,sourceTimestampConflict:false};
  return null;
}
function makeNode({degree,modelVersion,sourcePath,sourceFieldPath,anchorField,label,price,time,approvalReference,selectionStatus}){
  if(!tick(price))return null;
  const parsed=parseSourceTime(time);
  if(!parsed)return null;
  const nodeId="node-"+sha([degree,modelVersion,anchorField]).slice(0,24);
  const sourceRevision=sha([sourcePath,sourceFieldPath,price,time,parsed.marketAtUtc,approvalReference??null]);
  return {nodeId,waveId:"wave-"+sha([degree,modelVersion]).slice(0,24),
    countId:modelVersion,modelVersion,degree,sourcePath,sourceFieldPath,anchorField,
    label,price,marketAtUtc:parsed.marketAtUtc,ownerArizonaTime:parsed.ownerArizonaTime,
    sourceRevision,approvalStatus:"RESEARCH",selectionStatus,
    ownerApprovalReference:approvalReference??null,
    lifecycle:"DEVELOPING",waveCompletionConfirmed:false,plotAllowed:false,
    presentationAllowed:true,selectedForResearchDisplay:true,
    sourceTimestampConflict:false,priceBasisStatus:"PENDING",
    noExecution:true};
}
function makeModel({degree,modelVersion,sourcePath,selectionStatus,approvalReference,specs}){
  const anchors=specs.map(s=>makeNode({...s,degree,modelVersion,sourcePath,selectionStatus,approvalReference})).filter(Boolean);
  return {degree,modelVersion,sourcePath,scenarioStatus:"RESEARCH_ONLY",
    sourceSelectionStatus:selectionStatus,selectedForResearchDisplay:true,
    modelFingerprint:sha(anchors.map(n=>[n.nodeId,n.sourceRevision])),
    historicalAnchors:[],anchors};
}
// Minute and Subminute are intentionally empty. Do not turn displayed Fib or
// scenario anchors into chart nodes without a new owner-authorized source.
export function buildSelectedDegreeNodeModelsV1({degreeStates}={}){
  const models=[];
  // Higher degrees have canonical Engine22 degree-state selections. Only
  // source marks with a complete explicit timestamp pass validation.
  for(const degree of ["primary","intermediate","minor"]){
    const sel=ownerApprovedWorkingSelection.degrees?.[degree];
    const state=degreeStates?.[degree];
    if(sel?.source!=="degreeStates"||!state||state.degree!==degree||state.active!==true)continue;
    const sourcePath="degreeStates."+degree;
    const modelVersion=typeof state.version==="string"&&state.version
      ?state.version:"engine22.degreeStates."+degree+".v1";
    const specs=Object.entries(state.marks??{}).filter(([key,mark])=>
      /^(?:W[1-5]|A|B|C|D|E)$/.test(key)&&mark&&!mark.superseded)
      .flatMap(([key,mark])=>{
        // W1 carries two legitimate endpoints. Keep the existing W1 high
        // node identity stable, adding its exact low as an independent node.
        const low=key==="W1"&&mark.low&&typeof mark.low==="object"
          ?[{anchorField:"marks_W1_low",sourceFieldPath:sourcePath+".marks.W1.low",
              label:"W1 LOW",price:mark.low.price,
              time:approvedTimeForCardMark(degree,mark.low)}]:[];
        const high={anchorField:"marks_"+key,
          sourceFieldPath:sourcePath+".marks."+key,
          label:key==="W1"?"W1 HIGH":key,
          price:mark.price,
          time:approvedTimeForCardMark(degree,mark.high??mark)};
        return [...low,high];
      });
    models.push(makeModel({degree,modelVersion,sourcePath,
      selectionStatus:"CANONICAL_DEGREE_STATE",
      approvalReference:ownerApprovedWorkingSelection.approvalReference,specs}));
  }
  return models;
}
