// services/core/logic/engine22/wave/analyzeWaveStack.js
// Engine 22G — Generic Wave/Fib State Engine
// File 4: analyzeWaveStack.js
//
// Purpose:
// Run analyzeWaveDegree() across primary, intermediate, minor, minute, and micro.
// Then summarize the total wave/fib stack.
// This is read-only intelligence. It does not create trades.

import { analyzeWaveDegree } from "./analyzeWaveDegree.js";
import { analyzeMicroW4AbcRisk } from "./analyzeMicroW4AbcRisk.js";
import { analyzeWaveDuration } from "./analyzeWaveDuration.js";
import { analyzeAbcCorrection } from "./analyzeAbcCorrection.js";
import { buildTradeContextSummary } from "./buildTradeContextSummary.js";
import { buildW4Levels } from "./buildW4Levels.js";

const DEGREE_ORDER = ["primary", "intermediate", "minor", "minute", "micro"];

const PARENT_BY_DEGREE = {
  primary: null,
  intermediate: "primary",
  minor: "intermediate",
  minute: "minor",
  micro: "minute",
};

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

function isImpulsePhase(phase) {
  const p = upper(phase);
  return p === "IN_W1" || p === "IN_W3" || p === "IN_W5";
}

function isPullbackPhase(phase) {
  const p = upper(phase);
  return p === "IN_W2" || p === "IN_W4";
}

function chaseRiskRank(risk) {
  const r = upper(risk);

  if (r === "EXTREME") return 5;
  if (r === "VERY_HIGH") return 4;
  if (r === "HIGH") return 3;
  if (r === "ELEVATED") return 2;
  if (r === "MODERATE") return 1;
  if (r === "LOW_TO_MODERATE") return 0;

  return -1;
}

function strongestChaseRisk(degrees = {}) {
  let best = {
    risk: "UNKNOWN",
    rank: -1,
    degree: null,
  };

  for (const degree of DEGREE_ORDER) {
    const risk = degrees?.[degree]?.fibPressure?.chaseRisk || "UNKNOWN";
    const rank = chaseRiskRank(risk);

    if (rank > best.rank) {
      best = {
        risk,
        rank,
        degree,
      };
    }
  }

  return best;
}

function findHighestFibPressureDegree(degrees = {}) {
  let best = null;

  for (const degree of DEGREE_ORDER) {
    const d = degrees?.[degree];
    const risk = d?.fibPressure?.chaseRisk || "UNKNOWN";
    const rank = chaseRiskRank(risk);

    if (!best || rank > best.rank) {
      best = {
        degree,
        rank,
        risk,
        extensionState: d?.fibPressure?.extensionState || "UNKNOWN",
        nearestFib: d?.fibPressure?.nearestFib || null,
        nearestFibPrice: d?.fibPressure?.nearestFibPrice ?? null,
      };
    }
  }

  return best;
}

function tickSizeForSymbol(symbol) {
  const s = String(symbol || "").toUpperCase();

  if (
    s === "ES" ||
    s.startsWith("ES") ||
    s === "MES" ||
    s.startsWith("MES") ||
    s === "NQ" ||
    s.startsWith("NQ") ||
    s === "MNQ" ||
    s.startsWith("MNQ")
  ) {
    return 0.25;
  }

  return null;
}

function attachW4LevelsToDegrees({ symbol, engine2State, degrees, currentPrice }) {
  const tickSize = tickSizeForSymbol(symbol);

  for (const degree of DEGREE_ORDER) {
    const degreeState = degrees?.[degree];
    const engine2Block = engine2State?.[degree] || null;

    if (!degreeState?.ok || !engine2Block) continue;

    const phase = upper(degreeState.phase);
    const confirmedPhase = upper(degreeState.confirmedPhase);
    const nextExpectedWave = upper(degreeState.nextExpectedWave);

    const shouldBuildW4Levels =
      phase === "IN_W4" ||
      confirmedPhase === "IN_W3" ||
      nextExpectedWave === "W5";

    if (!shouldBuildW4Levels) continue;

    const w4Levels = buildW4Levels({
      symbol,
      degree,
      degreeState,
      engine2Block,
      currentPrice,
      tickSize,
    });

    degrees[degree] = {
      ...degreeState,
      w4Levels,
    };
  }

  return degrees;
}

function findActiveTradingDegree(degrees = {}) {
  // Prefer the lowest-degree active pullback because that is where entry timing later happens.
  for (const degree of ["micro", "minute", "minor", "intermediate", "primary"]) {
    const d = degrees?.[degree];
    if (!d?.ok) continue;

    if (isPullbackPhase(d.phase)) {
      return {
        degree,
        reason: `${degree.toUpperCase()}_${d.phase}_ACTIVE`,
        setup:
          d.phase === "IN_W4"
            ? `${degree.toUpperCase()}_W4_TO_W5`
            : `${degree.toUpperCase()}_W2_TO_W3`,
      };
    }
  }

  // If no pullback is active, use the lowest impulse degree.
  for (const degree of ["micro", "minute", "minor", "intermediate", "primary"]) {
    const d = degrees?.[degree];
    if (!d?.ok) continue;

    if (isImpulsePhase(d.phase)) {
      return {
        degree,
        reason: `${degree.toUpperCase()}_${d.phase}_ACTIVE`,
        setup:
          d.phase === "IN_W5"
            ? `${degree.toUpperCase()}_W5_EXTENSION`
            : `${degree.toUpperCase()}_IMPULSE`,
      };
    }
  }

  return {
    degree: null,
    reason: "NO_ACTIVE_TRADING_DEGREE",
    setup: "NONE",
  };
}

function buildStackBias({ degrees, chaseRisk }) {
  const primary = degrees?.primary;
  const intermediate = degrees?.intermediate;
  const minor = degrees?.minor;
  const minute = degrees?.minute;
  const micro = degrees?.micro;

  const higherBullish =
    isImpulsePhase(primary?.phase) &&
    isImpulsePhase(intermediate?.phase) &&
    isImpulsePhase(minor?.phase);

  const allFinalImpulse =
    primary?.phase === "IN_W5" &&
    intermediate?.phase === "IN_W5" &&
    minor?.phase === "IN_W5";

  const lowerPullback =
    isPullbackPhase(minute?.phase) ||
    isPullbackPhase(micro?.phase);

  const highRisk =
    chaseRisk?.risk === "HIGH" ||
    chaseRisk?.risk === "VERY_HIGH" ||
    chaseRisk?.risk === "EXTREME";

  if (allFinalImpulse && lowerPullback && highRisk) {
    return "BULLISH_LATE_EXTENSION_REACTION_ZONE";
  }

  if (higherBullish && lowerPullback) {
    return "BULLISH_PULLBACK_INSIDE_HIGHER_IMPULSE";
  }

  if (allFinalImpulse && highRisk) {
    return "BULLISH_FINAL_IMPULSE_HIGH_CHASE_RISK";
  }

  if (higherBullish) {
    return "BULLISH_IMPULSE_STACK";
  }

  return "MIXED_OR_UNKNOWN_WAVE_STACK";
}

function sentenceForDegree(degree, d) {
  if (!d || d.ok !== true) return null;

  const name = `${degree.charAt(0).toUpperCase()}${degree.slice(1)}`;

  if (d.extensionProgress?.state === "POST_EXTENSION_PULLBACK") {
    return `${name} ${d.extensionProgress.activeWave} already tagged ${d.extensionProgress.highestExtensionHit} near ${d.extensionProgress.highestExtensionPrice} and is now pulling back.`;
  }

  if (
    d.phase === "IN_W5" &&
    d.fibPressure?.extensionState === "NEAR_1_618_REACTION_ZONE"
  ) {
    return `${name} W5 is reacting near its 1.618 extension at ${d.fibPressure.nearestFibPrice}.`;
  }

  if (d.phase === "IN_W5" && d.fibProjection?.levels?.e100 != null) {
    return `${name} W5 is active with its 1.000 extension near ${d.fibProjection.levels.e100}.`;
  }

  if (d.phase === "IN_W4" && d.confirmedPhase === "IN_W3") {
    return `${name} W4 pullback is active after ${name} W3 completed.`;
  }

  if (d.phase === "IN_W2" && d.confirmedPhase === "IN_W1") {
    return `${name} W2 pullback is active after ${name} W1 completed.`;
  }

  if (d.phase === "IN_W3") {
    return `${name} W3 expansion is active.`;
  }

  return `${name} phase is ${d.phase}.`;
}

function buildPlainEnglishSummary({
  symbol,
  degrees,
  stackBias,
  chaseRisk,
  activeTradingDegree,
}) {
  const parts = [];

  const pressure = findHighestFibPressureDegree(degrees);

  const activeDegree = activeTradingDegree?.degree
    ? degrees?.[activeTradingDegree.degree]
    : null;

  if (activeDegree?.extensionProgress?.state === "POST_EXTENSION_PULLBACK") {
    parts.push(activeDegree.extensionProgress.read);
  } else if (
    pressure &&
    pressure.degree &&
    pressure.extensionState === "NEAR_1_618_REACTION_ZONE"
  ) {
    const degreeName =
      pressure.degree.charAt(0).toUpperCase() + pressure.degree.slice(1);

    parts.push(
      `${symbol} reacted near ${degreeName} W5 1.618 around ${pressure.nearestFibPrice}.`
    );
  } else {
    const intermediateSentence = sentenceForDegree("intermediate", degrees?.intermediate);
    if (intermediateSentence) parts.push(intermediateSentence);
  }

  const minuteSentence = sentenceForDegree("minute", degrees?.minute);
  const microSentence = sentenceForDegree("micro", degrees?.micro);

  if (minuteSentence) parts.push(minuteSentence);
  if (microSentence) parts.push(microSentence);

  if (
    stackBias === "BULLISH_LATE_EXTENSION_REACTION_ZONE" ||
    stackBias === "BULLISH_FINAL_IMPULSE_HIGH_CHASE_RISK"
  ) {
    parts.push("Higher trend remains bullish, but chase risk is high.");
  } else if (stackBias === "BULLISH_PULLBACK_INSIDE_HIGHER_IMPULSE") {
    parts.push("Higher trend remains bullish while the lower degree is pulling back.");
  }

  if (activeTradingDegree?.degree && activeTradingDegree?.setup) {
    parts.push(
      `Active trading focus is ${activeTradingDegree.setup}; wait for support/reclaim before any trigger.`
    );
  }

  if (!parts.length) {
    return `${symbol} wave/fib stack is mixed or unavailable. Wait for clearer Engine 2 structure.`;
  }

  return parts.join(" ");
}

export function analyzeWaveStack({
  symbol = "SPY",
  engine2State = null,
  currentPrice = null,
  regimeLayers = null,
  reactionContext = null,
  volumeContext = null,
  snapshotNow = null,
  currentTimeSec = null,
  barsByTf = {},
} = {}) {
  if (!engine2State || typeof engine2State !== "object") {
    return {
      ok: false,
      engine: "engine22.waveFibState.v1",
      symbol,
      currentPrice: round2(currentPrice),
      stackBias: "UNKNOWN",
      activeTradingDegree: null,
      activeSetup: "NONE",
      chaseRisk: "UNKNOWN",
      degrees: {},
      summary: `${symbol} Engine 2 state is unavailable.`,
      reasonCodes: ["MISSING_ENGINE2_STATE"],
    };
  }

    let degrees = {};

  for (const degree of DEGREE_ORDER) {
    const parentDegree = PARENT_BY_DEGREE[degree];
    const block = engine2State?.[degree] || null;
    const parentBlock = parentDegree ? engine2State?.[parentDegree] || null : null;

    degrees[degree] = analyzeWaveDegree({
      symbol,
      degree,
      parentDegree,
      block,
      parentBlock,
      currentPrice,
      barsByTf,
    });
  }

  degrees = attachW4LevelsToDegrees({
    symbol,
    engine2State,
    degrees,
    currentPrice,
  });

  const chaseRisk = strongestChaseRisk(degrees);
  const activeTradingDegree = findActiveTradingDegree(degrees);
  const stackBias = buildStackBias({
    degrees,
    chaseRisk,
  });

  const microW4AbcRisk =
    activeTradingDegree?.setup === "MICRO_W4_TO_W5"
      ? analyzeMicroW4AbcRisk({
          symbol,
          engine2State,
          currentPrice,
          regimeLayers,
          reactionContext,
          volumeContext,
        })
      : {
          ok: true,
          active: false,
          symbol,
          state: "NO_ACTIVE_MICRO_W4_RISK",
          reasonCodes: ["ACTIVE_SETUP_NOT_MICRO_W4_TO_W5"],
        };

  const waveDuration = analyzeWaveDuration({
    symbol,
    engine2State,
    snapshotNow,
    currentTimeSec,
    barsByTf,
  });

  const activeDegreeName = activeTradingDegree?.degree || null;
  const activeDegreeBlock = activeDegreeName ? engine2State?.[activeDegreeName] || null : null;
  const activeDegreePhase = upper(activeDegreeBlock?.phase);
  const activeDegreeConfirmedPhase = upper(activeDegreeBlock?.confirmedPhase);

  const activeCorrectionFor =
    activeDegreePhase === "IN_W4" && activeDegreeConfirmedPhase === "IN_W3"
      ? "W4"
      : activeDegreePhase === "IN_W2" && activeDegreeConfirmedPhase === "IN_W1"
      ? "W2"
      : null;

  const abcCorrection =
    activeDegreeName && activeCorrectionFor
      ? analyzeAbcCorrection({
          symbol,
          degree: activeDegreeName,
          correctionFor: activeCorrectionFor,
          block: activeDegreeBlock,
          currentPrice,
          barsByTf,
        })
      : {
          ok: true,
          active: false,
          symbol,
          degree: activeDegreeName,
          correctionFor: null,
          state: "NO_ACTIVE_ABC_CORRECTION",
          reasonCodes: ["ACTIVE_SETUP_NOT_ACTIVE_CORRECTION_DEGREE"],
        };

  const summary = buildPlainEnglishSummary({
    symbol,
    degrees,
    stackBias,
    chaseRisk,
    activeTradingDegree,
  });

  const reasonCodes = [
    "ENGINE22_WAVE_FIB_STATE_BUILT",
    stackBias,
    activeTradingDegree?.reason || null,
    chaseRisk?.degree ? `CHASE_RISK_FROM_${chaseRisk.degree.toUpperCase()}` : null,
  ].filter(Boolean);

  const partialWaveFibState = {
    ok: true,
    engine: "engine22.waveFibState.v1",
    symbol,
    currentPrice: round2(currentPrice),

    stackBias,
    activeTradingDegree: activeTradingDegree.degree,
    activeSetup: activeTradingDegree.setup,
    activeTradingDegreeReason: activeTradingDegree.reason,

    chaseRisk: chaseRisk.risk,
    chaseRiskDegree: chaseRisk.degree,

    degrees,
    microW4AbcRisk,
    abcCorrection,
    waveDuration,

    summary,
    reasonCodes,
  };

  const tradeContextSummary = buildTradeContextSummary({
    waveFibState: partialWaveFibState,
  });

  return {
    ok: true,
    engine: "engine22.waveFibState.v1",
    symbol,
    currentPrice: round2(currentPrice),

    stackBias,
    activeTradingDegree: activeTradingDegree.degree,
    activeSetup: activeTradingDegree.setup,
    activeTradingDegreeReason: activeTradingDegree.reason,

    chaseRisk: chaseRisk.risk,
    chaseRiskDegree: chaseRisk.degree,

    degrees,
    microW4AbcRisk,
    abcCorrection,
    waveDuration,
    tradeContextSummary,

    regimeContext: regimeLayers || null,

    reactionContext: reactionContext || null,
    volumeContext: volumeContext || null,

    summary,
    reasonCodes,
  };
}

export default analyzeWaveStack;
