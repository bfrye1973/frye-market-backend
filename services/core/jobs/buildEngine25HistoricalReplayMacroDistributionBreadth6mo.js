// services/core/jobs/buildEngine25HistoricalReplayMacroDistributionBreadth6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const MACRO_DISTRIBUTION_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-macro-distribution-6mo.json"
);

const BREADTH_FILE = path.join(
  DATA_DIR,
  "engine25-historical-breadth-participation-6mo.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-macro-distribution-breadth-6mo.json"
);

const ENGINE_NAME = "engine25.historicalReplayMacroDistributionBreadth.v0.1";
const MODEL_TYPE = "POLYGON_PROXY_PLUS_MACRO_PLUS_DISTRIBUTION_PLUS_BREADTH";

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

function indexRowsByDate(rows) {
  const map = new Map();
  const duplicates = [];

  for (const row of rows) {
    const date = row?.date;
    if (!date) continue;

    if (map.has(date)) duplicates.push(date);
    map.set(date, row);
  }

  return { map, duplicates };
}

function deriveFinalPermission(row, breadthParticipation) {
  const distributionPermission =
    row.historicalEsPermissionMacroDistributionAware ||
    row.historicalEsPermissionMacroAware ||
    "UNKNOWN";

  const distributionSize =
    safeNumber(row.macroDistributionAwareSizeMultiplier) ??
    safeNumber(row.macroAwareSizeMultiplier) ??
    0.5;

  const distributionLabel =
    row.distributionPressure?.label || "DISTRIBUTION_PRESSURE_UNKNOWN";

  const breadthScore = safeNumber(breadthParticipation?.score) ?? 50;
  const breadthLabel =
    breadthParticipation?.label || "BREADTH_PARTICIPATION_UNKNOWN";

  let permission = distributionPermission;
  let sizeMultiplier = distributionSize;
  const notes = [];

  if (breadthLabel === "BREADTH_PARTICIPATION_WEAK" || breadthScore < 40) {
    permission = "A_PLUS_ONLY_WEAK_BREADTH";
    sizeMultiplier = Math.min(distributionSize, 0.5);
    notes.push("Breadth participation is weak. ES longs require A+ reclaim/confirmation only.");
  } else if (breadthLabel === "BREADTH_PARTICIPATION_MIXED" || breadthScore < 55) {
    if (distributionLabel === "DISTRIBUTION_PRESSURE_FRAGILE_UNDER_SURFACE") {
      permission = "A_PLUS_ONLY_FRAGILE_BREADTH_MIXED";
      sizeMultiplier = Math.min(distributionSize, 0.5);
      notes.push("Breadth is mixed and distribution is fragile underneath. Stay selective.");
    } else {
      permission = distributionPermission;
      sizeMultiplier = Math.min(distributionSize, 0.75);
      notes.push("Breadth is mixed. Longs need confirmation.");
    }
  } else if (breadthLabel === "BREADTH_PARTICIPATION_IMPROVING") {
    if (
      distributionLabel === "DISTRIBUTION_PRESSURE_LOW" ||
      distributionLabel === "DISTRIBUTION_PRESSURE_NORMAL"
    ) {
      permission = "SELECTIVE_LONGS_BREADTH_IMPROVING";
      sizeMultiplier = Math.min(Math.max(distributionSize, 0.65), 0.75);
      notes.push("Breadth is improving. ES long quality improves on reclaim confirmation.");
    } else {
      permission = "A_PLUS_LONGS_BREADTH_IMPROVING_BUT_DISTRIBUTION_RISK";
      sizeMultiplier = Math.min(distributionSize, 0.65);
      notes.push("Breadth is improving, but distribution pressure still requires selectivity.");
    }
  } else if (breadthLabel === "BREADTH_PARTICIPATION_STRONG") {
    if (
      distributionLabel === "DISTRIBUTION_PRESSURE_LOW" ||
      distributionLabel === "DISTRIBUTION_PRESSURE_NORMAL"
    ) {
      permission = "CONFIRMED_LONGS_ALLOWED_BREADTH_SUPPORTIVE";
      sizeMultiplier = Math.min(Math.max(distributionSize, 0.75), 1.0);
      notes.push("Breadth is strong and distribution pressure is not elevated.");
    } else {
      permission = "SELECTIVE_LONGS_STRONG_BREADTH_WITH_DISTRIBUTION_CAUTION";
      sizeMultiplier = Math.min(distributionSize, 0.75);
      notes.push("Breadth is strong, but distribution pressure still requires caution.");
    }
  }

  return {
    distributionPermission,
    finalPermission: permission,
    distributionSizeMultiplier: distributionSize,
    finalSizeMultiplier: sizeMultiplier,
    distributionLabel,
    breadthLabel,
    breadthScore,
    notes,
  };
}

function buildMergedRow(row, breadthRow) {
  const breadthParticipation = breadthRow?.breadthParticipation || null;
  const finalPermission = deriveFinalPermission(row, breadthParticipation);

  return {
    ...row,
    modelType: MODEL_TYPE,

    componentScores: {
      ...(row.componentScores || {}),
      distributionPressure: safeNumber(row.distributionPressure?.score),
      breadthParticipation: safeNumber(breadthParticipation?.score),
    },

    breadthParticipation: breadthParticipation
      ? {
          score: breadthParticipation.score,
          label: breadthParticipation.label,
          interpretation: breadthParticipation.interpretation,
          warnings: breadthParticipation.warnings || [],
          components: breadthParticipation.components || null,
        }
      : null,

    historicalEsPermissionMacroDistributionBreadthAware:
      finalPermission.finalPermission,

    macroDistributionBreadthAwareSizeMultiplier:
      finalPermission.finalSizeMultiplier,

    finalPermissionRead: finalPermission,

    warnings: [
      ...(Array.isArray(row.warnings) ? row.warnings : []),
      ...(Array.isArray(breadthParticipation?.warnings)
        ? breadthParticipation.warnings
        : []),
    ].filter(Boolean),
  };
}

function buildSummary(rows, missingBreadthDates) {
  const byBreadthLabel = rows.reduce((acc, row) => {
    const label = row.breadthParticipation?.label || "BREADTH_MISSING";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const byDistributionLabel = rows.reduce((acc, row) => {
    const label = row.distributionPressure?.label || "DISTRIBUTION_MISSING";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const byFinalPermission = rows.reduce((acc, row) => {
    const permission =
      row.historicalEsPermissionMacroDistributionBreadthAware || "UNKNOWN";
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

    avgBreadthParticipationScore: avgNumber(
      rows.map((row) => row.breadthParticipation?.score)
    ),

    byDistributionLabel,
    byBreadthLabel,
    byFinalPermission,

    missingBreadthDates,
    missingBreadthCount: missingBreadthDates.length,
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
      macroDistributionFile:
        "engine25-historical-replay-macro-distribution-6mo.json",
      breadthFile: "engine25-historical-breadth-participation-6mo.json",
      outputFile:
        "engine25-historical-replay-macro-distribution-breadth-6mo.json",
    },
    limitations: [
      "This v0.1 merge adds historical breadthParticipation into the macro + distribution replay.",
      "This does not overwrite prior replay files.",
      "Final permission is a first-pass replay permission and does not change live trading behavior.",
      "Full sector member-level breadth and raw volume distribution days are future upgrades.",
    ],
    summary: null,
    validation: null,
    rows: [],
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25 Historical Replay Macro + Distribution + Breadth Merge");
    console.log("========================================");

    console.log("\nReading macro + distribution replay:");
    console.log(MACRO_DISTRIBUTION_FILE);

    const macroDistribution = readJsonFile(MACRO_DISTRIBUTION_FILE);
    const macroDistributionRows = normalizeRows(
      macroDistribution,
      "Macro + distribution replay"
    );

    console.log("Macro + distribution rows:", macroDistributionRows.length);

    console.log("\nReading breadth participation:");
    console.log(BREADTH_FILE);

    const breadth = readJsonFile(BREADTH_FILE);
    const breadthRows = normalizeRows(breadth, "Breadth participation");

    console.log("Breadth rows:", breadthRows.length);

    const breadthIndex = indexRowsByDate(breadthRows);

    const missingBreadthDates = [];

    const rows = macroDistributionRows.map((row) => {
      const breadthRow = breadthIndex.map.get(row.date);

      if (!breadthRow) {
        missingBreadthDates.push(row.date);
      }

      return buildMergedRow(row, breadthRow);
    });

    output.rows = rows;
    output.summary = buildSummary(rows, missingBreadthDates);

    output.validation = {
      macroDistributionRows: macroDistributionRows.length,
      breadthRows: breadthRows.length,
      mergedRows: rows.length,
      missingBreadthCount: missingBreadthDates.length,
      missingBreadthDates,
      breadthDuplicateDates: breadthIndex.duplicates,
      ok:
        rows.length === macroDistributionRows.length &&
        missingBreadthDates.length === 0 &&
        breadthIndex.duplicates.length === 0,
      firstRow: rows[0] || null,
      lastRow: rows[rows.length - 1] || null,
    };

    output.ok = output.validation.ok;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Historical Replay Macro + Distribution + Breadth Merge Complete");
    console.log("OK:", output.ok);
    console.log("Rows:", output.summary.rows);
    console.log("Missing breadth rows:", output.summary.missingBreadthCount);
    console.log("Avg distribution pressure:", output.summary.avgDistributionPressureScore);
    console.log("Avg breadth participation:", output.summary.avgBreadthParticipationScore);
    console.log("By breadth label:", output.summary.byBreadthLabel);
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
            macroDistributionRows: output.validation.macroDistributionRows,
            breadthRows: output.validation.breadthRows,
            mergedRows: output.validation.mergedRows,
            missingBreadthCount: output.validation.missingBreadthCount,
            breadthDuplicateDates: output.validation.breadthDuplicateDates,
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
                breadthParticipation:
                  output.validation.firstRow.componentScores?.breadthParticipation,
                breadthLabel:
                  output.validation.firstRow.breadthParticipation?.label,
                oldPermission:
                  output.validation.firstRow
                    .historicalEsPermissionMacroDistributionAware,
                finalPermission:
                  output.validation.firstRow
                    .historicalEsPermissionMacroDistributionBreadthAware,
                finalSize:
                  output.validation.firstRow
                    .macroDistributionBreadthAwareSizeMultiplier,
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
                breadthParticipation:
                  output.validation.lastRow.componentScores?.breadthParticipation,
                breadthLabel:
                  output.validation.lastRow.breadthParticipation?.label,
                oldPermission:
                  output.validation.lastRow
                    .historicalEsPermissionMacroDistributionAware,
                finalPermission:
                  output.validation.lastRow
                    .historicalEsPermissionMacroDistributionBreadthAware,
                finalSize:
                  output.validation.lastRow
                    .macroDistributionBreadthAwareSizeMultiplier,
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

    console.error("Engine 25 Historical Replay Macro + Distribution + Breadth Merge Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
