// server.js — single-file Express backend (CommonJS)

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const PORT = process.env.PORT || 3000;

// Comma-separated allow list. Example env:
// CORS_ORIGIN=https://frye-dashboard.onrender.com,http://localhost:5173
const DEFAULT_ORIGIN = "https://frye-dashboard.onrender.com";
const ALLOW_LIST = String(process.env.CORS_ORIGIN || DEFAULT_ORIGIN)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();
app.set("trust proxy", 1);

// ---------- Middleware ----------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("combined"));

// CORS (allow server-to-server/no-origin + listed origins)
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // e.g., curl/health checks
      if (ALLOW_LIST.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  })
);
// Preflight
app.options("*", cors());

// ---------- Health ----------
app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "backend",
    time: new Date().toISOString(),
  });
});
// Aliases some UIs use
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

// ---------- Quotes stub ----------
app.get("/api/v1/quotes", (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  // Demo values; swap with a real data provider later
  const price = 444.44;
  const change = 1.23;
  const pct = Number(((change / (price - change)) * 100).toFixed(2));
  res.json({
    ok: true,
    symbol,
    price,
    change,
    pct,
    time: new Date().toISOString(),
    source: "stub",
  });
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
