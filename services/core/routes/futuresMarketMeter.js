// services/core/routes/futuresMarketMeter.js
// ES Futures Market Meter — read-only lights
//
// GET /api/v1/futures/market-meter?symbol=ES
//
// Returns:
// 10m / 30m / 1h / 4h / EOD futures lights + ES Master score
//
// Important:
// - Uses existing /api/v1/futures/ohlc route as the data source.
// - Does NOT touch SPY Market Meter.
// - Does NOT use sector breadth.
// - ES score = Trend + Momentum + Squeeze + Volatility + Location.

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

function avg(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return NaN;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function ema(values, length) {
  if (!Array.isArray(values) || !values.length) return [];
  const k = 2 / (length + 1);
  const out = [];
  let e = null;

  for (const v of values) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    e = e === null ? n : e + k * (n - e);
    out.push(e);
  }

  return out;
}

function last(arr) {
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
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

  let mx = 0.0;
  let mn = 0.0;
  const diffs = [];
  const eps = 1e-12;

  for (const raw of closes) {
    const src = Number(raw);
    if (!Number.isFinite(src)) continue;

    mx = Math.max(src, mx - (mx - src) / conv);
    mn = Math.min(src, mn + (src - mn) / conv);

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

function smiScore(bars, lengthK = 12, lengthD = 5, lengthEMA = 5) {
  if (!Array.isArray(bars) || bars.length < lengthK + lengthD + lengthEMA + 5) {
    return {
      smi: null,
      signal: null,
      score: 50,
      state: "NEUTRAL",
    };
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

  const smi = [];
  for (let i = 0; i < Math.min(nume.length, deno.length); i += 1) {
    const d = deno[i];
    smi.push(!Number.isFinite(d) || d === 0 ? 0 : 200 * (nume[i] / d));
  }

  const sig = ema(smi, lengthEMA);
  const smiVal = last(smi);
  const sigVal = last(sig);

  const score = clamp(50 + 0.5 * num(smiVal, 0), 0, 100);
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
    score,
    state,
  };
}

function trendScoreFromEmas(close, e10, e20, e50) {
  let score = 50;

  if (close > e10) score += 15;
  else score -= 15;

  if (close > e20) score += 15;
  else score -= 15;

  if (close > e50) score += 10;
  else score -= 10;

  if (e10 > e20) score += 10;
  else score -= 10;

  if (e20 > e50) score += 10;
  else score -= 10;

  return clamp(score, 0, 100);
}

function locationScore(close, e10, e20) {
  if (!Number.isFinite(close) || !Number.isFinite(e10) || e10 === 0) return 50;

  const dist10 = ((close - e10) / e10) * 100;
  const absDist10 = Math.abs(dist10);

  let score = 70;

  // Near EMA10 = decision zone. Not automatically bad, but not a chase entry.
  if (absDist10 <= 0.20) score -= 10;
  else if (absDist10 <= 0.45) score -= 5;
  else if (absDist10 >= 1.20) score -= 12;

  if (close < e10) score -= 10;
  if (Number.isFinite(e20) && close < e20) score -= 15;

  return clamp(score, 0, 100);
}

function volatilityScore(bars, close) {
  const tr = calcTrueRanges(bars);
  const atr = last(ema(tr, 14));

  if (!Number.isFinite(atr) || !Number.isFinite(close) || close <= 0) {
    return {
      atr: null,
      atrPct: null,
      score: 50,
    };
  }

  const atrPct = (atr / close) * 100;

  // ES futures: too dead is bad, too hot is bad.
  let score = 75;
  if (atrPct < 0.15) score -= 12;
  if (atrPct > 0.75) score -= 15;
  if (atrPct > 1.10) score -= 25;

  return {
    atr,
    atrPct,
    score: clamp(score, 0, 100),
  };
}

function stateFromScore(score) {
  if (!Number.isFinite(score)) return "neutral";
  if (score >= 70) return "bull";
  if (score < 50) return "bear";
  return "neutral";
}

function toneFromScore(score) {
  if (!Number.isFinite(score)) return "info";
  if (score >= 70) return "OK";
  if (score >= 50) return "warn";
  return "danger";
}

function computeTimeframeMeter(tf, bars) {
  const clean = Array.isArray(bars)
    ? bars
        .map((b) => ({
          time: num(b.time),
          open: num(b.open),
          high: num(b.high),
          low: num(b.low),
          close: num(b.close),
          volume: num(b.volume, 0),
        }))
        .filter((b) =>
          [b.time, b.open, b.high, b.low, b.close].every(Number.isFinite)
        )
    : [];

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

  const closes = clean.map((b) => b.close);
  const close = last(closes);

  const e10 = last(ema(closes, 10));
  const e20 = last(ema(closes, 20));
  const e50 = last(ema(closes, 50));

  const trend = trendScoreFromEmas(close, e10, e20, e50);
  const momentum = smiScore(clean);
  const psi = luxPsi(closes, 50, 20);

  // Lux PSI is tightness. For score, expansion gets the reward.
  const squeezeExpansion = Number.isFinite(psi) ? clamp(100 - psi, 0, 100) : 50;

  const vol = volatilityScore(clean, close);
  const loc = locationScore(close, e10, e20);

  const score = clamp(
    trend * 0.35 +
      momentum.score * 0.25 +
      squeezeExpansion * 0.15 +
      vol.score * 0.10 +
      loc * 0.15,
    0,
    100
  );

  const state = stateFromScore(score);

  return {
    ok: true,
    tf,
    label: TF_CONFIG[tf]?.label || tf,
    score: Number(score.toFixed(2)),
    state,
    tone: toneFromScore(score),
    reason:
      state === "bull"
        ? "ES_TREND_FAVORABLE"
        : state === "bear"
          ? "ES_TREND_RISK"
          : "ES_MIXED_WAIT",
    barCount: clean.length,
    lastBar: clean[clean.length - 1],
    updated_at_utc: nowIso(),
    metrics: {
      close: Number(close.toFixed(2)),
      ema10: Number(e10.toFixed(2)),
      ema20: Number(e20.toFixed(2)),
      ema50: Number(e50.toFixed(2)),
      ema10DistancePct: Number((((close - e10) / e10) * 100).toFixed(4)),
      trendScore: Number(trend.toFixed(2)),
      momentumScore: Number(momentum.score.toFixed(2)),
      smi: momentum.smi === null ? null : Number(momentum.smi.toFixed(4)),
      smiSignal:
        momentum.signal === null ? null : Number(momentum.signal.toFixed(4)),
      smiState: momentum.state,
      squeezePsi: Number.isFinite(psi) ? Number(psi.toFixed(2)) : null,
      squeezeExpansion: Number(squeezeExpansion.toFixed(2)),
      volatilityScore: Number(vol.score.toFixed(2)),
      atrPct: vol.atrPct === null ? null : Number(vol.atrPct.toFixed(4)),
      locationScore: Number(loc.toFixed(2)),
    },
    components: {
      trend: Number((trend * 0.35).toFixed(2)),
      momentum: Number((momentum.score * 0.25).toFixed(2)),
      squeeze: Number((squeezeExpansion * 0.15).toFixed(2)),
      volatility: Number((vol.score * 0.10).toFixed(2)),
      location: Number((loc * 0.15).toFixed(2)),
    },
  };
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

function getSelfBaseUrl(req) {
  const port = process.env.PORT || 10000;
  return `http://127.0.0.1:${port}`;
}

async function fetchBarsFromExistingRoute(req, symbol, tf, limit) {
  const base = getSelfBaseUrl(req);
  const url = new URL(`${base}/api/v1/futures/ohlc`);

  url.searchParams.set("symbol", symbol);
  url.searchParams.set("timeframe", tf);
  url.searchParams.set("limit", String(limit));

  const r = await fetch(url.toString(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

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
          const bars = await fetchBarsFromExistingRoute(
            req,
            symbol,
            tf,
            cfg.limit
          );
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
    const masterState = stateFromScore(masterScore);

    res.setHeader("Cache-Control", "no-store");

    return res.json({
      ok: true,
      version: "futures-market-meter-v1",
      symbol,
      displaySymbol: symbol,
      updated_at_utc: nowIso(),
      source: "/api/v1/futures/ohlc",
      lights,
      master: {
        score: masterScore === null ? null : Number(masterScore.toFixed(2)),
        state: masterState,
        tone: toneFromScore(masterScore),
        weights: Object.fromEntries(
          Object.entries(TF_CONFIG).map(([tf, cfg]) => [tf, cfg.weight])
        ),
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
