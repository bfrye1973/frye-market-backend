// services/core/logic/engine29/data/providers/futuresProductMarketData.js
//
// Engine 29 direct futures-product market data adapter.
//
// Purpose:
// - Reuse the same CL/BZ nearby-contract resolution logic already proven by Engine 25.
// - Fetch current outright futures bars for structural + tactical Engine 29 layers.
// - Support 10m diagnostic monitoring where needed.
// - Keep WTI/Brent canonical product roots stable while the resolved contract rolls.
//
// Canonical roots:
//   WTI   -> CL
//   Brent -> BZ

import { resolveEngine25FuturesContract } from "../../../../jobs/updateEngine25IntradayMacro.js";
import { fetchFuturesAggs } from "../../../../providers/futuresOhlcProvider.js";

const RESOLUTION_BY_TIMEFRAME = Object.freeze({
  "1D": "1day",
  "1H": "1hour",
  "30m": "30min",
  "10m": "10min",
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

  const bars = normalizeFuturesBars(rawBars);

  return {
    ok: true,
    provider: "FRYE_FUTURES_PRODUCT",
    productCode: code,
    resolvedSymbol,
    timeframe: tf,
    resolution,
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
};
