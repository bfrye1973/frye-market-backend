// Engine 25 Distribution Pressure v2
// 4H owns the canonical structural score.
// 1H owns tactical direction.
// 30m owns confirmation/transition.
// 10m owns acceleration warning.

export const ENGINE25_DISTRIBUTION_V2_SCHEMA = "engine25.distributionPressure.v2";

export const DISTRIBUTION_V2_CONFIG = Object.freeze({
  weights: Object.freeze({ volume: 0.35, breadth: 0.30, highLow: 0.20, sectors: 0.15 }),
  thresholds: Object.freeze({
    tacticalDelta: 8,
    confirmationDelta: 15,
    accelerationDelta: 15,
    extremeMin: 85,
  }),
  freshnessMs: Object.freeze({
    "10m": 15 * 60 * 1000,
    "30m": 60 * 60 * 1000,
    "1h": 90 * 60 * 1000,
    "4h": 300 * 60 * 1000,
  }),
  minCoveragePct: 70,
  maxHistoryPerTimeframe: 8,
});

const TF_KEYS = ["10m", "30m", "1h", "4h"];

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  const n = finite(value);
  if (n === null) return null;
  return Math.max(min, Math.min(max, n));
}

function round(value, places = 2) {
  const n = finite(value);
  if (n === null) return null;
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function canonicalSectorName(name) {
  const raw = String(name || "").trim().toLowerCase();
  if (["tech", "technology", "information technology"].includes(raw)) return "information technology";
  if (["healthcare", "health care"].includes(raw)) return "health care";
  return raw;
}

function dedupeSectorCards(cards = []) {
  const byName = new Map();
  for (const card of Array.isArray(cards) ? cards : []) {
    const key = canonicalSectorName(card?.sector);
    if (!key || byName.has(key)) continue;
    byName.set(key, card);
  }
  return [...byName.values()];
}

export function extractDistributionSourceTimestamp(payload) {
  return (
    payload?.sourceTimestamp ||
    payload?.updated_at_utc ||
    payload?.generated_at_utc ||
    payload?.meta?.ts_utc ||
    payload?.meta?.last_full_run_utc ||
    payload?.meta?.last_run_utc ||
    null
  );
}

function sectorState(card) {
  const breadth = finite(card?.breadth_pct);
  const momentum = finite(card?.momentum_pct);
  if (breadth === null || momentum === null) return "UNAVAILABLE";
  if (breadth >= 55 && momentum >= 55) return "STRONG";
  if (breadth <= 45 && momentum <= 45) return "WEAK";
  return "NEUTRAL";
}

export function classifyDistributionPressure(score) {
  const n = finite(score);
  if (n === null) return "UNAVAILABLE";
  if (n >= 85) return "EXTREME";
  if (n >= 70) return "HIGH";
  if (n >= 50) return "ELEVATED";
  if (n >= 25) return "WATCH";
  return "LOW";
}

export function buildDistributionTimeframeObservation({
  timeframe,
  payload,
  now = Date.now(),
} = {}) {
  const timestamp = extractDistributionSourceTimestamp(payload);
  const timestampMs = Date.parse(String(timestamp || ""));
  const ageMs = Number.isFinite(timestampMs) ? Math.max(0, Number(now) - timestampMs) : null;
  const maxAgeMs = DISTRIBUTION_V2_CONFIG.freshnessMs[timeframe] ?? null;

  const cards = dedupeSectorCards(payload?.sectorCards);
  let advancingStocks = 0;
  let decliningStocks = 0;
  let newHighs = 0;
  let newLows = 0;
  let advancingVolume = 0;
  let decliningVolume = 0;
  let unchangedVolume = 0;
  let stocksScanned = 0;
  let stocksWithVolume = 0;
  let strongSectorCount = 0;
  let neutralSectorCount = 0;
  let weakSectorCount = 0;
  let classifiedSectorCount = 0;

  for (const card of cards) {
    advancingStocks += Number(card?.up || 0);
    decliningStocks += Number(card?.down || 0);
    newHighs += Number(card?.nh || 0);
    newLows += Number(card?.nl || 0);
    advancingVolume += Number(card?.advancingVolume || 0);
    decliningVolume += Number(card?.decliningVolume || 0);
    unchangedVolume += Number(card?.unchangedVolume || 0);
    stocksScanned += Number(card?.stocksScanned || 0);
    stocksWithVolume += Number(card?.stocksWithVolume || 0);

    const state = sectorState(card);
    if (state === "STRONG") {
      strongSectorCount += 1;
      classifiedSectorCount += 1;
    } else if (state === "WEAK") {
      weakSectorCount += 1;
      classifiedSectorCount += 1;
    } else if (state === "NEUTRAL") {
      neutralSectorCount += 1;
      classifiedSectorCount += 1;
    }
  }

  const breadthDenominator = advancingStocks + decliningStocks;
  const directionalVolume = advancingVolume + decliningVolume;
  const highsLowsDenominator = newHighs + newLows;

  const advancingBreadthShare =
    breadthDenominator > 0 ? advancingStocks / breadthDenominator : null;
  const decliningVolumeShare =
    directionalVolume > 0 ? decliningVolume / directionalVolume : null;
  const advancingVolumeShare =
    directionalVolume > 0 ? advancingVolume / directionalVolume : null;
  const newLowShare =
    highsLowsDenominator > 0 ? newLows / highsLowsDenominator : null;
  const coveragePct =
    stocksScanned > 0 ? (stocksWithVolume / stocksScanned) * 100 : null;

  const breadthPressure =
    advancingBreadthShare === null
      ? null
      : clamp(((0.60 - advancingBreadthShare) / 0.20) * 100);
  const volumePressure =
    decliningVolumeShare === null
      ? null
      : clamp(((decliningVolumeShare - 0.50) / 0.20) * 100);
  const highLowPressure =
    newLowShare === null
      ? null
      : clamp(((newLowShare - 0.50) / 0.20) * 100);
  const sectorPressure =
    classifiedSectorCount === 11 ? (weakSectorCount / 11) * 100 : null;

  const completeCanonicalSet =
    cards.length === 11 &&
    classifiedSectorCount === 11 &&
    breadthPressure !== null &&
    volumePressure !== null &&
    highLowPressure !== null &&
    sectorPressure !== null;

  const coverageValid =
    coveragePct !== null && coveragePct >= DISTRIBUTION_V2_CONFIG.minCoveragePct;

  const fresh =
    Boolean(timestamp) &&
    Number.isFinite(ageMs) &&
    Number.isFinite(maxAgeMs) &&
    ageMs <= maxAgeMs;

  const available = completeCanonicalSet && coverageValid && fresh;

  const pressure = available
    ? volumePressure * DISTRIBUTION_V2_CONFIG.weights.volume +
      breadthPressure * DISTRIBUTION_V2_CONFIG.weights.breadth +
      highLowPressure * DISTRIBUTION_V2_CONFIG.weights.highLow +
      sectorPressure * DISTRIBUTION_V2_CONFIG.weights.sectors
    : null;

  return {
    timeframe,
    sourceTimestamp: timestamp,
    ageMs,
    maxAgeMs,
    freshnessState: !timestamp ? "UNAVAILABLE" : fresh ? "FRESH" : "STALE",
    available,
    completeCanonicalSet,
    coverageValid,
    stocksScanned,
    stocksWithVolume,
    coveragePct: round(coveragePct),
    advancingStocks,
    decliningStocks,
    advancingBreadthPct: round(
      advancingBreadthShare === null ? null : advancingBreadthShare * 100
    ),
    newHighs,
    newLows,
    netNewHighsLows: newHighs - newLows,
    newLowSharePct: round(newLowShare === null ? null : newLowShare * 100),
    advancingVolume: round(advancingVolume, 3),
    decliningVolume: round(decliningVolume, 3),
    unchangedVolume: round(unchangedVolume, 3),
    advancingVolumeSharePct: round(
      advancingVolumeShare === null ? null : advancingVolumeShare * 100
    ),
    decliningVolumeSharePct: round(
      decliningVolumeShare === null ? null : decliningVolumeShare * 100
    ),
    strongSectorCount,
    neutralSectorCount,
    weakSectorCount,
    components: {
      volumePressure: round(volumePressure),
      breadthPressure: round(breadthPressure),
      highLowPressure: round(highLowPressure),
      sectorPressure: round(sectorPressure),
    },
    pressure: round(pressure),
    label: classifyDistributionPressure(pressure),
    reason: !completeCanonicalSet
      ? "INCOMPLETE_CANONICAL_EVIDENCE"
      : !coverageValid
        ? "VOLUME_COVERAGE_BELOW_70_PERCENT"
        : !fresh
          ? "SOURCE_STALE"
          : null,
  };
}

function priorRows(previous, timeframe) {
  return (Array.isArray(previous?.history?.[timeframe]) ? previous.history[timeframe] : [])
    .filter((row) => row?.sourceTimestamp && finite(row?.pressure) !== null);
}

function mergeHistory(previous, observations) {
  const history = {};
  for (const timeframe of TF_KEYS) {
    const rows = [...priorRows(previous, timeframe)];
    const current = observations[timeframe];
    if (current?.available && current?.sourceTimestamp && current?.pressure !== null) {
      if (!rows.some((row) => row.sourceTimestamp === current.sourceTimestamp)) {
        rows.push({
          sourceTimestamp: current.sourceTimestamp,
          pressure: current.pressure,
          label: current.label,
        });
      }
    }
    rows.sort((a, b) => String(a.sourceTimestamp).localeCompare(String(b.sourceTimestamp)));
    history[timeframe] = rows.slice(-DISTRIBUTION_V2_CONFIG.maxHistoryPerTimeframe);
  }
  return history;
}

function lastTwo(history, timeframe) {
  return (history?.[timeframe] || []).slice(-2);
}

function oneHourTrend(history, observation) {
  if (!observation?.available) return { state: "UNAVAILABLE", confirmed: false };
  const rows = lastTwo(history, "1h");
  if (rows.length < 2) return { state: "PENDING", confirmed: false, sourceTimestamp: observation.sourceTimestamp };

  const delta = round(rows[1].pressure - rows[0].pressure);
  const threshold = DISTRIBUTION_V2_CONFIG.thresholds.tacticalDelta;
  return {
    state: delta >= threshold ? "RISING" : delta <= -threshold ? "EASING" : "STABLE",
    confirmed: true,
    delta,
    previousPressure: rows[0].pressure,
    currentPressure: rows[1].pressure,
    previousSourceTimestamp: rows[0].sourceTimestamp,
    sourceTimestamp: rows[1].sourceTimestamp,
  };
}

function thirtySignal(pressure, structuralPressure) {
  const p = finite(pressure);
  const s = finite(structuralPressure);
  if (p === null || s === null) return "UNAVAILABLE";
  const delta = p - s;
  const threshold = DISTRIBUTION_V2_CONFIG.thresholds.confirmationDelta;
  if (delta >= threshold) return "SELLING_PRESSURE";
  if (delta <= -threshold) return "BUYING_RECOVERY";
  return "NO_MATERIAL_CHANGE";
}

function thirtyConfirmation(history, observation, structuralPressure) {
  if (!observation?.available) return { state: "UNAVAILABLE", confirmed: false };
  const rows = lastTwo(history, "30m");
  const currentSignal = thirtySignal(observation.pressure, structuralPressure);
  if (rows.length < 2) {
    return {
      state: currentSignal === "NO_MATERIAL_CHANGE" ? currentSignal : currentSignal + "_PENDING",
      confirmed: false,
      rawSignal: currentSignal,
      sourceTimestamp: observation.sourceTimestamp,
    };
  }
  const previousSignal = thirtySignal(rows[0].pressure, structuralPressure);
  const latestSignal = thirtySignal(rows[1].pressure, structuralPressure);
  const confirmed = latestSignal !== "NO_MATERIAL_CHANGE" && previousSignal === latestSignal;
  return {
    state: confirmed
      ? latestSignal + "_CONFIRMED"
      : latestSignal === "NO_MATERIAL_CHANGE"
        ? latestSignal
        : latestSignal + "_PENDING",
    confirmed,
    rawSignal: latestSignal,
    previousSignal,
    previousPressure: rows[0].pressure,
    currentPressure: rows[1].pressure,
    previousSourceTimestamp: rows[0].sourceTimestamp,
    sourceTimestamp: rows[1].sourceTimestamp,
  };
}

function tenAcceleration(history, observation, thirtyMinuteObservation) {
  if (!observation?.available || !thirtyMinuteObservation?.available) {
    return { state: "UNAVAILABLE", confirmed: false };
  }

  const signalFor = (pressure) => {
    const delta = Number(pressure) - Number(thirtyMinuteObservation.pressure);
    const threshold = DISTRIBUTION_V2_CONFIG.thresholds.accelerationDelta;
    if (delta >= threshold) return "FAST_SELLING_ACCELERATION";
    if (delta <= -threshold) return "FAST_BUYING_RECOVERY";
    return "NONE";
  };

  const rows = lastTwo(history, "10m");
  const currentSignal = signalFor(observation.pressure);
  if (rows.length < 2) {
    return {
      state: currentSignal === "NONE" ? "NONE" : currentSignal + "_PENDING",
      confirmed: false,
      rawSignal: currentSignal,
      sourceTimestamp: observation.sourceTimestamp,
    };
  }

  const previousSignal = signalFor(rows[0].pressure);
  const latestSignal = signalFor(rows[1].pressure);
  const confirmed = latestSignal !== "NONE" && previousSignal === latestSignal;
  return {
    state: confirmed
      ? latestSignal + "_CONFIRMED"
      : latestSignal === "NONE"
        ? "NONE"
        : latestSignal + "_PENDING",
    confirmed,
    rawSignal: latestSignal,
    previousSignal,
    previousPressure: rows[0].pressure,
    currentPressure: rows[1].pressure,
    previousSourceTimestamp: rows[0].sourceTimestamp,
    sourceTimestamp: rows[1].sourceTimestamp,
  };
}

function structuralPersistence(history, observation) {
  if (!observation?.available) return { state: "UNAVAILABLE", confirmed: false };

  const severeComponentCount = Object.values(observation.components || {})
    .map(finite)
    .filter((value) => value !== null && value >= 70).length;

  if (observation.pressure >= 85 && severeComponentCount >= 3) {
    return { state: "IMMEDIATE_CONFIRMED", confirmed: true, severeComponentCount };
  }

  if (!["HIGH", "EXTREME"].includes(observation.label)) {
    return { state: "NOT_REQUIRED", confirmed: true, severeComponentCount };
  }

  const rows = lastTwo(history, "4h");
  if (rows.length < 2) {
    return { state: "PENDING_CONFIRMATION", confirmed: false, severeComponentCount };
  }

  const confirmed = Number(rows[0].pressure) >= 70 && Number(rows[1].pressure) >= 70;
  return {
    state: confirmed ? "CONFIRMED" : "PENDING_CONFIRMATION",
    confirmed,
    severeComponentCount,
    previousPressure: rows[0].pressure,
    currentPressure: rows[1].pressure,
  };
}

function integratedState(structural, tactical, confirmation, acceleration) {
  if (!structural?.available) return "UNAVAILABLE";
  if (tactical?.state === "RISING" && confirmation?.state === "SELLING_PRESSURE_CONFIRMED") {
    return "DETERIORATING";
  }
  if (tactical?.state === "EASING" && confirmation?.state === "BUYING_RECOVERY_CONFIRMED") {
    return "REPAIRING";
  }
  if (acceleration?.state === "FAST_SELLING_ACCELERATION_CONFIRMED") {
    return "FAST_SELLING_WARNING";
  }
  if (acceleration?.state === "FAST_BUYING_RECOVERY_CONFIRMED") {
    return "FAST_BUYING_RECOVERY";
  }
  return "HOLDING";
}

export function buildEngine25DistributionPressureV2({
  intraday,
  thirtyMinute,
  hourly,
  fourHour,
  previous = null,
  now = Date.now(),
} = {}) {
  const observations = {
    "10m": buildDistributionTimeframeObservation({ timeframe: "10m", payload: intraday, now }),
    "30m": buildDistributionTimeframeObservation({ timeframe: "30m", payload: thirtyMinute, now }),
    "1h": buildDistributionTimeframeObservation({ timeframe: "1h", payload: hourly, now }),
    "4h": buildDistributionTimeframeObservation({ timeframe: "4h", payload: fourHour, now }),
  };

  const history = mergeHistory(previous, observations);
  const structural4h = observations["4h"];
  const trend = oneHourTrend(history, observations["1h"]);
  const confirmation = thirtyConfirmation(history, observations["30m"], structural4h?.pressure);
  const acceleration = tenAcceleration(history, observations["10m"], observations["30m"]);
  const persistence = structuralPersistence(history, structural4h);
  const state = integratedState(structural4h, trend, confirmation, acceleration);

  const rawPressure = structural4h?.available ? structural4h.pressure : null;
  const score = rawPressure === null ? null : round(100 - rawPressure);
  const pressureLabel = classifyDistributionPressure(rawPressure);

  return {
    schema: ENGINE25_DISTRIBUTION_V2_SCHEMA,
    engine: "engine25.distributionPressure.v2",
    generatedAt: new Date(now).toISOString(),
    authority: {
      owner: "ENGINE25",
      canonicalScoreTimeframe: "4h",
      oneHourRole: "TACTICAL_DIRECTION",
      thirtyMinuteRole: "CONFIRMATION_TRANSITION",
      tenMinuteRole: "ACCELERATION_WARNING",
      tradingAuthorityChanged: false,
    },
    config: DISTRIBUTION_V2_CONFIG,
    available: structural4h?.available === true,
    rawPressure,
    score,
    label: rawPressure === null ? "DISTRIBUTION_PRESSURE_UNAVAILABLE" : "DISTRIBUTION_PRESSURE_" + pressureLabel,
    pressureLabel,
    integratedState: state,
    persistence,
    structural4h,
    tactical1h: { ...observations["1h"], trend },
    confirmation30m: { ...observations["30m"], confirmation },
    acceleration10m: { ...observations["10m"], acceleration },
    observations,
    history,
  };
}

export default buildEngine25DistributionPressureV2;
