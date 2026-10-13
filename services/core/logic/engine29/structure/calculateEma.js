// services/core/logic/engine29/structure/calculateEma.js

export function calculateEmaSeries(values = [], period) {
  if (!Array.isArray(values) || !Number.isInteger(period) || period <= 0) return [];

  const multiplier = 2 / (period + 1);
  const result = [];
  let ema = null;
  let seed = [];

  for (const raw of values) {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      result.push(null);
      continue;
    }

    if (ema === null) {
      seed.push(value);
      if (seed.length < period) {
        result.push(null);
        continue;
      }
      if (seed.length === period) {
        ema = seed.reduce((a, b) => a + b, 0) / period;
        result.push(ema);
        continue;
      }
    }

    ema = value * multiplier + ema * (1 - multiplier);
    result.push(ema);
  }

  return result;
}

export function attachEmaSet(bars = [], periods = [10, 20, 50, 200]) {
  const closeValues = bars.map((bar) => bar?.close);
  const seriesByPeriod = Object.fromEntries(
    periods.map((period) => [period, calculateEmaSeries(closeValues, period)])
  );

  return bars.map((bar, index) => {
    const emas = {};
    for (const period of periods) {
      emas[`ema${period}`] = seriesByPeriod[period][index] ?? null;
    }
    return { ...bar, ...emas };
  });
}

export function emaSlope(bars = [], key, lookback = 3) {
  if (!Array.isArray(bars) || bars.length <= lookback) return null;
  const latest = Number(bars.at(-1)?.[key]);
  const prior = Number(bars.at(-(lookback + 1))?.[key]);
  if (!Number.isFinite(latest) || !Number.isFinite(prior) || prior === 0) return null;
  return ((latest - prior) / Math.abs(prior)) * 100;
}
