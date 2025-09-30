// routes/ohlc.js
import express from "express";
// import fetch from "node-fetch"; // Uncomment if not on Node 18+
export const ohlcRouter = express.Router();

/**
 * GET /api/v1/ohlc?symbol=SPY&timeframe=5m&limit=5000
 * Returns: [{ time, open, high, low, close, volume }, ...]
 * NOTE: time is EPOCH SECONDS (10-digit), not ms.
 */
ohlcRouter.get("/", async (req, res) => {
  try {
    const symbol    = String(req.query.symbol || "SPY").toUpperCase();
    const timeframe = String(req.query.timeframe || "10m").toLowerCase();

    // Clamp at 5000 so FE/BE are consistent
    let limit = Number.parseInt(String(req.query.limit ?? "1500"), 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 1500;
    limit = Math.min(limit, 5000);

    // timeframe → Polygon params + lookback (minute aggs for intraday/hourly)
    // tuned so 5m covers ~3 months with limit=5000; coarser TFs cover longer
    const tfMap = {
      "1m":  { mult: 1,   span: "minute", backDays: 5   },
      "3m":  { mult: 3,   span: "minute", backDays: 10  },
      "5m":  { mult: 5,   span: "minute", backDays: 90  },   // ~3 months
      "10m": { mult: 10,  span: "minute", backDays: 120 },   // ~4 months
      "15m": { mult: 15,  span: "minute", backDays: 120 },   // ~4 months
      "30m": { mult: 30,  span: "minute", backDays: 180 },   // ~6 months
      "1h":  { mult: 60,  span: "minute", backDays: 180 },   // ~6 months
      "4h":  { mult: 240, span: "minute", backDays: 270 },   // ~9 months
      "1d":  { mult: 1,   span: "day",    backDays: 365 },
      "d":   { mult: 1,   span: "day",    backDays: 365 },
      "day": { mult: 1,   span: "day",    backDays: 365 },
    };
    const tf = { ...(tfMap[timeframe] || tfMap["10m"]) };

    // Optional: allow ?backDays=N (capped) for quick testing
    const backDaysOverride = Number(req.query.backDays);
    if (Number.isFinite(backDaysOverride) && backDaysOverride > 0) {
      tf.backDays = Math.min(backDaysOverride, 2000);
    }

    // Window (ISO YYYY-MM-DD)
    const now   = new Date();
    const toISO = now.toISOString().slice(0, 10);
    const from  = new Date(now);
    from.setDate(from.getDate() - tf.backDays);
    const fromISO = from.toISOString().slice(0, 10);

    // Polygon key
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
      time:   Math.floor(Number(b.t) / 1000), // ms → s
      open:   Number(b.o),
      high:   Number(b.h),
      low:    Number(b.l),
      close:  Number(b.c),
      volume: Number(b.v ?? 0),
    })).filter(b =>
      Number.isFinite(b.time) &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close)
    );

    res.setHeader("Cache-Control", "no-store");
    return res.json(bars);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});
