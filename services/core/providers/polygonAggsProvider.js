// services/core/providers/polygonAggsProvider.js

const DEFAULT_POLYGON_REST_BASE =
  process.env.POLYGON_REST_BASE || "https://api.polygon.io";

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function appendApiKey(urlString, apiKey) {
  const url = new URL(urlString);
  if (!url.searchParams.has("apiKey")) {
    url.searchParams.set("apiKey", apiKey);
  }
  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  const text = await response.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response from Polygon: ${text.slice(0, 250)}`);
  }

  if (!response.ok) {
    throw new Error(
      `Polygon HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`
    );
  }

  return json;
}

function normalizePolygonAggregate(bar) {
  const time = Number(bar?.t);
  if (!Number.isFinite(time)) return null;

  return {
    date: new Date(time).toISOString().slice(0, 10),
    time,
    open: Number(bar?.o),
    high: Number(bar?.h),
    low: Number(bar?.l),
    close: Number(bar?.c),
    volume: Number.isFinite(Number(bar?.v)) ? Number(bar.v) : 0,
    vwap: Number.isFinite(Number(bar?.vw)) ? Number(bar.vw) : null,
    transactions: Number.isFinite(Number(bar?.n)) ? Number(bar.n) : null,
  };
}

export async function fetchPolygonAggregatesPaginated({
  symbol,
  multiplier = 1,
  timespan,
  from,
  to,
  apiKey = process.env.POLYGON_API_KEY,
  adjusted = true,
  limit = 50000,
  maxPages = 60,
  baseUrl = DEFAULT_POLYGON_REST_BASE,
} = {}) {
  if (!apiKey) throw new Error("Missing POLYGON_API_KEY");
  if (!symbol) throw new Error("Missing Polygon symbol");
  if (!timespan) throw new Error("Missing Polygon timespan");

  const fromDate = toDateString(from);
  const toDate = toDateString(to);
  if (!fromDate || !toDate) throw new Error("Invalid Polygon aggregate date range");

  const base = String(baseUrl || DEFAULT_POLYGON_REST_BASE).replace(/\/+$/, "");
  const initial = new URL(
    `${base}/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${multiplier}/${encodeURIComponent(timespan)}/${fromDate}/${toDate}`
  );

  initial.searchParams.set("adjusted", String(Boolean(adjusted)));
  initial.searchParams.set("sort", "asc");
  initial.searchParams.set("limit", String(limit));
  initial.searchParams.set("apiKey", apiKey);

  let url = initial.toString();
  let pages = 0;
  const rows = [];

  while (url) {
    pages += 1;
    if (pages > maxPages) {
      throw new Error(
        `Polygon pagination exceeded maxPages=${maxPages} for ${symbol} ${timespan}`
      );
    }

    const json = await fetchJson(url);
    const pageRows = Array.isArray(json?.results) ? json.results : [];

    for (const row of pageRows) {
      const normalized = normalizePolygonAggregate(row);
      if (normalized) rows.push(normalized);
    }

    url = json?.next_url ? appendApiKey(json.next_url, apiKey) : null;
  }

  rows.sort((a, b) => a.time - b.time);

  const deduped = [];
  let lastTime = null;
  for (const row of rows) {
    if (row.time === lastTime) continue;
    deduped.push(row);
    lastTime = row.time;
  }

  return {
    ok: true,
    source: "Polygon",
    symbol,
    timeframe: `${multiplier}${String(timespan).toUpperCase()}`,
    multiplier,
    timespan,
    from: fromDate,
    to: toDate,
    pages,
    count: deduped.length,
    latest: deduped[deduped.length - 1] || null,
    bars: deduped,
  };
}
