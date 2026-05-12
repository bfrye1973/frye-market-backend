// ES Futures Market Meter — V2
//
// GET /api/v1/futures/market-meter?symbol=ES
//
// V2 goal:
// - Keep ES separate from SPY Market Meter.
// - Use SPY-style logic for 10m / 30m / 1h.
// - 30m uses strict structure tiers like SPY 30m.
// - 1h gets hard caps when price is below 10/20 EMA.
// - 4h / EOD remain basic for now and will be tuned next.

import express from "express";

const router = express.Router();
export default router;

const TF_CONFIG = {
  "10m": { label: "10m", limit: 260, weight: 0.10 },
  "30m": { label: "30m", limit: 260, weight: 0.15 },
  "1h": { label: "1h", limit: 260, weight: 0.25 },
  "4h": { label: "4h", limit: 260, weight: 0.30 },
  "1d": { label: "EOD", limit: 260, weight: 0.20 },
};

const FULL_EMA_DIST_10M = 0.60;
const FULL_EMA_DIST_30M = 0.60;
const FULL_EMA_DIST_1H = 0.60;

const SMI_K_LEN = 12;
const SMI_D_LEN = 5;
const SMI_EMA_LEN = 5;

const SMI_BONUS_SCORE_MAX = 3.0;

const EMA_RECLAIM_TOL_PCT = Number(process.env.ES_EMA_RECLAIM_TOL_PCT || 0.10);
const EMA50_RECLAIM_TOL_PCT = Number(process.env.ES_EMA50_RECLAIM_TOL_PCT || 0.15);
const EMA_TREND_GAP_STRONG_PCT = Number(process.env.ES_EMA_TREND_GAP_STRONG_PCT || 0.20);

function nowIso() {
  return new Date().toISOString();
}

function clamp(x, lo = 0, hi = 100) {
  const n = Number(x);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function num(v, fallback = NaN) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v, places = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(places));
}

function avg(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return NaN;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function last(arr) {
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
}

function ema(values, length) {
  if (!Array.isArray(values) || !values.length) return [];

  const k = 2 / (length + 1);
  const out = [];
  let e = null;

  for (const raw of values) {
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    e = e === null ? v : e + k * (v - e);
    out.push(e);
  }

  return out;
}

function postureFromDist(distPct, fullDist) {
  const unit = clamp(Number(distPct) / Math.max(fullDist, 1e-9), -1, 1);
  return clamp(50 + 50 * unit, 0, 100);
}

function near(price, emaValue, tolPct) {
  if (!Number.isFinite(price) || !Number.isFinite(emaValue) || emaValue === 0) return false;
  return Math.abs(((price - emaValue) / emaValue) * 100) <= tolPct;
}

function calcTrueRanges(bars) {
  const out = [];

  for (let i = 1; i < bars.length; i += 1) {
    const h = num(bars[i].high);
    const l = num(bars[i].low);
    const pc = num(bars[i - 1].close);

    if (![h, l, pc].every(Number.isFinite)) continue;

    out.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }

  return out;
}

function luxPsi(closes, conv = 50, length = 20) {
  if (!Array.isArray(closes) || closes.length < length + 2) return null;

  let mx = null;
  let mn = null;
  const diffs = [];
  const eps = 1e-12;

  for (const raw of closes) {
    const src = Number(raw);
    if (!Number.isFinite(src)) continue;

    if (mx === null || mn === null) {
      mx = src;
      mn = src;
    } else {
      mx = Math.max(src, mx - (mx - src) / conv);
      mn = Math.min(src, mn + (src - mn) / conv);
    }

    diffs.push(Math.log(Math.max(mx - mn, eps)));
  }

  if (diffs.length < length) return null;

  const win = diffs.slice(-length);
  const xs = Array.from({ length }, (_, i) => i);

  const xbar = avg(xs);
  const ybar = avg(win);

  let numerator = 0;
  let denx = 0;
  let deny = 0;

  for (let i = 0; i < length; i += 1) {
    const dx = xs[i] - xbar;
    const dy = win[i] - ybar;
    numerator += dx * dy;
    denx += dx * dx;
    deny += dy * dy;
  }

  const den = Math.sqrt(denx * deny);
  const r = den > 0 ? numerator / den : 0;

  return clamp(-50 * r + 50, 0, 100);
}

function tvSmiAndSignal(bars, lengthK = SMI_K_LEN, lengthD = SMI_D_LEN, lengthEMA = SMI_EMA_LEN) {
  if (!Array.isArray(bars) || bars.length < Math.max(lengthK, lengthD, lengthEMA) + 5) {
    return { smi: null, signal: null, pct: 50, state: "NEUTRAL" };
  }

  const highs = bars.map((b) => num(b.high));
  const lows = bars.map((b) => num(b.low));
  const closes = bars.map((b) => num(b.close));

  const hh = [];
  const ll = [];

  for (let i = 0; i < closes.length; i += 1) {
    const start = Math.max(0, i - (lengthK - 1));
    hh.push(Math.max(...highs.slice(start, i + 1)));
    ll.push(Math.min(...lows.slice(start, i + 1)));
  }

  const rangeHL = hh.map((h, i) => h - ll[i]);
  const rel = closes.map((c, i) => c - (hh[i] + ll[i]) / 2);

  const emaEma = (vals, len) => ema(ema(vals, len), len);

  const nume = emaEma(rel, lengthD);
  const deno = emaEma(rangeHL, lengthD);

  const smiArr = [];

  for (let i = 0; i < Math.min(nume.length, deno.length); i += 1) {
    const d = deno[i];
    smiArr.push(!Number.isFinite(d) || d === 0 ? 0 : 200 * (nume[i] / d));
  }

  const sigArr = ema(smiArr, lengthEMA);
  const smiVal = last(smiArr);
  const sigVal = last(sigArr);

  const pct = clamp(50 + 0.5 * num(smiVal, 0), 0, 100);
  const state =
    Number.isFinite(smiVal) && Number.isFinite(sigVal)
      ? smiVal > sigVal
        ? "BULL"
        : smiVal < sigVal
          ? "BEAR"
          : "NEUTRAL"
      : "NEUTRAL";

  return {
    smi: Number.isFinite(smiVal) ? smiVal : null,
    signal: Number.isFinite(sigVal) ? sigVal : null,
    pct,
    state,
  };
}

function volatilityBlock(bars, close) {
  const tr = calcTrueRanges(bars);
  const atr = last(ema(tr, 14));

  if (!Number.isFinite(atr) || !Number.isFinite(close) || close <= 0) {
    return { atr: null, atrPct: null, scaled: 0, score: 50 };
  }

  const atrPct = (atr / close) * 100;
  const scaled = atrPct * 6.25;
  const score = clamp(100 - clamp(scaled, 0, 100), 0, 100);

  return { atr, atrPct, scaled, score };
}

function liquidityScoreFromVolume(bars) {
  const volumes = bars.map((b) => num(b.volume, 0));
  const v3 = last(ema(volumes, 3));
  const v12 = last(ema(volumes, 12));

  if (!Number.isFinite(v3) || !Number.isFinite(v12) || v12 <= 0) {
    return { raw: 50, score: 50 };
  }

  const raw = clamp(100 * (v3 / v12), 0, 200);
  const score = clamp((Math.min(raw, 120) / 120) * 100, 0, 100);

  return { raw, score };
}

function stateFromScore(score, emaSign = 0) {
  if (!Number.isFinite(score)) return "neutral";
  if (score >= 70) return "bull";
  if (emaSign < 0 && score < 50) return "bear";
  if (score < 45) return "bear";
  return "neutral";
}

function toneFromScore(score) {
  if (!Number.isFinite(score)) return "info";
  if (score >= 70) return "OK";
  if (score >= 50) return "warn";
  return "danger";
}

function cleanBars(bars) {
  return Array.isArray(bars)
    ? bars
        .map((b) => ({
          time: num(b.time),
          open: num(b.open),
          high: num(b.high),
          low: num(b.low),
          close: num(b.close),
          volume: num(b.volume, 0),
        }))
        .filter((b) => [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite))
    : [];
}

function baseFields(tf, clean) {
  const closes = clean.map((b) => b.close);
  const close = last(closes);

  const e8 = last(ema(closes, 8));
  const e10 = last(ema(closes, 10));
  const e18 = last(ema(closes, 18));
  const e20 = last(ema(closes, 20));
  const e50 = last(ema(closes, 50));

  const ema10DistPct = Number.isFinite(e10) && e10 !== 0 ? ((close - e10) / e10) * 100 : 0;
  const ema20DistPct = Number.isFinite(e20) && e20 !== 0 ? ((close - e20) / e20) * 100 : 0;
  const emaGapPct = Number.isFinite(e20) && e20 !== 0 ? Math.abs(((e10 - e20) / e20) * 100) : 0;
  const ema818GapPct = Number.isFinite(e18) && e18 !== 0 ? ((e8 - e18) / e18) * 100 : 0;

  const above10Raw = close > e10;
  const above20Raw = close > e20;
  const above50Raw = close > e50;

  const above10 = above10Raw || near(close, e10, EMA_RECLAIM_TOL_PCT);
  const above20 = above20Raw || near(close, e20, EMA_RECLAIM_TOL_PCT);
  const above50 = above50Raw;
  const stacked = e10 > e20;

  const smi = tvSmiAndSignal(clean);
  const psi = luxPsi(closes, 50, 20);
  const squeezePsi = Number.isFinite(psi) ? clamp(psi, 0, 100) : 50;
  const squeezeExpansion = clamp(100 - squeezePsi, 0, 100);

  const vol = volatilityBlock(clean, close);
  const liq = liquidityScoreFromVolume(clean);

  return {
    tf,
    clean,
    closes,
    close,
    e8,
    e10,
    e18,
    e20,
    e50,
    ema10DistPct,
    ema20DistPct,
    emaGapPct,
    ema818GapPct,
    above10,
    above20,
    above50,
    above10Raw,
    above20Raw,
    above50Raw,
    stacked,
    smi,
    squeezePsi,
    squeezeExpansion,
    vol,
    liq,
  };
}

function computeEs10m(tf, clean) {
  const b = baseFields(tf, clean);
  const emaPosture = postureFromDist(b.ema10DistPct, FULL_EMA_DIST_10M);
  const secondaryPosture = postureFromDist(b.ema818GapPct, FULL_EMA_DIST_10M);
  const momentumCombo = clamp(0.40 * emaPosture + 0.40 * b.smi.pct + 0.20 * secondaryPosture, 0, 100);
  const smiBonus = b.smi.state === "BULL" ? 2.0 : b.smi.state === "BEAR" ? -2.0 : 0.0;

  let score = clamp(
    0.35 * emaPosture + 0.30 * momentumCombo + 0.12 * b.squeezeExpansion + 0.10 * b.liq.score + 0.08 * b.vol.score + smiBonus,
    0,
    100
  );

  const reasons = [];

  if (!b.above10Raw && !b.above20Raw) {
    score = Math.min(score, b.above50Raw ? 46 : 38);
    reasons.push("BELOW_10_20");
  } else if (b.above10Raw && !b.above20Raw) {
    score = Math.min(score, 52);
    reasons.push("BETWEEN_10_20");
  }

  if (b.smi.state === "BEAR" && !b.above10Raw) {
    score = Math.min(score, 42);
    reasons.push("SMI_BEAR_BELOW_10");
  }

  return finishLight(tf, clean, score, b, {
    formula: "ES_10M_SPY_STYLE_TIMING",
    reasons,
    extra: { emaPosture, secondaryPosture, momentumCombo, smiBonus },
    components: {
      ema10: 0.35 * emaPosture,
      momentum: 0.30 * momentumCombo,
      squeeze: 0.12 * b.squeezeExpansion,
      liquidity: 0.10 * b.liq.score,
      volatility: 0.08 * b.vol.score,
      smiBonus,
    },
  });
}

function structure30m(b) {
  let structureScore = 38.0;
  let tier = "unknown";

  if (!b.above10 && !b.above20 && b.above50Raw) {
    structureScore = 42.0;
    tier = "below_10_20_above_50";
  } else if (!b.above10 && !b.above20) {
    structureScore = 25.0;
    tier = "below_both";
  } else if (b.above10 && !b.above20) {
    structureScore = 30.0;
    tier = "between_10_20";
  } else if (b.above10 && b.above20 && !b.stacked) {
    structureScore = 40.0;
    tier = "above_both_not_stacked";
  } else if (b.above10 && b.above20 && b.stacked && !b.above50Raw) {
    structureScore = 48.0;
    tier = "above_both_stacked_below50";
  } else if (b.above10 && b.above20 && b.stacked && b.above50Raw) {
    if (b.emaGapPct < EMA_TREND_GAP_STRONG_PCT || near(b.close, b.e50, EMA50_RECLAIM_TOL_PCT)) {
      structureScore = 56.0;
      tier = "above50_reclaim";
    } else {
      structureScore = 64.0;
      tier = "above50_trend";
    }
  }

  return { structureScore, tier };
}

function cap30m(score, b) {
  let cap = 100.0;

  if (!b.above10 && !b.above20) {
    cap = b.above50Raw ? 42.0 : 35.0;
  } else if (b.above10 && !b.above20) {
    cap = 46.0;
  } else if (b.above10 && b.above20 && !b.above50Raw) {
    cap = 49.0;
  } else if (b.above10 && b.above20 && b.above50Raw) {
    cap = near(b.close, b.e50, EMA50_RECLAIM_TOL_PCT) || b.emaGapPct < EMA_TREND_GAP_STRONG_PCT ? 49.0 : 58.0;
  }

  return Math.min(score, cap);
}

function computeEs30m(tf, clean) {
  const b = baseFields(tf, clean);
  const { structureScore, tier } = structure30m(b);
  const secondaryPosture = postureFromDist(b.ema818GapPct, FULL_EMA_DIST_30M);
  const momentumCombo = clamp(0.35 * structureScore + 0.40 * b.smi.pct + 0.25 * secondaryPosture, 0, 100);
  const smiBonus = b.smi.state === "BULL" ? SMI_BONUS_SCORE_MAX : b.smi.state === "BEAR" ? -SMI_BONUS_SCORE_MAX : 0;

  let score = clamp(
    0.48 * structureScore + 0.27 * momentumCombo + 0.10 * b.squeezeExpansion + 0.08 * b.liq.score + 0.07 * b.vol.score + smiBonus,
    0,
    100
  );

  let accelBonus = 0.0;
  if (b.close > b.e10) accelBonus += 2.0;
  if (b.e10 > b.e20) accelBonus += 2.0;
  if (b.smi.state === "BULL") accelBonus += 2.0;
  if (b.clean.length >= 2 && b.close > b.clean[b.clean.length - 2].close) accelBonus += 1.5;
  accelBonus = clamp(accelBonus, 0, 6);

  score = cap30m(score, b);
  score = clamp(score + accelBonus, 0, 100);

  return finishLight(tf, clean, score, b, {
    formula: "ES_30M_SPY_STRUCTURE_TIER",
    reasons: [tier],
    extra: { structureTier: tier, structureScore, secondaryPosture, momentumCombo, smiBonus, accelBonus },
    components: {
      structure: 0.48 * structureScore,
      momentum: 0.27 * momentumCombo,
      squeeze: 0.10 * b.squeezeExpansion,
      liquidity: 0.08 * b.liq.score,
      volatility: 0.07 * b.vol.score,
      smiBonus,
    },
  });
}

function computeEs1h(tf, clean) {
  const b = baseFields(tf, clean);
  const emaPosture = postureFromDist(b.ema10DistPct, FULL_EMA_DIST_1H);
  const momentumCombo = clamp(0.45 * emaPosture + 0.45 * b.smi.pct + 0.10 * 50, 0, 100);
  const smiBonus = b.smi.state === "BULL" ? SMI_BONUS_SCORE_MAX : b.smi.state === "BEAR" ? -SMI_BONUS_SCORE_MAX : 0;

  let score = clamp(
    0.35 * emaPosture + 0.25 * momentumCombo + 0.10 * b.squeezeExpansion + 0.10 * b.liq.score + 0.07 * b.vol.score + 0.13 * 50 + smiBonus,
    0,
    100
  );

  const reasons = [];

  if (!b.above10Raw && !b.above20Raw && b.above50Raw) {
    score = Math.min(score, 48.0);
    reasons.push("BELOW_10_20_ABOVE_50_CAP_48");
  } else if (!b.above10Raw && !b.above20Raw && !b.above50Raw) {
    score = Math.min(score, 38.0);
    reasons.push("BELOW_10_20_50_CAP_38");
  } else if (b.above10Raw && !b.above20Raw) {
    score = Math.min(score, 55.0);
    reasons.push("BETWEEN_10_20_CAP_55");
  } else if (b.above10Raw && b.above20Raw && !b.above50Raw) {
    score = Math.min(score, 58.0);
    reasons.push("ABOVE_10_20_BELOW_50_CAP_58");
  }

  if (b.smi.state === "BEAR" && !b.above10Raw) {
    score = Math.min(score, b.above50Raw ? 46.0 : 35.0);
    reasons.push("SMI_BEARISH_CONTROL_CAP");
  }

  return finishLight(tf, clean, score, b, {
    formula: "ES_1H_SPY_STYLE_WITH_CONTROL_CAPS",
    reasons,
    extra: { emaPosture, momentumCombo, smiBonus },
    components: {
      ema10: 0.35 * emaPosture,
      momentum: 0.25 * momentumCombo,
      squeeze: 0.10 * b.squeezeExpansion,
      liquidity: 0.10 * b.liq.score,
      volatility: 0.07 * b.vol.score,
      neutralRisk: 0.13 * 50,
      smiBonus,
    },
  });
}

function computeBasicHigherTf(tf, clean) {
  const b = baseFields(tf, clean);
  const emaPosture = postureFromDist(b.ema10DistPct, 0.90);
  const momentumCombo = clamp(0.50 * emaPosture + 0.50 * b.smi.pct, 0, 100);
  const smiBonus = b.smi.state === "BULL" ? SMI_BONUS_SCORE_MAX : b.smi.state === "BEAR" ? -SMI_BONUS_SCORE_MAX : 0;

  let score = clamp(
    0.35 * emaPosture + 0.25 * momentumCombo + 0.15 * b.squeezeExpansion + 0.10 * b.liq.score + 0.10 * b.vol.score + smiBonus,
    0,
    100
  );

  if (!b.above10Raw && !b.above20Raw && b.above50Raw) score = Math.min(score, 58);
  if (!b.above10Raw && !b.above20Raw && !b.above50Raw) score = Math.min(score, 45);

  return finishLight(tf, clean, score, b, {
    formula: tf === "4h" ? "ES_4H_BASIC_PENDING_TUNE" : "ES_EOD_BASIC_PENDING_TUNE",
    reasons: [],
    extra: { emaPosture, momentumCombo, smiBonus },
    components: {
      ema10: 0.35 * emaPosture,
      momentum: 0.25 * momentumCombo,
      squeeze: 0.15 * b.squeezeExpansion,
      liquidity: 0.10 * b.liq.score,
      volatility: 0.10 * b.vol.score,
      smiBonus,
    },
  });
}

function finishLight(tf, clean, scoreRaw, b, opts = {}) {
  const score = clamp(scoreRaw, 0, 100);
  const emaSign = b.close > b.e10 && b.close > b.e20 ? 1 : !b.above10Raw && !b.above20Raw ? -1 : 0;
  const state = stateFromScore(score, emaSign);

  return {
    ok: true,
    tf,
    label: TF_CONFIG[tf]?.label || tf,
    score: round(score, 2),
    state,
    tone: toneFromScore(score),
    reason: opts.reasons?.length ? opts.reasons.join("|") : state === "bull" ? "ES_TREND_FAVORABLE" : state === "bear" ? "ES_TREND_RISK" : "ES_MIXED_WAIT",
    formula: opts.formula || "ES_GENERIC",
    barCount: clean.length,
    lastBar: clean[clean.length - 1],
    updated_at_utc: nowIso(),
    metrics: {
      close: round(b.close, 2),
      ema8: round(b.e8, 2),
      ema10: round(b.e10, 2),
      ema18: round(b.e18, 2),
      ema20: round(b.e20, 2),
      ema50: round(b.e50, 2),
      ema10DistancePct: round(b.ema10DistPct, 4),
      ema20DistancePct: round(b.ema20DistPct, 4),
      emaGap10_20Pct: round(b.emaGapPct, 4),
      ema8_18GapPct: round(b.ema818GapPct, 4),
      above10: Boolean(b.above10Raw),
      above20: Boolean(b.above20Raw),
      above50: Boolean(b.above50Raw),
      ema10GtEma20: Boolean(b.e10 > b.e20),
      smi: b.smi.smi === null ? null : round(b.smi.smi, 4),
      smiSignal: b.smi.signal === null ? null : round(b.smi.signal, 4),
      smiPct: round(b.smi.pct, 2),
      smiState: b.smi.state,
      squeezePsi: round(b.squeezePsi, 2),
      squeezeExpansion: round(b.squeezeExpansion, 2),
      liquidityRaw: round(b.liq.raw, 2),
      liquidityScore: round(b.liq.score, 2),
      volatilityScore: round(b.vol.score, 2),
      atrPct: b.vol.atrPct === null ? null : round(b.vol.atrPct, 4),
      ...(opts.extra || {}),
    },
    components: Object.fromEntries(Object.entries(opts.components || {}).map(([k, v]) => [k, round(v, 2)])),
  };
}

function computeTimeframeMeter(tf, bars) {
  const clean = cleanBars(bars);

  if (clean.length < 60) {
    return {
      ok: false,
      tf,
      label: TF_CONFIG[tf]?.label || tf,
      score: null,
      state: "neutral",
      tone: "info",
      reason: "INSUFFICIENT_BARS",
      barCount: clean.length,
      updated_at_utc: nowIso(),
    };
  }

  if (tf === "10m") return computeEs10m(tf, clean);
  if (tf === "30m") return computeEs30m(tf, clean);
  if (tf === "1h") return computeEs1h(tf, clean);
  return computeBasicHigherTf(tf, clean);
}

function weightedMaster(lights) {
  let sum = 0;
  let wsum = 0;

  for (const [tf, cfg] of Object.entries(TF_CONFIG)) {
    const light = lights[tf];
    if (!light || !Number.isFinite(light.score)) continue;
    sum += light.score * cfg.weight;
    wsum += cfg.weight;
  }

  if (wsum <= 0) return null;
  return clamp(sum / wsum, 0, 100);
}

function getSelfBaseUrl() {
  const port = process.env.PORT || 10000;
  return `http://127.0.0.1:${port}`;
}

async function fetchBarsFromExistingRoute(symbol, tf, limit) {
  const base = getSelfBaseUrl();
  const url = new URL(`${base}/api/v1/futures/ohlc`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("timeframe", tf);
  url.searchParams.set("limit", String(limit));

  const r = await fetch(url.toString(), { cache: "no-store", headers: { Accept: "application/json" } });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`futures ohlc ${tf} failed ${r.status} ${txt.slice(0, 300)}`);
  }

  const json = await r.json();
  return Array.isArray(json) ? json : json?.bars || [];
}

router.get("/", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "ES").trim().toUpperCase();
    const lights = {};
    const errors = {};

    await Promise.all(
      Object.entries(TF_CONFIG).map(async ([tf, cfg]) => {
        try {
          const bars = await fetchBarsFromExistingRoute(symbol, tf, cfg.limit);
          lights[tf] = computeTimeframeMeter(tf, bars);
        } catch (err) {
          errors[tf] = String(err?.message || err);
          lights[tf] = {
            ok: false,
            tf,
            label: cfg.label,
            score: null,
            state: "neutral",
            tone: "info",
            reason: "FETCH_FAILED",
            error: String(err?.message || err),
            updated_at_utc: nowIso(),
          };
        }
      })
    );

    const masterScore = weightedMaster(lights);
    const masterState = stateFromScore(masterScore, 0);

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      ok: true,
      version: "futures-market-meter-v2-spy-style-10m-30m-1h",
      symbol,
      displaySymbol: symbol,
      updated_at_utc: nowIso(),
      source: "/api/v1/futures/ohlc",
      notes: {
        tenMin: "SPY-style timing formula",
        thirtyMin: "SPY 30m structure-tier formula",
        oneHour: "SPY 1h style with user-approved below-10/20 control caps",
        fourHour: "basic placeholder pending 4H formula port",
        eod: "basic placeholder pending EOD formula port",
      },
      lights,
      master: {
        score: masterScore === null ? null : round(masterScore, 2),
        state: masterState,
        tone: toneFromScore(masterScore),
        weights: Object.fromEntries(Object.entries(TF_CONFIG).map(([tf, cfg]) => [tf, cfg.weight])),
      },
      errors,
    });
  } catch (err) {
    console.error("[/api/v1/futures/market-meter] error:", err?.stack || err);
    return res.status(500).json({
      ok: false,
      error: "futures_market_meter_failed",
      detail: String(err?.message || err),
      updated_at_utc: nowIso(),
    });
  }
});
