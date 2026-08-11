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

  const candleDirection = candleDirectionFromBars(
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
    direction: candleDirection,

    // Preserve the existing zone-relative action diagnostics separately.
    quality: action.quality || "WEAK",
    state: action.state || "NO_SIGNAL",

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
