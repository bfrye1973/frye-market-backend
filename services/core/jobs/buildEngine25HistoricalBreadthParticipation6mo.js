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

const ENGINE_NAME = "engine25.historicalBreadthParticipation.v0.2";
const MODEL_TYPE = "HISTORICAL_BREADTH_PARTICIPATION_PROXY_MDY_AI_V0_2";

const INDEX_SYMBOLS = ["SPY", "QQQ", "IWM", "MDY", "DIA"];

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

const CREDIT_SYMBOLS = ["HYG", "JNK", "LQD", "KRE"];

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

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
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

  // Normal blocks store symbols directly:
  // proxyScores.marketTrend.inputs.SPY
  // proxyScores.creditFragility.inputs.HYG
  if (inputs?.[symbol]) return inputs[symbol];

  // AI leadership stores symbols nested:
  // proxyScores.aiLeadership.inputs.symbols.NVDA
  if (inputs?.symbols?.[symbol]) return inputs.symbols[symbol];

  // Future-safe fallback.
  if (inputs?.symbolScores?.[symbol]?.details) return inputs.symbolScores[symbol].details;

  return null;
}

function scoreDirect(value, badBelow, goodAbove) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  if (n >= goodAbove) return 100;
  if (n <= badBelow) return 0;
  return clamp(((n - badBelow) / (goodAbove - badBelow)) * 100);
}

function scoreInverse(value, goodBelow, badAbove) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  if (n <= goodBelow) return 100;
  if (n >= badAbove) return 0;
  return clamp(100 - ((n - goodBelow) / (badAbove - goodBelow)) * 100);
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
      aboveEma10: null,
      aboveEma20: null,
      aboveEma50: null,
      aboveEma200: null,
      details: {
        missing: true,
      },
      warnings: [],
    };
  }

  const aboveEma10 = item.aboveEma10;
  const aboveEma20 = item.aboveEma20;
  const aboveEma50 = item.aboveEma50;
  const aboveEma200 = item.aboveEma200;

  const pctChange5d = safeNumber(item.pctChange5d);
  const pctChange20d = safeNumber(item.pctChange20d);
  const pctChange50d = safeNumber(item.pctChange50d);

  const closeLocationPct = safeNumber(item.closeLocationPct);
  const isHighVolumeDownDay = item.isHighVolumeDownDay === true;
  const distributionDay = item.distributionDay === true;
  const highVolumeWeakClose = item.highVolumeWeakClose === true;
  const failedBreakout = item.failedBreakout === true;

  const emaScore = weightedAvg([
    { value: boolScore(aboveEma10, 100, 0), weight: 0.18 },
    { value: boolScore(aboveEma20, 100, 0), weight: 0.42 },
    { value: boolScore(aboveEma50, 100, 0), weight: 0.3 },
    { value: boolScore(aboveEma200, 100, 0), weight: 0.1 },
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

  const damagePenalty = weightedAvg([
    { value: distributionDay ? 0 : 100, weight: 0.35 },
    { value: highVolumeWeakClose ? 0 : 100, weight: 0.25 },
    { value: failedBreakout ? 25 : 100, weight: 0.15 },
    {
      value: Number.isFinite(closeLocationPct)
        ? scoreDirect(closeLocationPct, 20, 65)
        : 50,
      weight: 0.25,
    },
  ]);

  const score = weightedAvg([
    { value: emaScore, weight: 0.58 },
    { value: momentumScore, weight: 0.27 },
    { value: damagePenalty, weight: 0.15 },
  ]);

  const warnings = [];

  if (aboveEma20 === false) {
    warnings.push(`${item.symbol} below EMA20`);
  }

  if (aboveEma20 === false && aboveEma50 === false) {
    warnings.push(`${item.symbol} below EMA20/EMA50`);
  }

  if (distributionDay) {
    warnings.push(`${item.symbol} distribution day reduces participation quality`);
  }

  if (highVolumeWeakClose) {
    warnings.push(`${item.symbol} high-volume weak close`);
  }

  if (failedBreakout) {
    warnings.push(`${item.symbol} failed breakout`);
  }

  return {
    score,
    aboveEma10,
    aboveEma20,
    aboveEma50,
    aboveEma200,
    details: {
      symbol: item.symbol,
      date: item.date,
      close: item.close,
      volume: safeNumber(item.volume),
      avgVolume20: safeNumber(item.avgVolume20),
      closeLocationPct,
      isHighVolumeDownDay,
      distributionDay,
      highVolumeWeakClose,
      failedBreakout,
      aboveEma10,
      aboveEma20,
      aboveEma50,
      aboveEma200,
      pctChange5d,
      pctChange20d,
      pctChange50d,
      emaScore,
      momentumScore,
      damagePenalty,
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
  const mdyScore = symbolScores.MDY?.score ?? 50;
  const diaScore = symbolScores.DIA?.score ?? 50;

  const broadIndexScore = weightedAvg([
    { value: spyScore, weight: 0.3 },
    { value: qqqScore, weight: 0.3 },
    { value: iwmScore, weight: 0.15 },
    { value: mdyScore, weight: 0.15 },
    { value: diaScore, weight: 0.1 },
  ]);

  const smallCapParticipation =
    iwmScore >= Math.min(spyScore, qqqScore) - 10 ? 75 : 35;

  const midCapParticipation =
    mdyScore >= Math.min(spyScore, qqqScore) - 10 ? 75 : 35;

  const indexAbove20Count = ["SPY", "QQQ", "IWM", "MDY"].filter(
    (symbol) => symbolScores[symbol]?.aboveEma20 === true
  ).length;

  const indexAbove50Count = ["SPY", "QQQ", "IWM", "MDY"].filter(
    (symbol) => symbolScores[symbol]?.aboveEma50 === true
  ).length;

  const indexBreadthPct = round((indexAbove20Count / 4) * 100, 2);

  if (iwmScore < spyScore - 15 || iwmScore < qqqScore - 15) {
    warnings.push("IWM lagging SPY/QQQ; small-cap participation weak");
  }

  if (mdyScore < spyScore - 15 || mdyScore < qqqScore - 15) {
    warnings.push("MDY lagging SPY/QQQ; mid-cap participation weak");
  }

  if (indexAbove20Count <= 2) {
    warnings.push("Less than 3 of SPY/QQQ/IWM/MDY above EMA20");
  }

  return {
    score: weightedAvg([
      { value: broadIndexScore, weight: 0.62 },
      { value: smallCapParticipation, weight: 0.19 },
      { value: midCapParticipation, weight: 0.19 },
    ]),
    label:
      broadIndexScore >= 70 && indexAbove20Count >= 3
        ? "INDEX_PARTICIPATION_STRONG"
        : broadIndexScore >= 50
          ? "INDEX_PARTICIPATION_MIXED"
          : "INDEX_PARTICIPATION_WEAK",
    inputs: {
      symbolScores,
      spyScore,
      qqqScore,
      iwmScore,
      mdyScore,
      diaScore,
      broadIndexScore,
      smallCapParticipation,
      midCapParticipation,
      indexAbove20Count,
      indexAbove50Count,
      indexBreadthPct,
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

  const sectorBreadthScore =
    validCount > 0
      ? weightedAvg([
          { value: above20Pct, weight: 0.4 },
          { value: above50Pct, weight: 0.3 },
          { value: riskOnScore, weight: 0.2 },
          { value: clamp(50 + (riskOnScore - defensiveScore)), weight: 0.1 },
        ])
      : 50;

  if (validCount === 0) {
    warnings.push("Historical sector-card breadth unavailable; sector participation held neutral.");
  } else if (above20Count <= Math.floor(validCount / 2)) {
    warnings.push("Less than half of tracked sectors are above EMA20");
  }

  if (validCount > 0 && riskOnScore < defensiveScore - 5) {
    warnings.push("Defensive sectors leading risk-on sectors");
  }

  return {
    score: sectorBreadthScore,
    label:
      validCount === 0
        ? "SECTOR_PARTICIPATION_UNAVAILABLE"
        : sectorBreadthScore >= 70
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
      historicalSectorBreadthAvailable: validCount > 0,
    },
    warnings: [...new Set(warnings)],
  };
}

function scoreAiParticipation(row) {
  const aiInputs = getProxyInputs(row, "aiLeadership");
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

  let validCount = safeNumber(aiInputs.validCount);
  let above10Count = safeNumber(aiInputs.aiAboveEma10Count);
  let above20Count = safeNumber(aiInputs.aiAboveEma20Count);
  let above50Count = safeNumber(aiInputs.aiAboveEma50Count);
  let above200Count = safeNumber(aiInputs.aiAboveEma200Count);
  let aiBreadthPct = safeNumber(aiInputs.aiBreadthPct);
  let highVolumeDownDayCount = safeNumber(aiInputs.aiHighVolumeDownDayCount);
  let weakCloseCount = safeNumber(aiInputs.aiWeakCloseCount);
  let failedBreakoutCount = safeNumber(aiInputs.aiFailedBreakoutCount);
  const aiConcentrationRisk = aiInputs.aiConcentrationRisk === true;

  if (!Number.isFinite(validCount)) validCount = valid.length;
  if (!Number.isFinite(above10Count)) {
    above10Count = valid.filter((read) => read.aboveEma10 === true).length;
  }
  if (!Number.isFinite(above20Count)) {
    above20Count = valid.filter((read) => read.aboveEma20 === true).length;
  }
  if (!Number.isFinite(above50Count)) {
    above50Count = valid.filter((read) => read.aboveEma50 === true).length;
  }
  if (!Number.isFinite(above200Count)) {
    above200Count = valid.filter((read) => read.aboveEma200 === true).length;
  }
  if (!Number.isFinite(aiBreadthPct) && validCount > 0) {
    aiBreadthPct = round((above20Count / validCount) * 100, 2);
  }
  if (!Number.isFinite(highVolumeDownDayCount)) {
    highVolumeDownDayCount = AI_SYMBOLS.filter(
      (symbol) => symbolScores[symbol]?.details?.isHighVolumeDownDay === true
    ).length;
  }
  if (!Number.isFinite(weakCloseCount)) {
    weakCloseCount = AI_SYMBOLS.filter((symbol) => {
      const closeLocationPct = symbolScores[symbol]?.details?.closeLocationPct;
      return Number.isFinite(closeLocationPct) && closeLocationPct < 35;
    }).length;
  }
  if (!Number.isFinite(failedBreakoutCount)) {
    failedBreakoutCount = AI_SYMBOLS.filter(
      (symbol) => symbolScores[symbol]?.details?.failedBreakout === true
    ).length;
  }

  const above50Pct =
    validCount > 0 && Number.isFinite(above50Count)
      ? round((above50Count / validCount) * 100, 2)
      : null;

  const above200Pct =
    validCount > 0 && Number.isFinite(above200Count)
      ? round((above200Count / validCount) * 100, 2)
      : null;

  const avgAiScore = avg(Object.values(symbolScores).map((read) => read.score));

  const distributionQualityPenalty = clamp(
    highVolumeDownDayCount * 8 + weakCloseCount * 5 + failedBreakoutCount * 7
  );

  const concentrationPenalty = aiConcentrationRisk ? 18 : 0;

  const score = clamp(
    weightedAvg([
      { value: avgAiScore, weight: 0.45 },
      { value: aiBreadthPct, weight: 0.3 },
      { value: above50Pct, weight: 0.15 },
      { value: above200Pct, weight: 0.1 },
    ]) -
      distributionQualityPenalty * 0.25 -
      concentrationPenalty
  );

  if (validCount === 0) {
    warnings.push("AI leadership basket unavailable.");
  }

  if (above20Count <= 5) {
    warnings.push("AI leadership breadth is narrow");
  }

  if (aiConcentrationRisk) {
    warnings.push("AI leadership concentration risk");
  }

  if (highVolumeDownDayCount >= 3) {
    warnings.push("AI leaders showing high-volume down-day pressure");
  }

  if (weakCloseCount >= 4) {
    warnings.push("AI leaders showing weak close pressure");
  }

  if (symbolScores.NVDA?.aboveEma20 === false) {
    warnings.push("NVDA below EMA20; AI leadership confirmation weak");
  }

  return {
    score,
    label:
      score >= 70 && above20Count >= 7
        ? "AI_PARTICIPATION_BROAD"
        : score >= 55 && above20Count >= 5
          ? "AI_PARTICIPATION_SUPPORTIVE_BUT_SELECTIVE"
          : score >= 40
            ? "AI_PARTICIPATION_MIXED_OR_NARROW"
            : "AI_PARTICIPATION_WEAK",
    inputs: {
      symbolScores,
      validCount,
      above10Count,
      above20Count,
      above50Count,
      above200Count,
      aiBreadthPct,
      above50Pct,
      above200Pct,
      highVolumeDownDayCount,
      weakCloseCount,
      failedBreakoutCount,
      aiConcentrationRisk,
      distributionQualityPenalty,
      avgAiScore,
    },
    warnings: [...new Set(warnings)],
  };
}

function scoreCreditParticipation(row) {
  const symbolScores = {};
  const warnings = [];

  for (const symbol of CREDIT_SYMBOLS) {
    const item = getSymbol(row, "creditFragility", symbol);
    const read = symbolBreadthScore(item, "credit");

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

  const sectorWeight = sectorParticipation.inputs?.historicalSectorBreadthAvailable ? 0.18 : 0.05;

  const score = weightedAvg([
    { value: indexParticipation.score, weight: 0.34 },
    { value: aiParticipation.score, weight: 0.31 },
    { value: creditParticipation.score, weight: 0.22 },
    { value: sectorParticipation.score, weight: sectorWeight },
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
        ? "Breadth participation is strong. Market support is broad across indexes, AI leadership, credit, and available sector proxies."
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
    warnings: [...new Set(warnings)].slice(0, 30),
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
      "v0.2 uses historical proxy scores, MDY mid-cap participation, AI basket breadth, and credit ETF participation.",
      "This is not full SPY/QQQ member-level breadth yet.",
      "Historical sector-card breadth is only used if sectorRotation symbols are present in the proxy file; otherwise the sector component is held neutral with low weight.",
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
    console.log("Proxy + MDY + AI Basket v0.2");
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
