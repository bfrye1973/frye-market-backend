// services/core/logic/marketRegime.js
//
// Market Regime Helper
//
// PURPOSE
// - Conscious brain
// - Direction comes from 30m + 1h
// - Strictness comes from 4h + EOD
// - 10m is execution pulse / extra context
// - MASTER is NOT used here

function toNum(x, fb = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}

export function defaultMarketRegime(reason = "NO_MARKET_REGIME") {
  return {
    regime: "UNKNOWN",
    directionBias: "NONE",
    strictness: "MEDIUM",
    directionSource: "UNKNOWN",
    strictnessSource: "UNKNOWN",
    reasonCodes: [reason],
    proxyUsed: false,
    scores: {
      m10: null,
      m30: null,
      h1: null,
      h4: null,
      eod: null,
    },
    states: {
      m10: null,
      m30: null,
      h1: null,
      h4: null,
      eod: null,
    },
  };
}

export function computeMarketRegime(input = {}) {
  const m10 = toNum(input?.score10m ?? input?.m10 ?? input?.["10m"]);
  const m30 = toNum(input?.score30m ?? input?.m30 ?? input?.["30m"]);
  const h1  = toNum(input?.score1h  ?? input?.h1  ?? input?.["1h"]);
  const h4  = toNum(input?.score4h  ?? input?.h4  ?? input?.["4h"]);
  const eod = toNum(input?.scoreEOD ?? input?.eod ?? input?.EOD);

  const state10m = input?.state10m ?? null;
  const state30m = input?.state30m ?? null;
  const state1h  = input?.state1h ?? null;
  const state4h  = input?.state4h ?? null;
  const stateEOD = input?.stateEOD ?? null;

  const reasonCodes = [];

  const directionLong =
    Number.isFinite(m30) &&
    Number.isFinite(h1) &&
    m30 >= 50 &&
    h1 >= 55;

  const directionShort =
    Number.isFinite(m30) &&
    Number.isFinite(h1) &&
    m30 <= 50 &&
    h1 <= 45;

  const h4Bull = Number.isFinite(h4) && h4 >= 50;
  const h4Bear = Number.isFinite(h4) && h4 <= 50;

  const eodBull = Number.isFinite(eod) && eod >= 50;
  const eodBear = Number.isFinite(eod) && eod <= 45;

  const clusteringValues = [m30, h1, h4, eod].filter(Number.isFinite);
  const clusteredNeutral =
    clusteringValues.length >= 3 &&
    clusteringValues.every((v) => v >= 45 && v <= 55);

  let regime = "NEUTRAL";
  let directionBias = "NONE";
  let strictness = "HIGH";
  let directionSource = "30M_1H";
  let strictnessSource = "4H_EOD";

  if (directionLong && h4Bull && eodBull) {
    regime = "BULLISH";
    directionBias = "LONG";
    strictness = "LOW";
    reasonCodes.push("DIRECTION_LONG_30M_1H");
    reasonCodes.push("STRICTNESS_LOW_4H_EOD_SUPPORT");
  } else if (directionShort && h4Bear && eodBear) {
    regime = "BEARISH";
    directionBias = "SHORT";
    strictness = "LOW";
    reasonCodes.push("DIRECTION_SHORT_30M_1H");
    reasonCodes.push("STRICTNESS_LOW_4H_EOD_SUPPORT");
  } else if (directionLong) {
    regime = "TRANSITION";
    directionBias = "LONG";
    strictness = eodBull ? "MEDIUM" : "HIGH";
    reasonCodes.push("DIRECTION_LONG_30M_1H");
    reasonCodes.push("TRANSITION_4H_OR_EOD_NOT_FULLY_ALIGNED");
  } else if (directionShort) {
    regime = "TRANSITION";
    directionBias = "SHORT";
    strictness = eodBear ? "MEDIUM" : "HIGH";
    reasonCodes.push("DIRECTION_SHORT_30M_1H");
    reasonCodes.push("TRANSITION_4H_OR_EOD_NOT_FULLY_ALIGNED");
  } else if (clusteredNeutral) {
    regime = "NEUTRAL";
    directionBias = "NONE";
    strictness = "HIGH";
    reasonCodes.push("SCORES_CLUSTERED_NEUTRAL");
  } else {
    regime = "NEUTRAL";
    directionBias = "NONE";
    strictness = "HIGH";
    reasonCodes.push("NO_CLEAR_DIRECTION_ALIGNMENT");
  }

  return {
    regime,
    directionBias,
    strictness,
    directionSource,
    strictnessSource,
    reasonCodes,
    proxyUsed: false,
    scores: {
      m10,
      m30,
      h1,
      h4,
      eod,
    },
    states: {
      m10: state10m,
      m30: state30m,
      h1: state1h,
      h4: state4h,
      eod: stateEOD,
    },
  };
}

export default computeMarketRegime;
