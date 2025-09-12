// api/routes.js — ESM router (sector cards + numeric aliases, engine lights,
// ensure squeezeDaily, rpm/speed, volatility; with /debug, /outlook5d, /v1/ohlc, /sectorTrend)

import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

/* -------- Resolve __dirname in ESM -------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* -------- env / providers -------- */
const POLY_KEY = process.env.POLYGON_API_KEY || ""; // if set, we use Polygon for OHLC

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

/* -------- timestamp utils (normalize to unix SECONDS) -------- */
function toUnixSeconds(t) {
  if (t == null) return null;

  if (typeof t === "string") {
    const ms = Date.parse(t); // NaN if invalid
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;

  if (n > 1e18) return Math.floor(n / 1e9); // ns -> s
  if (n > 1e15) return Math.floor(n / 1e6); // µs -> s
  if (n > 1e12) return Math.floor(n / 1e3); // ms -> s
  return Math.floor(n);                      // already seconds
}

function normalizeBars(rawBars) {
  const now = Math.floor(Date.now() / 1000);
  const FUTURE_PAD = 60 * 60; // allow +1h window
  const out = [];

  for (const b of rawBars || []) {
    const ts = toUnixSeconds(b.time ?? b.t ?? b.timestamp ?? b.startTimestamp);
    if (!ts) continue;
    if (ts > now + FUTURE_PAD) continue; // drop far-future bars
    out.push({
      time: ts,
      open: Number(b.open ?? b.o),
      high: Number(b.high ?? b.h),
      low:  Number(b.low  ?? b.l),
      close:Number(b.close?? b.c),
      volume:Number(b.volume ?? b.v ?? 0),
    });
  }
  out.sort((a,b) => a.time - b.time);
  return out;
}

/* -------- Polygon provider (optional) -------- */
const TF_MAP = {
  "1m": { mult: 1, unit: "minute" },
  "5m": { mult: 5, unit: "minute" },
  "15m": { mult: 15, unit: "minute" },
  "30m": { mult: 30, unit: "minute" },
  "1h": { mult: 1, unit: "hour" },
  "4h": { mult: 4, unit: "hour" },
  "1d": { mult: 1, unit: "day" },
};

async function getBarsFromPolygon(symbol, timeframe) {
  if (!POLY_KEY) throw new Error("POLYGON_API_KEY missing");
  const tf = TF_MAP[timeframe];
  if (!tf) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const end = new Date();
  const start = new Date(end.getTime() - 60 * 24 * 60 * 60 * 1000); // ~60 days back
  const fmt = (d) => d.toISOString().slice(0,10);

  const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
              `/range/${tf.mult}/${tf.unit}/${fmt(start)}/${fmt(end)}` +
              `?adjusted=true&sort=asc&limit=50000&apiKey=${POLY_KEY}`;

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(()=>"");
    throw new Error(`Polygon ${r.status}: ${txt.slice(0,180)}`);
  }
  const j = await r.json();
  const rows = Array.isArray(j?.results) ? j.results : [];
  // return in generic shape so normalizer can map
  return rows.map(x => ({ t:x.t, o:x.o, h:x.h, l:x.l, c:x.c, v:x.v }));
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

  // DAILY SQUEEZE only from builder/override (no fuel fallback)
  const fromGlobal = Number(json?.global?.daily_squeeze_pct ?? NaN);
  if (Number.isFinite(fromGlobal)) {
    json.gauges.squeezeDaily = { pct: fromGlobal };
  }

  // optional manual override (exact Lux number if you want to match TradingView)
  const override = Number(process.env.DAILY_SQUEEZE_OVERRIDE ?? NaN);
  if (Number.isFinite(override)) {
    json.gauges.squeezeDaily = { pct: override };
  }

  // intraday squeeze odometer from fuel if missing
  if (!Number.isFinite(json.odometers.squeezeCompressionPct)) {
    const fuel = Number(json?.gauges?.fuel?.pct ?? NaN);
    if (Number.isFinite(fuel)) json.odometers.squeezeCompressionPct = fuel;
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

  // ---- OHLC (normalized) ----
  router.get("/v1/ohlc", async (req, res) => {
    try {
      const symbol = String(req.query.symbol || "SPY").toUpperCase();
      const timeframe = String(req.query.timeframe || "1h");

      let bars = [];

      if (POLY_KEY) {
        // Use Polygon if configured
        const raw = await getBarsFromPolygon(symbol, timeframe);
        bars = normalizeBars(raw);
      } else {
        // Fallback to the existing stub generator if no provider configured
        const tfSec = ({
          "1m": 60, "5m": 300, "15m": 900, "30m": 1800,
          "1h": 3600, "4h": 14400, "1d": 86400
        })[timeframe] || 3600;

        const now = Math.floor(Date.now() / 1000);
        const n = 120;
        let px = 650;
        const gen = [];
        for (let i = n; i > 0; i--) {
          const t = now - i * tfSec;
          const drift = (Math.random() - 0.5) * 2.0;
          const open = px;
          const close = px + drift;
          const high = Math.max(open, close) + Math.random() * 0.8;
          const low  = Math.min(open, close) - Math.random() * 0.8;
          const volume = Math.floor(800000 + Math.random() * 600000);
          gen.push({ time: t, open, high, low, close, volume });
          px = close;
        }
        bars = normalizeBars(gen);
      }

      return noStore(res).json({ bars, symbol, timeframe });
    } catch (e) {
      console.error("ohlc error:", e?.message || e);
      return noStore(res).status(500).json({ ok:false, error:String(e) });
    }
  });

  // ---- Sector hour-over-hour trend for cards (new) ----
  router.get("/sectorTrend", async (req, res) => {
    try {
      const hist = await readJsonFromProject("data/history.json");
      const days = Array.isArray(hist?.days) ? hist.days : [];
      if (days.length < 1) return noStore(res).json({ ok:true, sectors:{} });

      const curr = days[days.length - 1]?.groups || {};
      const prev = days.length >= 2 ? days[days.length - 2]?.groups || {} : {};

      const norm = (s="") => s.trim().toLowerCase();
      const canon = (s) => (norm(s) === "tech" ? "information technology" : norm(s));

      const sectors = {};
      const allKeys = new Set([...Object.keys(curr), ...Object.keys(prev)]);
      for (const k of allKeys) {
        const key = canon(k);
        const c = curr[k] || {};
        const p = prev[k] || {};
        const cn = {
          nh: Number(c?.nh ?? 0),
          nl: Number(c?.nl ?? 0),
          up: Number(c?.u  ?? c?.up   ?? 0),
          down: Number(c?.d ?? c?.down ?? 0),
        };
        const pn = {
          nh: Number(p?.nh ?? 0),
          nl: Number(p?.nl ?? 0),
          up: Number(p?.u  ?? p?.up   ?? 0),
          down: Number(p?.d ?? p?.down ?? 0),
        };
        cn.netNH = cn.nh - cn.nl;
        pn.netNH = pn.nh - pn.nl;
        sectors[key] = { curr: cn, prev: pn };
      }

      return noStore(res).json({
        ok: true,
        asOf: days[days.length - 1]?.date || null,
        prev: days.length >= 2 ? days[days.length - 2]?.date : null,
        sectors
      });
    } catch (e) {
      return noStore(res).status(500).json({ ok:false, error:String(e) });
    }
  });

  return router;
}
