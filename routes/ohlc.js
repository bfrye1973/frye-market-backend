// routes/ohlc.js
// Express ESM router that serves OHLC bars via Polygon v2 Aggs,
// normalized for Lightweight-Charts (time in EPOCH SECONDS).

import express from "express";
// If runtime < Node 18, uncomment next line and install node-fetch
// import fetch from "node-fetch";

export const ohlcRouter = express.Router();

/**
 * GET /api/v1/ohlc?symbol=SPY&timeframe=10m&limit=1500
 * timeframes supported: 1m,3m,5m,10m,15m,30m,1h,4h,1d (d,day also map to 1d)
 * Returns JSON array: [{ time, open, high, low, close, volume }, ...]
 * NOTE: time is EPOCH SECONDS (10-digit).
 */
ohlcRouter.get("/", async (req, res) => {
  try {
    /* -------- Params -------- */
    const symbol    = String(req.query.symbol || "SPY").toUpperCase();
    const timeframe = String(req.query.timeframe || "10m").toLowerCase();
    const limitReq  = Number(req.query.limit || 1500);
    const limit     = Number.isFinite(limitReq) ? Math.min(Math.max(limitReq, 1), 5000) : 1500;

    /* -------- TF map: multiplier/timespan + how far back to pull --------
       Intraday minute windows: ~45–60 days is usually plenty
       Hourly windows: widen substantially (2–3 years)
       Daily: 1+ year (can extend if you want more)
    --------------------------------------------------------------------- */
    const TF = {
      "1m":  { mult:  1, span: "minute", backDays:  7  },
      "3m":  { mult:  3, span: "minute", backDays: 14  },
      "5m":  { mult:  5, span: "minute", backDays: 30  },
      "10m": { mult: 10, span: "minute", backDays: 60  },
      "15m": { mult: 15, span: "minute", backDays: 90  },
      "30m": { mult: 30, span: "minute", backDays: 120 },
      "1h":  { mult:  1, span: "hour",   backDays: 730 }, // ~2 years
      "4h":  { mult:  4, span: "hour",   backDays: 1095 },// ~3 years
      "1d":  { mult:  1, span: "day",    backDays: 365 },
      "d":   { mult:  1, span: "day",    backDays: 365 },
      "day": { mult:  1, span: "day",    backDays: 365 },
    };
    const tf = TF[timeframe] || TF["10m"];

    /* -------- Date window (UTC ISO yyyy-mm-dd) -------- */
    const now   = new Date();
    const toISO = now.toISOString().slice(0, 10);
    const from  = new Date(now);
    from.setDate(from.getDate() - tf.backDays);
    const fromISO = from.toISOString().slice(0, 10);

    /* -------- API key -------- */
    const API =
      process.env.POLYGON_API ||
      process.env.POLYGON_API_KEY ||
      process.env.POLY_API_KEY ||
      "";
    if (!API) {
      return res.status(500).json({ ok: false, error: "Missing POLYGON_API env" });
    }

    /* -------- Build upstream URL -------- */
    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${tf.mult}/${tf.span}/${fromISO}/${toISO}` +
      `?adjusted=true&sort=asc&limit=${limit}&apiKey=${API}`;

    /* -------- Fetch & normalize -------- */
    const upstream = await fetch(url, { cache: "no-store" });
    if (!upstream.ok) {
      return res.status(upstream.status).json({ ok: false, error: `Upstream ${upstream.status}` });
    }
    const json = await upstream.json().catch(() => ({}));
    const results = Array.isArray(json?.results) ? json.results : [];

    // Convert Polygon result to LWC format (time in EPOCH SECONDS)
    const bars = results
      .map((b) => ({
        time:   Math.floor(Number(b.t) / 1000), // ms -> s
        open:   Number(b.o),
        high:   Number(b.h),
        low:    Number(b.l),
        close:  Number(b.c),
        volume: Number(b.v ?? 0),
      }))
      .filter(
        (b) =>
          Number.isFinite(b.time) &&
          Number.isFinite(b.open) &&
          Number.isFinite(b.high) &&
          Number.isFinite(b.low) &&
          Number.isFinite(b.close)
      );

    res.setHeader("Cache-Control", "no-store");
    // Optional fingerprint for debugging; comment out after verifying
    // res.setHeader("X-OHLC-Route", "routes/ohlc.js@canonical");

    return res.json(bars);
  } catch (e) {
    console.error("OHLC route error:", e);
    return res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});
