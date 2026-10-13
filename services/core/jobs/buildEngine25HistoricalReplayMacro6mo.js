// services/core/jobs/buildEngine25HistoricalReplayMacro6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const BASE_REPLAY_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-6mo.json"
);

const MACRO_FEEDS_FILE = path.join(
  DATA_DIR,
  "engine25-historical-macro-feeds-6mo.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-macro-6mo.json"
);

const ENGINE_NAME = "engine25.historicalReplayMacro.v0.1";
const MODEL_TYPE = "POLYGON_PROXY_PLUS_FRED_FISCALDATA_MACRO";

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeRows(block, label) {
  if (Array.isArray(block)) return block;
  if (Array.isArray(block?.rows)) return block.rows;

  throw new Error(`${label} does not contain a rows array or top-level array.`);
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(min, Math.min(max, Math.round(value)));
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

function avgNumber(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return Number((nums.reduce((sum, v) => sum + v, 0) / nums.length).toFixed(3));
}

function indexRowsByDate(rows, label) {
  const map = new Map();
  const duplicates = [];

  for (const row of rows) {
    const date = row?.date;

    if (!date) {
      continue;
    }

    if (map.has(date)) {
      duplicates.push(date);
    }

    map.set(date, row);
  }

  return {
    label,
    map,
    duplicates,
  };
}

function getComponentScore(row, key) {
  return safeNumber(row?.componentScores?.[key]);
}

function getMacroScore(macroRow, key) {
  return safeNumber(macroRow?.macroScores?.[key]?.score);
}

function buildMacroAwareScore(baseRow, macroRow) {
  const marketTrend = getComponentScore(baseRow, "marketTrend");
  const creditFragility = getComponentScore(baseRow, "creditFragility");
  const aiLeadership = getComponentScore(baseRow, "aiLeadership");
  const macroPressureProxy = getComponentScore(baseRow, "macroPressureProxy");

  const labor = getMacroScore(macroRow, "labor");
  const creditStress = getMacroScore(macroRow, "creditStress");
  const bondMarket = getMacroScore(macroRow, "bondMarket");
  const liquidity = getMacroScore(macroRow, "liquidity");
  const inflation = getMacroScore(macroRow, "inflation");

  // v0.1 combined replay score:
  // Keep Polygon proxy leadership/context important,
  // but replace blank macro fields with real FRED/FiscalData macro components.
  // Do not treat this as final live Engine 25 scoring yet.
  return weightedAvg([
    { value: marketTrend, weight: 0.2 },
    { value: creditFragility, weight: 0.15 },
    { value: aiLeadership, weight: 0.15 },
    { value: macroPressureProxy, weight: 0.1 },
    { value: labor, weight: 0.08 },
    { value: creditStress, weight: 0.1 },
    { value: bondMarket, weight: 0.08 },
    { value: liquidity, weight: 0.08 },
    { value: inflation, weight: 0.06 },
  ]);
}

function deriveMacroAwareLabel(score) {
  if (score >= 75) {
    return {
      label: "MACRO_AWARE_RISK_ON",
      color: "green",
      bias: "LONGS_ALLOWED_SELECTIVE",
      esMode: "CONFIRMED_LONGS_ALLOWED_MACRO_AWARE",
      sizeMultiplier: 0.75,
    };
  }

  if (score >= 65) {
    return {
      label: "MACRO_AWARE_CONSTRUCTIVE_SELECTIVE",
      color: "green",
      bias: "SELECTIVE_LONGS",
      esMode: "SELECTIVE_LONGS_MACRO_AWARE",
      sizeMultiplier: 0.65,
    };
  }

  if (score >= 55) {
    return {
      label: "MACRO_AWARE_MIXED_A_PLUS_ONLY",
      color: "orange",
      bias: "A_PLUS_ONLY",
      esMode: "A_PLUS_LONGS_ONLY_MACRO_AWARE",
      sizeMultiplier: 0.5,
    };
  }

  if (score >= 45) {
    return {
      label: "MACRO_AWARE_CHOP_WAIT",
      color: "orange",
      bias: "WAIT_FOR_CONFIRMATION",
      esMode: "A_PLUS_ONLY_OR_WAIT_MACRO_AWARE",
      sizeMultiplier: 0.35,
    };
  }

  return {
    label: "MACRO_AWARE_DEFENSIVE",
    color: "red",
    bias: "DEFENSIVE",
    esMode: "DEFENSIVE_NO_BLIND_LONGS_MACRO_AWARE",
    sizeMultiplier: 0.25,
  };
}

function buildCombinedRow(baseRow, macroRow) {
  const macroAwareScore = buildMacroAwareScore(baseRow, macroRow);
  const macroAware = deriveMacroAwareLabel(macroAwareScore);

  const baseComponentScores = baseRow?.componentScores || {};

  return {
    ...baseRow,

    modelType: MODEL_TYPE,

    engine25HistoricalScoreProxyOnly:
      safeNumber(baseRow?.engine25HistoricalScore) ?? null,

    engine25HistoricalScoreMacroAware: macroAwareScore,

    historicalRegimeProxyOnly: baseRow?.historicalRegime || null,
    historicalBiasProxyOnly: baseRow?.historicalBias || null,
    historicalEsPermissionProxyOnly: baseRow?.historicalEsPermission || null,

    historicalRegimeMacroAware: macroAware.label,
    historicalBiasMacroAware: macroAware.bias,
    historicalEsPermissionMacroAware: macroAware.esMode,
    macroAwareColor: macroAware.color,
    macroAwareSizeMultiplier: macroAware.sizeMultiplier,

    componentScores: {
      ...baseComponentScores,

      labor: getMacroScore(macroRow, "labor"),
      creditStress: getMacroScore(macroRow, "creditStress"),
      bondMarket: getMacroScore(macroRow, "bondMarket"),
      liquidity: getMacroScore(macroRow, "liquidity"),
      inflation: getMacroScore(macroRow, "inflation"),

      macroScoreSummary: safeNumber(macroRow?.macroScoreSummary),
    },

    macroFeed: {
      engine: "engine25.historicalMacroFeeds.v0.3",
      macroScoreSummary: safeNumber(macroRow?.macroScoreSummary),
      macroScores: macroRow?.macroScores || null,
      fiscalData: macroRow?.fiscalData || null,
      fred: macroRow?.fred || null,
      warnings: macroRow?.warnings || [],
    },

    warnings: [
      ...(Array.isArray(baseRow?.warnings) ? baseRow.warnings : []),
      ...(Array.isArray(macroRow?.warnings) ? macroRow.warnings : []),
    ],
  };
}

function buildSummary(rows, missingMacroDates) {
  const closedRows = rows.filter((row) => row.outcome5d !== "PENDING");
  const workedRows = closedRows.filter((row) => row.outcome5d === "WORKED");
  const failedRows = closedRows.filter((row) => row.outcome5d === "FAILED");

  const byMacroAwareColor = rows.reduce((acc, row) => {
    const key = row.macroAwareColor || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const byMacroAwareRegime = rows.reduce((acc, row) => {
    const key = row.historicalRegimeMacroAware || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const byMacroAwarePermission = rows.reduce((acc, row) => {
    const key = row.historicalEsPermissionMacroAware || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    rows: rows.length,
    closedRows: closedRows.length,
    workedCount: workedRows.length,
    failedCount: failedRows.length,
    pendingCount: rows.length - closedRows.length,
    baseWinRatePct:
      closedRows.length > 0
        ? Number(((workedRows.length / closedRows.length) * 100).toFixed(1))
        : null,

    avgProxyOnlyScore: avgNumber(
      rows.map((row) => row.engine25HistoricalScoreProxyOnly)
    ),

    avgMacroAwareScore: avgNumber(
      rows.map((row) => row.engine25HistoricalScoreMacroAware)
    ),

    avgMacroScoreSummary: avgNumber(
      rows.map((row) => row.componentScores?.macroScoreSummary)
    ),

    byMacroAwareColor,
    byMacroAwareRegime,
    byMacroAwarePermission,

    missingMacroDates,
    missingMacroCount: missingMacroDates.length,
  };
}

async function main() {
  const startedAt = new Date().toISOString();

  const output = {
    ok: false,
    engine: ENGINE_NAME,
    modelType: MODEL_TYPE,
    symbol: "ES",
    timeframe: "1d",
    generatedAtUtc: null,
    startedAt,
    finishedAt: null,
    source: {
      baseReplayFile: "engine25-historical-replay-6mo.json",
      macroFeedsFile: "engine25-historical-macro-feeds-6mo.json",
      outputFile: "engine25-historical-replay-macro-6mo.json",
    },
    limitations: [
      "This v0.1 merge file does not overwrite POLYGON_PROXY_ONLY replay.",
      "Macro-aware score is a first-pass blend of Polygon proxy context plus FRED/FiscalData macro components.",
      "Final live Engine 25 weighting is not changed by this job.",
      "Distribution pressure, breadth participation, historical FMP event risk, and final ES permission tuning are still future steps.",
    ],
    summary: null,
    validation: null,
    rows: [],
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25 Historical Replay Macro Merge");
    console.log("Polygon proxy replay + FRED/FiscalData macro");
    console.log("========================================");

    console.log("\nReading base replay:");
    console.log(BASE_REPLAY_FILE);
    const baseReplay = readJsonFile(BASE_REPLAY_FILE);
    const baseRows = normalizeRows(baseReplay, "Base replay");

    console.log("Base replay rows:", baseRows.length);

    console.log("\nReading macro feeds:");
    console.log(MACRO_FEEDS_FILE);
    const macroFeeds = readJsonFile(MACRO_FEEDS_FILE);
    const macroRows = normalizeRows(macroFeeds, "Macro feeds");

    console.log("Macro feed rows:", macroRows.length);

    const macroIndex = indexRowsByDate(macroRows, "macroFeeds");

    const missingMacroDates = [];
    const mergedRows = [];

    for (const baseRow of baseRows) {
      const date = baseRow?.date;

      if (!date) {
        continue;
      }

      const macroRow = macroIndex.map.get(date);

      if (!macroRow) {
        missingMacroDates.push(date);
        mergedRows.push({
          ...baseRow,
          modelType: MODEL_TYPE,
          macroFeed: null,
          macroMergeWarning: "MISSING_MACRO_ROW_FOR_DATE",
        });
        continue;
      }

      mergedRows.push(buildCombinedRow(baseRow, macroRow));
    }

    output.rows = mergedRows;
    output.summary = buildSummary(mergedRows, missingMacroDates);

    output.validation = {
      baseRows: baseRows.length,
      macroRows: macroRows.length,
      mergedRows: mergedRows.length,
      missingMacroCount: missingMacroDates.length,
      missingMacroDates,
      macroDuplicateDates: macroIndex.duplicates,
      ok:
        mergedRows.length === baseRows.length &&
        missingMacroDates.length === 0 &&
        macroIndex.duplicates.length === 0,
      firstRow: mergedRows[0] || null,
      lastRow: mergedRows[mergedRows.length - 1] || null,
    };

    output.ok = output.validation.ok;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Historical Replay Macro Merge Complete");
    console.log("OK:", output.ok);
    console.log("Rows:", output.summary.rows);
    console.log("Missing macro rows:", output.summary.missingMacroCount);
    console.log("Avg proxy score:", output.summary.avgProxyOnlyScore);
    console.log("Avg macro-aware score:", output.summary.avgMacroAwareScore);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          modelType: output.modelType,
          summary: output.summary,
          validation: {
            baseRows: output.validation.baseRows,
            macroRows: output.validation.macroRows,
            mergedRows: output.validation.mergedRows,
            missingMacroCount: output.validation.missingMacroCount,
            macroDuplicateDates: output.validation.macroDuplicateDates,
          },
          firstRowQuick: {
            date: output.validation.firstRow?.date,
            proxyScore: output.validation.firstRow?.engine25HistoricalScoreProxyOnly,
            macroAwareScore:
              output.validation.firstRow?.engine25HistoricalScoreMacroAware,
            macroScoreSummary:
              output.validation.firstRow?.componentScores?.macroScoreSummary,
            macroAwarePermission:
              output.validation.firstRow?.historicalEsPermissionMacroAware,
          },
          lastRowQuick: {
            date: output.validation.lastRow?.date,
            proxyScore: output.validation.lastRow?.engine25HistoricalScoreProxyOnly,
            macroAwareScore:
              output.validation.lastRow?.engine25HistoricalScoreMacroAware,
            macroScoreSummary:
              output.validation.lastRow?.componentScores?.macroScoreSummary,
            macroAwarePermission:
              output.validation.lastRow?.historicalEsPermissionMacroAware,
          },
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );

    if (!output.ok) {
      process.exit(1);
    }
  } catch (err) {
    output.ok = false;
    output.finishedAt = new Date().toISOString();
    output.generatedAtUtc = output.finishedAt;
    output.errors.push({
      message: err.message,
      stack: err.stack,
    });

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.error("Engine 25 Historical Replay Macro Merge Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
