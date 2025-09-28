// routes/ohlc.js
// ESM Express router that aliases /api/v1/ohlc to Polygon OHLC
import express from "express";

// If your runtime is Node 18+ (Render default), global fetch exists.
// If you're on Node 16, uncomment the next line and add "node-fetch" to dependencies.
// import fetch from "node-fetch";

export const ohlcRouter = express.Router();

/**
 * GET /api/v1/ohlc?symbol=SPY&timeframe=10m&limit=1500
 * Returns: [{ time, open, high, low, close, volume }, ...]
 * NOTE: time is EPOCH SECONDS (10-digit), not ms.
 */
ohlcRouter.get("/", async (req, res) => {
  try {
    const symbol    = String(req.query.symbol || "SPY").toUpperCase();
    const timeframe = String(req.query.timeframe || "10m").toLowerCase();
    const limit     = Math.min(Number(req.query.limit || 1500), 5000);

    // timeframe → Polygon params + how far back to pull
    const tfMap = {
      "1m":  { mult: 1,  span: "minute", backDays: 5  },
      "3m":  { mult: 3,  span: "minute", backDays: 10 },
      "5m":  { mult: 5,  span: "minute", backDays: 20 },
      "10m": { mult: 10, span: "minute", backDays: 45 },
      "15m": { mult: 15, span: "minute", backDays: 60 },
      "30m": { mult: 30, span: "minute", backDays: 90 },
      "1h":  { mult: 1,  span: "hour",   backDays: 120 },
      "4h":  { mult: 4,  span: "hour",   backDays: 365 },
      "1d":  { mult: 1,  span: "day",    backDays: 365 },
      "d":   { mult: 1,  span: "day",    backDays: 365 },
      "day": { mult: 1,  span: "day",    backDays: 365 },
    };
    const tf = tfMap[timeframe] || tfMap["10m"];

    // window
    const now   = new Date();
    const toISO = now.toISOString().slice(0, 10);
    const from  = new Date(now);
    from.setDate(from.getDate() - tf.backDays);
    const fromISO = from.toISOString().slice(0, 10);

    // Polygon key (env)
    const API = process.env.POLYGON_API
             || process.env.POLYGON_API_KEY
             || process.env.POLY_API_KEY
             || "";
    if (!API) {
      return res.status(500).json({ ok: false, error: "Missing POLYGON_API env" });
    }

    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${tf.mult}/${tf.span}/${fromISO}/${toISO}` +
      `?adjusted=true&sort=asc&limit=${limit}&apiKey=${API}`;

    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ ok: false, error: `upstream ${r.status}` });
    const j = await r.json();

    const results = Array.isArray(j?.results) ? j.results : [];

    // Normalize → seconds for Lightweight-Charts
    const bars = results.map(b => ({
      time:  Math.floor(Number(b.t) / 1000), // ms → s
      open:  Number(b.o),
      high:  Number(b.h),
      low:   Number(b.l),
      close: Number(b.c),
      volume:Number(b.v ?? 0),
    })).filter(b =>
      Number.isFinite(b.time) && Number.isFinite(b.open) &&
      Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close)
    );

    res.setHeader("Cache-Control", "no-store");
    return res.json(bars);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});
