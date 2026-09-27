// services/core/logic/engine25/engine29/buildRatesAuthority.js
// Engine 25 <- Engine 29 rates/duration authority adapter v1
//
// Engine 29 owns fast rates/duration REACTION.
// Engine 25 keeps official slow FRED context and the separate ZN/ZB lane.
// No MACRO_SHOCK or execution authority is created here.

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

export function buildRatesAuthority({
  engine29Data = null,
  legacyBondMarket = null,
} = {}) {
  const group = engine29Data?.groups?.ratesDuration || null;

  const degradedGroups = Array.isArray(engine29Data?.dataQuality?.degradedGroups)
    ? engine29Data.dataQuality.degradedGroups
    : [];

  const groupDegraded = degradedGroups.some(
    (name) => String(name || "").toLowerCase() === "ratesduration"
  );

  const structuralState = group?.structural?.state || null;
  const tacticalState = group?.tactical?.state || null;
  const fastState = group?.fastTactical?.state || null;

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
      ...(legacyBondMarket || {}),
      authority: "ENGINE25_LEGACY_BOND_MARKET_FALLBACK",
      primarySource: "ENGINE25_FRED_BOND_CONTEXT",
      fallbackUsed: true,
      engine29RatesAuthorityAvailable: false,
      engine29FallbackReason: !engine29Data
        ? "ENGINE29_UNAVAILABLE"
        : !group
          ? "ENGINE29_RATES_DURATION_GROUP_UNAVAILABLE"
          : groupDegraded
            ? "ENGINE29_RATES_DURATION_GROUP_DEGRADED"
            : layerDegraded
              ? "ENGINE29_RATES_DURATION_LAYER_DEGRADED"
              : missingRequiredMembers.length > 0
                ? "ENGINE29_RATES_DURATION_REQUIRED_MEMBER_MISSING"
                : "ENGINE29_RATES_DURATION_CANONICAL_STATES_UNAVAILABLE",
      engine29: {
        structural1wState: structuralState,
        tactical1hState: tacticalState,
        fast30mState: fastState,
        groupDegraded,
        layerDegraded,
        missingRequiredMembers,
      },
    };
  }

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
    warnings.push("Engine 29 structural rates/duration stress confirmed");
  }
  if (tacticalStressConfirmed) {
    warnings.push("Engine 29 1H rates/duration stress confirmed");
  } else if (tacticalState === "FORMING") {
    warnings.push("Engine 29 1H rates/duration stress forming");
  }
  if (fastStressConfirmed) {
    warnings.push("Engine 29 30m rates/duration stress confirmed");
  } else if (fastState === "FORMING") {
    warnings.push("Engine 29 30m rates/duration stress forming");
  }

  return {
    score,
    label:
      score >= 70
        ? "BONDS_SUPPORTIVE"
        : score >= 50
          ? "BONDS_MIXED"
          : "BONDS_PRESSURE",

    authority: "ENGINE29_GROUPS_RATES_DURATION_PRIMARY",
    primarySource: "ENGINE29_GROUPS_RATES_DURATION",
    fallbackUsed: false,
    engine29RatesAuthorityAvailable: true,

    structural1wState: structuralState,
    tactical1hState: tacticalState,
    fast30mState: fastState,

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

    inputs: {
      engine29RatesDurationGroup: group,
      officialSlowMacroContext: {
        score: legacyBondMarket?.score ?? null,
        label: legacyBondMarket?.label ?? null,
        DGS10: legacyBondMarket?.inputs?.tenYear ?? null,
        DGS2: legacyBondMarket?.inputs?.twoYear ?? null,
        T10Y2Y: legacyBondMarket?.inputs?.tenMinusTwo ?? null,
        T10Y3M: legacyBondMarket?.inputs?.tenMinusThreeMonth ?? null,
      },
    },

    warnings,
  };
}

export default buildRatesAuthority;
