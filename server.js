// server.js  — single-file Express backend (CommonJS)
// No "type":"module" required in package.json.

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const PORT = process.env.PORT || 3000;
// EXACT origin of your deployed frontend:
const FRONTEND_ORIGIN =
  process.env.CORS_ORIGIN || "https://frye-dashboard.onrender.com";

const ALLOW_LIST = [FRONTEND_ORIGIN];

const app = express();
app.set("trust proxy", 1);

// ---------- Middleware ----------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("combined"));

// CORS (allow server-to-server calls with no Origin + your frontend origin)
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOW_LIST.includes(origin)) return cb(null, true);
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

// Aliases some frontends use
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

// ---------- Ping endpoints ----------
app.get("/api/ping", (_req, res) => {
  res.json({ ok: true, message: "pong", ts: Date.now(), path: "/api/ping" });
});
app.get("/api/v1/ping", (_req, res) => {
  res.json({ ok: true, message: "pong", ts: Date.now(), path: "/api/v1/ping" });
});

// ---------- Echo demo (POST) ----------
app.post("/api/v1/echo", (req, res) => {
  res.json({ ok: true, received: req.body ?? null, ts: Date.now() });
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
  console.log("Allowed origin:", FRONTEND_ORIGIN);
});
