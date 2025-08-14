// server.js — single-file Express backend (CommonJS)

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

// Node 18+ has global fetch. If you run <18 locally, upgrade Node.
// (Alternative: install node-fetch and polyfill fetch.)

const PORT = process.env.PORT || 3000;

// Comma-separated allow list, e.g.
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
  res.status(200).json({
    ok: true,
    service: "backend",
    time: new Date().toISOString(),
  });
});
app.get("/api/healthz", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "backend",
    alias: "/api/healthz",
    time: new Date().toISOString(),
  });
});
app.get("/api/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "backend",
    alias: "/api/health",
    time: new Date().toISOString(),
  });
});

// ---------- Ping ----------
app.get("/api/ping", (_req, res) => {
  res.json({ ok: true, message: "pong", ts: Date.now(), path: "/api/ping" });
});
app.get("/api/v1/ping", (_req, res) => {
  res.json({ ok: true, message: "pong", ts: Date.now(), path: "/api/v1/ping" });
});

// ---------- Echo (POST) ----------
app.post("/api/v1/echo", (req, res) => {
  res.json({ ok: true, received: req.body ?? null, ts: Date.now() });
});

// ---------- Quotes (live via Polygon if key set; otherwise stub) ----------
app.get("/api/v1/quotes", async (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const key = process.env.POLYGON_API_KEY;

  // Fallback stub so UI always works
  if (!key) {
    const price = 444.44;
    const change = 1.23;
    const pct = Number(((change / (price - change)) * 100).toFixed(2));
    return res.json({
      ok: true,
      symbol,
      price,
      change,
      pct,
      time: new Date().toISOString(),
      source: "stub",
      note: "Set POLYGON_API_KEY to use live data",
    });
  }

  try {
    const url = `https://api.polygon.io/v2/last/trade/${encodeURIComponent(
      symbol
    )}?apiKey=${key}`;

    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({
        ok: false,
        error: data?.error || "Polygon error",
        data,
      });
    }

    // polygon payload shape: { results: { p: price, t: ns_timestamp, ... } }
    const results = data?.results || {};
    const rawTs = results.t ?? Date.now();
    const tsMs =
      typeof rawTs === "number" && rawTs > 1e12 ? Math.round(rawTs / 1e6) : rawTs;

    const price = results.p ?? results.price ?? null;

    return res.json({
      ok: true,
      symbol,
      price,
      time: new Date(tsMs).toISOString(),
      source: "polygon",
    });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, error: err?.message || String(err) });
  }
});

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path });
});

// ---------- Error handler (incl. CORS errors) ----------
app.use((err, _req, res, _next) => {
  const status = err?.status || 500;
  res.status(status).json({ ok: false, error: err?.message || "Server error" });
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
  console.log("Allowed origins:", ALLOW_LIST.join(", ") || "(none)");
});
