import { deriveCandleCompletionTruth } from "./candleCompletionTruth.js";
import { buildExactZoneAction } from "../priceAction/currentLevelAction.js";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function zoneFrom(candidate = {}, handoff = {}) {
  for (const source of [
    handoff?.negotiatedZone,
    handoff?.zone,
    candidate?.negotiatedZone,
    candidate?.zone,
    candidate?.locationZone,
    candidate,
  ]) {
    const lo = number(
      source?.lo ??
      source?.low ??
      source?.zoneLo
    );

    const hi = number(
      source?.hi ??
      source?.high ??
      source?.zoneHi
    );

    if (lo != null && hi != null) {
      const mid =
        number(
          source?.mid ??
          source?.midline ??
          source?.zoneMid
        ) ??
        (Math.min(lo, hi) + Math.max(lo, hi)) / 2;

      return {
        lo: Math.min(lo, hi),
        hi: Math.max(lo, hi),
        mid,
      };
    }
  }

  return null;
}

/*
 * CURRENT 10m PRICE ACTION
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

export function buildReactionConfirmation10m({
  bars = [],
  evaluationTimeMs,
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  const truth = deriveCandleCompletionTruth({
    bars,
    timeframe: "10m",
    evaluationTimeMs,
  });

  const zone = zoneFrom(
    engine26LocationCandidate,
    engine26ReactionHandoff
  );

  const symbol =
    engine26ReactionHandoff?.symbol ||
    engine26LocationCandidate?.symbol ||
    "ES";

  /*
   * Keep exact-zone diagnostics for separate inspection.
   * These are NOT the current 10m price-action read.
   */
  const liveZoneAction = buildExactZoneAction({
    symbol,
    tf: "10m",
    bars: truth.allBars,
    currentPrice:
      truth.allBars.at(-1)?.close ??
      null,
    zone,
    evaluationTimeMs,
  });

  const completedZoneAction = buildExactZoneAction({
    symbol,
    tf: "10m",
    bars: truth.completedBars,
    currentPrice:
      truth.completedBars.at(-1)?.close ??
      null,
    zone,
    evaluationTimeMs,
  });

  /*
   * 10m timeline row is current price action.
   * Use all 10m bars, including the current forming candle.
   */
  const currentPriceAction = candleReactionFromBars(
    truth.allBars
  );

  /*
   * Completed-only 10m read remains separately available.
   */
  const completedPriceAction = candleReactionFromBars(
    truth.completedBars
  );

  return {
    active:
      Array.isArray(truth.allBars) &&
      truth.allBars.length >= 2,

    diagnosticOnly: true,
    currentPriceActionOnly: true,
    noPermissionCreated: true,
    noExecution: true,

    sourceTimeframe: "10m",
    role: "BROADER_PRICE_ACTION_DIAGNOSTIC",

    symbol,

    laneId:
      engine26ReactionHandoff?.laneId ||
      engine26LocationCandidate?.laneId ||
      "minute",

    strategyId:
      engine26ReactionHandoff?.strategyId ||
      engine26LocationCandidate?.strategyId ||
      "intraday_scalp@10m",

    candidateId:
      engine26ReactionHandoff?.candidateId ??
      engine26LocationCandidate?.candidateId ??
      null,

    zoneId:
      engine26ReactionHandoff?.zoneId ??
      engine26LocationCandidate?.zoneId ??
      null,

    candidateIdentityVersion:
      engine26ReactionHandoff?.candidateIdentityVersion ??
      engine26LocationCandidate?.candidateIdentityVersion ??
      null,

    authorizeEngine3Evaluation:
      engine26ReactionHandoff?.authorizeEngine3Evaluation === true ||
      engine26LocationCandidate?.authorizeEngine3Evaluation === true,

    /*
     * Primary 10m row: what price is doing NOW.
     */
    state:
      currentPriceAction.state,

    direction:
      currentPriceAction.direction,

    quality:
      currentPriceAction.quality,

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
     * Exact-zone/reference diagnostics remain separate.
     */
    referenceType:
      liveZoneAction?.referenceType ||
      completedZoneAction?.referenceType ||
      "ENGINE26_NEGOTIATED_ZONE",

    referenceLabel:
      liveZoneAction?.referenceLabel ||
      completedZoneAction?.referenceLabel ||
      "Engine 26 Negotiated Zone",

    referenceLevel:
      liveZoneAction?.referenceLevel ??
      completedZoneAction?.referenceLevel ??
      zone?.mid ??
      null,

    negotiatedZone:
      liveZoneAction?.zone ||
      completedZoneAction?.zone ||
      zone ||
      null,

    liveZoneReactionRole:
      "WATCH_DISPLAY_ONLY",

    liveZoneReactionState:
      liveZoneAction?.state ||
      "NO_SIGNAL",

    liveZoneReactionDirection:
      liveZoneAction?.direction ||
      "NEUTRAL",

    liveZoneReactionQuality:
      liveZoneAction?.quality ||
      "WEAK",

    liveLevelAction:
      liveZoneAction?.levelAction ||
      null,

    liveZoneAction:
      liveZoneAction || null,

    completedZoneReactionRole:
      "BROADER_ENGINE3_CONFIRMATION_EVIDENCE",

    completedZoneReactionState:
      completedZoneAction?.state ||
      "NO_SIGNAL",

    completedZoneReactionDirection:
      completedZoneAction?.direction ||
      "NEUTRAL",

    completedZoneReactionQuality:
      completedZoneAction?.quality ||
      "WEAK",

    completedLevelAction:
      completedZoneAction?.levelAction ||
      null,

    completedZoneAction:
      completedZoneAction || null,

    completedZoneReactionActive:
      completedZoneAction?.active === true,

    currentCandle:
      truth.allBars.at(-1) || null,

    priorCandle:
      truth.allBars.at(-2) || null,

    currentCandleStatus:
      truth.latestBarCompletionState ||
      "NO_BARS",

    completedBarCount:
      Array.isArray(truth.completedBars)
        ? truth.completedBars.length
        : 0,

    observedAt:
      truth.evaluationTimeMs,

    canonicalDirectionAuthority: false,
    canonicalQualificationAuthority: false,
    liveReactionMayAuthorize: false,
    completedReactionMayAuthorize: false,
    ema10Authority: false,

    reasonCodes: [
      "ENGINE3_10M_CURRENT_PRICE_ACTION_DIAGNOSTIC",
      "ENGINE3_10M_CURRENT_PRICE_ACTION_INDEPENDENT_OF_ZONE",
      "ENGINE3_10M_CURRENT_PRICE_ACTION_INDEPENDENT_OF_EMA10",
      "ENGINE3_10M_EXACT_ZONE_DIAGNOSTICS_PRESERVED_SEPARATELY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildReactionConfirmation10m;
