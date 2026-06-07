// services/core/jobs/buildEngine25ZoneClassification.js
//
// Engine 25G — Zone Classification v0.1
//
// Purpose:
// Classify the current ES zone as accumulation, distribution, decision zone,
// support-at-risk, or confirmed reclaim context.
//
// Ownership rules:
// - Engine 1 owns raw zones / shelves.
// - Engine 3 owns price reaction.
// - Engine 4 owns volume participation; true volume-in-zone is not available yet.
// - Engine 25 classifies accumulation/distribution quality using market health,
//   sector breadth, distribution pressure, and the zone-aware read.
// - Engine 6 remains final trade permission referee.
//
// Reads:
//   data/engine25-es-zone-aware-read.json
//   data/engine25-sector-card-breadth-snapshots.json
//   data/engine25-market-health.json
//   data/engine25-historical-distribution-pressure-6mo.json
//   data/engine25-historical-breadth-participation-6mo.json
//
// Writes:
//   data/engine25-zone-classification.json

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const ZONE_READ_FILE = path.join(DATA_DIR, "engine25-es-zone-aware-read.json");
const SECTOR_BREADTH_FILE = path.join(
  DATA_DIR,
  "engine25-sector-card-breadth-snapshots.json"
);
const MARKET_HEALTH_FILE = path.join(DATA_DIR, "engine25-market-health.json");
const DISTRIBUTION_FILE = path.join(
  DATA_DIR,
  "engine25-historical-distribution-pressure-6mo.json"
);
const BREADTH_FILE = path.join(
  DATA_DIR,
  "engine25-historical-breadth-participation-6mo.json"
);

const OUTPUT_FILE = path.join(DATA_DIR, "engine25-zone-classification.json");

const ENGINE_NAME = "engine25.zoneClassification.v0.1";

function nowUtcIso() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJsonOptional(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      error: `Failed reading ${path.basename(filePath)}: ${err.message}`,
    };
  }
}

function latestRow(payload) {
  if (Array.isArray(payload?.rows) && payload.rows.length) {
    return payload.rows[payload.rows.length - 1];
  }

  if (Array.isArray(payload) && payload.length) {
    return payload[payload.length - 1];
  }

  return null;
}

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, lo = 0, hi = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

function addScore(read, points, code, note = null) {
  if (!Number.isFinite(points) || points === 0) return;

  read.scoreRaw += points;
  read.reasonCodes.push(code);

  if (note) {
    read.notes.push(note);
  }
}

function labelIncludes(value, token) {
  return String(value || "").toUpperCase().includes(String(token || "").toUpperCase());
}

function isEngine3Constructive(state) {
  return [
    "HELD_ACCUMULATION",
    "DEFENDING_LOWER_ZONE",
    "BREAKING_ABOVE_NEGOTIATED_VALUE",
    "BREAKING_ABOVE_DISTRIBUTION",
    "ACCEPTING_VALUE",
  ].includes(String(state || "").toUpperCase());
}

function isEngine3Risk(state) {
  return [
    "REJECTING_UPPER_ZONE",
    "REJECTED_FROM_DISTRIBUTION",
    "BREAKING_BELOW_NEGOTIATED_VALUE",
    "BREAKING_BELOW_ACCUMULATION",
    "BELOW_INSTITUTIONAL_ZONE",
  ].includes(String(state || "").toUpperCase());
}

function buildInputs({ zoneRead, sectorBreadth, marketHealth, distributionRow, breadthRow }) {
  const zs = zoneRead?.zoneState || {};
  const latestSector = sectorBreadth?.latest || null;
  const combinedSector = sectorBreadth?.latest?.combinedRead || sectorBreadth?.combinedRead || null;
  const tactical1h = sectorBreadth?.latest?.tactical1h || sectorBreadth?.tactical1h || null;
  const regime4h = sectorBreadth?.latest?.regime4h || sectorBreadth?.regime4h || null;

  const engine3 =
    zs.engine3Reaction ||
    zoneRead?.engine3Reaction ||
    {};

  const engine4 =
    zs.engine4VolumeContext ||
    zoneRead?.engine4VolumeContext ||
    {};

  const intraday =
    marketHealth?.intradayProxyDamage ||
    marketHealth?.intradayProxyDamage?.intradayProxyDamage ||
    null;

  const distributionPressure =
    zoneRead?.context?.distributionPressure ||
    distributionRow?.distributionPressure ||
    null;

  const breadthParticipation =
    zoneRead?.context?.breadthParticipation ||
    breadthRow?.breadthParticipation ||
    null;

  return {
    price: zoneRead?.current?.price ?? null,
    nearestZone: zoneRead?.nearestZone || null,
    nearestShelf: zoneRead?.nearestShelf || null,

    zoneState: zs,
    zoneStateName: zs.state || null,
    zonePermission: zs.permission || null,

    belowInstitutional: zs.belowInstitutional === true,
    insideInstitutional: zs.insideInstitutional === true,
    insideNegotiated: zs.insideNegotiated === true,
    aboveInstitutional: zs.aboveInstitutional === true,
    secondaryShelfDefense: zs.secondaryShelfDefense?.value === true,
    accumulationWatch: zs.accumulationWatch?.value === true,
    failedReclaim: zs.failedReclaim?.value === true,
    weakClose: zs.weakClose?.value === true,
    highVolumeRejection: zs.highVolumeRejection?.value === true,
    zoneAwareVolumeAvailable: zs.zoneAwareVolumeAvailable === true,

    reclaimLevels: {
      institutionalFloor: zs.failureInstitutional ?? null,
      negotiatedHigh: zs.reclaimNegotiated ?? null,
      institutionalHigh: zs.reclaimInstitutional ?? null,
    },

    engine3State: engine3.state || null,
    engine3Bias: engine3.bias || null,
    engine3Quality: engine3.quality || null,
    engine3QualityScore: safeNumber(engine3.qualityScore),
    engine3ZoneType: engine3.zoneType || null,
    engine3ZoneSource: engine3.zoneSource || null,

    engine4ParticipationState: engine4.participationState || null,
    engine4ParticipationQuality: engine4.participationQuality || null,
    engine4VolumeConfirmed: engine4.volumeConfirmed === true,
    engine4VolumeScore: safeNumber(engine4.volumeScore),
    engine4RelativeVolume: safeNumber(engine4.relativeVolume),

    intradayLabel: intraday?.label || null,
    intradayScore: safeNumber(intraday?.score),

    sectorLatestSnapshotDate:
      sectorBreadth?.latestSnapshotDate ||
      latestSector?.date ||
      null,
    sectorCombinedLabel: combinedSector?.label || null,
    sectorCombinedScore: safeNumber(combinedSector?.score),
    sectorPermissionImpact: combinedSector?.permissionImpact || null,
    sectorTacticalLabel: tactical1h?.classification?.label || null,
    sectorTacticalScore: safeNumber(tactical1h?.classification?.score),
    sectorRegimeLabel: regime4h?.classification?.label || null,
    sectorRegimeScore: safeNumber(regime4h?.classification?.score),
    sector1hNh: safeNumber(tactical1h?.summary?.totalNh),
    sector1hNl: safeNumber(tactical1h?.summary?.totalNl),
    sector1hWeakSectors: safeNumber(tactical1h?.summary?.sectorsWeak),
    sector4hRiskOnPct: safeNumber(regime4h?.summary?.riskOnBreadthPct),

    distributionLabel: distributionPressure?.label || null,
    distributionScore: safeNumber(distributionPressure?.score),

    breadthLabel: breadthParticipation?.label || null,
    breadthScore: safeNumber(breadthParticipation?.score),
  };
}

function scoreAccumulation(inputs) {
  const read = {
    active: false,
    scoreRaw: 0,
    score: 0,
    state: "NO_CONFIRMED_ACCUMULATION",
    label: "Accumulation not confirmed",
    reasonCodes: [],
    notes: [],
  };

  if (isEngine3Constructive(inputs.engine3State)) {
    addScore(read, 20, `ENGINE3_CONSTRUCTIVE_${inputs.engine3State}`);
  }

  if (inputs.engine3Bias && labelIncludes(inputs.engine3Bias, "BULL")) {
    addScore(read, 8, "ENGINE3_BULLISH_REACTION_BIAS");
  }

  if (inputs.engine3QualityScore >= 70) {
    addScore(read, 8, "ENGINE3_REACTION_QUALITY_GOOD");
  }

  if (inputs.accumulationWatch) {
    addScore(read, 14, "ZONE_AWARE_ACCUMULATION_WATCH");
  }

  if (inputs.secondaryShelfDefense) {
    addScore(
      read,
      8,
      "SECONDARY_AUTO_SHELF_DEFENSE",
      "Auto shelf defense is useful, but it does not override manual institutional zone priority."
    );
  }

  if (inputs.insideInstitutional || inputs.insideNegotiated) {
    addScore(read, 14, "PRICE_INSIDE_MANUAL_VALUE_ZONE");
  }

  if (inputs.engine4VolumeConfirmed) {
    addScore(read, 10, "ENGINE4_GENERAL_VOLUME_CONFIRMED");
  }

  if (labelIncludes(inputs.engine4ParticipationState, "ABSORPTION")) {
    addScore(read, 10, "ENGINE4_GENERAL_ABSORPTION_CONTEXT");
  }

  if (
    labelIncludes(inputs.sectorCombinedLabel, "EXPANDING") ||
    labelIncludes(inputs.sectorCombinedLabel, "SUPPORTIVE") ||
    labelIncludes(inputs.sectorPermissionImpact, "SUPPORTIVE")
  ) {
    addScore(read, 18, "SECTOR_BREADTH_SUPPORTIVE");
  }

  if (
    labelIncludes(inputs.sectorTacticalLabel, "EXPANDING") ||
    labelIncludes(inputs.sectorTacticalLabel, "RISK_ON")
  ) {
    addScore(read, 12, "TACTICAL_1H_SECTOR_BREADTH_IMPROVING");
  }

  if (
    Number.isFinite(inputs.distributionScore) &&
    inputs.distributionScore < 45
  ) {
    addScore(read, 10, "DISTRIBUTION_PRESSURE_NOT_ELEVATED");
  }

  if (
    Number.isFinite(inputs.breadthScore) &&
    inputs.breadthScore >= 50
  ) {
    addScore(read, 8, "BREADTH_PARTICIPATION_NOT_WEAK");
  }

  if (inputs.belowInstitutional) {
    addScore(
      read,
      -25,
      "MANUAL_INSTITUTIONAL_SUPPORT_LOST",
      "Accumulation cannot be confirmed while ES remains below the manual institutional zone."
    );
  }

  if (labelIncludes(inputs.intradayLabel, "DISTRIBUTION_ACTIVE")) {
    addScore(read, -25, "INTRADAY_DISTRIBUTION_ACTIVE");
  }

  if (
    labelIncludes(inputs.sectorCombinedLabel, "WEAK") ||
    labelIncludes(inputs.sectorPermissionImpact, "NO_BLIND")
  ) {
    addScore(read, -20, "SECTOR_BREADTH_WEAK");
  }

  if (
    Number.isFinite(inputs.distributionScore) &&
    inputs.distributionScore >= 60
  ) {
    addScore(read, -14, "DISTRIBUTION_PRESSURE_ELEVATED");
  }

  if (inputs.weakClose) {
    addScore(read, -10, "WEAK_CLOSE_PRESENT");
  }

  read.score = round2(clamp(read.scoreRaw));

  if (read.score >= 70 && !inputs.belowInstitutional) {
    read.active = true;
    read.state = "ACCUMULATION_BUILDING";
    read.label = "Accumulation building";
  } else if (read.score >= 50 && !inputs.belowInstitutional) {
    read.active = true;
    read.state = "ACCUMULATION_RECLAIM_WATCH";
    read.label = "Accumulation reclaim watch";
  } else if (inputs.secondaryShelfDefense && inputs.belowInstitutional) {
    read.active = false;
    read.state = "SECONDARY_SHELF_DEFENSE_ONLY";
    read.label = "Shelf defense only — accumulation not confirmed";
  }

  return read;
}

function scoreDistribution(inputs) {
  const read = {
    active: false,
    scoreRaw: 0,
    score: 0,
    state: "NO_CONFIRMED_DISTRIBUTION",
    label: "Distribution not confirmed",
    reasonCodes: [],
    notes: [],
  };

  if (
    inputs.zoneStateName === "INSTITUTIONAL_SUPPORT_AT_RISK" ||
    inputs.zoneStateName === "FAILED_RECLAIM_WEAK_CLOSE" ||
    inputs.zoneStateName === "DISTRIBUTION_REJECTION_AT_NEGOTIATED_ZONE"
  ) {
    addScore(read, 22, `ZONE_STATE_${inputs.zoneStateName}`);
  }

  if (inputs.belowInstitutional) {
    addScore(read, 18, "PRICE_BELOW_MANUAL_INSTITUTIONAL_ZONE");
  }

  if (isEngine3Risk(inputs.engine3State)) {
    addScore(read, 18, `ENGINE3_RISK_REACTION_${inputs.engine3State}`);
  }

  if (inputs.failedReclaim) {
    addScore(read, 15, "FAILED_RECLAIM_PROVISIONAL");
  }

  if (inputs.weakClose) {
    addScore(read, 12, "WEAK_CLOSE_PROVISIONAL");
  }

  if (inputs.highVolumeRejection) {
    addScore(read, 12, "HIGH_VOLUME_REJECTION_PROVISIONAL");
  }

  if (labelIncludes(inputs.intradayLabel, "DISTRIBUTION_ACTIVE")) {
    addScore(read, 18, "INTRADAY_DISTRIBUTION_ACTIVE");
  }

  if (
    labelIncludes(inputs.sectorCombinedLabel, "WEAK") ||
    labelIncludes(inputs.sectorPermissionImpact, "NO_BLIND")
  ) {
    addScore(read, 18, "SECTOR_BREADTH_WEAK_TACTICAL_AND_REGIME");
  }

  if (labelIncludes(inputs.sectorTacticalLabel, "WEAK")) {
    addScore(read, 8, "TACTICAL_1H_SECTOR_BREADTH_WEAK");
  }

  if (
    labelIncludes(inputs.sectorRegimeLabel, "WEAK") ||
    labelIncludes(inputs.sectorRegimeLabel, "RISK_OFF")
  ) {
    addScore(read, 8, "REGIME_4H_SECTOR_BREADTH_WEAK");
  }

  if (
    Number.isFinite(inputs.distributionScore) &&
    inputs.distributionScore >= 60
  ) {
    addScore(read, 12, "DISTRIBUTION_PRESSURE_ELEVATED");
  }

  if (
    Number.isFinite(inputs.breadthScore) &&
    inputs.breadthScore < 40
  ) {
    addScore(read, 10, "BREADTH_PARTICIPATION_WEAK");
  }

  if (labelIncludes(inputs.engine4ParticipationState, "WEAK")) {
    addScore(read, 6, "ENGINE4_GENERAL_VOLUME_WEAK_PARTICIPATION");
  }

  if (inputs.accumulationWatch && !inputs.belowInstitutional) {
    addScore(read, -12, "ACCUMULATION_WATCH_REDUCES_DISTRIBUTION_SCORE");
  }

  if (inputs.engine4VolumeConfirmed && isEngine3Constructive(inputs.engine3State)) {
    addScore(read, -8, "ENGINE3_AND_ENGINE4_SUPPORTIVE_CONTEXT");
  }

  read.score = round2(clamp(read.scoreRaw));

  if (read.score >= 75) {
    read.active = true;
    read.state = "DISTRIBUTION_ACTIVE_AT_ZONE";
    read.label = "Distribution active at zone";
  } else if (read.score >= 60) {
    read.active = true;
    read.state = "DISTRIBUTION_PRESSURE_ACTIVE_AT_ZONE";
    read.label = "Distribution pressure active at zone";
  } else if (read.score >= 45) {
    read.active = false;
    read.state = "DISTRIBUTION_REJECTION_WATCH";
    read.label = "Distribution rejection watch";
  }

  return read;
}

function buildFinalClassification({ inputs, accumulationRead, distributionRead }) {
  const requiredConfirmation = [];

  const reclaim = inputs.reclaimLevels || {};

  if (reclaim.institutionalFloor !== null && reclaim.institutionalFloor !== undefined) {
    requiredConfirmation.push({
      label: "Reclaim institutional floor",
      level: reclaim.institutionalFloor,
      reason: "First repair after losing manual institutional support.",
    });
  }

  if (reclaim.negotiatedHigh !== null && reclaim.negotiatedHigh !== undefined) {
    requiredConfirmation.push({
      label: "Reclaim negotiated value",
      level: reclaim.negotiatedHigh,
      reason: "Shows value acceptance returning.",
    });
  }

  if (reclaim.institutionalHigh !== null && reclaim.institutionalHigh !== undefined) {
    requiredConfirmation.push({
      label: "Reclaim institutional high",
      level: reclaim.institutionalHigh,
      reason: "Stronger confirmation above the full manual institutional zone.",
    });
  }

  requiredConfirmation.push({
    label: "Sector breadth repair",
    level: null,
    reason: "1H tactical sector breadth should stop weakening and preferably improve.",
  });

  requiredConfirmation.push({
    label: "Engine 6 final permission",
    level: null,
    reason: "Engine 25 is context only. Engine 6 remains final trade referee.",
  });

  const spread = round2(distributionRead.score - accumulationRead.score);

  let state = "DECISION_ZONE_NO_CONFIRMATION";
  let label = "Decision zone — no confirmed accumulation or distribution";
  let permissionImpact = "WATCH_ONLY";
  let tone = "neutral";

  if (inputs.zoneStateName === "INSTITUTIONAL_SUPPORT_AT_RISK" && distributionRead.score >= 55) {
    state = "INSTITUTIONAL_SUPPORT_AT_RISK";
    label = "Support at risk — distribution pressure active";
    permissionImpact = "NO_BLIND_LONGS_OR_A_PLUS_RECLAIM_ONLY";
    tone = "defensive";
  } else if (distributionRead.score >= 75 && distributionRead.score >= accumulationRead.score + 15) {
    state = "DISTRIBUTION_ACTIVE";
    label = "Distribution active";
    permissionImpact = "NO_NORMAL_LONGS";
    tone = "defensive";
  } else if (distributionRead.score >= 60 && distributionRead.score >= accumulationRead.score + 8) {
    state = "DISTRIBUTION_PRESSURE_ACTIVE";
    label = "Distribution pressure active";
    permissionImpact = "NO_BLIND_LONGS_OR_A_PLUS_ONLY";
    tone = "defensive";
  } else if (accumulationRead.score >= 70 && accumulationRead.score >= distributionRead.score + 15) {
    state = "ACCUMULATION_BUILDING";
    label = "Accumulation building";
    permissionImpact = "A_PLUS_RECLAIM_ONLY";
    tone = "constructive_watch";
  } else if (accumulationRead.score >= 50 && accumulationRead.score >= distributionRead.score) {
    state = "ACCUMULATION_RECLAIM_WATCH";
    label = "Accumulation reclaim watch";
    permissionImpact = "A_PLUS_RECLAIM_ONLY";
    tone = "watch";
  } else if (inputs.secondaryShelfDefense && inputs.belowInstitutional) {
    state = "SECONDARY_SHELF_DEFENSE_SUPPORT_AT_RISK";
    label = "Secondary shelf defense, but manual support is at risk";
    permissionImpact = "NO_BLIND_LONGS_UNTIL_MANUAL_ZONE_RECLAIM";
    tone = "defensive";
  } else if (Math.abs(distributionRead.score - accumulationRead.score) <= 10) {
    state = "MIXED_DECISION_ZONE";
    label = "Mixed decision zone";
    permissionImpact = "WAIT_FOR_CONFIRMATION";
    tone = "mixed";
  }

  return {
    state,
    label,
    permissionImpact,
    tone,
    accumulationScore: accumulationRead.score,
    distributionScore: distributionRead.score,
    distributionMinusAccumulationSpread: spread,
    confidence:
      Math.abs(spread) >= 25
        ? "HIGH"
        : Math.abs(spread) >= 12
          ? "MEDIUM"
          : "LOW",
    requiredConfirmation,
  };
}

async function main() {
  const startedAt = nowUtcIso();

  const outputBase = {
    ok: false,
    engine: ENGINE_NAME,
    modelType: "ENGINE25_ZONE_ACCUMULATION_DISTRIBUTION_CLASSIFIER",
    symbol: "ES",
    startedAt,
    finishedAt: null,
    generatedAtUtc: null,
    liveOnly: true,
    historicalZoneClassificationEnabled: false,
    historicalDisabledReason:
      "NO_HISTORICAL_ES_ZONE_SNAPSHOTS_OR_SECTOR_CARD_SNAPSHOTS",
    source: {
      zoneReadFile: "engine25-es-zone-aware-read.json",
      sectorBreadthFile: "engine25-sector-card-breadth-snapshots.json",
      marketHealthFile: "engine25-market-health.json",
      distributionFile: "engine25-historical-distribution-pressure-6mo.json",
      breadthFile: "engine25-historical-breadth-participation-6mo.json",
      outputFile: "engine25-zone-classification.json",
    },
    ownership: {
      engine1: "zones / shelves",
      engine3: "price reaction",
      engine4: "general ES volume participation; true zone volume not available yet",
      engine25: "accumulation/distribution classifier using market health context",
      engine6: "final permission referee",
    },
    inputs: null,
    accumulationRead: null,
    distributionRead: null,
    finalZoneClassification: null,
    plainEnglish: null,
    errors: [],
  };

  try {
    const zoneRead = readJsonOptional(ZONE_READ_FILE);
    const sectorBreadth = readJsonOptional(SECTOR_BREADTH_FILE);
    const marketHealth = readJsonOptional(MARKET_HEALTH_FILE);
    const distributionPayload = readJsonOptional(DISTRIBUTION_FILE);
    const breadthPayload = readJsonOptional(BREADTH_FILE);

    if (!zoneRead?.ok) {
      throw new Error("Missing or invalid engine25-es-zone-aware-read.json");
    }

    const distributionRow = latestRow(distributionPayload);
    const breadthRow = latestRow(breadthPayload);

    const inputs = buildInputs({
      zoneRead,
      sectorBreadth,
      marketHealth,
      distributionRow,
      breadthRow,
    });

    const accumulationRead = scoreAccumulation(inputs);
    const distributionRead = scoreDistribution(inputs);
    const finalZoneClassification = buildFinalClassification({
      inputs,
      accumulationRead,
      distributionRead,
    });

    const plainEnglish = [
      `Engine 25 classifies the current ES zone as: ${finalZoneClassification.label}.`,
      `Accumulation score ${accumulationRead.score}; distribution score ${distributionRead.score}.`,
      inputs.secondaryShelfDefense
        ? "Engine 3 sees secondary auto-shelf defense, but manual institutional zone priority still controls."
        : null,
      inputs.belowInstitutional
        ? "ES is below the manual institutional zone, so accumulation is not confirmed."
        : null,
      inputs.sectorCombinedLabel
        ? `Sector breadth: ${inputs.sectorCombinedLabel} with impact ${inputs.sectorPermissionImpact || "unknown"}.`
        : null,
      inputs.intradayLabel
        ? `Intraday layer: ${inputs.intradayLabel}.`
        : null,
      `Permission impact: ${finalZoneClassification.permissionImpact}.`,
      "Engine 6 remains the final trade permission referee.",
    ]
      .filter(Boolean)
      .join(" ");

    const output = {
      ...outputBase,
      ok: true,
      finishedAt: nowUtcIso(),
      generatedAtUtc: nowUtcIso(),
      inputs,
      accumulationRead,
      distributionRead,
      finalZoneClassification,
      plainEnglish,
    };

    ensureDir(OUTPUT_FILE);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("========================================");
    console.log("Engine 25 Zone Classification Complete");
    console.log("OK:", output.ok);
    console.log("State:", finalZoneClassification.state);
    console.log("Label:", finalZoneClassification.label);
    console.log("Accumulation:", accumulationRead.score, accumulationRead.state);
    console.log("Distribution:", distributionRead.score, distributionRead.state);
    console.log("Impact:", finalZoneClassification.permissionImpact);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          price: inputs.price,
          state: finalZoneClassification.state,
          label: finalZoneClassification.label,
          permissionImpact: finalZoneClassification.permissionImpact,
          accumulationRead,
          distributionRead,
          finalZoneClassification,
          plainEnglish,
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );
  } catch (err) {
    const output = {
      ...outputBase,
      ok: false,
      finishedAt: nowUtcIso(),
      generatedAtUtc: nowUtcIso(),
      errors: [
        {
          message: err.message,
          stack: err.stack,
        },
      ],
    };

    ensureDir(OUTPUT_FILE);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.error("Engine 25 Zone Classification Failed:");
    console.error(err);
    process.exit(1);
  }
}

main();
