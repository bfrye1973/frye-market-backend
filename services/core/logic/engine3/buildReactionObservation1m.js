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
 * CURRENT 1m PRICE ACTION
 *
 * Diagnostic only.
 * - Does not use EMA10.
 * - Does not create/hold/reset canonical Engine 3 travel direction.
 * - Does not derive direction from negotiated-zone position.
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
    currentHigh != null &&
    previousHigh != null &&
    currentClose > previousClose &&
    currentHigh >= previousHigh
  ) {
    return "LONG";
  }

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

  return "NEUTRAL";
}

function candleReactionFromBars(bars = []) {
  const recent = Array.isArray(bars)
    ? bars.filter(Boolean).slice(-3)
    : [];

  if (recent.length < 2) {
    return {
      state: "NO_CLEAR_DIRECTION",
      direction: "NEUTRAL",
      quality: "WEAK",
    };
  }

  const latestDirection = directionalPair(
    recent[recent.length - 2],
    recent[recent.length - 1]
  );

  if (latestDirection === "NEUTRAL") {
    return {
      state: "NO_CLEAR_DIRECTION",
      direction: "NEUTRAL",
      quality: "WEAK",
    };
  }

  let quality = "GOOD";

  if (recent.length >= 3) {
    const previousDirection = directionalPair(
      recent[recent.length - 3],
      recent[recent.length - 2]
    );

    if (previousDirection === latestDirection) {
      quality = "STRONG";
    }
  }

  return {
    state:
      latestDirection === "LONG"
        ? "PUSHING_HIGHER"
        : "PUSHING_LOWER",
    direction: latestDirection,
    quality,
  };
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

  /*
   * Keep the old level/zone action for diagnostic detail only.
   * It is not the 1m current-price-action direction.
   */
  const levelAction = buildCurrentLevelAction({
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

  /*
   * 1m display is intentionally immediate.
   * Use all available 1m bars, including the current forming candle.
   */
  const currentPriceAction = candleReactionFromBars(
    truth.allBars
  );

  /*
   * Completed-only 1m read remains visible separately for stable diagnostics.
   */
  const completedPriceAction = candleReactionFromBars(
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
      Array.isArray(truth.allBars) &&
      truth.allBars.length >= 2,

    diagnosticOnly: true,
    currentPriceActionOnly: true,
    noPermissionCreated: true,
    noExecution: true,

    sourceTimeframe: "1m",

    /*
     * Primary 1m row: what price is doing NOW.
     */
    state: currentPriceAction.state,
    direction: currentPriceAction.direction,
    quality: currentPriceAction.quality,

    currentPriceActionState:
      currentPriceAction.state,
    currentPriceActionDirection:
      currentPriceAction.direction,
    currentPriceActionQuality:
      currentPriceAction.quality,

    completedPriceActionState:
      completedPriceAction.state,
    completedPriceActionDirection:
      completedPriceAction.direction,
    completedPriceActionQuality:
      completedPriceAction.quality,

    /*
     * Negotiated-zone/reference diagnostics remain separate.
     */
    levelActionState:
      levelAction?.state || "NO_SIGNAL",

    levelActionDirection:
      levelAction?.direction || "NEUTRAL",

    levelActionQuality:
      levelAction?.quality || "WEAK",

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
      truth.allBars.at(-1)?.close ??
      levelAction?.currentPrice ??
      null,

    referenceLevel:
      levelAction?.referenceLevel ?? null,

    referenceType:
      levelAction?.referenceType ?? null,

    referenceLabel:
      levelAction?.referenceLabel ?? null,

    distancePts:
      levelAction?.distancePts ?? null,

    levelAction:
      levelAction?.levelAction || null,

    currentCandle:
      truth.allBars.at(-1) || null,

    priorCandle:
      truth.allBars.at(-2) || null,

    currentCandleStatus:
      truth.latestBarCompletionState || "NO_BARS",

    completedBarCount:
      Array.isArray(truth.completedBars)
        ? truth.completedBars.length
        : 0,

    ...identity,

    canonicalDirectionAuthority: false,
    canonicalQualificationAuthority: false,
    ema10Authority: false,

    reasonCodes: [
      "ENGINE3_1M_CURRENT_PRICE_ACTION_DIAGNOSTIC",
      "ENGINE3_1M_CURRENT_PRICE_ACTION_INDEPENDENT_OF_ZONE",
      "ENGINE3_1M_CURRENT_PRICE_ACTION_INDEPENDENT_OF_EMA10",
      ...(zone
        ? ["ENGINE26_NEGOTIATED_ZONE_CONTEXT_AVAILABLE_DIAGNOSTIC_ONLY"]
        : ["NEGOTIATED_ZONE_MISSING"]),
      ...(levelAction?.reasonCodes || []),
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildReactionObservation1m;
