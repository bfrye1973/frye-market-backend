// services/core/jobs/buildEngine25HistoricalBreadthParticipation6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const PROXY_FILE = path.join(
  DATA_DIR,
  "engine25-es-replay-proxy-scores-6mo.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-breadth-participation-6mo.json"
);

const ENGINE_NAME = "engine25.historicalBreadthParticipation.v0.1";
const MODEL_TYPE = "HISTORICAL_BREADTH_PARTICIPATION_PROXY_V0_1";

const INDEX_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA"];

const RISK_ON_SECTORS = ["XLK", "XLY", "XLF", "XLI", "SMH", "IGV"];
const DEFENSIVE_SECTORS = ["XLP", "XLU", "XLV"];
const ALL_SECTORS = [
  "XLK",
  "XLY",
  "XLF",
  "XLI",
  "XLE",
  "XLV",
  "XLP",
  "XLU",
  "XLRE",
  "XLB",
  "SMH",
  "IGV",
];

const AI_SYMBOLS = [
  "NVDA",
  "MSFT",
  "AVGO",
  "AMD",
  "META",
  "GOOGL",
  "AMZN",
  "TSM",
  "ARM",
  "PLTR",
];

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

function normalizeRows(block) {
  if (Array.isArray(block)) return block;
  if (Array.isArray(block?.rows)) return block.rows;
  throw new Error("Proxy file does not contain rows.");
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

function avg(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return 50;
  return clamp(nums.reduce((sum, value) => sum + value, 0) / nums.length);
}

function getProxyInputs(row, blockName) {
  return row?.proxyScores?.[blockName]?.inputs || {};
}

function getSymbol(row, blockName, symbol) {
  const inputs = getProxyInputs(row, blockName);
  return inputs?.[symbol] || null;
}

function scoreDirect(value, badBelow, goodAbove) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  if (n >= goodAbove) return 100;
  if (n <= badBelow) return 0;
  return clamp(((n - badBelow) / (goodAbove - badBelow)) * 100);
}

function boolScore(value, trueScore = 100, falseScore = 0, unknownScore = 50) {
  if (value === true) return trueScore;
  if (value === false) return falseScore;
  return unknownScore;
}

function symbolBreadthScore(item, type = "equity") {
  if (!item?.ok) {
    return {
      score: 50,
      aboveEma20: null,
      aboveEma50: null,
      details: {
        missing: true,
      },
      warnings: [],
    };
  }

  const aboveEma10 = item.aboveEma10;
  const aboveEma20 = item.aboveEma20;
  const aboveEma50 = item.aboveEma50;

  const pctChange5d = safeNumber(item.pctChange5d);
  const pctChange20d = safeNumber(item.pctChange20d);
  const pctChange50d = safeNumber(item.pctChange50d);

  const emaScore = weightedAvg([
    { value: boolScore(aboveEma10, 100, 0), weight: 0.2 },
    { value: boolScore(aboveEma20, 100, 0), weight: 0.45 },
    { value: boolScore(aboveEma50, 100, 0), weight: 0.35 },
  ]);

  const momentumScore =
    type === "credit"
      ? weightedAvg([
          { value: scoreDirect(pctChange5d, -1.5, 0.5), weight: 0.35 },
          { value: scoreDirect(pctChange20d, -3, 1.5), weight: 0.45 },
          { value: scoreDirect(pctChange50d, -5, 3), weight: 0.2 },
        ])
      : weightedAvg([
          { value: scoreDirect(pctChange5d, -3, 2), weight: 0.35 },
          { value: scoreDirect(pctChange20d, -6, 5), weight: 0.45 },
          { value: scoreDirect(pctChange50d, -10, 8), weight: 0.2 },
        ]);

  const score = weightedAvg([
    { value: emaScore, weight: 0.65 },
    { value: momentumScore, weight: 0.35 },
  ]);

  const warnings = [];

  if (aboveEma20 === false) {
    warnings.push(`${item.symbol} below EMA20`);
  }

  if (aboveEma20 === false && aboveEma50 === false) {
    warnings.push(`${item.symbol} below EMA20/EMA50`);
  }

  return {
    score,
    aboveEma20,
    aboveEma50,
    details: {
      symbol: item.symbol,
      date: item.date,
      close: item.close,
      aboveEma10,
      aboveEma20,
      aboveEma50,
      pctChange5d,
      pctChange20d,
      pctChange50d,
      emaScore,
      momentumScore,
    },
    warnings,
  };
}

function scoreIndexParticipation(row) {
  const symbolScores = {};
  const warnings = [];

  for (const symbol of INDEX_SYMBOLS) {
    const item = getSymbol(row, "marketTrend", symbol);
    const read = symbolBreadthScore(item, "equity");

    symbolScores[symbol] = read;
    warnings.push(...read.warnings);
  }

  const spyScore = symbolScores.SPY?.score ?? 50;
  const qqqScore = symbolScores.QQQ?.score ?? 50;
  const iwmScore = symbolScores.IWM?.score ?? 50;
  const diaScore = symbolScores.DIA?.score ?? 50;

  const broadIndexScore = weightedAvg([
    { value: spyScore, weight: 0.3 },
    { value: qqqScore, weight: 0.3 },
    { value: iwmScore, weight: 0.25 },
    { value: diaScore, weight: 0.15 },
  ]);

  const smallCapParticipation =
    iwmScore >= Math.min(spyScore, qqqScore) - 10 ? 70 : 35;

  if (iwmScore < spyScore - 15 || iwmScore < qqqScore - 15) {
    warnings.push("IWM lagging SPY/QQQ; broad participation weak");
  }

  return {
    score: weightedAvg([
      { value: broadIndexScore, weight: 0.75 },
      { value: smallCapParticipation, weight: 0.25 },
    ]),
    label:
      broadIndexScore >= 70
        ? "INDEX_PARTICIPATION_STRONG"
        : broadIndexScore >= 50
          ? "INDEX_PARTICIPATION_MIXED"
          : "INDEX_PARTICIPATION_WEAK",
    inputs: {
      symbolScores,
      spyScore,
      qqqScore,
      iwmScore,
      diaScore,
      broadIndexScore,
      smallCapParticipation,
    },
    warnings: [...new Set(warnings)],
  };
}

function scoreSectorParticipation(row) {
  const sectorInputs = getProxyInputs(row, "sectorRotation");
  const symbolScores = {};
  const warnings = [];

  for (const symbol of ALL_SECTORS) {
    const read = symbolBreadthScore(sectorInputs?.[symbol], "equity");
    symbolScores[symbol] = read;
    warnings.push(...read.warnings);
  }

  const valid = Object.values(symbolScores).filter(
    (read) => read?.details && !read.details.missing
  );

  const above20Count = valid.filter((read) => read.aboveEma20 === true).length;
  const above50Count = valid.filter((read) => read.aboveEma50 === true).length;
  const validCount = valid.length;

  const above20Pct = validCount > 0 ? (above20Count / validCount) * 100 : null;
  const above50Pct = validCount > 0 ? (above50Count / validCount) * 100 : null;

  const riskOnScore = avg(
    RISK_ON_SECTORS.map((symbol) => symbolScores[symbol]?.score)
  );

  const defensiveScore = avg(
    DEFENSIVE_SECTORS.map((symbol) => symbolScores[symbol]?.score)
  );

  const sectorBreadthScore = weightedAvg([
    { value: above20Pct, weight: 0.4 },
    { value: above50Pct, weight: 0.3 },
    { value: riskOnScore, weight: 0.2 },
    { value: clamp(50 + (riskOnScore - defensiveScore)), weight: 0.1 },
  ]);

  if (validCount > 0 && above20Count <= Math.floor(validCount / 2)) {
    warnings.push("Less than half of tracked sectors are above EMA20");
  }

  if (riskOnScore < defensiveScore - 5) {
    warnings.push("Defensive sectors leading risk-on sectors");
  }

  return {
    score: sectorBreadthScore,
    label:
      sectorBreadthScore >= 70
        ? "SECTOR_PARTICIPATION_STRONG"
        : sectorBreadthScore >= 50
          ? "SECTOR_PARTICIPATION_MIXED"
          : "SECTOR_PARTICIPATION_WEAK",
    inputs: {
      symbolScores,
      validCount,
      above20Count,
      above50Count,
      above20Pct: above20Pct === null ? null : Number(above20Pct.toFixed(2)),
      above50Pct: above50Pct === null ? null : Number(above50Pct.toFixed(2)),
      riskOnScore,
      defensiveScore,
    },
    warnings: [...new Set(warnings)],
  };
}

function scoreAiParticipation(row) {
  const symbolScores = {};
  const warnings = [];

  for (const symbol of AI_SYMBOLS) {
    const item = getSymbol(row, "aiLeadership", symbol);
    const read = symbolBreadthScore(item, "equity");

    symbolScores[symbol] = read;
    warnings.push(...read.warnings);
  }

  const valid = Object.values(symbolScores).filter(
    (read) => read?.details && !read.details.missing
  );

  const validCount = valid.length;
  const above20Count = valid.filter((read) => read.aboveEma20 === true).length;
  const above50Count = valid.filter((read) => read.aboveEma50 === true).length;

  const above20Pct = validCount > 0 ? (above20Count / validCount) * 100 : null;
  const above50Pct = validCount > 0 ? (above50Count / validCount) * 100 : null;

  const avgAiScore = avg(Object.values(symbolScores).map((read) => read.score));

  const score = weightedAvg([
    { value: avgAiScore, weight: 0.55 },
    { value: above20Pct, weight: 0.3 },
    { value: above50Pct, weight: 0.15 },
  ]);

  if (above20Count <= 5) {
    warnings.push("AI leadership breadth is narrow");
  }

  if (symbolScores.NVDA?.aboveEma20 === false) {
    warnings.push("NVDA below EMA20; AI leadership confirmation weak");
  }

  return {
    score,
    label:
      score >= 70
        ? "AI_PARTICIPATION_STRONG"
        : score >= 50
          ? "AI_PARTICIPATION_MIXED"
          : "AI_PARTICIPATION_WEAK",
    inputs: {
      symbolScores,
      validCount,
      above20Count,
      above50Count,
      above20Pct: above20Pct === null ? null : Number(above20Pct.toFixed(2)),
      above50Pct: above50Pct === null ? null : Number(above50Pct.toFixed(2)),
      avgAiScore,
    },
    warnings: [...new Set(warnings)],
  };
}

function scoreCreditParticipation(row) {
  const creditInputs = getProxyInputs(row, "creditFragility");
  const symbolScores = {};
  const warnings = [];

  const symbols = ["HYG", "JNK", "LQD", "KRE"];

  for (const symbol of symbols) {
    const read = symbolBreadthScore(creditInputs?.[symbol], "credit");
    symbolScores[symbol] = read;
    warnings.push(...read.warnings);
  }

  const score = weightedAvg([
    { value: symbolScores.HYG?.score, weight: 0.3 },
    { value: symbolScores.JNK?.score, weight: 0.3 },
    { value: symbolScores.LQD?.score, weight: 0.2 },
    { value: symbolScores.KRE?.score, weight: 0.2 },
  ]);

  if (symbolScores.HYG?.aboveEma20 === false && symbolScores.JNK?.aboveEma20 === false) {
    warnings.push("High-yield/junk credit participation weak");
  }

  return {
    score,
    label:
      score >= 70
        ? "CREDIT_PARTICIPATION_STRONG"
        : score >= 50
          ? "CREDIT_PARTICIPATION_MIXED"
          : "CREDIT_PARTICIPATION_WEAK",
    inputs: symbolScores,
    warnings: [...new Set(warnings)],
  };
}

function buildBreadthParticipation(row) {
  const indexParticipation = scoreIndexParticipation(row);
  const sectorParticipation = scoreSectorParticipation(row);
  const aiParticipation = scoreAiParticipation(row);
  const creditParticipation = scoreCreditParticipation(row);

  const score = weightedAvg([
    { value: indexParticipation.score, weight: 0.3 },
    { value: sectorParticipation.score, weight: 0.25 },
    { value: aiParticipation.score, weight: 0.25 },
    { value: creditParticipation.score, weight: 0.2 },
  ]);

  const warnings = [
    ...indexParticipation.warnings,
    ...sectorParticipation.warnings,
    ...aiParticipation.warnings,
    ...creditParticipation.warnings,
  ];

  return {
    score,
    label:
      score >= 70
        ? "BREADTH_PARTICIPATION_STRONG"
        : score >= 55
          ? "BREADTH_PARTICIPATION_IMPROVING"
          : score >= 40
            ? "BREADTH_PARTICIPATION_MIXED"
            : "BREADTH_PARTICIPATION_WEAK",
    interpretation:
      score >= 70
        ? "Breadth participation is strong. Market support is broad across indexes, sectors, leaders, and credit."
        : score >= 55
          ? "Breadth participation is improving. Long setups can improve if price confirms reclaim."
          : score >= 40
            ? "Breadth participation is mixed. Stay selective and require confirmation."
            : "Breadth participation is weak. Market support is narrow and long setups need A+ quality only.",
    components: {
      indexParticipation,
      sectorParticipation,
      aiParticipation,
      creditParticipation,
    },
    warnings: [...new Set(warnings)].slice(0, 25),
  };
}

function buildSummary(rows) {
  const byLabel = rows.reduce((acc, row) => {
    const label = row.breadthParticipation?.label || "UNKNOWN";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const nums = rows
    .map((row) => safeNumber(row.breadthParticipation?.score))
    .filter(Number.isFinite);

  const avgBreadthParticipationScore =
    nums.length > 0
      ? Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(3))
      : null;

  return {
    rows: rows.length,
    avgBreadthParticipationScore,
    byLabel,
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
      proxyFile: "engine25-es-replay-proxy-scores-6mo.json",
      outputFile: "engine25-historical-breadth-participation-6mo.json",
    },
    limitations: [
      "v0.1 uses historical proxy scores and ETF trend/momentum data.",
      "This is not full SPY/QQQ member-level breadth yet.",
      "Higher breadthParticipation score means broader market support.",
      "This job does not change live Engine 25 or frontend behavior.",
    ],
    summary: null,
    rows: [],
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25 Historical Breadth Participation");
    console.log("Proxy-based v0.1");
    console.log("========================================");

    const proxy = readJsonFile(PROXY_FILE);
    const proxyRows = normalizeRows(proxy);

    console.log("Proxy rows loaded:", proxyRows.length);

    const rows = proxyRows.map((row) => {
      const breadthParticipation = buildBreadthParticipation(row);

      return {
        date: row.date,
        time: row.time,
        symbol: "ES",
        timeframe: "1d",
        esOpen: row.esOpen,
        esHigh: row.esHigh,
        esLow: row.esLow,
        esClose: row.esClose,
        next1dReturnPct: row.next1dReturnPct,
        next3dReturnPct: row.next3dReturnPct,
        next5dReturnPct: row.next5dReturnPct,
        maxDrawdownNext5dPct: row.maxDrawdownNext5dPct,
        maxRunupNext5dPct: row.maxRunupNext5dPct,
        outcome5d: row.outcome5d,
        breadthParticipation,
      };
    });

    output.rows = rows;
    output.summary = buildSummary(rows);
    output.ok = rows.length > 0;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Historical Breadth Participation Complete");
    console.log("OK:", output.ok);
    console.log("Rows:", output.summary.rows);
    console.log("Avg score:", output.summary.avgBreadthParticipationScore);
    console.log("By label:", output.summary.byLabel);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          modelType: output.modelType,
          summary: {
            rows: output.summary.rows,
            avgBreadthParticipationScore:
              output.summary.avgBreadthParticipationScore,
            byLabel: output.summary.byLabel,
          },
          firstRow: output.summary.firstRow
            ? {
                date: output.summary.firstRow.date,
                score: output.summary.firstRow.breadthParticipation.score,
                label: output.summary.firstRow.breadthParticipation.label,
                interpretation:
                  output.summary.firstRow.breadthParticipation.interpretation,
                warnings: output.summary.firstRow.breadthParticipation.warnings,
              }
            : null,
          lastRow: output.summary.lastRow
            ? {
                date: output.summary.lastRow.date,
                score: output.summary.lastRow.breadthParticipation.score,
                label: output.summary.lastRow.breadthParticipation.label,
                interpretation:
                  output.summary.lastRow.breadthParticipation.interpretation,
                warnings: output.summary.lastRow.breadthParticipation.warnings,
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

    console.error("Engine 25 Historical Breadth Participation Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
