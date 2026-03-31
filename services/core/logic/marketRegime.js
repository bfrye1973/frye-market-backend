// services/core/logic/marketRegime.js
//
// Market Regime Helper
//
// PURPOSE
// - Conscious brain
// - Direction comes from 30m + 1h
// - Strictness comes from 4h + EOD
// - MASTER is NOT used here
//
// OPTION 1 (v1):
// - OVERALL scores only
// - simple, safe, easy to validate

function toNum(x, fb = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}

function safeUpper(x, fallback = "") {
  const s = String(x ?? fallback).trim().toUpperCase();
  return s || fallback;
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
  };
}

export function computeMarketRegime(input = {}) {
  const m10 = toNum(
    input?.score10m ??
      input?.m10 ??
      input?.["10m"]
  );

  const m30Raw =
    input?.score30m ??
    input?.score30min ??
    input?.m30 ??
    input?.["30m"];

  const m30 = toNum(m30Raw, null);
  const used30mProxy = m30 == null && m10 != null;
  const effective30m = m30 != null ? m30 : m10;

  const h1 = toNum(
    input?.score1h ??
      input?.h1 ??
      input?.["1h"]
  );

  const h4 = toNum(
    input?.score4h ??
      input?.h4 ??
      input?.["4h"]
  );

  const eod = toNum(
    input?.scoreEOD ??
      input?.scoreEod ??
      input?.eod ??
      input?.EOD
  );

  const reasonCodes = [];

  if (used30mProxy) {
    reasonCodes.push("PROXY_30M_FROM_10M");
  }

  const directionLong =
    Number.isFinite(h1) &&
    Number.isFinite(effective30m) &&
    h1 >= 55 &&
    effective30m >= 50;

  const directionShort =
    Number.isFinite(h1) &&
    Number.isFinite(effective30m) &&
    h1 <= 45 &&
    effective30m <= 50;

  const h4Bull = Number.isFinite(h4) && h4 >= 50;
  const h4Bear = Number.isFinite(h4) && h4 <= 50;

  const eodBull = Number.isFinite(eod) && eod >= 50;
  const eodBear = Number.isFinite(eod) && eod <= 45;

  const clusteringValues = [effective30m, h1, h4, eod].filter(Number.isFinite);
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
    proxyUsed: used30mProxy,
    scores: {
      m10,
      m30: effective30m,
      h1,
      h4,
      eod,
    },
  };
}

export default computeMarketRegime;
