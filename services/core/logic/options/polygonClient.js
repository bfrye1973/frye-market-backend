const POLYGON_BASE = "https://api.polygon.io";

function getApiKey() {
  const key = process.env.POLYGON_API_KEY || process.env.POLY_API_KEY || process.env.POLYGON_KEY;
  if (!key) throw new Error("MISSING_POLYGON_API_KEY");
  return key;
}

function withApiKey(url) {
  const u = new URL(url);
  if (!u.searchParams.has("apiKey")) u.searchParams.set("apiKey", getApiKey());
  return u.toString();
}

async function fetchJson(url) {
  const res = await fetch(withApiKey(url));
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (!res.ok) {
    const msg = json?.error || json?.message || `HTTP_${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * GET /v3/reference/options/contracts
 * Used to build expirations list. :contentReference[oaicite:4]{index=4}
 */
export async function polygonListOptionContracts({
  underlying_ticker,
  expired = false,
  limit = 1000,
  sort = "expiration_date",
  order = "asc",
  next_url = null
}) {
  if (next_url) return fetchJson(next_url);

  const u = new URL(`${POLYGON_BASE}/v3/reference/options/contracts`);
  u.searchParams.set("underlying_ticker", underlying_ticker);
  u.searchParams.set("expired", String(expired));
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("sort", sort);
  u.searchParams.set("order", order);
  return fetchJson(u.toString());
}

/**
 * GET /v3/snapshot/options/{underlyingAsset}
 * Chain snapshot with OI/quotes/trades etc. :contentReference[oaicite:5]{index=5}
 */
export async function polygonOptionsChainSnapshot({
  underlying,
  expiration_date,
  contract_type, // "call" | "put"
  limit = 250,
  sort = "strike_price",
  order = "asc",
  next_url = null
}) {
  if (next_url) return fetchJson(next_url);

  const u = new URL(`${POLYGON_BASE}/v3/snapshot/options/${encodeURIComponent(underlying)}`);
  if (expiration_date) u.searchParams.set("expiration_date", expiration_date);
  if (contract_type) u.searchParams.set("contract_type", contract_type);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("sort", sort);
  u.searchParams.set("order", order);
  return fetchJson(u.toString());
}

/**
 * Underlying last trade (spot). Lightweight.
 * If this endpoint isn't on your plan, we can swap to another snapshot endpoint.
 */
export async function polygonLastTrade(ticker) {
  const u = new URL(`${POLYGON_BASE}/v2/last/trade/${encodeURIComponent(ticker)}`);
  const j = await fetchJson(u.toString());

  const p = Number(j?.results?.p);
  const t = j?.results?.t ? new Date(j.results.t).toISOString() : null;

  return {
    last: Number.isFinite(p) ? p : null,
    ts: t
  };
}
