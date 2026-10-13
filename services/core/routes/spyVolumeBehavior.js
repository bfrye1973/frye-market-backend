// services/core/routes/spyVolumeBehavior.js

import express from "express";
import { computeSpyTimelineVolume } from "../logic/spyTimelineVolumeEngine.js";

export const spyVolumeBehaviorRouter = express.Router();

function normalizeTf(tf) {
  const value = String(tf || "10m").trim();
  return value || "10m";
}

function normalizeSymbol(symbol) {
  const value = String(symbol || "SPY").trim().toUpperCase();
  return value || "SPY";
}

function getBaseUrl(req) {
  // Engine 4 SPY timeline volume should call local core API from inside Render.
  // Keep this isolated from public Render URL/env self-fetch issues.
  return "http://127.0.0.1:10000";
}

async function fetchSpyBars(req, { symbol, tf, limit = 100 }) {
  const baseUrl = getBaseUrl(req);

  const url =
    `${baseUrl}/api/v1/ohlc` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=${encodeURIComponent(tf)}` +
    `&limit=${encodeURIComponent(limit)}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`SPY OHLC request failed: HTTP ${response.status}`);
  }

  const json = await response.json();

  // SPY /api/v1/ohlc currently returns a raw array:
  // [
  //   { time, open, high, low, close, volume },
  //   ...
  // ]
  if (!Array.isArray(json)) {
    throw new Error("SPY OHLC response expected raw candle array.");
  }

  return {
    url,
    bars: json,
  };
}

spyVolumeBehaviorRouter.get("/spy-volume-behavior", async (req, res) => {
  const updatedAtUtc = new Date().toISOString();

  try {
    const symbol = normalizeSymbol(req.query.symbol);
    const tf = normalizeTf(req.query.tf || req.query.timeframe);
    const limit = Number(req.query.limit || 100);

    if (symbol !== "SPY") {
      return res.status(200).json({
        ok: false,
        updatedAtUtc,
        symbol,
        tf,
        engine: "ENGINE4_SPY_TIMELINE_VOLUME",
        error: "SPY timeline volume route currently supports symbol=SPY only.",
      });
    }

    const fetched = await fetchSpyBars(req, {
      symbol,
      tf,
      limit: Number.isFinite(limit) ? limit : 100,
    });

    const engine4Volume = computeSpyTimelineVolume({
      symbol,
      tf,
      bars: fetched.bars,
    });

    return res.status(200).json({
      ...engine4Volume,

      // Stable aliases for Engine 22.
      engine: "ENGINE4_SPY_TIMELINE_VOLUME",
      updatedAtUtc,

      // Nested copy for future compatibility if Engine 22 wants a block.
      engine4Volume,

      meta: {
        source: "ohlc",
        ohlcRoute: "/api/v1/ohlc",
        barsUsed: fetched.bars.length,
        lastBarTime: fetched.bars?.[fetched.bars.length - 1]?.time ?? null,
        impulseWindowBars: 4,
        avgVolLookback: 20,
        recentHighLowLookback: 50,
        confirmationRule:
          "burstVolAvg >= avgVol20*1.35 AND highVolumeCandles>=2 AND volumeTrend=EXPANDING AND priceDisplacementStrong",
      },

      raw: {
        ohlc: {
          count: fetched.bars.length,
          firstBar: fetched.bars?.[0] ?? null,
          lastBar: fetched.bars?.[fetched.bars.length - 1] ?? null,
        },
      },
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      updatedAtUtc,
      symbol: normalizeSymbol(req.query.symbol),
      tf: normalizeTf(req.query.tf || req.query.timeframe),
      engine: "ENGINE4_SPY_TIMELINE_VOLUME",
      error: err?.message || String(err),
    });
  }
});
