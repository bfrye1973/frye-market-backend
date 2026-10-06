// services/core/jobs/buildEngine25EsForwardReturns6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ENGINE = "engine25.esForwardReturns.v0.2";
const SYMBOL = "ES";
const TIMEFRAME = "1d";
const LOOKBACK_TRADING_DAYS = 126;
const FETCH_LIMIT = 180;

const BACKEND_BASE =
  process.env.BACKEND_BASE || "https://frye-market-backend-1.onrender.com";

const ES_DAILY_PATH = `/api/v1/futures/ohlc?symbol=${SYMBOL}&timeframe=${TIMEFRAME}&limit=${FETCH_LIMIT}`;
const ES_DAILY_URL = `${BACKEND_BASE}${ES_DAILY_PATH}`;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-es-price-forward-returns-6mo.json"
);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundPct(value) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(3));
}

function dateFromUnixSeconds(seconds) {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function pctChange(fromValue, toValue) {
  const from = toNumber(fromValue, null);
  const to = toNumber(toValue, null);

  if (!from || !to) return null;

  return roundPct(((to - from) / from) * 100);
}

function maxDrawdownPctFromClose(currentClose, futureBars) {
  const close = toNumber(currentClose, null);
  if (!close || !Array.isArray(futureBars) || futureBars.length === 0) {
    return null;
  }

  const lows = futureBars
    .map((bar) => toNumber(bar.low, null))
    .filter((value) => Number.isFinite(value));

  if (!lows.length) return null;

  const minLow = Math.min(...lows);
  return roundPct(((minLow - close) / close) * 100);
}

function maxRunupPctFromClose(currentClose, futureBars) {
  const close = toNumber(currentClose, null);
  if (!close || !Array.isArray(futureBars) || futureBars.length === 0) {
    return null;
  }

  const highs = futureBars
    .map((bar) => toNumber(bar.high, null))
    .filter((value) => Number.isFinite(value));

  if (!highs.length) return null;

  const maxHigh = Math.max(...highs);
  return roundPct(((maxHigh - close) / close) * 100);
}

function gradeOutcome5d({ next5dReturnPct, maxDrawdownNext5dPct }) {
  if (
    next5dReturnPct === null ||
    next5dReturnPct === undefined ||
    maxDrawdownNext5dPct === null ||
    maxDrawdownNext5dPct === undefined
  ) {
    return "PENDING";
  }

  if (next5dReturnPct > 0 && maxDrawdownNext5dPct >= -1.25) {
    return "WORKED";
  }

  if (next5dReturnPct < 0 || maxDrawdownNext5dPct < -1.25) {
    return "FAILED";
  }

  return "MIXED";
}

async function fetchEsDailyBars() {
  const res = await fetch(ES_DAILY_URL);
  const text = await res.text();

  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid ES daily bars JSON: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`ES daily bars fetch failed HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  if (!Array.isArray(json)) {
    throw new Error("ES daily bars endpoint did not return an array");
  }

  if (json.length < LOOKBACK_TRADING_DAYS) {
    throw new Error(
      `Not enough ES daily bars. Needed ${LOOKBACK_TRADING_DAYS}, got ${json.length}`
    );
  }

  return json;
}

function normalizeBar(bar) {
  return {
    time: toNumber(bar.time, null),
    open: toNumber(bar.open, null),
    high: toNumber(bar.high, null),
    low: toNumber(bar.low, null),
    close: toNumber(bar.close, null),
    volume: toNumber(bar.volume, null),
  };
}

function buildForwardReturnRows(allBars) {
  const normalized = allBars
    .map(normalizeBar)
    .filter((bar) => {
      return (
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close)
      );
    })
    .sort((a, b) => a.time - b.time);

  const startIndex = Math.max(0, normalized.length - LOOKBACK_TRADING_DAYS);
  const rowsSource = normalized.slice(startIndex);

  return rowsSource.map((bar, idx) => {
    const globalIndex = startIndex + idx;

    const bar1 = normalized[globalIndex + 1] || null;
    const bar3 = normalized[globalIndex + 3] || null;
    const bar5 = normalized[globalIndex + 5] || null;

    const future5Bars = normalized.slice(globalIndex + 1, globalIndex + 6);

    const next1dReturnPct = bar1 ? pctChange(bar.close, bar1.close) : null;
    const next3dReturnPct = bar3 ? pctChange(bar.close, bar3.close) : null;
    const next5dReturnPct = bar5 ? pctChange(bar.close, bar5.close) : null;

    const maxDrawdownNext5dPct =
      future5Bars.length >= 5
        ? maxDrawdownPctFromClose(bar.close, future5Bars)
        : null;

    const maxRunupNext5dPct =
      future5Bars.length >= 5
        ? maxRunupPctFromClose(bar.close, future5Bars)
        : null;

    const outcome5d = gradeOutcome5d({
      next5dReturnPct,
      maxDrawdownNext5dPct,
    });

    return {
      date: dateFromUnixSeconds(bar.time),
      time: bar.time,
      esOpen: bar.open,
      esHigh: bar.high,
      esLow: bar.low,
      esClose: bar.close,
      next1dReturnPct,
      next3dReturnPct,
      next5dReturnPct,
      maxDrawdownNext5dPct,
      maxRunupNext5dPct,
      outcome5d,
    };
  });
}

function buildSummary(rows) {
  return {
    rows: rows.length,
    workedCount: rows.filter((row) => row.outcome5d === "WORKED").length,
    failedCount: rows.filter((row) => row.outcome5d === "FAILED").length,
    mixedCount: rows.filter((row) => row.outcome5d === "MIXED").length,
    pendingCount: rows.filter((row) => row.outcome5d === "PENDING").length,
  };
}

async function main() {
  ensureDataDir();

  console.log("========================================");
  console.log("Engine 25 ES Forward Returns Build");
  console.log("ES price truth only");
  console.log("========================================");

  const allBars = await fetchEsDailyBars();
  const rows = buildForwardReturnRows(allBars);
  const summary = buildSummary(rows);

  const output = {
    ok: true,
    engine: ENGINE,
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    lookbackTradingDays: LOOKBACK_TRADING_DAYS,
    generatedAtUtc: new Date().toISOString(),
    source: {
      esDailyUrl: ES_DAILY_URL,
      fetchedBars: allBars.length,
      usedBars: rows.length,
    },
    summary,
    rows,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log("\n========================================");
  console.log("Engine 25 ES Forward Returns Complete");
  console.log("OK:", output.ok);
  console.log("Rows:", summary.rows);
  console.log("Worked:", summary.workedCount);
  console.log("Failed:", summary.failedCount);
  console.log("Mixed:", summary.mixedCount);
  console.log("Pending:", summary.pendingCount);
  console.log("First Date:", rows[0]?.date || null);
  console.log("Last Date:", rows[rows.length - 1]?.date || null);
  console.log("Wrote:", OUTPUT_FILE);
  console.log("========================================");

  console.log(
    JSON.stringify(
      {
        ok: output.ok,
        engine: output.engine,
        symbol: output.symbol,
        timeframe: output.timeframe,
        lookbackTradingDays: output.lookbackTradingDays,
        summary: output.summary,
        firstRow: rows[0] || null,
        lastRow: rows[rows.length - 1] || null,
        outputFile: OUTPUT_FILE,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("[Engine25EsForwardReturns] FAILED:");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
