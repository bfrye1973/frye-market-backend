// Engine 16B Milestone 1. Pure, research-only, no IO, routes, orders or mutations.
import { confirmedPivots } from "./research.js";
export const ABC_M1_SCHEMA = "engine16.abcMilestone1.v1";
export const C_RATIOS = Object.freeze([0.618, 1, 1.272, 1.618, 2, 2.618]);
const iso = (x) => typeof x === "string" && Number.isFinite(Date.parse(x));
const roundTick = (x, tick) => Number((Math.round(x / tick) * tick).toFixed(10));
const frozenCopy = (obj) => JSON.parse(JSON.stringify(obj));
const STEPS = Object.freeze(["primary","intermediate","minor","minute","subminute","micro","submicro"]);

function normalizeBars(bars, asOf) {
  if (!Array.isArray(bars) || !iso(asOf)) throw new Error("BARS_AND_ASOF_REQUIRED");
  let previousTime = -Infinity, previousKnown = -Infinity;
  return bars.filter(bar => {
    if (!bar || !iso(bar.time) || !iso(bar.closeAt) || !iso(bar.knownAt))
      throw new Error("BAR_CLOCKS_REQUIRED");
    const at = Date.parse(bar.time), closeAt = Date.parse(bar.closeAt), known = Date.parse(bar.knownAt);
    if (at <= previousTime || known < previousKnown || closeAt < at || known < closeAt)
      throw new Error("BAR_CLOCK_ORDER_INVALID");
    previousTime = at; previousKnown = known;
    for (const field of ["open","high","low","close"])
      if (!Number.isFinite(bar[field])) throw new Error("INVALID_OHLC");
    if (bar.low > bar.high || bar.open < bar.low || bar.open > bar.high ||
        bar.close < bar.low || bar.close > bar.high) throw new Error("INVALID_OHLC");
    if (bar.closed !== true && bar.closed !== false) throw new Error("BAR_CLOSED_FLAG_REQUIRED");
    return known <= Date.parse(asOf);
  });
}
// Consumes the Engine 22 current-node metadata contract; no implied as-of history.
// If its publication is newer than cutoff, drop it rather than leaking the future.
export function readOnlyEngine22Context(snapshot, asOf) {
  if (!iso(asOf)) throw new Error("ASOF_REQUIRED");
  const unavailable = {status:"UNKNOWN",sourceSchema:null,revision:null,degreeRefs:[],reason:"ENGINE22_CONTEXT_UNAVAILABLE"};
  if (!snapshot || snapshot.schema !== "engine22.chartNodeCurrent.v1" ||
      snapshot.readOnly !== true || !Array.isArray(snapshot.records))
    return unavailable;
  if (snapshot.historicalAsOfSupported !== true)
    return {...unavailable,sourceSchema:snapshot.schema,revision:snapshot.latestRevision ?? null,
      reason:"ENGINE22_HISTORICAL_ASOF_NOT_SUPPORTED"};
  const records = snapshot.records.filter(n =>
    n.approvalStatus === "OWNER_APPROVED" && STEPS.includes(n.degree) &&
    iso(n.publishedAtUtc) && Date.parse(n.publishedAtUtc) <= Date.parse(asOf));
  return {
    status:records.length ? "AVAILABLE" : "UNKNOWN",sourceSchema:snapshot.schema,
    revision:snapshot.latestRevision ?? null,
    degreeRefs:records.map(n => ({
      nodeId:n.nodeId, degree:n.degree, parentWaveId:n.parentWaveId ?? null,
      modelVersion:n.modelVersion ?? null, marketAtUtc:n.marketAtUtc ?? null,
      esPrice:n.esPrice ?? null, priceBasisId:n.priceBasisId ?? null,
      publishedAtUtc:n.publishedAtUtc, sourceRevision:n.sourceRevision ?? null,
      approvalStatus:n.approvalStatus
    })),reason:records.length ? null : "NO_ELIGIBLE_OWNER_APPROVED_NODES"
  };
}
export function projectCFromB({start,A,B,direction,priceBasis,tickSize=0.25,modelVersion="research-c-from-b-v1"}) {
  if (!start || !A || !B || ![start.price,A.price,B.price].every(Number.isFinite) ||
      typeof priceBasis !== "string" || !priceBasis || !(tickSize > 0) ||
      !["UP","DOWN"].includes(direction)) throw new Error("INVALID_C_MODEL_INPUT");
  const sign = direction === "UP" ? 1 : -1, length = Math.abs(A.price-start.price);
  if (!(length > 0) || sign*(A.price-start.price) <= 0) throw new Error("A_DIRECTION_MISMATCH");
  return {modelId:["C_FROM_B",start.id,A.id,B.id,modelVersion].join("|"),
    modelVersion,priceBasis,tickSize,direction,measuredStart:start.id,measuredEnd:A.id,
    projectionOrigin:B.id,formula:"rawPrice = B.price + directionSign * abs(A.price-start.price) * ratio",
    levels:C_RATIOS.map(ratio => ({ratio,rawPrice:B.price+sign*length*ratio,
      price:roundTick(B.price+sign*length*ratio,tickSize)}))};
}
function eligibleTrios(pivots) {
  const out=[];
  // Only consecutive, alternating, confirmed 0-A-B swings in milestone 1.
  for(let i=0;i+2<pivots.length;i++) {
    const [start,A,B]=pivots.slice(i,i+3);
    const up=start.kind==="LOW"&&A.kind==="HIGH"&&B.kind==="LOW"&&B.price>start.price&&B.price<A.price;
    const down=start.kind==="HIGH"&&A.kind==="LOW"&&B.kind==="HIGH"&&B.price<start.price&&B.price>A.price;
    if(up||down) out.push({start,A,B,direction:up?"UP":"DOWN"});
  }
  return out;
}
function endpointEvidence(bars, B, direction, tickSize, policy) {
  const after=bars.filter(x=>Date.parse(x.knownAt)>=Date.parse(B.confirmationTime) &&
      Date.parse(x.time)>Date.parse(B.time));
  if(!after.length)return {extreme:null,endpoint:null,wickObserved:false};
  const sign=direction==="UP"?1:-1;
  const choose=direction==="UP"?b=>b.high:b=>b.low;
  let extreme=after[0], price=choose(extreme);
  for(const bar of after) if(sign*(choose(bar)-price)>0){extreme=bar;price=choose(bar);}
  const range=extreme.high-extreme.low;
  const wick=direction==="UP"?extreme.high-Math.max(extreme.open,extreme.close):
    Math.min(extreme.open,extreme.close)-extreme.low;
  const sufficient=range>0 && wick/range>=policy.wickFraction && wick>=policy.minWickTicks*tickSize;
  // Wick evidence remains provisional. Closed-bar reversal is optional; never becomes an orthodox count.
  const later=after.filter(x=>Date.parse(x.knownAt)>Date.parse(extreme.knownAt) && x.closed===true);
  const reversed=later.some(x=>direction==="UP"?x.close<extreme.close:x.close>extreme.close);
  const qualifies=sufficient && (!policy.requireLaterReversal || reversed);
  return {extreme:{price,time:extreme.time,knownAt:extreme.knownAt,evidenceId:extreme.time+":C_EXTREME"},
    endpoint:qualifies?{price,time:extreme.time,knownAt:later.length?
      later[0].knownAt:extreme.knownAt,evidenceId:extreme.time+":WICK_REJECTION"}:null,
    wickObserved:sufficient};
}
export function computeAbcMilestone1({bars,asOf,symbol="ES",contract,priceBasis,
  timeframe="10m",tickSize=0.25,pivotStrength=1,engine22Snapshot=null,
  completionPolicy={wickFraction:0.55,minWickTicks:2,requireLaterReversal:true}}) {
  if(typeof priceBasis!=="string"||!priceBasis||typeof contract!=="string"||!contract)
    throw new Error("CONTRACT_AND_PRICE_BASIS_REQUIRED");
  if(!(tickSize>0)||!Number.isInteger(pivotStrength)||pivotStrength<1)
    throw new Error("INVALID_PIVOT_OPTIONS");
  const policy={wickFraction:0.55,minWickTicks:2,requireLaterReversal:true,...completionPolicy};
  if(!(policy.wickFraction>=0&&policy.wickFraction<=1)||
      !(policy.minWickTicks>=0)||typeof policy.requireLaterReversal!=="boolean")
    throw new Error("INVALID_RESEARCH_POLICY");
  const visible=normalizeBars(bars,asOf);
  const closed=visible.filter(x=>x.closed===true);
  // Do not let a forming bar masquerade as closed, or skip a forming bar followed by a closed bar.
  if(visible.some((x,i)=>x.closed===false && visible.slice(i+1).some(y=>y.closed===true)))
    throw new Error("CLOSED_AFTER_FORMING_BAR");
  const pivots=confirmedPivots(closed,{strength:pivotStrength})
    .map(p=>({...p,knownAt:closed.find(b=>b.time===p.confirmationTime)?.knownAt??null,
      observationTime:p.time,confirmationTime:p.confirmationTime}));
  const parent=readOnlyEngine22Context(engine22Snapshot,asOf);
  const candidates=[];
  for(const {start,A,B,direction} of eligibleTrios(pivots)){
    if(Date.parse(B.knownAt)>Date.parse(asOf))continue;
    const id=["ABC",symbol,contract,timeframe,priceBasis,start.id,A.id,B.id].join("|");
    const evidence=endpointEvidence(visible,B,direction,tickSize,policy);
    const fib=projectCFromB({start,A,B,direction,priceBasis,tickSize});
    const state=evidence.endpoint?"C_COMPLETION_CANDIDATE":"C_DEVELOPING";
    candidates.push({candidateId:id,scenarioType:"ABC_B_TO_C",direction,state,
      displayLabel:state==="C_COMPLETION_CANDIDATE"?"C?":"C developing",
      anchors:{start,A,B},cExtreme:evidence.extreme,cEndpointProposal:evidence.endpoint,
      fib,structuralInvalidation:{price:B.price,kind:"RESEARCH_REFERENCE_ONLY",
        ruleStatus:"UNKNOWN",reason:"MANAGER_STRUCTURAL_INVALIDATION_NOT_APPROVED"},
      orthodoxSubdivisionsVerified:false,confidence:"UNVALIDATED_SWING_CANDIDATE",
      childEvidence:"UNKNOWN",parentContextStatus:parent.status,
      createdKnownAt:B.knownAt,asOf,researchOnly:true});
    // Distinct scenario ID, never assert that the approved parent is Micro W2 unless supplied.
    candidates.push({candidateId:"W3_ALT|"+id,scenarioType:"MICRO2_TO_W3_ALTERNATIVE",
      sharesPivotId:B.id,direction,state:"W3_DEVELOPING",parentContextStatus:parent.status,
      authorizedEngine22Refs:parent.degreeRefs.filter(n=>n.degree==="micro").map(n=>n.nodeId),
      interpretationStatus:"UNRESOLVED",asOf,researchOnly:true});
  }
  return {schema:ABC_M1_SCHEMA,asOf,symbol,contract,timeframe,priceBasis,
    evidenceKnownAt:visible.at(-1)?.knownAt??null,
    pivots,engine22Context:parent,candidates,policy:{...policy,authority:"RESEARCH_ONLY_NOT_ORTHODOX"},
    researchOnly:true,noExecution:true,noPermissionCreated:true};
}
// Reconstruct an append-only event journal from chronological evidence cutoffs.
// Events record complete immutable as-of states. No timestamps are backdated to swing extrema.
export function replayAbcMilestone1(options) {
  const cutoffs=[...new Set(options.bars.map(b=>b.knownAt))].sort();
  const snapshots=[],events=[],previous=new Map();
  for(const cutoff of cutoffs) {
    const snapshot=computeAbcMilestone1({...options,asOf:cutoff});
    snapshots.push(frozenCopy(snapshot));
    for(const candidate of snapshot.candidates) {
      const prior=previous.get(candidate.candidateId);
      const material=JSON.stringify({state:candidate.state,cExtreme:candidate.cExtreme,
        endpoint:candidate.cEndpointProposal,parentContextStatus:candidate.parentContextStatus});
      if(material!==prior) {
        const reason=!prior?"CANDIDATE_DISCOVERED":
          candidate.state==="C_COMPLETION_CANDIDATE"?"POSSIBLE_COMPLETION":
          prior.includes("C_COMPLETION_CANDIDATE")?"ENDPOINT_REVISED_OR_EXTENDED":"EVIDENCE_UPDATED";
        events.push({eventId:candidate.candidateId+"|"+cutoff+"|"+events.length,
          candidateId:candidate.candidateId,knownAt:cutoff,reason,
          evidenceIds:candidate.cExtreme?[candidate.cExtreme.evidenceId]:[candidate.sharesPivotId].filter(Boolean),
          state:candidate.state,snapshot:frozenCopy(candidate)});
        previous.set(candidate.candidateId,material);
      }
    }
  }
  return {schema:"engine16.abcReplay.v1",snapshots,events,researchOnly:true,noExecution:true};
}
