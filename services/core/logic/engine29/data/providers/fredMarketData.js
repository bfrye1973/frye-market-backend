// services/core/logic/engine29/data/providers/fredMarketData.js

import { fetchFredSeries } from "../../../engine25DataSources.js";

export async function fetchEngine29FredDaily({
  seriesId,
  apiKey,
  observationStart,
}) {
  return fetchFredSeries({
    seriesId,
    apiKey,
    observationStart,
  });
}
