// services/core/jobs/buildEngine25EsReplayDailyTechnical6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ENGINE = "engine25.esReplayDailyTechnical.v0.4";
const SYMBOL = "ES";
const TIMEFRAME = "1d";
const LOOKBACK_TRADING_DAYS = 126;
const FETCH_LIMIT = 220;

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
  "engine25-es-replay-daily-technical-6mo.json"
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

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function roundPct(value) {
  return round(value, 3);
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

function ema(values, length) {
  if (!Array.isArray(values) || values.length < length) return [];

  const multiplier = 2 / (length + 1);
  const output = new Array(values.length).fill(null);

  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += values[i];
  }

  let previousEma = sum / length;
  output[length - 1] = previousEma;

  for (let i = length; i < values.length; i += 1) {
    previousEma = values[i] * multiplier + previousEma * (1 - multiplier);
    output[i] = previousEma;
  }

  return output;
}

function avgFromBars(bars, index, field, lookback = 20) {
  const start = Math.max(0, index - lookback);
  const priorBars = bars.slice(start, index);
  const values = priorBars
    .map((bar) => toNumber(bar?.[field], null))
    .filter(Number.isFinite);

  if (values.length < Math.min(lookback, 10)) return null;

  return round(values.reduce((sum, value) => sum + value, 0) / values.length, 0);
}

function closeLocationPct(bar) {
  const high = toNumber(bar?.high, null);
  const low = toNumber(bar?.low, null);
  const close = toNumber(bar?.close, null);

  if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    return null;
  }

  const range = high - low;
  if (range <= 0) return 50;

  return round(((close - low) / range) * 100, 2);
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

function deriveDailyTechnicalState({
  close,
  ema10,
  ema20,
  ema50,
  aboveEma10,
  aboveEma20,
  aboveEma50,
}) {
  if (!close || !ema10 || !ema20 || !ema50) {
    return "INSUFFICIENT_DATA";
  }

  if (aboveEma10 && aboveEma20 && aboveEma50 && ema10 >= ema20 && ema20 >= ema50) {
    return "DAILY_BULLISH_STACK";
  }

  if (aboveEma20 && aboveEma50 && !aboveEma10) {
    return "DAILY_PULLBACK_ABOVE_CORE_SUPPORT";
  }

  if (aboveEma20 && aboveEma50) {
    return "DAILY_CONSTRUCTIVE_ABOVE_20_50";
  }

  if (!aboveEma20 && aboveEma50) {
    return "DAILY_TESTING_50EMA_SUPPORT";
  }

  if (!aboveEma20 && !aboveEma50) {
    return "DAILY_BELOW_CORE_SUPPORT";
  }

  return "DAILY_MIXED";
}

function deriveEsVolumeDistributionState({
  isHighVolumeDownDay,
  highVolumeWeakClose,
  volumeExpansionIntoSelloff,
  sellingPressureFading,
  volumeFadeNearSupport,
  weakClose,
}) {
  if (volumeExpansionIntoSelloff) return "ES_VOLUME_EXPANSION_SELLOFF";
  if (highVolumeWeakClose) return "ES_HIGH_VOLUME_WEAK_CLOSE_DISTRIBUTION";
  if (isHighVolumeDownDay) return "ES_HIGH_VOLUME_DISTRIBUTION";
  if (weakClose) return "ES_WEAK_CLOSE_DISTRIBUTION";
  if (sellingPressureFading) return "SELLING_PRESSURE_FADING";
  if (volumeFadeNearSupport) return "VOLUME_FADE_NEAR_SUPPORT";
  return "ES_VOLUME_NORMAL";
}

function buildEsVolumeRead({
  bars,
  index,
  bar,
  priorBar,
  dailyTechnicalState,
  aboveEma20,
  aboveEma50,
}) {
  const volume = toNumber(bar.volume, null);
  const priorClose = toNumber(priorBar?.close, null);
  const avgVolume20 = avgFromBars(bars, index, "volume", 20);
  const closeLoc = closeLocationPct(bar);

  const isDownDay =
    Number.isFinite(priorClose) && Number.isFinite(bar.close)
      ? bar.close < priorClose
      : null;

  const weakClose = Number.isFinite(closeLoc) ? closeLoc < 35 : false;

  const isHighVolumeDownDay =
    isDownDay === true &&
    Number.isFinite(volume) &&
    Number.isFinite(avgVolume20)
      ? volume > avgVolume20 * 1.1
      : false;

  const highVolumeWeakClose =
    isHighVolumeDownDay === true && weakClose === true;

  const volumeExpansionIntoSelloff =
    isDownDay === true &&
    Number.isFinite(volume) &&
    Number.isFinite(avgVolume20) &&
    Number.isFinite(closeLoc)
      ? volume > avgVolume20 * 1.2 && closeLoc < 45
      : false;

  const nearCoreSupport =
    dailyTechnicalState === "DAILY_TESTING_50EMA_SUPPORT" ||
    dailyTechnicalState === "DAILY_BELOW_CORE_SUPPORT" ||
    aboveEma20 === false ||
    aboveEma50 === false;

  const sellingPressureFading =
    isDownDay === true &&
    Number.isFinite(volume) &&
    Number.isFinite(avgVolume20) &&
    Number.isFinite(closeLoc)
      ? volume < avgVolume20 && closeLoc > 40
      : false;

  const volumeFadeNearSupport =
    nearCoreSupport === true &&
    Number.isFinite(volume) &&
    Number.isFinite(avgVolume20)
      ? volume < avgVolume20
      : false;

  const volumeVsAvg20Pct =
    Number.isFinite(volume) && Number.isFinite(avgVolume20) && avgVolume20 > 0
      ? round(((volume - avgVolume20) / avgVolume20) * 100, 2)
      : null;

  const state = deriveEsVolumeDistributionState({
    isHighVolumeDownDay,
    highVolumeWeakClose,
    volumeExpansionIntoSelloff,
    sellingPressureFading,
    volumeFadeNearSupport,
    weakClose,
  });

  const warnings = [];

  if (volumeExpansionIntoSelloff) {
    warnings.push("ES volume expanded into selloff with weak close");
  } else if (highVolumeWeakClose) {
    warnings.push("ES high-volume weak close distribution");
  } else if (isHighVolumeDownDay) {
    warnings.push("ES high-volume down day");
  } else if (weakClose) {
    warnings.push("ES weak close location");
  }

  if (sellingPressureFading) {
    warnings.push("ES selling pressure fading");
  }

  if (volumeFadeNearSupport) {
    warnings.push("ES volume fading near core support");
  }

  return {
    state,
    volume,
    avgVolume20,
    volumeVsAvg20Pct,
    priorClose,
    closeLocationPct: closeLoc,
    weakClosePct: closeLoc,
    isDownDay,
    weakClose,
    isHighVolumeDownDay,
    highVolumeWeakClose,
    volumeExpansionIntoSelloff,
    sellingPressureFading,
    volumeFadeNearSupport,
    nearCoreSupport,
    warnings,
  };
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

function buildReplayRows(allBars) {
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

  const closes = normalized.map((bar) => bar.close);

  const ema10Series = ema(closes, 10);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);

  const startIndex = Math.max(0, normalized.length - LOOKBACK_TRADING_DAYS);
  const rowsSource = normalized.slice(startIndex);

  return rowsSource.map((bar, idx) => {
    const globalIndex = startIndex + idx;

    const ema10 = round(ema10Series[globalIndex], 2);
    const ema20 = round(ema20Series[globalIndex], 2);
    const ema50 = round(ema50Series[globalIndex], 2);

    const aboveEma10 = ema10 === null ? null : bar.close > ema10;
    const aboveEma20 = ema20 === null ? null : bar.close > ema20;
    const aboveEma50 = ema50 === null ? null : bar.close > ema50;

    const distanceToEma20Pct =
      ema20 === null ? null : roundPct(((bar.close - ema20) / bar.close) * 100);

    const dailyTechnicalState = deriveDailyTechnicalState({
      close: bar.close,
      ema10,
      ema20,
      ema50,
      aboveEma10,
      aboveEma20,
      aboveEma50,
    });

    const priorBar = normalized[globalIndex - 1] || null;

    const esVolumeDistribution = buildEsVolumeRead({
      bars: normalized,
      index: globalIndex,
      bar,
      priorBar,
      dailyTechnicalState,
      aboveEma20,
      aboveEma50,
    });

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
      esVolume: bar.volume,

      daily: {
        close: bar.close,
        volume: bar.volume,
        ema10,
        ema20,
        ema50,
        aboveEma10,
        aboveEma20,
        aboveEma50,
        distanceToEma20Pct,
        technicalState: dailyTechnicalState,
        esVolumeDistribution,
      },

      esVolumeDistribution,

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
  const technicalStateCounts = {};
  const esVolumeStateCounts = {};

  for (const row of rows) {
    const state = row.daily?.technicalState || "UNKNOWN";
    technicalStateCounts[state] = (technicalStateCounts[state] || 0) + 1;

    const volumeState = row.esVolumeDistribution?.state || "UNKNOWN";
    esVolumeStateCounts[volumeState] = (esVolumeStateCounts[volumeState] || 0) + 1;
  }

  return {
    rows: rows.length,
    workedCount: rows.filter((row) => row.outcome5d === "WORKED").length,
    failedCount: rows.filter((row) => row.outcome5d === "FAILED").length,
    mixedCount: rows.filter((row) => row.outcome5d === "MIXED").length,
    pendingCount: rows.filter((row) => row.outcome5d === "PENDING").length,
    technicalStateCounts,
    esVolumeStateCounts,
  };
}

async function main() {
  ensureDataDir();

  console.log("========================================");
  console.log("Engine 25 ES Replay Daily Technical Build");
  console.log("ES price truth + daily technical + ES volume distribution v0.4");
  console.log("========================================");

  const allBars = await fetchEsDailyBars();
  const rows = buildReplayRows(allBars);
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
  console.log("Engine 25 ES Replay Daily Technical Complete");
  console.log("OK:", output.ok);
  console.log("Rows:", summary.rows);
  console.log("Worked:", summary.workedCount);
  console.log("Failed:", summary.failedCount);
  console.log("Mixed:", summary.mixedCount);
  console.log("Pending:", summary.pendingCount);
  console.log("Technical States:", JSON.stringify(summary.technicalStateCounts));
  console.log("ES Volume States:", JSON.stringify(summary.esVolumeStateCounts));
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
  console.error("[Engine25EsReplayDailyTechnical] FAILED:");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
