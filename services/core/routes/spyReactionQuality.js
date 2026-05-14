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
  return resp?.bars || resp?.candles || resp?.results || [];
}

router.get("/", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "10m");

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const ohlcResp = await fetchJson(
      `${baseUrl}/api/v1/ohlc?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}&limit=120`
    );

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
        source: "/api/v1/ohlc",
        route: "/api/v1/spy-reaction-quality",
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
