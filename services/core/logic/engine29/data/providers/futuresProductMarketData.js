// services/core/logic/engine29/data/providers/futuresProductMarketData.js
//
// Engine 29 direct futures-product market data adapter.
//
// Purpose:
// - Reuse the same CL/BZ nearby-contract resolution logic already proven by Engine 25.
// - Fetch current outright futures bars for structural + tactical Engine 29 layers.
// - Keep WTI/Brent canonical product roots stable while the resolved contract rolls.
//
// Important:
// Polygon's direct 30m/1h futures aggregate endpoint can lag the live 5m/10m
// stream by many hours. Engine 25 already proves the nearby CL/BZ 10m feed is
// current. For Engine 29 tactical oil, fetch 10m direct futures bars and
// aggregate them locally into 30m/1h candles. This keeps Engine 29 independent
// while using the same direct contract source.
//
// Canonical roots:
//   WTI   -> CL
//   Brent -> BZ

import { resolveEngine25FuturesContract } from "../../../../jobs/updateEngine25IntradayMacro.js";
import { fetchFuturesAggs } from "../../../../providers/futuresOhlcProvider.js";

const RESOLUTION_BY_TIMEFRAME = Object.freeze({
  "1D": "1day",
  "1H": "10min",
  "30m": "10min",
  "10m": "10min",
});

const TARGET_BUCKET_MS = Object.freeze({
  "1H": 60 * 60 * 1000,
  "30m": 30 * 60 * 1000,
});

function normalizeFuturesBars(bars = []) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar) => {
      const rawTime = Number(bar?.time);
      const time = Number.isFinite(rawTime)
        ? rawTime < 1e12
          ? rawTime * 1000
          : rawTime
        : null;

      const open = Number(bar?.open);
      const high = Number(bar?.high);
      const low = Number(bar?.low);
      const close = Number(bar?.close);
      const volume = Number(bar?.volume ?? 0);

      if (![time, open, high, low, close].every(Number.isFinite)) return null;

      return {
        date: new Date(time).toISOString().slice(0, 10),
        time,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
        vwap: null,
        transactions: null,
        dataShape: "OHLCV",
        syntheticOhlc: false,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
}

export function aggregateEngine29FuturesBars(
  bars = [],
  timeframe
) {
  const bucketMs = TARGET_BUCKET_MS[timeframe];

  if (!bucketMs) {
    return [...bars];
  }

  const buckets = new Map();

  for (const bar of bars) {
    const time = Number(bar?.time);
    if (!Number.isFinite(time)) continue;

    const bucketTime =
      Math.floor(time / bucketMs) * bucketMs;

    const existing = buckets.get(bucketTime);

    if (!existing) {
      buckets.set(bucketTime, {
        date: new Date(bucketTime).toISOString().slice(0, 10),
        time: bucketTime,
        open: Number(bar.open),
        high: Number(bar.high),
        low: Number(bar.low),
        close: Number(bar.close),
        volume: Number(bar.volume ?? 0),
        vwap: null,
        transactions: null,
        dataShape: "OHLCV",
        syntheticOhlc: false,
        aggregatedFrom: "10m",
      });
      continue;
    }

    existing.high = Math.max(
      Number(existing.high),
      Number(bar.high)
    );
    existing.low = Math.min(
      Number(existing.low),
      Number(bar.low)
    );
    existing.close = Number(bar.close);
    existing.volume += Number(bar.volume ?? 0);
  }

  return [...buckets.values()].sort(
    (a, b) => a.time - b.time
  );
}

export async function fetchEngine29FuturesProductBars({
  productCode,
  timeframe,
  from,
  to,
  now = Date.now(),
  limit = 50000,
}) {
  const code = String(productCode || "").trim().toUpperCase();
  const tf = String(timeframe || "");
  const resolution = RESOLUTION_BY_TIMEFRAME[tf];

  if (!code) {
    throw new Error("Engine 29 futures productCode is required");
  }

  if (!resolution) {
    throw new Error(`Unsupported Engine 29 futures timeframe: ${tf}`);
  }

  const resolver = await resolveEngine25FuturesContract(
    code,
    new Date(now)
  );

  const resolvedSymbol = resolver?.resolvedSymbol || null;

  if (!resolvedSymbol) {
    throw new Error(
      `Could not resolve Engine 29 futures product ${code}`
    );
  }

  const rawBars = await fetchFuturesAggs({
    resolvedSymbol,
    resolution,
    startDate: from,
    endDate: to,
    limit,
  });

  const normalized = normalizeFuturesBars(rawBars);
  const bars = aggregateEngine29FuturesBars(
    normalized,
    tf
  );

  return {
    ok: true,
    provider: "FRYE_FUTURES_PRODUCT",
    productCode: code,
    resolvedSymbol,
    timeframe: tf,
    resolution,
    sourceResolution: resolution,
    aggregation:
      TARGET_BUCKET_MS[tf]
        ? `LOCAL_10M_TO_${tf}`
        : "PROVIDER_NATIVE",
    from,
    to,
    count: bars.length,
    latest: bars.at(-1) || null,
    bars,
    resolver,
    contractSpecificHistory: true,
    continuousHistory: false,
  };
}

export default {
  fetchEngine29FuturesProductBars,
  aggregateEngine29FuturesBars,
};
