// services/core/logic/engine29/data/validateFreshness.js

const HOUR_MS = 60 * 60 * 1000;

export const ENGINE29_FRESHNESS_DEFAULTS = Object.freeze({
  DAILY_MAX_AGE_MS: 96 * HOUR_MS,
  HOURLY_MAX_AGE_MS: 36 * HOUR_MS,
  THIRTY_MIN_MAX_AGE_MS: 18 * HOUR_MS,
  WEEKEND_HOURLY_MAX_AGE_MS: 84 * HOUR_MS,
  WEEKEND_THIRTY_MIN_MAX_AGE_MS: 84 * HOUR_MS,
});

function isWeekendUtc(nowMs) {
  const day = new Date(nowMs).getUTCDay();
  return day === 0 || day === 6;
}

export function evaluateFreshness({
  latestTime,
  timeframe,
  now = Date.now(),
  dailyMaxAgeMs = ENGINE29_FRESHNESS_DEFAULTS.DAILY_MAX_AGE_MS,
  hourlyMaxAgeMs = ENGINE29_FRESHNESS_DEFAULTS.HOURLY_MAX_AGE_MS,
  thirtyMinMaxAgeMs = ENGINE29_FRESHNESS_DEFAULTS.THIRTY_MIN_MAX_AGE_MS,
  weekendHourlyMaxAgeMs = ENGINE29_FRESHNESS_DEFAULTS.WEEKEND_HOURLY_MAX_AGE_MS,
  weekendThirtyMinMaxAgeMs = ENGINE29_FRESHNESS_DEFAULTS.WEEKEND_THIRTY_MIN_MAX_AGE_MS,
} = {}) {
  const latestMs = Number(latestTime);

  if (!Number.isFinite(latestMs)) {
    return {
      stale: true,
      ageMs: null,
      ageMinutes: null,
      maxAgeMs: null,
      reason: "NO_LATEST_TIMESTAMP",
    };
  }

  const ageMs = Math.max(0, Number(now) - latestMs);
  let maxAgeMs = dailyMaxAgeMs;

  if (timeframe === "1H") {
    maxAgeMs = isWeekendUtc(now) ? weekendHourlyMaxAgeMs : hourlyMaxAgeMs;
  } else if (timeframe === "30m") {
    maxAgeMs = isWeekendUtc(now) ? weekendThirtyMinMaxAgeMs : thirtyMinMaxAgeMs;
  }

  return {
    stale: ageMs > maxAgeMs,
    ageMs,
    ageMinutes: Math.round(ageMs / 60000),
    maxAgeMs,
    reason: ageMs > maxAgeMs ? "AGE_EXCEEDED" : "FRESH",
  };
}
