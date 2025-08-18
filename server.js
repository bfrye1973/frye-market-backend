// server.js — single-file Express backend (CommonJS)
// Env vars used:
//   - CORS_ORIGIN                (comma-separated origins; default https://frye-dashboard.onrender.com)
//   - POLYGON_API_KEY            (for live quotes; if missing we serve a stub)
//   - MARKET_MONITOR_CSV_URL     (Google Sheet “Publish to web” CSV link)

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

// Node 18+ has global fetch. If you use an older Node locally, upgrade Node
// or polyfill with:  const fetch = (...args) => import('node-fetch').then(m => m.default(...args))

const PORT = process.env.PORT || 3000;

// CORS allow list (comma-separated). Example:
// CORS_ORIGIN="https://frye-dashboard.onrender.com,http://localhost:5173"
const DEFAULT_ORIGINS = "https://frye-dashboard.onrender.com";
const ALLOW_LIST = String(process.env.CORS_ORIGIN || DEFAULT_ORIGINS)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.set("trust proxy", 1);

// ---------- Middleware ----------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("combined"));

app.use(
  cors({
    origin(origin, cb) {
      // allow server-to-server (no Origin) and explicit origins
      if (!origin || ALLOW_LIST.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);
app.options("*", cors()); // Preflight

// ---------- Health ----------
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "backend", time: new Date().toISOString() });
});
app.get("/api/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "backend", alias: "/api/healthz", time: new Date().toISOString() });
});
app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "backend", alias: "/api/health", time: new Date().toISOString() });
});

// ---------- Ping / Echo ----------
app.get("/api/ping", (_req, res) => res.json({ ok: true, message: "pong", ts: Date.now(), path: "/api/ping" }));
app.get("/api/v1/ping", (_req, res) => res.json({ ok: true, message: "pong", ts: Date.now(), path: "/api/v1/ping" }));
app.post("/api/v1/echo", (req, res) => res.json({ ok: true, received: req.body ?? null, ts: Date.now() }));

// ---------- Quotes (Polygon live with change/pct; stub otherwise) ----------
app.get("/api/v1/quotes", async (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const key = process.env.POLYGON_API_KEY;

  // Stub: consistent shape with change/pct
  if (!key) {
    const prevClose = 443.21;
    const price = 444.44;
    const change = +(price - prevClose).toFixed(2);
    const pct = +((change / prevClose) * 100).toFixed(2);
    return res.json({
      ok: true,
      symbol,
      price,
      prevClose,
      change,
      pct,
      time: new Date().toISOString(),
      source: "stub",
      note: "Set POLYGON_API_KEY to use live data",
    });
  }

  try {
    // Fetch last trade and previous close in parallel
    const encoded = encodeURIComponent(symbol);
    const [lastResp, prevResp] = await Promise.all([
      fetch(`https://api.polygon.io/v2/last/trade/${encoded}?apiKey=${key}`),
      fetch(`https://api.polygon.io/v2/aggs/ticker/${encoded}/prev?adjusted=true&apiKey=${key}`),
    ]);

    const lastJson = await lastResp.json();
    const prevJson = await prevResp.json();

    if (!lastResp.ok) {
      return res
        .status(lastResp.status)
        .json({ ok: false, error: lastJson?.error || "Polygon error (last trade)", data: lastJson });
    }

    // Polygon last-trade: { results: { p: price, t: ns_timestamp, ... } }
    const results = lastJson?.results || {};
    const rawTs = results.t ?? Date.now(); // ns or ms
    const tsMs = typeof rawTs === "number" && rawTs > 1e12 ? Math.round(rawTs / 1e6) : rawTs; // ns -> ms
    const price = results.p ?? results.price ?? null;

    // Polygon prev close: { results: [{ c: close, ... }] }
    const prevClose =
      Array.isArray(prevJson?.results) && prevJson.results[0]
        ? prevJson.results[0].c ?? null
        : null;

    let change = null,
      pct = null;
    if (typeof price === "number" && typeof prevClose === "number" && prevClose) {
      change = +(price - prevClose).toFixed(2);
      pct = +((change / prevClose) * 100).toFixed(2);
    }

    return res.json({
      ok: true,
      symbol,
      price,
      prevClose,
      change,
      pct,
      time: new Date(tsMs).toISOString(),
      source: "polygon",
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- OHLC History (Polygon; stub if no key) ----------
app.get("/api/v1/ohlc", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.timeframe || "1m").toLowerCase(); // e.g., 1m,5m,15m,1h,1d
    const now = new Date();
    const toISO = now.toISOString().slice(0, 10);

    // map timeframe -> polygon range
    const tfMap = {
      "1m": { mult: 1, span: "minute", lookbackDays: 2 },
      "5m": { mult: 5, span: "minute", lookbackDays: 7 },
      "15m": { mult: 15, span: "minute", lookbackDays: 14 },
      "30m": { mult: 30, span: "minute", lookbackDays: 30 },
      "1h": { mult: 60, span: "minute", lookbackDays: 30 },
      "1d": { mult: 1, span: "day", lookbackDays: 365 },
    };
    const cfg = tfMap[tf] || tfMap["1m"];

    const from = new Date(now.getTime() - cfg.lookbackDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const key = process.env.POLYGON_API_KEY;

    // Stub if no key
    if (!key) {
      const n = 200;
      let price = 400;
      const out = [];
      for (let i = 0; i < n; i++) {
        const o = price;
        const h = o + Math.random() * 2;
        const l = o - Math.random() * 2;
        const c = l + Math.random() * (h - l);
        const v = Math.floor(1000000 * (0.6 + Math.random()));
        price = c;
        const t = Date.now() - (n - i) * cfg.mult * 60 * 1000; // minute spacing
        out.push({ t, o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2), v });
      }
      return res.json({ ok: true, symbol, timeframe: tf, source: "stub", bars: out });
    }

    // Polygon aggregates
    const encoded = encodeURIComponent(symbol);
    const url = `https://api.polygon.io/v2/aggs/ticker/${encoded}/range/${cfg.mult}/${cfg.span}/${from}/${toISO}?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: j?.error || "Polygon error", data: j });
    }

    const bars = Array.isArray(j?.results)
      ? j.results.map((b) => ({
          t: typeof b.t === "number" && b.t > 1e12 ? Math.round(b.t / 1e6) : b.t, // ns->ms
          o: b.o, h: b.h, l: b.l, c: b.c, v: b.v,
        }))
      : [];

    return res.json({ ok: true, symbol, timeframe: tf, source: "polygon", bars });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- Market Monitor (Google Sheet CSV) ----------
const MARKET_MONITOR_CSV_URL = process.env.MARKET_MONITOR_CSV_URL || "";

// Order taken from your sheet header row (after Date, QQQ, SPY, MDY, IWM):
const MM_GROUPS = [
  "Small+Large Cap",
  "Mid Cap",
  "Small Cap",
  "Tech",
  "Consumer",
  "Healthcare",
  "Financials",
  "Energy",
  "Industrials",
  "Materials",
  "Defensive",
  "Real Estate",
  "Comms Svcs",
  "Utilities",
];

// 60s in-memory cache
let _mmCache = { at: 0, rows: null };

function parseCsvSimple(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const rows = [];
  const nowYear = new Date().getFullYear();

  for (const line of lines) {
    const cols = line.split(",").map((s) => s.trim());
    const rawDate = cols[0];
    if (!rawDate || rawDate.toLowerCase().includes("date")) continue;

    let iso;
    if (rawDate.includes("/")) {
      // handle M/D (no year) → assume current year
      const [m, d] = rawDate.split("/").map((v) => parseInt(v, 10));
      if (!m || !d) continue;
      const month = String(m).padStart(2, "0");
      const day = String(d).padStart(2, "0");
      iso = `${nowYear}-${month}-${day}`;
    } else {
      // already YYYY-MM-DD-ish
      iso = rawDate.slice(0, 10);
    }

    const num = (v) => Number(String(v).replace(/[^0-9.\-]/g, "")) || 0;

    const indices = {
      QQQ: num(cols[1]),
      SPY: num(cols[2]),
      MDY: num(cols[3]),
      IWM: num(cols[4]),
    };

    const groups = {};
    let base = 5;
    for (let i = 0; i < MM_GROUPS.length; i++) {
      const name = MM_GROUPS[i];
      const g = {
        "10NH": num(cols[base + 0]),
        "10NL": num(cols[base + 1]),
        "3U": num(cols[base + 2]),
        "3D": num(cols[base + 3]),
      };
      g.net = g["10NH"] - g["10NL"];
      groups[name] = g;
      base += 4;
    }

    rows.push({ date: iso, indices, groups });
  }

  return rows.filter((r) => r.date && r.indices);
}

app.get("/api/v1/market-monitor", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(365, Number(req.query.limit || 30)));
    const latest = String(req.query.latest || "false").toLowerCase() === "true";

    if (!MARKET_MONITOR_CSV_URL) {
      return res.status(200).json({ ok: true, source: "stub", rows: [] });
    }

    const now = Date.now();
    if (_mmCache.rows && now - _mmCache.at < 60_000) {
      const rows = _mmCache.rows.slice(-limit);
      return res.json({
        ok: true,
        source: "cache",
        rows: latest ? [rows[rows.length - 1]] : rows,
      });
    }

    const r = await fetch(MARKET_MONITOR_CSV_URL);
    if (!r.ok) return res.status(r.status).json({ ok: false, error: "CSV fetch failed" });
    const csv = await r.text();
    const rows = parseCsvSimple(csv);

    _mmCache = { at: now, rows };
    const out = rows.slice(-limit);
    res.json({ ok: true, source: "sheet", rows: latest ? [out[out.length - 1]] : out });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path });
});

// ---------- Error handler ----------
app.use((err, _req, res, _next) => {
  const status = err?.status || 500;
  res.status(status).json({ ok: false, error: err?.message || "Server error" });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
  console.log("Allowed origins:", ALLOW_LIST.join(", ") || "(none)");
});
