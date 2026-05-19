// services/core/routes/engine25MarketHealth.js

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const MARKET_HEALTH_FILE = path.join(DATA_DIR, "engine25-market-health.json");
const VALIDATION_FILE = path.join(DATA_DIR, "engine25-feed-validation.json");

let ENGINE25_UPDATE_RUNNING = false;

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

function runEngine25FullUpdate() {
  return new Promise((resolve, reject) => {
    if (ENGINE25_UPDATE_RUNNING) {
      return reject(new Error("Engine 25 update already running"));
    }

    ENGINE25_UPDATE_RUNNING = true;

    const child = spawn("node", ["jobs/updateEngine25Full.js"], {
      cwd: CORE_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      ENGINE25_UPDATE_RUNNING = false;

      if (code !== 0) {
        return reject(
          new Error(
            `Engine 25 full update failed with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
          )
        );
      }

      resolve({ stdout, stderr });
    });

    child.on("error", (err) => {
      ENGINE25_UPDATE_RUNNING = false;
      reject(err);
    });
  });
}

// Manual/live trigger
router.post("/engine25/update", async (req, res) => {
  try {
    const startedAt = new Date().toISOString();

    const result = await runEngine25FullUpdate();

    const marketHealth = readJsonSafe(MARKET_HEALTH_FILE);
    const validation = readJsonSafe(VALIDATION_FILE);

    return res.json({
      ok: true,
      engine: "engine25.update.route",
      startedAt,
      finishedAt: new Date().toISOString(),
      updateRunning: ENGINE25_UPDATE_RUNNING,
      validation: validation?.ok === true ? validation : validation,
      marketHealth: marketHealth?.ok === true
        ? {
            ok: marketHealth.ok,
            score: marketHealth.score,
            regime: marketHealth.regime,
            bias: marketHealth.bias,
            riskLevel: marketHealth.riskLevel,
            tradePermission: marketHealth.tradePermission,
            esPermission: marketHealth.esPermission,
            warnings: marketHealth.warnings || [],
            summary: marketHealth.summary || null,
          }
        : marketHealth,
      logs: {
        stdoutTail: result.stdout.slice(-4000),
        stderrTail: result.stderr.slice(-2000),
      },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      engine: "engine25.update.route",
      error: "engine25_update_failed",
      detail: err.message,
    });
  }
});

// Full Engine 25 file
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

// Summary for dashboard / Engine 6
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
