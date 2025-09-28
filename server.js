// server.js — Express ESM with CORS, static, API, GitHub proxies, and OHLC route

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRouter from "./api/routes.js";
import { ohlcRouter } from "./routes/ohlc.js"; // ✅ new import

const app = express();
const PORT = process.env.PORT || 3000;

/* ---------- Resolve __dirname (ESM safe) ---------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------- CORS (allow dashboard + localhost) ---------- */
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
    "Content-Type, Cache-Control, Authorization, X-Requested-With, X-Idempotency-Key"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ---------- JSON body parsing (needed for POST orders) ---------- */
app.use(express.json());

/* ---------- /public static (optional) ---------- */
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

/* ---------- Local static mounts (optional) ---------- */
function noStore(_, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}
app.use(
  "/data-live-10min",
  noStore,
  express.static(path.join(__dirname, "data-live-10min", "data"))
);
app.use(
  "/data-live-hourly",
  noStore,
  express.static(path.join(__dirname, "data-live-hourly", "data"))
);
app.use(
  "/data-live-eod",
  noStore,
  express.static(path.join(__dirname, "data-live-eod", "data"))
);

/* ---------- API ---------- */
app.use("/api", apiRouter);
app.use("/api/v1/ohlc", ohlcRouter); // ✅ new mount

/* ---------- GitHub raw proxies ---------- */
const GH_RAW_BASE = "https://raw.githubusercontent.com/bfrye1973/frye-market-backend";

async function proxyRaw(res, url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok)
      return res
        .status(r.status)
        .json({ ok: false, error: `Upstream ${r.status}` });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    const text = await r.text();
    return res.send(text);
  } catch (e) {
    console.error("Proxy error:", e);
    return res.status(502).json({ ok: false, error: "Bad Gateway" });
  }
}

app.get("/live/intraday", (req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-10min/data/outlook_intraday.json`)
);
app.get("/live/eod", (req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-eod/data/outlook.json`)
);
app.get("/live/hourly", (req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-hourly/data/outlook_hourly.json`)
);

/* ---------- Health ---------- */
app.get("/healthz", (req, res) => res.json({ ok: true }));

/* ---------- 404 + error handling ---------- */
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

/* ---------- Start ---------- */
app.listen(PORT, () => {
  console.log(`[OK] backend listening on :${PORT}
- GET /live/intraday
- GET /live/eod
- GET /live/hourly
- GET /api/v1/ohlc?symbol=SPY&timeframe=10m
- GET /api/...
`);
});
