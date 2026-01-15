// src/services/core/jobs/updateFibLevels.js
// Engine 2 job — reads fib-manual-anchors.json, fetches 1h bars from backend-1 /api/v1/ohlc,
// computes fib output, writes fib-levels.json (atomic).
//
// LOCKED:
// - uses backend-1 /api/v1/ohlc (dashboard candle truth)
// - 1h only v1
// - 74% invalidation gate enforced in fibEngine

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeFibFromAnchors, normalizeBars } from "../logic/fibEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANUAL_FILE = path.resolve(__dirname, "../data/fib-manual-anchors.json");
const OUTFILE = path.resolve(__dirname, "../data/fib-levels.json");

// Where to fetch candles from (backend-1)
const API_BASE = process.env.FRYE_API_BASE || `http://127.0.0.1:${process.env.PORT || 3001}`;
const OHLC_PATH = "/api/v1/ohlc";

// Fetch parameters (keep loose—endpoint may ignore some)
const DEFAULT_LIMIT = Number(process.env.FIB_OHLC_LIMIT || 500);
const MODE = process.env.FIB_OHLC_MODE || "rth"; // if your ohlc supports mode; safe if ignored

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

  const res = await fetch(url.toString(), {
    headers: { "accept": "application/json" }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OHLC fetch failed ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  // Accept multiple possible payload shapes
  const rawBars =
    data?.bars ||
    data?.candles ||
    data?.data ||
    (Array.isArray(data) ? data : null);

  return normalizeBars(rawBars || []);
}

function selectAnchor(anchors, symbol, tf) {
  if (!Array.isArray(anchors)) return null;
  return anchors.find(a =>
    String(a.symbol || "").toUpperCase() === String(symbol).toUpperCase() &&
    String(a.tf || "").toLowerCase() === String(tf).toLowerCase() &&
    String(a.wave || "").toUpperCase() === "W1"
  ) || null;
}

(async function main() {
  const started = new Date().toISOString();
  console.log(`[fib] updateFibLevels start ${started}`);
  console.log(`[fib] API_BASE=${API_BASE}`);

  if (!fs.existsSync(MANUAL_FILE)) {
    const out = {
      ok: false,
      reason: "NO_ANCHORS",
      message: "fib-manual-anchors.json not found",
      meta: { schema: "fib-levels@1", generated_at_utc: new Date().toISOString() }
    };
    atomicWriteJson(OUTFILE, out);
    console.log(`[fib] wrote ${OUTFILE} (NO_ANCHORS: missing manual file)`);
    process.exit(0);
  }

  const manual = readJson(MANUAL_FILE);
  const anchors = manual?.anchors || [];
  const symbol = "SPY";
  const tf = "1h";

  const a = selectAnchor(anchors, symbol, tf);
  if (!a) {
    const out = {
      ok: false,
      reason: "NO_ANCHORS",
      message: "No matching W1 anchor found for SPY 1h",
      meta: { schema: "fib-levels@1", symbol, tf, generated_at_utc: new Date().toISOString() }
    };
    atomicWriteJson(OUTFILE, out);
    console.log(`[fib] wrote ${OUTFILE} (NO_ANCHORS: no SPY 1h W1 entry)`);
    process.exit(0);
  }

  // Validate anchor fields
  const low = Number(a.low);
  const high = Number(a.high);
  const context = a.context ?? null;

  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    const out = {
      ok: false,
      reason: "BAD_ANCHORS",
      message: "Anchor low/high invalid. Ensure high > low and both numeric.",
      meta: { schema: "fib-levels@1", symbol, tf, generated_at_utc: new Date().toISOString() },
      anchors: { low: a.low, high: a.high, context }
    };
    atomicWriteJson(OUTFILE, out);
    console.log(`[fib] wrote ${OUTFILE} (BAD_ANCHORS)`);
    process.exit(0);
  }

  // Fetch bars
  let bars = [];
  try {
    bars = await fetchOhlcBars({ symbol, tf });
  } catch (err) {
    const out = {
      ok: false,
      reason: "OHLC_FETCH_FAILED",
      message: String(err?.message || err),
      meta: { schema: "fib-levels@1", symbol, tf, generated_at_utc: new Date().toISOString() }
    };
    atomicWriteJson(OUTFILE, out);
    console.log(`[fib] wrote ${OUTFILE} (OHLC_FETCH_FAILED)`);
    process.exit(0);
  }

  // Compute output
  const computed = computeFibFromAnchors({
    symbol,
    tf,
    anchorLow: low,
    anchorHigh: high,
    context,
    bars
  });

  // If ATR isn’t computable, we still return ok:true (engine is graceful)
  // but we also set a top-level reason for visibility (optional).
  const out = computed;

  atomicWriteJson(OUTFILE, out);
  console.log(`[fib] wrote ${OUTFILE} ok=${out.ok} invalidated=${out?.signals?.invalidated ?? false}`);
  process.exit(0);
})().catch(err => {
  const out = {
    ok: false,
    reason: "JOB_CRASH",
    message: String(err?.stack || err),
    meta: { schema: "fib-levels@1", generated_at_utc: new Date().toISOString() }
  };
  try {
    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(out, null, 2));
  } catch {}
  console.error("[fib] JOB_CRASH", err);
  process.exit(1);
});
