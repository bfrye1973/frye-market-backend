// server.js — full Express server (ESM)
// - CORS
// - Static
// - OHLC history (/api/v1/ohlc)
// - LIVE now bar (/api/v1/live/nowbar, /api/v1/live/diag)
// - GitHub raw proxies for dashboard tiles (/live/intraday, /live/hourly, /live/eod)
// - Health, 404, error

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRouter from "./api/routes.js";
import { ohlcRouter } from "./routes/ohlc.js";
import { streamRouter } from "./routes/stream.js";

// ...after other app.use(...)
app.use("/stream", streamRouter);


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

app.use(express.json({ limit: "1mb" }));

/* --------------------------- Static: /public ----------------------------- */
app.use(express.static(path.join(__dirname, "public")));

/* ===================== API ROUTE MOUNT ORDER (CRITICAL) ================== */
/** Mount deep-history OHLC first so it can't be shadowed by /api. */
app.use("/api/v1/ohlc", ohlcRouter);

/** Mount the rest of your API (generic router). */
app.use("/api", apiRouter);

/* ------------------------------ LIVE NOW-BAR ----------------------------- */
/**
 * GET /api/v1/live/nowbar?symbol=SPY&tf=10m
 * -> { ok:true, tf, symbol, bar:{ time, open, high, low, close, volume } }
 *
 * GET /api/v1/live/diag?symbol=SPY&tf=10m
 * -> { ok:true, upstreamStatus, url, polygon }
 */
function getPolyKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}
function tfParams(tf = "10m") {
  const t = String(tf || "").toLowerCase();
  const map = {
    "1m":  { mult: 1,   span: "minute", backDays: 7   },
    "5m":  { mult: 5,   span: "minute", backDays: 14  },
    "10m": { mult: 10,  span: "minute", backDays: 30  },
    "15m": { mult: 15,  span: "minute", backDays: 30  },
    "30m": { mult: 30,  span: "minute", backDays: 60  },
    "1h":  { mult: 60,  span: "minute", backDays: 90  },
    "4h":  { mult: 240, span: "minute", backDays: 120 },
    "1d":  { mult: 1,   span: "day",    backDays: 365 },
  };
  return map[t] || map["10m"];
}

app.get("/api/v1/live/nowbar", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfIn   = String(req.query.tf || req.query.timeframe || "10m");
    const tf     = tfParams(tfIn);

    const now    = new Date();
    const toISO  = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const from   = new Date(now); from.setDate(from.getDate() - tf.backDays);
    const fromISO= from.toISOString().slice(0, 10); // YYYY-MM-DD

    const API = getPolyKey();
    if (!API) return res.status(500).json({ ok:false, error:"Missing POLYGON_API env" });

    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${tf.mult}/${tf.span}/${fromISO}/${toISO}` +
      `?adjusted=true&sort=desc&limit=1&apiKey=${API}`;

    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return res.status(r.status).json({ ok:false, error:`upstream ${r.status}` });
    const j = await r.json();
    const results = Array.isArray(j?.results) ? j.results : [];

    let bar;
    if (results.length > 0) {
      const b = results[0];
      bar = {
        time:   Math.floor(Number(b.t) / 1000),
        open:   Number(b.o),
        high:   Number(b.h),
        low:    Number(b.l),
        close:  Number(b.c),
        volume: Number(b.v ?? 0),
      };
    } else {
      // Fallback: last trade as synthetic bar (keeps UI moving)
      const tradeUrl = `https://api.polygon.io/v2/last/trade/${symbol}?apiKey=${API}`;
      const tr = await fetch(tradeUrl, { cache: "no-store" });
      const tj = await tr.json();
      const p = Number(tj?.results?.p ?? 0);
      const t = Math.floor(Number(tj?.results?.t ?? Date.now()) / 1000);
      bar = { time: t, open: p, high: p, low: p, close: p, volume: 0 };
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok:true, tf: tfIn, symbol, bar });
  } catch (e) {
    console.error("nowbar error:", e);
    return res.status(500).json({ ok:false, error:e?.message || "server error" });
  }
});

app.get("/api/v1/live/diag", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfIn   = String(req.query.tf || "10m");
    const tf     = tfParams(tfIn);

    const now    = new Date();
    const toISO  = now.toISOString().slice(0, 10);
    const from   = new Date(now); from.setDate(from.getDate() - tf.backDays);
    const fromISO= from.toISOString().slice(0, 10);

    const API = getPolyKey();
    if (!API) return res.status(500).json({ ok:false, error:"Missing POLYGON_API env" });

    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${tf.mult}/${tf.span}/${fromISO}/${toISO}` +
      `?adjusted=true&sort=desc&limit=1&apiKey=${API}`;

    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json();

    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok:true, upstreamStatus:r.status, url, polygon: j });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e?.message || "diag error" });
  }
});

/* --------------------------- GitHub raw proxies -------------------------- */
/** These power Market Meter / Engine Lights / Index Sectors tiles. */
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
    return res.status(502).json({ ok:false, error:"Bad Gateway" });
  }
}

// NOTE: these use **branch names** as part of the path.
app.get("/live/intraday", (_req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-10min/data/outlook_intraday.json`)
);
app.get("/live/hourly", (_req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-hourly/data/outlook_hourly.json`)
);
app.get("/live/eod", (_req, res) =>
  proxyRaw(res, `${GH_RAW_BASE}/data-live-eod/data/outlook.json`)
);

/* -------------------------------- Health --------------------------------- */
app.get("/healthz", (req, res) =>
  res.json({ ok: true, service: "backend", ts: new Date().toISOString() })
);

/* ------------------------ 404 + Error Handlers --------------------------- */
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok:false, error:"Internal Server Error" });
});

/* --------------------------------- Start --------------------------------- */
app.listen(PORT, () => {
  console.log(`[OK] backend listening on :${PORT}
- GET /api/v1/ohlc?symbol=SPY&timeframe=10m|1h|1d
- GET /api/v1/live/nowbar?symbol=SPY&tf=10m
- GET /api/v1/live/diag?symbol=SPY&tf=10m
- GET /live/intraday | /live/hourly | /live/eod
- GET /healthz
`);
});
