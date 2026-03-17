// src/services/core/jobs/updateFibLevels.js
// Engine 2 — CSV Input (Easy Mode)
//
// INPUT:  data/fib-input.csv          (you edit this)
// OUTPUT: data/fib-levels.json        (engine output)
//
// - Forgiving parser: skips bad rows, logs warnings, does NOT crash on one mistake
// - Uses AZ time (America/Phoenix) by applying fixed -07:00 offset
// - Builds fib outputs per (symbol, degree, tf):
//     - W1 fib (requires W1 LOW + HIGH)
//     - W4 fib (optional; requires W4 LOW + HIGH)
// - Passes MARK wave labels (MARK) as anchors.waveMarks with tSec for candle locking
//
// Candle truth source: backend-1 /api/v1/ohlc
//
// IMPORTANT FIX:
// - Context/tag must NOT be hard-coded to "W2"
// - Context is derived from the highest available MARK (W5→W4→W3→W2→W1)
// - This makes PRIMARY/INTERMEDIATE/MINOR/ (later MINUTE) alignment readable + correct

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeFibFromAnchors, normalizeBars } from "../logic/fibEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.resolve(__dirname, "../data/fib-input.csv");
const OUTFILE = path.resolve(__dirname, "../data/fib-levels.json");

// backend-1 candle truth (Render-safe loopback default)
const DEFAULT_PORT = Number(process.env.PORT) || 8080;
const API_BASE =
  process.env.FRYE_API_BASE && String(process.env.FRYE_API_BASE).trim().length
    ? String(process.env.FRYE_API_BASE).trim()
    : `http://127.0.0.1:${DEFAULT_PORT}`;

const OHLC_PATH = "/api/v1/ohlc";

const DEFAULT_LIMIT = Number(process.env.FIB_OHLC_LIMIT || 600);
const MODE = process.env.FIB_OHLC_MODE || "rth";

function atomicWriteJson(filepath, obj) {
  const tmp = `${filepath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filepath);
}

// Phoenix is UTC-7 year-round (no DST)
function azToEpochSeconds(t) {
  if (!t) return null;
  const s = String(t).trim();
  if (!s) return null;

  // Accept ISO w/ timezone
  if (s.includes("T") && (s.endsWith("Z") || s.match(/[+-]\d\d:\d\d$/))) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }

  // "YYYY-MM-DD HH:MM" (AZ) -> append -07:00
  const isoLocal = s.replace(" ", "T");
  const withSeconds = isoLocal.length === 16 ? `${isoLocal}:00` : isoLocal;
  const ms = Date.parse(`${withSeconds}-07:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length && !l.startsWith("#"));

  if (!lines.length) return { header: [], rows: [] };

  const header = lines[0].split(",").map((x) => x.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((x) => x.trim());
    if (parts.length !== header.length) {
      rows.push({ __bad: true, __line: i + 1, __raw: lines[i] });
      continue;
    }
    const obj = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = parts[j];
    obj.__line = i + 1;
    rows.push(obj);
  }

  return { header, rows };
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normMark(dtAz, price) {
  const p = toNum(price);
  if (!Number.isFinite(p)) return null;
  const t = dtAz ? String(dtAz).trim() : null;
  const tSec = azToEpochSeconds(t);
  return { p, t: t || null, tSec: Number.isFinite(tSec) ? tSec : null };
}

function keyFor(symbol, degree, tf) {
  return `${symbol}__${degree}__${tf}`;
}

function deriveContextFromMarks(marks) {
  // Highest completed wave wins (locks signals.tag + anchors.context)
  if (!marks || typeof marks !== "object") return "W2"; // default expectation for W1 fib outputs
  const has = (k) => !!(marks?.[k] && Number.isFinite(Number(marks[k].p)) && Number(marks[k].p) > 0);
  if (has("W5")) return "W5";
  if (has("W4")) return "W4";
  if (has("W3")) return "W3";
  if (has("W2")) return "W2";
  if (has("W1")) return "W1";
  return "W2";
}

const barsCache = new Map(); // key: symbol__tf__limit__mode

async function fetchOhlcBars({ symbol, tf }) {
  const cacheKey = `${symbol}__${tf}__${DEFAULT_LIMIT}__${MODE}`;
  if (barsCache.has(cacheKey)) return barsCache.get(cacheKey);

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

  const normalized = normalizeBars(rawBars || []);
  barsCache.set(cacheKey, normalized);
  return normalized;
}

(async function main() {
  console.log(`[fib] updateFibLevels (CSV) start ${new Date().toISOString()}`);
  console.log(`[fib] API_BASE=${API_BASE}`);

  if (!fs.existsSync(CSV_FILE)) {
    atomicWriteJson(OUTFILE, {
      ok: false,
      reason: "NO_INPUT",
      message: "Missing data/fib-input.csv",
      meta: { schema: "fib-levels@3", generated_at_utc: new Date().toISOString() },
      items: [],
    });
    console.log(`[fib] wrote ${OUTFILE} (NO_INPUT)`);
    process.exit(0);
  }

  const csvText = fs.readFileSync(CSV_FILE, "utf-8");
  const { header, rows } = parseCsv(csvText);

  const required = ["symbol", "degree", "tf", "wave", "kind", "datetime_az", "price"];
  const missingCols = required.filter((c) => !header.includes(c));
  if (missingCols.length) {
    atomicWriteJson(OUTFILE, {
      ok: false,
      reason: "BAD_CSV_HEADER",
      message: `Missing columns: ${missingCols.join(", ")}`,
      meta: { schema: "fib-levels@3", generated_at_utc: new Date().toISOString() },
      items: [],
    });
    console.log(`[fib] wrote ${OUTFILE} (BAD_CSV_HEADER)`);
    process.exit(0);
  }

  // Accumulate per (symbol,degree,tf)
  const buckets = new Map();
  const warn = (msg) => console.log(`[fib][WARN] ${msg}`);

  for (const r of rows) {
    if (r.__bad) {
      warn(`Line ${r.__line}: bad CSV row (wrong column count): ${r.__raw}`);
      continue;
    }

    const symbol = String(r.symbol || "").toUpperCase();
    const degree = String(r.degree || "").toLowerCase();
    const tf = String(r.tf || "").toLowerCase();
    const wave = String(r.wave || "").toUpperCase(); // W1, W4, MARK
    const kind = String(r.kind || "").toUpperCase(); // LOW/HIGH or W1..W5 for MARK
    const dtAz = String(r.datetime_az || "").trim();
    const price = toNum(r.price);

    if (!symbol || !degree || !tf || !wave || !kind || !Number.isFinite(price)) {
      warn(`Line ${r.__line}: missing required fields or bad price`);
      continue;
    }

    const k = keyFor(symbol, degree, tf);
    if (!buckets.has(k)) {
      buckets.set(k, {
        symbol,
        degree,
        tf,
        w1: { low: null, high: null },
        w4: { low: null, high: null },
        marks: {}, // W1..W5
      });
    }
    const b = buckets.get(k);

    if (wave === "W1") {
      if (kind !== "LOW" && kind !== "HIGH") {
        warn(`Line ${r.__line}: W1 kind must be LOW or HIGH`);
        continue;
      }
      b.w1[kind.toLowerCase()] = normMark(dtAz, price);
    } else if (wave === "W4") {
      if (kind !== "LOW" && kind !== "HIGH") {
        warn(`Line ${r.__line}: W4 kind must be LOW or HIGH`);
        continue;
      }
      b.w4[kind.toLowerCase()] = normMark(dtAz, price);
    } else if (wave === "MARK") {
      if (!["W1", "W2", "W3", "W4", "W5"].includes(kind)) {
        warn(`Line ${r.__line}: MARK kind must be W1..W5`);
        continue;
      }
      b.marks[kind] = normMark(dtAz, price);
    } else {
      warn(`Line ${r.__line}: wave must be W1, W4, or MARK`);
      continue;
    }
  }

  const items = [];

  for (const b of buckets.values()) {
    const waveMarks = Object.keys(b.marks).length ? b.marks : null;
    const derivedContext = deriveContextFromMarks(waveMarks);

    // Fetch bars once per bucket (symbol,tf)
    let bars = [];
    try {
      bars = await fetchOhlcBars({ symbol: b.symbol, tf: b.tf });
    } catch (e) {
      warn(`OHLC fetch failed for ${b.symbol} ${b.tf}: ${String(e?.message || e).slice(0, 200)}`);
      bars = [];
    }

    // --- W1 output (primary/intermediate/minor/minute all use W1 anchors when present) ---
    if (b.w1.low && b.w1.high) {
      const lo = b.w1.low.p;
      const hi = b.w1.high.p;
      if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi !== lo)) {
        warn(`Bad W1 anchors for ${b.symbol} ${b.degree} ${b.tf}`);
      } else {
        const anchorLow = Math.min(lo, hi);
        const anchorHigh = Math.max(lo, hi);

        const computed = computeFibFromAnchors({
          symbol: b.symbol,
          tf: b.tf,
          anchorLow,
          anchorHigh,
          context: derivedContext, // ✅ FIX: no more hard-coded "W2"
          bars,
        });

        items.push({
          ...computed,
          meta: {
            ...(computed.meta || {}),
            schema: "fib-levels@3",
            symbol: b.symbol,
            tf: b.tf,
            degree: b.degree,
            wave: "W1",
            generated_at_utc: computed?.meta?.generated_at_utc || new Date().toISOString(),
          },
          anchors: {
            ...(computed.anchors || {}),
            // Preserve original row anchors exactly as given (a=LOW row, b=HIGH row)
            a: b.w1.low,
            b: b.w1.high,
            // Pass through marks for wave-state alignment
            waveMarks,
            // Ensure context aligns with derivedContext
            context: derivedContext,
          },
          // Ensure signals.tag matches derived context (if fibEngine didn't set it)
          signals: {
            ...(computed.signals || {}),
            tag: computed?.signals?.tag || derivedContext,
          },
        });
      }
    }

    // --- W4 output (optional) ---
    if (b.w4.low && b.w4.high) {
      const lo = b.w4.low.p;
      const hi = b.w4.high.p;
      if (!(Number.isFinite(lo) && Number.isFinite(hi) && hi !== lo)) {
        warn(`Bad W4 anchors for ${b.symbol} ${b.degree} ${b.tf}`);
      } else {
        const anchorLow = Math.min(lo, hi);
        const anchorHigh = Math.max(lo, hi);

        const computed = computeFibFromAnchors({
          symbol: b.symbol,
          tf: b.tf,
          anchorLow,
          anchorHigh,
          context: "W4",
          bars,
        });

        items.push({
          ...computed,
          meta: {
            ...(computed.meta || {}),
            schema: "fib-levels@3",
            symbol: b.symbol,
            tf: b.tf,
            degree: b.degree,
            wave: "W4",
            generated_at_utc: computed?.meta?.generated_at_utc || new Date().toISOString(),
          },
          anchors: {
            ...(computed.anchors || {}),
            a: b.w4.low,
            b: b.w4.high,
            waveMarks,
            context: "W4",
          },
          signals: {
            ...(computed.signals || {}),
            tag: computed?.signals?.tag || "W4",
          },
        });
      }
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
