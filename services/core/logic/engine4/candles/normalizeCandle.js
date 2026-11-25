function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCandle(bar = null) {
  if (!bar || typeof bar !== "object") {
    return {
      open: null,
      high: null,
      low: null,
      close: null,
      volume: null,
      time: null,
      completed: null,
      isClosed: null,
      candleClosed: null,
    };
  }

  const completed =
    bar.completed === true ||
    bar.isClosed === true ||
    bar.candleClosed === true ||
    bar.closed === true;

  const explicitOpen =
    bar.completed === false ||
    bar.isClosed === false ||
    bar.candleClosed === false ||
    bar.closed === false;

  return {
    open: toNum(bar.open ?? bar.o),
    high: toNum(bar.high ?? bar.h),
    low: toNum(bar.low ?? bar.l),
    close: toNum(bar.close ?? bar.c),
    volume: toNum(bar.volume ?? bar.v),
    time: bar.time ?? bar.t ?? bar.tSec ?? null,
    completed: explicitOpen ? false : completed ? true : null,
    isClosed: explicitOpen ? false : completed ? true : null,
    candleClosed: explicitOpen ? false : completed ? true : null,
  };
}
