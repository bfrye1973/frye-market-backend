// services/core/routes/esReactionScore.js

import express from "express";
import fs from "fs";
import path from "path";
import { computeEngine3EsReactionQuality } from "../logic/engine3EsReactionQuality.js";

const router = express.Router();

const CORE_DIR = process.cwd();
const MANUAL_STRUCTURES_FILE = path.join(CORE_DIR, "data", "es-smz-manual-structures.json");

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed ${r.status}: ${url}`);
  return r.json();
}

router.get("/", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "ES").toUpperCase();
    const tf = String(req.query.tf || "10m");

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const manual = readJsonSafe(MANUAL_STRUCTURES_FILE, { structures: [] });

    const shelvesResp = await fetchJson(`${baseUrl}/api/v1/es-smz-shelves?symbol=${encodeURIComponent(symbol)}`);

    const candlesResp = await fetchJson(
      `${baseUrl}/api/v1/futures/ohlc?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}&limit=100`
    );

    const candles = candlesResp.bars || [];
    const last = candles[candles.length - 1] || {};
    const price = Number(shelvesResp.current_price ?? last.close);

    const result = computeEngine3EsReactionQuality({
      price,
      candles,
      manualStructures: manual.structures || [],
      shelves: shelvesResp.levels || [],
    });

    return res.json({
      ok: true,
      ...result,
      meta: {
        tf,
        resolvedSymbol: candlesResp.resolvedSymbol || null,
        candles: candles.length,
        manualZones: (manual.structures || []).length,
        shelves: (shelvesResp.levels || []).length,
      },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "ES_REACTION_SCORE_FAILED",
      message: err.message,
    });
  }
});

export default router;
