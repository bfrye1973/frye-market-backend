// server.js — Express ESM with CORS, static assets, API router, GitHub proxies,
// and the OHLC route mounted FIRST so it cannot be shadowed.

/* ----------------------------- Imports (ESM) ----------------------------- */
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRouter from "./api/routes.js";
import { ohlcRouter } from "./routes/ohlc.js";

/* --------------------------- App / Constants ----------------------------- */
const app = express();
const PORT = process.env.PORT || 3000;

/* ------------- __dirname in ESM (safe across environments) --------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ------------------------------- CORS ------------------------------------ */
/** Allow the dashboard origin(s) only; reflect origin on success; short-circuit OPTIONS. */
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

/* ---------------------------- Body Parsing ------------------------------- */
app.use(express.json({ limit: "1mb" }));

/* --------------------------- Static: /public ----------------------------- */
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

/* ---------------------- Local static JSON mirrors ------------------------ */
function noStore(_, res, next) {
  res.setHeader("Cache-Control", "no-store");
  next();
}
app.use("/data-live-10min",  noStore, express.static(path.join(__dirname, "data-live-10min",  "data")));
app.use("/data-live-hourly", noStore, express.static(path.join(__dirname, "data-live-hourly", "data")));
app.use("/data-live-eod",    noStore, express.static(path.join(__dirname, "data-live-eod",    "data")));

/* ===================== API ROUTE MOUNT ORDER (CRITICAL) ================== */
/** Mount the deep-history OHLC route FIRST so it cannot be shadowed by /api. */
app.use("/api/v1/ohlc", ohlcRouter);

/** Mount the rest of your API under /api (generic router SECOND). */
app.use("/api", apiRouter);

/* --------------------------- GitHub raw proxies -------------------------- */
const GH_RAW_BASE =
  "https://raw.githubusercontent.com/bfrye1973/frye-market-backend";

async function proxyRaw(res, url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: `Upstream ${r.status}` });
    }
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
app.get("/live/hourly", (req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-hourly/data/outlook_hourly.json`)
);
app.get("/live/eod", (req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-eod/data/outlook.json`)
);

/* -------------------------------- Health --------------------------------- */
app.get("/healthz", (req, res) => res.json({ ok: true }));

/* ------------------------ 404 + Error Handlers --------------------------- */
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

/* --------------------------------- Start --------------------------------- */
app.listen(PORT, () => {
  console.log(`[OK] backend listening on :${PORT}
- GET /api/v1/ohlc?symbol=SPY&timeframe=10m|1h|1d
- GET /live/intraday
- GET /live/hourly
- GET /live/eod
- GET /api/...
`);
});
