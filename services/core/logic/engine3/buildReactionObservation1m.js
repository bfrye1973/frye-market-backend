import { deriveCandleCompletionTruth } from "./candleCompletionTruth.js";
import { buildCurrentLevelAction } from "../priceAction/currentLevelAction.js";

const STALE_AFTER_MS = 2 * 60 * 1000;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function identityFrom(candidate = {}, handoff = {}) {
  return {
    symbol: handoff?.symbol || candidate?.symbol || "ES",
    laneId: handoff?.laneId || candidate?.laneId || "minute",
    strategyId:
      handoff?.strategyId || candidate?.strategyId || "intraday_scalp@10m",
    candidateId: handoff?.candidateId ?? candidate?.candidateId ?? null,
    zoneId: handoff?.zoneId ?? candidate?.zoneId ?? null,
    setupClass: handoff?.setupClass ?? candidate?.setupClass ?? null,
    setupGrade: handoff?.setupGrade ?? candidate?.setupGrade ?? null,
    identitySetupKey:
      handoff?.identitySetupKey ?? candidate?.identitySetupKey ?? null,
    candidateIdentityVersion:
      handoff?.candidateIdentityVersion ??
      candidate?.candidateIdentityVersion ??
      null,
    contactState: handoff?.contactState ?? candidate?.contactState ?? null,
    chainArmed: handoff?.chainArmed === true || candidate?.chainArmed === true,
    authorizeEngine3Evaluation:
      handoff?.authorizeEngine3Evaluation === true ||
      candidate?.authorizeEngine3Evaluation === true,
  };
}

function negotiatedZone(candidate = {}, handoff = {}) {
  const sources = [
    handoff?.negotiatedZone,
    handoff?.zone,
    candidate?.negotiatedZone,
    candidate?.zone,
    candidate?.locationZone,
    candidate,
  ];

  for (const source of sources) {
    const lo = number(source?.lo ?? source?.low ?? source?.zoneLo);
    const hi = number(source?.hi ?? source?.high ?? source?.zoneHi);

    if (lo != null && hi != null) {
      return {
        lo: Math.min(lo, hi),
        hi: Math.max(lo, hi),
      };
    }
  }

  return null;
}

/*
 * Strategy 1 immediate direction is candle-owned.
 *
 * Engine 26 still owns zone/location context, but zone position must not
 * suppress clear intraday candle direction.
 *
 * Use completed candles only for actionable direction.
 */
function directionalPair(previousBar, currentBar) {
  const currentClose = number(currentBar?.close ?? currentBar?.c);
  const previousClose = number(previousBar?.close ?? previousBar?.c);
  const currentLow = number(currentBar?.low ?? currentBar?.l);
  const previousLow = number(previousBar?.low ?? previousBar?.l);
  const currentHigh = number(currentBar?.high ?? currentBar?.h);
  const previousHigh = number(previousBar?.high ?? previousBar?.h);

  if (
    currentClose != null &&
    previousClose != null &&
    currentLow != null &&
    previousLow != null &&
    currentClose < previousClose &&
    currentLow <= previousLow
  ) {
    return "SHORT";
  }

  if (
    currentClose != null &&
    previousClose != null &&
    currentHigh != null &&
    previousHigh != null &&
    currentClose > previousClose &&
    currentHigh >= previousHigh
  ) {
    return "LONG";
  }

  return "NEUTRAL";
}

/*
 * Strategy 1 direction and quality share one completed-1m candle model.
 *
 * GOOD   = newest completed pair qualifies directionally.
 * STRONG = newest two consecutive pairs across the latest three completed
 *          bars qualify in the same direction.
 * WEAK   = newest completed pair does not qualify.
 *
 * Legacy currentLevelAction state/quality remain diagnostic only.
 */
function candleReactionFromBars(bars = []) {
  const recent = Array.isArray(bars)
    ? bars.filter(Boolean).slice(-3)
    : [];

  if (recent.length < 2) {
    return { direction: "NEUTRAL", quality: "WEAK" };
  }

  const latestDirection = directionalPair(
    recent[recent.length - 2],
    recent[recent.length - 1]
  );

  if (latestDirection === "NEUTRAL") {
    return { direction: "NEUTRAL", quality: "WEAK" };
  }

  if (recent.length >= 3) {
    const previousDirection = directionalPair(
      recent[recent.length - 3],
      recent[recent.length - 2]
    );

    if (previousDirection === latestDirection) {
      return { direction: latestDirection, quality: "STRONG" };
    }
  }

  return { direction: latestDirection, quality: "GOOD" };
}

export function buildReactionObservation1m({
  bars = [],
  evaluationTimeMs,
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  const identity = identityFrom(
    engine26LocationCandidate,
    engine26ReactionHandoff
  );

  const zone = negotiatedZone(
    engine26LocationCandidate,
    engine26ReactionHandoff
  );

  const truth = deriveCandleCompletionTruth({
    bars,
    timeframe: "1m",
    evaluationTimeMs,
  });

  const action = buildCurrentLevelAction({
    symbol: identity.symbol,
    tf: "1m",
    bars10m: truth.allBars,
    currentPrice: truth.allBars.at(-1)?.close ?? null,
    zones: zone ? { zone } : null,
    confirmationContext: zone
      ? {
          reference: {
            zone,
          },
        }
      : null,
    evaluationTimeMs,
  });

  const candleReaction = candleReactionFromBars(
    truth.completedBars
  );

  const barStart = truth.latestBarStartTimeMs;
  const barEnd = truth.latestExpectedCloseTimeMs;

  const ageMs =
    barEnd != null && truth.evaluationTimeMs != null
      ? Math.max(0, truth.evaluationTimeMs - barEnd)
      : null;

  const stale =
    ageMs == null ||
    ageMs > STALE_AFTER_MS;

  const staleReason =
    ageMs == null
      ? "NO_SOURCE_BAR_TIME"
      : stale
      ? "SOURCE_BAR_TOO_OLD"
      : null;

  return {
    active:
      action.active === true &&
      zone != null,

    diagnosticOnly: true,
    noPermissionCreated: true,
    noExecution: true,

    sourceTimeframe: "1m",

    // Strategy 1 direction is derived from completed candle behavior,
    // not from where price sits inside the larger imbalance zone.
    direction: candleReaction.direction,
    quality: candleReaction.quality,

    // Preserve legacy level-action outputs as diagnostics only.
    state: action.state || "NO_SIGNAL",
    levelActionQuality: action.quality || "WEAK",

    candleState:
      truth.latestBarCompletionState,

    observedAt:
      truth.evaluationTimeMs,

    barStart,
    barEnd,

    sourceAgeMs:
      ageMs,

    stale,
    staleReason,

    currentPrice:
      action.currentPrice ?? null,

    referenceLevel:
      action.referenceLevel ?? null,

    referenceType:
      action.referenceType ?? null,

    distancePts:
      action.distancePts ?? null,

    levelAction:
      action.levelAction || null,

    ...identity,

    reasonCodes: [
      "ENGINE3_1M_DIAGNOSTIC_OBSERVATION",
      "ENGINE3_STRATEGY1_CANDLE_DIRECTION_INDEPENDENT_OF_ZONE",
      ...(zone
        ? []
        : ["NEGOTIATED_ZONE_MISSING"]),
      ...(action.reasonCodes || []),
    ],
  };
}

export default buildReactionObservation1m;
