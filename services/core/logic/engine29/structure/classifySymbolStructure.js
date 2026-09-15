// services/core/logic/engine29/structure/classifySymbolStructure.js

import {
  ENGINE29_STRESS_DIRECTIONS,
  ENGINE29_SYMBOL_STATES,
  ENGINE29_CONFIDENCE,
} from "../constants.js";

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isBeyondStressLevel({ direction, close, support, resistance }) {
  if (direction === ENGINE29_STRESS_DIRECTIONS.LOWER) {
    return Number.isFinite(close) && Number.isFinite(support) && close < support;
  }
  if (direction === ENGINE29_STRESS_DIRECTIONS.HIGHER) {
    return Number.isFinite(close) && Number.isFinite(resistance) && close > resistance;
  }
  return false;
}

function countCompletedClosesBeyond({ bars, direction, level }) {
  if (!Number.isFinite(level)) return 0;
  let count = 0;
  for (let i = bars.length - 1; i >= 0; i -= 1) {
    const bar = bars[i];
    if (!bar?.completed) continue;
    const close = finite(bar.close);
    if (!Number.isFinite(close)) continue;

    const beyond =
      direction === ENGINE29_STRESS_DIRECTIONS.LOWER ? close < level : close > level;

    if (!beyond) break;
    count += 1;
  }
  return count;
}

function stressEmaEvidence({ direction, latest }) {
  const close = finite(latest?.close);
  const ema10 = finite(latest?.ema10);
  const ema20 = finite(latest?.ema20);
  const ema50 = finite(latest?.ema50);

  if (!Number.isFinite(close)) return { fast: false, medium: false, deep: false };

  if (direction === ENGINE29_STRESS_DIRECTIONS.LOWER) {
    return {
      fast: Number.isFinite(ema10) && close < ema10,
      medium: Number.isFinite(ema20) && close < ema20,
      deep: Number.isFinite(ema50) && close < ema50,
    };
  }

  if (direction === ENGINE29_STRESS_DIRECTIONS.HIGHER) {
    return {
      fast: Number.isFinite(ema10) && close > ema10,
      medium: Number.isFinite(ema20) && close > ema20,
      deep: Number.isFinite(ema50) && close > ema50,
    };
  }

  return { fast: false, medium: false, deep: false };
}

function nearStressLevel({ direction, distanceFromSupportPct, distanceFromResistancePct, thresholdPct }) {
  if (direction === ENGINE29_STRESS_DIRECTIONS.LOWER && Number.isFinite(distanceFromSupportPct)) {
    return distanceFromSupportPct >= 0 && distanceFromSupportPct <= thresholdPct;
  }
  if (direction === ENGINE29_STRESS_DIRECTIONS.HIGHER && Number.isFinite(distanceFromResistancePct)) {
    return distanceFromResistancePct <= 0 && Math.abs(distanceFromResistancePct) <= thresholdPct;
  }
  return false;
}

function deriveConfidence({ evidenceQuality, completedBars, hasLevel, hasEma20 }) {
  if (evidenceQuality === "MISSING" || completedBars < 20) return ENGINE29_CONFIDENCE.LOW;
  if (evidenceQuality === "PROXY" || !hasLevel || !hasEma20) return ENGINE29_CONFIDENCE.MEDIUM;
  return ENGINE29_CONFIDENCE.HIGH;
}

export function classifySymbolStructure({
  bars = [],
  stressDirection,
  evidenceQuality = "DIRECT",
  levels = {},
  swingSummary = {},
  testingThresholdPct = 1.5,
} = {}) {
  const latest = bars.at(-1) || null;
  if (!latest) {
    return {
      state: null,
      stage: "NO_DATA",
      confidence: ENGINE29_CONFIDENCE.LOW,
      contextual: stressDirection === ENGINE29_STRESS_DIRECTIONS.CONTEXTUAL,
      evidence: {},
    };
  }

  const close = finite(latest.close);
  const support = finite(levels.recentSupport);
  const resistance = finite(levels.recentResistance);
  const currentBeyond = isBeyondStressLevel({
    direction: stressDirection,
    close,
    support,
    resistance,
  });

  const referenceLevel =
    stressDirection === ENGINE29_STRESS_DIRECTIONS.LOWER ? support : resistance;
  const persistenceCount = countCompletedClosesBeyond({
    bars,
    direction: stressDirection,
    level: referenceLevel,
  });

  const ema = stressEmaEvidence({ direction: stressDirection, latest });
  const nearLevel = nearStressLevel({
    direction: stressDirection,
    distanceFromSupportPct: levels.distanceFromSupportPct,
    distanceFromResistancePct: levels.distanceFromResistancePct,
    thresholdPct: testingThresholdPct,
  });

  const bearishSwingStress = swingSummary.trend === "BEARISH";
  const bullishSwingStress = swingSummary.trend === "BULLISH";
  const swingStress =
    stressDirection === ENGINE29_STRESS_DIRECTIONS.LOWER
      ? bearishSwingStress
      : stressDirection === ENGINE29_STRESS_DIRECTIONS.HIGHER
        ? bullishSwingStress
        : false;

  const latestCompleted = Boolean(latest.completed);
  const intraperiodBreak = currentBeyond && !latestCompleted;
  const completedBreak = currentBeyond && latestCompleted;
  const confirmedBreak = persistenceCount >= 2;

  // Reclaim detection: prior completed bar was beyond the level, current close is back through it.
  const priorCompleted = [...bars].reverse().find((bar, idx) => idx > 0 && bar?.completed) || null;
  const priorClose = finite(priorCompleted?.close);
  let recovering = false;
  if (Number.isFinite(referenceLevel) && Number.isFinite(priorClose) && Number.isFinite(close)) {
    if (stressDirection === ENGINE29_STRESS_DIRECTIONS.LOWER) {
      recovering = priorClose < referenceLevel && close >= referenceLevel;
    } else if (stressDirection === ENGINE29_STRESS_DIRECTIONS.HIGHER) {
      recovering = priorClose > referenceLevel && close <= referenceLevel;
    }
  }

  let state = ENGINE29_SYMBOL_STATES.HEALTHY;
  let stage = "NORMAL";

  if (stressDirection === ENGINE29_STRESS_DIRECTIONS.CONTEXTUAL) {
    state = null;
    stage = "CONTEXTUAL";
  } else if (recovering) {
    state = ENGINE29_SYMBOL_STATES.RECOVERING;
    stage = "RECOVERING";
  } else if (confirmedBreak) {
    state = ENGINE29_SYMBOL_STATES.CONFIRMED_BREAK;
    stage = "CONFIRMED_BREAK";
  } else if (completedBreak) {
    state = ENGINE29_SYMBOL_STATES.BREAKING;
    stage = "COMPLETED_CLOSE_BREAK";
  } else if (intraperiodBreak) {
    state = ENGINE29_SYMBOL_STATES.BREAKING;
    stage = "INTRAPERIOD_BREAK";
  } else if (ema.fast && ema.medium && swingStress) {
    state = ENGINE29_SYMBOL_STATES.BREAKING;
    stage = "TREND_BREAKING";
  } else if (nearLevel) {
    state = ENGINE29_SYMBOL_STATES.WARNING;
    stage = "TESTING_STRESS_LEVEL";
  } else if (ema.fast || swingStress) {
    state = ENGINE29_SYMBOL_STATES.WARNING;
    stage = "WARNING";
  }

  const completedBars = bars.filter((bar) => bar?.completed).length;
  const confidence = deriveConfidence({
    evidenceQuality,
    completedBars,
    hasLevel: Number.isFinite(referenceLevel),
    hasEma20: Number.isFinite(finite(latest.ema20)),
  });

  return {
    state,
    stage,
    confidence,
    contextual: stressDirection === ENGINE29_STRESS_DIRECTIONS.CONTEXTUAL,
    evidence: {
      currentBeyondStressLevel: currentBeyond,
      intraperiodBreak,
      completedBreak,
      persistenceCount,
      confirmedBreak,
      recovering,
      testingStressLevel: nearLevel,
      belowOrAboveEma10InStressDirection: ema.fast,
      belowOrAboveEma20InStressDirection: ema.medium,
      belowOrAboveEma50InStressDirection: ema.deep,
      swingStress,
      latestCompleted,
    },
  };
}
