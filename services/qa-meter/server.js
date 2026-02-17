#!/usr/bin/env node
/* eslint-disable no-console */
import express from "express";

/* =========================
   Config (via env)
   ========================= */
const PORT = process.env.PORT || 3000;

// Where to read your live intraday JSON (for reference links in output)
const RAW_OWNER  = process.env.RAW_OWNER  || "bfrye1973";
const RAW_REPO   = process.env.RAW_REPO   || "frye-market-backend";
const RAW_BRANCH = process.env.RAW_BRANCH || "data-live-10min";
const RAW_PATH_INTRADAY = process.env.RAW_PATH_INTRADAY || "data/outlook_intraday.json";

// Polygon
const POLY_KEY  = process.env.POLYGON_API_KEY || process.env.POLY_KEY || "";

/* =========================
   Helpers
   ========================= */
const app = express();

app.get("/__up", (_req, res) => res.type("text").send("UP"));
app.get("/__routes", (_req, res) => {
  res.json({
    routes: ["/__up", "/__routes", "/qa/meter (existing)", "/qa/ema10 (existing)", "/qa/bars"],
  });
});

// small util
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const emaLast = (arr, span) => {
  if (!arr || !arr.length) return null;
  const k = 2 / (span + 1);
  let e = null;
  for (const v of arr) e = e === null ? v : e + k * (v - e);
  return e;
};

function trSeries(H, L, C) {
  const trs = [];
  for (let i = 1; i < C.length; i++) {
    trs.push(Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])));
  }
  return trs;
}

async function fetchJson(url, opts) {
  const r = await fetch(url, { ...opts, headers: { "User-Agent": "qa-meter/1.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.json();
}

function dropInflight10m(bars) {
  if (!bars || !bars.length) return bars;
  const BUCKET = 600;
  const now = Math.floor(Date.now() / 1000);
  const currBucket = Math.floor(now / BUCKET) * BUCKET;
  const lastBucket = Math.floor(bars[bars.length - 1].t / 1000 / BUCKET) * BUCKET;
  if (lastBucket === currBucket) return bars.slice(0, -1);
  return bars;
}

function computeSqueeze(H, L, C, lookback = 6) {
  if (!C || C.length < lookback) return null;
  const n = lookback;
  const cn = C.slice(-n);
  const hn = H.slice(-n);
  const ln = L.slice(-n);

  const mean = cn.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(cn.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n);
  const bbWidth = (mean + 2 * sd) - (mean - 2 * sd); // 4*sd

  const prevs = cn.slice(0, -1).concat(cn[cn.length - 1]);
  const trs6 = hn.map((h, i) => Math.max(h - ln[i], Math.abs(h - prevs[i]), Math.abs(ln[i] - prevs[i])));
  const kcWidth = 2.0 * (trs6.reduce((a, b) => a + b, 0) / trs6.length);
  if (kcWidth <= 0) return null;

  return clamp(100 * (bbWidth / kcWidth), 0, 100);
}

function computeLiquidityPSI(V) {
  if (!V || !V.length) return null;
  const v3 = emaLast(V, 3);
  const v12 = emaLast(V, 12);
  if (!v12 || v12 <= 0) return 0;
  return clamp(100 * (v3 / v12), 0, 200);
}

function computeVolatilityPct(H, L, C) {
  if (!C || !C.length) return null;
  if (C.length >= 2) {
    const trs = trSeries(H, L, C);
    const atrFast = emaLast(trs, 3);
    if (atrFast && C[C.length - 1] > 0) return Math.max(0, 100 * (atrFast / C[C.length - 1]));
    return null;
  } else {
    const tr = Math.max(H[0] - L[0], Math.abs(H[0] - C[0]), Math.abs(L[0] - C[0]));
    return C[0] > 0 ? Math.max(0, 100 * (tr / C[0])) : 0;
  }
}

/* =========================
   /qa/bars
   =========================
   Params:
     symbol=SPY
     from=YYYY-MM-DD (UTC)
     to=YYYY-MM-DD   (UTC)
   Defaults: last 2 calendar days
   Output: plain text with Squeeze, Liquidity PSI, Volatility %, Volatility Scaled
*/
app.get("/qa/bars", async (req, res) => {
  res.type("text");
  try {
    const symbol = (req.query.symbol || "SPY").toUpperCase();
    const to = req.query.to || new Date().toISOString().slice(0, 10);
    const from = req.query.from || new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);

    if (!POLY_KEY) {
      res.status(200).send("ERROR: POLYGON_API_KEY not set in env.\n");
      return;
    }

    const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/10/minute/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${POLY_KEY}`;
    const js = await fetchJson(url);
    let rows = Array.isArray(js.results) ? js.results : [];
    if (!rows.length) {
      res.status(200).send(`No bars returned for ${symbol} ${from}→${to}\n`);
      return;
    }

    // drop in-flight
    rows = dropInflight10m(rows);

    const H = rows.map(r => +r.h);
    const L = rows.map(r => +r.l);
    const C = rows.map(r => +r.c);
    const V = rows.map(r => +r.v);

    const squeeze = computeSqueeze(H, L, C, 6);
    const psi = computeLiquidityPSI(V);
    const vol = computeVolatilityPct(H, L, C);
    const volScaled = vol != null ? +(vol * 6.25).toFixed(2) : null;

    const lastTs = new Date((rows.at(-1).t)).toISOString();

    const src = `https://raw.githubusercontent.com/${RAW_OWNER}/${RAW_REPO}/${RAW_BRANCH}/${RAW_PATH_INTRADAY}`;
    let out = "";
    out += `QA Bars Check  (${new Date().toISOString()})\n`;
    out += `Source: ${src}\n`;
    out += `Symbol: ${symbol}  Bars used: ${rows.length}  last_ts: ${lastTs}\n\n`;

    out += `Squeeze %        : ${squeeze != null ? squeeze.toFixed(2) : "N/A"}\n`;
    out += `Liquidity PSI    : ${psi != null ? psi.toFixed(2) : "N/A"}\n`;
    out += `Volatility %     : ${vol != null ? vol.toFixed(3) : "N/A"}\n`;
    out += `Volatility scaled: ${volScaled != null ? volScaled.toFixed(2) : "N/A"}\n`;

    res.send(out);
  } catch (e) {
    res.status(200).send(`ERROR: ${e.message || String(e)}\n`);
  }
});

/* =========================
   Start
   ========================= */
app.listen(PORT, () => {
  console.log(`qa-meter listening on :${PORT}`);
});
