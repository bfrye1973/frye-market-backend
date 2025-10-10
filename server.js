// server.js — Express ESM
// - CORS
// - Static
// - /api/v1/ohlc (deep history) + /api (other routes)
// - LIVE proxies: /live/intraday, /live/hourly, /live/eod
// - NEW: /live/intraday-deltas (5m sandbox, no-store)
// - Health, 404, error

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// Optional routers (adjust paths to your repo layout)
import apiRouter from "./api/routes.js";            // keep if you have /api
import { ohlcRouter } from "./routes/ohlc.js";      // keep if you have /api/v1/ohlc

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ------------------------------- CORS ------------------------------------ */
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000"
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOW.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Cache-Control, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

/* --------------------------- Static: /public ----------------------------- */
app.use(express.static(path.join(__dirname, "public")));

/* ===================== API ROUTE MOUNT ORDER ============================= */
app.use("/api/v1/ohlc", ohlcRouter);   // deep-history OHLC
app.use("/api", apiRouter);            // your other API routes

/* ------------------------ GitHub RAW proxies ----------------------------- */
// Helper to fetch raw JSON and forward with no-store headers
async function proxyRawJSON(res, url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    const text = await r.text();
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(r.status).send(text);
  } catch (e) {
    console.error("proxy error:", e);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
}

const GH_RAW_BASE = "https://raw.githubusercontent.com/bfrye1973/frye-market-backend";

// Canonical LIVE feeds used by the dashboard rows
app.get("/live/intraday",  (_req, res) =>
  proxyRawJSON(res, `${GH_RAW_BASE}/data-live-10min/data/outlook_intraday.json?t=${Date.now()}`)
);
app.get("/live/hourly",    (_req, res) =>
  proxyRawJSON(res, `${GH_RAW_BASE}/data-live-hourly/data/outlook_hourly.json?t=${Date.now()}`)
);
app.get("/live/eod",       (_req, res) =>
  proxyRawJSON(res, `${GH_RAW_BASE}/data-live-eod/data/outlook.json?t=${Date.now()}`)
);

// NEW: 5-minute sandbox deltas (bypass GitHub CDN in the browser)
app.get("/live/intraday-deltas", (_req, res) =>
  proxyRawJSON(res, `${GH_RAW_BASE}/data-live-10min-sandbox/data/outlook_intraday.json?t=${Date.now()}`)
);

/* -------------------------------- Health --------------------------------- */
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, service: "backend", ts: new Date().toISOString() })
);

/* ------------------------ 404 + Error Handlers --------------------------- */
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

/* --------------------------------- Start --------------------------------- */
app.listen(PORT, () => {
  console.log(
    `[OK] backend listening on :${PORT}\n` +
    " - /api/v1/ohlc\n" +
    " - /api/*\n" +
    " - /live/intraday\n" +
    " - /live/hourly\n" +
    " - /live/eod\n" +
    " - /live/intraday-deltas (5m sandbox)\n" +
    " - /healthz"
  );
});
