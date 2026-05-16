// services/core/logic/engine15EsReadiness.js

const ENGINE = "engine15.esReadiness.v1";
const DEFAULT_STRATEGY_ID = "intraday_scalp@10m";
const ES_TICK_SIZE = 0.25;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function includesAny(value, tokens = []) {
  const text = String(value || "").toUpperCase();
  return tokens.some((token) => text.includes(String(token).toUpperCase()));
}

function getNested(obj, path, fallback = undefined) {
  try {
    return path.split(".").reduce((acc, key) => acc?.[key], obj) ?? fallback;
  } catch {
    return fallback;
  }
}

function postureText(value) {
  return String(value || "").toUpperCase();
}

function isAboveEma10(value) {
  return includesAny(value, ["ABOVE_EMA10", "ABOVE_10"]);
}

function isBelowEma10(value) {
  return includesAny(value, ["BELOW_EMA10", "BELOW_10"]);
}

function isBelowEma20(value) {
  return includesAny(value, ["BELOW_EMA20", "BELOW_20"]);
}

function permissionBlocked(permission) {
  if (!permission) return false;

  if (permission.allowed === false) return true;
  if (permission.canTrade === false) return true;
  if (permission.tradeAllowed === false) return true;
  if (permission.status === "BLOCKED") return true;
  if (permission.state === "BLOCKED") return true;

  return false;
}

function engine16Invalidated(engine16) {
  const state = postureText(engine16?.state);
  const readiness = postureText(engine16?.readinessLabel);

  if (engine16?.invalidated === true) return true;
  if (includesAny(state, ["INVALIDATED", "FAILED", "BROKEN"])) return true;
  if (includesAny(readiness, ["BLOCKED", "STAND_DOWN"])) return true;

  return false;
}

function hasLongTrigger(engine16, emaPosture) {
  const tenMinute = postureText(emaPosture?.tenMinute);
  const state = postureText(engine16?.state);
  const readiness = postureText(engine16?.readinessLabel);

  const explicitLongTrigger =
    engine16?.triggerConfirmed === true &&
    postureText(engine16?.triggerDirection || engine16?.direction) === "LONG";

  const continuationTrigger =
    engine16?.continuationTriggerLong === true ||
    engine16?.exhaustionTriggerLong === true;

  const reclaimedByState = includesAny(state, [
    "RECLAIM",
    "TRIGGER",
    "READY",
    "CONFIRMED",
    "ABOVE_EMA10",
    "ABOVE_EMA20",
  ]);

  const readyByLabel = includesAny(readiness, [
    "READY",
    "CONFIRMED",
    "TRIGGERED",
  ]);

  const above10m = isAboveEma10(tenMinute);

  return explicitLongTrigger || continuationTrigger || reclaimedByState || readyByLabel || above10m;
}

function reactionConfirmed(reaction) {
  if (!reaction) return false;

  const state = postureText(reaction.state);
  const quality = postureText(reaction.quality);
  const direction = postureText(reaction.direction);

  if (reaction.confirmed === true) return true;
  if (Number(reaction.score || reaction.reactionScore || 0) >= 65) return true;
  if (includesAny(state, ["CONFIRMED", "BUYING", "ACCUMULATION", "SUPPORT"])) return true;
  if (includesAny(quality, ["GOOD", "STRONG", "HIGH"])) return true;
  if (direction === "LONG") return true;

  return false;
}

function volumeConfirmed(volume) {
  if (!volume) return false;

  const state = postureText(volume.state);
  const quality = postureText(volume.quality);
  const participationState = postureText(volume.participationState);
  const breakoutState = postureText(volume.breakoutParticipation?.state);

  if (volume.confirmed === true) return true;
  if (volume.breakoutParticipation?.confirmed === true) return true;
  if (Number(volume.score || 0) >= 8) return true;
  if (Number(volume.relativeVolume || 0) >= 1.2) return true;

  if (
    includesAny(state, ["PARTICIPATION", "IGNITION", "EXPANSION"]) ||
    includesAny(quality, ["GOOD", "STRONG", "HIGH"]) ||
    includesAny(participationState, ["PARTICIPATION", "EXPANSION"]) ||
    includesAny(breakoutState, ["PARTICIPATION", "CONFIRMED"])
  ) {
    return true;
  }

  return false;
}

function hasActiveEngine2Extension(engine2State) {
  if (!engine2State) return false;

  if (engine2State?.activeExtensions?.scalp) return true;
  if (engine2State?.activeExtensions?.intraday) return true;
  if (engine2State?.waveExtension?.scalp?.active) return true;
  if (engine2State?.waveExtension?.minute?.active) return true;

  const reasonCodes = asArray(engine2State?.reasonCodes);
  return reasonCodes.some((code) =>
    includesAny(code, ["ACTIVE_W5_EXTENSION", "ACTIVE_SCALP_EXTENSION", "EXTENSION"])
  );
}

function buildBlockedDecision({
  symbol,
  strategyId,
  permission,
  blockers,
  reasonCodes,
  debug,
}) {
  return {
    ok: true,
    engine: ENGINE,
    symbol,
    strategyId,
    strategyType: "NONE",
    direction: "NONE",
    readinessLabel: "BLOCKED",
    executionBias: "BLOCKED",
    action: "BLOCKED",
    priority: "LOW",
    entryStyle: "NO_ENTRY",
    freshEntryNow: false,

    reasonCodes,
    blockers,
    conflicts: blockers,

    needs: ["RESOLVE_BLOCKERS"],

    qualityGatePassed: false,
    momentumGatePassed: false,
    permissionGatePassed: false,

    qualityScore: 0,
    qualityGrade: "BLOCKED",
    qualityBand: "BLOCKED",
    qualityBreakdown: {},

    grade: "BLOCKED",
    permission: permission || null,
    sizeMultiplier: 0,

    setupChain: [],
    nextSetupType: "NONE",
    primaryExhaustionTF: null,
    signalEvent: null,

    summary: "ES Engine 15 is blocked because required permission, structure, or snapshot data is missing or invalid.",
    lifecycle: "BLOCKED",

    futures: {
      tickSize: ES_TICK_SIZE,
    },

    debug,
  };
}

export function buildEngine15EsDecision(esSnapshot, strategyId = DEFAULT_STRATEGY_ID) {
  const symbol = "ES";
  const scalp = esSnapshot?.strategies?.[strategyId];

  const blockers = [];
  const conflicts = [];
  const needs = [];
  const reasonCodes = [];

  const emaPosture = esSnapshot?.emaPosture;
  const engine2State = esSnapshot?.engine2State;
  const engine16 = scalp?.engine16;
  const reaction = getNested(scalp, "confluence.context.reaction", null);
  const volume = getNested(scalp, "confluence.context.volume", null);
  const permission = scalp?.permission;
  const engine22 = scalp?.engine22Scalp || scalp?.engine22 || null;

  const currentPrice =
    esSnapshot?.currentPrice ??
    esSnapshot?.price ??
    scalp?.currentPrice ??
    engine16?.latestClose ??
    null;

  const debug = {
    currentPrice,
    emaPosture,
    engine16State: engine16?.state || null,
    engine16Readiness: engine16?.readinessLabel || null,
    engine16TrendState1h: engine16?.trendState_1h || null,
    engine16TrendState4h: engine16?.trendState_4h || null,
    reactionState: reaction?.state || null,
    reactionScore: reaction?.score ?? reaction?.reactionScore ?? null,
    volumeState: volume?.state || null,
    volumeScore: volume?.score ?? null,
    engine22Present: Boolean(engine22),
  };

  // Critical data checks.
  if (!esSnapshot) blockers.push("MISSING_ES_SNAPSHOT");
  if (!scalp) blockers.push("MISSING_INTRADAY_SCALP_10M");
  if (!currentPrice) blockers.push("MISSING_CURRENT_PRICE");
  if (!engine16) blockers.push("MISSING_ENGINE16_ES");
  if (!emaPosture) blockers.push("MISSING_EMA_POSTURE");
  if (!permission) blockers.push("MISSING_PERMISSION");

  if (blockers.length > 0) {
    reasonCodes.push("CRITICAL_ES_DATA_MISSING");
    return buildBlockedDecision({
      symbol,
      strategyId,
      permission,
      blockers,
      reasonCodes,
      debug,
    });
  }

  const tenMinute = postureText(emaPosture?.tenMinute);
  const oneHour = postureText(emaPosture?.oneHour);
  const daily = postureText(emaPosture?.daily);
  const fourHour = postureText(engine16?.trendState_4h || emaPosture?.fourHour);

  const dailyAbove = isAboveEma10(daily);
  const dailyBelow = isBelowEma10(daily);
  const oneHourBelow = isBelowEma10(oneHour) || includesAny(engine16?.trendState_1h, ["BELOW", "WEAK", "FAILING"]);
  const tenMinuteBelow10 = isBelowEma10(tenMinute);
  const tenMinuteBelow20 = isBelowEma20(tenMinute) || includesAny(engine16?.state, ["BELOW_EMA20"]);
  const fourHourMissing = !fourHour;
  const fourHourWeak = includesAny(fourHour, ["BELOW", "WEAK", "FAILING", "PULLBACK"]);

  const longTrigger = hasLongTrigger(engine16, emaPosture);
  const reactionOk = reactionConfirmed(reaction);
  const volumeOk = volumeConfirmed(volume);
  const engine2Extension = hasActiveEngine2Extension(engine2State);

  // Hard blockers.
  if (permissionBlocked(permission)) {
    blockers.push("PERMISSION_BLOCKED");
    reasonCodes.push("PERMISSION_EXPLICITLY_BLOCKED");
  }

  if (engine16Invalidated(engine16)) {
    blockers.push("ENGINE16_INVALIDATED");
    reasonCodes.push("ENGINE16_STRUCTURE_INVALIDATED");
  }

  if (dailyBelow) {
    blockers.push("DAILY_BELOW_EMA10_LONG_CONTINUATION_BLOCKED");
    reasonCodes.push("DAILY_BELOW_EMA10_LONG_PERMISSION_REDUCED");
  }

  if (blockers.length > 0) {
    return buildBlockedDecision({
      symbol,
      strategyId,
      permission,
      blockers,
      reasonCodes,
      debug,
    });
  }

  // Context reasons.
  if (dailyAbove) {
    reasonCodes.push("DAILY_ABOVE_EMA10_LONG_PERMISSION");
  } else {
    needs.push("DAILY_EMA10_CONFIRMATION");
    reasonCodes.push("DAILY_EMA10_PERMISSION_UNKNOWN");
  }

  if (oneHourBelow) {
    needs.push("1H_STABILIZATION");
    reasonCodes.push("ONE_HOUR_BELOW_EMA10_PULLBACK_WEAK");
  } else {
    reasonCodes.push("ONE_HOUR_NOT_WEAK");
  }

  if (fourHourMissing) {
    needs.push("4H_CONFIRMATION_PENDING");
    reasonCodes.push("FOUR_HOUR_NOT_AVAILABLE");
  } else if (fourHourWeak) {
    needs.push("4H_IMPROVEMENT");
    reasonCodes.push("FOUR_HOUR_WEAK_OR_PULLBACK");
  } else {
    reasonCodes.push("FOUR_HOUR_SUPPORTIVE");
  }

  if (tenMinuteBelow10 || tenMinuteBelow20 || !longTrigger) {
    needs.push("10M_RECLAIM_EMA10_EMA20");
    reasonCodes.push("TEN_MIN_BELOW_EMA10_NO_TRIGGER");
  } else {
    reasonCodes.push("TEN_MIN_TRIGGER_OR_RECLAIM_PRESENT");
  }

  if (!reactionOk) {
    needs.push("ENGINE3_REACTION_CONFIRMATION");
    reasonCodes.push("ENGINE3_REACTION_NOT_CONFIRMED");
  } else {
    reasonCodes.push("ENGINE3_REACTION_CONFIRMED");
  }

  if (!volumeOk) {
    needs.push("ENGINE4_PARTICIPATION");
    reasonCodes.push("ENGINE4_PARTICIPATION_NOT_CONFIRMED");
  } else {
    reasonCodes.push("ENGINE4_PARTICIPATION_CONFIRMED");
  }

  if (engine2Extension) {
    reasonCodes.push("ENGINE2_ACTIVE_SCALP_EXTENSION_CONTEXT");
  }

  if (!engine22) {
    reasonCodes.push("ENGINE22_ES_NOT_AVAILABLE_YET");
  }

  const readyConditions =
    dailyAbove &&
    longTrigger &&
    !oneHourBelow &&
    !fourHourWeak &&
    !fourHourMissing &&
    reactionOk &&
    volumeOk;

  const watchConditions =
    dailyAbove ||
    oneHourBelow ||
    tenMinuteBelow10 ||
    tenMinuteBelow20 ||
    engine2Extension ||
    !reactionOk ||
    !volumeOk;

  let readinessLabel = "NO_SETUP";
  let action = "NO_ACTION";
  let direction = "NONE";
  let executionBias = "NO_BIAS";
  let strategyType = "NONE";
  let priority = "LOW";
  let entryStyle = "NO_ENTRY";
  let qualityGrade = "NO_SETUP";
  let qualityBand = "NO_SETUP";
  let grade = "NO_SETUP";
  let qualityScore = 0;
  let lifecycle = "NO_SETUP";
  let summary = "No clean ES setup is active yet.";

  if (readyConditions) {
    readinessLabel = "READY";
    action = "PAPER_READY";
    direction = "LONG";
    executionBias = "LONG_PAPER_READY";
    strategyType = "CONTINUATION";
    priority = "HIGH";
    entryStyle = "FUTURES_SCALP_CONFIRMATION";
    qualityGrade = "READY";
    qualityBand = "HIGH";
    grade = "READY";
    qualityScore = 80;
    lifecycle = "READY";
    summary =
      "ES has long permission, 10m trigger/reclaim, supportive 1H/4H posture, and reaction/participation confirmation. Paper-ready only; live execution is not enabled.";
  } else if (watchConditions) {
    readinessLabel = "WATCH";
    action = "WATCH";
    direction = dailyAbove ? "LONG" : "NONE";
    executionBias = dailyAbove ? "LONG_WATCH_ONLY" : "WATCH_ONLY";
    strategyType = dailyAbove ? "CONTINUATION" : "NONE";
    priority = "MEDIUM";
    entryStyle = "WAIT_FOR_RECLAIM";
    qualityGrade = "CAUTION";
    qualityBand = "WATCH";
    grade = "CAUTION";
    qualityScore = 45;
    lifecycle = "WATCH";

    if (fourHourMissing) {
      summary =
        "Daily still allows long ES ideas, but 1H is weak and 4H confirmation is pending. 10m has not fully confirmed a reclaim yet, so there is no clean ES long entry.";
    } else {
      summary =
        "Daily still allows long ES ideas, but 1H/4H are weak and 10m has not reclaimed EMA10/EMA20. No clean ES long entry yet.";
    }
  }

  // Remove duplicate needs/reasons while preserving order.
  const uniqueNeeds = [...new Set(needs)];
  const uniqueReasonCodes = [...new Set(reasonCodes)];

  return {
    ok: true,
    engine: ENGINE,
    symbol,
    strategyId,

    strategyType,
    direction,
    readinessLabel,
    executionBias,
    action,
    priority,
    entryStyle,
    freshEntryNow: false,

    reasonCodes: uniqueReasonCodes,
    blockers,
    conflicts,

    needs: uniqueNeeds,

    qualityGatePassed: reactionOk,
    momentumGatePassed: longTrigger,
    permissionGatePassed: !permissionBlocked(permission),

    qualityScore,
    qualityGrade,
    qualityBand,
    qualityBreakdown: {
      dailyAbove,
      oneHourBelow,
      fourHourMissing,
      fourHourWeak,
      tenMinuteBelow10,
      tenMinuteBelow20,
      longTrigger,
      reactionOk,
      volumeOk,
      engine2Extension,
    },

    grade,
    permission,
    sizeMultiplier: readinessLabel === "READY" ? 0.25 : 0,

    setupChain: uniqueReasonCodes,
    nextSetupType: readinessLabel === "WATCH" ? "WAIT_FOR_10M_RECLAIM" : "NONE",
    primaryExhaustionTF: null,
    signalEvent: null,

    summary,
    lifecycle,

    futures: {
      tickSize: ES_TICK_SIZE,
      liveExecutionEnabled: false,
      paperOnly: readinessLabel === "READY",
    },

    debug,
  };
}

export default buildEngine15EsDecision;
