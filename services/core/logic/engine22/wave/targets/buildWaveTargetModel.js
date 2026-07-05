// services/core/logic/engine22/wave/targets/buildWaveTargetModel.js
// Engine 22 — Generated Wave Target Model
//
// Purpose:
// Generate extension and retracement ladders from structural Elliott marks.
//
// This is structural display context only.
// It does NOT create trade permission.
// It does NOT create Engine 6 allow.
// It does NOT change Engine 15 readiness.
// It does NOT call Engine 8 / execution.

const EXTENSION_FIBS = [
  { label: "1.000", key: "e100", value: 1.0 },
  { label: "1.272", key: "e1272", value: 1.272 },
  { label: "1.618", key: "e1618", value: 1.618 },
  { label: "2.000", key: "e200", value: 2.0 },
  { label: "2.618", key: "e2618", value: 2.618 },
];

const RETRACEMENT_FIBS = [
  { label: "0.236", key: "r236", value: 0.236 },
  { label: "0.382", key: "r382", value: 0.382 },
  { label: "0.500", key: "r500", value: 0.5 },
  { label: "0.618", key: "r618", value: 0.618 },
  { label: "0.786", key: "r786", value: 0.786 },
];

const TARGET_MODEL_SOURCE = "engine22.wave.targets.v1";

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function tickSizeForSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();

  if (["ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K"].includes(s)) {
    return 0.25;
  }

  return null;
}

function roundToTick(price, symbol) {
  const p = Number(price);
  if (!Number.isFinite(p)) return null;

  const tick = tickSizeForSymbol(symbol);
  if (!tick) return round2(p);

  return Number((Math.round(p / tick) * tick).toFixed(2));
}

function getMark(mark, path = null) {
  if (!mark || typeof mark !== "object") return null;

  if (path === "low") {
    return toNum(mark?.low?.price ?? mark?.low?.p ?? mark?.low);
  }

  if (path === "high") {
    return toNum(mark?.high?.price ?? mark?.high?.p ?? mark?.high);
  }

  return toNum(mark?.price ?? mark?.p ?? mark?.value);
}

function getWaveLow(marks = {}, waveKey) {
  const mark = marks?.[waveKey] || marks?.[String(waveKey).toLowerCase()] || null;

  return (
    getMark(mark, "low") ??
    getMark(mark) ??
    null
  );
}

function getWaveHigh(marks = {}, waveKey) {
  const mark = marks?.[waveKey] || marks?.[String(waveKey).toLowerCase()] || null;

  return (
    getMark(mark, "high") ??
    getMark(mark) ??
    null
  );
}

function getWavePrice(marks = {}, waveKey) {
  const mark = marks?.[waveKey] || marks?.[String(waveKey).toLowerCase()] || null;
  return getMark(mark);
}

function invalidTargetModel({
  symbol,
  degree,
  activeWave,
  modelType = "UNKNOWN",
  reason = "TARGET_MODEL_INSUFFICIENT_ANCHORS",
  manualFallback = null,
} = {}) {
  if (manualFallback && typeof manualFallback === "object") {
    return {
      ...manualFallback,
      active: manualFallback.active !== false,
      source: manualFallback.source || "manual.targetModel.fallback",
      generated: false,
      manualFallbackUsed: true,
      noExecution: true,
      noPermissionCreated: true,
      watchOnly: true,
      reasonCodes: [
        "MANUAL_TARGET_MODEL_USED_AS_FALLBACK",
        reason,
        ...(Array.isArray(manualFallback.reasonCodes)
          ? manualFallback.reasonCodes
          : []),
        "NO_EXECUTION",
        "NO_PERMISSION_CREATED",
      ],
    };
  }

  return {
    active: false,
    source: TARGET_MODEL_SOURCE,
    generated: false,
    symbol,
    degree,
    activeWave,
    modelType,
    anchorModel: null,
    levels: null,
    displayLevels: [],
    nextTarget: null,
    summary: "Target model unavailable. Missing structural anchors.",
    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,
    reasonCodes: [
      reason,
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function buildDisplayLevels({ levels = {}, fibs = [] } = {}) {
  return fibs.map((fib) => ({
    label: fib.label,
    price: levels?.[fib.label] ?? levels?.[fib.key] ?? null,
    status: "WATCH",
  }));
}

function buildExtensionTargetModel({
  symbol,
  degree,
  activeWave,
  impulseStart,
  impulseEnd,
  projectionBase,
  projectionMethod,
  currentPrice = null,
  manualFallback = null,
} = {}) {
  const start = toNum(impulseStart);
  const end = toNum(impulseEnd);
  const base = toNum(projectionBase);

  if (start === null || end === null || base === null) {
    return invalidTargetModel({
      symbol,
      degree,
      activeWave,
      modelType: "EXTENSION_LADDER",
      reason: "TARGET_MODEL_MISSING_EXTENSION_ANCHORS",
      manualFallback,
    });
  }

  const range = Math.abs(end - start);

  if (!Number.isFinite(range) || range <= 0) {
    return invalidTargetModel({
      symbol,
      degree,
      activeWave,
      modelType: "EXTENSION_LADDER",
      reason: "TARGET_MODEL_INVALID_EXTENSION_RANGE",
      manualFallback,
    });
  }

  const levels = {};

  for (const fib of EXTENSION_FIBS) {
    const price = roundToTick(base + range * fib.value, symbol);

    levels[fib.label] = price;
    levels[fib.key] = price;
  }

  const displayLevels = buildDisplayLevels({
    levels,
    fibs: EXTENSION_FIBS,
  });

  const sortedPrices = displayLevels
    .map((x) => toNum(x.price))
    .filter((x) => x !== null)
    .sort((a, b) => a - b);

  const price = toNum(currentPrice);

  const nextTarget =
    price !== null
      ? sortedPrices.find((target) => target >= price) ?? sortedPrices[0] ?? null
      : sortedPrices[0] ?? null;

  return {
    active: true,
    source: TARGET_MODEL_SOURCE,
    generated: true,
    symbol,
    degree,
    activeWave,
    modelType: "EXTENSION_LADDER",
    projectionMethod,

    anchorModel: {
      impulseStart: round2(start),
      impulseEnd: round2(end),
      projectionBase: round2(base),
      range: round2(range),
    },

    levels,
    displayLevels,
    nextTarget: round2(nextTarget),

    summary: `${degree} ${activeWave} extension ladder generated from structural marks.`,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "TARGET_MODEL_GENERATED_FROM_ACTIVE_STRUCTURE",
      "EXTENSION_LADDER_GENERATED",
      projectionMethod,
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function buildRetracementTargetModel({
  symbol,
  degree,
  activeWave,
  impulseStart,
  impulseHigh,
  projectionMethod,
  localSupportWatch = null,
  currentPrice = null,
  manualFallback = null,
} = {}) {
  const start = toNum(impulseStart);
  const high = toNum(impulseHigh);

  if (start === null || high === null) {
    return invalidTargetModel({
      symbol,
      degree,
      activeWave,
      modelType: "RETRACEMENT_LADDER",
      reason: "TARGET_MODEL_MISSING_RETRACEMENT_ANCHORS",
      manualFallback,
    });
  }

  const range = Math.abs(high - start);

  if (!Number.isFinite(range) || range <= 0) {
    return invalidTargetModel({
      symbol,
      degree,
      activeWave,
      modelType: "RETRACEMENT_LADDER",
      reason: "TARGET_MODEL_INVALID_RETRACEMENT_RANGE",
      manualFallback,
    });
  }

  const levels = {};

  for (const fib of RETRACEMENT_FIBS) {
    const price = roundToTick(high - range * fib.value, symbol);

    levels[fib.label] = price;
    levels[fib.key] = price;
  }

  const displayLevels = buildDisplayLevels({
    levels,
    fibs: RETRACEMENT_FIBS,
  });

  const sortedPrices = displayLevels
    .map((x) => toNum(x.price))
    .filter((x) => x !== null)
    .sort((a, b) => b - a);

  const price = toNum(currentPrice);

  const nextTarget =
    price !== null
      ? sortedPrices.find((target) => target <= price) ?? sortedPrices[0] ?? null
      : sortedPrices[0] ?? null;

  return {
    active: true,
    source: TARGET_MODEL_SOURCE,
    generated: true,
    symbol,
    degree,
    activeWave,
    modelType: "RETRACEMENT_LADDER",
    projectionMethod,

    anchorModel: {
      impulseStart: round2(start),
      impulseHigh: round2(high),
      range: round2(range),
    },

    levels,
    displayLevels,
    nextTarget: round2(nextTarget),

    ...(localSupportWatch ? { localSupportWatch } : {}),

    summary: `${degree} ${activeWave} retracement ladder generated from structural marks.`,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "TARGET_MODEL_GENERATED_FROM_ACTIVE_STRUCTURE",
      "RETRACEMENT_LADDER_GENERATED",
      projectionMethod,
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function chooseManualTargetFallback(structure = {}) {
  const targetModel =
    structure?.targetModel && typeof structure.targetModel === "object"
      ? structure.targetModel
      : null;

  if (!targetModel) return null;

  // Manual override is allowed only when explicitly marked.
  // Otherwise generated target model should be preferred.
  if (targetModel.override === true || targetModel.manualOverride === true) {
    return {
      ...targetModel,
      override: true,
      source: targetModel.source || "manual.targetModel.override",
      reasonCodes: [
        "MANUAL_TARGET_MODEL_OVERRIDE_USED",
        ...(Array.isArray(targetModel.reasonCodes) ? targetModel.reasonCodes : []),
      ],
    };
  }

  return targetModel;
}

export function buildWaveTargetModel({
  symbol = "ES",
  degree = null,
  structure = {},
  currentPrice = null,
} = {}) {
  if (!structure || typeof structure !== "object") {
    return invalidTargetModel({
      symbol,
      degree,
      activeWave: null,
      reason: "TARGET_MODEL_MISSING_STRUCTURE",
    });
  }

  const activeWave = upper(
    structure.activeWave ||
      structure.currentWave ||
      structure.wave ||
      structure.activeLeg
  );

  const marks = structure?.marks || structure?.waveMarks || {};
  const manualFallback = chooseManualTargetFallback(structure);

  if (manualFallback?.override === true) {
    return {
      ...manualFallback,
      active: manualFallback.active !== false,
      generated: false,
      manualOverrideUsed: true,
      noExecution: true,
      noPermissionCreated: true,
      watchOnly: true,
    };
  }

  if (activeWave === "W3") {
    const w1Low = getWaveLow(marks, "W1");
    const w1High = getWaveHigh(marks, "W1");
    const w2 = getWavePrice(marks, "W2");

    return buildExtensionTargetModel({
      symbol,
      degree,
      activeWave,
      impulseStart: w1Low,
      impulseEnd: w1High,
      projectionBase: w2,
      projectionMethod: "W1_RANGE_PROJECTED_FROM_W2",
      currentPrice,
      manualFallback,
    });
  }

  if (activeWave === "W5") {
    const w1Low = getWaveLow(marks, "W1");
    const w1High = getWaveHigh(marks, "W1");
    const w4 = getWavePrice(marks, "W4");

    return buildExtensionTargetModel({
      symbol,
      degree,
      activeWave,
      impulseStart: w1Low,
      impulseEnd: w1High,
      projectionBase: w4,
      projectionMethod: "W1_RANGE_PROJECTED_FROM_W4",
      currentPrice,
      manualFallback,
    });
  }

  if (activeWave === "W2") {
    const w1Low = getWaveLow(marks, "W1");
    const w1High = getWaveHigh(marks, "W1");

    return buildRetracementTargetModel({
      symbol,
      degree,
      activeWave,
      impulseStart: w1Low,
      impulseHigh: w1High,
      projectionMethod: "W1_RANGE_RETRACEMENT_FROM_W1_HIGH",
      localSupportWatch: structure?.targetModel?.localSupportWatch || null,
      currentPrice,
      manualFallback,
    });
  }

  if (activeWave === "W4") {
    const w2 = getWavePrice(marks, "W2");
    const w3 = getWavePrice(marks, "W3");

    return buildRetracementTargetModel({
      symbol,
      degree,
      activeWave,
      impulseStart: w2,
      impulseHigh: w3,
      projectionMethod: "W3_RANGE_RETRACEMENT_FROM_W3_HIGH",
      localSupportWatch: structure?.targetModel?.localSupportWatch || null,
      currentPrice,
      manualFallback,
    });
  }

  return invalidTargetModel({
    symbol,
    degree,
    activeWave,
    modelType: "NO_TARGET_MODEL_FOR_ACTIVE_WAVE",
    reason: "TARGET_MODEL_ACTIVE_WAVE_NOT_SUPPORTED",
    manualFallback,
  });
}

export function attachTargetModelsToActiveStructures({
  symbol = "ES",
  activeStructures = {},
  currentPrice = null,
} = {}) {
  if (!activeStructures || typeof activeStructures !== "object") {
    return {};
  }

  const out = { ...activeStructures };

  for (const [degree, structure] of Object.entries(activeStructures)) {
    if (!structure || typeof structure !== "object") continue;

    const targetModel = buildWaveTargetModel({
      symbol,
      degree,
      structure,
      currentPrice,
    });

    out[degree] = {
      ...structure,
      targetModel,
      reasonCodes: [
        ...(Array.isArray(structure.reasonCodes) ? structure.reasonCodes : []),
        ...(targetModel?.generated === true
          ? ["TARGET_MODEL_GENERATED_FROM_ACTIVE_STRUCTURE"]
          : targetModel?.manualOverrideUsed === true
          ? ["MANUAL_TARGET_MODEL_OVERRIDE_USED"]
          : targetModel?.manualFallbackUsed === true
          ? ["MANUAL_TARGET_MODEL_FALLBACK_USED"]
          : []),
      ],
    };
  }

  return out;
}

export default buildWaveTargetModel;
