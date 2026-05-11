// services/core/routes/futuresOhlc.js
// Backend-1 — Futures OHLC endpoint
//
// GET /api/v1/futures/ohlc?symbol=ES&timeframe=1m&limit=1500
//
// Purpose:
// - Resolve user-facing ES -> active Polygon futures contract like ESM6
// - Fetch historical futures candles from Polygon futures aggs endpoint
// - Return same chart bar shape as /api/v1/ohlc:
//   { time, open, high, low, close, volume }

import express from "express";

const router = express.Router();
export default router;

const POLY_KEY =
  process.env.POLYGON_API ||
  process.env.POLYGON_API_KEY ||
  process.env.POLY_API_KEY ||
  "";

const POLYGON_REST_BASE =
  process.env.POLYGON_REST_BASE ||
  process.env.POLYGON_BASE_URL ||
  "https://api.polygon.io";

const FUTURES_SNAPSHOT_PATH = "/futures/v1/snapshot";

// Dashboard TF -> Polygon futures resolution
const TF_MAP = {
  "1m": "1min",
  "5m": "5min",
  "10m": "10min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1hour",
  "4h": "4hour",
  "1d": "1day",
};

const DAYS_BY_TF = {
  "1m": 10,
  "5m": 20,
  "10m": 45,
  "15m": 60,
  "30m": 90,
  "1h": 180,
  "4h": 365,
  "1d": 365 * 5,
};

const RESOLVE_CACHE_MS = Number(
  process.env.FUTURES_RESOLVE_CACHE_MS || 2 * 60 * 1000
);

const resolveCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

function cleanProductCode(v) {
  const s = String(v || "ES").trim().toUpperCase();
  return s || "ES";
}

function clampInt(n, lo, hi, fallback) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(lo, Math.min(hi, Math.floor(x)));
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDateMs(v) {
  if (!v) return null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

function formatDateUTC(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function isSpreadTicker(ticker) {
  return String(ticker || "").includes("-");
}

function isPlainFuturesTicker(ticker, productCode) {
  const t = String(ticker || "").trim().toUpperCase();
  const pc = String(productCode || "").trim().toUpperCase();

  if (!t || !pc) return false;
  if (isSpreadTicker(t)) return false;

  // Polygon futures uses short year format like ESM6.
  // Also allow ESM26 if returned later.
  const re = new RegExp(`^${pc}[FGHJKMNQUVXZ]\\d{1,2}$`);
  return re.test(t);
}

function normalizeCandidate(row, productCode) {
  if (!row || typeof row !== "object") return null;

  const details = row.details || {};
  const session = row.session || {};

  const ticker = String(details.ticker || "").trim().toUpperCase();
  const rowProductCode = String(details.product_code || productCode || "")
    .trim()
    .toUpperCase();

  if (rowProductCode !== String(productCode).toUpperCase()) return null;
  if (!isPlainFuturesTicker(ticker, productCode)) return null;

  const settlementDate = details.settlement_date || null;
  const settlementMs = parseDateMs(settlementDate);
  const volume = toNum(session.volume) ?? 0;

  const isExpired =
    settlementMs && Number.isFinite(settlementMs)
      ? settlementMs < Date.now()
      : false;

  return {
    ticker,
    productCode: rowProductCode,
    settlementDate,
    settlementMs,
    isExpired,
    volume,
    close: toNum(session.close),
  };
}

async function resolveFuturesContract(productCode) {
  if (!POLY_KEY) {
    throw new Error("Missing Polygon API key");
  }

  const cacheKey = productCode;
  const cached = resolveCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAtMs < RESOLVE_CACHE_MS) {
    return cached.value;
  }

  const base = String(POLYGON_REST_BASE || "").replace(/\/+$/, "");
  const url = new URL(`${base}${FUTURES_SNAPSHOT_PATH}`);
  url.searchParams.set("product_code", productCode);
  url.searchParams.set("apiKey", POLY_KEY);

  const r = await fetch(url.toString(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Polygon futures snapshot ${r.status} ${txt}`);
  }

  const json = await r.json();
  const results = Array.isArray(json?.results) ? json.results : [];

  const candidates = results
    .map((row) => normalizeCandidate(row, productCode))
    .filter(Boolean)
    .filter((c) => !c.isExpired);

  const sorted = [...candidates].sort((a, b) => {
    const aSettle = Number(a.settlementMs || Number.MAX_SAFE_INTEGER);
    const bSettle = Number(b.settlementMs || Number.MAX_SAFE_INTEGER);

    if (aSettle !== bSettle) return aSettle - bSettle;

    return Number(b.volume || 0) - Number(a.volume || 0);
  });

  const selected = sorted[0] || null;

  if (!selected?.ticker) {
    throw new Error(`Could not resolve futures contract for ${productCode}`);
  }

  const value = {
    productCode,
    resolvedSymbol: selected.ticker,
    selected,
    candidateCount: candidates.length,
    checkedAt: nowIso(),
  };

  resolveCache.set(cacheKey, {
    cachedAtMs: Date.now(),
    value,
  });

  return value;
}

function toUnixSecFromNs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;

  // Futures aggs window_start is nanoseconds.
  if (n > 1e17) return Math.floor(n / 1e9);
  if (n > 1e14) return Math.floor(n / 1e6);
  if (n > 1e12) return Math.floor(n / 1000);

  return Math.floor(n);
}

function normFuturesAgg(b) {
  const time = toUnixSecFromNs(b?.window_start);
  const open = Number(b?.open);
  const high = Number(b?.high);
  const low = Number(b?.low);
  const close = Number(b?.close);
  const volume = Number(b?.volume ?? 0);

  if (![time, open, high, low, close].every(Number.isFinite)) return null;

  return {
    time,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

async function fetchFuturesAggs({
  resolvedSymbol,
  resolution,
  startDate,
  endDate,
  limit,
}) {
  if (!POLY_KEY) {
    throw new Error("Missing Polygon API key");
  }

  const base = String(POLYGON_REST_BASE || "").replace(/\/+$/, "");

  let url = new URL(
    `${base}/futures/v1/aggs/${encodeURIComponent(resolvedSymbol)}`
  );

  url.searchParams.set("resolution", resolution);
  url.searchParams.set("window_start.gte", startDate);
  url.searchParams.set("window_start.lte", endDate);
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", String(Math.min(limit, 50000)));
  url.searchParams.set("apiKey", POLY_KEY);

  const out = [];
  let hops = 0;
  let nextUrl = url.toString();

  while (nextUrl) {
    if (++hops > 60) break;

    const r = await fetch(nextUrl, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`Polygon futures aggs ${r.status} ${txt}`);
    }

    const data = await r.json();
    const arr = Array.isArray(data?.results) ? data.results : [];

    for (const b of arr) {
      const nb = normFuturesAgg(b);
      if (nb) out.push(nb);
    }

    if (!data?.next_url) {
      nextUrl = null;
    } else {
      const u = new URL(data.next_url);
      u.searchParams.set("apiKey", POLY_KEY);
      nextUrl = u.toString();
    }
  }

  out.sort((a, b) => a.time - b.time);

  // De-dup by time
  const dedup = [];
  let last = -1;

  for (const b of out) {
    if (b.time !== last) {
      dedup.push(b);
      last = b.time;
    }
  }

  return dedup;
}

router.get("/", async (req, res) => {
  try {
    const productCode = cleanProductCode(req.query.symbol || "ES");
    const tfRaw = String(req.query.timeframe || "1m").toLowerCase();
    const tf = TF_MAP[tfRaw] ? tfRaw : "1m";
    const resolution = TF_MAP[tf];

    const limit = clampInt(req.query.limit, 1, 50000, 1500);

    const resolver = await resolveFuturesContract(productCode);
    const resolvedSymbol = resolver.resolvedSymbol;

    const targetDays = DAYS_BY_TF[tf] ?? 10;
    const endMs = Date.now();
    const startMs = endMs - targetDays * 24 * 60 * 60 * 1000;

    const startDate = formatDateUTC(startMs);
    const endDate = formatDateUTC(endMs);

    const bars = await fetchFuturesAggs({
      resolvedSymbol,
      resolution,
      startDate,
      endDate,
      limit,
    });

    const trimmed = bars.length > limit ? bars.slice(-limit) : bars;

    res.setHeader("Cache-Control", "no-store");

    // Return same simple array shape as /api/v1/ohlc
    return res.json(trimmed);
  } catch (e) {
    console.error("[/api/v1/futures/ohlc] error:", e?.stack || e);

    return res.status(502).json({
      ok: false,
      error: "upstream_error",
      detail: String(e?.message || e),
    });
  }
});
