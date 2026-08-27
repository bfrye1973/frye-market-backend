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
 * LEGACY / COMPATIBILITY DIRECTION
 *
 * This remains published so existing downstream/front-end code does not
 * break while Strategy 1 is being rewired.
 *
 * It is NOT the new canonical Engine 3 reaction authority.
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

  /*
   * LIVE 5m negotiated-zone observation.
   *
   * Uses all 5m bars, including the current forming bar.
   * Purpose:
   * - dashboard/watch visibility
   * - show what Engine 3 is seeing right now
   *
   * This must NOT directly authorize canonical Engine 3.
   */
  const liveZoneAction = buildExactZoneAction({
    symbol:
      observation1m?.symbol ||
      engine26ReactionHandoff?.symbol ||
      engine26LocationCandidate?.symbol ||
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

  /*
   * COMPLETED 5m negotiated-zone reaction evidence.
   *
   * Uses completed 5m bars only.
   * This is the stable/mature 5m price-reaction evidence that may later
   * be consumed by canonical Engine 3 after the manager-approved wiring
   * is implemented.
   *
   * IMPORTANT:
   * This builder still does not authorize Engine 3.
   */
  const completedZoneAction = buildExactZoneAction({
    symbol:
      observation1m?.symbol ||
      engine26ReactionHandoff?.symbol ||
      engine26LocationCandidate?.symbol ||
      "ES",

    tf: "5m",

    bars:
      truth.completedBars,

    currentPrice:
      truth.completedBars.at(-1)?.close ??
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

  /*
   * Legacy compatibility comparison.
   *
   * Keep publishing this while old downstream consumers still expect
   * SUPPORT / CONFLICT / UNRESOLVED.
   *
   * This no longer represents the intended future canonical Engine 3
   * reaction authority.
   */
  const oneDirection =
    observation1m?.direction ||
    "NEUTRAL";

  const fiveDirection =
    candleDirectionFromBars(
      truth.completedBars
    );

  const comparable =
    identityAligned &&
    !stale &&
    observation1m?.active === true &&
    completedZoneAction?.active === true;

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
      zone != null &&
      (
        liveZoneAction?.active === true ||
        completedZoneAction?.active === true
      ),

    diagnosticOnly: true,
    noPermissionCreated: true,
    noExecution: true,

    sourceTimeframe: "5m",

    /*
     * ------------------------------------------------------------------
     * LEGACY COMPATIBILITY FIELDS
     * ------------------------------------------------------------------
     */
    validationState,

    direction:
      fiveDirection,

    quality:
      completedZoneAction?.quality ||
      liveZoneAction?.quality ||
      "WEAK",

    supports1mDirection:
      supports,

    conflictsWith1mDirection:
      conflicts,

    maturityResolved:
      supports || conflicts,

    /*
     * ------------------------------------------------------------------
     * NEW EXACT ENGINE 26 NEGOTIATED-ZONE REACTION FIELDS
     * ------------------------------------------------------------------
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

    /*
     * Backward-compatible aliases for the live exact-zone view.
     */
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

    /*
     * COMPLETED / MATURE 5m VIEW
     */
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

    currentCandleStatus:
      truth.latestBarCompletionState ||
      "NO_BARS",

    completedBarCount:
      Array.isArray(truth.completedBars)
        ? truth.completedBars.length
        : 0,

    ...identity,

    canonicalDirectionAuthority:
      false,

    canonicalQualificationAuthority:
      false,

    liveReactionMayAuthorize:
      false,

    completedReactionMayAuthorize:
      false,

    reasonCodes: [
      "ENGINE3_5M_DIAGNOSTIC_VALIDATION",
      "ENGINE3_STRATEGY1_CANDLE_DIRECTION_INDEPENDENT_OF_ZONE",

      "ENGINE3_5M_EXACT_ENGINE26_NEGOTIATED_ZONE_REFERENCE",
      "ENGINE3_5M_LIVE_ZONE_REACTION_WATCH_ONLY",
      "ENGINE3_5M_COMPLETED_ZONE_REACTION_EVIDENCE",

      "ENGINE3_5M_LIVE_REACTION_HAS_NO_CANONICAL_AUTHORITY",
      "ENGINE3_5M_COMPLETED_REACTION_NOT_YET_WIRED_TO_CANONICAL_AUTHORITY",

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
