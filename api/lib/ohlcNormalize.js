// api/lib/ohlcNormalize.js
// Ensures all bars use unix SECONDS, sorted asc, and drops far-future bars.

export function toUnixSeconds(t) {
  if (t == null) return null;

  // ISO string?
  if (typeof t === "string") {
    const ms = Date.parse(t); // NaN if invalid
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }

  const n = Number(t);
  if (!Number.isFinite(n)) return null;

  // ns / µs / ms guards
  if (n > 1e18) return Math.floor(n / 1e9); // ns -> s
  if (n > 1e15) return Math.floor(n / 1e6); // µs -> s
  if (n > 1e12) return Math.floor(n / 1e3); // ms -> s
  return Math.floor(n);                      // already seconds
}

export function normalizeBars(rawBars) {
  const now = Math.floor(Date.now() / 1000);
  const FUTURE_PAD = 60 * 60; // allow up to +1h ahead (prevents off-screen data)

  const out = [];
  for (const b of rawBars || []) {
    const ts =
      toUnixSeconds(b.time ?? b.t ?? b.timestamp ?? b.startTimestamp) ?? null;
    if (!ts) continue;
    if (ts > now + FUTURE_PAD) continue; // drop far-future bars

    out.push({
      time: ts,
      open: Number(b.open ?? b.o),
      high: Number(b.high ?? b.h),
      low:  Number(b.low  ?? b.l),
      close:Number(b.close?? b.c),
      volume:Number(b.volume ?? b.v ?? 0),
    });
  }

  out.sort((a, b) => a.time - b.time);
  return out;
}
