// services/core/logic/engine29/structure/aggregateDailyToWeekly.js

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mondayStartUtc(timeMs) {
  const d = new Date(timeMs);
  const day = d.getUTCDay(); // Sun=0 ... Sat=6
  const delta = day === 0 ? -6 : 1 - day;
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + delta,
    0,
    0,
    0,
    0
  );
}

function weekEndUtc(weekStartMs) {
  return weekStartMs + 7 * 24 * 60 * 60 * 1000 - 1;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function aggregateDailyToWeekly(bars = [], { now = Date.now() } = {}) {
  if (!Array.isArray(bars) || bars.length === 0) return [];

  const usable = bars
    .filter((bar) => Number.isFinite(Number(bar?.time)) && Number.isFinite(Number(bar?.close)))
    .slice()
    .sort((a, b) => Number(a.time) - Number(b.time));

  const groups = new Map();

  for (const bar of usable) {
    const start = mondayStartUtc(Number(bar.time));
    if (!groups.has(start)) groups.set(start, []);
    groups.get(start).push(bar);
  }

  return [...groups.entries()].map(([weekStart, rows]) => {
    const first = rows[0];
    const last = rows[rows.length - 1];
    const closeOnly = rows.every((row) => row?.dataShape === "CLOSE_ONLY_SERIES");

    const closeValues = rows.map((row) => finite(row.close)).filter(Number.isFinite);
    const highValues = closeOnly
      ? closeValues
      : rows.map((row) => finite(row.high ?? row.close)).filter(Number.isFinite);
    const lowValues = closeOnly
      ? closeValues
      : rows.map((row) => finite(row.low ?? row.close)).filter(Number.isFinite);

    const volumeValues = rows.map((row) => finite(row.volume)).filter(Number.isFinite);
    const volume = volumeValues.length > 0 ? volumeValues.reduce((a, b) => a + b, 0) : null;

    const end = weekEndUtc(weekStart);

    return {
      date: isoDate(weekStart),
      time: weekStart,
      weekStart: isoDate(weekStart),
      weekEnd: isoDate(end),
      open: closeOnly ? finite(first.close) : finite(first.open ?? first.close),
      high: highValues.length ? Math.max(...highValues) : null,
      low: lowValues.length ? Math.min(...lowValues) : null,
      close: finite(last.close),
      volume,
      sourceBars: rows.length,
      dataShape: closeOnly ? "CLOSE_ONLY_WEEKLY_SERIES" : "WEEKLY_OHLCV",
      syntheticOhlc: closeOnly,
      completed: end < now,
    };
  });
}
