// services/core/routes/engine25MarketHealth.js

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const MARKET_HEALTH_FILE = path.join(DATA_DIR, "engine25-market-health.json");
const VALIDATION_FILE = path.join(DATA_DIR, "engine25-feed-validation.json");

function readJsonSafe(file) {
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      missing: true,
      file,
      error: `Missing file: ${file}`,
    };
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return {
      ok: false,
      file,
      error: `Invalid JSON: ${err.message}`,
    };
  }
}

router.get("/engine25/market-health", (_req, res) => {
  const marketHealth = readJsonSafe(MARKET_HEALTH_FILE);
  const validation = readJsonSafe(VALIDATION_FILE);

  if (!marketHealth?.ok) {
    return res.status(503).json({
      ok: false,
      engine: "engine25.marketHealth.route",
      error: "engine25_market_health_unavailable",
      detail: marketHealth?.error || "Engine 25 market health file is not ready.",
      validation,
      dataFile: MARKET_HEALTH_FILE,
    });
  }

  return res.json({
    ok: true,
    engine: "engine25.marketHealth.route",
    servedAt: new Date().toISOString(),
    validation: validation?.ok === true ? validation : null,
    data: marketHealth,
  });
});

router.get("/engine25/market-health/summary", (_req, res) => {
  const marketHealth = readJsonSafe(MARKET_HEALTH_FILE);
  const validation = readJsonSafe(VALIDATION_FILE);

  if (!marketHealth?.ok) {
    return res.status(503).json({
      ok: false,
      engine: "engine25.marketHealth.summaryRoute",
      error: "engine25_market_health_unavailable",
      detail: marketHealth?.error || "Engine 25 market health file is not ready.",
      validation,
    });
  }

  const components = marketHealth.components || {};

  return res.json({
    ok: true,
    engine: "engine25.marketHealth.summaryRoute",
    servedAt: new Date().toISOString(),
    score: marketHealth.score,
    regime: marketHealth.regime,
    bias: marketHealth.bias,
    riskLevel: marketHealth.riskLevel,
    tradePermission: marketHealth.tradePermission || null,
    esPermission: marketHealth.esPermission || null,
    componentScores: {
      labor: components.labor?.score ?? null,
      creditStress: components.creditStress?.score ?? null,
      creditFragility: components.creditFragility?.score ?? null,
      bondMarket: components.bondMarket?.score ?? null,
      liquidity: components.liquidity?.score ?? null,
      inflation: components.inflation?.score ?? null,
      marketTrend: components.marketTrend?.score ?? null,
      volatility: components.volatility?.score ?? null,
      sectorRotation: components.sectorRotation?.score ?? null,
      aiLeadership: components.aiLeadership?.score ?? null,
      eventRisk: components.eventRisk?.score ?? null,
      macroPressure: components.macroPressure?.score ?? null,
    },
    warnings: marketHealth.warnings || [],
    summary: marketHealth.summary || null,
    validation: validation?.ok === true
      ? {
          ok: validation.ok,
          canScoreEngine25: validation.gate?.canScoreEngine25 ?? null,
          warnings: validation.warnings || [],
          errors: validation.errors || [],
        }
      : null,
  });
});

export default router;
