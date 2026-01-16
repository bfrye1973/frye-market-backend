// src/services/core/jobs/updateFibLevels.js
// Engine 2 — Multi-degree, multi-wave fib job (AZ-time aware + waveMarks passthrough)
//
// Reads:  data/fib-manual-anchors.json
// Writes: data/fib-levels.json
//
// Supports:
// - degree: intermediate | minor | minute
// - wave: W1 | W4
// - active: true
// - Anchor endpoints can be provided as either:
//    A) low/high numbers
//    B) a/b points with AZ time: { t:"YYYY-MM-DD HH:MM", p:number }
//
// NEW:
// - Converts AZ time (America/Phoenix) to epoch seconds using fixed -07:00 offset
// - Passes through anchor points + waveMarks into output so frontend can place labels on candles.
//
// Candle truth source (LOCKED): backend-1 /api/v1/ohlc

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeFibFromAnchors, normalizeBars } from "../logic/fibEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANUAL_FILE = path.resolve(__dirname, "../data/fib-manual-anchors.json");
const OUTFILE = path.resolve(__dirname, "../data/fib-levels.json");

// backend-1 candle truth
const API_BASE = process.env.FRYE_API_BASE || `http://127.0.0.1:${process.env.PORT || 3001}`;
const OHLC_PATH = "/api/v1/ohlc";

const DEFAULT_LIMIT = Number(process.env.FIB_OHLC_LIMIT || 600);
const MODE = process.env.FIB_OHLC_MODE || "rth";

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function atomicWriteJson(filepath, obj) {
  const tmp = `${filepath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filepath);
}

// AZ time parser: Phoenix is UTC-7 year-round (no DST).
// Accepts:
// - "YYYY-MM-DD HH:MM"
// - "YYYY-MM-DD HH:MM:SS"
// - ISO with timezone already ("...Z" or "...-07:00")
function azToEpochSeconds(t) {
  if (!t) return null;

  // If already a number-ish epoch seconds
  if (typeof t === "number" && Number.isFinite(t)) {
    return t > 1e12 ? Math.floor(t / 1000) : Math.floor(t);
  }

  const s = String(t).trim();
  if (!s) return null;

  // If ISO with timezone info, Date can parse it
  if (s.includes("T") && (s.endsWith("Z") || s.match(/[+-]\d\d:\d\d$/))) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }

  // If "YYYY-MM-DD HH:MM" or "YYYY-MM-DD HH:MM:SS", treat as AZ and append -07:00
  // Convert " " to "T"
  const isoLocal = s.replace(" ", "T");
  const withSeconds = isoLocal.length === 16 ? `${isoLocal}:00` : isoLocal; // add :00 if missing seconds
  const ms = Date.parse(`${withSeconds}-07:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function normPoint(pt) {
  if (!pt || typeof pt !== "object") return null;
  const p = Number(pt.p);
  if (!Number.isFinite(p)) return null;
  const tSec = azToEpochSeconds(pt.t);
  return { p, t: pt.t ?? null, tSec: Number.isFinite(tSec) ? tSec : null };
}

function normWaveMarks(marks) {
  if (!marks || typeof marks !== "object") return null;
  const out = {};
  for (const k of Object.keys(marks)) {
    const m = marks[k];
    if (!m || typeof m !== "object") continue;
    const p = Number(m.p ?? m.price);
    if (!Number.isFinite(p)) continue;
    const tSec = azToEpochSeconds(m.t ?? m.time);
    out[k] = {
      p,
      t: (m.t ?? m.time) || null,
      tSec: Number.isFinite(tSec) ? tSec : null,
    };
  }
  return Object.keys(out).length ? out : null;
}

async function fetchOhlcBars({ symbol, tf }) {
  const url = new URL(`${API_BASE}${OHLC_PATH}`);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("tf", tf);
  url.searchParams.set("limit", String(DEFAULT_LIMIT));
  url.searchParams.set("mode", MODE);

  const res = await fetch(url.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OHLC fetch failed ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const rawBars =
    data?.bars ||
    data?.candles ||
    data?.data ||
    (Array.isArray(data) ? data : null);

  return normalizeBars(rawBars || []);
}

// Active anchors with valid wave W1/W4 and resolvable low/high
function pickActiveAnchors(anchors) {
  const list = Array.isArray(anchors) ? anchors : [];
  return list.filter((a) => {
    if (!a) return false;
    if (a.active !== true) return false;

    const wave = String(a.wave || "").toUpperCase();
    if (!["W1", "W4"].includes(wave)) return false;

    if (!a.symbol || !a.tf || !a.degree) return false;

    // allow either low/high OR a/b points
    const low = Number(a.low);
    const high = Number(a.high);
    const hasLowHigh = Number.isFinite(low) && Number.isFinite(high) && high > low;

    const A = normPoint(a.a);
    const B = normPoint(a.b);
    const hasAB = A && B && Number.isFinite(A.p) && Number.isFinite(B.p) && A.p !== B.p;

    return hasLowHigh || hasAB;
  });
}

function resolveLowHigh(a) {
  // Prefer explicit low/high if present
  const low = Number(a.low);
  const high = Number(a.high);
  if (Number.isFinite(low) && Number.isFinite(high) && high > low) {
    return { low, high };
  }

  // Else derive from a/b prices
  const A = normPoint(a.a);
  const B = normPoint(a.b);
  if (A && B) {
    const lo = Math.min(A.p, B.p);
    const hi = Math.max(A.p, B.p);
    if (hi > lo) return { low: lo, high: hi };
  }

  return null;
}

(async function main() {
  const started = new Date().toISOString();
  console.log(`[fib] updateFibLevels start ${started}`);
  console.log(`[fib] API_BASE=${API_BASE}`);

  if (!fs.existsSync(MANUAL_FILE)) {
    atomicWriteJson(OUTFILE, {
      ok: false,
      reason: "NO_ANCHORS",
      message: "fib-manual-anchors.json not found",
      meta: { schema: "fib-levels@3", generated_at_utc: new Date().toISOString() },
      items: [],
    });
    console.log(`[fib] wrote ${OUTFILE} (NO_ANCHORS: missing manual file)`);
    process.exit(0);
  }

  const manual = readJson(MANUAL_FILE);
  const active = pickActiveAnchors(manual?.anchors);

  if (!active.length) {
    atomicWriteJson(OUTFILE, {
      ok: false,
      reason: "NO_ANCHORS",
      message: "No active anchors found. Need active:true + wave W1/W4 + (low/high) or (a/b).",
      meta: { schema: "fib-levels@3", generated_at_utc: new Date().toISOString() },
      items: [],
    });
    console.log(`[fib] wrote ${OUTFILE} (NO_ANCHORS: none active)`);
    process.exit(0);
  }

  const items = [];

  for (const a of active) {
    const symbol = String(a.symbol).toUpperCase();
    const tf = String(a.tf).toLowerCase();
    const degree = String(a.degree).toLowerCase();
    const wave = String(a.wave).toUpperCase();

    const resolved = resolveLowHigh(a);
    if (!resolved) {
      items.push({
        ok: false,
        reason: "BAD_ANCHORS",
        message: "Could not resolve low/high from anchor record (need low/high or a/b points).",
        meta: { schema: "fib-levels@3", symbol, tf, degree, wave, generated_at_utc: new Date().toISOString() },
      });
      continue;
    }

    let bars = [];
    try {
      bars = await fetchOhlcBars({ symbol, tf });
    } catch (err) {
      items.push({
        ok: false,
        reason: "OHLC_FETCH_FAILED",
        message: String(err?.message || err),
        meta: { schema: "fib-levels@3", symbol, tf, degree, wave, generated_at_utc: new Date().toISOString() },
      });
      continue;
    }

    const computed = computeFibFromAnchors({
      symbol,
      tf,
      anchorLow: resolved.low,
      anchorHigh: resolved.high,
      context: a.context ?? null,
      bars,
    });

    // Pass through points + waveMarks so frontend can place labels at correct candles.
    const A = normPoint(a.a);
    const B = normPoint(a.b);
    const waveMarks = normWaveMarks(a.waveMarks);

    items.push({
      ...computed,
      meta: {
        ...(computed.meta || {}),
        schema: "fib-levels@3",
        symbol,
        tf,
        degree,
        wave,
        generated_at_utc: computed?.meta?.generated_at_utc || new Date().toISOString(),
      },
      anchors: {
        ...(computed.anchors || {}),
        // keep low/high/direction/context from engine
        a: A,
        b: B,
        waveMarks: waveMarks,
      },
    });
  }

  atomicWriteJson(OUTFILE, {
    ok: true,
    meta: { schema: "fib-levels@3", generated_at_utc: new Date().toISOString() },
    items,
  });

  console.log(`[fib] wrote ${OUTFILE} items=${items.length}`);
  process.exit(0);
})().catch((err) => {
  atomicWriteJson(OUTFILE, {
    ok: false,
    reason: "JOB_CRASH",
    message: String(err?.stack || err),
    meta: { schema: "fib-levels@3", generated_at_utc: new Date().toISOString() },
    items: [],
  });
  console.error("[fib] JOB_CRASH", err);
  process.exit(1);
});
