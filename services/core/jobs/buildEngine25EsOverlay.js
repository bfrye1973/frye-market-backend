// services/core/jobs/buildEngine25EsOverlay.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ENGINE = "engine25.esOverlay.v0.1";
const SYMBOL = "ES";
const BACKEND_BASE =
  process.env.BACKEND_BASE || "https://frye-market-backend-1.onrender.com";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const MARKET_HEALTH_FILE = path.join(DATA_DIR, "engine25-market-health.json");
const ES_TECH_FILE = path.join(DATA_DIR, "engine25-es-technical-context.json");
const OUTPUT_FILE = path.join(DATA_DIR, "engine25-es-overlay.json");

const ES_DAILY_PATH = "/api/v1/futures/ohlc?symbol=ES&timeframe=1d&limit=5";
const ES_DAILY_URL = `${BACKEND_BASE}${ES_DAILY_PATH}`;

function readJsonSafe(file, required = true) {
  if (!fs.existsSync(file)) {
    if (required) {
      throw new Error(`Missing required data file: ${file}`);
    }
    return null;
  }

  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getComponentScore(marketHealth, key) {
  return toNumber(marketHealth?.components?.[key]?.score, null);
}

function getFallbackEsTechnicalContext(esTechnicalData) {
  if (!esTechnicalData) return null;

  return {
    state: esTechnicalData.technicalRead?.state || null,
    bias: esTechnicalData.technicalRead?.bias || null,
    permission: esTechnicalData.technicalRead?.permission || null,
    requiredAction: esTechnicalData.technicalRead?.requiredAction || null,
    sizeCap: esTechnicalData.technicalRead?.sizeCap ?? null,
    notes: esTechnicalData.technicalRead?.notes || [],
    rules: esTechnicalData.technicalRead?.rules || {},
    daily: esTechnicalData.daily || null,
    fourHour: esTechnicalData.fourHour || null,
    oneHour: esTechnicalData.oneHour || null,
    tenMinute: esTechnicalData.tenMinute || null,
  };
}

function resolveEsTechnicalContext(marketHealth, esTechnicalData) {
  if (marketHealth?.esTechnicalContext) {
    return marketHealth.esTechnicalContext;
  }

  return getFallbackEsTechnicalContext(esTechnicalData);
}

function dateFromUnixSeconds(seconds) {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function deriveColor({
  score,
  sizeMultiplier,
  distributionPressure,
  breadthParticipation,
  creditFragility,
}) {
  if (sizeMultiplier <= 0.25 || score < 45) {
    return "red";
  }

  if (
    sizeMultiplier <= 0.5 ||
    distributionPressure < 35 ||
    breadthParticipation < 35 ||
    creditFragility < 35
  ) {
    return "orange";
  }

  if (score < 70) {
    return "yellow";
  }

  return "green";
}

function deriveLabel({
  longScalpsAllowed,
  shortScalpsAllowed,
  sizeMultiplier,
  score,
  esMode,
}) {
  const rawMode = String(esMode || "");

  if (!longScalpsAllowed && shortScalpsAllowed) {
    return "RISK OFF";
  }

  if (sizeMultiplier <= 0.25 || score < 45) {
    return "BLOCKED";
  }

  if (rawMode.includes("A_PLUS") || rawMode.includes("A+")) {
    return "A+ LONGS ONLY";
  }

  if (longScalpsAllowed && sizeMultiplier < 1) {
    return "SELECTIVE LONGS";
  }

  if (longScalpsAllowed) {
    return "LONGS OK";
  }

  return "NEUTRAL / WAIT";
}

async function fetchLatestEsDailyCandle() {
  const res = await fetch(ES_DAILY_URL);
  const text = await res.text();

  let json;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid ES daily candle JSON: ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`ES daily candle fetch failed HTTP ${res.status}: ${text.slice(0, 500)}`);
  }

  if (!Array.isArray(json)) {
    throw new Error("ES daily candle endpoint did not return an array");
  }

  if (json.length === 0) {
    throw new Error("ES daily candle endpoint returned an empty array");
  }

  return json[json.length - 1];
}

async function main() {
  console.log("========================================");
  console.log("Engine 25 ES Overlay Build");
  console.log("Latest-day overlay JSON");
  console.log("========================================");

  const marketHealth = readJsonSafe(MARKET_HEALTH_FILE, true);
  const esTechnicalData = readJsonSafe(ES_TECH_FILE, false);

  const esTechnicalContext = resolveEsTechnicalContext(
    marketHealth,
    esTechnicalData
  );

  const latestDailyCandle = await fetchLatestEsDailyCandle();

  const components = marketHealth.components || {};
  const esPermission = marketHealth.esPermission || {};

  const score = toNumber(marketHealth.score, null);
  const sizeMultiplier = toNumber(esPermission.sizeMultiplier, 1);

  const creditStress = getComponentScore(marketHealth, "creditStress");
  const creditFragility = getComponentScore(marketHealth, "creditFragility");
  const macroPressure = getComponentScore(marketHealth, "macroPressure");
  const distributionPressure = getComponentScore(
    marketHealth,
    "distributionPressure"
  );
  const breadthParticipation = getComponentScore(
    marketHealth,
    "breadthParticipation"
  );
  const marketTrend = getComponentScore(marketHealth, "marketTrend");
  const aiLeadership = getComponentScore(marketHealth, "aiLeadership");

  const esMode = esPermission.mode || esTechnicalContext?.permission || null;
  const longScalpsAllowed = Boolean(esPermission.longScalps);
  const shortScalpsAllowed = Boolean(esPermission.shortScalps);

  const color = deriveColor({
    score,
    sizeMultiplier,
    distributionPressure,
    breadthParticipation,
    creditFragility,
  });

  const label = deriveLabel({
    longScalpsAllowed,
    shortScalpsAllowed,
    sizeMultiplier,
    score,
    esMode,
  });

  const item = {
    date: dateFromUnixSeconds(latestDailyCandle.time),
    time: latestDailyCandle.time,
    esClose: toNumber(latestDailyCandle.close, null),

    score,
    regime: marketHealth.regime || null,
    bias: marketHealth.bias || null,

    esBias: esPermission.bias || esTechnicalContext?.bias || null,
    esMode,
    longScalpsAllowed,
    shortScalpsAllowed,

    technicalState:
      esPermission.technicalState || esTechnicalContext?.state || null,

    requiredAction:
      esPermission.requiredTechnicalAction ||
      esTechnicalContext?.requiredAction ||
      null,

    sizeMultiplier,

    macroPressure,
    creditStress,
    creditFragility,
    distributionPressure,
    breadthParticipation,
    marketTrend,
    aiLeadership,

    color,
    label,

    warnings: Array.isArray(marketHealth.warnings)
      ? marketHealth.warnings
      : [],

    dailyClose: toNumber(esTechnicalContext?.daily?.close, null),
    dailyEma20: toNumber(esTechnicalContext?.daily?.ema20, null),
    dailyAboveEma20:
      typeof esTechnicalContext?.daily?.aboveEma20 === "boolean"
        ? esTechnicalContext.daily.aboveEma20
        : null,

    fourHourAboveEma50:
      typeof esTechnicalContext?.fourHour?.aboveEma50 === "boolean"
        ? esTechnicalContext.fourHour.aboveEma50
        : null,

    oneHourAboveEma20:
      typeof esTechnicalContext?.oneHour?.aboveEma20 === "boolean"
        ? esTechnicalContext.oneHour.aboveEma20
        : null,

    tenMinuteAboveEma20:
      typeof esTechnicalContext?.tenMinute?.aboveEma20 === "boolean"
        ? esTechnicalContext.tenMinute.aboveEma20
        : null,
  };

  const output = {
    ok: true,
    engine: ENGINE,
    symbol: SYMBOL,
    generatedAtUtc: new Date().toISOString(),
    source: {
      marketHealthFile: "engine25-market-health.json",
      esTechnicalFile: "engine25-es-technical-context.json",
      esCandleSource: ES_DAILY_PATH,
      backendBase: BACKEND_BASE,
    },
    items: [item],
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

  console.log("\n========================================");
  console.log("Engine 25 ES Overlay Complete");
  console.log("OK:", output.ok);
  console.log("Score:", item.score);
  console.log("Regime:", item.regime);
  console.log("Label:", item.label);
  console.log("Color:", item.color);
  console.log("Technical State:", item.technicalState);
  console.log("ES Close:", item.esClose);
  console.log("Wrote:", OUTPUT_FILE);
  console.log("========================================");

  console.log(
    JSON.stringify(
      {
        ok: output.ok,
        engine: output.engine,
        symbol: output.symbol,
        label: item.label,
        color: item.color,
        technicalState: item.technicalState,
        esClose: item.esClose,
        score: item.score,
        regime: item.regime,
        outputFile: OUTPUT_FILE,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("[Engine25EsOverlay] FAILED:");
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
