// services/core/routes/esReactionScore.js

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeEngine3EsReactionQuality } from "../logic/engine3EsReactionQuality.js";
import { maybeSendImpulseIgnitionAlert } from "../logic/alerts/instantImpulseIgnitionPushover.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");

const MANUAL_STRUCTURES_FILE = path.join(
  CORE_DIR,
  "data",
  "es-smz-manual-structures.json"
);

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

function normalizeCandles(candlesResp) {
  return (
    candlesResp?.bars ||
    candlesResp?.candles ||
    candlesResp?.results ||
    []
  );
}

router.get("/", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "ES").toUpperCase();
    const tf = String(req.query.tf || "10m");

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const manual = readJsonSafe(MANUAL_STRUCTURES_FILE, { structures: [] });

    const shelvesResp = await fetchJson(
      `${baseUrl}/api/v1/es-smz-shelves?symbol=${encodeURIComponent(symbol)}`
    );

    const candlesResp = await fetchJson(
      `${baseUrl}/api/v1/futures/ohlc?symbol=${encodeURIComponent(
        symbol
      )}&timeframe=${encodeURIComponent(tf)}&limit=100&debug=1`
    );

    const candles = normalizeCandles(candlesResp);
    const last = candles[candles.length - 1] || {};

    const price = Number(
      shelvesResp.current_price ??
        shelvesResp.price ??
        last.close ??
        last.c
    );

    const result = computeEngine3EsReactionQuality({
      price,
      candles,
      manualStructures: manual.structures || [],
      shelves: shelvesResp.levels || [],
    });

    const lastCandle = candles[candles.length - 1] || {};
    const lastCandleTime =
      lastCandle.time ??
      lastCandle.timestamp ??
      lastCandle.t ??
      null;

    const impulseAlert = await maybeSendImpulseIgnitionAlert({
      symbol,
      tf,
      price: result.price ?? price,
      lastCandleTime,
      impulseIgnition: result.impulseIgnition,
    });
    
    return res.json({
      ok: true,
      ...result,
      meta: {
        tf,
        resolvedSymbol:
          candlesResp.resolvedSymbol ||
          candlesResp.resolved_symbol ||
          candlesResp.symbol ||
          null,
        candles: candles.length,
        manualZones: (manual.structures || []).length,
        shelves: (shelvesResp.levels || []).length,
        impulseIgnitionEnabled: true,
        impulseAlert,
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
