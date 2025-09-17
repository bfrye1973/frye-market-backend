// api/routes.js — ESM router (sector cards + numeric aliases, engine lights,
// ensure squeezeDaily, rpm/speed, volatility; with /debug, /outlook5d, /v1/ohlc, /sectorTrend,
// and NEW: /replay/index + /replay/at + replay-aware OHLC &at=)

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
    const first = Number(spark
