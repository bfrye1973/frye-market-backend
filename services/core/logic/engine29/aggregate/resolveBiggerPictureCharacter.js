// Engine 29 Bigger Picture v2 — market-character resolver.
//
// Uses existing canonical states only:
// - Engine 29 owns structural state.
// - Engine 25 owns breadth/distribution truth.
// - No Engine 25 score is recalculated here.
// - Closed-session / last-valid participation remains diagnostic only.

export const ENGINE29_BIGGER_PICTURE_CHARACTER_STATES = Object.freeze({
  SUPPORTIVE: "SUPPORTIVE",
  NARROWING: "NARROWING",
  DISTRIBUTION_PRESSURE: "DISTRIBUTION_PRESSURE",
  BROAD_DETERIORATION: "BROAD_DETERIORATION",
  STRUCTURE_ONLY: "STRUCTURE_ONLY",
  MIXED: "MIXED",
});

function distributionCharacter(structuralParticipation) {
  if (
    structuralParticipation?.contractValid !== true ||
    structuralParticipation?.distribution?.canonicalEngine !==
      "engine25.distributionPressure.v2"
  ) {
    return {
      state: null,
      reason: "ENGINE25_DISTRIBUTION_V2_UNAVAILABLE",
    };
  }

  const pressureLabel =
    String(
      structuralParticipation?.distribution?.pressureLabel || ""
    ).toUpperCase();

  const breadthLabel =
    String(
      structuralParticipation?.breadth?.label || ""
    ).toUpperCase();

  const persistence =
    structuralParticipation?.distribution?.persistence || null;

  const persistentHigh =
    ["HIGH", "EXTREME"].includes(pressureLabel) &&
    persistence?.confirmed === true;

  if (persistentHigh) {
    return {
      state:
        ENGINE29_BIGGER_PICTURE_CHARACTER_STATES
          .DISTRIBUTION_PRESSURE,
      reason: "ENGINE25_4H_DISTRIBUTION_HIGH_PERSISTENT",
    };
  }

  if (
    ["WATCH", "ELEVATED"].includes(pressureLabel) ||
    [
      "BREADTH_PARTICIPATION_WEAK",
      "BREADTH_PARTICIPATION_MIXED_WEAKENING",
    ].includes(breadthLabel)
  ) {
    return {
      state:
        ENGINE29_BIGGER_PICTURE_CHARACTER_STATES.NARROWING,
      reason: "ENGINE25_PARTICIPATION_NARROWING",
    };
  }

  if (
    pressureLabel === "LOW" &&
    [
      "BREADTH_PARTICIPATION_HEALTHY",
      "BREADTH_PARTICIPATION_MIXED",
    ].includes(breadthLabel)
  ) {
    return {
      state:
        ENGINE29_BIGGER_PICTURE_CHARACTER_STATES.SUPPORTIVE,
      reason: "ENGINE25_PARTICIPATION_SUPPORTIVE",
    };
  }

  return {
    state: ENGINE29_BIGGER_PICTURE_CHARACTER_STATES.MIXED,
    reason: "ENGINE25_PARTICIPATION_MIXED",
  };
}

export function resolveEngine29BiggerPictureCharacter({
  structuralState = null,
  structuralParticipation = null,
} = {}) {
  const structural = String(structuralState || "").toUpperCase();

  // Engine 29 structural authority is always allowed to declare broad
  // deterioration/risk-off/systemic conditions.
  if (
    [
      "BROAD_DETERIORATION",
      "RISK_OFF_CONFIRMED",
      "SYSTEMIC_STRESS",
    ].includes(structural)
  ) {
    return {
      version: "engine29.biggerPictureCharacter.v1",
      state:
        ENGINE29_BIGGER_PICTURE_CHARACTER_STATES
          .BROAD_DETERIORATION,
      currentParticipationPromotionEligible: false,
      participationDiagnostic: distributionCharacter(
        structuralParticipation
      ),
      structuralState,
      reason: "ENGINE29_STRUCTURAL_DETERIORATION_CONFIRMED",
      authority: {
        structural: "ENGINE29",
        participation: "ENGINE25_READ_ONLY",
      },
    };
  }

  const participationCharacter =
    distributionCharacter(structuralParticipation);

  const currentParticipationPromotionEligible =
    structuralParticipation?.freshness?.state === "FRESH" &&
    structuralParticipation?.freshness?.equityScannerSession?.active === true;

  // Outside the active equity session, Engine 25's last-valid read remains
  // diagnostic only. Do not manufacture a fresh SUPPORTIVE/NARROWING/
  // DISTRIBUTION_PRESSURE promotion from closed-session evidence.
  if (!currentParticipationPromotionEligible) {
    return {
      version: "engine29.biggerPictureCharacter.v1",
      state:
        ENGINE29_BIGGER_PICTURE_CHARACTER_STATES.STRUCTURE_ONLY,
      currentParticipationPromotionEligible: false,
      participationDiagnostic: participationCharacter,
      structuralState,
      reason: "ENGINE25_CURRENT_PARTICIPATION_NOT_PROMOTION_ELIGIBLE",
      authority: {
        structural: "ENGINE29",
        participation: "ENGINE25_READ_ONLY",
      },
    };
  }

  return {
    version: "engine29.biggerPictureCharacter.v1",
    state:
      participationCharacter.state ||
      ENGINE29_BIGGER_PICTURE_CHARACTER_STATES.MIXED,
    currentParticipationPromotionEligible: true,
    participationDiagnostic: participationCharacter,
    structuralState,
    reason: participationCharacter.reason,
    authority: {
      structural: "ENGINE29",
      participation: "ENGINE25_READ_ONLY",
    },
  };
}

export default resolveEngine29BiggerPictureCharacter;
