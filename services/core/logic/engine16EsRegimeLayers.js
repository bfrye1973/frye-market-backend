cd /opt/render/project/src/services/core

// services/core/logic/engine16EsRegimeLayers.js
// Engine 16ES — ES Regime Layers / Structure Truth Engine
//
// Mission:
// EOD = permission
// 4H  = higher-timeframe trend / swing pressure
// 1H  = pullback health
// 10m = trigger timing
//
// This is NOT Morning Fib.
// This does NOT create GO / ENTRY / BUY / SELL.
// Engine 16ES only provides clean structure truth for Engine 22 and Engine 15.

const NEAR_EMA10_PTS_ES = 6;

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function isFiniteNum(x) {
  return Number.isFinite(Number(x));
}

function toNum(x, fb = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}

function boolFromPosture(p, key = "aboveEma10") {
  if (typeof p?.[key] === "boolean") return p[key];

  const close = toNum(p?.close);
  const ema =
    key === "aboveEma20"
      ? toNum(p?.ema20)
      : toNum(p?.ema10);

  if (!Number.isFinite(close) || !Number.isFinite(ema)) return null;
  return close > ema;
}

function distance(close, ema) {
  const c = toNum(close);
  const e = toNum(ema);
  if (!Number.isFinite(c) || !Number.isFinite(e)) return null;
  return round2(c - e);
}

function nearEma10(close, ema10) {
  const d = distance(close, ema10);
  return Number.isFinite(d) && Math.abs(d) <= NEAR_EMA10_PTS_ES;
}

function trendStateFromAbove(above) {
  if (above === true) return "LONG_ONLY";
  if (above === false) return "SHORT_ONLY";
  return "NEUTRAL";
}

function safePosture(p = {}) {
  const close = toNum(p?.close);
  const ema10 = toNum(p?.ema10);
  const ema20 = toNum(p?.ema20);

  const aboveEma10 = boolFromPosture(p, "aboveEma10");
  const aboveEma20 = boolFromPosture(p, "aboveEma20");

  return {
    close,
    ema10,
    ema20,
    aboveEma10,
    aboveEma20,
    distanceToEma10: distance(close, ema10),
    distanceToEma20: distance(close, ema20),
    nearEma10: nearEma10(close, ema10),
    raw: p || null,
  };
}

function buildTrigger10m(emaPosture) {
  const p = safePosture(emaPosture?.tenMinute || {});
  const { close, ema10, ema20, aboveEma10, aboveEma20 } = p;

  let state = "MIXED_TRIGGER_LAYER";
  let score = 0;

  if (aboveEma10 === true && aboveEma20 === true) {
    state = "TRIGGER_READY";
    score = 25;
  } else if (aboveEma10 === true && aboveEma20 !== true) {
    state = "ABOVE_EMA10";
    score = 15;
  } else if (aboveEma10 === false && p.nearEma10 === true) {
    state = "RECLAIM_WATCH";
    score = 8;
  } else if (aboveEma10 === false && aboveEma20 === false) {
    state = "BELOW_EMA10_EMA20";
    score = 0;
  } else if (aboveEma10 === true && aboveEma20 === true) {
    state = "ABOVE_EMA10_EMA20";
    score = 25;
  }

  return {
    timeframe: "10m",
    close: round2(close),
    ema10: round2(ema10),
    ema20: round2(ema20),
    distanceToEma10: p.distanceToEma10,
    distanceToEma20: p.distanceToEma20,
    aboveEma10,
    aboveEma20,
    nearEma10: p.nearEma10,
    state,
    score,
    trendState: trendStateFromAbove(aboveEma10),
    source: "EMA_POSTURE_TEN_MINUTE",
  };
}

function buildPullback1h(emaPosture, dailyAbove, fourHourAbove) {
  const p = safePosture(emaPosture?.oneHour || {});
  const above = p.aboveEma10;

  let state = "PULLBACK_CAUTION";
  let score = 10;

  if (above === true) {
    state = "HEALTHY_PULLBACK";
    score = 25;
  } else if (above === false && dailyAbove === true && fourHourAbove === true) {
    state = "PULLBACK_CAUTION";
    score = 10;
  } else if (above === false) {
    state = "FAILING_PULLBACK";
    score = 0;
  }

  return {
    timeframe: "1h",
    close: round2(p.close),
    ema10: round2(p.ema10),
    distanceToEma10: p.distanceToEma10,
    aboveEma10: above,
    nearEma10: p.nearEma10,
    state,
    score,
    trendState: trendStateFromAbove(above),
    source: "EMA_POSTURE_ONE_HOUR",
  };
}

function buildTrend4h(emaPosture) {
  const p = safePosture(emaPosture?.fourHour || {});
  const above = p.aboveEma10;

  let state = "HTF_WARNING";
  let score = 15;

  if (above === true) {
    state = "HTF_TREND_SUPPORTING";
    score = 30;
  } else if (above === false && p.nearEma10 === true) {
    state = "HTF_WARNING";
    score = 15;
  } else if (above === false) {
    state = "HTF_TREND_FAILING";
    score = 0;
  }

  return {
    timeframe: "4h",
    close: round2(p.close),
    ema10: round2(p.ema10),
    distanceToEma10: p.distanceToEma10,
    aboveEma10: above,
    nearEma10: p.nearEma10,
    state,
    score,
    trendState: trendStateFromAbove(above),
    source: "EMA_POSTURE_FOUR_HOUR",
  };
}

function buildRegimeEod(emaPosture) {
  const p = safePosture(emaPosture?.daily || {});
  const above = p.aboveEma10;

  let state = "EOD_NEUTRAL";
  let score = 10;

  if (above === true) {
    state = "EOD_LONG_PERMISSION";
    score = 20;
  } else if (above === false && p.nearEma10 === true) {
    state = "EOD_NEUTRAL";
    score = 10;
  } else if (above === false) {
    state = "EOD_RISK_OFF";
    score = 0;
  }

  return {
    timeframe: "1d",
    close: round2(p.close),
    ema10: round2(p.ema10),
    distanceToEma10: p.distanceToEma10,
    aboveEma10: above,
    nearEma10: p.nearEma10,
    dipBuyPermission: above === true,
    state,
    score,
    trendState: trendStateFromAbove(above),
    source: "EMA_POSTURE_DAILY",
  };
}

function deriveDirectionBias({ dailyAbove, fourHourAbove }) {
  if (dailyAbove === true && fourHourAbove === true) return "LONG";
  if (dailyAbove === true && fourHourAbove !== true) return "LONG_CAUTION";
  if (dailyAbove !== true && fourHourAbove !== true) return "NEUTRAL_OR_SHORT";
  return "NEUTRAL";
}

function deriveSetupPosture({ dailyAbove, fourHourAbove, oneHourAbove, tenAbove10, tenAbove20 }) {
  if (
    dailyAbove === true &&
    fourHourAbove === true &&
    oneHourAbove === true &&
    tenAbove10 === true &&
    tenAbove20 === true
  ) {
    return "BULLISH_ALIGNMENT";
  }

  if (
    dailyAbove === true &&
    fourHourAbove === true &&
    (oneHourAbove !== true || tenAbove10 !== true || tenAbove20 !== true)
  ) {
    return "PULLBACK_WITH_HTF_SUPPORT";
  }

  if (
    dailyAbove === false &&
    fourHourAbove === false &&
    oneHourAbove === false &&
    tenAbove10 === false &&
    tenAbove20 === false
  ) {
    return "RISK_OFF";
  }

  return "MIXED_REGIME";
}

function deriveReadiness({ dailyAbove, fourHourAbove, oneHourAbove, tenAbove10, tenAbove20 }) {
  const needs = [];

  if (
    dailyAbove === true &&
    fourHourAbove === true &&
    oneHourAbove === true &&
    tenAbove10 === true &&
    tenAbove20 === true
  ) {
    return {
      readiness: "READY",
      needs,
    };
  }

  if (dailyAbove === true && fourHourAbove === true) {
    if (oneHourAbove !== true) needs.push("1H_STABILIZATION");
    if (tenAbove10 !== true) needs.push("10M_RECLAIM_EMA10");
    if (tenAbove20 !== true) needs.push("10M_RECLAIM_EMA20");

    return {
      readiness: "WATCH",
      needs: needs.length ? needs : ["WAIT_FOR_TRIGGER_CONFIRMATION"],
    };
  }

  if (
    dailyAbove === false &&
    fourHourAbove === false &&
    oneHourAbove === false &&
    tenAbove10 === false
  ) {
    return {
      readiness: "STAND_DOWN",
      needs: ["EOD_RECLAIM_EMA10", "4H_RECLAIM_EMA10"],
    };
  }

  return {
    readiness: "WATCH",
    needs: ["REGIME_ALIGNMENT_NEEDED"],
  };
}

function deriveReasonCodes({ regimeEod, trend4h, pullback1h, trigger10m }) {
  const out = [];

  if (regimeEod?.state) out.push(regimeEod.state);

  if (trend4h?.state === "HTF_TREND_SUPPORTING") {
    out.push("FOUR_HOUR_TREND_SUPPORTING");
  } else if (trend4h?.state === "HTF_WARNING") {
    out.push("FOUR_HOUR_TREND_WARNING");
  } else if (trend4h?.state === "HTF_TREND_FAILING") {
    out.push("FOUR_HOUR_TREND_FAILING");
  }

  if (pullback1h?.state === "HEALTHY_PULLBACK") {
    out.push("ONE_HOUR_PULLBACK_HEALTHY");
  } else if (pullback1h?.state === "PULLBACK_CAUTION") {
    out.push("ONE_HOUR_PULLBACK_CAUTION");
  } else if (pullback1h?.state === "FAILING_PULLBACK") {
    out.push("ONE_HOUR_PULLBACK_FAILING");
  }

  if (trigger10m?.state === "TRIGGER_READY" || trigger10m?.state === "ABOVE_EMA10_EMA20") {
    out.push("TEN_MIN_TRIGGER_READY");
  } else if (trigger10m?.state === "RECLAIM_WATCH") {
    out.push("TEN_MIN_RECLAIM_WATCH");
  } else if (trigger10m?.state === "BELOW_EMA10_EMA20") {
    out.push("TEN_MIN_NO_TRIGGER");
  } else {
    out.push("TEN_MIN_MIXED_TRIGGER_LAYER");
  }

  return [...new Set(out)];
}

function buildSummary({ regimeEod, trend4h, pullback1h, trigger10m, readiness, needs }) {
  const displayLines = [
    `EOD: ${regimeEod?.state || "UNKNOWN"}`,
    `4H: ${trend4h?.state || "UNKNOWN"}`,
    `1H: ${pullback1h?.state || "UNKNOWN"}`,
    `10m: ${trigger10m?.state || "UNKNOWN"}`,
  ];

  let nextStep = "Wait for cleaner alignment.";

  if (readiness === "READY") {
    nextStep = "Structure is aligned. Engine 22 and Engine 15 must still confirm opportunity and permission.";
  } else if (Array.isArray(needs) && needs.length) {
    nextStep = needs.join(" + ");
  }

  let plainEnglish = "ES regime is mixed. Wait for cleaner confirmation.";

  if (
    regimeEod?.state === "EOD_LONG_PERMISSION" &&
    trend4h?.state === "HTF_TREND_SUPPORTING" &&
    readiness === "WATCH"
  ) {
    plainEnglish =
      "Daily and 4H still support longs, but the lower timeframe trigger is not fully ready yet. Wait for 10m reclaim and 1H stabilization.";
  } else if (readiness === "READY") {
    plainEnglish =
      "Daily, 4H, 1H, and 10m structure are aligned. Engine 22 must identify the scalp opportunity and Engine 15 must approve the final decision.";
  } else if (readiness === "STAND_DOWN") {
    plainEnglish =
      "Daily, 4H, 1H, and 10m structure are weak. Stand down until higher timeframe structure improves.";
  }

  return {
    plainEnglish,
    nextStep,
    displayLines,
  };
}

export async function computeEngine16EsRegimeLayers({
  symbol = "ES",
  emaPosture = null,
  engine2State = null,
  reaction = null,
  volume = null,
} = {}) {
  const sym = String(symbol || "ES").toUpperCase();

  if (sym !== "ES" && sym !== "MES") {
    return {
      ok: false,
      symbol: sym,
      mode: "ES_REGIME_LAYERS",
      error: "UNSUPPORTED_SYMBOL_FOR_ENGINE16ES",
      reasonCodes: ["ENGINE16ES_ONLY_SUPPORTS_ES_PHASE1"],
    };
  }

  const trigger10m = buildTrigger10m(emaPosture);
  const trend4h = buildTrend4h(emaPosture);
  const regimeEod = buildRegimeEod(emaPosture);

  const dailyAbove = regimeEod.aboveEma10;
  const fourHourAbove = trend4h.aboveEma10;

  const pullback1h = buildPullback1h(emaPosture, dailyAbove, fourHourAbove);

  const oneHourAbove = pullback1h.aboveEma10;
  const tenAbove10 = trigger10m.aboveEma10;
  const tenAbove20 = trigger10m.aboveEma20;

  const directionBias = deriveDirectionBias({
    dailyAbove,
    fourHourAbove,
  });

  const setupPosture = deriveSetupPosture({
    dailyAbove,
    fourHourAbove,
    oneHourAbove,
    tenAbove10,
    tenAbove20,
  });

  const readinessInfo = deriveReadiness({
    dailyAbove,
    fourHourAbove,
    oneHourAbove,
    tenAbove10,
    tenAbove20,
  });

  const reasonCodes = deriveReasonCodes({
    regimeEod,
    trend4h,
    pullback1h,
    trigger10m,
  });

  const totalScore = [
    trigger10m?.score,
    pullback1h?.score,
    trend4h?.score,
    regimeEod?.score,
  ]
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x))
    .reduce((a, b) => a + b, 0);

  const summary = buildSummary({
    regimeEod,
    trend4h,
    pullback1h,
    trigger10m,
    readiness: readinessInfo.readiness,
    needs: readinessInfo.needs,
  });

  return {
    ok: true,
    symbol: sym,
    mode: "ES_REGIME_LAYERS",

    regimeLayers: {
      trigger10m,
      pullback1h,
      trend4h,
      regimeEod,
    },

    setupPosture,
    directionBias,
    readiness: readinessInfo.readiness,
    needs: readinessInfo.needs,
    reasonCodes,

    score: totalScore,
    maxScore: 100,

    summary,

    context: {
      engine2Available: engine2State != null,
      reactionAvailable: reaction != null,
      volumeAvailable: volume != null,
      phase1Uses: "EMA_POSTURE_PRIMARY",
    },

    meta: {
      nearEma10Pts: NEAR_EMA10_PTS_ES,
      createdBy: "engine16EsRegimeLayers",
      version: "engine16es.regimeLayers.v1",
    },
  };
}

export default computeEngine16EsRegimeLayers;
EOF
