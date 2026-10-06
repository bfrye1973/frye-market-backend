// services/core/logic/engine25/buildMacroPressure.js
// Engine 25 Macro Pressure v2 — unique macro inputs only.
//
// Active score:
// - DGS2 / Fed-policy pressure: 30%
// - T10Y2Y / yield-curve pressure: 20%
// - UUP / dollar pressure: 20%
// - Engine29 Energy/Oil authority: 30%
//
// DGS10, TLT, headline indexes, AI breadth, narrow leadership, and inflation
// are diagnostic/non-scoring here. Their scoring authority remains elsewhere.

import { buildEnergyAuthority } from "./engine29/buildEnergyAuthority.js";

export const MACRO_PRESSURE_WEIGHTS = Object.freeze({
  DGS2: 0.30,
  T10Y2Y: 0.20,
  UUP: 0.20,
  ENERGY: 0.30,
});

function isNum(value) {
  if (value === null || value === undefined || value === "") return false;
  return Number.isFinite(Number(value));
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function weightedAvg(items) {
  const valid = items.filter(
    (item) => isNum(item?.value) && isNum(item?.weight) && Number(item.weight) > 0
  );
  if (!valid.length) return 50;
  const totalWeight = valid.reduce((sum, item) => sum + Number(item.weight), 0);
  return clamp(
    valid.reduce(
      (sum, item) => sum + Number(item.value) * Number(item.weight),
      0
    ) / totalWeight
  );
}

function scoreDirect(value, badBelow, goodAbove) {
  if (!isNum(value)) return 50;
  const n = Number(value);
  if (n <= badBelow) return 0;
  if (n >= goodAbove) return 100;
  return clamp(((n - badBelow) / (goodAbove - badBelow)) * 100);
}

function scoreInverse(value, goodBelow, badAbove) {
  if (!isNum(value)) return 50;
  const n = Number(value);
  if (n <= goodBelow) return 100;
  if (n >= badAbove) return 0;
  return clamp(100 - ((n - goodBelow) / (badAbove - goodBelow)) * 100);
}

function boolScore(value, whenTrue, whenFalse) {
  if (value === true) return whenTrue;
  if (value === false) return whenFalse;
  return 50;
}

function getFredValue(macroData, key) {
  const value = macroData?.sources?.fred?.latest?.[key]?.value;
  return isNum(value) ? Number(value) : null;
}

function getSymbol(marketData, group, symbol) {
  return marketData?.quickRead?.[group]?.[symbol] ?? null;
}

export function buildMacroPressure({
  macroData = null,
  marketData = null,
  engine29Data = null,
} = {}) {
  const tenYear = getFredValue(macroData, "DGS10");
  const twoYear = getFredValue(macroData, "DGS2");
  const tenMinusTwo = getFredValue(macroData, "T10Y2Y");

  const uso = getSymbol(marketData, "macroProxies", "USO");
  const tlt = getSymbol(marketData, "macroProxies", "TLT");
  const uup = getSymbol(marketData, "macroProxies", "UUP");

  const spy = getSymbol(marketData, "marketTrend", "SPY");
  const qqq = getSymbol(marketData, "marketTrend", "QQQ");
  const iwm = getSymbol(marketData, "marketTrend", "IWM");

  const ai = marketData?.quickRead?.aiLeadership || {};
  const aiSymbols = [
    "NVDA", "MSFT", "AVGO", "AMD", "META",
    "GOOGL", "AMZN", "TSM", "ARM", "PLTR",
  ];
  const aiAbove20 = aiSymbols.filter((symbol) => ai[symbol]?.aboveEma20 === true).length;
  const aiAbove50 = aiSymbols.filter((symbol) => ai[symbol]?.aboveEma50 === true).length;

  const twoYearPressureScore = scoreInverse(twoYear, 4.0, 5.0);
  const curvePressureScore = scoreDirect(tenMinusTwo, -0.5, 0.75);

  const dollarPressureScore = weightedAvg([
    { value: boolScore(uup?.aboveEma20, 35, 75), weight: 0.4 },
    { value: scoreInverse(uup?.pctChange20d, 1, 6), weight: 0.6 },
  ]);

  const legacyOilPressureScore = weightedAvg([
    { value: boolScore(uso?.aboveEma20, 30, 80), weight: 0.35 },
    { value: boolScore(uso?.aboveEma50, 30, 80), weight: 0.25 },
    { value: scoreInverse(uso?.pctChange20d, 2, 15), weight: 0.4 },
  ]);

  const energyAuthority = buildEnergyAuthority({
    engine29Data,
    legacyOilPressureScore,
    legacyUso: uso,
  });
  const oilPressureScore = energyAuthority.score;

  // Diagnostic only. These values have no path into the active score.
  const smallCapParticipationScore = weightedAvg([
    { value: boolScore(iwm?.aboveEma20, 100, 0), weight: 0.45 },
    { value: boolScore(iwm?.aboveEma50, 100, 0), weight: 0.25 },
    { value: scoreDirect(iwm?.pctChange20d, -5, 5), weight: 0.3 },
  ]);
  const aiBreadthScore = weightedAvg([
    { value: scoreDirect(aiAbove20, 3, 8), weight: 0.6 },
    { value: scoreDirect(aiAbove50, 3, 8), weight: 0.4 },
  ]);
  const narrowLeadershipScore = weightedAvg([
    { value: smallCapParticipationScore, weight: 0.45 },
    { value: aiBreadthScore, weight: 0.55 },
  ]);

  const score = weightedAvg([
    { value: twoYearPressureScore, weight: MACRO_PRESSURE_WEIGHTS.DGS2 },
    { value: curvePressureScore, weight: MACRO_PRESSURE_WEIGHTS.T10Y2Y },
    { value: dollarPressureScore, weight: MACRO_PRESSURE_WEIGHTS.UUP },
    { value: oilPressureScore, weight: MACRO_PRESSURE_WEIGHTS.ENERGY },
  ]);

  const warnings = [];

  if (isNum(twoYear) && Number(twoYear) >= 4.25) {
    warnings.push("2Y yield suggests Fed-policy pressure");
  }
  if (isNum(tenMinusTwo) && Number(tenMinusTwo) < 0) {
    warnings.push("Yield curve remains inverted; structural macro pressure elevated");
  }
  if (uup?.aboveEma20 === true && isNum(uup?.pctChange20d) && Number(uup.pctChange20d) >= 1) {
    warnings.push("Dollar strength is adding macro tightening pressure");
  }
  if (Array.isArray(energyAuthority?.warnings)) {
    warnings.push(...energyAuthority.warnings);
  }

  return {
    score,
    label:
      score >= 75
        ? "MACRO_PRESSURE_LOW"
        : score >= 60
          ? "MACRO_PRESSURE_MANAGEABLE"
          : score >= 45
            ? "MACRO_PRESSURE_ELEVATED"
            : "MACRO_PRESSURE_HIGH",
    weights: { ...MACRO_PRESSURE_WEIGHTS },
    inputs: {
      twoYear,
      tenMinusTwo,
      UUP: uup,
      energyAuthority,
      twoYearPressureScore,
      curvePressureScore,
      dollarPressureScore,
      oilPressureScore,

      // Compatibility alias for engine25FullDashboard.js. NON-SCORING.
      TLT: tlt,
      TLTScoringRole: "DIAGNOSTIC_NON_SCORING_COMPATIBILITY_ALIAS",
    },
    diagnostics: {
      scoringRole: "NON_SCORING",
      DGS10: tenYear,
      TLT: tlt,
      SPY: spy,
      QQQ: qqq,
      IWM: iwm,
      aiBreadth: {
        aiAbove20,
        aiAbove50,
        aiBreadthScore,
      },
      narrowLeadership: {
        smallCapParticipationScore,
        aiBreadthScore,
        narrowLeadershipScore,
      },
    },
    warnings,
  };
}

export default buildMacroPressure;
