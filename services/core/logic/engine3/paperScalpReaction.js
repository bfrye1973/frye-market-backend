// services/core/logic/engine3/paperScalpReaction.js
//
// Engine 3 — Strategy 1 canonical PAPER_ONLY reaction contract.
//
// LONG-RUN STRATEGY 1 OWNERSHIP
// - Engine 26 owns WHERE: candidate identity + exact negotiated zone + lifecycle.
// - Engine 3 owns WHAT PRICE DID THERE.
// - 1m is WATCH / DISPLAY ONLY. It never creates, flips, confirms, or invalidates
//   canonical Engine 3 direction.
// - 5m is the primary mature reaction-direction evidence layer.
// - Book-language reaction state is calculated ONLY against the exact Engine 26
//   negotiated zone. No nearest EMA/wave/shelf/prior-high-low reference search.
// - 10m is broader price confirmation of the 5m direction. Initial direction is
//   established only when completed 5m + completed 10m agree.
// - Engine 4 owns participation / volume confirmation.
// - Engine 6 owns final PAPER permission.
//
// TRAVEL / PERSISTENCE
// - Once an established Strategy 1 direction leaves the negotiated zone, 1m/5m
//   are diagnostic only and cannot flip canonical direction.
// - SHORT remains SHORT until either Engine 26 starts a fresh lifecycle (target
//   midpoint completion / new candidate) OR a completed 10m close is ABOVE EMA10.
// - LONG remains LONG until either Engine 26 starts a fresh lifecycle OR a
//   completed 10m close is BELOW EMA10.
// - EMA10 NEVER creates the initial direction.
//
// BOOK-LANGUAGE STATES (exact Engine 26 negotiated zone only)
// WICK_BELOW_AND_RECLAIM, DIP_BOUGHT_FAST, SELLERS_TRAPPED,
// HELD_LEVEL, RECLAIMED_LEVEL, LOST_LEVEL, FAILED_RECLAIM,
// ACCEPTING_VALUE, REJECTING_VALUE, BREAKOUT_HOLDING,
// BREAKOUT_FAILING, CHOP_INSIDE_VALUE, NO_SIGNAL.
//
// IMPORTANT DESIGN RULE
// A semantic state is descriptive evidence, NOT an automatic LONG/SHORT veto.
// 5m direction comes from completed 5m price sequence. 10m confirmation comes
// from completed 10m price sequence. Book state explains what happened at the
// negotiated zone and remains visible on the timeline.
//
// Output path:
// confluence.context.reaction.paperScalpReaction

import { buildEngine22DegreeWaveContext } from "./engine22DegreeWaveContext.js";
import { deriveCandleCompletionTruth } from "./candleCompletionTruth.js";
import { buildEngine26LocationReactionContext } from "./engine26LocationReactionContext.js";

const ENGINE = "engine3.paperScalpReaction.v7";
const SOURCE = "engine3.strategy1.negotiatedZoneReaction";

const TARGET_MODEL = {
  instrument: "ES",
  targetPoints: 10,
  exitModel: "THREE_BLOCKS",
};

function safeUpper(value, fallback = "NONE") {
  const text = String(value ?? "").trim();
  return text ? text.toUpperCase() : fallback;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function barNumber(bar, ...keys) {
  if (!bar || typeof bar !== "object") return null;
  for (const key of keys) {
    const value = toNum(bar?.[key]);
    if (value != null) return value;
  }
  return null;
}

function barOpen(bar) {
  return barNumber(bar, "open", "o");
}

function barHigh(bar) {
  return barNumber(bar, "high", "h");
}

function barLow(bar) {
  return barNumber(bar, "low", "l");
}

function barClose(bar) {
  return barNumber(bar, "close", "c");
}

function barTime(bar) {
  return bar?.time ?? bar?.t ?? bar?.tSec ?? null;
}

function getEngine22Direction(engine22WaveStrategy) {
  return safeUpper(
    engine22WaveStrategy?.currentLifecycleState?.confirmationContext?.direction ||
      engine22WaveStrategy?.currentLifecycleState?.direction ||
      engine22WaveStrategy?.waveOpportunity?.direction ||
      engine22WaveStrategy?.direction ||
      "NONE",
    "NONE"
  );
}

function normalizeZone(handoff = null) {
  const sources = [handoff?.zone, handoff?.negotiatedZone];

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    const rawLo = validPrice(source?.lo ?? source?.low ?? source?.zoneLo);
    const rawHi = validPrice(source?.hi ?? source?.high ?? source?.zoneHi);

    if (rawLo == null || rawHi == null) continue;

    const lo = Math.min(rawLo, rawHi);
    const hi = Math.max(rawLo, rawHi);
    const mid =
      validPrice(source?.mid ?? source?.zoneMid) ??
      Number(((lo + hi) / 2).toFixed(2));

    return {
      lo,
      hi,
      mid,
      type: source?.type ?? "NEGOTIATED",
      timeframe: source?.timeframe ?? "10m",
      source: source?.source ?? "ENGINE26",
      sourcePath: source?.sourcePath ?? null,
      relation: source?.relation ?? null,
    };
  }

  return null;
}

function resolveNegotiatedZonePosition({ currentPrice = null, zone = null } = {}) {
  const price = validPrice(currentPrice);

  if (price == null || !zone) {
    return {
      known: false,
      inside: false,
      position: "UNKNOWN",
      currentPrice: price,
      lo: zone?.lo ?? null,
      hi: zone?.hi ?? null,
      mid: zone?.mid ?? null,
    };
  }

  if (price < zone.lo) {
    return {
      known: true,
      inside: false,
      position: "BELOW_ZONE",
      currentPrice: price,
      lo: zone.lo,
      hi: zone.hi,
      mid: zone.mid,
    };
  }

  if (price > zone.hi) {
    return {
      known: true,
      inside: false,
      position: "ABOVE_ZONE",
      currentPrice: price,
      lo: zone.lo,
      hi: zone.hi,
      mid: zone.mid,
    };
  }

  return {
    known: true,
    inside: true,
    position: "INSIDE_ZONE",
    currentPrice: price,
    lo: zone.lo,
    hi: zone.hi,
    mid: zone.mid,
  };
}

function identityValue(source, key) {
  const value = source?.[key];
  return value === undefined || value === null || String(value).trim() === ""
    ? null
    : value;
}

function sameLifecycle({ previousCandidateId = null, previousZoneId = null, handoff = null } = {}) {
  const currentCandidateId = identityValue(handoff, "candidateId");
  const currentZoneId = identityValue(handoff, "zoneId");

  // If previous identity is published, a conflict is a hard lifecycle change.
  if (previousCandidateId != null && currentCandidateId != null) {
    if (String(previousCandidateId) !== String(currentCandidateId)) return false;
  }

  if (previousZoneId != null && currentZoneId != null) {
    if (String(previousZoneId) !== String(currentZoneId)) return false;
  }

  // If a previous directional state exists but neither previous identity field
  // is available, we cannot safely prove a new lifecycle. Preserve backward
  // compatibility, but publish a diagnostic reason code in the final object.
  return true;
}

function sourceIdentityFromHandoff(handoff) {
  return {
    symbol: handoff?.symbol ?? null,
    laneId: handoff?.laneId ?? null,
    strategyId: handoff?.strategyId ?? null,
    candidateId: handoff?.candidateId ?? null,
    zoneId: handoff?.zoneId ?? null,
    setupClass: handoff?.setupClass ?? null,
    setupGrade: handoff?.setupGrade ?? null,
    identitySetupKey: handoff?.identitySetupKey ?? null,
    candidateIdentityVersion: handoff?.candidateIdentityVersion ?? null,
  };
}

function completedBarsForTimeframe({ bars = [], timeframe, evaluationTimeMs = null } = {}) {
  const truth = deriveCandleCompletionTruth({
    bars: Array.isArray(bars) ? bars : [],
    timeframe,
    evaluationTimeMs,
  });

  return {
    truth,
    completedBars: Array.isArray(truth?.completedBars) ? truth.completedBars.filter(Boolean) : [],
  };
}

/*
 * Direction model intentionally matches the proven completed-candle direction
 * model that already behaved correctly in the old 5m builder.
 *
 * It is NOT by itself canonical Engine 3 direction.
 * 5m proposes the mature direction. 10m must independently agree.
 */
function candleDirectionFromBars(bars = []) {
  const recent = Array.isArray(bars) ? bars.filter(Boolean).slice(-3) : [];

  if (recent.length < 2) return "NEUTRAL";

  const last = recent.at(-1);
  const prev = recent.at(-2);

  const lastClose = barClose(last);
  const prevClose = barClose(prev);
  const lastLow = barLow(last);
  const prevLow = barLow(prev);
  const lastHigh = barHigh(last);
  const prevHigh = barHigh(prev);

  if (
    lastClose != null &&
    prevClose != null &&
    lastLow != null &&
    prevLow != null &&
    lastClose < prevClose &&
    lastLow <= prevLow
  ) {
    return "SHORT";
  }

  if (
    lastClose != null &&
    prevClose != null &&
    lastHigh != null &&
    prevHigh != null &&
    lastClose > prevClose &&
    lastHigh >= prevHigh
  ) {
    return "LONG";
  }

  return "NEUTRAL";
}

function closeLocation(close, zone) {
  if (close == null || !zone) return "UNKNOWN";
  if (close < zone.lo) return "BELOW_ZONE";
  if (close > zone.hi) return "ABOVE_ZONE";
  if (close >= zone.mid) return "INSIDE_UPPER_HALF";
  return "INSIDE_LOWER_HALF";
}

function touchesZone(bar, zone) {
  if (!bar || !zone) return false;
  const high = barHigh(bar);
  const low = barLow(bar);
  return high != null && low != null && high >= zone.lo && low <= zone.hi;
}

/*
 * Book-language state at the exact Engine 26 negotiated zone.
 *
 * IMPORTANT:
 * The state explains WHAT happened at the zone. It does not override the
 * independent 5m/10m direction calculation merely because of its label.
 */
function evaluateNegotiatedZoneState({ bars = [], zone = null } = {}) {
  const recent = Array.isArray(bars) ? bars.filter(Boolean).slice(-3) : [];
  const current = recent.at(-1) || null;
  const prior = recent.at(-2) || null;
  const first = recent.at(-3) || null;

  if (!zone || !current) {
    return {
      state: "NO_SIGNAL",
      evidence: [],
      sequence: [],
      reasonCodes: ["ENGINE3_NEGOTIATED_ZONE_STATE_DATA_INCOMPLETE"],
    };
  }

  const o = barOpen(current);
  const h = barHigh(current);
  const l = barLow(current);
  const c = barClose(current);
  const pc = barClose(prior);
  const ph = barHigh(prior);
  const pl = barLow(prior);

  if ([h, l, c].some((value) => value == null)) {
    return {
      state: "NO_SIGNAL",
      evidence: [],
      sequence: [],
      reasonCodes: ["ENGINE3_NEGOTIATED_ZONE_CURRENT_BAR_INCOMPLETE"],
    };
  }

  const evidence = [];
  const sequence = recent.map((bar) => ({
    time: barTime(bar),
    open: barOpen(bar),
    high: barHigh(bar),
    low: barLow(bar),
    close: barClose(bar),
    closeLocation: closeLocation(barClose(bar), zone),
    touchedZone: touchesZone(bar, zone),
  }));

  const currentBelow = c < zone.lo;
  const currentAbove = c > zone.hi;
  const currentInside = !currentBelow && !currentAbove;

  const priorBelow = pc != null && pc < zone.lo;
  const priorAbove = pc != null && pc > zone.hi;
  const priorInside = pc != null && !priorBelow && !priorAbove;

  const wickBelowAndReclaim = l < zone.lo && c >= zone.lo;
  const wickAboveAndReject = h > zone.hi && c <= zone.hi;

  if (wickBelowAndReclaim) evidence.push("WICK_BELOW_AND_RECLAIM");
  if (wickBelowAndReclaim && o != null && c > o) evidence.push("DIP_BOUGHT_FAST");

  if (priorBelow && c >= zone.lo) {
    evidence.push("RECLAIMED_LEVEL");
    if (c > pc && (h == null || ph == null || h >= ph)) {
      evidence.push("SELLERS_TRAPPED");
    }
  }

  if (wickAboveAndReject) evidence.push("REJECTING_VALUE");

  if (priorAbove && c <= zone.hi) {
    evidence.push("BREAKOUT_FAILING");
  }

  if (priorInside && currentBelow) {
    evidence.push("LOST_LEVEL");
  }

  const attemptedReclaimFromBelow =
    currentBelow &&
    (
      h >= zone.lo ||
      (prior && barHigh(prior) != null && barHigh(prior) >= zone.lo)
    );

  if (attemptedReclaimFromBelow) {
    evidence.push("FAILED_RECLAIM");
  }

  if (currentAbove && (priorInside || priorBelow)) {
    evidence.push("ACCEPTING_VALUE");
  }

  if (currentAbove && priorAbove) {
    evidence.push("BREAKOUT_HOLDING");
  }

  const heldInside =
    currentInside &&
    priorInside &&
    l >= zone.lo &&
    h <= zone.hi;

  if (heldInside) {
    evidence.push("HELD_LEVEL");
  }

  if (currentInside && evidence.length === 0) {
    evidence.push("CHOP_INSIDE_VALUE");
  }

  // Outside-zone continuation remains described in zone language. This is not
  // a new directional classifier; direction is still independently calculated.
  if (currentBelow && evidence.length === 0) {
    evidence.push("LOST_LEVEL");
  }

  if (currentAbove && evidence.length === 0) {
    evidence.push("BREAKOUT_HOLDING");
  }

  // Primary state favors the latest aftermath over an older touch label.
  let state = "NO_SIGNAL";

  if (currentBelow) {
    state = evidence.includes("FAILED_RECLAIM") ? "FAILED_RECLAIM" : "LOST_LEVEL";
  } else if (currentAbove) {
    state = evidence.includes("ACCEPTING_VALUE")
      ? "ACCEPTING_VALUE"
      : "BREAKOUT_HOLDING";
  } else if (evidence.includes("BREAKOUT_FAILING")) {
    state = "BREAKOUT_FAILING";
  } else if (evidence.includes("REJECTING_VALUE")) {
    state = "REJECTING_VALUE";
  } else if (evidence.includes("SELLERS_TRAPPED")) {
    state = "SELLERS_TRAPPED";
  } else if (evidence.includes("DIP_BOUGHT_FAST")) {
    state = "DIP_BOUGHT_FAST";
  } else if (evidence.includes("WICK_BELOW_AND_RECLAIM")) {
    state = "WICK_BELOW_AND_RECLAIM";
  } else if (evidence.includes("RECLAIMED_LEVEL")) {
    state = "RECLAIMED_LEVEL";
  } else if (evidence.includes("HELD_LEVEL")) {
    state = "HELD_LEVEL";
  } else if (currentInside) {
    state = "CHOP_INSIDE_VALUE";
  }

  return {
    state,
    evidence: unique(evidence),
    sequence,
    currentCloseLocation: closeLocation(c, zone),
    currentTouchedZone: touchesZone(current, zone),
    priorTouchedZone: touchesZone(prior, zone),
    firstTouchedZone: touchesZone(first, zone),
    reasonCodes: [
      `ENGINE3_ZONE_STATE_${state}`,
      "ENGINE3_ENGINE26_NEGOTIATED_ZONE_ONLY",
      "ENGINE3_STATE_IS_DIAGNOSTIC_EVIDENCE_NOT_DIRECTION_VETO",
    ],
  };
}

function buildFiveMinuteReaction({
  bars = [],
  evaluationTimeMs = null,
  zone = null,
  validation5m = null,
} = {}) {
  const { truth, completedBars } = completedBarsForTimeframe({
    bars,
    timeframe: "5m",
    evaluationTimeMs,
  });

  // Prefer the raw completed-bar calculation. The existing validation object is
  // retained only as a diagnostic cross-check and never compares against 1m here.
  const direction = candleDirectionFromBars(completedBars);
  const zoneRead = evaluateNegotiatedZoneState({
    bars: completedBars,
    zone,
  });

  const enoughBars = completedBars.length >= 2;
  const directional = direction === "LONG" || direction === "SHORT";

  return {
    active: zone != null && enoughBars,
    sourceTimeframe: "5m",
    role: "PRIMARY_MATURE_REACTION_EVIDENCE",
    direction,
    state: zoneRead.state,
    reactionState: zoneRead.state,
    quality: directional ? "GOOD" : "WEAK",
    maturity: enoughBars && directional ? "MATURE_REACTION" : "WAIT",
    maturityResolved: enoughBars && directional,
    observedAt: truth?.evaluationTimeMs ?? evaluationTimeMs ?? null,
    completedBarCount: completedBars.length,
    latestCompletedBar: completedBars.at(-1) || null,
    priorCompletedBar: completedBars.at(-2) || null,
    evidence: zoneRead.evidence,
    sequence: zoneRead.sequence,
    currentCloseLocation: zoneRead.currentCloseLocation,
    currentTouchedZone: zoneRead.currentTouchedZone,
    validationDiagnostic: validation5m
      ? {
          direction: validation5m?.direction ?? null,
          quality: validation5m?.quality ?? null,
          validationState: validation5m?.validationState ?? null,
          stale: validation5m?.stale ?? null,
        }
      : null,
    currentCandleStatus: truth?.latestBarCompletionState ?? null,
    evaluationTimeMs: truth?.evaluationTimeMs ?? evaluationTimeMs ?? null,
    reasonCodes: unique([
      "ENGINE3_5M_PRIMARY_REACTION_EVIDENCE",
      "ENGINE3_5M_DIRECTION_FROM_COMPLETED_CANDLES",
      ...zoneRead.reasonCodes,
      !enoughBars ? "ENGINE3_WAITING_FOR_TWO_COMPLETED_5M_BARS_FOR_DIRECTION" : null,
      directional ? `ENGINE3_5M_DIRECTION_${direction}` : "ENGINE3_5M_DIRECTION_NEUTRAL",
    ]),
  };
}

function buildTenMinuteConfirmation({
  bars = [],
  evaluationTimeMs = null,
  zone = null,
  fiveMinuteReaction = null,
} = {}) {
  const { truth, completedBars } = completedBarsForTimeframe({
    bars,
    timeframe: "10m",
    evaluationTimeMs,
  });

  const direction = candleDirectionFromBars(completedBars);
  const zoneRead = evaluateNegotiatedZoneState({
    bars: completedBars,
    zone,
  });

  const fiveDirection = safeUpper(fiveMinuteReaction?.direction, "NEUTRAL");
  const directional = direction === "LONG" || direction === "SHORT";
  const fiveDirectional = fiveDirection === "LONG" || fiveDirection === "SHORT";
  const enoughBars = completedBars.length >= 2;
  const aligned = enoughBars && directional && fiveDirectional && direction === fiveDirection;
  const conflict = enoughBars && directional && fiveDirectional && direction !== fiveDirection;

  return {
    active: zone != null && enoughBars,
    sourceTimeframe: "10m",
    role: "BROADER_PRICE_CONFIRMATION",
    direction,
    state: zoneRead.state,
    reactionState: zoneRead.state,
    quality: aligned ? "GOOD" : "WEAK",
    confirmed: aligned,
    validationState: aligned ? "SUPPORT" : conflict ? "CONFLICT" : "UNRESOLVED",
    supportsFiveMinuteDirection: aligned,
    conflictsWithFiveMinuteDirection: conflict,
    completedBarCount: completedBars.length,
    latestCompletedBar: completedBars.at(-1) || null,
    priorCompletedBar: completedBars.at(-2) || null,
    evidence: zoneRead.evidence,
    sequence: zoneRead.sequence,
    currentCloseLocation: zoneRead.currentCloseLocation,
    currentCandleStatus: truth?.latestBarCompletionState ?? null,
    evaluationTimeMs: truth?.evaluationTimeMs ?? evaluationTimeMs ?? null,
    reason: !enoughBars
      ? "WAITING_FOR_COMPLETED_10M_PRICE_SEQUENCE"
      : aligned
      ? `COMPLETED_10M_CONFIRMS_${direction}`
      : conflict
      ? `COMPLETED_10M_CONFLICTS_WITH_5M_${fiveDirection}`
      : "COMPLETED_10M_NOT_DIRECTIONAL",
    reasonCodes: unique([
      "ENGINE3_10M_BROADER_PRICE_CONFIRMATION",
      "ENGINE3_10M_DIRECTION_FROM_COMPLETED_CANDLES",
      ...zoneRead.reasonCodes,
      !enoughBars ? "ENGINE3_WAITING_FOR_TWO_COMPLETED_10M_BARS_FOR_DIRECTION" : null,
      aligned ? `ENGINE3_10M_CONFIRMS_${direction}` : null,
      conflict ? "ENGINE3_10M_CONFLICTS_WITH_5M" : null,
    ]),
  };
}

function resolveBroaderReaction10m({
  fastImbalanceReaction = null,
  currentLevelAction = null,
} = {}) {
  // Compatibility-only helper for the old buildPaperScalpReaction export.
  // Strategy 1 attachPaperScalpReactionToConfluence() does NOT use this as
  // canonical authority.
  if (fastImbalanceReaction && typeof fastImbalanceReaction === "object") {
    return {
      ...fastImbalanceReaction,
      broaderContextOnly: true,
      canonicalDirectionAuthority: false,
      canonicalQualificationAuthority: false,
    };
  }

  if (currentLevelAction && typeof currentLevelAction === "object") {
    return {
      ...currentLevelAction,
      broaderContextOnly: true,
      canonicalDirectionAuthority: false,
      canonicalQualificationAuthority: false,
    };
  }

  return null;
}

function setupTypeForCanonical({ state, direction } = {}) {
  const s = safeUpper(state, "NO_SIGNAL");
  const d = safeUpper(direction, "NEUTRAL");

  if (d === "SHORT") {
    if (s === "LOST_LEVEL") return "LOST_LEVEL_SHORT";
    if (s === "FAILED_RECLAIM") return "FAILED_RECLAIM_SHORT";
    if (s === "REJECTING_VALUE") return "REJECTING_VALUE_SHORT";
    if (s === "BREAKOUT_FAILING") return "BREAKOUT_FAILING_SHORT";
    return "CANONICAL_SHORT_REACTION";
  }

  if (d === "LONG") {
    if (s === "RECLAIMED_LEVEL") return "RECLAIMED_LEVEL_LONG";
    if (s === "WICK_BELOW_AND_RECLAIM") return "WICK_BELOW_AND_RECLAIM_LONG";
    if (s === "DIP_BOUGHT_FAST") return "DIP_BOUGHT_FAST_LONG";
    if (s === "SELLERS_TRAPPED") return "SELLERS_TRAPPED_LONG";
    if (s === "HELD_LEVEL") return "HELD_LEVEL_LONG";
    if (s === "ACCEPTING_VALUE") return "ACCEPTING_VALUE_LONG";
    if (s === "BREAKOUT_HOLDING") return "BREAKOUT_HOLDING_LONG";
    return "CANONICAL_LONG_REACTION";
  }

  return "CANONICAL_NEUTRAL_REACTION";
}

function buildAuthorizationContext({
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  state = "NO_SIGNAL",
  quality = "WEAK",
  direction = "NEUTRAL",
  confirmed = false,
  currentPrice = null,
  lastCandle = null,
} = {}) {
  return buildEngine26LocationReactionContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    reactionInput: {
      ...sourceIdentityFromHandoff(engine26ReactionHandoff),
      state,
      quality,
      direction,
      confirmed,
      currentPrice,
      lastCandle,
      noPermissionCreated: true,
      noExecution: true,
    },
  });
}

function directionIsDirectional(direction) {
  return direction === "LONG" || direction === "SHORT";
}

function resolveCanonicalLifecycle({
  fiveMinuteReaction,
  tenMinuteConfirmation,
  engine26ReactionHandoff,
  zonePosition,
  previousCanonicalDirection = null,
  previousReactionConfirmed = false,
  previousCandidateId = null,
  previousZoneId = null,
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  activePaperTradeDirection = null,
} = {}) {
  const fiveDirection = safeUpper(fiveMinuteReaction?.direction, "NEUTRAL");
  const tenDirection = safeUpper(tenMinuteConfirmation?.direction, "NEUTRAL");
  const previousDirection = safeUpper(previousCanonicalDirection, "NEUTRAL");
  const activeDirection = safeUpper(activePaperTradeDirection, "NEUTRAL");

  const lifecycleSame = sameLifecycle({
    previousCandidateId,
    previousZoneId,
    handoff: engine26ReactionHandoff,
  });

  const lifecycleChanged = lifecycleSame === false;
  const previousDirectional = directionIsDirectional(previousDirection);
  const activeDirectional = directionIsDirectional(activeDirection);

  const completedClose = toNum(tenMinuteCompletedClose);
  const ema10 = toNum(tenMinuteEma10);
  const ema10DataAvailable = completedClose != null && ema10 != null;

  const engine26EvaluationAuthorized =
    engine26ReactionHandoff?.active === true &&
    engine26ReactionHandoff?.authorizeEngine3Evaluation === true;

  const alignedInitialReaction =
    engine26EvaluationAuthorized &&
    directionIsDirectional(fiveDirection) &&
    tenMinuteConfirmation?.confirmed === true &&
    tenDirection === fiveDirection;

  let direction = "NEUTRAL";
  let state = fiveMinuteReaction?.state || "NO_SIGNAL";
  let quality = "WEAK";
  let reactionConfirmed = false;
  let directionPersistenceActive = false;
  let ema10ResetTriggered = false;
  let sourceTimeframe = null;
  let reactionTimeframe = null;
  let resolutionStatus = "CANONICAL_NEUTRAL_WAITING_FOR_REACTION";
  let resolutionReason = "WAITING_FOR_5M_REACTION_AND_10M_CONFIRMATION";

  // A new Engine 26 lifecycle invalidates inherited Engine 3 direction before
  // any new reaction is evaluated. New 5m+10m evidence may still establish a
  // fresh direction in the same build.
  const inheritedDirectionAllowed = lifecycleSame;

  if (activeDirectional && inheritedDirectionAllowed) {
    const resetShort =
      activeDirection === "SHORT" &&
      ema10DataAvailable &&
      completedClose > ema10;

    const resetLong =
      activeDirection === "LONG" &&
      ema10DataAvailable &&
      completedClose < ema10;

    ema10ResetTriggered = resetShort || resetLong;

    if (ema10ResetTriggered) {
      direction = "NEUTRAL";
      state = "ACTIVE_TRADE_DIRECTION_RESET";
      sourceTimeframe = "10m";
      reactionTimeframe = "10m";
      resolutionStatus = `ACTIVE_PAPER_TRADE_${activeDirection}_RESET_AT_10M_EMA10`;
      resolutionReason =
        activeDirection === "SHORT"
          ? "ACTIVE_SHORT_RESET_BY_COMPLETED_10M_CLOSE_ABOVE_EMA10"
          : "ACTIVE_LONG_RESET_BY_COMPLETED_10M_CLOSE_BELOW_EMA10";
    } else {
      direction = activeDirection;
      state = fiveMinuteReaction?.state || "ACTIVE_TRADE_DIRECTION_PERSISTED";
      quality = "GOOD";
      reactionConfirmed = true;
      directionPersistenceActive = true;
      sourceTimeframe = "ACTIVE_PAPER_TRADE";
      reactionTimeframe = "10m";
      resolutionStatus = `ACTIVE_PAPER_TRADE_${activeDirection}_PERSISTED`;
      resolutionReason =
        activeDirection === "SHORT"
          ? "ACTIVE_SHORT_HELD_UNTIL_COMPLETED_10M_CLOSE_ABOVE_EMA10"
          : "ACTIVE_LONG_HELD_UNTIL_COMPLETED_10M_CLOSE_BELOW_EMA10";
    }
  } else if (
    inheritedDirectionAllowed &&
    previousDirectional &&
    previousReactionConfirmed === true &&
    zonePosition?.known === true &&
    zonePosition?.inside !== true
  ) {
    const resetShort =
      previousDirection === "SHORT" &&
      ema10DataAvailable &&
      completedClose > ema10;

    const resetLong =
      previousDirection === "LONG" &&
      ema10DataAvailable &&
      completedClose < ema10;

    ema10ResetTriggered = resetShort || resetLong;

    if (ema10ResetTriggered) {
      direction = "NEUTRAL";
      state = "ZONE_EXIT_DIRECTION_RESET";
      sourceTimeframe = "10m";
      reactionTimeframe = "10m";
      resolutionStatus = `ZONE_EXIT_${previousDirection}_RESET_AT_10M_EMA10`;
      resolutionReason =
        previousDirection === "SHORT"
          ? "ZONE_EXIT_SHORT_RESET_BY_COMPLETED_10M_CLOSE_ABOVE_EMA10"
          : "ZONE_EXIT_LONG_RESET_BY_COMPLETED_10M_CLOSE_BELOW_EMA10";
    } else {
      direction = previousDirection;
      state = fiveMinuteReaction?.state || "ZONE_EXIT_DIRECTION_PERSISTED";
      quality = "GOOD";
      reactionConfirmed = true;
      directionPersistenceActive = true;
      sourceTimeframe = "10m_EMA10_HOLD";
      reactionTimeframe = "10m";
      resolutionStatus = `ZONE_EXIT_${previousDirection}_PERSISTED_BY_10M_EMA10`;
      resolutionReason =
        previousDirection === "SHORT"
          ? "ZONE_EXIT_SHORT_HELD_UNTIL_COMPLETED_10M_CLOSE_ABOVE_EMA10"
          : "ZONE_EXIT_LONG_HELD_UNTIL_COMPLETED_10M_CLOSE_BELOW_EMA10";
    }
  } else if (alignedInitialReaction) {
    direction = fiveDirection;
    state = fiveMinuteReaction?.state || "NO_SIGNAL";
    quality = "GOOD";
    reactionConfirmed = true;
    sourceTimeframe = "5m+10m";
    reactionTimeframe = "5m+10m";
    resolutionStatus = `CANONICAL_${fiveDirection}_NEGOTIATED_ZONE_REACTION_CONFIRMED`;
    resolutionReason = "ENGINE3_DIRECTION_ESTABLISHED_BY_ALIGNED_COMPLETED_5M_AND_10M_PRICE_REACTION";
  } else if (lifecycleChanged) {
    direction = "NEUTRAL";
    state = fiveMinuteReaction?.state || "NO_SIGNAL";
    resolutionStatus = "ENGINE26_NEW_LIFECYCLE_RESET_TO_NEUTRAL";
    resolutionReason = "PREVIOUS_ENGINE3_DIRECTION_BELONGED_TO_PRIOR_ENGINE26_CANDIDATE_OR_ZONE";
  } else if (!engine26EvaluationAuthorized) {
    resolutionStatus = "WAITING_FOR_ENGINE26_AUTHORIZED_LOCATION";
    resolutionReason = "ENGINE26_EVALUATION_NOT_AUTHORIZED";
  } else if (!directionIsDirectional(fiveDirection)) {
    resolutionStatus = "WAITING_FOR_MATURE_5M_REACTION";
    resolutionReason = "COMPLETED_5M_REACTION_NOT_DIRECTIONAL";
  } else if (tenMinuteConfirmation?.confirmed !== true) {
    resolutionStatus = "WAITING_FOR_ALIGNED_10M_CONFIRMATION";
    resolutionReason = tenMinuteConfirmation?.reason || "COMPLETED_10M_HAS_NOT_CONFIRMED_5M_DIRECTION";
  }

  return {
    state,
    direction,
    quality,
    reactionConfirmed,
    sourceTimeframe,
    reactionTimeframe,
    directionPersistenceActive,
    ema10ResetTriggered,
    tenMinuteCompletedClose: completedClose,
    tenMinuteEma10: ema10,
    ema10ResetDataAvailable: ema10DataAvailable,
    previousCanonicalDirection: inheritedDirectionAllowed && previousDirectional
      ? previousDirection
      : "NEUTRAL",
    previousReactionConfirmed: previousReactionConfirmed === true,
    activePaperTrade: activeDirectional,
    activePaperTradeDirection: activeDirectional ? activeDirection : "NEUTRAL",
    lifecycleSame,
    lifecycleChanged,
    engine26EvaluationAuthorized,
    alignedInitialReaction,
    candidateDirection: fiveDirection,
    candidateState: fiveMinuteReaction?.state || "NO_SIGNAL",
    candidateQuality: directionIsDirectional(fiveDirection) ? "GOOD" : "WEAK",
    resolutionStatus,
    resolutionReason,
  };
}

function resolveStrategy1Qualification({
  canonicalResolution,
  engine26LocationContext,
} = {}) {
  const blockers = [];
  const reasonCodes = [];

  const reactionConfirmed = canonicalResolution?.reactionConfirmed === true;
  const direction = safeUpper(canonicalResolution?.direction, "NEUTRAL");
  const directional = directionIsDirectional(direction);

  const engine26Verified =
    engine26LocationContext?.confirmed === true &&
    engine26LocationContext?.state === "REACTION_CONFIRMED";

  if (!reactionConfirmed) blockers.push("ENGINE3_REACTION_NOT_CONFIRMED");
  if (!directional) blockers.push("ENGINE3_CANONICAL_DIRECTION_NEUTRAL");
  if (!engine26Verified) blockers.push("ENGINE26_REACTION_NOT_VERIFIED");

  const qualified = blockers.length === 0;

  reasonCodes.push(
    qualified
      ? "ENGINE3_STRATEGY1_QUALIFIED_FOR_ENGINE6"
      : "ENGINE3_STRATEGY1_NOT_QUALIFIED_FOR_ENGINE6"
  );

  return {
    qualified,
    blockers,
    reasonCodes,
  };
}

/*
 * Compatibility export for old callers.
 * This is broader diagnostic context only and does not own Strategy 1 canonical
 * direction. It is intentionally preserved to avoid breaking old routes while
 * the Strategy 1 canonical path stays clean.
 */
export function buildPaperScalpReaction({
  currentLevelAction = null,
  fastImbalanceReaction = null,
  engine22WaveStrategy = null,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
} = {}) {
  const broaderReaction10m = resolveBroaderReaction10m({
    fastImbalanceReaction,
    currentLevelAction,
  });

  const diagnosticInput = broaderReaction10m || currentLevelAction || {};

  const engine26LocationContext = buildEngine26LocationReactionContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    reactionInput: {
      ...sourceIdentityFromHandoff(engine26ReactionHandoff),
      state: diagnosticInput?.state || "NO_SIGNAL",
      quality: diagnosticInput?.quality || "WEAK",
      direction: diagnosticInput?.direction || "NEUTRAL",
      confirmed: false,
      currentPrice: diagnosticInput?.currentPrice ?? null,
      lastCandle: diagnosticInput?.lastCandle ?? null,
      noPermissionCreated: true,
      noExecution: true,
    },
  });

  return {
    active: true,
    engine: ENGINE,
    source: SOURCE,
    mode: "PAPER_ONLY",
    researchOnly: true,
    state: diagnosticInput?.state || "NO_SIGNAL",
    direction: diagnosticInput?.direction || "NEUTRAL",
    quality: diagnosticInput?.quality || "WEAK",
    allowed: false,
    engine3Strategy1QualifiedForEngine6: false,
    participationEvaluationEligible: false,
    reactionConfirmed: false,
    engine26LocationContext,
    broaderContextOnly: true,
    canonicalDirectionAuthority: false,
    canonicalQualificationAuthority: false,
    engine22Direction: getEngine22Direction(engine22WaveStrategy),
    paperShortResearchEnabled: paperShortResearchEnabled === true,
    noPermissionCreated: true,
    noRealPermissionCreated: true,
    noExecution: true,
    realExecutionAuthority: false,
    blockers: ["BROADER_10M_CONTEXT_ONLY"],
    reasonCodes: [
      "ENGINE3_BROADER_10M_CONTEXT_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export function attachPaperScalpReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
  previousCanonicalDirection = null,
  previousReactionConfirmed = false,
  previousCandidateId = null,
  previousZoneId = null,
  fiveMinuteBars = [],
  tenMinuteBars = [],
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  activePaperTradeDirection = null,
}) {
  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.reaction = patchedConfluence.context.reaction || {};

  const observation1m =
    patchedConfluence?.context?.reaction?.engine3ReactionObservation1m || null;

  const validation5m =
    patchedConfluence?.context?.reaction?.engine3ReactionValidation5m || null;

  // Legacy objects remain visible for diagnostics only. They cannot create,
  // confirm, veto, hold, or reset Strategy 1 canonical Engine 3 direction.
  const currentLevelAction =
    patchedConfluence?.context?.reaction?.currentLevelAction || null;

  const fastImbalanceReaction =
    patchedConfluence?.context?.reaction?.engine3FastImbalanceReaction || null;

  const evaluationTimeMs =
    observation1m?.evaluationTimeMs ??
    observation1m?.observedAt ??
    validation5m?.evaluationTimeMs ??
    validation5m?.observedAt ??
    Date.now();

  const zone = normalizeZone(engine26ReactionHandoff);

  const currentPrice =
    validPrice(observation1m?.currentPrice) ??
    validPrice(observation1m?.currentCandle?.close) ??
    validPrice(validation5m?.currentCandle?.close) ??
    validPrice(tenMinuteCompletedClose) ??
    null;

  const negotiatedZonePosition = resolveNegotiatedZonePosition({
    currentPrice,
    zone,
  });

  const fiveMinuteReaction = buildFiveMinuteReaction({
    bars: fiveMinuteBars,
    evaluationTimeMs,
    zone,
    validation5m,
  });

  const tenMinuteConfirmation = buildTenMinuteConfirmation({
    bars: tenMinuteBars,
    evaluationTimeMs,
    zone,
    fiveMinuteReaction,
  });

  const canonicalResolution = resolveCanonicalLifecycle({
    fiveMinuteReaction,
    tenMinuteConfirmation,
    engine26ReactionHandoff,
    zonePosition: negotiatedZonePosition,
    previousCanonicalDirection,
    previousReactionConfirmed,
    previousCandidateId,
    previousZoneId,
    tenMinuteCompletedClose,
    tenMinuteEma10,
    activePaperTradeDirection,
  });

  const canonicalDirection = safeUpper(canonicalResolution.direction, "NEUTRAL");
  const canonicalDirectional = directionIsDirectional(canonicalDirection);
  const canonicalQuality = canonicalDirectional ? canonicalResolution.quality : "WEAK";
  const bookReactionState = fiveMinuteReaction?.state || "NO_SIGNAL";

  const lastCandle =
    fiveMinuteReaction?.latestCompletedBar ||
    observation1m?.currentCandle ||
    null;

  const engine26LocationContext = buildAuthorizationContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    state: bookReactionState,
    quality: canonicalQuality,
    direction: canonicalDirection,
    confirmed: canonicalResolution.reactionConfirmed === true,
    currentPrice,
    lastCandle,
  });

  const qualification = resolveStrategy1Qualification({
    canonicalResolution,
    engine26LocationContext,
  });

  const qualified = qualification.qualified === true;
  const participationEvaluationEligible = qualified;
  const authorizedForEngine4 = qualified;

  const setupType = setupTypeForCanonical({
    state: bookReactionState,
    direction: canonicalDirection,
  });

  const activePaperTradeLocked =
    canonicalResolution?.activePaperTrade === true &&
    canonicalResolution?.directionPersistenceActive === true &&
    canonicalResolution?.ema10ResetTriggered !== true &&
    canonicalDirectional;

  const zoneExitDirectionLocked =
    canonicalResolution?.activePaperTrade !== true &&
    canonicalResolution?.directionPersistenceActive === true &&
    canonicalResolution?.ema10ResetTriggered !== true &&
    canonicalDirectional;

  const oneMinuteDirection = safeUpper(observation1m?.direction, "NEUTRAL");
  const oneMinuteState = safeUpper(observation1m?.state, "NO_SIGNAL");
  const oneMinuteQuality = safeUpper(observation1m?.quality, "WEAK");

  const blockers = unique([
    ...qualification.blockers,
    canonicalResolution.engine26EvaluationAuthorized !== true
      ? "ENGINE26_EVALUATION_NOT_AUTHORIZED"
      : null,
    !fiveMinuteReaction?.maturityResolved && !canonicalResolution.directionPersistenceActive
      ? "ENGINE3_WAITING_FOR_MATURE_5M_REACTION"
      : null,
    fiveMinuteReaction?.maturityResolved === true &&
    tenMinuteConfirmation?.confirmed !== true &&
    !canonicalResolution.directionPersistenceActive &&
    !canonicalResolution.ema10ResetTriggered
      ? "ENGINE3_WAITING_FOR_ALIGNED_10M_CONFIRMATION"
      : null,
    canonicalResolution.ema10ResetTriggered
      ? "ENGINE3_DIRECTION_RESET_BY_COMPLETED_10M_EMA10"
      : null,
  ]);

  const paperScalpReaction = {
    active: true,
    engine: ENGINE,
    source: SOURCE,
    mode: "PAPER_ONLY",
    researchOnly: true,
    fastMode: false,
    paperShortResearchEnabled: paperShortResearchEnabled === true,

    // ONE canonical Engine 3 truth.
    state: canonicalResolution.state,
    direction: canonicalDirection,
    quality: canonicalQuality,
    setupType,

    reactionState: bookReactionState,
    bookReactionState,
    bookReactionEvidence: fiveMinuteReaction?.evidence || [],

    reactionConfirmed: canonicalResolution.reactionConfirmed === true,
    authorizedForEngine4,
    allowed: qualified,
    engine3Strategy1QualifiedForEngine6: qualified,
    participationEvaluationEligible,
    qualificationExplicitlyPublished: true,

    canonicalResolutionStatus: canonicalResolution.resolutionStatus,
    canonicalResolutionReason: canonicalResolution.resolutionReason,
    canonicalObservationUsable:
      fiveMinuteReaction?.maturityResolved === true &&
      tenMinuteConfirmation?.completedBarCount >= 2,
    canonicalIdentityAligned:
      engine26LocationContext?.identityComparison?.matched === true,

    sourceTimeframe: canonicalResolution.sourceTimeframe,
    reactionTimeframe: canonicalResolution.reactionTimeframe,

    directionEstablishmentTimeframe:
      canonicalResolution.directionPersistenceActive
        ? "10m_EMA10_POST_ZONE_HOLD"
        : "5m_REACTION_PLUS_10m_CONFIRMATION",

    validationTimeframe: "10m_CONFIRMS_5m_REACTION",
    directionResetTimeframe: "10m_EMA10_OR_ENGINE26_NEW_LIFECYCLE",

    // Exact canonical reference from Engine 26 only.
    referenceType: "ENGINE26_NEGOTIATED_ZONE",
    referenceLabel: "ENGINE26_NEGOTIATED_ZONE",
    referenceLevel: zone?.mid ?? null,
    negotiatedZoneLo: zone?.lo ?? null,
    negotiatedZoneHi: zone?.hi ?? null,
    negotiatedZoneMid: zone?.mid ?? null,
    negotiatedZonePosition: negotiatedZonePosition.position,
    negotiatedZonePositionKnown: negotiatedZonePosition.known,
    insideNegotiatedZone: negotiatedZonePosition.inside,

    currentPrice,
    distancePts:
      currentPrice != null && zone?.mid != null
        ? Number(Math.abs(currentPrice - zone.mid).toFixed(2))
        : null,

    // 1m is permanently watch/display only.
    oneMinuteImmediateDirection: oneMinuteDirection,
    oneMinuteWatchDirection: oneMinuteDirection,
    oneMinuteWatchState: oneMinuteState,
    oneMinuteWatchQuality: oneMinuteQuality,
    oneMinuteCanonicalAuthority: false,
    directionEstablishedByFresh1m: false,
    fiveMinuteValidationRequired: true,

    reactionObservation1m: observation1m,

    // 5m is the primary mature price-reaction evidence.
    fiveMinuteValidationDirection: fiveMinuteReaction.direction,
    fiveMinuteReaction,
    reactionValidation5m: validation5m,
    fiveMinuteCanonicalDirectionAuthority: false,
    fiveMinuteReactionEvidenceAuthority: true,

    // 10m confirms the 5m direction; it does not use EMA10 for initial direction.
    broaderTenMinuteDirection: tenMinuteConfirmation.direction,
    broaderReaction10m: tenMinuteConfirmation,
    tenMinuteConfirmation,
    tenMinuteInitialDirectionAuthority: false,
    tenMinuteConfirmationAuthority: true,

    reactionCandidateDirection: fiveMinuteReaction.direction,
    reactionCandidateState: fiveMinuteReaction.state,
    reactionCandidateQuality: fiveMinuteReaction.quality,
    reactionCandidateConfirmed: tenMinuteConfirmation.confirmed === true,

    previousCanonicalDirection: canonicalResolution.previousCanonicalDirection,
    previousReactionConfirmed: canonicalResolution.previousReactionConfirmed,
    previousCandidateId,
    previousZoneId,
    lifecycleSame: canonicalResolution.lifecycleSame,
    lifecycleChanged: canonicalResolution.lifecycleChanged,

    activePaperTrade: canonicalResolution.activePaperTrade,
    activePaperTradeDirection: canonicalResolution.activePaperTradeDirection,
    directionPersistenceActive: canonicalResolution.directionPersistenceActive,
    activePaperTradeLocked,
    zoneExitDirectionLocked,

    tenMinuteCompletedClose: canonicalResolution.tenMinuteCompletedClose,
    tenMinuteEma10: canonicalResolution.tenMinuteEma10,
    ema10ResetDataAvailable: canonicalResolution.ema10ResetDataAvailable,
    ema10ResetTriggered: canonicalResolution.ema10ResetTriggered,

    // Engine 26 authorization / identity transport.
    authorized: engine26LocationContext?.authorized === true,
    evaluationAuthorized:
      engine26LocationContext?.authorizeEngine3Evaluation === true,
    authorizeEngine3Evaluation:
      engine26LocationContext?.authorizeEngine3Evaluation === true,

    authorizedReactionState:
      canonicalResolution.reactionConfirmed === true
        ? "REACTION_CONFIRMED"
        : engine26LocationContext?.state ?? null,

    authorizedReactionRawState:
      engine26LocationContext?.rawState ?? bookReactionState,

    engine26ReactionVerified:
      engine26LocationContext?.confirmed === true &&
      engine26LocationContext?.state === "REACTION_CONFIRMED",

    candidateId:
      engine26LocationContext?.candidateId ??
      engine26ReactionHandoff?.candidateId ??
      null,

    zoneId:
      engine26LocationContext?.zoneId ??
      engine26ReactionHandoff?.zoneId ??
      null,

    laneId:
      engine26LocationContext?.laneId ??
      engine26ReactionHandoff?.laneId ??
      null,

    strategyId:
      engine26LocationContext?.strategyId ??
      engine26ReactionHandoff?.strategyId ??
      null,

    symbol:
      engine26LocationContext?.symbol ??
      engine26ReactionHandoff?.symbol ??
      null,

    setupClass:
      engine26LocationContext?.setupClass ??
      engine26ReactionHandoff?.setupClass ??
      null,

    setupGrade:
      engine26LocationContext?.setupGrade ??
      engine26ReactionHandoff?.setupGrade ??
      null,

    identitySetupKey:
      engine26LocationContext?.identitySetupKey ??
      engine26ReactionHandoff?.identitySetupKey ??
      null,

    candidateIdentityVersion:
      engine26LocationContext?.candidateIdentityVersion ??
      engine26ReactionHandoff?.candidateIdentityVersion ??
      null,

    canonicalIdentity: engine26LocationContext?.canonicalIdentity || null,
    sourceIdentity: engine26LocationContext?.sourceIdentity || null,
    identityComparison: engine26LocationContext?.identityComparison || null,

    armed: engine26LocationContext?.armed === true,
    chainArmed: engine26LocationContext?.chainArmed === true,
    contactState: engine26LocationContext?.contactState ?? null,
    directionState: engine26LocationContext?.directionState ?? null,
    tradeDirectionBias: engine26LocationContext?.tradeDirectionBias ?? null,
    expectedReactionDirection:
      engine26LocationContext?.expectedReactionDirection ?? null,
    expectedReactions: Array.isArray(engine26LocationContext?.expectedReactions)
      ? engine26LocationContext.expectedReactions
      : [],
    reactionExpected: engine26LocationContext?.reactionExpected ?? null,
    timeframe: engine26LocationContext?.timeframe ?? null,
    snapshotTime: engine26LocationContext?.snapshotTime ?? null,
    engine26LocationContext: engine26LocationContext || null,

    targetModel: TARGET_MODEL,

    // Backward-compatible validation fields, now describing 5m -> 10m rather
    // than 1m -> 5m authority.
    validationState: tenMinuteConfirmation.validationState,
    validationSupports1m: false,
    validationConflictsWith1m: false,
    validationResolved5m: fiveMinuteReaction.maturityResolved === true,
    validationSupports5m: tenMinuteConfirmation.supportsFiveMinuteDirection === true,
    validationConflictsWith5m:
      tenMinuteConfirmation.conflictsWithFiveMinuteDirection === true,

    broaderContextDirection: tenMinuteConfirmation.direction,
    broaderContextState: tenMinuteConfirmation.state,

    confirmationDiagnostics: {
      oneMinuteWatchOnly: true,
      oneMinuteDirection,
      oneMinuteState,
      oneMinuteQuality,
      fiveMinuteDirection: fiveMinuteReaction.direction,
      fiveMinuteState: fiveMinuteReaction.state,
      fiveMinuteQuality: fiveMinuteReaction.quality,
      fiveMinuteMaturityResolved: fiveMinuteReaction.maturityResolved,
      tenMinuteDirection: tenMinuteConfirmation.direction,
      tenMinuteState: tenMinuteConfirmation.state,
      tenMinuteConfirmed: tenMinuteConfirmation.confirmed,
      tenMinuteValidationState: tenMinuteConfirmation.validationState,
      engine26EvaluationAuthorized:
        canonicalResolution.engine26EvaluationAuthorized,
      lifecycleSame: canonicalResolution.lifecycleSame,
      lifecycleChanged: canonicalResolution.lifecycleChanged,
      activePaperTradeLocked,
      zoneExitDirectionLocked,
      authorizedForEngine4,
    },

    // Candle contract remains available for Engine 4 / diagnostics. 1m remains
    // the most immediate observation but has no canonical reaction authority.
    supportingBarTime:
      observation1m?.supportingBarTime ??
      barTime(fiveMinuteReaction?.latestCompletedBar) ??
      null,

    evaluationTimeMs,
    currentCandleStatus: observation1m?.currentCandleStatus || null,
    priorCandleStatus: observation1m?.priorCandleStatus || null,
    currentCandle: observation1m?.currentCandle || null,
    priorCandle: observation1m?.priorCandle || null,
    lastCandle:
      observation1m?.currentCandle ||
      fiveMinuteReaction?.latestCompletedBar ||
      null,

    candleClosed:
      observation1m?.currentCandleStatus === "COMPLETED"
        ? true
        : observation1m?.currentCandleStatus === "FORMING"
        ? false
        : null,

    priorCandleCompleted:
      observation1m?.priorCandleStatus === "COMPLETED"
        ? true
        : observation1m?.priorCandleStatus === "FORMING"
        ? false
        : null,

    candleSourceFresh:
      observation1m?.stale === false &&
      (validation5m == null || validation5m?.stale === false),

    // Legacy inputs are visible only so old UI/routes do not break. They have
    // no Strategy 1 canonical authority in v7.
    currentLevelAction: currentLevelAction || null,
    fastImbalanceReaction: fastImbalanceReaction || null,
    legacyNearestReferenceAuthority: false,
    legacyFastImbalanceAuthority: false,

    lifecycleKey:
      engine22WaveStrategy?.currentLifecycleState?.key || null,

    engine22Direction: getEngine22Direction(engine22WaveStrategy),

    waveContext: buildEngine22DegreeWaveContext({
      engine22WaveStrategy,
      reactionState: bookReactionState,
      reactionDirection: canonicalDirection,
    }),

    requiresEngine6PaperApproval: true,
    realExecutionAuthority: false,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,

    blockers,

    reasonCodes: unique([
      "PAPER_ONLY_RESEARCH_LANE",
      "ENGINE3_STRATEGY1_CANONICAL_REACTION_V7",
      "ENGINE26_NEGOTIATED_ZONE_IS_ONLY_CANONICAL_REFERENCE",
      "ENGINE3_BOOK_BASED_REACTION_LANGUAGE_RESTORED",
      "ENGINE3_1M_WATCH_DISPLAY_ONLY",
      "ENGINE3_5M_PRIMARY_MATURE_REACTION_EVIDENCE",
      "ENGINE3_10M_BROADER_PRICE_CONFIRMATION",
      "ENGINE3_5M_AND_10M_MUST_ALIGN_FOR_INITIAL_DIRECTION",
      "ENGINE3_SEMANTIC_STATE_IS_NOT_DIRECTION_VETO",
      "LEGACY_NEAREST_REFERENCE_AUTHORITY_REMOVED",
      "LEGACY_FAST_IMBALANCE_AUTHORITY_REMOVED",
      "TEN_MINUTE_EMA10_HOLD_RESET_ONLY_AFTER_ESTABLISHED_DIRECTION",
      canonicalResolution.lifecycleChanged
        ? "ENGINE3_RESET_BY_NEW_ENGINE26_LIFECYCLE"
        : null,
      canonicalResolution.directionPersistenceActive
        ? "ENGINE3_DIRECTION_PERSISTENCE_ACTIVE"
        : null,
      canonicalResolution.ema10ResetTriggered
        ? "ENGINE3_DIRECTION_RESET_BY_10M_EMA10"
        : null,
      canonicalResolution.resolutionStatus,
      canonicalResolution.resolutionReason,
      ...fiveMinuteReaction.reasonCodes,
      ...tenMinuteConfirmation.reasonCodes,
      ...(engine26LocationContext?.reasonCodes || []),
      ...qualification.reasonCodes,
      qualified
        ? "ENGINE3_PAPER_SCALP_REACTION_ALLOWED"
        : "ENGINE3_PAPER_SCALP_REACTION_NOT_ALLOWED",
      authorizedForEngine4
        ? "ENGINE4_PARTICIPATION_EVALUATION_ELIGIBLE"
        : "ENGINE4_PARTICIPATION_EVALUATION_NOT_ELIGIBLE",
      "ENGINE4_OWNS_PARTICIPATION",
      "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
      "NO_REAL_PERMISSION_CREATED",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ]),
  };

  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    paperScalpReaction,
  };

  return patchedConfluence;
}

export default buildPaperScalpReaction;
