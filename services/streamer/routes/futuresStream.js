// services/streamer/routes/futuresStream.js
// Backend-2 — Futures stream/resolver routes
//
// Phase 1 purpose:
// - Resolve user-facing ES -> active Polygon futures contract like ESM6
// - Inspect Polygon's real futures snapshot response safely
// - Do NOT touch stock /stream/agg
// - Do NOT touch frontend yet
//
// Confirmed Polygon futures snapshot shape:
// results[].details.ticker
// results[].details.product_code
// results[].details.settlement_date
// results[].session.volume
// results[].session.close

import express from "express";

const router = express.Router();
export default router;

const POLYGON_REST_BASE =
  process.env.POLYGON_REST_BASE ||
  process.env.POLYGON_BASE_URL ||
  "https://api.polygon.io";

const FUTURES_SNAPSHOT_PATH = "/futures/v1/snapshot";

// Keep short while testing ES resolver.
const RESOLVE_CACHE_MS = Number(
  process.env.FUTURES_RESOLVE_CACHE_MS || 2 * 60 * 1000
);

const resolveCache = new Map();

/* -------------------------------------------------
   Env / helpers
-------------------------------------------------- */

function resolvePolygonKey() {
  return (
    process.env.POLYGON_API ||
    process.env.POLYGON_API_KEY ||
    process.env.POLY_API_KEY ||
    ""
  );
}

function cleanProductCode(v) {
  const s = String(v || "ES").trim().toUpperCase();
  return s || "ES";
}

function nowIso() {
  return new Date().toISOString();
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDateMs(v) {
  if (!v) return null;

  if (typeof v === "number") {
    if (v > 1e12) return v;
    if (v > 1e9) return v * 1000;
    return null;
  }

  const s = String(v).trim();
  if (!s) return null;

  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function safeJsonShape(value) {
  if (!value || typeof value !== "object") return typeof value;

  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sampleKeys:
        value.length && value[0] && typeof value[0] === "object"
          ? Object.keys(value[0]).slice(0, 30)
          : [],
    };
  }

  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, 50)) {
    if (Array.isArray(v)) {
      out[k] = {
        type: "array",
        length: v.length,
        sampleKeys:
          v.length && v[0] && typeof v[0] === "object"
            ? Object.keys(v[0]).slice(0, 30)
            : [],
      };
    } else if (v && typeof v === "object") {
      out[k] = {
        type: "object",
        keys: Object.keys(v).slice(0, 30),
      };
    } else {
      out[k] = typeof v;
    }
  }

  return out;
}

/* -------------------------------------------------
   Polygon ES ticker handling
-------------------------------------------------- */

function isSpreadTicker(ticker) {
  return String(ticker || "").includes("-");
}

function isPlainFuturesTicker(ticker, productCode) {
  const t = String(ticker || "").trim().toUpperCase();
  const pc = String(productCode || "").trim().toUpperCase();

  if (!t || !pc) return false;
  if (isSpreadTicker(t)) return false;

  // Polygon futures snapshot currently returns short year format:
  // ESM6, ESU6, ESZ6, ESH7
  //
  // We also allow 2-digit year format in case Polygon/support returns it later:
  // ESM26, ESU26, ESZ26
  //
  // Futures month codes:
  // F Jan, G Feb, H Mar, J Apr, K May, M Jun,
  // N Jul, Q Aug, U Sep, V Oct, X Nov, Z Dec
  const re = new RegExp(`^${pc}[FGHJKMNQUVXZ]\\d{1,2}$`);
  return re.test(t);
}

function getContractYearHint(ticker) {
  const t = String(ticker || "").trim().toUpperCase();
  const m = t.match(/(\d{1,2})$/);
  return m ? m[1] : null;
}

function normalizePolygonCandidate(row, productCode) {
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
  const close = toNum(session.close);
  const open = toNum(session.open);
  const high = toNum(session.high);
  const low = toNum(session.low);

  const now = Date.now();
  const daysToSettlement =
    settlementMs && settlementMs > 0
      ? Math.round((settlementMs - now) / 86400000)
      : null;

  const isExpired =
    settlementMs && Number.isFinite(settlementMs) ? settlementMs < now : false;

  return {
    ticker,
    productCode: rowProductCode,
    settlementDate,
    settlementMs,
    daysToSettlement,
    isExpired,
    volume,
    close,
    open,
    high,
    low,
    yearHint: getContractYearHint(ticker),
    rawKeys: Object.keys(row).slice(0, 40),
    detailKeys: Object.keys(details).slice(0, 40),
    sessionKeys: Object.keys(session).slice(0, 40),
  };
}

function chooseResolvedContractFromSnapshot(json, productCode) {
  const results = Array.isArray(json?.results) ? json.results : [];

  const allCandidates = results
    .map((row) => normalizePolygonCandidate(row, productCode))
    .filter(Boolean);

  const validNonExpired = allCandidates.filter((c) => !c.isExpired);

  // For ES front-month trading, highest liquid plain contract is safest.
  // This avoids Polygon's unsorted list where far contracts can appear first.
  //
  // Example from live Polygon data:
  // ESM6 settlement 2026-06-18 volume 1,148,365
  //
  // We ignore spread contracts like ESM6-ESU6 because those are calendar spreads,
  // not the outright ES contract we need for charting/trading signals.
  const sorted = [...validNonExpired].sort((a, b) => {
    const volDiff = Number(b.volume || 0) - Number(a.volume || 0);
    if (volDiff !== 0) return volDiff;

    const aSettle = Number(a.settlementMs || Number.MAX_SAFE_INTEGER);
    const bSettle = Number(b.settlementMs || Number.MAX_SAFE_INTEGER);
    return aSettle - bSettle;
  });

  const selected = sorted[0] || null;

  return {
    resolvedSymbol: selected?.ticker || null,
    selected,
    candidates: sorted,
    allCandidateCount: allCandidates.length,
    rawResultCount: results.length,
  };
}

/* -------------------------------------------------
   Polygon fetch
-------------------------------------------------- */

async function fetchFuturesSnapshot(productCode, apiKey) {
  const base = String(POLYGON_REST_BASE || "").replace(/\/+$/, "");
  const url = new URL(`${base}${FUTURES_SNAPSHOT_PATH}`);
  url.searchParams.set("product_code", productCode);
  url.searchParams.set("apiKey", apiKey);

  const r = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  const text = await r.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    ok: r.ok,
    status: r.status,
    statusText: r.statusText,
    json,
    textPreview: json ? null : text.slice(0, 500),
  };
}

async function resolveFuturesContract(productCode) {
  const apiKey = resolvePolygonKey();

  if (!apiKey) {
    return {
      ok: false,
      error: "missing_polygon_api_key",
      productCode,
      checkedAt: nowIso(),
    };
  }

  const cacheKey = productCode;
  const cached = resolveCache.get(cacheKey);

  if (cached && Date.now() - cached.cachedAtMs < RESOLVE_CACHE_MS) {
    return {
      ...cached.value,
      cached: true,
      cacheAgeMs: Date.now() - cached.cachedAtMs,
    };
  }

  const fetched = await fetchFuturesSnapshot(productCode, apiKey);

  if (!fetched.ok) {
    const value = {
      ok: false,
      error: "polygon_futures_snapshot_failed",
      productCode,
      status: fetched.status,
      statusText: fetched.statusText,
      polygonPreview: fetched.textPreview,
      polygonShape: safeJsonShape(fetched.json),
      checkedAt: nowIso(),
      cached: false,
    };

    resolveCache.set(cacheKey, {
      cachedAtMs: Date.now(),
      value,
    });

    return value;
  }

  const chosen = chooseResolvedContractFromSnapshot(fetched.json, productCode);

  const value = {
    ok: true,
    productCode,
    resolvedSymbol: chosen.resolvedSymbol,
    source: "polygon_futures_snapshot",
    selectionRule:
      "plain_non_spread_contract_highest_volume_then_nearest_settlement",
    needsInspection: !chosen.resolvedSymbol,
    selected: chosen.selected,
    candidateCount: chosen.candidates.length,
    allCandidateCount: chosen.allCandidateCount,
    rawResultCount: chosen.rawResultCount,
    candidates: chosen.candidates.slice(0, 12),
    polygonShape: safeJsonShape(fetched.json),
    checkedAt: nowIso(),
    cached: false,
  };

  resolveCache.set(cacheKey, {
    cachedAtMs: Date.now(),
    value,
  });

  return value;
}

/* -------------------------------------------------
   Routes
-------------------------------------------------- */

router.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "futures-stream",
    phase: "resolver-only",
    ts: nowIso(),
  });
});

router.get("/resolve", async (req, res) => {
  try {
    const productCode = cleanProductCode(
      req.query.product_code || req.query.productCode || req.query.symbol || "ES"
    );

    const result = await resolveFuturesContract(productCode);

    if (!result.ok && result.error === "missing_polygon_api_key") {
      return res.status(500).json(result);
    }

    return res.json(result);
  } catch (err) {
    console.error("[futures.resolve] error:", err?.stack || err);
    return res.status(500).json({
      ok: false,
      error: "futures_resolve_exception",
      detail: String(err?.message || err),
      checkedAt: nowIso(),
    });
  }
});

// Stub only. Do not wire chart to this until resolver is verified.
router.get("/agg", async (req, res) => {
  const symbol = cleanProductCode(req.query.symbol || "ES");

  return res.status(501).json({
    ok: false,
    error: "futures_stream_not_enabled_yet",
    message:
      "Phase 1 only: resolver is enabled. Verify /stream/futures/resolve first, then implement SSE /stream/futures/agg.",
    symbol,
    expectedNextTest: `/stream/futures/resolve?product_code=${encodeURIComponent(
      symbol
    )}`,
    ts: nowIso(),
  });
});
