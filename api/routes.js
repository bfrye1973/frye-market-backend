// api/routes.js — ESM router (sector cards + numbers/aliases, real Engine Lights, volatility placeholder)

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
  String(s || "").trim().split(" ").map(w => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
const orderKey = (label) => {
  const n = String(label || "").trim().toLowerCase();
  const syn = n === "tech" ? "information technology" : n;
  const i = PREFERRED_ORDER.indexOf(syn);
  return i === -1 ? 999 : i;
};

function computeCardNumbers(vals){
  const spark = Array.isArray(vals?.spark) ? vals.spark : [];
  if (spark.length >= 2){
    const first = Number(spark[0]) || 0;
    const last  = Number(spark[spark.length - 1]) || 0;
    const base  = Math.abs(first) > 1e-9 ? Math.abs(first) : 1;
    const delta   = last - first;
    const deltaPct = (delta / base) * 100;
    return { last, delta, deltaPct };
  }
  const nh = Number(vals?.nh ?? 0);
  const nl = Number(vals?.nl ?? 0);
  const netNH = Number(vals?.netNH ?? (nh - nl));
  const denom = (nh + nl) > 0 ? (nh + nl) : 1;
  const deltaPct = (netNH / denom) * 100;
  return { last: netNH, delta: netNH, deltaPct };
}

function normalizeSectorCards(json){
  json.outlook = json.outlook || {};
  const sectors = (json.outlook.sectors && typeof json.outlook.sectors === "object") ? json.outlook.sectors : null;

  let cards = [];
  if (sectors){
    cards = Object.keys(sectors).map(name => {
      const v = sectors[name] || {};
      const nh    = Number(v.nh ?? 0);
      const nl    = Number(v.nl ?? 0);
      const netNH = Number(v.netNH ?? (nh - nl));
      const netUD = Number(v.netUD ?? 0);
      const spark = Array.isArray(v.spark) ? v.spark : [];
      const outlook = netNH > 0 ? "Bullish" : netNH < 0 ? "Bearish" : "Neutral";

      const { last, delta, deltaPct } = computeCardNumbers(v);

      // include multiple aliases so any UI binding will find what it needs
      return {
        sector: toTitle(name),
        outlook,
        spark,
        nh, nl, netNH, netUD,
        last,                 // primary value
        value: last,          // alias
        deltaPct,             // primary percent change
        pct: deltaPct,        // alias
        changePct: deltaPct,  // alias
        delta                 // points change (fallback)
      };
    });
  }

  // ensure all 11 exist
  const have = new Set(cards.map(c => c.sector.toLowerCase()));
  for (const s of PREFERRED_ORDER){
    const label = toTitle(s);
    if (!have.has(label.toLowerCase())){
      cards.push({
        sector: label,
        outlook: "Neutral",
        spark: [],
        nh:0, nl:0, netNH:0, netUD:0,
        last:0, value:0, delta:0, deltaPct:0, pct:0, changePct:0
      });
    }
  }

  cards.sort((a,b) => orderKey(a.sector) - orderKey(b.sector));
  json.outlook.sectorCards = cards;

  // ✅ mirror to top-level for legacy UIs
  json.sectorCards = cards;

  return json;
}

/* -------- volatility placeholder (0..100) -------- */
function addVolatilityPlaceholder(json){
  json.gauges = json.gauges || {};
  if (!Number.isFinite(json?.gauges?.volatilityPct)) json.gauges.volatilityPct = 50;
  return json;
}

/* -------- real Engine Lights (signals) -------- */
function computeSignals(json){
  const g = json?.gauges || {};
  const rpmPct   = Number(g?.rpm?.pct   ?? json?.breadthIdx ?? 0);
  const speedPct = Number(g?.speed?.pct ?? json?.momentumIdx ?? 0);
  const fuelPct  = Number(g?.fuel?.pct  ?? json?.squeeze ?? 0);
  const oilPsi   = Number(g?.oil?.psi   ?? g?.oilPsi ?? 60);

  const sectors = (json?.outlook?.sectors && typeof json.outlook.sectors === "object") ? json.outlook.sectors : {};
  const netMarketNH = Object.values(sectors).reduce((sum, v) => {
    const nh  = Number(v?.nh ?? 0), nl = Number(v?.nl ?? 0);
    return sum + Number(v?.netNH ?? (nh - nl));
  }, 0);

  const signals = {
    sigBreakout:     { active: netMarketNH > 0,  severity: netMarketNH > 50 ? "warn"   : "info" },
    sigDistribution: { active: netMarketNH < 0,  severity: netMarketNH < -50 ? "danger" : "warn" },
    sigCompression:  { active: fuelPct >= 70,    severity: fuelPct >= 90 ? "danger" : "warn" },
    sigExpansion:    { active: fuelPct > 0 && fuelPct < 40, severity: "info" },
    sigOverheat:     { active: speedPct > 85,    severity: speedPct > 92 ? "danger" : "warn" },
    sigTurbo:        { active: speedPct > 92 && fuelPct < 40, severity: "warn" },
    sigDivergence:   { active: speedPct > 60 && rpmPct < 40,  severity: "warn" },
    sigLowLiquidity: { active: oilPsi < 40,      severity: oilPsi < 30 ? "danger" : "warn" }
  };

  // keep off-signals clean
  for (const k of Object.keys(signals)){
    if (!signals[k].active) signals[k] = { active:false };
  }
  return signals;
}

/* -------- gauges table rows (simple passthrough) -------- */
function buildGaugeRowsFromDashboard(dash, index){
  const g = dash?.gauges || {};
  const rows = [];
  const breadthIdx  = dash?.summary?.breadthIdx ?? dash?.breadthIdx ?? g?.rpm?.pct ?? null;
  const momentumIdx = dash?.summary?.momentumIdx ?? dash?.momentumIdx ?? g?.speed?.pct ?? null;
  if (breadthIdx !== null)  rows.push({ label:"Breadth",  value:Number(breadthIdx),  unit:"%", index });
  if (momentumIdx !== null) rows.push({ label:"Momentum", value:Number(momentumIdx), unit:"%", index });
  const oilPsi  = g?.oil?.psi ?? g?.oilPsi ?? null;
  const fuelPct = g?.fuel?.pct ?? g?.squeeze?.pct ?? null;
  if (oilPsi  !== null) rows.push({ label:"Liquidity (PSI)", value:Number(oilPsi),  unit:"psi", index });
  if (fuelPct !== null) rows.push({ label:"Squeeze (Fuel)",  value:Number(fuelPct), unit:"%",   index });
  return rows;
}

/* -------- Router -------- */
export default function buildRouter(){
  const router = express.Router();

  router.get("/health", (req,res) => {
    noStore(res).json({ ok:true, ts:new Date().toISOString(), service:"frye-market-backend" });
  });

  router.get("/dashboard", async (req,res) => {
    try{
      let json = await readJsonFromProject("data/outlook.json");
      if (!json) throw new Error("outlook.json not found");

      json = normalizeSectorCards(json);
      json = addVolatilityPlaceholder(json);
      json.signals = computeSignals(json);
      json.meta = json.meta || {};
      json.meta.ts = json.meta.ts || json.updated_at || new Date().toISOString();

      return noStore(res).json(json);
    }catch(e){
      console.error("dashboard error:", e?.message || e);
      return noStore(res).status(500).json({
        ok:false,
        outlook:{ sectorCards:[] },
        gauges:{ volatilityPct:50 },
        signals:{},
        meta:{ ts:new Date().toISOString() },
        error:String(e?.message || e),
      });
    }
  });

  router.get("/gauges", async (req,res) => {
    try{
      const index = (req.query.index || req.query.symbol || Object.keys(req.query)[0] || "SPY").toString();
      const dash = await readJsonFromProject("data/outlook.json");
      if (!dash) return noStore(res).json([]);
      const rows = buildGaugeRowsFromDashboard(dash, index);
      return noStore(res).json(Array.isArray(rows)? rows : []);
    }catch(e){
      console.error("gauges error:", e?.message || e);
      return noStore(res).json([]);
    }
  });

  router.get("/v1/ohlc", (req,res) => {
    const symbol    = req.query.symbol || "SPY";
    const timeframe = req.query.timeframe || "1d";
    const tfSec = ({ "1m":60,"5m":300,"15m":900,"30m":1800,"1h":3600,"1d":86400 })[timeframe] || 3600;

    const now = Math.floor(Date.now()/1000);
    const bars = [];
    let px = 640;
    for (let i=60; i>0; i--){
      const t = now - i*tfSec;
      const o = px;
      const c = px + (Math.random()-0.5)*2;
      const h = Math.max(o,c) + Math.random();
      const l = Math.min(o,c) - Math.random();
      const v = Math.floor(1_000_000 + Math.random()*500_000);
      bars.push({ time:t, open:o, high:h, low:l, close:c, volume:v });
      px = c;
    }
    return noStore(res).json({ bars, symbol, timeframe });
  });

  return router;
}
