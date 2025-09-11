// api/routes.js — ESM router (normalized /dashboard, stub signals, volatility placeholder, sector card numbers)

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

/** Compute the numeric pair the UI shows inside the card */
function computeCardNumbers(name, vals) {
  // prefer sparkline if present: last & percent change vs first
  const spark = Array.isArray(vals?.spark) ? vals.spark : [];
  if (spark.length >= 2) {
    const first = Number(spark[0]) || 0;
    const last  = Number(spark[spark.length - 1]) || 0;
    const base  = Math.abs(first) > 1e-9 ? Math.abs(first) : 1; // avoid /0
    const deltaPct = ((last - first) / base) * 100;
    return { last, deltaPct };
  }

  // fallback: use breadth proxy if no spark
  const nh = Number(vals?.nh ?? 0);
  const nl = Number(vals?.nl ?? 0);
  const netNH = Number(vals?.netNH ?? (nh - nl));
  const denom = (nh + nl) > 0 ? (nh + nl) : 1;
  const deltaPct = (netNH / denom) * 100; // relative breadth tilt today
  return { last: netNH, deltaPct };
}

function normalizeSectorCards(json) {
  json.outlook = json.outlook || {};
  const sectors =
    json.outlook.sectors && typeof json.outlook.sectors === "object"
      ? json.outlook.sectors
      : null;

  let cards = [];
  if (sectors) {
    cards = Object.keys(sectors).map((name) => {
      const v = sectors[name] || {};
      const nh    = Number(v.nh ?? 0);
      const nl    = Number(v.nl ?? 0);
      const netNH = Number(v.netNH ?? (nh - nl));
      const netUD = Number(v.netUD ?? 0);
      const spark = Array.isArray(v.spark) ? v.spark : [];

      const outlook =
        netNH > 0 ? "Bullish" :
        netNH < 0 ? "Bearish" : "Neutral";

      const { last, deltaPct } = computeCardNumbers(name, v);

      return {
        sector: toTitle(name),
        outlook,
        spark,
        nh, nl, netNH, netUD,
        // 👇 numbers the frontend expects to display
        last,
        deltaPct
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
        last: 0, deltaPct: 0
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
