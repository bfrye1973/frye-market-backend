// services/core/logic/engine22/wave/analyzeWaveDegree.js
// Engine 22G — Generic Wave/Fib State Engine
// File 3: analyzeWaveDegree.js
//
// Purpose:
// Analyze one Elliott wave degree using Engine 2's existing block shape.
// This file does not create trades.
// It only explains phase, fib pressure, chase risk, and next expected wave.

import { projectFibExtensions } from "./projectFibExtensions.js";
import { analyzeFibPressure } from "./analyzeFibPressure.js";
import { analyzeExtensionProgress } from "./analyzeExtensionProgress.js";

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function upper(x) {
  return String(x || "").trim().toUpperCase();
}

function getMarkPrice(waveMarks, key) {
  const p = toNum(waveMarks?.[key]?.p);
  return p !== null && p > 0 ? p : null;
}

function getLastMarkPrice(block, key) {
  if (block?.lastMark?.key === key) {
    const p = toNum(block?.lastMark?.p);
    return p !== null && p > 0 ? p : null;
  }

  return null;
}

function getAnchorPrices(block) {
  const waveMarks = block?.waveMarks || null;

  const w1 =
    getMarkPrice(waveMarks, "W1") ??
    getLastMarkPrice(block, "W1");

  const w2 =
    getMarkPrice(waveMarks, "W2") ??
    getLastMarkPrice(block, "W2");

  const w3 =
    getMarkPrice(waveMarks, "W3") ??
    getLastMarkPrice(block, "W3");

  const markedW4 =
    getMarkPrice(waveMarks, "W4") ??
    getLastMarkPrice(block, "W4");

  const cLow = toNum(block?.cLow);
  const w4Low = toNum(block?.w4Low);

  const w4 =
    markedW4 ??
    cLow ??
    w4Low;

  const w4Source =
    markedW4 !== null
      ? "MARK_W4"
      : cLow !== null
      ? "C_LOW_LEVEL"
      : w4Low !== null
      ? "W4_LOW_FIELD"
      : null;

  return {
    w1,
    w2,
    w3,
    w4,
    w4Source,
    markedW4,
    cLow,
    w4Low,
  };
}

function inferDirectionFromAnchors({ w2, w3 }) {
  const a = toNum(w2);
  const b = toNum(w3);

  if (a !== null && b !== null && b < a) return "BEARISH";

  return "BULLISH";
}

function phaseToWaveType(phase) {
  const p = upper(phase);

  if (["IN_W1", "IN_W3", "IN_W5", "COMPLETE_W5"].includes(p)) {
    return "IMPULSE";
  }

  if (["IN_W2", "IN_W4", "IN_A", "IN_B", "IN_C", "COMPLETE_C"].includes(p)) {
    return "CORRECTIVE";
  }

  return "UNKNOWN";
}

function phaseToState({ phase, confirmedPhase, fibPressure }) {
  const p = upper(phase);
  const cp = upper(confirmedPhase);

  if (p === "IN_W1") {
    return {
      waveType: "IMPULSE",
      impulseStage: "EARLY_IMPULSE",
      state: "IMPULSE_STARTING",
      action: "OBSERVE_FOR_W2_PULLBACK",
      nextExpectedWave: "W2",
      needs: ["W2_PULLBACK_STRUCTURE"],
      blockers: ["NO_GENERIC_TRADE_DECISION_YET"],
      reasonCodes: ["IN_W1", "IMPULSE_STARTING"],
    };
  }

  if (p === "IN_W2") {
    return {
      waveType: "CORRECTIVE",
      impulseStage: null,
      state: "PULLBACK_ACTIVE",
      action: "WAIT_FOR_SUPPORT_RECLAIM",
      nextExpectedWave: "W3",
      needs: ["SUPPORT_HOLD", "EMA_RECLAIM", "ENGINE3_REACTION", "ENGINE4_PARTICIPATION"],
      blockers: ["NO_TRIGGER_YET"],
      reasonCodes: ["IN_W2", "PULLBACK_ACTIVE", "WAIT_FOR_W3_TRIGGER"],
    };
  }

  if (p === "IN_W3") {
    return {
      waveType: "IMPULSE",
      impulseStage: "EXPANSION_IMPULSE",
      state: "IMPULSE_EXPANSION_ACTIVE",
      action: "CONTROLLED_DIP_BUY_ONLY",
      nextExpectedWave: "W4",
      needs: ["CONTROLLED_PULLBACK_FOR_ENTRY", "NO_CHASE"],
      blockers: [],
      reasonCodes: ["IN_W3", "IMPULSE_EXPANSION_ACTIVE"],
    };
  }

  if (p === "IN_W4") {
    return {
      waveType: "CORRECTIVE",
      impulseStage: null,
      state: "PULLBACK_ACTIVE",
      action: "WAIT_FOR_SUPPORT_RECLAIM",
      nextExpectedWave: "W5",
      needs: ["SUPPORT_HOLD", "EMA_RECLAIM", "ENGINE3_REACTION", "ENGINE4_PARTICIPATION"],
      blockers: ["NO_TRIGGER_YET"],
      reasonCodes: [
        "IN_W4",
        cp === "IN_W3" ? "CONFIRMED_W3_COMPLETE" : null,
        "PULLBACK_ACTIVE",
        "WAIT_FOR_W5_TRIGGER",
      ].filter(Boolean),
    };
  }

  if (p === "IN_W5") {
    const highRisk =
      fibPressure?.chaseRisk === "HIGH" ||
      fibPressure?.chaseRisk === "VERY_HIGH" ||
      fibPressure?.chaseRisk === "EXTREME";

    return {
      waveType: "IMPULSE",
      impulseStage: "FINAL_IMPULSE",
      state: "FINAL_IMPULSE_ACTIVE",
      action: highRisk ? "FOLLOW_BUT_DO_NOT_CHASE" : "FOLLOW_WITH_CONTROLLED_PULLBACKS",
      nextExpectedWave: highRisk ? "W5_COMPLETION_OR_PULLBACK" : "W5_EXTENSION",
      needs: highRisk
        ? ["LOWER_DEGREE_PULLBACK_FOR_ENTRY", "REACTION_CONFIRMATION", "VOLUME_PARTICIPATION"]
        : ["CONTROLLED_PULLBACK_FOR_ENTRY"],
      blockers: highRisk ? ["HIGH_CHASE_RISK"] : [],
      reasonCodes: [
        "IN_W5",
        "FINAL_IMPULSE_ACTIVE",
        highRisk ? "HIGH_CHASE_RISK" : "NORMAL_W5_EXTENSION",
      ],
    };
  }

  if (p === "COMPLETE_W5") {
    return {
      waveType: "IMPULSE",
      impulseStage: "IMPULSE_COMPLETE",
      state: "IMPULSE_COMPLETE",
      action: "WAIT_FOR_NEW_STRUCTURE",
      nextExpectedWave: "A_OR_NEW_CYCLE",
      needs: ["NEW_WAVE_STRUCTURE"],
      blockers: ["IMPULSE_COMPLETE"],
      reasonCodes: ["COMPLETE_W5", "IMPULSE_COMPLETE"],
    };
  }

  if (["IN_A", "IN_B", "IN_C", "COMPLETE_C"].includes(p)) {
    return {
      waveType: "CORRECTIVE",
      impulseStage: null,
      state: "CORRECTION_ACTIVE",
      action: "WAIT_FOR_CORRECTION_COMPLETION",
      nextExpectedWave: p === "IN_A" ? "B" : p === "IN_B" ? "C" : "NEW_IMPULSE",
      needs: ["CORRECTION_STRUCTURE_COMPLETION"],
      blockers: ["CORRECTION_ACTIVE"],
      reasonCodes: [p, "CORRECTION_ACTIVE"],
    };
  }

  return {
    waveType: "UNKNOWN",
    impulseStage: null,
    state: "UNKNOWN",
    action: "WAIT_FOR_VALID_ENGINE2_PHASE",
    nextExpectedWave: "UNKNOWN",
    needs: ["VALID_ENGINE2_PHASE"],
    blockers: ["UNKNOWN_PHASE"],
    reasonCodes: ["UNKNOWN_PHASE"],
  };
}

function buildProjectionFromBlock({
  symbol,
  block,
  direction,
}) {
  const anchors = getAnchorPrices(block);

  if (anchors.w2 === null || anchors.w3 === null || anchors.w4 === null) {
    return {
      ok: false,
      source: "W4_TO_W5",
      reason: "MISSING_W2_W3_W4_ANCHORS",
      anchors,
      levels: null,
      reasonCodes: ["MISSING_W2_W3_W4_ANCHORS"],
    };
  }

  return {
    ...projectFibExtensions({
      symbol,
      direction,
      w2: anchors.w2,
      w3: anchors.w3,
      w4: anchors.w4,
    }),
    anchorSource: {
      w2: "MARK_W2",
      w3: "MARK_W3",
      w4: anchors.w4Source,
    },
  };
}

function buildW3ProjectionFromBlock({
  symbol,
  block,
  direction,
}) {
  const anchors = getAnchorPrices(block);

  if (anchors.w1 === null || anchors.w2 === null) {
    return {
      ok: false,
      source: "W1_W2_TO_W3",
      reason: "MISSING_W1_W2_ANCHORS",
      anchors,
      levels: null,
      reasonCodes: ["MISSING_W1_W2_ANCHORS"],
    };
  }

  const dir = upper(direction) === "BEARISH" ? "BEARISH" : "BULLISH";
  const sign = dir === "BEARISH" ? -1 : 1;
  const range = Math.abs(anchors.w1 - anchors.w2);

  if (!Number.isFinite(range) || range <= 0) {
    return {
      ok: false,
      source: "W1_W2_TO_W3",
      reason: "INVALID_W1_W2_RANGE",
      anchors,
      levels: null,
      reasonCodes: ["INVALID_W1_W2_RANGE"],
    };
  }

  const tickSize = ["ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K"].includes(
    String(symbol || "").toUpperCase()
  )
    ? 0.25
    : null;

  const roundToTick = (price) => {
    const p = Number(price);
    if (!Number.isFinite(p)) return null;
    if (!Number.isFinite(tickSize) || tickSize <= 0) return round2(p);
    return Number((Math.round(p / tickSize) * tickSize).toFixed(2));
  };

  const fibs = [
    { key: "e100", label: "1.000", value: 1.0 },
    { key: "e1272", label: "1.272", value: 1.272 },
    { key: "e1618", label: "1.618", value: 1.618 },
    { key: "e200", label: "2.000", value: 2.0 },
    { key: "e2618", label: "2.618", value: 2.618 },
  ];

  const rawLevels = {};
  const levels = {};
  const fibMeta = {};

  for (const fib of fibs) {
    const raw = anchors.w2 + sign * range * fib.value;
    rawLevels[fib.key] = raw;
    levels[fib.key] = roundToTick(raw);
    fibMeta[fib.key] = {
      label: fib.label,
      value: fib.value,
    };
  }

  return {
    ok: true,
    source: "W1_W2_TO_W3_ACTIVE_EXECUTION",
    symbol,
    direction: dir,
    anchors: {
      w1: round2(anchors.w1),
      w2: round2(anchors.w2),
    },
    range: round2(range),
    rawLevels,
    levels,
    fibMeta,
    tickSize,
    reason: "W1_W2_ANCHORS_VALID_ACTIVE_W3_PROJECTION",
    reasonCodes: ["W1_W2_ANCHORS_VALID_ACTIVE_W3_PROJECTION"],
    anchorSource: {
      w1: "MARK_W1",
      w2: "MARK_W2",
    },
  };
}

export function analyzeWaveDegree({
  symbol = "SPY",
  degree = null,
  parentDegree = null,
  block = null,
  parentBlock = null,
  currentPrice = null,
  barsByTf = {},
} = {}) {
  if (!block || typeof block !== "object") {
    return {
      ok: false,
      symbol,
      degree,
      parentDegree,
      phase: "UNKNOWN",
      confirmedPhase: "UNKNOWN",
      waveType: "UNKNOWN",
      state: "UNKNOWN",
      action: "WAIT_FOR_ENGINE2_BLOCK",
      nextExpectedWave: "UNKNOWN",
      fibProjection: null,
      fibPressure: null,
      needs: ["ENGINE2_BLOCK"],
      blockers: ["MISSING_ENGINE2_BLOCK"],
      reasonCodes: ["MISSING_ENGINE2_BLOCK"],
    };
  }

  const phase = block?.phase || "UNKNOWN";
  const confirmedPhase = block?.confirmedPhase || "UNKNOWN";

  const anchors = getAnchorPrices(block);
  const direction = inferDirectionFromAnchors({
    w2: anchors.w2,
    w3: anchors.w3,
  });

  const preliminary = phaseToState({
    phase,
    confirmedPhase,
    fibPressure: null,
  });

  const phaseKey = upper(phase);

const shouldProjectW3 =
  phaseKey === "IN_W3" &&
  anchors.w1 !== null &&
  anchors.w2 !== null &&
  anchors.w3 === null;

const shouldProjectW5 =
  ["IN_W4", "IN_W5", "COMPLETE_W5"].includes(phaseKey) ||
  anchors.w4 !== null;

const fibProjection = shouldProjectW3
  ? buildW3ProjectionFromBlock({
      symbol,
      block,
      direction,
    })
  : shouldProjectW5
  ? buildProjectionFromBlock({
      symbol,
      block,
      direction,
    })
  : {
      ok: false,
      source: "NO_ACTIVE_FIB_PROJECTION",
      reason: "FIB_PROJECTION_NOT_ACTIVE_FOR_PHASE",
      anchors,
      levels: null,
      reasonCodes: ["FIB_PROJECTION_NOT_ACTIVE_FOR_PHASE"],
    };

    const fibPressure =
    fibProjection?.ok === true
      ? analyzeFibPressure({
          currentPrice,
          levels: fibProjection.levels,
          direction: fibProjection.direction,
        })
      : {
          ok: false,
          currentPrice: round2(currentPrice),
          extensionState: "UNKNOWN",
          chaseRisk: "UNKNOWN",
          expectedBehavior: "WAIT_FOR_VALID_PROJECTION",
          reasonCodes: fibProjection?.reasonCodes || ["NO_VALID_FIB_PROJECTION"],
        };

  const extensionProgress =
    fibProjection?.ok === true
      ? analyzeExtensionProgress({
          symbol,
          degree,
          phase,
          direction: fibProjection.direction || direction,
          currentPrice,
          block,
          fibProjection,
          barsByTf,
        })
      : {
          ok: false,
          active: false,
          symbol,
          degree,
          activeWave: null,
          state: "NO_VALID_FIB_PROJECTION",
          reasonCodes: fibProjection?.reasonCodes || ["NO_VALID_FIB_PROJECTION"],
        };

  const interpreted = phaseToState({
    phase,
    confirmedPhase,
    fibPressure,
  });

  const reasonCodes = [
    ...(Array.isArray(interpreted.reasonCodes) ? interpreted.reasonCodes : []),
    ...(fibProjection?.ok === true ? ["FIB_PROJECTION_AVAILABLE"] : []),
    ...(Array.isArray(fibPressure?.reasonCodes) ? fibPressure.reasonCodes : []),
  ];

  return {
    ok: true,
    symbol,
    degree: degree || block?.degree || null,
    parentDegree,

    phase,
    confirmedPhase,
    phaseReason: block?.phaseReason || null,

    waveType: interpreted.waveType || phaseToWaveType(phase),
    impulseStage: interpreted.impulseStage || null,
    state: interpreted.state,

    direction,
    currentPrice: round2(currentPrice),

anchors: {
  w1: round2(anchors.w1),
  w2: round2(anchors.w2),
  w3: round2(anchors.w3),
  w4: round2(anchors.w4),
  w4Source: anchors.w4Source,
  markedW4: round2(anchors.markedW4),
  cLow: round2(anchors.cLow),
  w4Low: round2(anchors.w4Low),

  // Manual ABC correction levels, if supplied from fib-input.csv LEVEL rows.
  aLow: round2(block?.aLow),
  bHigh: round2(block?.bHigh),
  manualCLow: round2(block?.cLow),
},

// Manual ABC correction levels copied through from Engine 2.
// These are read-only context for post-W5 ABC correction mapping.
aLow: round2(block?.aLow),
bHigh: round2(block?.bHigh),
cLow: round2(block?.cLow),
w4Low: round2(block?.w4Low),
lowerHighLevel: round2(block?.lowerHighLevel),
continuationLevel: round2(block?.continuationLevel),
abcMarks: block?.abcMarks || null,

fibProjection,
fibPressure,
extensionProgress,

    action: interpreted.action,
    nextExpectedWave: interpreted.nextExpectedWave,

    needs: interpreted.needs,
    blockers: interpreted.blockers,

    parentContext: parentBlock
      ? {
          degree: parentBlock?.degree || parentDegree || null,
          phase: parentBlock?.phase || "UNKNOWN",
          confirmedPhase: parentBlock?.confirmedPhase || "UNKNOWN",
        }
      : null,

    reasonCodes,
  };
}

export default analyzeWaveDegree;
