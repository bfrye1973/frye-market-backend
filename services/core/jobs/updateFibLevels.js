// src/services/core/jobs/updateFibLevels.js
// Engine 2 — CSV Input (Easy Mode)
//
// INPUT:  data/fib-input.csv          (you edit this)
// OUTPUT: data/fib-levels.json        (engine output)
//
// - Forgiving parser: skips bad rows, logs warnings, does NOT crash on one mistake
// - Uses AZ time (America/Phoenix) by applying fixed -07:00 offset
// - Builds W1 and W4 fib anchors per (symbol, degree, tf)
// - Passes wave label marks (MARK) as anchors.waveMarks with tSec for candle locking
//
// Candle truth source: backend-1 /api/v1/ohlc

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeFibFromAnchors, normalizeBars } from "../logic/fibEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_FILE = path.resolve(__dirname, "../data/fib-input.csv");
const OUTFILE = path.resolve(__dirname, "../data/fib-levels.json");

// backend-1 candle truth
const API_BASE = process.env.FRYE_API_BASE || `http://127.0.0.1:${process.env.PORT || 3001}`;
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

function keyFor(symbol, degree, tf) {
  return `${symbol}__${degree}__${tf}`;
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
      // kind holds which wave label: W1..W5
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
    // Build waveMarks
    const waveMarks = Object.keys(b.marks).length ? b.marks : null;

    // Compute W1 fib if we have both endpoints
    if (b.w1.low && b.w1.high && b.w1.high.p > b.w1.low.p) {
      const bars = await fetchOhlcBars({ symbol: b.symbol, tf: b.tf });
      const computed = computeFibFromAnchors({
        symbol: b.symbol,
        tf: b.tf,
        anchorLow: b.w1.low.p,
        anchorHigh: b.w1.high.p,
        context: "W2",
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
          a: b.w1.low,
          b: b.w1.high,
          waveMarks,
        },
      });
    }

    // Compute W4 fib if we have both endpoints
    if (b.w4.low && b.w4.high && b.w4.high.p > b.w4.low.p) {
      const bars = await fetchOhlcBars({ symbol: b.symbol, tf: b.tf });
      const computed = computeFibFromAnchors({
        symbol: b.symbol,
        tf: b.tf,
        anchorLow: b.w4.low.p,
        anchorHigh: b.w4.high.p,
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
        },
      });
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
