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
   * LIVE 10m view.
   *
   * Uses the forming 10m candle when present.
   * Timeline / watch visibility only.
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

  /*
   * COMPLETED 10m view.
   *
   * Uses completed 10m candles only.
   * Stable broader reaction-confirmation evidence.
   *
   * This file does NOT authorize Engine 3.
   */
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

    sourceTimeframe: "10m",
    role: "BROADER_PRICE_REACTION_CONFIRMATION",

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

    /*
     * LIVE / FORMING 10m VIEW
     */
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
     * COMPLETED / STABLE 10m VIEW
     */
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

    currentCandleStatus:
      truth.latestBarCompletionState ||
      "NO_BARS",

    completedBarCount:
      Array.isArray(truth.completedBars)
        ? truth.completedBars.length
        : 0,

    observedAt:
      truth.evaluationTimeMs,

    /*
     * Safety: this sensor cannot authorize canonical Engine 3 by itself.
     */
    canonicalDirectionAuthority: false,
    canonicalQualificationAuthority: false,
    liveReactionMayAuthorize: false,
    completedReactionMayAuthorize: false,

    reasonCodes: [
      "ENGINE3_10M_BROADER_REACTION_SENSOR",
      "ENGINE3_10M_EXACT_ENGINE26_NEGOTIATED_ZONE_REFERENCE",
      "ENGINE3_10M_LIVE_ZONE_REACTION_WATCH_ONLY",
      "ENGINE3_10M_COMPLETED_ZONE_REACTION_CONFIRMATION_EVIDENCE",
      "ENGINE3_10M_HAS_NO_CANONICAL_AUTHORITY_YET",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildReactionConfirmation10m;
