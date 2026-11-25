// services/core/logic/engine25/engine29/buildEnergyAuthority.js
// Engine 25 <- Engine 29 energy/oil authority adapter v1
//
// Engine 29 groups.energyInflation owns active 1W / 1H / 30m oil-complex reaction.
// Engine 25's separate CL/BZ intraday lane remains unchanged.
// Finlight/news remains event context ("why").
// This adapter does not create MACRO_SHOCK or execution authority.

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function weightedAverage(items = []) {
  const valid = items.filter(
    (item) =>
      item &&
      isFiniteNumber(item.value) &&
      isFiniteNumber(item.weight) &&
      Number(item.weight) > 0
  );

  if (!valid.length) return null;

  const totalWeight = valid.reduce((sum, item) => sum + Number(item.weight), 0);
  const weightedSum = valid.reduce(
    (sum, item) => sum + Number(item.value) * Number(item.weight),
    0
  );

  return Math.round(weightedSum / totalWeight);
}

function stateHealthScore(state) {
  const normalized = String(state || "").toUpperCase();

  if (normalized === "HEALTHY") return 90;
  if (normalized === "RECOVERING") return 75;
  if (normalized === "FORMING") return 55;
  if (normalized === "CONFIRMED") return 35;
  if (normalized === "SEVERE") return 15;

  return null;
}

export function buildEnergyAuthority({
  engine29Data = null,
  legacyOilPressureScore = null,
  legacyUso = null,
} = {}) {
  const group = engine29Data?.groups?.energyInflation || null;

  const degradedGroups = Array.isArray(engine29Data?.dataQuality?.degradedGroups)
    ? engine29Data.dataQuality.degradedGroups
    : [];

  const groupDegraded = degradedGroups.some(
    (name) => String(name || "").toLowerCase() === "energyinflation"
  );

  const structuralState = group?.structural?.state || null;
  const tacticalState = group?.tactical?.state || null;
  const fastState = group?.fastTactical?.state || null;

  const tacticalDirectionalState = group?.tactical?.directionalState || null;
  const fastDirectionalState = group?.fastTactical?.directionalState || null;

  const layerDegraded =
    group?.structural?.dataDegraded === true ||
    group?.tactical?.dataDegraded === true ||
    group?.fastTactical?.dataDegraded === true;

  const missingRequiredMembers = [
    ...(Array.isArray(group?.structural?.missingRequiredMembers)
      ? group.structural.missingRequiredMembers
      : []),
    ...(Array.isArray(group?.tactical?.missingRequiredMembers)
      ? group.tactical.missingRequiredMembers
      : []),
    ...(Array.isArray(group?.fastTactical?.missingRequiredMembers)
      ? group.fastTactical.missingRequiredMembers
      : []),
  ];

  const structuralScore = stateHealthScore(structuralState);
  const tacticalScore = stateHealthScore(tacticalState);
  const fastScore = stateHealthScore(fastState);

  const hasCanonicalStates =
    isFiniteNumber(structuralScore) &&
    isFiniteNumber(tacticalScore) &&
    isFiniteNumber(fastScore);

  const usable =
    Boolean(engine29Data) &&
    Boolean(group) &&
    !groupDegraded &&
    !layerDegraded &&
    missingRequiredMembers.length === 0 &&
    hasCanonicalStates;

  if (!usable) {
    return {
      score: isFiniteNumber(legacyOilPressureScore)
        ? Number(legacyOilPressureScore)
        : 50,
      label: "ENGINE25_LEGACY_USO_OIL_PRESSURE",
      authority: "ENGINE25_LEGACY_USO_FALLBACK",
      primarySource: "ENGINE25_USO_PROXY",
      fallbackUsed: true,
      engine29EnergyAuthorityAvailable: false,
      engine29FallbackReason: !engine29Data
        ? "ENGINE29_UNAVAILABLE"
        : !group
          ? "ENGINE29_ENERGY_INFLATION_GROUP_UNAVAILABLE"
          : groupDegraded
            ? "ENGINE29_ENERGY_INFLATION_GROUP_DEGRADED"
            : layerDegraded
              ? "ENGINE29_ENERGY_INFLATION_LAYER_DEGRADED"
              : missingRequiredMembers.length > 0
                ? "ENGINE29_ENERGY_INFLATION_REQUIRED_MEMBER_MISSING"
                : "ENGINE29_ENERGY_INFLATION_CANONICAL_STATES_UNAVAILABLE",
      legacyUso,
      warnings: [],
    };
  }

  // Higher score = less macro pressure / more supportive.
  // This preserves Engine 25's existing oilPressureScore orientation.
  const score = weightedAverage([
    { value: structuralScore, weight: 0.20 },
    { value: tacticalScore, weight: 0.40 },
    { value: fastScore, weight: 0.40 },
  ]);

  const structuralStressConfirmed =
    structuralState === "CONFIRMED" || structuralState === "SEVERE";
  const tacticalStressConfirmed =
    tacticalState === "CONFIRMED" || tacticalState === "SEVERE";
  const fastStressConfirmed =
    fastState === "CONFIRMED" || fastState === "SEVERE";

  const warnings = [];

  if (structuralStressConfirmed) {
    warnings.push("Engine 29 structural oil-complex pressure confirmed");
  }
  if (tacticalStressConfirmed) {
    warnings.push("Engine 29 1H oil-complex pressure confirmed");
  } else if (tacticalState === "FORMING") {
    warnings.push("Engine 29 1H oil-complex pressure forming");
  }
  if (fastStressConfirmed) {
    warnings.push("Engine 29 30m oil-complex pressure confirmed");
  } else if (fastState === "FORMING") {
    warnings.push("Engine 29 30m oil-complex pressure forming");
  }

  if (tacticalDirectionalState === "PRESSURE_INCREASING") {
    warnings.push("Engine 29 1H oil pressure is increasing");
  }
  if (fastDirectionalState === "PRESSURE_INCREASING") {
    warnings.push("Engine 29 30m oil pressure is increasing");
  } else if (fastDirectionalState === "PRESSURE_EASING") {
    warnings.push("Engine 29 30m oil pressure is easing");
  }

  return {
    score,
    label:
      score >= 75
        ? "ENERGY_PRESSURE_LOW"
        : score >= 60
          ? "ENERGY_PRESSURE_MANAGEABLE"
          : score >= 45
            ? "ENERGY_PRESSURE_ELEVATED"
            : "ENERGY_PRESSURE_HIGH",

    authority: "ENGINE29_GROUPS_ENERGY_INFLATION_PRIMARY",
    primarySource: "ENGINE29_GROUPS_ENERGY_INFLATION",
    fallbackUsed: false,
    engine29EnergyAuthorityAvailable: true,

    structural1wState: structuralState,
    tactical1hState: tacticalState,
    fast30mState: fastState,

    tacticalDirectionalState,
    fastDirectionalState,

    structuralStressConfirmed,
    tacticalStressConfirmed,
    fastStressConfirmed,

    stateHealthScores: {
      structural: structuralScore,
      tactical: tacticalScore,
      fastTactical: fastScore,
    },

    formula:
      "20PCT_STRUCTURAL_1W_PLUS_40PCT_TACTICAL_1H_PLUS_40PCT_FAST_30M",

    legacyUso: {
      score: isFiniteNumber(legacyOilPressureScore)
        ? Number(legacyOilPressureScore)
        : null,
      symbol: legacyUso || null,
    },

    warnings,
  };
}

export default buildEnergyAuthority;
