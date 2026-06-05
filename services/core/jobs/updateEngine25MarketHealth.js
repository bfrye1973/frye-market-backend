// services/core/jobs/updateEngine25MarketHealth.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeEngine25MarketHealth } from "../logic/engine25MarketHealth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");

const MACRO_FILE = path.join(DATA_DIR, "engine25-data-test.json");
const MARKET_FILE = path.join(DATA_DIR, "engine25-market-feeds-test.json");
const FMP_FILE = path.join(DATA_DIR, "engine25-fmp-feeds-test.json");
const SECTOR_FILE = path.join(DATA_DIR, "engine25-sector-health-test.json");
const ES_TECH_FILE = path.join(DATA_DIR, "engine25-es-technical-context.json");

const OUTPUT_FILE = path.join(DATA_DIR, "engine25-market-health.json");
const INTRADAY_DAMAGE_FILE = path.join(DATA_DIR, "engine25-intraday-proxy-damage.json");

const BACKEND_BASE =
  process.env.BACKEND_BASE || "https://frye-market-backend-1.onrender.com";

const TIMEFRAME = "1h";
const LIMIT = 80;

const INDEX_SYMBOLS = ["SPY", "QQQ", "IWM", "MDY"];
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

const ALL_INTRADAY_SYMBOLS = [...new Set([...INDEX_SYMBOLS, ...AI_SYMBOLS])];

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

function timeToDateYmd(time) {
  const n = toNumber(time, null);
  if (!Number.isFinite(n)) return null;

  // Route usually returns seconds. Support ms too.
  const ms = n > 1000000000000 ? n : n * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

function ema(values, length) {
  if (!Array.isArray(values) || values.length < length) return [];

  const k = 2 / (length + 1);
  const output = new Array(values.length).fill(null);

  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += values[i];
  }

  let current = sum / length;
  output[length - 1] = current;

  for (let i = length; i < values.length; i += 1) {
    current = values[i] * k + current * (1 - k);
    output[i] = current;
  }

  return output;
}

function normalizeBar(bar) {
  const time = toNumber(bar?.time, null);

  return {
    time,
    date: timeToDateYmd(time),
    open: toNumber(bar?.open, null),
    high: toNumber(bar?.high, null),
    low: toNumber(bar?.low, null),
    close: toNumber(bar?.close, null),
    volume: toNumber(bar?.volume, null),
  };
}

function closeLocationPct({ high, low, close }) {
  if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    return null;
  }

  const range = high - low;
  if (range <= 0) return 50;

  return round(((close - low) / range) * 100, 2);
}

async function fetchIntradayBars(symbol) {
  const url = `${BACKEND_BASE}/api/v1/ohlc?symbol=${symbol}&timeframe=${TIMEFRAME}&limit=${LIMIT}`;

  const res = await fetch(url);
  const text = await res.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${symbol} intraday route: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${symbol}: ${text.slice(0, 500)}`);
  }

  if (!Array.isArray(json)) {
    throw new Error(`${symbol} intraday OHLC route did not return an array`);
  }

  return json;
}

function buildIntradaySymbolRead(symbol, rawBars) {
  const bars = rawBars
    .map(normalizeBar)
    .filter(
      (bar) =>
        Number.isFinite(bar.time) &&
        Number.isFinite(bar.open) &&
        Number.isFinite(bar.high) &&
        Number.isFinite(bar.low) &&
        Number.isFinite(bar.close)
    )
    .sort((a, b) => a.time - b.time);

  if (!bars.length) {
    return {
      ok: false,
      symbol,
      error: "No valid intraday bars",
    };
  }

  const closes = bars.map((bar) => bar.close);
  const ema10Series = ema(closes, 10);
  const ema20Series = ema(closes, 20);

  const lastIndex = bars.length - 1;
  const latest = bars[lastIndex];
  const latestDate = latest.date;

  const todayBars = bars.filter((bar) => bar.date === latestDate);
  const firstToday = todayBars[0] || latest;

  const dayHigh = Math.max(...todayBars.map((bar) => bar.high).filter(Number.isFinite));
  const dayLow = Math.min(...todayBars.map((bar) => bar.low).filter(Number.isFinite));

  const ema10 = round(ema10Series[lastIndex], 3);
  const ema20 = round(ema20Series[lastIndex], 3);

  const redCandleCount = todayBars.filter((bar) => bar.close < bar.open).length;
  const greenCandleCount = todayBars.filter((bar) => bar.close > bar.open).length;

  const todayCloseLocationPct = closeLocationPct({
    high: dayHigh,
    low: dayLow,
    close: latest.close,
  });

  const highToLowDropPct =
    Number.isFinite(dayHigh) && dayHigh > 0 && Number.isFinite(dayLow)
      ? round(((dayHigh - dayLow) / dayHigh) * 100, 3)
      : null;

  const fromOpenPct =
    Number.isFinite(firstToday.open) && firstToday.open > 0
      ? round(((latest.close - firstToday.open) / firstToday.open) * 100, 3)
      : null;

  const latestBelowEma10 =
    Number.isFinite(ema10) && Number.isFinite(latest.close) ? latest.close < ema10 : null;

  const latestBelowEma20 =
    Number.isFinite(ema20) && Number.isFinite(latest.close) ? latest.close < ema20 : null;

  const weakClose = Number.isFinite(todayCloseLocationPct)
    ? todayCloseLocationPct < 35
    : false;

  const highVelocitySelloff =
    (Number.isFinite(fromOpenPct) && fromOpenPct <= -1.5) ||
    (Number.isFinite(highToLowDropPct) && highToLowDropPct >= 2.5);

  return {
    ok: true,
    symbol,
    timeframe: TIMEFRAME,
    latestDate,
    latestTime: latest.time,
    latest: {
      open: latest.open,
      high: latest.high,
      low: latest.low,
      close: latest.close,
      volume: latest.volume,
    },
    today: {
      bars: todayBars.length,
      open: firstToday.open,
      high: dayHigh,
      low: dayLow,
      close: latest.close,
      closeLocationPct: todayCloseLocationPct,
      highToLowDropPct,
      fromOpenPct,
      redCandleCount,
      greenCandleCount,
    },
    ema: {
      ema10,
      ema20,
      latestBelowEma10,
      latestBelowEma20,
    },
    damageFlags: {
      weakClose,
      highVelocitySelloff,
      redDominant: redCandleCount >= Math.max(3, greenCandleCount + 1),
    },
  };
}

async function buildIntradayProxyDamage() {
  const symbols = {};
  const errors = [];

  for (const symbol of ALL_INTRADAY_SYMBOLS) {
    try {
      const rawBars = await fetchIntradayBars(symbol);
      symbols[symbol] = buildIntradaySymbolRead(symbol, rawBars);
      console.log(
        `[IntradayDamage] ${symbol}:`,
        symbols[symbol].ok ? `${symbols[symbol].latestDate} ${symbols[symbol].latest?.close}` : "not ok"
      );
    } catch (err) {
      errors.push({ symbol, error: err.message });
      symbols[symbol] = {
        ok: false,
        symbol,
        error: err.message,
      };
      console.warn(`[IntradayDamage] ${symbol} failed: ${err.message}`);
    }
  }

  const qqq = symbols.QQQ;
  const spy = symbols.SPY;
  const iwm = symbols.IWM;
  const mdy = symbols.MDY;

  const aiValid = AI_SYMBOLS.filter((symbol) => symbols[symbol]?.ok);
  const aiBelowEma20Count = aiValid.filter(
    (symbol) => symbols[symbol]?.ema?.latestBelowEma20 === true
  ).length;
  const aiWeakCloseCount = aiValid.filter(
    (symbol) => symbols[symbol]?.damageFlags?.weakClose === true
  ).length;
  const aiHighVelocitySelloffCount = aiValid.filter(
    (symbol) => symbols[symbol]?.damageFlags?.highVelocitySelloff === true
  ).length;
  const aiRedDominantCount = aiValid.filter(
    (symbol) => symbols[symbol]?.damageFlags?.redDominant === true
  ).length;

  let penalty = 0;
  const warnings = [];

  if (qqq?.ema?.latestBelowEma10 === true) {
    penalty += 10;
    warnings.push("QQQ below 1H EMA10");
  }

  if (qqq?.ema?.latestBelowEma20 === true) {
    penalty += 15;
    warnings.push("QQQ below 1H EMA20");
  }

  if (qqq?.damageFlags?.weakClose === true) {
    penalty += 15;
    warnings.push("QQQ closing weak in today's intraday range");
  }

  if (qqq?.damageFlags?.highVelocitySelloff === true) {
    penalty += 25;
    warnings.push("QQQ high-velocity intraday selloff active");
  }

  if (qqq?.today?.redCandleCount >= 3) {
    penalty += 10;
    warnings.push(`QQQ has ${qqq.today.redCandleCount} red 1H candle(s) today`);
  }

  if (spy?.damageFlags?.highVelocitySelloff === true) {
    penalty += 8;
    warnings.push("SPY intraday selloff confirms broad index pressure");
  }

  if (iwm?.ema?.latestBelowEma20 === true || mdy?.ema?.latestBelowEma20 === true) {
    penalty += 8;
    warnings.push("IWM/MDY intraday participation weakening");
  }

  if (aiBelowEma20Count >= 5) {
    penalty += 18;
    warnings.push(`${aiBelowEma20Count} AI leaders below 1H EMA20`);
  }

  if (aiWeakCloseCount >= 4) {
    penalty += 15;
    warnings.push(`${aiWeakCloseCount} AI leaders closing weak intraday`);
  }

  if (aiHighVelocitySelloffCount >= 3) {
    penalty += 20;
    warnings.push(`${aiHighVelocitySelloffCount} AI leaders in high-velocity selloff`);
  }

  if (aiRedDominantCount >= 5) {
    penalty += 10;
    warnings.push(`${aiRedDominantCount} AI leaders have red-dominant 1H structure`);
  }

  const score = clamp(100 - penalty);

  let label = "INTRADAY_PROXY_STABLE";
  if (score <= 35) {
    label = "INTRADAY_DISTRIBUTION_ACTIVE";
  } else if (score <= 50) {
    label = "INTRADAY_DAMAGE_ELEVATED";
  } else if (score <= 65) {
    label = "INTRADAY_DAMAGE_WATCH";
  }

  const output = {
    ok: true,
    engine: "engine25.intradayProxyDamage.v0.1",
    generatedAtUtc: new Date().toISOString(),
    timeframe: TIMEFRAME,
    score,
    label,
    inputs: {
      indexSymbols: INDEX_SYMBOLS,
      aiSymbols: AI_SYMBOLS,
      symbols,
      qqqDamage: qqq || null,
      spyDamage: spy || null,
      iwmDamage: iwm || null,
      mdyDamage: mdy || null,
      aiValidCount: aiValid.length,
      aiBelowEma20Count,
      aiWeakCloseCount,
      aiHighVelocitySelloffCount,
      aiRedDominantCount,
      rawPenalty: penalty,
      errors,
    },
    warnings,
  };

  fs.writeFileSync(INTRADAY_DAMAGE_FILE, JSON.stringify(output, null, 2));

  return output;
}

function applyIntradayDamage(result, intradayProxyDamage) {
  if (!result?.ok || !intradayProxyDamage?.ok) return result;

  const label = intradayProxyDamage.label;
  const damageScore = Number(intradayProxyDamage.score);

  const next = {
    ...result,
    components: {
      ...(result.components || {}),
      intradayProxyDamage,
    },
    warnings: [
      ...(intradayProxyDamage.warnings || []),
      ...(result.warnings || []),
    ].filter(Boolean).slice(0, 40),
  };

  next.intradayProxyDamage = intradayProxyDamage;

  if (label === "INTRADAY_DISTRIBUTION_ACTIVE") {
    next.score = Math.min(Number(result.score ?? 50), 48);
    next.bias = "NEUTRAL_WAIT";
    next.riskLevel = "HIGH";

    next.tradePermission = {
      ...(result.tradePermission || {}),
      longScalps: false,
      shortScalps: true,
      swingLongs: false,
      swingShorts: true,
      engine22Mode: "NO_NORMAL_LONGS_INTRADAY_DISTRIBUTION_ACTIVE",
      sizeMultiplier: Math.min(Number(result.tradePermission?.sizeMultiplier ?? 0.5), 0.25),
      notes: [
        ...((result.tradePermission && result.tradePermission.notes) || []),
        "Intraday distribution is active. Do not use yesterday's daily proxy read for long permission.",
        "Only consider shorts or defensive trades if Engine 22/Engine 6 confirm structure.",
      ],
    };

    next.esPermission = {
      ...(result.esPermission || {}),
      bias: "NEUTRAL_WAIT",
      mode: "NO_NORMAL_LONGS_INTRADAY_DISTRIBUTION_ACTIVE",
      longScalps: false,
      shortScalps: true,
      swingLongs: false,
      swingShorts: true,
      riskLevel: "HIGH",
      sizeMultiplier: Math.min(Number(result.esPermission?.sizeMultiplier ?? 0.5), 0.25),
      intradayDamageLabel: label,
      intradayDamageScore: damageScore,
      notes: [
        ...((result.esPermission && result.esPermission.notes) || []),
        "QQQ / AI intraday damage is active.",
        "Long permission requires reclaim/confirmation after intraday distribution cools.",
      ],
    };
  } else if (label === "INTRADAY_DAMAGE_ELEVATED") {
    next.score = Math.min(Number(result.score ?? 50), 55);
    next.riskLevel = next.riskLevel === "HIGH" ? "HIGH" : "ELEVATED";

    next.tradePermission = {
      ...(result.tradePermission || {}),
      swingLongs: false,
      engine22Mode: "A_PLUS_ONLY_INTRADAY_DAMAGE",
      sizeMultiplier: Math.min(Number(result.tradePermission?.sizeMultiplier ?? 0.5), 0.5),
      notes: [
        ...((result.tradePermission && result.tradePermission.notes) || []),
        "Intraday damage is elevated. A+ setups only until QQQ/AI reclaim.",
      ],
    };

    next.esPermission = {
      ...(result.esPermission || {}),
      mode: "A_PLUS_ONLY_INTRADAY_DAMAGE_REQUIRES_RECLAIM",
      swingLongs: false,
      sizeMultiplier: Math.min(Number(result.esPermission?.sizeMultiplier ?? 0.5), 0.5),
      intradayDamageLabel: label,
      intradayDamageScore: damageScore,
      notes: [
        ...((result.esPermission && result.esPermission.notes) || []),
        "Intraday QQQ/AI damage requires reclaim before increasing ES long permission.",
      ],
    };
  } else if (label === "INTRADAY_DAMAGE_WATCH") {
    next.esPermission = {
      ...(result.esPermission || {}),
      intradayDamageLabel: label,
      intradayDamageScore: damageScore,
      notes: [
        ...((result.esPermission && result.esPermission.notes) || []),
        "Intraday damage watch is active; require confirmation before adding size.",
      ],
    };
  }

  next.summary = {
    ...(result.summary || {}),
    plainEnglish:
      label === "INTRADAY_DISTRIBUTION_ACTIVE"
        ? "Intraday distribution is active in QQQ / AI leadership. Engine 25 is overriding stale daily strength and blocking normal ES long permission until reclaim/confirmation."
        : label === "INTRADAY_DAMAGE_ELEVATED"
          ? "Intraday damage is elevated. Engine 25 requires A+ quality and reclaim confirmation before ES long permission improves."
          : result.summary?.plainEnglish,
  };

  return next;
}

async function main() {
  const startedAt = new Date().toISOString();

  const output = {
    ok: false,
    engine: "engine25.marketHealth.updateJob.v0.2",
    startedAt,
    finishedAt: null,
    result: null,
    errors: [],
  };

  try {
    console.log("========================================");
    console.log("Engine 25 Market Health Update");
    console.log("Reading macro + market + FMP + intraday damage");
    console.log("========================================");

    const macroData = readJsonSafe(MACRO_FILE, true);
    const marketData = readJsonSafe(MARKET_FILE, true);
    const fmpData = readJsonSafe(FMP_FILE, false);
    const sectorHealthData = readJsonSafe(SECTOR_FILE, false);
    const esTechnicalContextData = readJsonSafe(ES_TECH_FILE, false);

    const baseResult = computeEngine25MarketHealth({
      macroData,
      marketData,
      fmpData,
      sectorHealthData,
      esTechnicalContextData,
    });

    const intradayProxyDamage = await buildIntradayProxyDamage();
    const result = applyIntradayDamage(baseResult, intradayProxyDamage);

    output.ok = result.ok;
    output.finishedAt = new Date().toISOString();
    output.result = result;

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));

    console.log("\n========================================");
    console.log("Engine 25 Market Health Complete");
    console.log("OK:", result.ok);
    console.log("Score:", result.score);
    console.log("Regime:", result.regime);
    console.log("Bias:", result.bias);
    console.log("Risk:", result.riskLevel);
    console.log("Intraday:", intradayProxyDamage.label, intradayProxyDamage.score);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("Intraday file:", INTRADAY_DAMAGE_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          engine: result.engine,
          score: result.score,
          regime: result.regime,
          bias: result.bias,
          riskLevel: result.riskLevel,
          intradayProxyDamage: {
            score: intradayProxyDamage.score,
            label: intradayProxyDamage.label,
            warnings: intradayProxyDamage.warnings,
          },
          tradePermission: result.tradePermission,
          esPermission: result.esPermission,
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );
  } catch (err) {
    output.ok = false;
    output.finishedAt = new Date().toISOString();
    output.errors.push({
      message: err.message,
      stack: err.stack,
    });

    fs.writeFileSync(
      path.join(DATA_DIR, "engine25-market-health-error.json"),
      JSON.stringify(output, null, 2)
    );

    console.error("Engine 25 Market Health Failed:");
    console.error(err);

    process.exit(1);
  }
}

main();
