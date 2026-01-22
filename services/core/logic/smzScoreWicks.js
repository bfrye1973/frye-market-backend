// smzScoreWicks.js (0–30)
// Any wick anywhere in zone counts (length-weighted in raw points)

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function intersects(b, lo, hi) {
  return b && Number.isFinite(b.high) && Number.isFinite(b.low) && b.high >= lo && b.low <= hi;
}

export function scoreWicks({ lo, hi, bars1h }) {
  let wickTotalPts = 0;
  let touchBars = 0;

  for (const b of bars1h) {
    if (!intersects(b, lo, hi)) continue;
    touchBars++;

    const bodyHi = Math.max(b.open, b.close);
    const bodyLo = Math.min(b.open, b.close);

    const upperW = Math.max(0, b.high - bodyHi);
    const lowerW = Math.max(0, bodyLo - b.low);

    wickTotalPts += (upperW + lowerW);
  }

  const wickAvg = touchBars ? wickTotalPts / touchBars : 0;

  // Map wickAvg (points) -> 0..1
  // SPY-ish thresholds: 0.3 weak, 0.8 good, 1.5 strong+
  const norm = clamp((wickAvg - 0.3) / (1.5 - 0.3), 0, 1);

  return {
    points: Math.round(norm * 30),
    facts: {
      wickTotalPts: +wickTotalPts.toFixed(2),
      wickAvgPtsPerTouchBar: +wickAvg.toFixed(3),
      wickTouchBars: touchBars,
    },
  };
}
