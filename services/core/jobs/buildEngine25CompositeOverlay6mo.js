// services/core/jobs/buildEngine25CompositeOverlay6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const INPUT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-replay-macro-distribution-breadth-6mo.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-composite-overlay-6mo.json"
);

const ENGINE_NAME = "engine25.compositeOverlay.v0.1";
const MODEL_TYPE = "ENGINE25_COMPOSITE_MARKET_HEALTH_OVERLAY";

const WEIGHTS = {
  macroAwareScore: 0.35,
  breadthParticipation: 0.25,
  distributionSupport: 0.2,
  marketTrend: 0.1,
  creditFragility: 0.05,
  aiLeadership: 0.05,
};

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

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round(value, decimals = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(decimals));
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

function deriveOverlayState(score) {
  if (score >= 75) {
    return {
      state: "ENGINE25_RISK_ON",
      color: "green",
      label: "Risk-On",
      interpretation: "Engine 25 composite health is strong. ES long setups are favored when price confirms.",
    };
  }

  if (score >= 65) {
    return {
      state: "ENGINE25_CONSTRUCTIVE_SELECTIVE",
      color: "green",
      label: "Constructive",
      interpretation: "Engine 25 is constructive but still selective. Longs need clean setup quality.",
    };
  }

  if (score >= 55) {
    return {
      state: "ENGINE25_MIXED_A_PLUS_ONLY",
      color: "orange",
      label: "A+ Only",
      interpretation: "Engine 25 is mixed. ES longs require A+ confirmation and reduced size.",
    };
  }

  if (score >= 45) {
    return {
      state: "ENGINE25_DEFENSIVE_WARNING",
      color: "orange",
      label: "Defensive Warning",
      interpretation: "Engine 25 is warning. Avoid blind longs and wait for reclaim confirmation.",
    };
  }

  return {
    state: "ENGINE25_RISK_OFF",
    color: "red",
    label: "Risk-Off",
    interpretation: "Engine 25 is risk-off. ES long exposure should be avoided unless a separate A+ reversal confirms.",
  };
}

function getNestedDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : null;
}

function resolveEodDates(row) {
  const esSessionDate = getNestedDate(row?.date);

  const qqqDistributionDate = getNestedDate(
    row?.distributionPressure?.components?.indexDistribution?.inputs?.symbolScores?.QQQ?.details?.date
  );

  const spyDistributionDate = getNestedDate(
    row?.distributionPressure?.components?.indexDistribution?.inputs?.symbolScores?.SPY?.details?.date
  );

  const qqqBreadthDate = getNestedDate(
    row?.breadthParticipation?.components?.indexParticipation?.inputs?.symbolScores?.QQQ?.details?.date
  );

  const spyBreadthDate = getNestedDate(
    row?.breadthParticipation?.components?.indexParticipation?.inputs?.symbolScores?.SPY?.details?.date
  );

  const cashProxyDate =
    qqqDistributionDate ||
    spyDistributionDate ||
    qqqBreadthDate ||
    spyBreadthDate ||
    esSessionDate;

  const dateAlignment =
    cashProxyDate && esSessionDate && cashProxyDate !== esSessionDate
      ? "CASH_PROXY_EOD_DIFFERS_FROM_ES_SESSION"
      : "ES_SESSION_AND_CASH_PROXY_MATCH";

  return {
    esSessionDate,
    cashProxyDate,
    latestEodDate: cashProxyDate,
    dateAlignment,
  };
}

function buildOverlayRow(row) {
  const eodDates = resolveEodDates(row);
  const macroAwareScore = safeNumber(row.engine25HistoricalScoreMacroAware, 50);

  const distributionPressure = safeNumber(
    row.componentScores?.distributionPressure ??
      row.distributionPressure?.score,
    50
  );

  const distributionSupport = clamp(100 - distributionPressure);

  const breadthParticipation = safeNumber(
    row.componentScores?.breadthParticipation ??
      row.breadthParticipation?.score,
    50
  );

  const marketTrend = safeNumber(row.componentScores?.marketTrend, 50);
  const creditFragility = safeNumber(row.componentScores?.creditFragility, 50);
  const aiLeadership = safeNumber(row.componentScores?.aiLeadership, 50);

  const engine25CompositeScore = weightedAvg([
    { value: macroAwareScore, weight: WEIGHTS.macroAwareScore },
    { value: breadthParticipation, weight: WEIGHTS.breadthParticipation },
    { value: distributionSupport, weight: WEIGHTS.distributionSupport },
    { value: marketTrend, weight: WEIGHTS.marketTrend },
    { value: creditFragility, weight: WEIGHTS.creditFragility },
    { value: aiLeadership, weight: WEIGHTS.aiLeadership },
  ]);

  const overlay = deriveOverlayState(engine25CompositeScore);

  return {
    date: eodDates.latestEodDate,
    esSessionDate: eodDates.esSessionDate,
    cashProxyDate: eodDates.cashProxyDate,
    latestEodDate: eodDates.latestEodDate,
    dateAlignment: eodDates.dateAlignment,
    time: row.time,

    symbol: "ES",
    timeframe: "1d",

    esOpen: safeNumber(row.esOpen),
    esHigh: safeNumber(row.esHigh),
    esLow: safeNumber(row.esLow),
    esClose: safeNumber(row.esClose),

    engine25CompositeScore,
    overlayState: overlay.state,
    overlayColor: overlay.color,
    overlayLabel: overlay.label,
    overlayInterpretation: overlay.interpretation,

    components: {
      macroAwareScore,
      breadthParticipation,
      distributionPressure,
      distributionSupport,
      marketTrend,
      creditFragility,
      aiLeadership,
    },

    weights: WEIGHTS,

    permissions: {
      macroAware: row.historicalEsPermissionMacroAware || null,
      macroDistributionAware:
        row.historicalEsPermissionMacroDistributionAware || null,
      macroDistributionBreadthAware:
        row.historicalEsPermissionMacroDistributionBreadthAware || null,
      finalPermission:
        row.historicalEsPermissionMacroDistributionBreadthAware ||
        row.historicalEsPermissionMacroDistributionAware ||
        row.historicalEsPermissionMacroAware ||
        null,
      finalSize:
        safeNumber(row.macroDistributionBreadthAwareSizeMultiplier) ??
        safeNumber(row.macroDistributionAwareSizeMultiplier) ??
        safeNumber(row.macroAwareSizeMultiplier) ??
        null,
    },

    labels: {
      distribution:
        row.distributionPressure?.label || "DISTRIBUTION_PRESSURE_UNKNOWN",
      breadth:
        row.breadthParticipation?.label || "BREADTH_PARTICIPATION_UNKNOWN",
      regime:
        row.historicalRegimeMacroAware ||
        row.historicalRegime ||
        null,
    },

    forwardReturns: {
      next1dReturnPct: safeNumber(row.next1dReturnPct),
      next3dReturnPct: safeNumber(row.next3dReturnPct),
      next5dReturnPct: safeNumber(row.next5dReturnPct),
      maxDrawdownNext5dPct: safeNumber(row.maxDrawdownNext5dPct),
      maxRunupNext5dPct: safeNumber(row.maxRunupNext5dPct),
      outcome5d: row.outcome5d || null,
    },
  };
}

function buildSummary(rows) {
  const scores = rows
    .map((row) => safeNumber(row.engine25CompositeScore))
    .filter(Number.isFinite);

  const byState = rows.reduce((acc, row) => {
    const key = row.overlayState || "UNKNOWN";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const byColor = rows.reduce((acc, row) => {
    const key = row.overlayColor || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const closedRows = rows.filter((row) => row.forwardReturns?.outcome5d !== "PENDING");
  const workedRows = closedRows.filter((row) => row.forwardReturns?.outcome5d === "WORKED");
  const failedRows = closedRows.filter((row) => row.forwardReturns?.outcome5d === "FAILED");

  const byStateOutcome = {};

  for (const row of closedRows) {
    const state = row.overlayState || "UNKNOWN";
    const outcome = row.forwardReturns?.outcome5d || "UNKNOWN";

    if (!byStateOutcome[state]) {
      byStateOutcome[state] = {
        total: 0,
        worked: 0,
        failed: 0,
        winRatePct: null,
      };
    }

    byStateOutcome[state].total += 1;

    if (outcome === "WORKED") byStateOutcome[state].worked += 1;
    if (outcome === "FAILED") byStateOutcome[state].failed += 1;
  }

  for (const state of Object.keys(byStateOutcome)) {
    const item = byStateOutcome[state];

    item.winRatePct =
      item.total > 0 ? round((item.worked / item.total) * 100, 1) : null;
  }

  return {
    rows: rows.length,
    closedRows: closedRows.length,
    workedCount: workedRows.length,
    failedCount: failedRows.length,
    pendingCount: rows.length - closedRows.length,
    baseWinRatePct:
      closedRows.length > 0
        ? round((workedRows.length / closedRows.length) * 100, 1)
        : null,
    avgEngine25CompositeScore:
      scores.length > 0
        ? round(scores.reduce((sum, value) => sum + value, 0) / scores.length, 3)
        : null,
    minEngine25CompositeScore: scores.length ? Math.min(...scores) : null,
    maxEngine25CompositeScore: scores.length ? Math.max(...scores) : null,
    byState,
    byColor,
    byStateOutcome,
    firstRow: rows[0] || null,
    lastRow: rows[rows.length - 1] || null,
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
      inputFile:
        "engine25-historical-replay-macro-distribution-breadth-6mo.json",
      outputFile: "engine25-composite-overlay-6mo.json",
    },
    description:
      "One combined Engine 25 Market Health overlay line for comparing model strength against the ES 6-month futures chart.",
    weights: WEIGHTS,
    limitations: [
      "v0.1 uses first-pass weights for visual testing against ES candles.",
      "Distribution pressure is inverted into distributionSupport before combining.",
      "This overlay does not change live trading behavior.",
      "Weights are expected to be tuned after visual comparison with ES futures chart.",
    ],
    summary: null,
    rows: [],
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25 Composite Overlay 6mo");
    console.log("========================================");

    const input = readJsonFile(INPUT_FILE);
    const sourceRows = normalizeRows(input, "Macro + distribution + breadth replay");

    console.log("Input rows:", sourceRows.length);

    const rows = sourceRows.map(buildOverlayRow);

    output.rows = rows;
    output.summary = buildSummary(rows);
    output.ok = rows.length > 0;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Composite Overlay Complete");
    console.log("OK:", output.ok);
    console.log("Rows:", output.summary.rows);
    console.log("Avg composite:", output.summary.avgEngine25CompositeScore);
    console.log("By state:", output.summary.byState);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          modelType: output.modelType,
          summary: output.summary,
          firstRow: output.summary.firstRow
            ? {
                date: output.summary.firstRow.date,
                esClose: output.summary.firstRow.esClose,
                score: output.summary.firstRow.engine25CompositeScore,
                state: output.summary.firstRow.overlayState,
                color: output.summary.firstRow.overlayColor,
                components: output.summary.firstRow.components,
                permission: output.summary.firstRow.permissions.finalPermission,
              }
            : null,
          lastRow: output.summary.lastRow
            ? {
                date: output.summary.lastRow.date,
                esClose: output.summary.lastRow.esClose,
                score: output.summary.lastRow.engine25CompositeScore,
                state: output.summary.lastRow.overlayState,
                color: output.summary.lastRow.overlayColor,
                components: output.summary.lastRow.components,
                permission: output.summary.lastRow.permissions.finalPermission,
              }
            : null,
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );
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

    console.error("Engine 25 Composite Overlay Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
