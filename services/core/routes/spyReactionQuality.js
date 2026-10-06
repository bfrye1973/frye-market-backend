// services/core/routes/spyReactionQuality.js

import express from "express";
import { computeEngine3SpyReactionQualityTimeline } from "../logic/engine3SpyReactionQualityTimeline.js";

const router = express.Router();

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed ${r.status}: ${url}`);
  return r.json();
}

function normalizeCandles(resp) {
  // /api/v1/ohlc currently returns a raw array:
  // [{ time, open, high, low, close, volume }, ...]
  if (Array.isArray(resp)) return resp;

  // Keep fallbacks in case OHLC route shape changes later.
  return resp?.bars || resp?.candles || resp?.results || [];
}

router.get("/", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "10m");
    const limit = Number(req.query.limit || 120);

    const safeLimit =
      Number.isFinite(limit) && limit > 0
        ? Math.min(Math.max(Math.floor(limit), 30), 500)
        : 120;

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const ohlcUrl =
      `${baseUrl}/api/v1/ohlc?symbol=${encodeURIComponent(symbol)}` +
      `&timeframe=${encodeURIComponent(tf)}` +
      `&limit=${encodeURIComponent(safeLimit)}`;

    const ohlcResp = await fetchJson(ohlcUrl);
    const candles = normalizeCandles(ohlcResp);

    const result = computeEngine3SpyReactionQualityTimeline({
      symbol,
      tf,
      candles,
    });

    return res.json({
      ...result,
      meta: {
        candles: candles.length,
        requestedLimit: safeLimit,
        source: "/api/v1/ohlc",
        route: "/api/v1/spy-reaction-quality",
        ohlcShape: Array.isArray(ohlcResp) ? "array" : "object",
        lastCandleTime: candles[candles.length - 1]?.time ?? null,
      },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "SPY_REACTION_QUALITY_FAILED",
      message: err.message,
    });
  }
});

export default router;
