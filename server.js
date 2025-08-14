// server.js  (single file backend)
// Works without "type":"module" in package.json

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

// ----- Config -----
const PORT = process.env.PORT || 3000;
// EXACT origin of your deployed frontend:
const FRONTEND_ORIGIN =
  process.env.CORS_ORIGIN || "https://frye-dashboard.onrender.com";

// You can add more allowed origins here if needed
const ALLOW_LIST = [FRONTEND_ORIGIN];

const app = express();
app.set("trust proxy", 1);

// ----- Middleware -----
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan("combined"));

// CORS with allow‑list (also allows server‑to‑server/no‑origin)
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
// Preflight for all routes
app.options("*", cors());

// ----- Health -----
app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "backend",
    time: new Date().toISOString(),
  });
});

// ----- API v1 -----
app.get("/api/v1/ping", (_req, res) => {
  res.json({ ok: true, message: "pong", ts: Date.now() });
});

app.post("/api/v1/echo", (req, res) => {
  res.json({ ok: true, received: req.body ?? null, ts: Date.now() });
});

// ----- 404 -----
app.use((req, res) => {
  res.status(404).json({ ok: false, error: "Not Found", path: req.path });
});

// ----- Error handler (incl. CORS errors) -----
/* eslint-disable no-unused-vars */
app.use((err, _req, res, _next) => {
  const status = err?.status || 500;
  res.status(status).json({
    ok: false,
    error: err?.message || "Server error",
  });
});
/* eslint-enable no-unused-vars */

// ----- Start -----
app.listen(PORT, () => {
  console.log(`API listening on port ${PORT}`);
  console.log("Allowed origin:", FRONTEND_ORIGIN);
});
