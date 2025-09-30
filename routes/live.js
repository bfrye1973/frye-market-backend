// routes/live.js (or wherever /api/v1/live/nowbar is defined)
import express from "express";
export const liveRouter = express.Router();

liveRouter.get("/nowbar", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfIn   = String(req.query.tf || req.query.timeframe || "10m").toLowerCase();

    // timeframe → Polygon params + wide back window to avoid "no-data"
    const tfMap = {
      "1m":  { mult: 1,   span: "minute", backDays: 7   },
      "5m":  { mult: 5,   span: "minute", backDays: 14  },
      "10m": { mult: 10,  span: "minute", backDays: 30  },
      "15m": { mult: 15,  span: "minute", backDays: 30  },
      "30m": { mult: 30,  span: "minute", backDays: 60  },
      "1h":  { mult: 60,  span: "minute", backDays: 90  },   // hourly via minute aggs
      "4h":  { mult: 240, span: "minute", backDays: 120 },   // 4h via minute aggs
      "1d":  { mult: 1,   span: "day",    backDays: 365 },
    };
    const tf = tfMap[tfIn] || tfMap["10m"];

    // Date window
    const now = new Date();
    const toISO = now.toISOString().slice(0, 10);
    const from = new Date(now);
    from.setDate(from.getDate() - tf.backDays);
    const fromISO = from.toISOString().slice(0, 10);

    // Polygon key from env
    const API = process.env.POLYGON_API
             || process.env.POLYGON_API_KEY
             || process.env.POLY_API_KEY
             || "";
    if (!API) return res.status(500).json({ ok: false, error: "Missing POLYGON_API env" });

    // Ask Polygon for the latest completed bar across a wide window
    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${tf.mult}/${tf.span}/${fromISO}/${toISO}` +
      `?adjusted=true&sort=desc&limit=1&apiKey=${API}`;

    const r = await fetch(url);
    if (!r.ok) return res.status(r.status).json({ ok: false, error: `upstream ${r.status}` });

    const j = await r.json();
    const results = Array.isArray(j?.results) ? j.results : [];
    if (results.length === 0) return res.json({ ok: false, error: "no-data" });

    const b = results[0];
    const bar = {
      time:   Math.floor(Number(b.t) / 1000), // ms → s
      open:   Number(b.o),
      high:   Number(b.h),
      low:    Number(b.l),
      close:  Number(b.c),
      volume: Number(b.v ?? 0),
    };

    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, bar });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "server error" });
  }
});
