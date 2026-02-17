// smzScoreRetests.js (0–35)
// Retests = unique trading days with ANY overlap (wick/body) in zone, using 1H

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function toSec(t) { const n = Number(t ?? 0); return n > 1e12 ? Math.floor(n / 1000) : n; }
function dayKeyUtc(sec) {
  const d = new Date(toSec(sec) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}
function overlaps(b, lo, hi) {
  return b && Number.isFinite(b.high) && Number.isFinite(b.low) && b.high >= lo && b.low <= hi;
}

function uniqueDaysOverlapping(bars1h, lo, hi) {
  const s = new Set();
  for (const b of bars1h) if (overlaps(b, lo, hi)) s.add(dayKeyUtc(b.time));
  return s;
}

function reactionPoints0to8(bars1h, lo, hi) {
  // quick reaction after last overlap
  let last = -1;
  for (let i = bars1h.length - 1; i >= 0; i--) { if (overlaps(bars1h[i], lo, hi)) { last = i; break; } }
  if (last < 0 || last >= bars1h.length - 2) return 3;

  const center = (lo + hi) / 2;
  const look = Math.min(bars1h.length - 1, last + 6);

  let best = 0;
  for (let i = last + 1; i <= look; i++) best = Math.max(best, Math.abs(bars1h[i].close - center));

  if (best >= 6) return 8;
  if (best >= 3) return 5;
  return 3;
}

export function scoreRetests({ lo, hi, bars1h }) {
  const days = uniqueDaysOverlapping(bars1h, lo, hi).size;

  // days -> 0..1 (largest contributor in this bucket)
  // 1 day = 0.35, 2 days = 0.55, 3–4 = 0.75, 5+ = 1.0
  const daysNorm =
    days <= 0 ? 0 :
    days === 1 ? 0.35 :
    days === 2 ? 0.55 :
    days <= 4 ? 0.75 : 1.0;

  const react8 = reactionPoints0to8(bars1h, lo, hi);
  const reactNorm = clamp(react8 / 8, 0, 1);

  // Weight inside retest bucket: days 75%, reaction 25%
  const norm = (0.75 * daysNorm) + (0.25 * reactNorm);

  return {
    points: Math.round(norm * 35),
    facts: {
      retestDays: days,
      retestReaction0to8: react8,
    },
  };
}
