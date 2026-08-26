// services/core/logic/engine3/paperScalpReaction.js
//
// Engine 3 Strategy 1 canonical PAPER_ONLY price-reaction contract.
//
// Strategy 1 ownership (locked):
// - Engine 26 owns WHERE: exact negotiated zone, candidate identity, lifecycle.
// - Engine 3 owns WHAT PRICE DID at that exact negotiated zone.
// - 1m is watch/display only. It never creates, flips, confirms, or resets canonical direction.
// - 5m is mature price-reaction evidence at the Engine 26 negotiated zone.
// - 10m is broader price-reaction confirmation at that SAME negotiated zone.
// - 5m/10m do not vote LONG/SHORT by candle color; both use the same book-based
//   zone-reaction language (reclaim, failed reclaim, rejection, acceptance,
//   hold/loss, breakout hold/fail, chop, follow-through/aftermath).
// - Once a confirmed direction leaves the zone, 1m/5m are diagnostic only.
// - Post-zone SHORT holds until completed 10m close > EMA10.
// - Post-zone LONG holds until completed 10m close < EMA10.
// - EMA10 never creates an initial direction.
// - A fresh Engine 26 candidate/zone lifecycle resets old Engine 3 direction.
// - Engine 4 owns participation. Engine 6 owns final PAPER permission.
//
// Safety: PAPER_ONLY / RESEARCH_ONLY. No real permission or execution.

import { buildEngine22DegreeWaveContext } from "./engine22DegreeWaveContext.js";
import { buildEngine26LocationReactionContext } from "./engine26LocationReactionContext.js";

const ENGINE = "engine3.paperScalpReaction.v8";
const SOURCE = "engine3.strategy1.bookZoneReaction";

const TARGET_MODEL = {
  instrument: "ES",
  targetPoints: 10,
  exitModel: "THREE_BLOCKS",
};

const IDENTITY_FIELDS = [
  "symbol",
  "laneId",
  "strategyId",
  "candidateId",
  "zoneId",
  "candidateIdentityVersion",
];

const LONG_REACTION_STATES = new Set([
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "SELLERS_TRAPPED",
  "RECLAIMED_LEVEL",
  "HELD_LEVEL",
  "ACCEPTING_VALUE",
  "BREAKOUT_HOLDING",
]);

const SHORT_REACTION_STATES = new Set([
  "LOST_LEVEL",
  "FAILED_RECLAIM",
  "REJECTING_VALUE",
  "BREAKOUT_FAILING",
]);

const WAIT_REACTION_STATES = new Set([
  "CHOP_INSIDE_VALUE",
  "NO_SIGNAL",
  "INSUFFICIENT_CANDLES",
  "NO_NEGOTIATED_ZONE",
]);

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

function normalizeEpochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n < 1e12 ? n * 1000 : n;
}

function barValue(bar, key) {
  if (!bar || typeof bar !== "object") return null;
  const map = {
    open: ["open", "o"],
    high: ["high", "h"],
    low: ["low", "l"],
    close: ["close", "c"],
  };
  for (const k of map[key] || [key]) {
    const n = toNum(bar?.[k]);
    if (n != null) return n;
  }
  return null;
}

function barStartMs(bar) {
  return normalizeEpochMs(bar?.time ?? bar?.t ?? bar?.tSec ?? bar?.timestamp);
}

function resolveNegotiatedZone({ engine26ReactionHandoff = null } = {}) {
  const rawLo = validPrice(engine26ReactionHandoff?.zone?.lo);
  const rawHi = validPrice(engine26ReactionHandoff?.zone?.hi);
  const rawMid = validPrice(engine26ReactionHandoff?.zone?.mid);

  if (rawLo == null || rawHi == null) {
    return {
      valid: false,
      lo: rawLo,
      hi: rawHi,
      mid: rawMid,
      type: engine26ReactionHandoff?.zone?.type || "NEGOTIATED",
      timeframe: engine26ReactionHandoff?.zone?.timeframe || "10m",
    };
  }

  const lo = Math.min(rawLo, rawHi);
  const hi = Math.max(rawLo, rawHi);
  const mid = rawMid != null ? rawMid : (lo + hi) / 2;

  return {
    valid: true,
    lo,
    hi,
    mid,
    type: engine26ReactionHandoff?.zone?.type || "NEGOTIATED",
    timeframe: engine26ReactionHandoff?.zone?.timeframe || "10m",
  };
}

function resolveNegotiatedZonePosition({ currentPrice = null, zone = null } = {}) {
  const price = validPrice(currentPrice);

  if (price == null || zone?.valid !== true) {
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

  if (price >= zone.lo && price <= zone.hi) {
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

  return {
    known: true,
    inside: false,
    position: price < zone.lo ? "BELOW_ZONE" : "ABOVE_ZONE",
    currentPrice: price,
    lo: zone.lo,
    hi: zone.hi,
    mid: zone.mid,
  };
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

function engine26IdentityAligned(engine26ReactionHandoff, authorizationContext) {
  if (!engine26ReactionHandoff || typeof engine26ReactionHandoff !== "object") {
    return false;
  }

  const comparison = authorizationContext?.identityComparison;
  if (comparison && typeof comparison === "object") {
    return comparison.matched === true;
  }

  return IDENTITY_FIELDS.every((field) => {
    const value = engine26ReactionHandoff?.[field];
    return value != null && value !== "";
  });
}

function selectCompletedBars({ bars = [], timeframeMs, evaluationTimeMs, maxBars = 3 } = {}) {
  if (!Array.isArray(bars) || !Number.isFinite(timeframeMs)) return [];

  const evalMs = Number.isFinite(Number(evaluationTimeMs))
    ? Number(evaluationTimeMs)
    : Date.now();

  return bars
    .filter(Boolean)
    .map((bar) => ({ bar, startMs: barStartMs(bar) }))
    .filter(({ startMs }) => startMs != null && startMs + timeframeMs <= evalMs)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(-maxBars)
    .map(({ bar }) => bar);
}

function directionForReactionState(state) {
  const s = safeUpper(state, "NO_SIGNAL");
  if (LONG_REACTION_STATES.has(s)) return "LONG";
  if (SHORT_REACTION_STATES.has(s)) return "SHORT";
  return "NEUTRAL";
}

/*
 * Book-based exact-zone reaction classification.
 *
 * The state is a description of RAW price behavior at Engine 26's negotiated zone.
 * It is never inferred from EMA, wave, shelf, prior-high/low, Engine 25, or nearest-reference data.
 *
 * Precedence intentionally favors the newest aftermath/follow-through event.
 */
function classifyExactZoneReaction({ bar = null, priorBar = null, earlierBar = null, zone = null } = {}) {
  if (zone?.valid !== true) {
    return {
      state: "NO_NEGOTIATED_ZONE",
      direction: "NEUTRAL",
      evidence: [],
    };
  }

  const o = barValue(bar, "open");
  const h = barValue(bar, "high");
  const l = barValue(bar, "low");
  const c = barValue(bar, "close");
  const pc = barValue(priorBar, "close");
  const ec = barValue(earlierBar, "close");

  if ([h, l, c].some((v) => v == null)) {
    return {
      state: "INSUFFICIENT_CANDLES",
      direction: "NEUTRAL",
      evidence: [],
    };
  }

  const evidence = [];
  const inside = c >= zone.lo && c <= zone.hi;
  const above = c > zone.hi;
  const below = c < zone.lo;

  const sweptBelowAndReclaimed = l < zone.lo && c >= zone.lo;
  const rejectedUpperEdge = h > zone.hi && c <= zone.hi;
  const priorBelow = pc != null && pc < zone.lo;
  const priorInsideOrAbove = pc != null && pc >= zone.lo;
  const priorAbove = pc != null && pc > zone.hi;
  const earlierBelow = ec != null && ec < zone.lo;

  // Failed reclaim: recent sequence came from below, got back into/above the zone,
  // then the newest completed bar lost the lower boundary again.
  const failedReclaim =
    below &&
    priorInsideOrAbove &&
    (earlierBelow || (priorBar && barValue(priorBar, "low") < zone.lo));

  if (failedReclaim) {
    evidence.push("RECENT_RECLAIM_FAILED_BACK_BELOW_ZONE_LOW");
    return { state: "FAILED_RECLAIM", direction: "SHORT", evidence };
  }

  if (priorInsideOrAbove && below) {
    evidence.push("COMPLETED_BAR_LOST_NEGOTIATED_ZONE_LOW");
    return { state: "LOST_LEVEL", direction: "SHORT", evidence };
  }

  if (priorAbove && c <= zone.hi) {
    evidence.push("PRIOR_BREAKOUT_ABOVE_ZONE_FAILED_BACK_INTO_VALUE");
    return { state: "BREAKOUT_FAILING", direction: "SHORT", evidence };
  }

  if (rejectedUpperEdge) {
    evidence.push("TRADED_ABOVE_ZONE_HIGH_AND_CLOSED_BACK_IN_OR_BELOW");
    return { state: "REJECTING_VALUE", direction: "SHORT", evidence };
  }

  if (sweptBelowAndReclaimed) {
    evidence.push("TRADED_BELOW_ZONE_LOW_AND_CLOSED_BACK_AT_OR_ABOVE_ZONE_LOW");
    if (o != null && c > o) {
      evidence.push("BULLISH_BODY_AFTER_LOWER_ZONE_SWEEP");
      return { state: "DIP_BOUGHT_FAST", direction: "LONG", evidence };
    }
    return { state: "WICK_BELOW_AND_RECLAIM", direction: "LONG", evidence };
  }

  if (priorBelow && c >= zone.lo) {
    evidence.push("PRIOR_CLOSE_BELOW_ZONE_THEN_COMPLETED_CLOSE_RECLAIMED_ZONE");
    if (c >= zone.mid) {
      evidence.push("RECLAIM_REACHED_OR_EXCEEDED_ZONE_MID");
      return { state: "SELLERS_TRAPPED", direction: "LONG", evidence };
    }
    return { state: "RECLAIMED_LEVEL", direction: "LONG", evidence };
  }

  if (above && priorAbove) {
    evidence.push("CONSECUTIVE_COMPLETED_CLOSES_ABOVE_NEGOTIATED_ZONE");
    return { state: "BREAKOUT_HOLDING", direction: "LONG", evidence };
  }

  if (above && (pc == null || pc <= zone.hi)) {
    evidence.push("COMPLETED_CLOSE_ACCEPTED_ABOVE_NEGOTIATED_ZONE_HIGH");
    return { state: "ACCEPTING_VALUE", direction: "LONG", evidence };
  }

  if (
    inside &&
    c >= zone.mid &&
    pc != null &&
    pc >= zone.mid &&
    pc <= zone.hi
  ) {
    evidence.push("CONSECUTIVE_COMPLETED_CLOSES_HELD_UPPER_HALF_OF_ZONE");
    return { state: "HELD_LEVEL", direction: "LONG", evidence };
  }

  if (inside) {
    evidence.push("COMPLETED_CLOSE_REMAINS_INSIDE_NEGOTIATED_VALUE");
    return { state: "CHOP_INSIDE_VALUE", direction: "NEUTRAL", evidence };
  }

  if (below) {
    evidence.push("PRICE_REMAINS_BELOW_ZONE_WITHOUT_NEW_COMPLETED_TRANSITION");
    return { state: "LOST_LEVEL", direction: "SHORT", evidence };
  }

  return { state: "NO_SIGNAL", direction: "NEUTRAL", evidence };
}

function buildReactionSequence({ bars = [], zone = null, timeframe = "5m" } = {}) {
  const states = [];

  for (let i = 0; i < bars.length; i += 1) {
    const reaction = classifyExactZoneReaction({
      bar: bars[i],
      priorBar: i > 0 ? bars[i - 1] : null,
      earlierBar: i > 1 ? bars[i - 2] : null,
      zone,
    });

    states.push({
      timeframe,
      barTime: barStartMs(bars[i]),
      close: barValue(bars[i], "close"),
      state: reaction.state,
      direction: reaction.direction,
      evidence: reaction.evidence,
    });
  }

  return states;
}

function buildOneMinuteZoneObservation({ observation1m = null, zone = null } = {}) {
  const current = observation1m?.currentCandle || null;
  const prior = observation1m?.priorCandle || null;
  const completed =
    observation1m?.currentCandleStatus === "COMPLETED" ||
    current?.completionState === "COMPLETED";

  const reaction = classifyExactZoneReaction({
    bar: current,
    priorBar: prior,
    earlierBar: null,
    zone,
  });

  return {
    active: Boolean(current),
    role: "WATCH_DISPLAY_ONLY",
    canonicalDirectionAuthority: false,
    canonicalQualificationAuthority: false,
    completed,
    state: reaction.state,
    direction: reaction.direction,
    evidence: reaction.evidence,
    currentCandle: current,
    priorCandle: prior,
    sourceTimeframe: "1m",
  };
}

function buildFiveMinuteZoneReaction({
  fiveMinuteBars = [],
  validation5m = null,
  zone = null,
  evaluationTimeMs = null,
} = {}) {
  let completed = selectCompletedBars({
    bars: fiveMinuteBars,
    timeframeMs: 5 * 60 * 1000,
    evaluationTimeMs,
    maxBars: 3,
  });

  // Compatibility fallback if raw 5m bars are not yet supplied.
  if (completed.length === 0) {
    const fallback = [validation5m?.priorCandle, validation5m?.currentCandle]
      .filter((bar) =>
        bar &&
        (bar?.completionState === "COMPLETED" || bar?.candleClosed === true)
      );
    completed = fallback.slice(-3);
  }

  const sequence = buildReactionSequence({ bars: completed, zone, timeframe: "5m" });
  const latest = sequence.at(-1) || null;
  const direction = latest?.direction || "NEUTRAL";
  const state = latest?.state || (completed.length ? "NO_SIGNAL" : "WAITING_FOR_COMPLETED_5M");

  const previousSameDirection = sequence
    .slice(0, -1)
    .reverse()
    .find((item) => item.direction === direction && direction !== "NEUTRAL");

  const followThrough =
    direction !== "NEUTRAL" &&
    previousSameDirection != null;

  // Keep quality deliberately simple. The book-based state establishes GOOD;
  // repeated same-direction exact-zone evidence upgrades to STRONG.
  const quality =
    direction === "NEUTRAL"
      ? "WEAK"
      : followThrough
      ? "STRONG"
      : "GOOD";

  return {
    active: completed.length > 0,
    role: "MATURE_NEGOTIATED_ZONE_REACTION_EVIDENCE",
    canonicalDirectionAuthority: false,
    state,
    direction,
    quality,
    mature: direction !== "NEUTRAL",
    followThrough,
    completedBarCount: completed.length,
    latestCompletedBar: completed.at(-1) || null,
    priorCompletedBar: completed.at(-2) || null,
    sequence,
    evidence: latest?.evidence || [],
    sourceTimeframe: "5m",
    reason:
      completed.length === 0
        ? "WAITING_FOR_COMPLETED_5M_ZONE_REACTION"
        : direction === "NEUTRAL"
        ? "COMPLETED_5M_ZONE_REACTION_UNRESOLVED"
        : "COMPLETED_5M_BOOK_REACTION_PRESENT",
  };
}

function buildTenMinuteZoneConfirmation({
  tenMinuteBars = [],
  zone = null,
  evaluationTimeMs = null,
  fiveMinuteReaction = null,
} = {}) {
  const completed = selectCompletedBars({
    bars: tenMinuteBars,
    timeframeMs: 10 * 60 * 1000,
    evaluationTimeMs,
    maxBars: 3,
  });

  const sequence = buildReactionSequence({ bars: completed, zone, timeframe: "10m" });
  const latest = sequence.at(-1) || null;
  const direction = latest?.direction || "NEUTRAL";
  const state = latest?.state || (completed.length ? "NO_SIGNAL" : "WAITING_FOR_COMPLETED_10M");
  const candidateDirection = safeUpper(fiveMinuteReaction?.direction, "NEUTRAL");

  const supportsReaction =
    ["LONG", "SHORT"].includes(candidateDirection) &&
    direction === candidateDirection;

  const contradictsReaction =
    ["LONG", "SHORT"].includes(candidateDirection) &&
    ["LONG", "SHORT"].includes(direction) &&
    direction !== candidateDirection;

  return {
    active: completed.length > 0,
    role: "BROADER_NEGOTIATED_ZONE_REACTION_CONFIRMATION",
    canonicalDirectionAuthority: false,
    state,
    direction,
    confirmed: supportsReaction,
    supportsFiveMinuteReaction: supportsReaction,
    contradictsFiveMinuteReaction: contradictsReaction,
    completedBarCount: completed.length,
    latestCompletedBar: completed.at(-1) || null,
    priorCompletedBar: completed.at(-2) || null,
    sequence,
    evidence: latest?.evidence || [],
    sourceTimeframe: "10m",
    reason:
      completed.length === 0
        ? "WAITING_FOR_COMPLETED_10M_ZONE_CONFIRMATION"
        : supportsReaction
        ? "COMPLETED_10M_ZONE_REACTION_CONFIRMS_5M_REACTION"
        : contradictsReaction
        ? "COMPLETED_10M_ZONE_REACTION_CONTRADICTS_5M_REACTION"
        : "COMPLETED_10M_ZONE_REACTION_UNRESOLVED",
  };
}

function buildAuthorizationContext({
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  reactionState = "NO_SIGNAL",
  reactionQuality = "WEAK",
  reactionDirection = "NEUTRAL",
  currentPrice = null,
  lastCandle = null,
} = {}) {
  return buildEngine26LocationReactionContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    reactionInput: {
      state: reactionState,
      quality: reactionQuality,
      direction: reactionDirection,
      confirmed: false,
      currentPrice,
      lastCandle,
      noPermissionCreated: true,
      noExecution: true,
    },
  });
}

function resolveLifecycleIdentity({
  engine26ReactionHandoff = null,
  previousCandidateId = null,
  previousZoneId = null,
} = {}) {
  const candidateId = engine26ReactionHandoff?.candidateId ?? null;
  const zoneId = engine26ReactionHandoff?.zoneId ?? null;

  const candidateChanged =
    previousCandidateId != null &&
    candidateId != null &&
    previousCandidateId !== candidateId;

  const zoneChanged =
    previousZoneId != null &&
    zoneId != null &&
    previousZoneId !== zoneId;

  return {
    candidateId,
    zoneId,
    previousCandidateId,
    previousZoneId,
    candidateChanged,
    zoneChanged,
    freshLifecycle: candidateChanged || zoneChanged,
  };
}

function resolveCanonicalReaction({
  zonePosition,
  fiveMinuteReaction,
  tenMinuteConfirmation,
  authorizationValid,
  identityMatched,
  previousCanonicalDirection = null,
  previousReactionConfirmed = false,
  lifecycleIdentity = null,
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  activePaperTradeDirection = null,
} = {}) {
  const previousDirection = safeUpper(previousCanonicalDirection, "NEUTRAL");
  const activeDirection = safeUpper(activePaperTradeDirection, "NEUTRAL");
  const fiveDirection = safeUpper(fiveMinuteReaction?.direction, "NEUTRAL");

  const previousDirectional = ["LONG", "SHORT"].includes(previousDirection);
  const activeDirectional = ["LONG", "SHORT"].includes(activeDirection);
  const sameLifecycle = lifecycleIdentity?.freshLifecycle !== true;

  const completedClose = toNum(tenMinuteCompletedClose);
  const ema10 = toNum(tenMinuteEma10);
  const emaDataAvailable = completedClose != null && ema10 != null;

  // Fresh Engine 26 lifecycle means the prior trip is finished. Never carry old direction forward.
  if (!sameLifecycle) {
    return {
      state: "WAITING_FOR_NEGOTIATED_ZONE_REACTION",
      direction: "NEUTRAL",
      quality: "WEAK",
      reactionConfirmed: false,
      sourceTimeframe: null,
      reactionTimeframe: null,
      directionPersistenceActive: false,
      persistedConfirmation: false,
      ema10ResetTriggered: false,
      ema10ResetDataAvailable: emaDataAvailable,
      tenMinuteCompletedClose: completedClose,
      tenMinuteEma10: ema10,
      resolutionStatus: "FRESH_ENGINE26_LIFECYCLE_RESET",
      resolutionReason: "ENGINE26_CANDIDATE_OR_ZONE_CHANGED_OLD_ENGINE3_DIRECTION_RELEASED",
      blockers: ["WAITING_FOR_NEW_NEGOTIATED_ZONE_REACTION"],
    };
  }

  // Actual open paper trade is strongest persistence evidence.
  const persistedDirection = activeDirectional
    ? activeDirection
    : previousDirectional && previousReactionConfirmed === true
    ? previousDirection
    : "NEUTRAL";

  const persistedDirectional = ["LONG", "SHORT"].includes(persistedDirection);

  // Once a confirmed reaction has moved OUTSIDE the zone, 10m EMA10 owns HOLD / RESET.
  if (
    persistedDirectional &&
    zonePosition?.known === true &&
    zonePosition?.inside !== true
  ) {
    const resetShort =
      persistedDirection === "SHORT" &&
      emaDataAvailable &&
      completedClose > ema10;

    const resetLong =
      persistedDirection === "LONG" &&
      emaDataAvailable &&
      completedClose < ema10;

    const reset = resetShort || resetLong;

    if (reset) {
      return {
        state: "ZONE_EXIT_DIRECTION_RESET",
        direction: "NEUTRAL",
        quality: "WEAK",
        reactionConfirmed: false,
        sourceTimeframe: "10m",
        reactionTimeframe: "10m",
        directionPersistenceActive: false,
        persistedConfirmation: false,
        ema10ResetTriggered: true,
        ema10ResetDataAvailable: true,
        tenMinuteCompletedClose: completedClose,
        tenMinuteEma10: ema10,
        resolutionStatus: `ZONE_EXIT_${persistedDirection}_RESET_AT_10M_EMA10`,
        resolutionReason:
          persistedDirection === "SHORT"
            ? "ZONE_EXIT_SHORT_RESET_BY_COMPLETED_10M_CLOSE_ABOVE_EMA10"
            : "ZONE_EXIT_LONG_RESET_BY_COMPLETED_10M_CLOSE_BELOW_EMA10",
        blockers: ["ENGINE3_DIRECTION_RESET_BY_COMPLETED_10M_EMA10"],
      };
    }

    return {
      state: "ZONE_EXIT_DIRECTION_PERSISTED",
      direction: persistedDirection,
      quality: "GOOD",
      reactionConfirmed: true,
      sourceTimeframe: "10m_EMA10_HOLD",
      reactionTimeframe: "10m",
      directionPersistenceActive: true,
      persistedConfirmation: true,
      ema10ResetTriggered: false,
      ema10ResetDataAvailable: emaDataAvailable,
      tenMinuteCompletedClose: completedClose,
      tenMinuteEma10: ema10,
      resolutionStatus: `ZONE_EXIT_${persistedDirection}_PERSISTED_BY_10M_EMA10`,
      resolutionReason:
        persistedDirection === "SHORT"
          ? "ZONE_EXIT_SHORT_HELD_UNTIL_COMPLETED_10M_CLOSE_ABOVE_EMA10"
          : "ZONE_EXIT_LONG_HELD_UNTIL_COMPLETED_10M_CLOSE_BELOW_EMA10",
      blockers: [],
    };
  }

  // If Engine 3 already confirmed this SAME lifecycle but price is still in the zone,
  // keep that confirmed answer stable. 1m/5m cannot flip-flop the established reaction.
  if (persistedDirectional && zonePosition?.inside === true) {
    return {
      state: "NEGOTIATED_ZONE_REACTION_LOCKED",
      direction: persistedDirection,
      quality: "GOOD",
      reactionConfirmed: true,
      sourceTimeframe: "ENGINE3_REACTION_LOCK",
      reactionTimeframe: "5m_10m_ZONE_REACTION",
      directionPersistenceActive: true,
      persistedConfirmation: true,
      ema10ResetTriggered: false,
      ema10ResetDataAvailable: emaDataAvailable,
      tenMinuteCompletedClose: completedClose,
      tenMinuteEma10: ema10,
      resolutionStatus: `NEGOTIATED_ZONE_${persistedDirection}_REACTION_LOCKED`,
      resolutionReason: "CONFIRMED_ENGINE3_REACTION_HELD_FOR_CURRENT_ENGINE26_LIFECYCLE",
      blockers: [],
    };
  }

  // EMA10 never manufactures a fresh direction outside the zone.
  if (zonePosition?.known === true && zonePosition?.inside !== true) {
    return {
      state: "WAITING_FOR_NEGOTIATED_ZONE_REACTION",
      direction: "NEUTRAL",
      quality: "WEAK",
      reactionConfirmed: false,
      sourceTimeframe: null,
      reactionTimeframe: null,
      directionPersistenceActive: false,
      persistedConfirmation: false,
      ema10ResetTriggered: false,
      ema10ResetDataAvailable: emaDataAvailable,
      tenMinuteCompletedClose: completedClose,
      tenMinuteEma10: ema10,
      resolutionStatus: "OUTSIDE_ZONE_WITHOUT_ESTABLISHED_DIRECTION",
      resolutionReason: "EMA10_CANNOT_CREATE_INITIAL_DIRECTION",
      blockers: ["WAITING_FOR_NEGOTIATED_ZONE_REACTION"],
    };
  }

  const fiveMature = fiveMinuteReaction?.mature === true && ["LONG", "SHORT"].includes(fiveDirection);
  const tenConfirms = tenMinuteConfirmation?.confirmed === true;

  const blockers = [];
  if (!authorizationValid) blockers.push("ENGINE26_EVALUATION_NOT_AUTHORIZED");
  if (!identityMatched) blockers.push("ENGINE26_ENGINE3_IDENTITY_MISMATCH");
  if (!fiveMature) blockers.push("ENGINE3_WAITING_FOR_MATURE_5M_ZONE_REACTION");
  if (fiveMature && !tenConfirms) blockers.push("ENGINE3_WAITING_FOR_10M_ZONE_REACTION_CONFIRMATION");

  const confirmed = blockers.length === 0;

  return {
    state: confirmed ? fiveMinuteReaction.state : fiveMinuteReaction?.state || "WAITING_FOR_NEGOTIATED_ZONE_REACTION",
    direction: confirmed ? fiveDirection : "NEUTRAL",
    quality: confirmed ? fiveMinuteReaction?.quality || "GOOD" : "WEAK",
    reactionConfirmed: confirmed,
    sourceTimeframe: confirmed ? "5m_BOOK_REACTION_PLUS_10m_CONFIRMATION" : null,
    reactionTimeframe: confirmed ? "5m_10m_ZONE_REACTION" : null,
    directionPersistenceActive: false,
    persistedConfirmation: false,
    ema10ResetTriggered: false,
    ema10ResetDataAvailable: emaDataAvailable,
    tenMinuteCompletedClose: completedClose,
    tenMinuteEma10: ema10,
    resolutionStatus: confirmed
      ? `CANONICAL_${fiveDirection}_NEGOTIATED_ZONE_REACTION_CONFIRMED`
      : "CANONICAL_NEUTRAL_WAITING_FOR_BOOK_REACTION",
    resolutionReason: confirmed
      ? "BOOK_BASED_ENGINE26_ZONE_REACTION_MATURED_ON_5M_AND_CONFIRMED_ON_10M"
      : "WAITING_FOR_BOOK_BASED_NEGOTIATED_ZONE_REACTION_CONFIRMATION",
    blockers,
  };
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

function resolveStrategy1Qualification({ canonicalResolution, authorizationValid, identityMatched } = {}) {
  const blockers = [];

  if (canonicalResolution?.reactionConfirmed !== true) {
    blockers.push("ENGINE3_REACTION_NOT_CONFIRMED");
  }
  if (!authorizationValid) {
    blockers.push("ENGINE26_EVALUATION_NOT_AUTHORIZED");
  }
  if (!identityMatched) {
    blockers.push("ENGINE26_ENGINE3_IDENTITY_MISMATCH");
  }

  const qualified = blockers.length === 0;

  return {
    qualified,
    blockers,
    reasonCodes: [
      qualified
        ? "ENGINE3_STRATEGY1_QUALIFIED_FOR_ENGINE6"
        : "ENGINE3_STRATEGY1_NOT_QUALIFIED_FOR_ENGINE6",
    ],
  };
}

/*
 * Compatibility export for old callers.
 * It intentionally has NO Strategy 1 canonical direction authority.
 */
export function buildPaperScalpReaction({
  currentLevelAction = null,
  fastImbalanceReaction = null,
  engine22WaveStrategy = null,
  paperShortResearchEnabled = false,
} = {}) {
  const diagnosticInput =
    (fastImbalanceReaction && typeof fastImbalanceReaction === "object"
      ? fastImbalanceReaction
      : null) ||
    (currentLevelAction && typeof currentLevelAction === "object"
      ? currentLevelAction
      : {});

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
    broaderContextOnly: true,
    canonicalDirectionAuthority: false,
    canonicalQualificationAuthority: false,
    engine22Direction: getEngine22Direction(engine22WaveStrategy),
    paperShortResearchEnabled: paperShortResearchEnabled === true,
    noPermissionCreated: true,
    noRealPermissionCreated: true,
    noExecution: true,
    realExecutionAuthority: false,
    blockers: ["COMPATIBILITY_DIAGNOSTIC_ONLY"],
    reasonCodes: [
      "ENGINE3_COMPATIBILITY_DIAGNOSTIC_ONLY",
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

  // Legacy objects are preserved as diagnostics ONLY. They never own canonical Strategy 1 reaction.
  const currentLevelAction =
    patchedConfluence?.context?.reaction?.currentLevelAction || null;
  const fastImbalanceReaction =
    patchedConfluence?.context?.reaction?.engine3FastImbalanceReaction || null;

  const observation1m =
    patchedConfluence?.context?.reaction?.engine3ReactionObservation1m || null;
  const validation5m =
    patchedConfluence?.context?.reaction?.engine3ReactionValidation5m || null;

  const zone = resolveNegotiatedZone({ engine26ReactionHandoff });

  const currentPrice =
    validPrice(observation1m?.currentPrice) ??
    validPrice(observation1m?.currentCandle?.close) ??
    validPrice(engine26ReactionHandoff?.currentPrice) ??
    validPrice(engine26ReactionHandoff?.zone?.currentPrice) ??
    null;

  const zonePosition = resolveNegotiatedZonePosition({ currentPrice, zone });

  const evaluationTimeMs =
    toNum(observation1m?.evaluationTimeMs) ??
    toNum(observation1m?.observedAt) ??
    Date.now();

  const oneMinuteZoneReaction = buildOneMinuteZoneObservation({
    observation1m,
    zone,
  });

  const fiveMinuteReaction = buildFiveMinuteZoneReaction({
    fiveMinuteBars,
    validation5m,
    zone,
    evaluationTimeMs,
  });

  const tenMinuteConfirmation = buildTenMinuteZoneConfirmation({
    tenMinuteBars,
    zone,
    evaluationTimeMs,
    fiveMinuteReaction,
  });

  const lifecycleIdentity = resolveLifecycleIdentity({
    engine26ReactionHandoff,
    previousCandidateId,
    previousZoneId,
  });

  // Build Engine 26 transport from the exact-zone 5m reaction candidate.
  const authorizationContext = buildAuthorizationContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    reactionState: fiveMinuteReaction.state,
    reactionQuality: fiveMinuteReaction.quality,
    reactionDirection: fiveMinuteReaction.direction,
    currentPrice,
    lastCandle: fiveMinuteReaction.latestCompletedBar || observation1m?.currentCandle || null,
  });

  const authorizationValid =
    authorizationContext?.active === true &&
    authorizationContext?.authorized === true &&
    authorizationContext?.authorizeEngine3Evaluation === true;

  const identityMatched = engine26IdentityAligned(
    engine26ReactionHandoff,
    authorizationContext
  );

  const canonicalResolution = resolveCanonicalReaction({
    zonePosition,
    fiveMinuteReaction,
    tenMinuteConfirmation,
    authorizationValid,
    identityMatched,
    previousCanonicalDirection,
    previousReactionConfirmed,
    lifecycleIdentity,
    tenMinuteCompletedClose,
    tenMinuteEma10,
    activePaperTradeDirection,
  });

  // Rebuild Engine 26 reaction context with the FINAL Engine 3 result for downstream metadata.
  // Its own expected-direction labels remain diagnostic; canonical direction above is already decided.
  const engine26LocationContext = buildEngine26LocationReactionContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    reactionInput: {
      state: canonicalResolution.state,
      quality: canonicalResolution.quality,
      direction: canonicalResolution.direction,
      confirmed: canonicalResolution.reactionConfirmed === true,
      currentPrice,
      lastCandle: fiveMinuteReaction.latestCompletedBar || observation1m?.currentCandle || null,
      noPermissionCreated: true,
      noExecution: true,
    },
  });

  const qualification = resolveStrategy1Qualification({
    canonicalResolution,
    authorizationValid,
    identityMatched,
  });

  const qualified = qualification.qualified === true;
  const setupType = setupTypeForCanonical({
    state: canonicalResolution.state,
    direction: canonicalResolution.direction,
  });

  const blockers = unique([
    ...(canonicalResolution.blockers || []),
    ...(qualification.blockers || []),
  ]);

  const reasonCodes = unique([
    "PAPER_ONLY_RESEARCH_LANE",
    "ENGINE3_STRATEGY1_CANONICAL_REACTION_V8",
    "ENGINE26_NEGOTIATED_ZONE_IS_ONLY_CANONICAL_REFERENCE",
    "ENGINE3_BOOK_BASED_REACTION_BRAIN_ACTIVE",
    "ENGINE3_APPROACH_CONTACT_AFTERMATH_SEQUENCE_MODEL",
    "ENGINE3_1M_WATCH_DISPLAY_ONLY",
    "ENGINE3_5M_MATURE_NEGOTIATED_ZONE_REACTION_EVIDENCE",
    "ENGINE3_10M_BROADER_NEGOTIATED_ZONE_REACTION_CONFIRMATION",
    "ENGINE3_5M_10M_DO_NOT_VOTE_BY_CANDLE_COLOR",
    "LEGACY_NEAREST_REFERENCE_AUTHORITY_REMOVED",
    "LEGACY_FAST_IMBALANCE_AUTHORITY_REMOVED",
    lifecycleIdentity.freshLifecycle
      ? "ENGINE26_FRESH_LIFECYCLE_RESETS_ENGINE3"
      : "ENGINE26_LIFECYCLE_IDENTITY_PRESERVED",
    canonicalResolution.directionPersistenceActive
      ? "ENGINE3_DIRECTION_PERSISTENCE_ACTIVE"
      : null,
    canonicalResolution.ema10ResetTriggered
      ? "ENGINE3_DIRECTION_RESET_BY_10M_EMA10"
      : null,
    canonicalResolution.resolutionStatus,
    canonicalResolution.resolutionReason,
    authorizationValid ? "ENGINE26_EVALUATION_AUTHORIZED" : null,
    identityMatched ? "ENGINE26_ENGINE3_IDENTITY_ALIGNED" : null,
    fiveMinuteReaction.state ? `ENGINE3_5M_STATE_${fiveMinuteReaction.state}` : null,
    tenMinuteConfirmation.state ? `ENGINE3_10M_STATE_${tenMinuteConfirmation.state}` : null,
    ...(qualification.reasonCodes || []),
    qualified
      ? "ENGINE3_PAPER_SCALP_REACTION_ALLOWED"
      : "ENGINE3_PAPER_SCALP_REACTION_NOT_ALLOWED",
    qualified
      ? "ENGINE4_PARTICIPATION_EVALUATION_ELIGIBLE"
      : "ENGINE4_PARTICIPATION_EVALUATION_NOT_ELIGIBLE",
    "ENGINE4_OWNS_PARTICIPATION",
    "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
    "NO_REAL_PERMISSION_CREATED",
    "NO_PERMISSION_CREATED",
    "NO_EXECUTION",
  ]);

  const paperScalpReaction = {
    active: true,
    engine: ENGINE,
    source: SOURCE,
    mode: "PAPER_ONLY",
    researchOnly: true,
    fastMode: false,

    // ONE canonical Engine 3 answer.
    state: canonicalResolution.state,
    reactionState: canonicalResolution.state,
    direction: canonicalResolution.direction,
    quality: canonicalResolution.quality,
    setupType,
    reactionConfirmed: canonicalResolution.reactionConfirmed === true,

    allowed: qualified,
    authorizedForEngine4: qualified,
    engine3Strategy1QualifiedForEngine6: qualified,
    participationEvaluationEligible: qualified,
    qualificationExplicitlyPublished: true,

    canonicalResolutionStatus: canonicalResolution.resolutionStatus,
    canonicalResolutionReason: canonicalResolution.resolutionReason,
    sourceTimeframe: canonicalResolution.sourceTimeframe,
    reactionTimeframe: canonicalResolution.reactionTimeframe,

    currentPrice,
    insideNegotiatedZone: zonePosition.inside === true,
    negotiatedZonePosition: zonePosition.position,
    negotiatedZonePositionKnown: zonePosition.known,
    negotiatedZoneLo: zone.lo,
    negotiatedZoneHi: zone.hi,
    negotiatedZoneMid: zone.mid,

    canonicalReferenceType: "ENGINE26_NEGOTIATED_ZONE",
    canonicalReferenceLabel: "ENGINE26_NEGOTIATED_ZONE",
    canonicalReference: {
      candidateId: lifecycleIdentity.candidateId,
      zoneId: lifecycleIdentity.zoneId,
      lo: zone.lo,
      hi: zone.hi,
      mid: zone.mid,
      type: zone.type,
      timeframe: zone.timeframe,
    },

    // Fast sensor: visible at all times, NEVER canonical authority.
    oneMinuteZoneReaction,
    reactionObservation1m: observation1m,
    oneMinuteImmediateDirection: oneMinuteZoneReaction.direction,
    oneMinuteReactionState: oneMinuteZoneReaction.state,

    // Mature book-based reaction evidence.
    fiveMinuteReaction,
    reactionValidation5m: validation5m,
    fiveMinuteValidationDirection: fiveMinuteReaction.direction,
    fiveMinuteReactionState: fiveMinuteReaction.state,
    fiveMinuteReactionQuality: fiveMinuteReaction.quality,
    fiveMinuteReactionSequence: fiveMinuteReaction.sequence,

    // Broader confirmation of the SAME zone reaction.
    tenMinuteConfirmation,
    broaderReaction10m: tenMinuteConfirmation,
    broaderTenMinuteDirection: tenMinuteConfirmation.direction,
    broaderContextDirection: tenMinuteConfirmation.direction,
    broaderContextState: tenMinuteConfirmation.state,
    tenMinuteReactionState: tenMinuteConfirmation.state,
    tenMinuteReactionSequence: tenMinuteConfirmation.sequence,

    previousCanonicalDirection:
      ["LONG", "SHORT"].includes(safeUpper(previousCanonicalDirection, "NEUTRAL"))
        ? safeUpper(previousCanonicalDirection, "NEUTRAL")
        : "NEUTRAL",
    previousReactionConfirmed: previousReactionConfirmed === true,
    previousCandidateId,
    previousZoneId,
    freshEngine26Lifecycle: lifecycleIdentity.freshLifecycle,

    directionPersistenceActive: canonicalResolution.directionPersistenceActive,
    persistedConfirmation: canonicalResolution.persistedConfirmation,
    tenMinuteCompletedClose: canonicalResolution.tenMinuteCompletedClose,
    tenMinuteEma10: canonicalResolution.tenMinuteEma10,
    ema10ResetDataAvailable: canonicalResolution.ema10ResetDataAvailable,
    ema10ResetTriggered: canonicalResolution.ema10ResetTriggered,

    directionEstablishmentTimeframe: "BOOK_REACTION_5m_MATURITY_10m_CONFIRMATION",
    validationTimeframe: "10m_BOOK_REACTION_CONFIRMATION",
    directionResetTimeframe: "10m_EMA10_POST_ZONE_ONLY",

    // Engine 26 authorization / identity transport.
    authorized: authorizationContext?.authorized === true,
    evaluationAuthorized: authorizationContext?.authorizeEngine3Evaluation === true,
    authorizeEngine3Evaluation: authorizationContext?.authorizeEngine3Evaluation === true,
    engine26ReactionVerified:
      canonicalResolution.reactionConfirmed === true && authorizationValid && identityMatched,

    candidateId: lifecycleIdentity.candidateId,
    zoneId: lifecycleIdentity.zoneId,
    laneId: engine26ReactionHandoff?.laneId ?? null,
    strategyId: engine26ReactionHandoff?.strategyId ?? null,
    symbol: engine26ReactionHandoff?.symbol ?? null,
    setupClass: engine26ReactionHandoff?.setupClass ?? null,
    setupGrade: engine26ReactionHandoff?.setupGrade ?? null,
    identitySetupKey: engine26ReactionHandoff?.identitySetupKey ?? null,
    candidateIdentityVersion: engine26ReactionHandoff?.candidateIdentityVersion ?? null,
    canonicalIdentity: authorizationContext?.canonicalIdentity || null,
    sourceIdentity: authorizationContext?.sourceIdentity || null,
    identityComparison: authorizationContext?.identityComparison || null,
    contactState: authorizationContext?.contactState ?? null,
    chainArmed: authorizationContext?.chainArmed === true,
    directionState: authorizationContext?.directionState ?? null,
    tradeDirectionBias: authorizationContext?.tradeDirectionBias ?? null,
    expectedReactionDirection: authorizationContext?.expectedReactionDirection ?? null,
    expectedReactions: Array.isArray(authorizationContext?.expectedReactions)
      ? authorizationContext.expectedReactions
      : [],
    authorizedReactionState:
      canonicalResolution.reactionConfirmed === true
        ? "REACTION_CONFIRMED"
        : authorizationContext?.state ?? canonicalResolution.state,
    authorizedReactionRawState: canonicalResolution.state,
    reactionExpected: authorizationContext?.reactionExpected ?? null,
    armed: authorizationContext?.armed === true,
    timeframe: authorizationContext?.timeframe ?? engine26ReactionHandoff?.timeframe ?? null,
    snapshotTime: authorizationContext?.snapshotTime ?? engine26ReactionHandoff?.snapshotTime ?? null,

    targetModel: TARGET_MODEL,

    referenceLevel: zone.mid,
    referenceType: "ENGINE26_NEGOTIATED_ZONE",
    referenceLabel: "ENGINE26_NEGOTIATED_ZONE",
    distancePts:
      currentPrice != null && zone.mid != null
        ? Math.abs(currentPrice - zone.mid)
        : null,

    // Legacy diagnostics retained ONLY for visibility / compatibility.
    currentLevelAction: currentLevelAction || null,
    fastImbalanceReaction: fastImbalanceReaction || null,
    engine26LocationContext: engine26LocationContext || null,

    validationState: validation5m?.validationState || null,
    validationSupports1m: validation5m?.supports1mDirection === true,
    validationConflictsWith1m: validation5m?.conflictsWith1mDirection === true,
    validationResolved5m: validation5m?.maturityResolved === true,

    confirmationDiagnostics: {
      authorizationValid,
      identityMatched,
      freshEngine26Lifecycle: lifecycleIdentity.freshLifecycle,
      fiveMinuteMature: fiveMinuteReaction.mature === true,
      fiveMinuteDirection: fiveMinuteReaction.direction,
      fiveMinuteState: fiveMinuteReaction.state,
      fiveMinuteQuality: fiveMinuteReaction.quality,
      fiveMinuteFollowThrough: fiveMinuteReaction.followThrough,
      tenMinuteConfirmed: tenMinuteConfirmation.confirmed === true,
      tenMinuteDirection: tenMinuteConfirmation.direction,
      tenMinuteState: tenMinuteConfirmation.state,
      tenMinuteSupportsFiveMinuteReaction:
        tenMinuteConfirmation.supportsFiveMinuteReaction === true,
      tenMinuteContradictsFiveMinuteReaction:
        tenMinuteConfirmation.contradictsFiveMinuteReaction === true,
      insideNegotiatedZone: zonePosition.inside === true,
      persistedConfirmation: canonicalResolution.persistedConfirmation === true,
    },

    // Candle contract retained for Engine 4 compatibility.
    supportingBarTime: observation1m?.supportingBarTime ?? null,
    evaluationTimeMs,
    currentCandleStatus: observation1m?.currentCandleStatus || null,
    priorCandleStatus: observation1m?.priorCandleStatus || null,
    currentCandle: observation1m?.currentCandle || null,
    priorCandle: observation1m?.priorCandle || null,
    lastCandle:
      fiveMinuteReaction.latestCompletedBar ||
      observation1m?.currentCandle ||
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

    lifecycleKey: engine22WaveStrategy?.currentLifecycleState?.key || null,
    engine22Direction: getEngine22Direction(engine22WaveStrategy),
    waveContext: buildEngine22DegreeWaveContext({
      engine22WaveStrategy,
      reactionState: canonicalResolution.state,
      reactionDirection: canonicalResolution.direction,
    }),

    requiresEngine6PaperApproval: true,
    realExecutionAuthority: false,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,

    blockers,
    reasonCodes,
  };

  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    paperScalpReaction,
  };

  return patchedConfluence;
}

export default buildPaperScalpReaction;
