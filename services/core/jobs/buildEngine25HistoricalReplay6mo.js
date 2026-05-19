// services/core/jobs/buildEngine25HistoricalReplay6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ENGINE = "engine25.historicalReplay.v0.6";
const MODEL_TYPE = "POLYGON_PROXY_ONLY";
const SYMBOL = "ES";
const TIMEFRAME = "1d";
const LOOKBACK_TRADING_DAYS = 126;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const PROXY_REPLAY_FILE = path.join(
  DATA_DIR,
  "engine25-es-replay-proxy-scores-6mo.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-6mo.json"
);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonSafe(file, required = true) {
  if (!fs.existsSync(file)) {
    if (required) {
      throw new Error(`Missing required data file: ${file}`);
    }
    return null;
  }

  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function weightedAvg(items) {
  const valid = items.filter(
    (item) =>
      item &&
      Number.isFinite(Number(item.value)) &&
      Number.isFinite(Number(item.weight)) &&
      Number(item.weight) > 0
  );

  if (!valid.length) return 50;

  const totalWeight = valid.reduce((sum, item) => sum + Number(item.weight), 0);
  const weightedSum = valid.reduce(
    (sum, item) => sum + Number(item.value) * Number(item.weight),
    0
  );

  return clamp(weightedSum / totalWeight);
}

function getScore(row, key) {
  return toNumber(row?.proxyScores?.[key]?.score, 50);
}

function deriveHistoricalScore(row) {
  const marketTrend = getScore(row, "marketTrend");
  const creditFragility = getScore(row, "creditFragility");
  const aiLeadership = getScore(row, "aiLeadership");
  const macroPressureProxy = getScore(row, "macroPressureProxy");

  return weightedAvg([
    { value: marketTrend, weight: 0.35 },
    { value: creditFragility, weight: 0.25 },
    { value: aiLeadership, weight: 0.25 },
    { value: macroPressureProxy, weight: 0.15 },
  ]);
}

function deriveHistoricalRegime(score, row) {
  const marketTrend = getScore(row, "marketTrend");
  const creditFragility = getScore(row, "creditFragility");
  const aiLeadership = getScore(row, "aiLeadership");
  const macroPressureProxy = getScore(row, "macroPressureProxy");

  if (
    score >= 75 &&
    marketTrend >= 75 &&
    creditFragility >= 65 &&
    aiLeadership >= 65 &&
    macroPressureProxy >= 60
  ) {
    return "POLYGON_PROXY_STRONG_RISK_ON";
  }

  if (
    score >= 65 &&
    marketTrend >= 65 &&
    aiLeadership >= 55 &&
    macroPressureProxy < 60
  ) {
    return "POLYGON_PROXY_AI_SUPPORTED_WITH_MACRO_PRESSURE";
  }

  if (score >= 65) {
    return "POLYGON_PROXY_HEALTHY_RISK_ON";
  }

  if (score >= 55 && marketTrend >= 55) {
    return "POLYGON_PROXY_MIXED_BULLISH";
  }

  if (score >= 45) {
    return "POLYGON_PROXY_NEUTRAL_CHOP";
  }

  if (score >= 35) {
    return "POLYGON_PROXY_RISK_OFF_WARNING";
  }

  return "POLYGON_PROXY_MARKET_STRESS";
}

function deriveHistoricalBias(score, row) {
  const marketTrend = getScore(row, "marketTrend");
  const creditFragility = getScore(row, "creditFragility");
  const aiLeadership = getScore(row, "aiLeadership");
  const macroPressureProxy = getScore(row, "macroPressureProxy");

  if (
    score >= 70 &&
    marketTrend >= 70 &&
    creditFragility >= 60 &&
    aiLeadership >= 60 &&
    macroPressureProxy >= 60
  ) {
    return "LONG_FAVORED_PROXY";
  }

  if (score >= 60) {
    if (creditFragility < 45) return "SELECTIVE_LONGS_CREDIT_FRAGILITY_PROXY";
    if (macroPressureProxy < 55) return "SELECTIVE_LONGS_MACRO_CAUTION_PROXY";
    return "SELECTIVE_LONGS_PROXY";
  }

  if (score >= 50) return "A_PLUS_ONLY_PROXY";
  if (score >= 45) return "NEUTRAL_WAIT_PROXY";
  return "DEFENSIVE_PROXY";
}

function deriveHistoricalEsPermission(score, row) {
  const marketTrend = getScore(row, "marketTrend");
  const creditFragility = getScore(row, "creditFragility");
  const aiLeadership = getScore(row, "aiLeadership");
  const macroPressureProxy = getScore(row, "macroPressureProxy");

  let mode = "WAIT_FOR_CONFIRMATION_PROXY";
  let longScalps = false;
  let shortScalps = false;
  let sizeMultiplier = 0.5;

  if (
    score >= 65 &&
    marketTrend >= 65 &&
    creditFragility >= 55 &&
    aiLeadership >= 50
  ) {
    mode = "CONFIRMED_LONG_SCALPS_ONLY_PROXY";
    longScalps = true;
    shortScalps = false;
    sizeMultiplier = 0.75;
  }

  if (score >= 70 && macroPressureProxy >= 60) {
    mode = "NORMAL_LONGS_ALLOWED_PROXY";
    longScalps = true;
    shortScalps = false;
    sizeMultiplier = 1.0;
  }

  if (macroPressureProxy < 60) {
    mode = "A_PLUS_LONGS_ONLY_MACRO_PROXY_PRESSURE";
    longScalps = true;
    shortScalps = false;
    sizeMultiplier = Math.min(sizeMultiplier, 0.5);
  }

  if (creditFragility < 45) {
    mode = "A_PLUS_LONGS_ONLY_CREDIT_FRAGILITY_PROXY";
    longScalps = true;
    shortScalps = false;
    sizeMultiplier = Math.min(sizeMultiplier, 0.5);
  }

  if (score < 50) {
    mode = "A_PLUS_ONLY_OR_WAIT_PROXY";
    longScalps = true;
    shortScalps = false;
    sizeMultiplier = 0.5;
  }

  if (score < 45) {
    mode = "DEFENSIVE_NO_BLIND_LONGS_PROXY";
    longScalps = false;
    shortScalps = true;
    sizeMultiplier = 0.25;
  }

  return {
    symbol: SYMBOL,
    modelType: MODEL_TYPE,
    mode,
    longScalps,
    shortScalps,
    swingLongs: longScalps && sizeMultiplier >= 0.75,
    swingShorts: shortScalps,
    sizeMultiplier,
  };
}

function deriveColor(score, permission) {
  if (score < 45 || permission.sizeMultiplier <= 0.25) return "red";
  if (permission.sizeMultiplier <= 0.5) return "orange";
  if (score < 70) return "yellow";
  return "green";
}

function deriveLabel(permission, score) {
  const mode = String(permission?.mode || "");

  if (mode.includes("A_PLUS")) return "A+ LONGS ONLY";
  if (mode.includes("NORMAL_LONGS")) return "LONGS OK";
  if (mode.includes("CONFIRMED_LONG")) return "CONFIRMED LONGS";
  if (mode.includes("DEFENSIVE")) return "DEFENSIVE";
  if (score < 50) return "WAIT";

  return "SELECTIVE LONGS";
}

function collectWarnings(row) {
  return [
    ...(row?.proxyScores?.marketTrend?.warnings || []),
    ...(row?.proxyScores?.creditFragility?.warnings || []),
    ...(row?.proxyScores?.aiLeadership?.warnings || []),
    ...(row?.proxyScores?.macroPressureProxy?.warnings || []),
  ];
}

function buildHistoricalRow(row) {
  const score = deriveHistoricalScore(row);
  const regime = deriveHistoricalRegime(score, row);
  const bias = deriveHistoricalBias(score, row);
  const esPermission = deriveHistoricalEsPermission(score, row);
  const color = deriveColor(score, esPermission);
  const label = deriveLabel(esPermission, score);

  const setup = row?.setups?.constructive20Pullback || null;

  return {
    date: row.date,
    time: row.time,

    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    modelType: MODEL_TYPE,

    esOpen: row.esOpen,
    esHigh: row.esHigh,
    esLow: row.esLow,
    esClose: row.esClose,

    daily: row.daily || null,

    engine25HistoricalScore: score,
    historicalRegime: regime,
    historicalBias: bias,
    historicalEsPermission: esPermission,
    color,
    label,

    componentScores: {
      marketTrend: getScore(row, "marketTrend"),
      creditFragility: getScore(row, "creditFragility"),
      aiLeadership: getScore(row, "aiLeadership"),
      macroPressureProxy: getScore(row, "macroPressureProxy"),
      distributionPressure: null,
      breadthParticipation: null,
      creditStress: null,
      liquidity: null,
      inflation: null,
      eventRisk: null,
    },

    componentLabels: {
      marketTrend: row?.proxyScores?.marketTrend?.label || null,
      creditFragility: row?.proxyScores?.creditFragility?.label || null,
      aiLeadership: row?.proxyScores?.aiLeadership?.label || null,
      macroPressureProxy: row?.proxyScores?.macroPressureProxy?.label || null,
    },

    setups: {
      constructive20Pullback: setup,
    },

    next1dReturnPct: row.next1dReturnPct,
    next3dReturnPct: row.next3dReturnPct,
    next5dReturnPct: row.next5dReturnPct,
    maxDrawdownNext5dPct: row.maxDrawdownNext5dPct,
    maxRunupNext5dPct: row.maxRunupNext5dPct,
    outcome5d: row.outcome5d,

    warnings: collectWarnings(row),
  };
}

function summarizeRows(rows) {
  const closedRows = rows.filter((row) => row.outcome5d !== "PENDING");
  const workedRows = closedRows.filter((row) => row.outcome5d === "WORKED");
  const failedRows = closedRows.filter((row) => row.outcome5d === "FAILED");

  const confirmedSetupRows = rows.filter(
    (row) => row.setups?.constructive20Pullback?.confirmed === true
  );

  const confirmedClosed = confirmedSetupRows.filter((row) => {
    const outcome = row.setups?.constructive20Pullback?.outcome5dFromEntry;
    return outcome && outcome !== "PENDING";
  });

  const confirmedWorked = confirmedClosed.filter(
    (row) => row.setups?.constructive20Pullback?.outcome5dFromEntry === "WORKED"
  );

  const confirmedFailed = confirmedClosed.filter(
    (row) => row.setups?.constructive20Pullback?.outcome5dFromEntry === "FAILED"
  );

  const byColor = {};
  const byRegime = {};
  const byPermission = {};

  for (const row of rows) {
    byColor[row.color] = (byColor[row.color] || 0) + 1;
    byRegime[row.historicalRegime] = (byRegime[row.historicalRegime] || 0) + 1;
    const mode = row.historicalEsPermission?.mode || "UNKNOWN";
    byPermission[mode] = (byPermission[mode] || 0) + 1;
  }

  const avg = (items) => {
    const nums = items.map(Number).filter(Number.isFinite);
    if (!nums.length) return null;
    return round(nums.reduce((sum, value) => sum + value, 0) / nums.length, 3);
  };

  return {
    rows: rows.length,
    closedRows: closedRows.length,
    workedCount: workedRows.length,
    failedCount: failedRows.length,
    pendingCount: rows.filter((row) => row.outcome5d === "PENDING").length,
    baseWinRatePct:
      closedRows.length === 0
        ? null
        : round((workedRows.length / closedRows.length) * 100, 1),

    avgHistoricalScore: avg(rows.map((row) => row.engine25HistoricalScore)),
    avgNext5dReturnPct: avg(rows.map((row) => row.next5dReturnPct)),
    avgMaxDrawdownNext5dPct: avg(rows.map((row) => row.maxDrawdownNext5dPct)),

    byColor,
    byRegime,
    byPermission,

    constructive20PullbackConfirmed: {
      confirmedCount: confirmedSetupRows.length,
      closedConfirmedCount: confirmedClosed.length,
      workedCount: confirmedWorked.length,
      failedCount: confirmedFailed.length,
      winRatePct:
        confirmedClosed.length === 0
          ? null
          : round((confirmedWorked.length / confirmedClosed.length) * 100, 1),
      rows: confirmedSetupRows.map((row) => ({
        setupDate: row.setups.constructive20Pullback.setupDate,
        entryDate: row.setups.constructive20Pullback.entryDate,
        label: row.label,
        color: row.color,
        engine25HistoricalScore: row.engine25HistoricalScore,
        historicalRegime: row.historicalRegime,
        historicalBias: row.historicalBias,
        esMode: row.historicalEsPermission.mode,
        sizeMultiplier: row.historicalEsPermission.sizeMultiplier,
        componentScores: row.componentScores,
        outcome5dFromEntry:
          row.setups.constructive20Pullback.outcome5dFromEntry,
        next5dReturnFromEntryPct:
          row.setups.constructive20Pullback.next5dReturnFromEntryPct,
        maxDrawdownNext5dFromEntryPct:
          row.setups.constructive20Pullback.maxDrawdownNext5dFromEntryPct,
      })),
    },
  };
}

function main() {
  ensureDataDir();

  console.log("========================================");
  console.log("Engine 25 Historical Replay Build");
  console.log("POLYGON_PROXY_ONLY");
  console.log("========================================");

  const proxyReplay = readJsonSafe(PROXY_REPLAY_FILE, true);

  if (!proxyReplay?.ok || !Array.isArray(proxyReplay.rows)) {
    throw new Error(
      "Invalid proxy replay file. Run buildEngine25EsReplayProxyScores6mo.js first."
    );
  }

  const rows = proxyReplay.rows.map(buildHistoricalRow);
  const summary = summarizeRows(rows);

  const output = {
    ok: true,
    engine: ENGINE,
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    lookbackTradingDays: LOOKBACK_TRADING_DAYS,
    modelType: MODEL_TYPE,
    generatedAtUtc: new Date().toISOString(),
    source: {
      proxyReplayFile: "engine25-es-replay-proxy-scores-6mo.json",
    },
    limitations: [
      "POLYGON_PROXY_ONLY model.",
      "Does not include FRED rates/yields/labor/credit stress.",
      "Does not include FiscalData liquidity.",
      "Does not include FMP event/news risk.",
      "Does not include sector-card distributionPressure or breadthParticipation.",
      "Does not include institutional/negotiated zones yet.",
      "Does not include Elliott Wave location yet.",
    ],
    scoreWeights: {
      marketTrend: 0.35,
      creditFragility: 0.25,
      aiLeadership: 0.25,
      macroPressureProxy: 0.15,
    },
    summary,
    rows,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log("\n========================================");
  console.log("Engine 25 Historical Replay Complete");
  console.log("OK:", output.ok);
  console.log("Rows:", summary.rows);
  console.log("Model Type:", output.modelType);
  console.log("Average Score:", summary.avgHistoricalScore);
  console.log("Base Win Rate:", summary.baseWinRatePct);
  console.log(
    "Constructive20:",
    JSON.stringify(summary.constructive20PullbackConfirmed, null, 2)
  );
  console.log("Wrote:", OUTPUT_FILE);
  console.log("========================================");

  console.log(
    JSON.stringify(
      {
        ok: output.ok,
        engine: output.engine,
        modelType: output.modelType,
        symbol: output.symbol,
        timeframe: output.timeframe,
        lookbackTradingDays: output.lookbackTradingDays,
        summary: output.summary,
        outputFile: OUTPUT_FILE,
      },
      null,
      2
    )
  );
}

main();
