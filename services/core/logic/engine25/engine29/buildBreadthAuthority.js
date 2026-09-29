// services/core/logic/engine25/engine29/buildBreadthAuthority.js
// Engine 25 <- Engine 29 breadth authority adapter v1
//
// Canonical contract:
// - Index Sector scanner breadth is primary when both intraday and EOD source truth are valid.
// - Engine 29 breadth is confirmation/comparison only during normal scanner operation.
// - Engine 29 may be an explicitly labeled temporary fallback when scanner breadth is unavailable.
// - Divergence is diagnostic only and does not alter permission or the scanner score.

const STATE_HEALTH_SCORES = Object.freeze({
  HEALTHY: 90,
  RECOVERING: 75,
  FORMING: 55,
  CONFIRMED: 35,
  SEVERE: 15,
});

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function stateHealthScore(state) {
  return STATE_HEALTH_SCORES[String(state || "").toUpperCase()] ?? null;
}

function breadthLabel(score) {
  if (score >= 75) return "BREADTH_PARTICIPATION_STRONG";
  if (score >= 55) return "BREADTH_PARTICIPATION_MIXED";
  if (score >= 35) return "BREADTH_PARTICIPATION_WEAK";
  return "BREADTH_PARTICIPATION_SEVERE";
}

function healthBand(score) {
  return isFiniteNumber(score) && Number(score) >= 55 ? "SUPPORTIVE" : "WEAK";
}

function buildEngine29Confirmation(engine29Data, scannerScore = null) {
  const breadthGroup = engine29Data?.groups?.breadth || null;
  const degradedGroups = Array.isArray(engine29Data?.dataQuality?.degradedGroups)
    ? engine29Data.dataQuality.degradedGroups
    : [];

  const groupDegraded = degradedGroups.some(
    (group) => String(group || "").toLowerCase() === "breadth"
  );

  const structural1wState = breadthGroup?.structural?.state || null;
  const tactical1hState = breadthGroup?.tactical?.state || null;
  const fast30mState = breadthGroup?.fastTactical?.state || null;

  const layerDegraded =
    breadthGroup?.structural?.dataDegraded === true ||
    breadthGroup?.tactical?.dataDegraded === true ||
    breadthGroup?.fastTactical?.dataDegraded === true;

  const missingRequiredMembers = [
    ...(Array.isArray(breadthGroup?.structural?.missingRequiredMembers)
      ? breadthGroup.structural.missingRequiredMembers
      : []),
    ...(Array.isArray(breadthGroup?.tactical?.missingRequiredMembers)
      ? breadthGroup.tactical.missingRequiredMembers
      : []),
    ...(Array.isArray(breadthGroup?.fastTactical?.missingRequiredMembers)
      ? breadthGroup.fastTactical.missingRequiredMembers
      : []),
  ];

  const structuralScore = stateHealthScore(structural1wState);
  const tacticalScore = stateHealthScore(tactical1hState);
  const fastScore = stateHealthScore(fast30mState);

  const hasCanonicalStates =
    isFiniteNumber(structuralScore) &&
    isFiniteNumber(tacticalScore) &&
    isFiniteNumber(fastScore);

  const available =
    Boolean(engine29Data) &&
    Boolean(breadthGroup) &&
    !groupDegraded &&
    !layerDegraded &&
    missingRequiredMembers.length === 0 &&
    hasCanonicalStates;

  const score = available
    ? structuralScore * 0.20 + tacticalScore * 0.40 + fastScore * 0.40
    : null;

  const scannerBand = isFiniteNumber(scannerScore) ? healthBand(scannerScore) : null;
  const engine29Band = isFiniteNumber(score) ? healthBand(score) : null;

  return {
    available,
    score,
    structural1wState,
    tactical1hState,
    fast30mState,
    scannerBand,
    engine29Band,
    comparison:
      scannerBand && engine29Band
        ? scannerBand === engine29Band
          ? "ALIGNED"
          : "DIVERGENT"
        : null,
    degraded: groupDegraded || layerDegraded || missingRequiredMembers.length > 0,
    groupDegraded,
    layerDegraded,
    missingRequiredMembers,
    stateHealthScores: {
      structural: structuralScore,
      tactical: tacticalScore,
      fastTactical: fastScore,
    },
    formula: "20PCT_STRUCTURAL_1W_PLUS_40PCT_TACTICAL_1H_PLUS_40PCT_FAST_30M",
  };
}

function scannerValidity(sectorHealthData) {
  const scannerBreadth = sectorHealthData?.breadthParticipation || null;
  const reasons = [];

  if (!sectorHealthData) reasons.push("SECTOR_HEALTH_UNAVAILABLE");
  if (sectorHealthData?.ok !== true) reasons.push("SECTOR_HEALTH_NOT_OK");
  if (!isFiniteNumber(scannerBreadth?.score)) reasons.push("SCANNER_BREADTH_SCORE_INVALID");
  if (!scannerBreadth?.label) reasons.push("SCANNER_BREADTH_LABEL_MISSING");
  if (sectorHealthData?.sources?.intraday?.ok !== true) {
    reasons.push("SCANNER_INTRADAY_SOURCE_UNAVAILABLE");
  }
  if (sectorHealthData?.sources?.eod?.ok !== true) {
    reasons.push("SCANNER_EOD_SOURCE_UNAVAILABLE");
  }

  return {
    valid: reasons.length === 0,
    reasons,
    scannerBreadth,
  };
}

export function buildBreadthAuthority({
  sectorHealthData = null,
  engine29Data = null,
} = {}) {
  const scanner = scannerValidity(sectorHealthData);
  const scannerScore = scanner.valid ? Number(scanner.scannerBreadth.score) : null;
  const engine29Confirmation = buildEngine29Confirmation(engine29Data, scannerScore);

  if (scanner.valid) {
    return {
      ...scanner.scannerBreadth,
      score: scannerScore,
      label: scanner.scannerBreadth.label,
      authority: "ENGINE25_SCANNER_BREADTH_PRIMARY",
      primarySource: "ENGINE25_SECTOR_BREADTH",
      fallbackUsed: false,
      scannerBreadthAvailable: true,
      scannerInvalidReasons: [],
      engine29Confirmation,
      inputs: {
        ...(scanner.scannerBreadth.inputs || {}),
        scannerBreadth: scanner.scannerBreadth,
        engine29BreadthGroup: engine29Data?.groups?.breadth || null,
      },
      warnings: Array.isArray(scanner.scannerBreadth.warnings)
        ? [...scanner.scannerBreadth.warnings]
        : [],
    };
  }

  if (engine29Confirmation.available) {
    const score = Number(engine29Confirmation.score);
    return {
      score,
      label: breadthLabel(score),
      authority: "ENGINE29_BREADTH_FALLBACK",
      primarySource: "ENGINE29_GROUPS_BREADTH",
      fallbackUsed: true,
      scannerBreadthAvailable: false,
      scannerInvalidReasons: scanner.reasons,
      engine29Confirmation,
      inputs: {
        scannerBreadth: scanner.scannerBreadth,
        engine29BreadthGroup: engine29Data?.groups?.breadth || null,
      },
      warnings: [
        ...(Array.isArray(scanner.scannerBreadth?.warnings)
          ? scanner.scannerBreadth.warnings
          : []),
        "Scanner breadth unavailable; using Engine 29 breadth as temporary fallback",
      ],
    };
  }

  return {
    score: 50,
    label: "BREADTH_PARTICIPATION_UNKNOWN",
    authority: "BREADTH_AUTHORITY_UNAVAILABLE",
    primarySource: null,
    fallbackUsed: true,
    scannerBreadthAvailable: false,
    scannerInvalidReasons: scanner.reasons,
    engine29Confirmation,
    inputs: {
      scannerBreadth: scanner.scannerBreadth,
      engine29BreadthGroup: engine29Data?.groups?.breadth || null,
    },
    warnings: [
      ...(Array.isArray(scanner.scannerBreadth?.warnings)
        ? scanner.scannerBreadth.warnings
        : []),
      "Scanner breadth and Engine 29 breadth are unavailable; breadth authority is unknown",
    ],
  };
}

export default buildBreadthAuthority;
