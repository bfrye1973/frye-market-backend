import { deriveCandleCompletionTruth } from "./candleCompletionTruth.js";
import { buildExactZoneAction } from "../priceAction/currentLevelAction.js";

const STALE_AFTER_MS = 10 * 60 * 1000;
const MAX_SKEW_MS = 5 * 60 * 1000;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameIdentity(a = {}, b = {}) {
  const fields = [
    "symbol",
    "laneId",
    "strategyId",
    "candidateId",
    "zoneId",
    "candidateIdentityVersion",
  ];

  return fields.every(
    (field) =>
      a?.[field] != null &&
      a?.[field] === b?.[field]
  );
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
 * CURRENT 5m PRICE ACTION
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

export function buildReactionValidation5m({
  bars = [],
  evaluationTimeMs,
  observation1m = null,
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  const truth = deriveCandleCompletionTruth({
    bars,
    timeframe: "5m",
    evaluationTimeMs,
  });

  const zone = zoneFrom(
    engine26LocationCandidate,
    engine26ReactionHandoff
  );

  const symbol =
    observation1m?.symbol ||
    engine26ReactionHandoff?.symbol ||
    engine26LocationCandidate?.symbol ||
    "ES";

  /*
   * Keep exact-zone diagnostics for separate inspection.
   * These are NOT the 5m current-price-action read.
   */
  const liveZoneAction = buildExactZoneAction({
    symbol,
    tf: "5m",
    bars: truth.allBars,
    currentPrice:
      truth.allBars.at(-1)?.close ??
      null,
    zone,
    evaluationTimeMs,
  });

  const completedZoneAction = buildExactZoneAction({
    symbol,
    tf: "5m",
    bars: truth.completedBars,
    currentPrice:
      truth.completedBars.at(-1)?.close ??
      null,
    zone,
    evaluationTimeMs,
  });

  /*
   * 5m timeline row is current price action.
   * Use all 5m bars, including the current forming candle.
   */
  const currentPriceAction = candleReactionFromBars(
    truth.allBars
  );

  /*
   * Completed-only 5m read stays available separately.
   */
  const completedPriceAction = candleReactionFromBars(
    truth.completedBars
  );

  const identity = {
    symbol:
      engine26ReactionHandoff?.symbol ||
      engine26LocationCandidate?.symbol ||
      "ES",

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

    setupClass:
      engine26ReactionHandoff?.setupClass ??
      engine26LocationCandidate?.setupClass ??
      null,

    setupGrade:
      engine26ReactionHandoff?.setupGrade ??
      engine26LocationCandidate?.setupGrade ??
      null,

    identitySetupKey:
      engine26ReactionHandoff?.identitySetupKey ??
      engine26LocationCandidate?.identitySetupKey ??
      null,

    candidateIdentityVersion:
      engine26ReactionHandoff?.candidateIdentityVersion ??
      engine26LocationCandidate?.candidateIdentityVersion ??
      null,

    contactState:
      engine26ReactionHandoff?.contactState ??
      engine26LocationCandidate?.contactState ??
      null,

    chainArmed:
      engine26ReactionHandoff?.chainArmed === true ||
      engine26LocationCandidate?.chainArmed === true,

    authorizeEngine3Evaluation:
      engine26ReactionHandoff?.authorizeEngine3Evaluation === true ||
      engine26LocationCandidate?.authorizeEngine3Evaluation === true,
  };

  const barStart =
    truth.latestBarStartTimeMs;

  const barEnd =
    truth.latestExpectedCloseTimeMs;

  const sourceAgeMs =
    barEnd != null &&
    truth.evaluationTimeMs != null
      ? Math.max(
          0,
          truth.evaluationTimeMs - barEnd
        )
      : null;

  const skew =
    barEnd != null &&
    observation1m?.barEnd != null
      ? Math.abs(
          barEnd -
          observation1m.barEnd
        )
      : null;

  const identityAligned =
    sameIdentity(
      identity,
      observation1m
    );

  const stale =
    sourceAgeMs == null ||
    sourceAgeMs > STALE_AFTER_MS ||
    skew == null ||
    skew > MAX_SKEW_MS;

  const staleReason =
    sourceAgeMs == null
      ? "NO_SOURCE_BAR_TIME"
      : sourceAgeMs > STALE_AFTER_MS
      ? "SOURCE_BAR_TOO_OLD"
      : skew == null
      ? "NO_CROSS_TIMEFRAME_SKEW"
      : skew > MAX_SKEW_MS
      ? "CROSS_TIMEFRAME_SKEW_EXCEEDED"
      : null;

  /*
   * Compatibility comparison only.
   */
  const oneDirection =
    observation1m?.direction ||
    "NEUTRAL";

  const fiveDirection =
    completedPriceAction.direction;

  const comparable =
    identityAligned &&
    !stale &&
    observation1m?.active === true &&
    Array.isArray(truth.completedBars) &&
    truth.completedBars.length >= 2;

  const supports =
    comparable &&
    oneDirection !== "NEUTRAL" &&
    oneDirection === fiveDirection;

  const conflicts =
    comparable &&
    oneDirection !== "NEUTRAL" &&
    fiveDirection !== "NEUTRAL" &&
    oneDirection !== fiveDirection;

  const validationState =
    !identityAligned
      ? "IDENTITY_MISMATCH"
      : stale
      ? "STALE"
      : !observation1m?.active
      ? "NO_1M_OBSERVATION"
      : supports
      ? "SUPPORT"
      : conflicts
      ? "CONFLICT"
      : "UNRESOLVED";

  return {
    active:
      Array.isArray(truth.allBars) &&
      truth.allBars.length >= 2,

    diagnosticOnly: true,
    currentPriceActionOnly: true,
    noPermissionCreated: true,
    noExecution: true,

    sourceTimeframe: "5m",

    /*
     * Primary 5m row: what price is doing NOW.
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
     * Legacy validation comparison remains diagnostic only.
     */
    validationState,

    supports1mDirection:
      supports,

    conflictsWith1mDirection:
      conflicts,

    maturityResolved:
      supports || conflicts,

    /*
     * Exact-zone diagnostics remain separate.
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

    zoneReactionState:
      liveZoneAction?.state ||
      "NO_SIGNAL",

    zoneReactionDirection:
      liveZoneAction?.direction ||
      "NEUTRAL",

    zoneReactionQuality:
      liveZoneAction?.quality ||
      "WEAK",

    levelAction:
      liveZoneAction?.levelAction ||
      null,

    completedZoneReactionRole:
      "MATURE_ENGINE3_REACTION_EVIDENCE",

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

    candleState:
      truth.latestBarCompletionState,

    observedAt:
      truth.evaluationTimeMs,

    barStart,
    barEnd,

    sourceAgeMs,

    crossTimeframeSkewMs:
      skew,

    stale,
    staleReason,

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

    ...identity,

    canonicalDirectionAuthority: false,
    canonicalQualificationAuthority: false,
    liveReactionMayAuthorize: false,
    completedReactionMayAuthorize: false,
    ema10Authority: false,

    reasonCodes: [
      "ENGINE3_5M_CURRENT_PRICE_ACTION_DIAGNOSTIC",
      "ENGINE3_5M_CURRENT_PRICE_ACTION_INDEPENDENT_OF_ZONE",
      "ENGINE3_5M_CURRENT_PRICE_ACTION_INDEPENDENT_OF_EMA10",
      "ENGINE3_5M_VALIDATION_STATE_COMPATIBILITY_ONLY",
      "ENGINE3_5M_EXACT_ZONE_DIAGNOSTICS_PRESERVED_SEPARATELY",
      ...(!identityAligned
        ? ["IDENTITY_MISMATCH"]
        : []),
      ...(staleReason
        ? [staleReason]
        : []),
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildReactionValidation5m;
