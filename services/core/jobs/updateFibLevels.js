// src/services/core/jobs/updateFibLevels.js
// Engine 2 — Multi-degree, multi-wave fib job
//
// Reads:  data/fib-manual-anchors.json
// Writes: data/fib-levels.json
//
// Supports:
// - degree: intermediate | minor | minute
// - wave: W1 | W4
// - active: true (single active per group enforced by your editing discipline)
//
// Candle truth source (LOCKED): backend-1 /api/v1/ohlc (same semantics as dashboard candles)

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

// Only active anchors with numeric low/high and valid wave W1 or W4.
function pickActiveAnchors(anchors) {
  const list = Array.isArray(anchors) ? anchors : [];
  return list.filter((a) => {
    if (!a) return false;
    if (a.active !== true) return false;

    const wave = String(a.wave || "").toUpperCase();
    if (!["W1", "W4"].includes(wave)) return false;

    const low = Number(a.low);
    const high = Number(a.high);
    if (!Number.isFinite(low) || !Number.isFinite(high) || !(high > low)) return false;

    if (!a.symbol || !a.tf || !a.degree) return false;
    return true;
  });
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
      meta: { schema: "fib-levels@2", generated_at_utc: new Date().toISOString() },
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
      message: "No active anchors found. Need active:true + wave W1/W4 + numeric low/high.",
      meta: { schema: "fib-levels@2", generated_at_utc: new Date().toISOString() },
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

    let bars = [];
    try {
      bars = await fetchOhlcBars({ symbol, tf });
    } catch (err) {
      items.push({
        ok: false,
        reason: "OHLC_FETCH_FAILED",
        message: String(err?.message || err),
        meta: {
          schema: "fib-levels@2",
          symbol,
          tf,
          degree,
          wave,
          generated_at_utc: new Date().toISOString(),
        },
      });
      continue;
    }

    const computed = computeFibFromAnchors({
      symbol,
      tf,
      anchorLow: Number(a.low),
      anchorHigh: Number(a.high),
      context: a.context ?? null,
      bars,
    });

    // Force meta fields so route can filter cleanly
    items.push({
      ...computed,
      meta: {
        ...(computed.meta || {}),
        schema: "fib-levels@2",
        symbol,
        tf,
        degree,
        wave,
        generated_at_utc: computed?.meta?.generated_at_utc || new Date().toISOString(),
      },
    });
  }

  atomicWriteJson(OUTFILE, {
    ok: true,
    meta: { schema: "fib-levels@2", generated_at_utc: new Date().toISOString() },
    items,
  });

  console.log(`[fib] wrote ${OUTFILE} items=${items.length}`);
  process.exit(0);
})().catch((err) => {
  atomicWriteJson(OUTFILE, {
    ok: false,
    reason: "JOB_CRASH",
    message: String(err?.stack || err),
    meta: { schema: "fib-levels@2", generated_at_utc: new Date().toISOString() },
    items: [],
  });
  console.error("[fib] JOB_CRASH", err);
  process.exit(1);
});
