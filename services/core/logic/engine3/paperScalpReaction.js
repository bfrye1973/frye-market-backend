// services/core/logic/engine3/paperScalpReaction.js
//
// Engine 3 — Strategy 1 canonical PAPER_ONLY price-reaction contract.
//
// LONG-RUN OWNERSHIP CONTRACT
// - Engine 26 owns WHERE: canonical Strategy 1 candidate + negotiated zone.
// - Engine 3 owns WHAT PRICE DID THERE.
// - 1m is WATCH / DISPLAY ONLY. It never creates, flips, confirms, or invalidates
//   canonical Engine 3 direction.
// - 5m is the mature price-reaction evidence layer at the exact Engine 26 zone.
// - 10m is the broader price-confirmation layer at the same exact Engine 26 zone.
// - Engine 4 owns participation / volume confirmation.
// - Engine 6 owns final PAPER permission.
// - Engine 22, old fast-imbalance logic, generic nearest-reference logic, EMA10,
//   EMA20, shelves, prior highs/lows, and other legacy references do NOT create
//   the initial Strategy 1 Engine 3 direction.
//
// TRAVEL / PERSISTENCE CONTRACT
// - Once Engine 3 has confirmed LONG/SHORT for the current Engine 26 lifecycle,
//   that canonical direction is stable. 1m and 5m may continue to display fresh
//   diagnostics but cannot flip the canonical direction.
// - After price leaves the negotiated zone, completed 10m close vs 10m EMA10
//   owns HOLD / RESET only:
//     SHORT stays SHORT until completed 10m close > EMA10.
//     LONG  stays LONG  until completed 10m close < EMA10.
// - EMA10 never creates initial direction.
// - A fresh Engine 26 candidate / zone lifecycle resets prior Engine 3 direction.
//   Engine 26 midpoint completion therefore starts a new neutral reaction cycle.
//
// CANONICAL REACTION LANGUAGE
// The following states are evaluated ONLY against the Engine 26 negotiated zone:
// WICK_BELOW_AND_RECLAIM, DIP_BOUGHT_FAST, SELLERS_TRAPPED,
// HELD_LEVEL, RECLAIMED_LEVEL, LOST_LEVEL, FAILED_RECLAIM,
// ACCEPTING_VALUE, REJECTING_VALUE, BREAKOUT_HOLDING,
// BREAKOUT_FAILING, CHOP_INSIDE_VALUE.
//
// Output path:
// confluence.context.reaction.paperScalpReaction

import { buildEngine22DegreeWaveContext } from "./engine22DegreeWaveContext.js";
import { deriveCandleCompletionTruth } from "./candleCompletionTruth.js";
import { buildEngine26LocationReactionContext } from "./engine26LocationReactionContext.js";

const ENGINE = "engine3.paperScalpReaction.v5";
const SOURCE = "engine3.strategy1.negotiatedZoneReaction";

const TARGET_MODEL = {
  instrument: "ES",
  targetPoints: 10,
  exitModel: "THREE_BLOCKS",
};

const LONG_STATES = new Set([
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "SELLERS_TRAPPED",
  "HELD_LEVEL",
  "RECLAIMED_LEVEL",
  "ACCEPTING_VALUE",
  "BREAKOUT_HOLDING",
]);

const SHORT_STATES = new Set([
  "LOST_LEVEL",
  "FAILED_RECLAIM",
  "REJECTING_VALUE",
  "BREAKOUT_FAILING",
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

function normalizeZone(handoff = null) {
  const sources = [
    handoff?.zone,
    handoff?.negotiatedZone,
  ];

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    const rawLo = validPrice(
      source?.lo ?? source?.low ?? source?.zoneLo
    );
    const rawHi = validPrice(
      source?.hi ?? source?.high ?? source?.zoneHi
    );

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
      relation: source?.relation ?? null,
    };
  }

  return null;
}

function zonePosition(currentPrice, zone) {
  const price = validPrice(currentPrice);
  if (price == null || !zone) {
    return {
      known: false,
      inside: false,
      position: "UNKNOWN",
    };
  }

  if (price < zone.lo) {
    return { known: true, inside: false, position: "BELOW_ZONE" };
  }

  if (price > zone.hi) {
    return { known: true, inside: false, position: "ABOVE_ZONE" };
  }

  return { known: true, inside: true, position: "INSIDE_ZONE" };
}

function getEngine22Direction(engine22WaveStrategy) {
  return safeUpper(
    engine22WaveStrategy?.currentLifecycleState?.direction ??
      engine22WaveStrategy?.waveOpportunity?.direction ??
      engine22WaveStrategy?.direction,
    "NEUTRAL"
  );
}

function identityValue(source, key) {
  const value = source?.[key];
  return value === undefined || value === null || String(value).trim() === ""
    ? null
    : value;
}

function identityMatches(source, handoff) {
  if (!source || !handoff) return false;

  const keys = [
    "symbol",
    "laneId",
    "strategyId",
    "candidateId",
    "zoneId",
    "candidateIdentityVersion",
  ];

  for (const key of keys) {
    const a = identityValue(source, key);
    const b = identityValue(handoff, key);

    // Missing diagnostic fields are allowed; published conflicts are not.
    if (a != null && b != null && String(a) !== String(b)) {
      return false;
    }
  }

  return true;
}

function sameLifecycle({
  previousCandidateId = null,
  previousZoneId = null,
  handoff = null,
} = {}) {
  const currentCandidateId = identityValue(handoff, "candidateId");
  const currentZoneId = identityValue(handoff, "zoneId");

  // Once the snapshot builder publishes previous identity, require exact match.
  if (previousCandidateId != null && currentCandidateId != null) {
    if (String(previousCandidateId) !== String(currentCandidateId)) return false;
  }

  if (previousZoneId != null && currentZoneId != null) {
    if (String(previousZoneId) !== String(currentZoneId)) return false;
  }

  return true;
}

function completedCandle(source, which = "current") {
  const candle =
    which === "prior"
      ? source?.priorCandle
      : source?.currentCandle;

  const status =
    which === "prior"
      ? source?.priorCandleStatus
      : source?.currentCandleStatus;

  if (!candle || status !== "COMPLETED") return null;
  return candle;
}


/*
 * Evaluate price behavior at ONE reference only: the Engine 26 negotiated zone.
 *
 * This is intentionally deterministic and reference-specific. It does not scan
 * EMAs, wave levels, shelves, prior highs/lows, trigger levels, or any nearest
 * reference pool.
 *
 * The result exposes both a primary state and all raw book-language evidence so
 * the timeline can show exactly what Engine 3 is seeing.
 */
function evaluateZoneReaction({ priorBar = null, currentBar = null, zone = null } = {}) {
  if (!zone || !currentBar) {
    return {
      active: false,
      state: "NO_SIGNAL",
      direction: "NEUTRAL",
      evidence: [],
      followThrough: false,
      reasonCodes: ["NEGOTIATED_ZONE_REACTION_DATA_INCOMPLETE"],
    };
  }

  const o = barOpen(currentBar);
  const h = barHigh(currentBar);
  const l = barLow(currentBar);
  const c = barClose(currentBar);

  const po = barOpen(priorBar);
  const ph = barHigh(priorBar);
  const pl = barLow(priorBar);
  const pc = barClose(priorBar);

  if ([h, l, c].some((value) => value == null)) {
    return {
      active: false,
      state: "NO_SIGNAL",
      direction: "NEUTRAL",
      evidence: [],
      followThrough: false,
      reasonCodes: ["NEGOTIATED_ZONE_CANDLE_OHLC_INCOMPLETE"],
    };
  }

  const evidence = [];

  const wickBelowAndReclaim = l < zone.lo && c >= zone.lo;
  const dipBoughtFast = wickBelowAndReclaim && o != null && c > o;
  const sellersTrapped = pc != null && pc < zone.lo && c >= zone.lo;
  const reclaimedLevel = pc != null && pc < zone.lo && c >= zone.lo;

  const acceptingValue = pc != null && pc <= zone.hi && c > zone.hi;
  const breakoutHolding = pc != null && pc > zone.hi && c > zone.hi;

  // HELD_LEVEL means the prior completed candle had already reclaimed / held
  // the lower half of the negotiated zone and the next completed candle did not
  // lose it. It is evidence of persistence, not a standalone initial trigger.
  const heldLevel =
    pc != null &&
    pc >= zone.mid &&
    c >= zone.mid &&
    l >= zone.lo;

  const rejectingValue = h > zone.hi && c <= zone.hi;
  const breakoutFailing = pc != null && pc > zone.hi && c <= zone.hi;
  const lostLevel = pc != null && pc >= zone.lo && c < zone.lo;
  const failedReclaim =
    pc != null &&
    pc < zone.lo &&
    h >= zone.lo &&
    c < zone.lo;

  const chopInsideValue = c >= zone.lo && c <= zone.hi;

  if (wickBelowAndReclaim) evidence.push("WICK_BELOW_AND_RECLAIM");
  if (dipBoughtFast) evidence.push("DIP_BOUGHT_FAST");
  if (sellersTrapped) evidence.push("SELLERS_TRAPPED");
  if (reclaimedLevel) evidence.push("RECLAIMED_LEVEL");
  if (heldLevel) evidence.push("HELD_LEVEL");
  if (acceptingValue) evidence.push("ACCEPTING_VALUE");
  if (breakoutHolding) evidence.push("BREAKOUT_HOLDING");

  if (rejectingValue) evidence.push("REJECTING_VALUE");
  if (breakoutFailing) evidence.push("BREAKOUT_FAILING");
  if (lostLevel) evidence.push("LOST_LEVEL");
  if (failedReclaim) evidence.push("FAILED_RECLAIM");

  if (chopInsideValue) evidence.push("CHOP_INSIDE_VALUE");

  // Primary state prioritizes a transition / failure over passive location.
  let state = "NO_SIGNAL";

  if (breakoutFailing) state = "BREAKOUT_FAILING";
  else if (failedReclaim) state = "FAILED_RECLAIM";
  else if (lostLevel) state = "LOST_LEVEL";
  else if (rejectingValue) state = "REJECTING_VALUE";
  else if (breakoutHolding) state = "BREAKOUT_HOLDING";
  else if (acceptingValue) state = "ACCEPTING_VALUE";
  else if (sellersTrapped) state = "SELLERS_TRAPPED";
  else if (reclaimedLevel) state = "RECLAIMED_LEVEL";
  else if (dipBoughtFast) state = "DIP_BOUGHT_FAST";
  else if (wickBelowAndReclaim) state = "WICK_BELOW_AND_RECLAIM";
  else if (heldLevel) state = "HELD_LEVEL";
  else if (chopInsideValue) state = "CHOP_INSIDE_VALUE";

  let direction = "NEUTRAL";
  if (LONG_STATES.has(state)) direction = "LONG";
  if (SHORT_STATES.has(state)) direction = "SHORT";

  // Follow-through is deliberately simple and raw-price based:
  // LONG evidence must not close lower than the prior completed close;
  // SHORT evidence must not close higher than the prior completed close.
  // This is not a second direction classifier; it only describes aftermath.
  let followThrough = false;
  if (pc != null && direction === "LONG") followThrough = c >= pc;
  if (pc != null && direction === "SHORT") followThrough = c <= pc;

  return {
    active: true,
    state,
    direction,
    evidence: unique(evidence),
    followThrough,
    currentClose: c,
    priorClose: pc,
    currentOpen: o,
    currentHigh: h,
    currentLow: l,
    priorOpen: po,
    priorHigh: ph,
    priorLow: pl,
    reasonCodes: unique([
      `ENGINE3_ZONE_STATE_${state}`,
      direction !== "NEUTRAL" ? `ENGINE3_ZONE_DIRECTION_${direction}` : null,
      followThrough ? "ENGINE3_ZONE_FOLLOW_THROUGH_PRESENT" : null,
    ]),
  };
}

function buildFiveMinuteReaction({ validation5m, zone, handoff } = {}) {
  const identityAligned = identityMatches(validation5m, handoff);
  const current = completedCandle(validation5m, "current");
  const prior = completedCandle(validation5m, "prior");

  const sourceFresh = validation5m?.stale === false;

  if (!identityAligned) {
    return {
      active: false,
      state: "IDENTITY_MISMATCH",
      direction: "NEUTRAL",
      evidence: [],
      confirmedCandleData: false,
      sourceFresh,
      identityAligned: false,
      reasonCodes: ["ENGINE3_5M_IDENTITY_MISMATCH"],
    };
  }

  if (!sourceFresh) {
    return {
      active: false,
      state: "STALE",
      direction: "NEUTRAL",
      evidence: [],
      confirmedCandleData: false,
      sourceFresh: false,
      identityAligned: true,
      reasonCodes: [validation5m?.staleReason || "ENGINE3_5M_SOURCE_STALE"],
    };
  }

  if (!current || !prior) {
    return {
      active: false,
      state: "WAITING_FOR_COMPLETED_5M",
      direction: "NEUTRAL",
      evidence: [],
      confirmedCandleData: false,
      sourceFresh: true,
      identityAligned: true,
      reasonCodes: ["ENGINE3_WAITING_FOR_TWO_COMPLETED_5M_CANDLES"],
    };
  }

  const reaction = evaluateZoneReaction({
    priorBar: prior,
    currentBar: current,
    zone,
  });

  return {
    ...reaction,
    sourceTimeframe: "5m",
    confirmedCandleData: true,
    sourceFresh: true,
    identityAligned: true,
  };
}

function buildTenMinuteConfirmation({
  tenMinuteBars = [],
  zone = null,
  evaluationTimeMs = null,
} = {}) {
  const truth = deriveCandleCompletionTruth({
    bars: Array.isArray(tenMinuteBars) ? tenMinuteBars : [],
    timeframe: "10m",
    evaluationTimeMs,
  });

  const recent = Array.isArray(truth.completedBars)
    ? truth.completedBars.slice(-3)
    : [];

  if (!zone || recent.length < 2) {
    return {
      active: false,
      state: "WAITING_FOR_COMPLETED_10M_CONFIRMATION",
      direction: "NEUTRAL",
      evidence: [],
      confirmed: false,
      reasonCodes: ["ENGINE3_WAITING_FOR_10M_NEGOTIATED_ZONE_CONFIRMATION"],
    };
  }

  const prior = recent[recent.length - 2];
  const current = recent[recent.length - 1];

  const reaction = evaluateZoneReaction({
    priorBar: prior,
    currentBar: current,
    zone,
  });

  return {
    ...reaction,
    sourceTimeframe: "10m",
    confirmed: reaction.direction !== "NEUTRAL",
  };
}

function buildInitialReaction({
  engine26ReactionHandoff,
  fiveMinuteReaction,
  tenMinuteConfirmation,
} = {}) {
  const authorized = engine26ReactionHandoff?.authorizeEngine3Evaluation === true;
  const handoffActive = engine26ReactionHandoff?.active !== false;
  const identityReady =
    identityValue(engine26ReactionHandoff, "candidateId") != null &&
    identityValue(engine26ReactionHandoff, "zoneId") != null;

  const fiveDirection = safeUpper(fiveMinuteReaction?.direction, "NEUTRAL");
  const tenDirection = safeUpper(tenMinuteConfirmation?.direction, "NEUTRAL");

  const aligned =
    ["LONG", "SHORT"].includes(fiveDirection) &&
    fiveDirection === tenDirection;

  const confirmed =
    authorized &&
    handoffActive &&
    identityReady &&
    fiveMinuteReaction?.confirmedCandleData === true &&
    fiveMinuteReaction?.sourceFresh === true &&
    fiveMinuteReaction?.identityAligned === true &&
    tenMinuteConfirmation?.confirmed === true &&
    aligned;

  const blockers = unique([
    !authorized ? "ENGINE26_ENGINE3_EVALUATION_NOT_AUTHORIZED" : null,
    !handoffActive ? "ENGINE26_REACTION_HANDOFF_NOT_ACTIVE" : null,
    !identityReady ? "ENGINE26_REACTION_IDENTITY_INCOMPLETE" : null,
    fiveMinuteReaction?.identityAligned === false ? "ENGINE3_5M_IDENTITY_MISMATCH" : null,
    fiveMinuteReaction?.sourceFresh === false ? "ENGINE3_5M_SOURCE_STALE" : null,
    fiveMinuteReaction?.confirmedCandleData !== true
      ? "ENGINE3_WAITING_FOR_COMPLETED_5M_REACTION"
      : null,
    tenMinuteConfirmation?.confirmed !== true
      ? "ENGINE3_WAITING_FOR_COMPLETED_10M_CONFIRMATION"
      : null,
    fiveDirection !== "NEUTRAL" && tenDirection !== "NEUTRAL" && fiveDirection !== tenDirection
      ? "ENGINE3_5M_10M_REACTION_CONFLICT"
      : null,
  ]);

  return {
    confirmed,
    direction: confirmed ? fiveDirection : "NEUTRAL",
    state: confirmed
      ? fiveMinuteReaction?.state || "REACTION_CONFIRMED"
      : fiveMinuteReaction?.state || "WATCHING_NEGOTIATED_ZONE",
    // Until a separate Strategy 1 quality scale is manager-approved for the
    // restored book-based model, every fully confirmed reaction is GOOD.
    // Engine 3 does not manufacture STRONG from arbitrary thresholds.
    quality: confirmed ? "GOOD" : "WEAK",
    aligned,
    blockers,
    reasonCodes: unique([
      "ENGINE3_ENGINE26_NEGOTIATED_ZONE_ONLY",
      "ENGINE3_1M_WATCH_ONLY",
      "ENGINE3_5M_MATURE_REACTION_EVIDENCE",
      "ENGINE3_10M_BROADER_PRICE_CONFIRMATION",
      confirmed ? `ENGINE3_INITIAL_${fiveDirection}_REACTION_CONFIRMED` : null,
      aligned ? "ENGINE3_5M_10M_REACTION_ALIGNED" : null,
      ...fiveMinuteReaction?.reasonCodes || [],
      ...tenMinuteConfirmation?.reasonCodes || [],
    ]),
  };
}

function resolvePersistence({
  initialReaction,
  previousCanonicalDirection,
  previousReactionConfirmed,
  previousCandidateId,
  previousZoneId,
  engine26ReactionHandoff,
  currentPrice,
  zone,
  tenMinuteCompletedClose,
  tenMinuteEma10,
  activePaperTradeDirection,
} = {}) {
  const previousDirection = safeUpper(previousCanonicalDirection, "NEUTRAL");
  const activeDirection = safeUpper(activePaperTradeDirection, "NEUTRAL");
  const inheritedDirection = ["LONG", "SHORT"].includes(activeDirection)
    ? activeDirection
    : ["LONG", "SHORT"].includes(previousDirection) && previousReactionConfirmed === true
    ? previousDirection
    : "NEUTRAL";

  const lifecycleSame = sameLifecycle({
    previousCandidateId,
    previousZoneId,
    handoff: engine26ReactionHandoff,
  });

  const position = zonePosition(currentPrice, zone);

  // A newly confirmed current-lifecycle reaction always wins over old neutral.
  if (initialReaction?.confirmed === true) {
    return {
      direction: initialReaction.direction,
      state: initialReaction.state,
      quality: initialReaction.quality,
      reactionConfirmed: true,
      directionPersistenceActive: !position.inside,
      ema10ResetTriggered: false,
      lifecycleResetTriggered: false,
      resolutionStatus: `CANONICAL_${initialReaction.direction}_NEGOTIATED_ZONE_REACTION_CONFIRMED`,
      resolutionReason: "ENGINE3_DIRECTION_ESTABLISHED_BY_5M_REACTION_AND_10M_CONFIRMATION_AT_ENGINE26_NEGOTIATED_ZONE",
    };
  }

  // Fresh Engine 26 lifecycle after midpoint completion: do not carry old trip.
  if (!lifecycleSame && inheritedDirection !== "NEUTRAL") {
    return {
      direction: "NEUTRAL",
      state: "WAITING_FOR_NEGOTIATED_ZONE_REACTION",
      quality: "WEAK",
      reactionConfirmed: false,
      directionPersistenceActive: false,
      ema10ResetTriggered: false,
      lifecycleResetTriggered: true,
      resolutionStatus: "CANONICAL_NEUTRAL_NEW_ENGINE26_LIFECYCLE",
      resolutionReason: "ENGINE26_CANDIDATE_OR_ZONE_CHANGED_PRIOR_ENGINE3_DIRECTION_RELEASED",
    };
  }

  // Once Engine 3 has completed the price-reaction answer for this lifecycle,
  // 1m/5m/10m reaction diagnostics cannot flip it. 10m EMA10 is only the
  // post-zone HOLD / RESET authority.
  if (inheritedDirection !== "NEUTRAL") {
    const close10 = validPrice(tenMinuteCompletedClose);
    const ema10 = validPrice(tenMinuteEma10);

    if (!position.inside && close10 != null && ema10 != null) {
      const adverseCross =
        inheritedDirection === "SHORT"
          ? close10 > ema10
          : close10 < ema10;

      if (adverseCross) {
        return {
          direction: "NEUTRAL",
          state: "DIRECTION_RESET_BY_10M_EMA10",
          quality: "WEAK",
          reactionConfirmed: false,
          directionPersistenceActive: false,
          ema10ResetTriggered: true,
          lifecycleResetTriggered: false,
          resolutionStatus: "CANONICAL_NEUTRAL_10M_EMA10_RESET",
          resolutionReason:
            inheritedDirection === "SHORT"
              ? "COMPLETED_10M_CLOSED_ABOVE_EMA10_SHORT_RESET"
              : "COMPLETED_10M_CLOSED_BELOW_EMA10_LONG_RESET",
        };
      }
    }

    return {
      direction: inheritedDirection,
      state: "REACTION_CONFIRMED",
      quality: "GOOD",
      reactionConfirmed: true,
      directionPersistenceActive: !position.inside,
      ema10ResetTriggered: false,
      lifecycleResetTriggered: false,
      resolutionStatus: `CANONICAL_${inheritedDirection}_LIFECYCLE_DIRECTION_LOCKED`,
      resolutionReason: position.inside
        ? "ENGINE3_CONFIRMED_DIRECTION_LOCKED_FOR_CURRENT_ENGINE26_LIFECYCLE"
        : "POST_ZONE_ENGINE3_DIRECTION_HELD_UNTIL_TARGET_MIDPOINT_OR_ADVERSE_10M_EMA10_CLOSE",
    };
  }

  return {
    direction: "NEUTRAL",
    state: initialReaction?.state || "WAITING_FOR_NEGOTIATED_ZONE_REACTION",
    quality: "WEAK",
    reactionConfirmed: false,
    directionPersistenceActive: false,
    ema10ResetTriggered: false,
    lifecycleResetTriggered: false,
    resolutionStatus: "CANONICAL_NEUTRAL_WAITING_FOR_REACTION",
    resolutionReason: "WAITING_FOR_ALIGNED_5M_REACTION_AND_10M_CONFIRMATION_AT_ENGINE26_NEGOTIATED_ZONE",
  };
}

function qualificationFromCanonical({ canonical, engine26LocationContext } = {}) {
  const directional = ["LONG", "SHORT"].includes(
    safeUpper(canonical?.direction, "NEUTRAL")
  );

  const authorized =
    engine26LocationContext?.authorized === true &&
    engine26LocationContext?.authorizeEngine3Evaluation === true;

  const identityMatched =
    engine26LocationContext?.identityComparison?.matched !== false;

  const verified =
    engine26LocationContext?.confirmed === true &&
    engine26LocationContext?.state === "REACTION_CONFIRMED";

  const qualified =
    directional &&
    canonical?.reactionConfirmed === true &&
    authorized &&
    identityMatched &&
    verified;

  return {
    qualified,
    blockers: unique([
      !directional ? "ENGINE3_CANONICAL_DIRECTION_NEUTRAL" : null,
      canonical?.reactionConfirmed !== true ? "ENGINE3_REACTION_NOT_CONFIRMED" : null,
      !authorized ? "ENGINE26_ENGINE3_EVALUATION_NOT_AUTHORIZED" : null,
      !identityMatched ? "ENGINE3_ENGINE26_IDENTITY_MISMATCH" : null,
      !verified ? "ENGINE26_REACTION_NOT_VERIFIED" : null,
    ]),
    reasonCodes: unique([
      qualified ? "ENGINE3_STRATEGY1_QUALIFIED" : "ENGINE3_STRATEGY1_NOT_QUALIFIED",
    ]),
  };
}

/*
 * Compatibility builder retained for old tests/routes.
 * It is diagnostic-only and cannot create Strategy 1 canonical authority.
 */
export function buildPaperScalpReaction({
  currentLevelAction = null,
  fastImbalanceReaction = null,
  engine22WaveStrategy = null,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
} = {}) {
  const diagnostic =
    fastImbalanceReaction ||
    currentLevelAction ||
    {};

  const engine26LocationContext = buildEngine26LocationReactionContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    reactionInput: {
      state: diagnostic?.state || "NO_SIGNAL",
      quality: diagnostic?.quality || "WEAK",
      direction: diagnostic?.direction || "NEUTRAL",
      confirmed: false,
      currentPrice: diagnostic?.currentPrice ?? null,
      lastCandle: diagnostic?.lastCandle ?? null,
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
    state: diagnostic?.state || "NO_SIGNAL",
    direction: diagnostic?.direction || "NEUTRAL",
    quality: diagnostic?.quality || "WEAK",
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
    blockers: ["LEGACY_DIAGNOSTIC_BUILDER_ONLY"],
    reasonCodes: [
      "ENGINE3_LEGACY_DIAGNOSTIC_BUILDER_ONLY",
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
  tenMinuteCompletedClose = null,
  tenMinuteEma10 = null,
  tenMinuteBars = [],
  activePaperTradeDirection = null,
}) {
  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.reaction = patchedConfluence.context.reaction || {};

  const observation1m =
    patchedConfluence.context.reaction.engine3ReactionObservation1m || null;

  const validation5m =
    patchedConfluence.context.reaction.engine3ReactionValidation5m || null;

  const zone = normalizeZone(engine26ReactionHandoff);

  const currentPrice =
    validPrice(observation1m?.currentPrice) ??
    validPrice(observation1m?.currentCandle?.close) ??
    validPrice(engine26ReactionHandoff?.currentPrice) ??
    validPrice(engine26ReactionHandoff?.zone?.currentPrice) ??
    null;

  const position = zonePosition(currentPrice, zone);

  // 1m is retained exactly as a WATCH / DISPLAY sensor.
  const oneMinuteWatch = {
    active: observation1m?.active === true,
    watchOnly: true,
    direction: safeUpper(observation1m?.direction, "NEUTRAL"),
    quality: safeUpper(observation1m?.quality, "WEAK"),
    state: safeUpper(observation1m?.state, "NO_SIGNAL"),
    candleState: observation1m?.candleState ?? null,
    stale: observation1m?.stale ?? null,
    staleReason: observation1m?.staleReason ?? null,
    evidenceAuthority: false,
    canonicalDirectionAuthority: false,
  };

  const fiveMinuteReaction = buildFiveMinuteReaction({
    validation5m,
    zone,
    handoff: engine26ReactionHandoff,
  });

  const tenMinuteConfirmation = buildTenMinuteConfirmation({
    tenMinuteBars,
    zone,
    evaluationTimeMs:
      validation5m?.evaluationTimeMs ??
      observation1m?.evaluationTimeMs ??
      observation1m?.observedAt ??
      null,
  });

  const initialReaction = buildInitialReaction({
    engine26ReactionHandoff,
    fiveMinuteReaction,
    tenMinuteConfirmation,
  });

  const canonical = resolvePersistence({
    initialReaction,
    previousCanonicalDirection,
    previousReactionConfirmed,
    previousCandidateId,
    previousZoneId,
    engine26ReactionHandoff,
    currentPrice,
    zone,
    tenMinuteCompletedClose,
    tenMinuteEma10,
    activePaperTradeDirection,
  });

  const reactionInput = {
    state: canonical.state,
    quality: canonical.quality,
    direction: canonical.direction,
    confirmed: canonical.reactionConfirmed === true,
    currentPrice,
    lastCandle: validation5m?.currentCandle || observation1m?.currentCandle || null,

    symbol: engine26ReactionHandoff?.symbol ?? null,
    laneId: engine26ReactionHandoff?.laneId ?? null,
    strategyId: engine26ReactionHandoff?.strategyId ?? null,
    candidateId: engine26ReactionHandoff?.candidateId ?? null,
    zoneId: engine26ReactionHandoff?.zoneId ?? null,
    setupClass: engine26ReactionHandoff?.setupClass ?? null,
    setupGrade: engine26ReactionHandoff?.setupGrade ?? null,
    identitySetupKey: engine26ReactionHandoff?.identitySetupKey ?? null,
    candidateIdentityVersion: engine26ReactionHandoff?.candidateIdentityVersion ?? null,

    noPermissionCreated: true,
    noExecution: true,
  };

  const engine26LocationContext = buildEngine26LocationReactionContext({
    engine26ReactionHandoff,
    engine26StructuralContext,
    reactionInput,
  });

  const qualification = qualificationFromCanonical({
    canonical,
    engine26LocationContext,
  });

  const qualified = qualification.qualified === true;

  const bookReactionState =
    canonical.reactionConfirmed === true
      ? fiveMinuteReaction?.state || canonical.state
      : fiveMinuteReaction?.state || "WATCHING_NEGOTIATED_ZONE";

  const referenceLevel = zone?.mid ?? null;

  const paperScalpReaction = {
    active: true,
    engine: ENGINE,
    source: SOURCE,
    mode: "PAPER_ONLY",
    researchOnly: true,
    fastMode: false,

    // ONE canonical Engine 3 answer.
    state: canonical.state,
    direction: canonical.direction,
    quality: canonical.quality,
    reactionState: canonical.reactionConfirmed === true
      ? "REACTION_CONFIRMED"
      : bookReactionState,
    bookReactionState,
    bookReactionEvidence5m: fiveMinuteReaction?.evidence || [],
    bookReactionEvidence10m: tenMinuteConfirmation?.evidence || [],

    setupType:
      canonical.direction === "LONG"
        ? "NEGOTIATED_ZONE_LONG_REACTION"
        : canonical.direction === "SHORT"
        ? "NEGOTIATED_ZONE_SHORT_REACTION"
        : "NEGOTIATED_ZONE_REACTION_WATCH",

    reactionTimeframe: "5m",
    sourceTimeframe: "5m",
    directionEstablishmentTimeframe: "5m_REACTION_PLUS_10m_CONFIRMATION",
    validationTimeframe: "10m_NEGOTIATED_ZONE_CONFIRMATION",
    directionResetTimeframe: "10m_EMA10_POST_ZONE_HOLD_RESET",

    canonicalResolutionStatus: canonical.resolutionStatus,
    canonicalResolutionReason: canonical.resolutionReason,
    canonicalObservationUsable:
      fiveMinuteReaction?.confirmedCandleData === true &&
      fiveMinuteReaction?.sourceFresh === true,
    canonicalIdentityAligned: fiveMinuteReaction?.identityAligned !== false,

    currentPrice,
    insideNegotiatedZone: position.inside === true,
    negotiatedZonePosition: position.position,
    negotiatedZonePositionKnown: position.known === true,
    negotiatedZoneLo: zone?.lo ?? null,
    negotiatedZoneHi: zone?.hi ?? null,
    negotiatedZoneMid: zone?.mid ?? null,

    // Engine 26 is the ONLY canonical Strategy 1 reaction reference.
    referenceLevel,
    referenceType: "ENGINE26_NEGOTIATED_ZONE",
    referenceLabel: "Engine 26 negotiated zone",
    referenceSource: "ENGINE26",
    distancePts:
      currentPrice != null && referenceLevel != null
        ? Number(Math.abs(currentPrice - referenceLevel).toFixed(2))
        : null,

    // 1m remains visible but has zero canonical authority.
    oneMinuteImmediateDirection: oneMinuteWatch.direction,
    oneMinuteWatch,
    oneMinuteCanonicalAuthority: false,

    // 5m is mature reaction evidence.
    fiveMinuteValidationDirection: fiveMinuteReaction?.direction || "NEUTRAL",
    fiveMinuteReactionState: fiveMinuteReaction?.state || "NO_SIGNAL",
    fiveMinuteReactionEvidence: fiveMinuteReaction?.evidence || [],
    fiveMinuteFollowThrough: fiveMinuteReaction?.followThrough === true,

    // 10m is broader price confirmation at the SAME Engine 26 zone.
    broaderTenMinuteDirection: tenMinuteConfirmation?.direction || "NEUTRAL",
    tenMinuteConfirmationState: tenMinuteConfirmation?.state || "NO_SIGNAL",
    tenMinuteConfirmationEvidence: tenMinuteConfirmation?.evidence || [],
    tenMinuteConfirmationAligned:
      initialReaction?.aligned === true,

    reactionCandidateDirection: initialReaction?.direction || "NEUTRAL",
    reactionCandidateState: initialReaction?.state || "NO_SIGNAL",
    reactionCandidateQuality: initialReaction?.quality || "WEAK",
    reactionCandidateConfirmed: initialReaction?.confirmed === true,

    previousCanonicalDirection: safeUpper(previousCanonicalDirection, "NEUTRAL"),
    previousReactionConfirmed: previousReactionConfirmed === true,
    previousCandidateId,
    previousZoneId,

    activePaperTrade: ["LONG", "SHORT"].includes(
      safeUpper(activePaperTradeDirection, "NEUTRAL")
    ),
    activePaperTradeDirection: safeUpper(activePaperTradeDirection, "NEUTRAL"),
    directionPersistenceActive: canonical.directionPersistenceActive === true,
    lifecycleResetTriggered: canonical.lifecycleResetTriggered === true,

    tenMinuteCompletedClose: validPrice(tenMinuteCompletedClose),
    tenMinuteEma10: validPrice(tenMinuteEma10),
    ema10ResetDataAvailable:
      validPrice(tenMinuteCompletedClose) != null &&
      validPrice(tenMinuteEma10) != null,
    ema10ResetTriggered: canonical.ema10ResetTriggered === true,

    // Engine 26 authorization / identity transport.
    authorized: engine26LocationContext?.authorized === true,
    evaluationAuthorized:
      engine26LocationContext?.authorizeEngine3Evaluation === true,
    authorizeEngine3Evaluation:
      engine26LocationContext?.authorizeEngine3Evaluation === true,
    authorizedReactionState:
      canonical.reactionConfirmed === true ? "REACTION_CONFIRMED" : engine26LocationContext?.state ?? null,
    authorizedReactionRawState: bookReactionState,
    reactionConfirmed: canonical.reactionConfirmed === true,
    engine26ReactionVerified:
      engine26LocationContext?.confirmed === true &&
      engine26LocationContext?.state === "REACTION_CONFIRMED",

    candidateId:
      engine26LocationContext?.candidateId ?? engine26ReactionHandoff?.candidateId ?? null,
    zoneId:
      engine26LocationContext?.zoneId ?? engine26ReactionHandoff?.zoneId ?? null,
    laneId:
      engine26LocationContext?.laneId ?? engine26ReactionHandoff?.laneId ?? null,
    strategyId:
      engine26LocationContext?.strategyId ?? engine26ReactionHandoff?.strategyId ?? null,
    symbol:
      engine26LocationContext?.symbol ?? engine26ReactionHandoff?.symbol ?? null,
    setupClass:
      engine26LocationContext?.setupClass ?? engine26ReactionHandoff?.setupClass ?? null,
    setupGrade:
      engine26LocationContext?.setupGrade ?? engine26ReactionHandoff?.setupGrade ?? null,
    identitySetupKey:
      engine26LocationContext?.identitySetupKey ?? engine26ReactionHandoff?.identitySetupKey ?? null,
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
    expectedReactionDirection: engine26LocationContext?.expectedReactionDirection ?? null,
    expectedReactions: Array.isArray(engine26LocationContext?.expectedReactions)
      ? engine26LocationContext.expectedReactions
      : [],
    reactionExpected: engine26LocationContext?.reactionExpected ?? null,
    timeframe: engine26LocationContext?.timeframe ?? null,
    snapshotTime: engine26LocationContext?.snapshotTime ?? null,

    // Final Engine 3 handoff to Engine 4 / Engine 6.
    allowed: qualified,
    engine3Strategy1QualifiedForEngine6: qualified,
    participationEvaluationEligible: qualified,
    qualificationExplicitlyPublished: true,
    targetModel: TARGET_MODEL,

    // Preserve three-timeframe objects for timeline / diagnostics.
    reactionObservation1m: observation1m,
    reactionValidation5m: validation5m,
    broaderReaction10m: tenMinuteConfirmation,

    // Legacy sources remain schema-stable but have ZERO Strategy 1 authority.
    currentLevelAction: null,
    fastImbalanceReaction: null,
    legacyReferenceAuthorityRemoved: true,

    engine26LocationContext: engine26LocationContext || null,

    confirmationDiagnostics: {
      engine26Authorized:
        engine26ReactionHandoff?.authorizeEngine3Evaluation === true,
      sameEngine26Lifecycle: sameLifecycle({
        previousCandidateId,
        previousZoneId,
        handoff: engine26ReactionHandoff,
      }),
      oneMinuteWatchOnly: true,
      fiveMinuteReactionDirection: fiveMinuteReaction?.direction || "NEUTRAL",
      fiveMinuteReactionState: fiveMinuteReaction?.state || "NO_SIGNAL",
      fiveMinuteReactionEvidence: fiveMinuteReaction?.evidence || [],
      fiveMinuteSourceFresh: fiveMinuteReaction?.sourceFresh === true,
      fiveMinuteIdentityAligned: fiveMinuteReaction?.identityAligned !== false,
      tenMinuteConfirmationDirection: tenMinuteConfirmation?.direction || "NEUTRAL",
      tenMinuteConfirmationState: tenMinuteConfirmation?.state || "NO_SIGNAL",
      tenMinuteConfirmationEvidence: tenMinuteConfirmation?.evidence || [],
      fiveAndTenMinuteAligned: initialReaction?.aligned === true,
      initialReactionConfirmed: initialReaction?.confirmed === true,
      directionLockedForLifecycle: canonical.reactionConfirmed === true,
      directionPersistenceActive: canonical.directionPersistenceActive === true,
      ema10ResetTriggered: canonical.ema10ResetTriggered === true,
      lifecycleResetTriggered: canonical.lifecycleResetTriggered === true,
    },

    validationState:
      initialReaction?.confirmed === true
        ? "CONFIRMED"
        : fiveMinuteReaction?.direction !== "NEUTRAL" &&
          tenMinuteConfirmation?.direction !== "NEUTRAL" &&
          fiveMinuteReaction?.direction !== tenMinuteConfirmation?.direction
        ? "CONFLICT"
        : "UNRESOLVED",

    validationSupports1m: false,
    validationConflictsWith1m: false,
    validationResolved5m: fiveMinuteReaction?.direction !== "NEUTRAL",

    broaderContextDirection: tenMinuteConfirmation?.direction || null,
    broaderContextState: tenMinuteConfirmation?.state || null,

    // Candle contract retained for downstream compatibility.
    supportingBarTime:
      validation5m?.supportingBarTime ?? observation1m?.supportingBarTime ?? null,
    evaluationTimeMs:
      validation5m?.evaluationTimeMs ?? observation1m?.evaluationTimeMs ?? null,
    currentCandleStatus:
      validation5m?.currentCandleStatus ?? observation1m?.currentCandleStatus ?? null,
    priorCandleStatus:
      validation5m?.priorCandleStatus ?? observation1m?.priorCandleStatus ?? null,
    currentCandle:
      validation5m?.currentCandle ?? observation1m?.currentCandle ?? null,
    priorCandle:
      validation5m?.priorCandle ?? observation1m?.priorCandle ?? null,
    lastCandle:
      validation5m?.currentCandle ?? observation1m?.currentCandle ?? null,
    candleClosed:
      (validation5m?.currentCandleStatus ?? observation1m?.currentCandleStatus) === "COMPLETED"
        ? true
        : (validation5m?.currentCandleStatus ?? observation1m?.currentCandleStatus) === "FORMING"
        ? false
        : null,
    priorCandleCompleted:
      (validation5m?.priorCandleStatus ?? observation1m?.priorCandleStatus) === "COMPLETED"
        ? true
        : (validation5m?.priorCandleStatus ?? observation1m?.priorCandleStatus) === "FORMING"
        ? false
        : null,
    candleSourceFresh:
      validation5m?.stale === false,

    // Engine 22 remains diagnostic only.
    lifecycleKey:
      engine22WaveStrategy?.currentLifecycleState?.key || null,
    engine22Direction: getEngine22Direction(engine22WaveStrategy),
    waveContext: buildEngine22DegreeWaveContext({
      engine22WaveStrategy,
      reactionState: canonical.state,
      reactionDirection: canonical.direction,
    }),

    requiresEngine6PaperApproval: true,
    realExecutionAuthority: false,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,

    blockers: unique([
      ...(initialReaction?.blockers || []),
      ...(qualification?.blockers || []),
    ]),

    reasonCodes: unique([
      "PAPER_ONLY_RESEARCH_LANE",
      "ENGINE3_STRATEGY1_CANONICAL_REACTION_V5",
      "ENGINE26_NEGOTIATED_ZONE_IS_ONLY_CANONICAL_REFERENCE",
      "ENGINE3_1M_WATCH_DISPLAY_ONLY",
      "ENGINE3_5M_MATURE_REACTION_EVIDENCE",
      "ENGINE3_10M_NEGOTIATED_ZONE_CONFIRMATION",
      "ENGINE3_BOOK_BASED_REACTION_LANGUAGE_RESTORED",
      "LEGACY_NEAREST_REFERENCE_AUTHORITY_REMOVED",
      "LEGACY_FAST_IMBALANCE_AUTHORITY_REMOVED",
      "ENGINE4_OWNS_PARTICIPATION",
      "ENGINE6_FINAL_PAPER_PERMISSION_REQUIRED",
      canonical.resolutionStatus,
      canonical.resolutionReason,
      canonical.directionPersistenceActive
        ? "ENGINE3_DIRECTION_PERSISTENCE_ACTIVE"
        : null,
      canonical.ema10ResetTriggered
        ? "ENGINE3_DIRECTION_RESET_BY_10M_EMA10"
        : null,
      canonical.lifecycleResetTriggered
        ? "ENGINE3_DIRECTION_RESET_BY_NEW_ENGINE26_LIFECYCLE"
        : null,
      ...(initialReaction?.reasonCodes || []),
      ...(engine26LocationContext?.reasonCodes || []),
      ...(qualification?.reasonCodes || []),
      qualified
        ? "ENGINE3_PAPER_SCALP_REACTION_ALLOWED"
        : "ENGINE3_PAPER_SCALP_REACTION_NOT_ALLOWED",
      qualified
        ? "ENGINE4_PARTICIPATION_EVALUATION_ELIGIBLE"
        : "ENGINE4_PARTICIPATION_EVALUATION_NOT_ELIGIBLE",
      "NO_REAL_PERMISSION_CREATED",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ]),
  };

  patchedConfluence.context.reaction = {
    ...patchedConfluence.context.reaction,
    paperScalpReaction,
  };

  return patchedConfluence;
}

export default buildPaperScalpReaction;
