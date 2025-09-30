// routes/live.js (ESM)
import express from "express";

export const liveRouter = express.Router();

function getKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}

function tfParams(tf = "1m") {
  const t = String(tf).toLowerCase();
  const map = {
    "1m":  { mult: 1,   span: "minute" },
    "5m":  { mult: 5,   span: "minute" },
    "10m": { mult: 10,  span: "minute" },
    "15m": { mult: 15,  span: "minute" },
    "30m": { mult: 30,  span: "minute" },
    "1h":  { mult: 60,  span: "minute" },
    "4h":  { mult: 240, span: "minute" },
    "1d":  { mult: 1,   span: "day" },
  };
  return map[t] || map["1m"];
}

// GET /api/v1/live/nowbar?symbol=SPY&tf=10m
// Returns the *latest completed/current bucket* OHLC for the given timeframe.
// Uses Polygon aggs TODAY/TODAY so it advances through the day.
liveRouter.get("/nowbar", async (req, res) => {
  try {
    const key = getKey();
    if (!key) return res.status(500).json({ ok: false, error: "Missing POLYGON_API key" });

    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || req.query.timeframe || "1m");
    const { mult, span } = tfParams(tf);

    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${mult}/${span}/TODAY/TODAY?adjusted=true&sort=desc&limit=1&apiKey=${key}`;

    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));

    const raw = Array.isArray(j?.results) ? j.results[0] : null;
    if (!raw) return res.json({ ok: false, error: "no-data" });

    const bar = {
      time:   Math.floor(Number(raw.t) / 1000), // ms→s
      open:   Number(raw.o),
      high:   Number(raw.h),
      low:    Number(raw.l),
      close:  Number(raw.c),
      volume: Number(raw.v ?? 0),
    };

    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, bar, tf });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e?.message || "upstream" });
  }
});

// Optional quick diag so you can see we’re hitting Polygon from the server
// GET /api/v1/live/diag?symbol=SPY&tf=1m
liveRouter.get("/diag", async (req, res) => {
  try {
    const key = getKey();
    if (!key) return res.status(500).json({ ok: false, error: "Missing POLYGON_API key" });

    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "1m");
    const { mult, span } = tfParams(tf);
    const url =
      `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${mult}/${span}/TODAY/TODAY?adjusted=true&sort=desc&limit=1&apiKey=${key}`;
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, upstreamStatus: r.status, sample: j?.results?.[0] ?? null });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e?.message || "diag-failed" });
  }
});
