// services/core/jobs/buildEngine25HistoricalReplayMacroDistribution6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const MACRO_REPLAY_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-macro-6mo.json"
);

const DISTRIBUTION_FILE = path.join(
  DATA_DIR,
  "engine25-historical-distribution-pressure-6mo.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-macro-distribution-6mo.json"
);

const ENGINE_NAME = "engine25.historicalReplayMacroDistribution.v0.1";
const MODEL_TYPE = "POLYGON_PROXY_PLUS_MACRO_PLUS_DISTRIBUTION_PRESSURE";

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeRows(block, label) {
  if (Array.isArray(block)) return block;
  if (Array.isArray(block?.rows)) return block.rows;
  throw new Error(`${label} does not contain rows.`);
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function avgNumber(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;

  return Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(3));
}

function indexRowsByDate(rows, label) {
  const map = new Map();
  const duplicates = [];

  for (const row of rows) {
    const date = row?.date;

    if (!date) continue;

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

function deriveDistributionAdjustedPermission(row, distributionPressure) {
  const basePermission = row.historicalEsPermissionMacroAware || "UNKNOWN";
  const baseSize = safeNumber(row.macroAwareSizeMultiplier) ?? 0.5;
  const distributionScore = safeNumber(distributionPressure?.score) ?? 50;
  const distributionLabel = distributionPressure?.label || "DISTRIBUTION_PRESSURE_UNKNOWN";

  let permission = basePermission;
  let sizeMultiplier = baseSize;
  const notes = [];

  if (distributionLabel === "DISTRIBUTION_PRESSURE_HIGH" || distributionScore >= 70) {
    permission = "A_PLUS_ONLY_HIGH_DISTRIBUTION_PRESSURE";
    sizeMultiplier = Math.min(baseSize, 0.25);
    notes.push("Distribution pressure is high. Avoid blind longs and require strong reclaim confirmation.");
  } else if (distributionLabel === "DISTRIBUTION_PRESSURE_ELEVATED" || distributionScore >= 50) {
    permission = "A_PLUS_ONLY_ELEVATED_DISTRIBUTION_PRESSURE";
    sizeMultiplier = Math.min(baseSize, 0.5);
    notes.push("Distribution pressure is elevated. Longs require A+ quality and reduced size.");
  } else if (distributionLabel === "DISTRIBUTION_PRESSURE_FRAGILE_UNDER_SURFACE") {
    permission = "A_PLUS_ONLY_FRAGILE_UNDER_SURFACE";
    sizeMultiplier = Math.min(baseSize, 0.5);
    notes.push("Market is fragile underneath. Small caps, credit, or AI breadth show pressure.");
  } else if (distributionLabel === "DISTRIBUTION_PRESSURE_NORMAL") {
    permission = basePermission;
    sizeMultiplier = Math.min(baseSize, 0.75);
    notes.push("Distribution pressure is normal/mixed. Stay selective.");
  } else {
    permission = basePermission;
    sizeMultiplier = baseSize;
    notes.push("Distribution pressure is low.");
  }

  return {
    basePermission,
    distributionAdjustedPermission: permission,
    baseSizeMultiplier: baseSize,
    distributionAdjustedSizeMultiplier: sizeMultiplier,
    distributionScore,
    distributionLabel,
    notes,
  };
}

function buildMergedRow(row, distributionRow) {
  const distributionPressure = distributionRow?.distributionPressure || null;
  const adjustedPermission = deriveDistributionAdjustedPermission(row, distributionPressure);

  return {
    ...row,
    modelType: MODEL_TYPE,

    componentScores: {
      ...(row.componentScores || {}),
      distributionPressure: safeNumber(distributionPressure?.score),
    },

    distributionPressure: distributionPressure
      ? {
          score: distributionPressure.score,
          label: distributionPressure.label,
          interpretation: distributionPressure.interpretation,
          warnings: distributionPressure.warnings || [],
          components: distributionPressure.components || null,
        }
      : null,

    historicalEsPermissionMacroDistributionAware:
      adjustedPermission.distributionAdjustedPermission,

    macroDistributionAwareSizeMultiplier:
      adjustedPermission.distributionAdjustedSizeMultiplier,

    distributionAdjustedPermission: adjustedPermission,

    warnings: [
      ...(Array.isArray(row.warnings) ? row.warnings : []),
      ...(Array.isArray(distributionPressure?.warnings) ? distributionPressure.warnings : []),
    ].filter(Boolean),
  };
}

function buildSummary(rows, missingDistributionDates) {
  const byDistributionLabel = rows.reduce((acc, row) => {
    const label = row.distributionPressure?.label || "DISTRIBUTION_PRESSURE_MISSING";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const byDistributionAdjustedPermission = rows.reduce((acc, row) => {
    const permission =
      row.historicalEsPermissionMacroDistributionAware || "UNKNOWN";
    acc[permission] = (acc[permission] || 0) + 1;
    return acc;
  }, {});

  const closedRows = rows.filter((row) => row.outcome5d !== "PENDING");
  const workedRows = closedRows.filter((row) => row.outcome5d === "WORKED");
  const failedRows = closedRows.filter((row) => row.outcome5d === "FAILED");

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

    avgMacroAwareScore: avgNumber(
      rows.map((row) => row.engine25HistoricalScoreMacroAware)
    ),

    avgDistributionPressureScore: avgNumber(
      rows.map((row) => row.distributionPressure?.score)
    ),

    byDistributionLabel,
    byDistributionAdjustedPermission,

    missingDistributionDates,
    missingDistributionCount: missingDistributionDates.length,
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
    startedAt,
    finishedAt: null,
    generatedAtUtc: null,
    source: {
      macroReplayFile: "engine25-historical-replay-macro-6mo.json",
      distributionFile: "engine25-historical-distribution-pressure-6mo.json",
      outputFile: "engine25-historical-replay-macro-distribution-6mo.json",
    },
    limitations: [
      "This v0.1 merge adds historical distributionPressure into the macro-aware replay.",
      "This does not overwrite the macro-only replay file.",
      "Distribution-adjusted permission is a first-pass replay permission and does not change live trading behavior.",
      "BreadthParticipation is still a future step.",
      "Raw volume distribution days are not included yet.",
    ],
    summary: null,
    validation: null,
    rows: [],
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25 Historical Replay Macro + Distribution Merge");
    console.log("========================================");

    console.log("\nReading macro replay:");
    console.log(MACRO_REPLAY_FILE);

    const macroReplay = readJsonFile(MACRO_REPLAY_FILE);
    const macroRows = normalizeRows(macroReplay, "Macro replay");

    console.log("Macro replay rows:", macroRows.length);

    console.log("\nReading distribution pressure:");
    console.log(DISTRIBUTION_FILE);

    const distribution = readJsonFile(DISTRIBUTION_FILE);
    const distributionRows = normalizeRows(distribution, "Distribution pressure");

    console.log("Distribution rows:", distributionRows.length);

    const distributionIndex = indexRowsByDate(
      distributionRows,
      "distributionPressure"
    );

    const missingDistributionDates = [];

    const rows = macroRows.map((row) => {
      const distributionRow = distributionIndex.map.get(row.date);

      if (!distributionRow) {
        missingDistributionDates.push(row.date);
      }

      return buildMergedRow(row, distributionRow);
    });

    output.rows = rows;
    output.summary = buildSummary(rows, missingDistributionDates);

    output.validation = {
      macroRows: macroRows.length,
      distributionRows: distributionRows.length,
      mergedRows: rows.length,
      missingDistributionCount: missingDistributionDates.length,
      missingDistributionDates,
      distributionDuplicateDates: distributionIndex.duplicates,
      ok:
        rows.length === macroRows.length &&
        missingDistributionDates.length === 0 &&
        distributionIndex.duplicates.length === 0,
      firstRow: rows[0] || null,
      lastRow: rows[rows.length - 1] || null,
    };

    output.ok = output.validation.ok;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Historical Replay Macro + Distribution Merge Complete");
    console.log("OK:", output.ok);
    console.log("Rows:", output.summary.rows);
    console.log("Missing distribution rows:", output.summary.missingDistributionCount);
    console.log("Avg distribution pressure:", output.summary.avgDistributionPressureScore);
    console.log("By distribution label:", output.summary.byDistributionLabel);
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
            macroRows: output.validation.macroRows,
            distributionRows: output.validation.distributionRows,
            mergedRows: output.validation.mergedRows,
            missingDistributionCount: output.validation.missingDistributionCount,
            distributionDuplicateDates: output.validation.distributionDuplicateDates,
          },
          firstRowQuick: output.validation.firstRow
            ? {
                date: output.validation.firstRow.date,
                macroAwareScore:
                  output.validation.firstRow.engine25HistoricalScoreMacroAware,
                distributionPressure:
                  output.validation.firstRow.componentScores?.distributionPressure,
                distributionLabel:
                  output.validation.firstRow.distributionPressure?.label,
                oldPermission:
                  output.validation.firstRow.historicalEsPermissionMacroAware,
                newPermission:
                  output.validation.firstRow
                    .historicalEsPermissionMacroDistributionAware,
                newSize:
                  output.validation.firstRow.macroDistributionAwareSizeMultiplier,
              }
            : null,
          lastRowQuick: output.validation.lastRow
            ? {
                date: output.validation.lastRow.date,
                macroAwareScore:
                  output.validation.lastRow.engine25HistoricalScoreMacroAware,
                distributionPressure:
                  output.validation.lastRow.componentScores?.distributionPressure,
                distributionLabel:
                  output.validation.lastRow.distributionPressure?.label,
                oldPermission:
                  output.validation.lastRow.historicalEsPermissionMacroAware,
                newPermission:
                  output.validation.lastRow
                    .historicalEsPermissionMacroDistributionAware,
                newSize:
                  output.validation.lastRow.macroDistributionAwareSizeMultiplier,
              }
            : null,
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

    console.error("Engine 25 Historical Replay Macro + Distribution Merge Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
