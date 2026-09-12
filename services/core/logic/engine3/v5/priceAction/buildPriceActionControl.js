// services/core/logic/engine3/v5/priceAction/buildPriceActionControl.js
//
// Engine 3 v5 — Timeframe-agnostic price-action control layer.
//
// Contract:
// - Consumes already-built high-resolution price-action evidence.
// - Resolves buyer/seller CONTROL from what price is actually doing:
//     approach
//     contact
//     reaction
//     follow-through
//     sequence
// - Does NOT publish canonical LONG / SHORT / NEUTRAL.
// - Does NOT give 1m, 5m, or 10m directional authority.
// - The source bar interval is transport/resolution only, not authority.
// - Does not create permission or execution.
//
// Canonical direction remains exclusively owned by
// state/directionStateMachine.js.

import {
  resolveBuyerSellerControl,
} from "../control/resolveBuyerSellerControl.js";

import {
  resolveReactionQuality,
} from "../control/resolveReactionQuality.js";

const ENGINE = "engine3.v5.priceAction.buildPriceActionControl.v1";
const SOURCE = "engine3.v5.priceAction.buildPriceActionControl";

function safeUpper(value, fallback = "UNKNOWN") {
  const text = String(value || "").trim().toUpperCase();
  return text || fallback;
}

export function buildPriceActionControl({
  normalizedZoneInput = null,
  priceActionEvidence = null,
  sourceResolution = "HIGH_RESOLUTION_PRICE_PATH",
} = {}) {
  const evidence =
    priceActionEvidence && typeof priceActionEvidence === "object"
      ? priceActionEvidence
      : null;

  const zoneEligible =
    normalizedZoneInput?.eligible === true;

  const normalizedBarCount =
    Number(
      evidence?.normalized?.validBarCount ??
      evidence?.normalized?.bars?.length ??
      0
    ) || 0;

  const evidenceAvailable =
    evidence != null &&
    normalizedBarCount > 0;

  if (!zoneEligible || !evidenceAvailable) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,

      role: "PRICE_ACTION_CONTROL",
      sourceResolution,
      sourceResolutionAuthority: false,

      eligible: false,
      controlResolved: false,

      controlState: "NO_CONTROL",
      controlConfidence: "WEAK",
      quality: "WEAK",
      qualityScore: null,

      canonicalDirection: null,
      canonicalDirectionPublisher: false,
      canonicalControlAuthority: true,

      approachState:
        evidence?.approach?.approachState ?? null,
      contactState:
        evidence?.contact?.contactState ?? null,
      reactionState:
        evidence?.reaction?.reactionState ?? null,
      reactionBias:
        evidence?.reaction?.reactionBias ?? null,
      followThroughState:
        evidence?.followThrough?.followThroughState ?? null,
      followThroughBias:
        evidence?.followThrough?.followThroughBias ?? null,
      sequencePhase:
        evidence?.sequenceMomentum?.phase ?? null,

      reasonCodes: [
        "ENGINE3_V5_PRICE_ACTION_CONTROL_BUILT",
        zoneEligible
          ? "ENGINE3_V5_PRICE_ACTION_EVIDENCE_UNAVAILABLE"
          : "ENGINE3_V5_PRICE_ACTION_ZONE_NOT_ELIGIBLE",
        "ENGINE3_V5_TIMEFRAME_LABELS_HAVE_NO_DIRECTION_AUTHORITY",
        "ENGINE3_V5_DIRECTION_STATE_MACHINE_REQUIRED",
        "ENGINE3_V5_NO_PERMISSION_CREATED",
        "ENGINE3_V5_NO_EXECUTION",
      ],
    };
  }

  const control =
    resolveBuyerSellerControl({
      approach:
        evidence.approach || null,
      contact:
        evidence.contact || null,
      reaction:
        evidence.reaction || null,
      followThrough:
        evidence.followThrough || null,
      sequenceMomentum:
        evidence.sequenceMomentum || null,
    });

  const quality =
    resolveReactionQuality({
      approach:
        evidence.approach || null,
      contact:
        evidence.contact || null,
      reaction:
        evidence.reaction || null,
      followThrough:
        evidence.followThrough || null,
      sequenceMomentum:
        evidence.sequenceMomentum || null,
      control,
    });

  const controlState =
    safeUpper(
      control?.controlState,
      "NO_CONTROL"
    );

  const controlResolved =
    controlState === "BUYERS_CONTROL" ||
    controlState === "SELLERS_CONTROL";

  return {
    ok: true,
    engine: ENGINE,
    source: SOURCE,

    role: "PRICE_ACTION_CONTROL",

    /*
     * This records where the densest price path came from.
     * It is diagnostic transport metadata only.
     */
    sourceResolution,
    sourceResolutionAuthority: false,

    eligible:
      zoneEligible && evidenceAvailable,

    controlResolved,

    controlState,

    controlConfidence:
      safeUpper(
        control?.controlConfidence,
        "WEAK"
      ),

    quality:
      safeUpper(
        quality?.quality,
        "WEAK"
      ),

    qualityScore:
      quality?.qualityScore ?? null,

    buyerScore:
      control?.score?.buyers ??
      null,

    sellerScore:
      control?.score?.sellers ??
      null,

    mixedScore:
      control?.score?.mixed ??
      null,

    approachState:
      evidence?.approach?.approachState ?? null,

    approachCharacter:
      evidence?.approach?.approachCharacter ?? null,

    contactState:
      evidence?.contact?.contactState ?? null,

    contactCharacter:
      evidence?.contact?.contactCharacter ?? null,

    reactionState:
      evidence?.reaction?.reactionState ?? null,

    reactionBias:
      evidence?.reaction?.reactionBias ?? null,

    followThroughState:
      evidence?.followThrough?.followThroughState ?? null,

    followThroughBias:
      evidence?.followThrough?.followThroughBias ?? null,

    sequencePhase:
      evidence?.sequenceMomentum?.phase ?? null,

    sequenceBias:
      evidence?.sequenceMomentum?.evidenceBias ?? null,

    canonicalDirection: null,
    canonicalDirectionPublisher: false,

    /*
     * This module owns CONTROL resolution only.
     * directionStateMachine.js remains the sole direction publisher.
     */
    canonicalControlAuthority: true,

    control,
    qualityEvidence: quality,

    reasonCodes: [
      "ENGINE3_V5_PRICE_ACTION_CONTROL_BUILT",
      "ENGINE3_V5_PRICE_ACTION_NOT_TIMEFRAME_AUTHORITY",
      controlResolved
        ? `ENGINE3_V5_PRICE_ACTION_${controlState}_RESOLVED`
        : `ENGINE3_V5_PRICE_ACTION_${controlState}`,
      "ENGINE3_V5_DIRECTION_STATE_MACHINE_REQUIRED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default buildPriceActionControl;
