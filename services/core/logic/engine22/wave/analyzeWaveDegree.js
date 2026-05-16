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

export function analyzeWaveDegree({
  symbol = "SPY",
  degree = null,
  parentDegree = null,
  block = null,
  parentBlock = null,
  currentPrice = null,
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

  const shouldProjectW5 =
    ["IN_W4", "IN_W5", "COMPLETE_W5"].includes(upper(phase)) ||
    anchors.w4 !== null;

  const fibProjection =
    shouldProjectW5
      ? buildProjectionFromBlock({
          symbol,
          block,
          direction,
        })
      : {
          ok: false,
          source: "W4_TO_W5",
          reason: "W5_PROJECTION_NOT_ACTIVE_FOR_PHASE",
          anchors,
          levels: null,
          reasonCodes: ["W5_PROJECTION_NOT_ACTIVE_FOR_PHASE"],
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
    },

    fibProjection,
    fibPressure,

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
