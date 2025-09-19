// api/routes.js — ESM router (sector cards + numeric aliases, engine lights,
// ensure squeezeDaily, rpm/speed, volatility; with /debug, /outlook5d, /v1/ohlc, /sectorTrend,
// and /replay/index + /replay/at + replay-aware OHLC &at=)
// UPDATED: /dashboard prefers intraday→hourly→eod→legacy & attaches per-cadence heartbeats.
// Index Sectors uses 10-min heartbeat (your request).

import express from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

/* -------- Resolve __dirname in ESM -------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* -------- project paths -------- */
const DATA_ROOT = path.resolve(__dirname, "..", "data");

/* -------- env / providers -------- */
const POLY_KEY = process.env.POLYGON_API_KEY || ""; // if set, we use Polygon for OHLC
const DAILY_SQUEEZE_OVERRIDE = process.env.DAILY_SQUEEZE_OVERRIDE;

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

async function readJsonAbs(absPath) {
  try {
    const raw = await fs.readFile(absPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* -------- NEW: safe text stamp reader (returns trimmed ISO or null) -------- */
async function readStamp(absPath) {
  try {
    const t = await fs.readFile(absPath, "utf8");
    return (t || "").trim() || null;
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
  "1m":  { mult: 1, unit: "minute" },
  "5m":  { mult: 5, unit: "minute" },
  "10m": { mult:10, unit: "minute" },
  "15m": { mult:15, unit: "minute" },
  "30m": { mult:30, unit: "minute" },
  "1h":  { mult: 1, unit: "hour" },
  "4h":  { mult: 4, unit: "hour" },
  "1d":  { mult: 1, unit: "day" },
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
      const nh = Number(v?.nh ?? 0), nl = Number(v?.nl ?? 0);
      const netNH = Number(v?.netNH ?? (nh - nl)), netUD = Number(v?.netUD ?? 0);
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
  json.sectorCards = cards;              // legacy mirror (top-level)
  json.outlook.sectors = cards;          // NEW legacy alias for older UI expecting outlook.sectors
  return json;
}

/* -------- ensure squeeze (Daily + Intraday) -------- */
function ensureSqueeze(json){
  json.gauges = json.gauges || {};
  json.odometers = json.odometers || {};

  // DAILY SQUEEZE only from builder/override (no fuel fallback)
  const fromGlobal = Number(json?.global?.daily_squeeze_pct ?? json?.global?.squeeze_daily_pct ?? NaN);
  if (Number.isFinite(fromGlobal)) {
    json.gauges.squeezeDaily = { pct: fromGlobal };
  }
  // optional manual override (exact Lux number if you want to match TradingView)
  const override = Number(DAILY_SQUEEZE_OVERRIDE ?? NaN);
  if (Number.isFinite(override)) {
    json.gauges.squeezeDaily = { pct: override };
  }

  // intraday squeeze odometer from fuel if missing
  if (!Number.isFinite(json.odometers?.squeezeCompressionPct)) {
    const fuel = Number(json?.gauges?.fuel?.pct ?? NaN);
    if (Number.isFinite(fuel)) json.odometers = { ...(json.odometers||{}), squeezeCompressionPct: fuel };
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
  const netMarketNH = Array.isArray(sectors)
    ? sectors.reduce((sum, v) => sum + Number(v?.netNH ?? 0), 0)
    : Object.values(sectors).reduce((sum, v) => {
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

/* -------- Replay helpers -------- */
function granDir(gran) {
  const g = (gran||"hourly").toLowerCase();
  if (g === "10min" || g === "10m") return "10min";
  if (g === "eod" || g === "daily") return "eod";
  return "hourly";
}
function tfDir(tf) {
  const t = (tf||"1h").toLowerCase();
  if (t === "10m" || t === "10min") return "10m";
  if (t === "1h" || t === "60m") return "1h";
  return "1d";
}
function isoFromArchName(s) {
  // outlook_YYYY-MM-DDTHH-MM-SSZ.json  →  YYYY-MM-DDTHH:MM:SSZ
  const core = s.replace(/^outlook_/, "").replace(/\.json$/, "");
  return core.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, (m,h,mn,s) => `T${h}:${mn}:${s}Z`);
}

/* -------- Router -------- */
export default function buildRouter(){
  const router = express.Router();

  // Health
  router.get("/health", (req, res) =>
    noStore(res).json({ ok:true, ts:new Date().toISOString(), service:"frye-market-backend" })
  );

  // Dashboard (main payload) — UPDATED with file preference + per-cadence stamps
  router.get("/dashboard", async (req, res) => {
    try{
      // Prefer intraday → hourly → eod → legacy outlook.json
      let json =
        (await readJsonFromProject("data/outlook_intraday.json")) ||
        (await readJsonFromProject("data/outlook_hourly.json")) ||
        (await readJsonFromProject("data/outlook_eod.json")) ||
        (await readJsonFromProject("data/outlook.json")); // legacy fallback

      if (!json) throw new Error("no outlook payload found");

      // Normalize + fill derived fields
      json = normalizeSectorCards(json);
      json = ensureSqueeze(json);
      json = ensureIndexes(json);
      json = ensureVolatility(json);
      json.signals = computeSignals(json);

      // Per-cadence heartbeats (files written by workflows)
      const hb10     = await readStamp(path.join(DATA_ROOT, "heartbeat_10min.txt"));
      const hb1h     = await readStamp(path.join(DATA_ROOT, "heartbeat_hourly.txt"));
      const hbEod    = await readStamp(path.join(DATA_ROOT, "heartbeat_eod.txt"));
      const hbLegacy = await readStamp(path.join(DATA_ROOT, "heartbeat.txt")); // hourly writes this

      // Attach explicit freshness to sections (Index Sectors uses 10-min by your request)
      json.marketMeter  = { ...(json.marketMeter  || {}), updatedAt: hb10 || hbLegacy || hb1h || null };
      json.engineLights = { ...(json.engineLights || {}), updatedAt: hb10 || hbLegacy || hb1h || null };
      json.sectors      = { ...(json.sectors      || {}), updatedAt: hb10 || hb1h || hbLegacy || null };
      json.daily        = { ...(json.daily        || {}), updatedAt: hbEod || hb1h || hbLegacy || null };

      // Meta
      json.meta = json.meta || {};
      json.meta.ts = json.meta.ts || json.updated_at || new Date().toISOString();
      json.meta.stamps = {
        tenMin: hb10 || null,
        hourly: hb1h || null,
        eod: hbEod || null,
        legacy: hbLegacy || null
      };

      // For quick troubleshooting, tell which source file was used
      if (!json.meta.sourceFile) {
        if (await readJsonFromProject("data/outlook_intraday.json")) json.meta.sourceFile = "outlook_intraday.json";
        else if (await readJsonFromProject("data/outlook_hourly.json")) json.meta.sourceFile = "outlook_hourly.json";
        else if (await readJsonFromProject("data/outlook_eod.json")) json.meta.sourceFile = "outlook_eod.json";
        else json.meta.sourceFile = "outlook.json";
      }

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
      const dash = await readJsonFromProject("data/outlook_intraday.json")
               ||  await readJsonFromProject("data/outlook_hourly.json")
               ||  await readJsonFromProject("data/outlook_eod.json")
               ||  await readJsonFromProject("data/outlook.json");
      if (!dash) return noStore(res).json([]);
      const rows = buildGaugeRowsFromDashboard(dash, index);
      return noStore(res).json(Array.isArray(rows)? rows : []);
    }catch(e){
      console.error("gauges error:", e?.message || e);
      return noStore(res).json([]);
    }
  });

  // quick debug snapshot — UPDATED to show heartbeat stamps + source choice
  router.get("/debug", async (req, res) => {
    try {
      let src = "outlook_intraday.json";
      let dash = await readJsonFromProject("data/outlook_intraday.json");
      if (!dash) { src = "outlook_hourly.json"; dash = await readJsonFromProject("data/outlook_hourly.json"); }
      if (!dash) { src = "outlook_eod.json";    dash = await readJsonFromProject("data/outlook_eod.json"); }
      if (!dash) { src = "outlook.json";        dash = await readJsonFromProject("data/outlook.json"); }

      if (!dash) return noStore(res).status(404).json({ ok:false, error:"no outlook payload found" });

      const gg = dash.gauges || {};
      const od = dash.odometers || {};
      const summary = dash.summary || {};
      const sectors = (dash.outlook && dash.outlook.sectors) || {};
      const totals = (Array.isArray(sectors) ? sectors : Object.values(sectors)).reduce((acc, v) => {
        const nh  = Number(v?.nh ?? 0);
        const nl  = Number(v?.nl ?? 0);
        const u   = Number(v?.u  ?? v?.up   ?? 0);
        const d   = Number(v?.d  ?? v?.down ?? 0);
        acc.nh += nh; acc.nl += nl; acc.u += u; acc.d += d;
        return acc;
      }, { nh:0, nl:0, u:0, d:0 });

      // stamps (for quick verification)
      const hb10   = await readStamp(path.join(DATA_ROOT, "heartbeat_10min.txt"));
      const hb1h   = await readStamp(path.join(DATA_ROOT, "heartbeat_hourly.txt"));
      const hbEod  = await readStamp(path.join(DATA_ROOT, "heartbeat_eod.txt"));
      const hbLegacy = await readStamp(path.join(DATA_ROOT, "heartbeat.txt"));

      return noStore(res).json({
        ok: true,
        source: src,
        ts: dash.updated_at || dash.ts || new Date().toISOString(),
        dailySqueezePct: Number(gg?.squeezeDaily?.pct ?? NaN),
        intradaySqueezePct: Number(od?.squeezeCompressionPct ?? gg?.fuel?.pct ?? NaN),
        breadthIdx:  Number(summary?.breadthIdx  ?? gg?.rpm?.pct   ?? NaN),
        momentumIdx: Number(summary?.momentumIdx ?? gg?.speed?.pct ?? NaN),
        totals,
        stamps: { tenMin: hb10, hourly: hb1h, eod: hbEod, legacy: hbLegacy }
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

  /* ======================
     REPLAY ENDPOINTS
     ====================== */

  // List snapshots for a granularity
  router.get("/replay/index", async (req, res) => {
    try {
      const gran = granDir(req.query.granularity);
      const dir = path.join(DATA_ROOT, "archive", gran, "dashboard");
      let files = [];
      try { files = await fs.readdir(dir); } catch { files = []; }

      const items = files
        .filter(f => f.startsWith("outlook_") && f.endsWith(".json"))
        .map(f => {
          // filenames are outlook_YYYY-MM-DDTHH-MM-SSZ.json; derive ISO-ish
          const core = f.replace(/^outlook_/, "").replace(/\.json$/, "");
          // convert ...THH-MM-SSZ to ...THH:MM:SSZ for readability
          const ts = core.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, (m,h,mn,s) => `T${h}:${mn}:${s}Z`);
          return { ts, file: f };
        })
        .sort((a,b)=> b.ts.localeCompare(a.ts));

      return noStore(res).json({ ok:true, granularity: gran, items });
    } catch (e) {
      return noStore(res).status(500).json({ ok:false, error:String(e) });
    }
  });

  // Return one snapshot as a dashboard payload
  router.get("/replay/at", async (req, res) => {
    try {
      const gran = granDir(req.query.granularity);
      const tsQ  = String(req.query.ts || "").slice(0,19); // YYYY-MM-DDTHH:MM:SS
      const dir  = path.join(DATA_ROOT, "archive", gran, "dashboard");
      let files = [];
      try { files = await fs.readdir(dir); } catch { files = []; }
      const match = files
        .filter(f => f.startsWith("outlook_") && f.endsWith(".json"))
        .map(f => {
          const core = f.replace(/^outlook_/, "").replace(/\.json$/, ""); // YYYY-MM-DDTHH-MM-SSZ
          const iso  = core.replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, (m,h,mn,s)=>`T${h}:${mn}:${s}Z`);
          return { f, iso, key: iso.slice(0,19) };
        })
        .sort((a,b)=> a.iso.localeCompare(b.iso))
        .find(x => x.key >= tsQ) || null;

      if (!match) return noStore(res).status(404).json({ ok:false, error:"snapshot not found" });

      const abs = path.join(dir, match.f);
      let json = await readJsonAbs(abs);
      if (!json) return noStore(res).status(404).json({ ok:false, error:"snapshot unreadable" });

      // Normalize like live /dashboard
      json = normalizeSectorCards(json);
      json = ensureSqueeze(json);
      json = ensureIndexes(json);
      json = ensureVolatility(json);
      json.signals = computeSignals(json);
      json.meta = json.meta || {};
      json.meta.ts = json.meta.ts || json.updated_at || json.ts || match.iso;
      json.replay = true;
      json.replayGranularity = gran;

      return noStore(res).json(json);
    } catch (e) {
      return noStore(res).status(500).json({ ok:false, error:String(e) });
    }
  });

  // ---- OHLC (normalized) ----
  router.get("/v1/ohlc", async (req, res) => {
    try {
      const symbol = String(req.query.symbol || "SPY").toUpperCase();
      const timeframe = String(req.query.timeframe || "1h");
      const at = (req.query.at ? String(req.query.at) : "").trim(); // ISO timestamp for replay

      // If replay timestamp provided, try archived OHLC first
      if (at) {
        try {
          const tfFolder = tfDir(timeframe);
          const symDir = path.join(DATA_ROOT, "archive", "ohlc", symbol, tfFolder);
          const files = await fs.readdir(symDir);
          const pick = files
            .filter(f => f.startsWith("ohlc_") && f.endsWith(".json"))
            .map(f => ({ f, iso: f.replace(/^ohlc_/, "").replace(/\.json$/, "") }))
            .sort((a,b)=> a.iso.localeCompare(b.iso))
            .find(x => x.iso >= at);
          if (pick) {
            const snap = await readJsonAbs(path.join(symDir, pick.f));
            const cutoff = Math.floor(Date.parse(at)/1000);
            const bars = normalizeBars((snap?.bars)||[]).filter(b => b.time <= cutoff);
            if (bars.length) return noStore(res).json({ bars, symbol, timeframe, at, archived:true });
          }
        } catch {
          // fall through to live fetch + truncate
        }
      }

      // Live fetch (Polygon if available; else stub), and truncate if `at` is set
      let bars = [];
      if (POLY_KEY) {
        const raw = await getBarsFromPolygon(symbol, timeframe);
        bars = normalizeBars(raw);
      } else {
        // Fallback stub
        const tfSec = ({
          "1m":60, "5m":300, "10m":600, "15m":900, "30m":1800,
          "1h":3600, "4h":14400, "1d":86400
        })[timeframe] || 3600;

        const now = Math.floor(Date.now() / 1000);
        const n = 160;
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

      if (at) {
        const cutoff = Math.floor(Date.parse(at)/1000);
        bars = bars.filter(b => b.time <= cutoff);
      }

      return noStore(res).json({ bars, symbol, timeframe, at: at || null, archived:false });
    } catch (e) {
      console.error("ohlc error:", e?.message || e);
      return noStore(res).status(500).json({ ok:false, error:String(e) });
    }
  });

  // ---- Sector hour-over-hour trend for cards (existing) ----
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
