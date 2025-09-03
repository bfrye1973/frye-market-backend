// server.js — minimal Express backend for Ferrari Dashboard
// - /api/health
// - /api/dashboard (serves data/outlook.json) with Cache-Control: no-store
// - /api/source   (optional raw counts)      with Cache-Control: no-store
// - static public/ (optional)
// NOTE: Ensure "express" is in package.json dependencies.

const path = require("path");
const fs = require("fs");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

// --- health ---
app.get("/api/health", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, service: "frye-market-backend", ts: new Date().toISOString() });
});

// --- dashboard payload (frontend-ready JSON) ---
app.get("/api/dashboard", (req, res) => {
  try {
    res.set("Cache-Control", "no-store"); // <- important
    const p = path.join(__dirname, "data", "outlook.json");
    const txt = fs.readFileSync(p, "utf8");
    res.json(JSON.parse(txt));
  } catch (e) {
    console.error("dashboard error:", e);
    res.status(500).json({ ok: false, error: "cannot read data/outlook.json" });
  }
});

// --- raw counts (optional debug/verification) ---
app.get("/api/source", (req, res) => {
  try {
    res.set("Cache-Control", "no-store"); // <- important
    const p = path.join(__dirname, "data", "outlook_source.json");
    const txt = fs.readFileSync(p, "utf8");
    res.json(JSON.parse(txt));
  } catch (e) {
    console.error("source error:", e);
    res.status(500).json({ ok: false, error: "cannot read data/outlook_source.json" });
  }
});

// --- serve /public if present (optional) ---
const PUBLIC_DIR = path.join(__dirname, "public");
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
}

// 404 + error handler
app.use((req, res) => res.status(404).json({ ok: false, error: "Not Found" }));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ ok: false, error: "Internal Server Error" });
});

app.listen(PORT, () =>
  console.log(`[OK] frye-market-backend listening on :${PORT}\n- GET /api/health\n- GET /api/dashboard\n- GET /api/source`)
);
