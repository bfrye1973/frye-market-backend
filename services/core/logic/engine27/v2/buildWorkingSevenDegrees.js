import { buildEngine27SevenInvalidationsV1 } from "./buildSevenInvalidationsV1.js";
// Engine 27 additive seven-degree OWNER WORKING COUNT interpretation.
// Read-only. Engine 22 alone owns wave identity, level geometry, touch status and confirmations.
// These selectors are explicitly approved in Engine 22C's October 24 handoff.
export const ENGINE27_WORKING_DEGREES = Object.freeze([
  "submicro","micro","subminute","minute","minor","intermediate","primary"
]);
const string = v => typeof v === "string" && v.trim() ? v.trim() : null;
const object = v => v && typeof v === "object" && !Array.isArray(v) ? v : null;
const levels = v => Array.isArray(v) ? v.filter(l => l && typeof l.price === "number" && Number.isFinite(l.price)).map(l => ({
  key: l.key ?? null, label: l.label ?? l.key ?? "Level", price: l.price,
  status: l.status ?? "WATCH", touchedAt: l.touchedAt ?? null,
  touchEvidenceAvailable: l.touchEvidenceAvailable ?? null,
  touchEvidenceType: l.touchEvidenceType ?? null, provisional: l.provisional === true,
})) : [];
const published = (v, fallback = "NOT_PUBLISHED") => string(v) || fallback;
function sourceFor(e22, degree) {
  const cw = e22?.currentWavelength;
  const w2 = cw?.degrees?.minute?.ownerMinuteW2Hypothesis;
  switch (degree) {
    case "submicro": return {model:cw?.degrees?.submicro?.ownerSubmicroCDown, expected:"engine22.submicroCDownOwnerWatch.v1", source:"currentWavelength.degrees.submicro.ownerSubmicroCDown"};
    case "micro": return {model:cw?.degrees?.micro?.ownerMicroCDown, expected:"engine22.microCDownOwnerWatch.v1", source:"currentWavelength.degrees.micro.ownerMicroCDown"};
    case "subminute": return {model:cw?.degrees?.subminute?.ownerCurrentCDown, expected:"engine22.subminuteCurrentCDownReference.v1", source:"currentWavelength.degrees.subminute.ownerCurrentCDown"};
    case "minute": return {model:w2, expected:"engine22.minuteW2ComplexCorrectionWatch.v1", source:"currentWavelength.degrees.minute.ownerMinuteW2Hypothesis"};
    default: return {model:e22?.degreeStates?.[degree], expected:null, source:"degreeStates."+degree};
  }
}
function summarize(degree, model) {
  if (degree === "submicro") return "Submicro C DOWN developing inside Micro C. Completion unconfirmed.";
  if (degree === "micro") return "Micro C DOWN developing inside Subminute C. Completion unconfirmed.";
  if (degree === "subminute") return "Subminute C DOWN owner working reference inside Minute W2; degree placement provisional.";
  if (degree === "minute") return "Minute W2 complex correction; internal C DOWN scenario. ABC versus ABCDE unconfirmed.";
  return published(model?.headline, degree.toUpperCase()+" current structural state");
}
// Observational price direction only; never a wave invalidation, entry, or permission.
const PERIODS={submicro:["10m",600000],micro:["10m",600000],subminute:["10m",600000],minute:["10m",600000],minor:["1h",3600000],intermediate:["4h",14400000],primary:["1d",86400000]};
function timeMs(v){
 if(typeof v==="number"&&Number.isFinite(v))return v<1e11?v*1000:v;
 const t=Date.parse(v);return Number.isFinite(t)?t:null;
}
function priceDirection(snapshot,degree){
 const [timeframe,period]=PERIODS[degree]||["10m",600000];
 const posture=snapshot?.marketMeter?.layers?.emaPosture || snapshot?.emaPosture || {};
 const series=timeframe==="10m"?posture?.tenMinute?.bars:timeframe==="1h"?posture?.oneHour?.bars:timeframe==="4h"?posture?.fourHour?.bars:posture?.daily?.bars;
 const evaluated=timeMs(snapshot?.now??snapshot?.ts);
 if(!Array.isArray(series)||!Number.isFinite(evaluated))return {direction:"UNCONFIRMED",timeframe,evidence:"COMPLETED_BAR_EVIDENCE_UNAVAILABLE"};
 const closed=series.filter(b=>{
  const c=Number(b?.close??b?.c),t=timeMs(b?.time??b?.timestamp??b?.t);
  return Number.isFinite(c)&&c>0&&t!==null&&(b?.completed===true||b?.isComplete===true||t+period<=evaluated);
 }).sort((a,b)=>timeMs(a.time??a.timestamp??a.t)-timeMs(b.time??b.timestamp??b.t));
 if(closed.length<2)return {direction:"UNCONFIRMED",timeframe,evidence:"TWO_COMPLETED_CLOSES_REQUIRED"};
 const prev=closed[closed.length-2],last=closed[closed.length-1];
 const difference=Number(last.close??last.c)-Number(prev.close??prev.c);
 return {direction:difference>0?"UP":difference<0?"DOWN":"NEUTRAL",timeframe,
  evidence:"TWO_COMPLETED_CANDLE_CLOSES",previousClose:Number(prev.close??prev.c),
  latestClose:Number(last.close??last.c),latestBarTime:timeMs(last.time??last.timestamp??last.t)};
}
function directionAssessment(snapshot,degree,waveDirection,readiness){
 const observed=priceDirection(snapshot,degree);
 const expected=waveDirection==="UP"||waveDirection==="DOWN"?waveDirection:null;
 const status=!expected||observed.direction==="UNCONFIRMED"||observed.direction==="NEUTRAL"?"UNCONFIRMED":expected===observed.direction?"ALIGNED":"CONFLICT";
 const zone=readiness?.candidateZone??null;
 const single=Number(readiness?.proposedReview?.candidateReference);
 const boundary=zone&&Number.isFinite(zone.low)&&Number.isFinite(zone.high)?zone:(!zone&&Number.isFinite(single)&&single>0?{low:single,high:single}:null);
 const current=Number(snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.currentWavelength?.currentPrice);
 const zoneState=(!boundary||!Number.isFinite(current)||current<=0)?"UNAVAILABLE":current>=boundary.low&&current<=boundary.high?"AT_REVIEW_REFERENCE":"REFERENCE_ONLY";
 return {schema:"engine27.degreeDirectionalAssessment.v1",status,expectedWaveDirection:expected??"UNCONFIRMED",
  observedPriceDirection:observed.direction,timeframe:observed.timeframe,evidence:observed.evidence,
  previousClose:observed.previousClose??null,latestClose:observed.latestClose??null,
  latestBarTime:observed.latestBarTime??null,reviewZone:boundary,reviewZoneState:zoneState,
  invalidationStatus:readiness?.status??"NOT_PUBLISHED",officialInvalidationPrice:null,
  note:"Directional observation only. Conflict is not structural invalidation.",
  noExecution:true,noPermissionCreated:true};
}
export function buildEngine27WorkingSevenDegrees({snapshot} = {}) {
  const e22 = snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy;
  const invalidations = buildEngine27SevenInvalidationsV1({snapshot});
  const degrees = {};
  for (const degree of ENGINE27_WORKING_DEGREES) {
    const {model,expected,source} = sourceFor(e22,degree);
    const valid = Boolean(object(model) && (!expected || model.version === expected));
    if (!valid) {
      degrees[degree] = {degree,label:degree.toUpperCase(),available:false,
        activeWave:"NOT_PUBLISHED",waveDirection:"NOT_PUBLISHED",
        currentCondition:"NOT_PUBLISHED",
        confirmationNeeded:{status:"NOT_PUBLISHED",evidence:[]},
        potentialCompletion:{levels:[],nextLevel:null,summary:"Current Engine 22 owner model not published."},
        parentContext:{parentDegree:null,parentWave:null,displayText:null},
        invalidation:{price:null,status:"OWNER_MODEL_UNAVAILABLE",rule:null,source:null},traderRead:{headline:"Current working model unavailable",summary:"No fallback to superseded wave counts.",rules:[]},
        provenance:{workingSource:source,workingModelVersion:expected,confirmationStatus:"NOT_PUBLISHED",countId:null},
        noExecution:true};
      continue;
    }
    const minuteC = degree === "minute" ? e22?.currentWavelength?.degrees?.minute?.ownerLargerCDownScenario : null;
    const currentLevels = degree === "subminute" ? levels(minuteC?.levels) : levels(minuteC?.levels ?? model.levels ?? model.activeFibModel?.displayLevels);
    const leg = degree === "minute" ? (minuteC?.version === "engine22.largerCorrectionCDownWatch.v1" ? "C" : null) : null;
    const direction = degree === "minute" ? (leg === "C" ? "DOWN" : "NOT_PUBLISHED") : published(model.direction ?? model.sequenceDirection);
    const wave = published(model.activeWave ?? model.currentWave);
    const confirmation = degree === "subminute" ? published(model.confirmationStatus,"PENDING") : published(model.confirmationStatus ?? model.stage,"NOT_PUBLISHED");
    const parentDegree = degree === "submicro" ? "micro" : degree === "micro" ? "subminute" : degree === "subminute" ? "minute" : degree === "minute" ? "minor" : model.parentDegree ?? null;
    const parentWave = degree === "submicro" ? "C" : degree === "micro" ? "C" : degree === "subminute" ? "W2" : degree === "minute" ? null : model.parentWave ?? null;
    const story = summarize(degree,model);
    degrees[degree] = {degree,label:degree.toUpperCase(),available:true,
      activeWave:degree === "minute" ? "W2 / C DOWN" : wave,
      waveDirection:direction,
      currentCondition:degree === "subminute" ? published(model.stage,"DEVELOPING_CANDIDATE") : degree === "minute" ? published(minuteC?.status, "DEVELOPING_CANDIDATE") : published(model.stage ?? model.lifecycle),
      confirmationNeeded:{status:confirmation,evidence:[],rule:null,note:"Owner working interpretation is not confirmed solely by owner pivot approval."},
      potentialCompletion:{levels:currentLevels,nextLevel:null,summary:currentLevels.length?"Engine 22 owner-model projection; not completion confirmation.":"Current applicable Fibonacci ladder not published."},
      invalidation:{price:invalidations.degrees[degree]?.price ?? null,
        rule:invalidations.degrees[degree]?.rule ?? null,
        status:invalidations.degrees[degree]?.status ?? "NOT_PUBLISHED",
        breached:invalidations.degrees[degree]?.breached ?? null,
        source:invalidations.degrees[degree]?.provenance ?? null,
        displayText:invalidations.degrees[degree]?.rule ?? "Not published"},
      parentContext:{parentDegree,parentWave,displayText:degree === "minute"?"Internal C DOWN candidate inside Minute W2":degree === "micro"?"Micro C DOWN inside Subminute C DOWN":null},
      traderRead:{headline:story,summary:story,rules:[]},
      provenance:{workingSource:source,workingModelVersion:model.version ?? null,confirmationStatus:confirmation,countId:model.sourceCountId ?? null,workingCount:true,confirmed:false},
      internalLeg:leg,largerCorrection:degree === "minute"?"W2":null,
      noPermissionCreated:true,noSizingCreated:true,noExecution:true,noJournalWrite:true};
  }
  const structuralReadiness=e22?.sevenDegreeInvalidations?.degrees || {};
  for(const degree of ENGINE27_WORKING_DEGREES){
    degrees[degree].directionAssessment=directionAssessment(snapshot,degree,degrees[degree].waveDirection,
      structuralReadiness?.[degree]?.invalidationReadiness);
  }
  const available = ENGINE27_WORKING_DEGREES.filter(d => degrees[d]?.available);
  const up = available.filter(d => degrees[d]?.waveDirection === "UP");
  const down = available.filter(d => degrees[d]?.waveDirection === "DOWN");
  const corrective = available.filter(d => degrees[d]?.largerCorrection);
  const mixed = up.length > 0 && down.length > 0;
  const alignmentState = available.length !== 7 ? "PARTIAL_EVIDENCE" : mixed ? "MIXED_INTERNAL_CORRECTION" : down.length ? "BEARISH_WORKING_ALIGNMENT" : up.length ? "BULLISH_WORKING_ALIGNMENT" : "UNRESOLVED";
  const warnings = [
    ...(mixed ? ["LOWER_AND_HIGHER_DEGREE_DIRECTIONS_DIFFER"] : []),
    ...(corrective.length ? ["MINUTE_CORRECTION_UNCONFIRMED"] : []),
    ...(degrees.subminute?.potentialCompletion?.levels?.length ? [] : ["SUBMINUTE_ACTIVE_ABC_FIB_NOT_PUBLISHED"]),
    ...(available.length !== 7 ? ["STRUCTURAL_DEGREES_UNAVAILABLE"] : []),
  ];
  const story = [
    `Minute: ${degrees.minute?.traderRead?.summary ?? "not published"}`,
    `Subminute: ${degrees.subminute?.traderRead?.summary ?? "not published"}`,
    `Micro: ${degrees.micro?.traderRead?.summary ?? "not published"}`,
    `Submicro: ${degrees.submicro?.traderRead?.summary ?? "not published"}`,
  ].join(" ");
  return {engine:"engine27.workingSevenDegrees.v1",mode:"READ_ONLY",active:Boolean(e22),
    workingAlignment:{alignmentState,confidence:"NOT_CALIBRATED",upDegrees:up,downDegrees:down,unavailableDegrees:ENGINE27_WORKING_DEGREES.filter(d => !degrees[d]?.available),warnings,marketStory:story},
    degreeOrder:[...ENGINE27_WORKING_DEGREES],degrees,
    strategyCardCount:7,brokerMappingChanged:false,
    noPermissionCreated:true,noSizingCreated:true,noExecution:true,noJournalWrite:true};
}
