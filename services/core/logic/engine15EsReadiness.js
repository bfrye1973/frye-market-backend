// services/core/logic/engine15EsReadiness.js
//
// Engine 15ES — ES Futures Readiness Referee
//
// v1.2
// - ES-only readiness shell
// - Does NOT place orders
// - Does NOT replace Engine 16ES
// - Does NOT use Engine 22 because ES Engine 22 strategy is not built yet
// - Does NOT hard-code Elliott wave scenarios
//
// Authority model:
// - Engine 3 = raw reaction facts
// - Engine 4 = raw volume / participation facts
// - Engine 5 = normalized confluence + reaction / volume / timing verdicts
// - Engine 15ES = final ES setup referee
// - Engine 6 = final permission gate
//
// Main upgrade in v1.2:
// - Engine 15ES now uses Engine 5 normalized component verdicts first:
//   - engine5.components.engine3Reaction
//   - engine5.components.engine4Volume
//   - engine5.timingContext
//   - engine5.analytics.engine5.timingContext
// - Raw Engine 3 / Engine 4 remain fallback/debug only.
// - Engine 5 timing context can say the move already happened, post-extension,
//   late chase, or wait for pullback/reclaim. Engine 15ES must respect that.
//
// Main purpose:
// Engine 15ES answers:
// Is ES ready, watch-only, blocked, or waiting — and what exactly does the trader need next?

const ENGINE = "engine15.esReadiness.v1.2";
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

function getCurrentPrice({ emaPosture, engine16, zoneContext }) {
  return (
    toNum(emaPosture?.tenMinute?.close) ??
    toNum(engine16?.regimeLayers?.trigger10m?.close) ??
    toNum(zoneContext?.meta?.current_price) ??
    toNum(zoneContext?.meta?.currentPrice) ??
    null
  );
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

function chooseNextSetupType({
  readinessLabel,
  lateTiming,
  volumeOk,
  volumeRisk,
  reactionOk,
  tenMinuteTrigger,
}) {
  if (readinessLabel === "READY") return "PAPER_READY_ONLY";
  if (lateTiming) return "WAIT_FOR_PULLBACK_OR_RECLAIM";
  if (!tenMinuteTrigger) return "WAIT_FOR_10M_RECLAIM";
  if (!reactionOk) return "WAIT_FOR_ENGINE3_REACTION";
  if (!volumeOk) return "WAIT_FOR_ENGINE4_CLEAN_PARTICIPATION";
  if (volumeRisk) return "WAIT_FOR_VOLUME_RISK_CLEARANCE";
  return "WAIT_FOR_CONFIRMATION";
}

function buildWatchSummary({
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

  if (dailyAbove) {
    parts.push("Daily still allows long ES ideas");
  } else {
    parts.push("Daily does not yet provide clean long permission");
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

    const tenMinute = emaPosture?.tenMinute || null;
    const oneHour = emaPosture?.oneHour || null;
    const fourHour = emaPosture?.fourHour || null;
    const daily = emaPosture?.daily || null;

    const currentPrice = getCurrentPrice({
      emaPosture,
      engine16,
      zoneContext,
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

    // Hard permission / structure blockers.
    if (permissionBlocked(permission)) {
      blockers.push("PERMISSION_BLOCKED");
      reasonCodes.push("PERMISSION_BLOCKED");
    }

    if (engine16Invalidated(engine16)) {
      blockers.push("ENGINE16_INVALIDATED");
      reasonCodes.push("ENGINE16_INVALIDATED");
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

    // For v1.2, daily below EMA10 blocks LONG continuation only.
    if (dailyBelow) {
      blockers.push("DAILY_BELOW_EMA10_LONG_CONTINUATION_BLOCKED");
      reasonCodes.push("DAILY_BELOW_EMA10_LONG_PERMISSION_REDUCED");
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
      },
      engine22: {
        ignored: true,
        reason: "ES Engine 22 strategy has not been built yet.",
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

    // Important: do not inspect existing engine22Scalp.
    // The current ES snapshot may carry the SPY Engine 22 object.
    reasonCodes.push("ENGINE22_ES_NOT_BUILT_YET");

    const ready =
      dailyAbove &&
      !fourHourBelow &&
      !oneHourBelow &&
      longTrigger &&
      reactionOk &&
      volumeOk &&
      !volumeRisk &&
      !lateTiming &&
      permissionGatePassed(permission);

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
      direction = "LONG";
      executionBias = "LONG_PAPER_READY";
      strategyType = "CONTINUATION";
      priority = 80;
      entryStyle = "FUTURES_SCALP_CONFIRMATION";
      qualityScore = Math.max(80, e5Score ?? 0);
      qualityGrade = "A";
      qualityBand = "READY";
      setupChain = [
        "DAILY_PERMISSION",
        "HTF_SUPPORT",
        "10M_TRIGGER",
        "E5_REACTION_VOLUME_TIMING_CONFIRMATION",
      ];
      nextSetupType = "PAPER_READY_ONLY";
      summary =
        "ES has daily long permission, supportive 4H/1H posture, a 10m reclaim/trigger, Engine 5 confirms clean reaction and clean volume participation, and Engine 5 timing does not show post-extension chase risk. Paper-ready only; live execution is not enabled.";
    } else if (dailyAbove) {
      readinessLabel = "WATCH";
      action = "WATCH";
      direction = "LONG";
      executionBias = "LONG_WATCH_ONLY";
      strategyType = "CONTINUATION";
      priority = 45;
      entryStyle = lateTiming ? "WAIT_FOR_PULLBACK_OR_RECLAIM" : "WAIT_FOR_RECLAIM";
      qualityScore = e5Score ?? 45;
      qualityGrade = "CAUTION";
      qualityBand = "WATCH";
      setupChain = [
        "DAILY_LONG_PERMISSION",
        "LOWER_TF_OR_CONFIRMATION_NOT_READY",
        "WAIT_FOR_ENGINE5_CONFIRMATION",
      ];
      nextSetupType = chooseNextSetupType({
        readinessLabel,
        lateTiming,
        volumeOk,
        volumeRisk,
        reactionOk,
        tenMinuteTrigger: longTrigger,
      });
      summary = buildWatchSummary({
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

  return buildEngine15EsDecision({
    symbol: esSnapshot?.symbol || "ES",
    strategyId,
    snapshotContext: {
      emaPosture: esSnapshot?.emaPosture || null,
      engine2State: esSnapshot?.engine2State || null,
      marketMind: esSnapshot?.marketMind || null,
      marketMeter: esSnapshot?.marketMeter || null,
      marketRegime: esSnapshot?.marketRegime || null,
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
