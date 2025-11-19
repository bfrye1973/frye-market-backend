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

app.get("/__routes", (_req, r_
