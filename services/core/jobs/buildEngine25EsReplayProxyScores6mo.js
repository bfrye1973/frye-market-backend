// services/core/jobs/buildEngine25EsReplayProxyScores6mo.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ENGINE = "engine25.esReplayProxyScores.v0.6";
const SYMBOL = "ES";
const TIMEFRAME = "1d";
const LOOKBACK_TRADING_DAYS = 126;
const FETCH_LIMIT = 320;

const BACKEND_BASE =
  process.env.BACKEND_BASE || "https://frye-market-backend-1.onrender.com";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const SETUP_REPLAY_FILE = path.join(DATA_DIR, "engine25-es-replay-setups-6mo.json");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-es-replay-proxy-scores-6mo.json");

// Task 1: add MDY for mid-cap participation.
const MARKET_TREND_SYMBOLS = ["SPY", "QQQ", "IWM", "MDY", "DIA"];
const CREDIT_FRAGILITY_SYMBOLS = ["HYG", "JNK", "LQD", "KRE", "IWM", "MDY"];

const AI_LEADERSHIP_SYMBOLS = [
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

const MACRO_PROXY_SYMBOLS = ["TLT", "USO", "UUP", "IWM", "MDY"];

const ALL_SYMBOLS = [
  ...new Set([
    ...MARKET_TREND_SYMBOLS,
    ...CREDIT_FRAGILITY_SYMBOLS,
    ...AI_LEADERSHIP_SYMBOLS,
    ...MACRO_PROXY_SYMBOLS,
  ]),
];

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

function dateFromUnixSeconds(seconds) {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
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

function avg(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return 50;
  return clamp(nums.reduce((sum, v) => sum + v, 0) / nums.length);
}

function avgRaw(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return round(nums.reduce((sum, v) => sum + v, 0) / nums.length, 3);
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

function boolScore(value, trueScore = 100, falseScore = 0, unknownScore = 50) {
  if (value === true) return trueScore;
  if (value === false) return falseScore;
  return unknownScore;
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

function pctChangeFromIndex(bars, index, lookback) {
  const current = bars[index];
  const past = bars[index - lookback];

  if (!current || !past) return null;

  const currentClose = toNumber(current.close, null);
  const pastClose = toNumber(past.close, null);

  if (!currentClose || !pastClose) return null;

  return round(((currentClose - pastClose) / pastClose) * 100, 3);
}

function avgVolumeFromIndex(bars, index, lookback = 20) {
  const start = Math.max(0, index - lookback);
  const priorBars = bars.slice(start, index);
  const volumes = priorBars
    .map((bar) => toNumber(bar.volume, null))
    .filter(Number.isFinite);

  if (volumes.length < Math.min(lookback, 10)) return null;

  return round(volumes.reduce((sum, v) => sum + v, 0) / volumes.length, 0);
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

function rollingHighFromIndex(bars, index, lookback = 10) {
  const start = Math.max(0, index - lookback);
  const priorBars = bars.slice(start, index);
  const highs = priorBars.map((bar) => toNumber(bar.high, null)).filter(Number.isFinite);

  if (!highs.length) return null;

  return Math.max(...highs);
}

function rollingLowFromIndex(bars, index, lookback = 10) {
  const start = Math.max(0, index - lookback);
  const priorBars = bars.slice(start, index);
  const lows = priorBars.map((bar) => toNumber(bar.low, null)).filter(Number.isFinite);

  if (!lows.length) return null;

  return Math.min(...lows);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchStockDailyBars(symbol) {
  const url = `${BACKEND_BASE}/api/v1/ohlc?symbol=${symbol}&timeframe=1d&limit=${FETCH_LIMIT}`;

  const maxAttempts = 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url);
      const text = await res.text();

      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          `Invalid JSON for ${symbol} on attempt ${attempt}: ${text.slice(0, 300)}`
        );
      }

      if (!res.ok) {
        throw new Error(
          `Fetch failed for ${symbol} HTTP ${res.status} on attempt ${attempt}: ${text.slice(0, 500)}`
        );
      }

      if (!Array.isArray(json)) {
        throw new Error(`${symbol} OHLC route did not return an array`);
      }

      return {
        symbol,
        url,
        bars: json,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;

      console.warn(
        `[ProxyScores] ${symbol} fetch attempt ${attempt}/${maxAttempts} failed: ${err.message}`
      );

      if (attempt < maxAttempts) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw new Error(
    `Failed to fetch ${symbol} daily bars after ${maxAttempts} attempts. Last error: ${lastError?.message}`
  );
}

function normalizeBar(bar) {
  return {
    time: toNumber(bar.time, null),
    date: dateFromUnixSeconds(toNumber(bar.time, null)),
    open: toNumber(bar.open, null),
    high: toNumber(bar.high, null),
    low: toNumber(bar.low, null),
    close: toNumber(bar.close, null),
    volume: toNumber(bar.volume, null),
  };
}

function buildSymbolMetrics(symbol, rawBars) {
  const bars = rawBars
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

  const closes = bars.map((bar) => bar.close);

  const ema10Series = ema(closes, 10);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const ema200Series = ema(closes, 200);

  const metrics = bars.map((bar, index) => {
    const ema10 = round(ema10Series[index], 2);
    const ema20 = round(ema20Series[index], 2);
    const ema50 = round(ema50Series[index], 2);
    const ema200 = round(ema200Series[index], 2);

    const priorClose = index > 0 ? toNumber(bars[index - 1]?.close, null) : null;
    const avgVolume20 = avgVolumeFromIndex(bars, index, 20);
    const closeLoc = closeLocationPct(bar);

    const prior10dHigh = rollingHighFromIndex(bars, index, 10);
    const prior10dLow = rollingLowFromIndex(bars, index, 10);

    const isDownDay =
      Number.isFinite(priorClose) && Number.isFinite(bar.close)
        ? bar.close < priorClose
        : null;

    const isHighVolumeDownDay =
      isDownDay === true &&
      Number.isFinite(bar.volume) &&
      Number.isFinite(avgVolume20)
        ? bar.volume > avgVolume20 * 1.1
        : false;

    const highVolumeWeakClose =
      isHighVolumeDownDay === true &&
      Number.isFinite(closeLoc) &&
      closeLoc < 35;

    const distributionDay =
      isHighVolumeDownDay === true &&
      Number.isFinite(closeLoc) &&
      closeLoc < 45;

    const making10dHigh =
      Number.isFinite(prior10dHigh) && Number.isFinite(bar.close)
        ? bar.close > prior10dHigh
        : false;

    const making10dLow =
      Number.isFinite(prior10dLow) && Number.isFinite(bar.close)
        ? bar.close < prior10dLow
        : false;

    const failedBreakout =
      Number.isFinite(prior10dHigh) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.close)
        ? bar.high > prior10dHigh && bar.close < prior10dHigh
        : false;

    return {
      ok: true,
      symbol,
      date: bar.date,
      time: bar.time,

      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      priorClose,
      avgVolume20,

      closeLocationPct: closeLoc,
      weakClosePct: closeLoc,
      isDownDay,
      isHighVolumeDownDay,
      highVolumeWeakClose,
      distributionDay,

      prior10dHigh,
      prior10dLow,
      making10dHigh,
      making10dLow,
      failedBreakout,

      ema10,
      ema20,
      ema50,
      ema200,
      aboveEma10: ema10 === null ? null : bar.close > ema10,
      aboveEma20: ema20 === null ? null : bar.close > ema20,
      aboveEma50: ema50 === null ? null : bar.close > ema50,
      aboveEma200: ema200 === null ? null : bar.close > ema200,
      pctChange5d: pctChangeFromIndex(bars, index, 5),
      pctChange20d: pctChangeFromIndex(bars, index, 20),
      pctChange50d: pctChangeFromIndex(bars, index, 50),
    };
  });

  return {
    symbol,
    bars,
    metrics,
  };
}

function daysBetweenYmd(a, b) {
  if (!a || !b) return null;

  const aMs = Date.parse(`${a}T00:00:00Z`);
  const bMs = Date.parse(`${b}T00:00:00Z`);

  if (!Number.isFinite(aMs) || !Number.isFinite(bMs)) return null;

  return Math.round((bMs - aMs) / (24 * 60 * 60 * 1000));
}

function findMetricForEsSessionDate(symbolMetrics, esDate) {
  const metrics = symbolMetrics?.metrics || [];

  if (!metrics.length) {
    return {
      ok: false,
      symbol: symbolMetrics?.symbol || null,
      date: esDate,
      esDate,
      proxyDateUsed: null,
      proxyDateOffsetDays: null,
      dateAlignment: "NO_METRICS",
      error: "No metrics available",
    };
  }

  const exact = metrics.find((metric) => metric.date === esDate) || null;

  const nextCashSession =
    metrics.find((metric) => {
      const diff = daysBetweenYmd(esDate, metric.date);
      return Number.isFinite(diff) && diff >= 1 && diff <= 3;
    }) || null;

  let selected = nextCashSession || exact || null;

  if (!selected) {
    for (const metric of metrics) {
      if (metric.date && metric.date <= esDate) {
        selected = metric;
      } else if (metric.date && metric.date > esDate) {
        break;
      }
    }
  }

  if (!selected) {
    return {
      ok: false,
      symbol: symbolMetrics?.symbol || null,
      date: esDate,
      esDate,
      proxyDateUsed: null,
      proxyDateOffsetDays: null,
      dateAlignment: "NO_METRIC_ON_OR_BEFORE_ES_DATE",
      error: "No metric available for ES session date",
    };
  }

  const offset = daysBetweenYmd(esDate, selected.date);

  return {
    ...selected,
    esDate,
    proxyDateUsed: selected.date,
    proxyDateOffsetDays: offset,
    dateAlignment:
      offset === 0
        ? "EXACT_ES_DATE"
        : offset > 0
          ? "NEXT_CASH_SESSION_FOR_ES_FUTURES_DATE"
          : "PRIOR_CASH_SESSION_FALLBACK",
  };
}

function symbolTrendScore(item) {
  if (!item?.ok) return 50;

  const emaScore =
    boolScore(item.aboveEma10, 25, 0) +
    boolScore(item.aboveEma20, 25, 0) +
    boolScore(item.aboveEma50, 25, 0) +
    boolScore(item.aboveEma200, 25, 0);

  const momentumScore = scoreDirect(item.pctChange20d, -5, 5);

  const distributionPenalty = item.distributionDay === true ? 10 : 0;

  return clamp(
    weightedAvg([
      { value: emaScore, weight: 0.7 },
      { value: momentumScore, weight: 0.3 },
    ]) - distributionPenalty
  );
}

function scoreMarketTrendForDate(symbols) {
  const spyScore = symbolTrendScore(symbols.SPY);
  const qqqScore = symbolTrendScore(symbols.QQQ);
  const iwmScore = symbolTrendScore(symbols.IWM);
  const mdyScore = symbolTrendScore(symbols.MDY);
  const diaScore = symbolTrendScore(symbols.DIA);

  const indexDistributionDays = ["SPY", "QQQ", "IWM", "MDY"].filter(
    (symbol) => symbols[symbol]?.distributionDay === true
  ).length;

  const score = weightedAvg([
    { value: spyScore, weight: 0.3 },
    { value: qqqScore, weight: 0.3 },
    { value: iwmScore, weight: 0.15 },
    { value: mdyScore, weight: 0.15 },
    { value: diaScore, weight: 0.1 },
  ]);

  const warnings = [];

  if (symbols.IWM?.aboveEma10 === false || symbols.IWM?.aboveEma20 === false) {
    warnings.push("Small caps lagging short-term trend");
  }

  if (symbols.MDY?.aboveEma10 === false || symbols.MDY?.aboveEma20 === false) {
    warnings.push("Mid caps lagging short-term trend");
  }

  if (symbols.SPY?.aboveEma20 === false) warnings.push("SPY below Daily EMA20");
  if (symbols.QQQ?.aboveEma20 === false) warnings.push("QQQ below Daily EMA20");

  if (indexDistributionDays >= 2) {
    warnings.push("Distribution days building across SPY/QQQ/IWM/MDY");
  }

  return {
    score,
    label:
      score >= 75
        ? "MARKET_TREND_STRONG"
        : score >= 55
          ? "MARKET_TREND_HEALTHY"
          : "MARKET_TREND_WEAK",
    inputs: {
      SPY: symbols.SPY,
      QQQ: symbols.QQQ,
      IWM: symbols.IWM,
      MDY: symbols.MDY,
      DIA: symbols.DIA,
      spyScore,
      qqqScore,
      iwmScore,
      mdyScore,
      diaScore,
      indexDistributionDays,
    },
    warnings,
  };
}

function bondFragilityScore(item) {
  if (!item?.ok) return 50;

  const trendScore = weightedAvg([
    { value: boolScore(item.aboveEma10, 100, 0), weight: 0.2 },
    { value: boolScore(item.aboveEma20, 100, 0), weight: 0.3 },
    { value: boolScore(item.aboveEma50, 100, 0), weight: 0.25 },
    { value: boolScore(item.aboveEma200, 100, 0), weight: 0.25 },
  ]);

  const momentumScore = weightedAvg([
    { value: scoreDirect(item.pctChange5d, -3, 2), weight: 0.35 },
    { value: scoreDirect(item.pctChange20d, -5, 3), weight: 0.45 },
    { value: scoreDirect(item.pctChange50d, -8, 5), weight: 0.2 },
  ]);

  const distributionPenalty = item.distributionDay === true ? 8 : 0;

  return clamp(
    weightedAvg([
      { value: trendScore, weight: 0.65 },
      { value: momentumScore, weight: 0.35 },
    ]) - distributionPenalty
  );
}

function equityFragilityScore(item) {
  if (!item?.ok) return 50;

  const trendScore = weightedAvg([
    { value: boolScore(item.aboveEma10, 100, 0), weight: 0.2 },
    { value: boolScore(item.aboveEma20, 100, 0), weight: 0.3 },
    { value: boolScore(item.aboveEma50, 100, 0), weight: 0.25 },
    { value: boolScore(item.aboveEma200, 100, 0), weight: 0.25 },
  ]);

  const momentumScore = weightedAvg([
    { value: scoreDirect(item.pctChange5d, -5, 3), weight: 0.35 },
    { value: scoreDirect(item.pctChange20d, -8, 5), weight: 0.45 },
    { value: scoreDirect(item.pctChange50d, -12, 8), weight: 0.2 },
  ]);

  const distributionPenalty = item.distributionDay === true ? 8 : 0;

  return clamp(
    weightedAvg([
      { value: trendScore, weight: 0.65 },
      { value: momentumScore, weight: 0.35 },
    ]) - distributionPenalty
  );
}

function scoreCreditFragilityForDate(symbols) {
  const hygScore = bondFragilityScore(symbols.HYG);
  const jnkScore = bondFragilityScore(symbols.JNK);
  const lqdScore = bondFragilityScore(symbols.LQD);
  const kreScore = equityFragilityScore(symbols.KRE);
  const iwmScore = equityFragilityScore(symbols.IWM);
  const mdyScore = equityFragilityScore(symbols.MDY);

  const score = weightedAvg([
    { value: hygScore, weight: 0.22 },
    { value: jnkScore, weight: 0.22 },
    { value: lqdScore, weight: 0.14 },
    { value: kreScore, weight: 0.18 },
    { value: iwmScore, weight: 0.12 },
    { value: mdyScore, weight: 0.12 },
  ]);

  const warnings = [];

  if (symbols.HYG?.aboveEma20 === false && symbols.HYG?.aboveEma50 === false) {
    warnings.push("HYG below EMA20/EMA50; high-yield credit weakening");
  }

  if (symbols.JNK?.aboveEma20 === false && symbols.JNK?.aboveEma50 === false) {
    warnings.push("JNK below EMA20/EMA50; junk-credit fragility rising");
  }

  if (symbols.LQD?.aboveEma20 === false && symbols.LQD?.aboveEma50 === false) {
    warnings.push("LQD below EMA20/EMA50; investment-grade bonds under pressure");
  }

  if (symbols.KRE?.aboveEma20 === false && symbols.KRE?.aboveEma50 === false) {
    warnings.push("KRE below EMA20/EMA50; regional bank pressure rising");
  }

  if (symbols.IWM?.aboveEma20 === false) {
    warnings.push("IWM below EMA20; small-cap borrower/risk appetite weak");
  }

  if (symbols.MDY?.aboveEma20 === false) {
    warnings.push("MDY below EMA20; mid-cap risk appetite weak");
  }

  return {
    score,
    label:
      score >= 75
        ? "CREDIT_FRAGILITY_LOW"
        : score >= 60
          ? "CREDIT_FRAGILITY_WATCH"
          : score >= 45
            ? "CREDIT_FRAGILITY_ELEVATED"
            : "CREDIT_FRAGILITY_HIGH",
    inputs: {
      HYG: symbols.HYG,
      JNK: symbols.JNK,
      LQD: symbols.LQD,
      KRE: symbols.KRE,
      IWM: symbols.IWM,
      MDY: symbols.MDY,
      hygScore,
      jnkScore,
      lqdScore,
      kreScore,
      iwmScore,
      mdyScore,
    },
    warnings,
  };
}

function scoreAiLeadershipForDate(symbols) {
  const symbolScores = {};
  const validSymbols = AI_LEADERSHIP_SYMBOLS.filter((symbol) => symbols[symbol]?.ok);

  let aiAboveEma10Count = 0;
  let aiAboveEma20Count = 0;
  let aiAboveEma50Count = 0;
  let aiAboveEma200Count = 0;
  let aiPositive20dCount = 0;
  let aiMaking10dHighCount = 0;
  let aiMaking10dLowCount = 0;
  let aiHighVolumeDownDayCount = 0;
  let aiWeakCloseCount = 0;
  let aiFailedBreakoutCount = 0;

  for (const symbol of AI_LEADERSHIP_SYMBOLS) {
    const item = symbols[symbol];

    if (!item?.ok) {
      symbolScores[symbol] = 50;
      continue;
    }

    if (item.aboveEma10 === true) aiAboveEma10Count += 1;
    if (item.aboveEma20 === true) aiAboveEma20Count += 1;
    if (item.aboveEma50 === true) aiAboveEma50Count += 1;
    if (item.aboveEma200 === true) aiAboveEma200Count += 1;
    if (Number(item.pctChange20d) > 0) aiPositive20dCount += 1;
    if (item.making10dHigh === true) aiMaking10dHighCount += 1;
    if (item.making10dLow === true) aiMaking10dLowCount += 1;
    if (item.isHighVolumeDownDay === true) aiHighVolumeDownDayCount += 1;
    if (Number(item.closeLocationPct) < 35) aiWeakCloseCount += 1;
    if (item.failedBreakout === true) aiFailedBreakoutCount += 1;

    const emaScore =
      boolScore(item.aboveEma10, 20, 0) +
      boolScore(item.aboveEma20, 25, 0) +
      boolScore(item.aboveEma50, 25, 0) +
      boolScore(item.aboveEma200, 30, 0);

    const momentumScore = scoreDirect(item.pctChange20d, -8, 12);
    const distributionPenalty =
      item.distributionDay === true || item.failedBreakout === true ? 10 : 0;

    symbolScores[symbol] = clamp(
      weightedAvg([
        { value: emaScore, weight: 0.7 },
        { value: momentumScore, weight: 0.3 },
      ]) - distributionPenalty
    );
  }

  const score = avg(Object.values(symbolScores));
  const validCount = validSymbols.length;

  const aiBreadthPct =
    validCount > 0 ? round((aiAboveEma20Count / validCount) * 100, 2) : null;

  const aiConcentrationRisk =
    validCount > 0 && aiAboveEma20Count <= Math.max(3, Math.floor(validCount * 0.45));

  const warnings = [];

  if (symbolScores.NVDA < 60) warnings.push("NVDA leadership weakening");
  if (symbolScores.META < 40) warnings.push("META below major AI leadership trend");
  if (symbolScores.PLTR < 40) warnings.push("PLTR below major AI leadership trend");
  if (aiConcentrationRisk) warnings.push("AI leadership supportive but narrow");
  if (aiHighVolumeDownDayCount >= 3) warnings.push("AI leaders showing high-volume down days");
  if (aiFailedBreakoutCount >= 2) warnings.push("AI leaders showing failed breakout pressure");

  let label = "AI_LEADERSHIP_WEAK";
  if (score >= 75 && aiAboveEma20Count >= 7 && aiHighVolumeDownDayCount <= 1) {
    label = "AI_LEADERSHIP_BROAD";
  } else if (score >= 60 && aiAboveEma20Count >= 5) {
    label = "AI_LEADERSHIP_SUPPORTIVE_BUT_NARROW";
  } else if (score >= 45) {
    label = "AI_LEADERSHIP_FADING";
  } else {
    label = "AI_LEADERSHIP_DISTRIBUTING";
  }

  return {
    score,
    label,
    inputs: {
      symbolScores,
      symbols,
      validCount,
      aiAboveEma10Count,
      aiAboveEma20Count,
      aiAboveEma50Count,
      aiAboveEma200Count,
      aiPositive20dCount,
      aiMaking10dHighCount,
      aiMaking10dLowCount,
      aiHighVolumeDownDayCount,
      aiWeakCloseCount,
      aiFailedBreakoutCount,
      aiBreadthPct,
      aiConcentrationRisk,
    },
    warnings,
  };
}

function scoreMacroPressureProxyForDate(symbols, aiLeadership) {
  const tlt = symbols.TLT;
  const uso = symbols.USO;
  const uup = symbols.UUP;
  const iwm = symbols.IWM;
  const mdy = symbols.MDY;

  const aiSymbols = AI_LEADERSHIP_SYMBOLS;
  const aiAbove20 = aiSymbols.filter((symbol) => symbols[symbol]?.aboveEma20 === true).length;
  const aiAbove50 = aiSymbols.filter((symbol) => symbols[symbol]?.aboveEma50 === true).length;
  const aiHighVolumeDownDays = aiSymbols.filter(
    (symbol) => symbols[symbol]?.isHighVolumeDownDay === true
  ).length;

  const tltTrendScore = weightedAvg([
    { value: boolScore(tlt?.aboveEma20, 100, 0), weight: 0.35 },
    { value: boolScore(tlt?.aboveEma50, 100, 0), weight: 0.35 },
    { value: scoreDirect(tlt?.pctChange20d, -8, 5), weight: 0.3 },
  ]);

  const oilPressureScore = weightedAvg([
    { value: boolScore(uso?.aboveEma20, 30, 80), weight: 0.35 },
    { value: boolScore(uso?.aboveEma50, 30, 80), weight: 0.25 },
    { value: scoreInverse(uso?.pctChange20d, 2, 15), weight: 0.4 },
  ]);

  const dollarPressureScore = weightedAvg([
    { value: boolScore(uup?.aboveEma20, 35, 75), weight: 0.4 },
    { value: scoreInverse(uup?.pctChange20d, 1, 6), weight: 0.6 },
  ]);

  const smallCapParticipationScore = weightedAvg([
    { value: boolScore(iwm?.aboveEma20, 100, 0), weight: 0.45 },
    { value: boolScore(iwm?.aboveEma50, 100, 0), weight: 0.25 },
    { value: scoreDirect(iwm?.pctChange20d, -5, 5), weight: 0.3 },
  ]);

  const midCapParticipationScore = weightedAvg([
    { value: boolScore(mdy?.aboveEma20, 100, 0), weight: 0.45 },
    { value: boolScore(mdy?.aboveEma50, 100, 0), weight: 0.25 },
    { value: scoreDirect(mdy?.pctChange20d, -5, 5), weight: 0.3 },
  ]);

  const aiBreadthScore = weightedAvg([
    { value: scoreDirect(aiAbove20, 3, 8), weight: 0.6 },
    { value: scoreDirect(aiAbove50, 3, 8), weight: 0.4 },
  ]);

  const broadParticipationScore = weightedAvg([
    { value: smallCapParticipationScore, weight: 0.4 },
    { value: midCapParticipationScore, weight: 0.25 },
    { value: aiBreadthScore, weight: 0.35 },
  ]);

  const aiDistributionPenalty = clamp(aiHighVolumeDownDays * 8, 0, 24);

  const score = clamp(
    weightedAvg([
      { value: tltTrendScore, weight: 0.25 },
      { value: oilPressureScore, weight: 0.25 },
      { value: dollarPressureScore, weight: 0.15 },
      { value: broadParticipationScore, weight: 0.35 },
    ]) - aiDistributionPenalty
  );

  const warnings = [];

  if (tlt?.aboveEma20 === false && Number(tlt?.pctChange20d) < 0) {
    warnings.push("TLT weak; bond market pressure rising");
  }

  if (uso?.aboveEma20 === true && Number(uso?.pctChange20d) >= 5) {
    warnings.push("Oil/energy strength may pressure CPI");
  }

  if (aiAbove20 <= 5) {
    warnings.push("AI leadership breadth is narrowing");
  }

  if (aiHighVolumeDownDays >= 3) {
    warnings.push("AI leadership showing high-volume distribution pressure");
  }

  if (iwm?.aboveEma20 === false) {
    warnings.push("Small caps lagging / narrow leadership risk");
  }

  if (mdy?.aboveEma20 === false) {
    warnings.push("Mid caps lagging / broad participation risk");
  }

  return {
    score,
    label:
      score >= 75
        ? "MACRO_PROXY_PRESSURE_LOW"
        : score >= 60
          ? "MACRO_PROXY_PRESSURE_MANAGEABLE"
          : score >= 45
            ? "MACRO_PROXY_PRESSURE_ELEVATED"
            : "MACRO_PROXY_PRESSURE_HIGH",
    limitation:
      "Proxy only. Does not include FRED yields, inflation, FiscalData, FMP events, or sector-card distribution/breadth.",
    inputs: {
      TLT: tlt,
      USO: uso,
      UUP: uup,
      IWM: iwm,
      MDY: mdy,
      aiAbove20,
      aiAbove50,
      aiHighVolumeDownDays,
      aiLeadershipScore: aiLeadership?.score ?? null,
      tltTrendScore,
      oilPressureScore,
      dollarPressureScore,
      smallCapParticipationScore,
      midCapParticipationScore,
      aiBreadthScore,
      broadParticipationScore,
      aiDistributionPenalty,
    },
    warnings,
  };
}

function scoreProxyComponentsForRow(row, symbolMetricMap) {
  const date = row.date;

  const symbols = {};
  for (const symbol of ALL_SYMBOLS) {
    symbols[symbol] = findMetricForEsSessionDate(symbolMetricMap[symbol], date);
  }

  const marketTrend = scoreMarketTrendForDate(symbols);
  const creditFragility = scoreCreditFragilityForDate(symbols);
  const aiLeadership = scoreAiLeadershipForDate(symbols);
  const macroPressureProxy = scoreMacroPressureProxyForDate(symbols, aiLeadership);

  return {
    marketTrend,
    creditFragility,
    aiLeadership,
    macroPressureProxy,
  };
}

function summarizeConfirmedSetupProxy(rows) {
  const confirmedRows = rows.filter(
    (row) => row.setups?.constructive20Pullback?.confirmed === true
  );

  const workedRows = confirmedRows.filter(
    (row) => row.setups?.constructive20Pullback?.outcome5dFromEntry === "WORKED"
  );

  const failedRows = confirmedRows.filter(
    (row) => row.setups?.constructive20Pullback?.outcome5dFromEntry === "FAILED"
  );

  function avgScore(group, key) {
    return avgRaw(group.map((row) => row.proxyScores?.[key]?.score));
  }

  return {
    setupName: "CONSTRUCTIVE_20EMA_PULLBACK_CONFIRMED",
    confirmedCount: confirmedRows.length,
    workedCount: workedRows.length,
    failedCount: failedRows.length,
    workedAvgScores: {
      marketTrend: avgScore(workedRows, "marketTrend"),
      creditFragility: avgScore(workedRows, "creditFragility"),
      aiLeadership: avgScore(workedRows, "aiLeadership"),
      macroPressureProxy: avgScore(workedRows, "macroPressureProxy"),
    },
    failedAvgScores: {
      marketTrend: avgScore(failedRows, "marketTrend"),
      creditFragility: avgScore(failedRows, "creditFragility"),
      aiLeadership: avgScore(failedRows, "aiLeadership"),
      macroPressureProxy: avgScore(failedRows, "macroPressureProxy"),
    },
    confirmedRows: confirmedRows.map((row) => ({
      setupDate: row.setups.constructive20Pullback.setupDate,
      entryDate: row.setups.constructive20Pullback.entryDate,
      outcome5dFromEntry: row.setups.constructive20Pullback.outcome5dFromEntry,
      next5dReturnFromEntryPct:
        row.setups.constructive20Pullback.next5dReturnFromEntryPct,
      maxDrawdownNext5dFromEntryPct:
        row.setups.constructive20Pullback.maxDrawdownNext5dFromEntryPct,
      proxyScores: {
        marketTrend: row.proxyScores?.marketTrend?.score ?? null,
        creditFragility: row.proxyScores?.creditFragility?.score ?? null,
        aiLeadership: row.proxyScores?.aiLeadership?.score ?? null,
        macroPressureProxy: row.proxyScores?.macroPressureProxy?.score ?? null,
      },
      proxyLabels: {
        marketTrend: row.proxyScores?.marketTrend?.label ?? null,
        creditFragility: row.proxyScores?.creditFragility?.label ?? null,
        aiLeadership: row.proxyScores?.aiLeadership?.label ?? null,
        macroPressureProxy: row.proxyScores?.macroPressureProxy?.label ?? null,
      },
      warnings: [
        ...(row.proxyScores?.marketTrend?.warnings || []),
        ...(row.proxyScores?.creditFragility?.warnings || []),
        ...(row.proxyScores?.aiLeadership?.warnings || []),
        ...(row.proxyScores?.macroPressureProxy?.warnings || []),
      ],
    })),
  };
}

async function main() {
  ensureDataDir();

  console.log("========================================");
  console.log("Engine 25 ES Replay Proxy Scores Build");
  console.log("Market Trend + Credit Fragility + AI Leadership + Macro Proxy");
  console.log("v0.6: MDY + volume/distribution fields + AI breadth counts");
  console.log("========================================");

  const setupReplay = readJsonSafe(SETUP_REPLAY_FILE, true);

  if (!setupReplay?.ok || !Array.isArray(setupReplay.rows)) {
    throw new Error("Invalid setup replay file. Run buildEngine25EsReplaySetups6mo.js first.");
  }

  console.log("[ProxyScores] Fetching daily OHLC for symbols...");
  const fetched = {};

  for (const symbol of ALL_SYMBOLS) {
    const result = await fetchStockDailyBars(symbol);
    fetched[symbol] = result;
    console.log(`[ProxyScores] ${symbol}: ${result.bars.length} bars`);
  }

  console.log("[ProxyScores] Building symbol metrics...");
  const symbolMetricMap = {};
  for (const symbol of ALL_SYMBOLS) {
    symbolMetricMap[symbol] = buildSymbolMetrics(symbol, fetched[symbol].bars);
  }

  console.log("[ProxyScores] Attaching proxy scores to ES replay rows...");
  const rows = setupReplay.rows.map((row) => ({
    ...row,
    proxyScores: scoreProxyComponentsForRow(row, symbolMetricMap),
  }));

  const summary = {
    ...setupReplay.summary,
    proxyComponents: {
      marketTrend: "SPY/QQQ/IWM/MDY/DIA",
      creditFragility: "HYG/JNK/LQD/KRE/IWM/MDY",
      aiLeadership: AI_LEADERSHIP_SYMBOLS.join("/"),
      macroPressureProxy: "TLT/USO/UUP/IWM/MDY/AI breadth and AI distribution pressure",
    },
    addedInV06: [
      "MDY added to marketTrend, creditFragility, and macroPressureProxy.",
      "Symbol metrics now preserve open/high/low/close/volume.",
      "Symbol metrics now include avgVolume20, closeLocationPct, weakClosePct, isHighVolumeDownDay, highVolumeWeakClose, and distributionDay.",
      "AI leadership now includes EMA breadth counts, 10-day high/low counts, high-volume down-day count, weak-close count, failed-breakout count, and concentration risk.",
    ],
    limitations: [
      "Historical proxy replay does not include FRED yields/rates.",
      "Historical proxy replay does not include FiscalData liquidity.",
      "Historical proxy replay does not include FMP event/news risk.",
      "Historical proxy replay does not include sector-card distributionPressure or breadthParticipation.",
    ],
    constructive20PullbackProxyRead: summarizeConfirmedSetupProxy(rows),
  };

  const output = {
    ok: true,
    engine: ENGINE,
    symbol: SYMBOL,
    timeframe: TIMEFRAME,
    lookbackTradingDays: LOOKBACK_TRADING_DAYS,
    generatedAtUtc: new Date().toISOString(),
    source: {
      setupReplayFile: "engine25-es-replay-setups-6mo.json",
      backendBase: BACKEND_BASE,
      fetchLimit: FETCH_LIMIT,
      symbols: ALL_SYMBOLS,
    },
    summary,
    rows,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log("\n========================================");
  console.log("Engine 25 ES Replay Proxy Scores Complete");
  console.log("OK:", output.ok);
  console.log("Rows:", rows.length);
  console.log(
    "Constructive20 Proxy Read:",
    JSON.stringify(summary.constructive20PullbackProxyRead, null, 2)
  );
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
        symbols: output.source.symbols,
        outputFile: OUTPUT_FILE,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("[Engine25EsReplayProxyScores] FAILED:");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
