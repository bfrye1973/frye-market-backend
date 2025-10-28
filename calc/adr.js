// calc/adr.js
// Average Daily Range (very simple version)

export default function adr(bars, lookback = 20) {
  if (!Array.isArray(bars) || bars.length === 0) return 0;

  const n = Math.min(lookback, bars.length);
  let sum = 0;

  // bars should be array of { high, low, close }
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i] || {};
    const h = Number(b.high ?? b.h ?? 0);
    const l = Number(b.low ?? b.l ?? 0);
    const c = Number(b.close ?? b.c ?? 1);

    if (c === 0) continue;
    sum += (h - l) / c; // normalized range
  }

  // return percent
  return Number(((sum / n) * 100).toFixed(2));
}
