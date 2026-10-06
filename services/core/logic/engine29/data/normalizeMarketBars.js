// services/core/logic/engine29/data/normalizeMarketBars.js

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateToEpochMs(dateValue) {
  if (!dateValue) return null;
  const ms = Date.parse(`${dateValue}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function normalizePolygonBars(bars = []) {
  if (!Array.isArray(bars)) return [];

  return bars
    .map((bar) => {
      const time = finiteOrNull(bar?.time);
      const date = bar?.date || (time ? new Date(time).toISOString().slice(0, 10) : null);

      return {
        date,
        time: time ?? dateToEpochMs(date),
        open: finiteOrNull(bar?.open),
        high: finiteOrNull(bar?.high),
        low: finiteOrNull(bar?.low),
        close: finiteOrNull(bar?.close),
        volume: finiteOrNull(bar?.volume),
        vwap: finiteOrNull(bar?.vwap),
        transactions: finiteOrNull(bar?.transactions),
        dataShape: "OHLCV",
        syntheticOhlc: false,
      };
    })
    .filter((bar) => bar.date && Number.isFinite(bar.close));
}

export function normalizeFredObservations(observations = []) {
  if (!Array.isArray(observations)) return [];

  return observations
    .map((row) => {
      const close = finiteOrNull(row?.value);
      const date = row?.date || null;

      return {
        date,
        time: dateToEpochMs(date),
        open: null,
        high: null,
        low: null,
        close,
        volume: null,
        vwap: null,
        transactions: null,
        dataShape: "CLOSE_ONLY_SERIES",
        syntheticOhlc: true,
      };
    })
    .filter((bar) => bar.date && Number.isFinite(bar.close));
}

export function getLatestNormalizedBar(bars = []) {
  if (!Array.isArray(bars) || bars.length === 0) return null;
  return bars[bars.length - 1] || null;
}
