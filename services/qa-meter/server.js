// services/qa-meter/server.js
// QA Meter microservice (ESM) — independent of Core
// Routes:
//   GET /__up            -> "UP"
//   GET /__routes        -> list all mounted routes
//   GET /healthz         -> { ok, service, ts }
//   GET /qa/meter        -> verify intraday (10m) snapshot math
//   GET /qa/hourly       -> verify hourly (1h) snapshot math

import express from "express";

/* -------------------------- Ensure global fetch --------------------------- */
if (typeof globalThis.fetch !== "function") {
  const { default: nodeFetch } = await import("node-fetch");
  globalThis.fetch = nodeFetch;
}

/* --------------------------------- App ----------------------------------- */
const app = express();
const PORT = process.env.PORT || 3000;

/* --------------------------------- CORS ---------------------------------- */
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000",
]);
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ALLOW.has(o)) res.setHeader("Access-Control-Allow-Origin", o);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* --------------------------- Repo/branch config -------------------------- */
const RAW_OWNER  = process.env.RAW_OWNER  || "bfrye1973";
const RAW_REPO   = process.env.RAW_REPO   || "frye-market-backend";

/* Intraday (10m) */
const RAW_BRANCH          = process.env.RAW_BRANCH          || "data-live-10min";
const RAW_PATH_INTRADAY   = process.env.RAW_PATH_INTRADAY   || "data/outlook_intraday.json";

/* Hourly (1h) */
const RAW_BRANCH_HOURLY   = process.env.RAW_BRANCH_HOURLY   || "data-live-hourly";
const RAW_PATH_HOURLY     = process.env.RAW_PATH_HOURLY     || "data/outlook_hourly.json";

/* URL builders */
const rawUrl = (branch, pathStr) =>
  `https://raw.githubusercontent.com/${RAW_OWNER}/${RAW_REPO}/${branch}/${pathStr}?t=${Date.now()}`;

/* ------------------------------- Helpers --------------------------------- */
const pct = (a, b) => (b === 0 ? 0 : 100 * a / b);
const OFF = new Set(["Information Technology","Communication Services","Consumer Discretionary"]);
const DEF = new Set(["Consumer Staples","Utilities","Health Care","Real Estate"]);

function summarizeFromCards(cards = []) {
  let NH=0, NL=0, UP=0, DN=0, rising=0, offUp=0, defDn=0;
  for (const c of cards) {
    const nh=+c.nh||0, nl=+c.nl||0, up=+c.up||0, dn=+c.down||0;
    NH+=nh; NL+=nl; UP+=up; DN+=dn;
    const b = pct(nh, nh+nl);
    if (b > 50) rising++;
    const sec = String(c.sector || "");
    if (OFF.has(sec) && b > 50) offUp++;
    if (DEF.has(sec) && b < 50) defDn++;
  }
  return {
    NH, NL, UP, DN, rising, offUp, defDn,
    breadth_pct:  pct(NH, NH+NL),
    momentum_pct: pct(UP, UP+DN),
    risingPct:    pct(rising, 11),
    riskOnPct:    pct(offUp + defDn, OFF.size + DEF.size),
  };
}

function line(label, live, calc, tol) {
  const d  = +((live - calc)).toFixed(2);
  const ok = Math.abs(d) <= tol;
  return `${ok ? "✅" : "❌"} ${label.padEnd(12)} live=${live.toFixed(2).padStart(6)}  calc=${calc.toFixed(2).padStart(6)}  Δ=${d>=0?"+":""}${d.toFixed(2)} (tol ±${tol})`;
}

/* ------------------------------ Diagnostics ------------------------------ */
app.get("/__up", (_req, res) => res.type("text").send("UP"));

app.get("/__routes", (_req, res) => {
  const out = [];
  const stack = app._router?.stack || [];
  for (const layer of stack) {
    if (layer.route?.path) {
      const m = Object.keys(layer.route.methods).join(",").toUpperCase();
      out.push(`${m.padEnd(6)} ${layer.route.path}`);
    }
  }
  res.type("text").send(out.sort().join("\n"));
});

app.get("/healthz", (_req, res) =>
  res.json({ ok: true, service: "qa-meter", ts: new Date().toISOString() })
);

/* --------------------------- /qa/meter (10m) ----------------------------- */
app.get("/qa/meter", async (_req, res) => {
  try {
    const url = rawUrl(RAW_BRANCH, RAW_PATH_INTRADAY);
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return res.status(r.status).json({ ok:false, error:`raw ${r.status}` });
    const j = await r.json();

    const cards = Array.isArray(j?.sectorCards) ? j.sectorCards : [];
    const s = summarizeFromCards(cards);

    const live = {
      breadth_pct: +(j?.metrics?.breadth_pct ?? 0),
      momentum_pct: +(j?.metrics?.momentum_pct ?? 0),
      risingPct:    +((j?.intraday?.sectorDirection10m)?.risingPct ?? 0),
      riskOnPct:    +((j?.intraday?.riskOn10m)?.riskOnPct ?? 0),
    };

    const tol = { breadth_pct: 0.25, momentum_pct: 0.25, risingPct: 0.5, riskOnPct: 0.5 };
    const rows = [
      line("Breadth %",  live.breadth_pct,  s.breadth_pct,  tol.breadth_pct),
      line("Momentum %", live.momentum_pct, s.momentum_pct, tol.momentum_pct),
      line("Rising %",   live.risingPct,    s.risingPct,    tol.risingPct),
      line("Risk-On %",  live.riskOnPct,    s.riskOnPct,    tol.riskOnPct),
    ];
    const pass   = rows.every(r => r.startsWith("✅"));
    const stamp  = (j?.updated_at || j?.updated_at_utc || "").toString();
    const overall= j?.intraday?.overall10m || {};
    const comps  = overall.components || {};
    const emaX   = String(j?.metrics?.ema_cross ?? "n/a");
    const emaD   = Number(j?.metrics?.ema10_dist_pct ?? NaN);

    res.setHeader("Cache-Control", "no-store");
    res.type("text").send([
      `QA Meter Check  (${stamp})`,
      `Source: ${url.replace(/\?.*$/,"")}`,
      "",
      ...rows, "",
      `Overall10m: state=${String(overall.state ?? "n/a")}  score=${Number.isFinite(+overall.score)?overall.score:"n/a"}`,
      `  ema_cross=${emaX}  ema10_dist_pct=${Number.isFinite(emaD)?emaD.toFixed(2)+"%":"n/a"}`,
      `  components:`,
      `    ema10=${comps.ema10??"n/a"}  momentum=${comps.momentum??"n/a"}  breadth=${comps.breadth??"n/a"}`,
      `    squeeze=${comps.squeeze??"n/a"}  liquidity=${comps.liquidity??"n/a"}  riskOn=${comps.riskOn??"n/a"}`,
      "",
      `Summary: ${pass ? "PASS ✅" : "FAIL ❌"}`,
      ""
    ].join("\n"));
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});

/* -------------------------- /qa/hourly (1h) ------------------------------ */
app.get("/qa/hourly", async (_req, res) => {
  try {
    const url = rawUrl(RAW_BRANCH_HOURLY, RAW_PATH_HOURLY);
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return res.status(r.status).json({ ok:false, error:`raw ${r.status}` });
    const j = await r.json();

    const cards = Array.isArray(j?.sectorCards) ? j.sectorCards : [];
    const s = summarizeFromCards(cards);

    const live = {
      breadth_pct: +(j?.metrics?.breadth_pct ?? 0),
      momentum_pct: +(j?.metrics?.momentum_pct ?? 0),
      risingPct:    +((j?.hourly?.sectorDirection1h)?.risingPct ?? 0),
      riskOnPct:    +((j?.hourly?.riskOn1h)?.riskOnPct ?? 0),
    };

    const tol = { breadth_pct: 0.25, momentum_pct: 0.25, risingPct: 0.5, riskOnPct: 0.5 };
    const rows = [
      line("Breadth %",  live.breadth_pct,  s.breadth_pct,  tol.breadth_pct),
      line("Momentum %", live.momentum_pct, s.momentum_pct, tol.momentum_pct),
      line("Rising %",   live.risingPct,    s.risingPct,    tol.risingPct),
      line("Risk-On %",  live.riskOnPct,    s.riskOnPct,    tol.riskOnPct),
    ];
    const pass  = rows.every(r => r.startsWith("✅"));
    const stamp = (j?.updated_at || j?.updated_at_utc || "").toString();

    res.setHeader("Cache-Control", "no-store");
    res.type("text").send([
      `QA Hourly Check  (${stamp})`,
      `Source: ${url.replace(/\?.*$/,"")}`,
      "",
      ...rows, "",
      `Summary: ${pass ? "PASS ✅" : "FAIL ❌"}`,
      ""
    ].join("\n"));
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});

// GET /qa/ema10  -> SPY 10m EMA10/EMA20 using Polygon (last 2 CLOSED bars)
app.get("/qa/ema10", async (_req, res) => {
  try {
    const key = process.env.POLYGON_API_KEY || process.env.POLY_API_KEY;
    if (!key) return res.status(400).type("text").send("Missing POLYGON_API_KEY");
    const base = "https://api.polygon.io/v2/aggs/ticker/SPY/range/10/minute";
    const end  = new Date().toISOString().slice(0,10);           // today (UTC)
    const start= new Date(Date.now()-3*864e5).toISOString().slice(0,10); // 3 days
    const url  = `${base}/${start}/${end}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;

    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return res.status(r.status).json({ ok:false, error:`polygon ${r.status}` });
    const js = await r.json();
    const rs = (js.results || []).map(o => ({ t:o.t, c:o.c }));

    // last two CLOSED bars are the last two elements
    if (rs.length < 25) return res.status(500).type("text").send("Not enough bars");
    const closes = rs.map(b => b.c);

    const ema = (arr, n) => {
      const a = 2/(n+1); let e = arr[0];
      for (let i=1;i<arr.length;i++) e = e + a*(arr[i]-e);
      return e;
    };

    // prev = up to bar[-2], now = up to bar[-1] (both CLOSED)
    const prevCloses = closes.slice(0, closes.length-1);
    const ema10_prev = ema(prevCloses, 10);
    const ema20_prev = ema(prevCloses, 20);
    const ema10_now  = ema(closes, 10);
    const ema20_now  = ema(closes, 20);

    let cross = "none";
    if (ema10_prev >= ema20_prev && ema10_now < ema20_now) cross = "bear";
    if (ema10_prev <= ema20_prev && ema10_now > ema20_now) cross = "bull";

    const distPct = ema10_now ? (100*(closes.at(-1)-ema10_now)/ema10_now) : 0;

    res.type("text").send([
      "QA EMA10/20 (SPY 10m from Polygon)",
      `bars=${rs.length}`,
      `prev: ema10=${ema10_prev.toFixed(2)}  ema20=${ema20_prev.toFixed(2)}`,
      `now : ema10=${ema10_now.toFixed(2)}  ema20=${ema20_now.toFixed(2)}`,
      `close=${closes.at(-1).toFixed(2)}  ema10_dist_pct=${distPct.toFixed(2)}%`,
      `cross=${cross}`
    ].join("\n"));
  } catch (e) {
    res.status(500).json({ ok:false, error:String(e?.message||e) });
  }
});

/* -------------------------- 404 (keep last) ------------------------------ */
app.use((req, res) =>
  res.status(404).json({ ok:false, error:"Not Found", path:req.path })
);

/* -------------------------------- Start ---------------------------------- */
app.listen(PORT, () => {
  console.log(`[qa-meter] listening on :${PORT}`);
});
