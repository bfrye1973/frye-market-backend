// services/core/providers/futuresOhlcProvider.js
// Shared Futures OHLC Provider
//
// Purpose:
// - Resolve user-facing futures product codes like ES -> active Polygon contract like ESM6
// - Fetch Polygon futures aggregate candles
// - Normalize bars into dashboard/chart shape:
//   { time, open, high, low, close, volume }
//
// Used by:
// - routes/futuresOhlc.js
// - jobs/updateEsSmzShelves.js
//
// Important:
// - Does NOT use Express
// - Does NOT call local backend HTTP
// - Safe for cron/job usage

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

// Dashboard timeframe -> Polygon futures resolution
export const FUTURES_TF_MAP = {
  "1m": "1min",
  "5m": "5min",
  "10m": "10min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1hour",
  "4h": "4hour",
  "1d": "1day",
};

// Controlled lookback windows.
// Same concept as routes/futuresOhlc.js.
export const FUTURES_DAYS_BY_TF = {
  "1m": 3,
  "5m": 7,
  "10m": 14,
  "15m": 21,
  "30m": 45,
  "1h": 90,
  "4h": 240,
  "1d": 365 * 3,
};

const RESOLVE_CACHE_MS = Number(
  process.env.FUTURES_RESOLVE_CACHE_MS || 2 * 60 * 1000
);

const resolveCache = new Map();

function nowIso() {
  return new Date().toISOString();
}

export function cleanProductCode(v) {
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

  // Polygon futures currently uses short-year format:
  // ESM6, ESU6, ESZ6
  //
  // Also allow 2-digit year if Polygon changes later:
  // ESM26, ESU26, ESZ26
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
  const close = toNum(session.close);

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
    close,
  };
}

async function readJsonResponse(response, label) {
  const text = await response.text();

  if (!text || !text.trim()) {
    throw new Error(`${label} returned empty response`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${label} returned non-JSON response. status=${response.status} preview=${text.slice(
        0,
        300
      )}`
    );
  }
}

export async function resolveFuturesContract(productCodeInput = "ES") {
  if (!POLY_KEY) {
    throw new Error("Missing Polygon API key");
  }

  const productCode = cleanProductCode(productCodeInput);
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

  const json = await readJsonResponse(r, "Polygon futures snapshot");
  const results = Array.isArray(json?.results) ? json.results : [];

  const candidates = results
    .map((row) => normalizeCandidate(row, productCode))
    .filter(Boolean)
    .filter((c) => !c.isExpired);

  // Pick nearest valid plain contract first, then volume.
  // This keeps ES on the current front contract like ESM6.
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
    selectionRule: "plain_non_spread_contract_nearest_settlement_then_volume",
    candidateCount: sorted.length,
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

  // Polygon futures aggs window_start is nanoseconds.
  if (n > 1e17) return Math.floor(n / 1e9); // ns
  if (n > 1e14) return Math.floor(n / 1e6); // microseconds
  if (n > 1e12) return Math.floor(n / 1000); // ms

  return Math.floor(n); // sec
}

export function normFuturesAgg(b) {
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

export async function fetchFuturesAggs({
  resolvedSymbol,
  resolution,
  startDate,
  endDate,
  limit = 1500,
}) {
  if (!POLY_KEY) {
    throw new Error("Missing Polygon API key");
  }

  const safeLimit = clampInt(limit, 1, 50000, 1500);

  const base = String(POLYGON_REST_BASE || "").replace(/\/+$/, "");
  const url = new URL(
    `${base}/futures/v1/aggs/${encodeURIComponent(resolvedSymbol)}`
  );

  url.searchParams.set("resolution", resolution);
  url.searchParams.set("window_start.gte", startDate);
  url.searchParams.set("window_start.lte", endDate);

  // Use ASC and select latest N after sorting.
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", "50000");
  url.searchParams.set("apiKey", POLY_KEY);

  const r = await fetch(url.toString(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Polygon futures aggs ${r.status} ${txt}`);
  }

  const data = await readJsonResponse(r, "Polygon futures aggs");
  const arr = Array.isArray(data?.results) ? data.results : [];

  const bars = arr
    .map(normFuturesAgg)
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);

  // De-dup by time.
  const dedup = [];
  let last = -1;

  for (const b of bars) {
    if (b.time !== last) {
      dedup.push(b);
      last = b.time;
    }
  }

  return dedup.length > safeLimit ? dedup.slice(-safeLimit) : dedup;
}

export async function fetchFuturesBars({
  symbol = "ES",
  timeframe = "1m",
  limit = 1500,
} = {}) {
  const productCode = cleanProductCode(symbol);
  const tfRaw = String(timeframe || "1m").toLowerCase();
  const tf = FUTURES_TF_MAP[tfRaw] ? tfRaw : "1m";
  const resolution = FUTURES_TF_MAP[tf];

  const safeLimit = clampInt(limit, 1, 50000, 1500);

  const resolver = await resolveFuturesContract(productCode);
  const resolvedSymbol = resolver.resolvedSymbol;

  const targetDays = FUTURES_DAYS_BY_TF[tf] ?? 10;
  const endMs = Date.now();
  const startMs = endMs - targetDays * 24 * 60 * 60 * 1000;

  // Add one extra UTC day so today's active futures session is included.
  const startDate = formatDateUTC(startMs);
  const endDate = formatDateUTC(endMs + 24 * 60 * 60 * 1000);

  const bars = await fetchFuturesAggs({
    resolvedSymbol,
    resolution,
    startDate,
    endDate,
    limit: safeLimit,
  });

  return {
    ok: true,
    productCode,
    resolvedSymbol,
    timeframe: tf,
    resolution,
    limit: safeLimit,
    startDate,
    endDate,
    resolver,
    count: bars.length,
    firstBar: bars[0] || null,
    lastBar: bars[bars.length - 1] || null,
    bars,
  };
}

export default {
  FUTURES_TF_MAP,
  FUTURES_DAYS_BY_TF,
  cleanProductCode,
  resolveFuturesContract,
  normFuturesAgg,
  fetchFuturesAggs,
  fetchFuturesBars,
};
