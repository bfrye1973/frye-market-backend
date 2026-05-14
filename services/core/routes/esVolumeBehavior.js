// services/core/routes/esVolumeBehavior.js

import express from "express";
import { computeEsVolumeBehavior } from "../logic/esVolumeBehaviorEngine.js";

export const esVolumeBehaviorRouter = express.Router();

function normalizeTf(tf) {
  const value = String(tf || "10m").trim();
  return value || "10m";
}

function normalizeSymbol(symbol) {
  const value = String(symbol || "ES").trim().toUpperCase();
  return value || "ES";
}

function getBaseUrl(req) {
  const envBase =
    process.env.CORE_BASE_URL ||
    process.env.PUBLIC_CORE_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL;

  if (envBase) return envBase.replace(/\/$/, "");

  const protocol = req.protocol || "http";
  const host = req.get("host") || "127.0.0.1:10000";
  return `${protocol}://${host}`;
}

async function fetchEsFuturesBars(req, { symbol, tf, limit = 100 }) {
  const baseUrl = getBaseUrl(req);
  const url =
    `${baseUrl}/api/v1/futures/ohlc` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=${encodeURIComponent(tf)}` +
    `&limit=${encodeURIComponent(limit)}`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Futures OHLC request failed: HTTP ${response.status}`);
  }

  const json = await response.json();

  if (!json?.ok) {
    throw new Error(json?.error || "Futures OHLC returned ok=false");
  }

  if (!Array.isArray(json.bars)) {
    throw new Error("Futures OHLC response missing bars array");
  }

  return {
    url,
    json,
    bars: json.bars,
  };
}

esVolumeBehaviorRouter.get("/es-volume-behavior", async (req, res) => {
  const updatedAtUtc = new Date().toISOString();

  try {
    const symbol = normalizeSymbol(req.query.symbol);
    const tf = normalizeTf(req.query.tf || req.query.timeframe);
    const limit = Number(req.query.limit || 100);

    if (symbol !== "ES") {
      return res.status(200).json({
        ok: false,
        updatedAtUtc,
        symbol,
        tf,
        engine: "ENGINE4_ES_VOLUME",
        error: "ES volume behavior route currently supports symbol=ES only.",
      });
    }

    const fetched = await fetchEsFuturesBars(req, {
      symbol,
      tf,
      limit: Number.isFinite(limit) ? limit : 100,
    });

    const engine4EsVolume = computeEsVolumeBehavior({
      symbol,
      tf,
      bars: fetched.bars,
    });

    return res.status(200).json({
      ok: true,
      updatedAtUtc,

      symbol,
      tf,
      engine: "ENGINE4_ES_VOLUME",

      engine4EsVolume,

      meta: {
        source: "futures_ohlc",
        futuresRoute: "/api/v1/futures/ohlc",
        resolvedSymbol: fetched.json?.resolvedSymbol || null,
        timeframe: fetched.json?.timeframe || tf,
        count: fetched.json?.count ?? fetched.bars.length,
        barsUsed: fetched.bars.length,
        lastBarTime: fetched.bars?.[fetched.bars.length - 1]?.time ?? null,
        impulseWindowBars: 4,
        avgVolLookback: 20,
        confirmationRule:
          "burstVolAvg >= avgVol20*1.35 AND highVolumeCandles>=2 AND volumeTrend=EXPANDING AND priceDisplacement",
      },

      raw: {
        futuresOhlc: {
          symbol: fetched.json?.symbol,
          resolvedSymbol: fetched.json?.resolvedSymbol,
          timeframe: fetched.json?.timeframe,
          count: fetched.json?.count,
          firstBar: fetched.json?.firstBar,
          lastBar: fetched.json?.lastBar,
        },
      },
    });
  } catch (err) {
    return res.status(200).json({
      ok: false,
      updatedAtUtc,
      symbol: normalizeSymbol(req.query.symbol),
      tf: normalizeTf(req.query.tf || req.query.timeframe),
      engine: "ENGINE4_ES_VOLUME",
      error: err?.message || String(err),
    });
  }
});
