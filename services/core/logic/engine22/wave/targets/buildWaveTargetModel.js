// services/core/logic/engine22/wave/targets/buildWaveTargetModel.js
// Engine 22 — Generated Wave Target Model
//
// Purpose:
// Generate extension, retracement, and correction target ladders from
// structural Elliott marks.
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

const C_DOWN_FIBS = [
  { label: "C 1.000", key: "c100", value: 1.0 },
  { label: "C 1.272", key: "c1272", value: 1.272 },
  { label: "C 1.618", key: "c1618", value: 1.618 },
  { label: "C 2.000", key: "c200", value: 2.0 },
  { label: "C 2.618", key: "c2618", value: 2.618 },
];

const C_B_RETRACE_FIBS = [
  { label: "C-b 0.236", key: "cb236", value: 0.236 },
  { label: "C-b 0.382", key: "cb382", value: 0.382 },
  { label: "C-b 0.500", key: "cb500", value: 0.5 },
  { label: "C-b 0.618", key: "cb618", value: 0.618 },
  { label: "C-b 0.786", key: "cb786", value: 0.786 },
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

function getWaveMark(marks = {}, waveKey) {
  return marks?.[waveKey] || marks?.[String(waveKey).toLowerCase()] || null;
}

function getMarkStatus(mark) {
  return upper(mark?.status || mark?.maturity || "");
}

function getMarkTime(mark) {
  return mark?.time || mark?.t || mark?.timestamp || null;
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

function buildExpandedFlatCDownTargetModel({
  symbol,
  degree,
  activeWave,
  marks = {},
  currentPrice = null,
  manualFallback = null,
} = {}) {
  const waveA = getWaveMark(marks, "A");
  const waveB = getWaveMark(marks, "B");
  const waveC = getWaveMark(marks, "C");

  const aLow = getWavePrice(marks, "A");
  const bHigh = getWavePrice(marks, "B");

  if (aLow === null || bHigh === null) {
    return invalidTargetModel({
      symbol,
      degree,
      activeWave,
      modelType: "C_DOWN_EXTENSION_LADDER",
      reason: "TARGET_MODEL_MISSING_EXPANDED_FLAT_A_B_MARKS",
      manualFallback,
    });
  }

  const range = Math.abs(bHigh - aLow);

  if (!Number.isFinite(range) || range <= 0) {
    return invalidTargetModel({
      symbol,
      degree,
      activeWave,
      modelType: "C_DOWN_EXTENSION_LADDER",
      reason: "TARGET_MODEL_INVALID_EXPANDED_FLAT_A_B_RANGE",
      manualFallback,
    });
  }

  const levels = {};

  for (const fib of C_DOWN_FIBS) {
    const price = roundToTick(bHigh - range * fib.value, symbol);

    levels[fib.label] = price;
    levels[fib.key] = price;
  }

  const displayLevels = buildDisplayLevels({
    levels,
    fibs: C_DOWN_FIBS,
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

  const nextTargetKey =
    Object.entries(levels).find(([, value]) => value === nextTarget)?.[0] || null;

  return {
    active: true,
    source: TARGET_MODEL_SOURCE,
    generated: true,
    symbol,
    degree,
    activeWave,

    modelType: "C_DOWN_EXTENSION_LADDER",
    correctionType: "EXPANDED_FLAT",
    direction: "DOWN",
    currentLeg: "C",
    projectionMethod: "EXPANDED_FLAT_A_B_PROJECTED_FROM_B_HIGH",

    anchorModel: {
      waveALow: round2(aLow),
      waveATime: getMarkTime(waveA),
      waveAStatus: getMarkStatus(waveA) || null,

      waveBHigh: round2(bHigh),
      waveBTime: getMarkTime(waveB),
      waveBStatus: getMarkStatus(waveB) || null,

      waveCStatus: getMarkStatus(waveC) || null,

      projectionBase: round2(bHigh),
      range: round2(range),
    },

    levels,
    displayLevels,

    internalCStructure: buildInternalCStructure({
      symbol,
      degree,
      activeWave,
      marks,
      currentPrice,
      cDownLevels: levels,
      aLow,
      bHigh,
      range,
      waveA,
      waveB,
      waveC,
    }),

    nextTarget: round2(nextTarget),
    nextTargetKey,

    primaryTarget: levels.c1618 ?? null,
    primaryTargetKey: "c1618",

    invalidationLevel: round2(bHigh),
    invalidationRule: "C_DOWN_ACTIVE_WHILE_PRICE_CANNOT_HOLD_ABOVE_B_HIGH",

    summary:
      `${degree} W4 expanded flat is active. B high is ${round2(
        bHigh
      )}. While price cannot reclaim and hold above ${round2(
        bHigh
      )}, watch C down toward ${levels.c100}, ${levels.c1272}, and ${levels.c1618}.`,

    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,

    reasonCodes: [
      "TARGET_MODEL_GENERATED_FROM_ACTIVE_STRUCTURE",
      "EXPANDED_FLAT_C_DOWN_LADDER_GENERATED",
      "B_COMPLETE_C_DOWN_WATCH",
      "C_DOWN_ACTIVE_WHILE_PRICE_CANNOT_HOLD_ABOVE_B_HIGH",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
}

function buildInternalCStructure({
  symbol,
  degree,
  activeWave,
  marks = {},
  currentPrice = null,
  cDownLevels = {},
  aLow = null,
  bHigh = null,
  range = null,
  waveA = null,
  waveB = null,
  waveC = null,
} = {}) {
  const c100 = toNum(cDownLevels.c100);
  const c1272 = toNum(cDownLevels.c1272);
  const c1618 = toNum(cDownLevels.c1618);
  const price = toNum(currentPrice);

  const cACompletionHigh = c100 !== null ? roundToTick(c100, symbol) : null;
  const cACompletionLow = roundToTick(7700, symbol);

  const cBLevels = {};

  if (cACompletionHigh !== null && bHigh !== null) {
    const bounceRange = Math.abs(bHigh - cACompletionHigh);

    for (const fib of C_B_RETRACE_FIBS) {
      const level = roundToTick(cACompletionHigh + bounceRange * fib.value, symbol);

      cBLevels[fib.label] = level;
      cBLevels[fib.key] = level;
    }
  }

  const cADownPoints =
    price !== null && bHigh !== null
      ? round2(Math.max(0, bHigh - price))
      : null;

  const cAProgressRatio =
    cADownPoints !== null && range !== null && range > 0
      ? round2(cADownPoints / range)
      : null;

  let state = "C_A_DOWN_ACTIVE";

  if (price !== null && cACompletionHigh !== null && price <= cACompletionHigh) {
    state = "C_A_COMPLETION_ZONE_ACTIVE";
  }

  if (price !== null && cACompletionLow !== null && price <= cACompletionLow) {
    state = "C_A_EXTENDED_INTO_NEGOTIATED_ZONE";
  }

  return {
    active: true,
    source: "engine22.minuteW4.internalCStructure.v1",
    degree,
    activeWave,
    parentCorrection: "MINUTE_W4_EXPANDED_FLAT",
    correctionType: "EXPANDED_FLAT",
    parentCompletedWave: "W3",
    currentWave: "C",
    currentInternalWave: "C-a",
    nextExpectedInternalWave: "C-b",
    cWaveState: state,
    direction: "DOWN",
    currentPrice: round2(price),

    waveA: {
      price: round2(aLow),
      time: getMarkTime(waveA),
      status: getMarkStatus(waveA) || null,
    },

    waveB: {
      price: round2(bHigh),
      time: getMarkTime(waveB),
      status: getMarkStatus(waveB) || null,
    },

    waveC: {
      price: getWavePrice(marks, "C"),
      time: getMarkTime(waveC),
      status: getMarkStatus(waveC) || "ACTIVE_CANDIDATE",
    },

    cA: {
      state,
      start: round2(bHigh),
      currentPrice: round2(price),
      downPoints: cADownPoints,
      progressRatio: cAProgressRatio,
      progressPercent:
        cAProgressRatio !== null ? round2(cAProgressRatio * 100) : null,
      completionZone: {
        hi: cACompletionHigh,
        lo: cACompletionLow,
        primary: cACompletionHigh,
        negotiatedZoneApprox: cACompletionLow,
        label: "C_A_COMPLETION_ZONE_C100_TO_NEXT_NEGOTIATED_ZONE",
      },
    },

    cB: {
      state: "WATCH_AFTER_C_A_REACTION",
      expected: true,
      projectionPending: true,
      retraceOfCADown: {
        anchorLow: cACompletionHigh,
        anchorHigh: round2(bHigh),
        levels: cBLevels,
        normalZone: {
          lo: cBLevels.cb382 ?? null,
          hi: cBLevels.cb618 ?? null,
          label: "NORMAL_C_B_BOUNCE_ZONE",
        },
      },
    },

    cC: {
      state: "PENDING_C_B_HIGH",
      projectionPending: true,
      largerCPrimaryTarget: c1618,
      largerCTargets: {
        c100,
        c1272,
        c1618,
        c200: toNum(cDownLevels.c200),
        c2618: toNum(cDownLevels.c2618),
      },
    },

    invalidationLevel: round2(bHigh),
    invalidationRule: "C_DOWN_WATCH_WEAKENS_IF_PRICE_RECLAIMS_AND_HOLDS_ABOVE_B_HIGH",
    noExecution: true,
    noPermissionCreated: true,
    watchOnly: true,
    reasonCodes: [
      "ENGINE22_INTERNAL_C_STRUCTURE_BUILT",
      "ENGINE22_C_A_DOWN_ACTIVE",
      "ENGINE22_C_A_COMPLETION_ZONE_7722_75_TO_7700",
      "ENGINE22_C_B_BOUNCE_EXPECTED_AFTER_C_A_REACTION",
      "ENGINE22_C_C_PROJECTION_PENDING_C_B_HIGH",
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

  const stage = upper(
    structure.stage ||
      structure.status ||
      structure.state ||
      structure.lifecycle ||
      ""
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

  const reasonCodes = Array.isArray(structure?.reasonCodes)
    ? structure.reasonCodes.map((code) => upper(code))
    : [];

  const waveC = getWaveMark(marks, "C");

  const hasExpandedFlatCDownMarks =
    activeWave === "W4" &&
    getWavePrice(marks, "A") !== null &&
    getWavePrice(marks, "B") !== null &&
    (
      waveC != null ||
      reasonCodes.includes("ENGINE22_MINUTE_W4_EXPANDED_FLAT") ||
      reasonCodes.includes("ENGINE22_B_COMPLETE_C_DOWN_WATCH") ||
      reasonCodes.includes("ENGINE22_C_DOWN_ACTIVE_BELOW_7840")
    );

  if (hasExpandedFlatCDownMarks) {
    return buildExpandedFlatCDownTargetModel({
      symbol,
      degree,
      activeWave,
      marks,
      currentPrice,
      manualFallback,
    });
  }

  if (stage === "COMPLETE" || stage.includes("COMPLETE")) {
    return invalidTargetModel({
      symbol,
      degree,
      activeWave,
      modelType: "COMPLETED_WAVE_NO_FRESH_TARGET_LADDER",
      reason: "TARGET_MODEL_SKIPPED_COMPLETED_WAVE",
      manualFallback: null,
    });
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
