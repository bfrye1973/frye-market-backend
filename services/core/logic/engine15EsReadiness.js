// services/core/logic/engine15EsReadiness.js
//
// Engine 15ES — ES Futures Readiness Referee
//
// v1.7
// - ES-only readiness shell
// - Does NOT place orders
// - Does NOT replace Engine 16ES
// - Does NOT hard-code Elliott wave scenarios
//
// Authority model:
// - Engine 22 = Elliott Wave lifecycle / currentLifecycleState source
// - Engine 3 = raw reaction facts
// - Engine 4 = raw volume / participation facts
// - Engine 5 = normalized confluence + reaction / volume / timing verdicts
// - Engine 15ES = final ES setup readiness translator / referee
// - Engine 6 = final permission gate
//
// Main upgrade in v1.8:
// - Engine 15ES now consumes Engine 22 canonical currentLifecycleState generically.
// - Engine 22 owns the complete downstream-safe currentLifecycleState contract.
// - Engine 15ES no longer needs one custom branch for every new Engine 22 lifecycle key.
// - If Engine 22 says readOnly / noExecution / tradeableOpportunityBlocked / WATCH,
//   Engine 15ES translates it into a safe WATCH-only state.
// - Engine 15ES still owns confirmation awareness:
//   Engine 3 reaction, Engine 4 participation, Engine 5 timing/quality, Engine 6 permission.
// - Engine 15ES does NOT execute.
// - Engine 15ES does NOT create automatic LONG or SHORT permission.
// - Engine 15ES does NOT bypass Engine 6.
//
// Main purpose:
// Engine 15ES answers:
// Is ES ready, watch-only, blocked, or waiting — and what exactly does the trader need next?

const ENGINE = "engine15.esReadiness.v1.8";
const DEFAULT_STRATEGY_ID = "intraday_scalp@10m";
const ES_TICK_SIZE = 0.25;

function safeUpper(x, fallback = "") {
  const s = String(x ?? fallback).trim().toUpperCase();
  return s || fallback;
}

function toNum(x, fallback = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function unique(xs = []) {
  return [...new Set((Array.isArray(xs) ? xs : []).filter(Boolean))];
}

function getState(layer) {
  return safeUpper(layer?.state, "UNKNOWN");
}

function getTrendState(layer) {
  return safeUpper(layer?.trendState, "UNKNOWN");
}

function includesAny(value, tokens = []) {
  const text = safeUpper(value, "");
  return tokens.some((token) => text.includes(safeUpper(token, "")));
}

function layerAboveEma10(layer) {
  if (!layer || typeof layer !== "object") return false;
  if (layer.aboveEma10 === true) return true;
  return getState(layer).includes("ABOVE_EMA10");
}

function layerBelowEma10(layer) {
  if (!layer || typeof layer !== "object") return false;
  if (layer.aboveEma10 === false) return true;
  return getState(layer).includes("BELOW_EMA10");
}

function layerAboveEma20(layer) {
  if (!layer || typeof layer !== "object") return false;
  if (layer.aboveEma20 === true) return true;
  return getState(layer).includes("ABOVE_EMA20");
}

function layerBelowEma20(layer) {
  if (!layer || typeof layer !== "object") return false;
  if (layer.aboveEma20 === false) return true;
  return getState(layer).includes("BELOW_EMA20");
}

function permissionText(permission) {
  return safeUpper(
    permission?.permission ??
      permission?.state ??
      permission?.verdict,
    "UNKNOWN"
  );
}

function permissionBlocked(permission) {
  const p = permissionText(permission);

  return (
    p === "STAND_DOWN" ||
    p === "BLOCKED" ||
    permission?.allowed === false ||
    permission?.canTrade === false ||
    permission?.tradeAllowed === false
  );
}

function permissionGatePassed(permission) {
  const p = permissionText(permission);
  return p === "ALLOW" || p === "REDUCE";
}

function engine16Readiness(engine16) {
  return safeUpper(
    engine16?.readiness ??
      engine16?.readinessLabel,
    "UNKNOWN"
  );
}

function engine16Invalidated(engine16) {
  const state = safeUpper(engine16?.state, "");
  const readiness = engine16Readiness(engine16);

  return (
    engine16?.invalidated === true ||
    includesAny(state, ["INVALIDATED", "FAILED", "BROKEN"]) ||
    readiness === "BLOCKED" ||
    readiness === "STAND_DOWN"
  );
}

function getCurrentPrice({
  emaPosture,
  engine16,
  zoneContext,
  waveOpportunity,
  currentLifecycleState = null,
  possibleW5Up = null,
}) {
  return (
    toNum(currentLifecycleState?.currentPrice) ??
    toNum(possibleW5Up?.currentPrice) ??
    toNum(waveOpportunity?.currentPrice) ??
    toNum(emaPosture?.tenMinute?.close) ??
    toNum(engine16?.regimeLayers?.trigger10m?.close) ??
    toNum(zoneContext?.meta?.current_price) ??
    toNum(zoneContext?.meta?.currentPrice) ??
    null
  );
}

/* -----------------------------
   Engine 22 current lifecycle readers
------------------------------*/

function getEngine22WaveStrategy(snapshotContext) {
  return snapshotContext?.engine22WaveStrategy || null;
}

function getCurrentLifecycleState(engine22WaveStrategy) {
  return engine22WaveStrategy?.currentLifecycleState || null;
}

function getPossibleW5Up(engine22WaveStrategy) {
  return (
    engine22WaveStrategy?.waveFibState?.lifecycle?.postAbcReset?.possibleW5Up ||
    null
  );
}

function lifecycleKey(currentLifecycleState) {
  return safeUpper(currentLifecycleState?.key, "NONE");
}

function currentLifecycleReadiness(currentLifecycleState) {
  return safeUpper(currentLifecycleState?.readiness, "WATCH");
}

function currentLifecycleDirection(currentLifecycleState) {
  return safeUpper(currentLifecycleState?.direction, "NONE");
}

function currentLifecycleExecutionBias(currentLifecycleState) {
  const explicit = safeUpper(currentLifecycleState?.executionBias, "");
  if (explicit) return explicit;

  const direction = currentLifecycleDirection(currentLifecycleState);
  if (direction === "LONG") return "LONG";
  if (direction === "SHORT") return "SHORT";
  return "NONE";
}

function currentLifecycleIsWatchOnly(currentLifecycleState) {
  if (!currentLifecycleState || typeof currentLifecycleState !== "object") {
    return false;
  }

  return (
    currentLifecycleState.readOnly === true ||
    currentLifecycleState.noExecution === true ||
    currentLifecycleState.tradeableOpportunityBlocked === true ||
    currentLifecycleReadiness(currentLifecycleState) === "WATCH"
  );
}

function currentLifecycleAction(currentLifecycleState) {
  return safeUpper(
    currentLifecycleState?.action,
    "WAIT_FOR_CONFIRMATION"
  );
}

/* -----------------------------
   Engine 22 waveOpportunity fallback readers
------------------------------*/

function getWaveOpportunity(snapshotContext) {
  return (
    snapshotContext?.waveOpportunity ||
    snapshotContext?.engine22WaveStrategy?.waveOpportunity ||
    null
  );
}

function waveOpportunityExists(waveOpportunity) {
  return !!(
    waveOpportunity &&
    typeof waveOpportunity === "object" &&
    waveOpportunity.ok !== false
  );
}

function waveOpportunityActive(waveOpportunity) {
  return waveOpportunity?.active === true;
}

function waveSetupType(waveOpportunity) {
  return safeUpper(waveOpportunity?.setupType, "NONE");
}

function waveReadiness(waveOpportunity) {
  return safeUpper(waveOpportunity?.readiness, "NO_SETUP");
}

function waveTiming(waveOpportunity) {
  return safeUpper(waveOpportunity?.timing, "UNKNOWN");
}

function waveChaseRisk(waveOpportunity) {
  return safeUpper(waveOpportunity?.chaseRisk, "UNKNOWN");
}

function waveDirection(waveOpportunity) {
  return safeUpper(waveOpportunity?.direction, "NONE");
}

function waveDegree(waveOpportunity) {
  return safeUpper(waveOpportunity?.degree, "UNKNOWN");
}

function waveRawSetup(waveOpportunity) {
  return safeUpper(waveOpportunity?.rawSetup, "UNKNOWN");
}

function hasValidW3W5Opportunity(waveOpportunity) {
  if (!waveOpportunityExists(waveOpportunity)) return false;
  if (!waveOpportunityActive(waveOpportunity)) return false;

  const setupType = waveSetupType(waveOpportunity);

  return setupType === "W2_TO_W3" || setupType === "W4_TO_W5";
}

function waveOpportunityInvalid(waveOpportunity) {
  const readiness = waveReadiness(waveOpportunity);
  const setupType = waveSetupType(waveOpportunity);
  const rawSetup = waveRawSetup(waveOpportunity);

  return (
    readiness === "INVALID" ||
    setupType === "INVALID" ||
    rawSetup.includes("INVALID")
  );
}

function waveOpportunityWatchOnly(waveOpportunity) {
  const readiness = waveReadiness(waveOpportunity);
  return readiness === "WATCH" || readiness === "NO_SETUP";
}

function waveOpportunityArming(waveOpportunity) {
  return waveReadiness(waveOpportunity) === "ARMING";
}

function waveOpportunityReady(waveOpportunity) {
  return waveReadiness(waveOpportunity) === "READY";
}

function waveOpportunityLate(waveOpportunity) {
  const timing = waveTiming(waveOpportunity);
  return timing === "LATE" || timing === "POST_EXTENSION";
}

function waveOpportunityHighChaseRisk(waveOpportunity) {
  const risk = waveChaseRisk(waveOpportunity);
  return risk === "HIGH" || risk === "EXTREME";
}

function waveNeedsPullbackOrReclaim(waveOpportunity) {
  const needs = Array.isArray(waveOpportunity?.needs)
    ? waveOpportunity.needs.map((x) => safeUpper(x))
    : [];

  return (
    waveOpportunityLate(waveOpportunity) ||
    waveOpportunityHighChaseRisk(waveOpportunity) ||
    needs.includes("NO_CHASE_LONG") ||
    needs.includes("CONTROLLED_PULLBACK_OR_RECLAIM")
  );
}

function waveOpportunityReasonCodes(waveOpportunity) {
  return Array.isArray(waveOpportunity?.reasonCodes)
    ? waveOpportunity.reasonCodes
    : [];
}

function isPostAbcW2BounceWatch(waveOpportunity) {
  return (
    waveSetupType(waveOpportunity) === "POST_ABC_W2_BOUNCE_WATCH" &&
    waveReadiness(waveOpportunity) === "WATCH" &&
    waveDirection(waveOpportunity) === "NONE" &&
    waveOpportunity?.active === false &&
    waveOpportunity?.paperSignalCandidate === true
  );
}

function isPossibleW5UpCompletePullbackWatch({
  currentLifecycleState,
  possibleW5Up,
  waveOpportunity,
}) {
  return (
    lifecycleKey(currentLifecycleState) === "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH" ||
    possibleW5Up?.w5Complete === true ||
    safeUpper(possibleW5Up?.state, "") ===
      "POSSIBLE_MINOR_W5_UP_COMPLETE_POST_W5_PULLBACK_WATCH" ||
    waveSetupType(waveOpportunity) === "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH"
  );
}

/* -----------------------------
   Engine 23 behavior / no-chase readers
------------------------------*/

function getEngine23Interpretation(snapshotContext) {
  return snapshotContext?.engine23Interpretation || null;
}

function buildEngine23DamageContext(engine23Interpretation) {
  const state = safeUpper(engine23Interpretation?.state, "");
  const health = safeUpper(engine23Interpretation?.health, "");
  const directionBias = safeUpper(engine23Interpretation?.directionBias, "");
  const preferredEntry = safeUpper(engine23Interpretation?.preferredEntry, "");

  const reasonCodes = Array.isArray(engine23Interpretation?.reasonCodes)
    ? engine23Interpretation.reasonCodes
    : [];

  const reasonText = reasonCodes.map((x) => safeUpper(x, "")).join(" ");

  const touch = engine23Interpretation?.extensionTouchContext || null;
  const pattern = safeUpper(touch?.pattern, "");
  const levelKey = touch?.levelKey ?? null;
  const levelLabel = touch?.levelLabel ?? null;
  const level = toNum(touch?.level, null);

  const rejected =
    touch?.rejected === true ||
    reasonText.includes("DOUBLE_TOP_EXTENSION_REJECTION") ||
    reasonText.includes("EXTENSION_REJECTION");

  const failedAcceptance =
    touch?.failedAcceptance === true ||
    reasonText.includes("FAILED_ACCEPTANCE_ABOVE_EXTENSION");

  const w5Rejection =
    state.includes("W5_EXTENSION_DOUBLE_TOP_REJECTION") ||
    state.includes("EXTENSION_REJECTION") ||
    pattern === "DOUBLE_TOP_EXTENSION_REJECTION" ||
    rejected ||
    failedAcceptance;

  const longDamaged =
    directionBias.includes("LONG_DAMAGED") ||
    directionBias.includes("SHORT_WATCH");

  const noChase =
    engine23Interpretation?.chaseAllowed === false ||
    reasonText.includes("NO_CHASE_EXTENSION") ||
    preferredEntry.includes("WAIT_FOR_DOWNSIDE_CONFIRMATION") ||
    preferredEntry.includes("EXTENSION_RECLAIM");

  const active =
    engine23Interpretation &&
    engine23Interpretation.ok !== false &&
    (w5Rejection || longDamaged || noChase);

  const damageReasonCodes = [];

  if (w5Rejection) damageReasonCodes.push("ENGINE23_W5_EXTENSION_REJECTION");
  if (longDamaged) damageReasonCodes.push("ENGINE23_LONG_DAMAGED_SHORT_WATCH");
  if (noChase) damageReasonCodes.push("ENGINE23_NO_CHASE_EXTENSION");
  if (failedAcceptance) damageReasonCodes.push("ENGINE23_FAILED_ACCEPTANCE_ABOVE_EXTENSION");
  if (active) damageReasonCodes.push("WAIT_FOR_EXTENSION_RECLAIM_OR_DOWNSIDE_CONFIRMATION");

  const damageNeeds = [];

  if (w5Rejection || longDamaged || failedAcceptance) {
    damageNeeds.push("EXTENSION_RECLAIM_REQUIRED_FOR_LONG");
    damageNeeds.push("FRESH_DOWNSIDE_CONFIRMATION_REQUIRED_FOR_SHORT");
  }

  if (noChase) {
    damageNeeds.push("NO_CHASE_EXTENSION");
  }

  const levelPhrase =
    levelLabel && level != null
      ? ` near the ${levelLabel} extension at ${level}`
      : levelLabel
      ? ` near the ${levelLabel} extension`
      : level != null
      ? ` near ${level}`
      : "";

  const summary = active
    ? `Engine 23 shows a double-top W5 extension rejection${levelPhrase}. Long continuation is damaged. No long READY and no auto-short. Wait for extension reclaim with strength or fresh downside confirmation.`
    : null;

  return {
    present: Boolean(engine23Interpretation),
    active: Boolean(active),
    w5Rejection,
    longDamaged,
    noChase,
    rejected,
    failedAcceptance,
    state,
    health,
    directionBias,
    chaseAllowed: engine23Interpretation?.chaseAllowed,
    preferredEntry: engine23Interpretation?.preferredEntry || null,
    pattern: touch?.pattern || null,
    levelKey,
    levelLabel,
    level,
    summary,
    reasonCodes: damageReasonCodes,
    needs: damageNeeds,
    rawReasonCodes: reasonCodes,
    rawSummary: engine23Interpretation?.summary || null,
  };
}

/* -----------------------------
   Raw Engine 3 / Engine 4 fallbacks
------------------------------*/

function reactionConfirmedRaw(reaction) {
  if (!reaction || typeof reaction !== "object") return false;

  const score = toNum(reaction?.reactionScore ?? reaction?.score, 0);
  const stage = safeUpper(reaction?.stage, "UNKNOWN");
  const structureState = safeUpper(
    reaction?.structureState ??
      reaction?.state,
    "UNKNOWN"
  );

  return (
    reaction.confirmed === true ||
    score >= 70 ||
    stage === "CONFIRMED" ||
    stage === "TRIGGERED" ||
    includesAny(structureState, ["CONFIRMED", "RECLAIM", "SUPPORT_HELD"])
  );
}

function volumeConfirmedRaw(volume) {
  if (!volume || typeof volume !== "object") return false;

  const score = toNum(volume?.volumeScore ?? volume?.score, 0);
  const state = safeUpper(volume?.state, "UNKNOWN");
  const participationState = safeUpper(volume?.flags?.participationState, "");
  const participationQuality = safeUpper(volume?.flags?.participationQuality, "");
  const relativeVolume = toNum(
    volume?.flags?.relativeVolume ?? volume?.relativeVolume,
    0
  );

  const rawRisk =
    volume?.flags?.absorptionRisk === true ||
    volume?.flags?.climacticVolume === true ||
    includesAny(participationQuality, ["ABSORPTION", "CLIMACTIC"]) ||
    includesAny(state, ["ABSORPTION", "CLIMACTIC", "HIGH_VOLUME_FADING"]);

  if (rawRisk) return false;

  return (
    volume.volumeConfirmed === true ||
    volume.confirmed === true ||
    score >= 7 ||
    relativeVolume >= 1.2 ||
    includesAny(state, [
      "STRONG_PARTICIPATION",
      "PARTICIPATION_CONFIRMED",
      "EXPANSION",
      "IGNITION",
    ]) ||
    includesAny(participationState, ["STRONG", "CONFIRMED", "EXPANSION"]) ||
    includesAny(participationQuality, ["STRONG", "HIGH"])
  );
}

/* -----------------------------
   Engine 5 normalized component readers
------------------------------*/

function getEngine5Reaction(engine5) {
  return engine5?.components?.engine3Reaction || null;
}

function getEngine5Volume(engine5) {
  return engine5?.components?.engine4Volume || null;
}

function getEngine5Timing(engine5) {
  return (
    engine5?.timingContext ||
    engine5?.analytics?.engine5?.timingContext ||
    null
  );
}

function engine5Score(engine5) {
  return (
    toNum(engine5?.scores?.total) ??
    toNum(engine5?.score) ??
    toNum(engine5?.total) ??
    null
  );
}

function engine5Label(engine5) {
  return (
    engine5?.scores?.label ||
    engine5?.label ||
    null
  );
}

function reactionConfirmedFromEngine5(engine5, rawEngine3 = null) {
  const e5Reaction = getEngine5Reaction(engine5);

  if (e5Reaction && typeof e5Reaction === "object") {
    return (
      e5Reaction.confirmed === true ||
      e5Reaction.cleanReaction === true
    );
  }

  return reactionConfirmedRaw(rawEngine3);
}

function reactionDirectionFromEngine5(engine5, rawEngine3 = null) {
  const e5Reaction = getEngine5Reaction(engine5);

  return safeUpper(
    e5Reaction?.direction ??
      rawEngine3?.direction ??
      "NONE",
    "NONE"
  );
}

function reactionQualityFromEngine5(engine5, rawEngine3 = null) {
  const e5Reaction = getEngine5Reaction(engine5);

  return safeUpper(
    e5Reaction?.quality ??
      rawEngine3?.quality ??
      "UNKNOWN",
    "UNKNOWN"
  );
}

function volumeConfirmedFromEngine5(engine5, rawEngine4 = null) {
  const e5Volume = getEngine5Volume(engine5);

  if (e5Volume && typeof e5Volume === "object") {
    return (
      e5Volume.cleanParticipation === true ||
      e5Volume.confirmed === true
    );
  }

  return volumeConfirmedRaw(rawEngine4);
}

function volumeRiskFromEngine5(engine5, rawEngine4 = null) {
  const e5Volume = getEngine5Volume(engine5);

  if (e5Volume && typeof e5Volume === "object") {
    const quality = safeUpper(e5Volume.quality, "");
    const state = safeUpper(e5Volume.state, "");
    const participationState = safeUpper(e5Volume.participationState, "");
    const participationQuality = safeUpper(e5Volume.participationQuality, "");

    return (
      e5Volume.absorptionRisk === true ||
      e5Volume.climacticVolume === true ||
      quality === "HIGH_VOLUME_FADING" ||
      state === "HIGH_VOLUME_FADING" ||
      includesAny(quality, ["ABSORPTION", "CLIMACTIC", "FADING"]) ||
      includesAny(state, ["ABSORPTION", "CLIMACTIC", "FADING"]) ||
      includesAny(participationState, ["ABSORPTION", "CLIMACTIC", "FADING"]) ||
      includesAny(participationQuality, ["ABSORPTION", "CLIMACTIC", "FADING"])
    );
  }

  const rawState = safeUpper(rawEngine4?.state, "");
  const rawParticipationState = safeUpper(rawEngine4?.flags?.participationState, "");
  const rawParticipationQuality = safeUpper(rawEngine4?.flags?.participationQuality, "");

  return (
    rawEngine4?.flags?.absorptionRisk === true ||
    rawEngine4?.flags?.climacticVolume === true ||
    includesAny(rawState, ["ABSORPTION", "CLIMACTIC", "FADING"]) ||
    includesAny(rawParticipationState, ["ABSORPTION", "CLIMACTIC", "FADING"]) ||
    includesAny(rawParticipationQuality, ["ABSORPTION", "CLIMACTIC", "FADING"])
  );
}

function lateTimingFromEngine5(engine5) {
  const e5Timing = getEngine5Timing(engine5);

  if (!e5Timing || typeof e5Timing !== "object") return false;

  return (
    e5Timing.moveAlreadyHappened === true ||
    e5Timing.noChaseContext === true ||
    safeUpper(e5Timing.entryTiming, "") === "LATE_CHASE" ||
    safeUpper(e5Timing.entryTiming, "") === "POST_EXTENSION" ||
    safeUpper(e5Timing.chaseRisk, "") === "HIGH"
  );
}

function timingActionFromEngine5(engine5) {
  const e5Timing = getEngine5Timing(engine5);

  return safeUpper(
    e5Timing?.suggestedAction,
    "NONE"
  );
}

function timingEntryFromEngine5(engine5) {
  const e5Timing = getEngine5Timing(engine5);

  return safeUpper(
    e5Timing?.entryTiming,
    "UNKNOWN"
  );
}

function timingChaseRiskFromEngine5(engine5) {
  const e5Timing = getEngine5Timing(engine5);

  return safeUpper(
    e5Timing?.chaseRisk,
    "UNKNOWN"
  );
}

/* -----------------------------
   Engine 15 generic confirmation helpers
------------------------------*/

function engine3ConfirmedForCurrentLifecycle(engine3, engine5) {
  return reactionConfirmedFromEngine5(engine5, engine3);
}

function engine4ConfirmedForCurrentLifecycle(engine4, engine5) {
  return volumeConfirmedFromEngine5(engine5, engine4);
}

function buildEngine15NeedsFromCurrentLifecycleState({
  current,
  engine3,
  engine4,
  engine5,
  permission,
}) {
  const baseNeeds = Array.isArray(current?.needs) ? current.needs : [];
  const needs = [...baseNeeds];

  const engine3Ok = engine3ConfirmedForCurrentLifecycle(engine3, engine5);
  const engine4Ok = engine4ConfirmedForCurrentLifecycle(engine4, engine5);
  const permissionOk = permissionGatePassed(permission);

  if (!engine3Ok) needs.push("ENGINE3_REACTION_CONFIRMATION");
  if (!engine4Ok) needs.push("ENGINE4_PARTICIPATION_CONFIRMATION");
  if (!permissionOk) needs.push("ENGINE6_FINAL_PERMISSION_REQUIRED");

  return unique(needs);
}

function buildEngine15BlockersFromCurrentLifecycleState({
  current,
  engine3,
  engine4,
  engine5,
  permission,
}) {
  const blockers = Array.isArray(current?.blockers) ? [...current.blockers] : [];

  const engine3Ok = engine3ConfirmedForCurrentLifecycle(engine3, engine5);
  const engine4Ok = engine4ConfirmedForCurrentLifecycle(engine4, engine5);
  const permissionOk = permissionGatePassed(permission);

  if (!engine3Ok) blockers.push("ENGINE3_REACTION_NOT_CONFIRMED");
  if (!engine4Ok) blockers.push("ENGINE4_PARTICIPATION_NOT_CONFIRMED");
  if (!permissionOk) blockers.push("ENGINE6_FINAL_PERMISSION_REQUIRED");

  return unique(blockers);
}

/* -----------------------------
   Engine 15 PAPER_ONLY scalp readiness
------------------------------*/
function getEngine26StructuralContext(snapshotContext) {
  return snapshotContext?.engine26StructuralContext || null;
}

function isEngine26ShortStructuralWatch(engine26StructuralContext) {
  if (!engine26StructuralContext || typeof engine26StructuralContext !== "object") {
    return false;
  }

  const preferredDirection = safeUpper(
    engine26StructuralContext.preferredDirection,
    ""
  );

  return (
    engine26StructuralContext.active === true &&
    preferredDirection === "SHORT_WATCH_ONLY" &&
    engine26StructuralContext.shortResearchOnly === true &&
    engine26StructuralContext.doNotChaseLong === true
  );
}

function buildShortStructuralWatchReadiness({
  symbol,
  strategyId,
  current,
  currentPrice,
  engine26StructuralContext,
}) {
  const levels = engine26StructuralContext?.levels || {};
  const targetPathPreview = Array.isArray(engine26StructuralContext?.targetPathPreview)
    ? engine26StructuralContext.targetPathPreview
    : [];

  return {
    active: true,
    engine: "engine15.paperScalpReadiness.v1.2",
    mode: "PAPER_ONLY",
    readiness: "SHORT_STRUCTURAL_WATCH",
    source: "engine26StructuralContext",

    strategyId,
    instrument: symbol,

    allowed: false,
    grade: "D",
    score: 0,

    direction: "SHORT",
    setupType:
      engine26StructuralContext?.template ||
      engine26StructuralContext?.status ||
      lifecycleKey(current),
    setupRole: engine26StructuralContext?.activeImbalanceRole || null,
    structuralBias: engine26StructuralContext?.structuralBias || null,

    shortResearchOnly: true,
    doNotChaseLong: engine26StructuralContext?.doNotChaseLong === true,

    freshness: "WAIT_FOR_CONFIRMATION",
    timing: "WATCH",
    chaseRisk: "NO_CHASE_LONG_STRUCTURAL_SHORT_WATCH",

    realExecutionAllowed: false,
    noExecution: true,
    noPermissionCreated: true,
    requiresEngine6PaperApproval: true,

    currentPrice: toNum(currentPrice, null),

    riskModel: {
      mode: "PREVIEW_ONLY",
      stopPreview: "ABOVE_B_HIGH_OR_FAILED_ACCEPTANCE_HIGH",
      bHigh: toNum(levels?.bHigh, null),
      invalidationPreview: engine26StructuralContext?.invalidation || null,
      stopDefined: false,
      stopRequiredBeforeAllow: true,
      stopSource: "ENGINE26_STRUCTURAL_CONTEXT_PREVIEW",
    },

    targetModel: {
      mode: "PREVIEW_ONLY",
      targetPathPreview,
      cleanPathPreview: targetPathPreview.length > 0,
      targetPathRequiredBeforeAllow: true,
      targetSource: "ENGINE26_STRUCTURAL_CONTEXT_C_DOWN_PATH",
      levels,
    },

    confirmations: {
      engine22Context: true,
      engine26StructuralContext: true,
      engine3PaperReaction: false,
      engine4PaperParticipation: false,
      engine25Context: true,
      engine6PaperApprovalRequired: true,
    },

    blockers: [
      "SHORT_RESEARCH_ONLY_NO_PAPER_ALLOW",
      "ENGINE15_SHORT_READINESS_NOT_FULLY_BUILT",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
    ],

    warnings: [],

    reasonCodes: unique([
      "PAPER_ONLY_RESEARCH_LANE",
      "ENGINE15_READ_ENGINE26_STRUCTURAL_CONTEXT",
      "SHORT_STRUCTURAL_WATCH",
      engine26StructuralContext?.status,
      engine26StructuralContext?.template,
      engine26StructuralContext?.activeImbalanceRole,
      "SHORT_RESEARCH_ONLY",
      "DO_NOT_CHASE_LONG",
      "NO_PAPER_ALLOW",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
      "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
      ...(Array.isArray(engine26StructuralContext?.reasonCodes)
        ? engine26StructuralContext.reasonCodes
        : []),
    ]),
  };
}

function getPaperScalpReaction({ engine3, engine5 }) {
  return (
    engine3?.paperScalpReaction ||
    engine5?.context?.reaction?.paperScalpReaction ||
    engine5?.components?.engine3Reaction?.paperScalpReaction ||
    null
  );
}

function getPaperScalpParticipation({ engine4, engine5 }) {
  return (
    engine4?.engine22LifecycleParticipation?.paperScalpParticipation ||
    engine5?.context?.volume?.engine22LifecycleParticipation?.paperScalpParticipation ||
    engine5?.components?.engine4Volume?.engine22LifecycleParticipation?.paperScalpParticipation ||
    null
  );
}

function getCurrentLevelAction({ engine3, engine5 }) {
  return (
    engine3?.currentLevelAction ||
    engine5?.context?.reaction?.currentLevelAction ||
    engine5?.components?.engine3Reaction?.currentLevelAction ||
    null
  );
}

function firstFiniteNumber(values = []) {
  for (const value of values) {
    const n = toNum(value, null);
    if (n != null) return n;
  }
  return null;
}

function firstValidPriceLevel(values = []) {
  for (const value of values) {
    const n = toNum(value, null);
    if (n != null && n > 0) return n;
  }
  return null;
}

function roundToEsTick(value) {
  const n = toNum(value, null);
  if (n == null) return null;
  return Math.round(n / ES_TICK_SIZE) * ES_TICK_SIZE;
}

function pointsBetween(targetLevel, currentPrice) {
  const target = toNum(targetLevel, null);
  const current = toNum(currentPrice, null);
  if (target == null || current == null) return null;
  return Number((target - current).toFixed(2));
}

function firstZoneLowerBoundary(zones) {
  if (!zones) return null;

  const candidates = [];

  const collect = (zone) => {
    if (!zone || typeof zone !== "object") return;

    candidates.push(
      zone.lo,
      zone.low,
      zone.lower,
      zone.lowerBound,
      zone.lowerBoundary,
      zone.bottom,
      zone.min,
      zone.from
    );
  };

  if (Array.isArray(zones)) {
    zones.forEach(collect);
  } else if (typeof zones === "object") {
    collect(zones);
    Object.values(zones).forEach(collect);
  }

  return roundToEsTick(firstValidPriceLevel(candidates));
}

function readPaperTargetModel({ current, waveOpportunity, currentPrice }) {
  const currentNum = toNum(currentPrice, null);
  const triggerLevels =
    current?.confirmationContext?.reference?.triggerLevels ||
    current?.data?.confirmationContext?.reference?.triggerLevels ||
    {};

  const reclaimNegotiated = roundToEsTick(triggerLevels?.reclaimNegotiated);
  const reclaimInstitutional = roundToEsTick(triggerLevels?.reclaimInstitutional);

  const intermediateE100 = roundToEsTick(
    current?.intermediate?.targets?.e100 ??
      current?.data?.intermediate?.targets?.e100 ??
      waveOpportunity?.intermediate?.targets?.e100
  );

  let targetLevel = null;
  let targetSource = null;
  let targetType = "IMBALANCE_TO_IMBALANCE";

  if (currentNum != null && reclaimNegotiated != null && reclaimNegotiated > currentNum) {
    targetLevel = reclaimNegotiated;
    targetSource = "ENGINE22_RECLAIM_NEGOTIATED";
  } else if (currentNum != null && reclaimInstitutional != null && reclaimInstitutional > currentNum) {
    targetLevel = reclaimInstitutional;
    targetSource = "ENGINE22_RECLAIM_INSTITUTIONAL";
  } else if (currentNum != null && intermediateE100 != null && intermediateE100 > currentNum) {
    targetLevel = intermediateE100;
    targetSource = "ENGINE22_INTERMEDIATE_E100";
  } else if (currentNum != null) {
    targetLevel = roundToEsTick(currentNum + 10);
    targetSource = "PAPER_PLANNER_10_POINT_FALLBACK";
    targetType = "PAPER_PLANNER_10_POINT_FALLBACK";
  }

  const availablePoints = pointsBetween(targetLevel, currentNum);

  return {
    desiredPoints: 10,
    minAcceptablePoints: 8,
    availablePoints,
    targetLevel,
    targetType,
    targetSource,
    targetPathRequired: true,
  };
}
function readPaperRiskModel({
  current,
  waveOpportunity,
  paperReaction,
  currentLevelAction,
  currentPrice,
}) {
  const currentNum = toNum(currentPrice, null);

  const triggerLevels =
    current?.confirmationContext?.reference?.triggerLevels ||
    current?.data?.confirmationContext?.reference?.triggerLevels ||
    {};

  const zones =
    current?.confirmationContext?.reference?.zones ||
    current?.data?.confirmationContext?.reference?.zones ||
    null;

  const failureInstitutional = roundToEsTick(
    firstValidPriceLevel([triggerLevels?.failureInstitutional])
  );

  const zoneLowerBoundary = firstZoneLowerBoundary(zones);

  const paperReactionReferenceMinus2 =
    toNum(paperReaction?.referenceLevel, null) != null
      ? roundToEsTick(toNum(paperReaction?.referenceLevel, null) - 2)
      : null;

  const currentLevelReferenceMinus2 =
    toNum(currentLevelAction?.referenceLevel, null) != null
      ? roundToEsTick(toNum(currentLevelAction?.referenceLevel, null) - 2)
      : null;

  const candidates = [
    {
      stopLevel: failureInstitutional,
      stopSource: "ENGINE22_FAILURE_INSTITUTIONAL",
    },
    {
      stopLevel: zoneLowerBoundary,
      stopSource: "ENGINE22_ZONE_LOWER_BOUNDARY",
    },
    {
      stopLevel: paperReactionReferenceMinus2,
      stopSource: "ENGINE3_PAPER_REACTION_REFERENCE_MINUS_2",
    },
    {
      stopLevel: currentLevelReferenceMinus2,
      stopSource: "CURRENT_LEVEL_ACTION_REFERENCE_MINUS_2",
    },
  ];

  const rejectedStopSources = [];

  for (const candidate of candidates) {
    const stopLevel = toNum(candidate.stopLevel, null);

    if (stopLevel == null) continue;

    if (stopLevel <= 0) {
      rejectedStopSources.push(`${candidate.stopSource}_ZERO_OR_NEGATIVE`);
      continue;
    }

    if (currentNum != null && stopLevel >= currentNum) {
      rejectedStopSources.push(`${candidate.stopSource}_ABOVE_OR_AT_CURRENT_PRICE`);
      continue;
    }

    return {
      stopLevel,
      invalidationLevel: stopLevel,
      stopDefined: true,
      stopSource: candidate.stopSource,
      rejectedStopSources,
    };
  }

  return {
    stopLevel: null,
    invalidationLevel: null,
    stopDefined: false,
    stopSource: null,
    invalidStopReason:
      rejectedStopSources.length > 0
        ? "NO_VALID_STOP_AFTER_REJECTING_BAD_SOURCES"
        : null,
    rejectedStopSources,
  };
}
function paperDirectionFromCurrent(current) {
  const direction = currentLifecycleDirection(current);
  return direction || "NONE";
}

function paperScalpLateChaseBlocked({ current, engine5 }) {
  const timing = safeUpper(
    current?.paperScalpReadiness?.timing ??
      current?.paperScalpTiming ??
      current?.timing ??
      "",
    ""
  );

  const chaseRisk = safeUpper(
    current?.paperScalpReadiness?.chaseRisk ??
      current?.paperScalpChaseRisk ??
      current?.chaseRisk ??
      "",
    ""
  );

  const engine5Timing = getEngine5Timing(engine5);
  const e5EntryTiming = safeUpper(engine5Timing?.entryTiming, "");
  const e5ChaseRisk = safeUpper(engine5Timing?.chaseRisk, "");

  return (
    timing === "LATE_CHASE" ||
    timing === "TOO_LATE" ||
    chaseRisk === "LATE_CHASE" ||
    e5EntryTiming === "LATE_CHASE" ||
    e5EntryTiming === "TOO_LATE" ||
    e5ChaseRisk === "EXTREME"
  );
}

function buildDefaultPaperScalpReadiness({
  symbol,
  strategyId,
  current,
  direction,
  setupType,
}) {
  return {
    active: true,
    engine: "engine15.paperScalpReadiness.v1.1",
    mode: "PAPER_ONLY",
    strategyId,
    instrument: symbol,

    allowed: false,
    grade: "D",
    score: 0,

    direction,
    setupType,

    freshness: "WAIT_FOR_CONFIRMATION",
    timing: "WATCH",
    chaseRisk: "CAUTION",

    realExecutionAllowed: false,
    requiresEngine6PaperApproval: true,

    targetModel: {
      desiredPoints: 10,
      minAcceptablePoints: 8,
      availablePoints: null,
      targetLevel: null,
      targetType: null,
      targetPathRequired: true,
    },

    riskModel: {
      stopLevel: null,
      invalidationLevel: null,
      stopDefined: false,
    },

    confirmations: {
      engine22Context: Boolean(current),
      engine3PaperReaction: false,
      engine4PaperParticipation: false,
      engine25Context: true,
      engine6PaperApprovalRequired: true,
    },

    blockers: [],
    warnings: [],
    reasonCodes: [
      "PAPER_ONLY_RESEARCH_LANE",
      "ENGINE15_PAPER_SCALP_READINESS",
      "REAL_EXECUTION_REMAINS_BLOCKED",
      "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
    ],
  };
}

function buildPaperScalpReadiness({
  symbol,
  strategyId,
  current,
  waveOpportunity,
  currentPrice,
  engine3,
  engine4,
  engine5,
  engine26StructuralContext = null,
}) {
  const setupType = lifecycleKey(current);
  const direction = paperDirectionFromCurrent(current);
  if (isEngine26ShortStructuralWatch(engine26StructuralContext)) {
    return buildShortStructuralWatchReadiness({
      symbol,
      strategyId,
      current,
      currentPrice,
      engine26StructuralContext,
    });
  }

  const paper = buildDefaultPaperScalpReadiness({
    symbol,
    strategyId,
    current,
    direction,
    setupType,
  });

  const blockers = [];
  const warnings = [];
  const reasonCodes = [...paper.reasonCodes];

  const paperReaction = getPaperScalpReaction({ engine3, engine5 });
  const paperParticipation = getPaperScalpParticipation({ engine4, engine5 });
  const currentLevelAction = getCurrentLevelAction({ engine3, engine5 });

  const targetModel = readPaperTargetModel({
    current,
    waveOpportunity,
    currentPrice,
  });

  const riskModel = readPaperRiskModel({
    current,
    waveOpportunity,
    paperReaction,
    currentLevelAction,
    currentPrice,
  });

  const engine22Context = Boolean(current && setupType && setupType !== "NONE");
  const engine22PaperCandidate =
    current?.paperTradeCandidate === true ||
    waveOpportunity?.paperTradeCandidate === true;

  const engine3Allowed = paperReaction?.allowed === true;
  const engine3Blocked =
    paperReaction?.allowed === false &&
    Array.isArray(paperReaction?.blockers) &&
    paperReaction.blockers.length > 0;

  const engine4Allowed = paperParticipation?.allowed === true;
  const engine4HardBlocked = paperParticipation?.hardBlocked === true;

  const lateChase = paperScalpLateChaseBlocked({
    current,
    engine5,
  });

  const currentPriceExists = toNum(currentPrice, null) != null;
  const availablePoints = toNum(targetModel.availablePoints, null);
  const targetPathDefined = availablePoints != null;
  const targetPathEnough = availablePoints != null && availablePoints >= 8;
  const targetPathCaution = availablePoints != null && availablePoints >= 6 && availablePoints < 8;

  if (!engine22Context) blockers.push("MISSING_ENGINE22_CONTEXT");
  if (!currentPriceExists) blockers.push("MISSING_CURRENT_PRICE");

  if (!engine22PaperCandidate) {
    blockers.push("ENGINE22_PAPER_TRADE_CANDIDATE_NOT_PRESENT");
  } else {
    reasonCodes.push("ENGINE22_PAPER_TRADE_CANDIDATE");
  }

  if (direction === "SHORT") {
    blockers.push("PAPER_SHORTS_DISABLED_V1");
  } else if (direction !== "LONG") {
    blockers.push("PAPER_DIRECTION_NOT_LONG");
  }

  if (!engine3Allowed) {
    blockers.push(
      engine3Blocked
        ? "ENGINE3_PAPER_REACTION_BLOCKED"
        : "ENGINE3_PAPER_REACTION_NOT_ALLOWED"
    );
    reasonCodes.push("ENGINE3_PAPER_REACTION_NOT_ALLOWED");
  } else {
    reasonCodes.push("ENGINE3_PAPER_REACTION_ALLOWED");
  }

  if (engine4HardBlocked) {
    blockers.push("ENGINE4_PAPER_PARTICIPATION_HARD_BLOCKED");
    reasonCodes.push("ENGINE4_PAPER_PARTICIPATION_HARD_BLOCKED");
  } else if (!engine4Allowed) {
    blockers.push("ENGINE4_PAPER_PARTICIPATION_NOT_ALLOWED");
    warnings.push("WAIT_FOR_RECLAIM_VOLUME");
    reasonCodes.push("ENGINE4_PAPER_PARTICIPATION_NOT_ALLOWED");
  } else {
    reasonCodes.push("ENGINE4_PAPER_PARTICIPATION_ALLOWED");
  }

  if (lateChase) {
    blockers.push("LATE_CHASE_AFTER_VERTICAL_CANDLE");
    reasonCodes.push("LATE_CHASE_AFTER_VERTICAL_CANDLE");
  }

  if (!riskModel.stopDefined) {
  blockers.push("NO_DEFINED_STOP_OR_INVALIDATION");
  reasonCodes.push("NO_DEFINED_STOP_OR_INVALIDATION");

  if (riskModel.invalidStopReason) {
    blockers.push(riskModel.invalidStopReason);
    reasonCodes.push(riskModel.invalidStopReason);
  }
} else {
  reasonCodes.push("STOP_DEFINED");
  if (riskModel.stopSource) {
    reasonCodes.push(`STOP_FROM_${riskModel.stopSource}`);
  }
}

if (!targetPathDefined) {
  blockers.push("MISSING_TARGET_PATH");
  reasonCodes.push("MISSING_TARGET_PATH");
} else if (!targetPathEnough && !targetPathCaution) {
  blockers.push("NO_CLEAN_PATH_TO_TARGET");
  reasonCodes.push("NO_CLEAN_PATH_TO_TARGET");
} else if (targetPathCaution) {
  warnings.push("TARGET_PATH_BELOW_PREFERRED_8_POINTS");
  reasonCodes.push("TARGET_PATH_CAUTION");

  if (targetModel.targetSource) {
    reasonCodes.push(`TARGET_FROM_${targetModel.targetSource}`);
  }
} else {
  reasonCodes.push("TARGET_PATH_DEFINED_OR_PREVIEW");

  if (targetModel.targetSource) {
    reasonCodes.push(`TARGET_FROM_${targetModel.targetSource}`);
  }

  if (targetModel.targetSource === "PAPER_PLANNER_10_POINT_FALLBACK") {
    warnings.push("PAPER_TARGET_PLANNER_FALLBACK_USED");
    reasonCodes.push("PAPER_TARGET_PLANNER_FALLBACK_USED");
  }
}

  const hardBlocked = blockers.some((blocker) =>
    [
      "MISSING_ENGINE22_CONTEXT",
      "MISSING_CURRENT_PRICE",
      "ENGINE22_PAPER_TRADE_CANDIDATE_NOT_PRESENT",
      "PAPER_SHORTS_DISABLED_V1",
      "PAPER_DIRECTION_NOT_LONG",
      "ENGINE3_PAPER_REACTION_BLOCKED",
      "ENGINE4_PAPER_PARTICIPATION_HARD_BLOCKED",
      "LATE_CHASE_AFTER_VERTICAL_CANDLE",
      "NO_DEFINED_STOP_OR_INVALIDATION",
      "MISSING_TARGET_PATH",
      "NO_CLEAN_PATH_TO_TARGET",
    ].includes(blocker)
  );

  const allowed =
    !hardBlocked &&
    engine3Allowed &&
    engine4Allowed &&
    engine22PaperCandidate &&
    direction === "LONG" &&
    riskModel.stopDefined &&
    targetPathEnough &&
    currentPriceExists;

  let grade = "D";
  let score = 0;
  let freshness = "WAIT_FOR_CONFIRMATION";
  let timing = "WATCH";
  let chaseRisk = "CAUTION";

  if (allowed) {
    grade = "A";
    score = 85;
    freshness = "FRESH_ENOUGH_FOR_PAPER";
    timing = "EARLY_OR_MID_MOVE";
    chaseRisk = "ACCEPTABLE_FOR_PAPER";
  } else if (
    engine22PaperCandidate &&
    engine3Allowed &&
    !engine4HardBlocked &&
    riskModel.stopDefined &&
    (targetPathEnough || targetPathCaution) &&
    currentPriceExists
  ) {
    grade = "C";
    score = 55;
    freshness = "FRESH_ENOUGH_FOR_PAPER";
    timing = "CONTROLLED_RECLAIM_WATCH";
    chaseRisk = "CAUTION";
    reasonCodes.push("PAPER_ONLY_GRADE_C");
  } else if (engine22PaperCandidate && engine3Allowed) {
    grade = "D";
    score = 35;
    freshness = "WAIT_FOR_CONFIRMATION";
    timing = "WATCH";
    chaseRisk = "CAUTION";
  }

  if (allowed) {
    reasonCodes.push("ENGINE15_PAPER_SCALP_ALLOWED");
  } else {
    reasonCodes.push("ENGINE15_PAPER_SCALP_NOT_ALLOWED");
  }

  return {
    ...paper,

    allowed,
    grade,
    score,

    direction,
    setupType,

    freshness,
    timing,
    chaseRisk,

  targetModel: {
    ...paper.targetModel,
    ...targetModel,
    targetType: targetModel.targetType || "IMBALANCE_TO_IMBALANCE",
    targetSource: targetModel.targetSource || null,
  },

    riskModel,

    confirmations: {
      engine22Context,
      engine3PaperReaction: engine3Allowed,
      engine4PaperParticipation: engine4Allowed,
      engine25Context: true,
      engine6PaperApprovalRequired: true,
    },

    blockers: unique(blockers),
    warnings: unique(warnings),
    reasonCodes: unique(reasonCodes),
  };
}

/* -----------------------------
   Structure / extension helpers
------------------------------*/

function activeEngine2Extension(engine2State) {
  if (!engine2State || typeof engine2State !== "object") return false;

  const scalp = engine2State?.activeExtensions?.scalp;
  const micro = engine2State?.micro?.waveExtension;
  const minute = engine2State?.minute?.waveExtension;
  const minor = engine2State?.minor?.waveExtension;

  return (
    scalp?.active === true ||
    micro?.active === true ||
    minute?.active === true ||
    minor?.active === true
  );
}

function tenMinuteLongTrigger({ tenMinute, engine16 }) {
  const trigger10m = engine16?.regimeLayers?.trigger10m || null;

  const layerAbove10And20 =
    layerAboveEma10(tenMinute) &&
    layerAboveEma20(tenMinute);

  const triggerLayerAbove10And20 =
    trigger10m?.aboveEma10 === true &&
    trigger10m?.aboveEma20 === true;

  const triggerState = safeUpper(trigger10m?.state, "");
  const triggerTrend = safeUpper(trigger10m?.trendState, "");

  const explicitLongTrigger =
    engine16?.triggerConfirmed === true &&
    safeUpper(engine16?.triggerDirection ?? engine16?.direction, "NONE") === "LONG";

  return (
    layerAbove10And20 ||
    triggerLayerAbove10And20 ||
    explicitLongTrigger ||
    engine16?.continuationTriggerLong === true ||
    engine16?.exhaustionTriggerLong === true ||
    triggerTrend === "LONG_ONLY" ||
    includesAny(triggerState, ["ABOVE_EMA10_EMA20", "RECLAIM", "LONG_TRIGGER"])
  );
}

/* -----------------------------
   Output helpers
------------------------------*/

function buildLifecycle({
  currentPrice,
  nextFocus = "WAIT_FOR_TRIGGER",
  lifecycleStage = "NO_TRADE",
}) {
  return {
    lifecycleStage,
    isFreshSetup: false,
    entryWindowOpen: false,
    freshEntryNow: false,
    signalPrice: null,
    currentPrice: toNum(currentPrice),
    barsSinceSignal: null,
    moveFromSignalPts: null,
    moveFromSignalAtr: null,
    zonesInPath: [],
    zonesHit: 0,
    targetCount: 0,
    targetProgress01: 0,
    firstTargetHit: false,
    secondTargetHit: false,
    tp1Zone: null,
    tp2Zone: null,
    tp1Reclaimed: false,
    block2Protected: false,
    block2ExitReason: null,
    runnerActive: false,
    runnerExitTriggered: false,
    runnerExitReason: null,
    ema10_30m: null,
    setupCompleted: false,
    edgeRemainingPct: 100,
    nextFocus,
  };
}

function buildSignalEvent() {
  return {
    signalType: "NONE",
    direction: "NONE",
    signalTime: null,
    signalPrice: null,
    signalSource: null,
  };
}

function buildBlockedDecision({
  symbol,
  strategyId,
  permission,
  currentPrice,
  blockers,
  reasonCodes,
  needs,
  debug,
}) {
  const pText = permissionText(permission);

  return {
    ok: true,
    engine: ENGINE,
    symbol,
    strategyId,

    strategyType: "NONE",
    direction: "NONE",
    readinessLabel: "BLOCKED",
    executionBias: "NONE",
    action: "BLOCKED",
    priority: 0,
    entryStyle: "NONE",
    active: false,
    freshEntryNow: false,

    reasonCodes: unique(reasonCodes),
    blockers: unique(blockers),
    conflicts: [],

    needs: unique(needs?.length ? needs : ["RESOLVE_BLOCKERS"]),
    summary:
      "ES Engine 15 is blocked because required ES readiness data, structure, or permission is not available.",

    qualityGatePassed: false,
    momentumGatePassed: false,
    permissionGatePassed: false,

    qualityScore: 0,
    qualityGrade: "IGNORE",
    qualityBand: "INVALID",
    qualityBreakdown: {
      waveOpportunityActive: false,
      waveSetupType: "NONE",
      waveReadiness: "NO_SETUP",
      waveTiming: "UNKNOWN",
      waveChaseRisk: "UNKNOWN",
      dailyAboveEma10: false,
      fourHourAboveEma10: false,
      oneHourAboveEma10: false,
      tenMinuteAboveEma10: false,
      tenMinuteAboveEma20: false,
      tenMinuteTrigger: false,
      reactionConfirmed: false,
      volumeConfirmed: false,
      volumeRisk: false,
      lateTiming: false,
      extensionContext: false,
    },

    permission: pText,
    sizeMultiplier: toNum(permission?.sizeMultiplier, null),

    setupChain: [],
    nextSetupType: "NONE",
    primaryExhaustionTF: null,

    signalEvent: buildSignalEvent(),

    lifecycle: buildLifecycle({
      currentPrice,
      nextFocus: "RESOLVE_BLOCKERS",
      lifecycleStage: "BLOCKED",
    }),

    futures: {
      tickSize: ES_TICK_SIZE,
      liveExecutionEnabled: false,
      paperOnly: true,
    },

    debug,
  };
}

function buildPostAbcW2BounceWatchDecision({
  symbol,
  strategyId,
  permission,
  currentPrice,
  waveOpportunity,
  dailyBelow,
  debug,
}) {
  const pText = permissionText(permission);

  const reasonCodes = [
    "ENGINE15_POST_ABC_BOUNCE_WATCH",
    "ENGINE22_POST_ABC_W2_BOUNCE_WATCH",
    "WATCH_ONLY",
    "NO_EXECUTION",
    "WAIT_FOR_RECLAIM_CONFIRMATION",
  ];

  if (dailyBelow) {
    reasonCodes.push("DAILY_BELOW_EMA10_BOUNCE_CAUTION");
  }

  const needs = [
    "7400_SUPPORT_HOLD",
    "RECLAIM_CONFIRMATION_REQUIRED",
    "ENGINE22_POST_ABC_BOUNCE_ARMING_REQUIRED",
    "ENGINE6_FINAL_PERMISSION_REQUIRED",
  ];

  return {
    ok: true,
    engine: ENGINE,
    symbol,
    strategyId,

    strategyType: "POST_ABC_W2_BOUNCE_WATCH",
    direction: "NONE",
    readinessLabel: "WATCH",
    executionBias: "NONE",
    action: "WAIT_FOR_RECLAIM_CONFIRMATION",
    priority: 20,
    entryStyle: "WATCH_ONLY_RECLAIM_CONFIRMATION",
    active: false,
    freshEntryNow: false,

    reasonCodes: unique(reasonCodes),
    blockers: [],
    conflicts: [],

    needs: unique(needs),
    summary:
      waveOpportunity?.summary ||
      "POST ABC W2 BOUNCE WATCH — WAIT FOR RECLAIM. This is watch-only and not executable.",

    qualityGatePassed: false,
    momentumGatePassed: false,
    permissionGatePassed: permissionGatePassed(permission),

    qualityScore: 0,
    qualityGrade: "WATCH",
    qualityBand: "WATCH_ONLY",
    qualityBreakdown: {
      waveOpportunityActive: waveOpportunityActive(waveOpportunity),
      waveSetupType: waveSetupType(waveOpportunity),
      waveRawSetup: waveRawSetup(waveOpportunity),
      waveDegree: waveDegree(waveOpportunity),
      waveDirection: waveDirection(waveOpportunity),
      waveReadiness: waveReadiness(waveOpportunity),
      waveTiming: waveTiming(waveOpportunity),
      waveChaseRisk: waveChaseRisk(waveOpportunity),
      postAbcW2BounceWatch: true,
      dailyBelowEma10BounceCaution: Boolean(dailyBelow),
      executionAllowed: false,
    },

    permission: pText,
    sizeMultiplier: toNum(permission?.sizeMultiplier, null),

    setupChain: [
      "ENGINE22_POST_ABC_W2_BOUNCE_WATCH",
      "WATCH_ONLY",
      "WAIT_FOR_RECLAIM_CONFIRMATION",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
    ],
    nextSetupType: "WAIT_FOR_POST_ABC_BOUNCE_ARMING",
    primaryExhaustionTF: null,

    signalEvent: buildSignalEvent(),

    lifecycle: buildLifecycle({
      currentPrice,
      nextFocus: "WAIT_FOR_RECLAIM_CONFIRMATION",
      lifecycleStage: "WATCH",
    }),

    futures: {
      tickSize: ES_TICK_SIZE,
      liveExecutionEnabled: false,
      paperOnly: true,
    },

    debug,
  };
}

function buildPossibleW5UpCompletePullbackWatchDecision({
  symbol,
  strategyId,
  permission,
  currentPrice,
  currentLifecycleState,
  possibleW5Up,
  waveOpportunity,
  debug,
}) {
  const pText = permissionText(permission);

  const pullbackLevelsFromW5 =
    currentLifecycleState?.pullbackLevelsFromW5 ??
    possibleW5Up?.pullbackLevelsFromW5 ??
    null;

  const entryZones =
    currentLifecycleState?.entryZones ??
    possibleW5Up?.entryZones ??
    null;

  const priceProgress =
    currentLifecycleState?.priceProgress ??
    possibleW5Up?.priceProgress ??
    null;

  const w5Complete =
    currentLifecycleState?.w5Complete === true ||
    possibleW5Up?.w5Complete === true;

  const noExecution =
    currentLifecycleState?.noExecution === true ||
    possibleW5Up?.noExecution === true;

  const tradeableOpportunityBlocked =
    currentLifecycleState?.tradeableOpportunityBlocked === true ||
    possibleW5Up?.tradeableOpportunityBlocked === true;

  const paperScalpReadiness = buildPaperScalpReadiness({
    symbol,
    strategyId,
    current: currentLifecycleState,
    waveOpportunity,
    currentPrice,
    engine3: null,
    engine4: null,
    engine5: null,
  });

  return {
    ok: true,
    engine: ENGINE,
    symbol,
    strategyId,

    strategyType: "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH",
    direction: "NONE",
    readinessLabel: "WATCH",
    executionBias: "NONE",
    action: "WAIT_FOR_POST_W5_PULLBACK_REACTION_OR_RECLAIM",
    priority: 25,
    entryStyle: "WATCH_ONLY_POST_W5_PULLBACK_REACTION",
    active: false,
    freshEntryNow: false,
    paperScalpReadiness,

    reasonCodes: unique([
      "ENGINE15_POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH",
      "ENGINE22_CURRENT_LIFECYCLE_STATE_CONSUMED",
      "ENGINE22_POSSIBLE_W5_UP_COMPLETE",
      "WATCH_ONLY",
      "NO_EXECUTION",
      "NO_CHASE",
      "WAIT_FOR_POST_W5_PULLBACK_REACTION",
    ]),

    blockers: [],
    conflicts: [],

    needs: unique([
      "WATCH_PULLBACK_ZONE_REACTION",
      "WAIT_FOR_RECLAIM_CONFIRMATION",
      "ENGINE3_REACTION_CONFIRMATION",
      "ENGINE4_PARTICIPATION_CONFIRMATION",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
    ]),

    summary:
      currentLifecycleState?.summary ||
      possibleW5Up?.summary ||
      waveOpportunity?.summary ||
      "Possible Minor W5 up is marked complete. Engine 15ES is watch-only while price pulls back into Engine 22 zones and waits for Engine 3 reaction, Engine 4 participation, and Engine 6 final permission.",

    qualityGatePassed: false,
    momentumGatePassed: false,
    permissionGatePassed: false,

    qualityScore: 0,
    qualityGrade: "WATCH",
    qualityBand: "WATCH_ONLY",

    qualityBreakdown: {
      engine22CurrentLifecycleKey: currentLifecycleState?.key || null,
      possibleW5UpCompletePullbackWatch: true,
      w5Complete,
      currentPrice:
        toNum(currentLifecycleState?.currentPrice, null) ??
        toNum(possibleW5Up?.currentPrice, null) ??
        toNum(currentPrice, null),
      noExecution,
      tradeableOpportunityBlocked,
      executionAllowed: false,
      pullbackLevelsFromW5,
      entryZones,
      priceProgress,
    },

    permission: pText,
    sizeMultiplier: toNum(permission?.sizeMultiplier, null),

    setupChain: [
      "ENGINE22_CURRENT_LIFECYCLE_STATE",
      "POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH",
      "WATCH_ONLY",
      "WAIT_FOR_POST_W5_PULLBACK_REACTION",
      "ENGINE3_REACTION_CONFIRMATION",
      "ENGINE4_PARTICIPATION_CONFIRMATION",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
    ],

    nextSetupType: "WAIT_FOR_POST_W5_PULLBACK_REACTION_OR_RECLAIM",
    primaryExhaustionTF: null,

    signalEvent: buildSignalEvent(),

    lifecycle: buildLifecycle({
      currentPrice,
      nextFocus: "WAIT_FOR_POST_W5_PULLBACK_REACTION_OR_RECLAIM",
      lifecycleStage: "WATCH",
    }),

    futures: {
      tickSize: ES_TICK_SIZE,
      liveExecutionEnabled: false,
      paperOnly: true,
    },

    engine22CurrentLifecycleState: currentLifecycleState || null,
    pullbackLevelsFromW5,
    entryZones,
    priceProgress,

    debug,
  };
}

function buildEngine15FromEngine22CurrentLifecycleState({
  symbol,
  strategyId,
  permission,
  currentPrice,
  current,
  engine3,
  engine4,
  engine5,
  engine26StructuralContext = null,
  debug,
}) {
  if (!current || typeof current !== "object") return null;

  const key = lifecycleKey(current);
  if (!key || key === "NONE" || key === "UNKNOWN_ENGINE22_STATE") return null;

  const watchOnly = currentLifecycleIsWatchOnly(current);
  if (!watchOnly) return null;

  const direction = currentLifecycleDirection(current);
  const executionBias = currentLifecycleExecutionBias(current);
  const rawReadiness = currentLifecycleReadiness(current);
  const readinessLabel = rawReadiness === "READY" ? "WATCH" : rawReadiness;

  const action = currentLifecycleAction(current);

  const needs = buildEngine15NeedsFromCurrentLifecycleState({
    current,
    engine3,
    engine4,
    engine5,
    permission,
  });

  const blockers = buildEngine15BlockersFromCurrentLifecycleState({
    current,
    engine3,
    engine4,
    engine5,
    permission,
  });

const paperScalpReadiness = buildPaperScalpReadiness({
  symbol,
  strategyId,
  current,
  waveOpportunity: null,
  currentPrice,
  engine3,
  engine4,
  engine5,
  engine26StructuralContext,
});
  const currentReasonCodes = Array.isArray(current.reasonCodes)
    ? current.reasonCodes
    : [];

  const reasonCodes = unique([
    "ENGINE15_RECOGNIZED_ENGINE22_CURRENT_LIFECYCLE_STATE",
    key,
    "WATCH_ONLY",
    "NO_EXECUTION",
    ...currentReasonCodes,
  ]);

  return {
    ok: true,
    engine: ENGINE,
    symbol,
    strategyId,

    strategyType: key,
    direction,
    readinessLabel,
    executionBias,
    action,
    priority: 30,
    entryStyle: "ENGINE22_CURRENT_LIFECYCLE_WATCH_ONLY",
    active: false,
    freshEntryNow: false,

    executable: false,
    noExecution: true,
    tradeableOpportunityBlocked:
      current.tradeableOpportunityBlocked === true,
    setupEligible: false,
    
    paperTradeCandidate: current.paperTradeCandidate === true,
    paperTradeAllowedOnlyAfterConfirmation:
      current.paperTradeAllowedOnlyAfterConfirmation === true,

   paperScalpReadiness, 

    reasonCodes,
    blockers,
    conflicts: [],

    needs,

    summary:
      current.summary ||
      current.headline ||
      "Engine 15ES is watching Engine 22 current lifecycle state and waiting for confirmation.",

    qualityGatePassed: false,
    momentumGatePassed: false,
    permissionGatePassed: false,

    qualityScore: 0,
    qualityGrade: "WATCH",
    qualityBand: "WATCH_ONLY",

    qualityBreakdown: {
      engine22CurrentLifecycleKey: key,
      engine22CurrentLifecycleAdapter: true,
      direction,
      executionBias,
      readOnly: current.readOnly === true,
      noExecution: true,
      tradeableOpportunityBlocked:
        current.tradeableOpportunityBlocked === true,
      paperTradeCandidate: current.paperTradeCandidate === true,
      paperTradeAllowedOnlyAfterConfirmation:
        current.paperTradeAllowedOnlyAfterConfirmation === true,
      executionAllowed: false,
    },

    permission: permissionText(permission),
    sizeMultiplier: toNum(permission?.sizeMultiplier, null),

    setupChain: unique([
      "ENGINE22_CURRENT_LIFECYCLE_STATE",
      key,
      "WATCH_ONLY",
      "ENGINE3_REACTION_CONFIRMATION",
      "ENGINE4_PARTICIPATION_CONFIRMATION",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
    ]),

    nextSetupType: action,
    primaryExhaustionTF: null,

    signalEvent: buildSignalEvent(),

    lifecycle: buildLifecycle({
      currentPrice,
      nextFocus: action,
      lifecycleStage: "WATCH",
    }),

    futures: {
      tickSize: ES_TICK_SIZE,
      liveExecutionEnabled: false,
      paperOnly: true,
    },

    engine22CurrentLifecycleState: current,

    debug,
  };
}

function chooseNextSetupType({
  readinessLabel,
  waveNeedsReclaim,
  waveOpportunity,
  lateTiming,
  volumeOk,
  volumeRisk,
  reactionOk,
  tenMinuteTrigger,
}) {
  if (readinessLabel === "READY") return "PAPER_READY_ONLY";
  if (waveNeedsReclaim) return "WAIT_FOR_PULLBACK_OR_RECLAIM";
  if (waveOpportunityWatchOnly(waveOpportunity)) return "WAIT_FOR_WAVE_OPPORTUNITY_ARMING";
  if (!tenMinuteTrigger) return "WAIT_FOR_10M_RECLAIM";
  if (!reactionOk) return "WAIT_FOR_ENGINE3_REACTION";
  if (!volumeOk) return "WAIT_FOR_ENGINE4_CLEAN_PARTICIPATION";
  if (volumeRisk) return "WAIT_FOR_VOLUME_RISK_CLEARANCE";
  if (lateTiming) return "WAIT_FOR_PULLBACK_OR_RECLAIM";
  return "WAIT_FOR_CONFIRMATION";
}

function buildWatchSummary({
  waveOpportunity,
  dailyAbove,
  fourHourBelow,
  oneHourBelow,
  tenMinuteBelow10,
  tenMinuteBelow20,
  longTrigger,
  reactionOk,
  volumeOk,
  volumeRisk,
  lateTiming,
  engine5Timing,
  e5Reaction,
  e5Volume,
}) {
  const parts = [];

  if (hasValidW3W5Opportunity(waveOpportunity)) {
    parts.push(
      `Engine 22 found a ${waveDegree(waveOpportunity)} ${waveSetupType(
        waveOpportunity
      )} Elliott Wave opportunity`
    );

    if (waveOpportunity?.summary) {
      parts.push(waveOpportunity.summary);
    }
  } else {
    parts.push("Engine 22 has not confirmed a valid W3/W5 opportunity");
  }

  if (dailyAbove) {
    parts.push("daily still allows long ES ideas");
  } else {
    parts.push("daily does not yet provide clean long permission");
  }

  if (!fourHourBelow && !oneHourBelow) {
    parts.push("4H and 1H are supportive");
  } else if (fourHourBelow && oneHourBelow) {
    parts.push("4H and 1H are still weak");
  } else if (fourHourBelow) {
    parts.push("4H is still weak");
  } else if (oneHourBelow) {
    parts.push("1H is still weak");
  }

  if (longTrigger && !tenMinuteBelow10 && !tenMinuteBelow20) {
    parts.push("10m reclaim/trigger is present");
  } else {
    parts.push("10m still needs a clean EMA10/EMA20 reclaim");
  }

  if (reactionOk) {
    const quality = safeUpper(e5Reaction?.quality, "");
    const direction = safeUpper(e5Reaction?.direction, "");
    const detail = [quality, direction].filter(Boolean).join(" ");
    parts.push(detail ? `Engine 5 confirms reaction (${detail})` : "Engine 5 confirms reaction");
  } else {
    parts.push("reaction is not confirmed");
  }

  if (volumeOk && !volumeRisk) {
    parts.push("volume participation is clean");
  } else if (volumeRisk) {
    const quality =
      safeUpper(e5Volume?.quality, "") ||
      safeUpper(e5Volume?.participationQuality, "") ||
      "RISK";
    parts.push(`volume is not clean because volume risk is present (${quality})`);
  } else {
    parts.push("volume participation is not confirmed");
  }

  if (lateTiming) {
    const timing = safeUpper(engine5Timing?.entryTiming, "UNKNOWN");
    const chaseRisk = safeUpper(engine5Timing?.chaseRisk, "UNKNOWN");
    const suggested = safeUpper(engine5Timing?.suggestedAction, "WAIT_FOR_PULLBACK_OR_RECLAIM");

    parts.push(
      `Engine 5 timing says the move already happened / no chase (${timing}, chase risk ${chaseRisk}); suggested action is ${suggested}`
    );
  }

  return `${parts.join(", ")}. No clean ES entry yet.`;
}
  
/**
 * Build ES Engine 15 decision from direct strategy-builder inputs.
 *
 * This signature is designed for jobs/buildStrategySnapshot.js inside processStrategy(...),
 * before the final full snapshot object exists.
 */
export function buildEngine15EsDecision({
  symbol = "ES",
  strategyId = DEFAULT_STRATEGY_ID,
  snapshotContext = {},
  engine16 = null,
  engine5 = null,
  momentum = null,
  permission = null,
  engine3 = null,
  engine4 = null,
  zoneContext = null,
} = {}) {
  try {
    const sym = safeUpper(symbol, "ES");
    const blockers = [];
    const needs = [];
    const reasonCodes = [];

    const emaPosture = snapshotContext?.emaPosture || {};
    const engine2State = snapshotContext?.engine2State || null;
    const marketRegime = snapshotContext?.marketRegime || null;

    const engine22WaveStrategy = getEngine22WaveStrategy(snapshotContext);
    const currentLifecycleState = getCurrentLifecycleState(engine22WaveStrategy);
    const possibleW5Up = getPossibleW5Up(engine22WaveStrategy);
    const waveOpportunity = getWaveOpportunity(snapshotContext);
    const engine26StructuralContext = getEngine26StructuralContext(snapshotContext);

    const engine23Interpretation = getEngine23Interpretation(snapshotContext);
    const engine23Damage = buildEngine23DamageContext(engine23Interpretation);
    const tenMinute = emaPosture?.tenMinute || null;
    const oneHour = emaPosture?.oneHour || null;
    const fourHour = emaPosture?.fourHour || null;
    const daily = emaPosture?.daily || null;

    const currentPrice = getCurrentPrice({
      emaPosture,
      engine16,
      zoneContext,
      waveOpportunity,
      currentLifecycleState,
      possibleW5Up,
    });

    const pText = permissionText(permission);

    // Critical data checks.
    if (sym !== "ES") blockers.push("NOT_ES_SYMBOL");
    if (strategyId !== DEFAULT_STRATEGY_ID) blockers.push("UNSUPPORTED_ES_STRATEGY");
    if (!engine16) blockers.push("MISSING_ENGINE16_ES");
    if (!emaPosture || !tenMinute || !oneHour || !fourHour || !daily) {
      blockers.push("MISSING_EMA_POSTURE");
    }
    if (!permission) blockers.push("MISSING_PERMISSION");
    if (currentPrice == null) blockers.push("MISSING_CURRENT_PRICE");

    const preliminaryCurrentLifecycleWatchOnly =
      currentLifecycleIsWatchOnly(currentLifecycleState);

    // Hard permission / structure blockers.
    // Important:
    // Engine 22 currentLifecycleState watch-only states are not execution requests.
    // Do not hard-block Engine 15 just because preliminary Engine 6 permission is
    // STAND_DOWN / BLOCKED. Engine 15 must first translate Engine 22 WATCH into
    // a safe WATCH-only readiness decision, then Engine 6 can remain no-execution.
    if (permissionBlocked(permission)) {
      if (preliminaryCurrentLifecycleWatchOnly) {
        reasonCodes.push("PERMISSION_BLOCKED_PRELIMINARY_CURRENT_LIFECYCLE_WATCH_ONLY");
        reasonCodes.push("ENGINE15_WILL_TRANSLATE_ENGINE22_WATCH_ONLY_BEFORE_ENGINE6_FINAL");
      } else {
        blockers.push("PERMISSION_BLOCKED");
        reasonCodes.push("PERMISSION_BLOCKED");
      }
    }

    if (engine16Invalidated(engine16)) {
      if (preliminaryCurrentLifecycleWatchOnly) {
        reasonCodes.push("ENGINE16_INVALIDATED_CURRENT_LIFECYCLE_WATCH_CAUTION");
      } else {
        blockers.push("ENGINE16_INVALIDATED");
        reasonCodes.push("ENGINE16_INVALIDATED");
      }
    }

    const hasWaveOpportunity = hasValidW3W5Opportunity(waveOpportunity);
    const postAbcW2BounceWatch = isPostAbcW2BounceWatch(waveOpportunity);

    const possibleW5UpCompletePullbackWatch =
      isPossibleW5UpCompletePullbackWatch({
        currentLifecycleState,
        possibleW5Up,
        waveOpportunity,
      });

    const waveInvalid = waveOpportunityInvalid(waveOpportunity);
    const waveWatchOnly = waveOpportunityWatchOnly(waveOpportunity);
    const waveArming = waveOpportunityArming(waveOpportunity);
    const waveReady = waveOpportunityReady(waveOpportunity);
    const waveLate = waveOpportunityLate(waveOpportunity);
    const waveHighChase = waveOpportunityHighChaseRisk(waveOpportunity);
    const waveNeedsReclaim = waveNeedsPullbackOrReclaim(waveOpportunity);
    const currentLifecycleWatchOnly =
      currentLifecycleIsWatchOnly(currentLifecycleState);

    if (possibleW5UpCompletePullbackWatch) {
      reasonCodes.push("ENGINE15_POSSIBLE_W5_UP_COMPLETE_PULLBACK_WATCH");
      reasonCodes.push("ENGINE22_CURRENT_LIFECYCLE_STATE_CONSUMED");
      reasonCodes.push("ENGINE22_POSSIBLE_W5_UP_COMPLETE");
      reasonCodes.push("WATCH_ONLY");
      reasonCodes.push("NO_EXECUTION");
      reasonCodes.push("NO_CHASE");
      reasonCodes.push("WAIT_FOR_POST_W5_PULLBACK_REACTION");
    } else if (!waveOpportunityExists(waveOpportunity)) {
      needs.push("ENGINE22_WAVE_OPPORTUNITY");
      reasonCodes.push("ENGINE22_WAVE_OPPORTUNITY_MISSING");
    } else if (postAbcW2BounceWatch) {
      reasonCodes.push("ENGINE15_POST_ABC_BOUNCE_WATCH");
      reasonCodes.push("ENGINE22_POST_ABC_W2_BOUNCE_WATCH");
      reasonCodes.push("WATCH_ONLY");
      reasonCodes.push("NO_EXECUTION");
      reasonCodes.push("WAIT_FOR_RECLAIM_CONFIRMATION");
    } else if (!hasWaveOpportunity && !currentLifecycleWatchOnly) {
      needs.push("VALID_W3_OR_W5_OPPORTUNITY");
      reasonCodes.push("NO_W3_W5_OPPORTUNITY");
    } else if (!currentLifecycleWatchOnly) {
      reasonCodes.push("ENGINE22_WAVE_OPPORTUNITY_FOUND");
      reasonCodes.push(`ENGINE22_${waveSetupType(waveOpportunity)}`);
      reasonCodes.push(`ENGINE22_DEGREE_${waveDegree(waveOpportunity)}`);
    }

    if (waveInvalid) {
      blockers.push("ENGINE22_WAVE_OPPORTUNITY_INVALID");
      reasonCodes.push("ENGINE22_WAVE_OPPORTUNITY_INVALID");
    }

    if (
      waveWatchOnly &&
      !postAbcW2BounceWatch &&
      !possibleW5UpCompletePullbackWatch &&
      !currentLifecycleWatchOnly
    ) {
      needs.push("ENGINE22_ARMING_OR_READY");
      reasonCodes.push("ENGINE22_WAVE_OPPORTUNITY_WATCH");
    }

    if (waveLate) {
      needs.push("WAIT_FOR_PULLBACK_OR_RECLAIM");
      reasonCodes.push("ENGINE22_TIMING_LATE_NO_CHASE");
    }

    if (waveHighChase) {
      needs.push("WAIT_FOR_PULLBACK_OR_RECLAIM");
      reasonCodes.push(`ENGINE22_CHASE_RISK_${waveChaseRisk(waveOpportunity)}`);
    }

    if (waveNeedsReclaim) {
      needs.push("WAIT_FOR_PULLBACK_OR_RECLAIM");
      reasonCodes.push("ENGINE22_CONTROLLED_PULLBACK_OR_RECLAIM_REQUIRED");
    }

    if (engine23Damage.active) {
      reasonCodes.push(...engine23Damage.reasonCodes);
      needs.push(...engine23Damage.needs);
    }

    const dailyAbove = layerAboveEma10(daily);
    const dailyBelow = layerBelowEma10(daily);

    const fourHourBelow =
      layerBelowEma10(fourHour) ||
      includesAny(engine16?.regimeLayers?.trend4h?.state, ["FAILING", "BELOW"]) ||
      getTrendState(engine16?.regimeLayers?.trend4h) === "SHORT_ONLY";

    const oneHourBelow =
      layerBelowEma10(oneHour) ||
      includesAny(engine16?.regimeLayers?.pullback1h?.state, ["FAILING", "BELOW"]) ||
      getTrendState(engine16?.regimeLayers?.pullback1h) === "SHORT_ONLY";

    const tenMinuteBelow10 =
      layerBelowEma10(tenMinute) ||
      includesAny(engine16?.regimeLayers?.trigger10m?.state, ["BELOW_EMA10"]);

    const tenMinuteBelow20 =
      layerBelowEma20(tenMinute) ||
      includesAny(engine16?.regimeLayers?.trigger10m?.state, ["BELOW_EMA20"]);

    const longTrigger = tenMinuteLongTrigger({
      tenMinute,
      engine16,
    });

    const e5Reaction = getEngine5Reaction(engine5);
    const e5Volume = getEngine5Volume(engine5);
    const e5Timing = getEngine5Timing(engine5);

    const reactionOk = reactionConfirmedFromEngine5(engine5, engine3);
    const volumeOk = volumeConfirmedFromEngine5(engine5, engine4);
    const volumeRisk = volumeRiskFromEngine5(engine5, engine4);
    const lateTiming = lateTimingFromEngine5(engine5);
    const engine2Extension = activeEngine2Extension(engine2State);

    const e5Score = engine5Score(engine5);
    const e5Label = engine5Label(engine5);

    // Daily below EMA10 blocks LONG continuation only.
    // Engine 22 currentLifecycleState watch-only states are not executable,
    // so daily-below-EMA10 is caution only for those states.
    if (dailyBelow) {
      if (postAbcW2BounceWatch) {
        reasonCodes.push("DAILY_BELOW_EMA10_BOUNCE_CAUTION");
      } else if (possibleW5UpCompletePullbackWatch) {
        reasonCodes.push("DAILY_BELOW_EMA10_POST_W5_PULLBACK_CAUTION");
      } else if (currentLifecycleWatchOnly) {
        reasonCodes.push("DAILY_BELOW_EMA10_CURRENT_LIFECYCLE_WATCH_CAUTION");
      } else {
        blockers.push("DAILY_BELOW_EMA10_LONG_CONTINUATION_BLOCKED");
        reasonCodes.push("DAILY_BELOW_EMA10_LONG_PERMISSION_REDUCED");
      }
    }

    const debug = {
      currentPrice,
      emaPosture,
      engine16: {
        readiness: engine16Readiness(engine16),
        setupPosture: engine16?.setupPosture ?? null,
        directionBias: engine16?.directionBias ?? null,
        reasonCodes: Array.isArray(engine16?.reasonCodes) ? engine16.reasonCodes : [],
        needs: Array.isArray(engine16?.needs) ? engine16.needs : [],
        regimeLayers: engine16?.regimeLayers ?? null,
      },
      permission: {
        permission: pText,
        sizeMultiplier: toNum(permission?.sizeMultiplier, null),
        reasonCodes: Array.isArray(permission?.reasonCodes) ? permission.reasonCodes : [],
      },
      marketRegime,
      waveOpportunity: waveOpportunity || null,
      engine22: {
        ignored: false,
        source: currentLifecycleState
          ? "snapshotContext.engine22WaveStrategy.currentLifecycleState"
          : "snapshotContext.waveOpportunity",
        active: waveOpportunityActive(waveOpportunity),
        setupType: waveSetupType(waveOpportunity),
        degree: waveDegree(waveOpportunity),
        direction: waveDirection(waveOpportunity),
        readiness: waveReadiness(waveOpportunity),
        timing: waveTiming(waveOpportunity),
        chaseRisk: waveChaseRisk(waveOpportunity),
        needs: Array.isArray(currentLifecycleState?.needs)
          ? currentLifecycleState.needs
          : Array.isArray(waveOpportunity?.needs)
          ? waveOpportunity.needs
          : [],
        reasonCodes: Array.isArray(currentLifecycleState?.reasonCodes)
          ? currentLifecycleState.reasonCodes
          : waveOpportunityReasonCodes(waveOpportunity),
        summary:
          currentLifecycleState?.summary ||
          currentLifecycleState?.headline ||
          waveOpportunity?.summary ||
          null,
        currentLifecycleState: currentLifecycleState
          ? {
              key: currentLifecycleState?.key || null,
              headline: currentLifecycleState?.headline || null,
              summary: currentLifecycleState?.summary || null,
              action: currentLifecycleState?.action || null,
              direction: currentLifecycleState?.direction || null,
              bias: currentLifecycleState?.bias || null,
              executionBias: currentLifecycleState?.executionBias || null,
              readiness: currentLifecycleState?.readiness || null,
              setupEligible: currentLifecycleState?.setupEligible === true,
              active: currentLifecycleState?.active === true,
              readOnly: currentLifecycleState?.readOnly === true,
              noExecution: currentLifecycleState?.noExecution === true,
              tradeableOpportunityBlocked:
                currentLifecycleState?.tradeableOpportunityBlocked === true,
              paperTradeCandidate:
                currentLifecycleState?.paperTradeCandidate === true,
              paperTradeAllowedOnlyAfterConfirmation:
                currentLifecycleState?.paperTradeAllowedOnlyAfterConfirmation === true,
              needs: Array.isArray(currentLifecycleState?.needs)
                ? currentLifecycleState.needs
                : [],
              blockers: Array.isArray(currentLifecycleState?.blockers)
                ? currentLifecycleState.blockers
                : [],
              reasonCodes: Array.isArray(currentLifecycleState?.reasonCodes)
                ? currentLifecycleState.reasonCodes
                : [],
              data: currentLifecycleState?.data || null,
            }
          : null,
      },

      engine26StructuralContext: engine26StructuralContext
        ? {
            active: engine26StructuralContext.active === true,
            engine: engine26StructuralContext.engine || null,
            status: engine26StructuralContext.status || null,
            template: engine26StructuralContext.template || null,
            activeImbalanceRole:
              engine26StructuralContext.activeImbalanceRole || null,
            structuralBias: engine26StructuralContext.structuralBias || null,
            preferredDirection:
              engine26StructuralContext.preferredDirection || null,
            preferredAction:
              engine26StructuralContext.preferredAction || null,
            doNotChaseLong:
              engine26StructuralContext.doNotChaseLong === true,
            shortResearchOnly:
              engine26StructuralContext.shortResearchOnly === true,
            watchOnly: engine26StructuralContext.watchOnly === true,
            noExecution: engine26StructuralContext.noExecution === true,
            noPermissionCreated:
              engine26StructuralContext.noPermissionCreated === true,
          }
        : null,

            engine23: {
        present: engine23Damage.present,
        active: engine23Damage.active,
        state: engine23Damage.state,
        health: engine23Damage.health,
        directionBias: engine23Damage.directionBias,
        chaseAllowed: engine23Damage.chaseAllowed,
        preferredEntry: engine23Damage.preferredEntry,
        rejected: engine23Damage.rejected,
        failedAcceptance: engine23Damage.failedAcceptance,
        pattern: engine23Damage.pattern,
        levelKey: engine23Damage.levelKey,
        levelLabel: engine23Damage.levelLabel,
        level: engine23Damage.level,
        summary: engine23Damage.rawSummary || engine23Damage.summary,
        reasonCodes: engine23Damage.rawReasonCodes,
      },

      engine5: {
        score: e5Score,
        label: e5Label,
        reactionComponent: e5Reaction || null,
        volumeComponent: e5Volume || null,
        timingContext: e5Timing || null,
        timingAction: timingActionFromEngine5(engine5),
        timingEntry: timingEntryFromEngine5(engine5),
        timingChaseRisk: timingChaseRiskFromEngine5(engine5),
      },
      reactionFallback: {
        score: toNum(engine3?.reactionScore ?? engine3?.score, null),
        confirmed: engine3?.confirmed === true,
        structureState: engine3?.structureState ?? engine3?.state ?? null,
      },
      volumeFallback: {
        score: toNum(engine4?.volumeScore ?? engine4?.score, null),
        confirmed: engine4?.volumeConfirmed === true || engine4?.confirmed === true,
        state: engine4?.state ?? null,
        flags: engine4?.flags ?? null,
      },
      booleans: {
        hasWaveOpportunity,
        postAbcW2BounceWatch,
        possibleW5UpCompletePullbackWatch,
        currentLifecycleWatchOnly,
        waveInvalid,
        waveWatchOnly,
        waveArming,
        waveReady,
        waveLate,
        waveHighChase,
        waveNeedsReclaim,
        dailyAbove,
        dailyBelow,
        fourHourBelow,
        oneHourBelow,
        tenMinuteBelow10,
        tenMinuteBelow20,
        longTrigger,
        reactionOk,
        volumeOk,
        volumeRisk,
        lateTiming,
        engine2Extension,
        engine23DamageActive: engine23Damage.active,
        engine23W5Rejection: engine23Damage.w5Rejection,
        engine23LongDamaged: engine23Damage.longDamaged,
        engine23NoChase: engine23Damage.noChase,
      },
    };

    if (blockers.length > 0) {
      return buildBlockedDecision({
        symbol: sym,
        strategyId,
        permission,
        currentPrice,
        blockers,
        reasonCodes: reasonCodes.length ? reasonCodes : ["ES_READINESS_BLOCKED"],
        needs,
        debug,
      });
    }

    const fromCurrentLifecycle = buildEngine15FromEngine22CurrentLifecycleState({
      symbol: sym,
      strategyId,
      permission,
      currentPrice,
      current: currentLifecycleState,
      engine3,
      engine4,
      engine5,
      engine26StructuralContext,
      debug,
    });

    if (fromCurrentLifecycle) {
      return fromCurrentLifecycle;
    }

    if (possibleW5UpCompletePullbackWatch) {
      return buildPossibleW5UpCompletePullbackWatchDecision({
        symbol: sym,
        strategyId,
        permission,
        currentPrice,
        currentLifecycleState,
        possibleW5Up,
        waveOpportunity,
        debug,
      });
    }

    if (postAbcW2BounceWatch) {
      return buildPostAbcW2BounceWatchDecision({
        symbol: sym,
        strategyId,
        permission,
        currentPrice,
        waveOpportunity,
        dailyBelow,
        debug,
      });
    }

    // Context reason codes and next needs.
    if (dailyAbove) {
      reasonCodes.push("DAILY_ABOVE_EMA10_LONG_PERMISSION");
    } else {
      needs.push("DAILY_EMA10_PERMISSION_CONFIRMATION");
      reasonCodes.push("DAILY_EMA10_PERMISSION_UNKNOWN");
    }

    if (fourHourBelow) {
      needs.push("4H_IMPROVEMENT");
      reasonCodes.push("FOUR_HOUR_BELOW_EMA10_TREND_FAILING");
    } else {
      reasonCodes.push("FOUR_HOUR_SUPPORTIVE");
    }

    if (oneHourBelow) {
      needs.push("1H_STABILIZATION");
      reasonCodes.push("ONE_HOUR_BELOW_EMA10_PULLBACK_WEAK");
    } else {
      reasonCodes.push("ONE_HOUR_SUPPORTIVE");
    }

    if (tenMinuteBelow10 || tenMinuteBelow20 || !longTrigger) {
      needs.push("10M_RECLAIM_EMA10_EMA20");
      reasonCodes.push("TEN_MIN_BELOW_EMA10_EMA20_NO_TRIGGER");
    } else {
      reasonCodes.push("TEN_MIN_RECLAIM_OR_TRIGGER_PRESENT");
    }

    if (!reactionOk) {
      needs.push("ENGINE3_REACTION_CONFIRMATION");
      reasonCodes.push("ENGINE3_REACTION_NOT_CONFIRMED");
    } else {
      reasonCodes.push("ENGINE3_REACTION_CONFIRMED");
    }

    if (!volumeOk) {
      needs.push("ENGINE4_CLEAN_PARTICIPATION");
      reasonCodes.push("ENGINE4_CLEAN_PARTICIPATION_NOT_CONFIRMED");
    } else {
      reasonCodes.push("ENGINE4_CLEAN_PARTICIPATION_CONFIRMED");
    }

    if (volumeRisk) {
      needs.push("ENGINE4_VOLUME_RISK_CLEARANCE");
      reasonCodes.push("ENGINE4_VOLUME_RISK_PRESENT");
    }

    if (lateTiming) {
      needs.push("WAIT_FOR_PULLBACK_OR_RECLAIM");
      reasonCodes.push("ENGINE5_TIMING_POST_EXTENSION_NO_CHASE");
    }

    if (pText === "REDUCE") {
      reasonCodes.push("PERMISSION_REDUCE_ONLY");
    } else if (pText === "ALLOW") {
      reasonCodes.push("PERMISSION_ALLOW");
    } else {
      reasonCodes.push("PERMISSION_UNKNOWN");
    }

    if (engine2Extension) {
      reasonCodes.push("ENGINE2_ACTIVE_EXTENSION_CONTEXT");
    }

    const ready =
      hasWaveOpportunity &&
      waveReady &&
      !waveLate &&
      !waveHighChase &&
      !waveNeedsReclaim &&
      !engine23Damage.active &&
      dailyAbove &&
      !fourHourBelow &&
      !oneHourBelow &&
      longTrigger &&
      reactionOk &&
      volumeOk &&
      !volumeRisk &&
      !lateTiming &&
      permissionGatePassed(permission);

    const arming =
      hasWaveOpportunity &&
      waveArming &&
      !engine23Damage.active &&
      dailyAbove &&
      !fourHourBelow &&
      !oneHourBelow &&
      longTrigger &&
      reactionOk &&
      permissionGatePassed(permission) &&
      !waveInvalid;

    let readinessLabel = "NO_SETUP";
    let action = "NO_ACTION";
    let direction = "NONE";
    let executionBias = "NONE";
    let strategyType = "NONE";
    let priority = 0;
    let entryStyle = "NONE";
    let qualityScore = 0;
    let qualityGrade = "IGNORE";
    let qualityBand = "INVALID";
    let setupChain = [];
    let nextSetupType = "NONE";
    let summary = "No clean ES setup is active yet.";

    if (ready) {
      readinessLabel = "READY";

      // No live ES execution yet. Keep this as watch/paper-safe.
      action = "WATCH";
      direction = waveDirection(waveOpportunity) || "LONG";
      executionBias = "LONG_PAPER_READY";
      strategyType = waveSetupType(waveOpportunity) === "W2_TO_W3"
        ? "CONTINUATION"
        : "CONTINUATION";
      priority = 80;
      entryStyle = "FUTURES_SCALP_CONFIRMATION";
      qualityScore = Math.max(80, e5Score ?? 0);
      qualityGrade = "A";
      qualityBand = "READY";
      setupChain = [
        "ENGINE22_W3_W5_READY",
        "DAILY_PERMISSION",
        "HTF_SUPPORT",
        "10M_TRIGGER",
        "E5_REACTION_VOLUME_TIMING_CONFIRMATION",
      ];
      nextSetupType = "PAPER_READY_ONLY";
      summary =
        `${waveOpportunity?.summary || "Engine 22 confirms a valid W3/W5 opportunity."} Engine 5 confirms clean reaction and clean volume participation, timing is acceptable, and ES is paper-ready only. Live execution is not enabled.`;
    } else if (arming) {
      readinessLabel = "ARMING";
      action = "WATCH";
      direction = waveDirection(waveOpportunity) || "LONG";
      executionBias = "LONG_ARMING";
      strategyType = "CONTINUATION";
      priority = 65;
      entryStyle = "WAIT_FOR_FINAL_CONFIRMATION";
      qualityScore = e5Score ?? 60;
      qualityGrade = "WATCH";
      qualityBand = "ARMING";
      setupChain = [
        "ENGINE22_W3_W5_ARMING",
        "DAILY_LONG_PERMISSION",
        "WAIT_FOR_ENGINE5_FINAL_CONFIRMATION",
      ];
      nextSetupType = chooseNextSetupType({
        readinessLabel,
        waveNeedsReclaim,
        waveOpportunity,
        lateTiming,
        volumeOk,
        volumeRisk,
        reactionOk,
        tenMinuteTrigger: longTrigger,
      });
      summary =
        `${waveOpportunity?.summary || "Engine 22 has a W3/W5 opportunity arming."} Engine 15ES is holding this at ARMING until all confirmation gates align.`;
    } else if (hasWaveOpportunity && dailyAbove) {
      readinessLabel = "WATCH";
      action = "WATCH";
      direction = waveDirection(waveOpportunity) || "LONG";
      executionBias = engine23Damage.active
        ? "LONG_DAMAGED_WATCH_ONLY"
        : "LONG_WATCH_ONLY";
      strategyType = "CONTINUATION";
      priority = engine23Damage.active ? 40 : 45;
      entryStyle =
        engine23Damage.active
          ? "WAIT_FOR_EXTENSION_RECLAIM_OR_DOWNSIDE_CONFIRMATION"
          : waveNeedsReclaim || lateTiming
          ? "WAIT_FOR_PULLBACK_OR_RECLAIM"
          : "WAIT_FOR_RECLAIM";
      qualityScore = e5Score ?? 45;
      qualityGrade = "CAUTION";
      qualityBand = "WATCH";
      setupChain = [
        "ENGINE22_W3_W5_WATCH",
        "DAILY_LONG_PERMISSION",
        "WAIT_FOR_ENGINE5_OR_WAVE_CONFIRMATION",
      ];
      nextSetupType = engine23Damage.active
        ? "WAIT_FOR_EXTENSION_RECLAIM_OR_DOWNSIDE_CONFIRMATION"
        : chooseNextSetupType({
            readinessLabel,
            waveNeedsReclaim,
            waveOpportunity,
            lateTiming,
            volumeOk,
            volumeRisk,
            reactionOk,
            tenMinuteTrigger: longTrigger,
          });

      summary = engine23Damage.active
        ? `${waveOpportunity?.summary || "Engine 22 found a valid W3/W5 opportunity."} ${engine23Damage.summary}`
        : buildWatchSummary({
            waveOpportunity,
            dailyAbove,
            fourHourBelow,
            oneHourBelow,
            tenMinuteBelow10,
            tenMinuteBelow20,
            longTrigger,
            reactionOk,
            volumeOk,
            volumeRisk,
            lateTiming,
            engine5Timing: e5Timing,
            e5Reaction,
            e5Volume,
          });
    } else if (!hasWaveOpportunity) {
      readinessLabel = "NO_SETUP";
      action = "NO_ACTION";
      direction = "NONE";
      executionBias = "NONE";
      strategyType = "NONE";
      priority = 0;
      entryStyle = "NONE";
      qualityScore = e5Score ?? 0;
      qualityGrade = "IGNORE";
      qualityBand = "INVALID";
      setupChain = ["NO_VALID_W3_W5_OPPORTUNITY"];
      nextSetupType = "WAIT_FOR_ENGINE22_W3_W5_OPPORTUNITY";
      summary =
        "Engine 22 has not confirmed a valid Elliott Wave 3 or Wave 5 opportunity. Engine 15ES will not create a trade without a W3/W5 setup.";
    } else {
      readinessLabel = "NO_SETUP";
      action = "NO_ACTION";
      direction = "NONE";
      executionBias = "NONE";
      strategyType = "NONE";
      priority = 0;
      entryStyle = "NONE";
      qualityScore = e5Score ?? 0;
      qualityGrade = "IGNORE";
      qualityBand = "INVALID";
      setupChain = ["NO_DAILY_LONG_PERMISSION"];
      nextSetupType = "WAIT_FOR_DAILY_PERMISSION";
      summary =
        "ES does not have a clean daily long permission setup yet. Stand by until higher-timeframe permission improves.";
    }

    return {
      ok: true,
      engine: ENGINE,
      symbol: sym,
      strategyId,

      strategyType,
      direction,
      readinessLabel,
      executionBias,
      action,
      priority,
      entryStyle,
      active: false,
      freshEntryNow: false,

      reasonCodes: unique(reasonCodes),
      blockers: [],
      conflicts: [],

      needs: unique(needs),
      summary,

      qualityGatePassed: reactionOk && volumeOk && !volumeRisk && !lateTiming,
      momentumGatePassed: longTrigger,
      permissionGatePassed: permissionGatePassed(permission),

      qualityScore,
      qualityGrade,
      qualityBand,
      qualityBreakdown: {
        engine5Score: e5Score,
        engine5Label: e5Label,

        waveOpportunityActive: waveOpportunityActive(waveOpportunity),
        waveSetupType: waveSetupType(waveOpportunity),
        waveRawSetup: waveRawSetup(waveOpportunity),
        waveDegree: waveDegree(waveOpportunity),
        waveDirection: waveDirection(waveOpportunity),
        waveReadiness: waveReadiness(waveOpportunity),
        waveTiming: waveTiming(waveOpportunity),
        waveChaseRisk: waveChaseRisk(waveOpportunity),
        waveNeedsReclaim,

        dailyAboveEma10: dailyAbove,
        fourHourAboveEma10: !fourHourBelow,
        oneHourAboveEma10: !oneHourBelow,
        tenMinuteAboveEma10: !tenMinuteBelow10,
        tenMinuteAboveEma20: !tenMinuteBelow20,
        tenMinuteTrigger: longTrigger,

        reactionConfirmed: reactionOk,
        reactionDirection: reactionDirectionFromEngine5(engine5, engine3),
        reactionQuality: reactionQualityFromEngine5(engine5, engine3),

        volumeConfirmed: volumeOk,
        cleanVolumeParticipation: volumeOk && !volumeRisk,
        volumeRisk,

        lateTiming,
        timingEntry: timingEntryFromEngine5(engine5),
        timingChaseRisk: timingChaseRiskFromEngine5(engine5),
        timingAction: timingActionFromEngine5(engine5),

        extensionContext: engine2Extension,

        engine23DamageActive: engine23Damage.active,
        engine23State: engine23Damage.state,
        engine23DirectionBias: engine23Damage.directionBias,
        engine23W5Rejection: engine23Damage.w5Rejection,
        engine23LongDamaged: engine23Damage.longDamaged,
        engine23NoChase: engine23Damage.noChase,
        engine23Rejected: engine23Damage.rejected,
        engine23FailedAcceptance: engine23Damage.failedAcceptance,
        engine23ExtensionLevelLabel: engine23Damage.levelLabel,
        engine23ExtensionLevel: engine23Damage.level,
      },

      permission: pText,
      sizeMultiplier: toNum(permission?.sizeMultiplier, null),

      setupChain,
      nextSetupType,
      primaryExhaustionTF: null,

      signalEvent: buildSignalEvent(),

      lifecycle: buildLifecycle({
        currentPrice,
        nextFocus: nextSetupType,
        lifecycleStage: readinessLabel === "READY" ? "PAPER_READY" : readinessLabel,
      }),

      futures: {
        tickSize: ES_TICK_SIZE,
        liveExecutionEnabled: false,
        paperOnly: true,
      },

      debug,
    };
  } catch (err) {
    return {
      ok: false,
      engine: ENGINE,
      symbol,
      strategyId,

      strategyType: "NONE",
      direction: "NONE",
      readinessLabel: "BLOCKED",
      executionBias: "NONE",
      action: "BLOCKED",
      priority: 0,
      entryStyle: "NONE",
      active: false,
      freshEntryNow: false,

      reasonCodes: ["ENGINE15_ES_ERROR"],
      blockers: [String(err?.message || err)],
      conflicts: [],

      needs: ["FIX_ENGINE15_ES_ERROR"],
      summary: "Engine 15ES failed while building the ES readiness decision.",

      qualityGatePassed: false,
      momentumGatePassed: false,
      permissionGatePassed: false,

      qualityScore: 0,
      qualityGrade: "IGNORE",
      qualityBand: "INVALID",
      qualityBreakdown: {},

      permission: "UNKNOWN",
      sizeMultiplier: null,

      setupChain: [],
      nextSetupType: "NONE",
      primaryExhaustionTF: null,

      signalEvent: buildSignalEvent(),

      lifecycle: buildLifecycle({
        currentPrice: null,
        nextFocus: "FIX_ENGINE15_ES_ERROR",
        lifecycleStage: "ERROR",
      }),

      futures: {
        tickSize: ES_TICK_SIZE,
        liveExecutionEnabled: false,
        paperOnly: true,
      },

      debug: {
        error: String(err?.message || err),
        stack: String(err?.stack || ""),
      },
    };
  }
}

/**
 * Backward-compatible wrapper for the earlier draft signature:
 * buildEngine15EsDecisionFromSnapshot(esSnapshot, strategyId)
 *
 * Use this only if calling after the final snapshot object exists.
 */
export function buildEngine15EsDecisionFromSnapshot(
  esSnapshot,
  strategyId = DEFAULT_STRATEGY_ID
) {
  const scalp = esSnapshot?.strategies?.[strategyId] || null;
  const engine22WaveStrategy = scalp?.engine22WaveStrategy || null;
  const engine23Interpretation = scalp?.engine23Interpretation || null;

  return buildEngine15EsDecision({
    symbol: esSnapshot?.symbol || "ES",
    strategyId,
    snapshotContext: {
      emaPosture: esSnapshot?.emaPosture || null,
      engine2State: esSnapshot?.engine2State || null,
      marketMind: esSnapshot?.marketMind || null,
      marketMeter: esSnapshot?.marketMeter || null,
      marketRegime: esSnapshot?.marketRegime || null,
      engine22WaveStrategy,
      waveOpportunity: engine22WaveStrategy?.waveOpportunity || null,
      engine23Interpretation,
    },
    engine16: scalp?.engine16 || null,
    engine5: scalp?.confluence || null,
    momentum: scalp?.momentum || esSnapshot?.momentum || null,
    permission: scalp?.permission || null,
    engine3: scalp?.confluence?.context?.reaction || null,
    engine4: scalp?.confluence?.context?.volume || null,
    zoneContext: scalp?.context || null,
  });
}

export default buildEngine15EsDecision;
