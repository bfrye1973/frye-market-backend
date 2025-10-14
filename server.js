// server.js — Express (ESM)
// - CORS
// - Static /public
// - /api/v1/ohlc (deep history) + /api (other routes)
// - LIVE proxies: /live/intraday, /live/hourly, /live/eod
// - NEW: /live/intraday-deltas (5m sandbox, no-store)
// - Health, 404, error

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// Optional routers (keep if present in your repo)
import apiRouter from "./api/routes.js";           // /api/*
import { ohlcRouter } from "./routes/ohlc.js";     // /api/v1/ohlc

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// ESM __dirname shim
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure fetch exists (Node 18+ has global fetch; this is a safe guard)
if (typeof fetch !== "function") {
  const { default: nodeFetch } = await import("node-fetch");
  // @ts-ignore
  globalThis.fetch = nodeFetch;
}

// ---------------------------------------------------------------------------
// CORS
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000",
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOW.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Cache-Control, Authorization, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

// ---------------------------------------------------------------------------
/** Static: /public */
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// API ROUTE MOUNT ORDER
app.use("/api/v1/ohlc", ohlcRouter); // deep-history OHLC
app.use("/api", apiRouter);          // your other API routes

// ---------------------------------------------------------------------------
// GitHub RAW base (owner/repo/branch configurable via env)
const RAW_OWNER  = process.env.RAW_OWNER  || "bfrye1973";
const RAW_REPO   = process.env.RAW_REPO   || "frye-market-backend";
const RAW_BRANCH = process.env.RAW_BRANCH || "main";

// Paths (override if your repo layout changes)
const PATH_INTRADAY       = process.env.RAW_PATH_INTRADAY
  || "data-live-10min/data/outlook_intraday.json";
const PATH_HOURLY         = process.env.RAW_PATH_HOURLY
  || "data-live-hourly/data/outlook_hourly.json";
const PATH_EOD            = process.env.RAW_PATH_EOD
  || "data-live-eod/data/outlook.json";
const PATH_INTRADAY_DELTA = process.env.RAW_PATH_INTRADAY_DELTA
  || "data-live-10min-sandbox/data/outlook_intraday.json";

// Helper: build raw URL w/ cache-bust
const rawUrl = (pathStr) =>
  `https://raw.githubusercontent.com/${RAW_OWNER}/${RAW_REPO}/${RAW_BRANCH}/${pathStr}?t=${Date.now()}`;

// Helper: fetch raw JSON and forward status with no-store headers
async function proxyRawJSON(res, url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    const body = await r.text();

    // Always forward upstream status
    res.status(r.status);

    // Force browser to avoid caching
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    return res.send(body);
  } catch (err) {
    console.error("proxy error:", err);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
}

// ---------------------------------------------------------------------------
// LIVE proxies used by dashboard rows
app.get("/live/intraday", (_req, res) =>
  proxyRawJSON(res, rawUrl(PATH_INTRADAY))
);

app.get("/live/hourly", (_req, res) =>
  proxyRawJSON(res, rawUrl(PATH_HOURLY))
);

app.get("/live/eod", (_req, res) =>
  proxyRawJSON(res, rawUrl(PATH_EOD))
);

// NEW: 5-minute sandbox deltas (bypass GitHub CDN in the browser)
app.get("/live/intraday-deltas", (_req, res) =>
  proxyRawJSON(res, rawUrl(PATH_INTRADAY_DELTA))
);

/* --------------------------- QA: Market Meter math --------------------------- */
// GET /qa/meter  → recompute key metrics from sectorCards and compare to live JSON
import crypto from "crypto";

app.get("/qa/meter", async (req, res) => {
  try {
    const LIVE_URL = process.env.LIVE_URL ||
      "https://frye-market-backend-1.onrender.com/live/intraday";

    const r = await fetch(LIVE_URL, { cache: "no-store" });
    if (!r.ok) return res.status(r.status).json({ ok:false, error:`upstream ${r.status}` });
    const j = await r.json();

    const cards = Array.isArray(j?.sectorCards) ? j.sectorCards : [];

    // recompute from cards
    let NH=0, NL=0, UP=0, DN=0, rising=0, offUp=0, defDn=0;
    const OFF = new Set(["Information Technology","Communication Services","Consumer Discretionary"]);
    const DEF = new Set(["Consumer Staples","Utilities","Health Care","Real Estate"]);

    function pct(a,b){ return b === 0 ? 0 : 100 * a / b; }

    for (const c of cards) {
      const nh = +c.nh || 0, nl = +c.nl || 0, up = +c.up || 0, dn = +c.down || 0;
      NH += nh; NL += nl; UP += up; DN += dn;
      const b = pct(nh, nh+nl);
      if (b > 50) rising++;
      const sec = String(c.sector || "");
      if (OFF.has(sec) && b > 50) offUp++;
      if (DEF.has(sec) && b < 50) defDn++;
    }

    const calc = {
      breadth_pct:  pct(NH, NH+NL),
      momentum_pct: pct(UP, UP+DN),
      risingPct:    pct(rising, 11),
      riskOnPct:    pct(offUp + defDn, OFF.size + DEF.size),
    };

    const live = {
      breadth_pct:  +(j?.metrics?.breadth_pct ?? 0),
      momentum_pct: +(j?.metrics?.momentum_pct ?? 0),
      risingPct:    +((j?.intraday?.sectorDirection10m)?.risingPct ?? 0),
      riskOnPct:    +((j?.intraday?.riskOn10m)?.riskOnPct ?? 0),
    };

    function line(label, a, b, tol){
      const d = +(a - b).toFixed(2);
      const ok = Math.abs(d) <= tol;
      const emoji = ok ? "✅" : "❌";
      return `${emoji} ${label.padEnd(12)} live=${a.toFixed(2).padStart(6)}  calc=${b.toFixed(2).padStart(6)}  Δ=${d>=0?'+':''}${d.toFixed(2)} (tol ±${tol})`;
    }

    const tol = { breadth_pct:0.25, momentum_pct:0.25, risingPct:0.5, riskOnPct:0.5 };

    const rows = [
      line("Breadth %",  live.breadth_pct,  calc.breadth_pct,  tol.breadth_pct),
      line("Momentum %", live.momentum_pct, calc.momentum_pct, tol.momentum_pct),
      line("Rising %",   live.risingPct,    calc.risingPct,    tol.risingPct),
      line("Risk-On %",  live.riskOnPct,    calc.riskOnPct,    tol.riskOnPct),
    ];

    const pass = rows.every(r => r.startsWith("✅"));
    const stamp = (j?.updated_at || j?.updated_at_utc || "").toString();

    res.setHeader("Cache-Control","no-store");
    res.setHeader("Content-Type","text/plain; charset=utf-8");
    res.send([
      `QA Meter Check  (${stamp})`,
      `Source: ${LIVE_URL}`,
      "",
      ...rows,
      "",
      `Summary: ${pass ? "PASS ✅" : "FAIL ❌"}`,
      ""
    ].join("\n"));

  } catch (e) {
    res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
});

// ---------------------------------------------------------------------------
// Health
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, service: "backend", ts: new Date().toISOString() })
);

// 404 + Error Handlers
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

// ---------------------------------------------------------------------------
// Start
app.listen(PORT, () => {
  console.log(
    `[OK] backend listening on :${PORT}
 - /api/v1/ohlc
 - /api/*
 - /live/intraday
 - /live/hourly
 - /live/eod
 - /live/intraday-deltas (5m sandbox)
 - /healthz`
  );
});
