// services/core/jobs/buildEngine25HistoricalDistributionPressure6mo.js

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

const ES_DAILY_TECHNICAL_FILE = path.join(
  DATA_DIR,
  "engine25-es-replay-daily-technical-6mo.json"
);

const OUTPUT_FILE = path.join(
  DATA_DIR,
  "engine25-historical-distribution-pressure-6mo.json"
);

const ENGINE_NAME = "engine25.historicalDistributionPressure.v0.4";
const MODEL_TYPE = "HISTORICAL_DISTRIBUTION_PRESSURE_PROXY_VOLUME_ES_VOLUME_V0_4";

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

const INDEX_SYMBOLS = ["SPY", "QQQ", "IWM", "MDY", "DIA"];
const CREDIT_SYMBOLS = ["HYG", "JNK", "LQD", "KRE"];
const RISK_ON_SECTORS = ["XLK", "XLY", "XLF", "XLI", "SMH", "IGV"];
const DEFENSIVE_SECTORS = ["XLP", "XLU", "XLV"];

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

function normalizeRows(block, label = "input") {
  if (Array.isArray(block)) return block;
  if (Array.isArray(block?.rows)) return block.rows;
  throw new Error(`${label} file does not contain rows.`);
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function avg(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return 50;
  return clamp(nums.reduce((sum, value) => sum + value, 0) / nums.length);
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

function boolPenalty(value, truePenalty = 20, falsePenalty = 0, unknownPenalty = 8) {
  if (value === true) return truePenalty;
  if (value === false) return falsePenalty;
  return unknownPenalty;
}

function scoreDirectPressure(value, calmAbove, pressureBelow) {
  const n = Number(value);

  if (!Number.isFinite(n)) return 50;
  if (n >= calmAbove) return 0;
  if (n <= pressureBelow) return 100;

  return clamp(((calmAbove - n) / (calmAbove - pressureBelow)) * 100);
}

function indexRowsByDate(rows) {
  const map = new Map();

  for (const row of rows || []) {
    if (row?.date) {
      map.set(row.date, row);
    }
  }

  return map;
}

function getProxyInputs(row, blockName) {
  return row?.proxyScores?.[blockName]?.inputs || {};
}

function getSymbol(row, blockName, symbol) {
  const inputs = getProxyInputs(row, blockName);

  if (inputs?.[symbol]) return inputs[symbol];

  if (inputs?.symbols?.[symbol]) return inputs.symbols[symbol];

  if (inputs?.symbolScores?.[symbol]?.details) {
    return inputs.symbolScores[symbol].details;
  }

  return null;
}

function getAiInputs(row) {
  return getProxyInputs(row, "aiLeadership");
}

function scoreSymbolDistribution(item, type = "equity") {
  if (!item?.ok) {
    return {
      score: 50,
      warnings: [],
      details: {
        symbol: null,
        missing: true,
      },
    };
  }

  const aboveEma10 = item.aboveEma10;
  const aboveEma20 = item.aboveEma20;
  const aboveEma50 = item.aboveEma50;

  const pctChange5d = safeNumber(item.pctChange5d);
  const pctChange20d = safeNumber(item.pctChange20d);
  const pctChange50d = safeNumber(item.pctChange50d);

  const volume = safeNumber(item.volume);
  const avgVolume20 = safeNumber(item.avgVolume20);
  const closeLocationPct = safeNumber(item.closeLocationPct);
  const weakClosePct = safeNumber(item.weakClosePct);
  const isHighVolumeDownDay = item.isHighVolumeDownDay === true;
  const highVolumeWeakClose = item.highVolumeWeakClose === true;
  const distributionDay = item.distributionDay === true;
  const failedBreakout = item.failedBreakout === true;

  const emaPressure = avg([
    boolPenalty(aboveEma10 === false, 22, 0),
    boolPenalty(aboveEma20 === false, 30, 0),
    boolPenalty(aboveEma50 === false, 35, 0),
  ]);

  const momentumPressure =
    type === "credit"
      ? weightedAvg([
          { value: scoreDirectPressure(pctChange5d, 0.25, -1.5), weight: 0.35 },
          { value: scoreDirectPressure(pctChange20d, 0.5, -3.0), weight: 0.45 },
          { value: scoreDirectPressure(pctChange50d, 1.0, -5.0), weight: 0.2 },
        ])
      : weightedAvg([
          { value: scoreDirectPressure(pctChange5d, 1.0, -3.0), weight: 0.35 },
          { value: scoreDirectPressure(pctChange20d, 2.0, -6.0), weight: 0.45 },
          { value: scoreDirectPressure(pctChange50d, 4.0, -10.0), weight: 0.2 },
        ]);

  const volumePressure = weightedAvg([
    { value: boolPenalty(isHighVolumeDownDay, 45, 0, 10), weight: 0.35 },
    { value: boolPenalty(highVolumeWeakClose, 65, 0, 10), weight: 0.35 },
    { value: boolPenalty(distributionDay, 55, 0, 10), weight: 0.2 },
    { value: boolPenalty(failedBreakout, 35, 0, 5), weight: 0.1 },
  ]);

  const weakClosePressure =
    Number.isFinite(closeLocationPct)
      ? scoreDirectPressure(closeLocationPct, 65, 20)
      : 50;

  const score = weightedAvg([
    { value: emaPressure, weight: 0.42 },
    { value: momentumPressure, weight: 0.28 },
    { value: volumePressure, weight: 0.2 },
    { value: weakClosePressure, weight: 0.1 },
  ]);

  const warnings = [];

  if (aboveEma20 === false && aboveEma50 === false) {
    warnings.push(`${item.symbol} below EMA20/EMA50`);
  } else if (aboveEma20 === false) {
    warnings.push(`${item.symbol} below EMA20`);
  }

  if (Number.isFinite(pctChange20d) && pctChange20d < -3) {
    warnings.push(`${item.symbol} 20d momentum negative`);
  }

  if (distributionDay) {
    warnings.push(`${item.symbol} distribution day`);
  }

  if (highVolumeWeakClose) {
    warnings.push(`${item.symbol} high-volume weak close`);
  }

  if (Number.isFinite(closeLocationPct) && closeLocationPct < 35) {
    warnings.push(`${item.symbol} weak close location`);
  }

  return {
    score,
    warnings,
    details: {
      symbol: item.symbol,
      date: item.date,
      close: item.close,
      volume,
      avgVolume20,
      closeLocationPct,
      weakClosePct,
      isHighVolumeDownDay,
      highVolumeWeakClose,
      distributionDay,
      failedBreakout,
      aboveEma10,
      aboveEma20,
      aboveEma50,
      pctChange5d,
      pctChange20d,
      pctChange50d,
      emaPressure,
      momentumPressure,
      volumePressure,
      weakClosePressure,
    },
  };
}

function scoreEsVolumeDistribution(row, esTechnicalRow) {
  const read =
    esTechnicalRow?.esVolumeDistribution ||
    esTechnicalRow?.daily?.esVolumeDistribution ||
    null;

  if (!read) {
    return {
      score: 50,
      label: "ES_VOLUME_DISTRIBUTION_UNKNOWN",
      inputs: {
        date: row.date,
        missing: true,
      },
      warnings: [],
    };
  }

  const state = read.state || "ES_VOLUME_UNKNOWN";
  const volumeVsAvg20Pct = safeNumber(read.volumeVsAvg20Pct);
  const closeLocationPct = safeNumber(read.closeLocationPct);

  let score = 15;

  if (read.volumeExpansionIntoSelloff === true) {
    score = 95;
  } else if (read.highVolumeWeakClose === true) {
    score = 88;
  } else if (read.isHighVolumeDownDay === true) {
    score = 72;
  } else if (read.weakClose === true) {
    score = 58;
  } else if (read.sellingPressureFading === true) {
    score = 25;
  } else if (read.volumeFadeNearSupport === true) {
    score = 30;
  }

  if (Number.isFinite(volumeVsAvg20Pct) && volumeVsAvg20Pct >= 50) {
    score = Math.max(score, 80);
  }

  if (Number.isFinite(closeLocationPct) && closeLocationPct <= 10) {
    score = Math.max(score, 70);
  }

  score = clamp(score);

  const warnings = [...(Array.isArray(read.warnings) ? read.warnings : [])];

  if (read.volumeExpansionIntoSelloff === true) {
    warnings.push("ES confirms volume expansion into selloff");
  }

  if (read.highVolumeWeakClose === true) {
    warnings.push("ES confirms high-volume weak close");
  }

  if (Number.isFinite(volumeVsAvg20Pct) && volumeVsAvg20Pct >= 50) {
    warnings.push(`ES volume ${volumeVsAvg20Pct}% above 20-day average`);
  }

  if (Number.isFinite(closeLocationPct) && closeLocationPct <= 10) {
    warnings.push("ES closed near the low of its daily range");
  }

  return {
    score,
    label:
      score >= 85
        ? "ES_VOLUME_DISTRIBUTION_HIGH"
        : score >= 65
          ? "ES_VOLUME_DISTRIBUTION_ELEVATED"
          : score >= 45
            ? "ES_VOLUME_DISTRIBUTION_WATCH"
            : "ES_VOLUME_DISTRIBUTION_LOW",
    inputs: {
      date: row.date,
      esTechnicalDate: esTechnicalRow?.date || null,
      esClose: esTechnicalRow?.esClose ?? row.esClose ?? null,
      technicalState:
        esTechnicalRow?.daily?.technicalState ||
        row?.daily?.technicalState ||
        null,
      state,
      volume: safeNumber(read.volume),
      avgVolume20: safeNumber(read.avgVolume20),
      volumeVsAvg20Pct,
      priorClose: safeNumber(read.priorClose),
      closeLocationPct,
      weakClosePct: safeNumber(read.weakClosePct),
      isDownDay: read.isDownDay,
      weakClose: read.weakClose,
      isHighVolumeDownDay: read.isHighVolumeDownDay,
      highVolumeWeakClose: read.highVolumeWeakClose,
      volumeExpansionIntoSelloff: read.volumeExpansionIntoSelloff,
      sellingPressureFading: read.sellingPressureFading,
      volumeFadeNearSupport: read.volumeFadeNearSupport,
      nearCoreSupport: read.nearCoreSupport,
      rawWarnings: read.warnings || [],
    },
    warnings: [...new Set(warnings)],
  };
}

function scoreIndexDistribution(row) {
  const symbolScores = {};
  const warnings = [];

  for (const symbol of INDEX_SYMBOLS) {
    const item = getSymbol(row, "marketTrend", symbol);
    const read = scoreSymbolDistribution(item, "equity");

    symbolScores[symbol] = read;
    warnings.push(...read.warnings);
  }

  const indexDistributionDays = ["SPY", "QQQ", "IWM", "MDY"].filter(
    (symbol) => symbolScores[symbol]?.details?.distributionDay === true
  ).length;

  const indexHighVolumeWeakCloseCount = ["SPY", "QQQ", "IWM", "MDY"].filter(
    (symbol) => symbolScores[symbol]?.details?.highVolumeWeakClose === true
  ).length;

  const indexWeakCloseCount = ["SPY", "QQQ", "IWM", "MDY"].filter((symbol) => {
    const closeLocationPct = symbolScores[symbol]?.details?.closeLocationPct;
    return Number.isFinite(closeLocationPct) && closeLocationPct < 35;
  }).length;

  const indexVolumePressure = clamp(
    indexDistributionDays * 18 +
      indexHighVolumeWeakCloseCount * 22 +
      indexWeakCloseCount * 8
  );

  const score = weightedAvg([
    { value: symbolScores.SPY?.score, weight: 0.3 },
    { value: symbolScores.QQQ?.score, weight: 0.3 },
    { value: symbolScores.IWM?.score, weight: 0.16 },
    { value: symbolScores.MDY?.score, weight: 0.16 },
    { value: symbolScores.DIA?.score, weight: 0.08 },
    { value: indexVolumePressure, weight: 0.22 },
  ]);

  const spy = symbolScores.SPY?.details;
  const qqq = symbolScores.QQQ?.details;
  const iwm = symbolScores.IWM?.details;
  const mdy = symbolScores.MDY?.details;

  if (spy?.aboveEma20 === false && qqq?.aboveEma20 === false) {
    warnings.push("SPY and QQQ both below EMA20");
  }

  if (
    Number.isFinite(iwm?.pctChange20d) &&
    Number.isFinite(spy?.pctChange20d) &&
    iwm.pctChange20d < spy.pctChange20d - 2
  ) {
    warnings.push("IWM underperforming SPY; small-cap participation weak");
  }

  if (
    Number.isFinite(mdy?.pctChange20d) &&
    Number.isFinite(spy?.pctChange20d) &&
    mdy.pctChange20d < spy.pctChange20d - 2
  ) {
    warnings.push("MDY underperforming SPY; mid-cap participation weak");
  }

  if (indexDistributionDays >= 2) {
    warnings.push("Distribution days building across SPY/QQQ/IWM/MDY");
  }

  if (indexHighVolumeWeakCloseCount >= 2) {
    warnings.push("High-volume weak closes building across index ETFs");
  }

  return {
    score,
    label:
      score >= 70
        ? "INDEX_DISTRIBUTION_HIGH"
        : score >= 50
          ? "INDEX_DISTRIBUTION_ELEVATED"
          : score >= 30
            ? "INDEX_DISTRIBUTION_NORMAL"
            : "INDEX_DISTRIBUTION_LOW",
    inputs: {
      symbolScores,
      indexDistributionDays,
      indexHighVolumeWeakCloseCount,
      indexWeakCloseCount,
      indexVolumePressure,
    },
    warnings: [...new Set(warnings)],
  };
}

function scoreCreditDistribution(row) {
  const symbolScores = {};
  const warnings = [];

  for (const symbol of CREDIT_SYMBOLS) {
    const item = getSymbol(row, "creditFragility", symbol);
    const read = scoreSymbolDistribution(item, "credit");

    symbolScores[symbol] = read;
    warnings.push(...read.warnings);
  }

  const score = weightedAvg([
    { value: symbolScores.HYG?.score, weight: 0.3 },
    { value: symbolScores.JNK?.score, weight: 0.3 },
    { value: symbolScores.LQD?.score, weight: 0.2 },
    { value: symbolScores.KRE?.score, weight: 0.2 },
  ]);

  if (symbolScores.HYG?.details?.aboveEma20 === false) {
    warnings.push("HYG below EMA20; high-yield credit distribution pressure");
  }

  if (symbolScores.JNK?.details?.aboveEma20 === false) {
    warnings.push("JNK below EMA20; junk credit weakening");
  }

  if (symbolScores.KRE?.details?.aboveEma20 === false) {
    warnings.push("KRE below EMA20; regional bank pressure");
  }

  return {
    score,
    label:
      score >= 70
        ? "CREDIT_DISTRIBUTION_HIGH"
        : score >= 50
          ? "CREDIT_DISTRIBUTION_ELEVATED"
          : score >= 30
            ? "CREDIT_DISTRIBUTION_NORMAL"
            : "CREDIT_DISTRIBUTION_LOW",
    inputs: symbolScores,
    warnings: [...new Set(warnings)],
  };
}

function scoreAiDistribution(row) {
  const aiInputs = getAiInputs(row);
  const symbolScores = {};
  const warnings = [];

  let above20Count = 0;
  let above50Count = 0;
  let validCount = 0;
  let highVolumeDownDayCount = safeNumber(aiInputs.aiHighVolumeDownDayCount);
  let weakCloseCount = safeNumber(aiInputs.aiWeakCloseCount);
  let failedBreakoutCount = safeNumber(aiInputs.aiFailedBreakoutCount);
  let aiBreadthPct = safeNumber(aiInputs.aiBreadthPct);

  for (const symbol of AI_SYMBOLS) {
    const item = getSymbol(row, "aiLeadership", symbol);
    const read = scoreSymbolDistribution(item, "equity");

    symbolScores[symbol] = read;

    if (item?.ok) {
      validCount += 1;
      if (item.aboveEma20 === true) above20Count += 1;
      if (item.aboveEma50 === true) above50Count += 1;
    }

    warnings.push(...read.warnings);
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

  if (!Number.isFinite(aiBreadthPct) && validCount > 0) {
    aiBreadthPct = Number(((above20Count / validCount) * 100).toFixed(2));
  }

  const avgLeaderPressure = avg(Object.values(symbolScores).map((item) => item.score));

  const breadthPressure =
    validCount > 0
      ? clamp(100 - ((above20Count / validCount) * 60 + (above50Count / validCount) * 40))
      : 50;

  const aiVolumeDistributionPressure = clamp(
    highVolumeDownDayCount * 10 + weakCloseCount * 7 + failedBreakoutCount * 8
  );

  const score = weightedAvg([
    { value: avgLeaderPressure, weight: 0.5 },
    { value: breadthPressure, weight: 0.25 },
    { value: aiVolumeDistributionPressure, weight: 0.25 },
  ]);

  if (above20Count <= 5) {
    warnings.push("AI leadership breadth narrowing");
  }

  if (highVolumeDownDayCount >= 3) {
    warnings.push("AI leadership high-volume down days building");
  }

  if (weakCloseCount >= 4) {
    warnings.push("AI leadership weak closes building");
  }

  if (failedBreakoutCount >= 2) {
    warnings.push("AI leadership failed breakouts building");
  }

  if (symbolScores.NVDA?.details?.aboveEma20 === false) {
    warnings.push("NVDA below EMA20; AI leader weakening");
  }

  return {
    score,
    label:
      score >= 70
        ? "AI_DISTRIBUTION_HIGH"
        : score >= 50
          ? "AI_DISTRIBUTION_ELEVATED"
          : score >= 30
            ? "AI_DISTRIBUTION_NORMAL"
            : "AI_DISTRIBUTION_LOW",
    inputs: {
      symbolScores,
      validCount,
      above20Count,
      above50Count,
      aiBreadthPct,
      highVolumeDownDayCount,
      weakCloseCount,
      failedBreakoutCount,
      breadthPressure,
      aiVolumeDistributionPressure,
      avgLeaderPressure,
    },
    warnings: [...new Set(warnings)],
  };
}

function scoreSectorDistribution(row) {
  const sectorInputs = getProxyInputs(row, "sectorRotation");
  const warnings = [];

  function sectorRead(symbol) {
    return scoreSymbolDistribution(sectorInputs?.[symbol], "equity");
  }

  const riskOnScores = {};
  const defensiveScores = {};

  for (const symbol of RISK_ON_SECTORS) {
    riskOnScores[symbol] = sectorRead(symbol);
    warnings.push(...riskOnScores[symbol].warnings);
  }

  for (const symbol of DEFENSIVE_SECTORS) {
    defensiveScores[symbol] = sectorRead(symbol);
    warnings.push(...defensiveScores[symbol].warnings);
  }

  const riskOnPressure = avg(Object.values(riskOnScores).map((item) => item.score));
  const defensivePressure = avg(Object.values(defensiveScores).map((item) => item.score));

  const defensiveRotationPressure = clamp(50 + (riskOnPressure - defensivePressure));

  const score = weightedAvg([
    { value: riskOnPressure, weight: 0.75 },
    { value: defensiveRotationPressure, weight: 0.25 },
  ]);

  if (riskOnPressure > defensivePressure + 10) {
    warnings.push("Risk-on sectors weaker than defensive sectors");
  }

  return {
    score,
    label:
      score >= 70
        ? "SECTOR_DISTRIBUTION_HIGH"
        : score >= 50
          ? "SECTOR_DISTRIBUTION_ELEVATED"
          : score >= 30
            ? "SECTOR_DISTRIBUTION_NORMAL"
            : "SECTOR_DISTRIBUTION_LOW",
    inputs: {
      riskOnScores,
      defensiveScores,
      riskOnPressure,
      defensivePressure,
      defensiveRotationPressure,
    },
    warnings: [...new Set(warnings)],
  };
}

function buildDistributionPressure(row, esTechnicalRow) {
  const esVolumeDistribution = scoreEsVolumeDistribution(row, esTechnicalRow);
  const indexDistribution = scoreIndexDistribution(row);
  const creditDistribution = scoreCreditDistribution(row);
  const aiDistribution = scoreAiDistribution(row);
  const sectorDistribution = scoreSectorDistribution(row);

  const score = weightedAvg([
    { value: esVolumeDistribution.score, weight: 0.24 },
    { value: indexDistribution.score, weight: 0.26 },
    { value: creditDistribution.score, weight: 0.18 },
    { value: aiDistribution.score, weight: 0.24 },
    { value: sectorDistribution.score, weight: 0.08 },
  ]);

  const fragileUnderSurface =
    score >= 35 &&
    (
      esVolumeDistribution.score >= 55 ||
      creditDistribution.score >= 45 ||
      indexDistribution.inputs?.symbolScores?.IWM?.score >= 45 ||
      indexDistribution.inputs?.symbolScores?.MDY?.score >= 45 ||
      aiDistribution.inputs?.breadthPressure >= 45 ||
      aiDistribution.inputs?.aiVolumeDistributionPressure >= 35
    );

  const warnings = [
    ...esVolumeDistribution.warnings,
    ...indexDistribution.warnings,
    ...creditDistribution.warnings,
    ...aiDistribution.warnings,
    ...sectorDistribution.warnings,
  ];

  return {
    score,
    label:
      score >= 70
        ? "DISTRIBUTION_PRESSURE_HIGH"
        : score >= 50
          ? "DISTRIBUTION_PRESSURE_ELEVATED"
          : fragileUnderSurface
            ? "DISTRIBUTION_PRESSURE_FRAGILE_UNDER_SURFACE"
            : score >= 30
              ? "DISTRIBUTION_PRESSURE_NORMAL"
              : "DISTRIBUTION_PRESSURE_LOW",
    interpretation:
      score >= 70
        ? "Institutional selling pressure is high. ES volume, index ETFs, credit, or AI leadership confirm distribution. Avoid blind longs and require strong reclaim confirmation."
        : score >= 50
          ? "Distribution pressure is elevated. ES volume or market internals show selling pressure. Longs require A+ setup quality and reduced size."
          : fragileUnderSurface
            ? "Market is not in full distribution, but ES volume, credit, small caps, mid caps, or AI breadth are showing pressure underneath. Longs remain selective and reduced size."
            : score >= 30
              ? "Distribution pressure is normal/mixed. Stay selective."
              : "Distribution pressure is low. Market structure is not showing broad selling pressure.",
    components: {
      esVolumeDistribution,
      indexDistribution,
      creditDistribution,
      aiDistribution,
      sectorDistribution,
    },
    warnings: [...new Set(warnings)].slice(0, 35),
  };
}

function buildSummary(rows) {
  const byLabel = rows.reduce((acc, row) => {
    const label = row.distributionPressure?.label || "UNKNOWN";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const byEsVolumeLabel = rows.reduce((acc, row) => {
    const label =
      row.distributionPressure?.components?.esVolumeDistribution?.label ||
      "ES_VOLUME_DISTRIBUTION_UNKNOWN";
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});

  const avgScore = (() => {
    const nums = rows
      .map((row) => safeNumber(row.distributionPressure?.score))
      .filter(Number.isFinite);

    if (!nums.length) return null;

    return Number((nums.reduce((sum, value) => sum + value, 0) / nums.length).toFixed(3));
  })();

  return {
    rows: rows.length,
    avgDistributionPressureScore: avgScore,
    byLabel,
    byEsVolumeLabel,
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
      esDailyTechnicalFile: "engine25-es-replay-daily-technical-6mo.json",
      outputFile: "engine25-historical-distribution-pressure-6mo.json",
    },
    limitations: [
      "v0.4 uses historical proxy scores, ETF trend/momentum data, MDY mid-cap participation, ETF volume distribution-day fields, AI basket distribution, credit pressure, and ES volume distribution.",
      "Higher distributionPressure score means more institutional selling pressure.",
      "DISTRIBUTION_PRESSURE_FRAGILE_UNDER_SURFACE is used when score is moderate but ES volume, credit, small caps, mid caps, or AI breadth show hidden weakness.",
      "This job does not change live Engine 25 or frontend behavior.",
    ],
    summary: null,
    rows: [],
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25 Historical Distribution Pressure");
    console.log("Proxy + MDY + ETF Volume + AI + ES Volume v0.4");
    console.log("========================================");

    const proxy = readJsonFile(PROXY_FILE);
    const proxyRows = normalizeRows(proxy, "Proxy");

    const esDailyTechnical = readJsonFile(ES_DAILY_TECHNICAL_FILE);
    const esDailyRows = normalizeRows(esDailyTechnical, "ES daily technical");
    const esDailyByDate = indexRowsByDate(esDailyRows);

    console.log("Proxy rows loaded:", proxyRows.length);
    console.log("ES daily technical rows loaded:", esDailyRows.length);

    const missingEsVolumeDates = [];

    const rows = proxyRows.map((row) => {
      const esTechnicalRow = esDailyByDate.get(row.date) || null;

      if (!esTechnicalRow) {
        missingEsVolumeDates.push(row.date);
      }

      const distributionPressure = buildDistributionPressure(row, esTechnicalRow);

      return {
        date: row.date,
        time: row.time,
        symbol: "ES",
        timeframe: "1d",
        esOpen: row.esOpen,
        esHigh: row.esHigh,
        esLow: row.esLow,
        esClose: row.esClose,
        esVolume: esTechnicalRow?.esVolume ?? null,
        esVolumeDistribution:
          distributionPressure.components?.esVolumeDistribution || null,
        next1dReturnPct: row.next1dReturnPct,
        next3dReturnPct: row.next3dReturnPct,
        next5dReturnPct: row.next5dReturnPct,
        maxDrawdownNext5dPct: row.maxDrawdownNext5dPct,
        maxRunupNext5dPct: row.maxRunupNext5dPct,
        outcome5d: row.outcome5d,
        distributionPressure,
      };
    });

    output.rows = rows;
    output.summary = {
      ...buildSummary(rows),
      missingEsVolumeDates,
      missingEsVolumeCount: missingEsVolumeDates.length,
    };
    output.ok = rows.length > 0;
    output.generatedAtUtc = new Date().toISOString();
    output.finishedAt = output.generatedAtUtc;

    ensureDataDir();
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Historical Distribution Pressure Complete");
    console.log("OK:", output.ok);
    console.log("Rows:", output.summary.rows);
    console.log("Avg score:", output.summary.avgDistributionPressureScore);
    console.log("By label:", output.summary.byLabel);
    console.log("By ES volume label:", output.summary.byEsVolumeLabel);
    console.log("Missing ES volume rows:", output.summary.missingEsVolumeCount);
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
            avgDistributionPressureScore:
              output.summary.avgDistributionPressureScore,
            byLabel: output.summary.byLabel,
            byEsVolumeLabel: output.summary.byEsVolumeLabel,
            missingEsVolumeCount: output.summary.missingEsVolumeCount,
          },
          firstRow: output.summary.firstRow
            ? {
                date: output.summary.firstRow.date,
                score: output.summary.firstRow.distributionPressure.score,
                label: output.summary.firstRow.distributionPressure.label,
                esVolumeLabel:
                  output.summary.firstRow.distributionPressure.components?.esVolumeDistribution?.label,
                interpretation:
                  output.summary.firstRow.distributionPressure.interpretation,
                warnings: output.summary.firstRow.distributionPressure.warnings,
              }
            : null,
          lastRow: output.summary.lastRow
            ? {
                date: output.summary.lastRow.date,
                score: output.summary.lastRow.distributionPressure.score,
                label: output.summary.lastRow.distributionPressure.label,
                esVolumeLabel:
                  output.summary.lastRow.distributionPressure.components?.esVolumeDistribution?.label,
                interpretation:
                  output.summary.lastRow.distributionPressure.interpretation,
                warnings: output.summary.lastRow.distributionPressure.warnings,
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

    console.error("Engine 25 Historical Distribution Pressure Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
