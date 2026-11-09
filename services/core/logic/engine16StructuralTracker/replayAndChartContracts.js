// Engine16B Package 2/3/4: research-only adapters. No HTTP, persistence, chart mutation or trade APIs.
import {computeAbcMilestone1,replayAbcMilestone1} from "./abcMilestone1.js";
export const INSPECTOR_TFS=Object.freeze(["1m","5m","10m","20m","30m","1h"]);
const duration=Object.freeze({"1m":60000,"5m":300000,"10m":600000,"20m":1200000,"30m":1800000,"1h":3600000});
const iso=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const canonical=x=>new Date(x).toISOString();
const finite=x=>typeof x==="number"&&Number.isFinite(x);

// Converts the actual /api/v1/futures/ohlc chart bar shape {time:UNIX_SECONDS,open,high,low,close,volume}
// into Engine16's explicit event clock. The route does not supply authentic historic bar knownAt.
// Caller must choose either per-bar attested knownAt or an explicitly SIMULATED_CLOSE replay clock.
export function adaptEngine11OhlcForResearch({bars,timeframe,contract,priceBasis,mode,
  attestedKnownAt=null,sourceFingerprint=null}={}) {
  if(!INSPECTOR_TFS.includes(timeframe)||!Array.isArray(bars)||
      !contract||!priceBasis||!["ATTESTED_CLOCKS","SIMULATED_CLOSE_CLOCKS"].includes(mode))
    throw Error("ENGINE11_REPLAY_CONTRACT_REQUIRED");
  if(mode==="ATTESTED_CLOCKS" && (!Array.isArray(attestedKnownAt)||attestedKnownAt.length!==bars.length))
    throw Error("ATTESTED_CLOCKS_MISSING");
  if(mode==="SIMULATED_CLOSE_CLOCKS"&&attestedKnownAt!==null)
    throw Error("SIMULATED_AND_ATTESTED_CLOCKS_MIXED");
  const d=duration[timeframe];let last=-Infinity;
  const normalized=bars.map((bar,i)=>{
    if(!Number.isSafeInteger(bar?.time)||bar.time<=0||bar.time*1000<=last||
      !["open","high","low","close"].every(k=>finite(bar[k])) ||
      bar.low>bar.high || Math.min(bar.open,bar.close)<bar.low ||
      Math.max(bar.open,bar.close)>bar.high)throw Error("ENGINE11_BAR_INVALID");
    const timestamp=bar.time*1000;last=timestamp;
    const close=timestamp+d;
    const known=mode==="SIMULATED_CLOSE_CLOCKS" ? close : Date.parse(attestedKnownAt[i]);
    if(!Number.isFinite(known)||known<close)throw Error("ENGINE11_KNOWNAT_INVALID");
    return {time:canonical(timestamp),closeAt:canonical(close),knownAt:canonical(known),
      open:bar.open,high:bar.high,low:bar.low,close:bar.close,closed:true};
  });
  return {schema:"engine16.engine11ReplayInput.v1",symbol:"ES",contract,timeframe,priceBasis,
    source:"/api/v1/futures/ohlc",sourceTimeUnit:"UNIX_SECONDS",
    sourceFingerprint:sourceFingerprint??null,mode,
    evidenceClockAuthority:mode==="ATTESTED_CLOCKS"?"CALLER_ATTESTED":"SIMULATED_NOT_HISTORICALLY_OBSERVED",
    noHistoricalAvailabilityClaim:mode!=="ATTESTED_CLOCKS",bars:normalized,
    researchOnly:true,noExecution:true};
}
export function replayEngine11Research({input,pivotStrength=1,completionPolicy,maxCandidateAgeBars}={}) {
  if(input?.schema!=="engine16.engine11ReplayInput.v1"||!Array.isArray(input.bars))
    throw Error("ENGINE11_REPLAY_INPUT_REQUIRED");
  if(input.bars.length===0)throw Error("ENGINE11_REPLAY_EMPTY");
  const replay=replayAbcMilestone1({bars:input.bars,symbol:input.symbol,
    contract:input.contract,timeframe:input.timeframe,priceBasis:input.priceBasis,
    pivotStrength,completionPolicy,maxCandidateAgeBars});
  return {...replay,inputSource:input.source,sourceFingerprint:input.sourceFingerprint,
    evidenceClockAuthority:input.evidenceClockAuthority,
    historicallyVerified:input.evidenceClockAuthority==="CALLER_ATTESTED" &&
      Boolean(input.sourceFingerprint),
    replayMode:input.mode};
}
// Read-only Engine22 journal view of observed selected degree models.
// This is NOT an owner-approved permanent node graph; do not claim historical-as-of support.
export function inspectEngine22HistoryObservation(event,{asOf}={}) {
  const unknown=(reason)=>({schema:"engine16.engine22Context.v1",status:"UNKNOWN",reason,
    asOf,degreeEvidence:[],ownerApprovedNodeRefs:[],readOnly:true,noExecution:true});
  if(!iso(asOf)||event?.schema!=="engine22.waveHistoryEvent.v1" ||
      event.content?.schema!=="engine22.waveHistoryObservation.v1")return unknown("INVALID_OR_MISSING_OBSERVATION");
  if(!iso(event.observedAt)||Date.parse(event.observedAt)>Date.parse(asOf))
    return unknown("ENGINE22_OBSERVATION_NOT_YET_KNOWN");
  // The actual journal declares historicalAsOfSupported:false; cannot reconstruct
  // old market states merely because a journal event happens to have an old timestamp.
  if(event.content.historicalAsOfSupported!==true)
    return unknown("ENGINE22_HISTORICAL_ASOF_NOT_SUPPORTED");
  return unknown("ENGINE22_APPROVED_NODE_ASOF_GRAPH_NOT_YET_AUTHORIZED");
}
// Backend-only overlay projection for later Engine2 integration. Visibility is controlled by Engine2;
// NEVER asserts authorization to plot or modifies existing Engine22 node data.
export function buildEngine16ChartResearchPack(snapshot,{maxCandidates=100}={}) {
  if(snapshot?.schema!=="engine16.abcMilestone1.v1" ||
      !Number.isSafeInteger(maxCandidates)||maxCandidates<1||maxCandidates>1000)
    throw Error("ENGINE16_CHART_SNAPSHOT_INVALID");
  const rows=snapshot.candidates.slice(0,maxCandidates).map(c=>({
    candidateId:c.candidateId,scenarioType:c.scenarioType,status:c.state,
    direction:c.direction,displayLabel:c.displayLabel??null,
    anchorRefs:c.anchors?{start:c.anchors.start.id,A:c.anchors.A.id,B:c.anchors.B.id}:null,
    anchors:c.anchors?Object.fromEntries(Object.entries(c.anchors).map(([key,a])=>
      [key,{observationTime:a.time,price:a.price,knownAt:a.knownAt??null,kind:a.kind}])):null,
    cExtreme:c.cExtreme??null,cCompletion:c.cEndpointProposal??null,
    fibTargets:c.fib?.levels.map(l=>({modelId:c.fib.modelId,ratio:l.ratio,
      rawPrice:l.rawPrice,displayPrice:l.price,priceBasis:c.fib.priceBasis,
      projectionOrigin:c.fib.projectionOrigin}))??[],
    invalidation:c.structuralInvalidation??null,parentContextStatus:c.parentContextStatus,
    sharedPivotId:c.sharesPivotId??null,authorizedEngine22Refs:c.authorizedEngine22Refs??[],
    researchOnly:true,plotAuthorized:false
  }));
  return {schema:"engine16.chartResearchPack.v1",symbol:snapshot.symbol,contract:snapshot.contract,
    timeframe:snapshot.timeframe,priceBasis:snapshot.priceBasis,asOf:snapshot.asOf,
    evidenceKnownAt:snapshot.evidenceKnownAt,rows,
    truncated:snapshot.candidates.length>rows.length,
    allowedInspectorTimeframes:INSPECTOR_TFS,engine22Authority:"READ_ONLY",
    noElliottOrthodoxCountApproval:true,plotAuthorized:false,
    readOnly:true,researchOnly:true,noExecution:true};
}
export function buildEngine16ChartHistoryPack(replay,{index}={}) {
  if(replay?.schema!=="engine16.abcReplay.v1" ||
      !Array.isArray(replay.snapshots)||!Number.isSafeInteger(index)||
      index<0||index>=replay.snapshots.length)throw Error("ENGINE16_CHART_HISTORY_INVALID");
  const snapshot=replay.snapshots[index];
  const pack=buildEngine16ChartResearchPack(snapshot);
  return {...pack,historicalSnapshotIndex:index,
    eventRefs:replay.events.filter(e=>Date.parse(e.knownAt)<=Date.parse(snapshot.asOf))
      .map(e=>({eventId:e.eventId,candidateId:e.candidateId,knownAt:e.knownAt,
        reason:e.reason,state:e.state})),historicalView:true};
}

// Current Engine22 node snapshot is usable ONLY from its independently captured time forward.
// Not a substitute for Engine22's unavailable historical-as-of count service.
export function inspectEngine22CurrentNodes(snapshot,{capturedAt,asOf,contract,priceBasis}={}) {
  const unknown=reason=>({schema:"engine16.engine22CurrentRefs.v1",status:"UNKNOWN",
    reason,capturedAt:capturedAt??null,asOf:asOf??null,degreeRefs:[],
    readOnly:true,noExecution:true});
  if(snapshot?.schema!=="engine22.chartNodeCurrent.v1"||snapshot.readOnly!==true||
    !Array.isArray(snapshot.records)||!iso(capturedAt)||!iso(asOf)||
    !contract||!priceBasis)return unknown("SOURCE_CONTRACT_OR_CAPTURE_MISSING");
  if(Date.parse(capturedAt)>Date.parse(asOf))return unknown("SOURCE_CAPTURE_AFTER_ASOF");
  const records=snapshot.records.filter(n=>
    n.approvalStatus==="OWNER_APPROVED" && n.lifecycle!=="SUPERSEDED" &&
    n.lifecycle!=="RETIRED" && n.contractSymbol===contract && n.priceBasisId===priceBasis &&
    iso(n.publishedAtUtc) && Date.parse(n.publishedAtUtc)<=Date.parse(capturedAt) &&
    ["primary","intermediate","minor","minute","subminute","micro","submicro"].includes(n.degree) &&
    typeof n.nodeId==="string" && n.nodeId.length>0 &&
    Number.isFinite(n.esPrice) && iso(n.marketAtUtc));
  return {schema:"engine16.engine22CurrentRefs.v1",
    status:records.length?"CURRENT_CONTEXT_ONLY":"UNKNOWN",
    reason:records.length?null:"NO_CAPTURED_APPROVED_MATCHING_NODES",
    capturedAt,asOf,sourceSchema:snapshot.schema,sourceRevision:snapshot.latestRevision??null,
    historicalAsOfSupported:false,degreeRefs:records.map(n=>({
      nodeId:n.nodeId,degree:n.degree,parentWaveId:n.parentWaveId??null,
      waveId:n.waveId??null,price:n.esPrice,marketAtUtc:n.marketAtUtc,
      publishedAtUtc:n.publishedAtUtc,priceBasisId:n.priceBasisId,
      contractSymbol:n.contractSymbol,sourceRevision:n.sourceRevision??null,
      modelVersion:n.modelVersion??null,approvalStatus:n.approvalStatus
    })),readOnly:true,noExecution:true};
}
