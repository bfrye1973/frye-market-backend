// Engine22 read-only Strategy-card -> Engine2 anchor snapshot bridge.
// Sole source: Engine22's published currentWavelength models. NO wave calculations,
// no account/trading authority and no invented historic point-in-time approvals.
// An append-only revision journal is a separate release gate (backend PR #266).
import {createHash} from "node:crypto";
import {buildSelectedDegreeNodeModelsV1} from "./buildSelectedDegreeNodeModelsV1.js";
export const SCHEMA="engine22.workingWaveNodes.v1";
export const DEGREE_ORDER=Object.freeze([
  "primary","intermediate","minor","minute","subminute","micro","submicro",
]);
const sha=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const tick=x=>typeof x==="number"&&Number.isFinite(x)&&x>0&&
  Math.abs(x*4-Math.round(x*4))<1e-8;
const utc=s=>typeof s==="string"&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s)&&
  Number.isFinite(Date.parse(s));
export function arizonaMarketTimeUtc(raw){
  if(typeof raw!=="string")return null;
  const m=/^(\d{4}-\d{2}-\d{2}) ([01]\d|2[0-3]):([0-5]\d) AZ$/.exec(raw);
  if(!m)return null;
  const d=new Date(m[1]+"T"+m[2]+":"+m[3]+":00-07:00");
  return Number.isFinite(d.getTime())?d.toISOString():null;
}
// Explicit Engine22 strategy model selections; no inference from nested objects.
// Old count identities remain present as research *alternatives*, not auto-promoted.
export const REVIEW_SOURCES=Object.freeze([
  Object.freeze({degree:"micro",key:"ownerMicroW3Nov9ReclassifiedResearch",display:true}),
  Object.freeze({degree:"micro",key:"ownerMicroW2Nov6Research",display:false}),
  Object.freeze({degree:"submicro",key:"ownerSubmicroW3Nov9InternalResearch",display:true}),
  Object.freeze({degree:"submicro",key:"ownerSubmicroW3Nov9Research",display:false}),
]);
// These are observation labels, not a statement that a wave ended.
const FIELD_LABELS=Object.freeze([
  ["w1Low","W1 Low"],["w1High","W1 High"],["w2Low","W2 research anchor"],
  ["w3High","W3 ending high"],["w4Low","W4 ending low"],["aHigh","A starting high"],["aLow","A ending low"],["bHigh","B ending high"],["cLow","C ending low / W1 start"],
]);
function fromModel(root,rule){
  const model=root?.degrees?.[rule.degree]?.[rule.key];
  if(!model||model.selectionStatus!=="RESEARCH_ONLY"||
     model.degree!==rule.degree||typeof model.version!=="string"||
     !model.version||!model.anchors||typeof model.anchors!=="object")return null;
  const anchors=FIELD_LABELS.flatMap(([key,label])=>{
    const price=model.anchors[key];
    if(price==null)return [];
    // A bad price must not be rounded to make it look like an ES tick.
    if(!tick(price))return [];
    const local=arizonaMarketTimeUtc(model.anchors[key+"LocalTime"]);
    const given=model.anchors[key+"AtUtc"];
    // A disagreement between supplied local and UTC times is a hard block.
    const conflict=given!=null&&(!utc(given)||
      (local!==null&&Date.parse(local)!==Date.parse(given)));
    const marketAtUtc=conflict?null:(utc(given)?new Date(given).toISOString():local);
    const sourcePath="currentWavelength.degrees."+rule.degree+"."+rule.key;
    const nodeId="node-"+sha([rule.degree,model.version,key]).slice(0,24);
    const sourceRevision=sha([price,marketAtUtc,model.anchors[key+"LocalTime"]??null,given??null]);
    return [{
      nodeId,waveId:"wave-"+sha([rule.degree,model.version]).slice(0,24),
      countId:model.version,modelVersion:model.version,degree:rule.degree,
      sourcePath,anchorField:key,label,price,marketAtUtc,
      ownerArizonaTime:model.anchors[key+"LocalTime"]??null,
      sourceRevision,approvalStatus:"RESEARCH",lifecycle:"DEVELOPING",
      waveCompletionConfirmed:false,
      plotAllowed:false, // Official/point-in-time approval remains with Engine22.
      presentationAllowed:rule.display&&Boolean(marketAtUtc),
      sourceTimestampConflict:conflict,priceBasisStatus:model.priceBasisReconciliation??"UNVERIFIED",
      selectedForResearchDisplay:rule.display,
      noExecution:true,
    }];
  });
  // Preserve explicitly owner-corrected earlier source coordinates without
  // exposing them as CURRENT Strategies/Engine2 chart nodes.
  const prior=model.anchors.priorAnchorRevision;
  const historicalAnchors=[];
  if(prior&&prior.status==="SUPERSEDED_BY_OWNER_20261109_CORRECTION"&&
     tick(prior.w2Low)){
    const priorLocal=arizonaMarketTimeUtc(prior.w2LowLocalTime);
    const priorUtc=prior.w2LowAtUtc;
    const conflict=priorUtc!=null&&(!utc(priorUtc)||
      (priorLocal!==null&&Date.parse(priorLocal)!==Date.parse(priorUtc)));
    const marketAtUtc=conflict?null:(utc(priorUtc)?new Date(priorUtc).toISOString():priorLocal);
    historicalAnchors.push({
      nodeId:"node-"+sha([rule.degree,model.version,"w2Low","prior-owner-correction"]).slice(0,24),
      waveId:"wave-"+sha([rule.degree,model.version]).slice(0,24),
      countId:model.version,modelVersion:model.version,degree:rule.degree,
      sourcePath:"currentWavelength.degrees."+rule.degree+"."+rule.key,
      anchorField:"priorAnchorRevision.w2Low",
      label:"W2 superseded source anchor",price:prior.w2Low,marketAtUtc,
      ownerArizonaTime:prior.w2LowLocalTime??null,
      sourceRevision:sha([prior.w2Low,marketAtUtc,prior.w2LowLocalTime??null,priorUtc??null]),
      approvalStatus:"SUPERSEDED",lifecycle:"SUPERSEDED",
      waveCompletionConfirmed:false,plotAllowed:false,presentationAllowed:false,
      selectedForResearchDisplay:false,sourceTimestampConflict:conflict,
      priceBasisStatus:model.priceBasisReconciliation??"UNVERIFIED",
      noExecution:true,
    });
  }
  return {
    degree:rule.degree,modelVersion:model.version,sourcePath:
      "currentWavelength.degrees."+rule.degree+"."+rule.key,
    scenarioStatus:"RESEARCH_ONLY",selectedForResearchDisplay:rule.display,
    modelFingerprint:sha([...historicalAnchors,...anchors].map(n=>[n.nodeId,n.sourceRevision])),
    historicalAnchors,anchors,
  };
}
export function buildEngine22WorkingWaveNodesV1({currentWavelength,degreeStates,symbol="ES"}={}){
  if(symbol!=="ES"||currentWavelength?.symbol!=="ES")
    return {schema:SCHEMA,available:false,reason:"ES_ONLY",readOnly:true,
      historicalAsOfSupported:false,noExecution:true};
  const models=[...REVIEW_SOURCES.map(r=>fromModel(currentWavelength,r)).filter(Boolean),
    ...buildSelectedDegreeNodeModelsV1({currentWavelength,degreeStates})];
  const degrees=Object.fromEntries(DEGREE_ORDER.map(degree=>{
    const selected=models.filter(m=>m.degree===degree&&m.selectedForResearchDisplay);
    const nodes=selected.flatMap(m=>m.anchors);
    const sourceMarks=degreeStates?.[degree]?.marks??{};
    const dateOnlyMarkCount=["primary","intermediate","minor"].includes(degree)
      ?Object.values(sourceMarks).filter(mark=>mark&&typeof mark==="object"&&
          typeof mark.time==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(mark.time)&&
          typeof mark.price==="number").length:0;
    const coverageStatus=nodes.length
      ?"VALIDATED_RESEARCH_NODES"
      :dateOnlyMarkCount?"EXACT_EVENT_TIME_MISSING"
      :["minute","subminute"].includes(degree)?"NO_CURRENT_CHART_NODES_BY_OWNER":"NO_VALIDATED_CURRENT_NODES";
    return [degree,{
      degree,
      available:nodes.length>0,
      models:models.filter(m=>m.degree===degree),
      nodes,nodeCount:nodes.length,dateOnlyMarkCount,coverageStatus,
    }];
  }));
  const fingerprint=sha(models.map(m=>[m.sourcePath,m.modelFingerprint]));
  return {schema:SCHEMA,authority:"ENGINE22",available:true,symbol:"ES",
    readOnly:true,historyRevision:null,historyAvailable:false,
    // Current selection may be unchanged while research anchors are corrected.
    // Use immutable content hash, not a timestamp or constant selectionRevision.
    fingerprint,degreeOrder:DEGREE_ORDER,degrees,
    historicalAsOfSupported:false,ownerCountPromotion:false,
    noExecution:true,noPermissionCreated:true,noWaveTransition:true};
}
