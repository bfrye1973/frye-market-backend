// Engine 4 canonical plain-English diagnostics / finalization.
// Extracted without behavior changes in Phase B3.

import { safeUpper } from "../contracts/inputUtils.js";

const STATES = {
  WAITING: "PARTICIPATION_WAITING",
  FORMING: "FORMING_CANDLE_PARTICIPATION_DEVELOPING",
  CONFIRMED: "PARTICIPATION_CONFIRMED",
  ADVERSE: "ADVERSE_PARTICIPATION_BLOCKED",
  INVALIDATED: "CANDIDATE_INVALIDATED",
  IDENTITY_MISMATCH: "IDENTITY_MISMATCH",
};

export function buildPlainEnglishLines(result) {
  const lines = [];
  const state = safeUpper(result?.participationState, STATES.WAITING);
  const quality = safeUpper(result?.participationQuality, "WEAK");
  const expectedParticipationDirection = safeUpper(
    result?.expectedParticipationDirection,
    ""
  );

  const hasSourceSpecificEngine3Observation =
    result?.observation1mTimeframe != null ||
    result?.validation5mTimeframe != null;

  // Preserve established Phase 3 wording only for legacy reaction objects that
  // do not publish the D3/explicit eligibility contract. New Strategy 1 output
  // uses the three-timeframe lines below.
  if (
    hasSourceSpecificEngine3Observation !== true &&
    result?.participationEvaluationEligibilityPublished !== true
  ) {
    lines.push("Engine 4 is watching volume.");

    if (quality === "RISK" || result?.hardBlocked === true) {
      lines.push("Volume participation is adverse enough to block the setup.");
    } else if (quality === "PROVISIONAL" || state === STATES.FORMING) {
      lines.push("Volume participation is developing, but it is not confirmed yet.");
    } else if (["GOOD", "STRONG"].includes(quality) || result?.participationConfirmed === true) {
      lines.push("Volume participation is confirmed for Engine 6 review.");
    } else {
      lines.push("Volume is weak right now.");
    }

    if (result?.hardBlocked === true) {
      lines.push("Engine 4 is blocking only because valid adverse evidence is present.");
    } else {
      lines.push("Engine 4 is not killing the setup.");
    }

    if (
      result?.participationEvaluationEligible !== true &&
      result?.reactionConfirmed !== true
    ) {
      lines.push("Engine 4 is waiting because Engine 3 reaction is not confirmed.");
    } else if (result?.participationConfirmed !== true) {
      lines.push("Engine 4 is waiting for participation to confirm.");
    } else if (result?.allowed === true) {
      lines.push("Engine 4 participation is acceptable for Engine 6 review only.");
    }

    if (
      result?.contactState === "NEGOTIATED_LINE_CONTACT" &&
      expectedParticipationDirection === "SHORT"
    ) {
      lines.push("Strategy 1 remains neutral while Engine 4 watches SHORT-side seller participation.");
    }

    lines.push("No permission. No execution.");
    return lines;
  }

  const volumeReaction = safeUpper(
    result?.currentVolumeReaction,
    "VOLUME_DATA_UNAVAILABLE"
  );

  if (result?.observationStatus === "STALE") {
    lines.push("1m: live volume observation is stale.");
  } else if (result?.observerActive !== true) {
    lines.push("1m: live volume observation is unavailable.");
  } else if (
    ["VOLUME_EXPANDING", "VOLUME_EXPANDING_STRONG", "FORMING_VOLUME_EXPANDING"].includes(volumeReaction)
  ) {
    lines.push("1m: volume expanding right now.");
  } else if (["VOLUME_LIGHT", "VOLUME_SLIGHTLY_BELOW_PRIOR", "FORMING_VOLUME_LIGHT"].includes(volumeReaction)) {
    lines.push("1m: volume lighter right now.");
  } else if (volumeReaction === "FORMING_VOLUME_ACTIVE") {
    lines.push("1m: volume is active on the forming candle.");
  } else if (volumeReaction === "VOLUME_ACTIVE_NO_CLEAR_EDGE") {
    lines.push("1m: volume is active with no clear edge.");
  } else {
    lines.push("1m: live volume data is available, but the immediate read is unresolved.");
  }

  if (result?.validation5mActive === true) {
    const validationState = safeUpper(result?.validation5mState, "UNRESOLVED");
    if (validationState === "UNRESOLVED") {
      lines.push("5m: validation still unresolved.");
    } else if (validationState === "SUPPORTIVE") {
      lines.push("5m: validation remains supportive.");
    } else if (validationState === "CONFLICTING") {
      lines.push("5m: validation is conflicting.");
    } else {
      lines.push(`5m: validation state is ${validationState}.`);
    }
  } else {
    lines.push("5m: validation is unavailable.");
  }

  if (result?.broader10mActive === true) {
    const broaderTrend = safeUpper(result?.broader10mVolumeTrend, "");
    if (broaderTrend === "FADING") {
      lines.push("10m: broader participation is fading.");
    } else if (broaderTrend === "EXPANDING") {
      lines.push("10m: broader participation is expanding.");
    } else if (result?.broader10mVolumeExpansion === true) {
      lines.push("10m: broader participation remains active with volume expansion.");
    } else {
      lines.push("10m: broader participation remains active.");
    }
  } else {
    lines.push("10m: broader participation context is unavailable.");
  }

  if (result?.hardBlocked === true) {
    lines.push("Engine 4 confirmation is blocked by valid adverse participation.");
  } else if (result?.participationEvaluationEligible !== true) {
    lines.push("Engine 4 confirmation is waiting for Engine 3 qualification.");
  } else if (result?.participationConfirmed !== true) {
    lines.push("Engine 4 confirmation is waiting for participation to confirm.");
  } else if (result?.allowed === true) {
    lines.push("Engine 4 participation is confirmed for Engine 6 review only.");
  }

  if (
    result?.contactState === "NEGOTIATED_LINE_CONTACT" &&
    expectedParticipationDirection === "SHORT"
  ) {
    lines.push("Strategy 1 remains neutral while Engine 4 watches SHORT-side seller participation.");
  }

  lines.push("No permission. No execution.");

  return lines;
}

export function finalizeResult(result) {
  const plainEnglishLines = buildPlainEnglishLines(result);

  return {
    ...result,
    plainEnglishLines,
    timelinePlainEnglish: plainEnglishLines.join(" "),
  };
}
