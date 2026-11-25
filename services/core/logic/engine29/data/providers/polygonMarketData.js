// services/core/logic/engine29/data/providers/polygonMarketData.js

import { fetchPolygonDailyBars } from "../../../engine25DataSources.js";
import { fetchPolygonAggregatesPaginated } from "../../../../providers/polygonAggsProvider.js";

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
}) {
  const result = await fetchPolygonAggregatesPaginated({
    symbol,
    multiplier: 1,
    timespan: "hour",
    from,
    to,
    apiKey,
    adjusted,
    limit: 50000,
  });

  return {
    ...result,
    timeframe: "1H",
  };
}

export async function fetchEngine29PolygonThirtyMinute({
  symbol,
  apiKey,
  from,
  to,
  adjusted = true,
}) {
  const result = await fetchPolygonAggregatesPaginated({
    symbol,
    multiplier: 30,
    timespan: "minute",
    from,
    to,
    apiKey,
    adjusted,
    limit: 50000,
  });

  return {
    ...result,
    timeframe: "30m",
  };
}

export async function fetchEngine29PolygonTenMinute({
  symbol,
  apiKey,
  from,
  to,
  adjusted = true,
}) {
  const result = await fetchPolygonAggregatesPaginated({
    symbol,
    multiplier: 10,
    timespan: "minute",
    from,
    to,
    apiKey,
    adjusted,
    limit: 50000,
  });

  return {
    ...result,
    timeframe: "10m",
  };
}
