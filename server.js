// server.js — Express (ESM) with SSE + ETag poller
// - CORS
// - Static /public
// - /api/v1/ohlc (deep history) + /api (other routes)
// - LIVE proxies: /live/intraday, /live/hourly, /live/eod, /live/intraday-deltas
// - NEW: /live/intraday/stream (SSE) + /live/intraday/cache (cached snapshot, no-store)
// - QA route: /qa/meter
// - Health, 404, error

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "node:crypto";
import apiRouter from "./api/routes.js";            // /api/*
import { ohlcRouter } from "./routes/ohlc.js";      // /api/v1/ohlc

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------------------------------------------------------------------------
 * ESM __dirname shim
 * ------------------------------------------------------------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure fetch exists (Node 18+ has global fetch)
if (typeof fetch !== "function") {
  const { default: nodeFetch } = await import("node-fetch");
  // @ts-ignore
  globalThis.fetch = nodeFetch;
}

/* ---------------------------------------------------------------------------
 * CORS
 * ------------------------------------------------------------------------ */
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

/* ---------------------------------------------------------------------------
 * Static
 * ------------------------------------------------------------------------ */
app.use(express.static(path.join(__dirname, "public")));

/* ---------------------------------------------------------------------------
 * API ROUTE MOUNT ORDER (critical)
 * ------------------------------------------------------------------------ */
app.use("/api/v1/ohlc", ohlcRouter);
app.use("/api", apiRouter);

/* ---------------------------------------------------------------------------
 * GitHub RAW config
 * ------------------------------------------------------------------------ */
const RAW_OWNER  = process.env.RAW_OWNER  || "bfrye1973";
const RAW_REPO   = process.env.RAW_REPO   || "frye-market-backend";
const RAW_BRANCH = process.env.RAW_BRANCH || "main";

const PATH_INTRADAY       = process.env.RAW_PATH_INTRADAY       || "data-live-10min/data/outlook_intraday.json";
const PATH_HOURLY         = process.env.RAW_PATH_HOURLY         || "data-live-hourly/data/outlook_hourly.json";
const PATH_EOD            = process.env.RAW_PATH_EOD            || "data-live-eod/data/outlook.json";
const PATH_INTRADAY_DELTA = process.env.RAW_PATH_INTRADAY_DELTA || "data-live-10min-sandbox/data/outlook_intraday.json";

const rawUrlBusted = (p) =>
  `https://raw.githubusercontent.com/${RAW_OWNER}/${RAW_REPO}/${RAW_BRANCH}/${p}?t=${Date.now()}`;

// Poller should *not* use cache-busting, so ETag/304 works:
const rawUrlNoCache = (p) =>
  `https://raw.githubusercontent.com/${RAW_OWNER}/${RAW_REPO}/${RAW_BRANCH}/${p}`;

/* ---------------------------------------------------------------------------
 * Lightweight RAW proxy with no-store headers (kept for backward compat)
 * ------------------------------------------------------------------------ */
async function proxyRawJSON(res, url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    const body = await r.text();
    res.status(r.status);
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

/* ---------------------------------------------------------------------------
 * LIVE proxies used by dashboard rows
 *   ✅ intraday now uses in-memory cache (fast)
 *   ⏳ others still proxy GitHub RAW directly
 * ------------------------------------------------------------------------ */

// INTRADAY: serve from in-memory cache (latest), fallback to RAW once on cold start
app.get("/live/intraday", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (latest?.json) {
    return res.status(200).send(JSON.stringify(latest.json));
  }

  // Cold start fallback: hit RAW once
  return proxyRawJSON(res, rawUrlBusted(PATH_INTRADAY));
});

// HOURLY/EOD still go straight to RAW (can be migrated later if needed)
app.get("/live/hourly",          (_req, res) => proxyRawJSON(res, rawUrlBusted(PATH_HOURLY)));
app.get("/live/eod",             (_req, res) => proxyRawJSON(res, rawUrlBusted(PATH_EOD)));
app.get("/live/intraday-deltas", (_req, res) => proxyRawJSON(res, rawUrlBusted(PATH_INTRADAY_DELTA)));

/* ---------------------------------------------------------------------------
 * NEW: Intraday ETag poller + SSE broadcaster
 * ------------------------------------------------------------------------ */
const GH_TOKEN    = process.env.GITHUB_TOKEN || "";             // optional for higher rate limit
const POLL_MS     = Number(process.env.POLL_MS || 30000);       // default: 30s poll interval
const PING_MS     = Number(process.env.SSE_PING_MS || 15000);   // SSE heartbeat
const BACKOFF_MIN = 5000;
const BACKOFF_MAX = 120000;

const INTRADAY_URL = rawUrlNoCache(PATH_INTRADAY);

/** @type {{ json:any, etag?:string, updatedAt?:string } | null} */
let latest = null;
let lastFetchTs = 0;
let backoff = 0;
/** @type {Set<import("express").Response>} */
const sseClients = new Set();

function iso() {
  return new Date().toISOString();
}
function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function log(...args) {
  console.log(iso(), "-", ...args);
}

async function pollOnce() {
  const headers = { "Accept": "application/json" };
  if (GH_TOKEN) headers["Authorization"] = `Bearer ${GH_TOKEN}`;
  if (latest?.etag) headers["If-None-Match"] = latest.etag;

  try {
    const r = await fetch(INTRADAY_URL, { headers, cache: "no-store" });
    if (r.status === 304) {
      lastFetchTs = Date.now();
      backoff = 0;
      log("poll 304 Not Modified");
      return;
    }
    if (r.status !== 200) {
      throw new Error(`HTTP ${r.status}`);
    }

    const text = await r.text();
    const json = safeJson(text);
    if (!json) throw new Error("invalid JSON from upstream");

    const etag = r.headers.get("etag") || crypto.createHash("sha1").update(text).digest("hex");
    const changed = !latest || latest.etag !== etag;

    latest = { json, etag, updatedAt: iso() };
    lastFetchTs = Date.now();
    backoff = 0;

    if (changed) {
      log(`poll 200 OK changed (len=${text.length}) etag=${etag}`);
      broadcastUpdate();
    } else {
      log("poll 200 OK same etag (no change)");
    }
  } catch (e) {
    lastFetchTs = Date.now();
    backoff = backoff ? Math.min(backoff * 2, BACKOFF_MAX) : BACKOFF_MIN;
    log("poll ERROR:", e?.message || e);
  }
}

function startPollLoop() {
  (async function loop() {
    // initial fetch immediately so SSE + cache have data quickly
    await pollOnce();
    while (true) {
      await new Promise((r) => setTimeout(r, backoff || POLL_MS));
      await pollOnce();
    }
  })().catch((e) => log("poll loop terminated:", e));
}

function broadcastUpdate() {
  if (!latest?.json) return;
  const payload = JSON.stringify({
    type: "intraday",
    ts: latest.updatedAt,
    etag: latest.etag,
    payload: latest.json,
  });

  for (const res of sseClients) {
    try {
      res.write(`event: update\n`);
      res.write(`data: ${payload}\n\n`);
    } catch {
      try { res.end(); } catch {}
      sseClients.delete(res);
    }
  }
}

/* Serve cached snapshot (no-store). Useful for quick reads without hitting GitHub. */
app.get("/live/intraday/cache", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (!latest?.json) {
    // warmup / fallback
    return proxyRawJSON(res, rawUrlBusted(PATH_INTRADAY));
  }
  return res.status(200).send(JSON.stringify(latest.json));
});

/* SSE endpoint for instant updates */
app.get("/live/intraday/stream", (req, res) => {
  // set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "Pragma": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  sseClients.add(res);
  log("SSE connect. clients=", sseClients.size);

  // send initial snapshot
  if (latest?.json) {
    const hello = {
      type: "intraday",
      ts: latest.updatedAt,
      etag: latest.etag,
      payload: latest.json,
    };
    res.write(`event: hello\n`);
    res.write(`data: ${JSON.stringify(hello)}\n\n`);
  } else {
    res.write(`event: hello\n`);
    res.write(`data: ${JSON.stringify({ warming: true, ts: iso() })}\n\n`);
  }

  // heartbeat
  const ping = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      // ignore
    }
  }, PING_MS);

  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
    try { res.end(); } catch {}
    log("SSE disconnect. clients=", sseClients.size);
  });
});

/* ---------------------------------------------------------------------------
 * Diagnostics helpers (kept)
 * ------------------------------------------------------------------------ */
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

/* --------------------------- QA: Market Meter + Overall Light (kept) ------- */
app.get("/qa/meter", async (_req, res) => {
  try {
    const LIVE_URL = process.env.LIVE_URL || "https://frye-market-backend-1.onrender.com/live/intraday";
    const r = await fetch(LIVE_URL, { cache: "no-store" });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: `upstream ${r.status}` });
    const j = await r.json();

    const cards = Array.isArray(j?.sectorCards) ? j.sectorCards : [];
    let NH = 0, NL = 0, UP = 0, DN = 0, rising = 0, offUp = 0, defDn = 0;
    const OFF = new Set(["Information Technology", "Communication Services", "Consumer Discretionary"]);
    const DEF = new Set(["Consumer Staples", "Utilities", "Health Care", "Real Estate"]);
    const pct = (a, b) => (b === 0 ? 0 : (100 * a) / b);

    for (const c of cards) {
      const nh = +c.nh || 0;
      const nl = +c.nl || 0;
      const up = +c.up || 0;
      const dn = +c.down || 0;
      NH += nh; NL += nl; UP += up; DN += dn;

      const b = pct(nh, nh + nl);
      if (b > 50) rising++;

      const sec = String(c.sector || "");
      if (OFF.has(sec) && b > 50) offUp++;
      if (DEF.has(sec) && b < 50) defDn++;
    }

    const calc = {
      breadth_pct: pct(NH, NH + NL),
      momentum_10m_pct: pct(UP, UP + DN),
      risingPct: pct(rising, 11),
      riskOnPct: pct(offUp + defDn, OFF.size + DEF.size),
    };

    const live = {
      breadth_pct: +(j?.metrics?.breadth_pct ?? j?.metrics?.breadth_10m_pct ?? 0),
      momentum_10m_pct: +(j?.metrics?.momentum_10m_pct ?? 0),
      risingPct: +((j?.intraday?.sectorDirection10m)?.risingPct ?? 0),
      riskOnPct: +((j?.intraday?.riskOn10m)?.riskOnPct ?? 0),
    };

    const tol = { breadth_pct: 0.25, momentum_10m_pct: 0.25, risingPct: 0.5, riskOnPct: 0.5 };
    const line = (label, a, b, t) => {
      const d = +(a - b).toFixed(2);
      const ok = Math.abs(d) <= t;
      return `${ok ? "✅" : "❌"} ${label.padEnd(14)} live=${a.toFixed(2).padStart(6)}  calc=${b.toFixed(2).padStart(6)}  Δ=${d >= 0 ? "+" : ""}${d.toFixed(2)} (±${t})`;
    };

    const rows = [
      line("Breadth %",       live.breadth_pct,      calc.breadth_pct,      tol.breadth_pct),
      line("Momentum 10m %",  live.momentum_10m_pct, calc.momentum_10m_pct, tol.momentum_10m_pct),
      line("Rising %",        live.risingPct,        calc.risingPct,        tol.risingPct),
      line("Risk-On %",       live.riskOnPct,        calc.riskOnPct,        tol.riskOnPct),
    ];
    const pass = rows.every((r) => r.startsWith("✅"));
    const stamp = (j?.updated_at || j?.updated_at_utc || "").toString();

    const overall = j?.intraday?.overall10m || {};
    const ovState = String(overall.state ?? "n/a");
    const ovScore = Number.isFinite(+overall.score) ? +overall.score : NaN;
    const comps   = overall.components || {};
    const emaCross = String(j?.metrics?.ema_cross ?? "n/a");
    const emaDist  = Number.isFinite(+j?.metrics?.ema10_dist_pct) ? +j.metrics.ema10_dist_pct : NaN;

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send([
      `QA Meter Check  (${stamp})`,
      `Source: ${LIVE_URL}`,
      "",
      ...rows,
      "",
      `Overall10m: state=${ovState}  score=${Number.isFinite(ovScore) ? ovScore : "n/a"}`,
      `  ema_cross=${emaCross}  ema10_dist_pct=${Number.isFinite(emaDist) ? emaDist.toFixed(2) + "%" : " n/a"}`,
      `  components:`,
      `    ema10=${comps.ema10 ?? "n/a"}  momentum=${comps.momentum ?? " n/a"}  breadth=${comps.breadth ?? " n/a"}`,
      `    squeeze=${compStr(comps.squeeze)}  liquidity=${compStr(comps.liquidity)}  riskOn=${compStr(comps.riskOn)}`,
      "",
      `Summary: ${pass ? "PASS ✅" : "FAIL ❌"}`,
      "",
    ].join("\n"));
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

function compStr(v) {
  return (v === 0 || v === 1 || v === -1) ? String(v) : "n/a";
}

/* ---------------------------------------------------------------------------
 * Health + 404/Errors (kept)
 * ------------------------------------------------------------------------ */
app.get("/healthz", (_req, res) =>
  res.json({
    ok: true,
    service: "backend",
    ts: new Date().toISOString(),
    cached: Boolean(latest?.json),
    lastFetchIso: lastFetchTs ? new Date(lastFetchTs).toISOString() : null,
  })
);

app.use((req, res) =>
  res.status(404).json({ ok: false, error: "Not Found", path: req.path })
);

app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

/* ---------------------------------------------------------------------------
 * Start
 * ------------------------------------------------------------------------ */
app.listen(PORT, () => {
  console.log(
    `[OK] backend listening on :${PORT}
 - /api/v1/ohlc
 - /api/*
 - /live/intraday
 - /live/hourly
 - /live/eod
 - /live/intraday-deltas
 - /live/intraday/cache   (cached snapshot, no-store)
 - /live/intraday/stream  (SSE)
 - /qa/meter
 - /healthz`
  );
  startPollLoop();
});
