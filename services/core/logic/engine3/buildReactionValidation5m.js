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
      return {
        lo: Math.min(lo, hi),
        hi: Math.max(lo, hi),
      };
    }
  }

  return null;
}

/*
 * Strategy 1 validation direction is candle-owned.
 *
 * Engine 26 zone/location remains available as context, but 5m validation
 * must compare actual 5m candle behavior against the 1m direction.
 */
function candleDirectionFromBars(bars = []) {
  const recent = Array.isArray(bars)
    ? bars.filter(Boolean).slice(-3)
    : [];

  if (recent.length < 2) {
    return "NEUTRAL";
  }

  const last = recent[recent.length - 1];
  const prev = recent[recent.length - 2];

  const lastClose = number(last?.close ?? last?.c);
  const prevClose = number(prev?.close ?? prev?.c);
  const lastLow = number(last?.low ?? last?.l);
  const prevLow = number(prev?.low ?? prev?.l);
  const lastHigh = number(last?.high ?? last?.h);
  const prevHigh = number(prev?.high ?? prev?.h);

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

  const action = buildExactZoneAction({
    symbol:
      observation1m?.symbol ||
      "ES",

    tf: "5m",

    bars:
      truth.allBars,

    currentPrice:
      truth.allBars.at(-1)?.close ??
      null,

    zone,

    evaluationTimeMs,
  });
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

  const comparable =
    identityAligned &&
    !stale &&
    observation1m?.active === true &&
    action.active === true;

  const oneDirection =
    observation1m?.direction ||
    "NEUTRAL";

  // Strategy 1 5m direction comes from completed 5m candle behavior,
  // not from zone-relative CHOP/HELD classification.
  const fiveDirection =
    candleDirectionFromBars(
      truth.completedBars
    );

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
      action.active === true &&
      zone != null,

    diagnosticOnly: true,
    noPermissionCreated: true,
    noExecution: true,

    sourceTimeframe: "5m",

    validationState,
    direction: fiveDirection,

    // Preserve existing zone-relative quality diagnostics.
    quality:
      action.quality || "WEAK",

    zoneReactionState:
      action.state ||
      "NO_SIGNAL",

    zoneReactionDirection:
      action.direction ||
      "NEUTRAL",

    zoneReactionQuality:
      action.quality ||
      "WEAK",

    referenceType:
      action.referenceType ||
      null,

    referenceLabel:
      action.referenceLabel ||
      null,

    referenceLevel:
      action.referenceLevel ??
      null,

    levelAction:
      action.levelAction ||
      null,

    negotiatedZone:
      action.zone ||
      zone ||
       null, 

    supports1mDirection:
      supports,

    conflictsWith1mDirection:
      conflicts,

    maturityResolved:
      supports || conflicts,

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

    ...identity,

    reasonCodes: [
      "ENGINE3_5M_DIAGNOSTIC_VALIDATION",
      "ENGINE3_STRATEGY1_CANDLE_DIRECTION_INDEPENDENT_OF_ZONE",
      ...(!identityAligned
        ? ["IDENTITY_MISMATCH"]
        : []),
      ...(staleReason
        ? [staleReason]
        : []),
    ],
  };
}

export default buildReactionValidation5m;
