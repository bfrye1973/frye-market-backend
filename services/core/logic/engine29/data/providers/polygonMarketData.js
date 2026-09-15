// services/core/logic/engine29/data/providers/polygonMarketData.js

import { fetchPolygonDailyBars } from "../../../engine25DataSources.js";

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response from Polygon: ${text.slice(0, 250)}`);
  }

  if (!res.ok) {
    throw new Error(`Polygon HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return json;
}

export async function fetchEngine29PolygonDaily({
  symbol,
  apiKey,
  from,
  to,
}) {
  return fetchPolygonDailyBars({ symbol, apiKey, from, to });
}

export async function fetchEngine29PolygonHourly({
  symbol,
  apiKey,
  from,
  to,
  adjusted = true,
  limit = 5000,
}) {
  if (!apiKey) throw new Error("Missing POLYGON_API_KEY");
  if (!symbol) throw new Error("Missing Polygon symbol");

  const fromDate = toDateString(from);
  const toDate = toDateString(to);
  if (!fromDate || !toDate) throw new Error("Invalid Polygon hourly date range");

  const params = new URLSearchParams({
    adjusted: String(adjusted),
    sort: "asc",
    limit: String(limit),
    apiKey,
  });

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/1/hour/${fromDate}/${toDate}` +
    `?${params.toString()}`;

  const json = await fetchJson(url);
  const bars = Array.isArray(json.results)
    ? json.results.map((bar) => ({
        date: new Date(bar.t).toISOString().slice(0, 10),
        time: bar.t,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        vwap: bar.vw ?? null,
        transactions: bar.n ?? null,
      }))
    : [];

  return {
    ok: true,
    source: "Polygon",
    symbol,
    timeframe: "1H",
    from: fromDate,
    to: toDate,
    count: bars.length,
    latest: bars[bars.length - 1] || null,
    bars,
  };
}
