// api/routes.js — ESM router with normalized /dashboard and safe fallbacks

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

/* Resolve __dirname in ESM */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* ---------- helpers ---------- */
function noStore(res) {
  res.set("Cache-Control", "no-store");
  return res;
}
function readJsonSafe(absPath) {
  try { return JSON.parse(fs.readFileSync(absPath, "utf8")); }
  catch { return null; }
}
function loadLocal(relPathFromProjectRoot) {
  // Routes live in /api. Project root is one level up from /api
  const abs = path.resolve(__dirname, "..", relPathFromProjectRoot);
  return readJsonSafe(abs);
}

/* ---------- normalization ---------- */
function normalizeDashboard(json) {
  json.gauges  = json.gauges  || {};
  json.outlook = json.outlook || {};
  json.meta    = json.meta    || {};

  // 1) squeezeDaily (compression %) — derive if missing
  const squeezeDaily =
    Number(json?.gauges?.squeezeDaily?.pct) ||
    Number(json?.gauges?.squeeze?.pct)      ||
    Number(json?.gauges?.fuel?.pct)         ||
    Number(json?.summary?.squeeze_pct);

  json.gauges.squeezeDaily = {
    pct: Number.isFinite(squeezeDaily) ? squeezeDaily : null,
    label: "Squeeze (Daily Compression)"
  };

  // 2) sectorCards — prefer outlook.sectorCards; convert legacy outlook.sectors; seed if empty
  let sectorCards = Array.isArray(json.outlook.sectorCards) ? json.outlook.sectorCards : [];

  if ((!sectorCards || sectorCards.length === 0) && json.outlook.sectors && typeof json.outlook.sectors === "object") {
    sectorCards = Object.keys(json.outlook.sectors).map(k => ({
      sector:  k,
      outlook: json.outlook.sectors[k]?.outlook ?? "Neutral",
      spark:   Array.isArray(json.outlook.sectors[k]?.spark) ? json.outlook.sectors[k].spark : []
    }));
  }

  if (!Array.isArray(sectorCards) || sectorCards.length === 0) {
    // TEMP SEED — remove when your real sectorCards are populated
    sectorCards = [
      { sector: "Technology", outlook: "Bullish",  spark: [120,125,130,128,132,137] },
      { sector: "Energy",     outlook: "Bearish",  spark: [ 85, 82, 79, 81, 78, 76] },
      { sector: "Financials", outlook: "Neutral",  spark: [100,101, 99,100,101,100] }
    ];
  }

  json.outlook.sectorCards = sectorCards;

  // timestamp
  json.meta.ts = json.meta.ts || json.updated_at || new Date().toISOString();
  return json;
}

/* ---------- /api/gauges builder ---------- */
function buildGaugeRowsFromDashboard(dash, index) {
  const g = dash?.gauges || {};
  const rows = [];

  const breadthIdx  = dash?.summary?.breadthIdx ?? dash?.breadthIdx ?? g?.rpm?.pct ?? null;
  const momentumIdx = dash?.summary?.momentumIdx ?? dash?.momentumIdx ?? g?.speed?.pct ?? null;

  if (breadthIdx !== null)  rows.push({ label: "Breadth",  value: Number(breadthIdx),  unit: "%",  index });
  if (momentumIdx !== null) rows.push({ label: "Momentum", value: Number(momentumIdx), unit: "%",  index });

  const oilPsi  = g?.oil?.psi  ?? null;
  const fuelPct = g?.fuel?.pct ?? g?.squeeze?.pct ?? null;

  if (oilPsi  !== null) rows.push({ label: "Liquidity (PSI)", value: Number(oilPsi),   unit: "psi", index });
  if (fuelPct !== null) rows.push({ label: "Squeeze (Fuel)",  value: Number(fuelPct), unit: "%",   index });

  return rows;
}

/* ---------- Router factory ---------- */
export default function buildRouter() {
  const router = express.Router();

  // Health
  router.get("/health", (req, res) => {
    noStore(res).json({ ok: true, ts: new Date().toISOString(), service: "frye-market-backend" });
  });

  // DASHBOARD: normalize & seed
  router.get("/dashboard", async (req, res) => {
    try {
      // Load from local data file; adjust path if your JSON lives elsewhere
      let json = loadLocal("data/outlook.json");
      if (!json) throw new Error("outlook.json not found");

      json = normalizeDashboard(json);
      return noStore(res).json(json);
    } catch (e) {
      console.error("dashboard error:", e.message);
      return noStore(res).json({
        ok: false,
        gauges: { squeezeDaily: { pct: null, label: "Squeeze (Daily Compression)" } },
        odometers: null,
        signals: null,
        outlook: { sectorCards: [] },
        meta: { ts: new Date().toISOString() },
        error: e.message
      });
    }
  });

  // GAUGES: array response for tables; never 500s
  router.get("/gauges", (req, res) => {
    try {
      const index = (req.query.index || req.query.symbol || Object.keys(req.query)[0] || "SPY").toString();
      const dash = loadLocal("data/outlook.json");
      if (!dash) return noStore(res).json([]);
      const rows = buildGaugeRowsFromDashboard(dash, index);
      return noStore(res).json(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error("gauges error:", e.message);
      return noStore(res).json([]);
    }
  });

  // OHLC: dummy data for chart testing
  router.get("/v1/ohlc", (req, res) => {
    const symbol = req.query.symbol || "SPY";
    const timeframe = req.query.timeframe || "1d";
    const tfSec = ({ "1m":60, "5m":300, "15m":900, "30m":1800, "1h":3600, "1d":86400 })[timeframe] || 3600;

    const now = Math.floor(Date.now() / 1000);
    const bars = [];
    let px = 640;

    for (let i = 60; i > 0; i--) {
      const t = now - i * tfSec;
      const o = px;
      const c = px + (Math.random() - 0.5) * 2;
      const h = Math.max(o, c) + Math.random();
      const l = Math.min(o, c) - Math.random();
      const v = Math.floor(1_000_000 + Math.random() * 500_000);
      bars.push({ time: t, open: o, high: h, low: l, close: c, volume: v });
      px = c;
    }
    return noStore(res).json({ bars, symbol, timeframe });
  });

  return router;
}
