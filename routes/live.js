// routes/live.js — clean replacement
import express from "express";
export const liveRouter = express.Router();

/* ------------------- helpers ------------------- */
function getPolyKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}

function tfParams(tf = "1m") {
  const t = String(tf || "").toLowerCase();
  const map = {
    "1m": { mult: 1, span: "minute", backDays: 7 },
    "5m": { mult: 5, span: "minute", backDays: 14 },
    "10m": { mult: 10, span: "minute", backDays: 30 },
    "15m": { mult: 15, span: "minute", backDays: 30 },
    "30m": { mult: 30, span: "minute", backDays: 60 },
    "1h": { mult: 60, span: "minute", backDays: 90 },
    "4h": { mult: 240, span: "minute", backDays: 120 },
    "1d": { mult: 1, span: "day", backDays: 365 },
  };
  return map[t] || map["10m"];
}

/* ------------------- nowbar route ------------------- */
// Example: GET /api/v1/live/nowbar?symbol=SPY&tf=10m
liveRouter.get("/nowbar", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfIn = String(req.query.tf || req.query.timeframe || "10m");
    const tf = tfParams(tfIn);

    const now = new Date();
    const toISO = now.toISOString(); // FULL ISO timestamp
    const from = new Date(now);
    from.setDate(from.getDate() - tf.backDays);
    const fromISO = from.toISOString(); // FULL ISO timestamp

    const API = getPolyKey();
    if (!API) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing POLYGON_API env" });
    }

    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${tf.mult}/${tf.span}/${fromISO}/${toISO}` +
      `?adjusted=true&sort=desc&limit=1&apiKey=${API}`;

    console.log("[nowbar] url:", url);

    const r = await fetch(url);
    if (!r.ok) {
      return res
        .status(r.status)
        .json({ ok: false, error: `upstream ${r.status}` });
    }

    const j = await r.json();
    const results = Array.isArray(j?.results) ? j.results : [];

    // fallback: if no agg bar, get last trade
    let bar;
    if (results.length > 0) {
      const b = results[0];
      bar = {
        time: Math.floor(Number(b.t) / 1000),
        open: Number(b.o),
        high: Number(b.h),
        low: Number(b.l),
        close: Number(b.c),
        volume: Number(b.v ?? 0),
      };
    } else {
      // call last trade
      const tradeUrl = `https://api.polygon.io/v2/last/trade/${symbol}?apiKey=${API}`;
      const tr = await fetch(tradeUrl);
      const tj = await tr.json();
      const p = Number(tj?.results?.p ?? 0);
      const t = Math.floor(Number(tj?.results?.t ?? Date.now()) / 1000);
      bar = {
        time: t,
        open: p,
        high: p,
        low: p,
        close: p,
        volume: 0,
      };
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, tf: tfIn, symbol, bar });
  } catch (e) {
    console.error("nowbar error:", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "server error" });
  }
});

/* ------------------- diag route ------------------- */
liveRouter.get("/diag", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tfIn = String(req.query.tf || "10m");
    const tf = tfParams(tfIn);

    const now = new Date();
    const toISO = now.toISOString();
    const from = new Date(now);
    from.setDate(from.getDate() - tf.backDays);
    const fromISO = from.toISOString();

    const API = getPolyKey();
    if (!API) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing POLYGON_API env" });
    }

    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${tf.mult}/${tf.span}/${fromISO}/${toISO}` +
      `?adjusted=true&sort=desc&limit=1&apiKey=${API}`;

    const r = await fetch(url);
    const j = await r.json();

    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, upstreamStatus: r.status, url, polygon: j });
  } catch (e) {
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "diag error" });
  }
});
