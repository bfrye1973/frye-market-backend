// server.js — Express ESM with CORS, static, API, and GitHub branch proxies

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import buildRouter from "./api/routes.js";

const app = express();
const PORT = process.env.PORT || 10000;

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
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Cache-Control, Authorization, X-Requested-With"
  );
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ---------- /public static (optional) ---------- */
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

/* ---------- Local static mounts (if files are copied on disk) ---------- */
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
app.use("/api", buildRouter());

/* ---------- GitHub raw proxies ---------- */
// NOTE: branch files actually live in GitHub, not on Render disk.
// These endpoints always pull the freshest JSON from GitHub branches.

const GH_RAW_BASE =
  "https://raw.githubusercontent.com/bfrye1973/frye-market-backend";

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

// Intraday (10-min) → branch: data-live-10min, path: data/outlook_intraday.json
app.get("/live/intraday", (req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-10min/main/data/outlook_intraday.json`)
);

// EOD (daily) → branch: data-live-eod, path: data/outlook.json
app.get("/live/eod", (req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-eod/main/data/outlook.json`)
);

// Hourly → branch: data-live-hourly, path: data/outlook_hourly.json
app.get("/live/hourly", (req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-hourly/main/data/outlook_hourly.json`)
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
- GET /api/...
`);
});
