// /src/server.js — full server with stream mount added
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import apiRouter from "./api/routes.js";
import { ohlcRouter } from "./routes/ohlc.js";
import streamRouter from "./routes/stream.js"; // <— NEW

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------------------- CORS ------------------------------------ */
const ALLOW = new Set([
  "https://frye-dashboard.onrender.com",
  "http://localhost:3000",
]);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOW.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Cache-Control, Authorization, X-Requested-With, X-Idempotency-Key"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "1mb" }));

/* --------------------------- Static: /public ----------------------------- */
app.use(express.static(path.join(__dirname, "public")));

/* ------------------------------ Core API -------------------------------- */
app.use("/api/v1/ohlc", ohlcRouter);  // history for chart
app.use("/api", apiRouter);           // your other API routes

/* ---------------------------- Stream (SSE) ------------------------------- */
// Isolated streaming route; does not affect other sections
app.use("/stream", streamRouter);

/* ----------------------- GitHub raw JSON proxies ------------------------ */
// These power Market Meter / Engine Lights / Index Sectors tiles
const GH_RAW_BASE =
  "https://raw.githubusercontent.com/bfrye1973/frye-market-backend";

async function proxyRaw(res, url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return res.status(r.status).json({ ok: false, error: `Upstream ${r.status}` });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const text = await r.text();
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
}

app.get("/live/intraday", (_req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-10min/data/outlook_intraday.json`)
);
app.get("/live/hourly", (_req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-hourly/data/outlook_hourly.json`)
);
app.get("/live/eod", (_req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-eod/data/outlook.json`)
);

/* -------------------------------- Health -------------------------------- */
app.get("/healthz", (_req, res) =>
  res.json({ ok: true, service: "backend", ts: new Date().toISOString() })
);

/* ------------------------ 404 + Error Handlers --------------------------- */
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

/* --------------------------------- Start -------------------------------- */
app.listen(PORT, () => {
  console.log(`[OK] backend listening on :${PORT}
- /api/v1/ohlc
- /stream/agg      (SSE)
- /live/intraday   (tiles)
- /live/hourly     (tiles)
- /live/eod        (tiles)
- /healthz
`);
});
