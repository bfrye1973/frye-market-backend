// services/core/logic/engine29/structure/deriveSupportResistance.js

function pctDistance(price, level) {
  if (!Number.isFinite(Number(price)) || !Number.isFinite(Number(level)) || Number(level) === 0) return null;
  return ((Number(price) - Number(level)) / Math.abs(Number(level))) * 100;
}

export function deriveSupportResistance({ bars = [], swings = {}, lookbackBars = 80 } = {}) {
  const latest = bars.at(-1) || null;
  if (!latest) {
    return {
      recentSupport: null,
      recentResistance: null,
      distanceFromSupportPct: null,
      distanceFromResistancePct: null,
      supportSource: null,
      resistanceSource: null,
    };
  }

  const cutoffIndex = Math.max(0, bars.length - lookbackBars);
  const swingLows = (swings.lows || []).filter((s) => s.index >= cutoffIndex && s.index < bars.length - 1);
  const swingHighs = (swings.highs || []).filter((s) => s.index >= cutoffIndex && s.index < bars.length - 1);

  const supportSwing = swingLows.at(-1) || null;
  const resistanceSwing = swingHighs.at(-1) || null;

  // Fallbacks are intentionally based on prior bars only so the current bar
  // cannot manufacture its own support/resistance level.
  const priorBars = bars.slice(Math.max(0, bars.length - Math.min(26, lookbackBars) - 1), -1);
  const fallbackSupport = priorBars.length
    ? Math.min(...priorBars.map((b) => Number(b.low ?? b.close)).filter(Number.isFinite))
    : null;
  const fallbackResistance = priorBars.length
    ? Math.max(...priorBars.map((b) => Number(b.high ?? b.close)).filter(Number.isFinite))
    : null;

  const recentSupport = supportSwing?.price ?? fallbackSupport;
  const recentResistance = resistanceSwing?.price ?? fallbackResistance;

  return {
    recentSupport,
    recentResistance,
    distanceFromSupportPct: pctDistance(latest.close, recentSupport),
    distanceFromResistancePct: pctDistance(latest.close, recentResistance),
    supportSource: supportSwing ? "CONFIRMED_SWING_LOW" : fallbackSupport != null ? "ROLLING_LOW_FALLBACK" : null,
    resistanceSource: resistanceSwing ? "CONFIRMED_SWING_HIGH" : fallbackResistance != null ? "ROLLING_HIGH_FALLBACK" : null,
  };
}
