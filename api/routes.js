// api/routes.js — ESM router (sector cards + numeric aliases, engine lights,
// ensure squeezeDaily, rpm/speed, volatility; with /debug and /outlook5d)

import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

/* -------- Resolve __dirname in ESM -------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* -------- small utils -------- */
function noStore(res) { res.set("Cache-Control","no-store"); return res; }
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

function computeCardNumbers(v){
  const spark = Array.isArray(v?.spark) ? v.spark : [];
  if (spark.length >= 2){
    const first = Number(spark[0]) || 0, last = Number(spark[spark.length-1]) || 0;
    const base = Math.abs(first) > 1e-9 ? Math.abs(first) : 1;
    const delta = last - first, deltaPct = (delta/base)*100;
    return { last, delta, deltaPct };
  }
  const nh = Number(v?.nh ?? 0), nl = Number(v?.nl ?? 0);
  const netNH = Number(v?.netNH ?? (nh - nl));
  const denom = (nh + nl) > 0 ? (nh + nl) : 1;
  const deltaPct = (netNH/denom)*100;
  return { last: netNH, delta: netNH, deltaPct };
}

function normalizeSectorCards(json){
  json.outlook = json.outlook || {};
  const sectors = (json.outlook.sectors && typeof json.outlook.sectors === "object") ? json.outlook.sectors : null;

  let cards = [];
  if (sectors){
    cards = Object.keys(sectors).map(name => {
      const v = sectors[name] || {};
      const nh = Number(v.nh ?? 0), nl = Number(v.nl ?? 0);
      const netNH = Number(v.netNH ?? (nh - nl)), netUD = Number(v.netUD ?? 0);
      const spark = Array.isArray(v.spark) ? v.spark : [];
      const outlook = netNH > 0 ? "Bullish" : netNH < 0 ? "Bearish" : "Neutral";
      const { last, delta, deltaPct } = computeCardNumbers(v);
      return { sector: toTitle(name), outlook, spark, nh, nl, netNH, netUD,
        last, value:last, deltaPct, pct:deltaPct, changePct:deltaPct, delta };
    });
  }

  // ensure all 11 exist
  const have = new Set(cards.map(c => c.sector.toLowerCase()));
  for (const s of PREFERRED_ORDER){
    const label = toTitle(s);
    if (!have.has(label.toLowerCase())){
      cards.push({ sector:label, outlook:"Neutral", spark:[], nh:0, nl:0, netNH:0, netUD:0,
        last:0, value:0, delta:0, deltaPct:0, pct:0, changePct:0 });
    }
  }

  cards.sort((a,b)=>orderKey(a.sector)-orderKey(b.sector));
  json.outlook.sectorCards = cards;
  json.sectorCards = cards; // legacy mirror
  return json;
}

/* -------- ensure squeeze (Daily + Intraday) -------- */
function ensureSqueeze(json){
  json.gauges = json.gauges || {};
  json.odometers = json.odometers || {};

  // daily squeeze
  if (!json.gauges.squeezeDaily || !Number.isFinite(json.gauges.squeezeDaily?.pct)) {
    const fromGlobal = Number(json?.global?.daily_squeeze_pct ?? NaN);
    const fromAlt    = Number(json?.squeezeDailyPct ?? NaN);
    const maybe = Number.isFinite(fromGlobal) ? fromGlobal : (Number.isFinite(fromAlt) ? fromAlt : NaN);
    if (Number.isFinite(maybe)) json.gauges.squeezeDaily = { pct: maybe };
  }

  // intraday squeeze odometer from fuel if missing
  if (!Number.isFinite(json.odometers.squeezeCompressionPct)) {
    const fuel = Number(json?.gauges?.fuel?.pct ?? NaN);
    if (Number.isFinite(fuel)) json.odometers.squeezeCompressionPct = fuel;
  }

  // optional manual override (for exact Lux value)
  const override = Number(process.env.DAILY_SQUEEZE_OVERRIDE ?? NaN);
  if (Number.isFinite(override)) {
    json.gauges.squeezeDaily = { pct: override };
  }

  return json;
}

/* -------- ensure indexes (rpm/speed) -------- */
function ensureIndexes(json){
  json.gauges = json.gauges || {};
  const b = Number(json?.summary?.breadthIdx ?? json?.breadthIdx ?? NaN);
  const m = Number(json?.summary?.momentumIdx ?? json?.momentumIdx ?? NaN);
  if (!Number.isFinite(json?.gauges?.rpm?.pct)   && Number.isFinite(b)) json.gauges.rpm   = { ...(json.gauges.rpm||{}),   pct:b };
  if (!Number.isFinite(json?.gauges?.speed?.pct) && Number.isFinite(m)) json.gauges.speed = { ...(json.gauges.speed||{}), pct:m };
  return json;
}

/* -------- ensure volatility (mirror water.pct if missing) -------- */
function ensureVolatility(json){
  json.gauges = json.gauges || {};
  const water = Number(json?.gauges?.water?.pct ?? NaN);
  if (!Number.isFinite(json?.gauges?.volatilityPct) && Number.isFinite(water)) {
    json.gauges.volatilityPct = water;
  }
  return json;
}

/* -------- Engine Lights -------- */
function computeSignals(json){
  const g = json?.gauges || {};
  const rpmPct   = Number(g?.rpm?.pct   ?? json?.breadthIdx ?? 0);
  const speedPct = Number(g?.speed?.pct ?? json?.momentumIdx ?? 0);
  const fuelPct  = Number(json?.odometers?.squeezeCompressionPct ?? g?.fuel?.pct ?? 0);
  const oilPsi   = Number(g?.oil?.psi   ?? g?.oilPsi ?? 60);
  const volPct   = Number(g?.volatilityPct ?? g?.water?.pct ?? 50);

  const sectors = (json?.outlook?.sectors && typeof json.outlook.sectors === "object") ? json.outlook.sectors : {};
  const netMarketNH = Object.values(sectors).reduce((sum, v) => {
    const nh  = Number(v?.nh ?? 0), nl = Number(v?.nl ?? 0);
    return sum + Number(v?.netNH ?? (nh - nl));
  }, 0);

  const signals = {
    sigBreakout:       { active: netMarketNH > 0,  severity: netMarketNH > 50 ? "warn"   : "info" },
    sigDistribution:   { active: netMarketNH < 0,  severity: netMarketNH < -50 ? "danger" : "warn" },
    sigCompression:    { active: fuelPct >= 70,    severity: fuelPct >= 90 ? "danger" : "warn" },
    sigExpansion:      { active: fuelPct > 0 && fuelPct < 40, severity: "info" },
    sigOverheat:       { active: speedPct > 85,    severity: speedPct > 92 ? "danger" : "warn" },
    sigTurbo:          { active: speedPct > 92 && fuelPct < 40, severity: "warn" },
    sigDivergence:     { active: speedPct > 60 && rpmPct < 40,  severity: "warn" },
    sigLowLiquidity:   { active: oilPsi < 40,      severity: oilPsi < 30 ? "danger" : "warn" },
    sigVolatilityHigh: { active: volPct > 70,      severity: volPct > 85 ? "danger" : "warn" },
  };

  for (const k of Object.keys(signals)){
    if (!signals[k].active) signals[k] = { active:false };
  }
  return signals;
}

/* -------- rows helper (for /api/gauges) -------- */
function buildGaugeRowsFromDashboard(dash, index){
  const g = dash?.gauges || {};
  const rows = [];
  const breadthIdx  = dash?.summary?.breadthIdx ?? dash?.breadthIdx ?? g?.rpm?.pct ?? null;
  const momentumIdx = dash?.summary?.momentumIdx ?? dash?.momentumIdx ?? g?.speed?.pct ?? null;
  if (breadthIdx !== null)  rows.push({ label:"Breadth",  value:Number(breadthIdx),  unit:"%", index });
  if (momentumIdx !== null) rows.push({ label:"Momentum", value:Number(momentumIdx), unit:"%", index });
  const oilPsi  = g?.oil?.psi ?? g?.oilPsi ?? null;
  const fuelPct = dash?.odometers?.squeezeCompressionPct ?? g?.fuel?.pct ?? null;
  if (oilPsi  !== null) rows.push({ label:"Liquidity (PSI)", value:Number(oilPsi),  unit:"psi", index });
  if (fuelPct !== null) rows.push({ label:"Squeeze (Fuel)",  value:Number(fuelPct), unit:"%",   index });
  return rows;
}

/* -------- Router -------- */
export default function buildRouter(){
  const router = express.Router();

  // Health
  router.get("/health", (req, res) =>
    noStore(res).json({ ok:true, ts:new Date().toISOString(), service:"frye-market-backend" })
  );

  // Dashboard (main payload)
  router.get("/dashboard", async (req, res) => {
    try{
      let json = await readJsonFromProject("data/outlook.json");
      if (!json) throw new Error("outlook.json not found");

      json = normalizeSectorCards(json);
      json = ensureSqueeze(json);
      json = ensureIndexes(json);
      json = ensureVolatility(json);
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

  // Gauges (rows) — optional helper
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

  // quick debug snapshot
  router.get("/debug", async (req, res) => {
    try {
      const dash = await readJsonFromProject("data/outlook.json");
      if (!dash) return noStore(res).status(404).json({ ok:false, error:"outlook.json not found" });

      const gg = dash.gauges || {};
      const od = dash.odometers || {};
      const summary = dash.summary || {};
      const sectors = (dash.outlook && dash.outlook.sectors) || {};
      const totals = Object.values(sectors).reduce((acc, v) => {
        acc.nh  += Number(v?.nh ?? 0);
        acc.nl  += Number(v?.nl ?? 0);
        acc.u   += Number(v?.up ?? v?.u ?? 0);
        acc.d   += Number(v?.down ?? v?.d ?? 0);
        return acc;
      }, { nh:0, nl:0, u:0, d:0 });

      return noStore(res).json({
        ok: true,
        ts: dash.updated_at || dash.ts || new Date().toISOString(),
        dailySqueezePct: Number(gg?.squeezeDaily?.pct ?? NaN),
        intradaySqueezePct: Number(od?.squeezeCompressionPct ?? gg?.fuel?.pct ?? NaN),
        breadthIdx:  Number(summary?.breadthIdx  ?? gg?.rpm?.pct   ?? NaN),
        momentumIdx: Number(summary?.momentumIdx ?? gg?.speed?.pct ?? NaN),
        totals
      });
    } catch (e) {
      return noStore(res).status(500).json({ ok:false, error:String(e) });
    }
  });

  // last 5 days (for narrator or checks)
  router.get("/outlook5d", async (req, res) => {
    try {
      const hist = await readJsonFromProject("data/history.json");
      const days = Array.isArray(hist?.days) ? hist.days.slice(-5) : [];
      const rows = days.map(d => ({
        date: d.date,
        nh: Number(d?.groups && Object.values(d.groups).reduce((a,g)=>a+Number(g?.nh||0),0) || 0),
        nl: Number(d?.groups && Object.values(d.groups).reduce((a,g)=>a+Number(g?.nl||0),0) || 0),
        u:  Number(d?.groups && Object.values(d.groups).reduce((a,g)=>a+Number(g?.u ||0),0) || 0),
        d:  Number(d?.groups && Object.values(d.groups).reduce((a,g)=>a+Number(g?.d ||0),0) || 0)
      }));
      return noStore(res).json({ ok:true, rows });
    } catch (e) {
      return noStore(res).status(500).json({ ok:false, error:String(e) });
    }
  });

  return router;
}
