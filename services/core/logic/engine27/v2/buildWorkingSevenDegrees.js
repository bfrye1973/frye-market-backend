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
    case "submicro": return {model:cw?.degrees?.submicro?.ownerSubmicroADown, expected:"engine22.submicroADownOwnerWatch.v1", source:"currentWavelength.degrees.submicro.ownerSubmicroADown"};
    case "micro": return {model:cw?.degrees?.micro?.ownerMicroBDown, expected:"engine22.microBDownOwnerWatch.v1", source:"currentWavelength.degrees.micro.ownerMicroBDown"};
    case "subminute": return {model:w2?.childDegreeContext?.subminute, expected:null, source:"currentWavelength.degrees.minute.ownerMinuteW2Hypothesis.childDegreeContext.subminute"};
    case "minute": return {model:w2, expected:"engine22.minuteW2ComplexCorrectionWatch.v1", source:"currentWavelength.degrees.minute.ownerMinuteW2Hypothesis"};
    default: return {model:e22?.degreeStates?.[degree], expected:null, source:"degreeStates."+degree};
  }
}
function summarize(degree, model) {
  if (degree === "submicro") return "Submicro A DOWN developing inside Micro B. Owner working count; structurally unconfirmed.";
  if (degree === "micro") return "Micro B DOWN developing after A. Owner working count; structurally unconfirmed.";
  if (degree === "subminute") return "Subminute ABC UP working inside Minute D. Recount pending; independent ABC Fibonacci model not published.";
  if (degree === "minute") return "Minute W2 complex correction; internal D UP developing. Triangle hypothesis unconfirmed.";
  return published(model?.headline, degree.toUpperCase()+" current structural state");
}
export function buildEngine27WorkingSevenDegrees({snapshot} = {}) {
  const e22 = snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy;
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
        invalidation:{price:null},traderRead:{headline:"Current working model unavailable",summary:"No fallback to superseded wave counts.",rules:[]},
        provenance:{workingSource:source,workingModelVersion:expected,confirmationStatus:"NOT_PUBLISHED",countId:null},
        noExecution:true};
      continue;
    }
    const minuteD = degree === "minute" ? model.internalDProjection : null;
    const currentLevels = degree === "subminute" ? [] : levels(minuteD?.levels ?? model.levels ?? model.activeFibModel?.displayLevels);
    const leg = degree === "minute" ? published(model.activeInternalLeg,"D") : null;
    const direction = degree === "minute" ? published(model.activeInternalLegDirection) : published(model.direction ?? model.sequenceDirection);
    const wave = degree === "subminute" ? "ABC" : published(model.activeWave ?? model.currentWave);
    const confirmation = degree === "subminute" ? published(model.waveRecount,"PENDING") : published(model.confirmationStatus ?? model.stage,"NOT_PUBLISHED");
    const parentDegree = degree === "submicro" ? "micro" : degree === "micro" ? null : degree === "subminute" ? "minute" : degree === "minute" ? "minor" : model.parentDegree ?? null;
    const parentWave = degree === "submicro" ? "B" : degree === "micro" ? null : degree === "subminute" ? "D" : degree === "minute" ? null : model.parentWave ?? null;
    const story = summarize(degree,model);
    degrees[degree] = {degree,label:degree.toUpperCase(),available:true,
      activeWave:degree === "minute" ? "W2 / D UP" : wave,
      waveDirection:direction,
      currentCondition:degree === "subminute" ? published(model.currentWorkingStructure,"ABC_UP_INSIDE_MINUTE_D") : degree === "minute" ? published(model.activeInternalLegStage, "DEVELOPING_CANDIDATE") : published(model.stage ?? model.lifecycle),
      confirmationNeeded:{status:confirmation,evidence:[],rule:null,note:"Owner working interpretation is not confirmed solely by owner pivot approval."},
      potentialCompletion:{levels:currentLevels,nextLevel:null,summary:currentLevels.length?"Engine 22 owner-model projection; not completion confirmation.":"Current applicable Fibonacci ladder not published."},
      invalidation:{price:null,displayText:null},
      parentContext:{parentDegree,parentWave,displayText:degree === "minute"?"Internal D UP inside Minute W2":degree === "micro"?"Micro B within Subminute/Minute correction; direct parent count identity unresolved":null},
      traderRead:{headline:story,summary:story,rules:[]},
      provenance:{workingSource:source,workingModelVersion:model.version ?? null,confirmationStatus:confirmation,countId:model.sourceCountId ?? null,workingCount:true,confirmed:false},
      internalLeg:leg,largerCorrection:degree === "minute"?"W2":null,
      noPermissionCreated:true,noSizingCreated:true,noExecution:true,noJournalWrite:true};
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
