// services/streamer/routes/futuresStream.js
// Backend-2 — Futures stream/resolver routes
//
// Phase 1 purpose:
// - Resolve user-facing ES -> active Polygon futures contract like ESM26
// - Inspect Polygon's real futures snapshot response safely
// - Do NOT touch stock /stream/agg
// - Do NOT touch frontend yet

import express from "express";

const router = express.Router();
export default router;

const POLYGON_REST_BASE =
  process.env.POLYGON_REST_BASE ||
  process.env.POLYGON_BASE_URL ||
  "https://api.polygon.io";

const FUTURES_SNAPSHOT_PATH = "/futures/v1/snapshot";

const RESOLVE_CACHE_MS = Number(process.env.FUTURES_RESOLVE_CACHE_MS || 10 * 60 * 1000);
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

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseExpiryMs(v) {
  if (!v) return null;

  // Accept yyyy-mm-dd, ISO strings, or unix timestamps.
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

function looksLikeFuturesTicker(v, productCode) {
  const s = String(v || "").trim().toUpperCase();
  if (!s) return false;

  // ES quarterly examples:
  // ESH26, ESM26, ESU26, ESZ26
  //
  // Keep this product-code based so later NQ/YM/RTY can reuse it.
  const pc = String(productCode || "").toUpperCase();
  const re = new RegExp(`^${pc}[FGHJKMNQUVXZ]\\d{2}$`);
  return re.test(s);
}

function findTickerInObject(obj, productCode) {
  if (!obj || typeof obj !== "object") return null;

  const directFields = [
    "ticker",
    "symbol",
    "contract",
    "contract_ticker",
    "contractTicker",
    "root_ticker",
    "rootTicker",
    "name",
  ];

  for (const field of directFields) {
    const val = obj[field];
    if (looksLikeFuturesTicker(val, productCode)) {
      return String(val).toUpperCase();
    }
  }

  // Light nested scan — enough for unknown Polygon shape without being expensive.
  const stack = [obj];
  let scanned = 0;

  while (stack.length && scanned < 150) {
    const cur = stack.shift();
    scanned += 1;

    if (!cur || typeof cur !== "object") continue;

    if (Array.isArray(cur)) {
      for (const item of cur.slice(0, 50)) {
        if (typeof item === "string" && looksLikeFuturesTicker(item, productCode)) {
          return item.toUpperCase();
        }
        if (item && typeof item === "object") stack.push(item);
      }
      continue;
    }

    for (const val of Object.values(cur)) {
      if (typeof val === "string" && looksLikeFuturesTicker(val, productCode)) {
        return val.toUpperCase();
      }
      if (val && typeof val === "object") stack.push(val);
    }
  }

  return null;
}

function collectCandidateObjects(json) {
  const candidates = [];

  function pushArray(arr, sourcePath) {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (item && typeof item === "object") {
        candidates.push({ item, sourcePath });
      }
    }
  }

  // Known/common places APIs put arrays.
  pushArray(json?.results, "results");
  pushArray(json?.contracts, "contracts");
  pushArray(json?.tickers, "tickers");
  pushArray(json?.data, "data");

  pushArray(json?.results?.contracts, "results.contracts");
  pushArray(json?.results?.tickers, "results.tickers");
  pushArray(json?.results?.data, "results.data");

  pushArray(json?.snapshot?.contracts, "snapshot.contracts");
  pushArray(json?.snapshot?.tickers, "snapshot.tickers");

  // If none found, scan one level deeper.
  if (!candidates.length && json && typeof json === "object") {
    for (const [k, v] of Object.entries(json)) {
      if (Array.isArray(v)) pushArray(v, k);
      else if (v && typeof v === "object") {
        for (const [k2, v2] of Object.entries(v)) {
          if (Array.isArray(v2)) pushArray(v2, `${k}.${k2}`);
        }
      }
    }
  }

  return candidates;
}

function normalizeCandidate(raw, productCode, sourcePath) {
  const ticker = findTickerInObject(raw, productCode);
  if (!ticker) return null;

  const active =
    raw.active ??
    raw.is_active ??
    raw.isActive ??
    raw.trading ??
    raw.is_trading ??
    raw.isTrading ??
    null;

  const frontMonth =
    raw.front_month ??
    raw.frontMonth ??
    raw.is_front_month ??
    raw.isFrontMonth ??
    raw.primary ??
    raw.is_primary ??
    raw.isPrimary ??
    null;

  const volume =
    toNum(raw.volume) ??
    toNum(raw.day?.v) ??
    toNum(raw.day?.volume) ??
    toNum(raw.session?.volume) ??
    toNum(raw.latest?.volume) ??
    0;

  const openInterest =
    toNum(raw.open_interest) ??
    toNum(raw.openInterest) ??
    toNum(raw.oi) ??
    0;

  const expirationRaw =
    raw.expiration_date ??
    raw.expirationDate ??
    raw.expiration ??
    raw.expiry ??
    raw.last_trade_date ??
    raw.lastTradeDate ??
    raw.contract_expiration ??
    null;

  const expiryMs = parseExpiryMs(expirationRaw);

  let score = 0;

  if (active === true || active === "true" || active === 1) score += 100000;
  if (frontMonth === true || frontMonth === "true" || frontMonth === 1) score += 50000;

  // Prefer contracts that are not expired if we can see an expiry.
  if (expiryMs && expiryMs > Date.now()) score += 10000;

  // Prefer stronger liquidity.
  score += Math.min(volume || 0, 100000);
  score += Math.min(openInterest || 0, 50000) / 2;

  // If expiry exists, prefer nearest future expiry after liquidity/active flags.
  const daysToExpiry = expiryMs ? Math.max(0, (expiryMs - Date.now()) / 86400000) : null;
  if (daysToExpiry !== null) {
    score += Math.max(0, 5000 - daysToExpiry);
  }

  return {
    ticker,
    sourcePath,
    score,
    active,
    frontMonth,
    volume,
    openInterest,
    expiration: expirationRaw,
    daysToExpiry,
    rawKeys: Object.keys(raw || {}).slice(0, 40),
  };
}

function chooseResolvedContract(json, productCode) {
  const rawObjects = collectCandidateObjects(json);

  const candidates = rawObjects
    .map(({ item, sourcePath }) => normalizeCandidate(item, productCode, sourcePath))
    .filter(Boolean);

  // Also handle case where the ticker is directly somewhere in the object,
  // not inside an array.
  const directTicker = findTickerInObject(json, productCode);
  if (directTicker && !candidates.some((c) => c.ticker === directTicker)) {
    candidates.push({
      ticker: directTicker,
      sourcePath: "direct_scan",
      score: 1,
      active: null,
      frontMonth: null,
      volume: 0,
      openInterest: 0,
      expiration: null,
      daysToExpiry: null,
      rawKeys: Object.keys(json || {}).slice(0, 40),
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  return {
    resolvedSymbol: candidates[0]?.ticker || null,
    candidates,
  };
}

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

    resolveCache.set(cacheKey, { cachedAtMs: Date.now(), value });
    return value;
  }

  const { resolvedSymbol, candidates } = chooseResolvedContract(
    fetched.json,
    productCode
  );

  const value = {
    ok: true,
    productCode,
    resolvedSymbol,
    source: "polygon_futures_snapshot",
    needsInspection: !resolvedSymbol,
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 12),
    polygonShape: safeJsonShape(fetched.json),
    checkedAt: nowIso(),
    cached: false,
  };

  resolveCache.set(cacheKey, { cachedAtMs: Date.now(), value });
  return value;
}

/* -------------------------------------------------
   Routes
-------------------------------------------------- */

router.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "futures-stream",
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
    expectedNextTest: `/stream/futures/resolve?product_code=${encodeURIComponent(symbol)}`,
    ts: nowIso(),
  });
});
