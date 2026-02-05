// src/services/core/jobs/updateFibLevels.js
// Engine 2 — Reads SIMPLE anchors file and generates fib-levels.json safely
//
// INPUT (easy): data/fib-anchors-simple.json
// OUTPUT (engine): data/fib-levels.json
//
// - Supports degrees: primary/intermediate/minor/minute
// - Supports waves: W1 and W4
// - Converts AZ time strings -> tSec
// - Passes marks -> waveMarks with tSec
// - Computes fib using w1.low/high or w4.low/high if present
//
// Candle truth source: backend-1 /api/v1/ohlc

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeFibFromAnchors, normalizeBars } from "../logic/fibEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIMPLE_FILE = path.resolve(__dirname, "../data/fib-anchors-simple.json");
const OUTFILE = path.resolve(__dirname, "../data/fib-levels.json");

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

// Phoenix is UTC-7 year-round (no DST)
function azToEpochSeconds(t) {
  if (!t) return null;

  if (typeof t === "number" && Number.isFinite(t)) {
    return t > 1e12 ? Math.floor(t / 1000) : Math.floor(t);
  }

  const s = String(t).trim();
  if (!s) return null;

  // Already ISO w/ timezone
  if (s.includes("T") && (s.endsWith("Z") || s.match(/[+-]\d\d:\d\d$/))) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }

  // "YYYY-MM-DD HH:MM" -> append -07:00
  const isoLocal = s.replace(" ", "T");
  const withSeconds = isoLocal.length === 16 ? `${isoLocal}:00` : isoLocal;
  const ms = Date.parse(`${withSeconds}-07:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function normTP(obj) {
  if (!obj || typeof obj !== "object") return null;
  const p = Number(obj.p);
  if (!Number.isFinite(p)) return null;
  const t = obj.t ?? null;
  const tSec = azToEpochSeconds(t);
  return { p, t, tSec: Number.isFinite(tSec) ? tSec : null };
}

function normMarks(marks) {
  const out = {};
  if (!marks || typeof marks !== "object") return null;
  for (const k of Object.keys(marks)) {
    const tp = normTP(marks[k]);
    if (!tp) continue;
    out[k] = tp;
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

function pushItem(items, computed, metaExtra, anchorsExtra) {
  items.push({
    ...computed,
    meta: {
      ...(computed.meta || {}),
      schema: "fib-levels@3",
      ...metaExtra,
      generated_at_utc: computed?.meta?.generated_at_utc || new Date().toISOString(),
    },
    anchors: {
      ...(computed.anchors || {}),
      ...anchorsExtra,
    },
  });
}

(async function main() {
  console.log(`[fib] updateFibLevels start ${new Date().toISOString()}`);

  if (!fs.existsSync(SIMPLE_FILE)) {
    atomicWriteJson(OUTFILE, {
      ok: false,
      reason: "NO_ANCHORS",
      message: "fib-anchors-simple.json not found",
      meta: { schema: "fib-levels@3", generated_at_utc: new Date().toISOString() },
      items: [],
    });
    console.log(`[fib] wrote ${OUTFILE} (missing simple file)`);
    process.exit(0);
  }

  const simple = readJson(SIMPLE_FILE);
  const symbols = simple?.symbols || {};
  const spy = symbols?.SPY;

  if (!spy) {
    atomicWriteJson(OUTFILE, {
      ok: false,
      reason: "NO_ANCHORS",
      message: "No SPY section found in fib-anchors-simple.json",
      meta: { schema: "fib-levels@3", generated_at_utc: new Date().toISOString() },
      items: [],
    });
    console.log(`[fib] wrote ${OUTFILE} (no SPY)`);
    process.exit(0);
  }

  const degrees = ["primary", "intermediate", "minor", "minute"];
  const items = [];

  for (const degree of degrees) {
    const cfg = spy[degree];
    if (!cfg) continue;

    const tf = String(cfg.tf || "").toLowerCase();
    if (!tf) continue;

    const marks = normMarks(cfg.marks);

    // Build W1 fib if low/high exists
    const w1Low = normTP(cfg?.w1?.low);
    const w1High = normTP(cfg?.w1?.high);

    if (w1Low && w1High && w1High.p > w1Low.p) {
      const bars = await fetchOhlcBars({ symbol: "SPY", tf });
      const computed = computeFibFromAnchors({
        symbol: "SPY",
        tf,
        anchorLow: w1Low.p,
        anchorHigh: w1High.p,
        context: "W2",
        bars,
      });

      pushItem(
        items,
        computed,
        { symbol: "SPY", tf, degree, wave: "W1" },
        { a: w1Low, b: w1High, waveMarks: marks }
      );
    }

    // Build W4 fib if low/high exists
    const w4Low = normTP(cfg?.w4?.low);
    const w4High = normTP(cfg?.w4?.high);

    if (w4Low && w4High && w4High.p > w4Low.p) {
      const bars = await fetchOhlcBars({ symbol: "SPY", tf });
      const computed = computeFibFromAnchors({
        symbol: "SPY",
        tf,
        anchorLow: w4Low.p,
        anchorHigh: w4High.p,
        context: "W4",
        bars,
      });

      pushItem(
        items,
        computed,
        { symbol: "SPY", tf, degree, wave: "W4" },
        { a: w4Low, b: w4High, waveMarks: marks }
      );
    }
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
