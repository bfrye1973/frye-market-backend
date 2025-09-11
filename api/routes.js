// api/routes.js — ESM router (normalized /dashboard, stub signals, volatility placeholder)

import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

/* -------- Resolve __dirname in ESM -------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* -------- small utils -------- */
function noStore(res) {
  res.set("Cache-Control", "no-store");
  return res;
}

async function readJsonFromProject(relPathFromProjectRoot) {
  // routes.js is in /api; project root is one level up
  const abs = path.resolve(__dirname, "..", relPathFromProjectRoot);
  try {
    const raw = await fs.readFile(abs, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* -------- sectorCards normalization (guarantee 11) -------- */
const PREFERRED_ORDER = [
  "information technology","materials","healthcare","communication services","real estate",
  "energy","consumer staples","consumer discretionary","financials","utilities","industrials",
];

const toTitle = (s) =>
  String(s || "")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");

const orderKey = (label) => {
  const n = String(label || "").trim().toLowerCase();
  // accept common synonym
  const syn = n === "tech" ? "information technology" : n;
  const i = PREFERRED_ORDER.indexOf(syn);
  return i === -1 ? 999 : i;
};

function normalizeSectorCards(json) {
  json.outlook = json.outlook || {};
  const sectors =
    json.outlook.sectors && typeof json.outlook.sectors === "object"
      ? json.outlook.sectors
      : null;

  let cards = [];
  if (sectors) {
    cards = Object.keys(sectors).map((name) => {
      const vals  = sectors[name] || {};
      const nh    = Number(vals.nh ?? 0);
      const nl    = Number(vals.nl ?? 0);
      const netNH = Number(vals.netNH ?? (nh - nl)); // breadth proxy
      const netUD = Number(vals.netUD ?? 0);
      const spark = Array.isArray(vals.spark) ? vals.spark : [];

      const outlook =
        netNH > 0 ? "Bullish" :
        netNH < 0 ? "Bearish" : "Neutral";

      return {
        sector: toTitle(name),
        outlook,
        spark,
        nh,
        nl,
        netNH,
        netUD,
      };
    });
  }

  // ensure all 11 exist (fill any missing with Neutral placeholders)
  const have = new Set(cards.map((c) => c.sector.toLowerCase()));
  for (const s of PREFERRED_ORDER) {
    const label = toTitle(s);
    if (!have.has(label.toLowerCase())) {
      cards.push({
        sector: label,
        outlook: "Neutral",
        spark: [],
        nh: 0, nl: 0, netNH: 0, netUD: 0,
      });
    }
  }

  cards.sort((a, b) => orderKey(a.sector) - orderKey(b.sector));
  json.outlook.sectorCards = cards;
  return json;
}

/* -------- volatility placeholder (0..100) -------- */
function addVolatilityPlaceholder(json) {
  json.gauges = json.gauges || {};
  if (!Number.isFinite(json?.gauges?.volatilityPct)) {
    json.gauges.volatilityPct = 50; // neutral placeholder; swap when real metric ready
  }
  return json;
}

/* -------- stub signals so Engine Lights light up -------- */
function addStubSignals(json) {
  // If you later compute real signals, remove this stub.
  if (json.signals) return json; // don't clobber real signals
  json.signals = {
    sigBreakout:     { active: true,  severity: "warn"   },
    sigCompression:  { active: true,  severity: "danger" },
    sigExpansion:    { active: false },
    sigTurbo:        { active: false },
    sigDistribution: { active: false },
    sigDivergence:   { active: false },
    sigOverheat:     { active: false },
    sigLowLiquidity: { active: false },
  };
  return json;
}

/* -------- gauges table rows (simple passthrough) -------- */
function buildGaugeRowsFromDashboard(dash, index) {
  const g = dash?.gauges || {};
  const rows = [];

  const breadthIdx  = dash?.summary?.breadthIdx ?? dash?.breadthIdx ?? g?.rpm?.pct ?? null;
  const momentumIdx = dash?.summary?.momentumIdx ?? dash?.momentumIdx ?? g?.speed?.pct ?? null;

  if (breadthIdx !== null)  rows.push({ label: "Breadth",  value: Number(breadthIdx),  unit: "%",  index });
  if (momentumIdx !== null) rows.push({ label: "Momentum", value: Number(momentumIdx), unit: "%",  index });

  const oilPsi  = g?.oil?.psi ?? g?.oilPsi ?? null;
  const fuelPct = g?.fuel?.pct ?? g?.squeeze?.pct ?? null;
  if (oilPsi  !== null) rows.push({ label: "Liquidity (PSI)", value: Number(oilPsi),   unit: "psi", index });
  if (fuelPct !== null) rows.push({ label: "Squeeze (Fuel)",  value: Number(fuelPct), unit: "%",   index });

  return rows;
}

/* -------- Router -------- */
export default function buildRouter() {
  const router = express.Router();

  // Health
  router.get("/health", (req, res) => {
    noStore(res).json({ ok: true, ts: new Date().toISOString(), service: "frye-market-backend" });
  });

  // Dashboard
  router.get("/dashboard", async (req, res) => {
    try {
      let json = await readJsonFromProject("data/outlook.json");
      if (!json) throw new Error("outlook.json not found");

      // Normalize + placeholders + stub signals
      json = normalizeSectorCards(json);
      json = addVolatilityPlaceholder(json);
      json = addStubSignals(json);

      json.meta = json.meta || {};
      json.meta.ts = json.meta.ts || json.updated_at || new Date().toISOString();

      return noStore(res).json(json);
    } catch (e) {
      console.error("dashboard error:", e?.message || e);
      return noStore(res).status(500).json({
        ok: false,
        outlook: { sectorCards: [] },
        gauges: { volatilityPct: 50 },
        signals: {},
        meta: { ts: new Date().toISOString() },
        error: String(e?.message || e),
      });
    }
  });

  // Gauges rows (array), never 500s
  router.get("/gauges", async (req, res) => {
    try {
      const index = (req.query.index || req.query.symbol || Object.keys(req.query)[0] || "SPY").toString();
      const dash = await readJsonFromProject("data/outlook.json");
      if (!dash) return noStore(res).json([]);
      const rows = buildGaugeRowsFromDashboard(dash, index);
      return noStore(res).json(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error("gauges error:", e?.message || e);
      return noStore(res).json([]);
    }
  });

  // Dummy OHLC (chart testing)
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
