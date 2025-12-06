// services/core/logic/smzEngine.js
// Simple Smart Money engine (single-price distribution levels only, WORKING VERSION)

function isFiniteBar(b) {
  return (
    b &&
    Number.isFinite(b.time) &&
    Number.isFinite(b.open) &&
    Number.isFinite(b.high) &&
    Number.isFinite(b.low) &&
    Number.isFinite(b.close)
  );
}

// Simple swing high detection
function detectSwingHighs(bars, lookback = 3) {
  const highs = [];
  const n = bars.length;
  if (!Array.isArray(bars) || n < lookback * 2 + 1) return highs;

  for (let i = lookback; i < n - lookback; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;
    let isHigh = true;
    for (let k = 1; k <= lookback; k++) {
      const prev = bars[i - k];
      const next = bars[i + k];
      if (!isFiniteBar(prev) || !isFiniteBar(next)) {
        isHigh = false;
        break;
      }
      if (prev.high >= b.high || next.high >= b.high) {
        isHigh = false;
        break;
      }
    }
    if (isHigh) highs.push(i);
  }
  return highs;
}

// Simple engine using 30m + 1h + 4h to find distribution shelves
export function computeAccDistLevelsFromBars(bars, opts = {}) {
  if (!Array.isArray(bars) || bars.length < 20) return [];

  // treat all bars as 30m+1h+4h merged, sorted
  const sorted = [...bars].filter(isFiniteBar).sort((a, b) => a.time - b.time);
  const highsIdx = detectSwingHighs(sorted, 3);

  // pick swing high anchors
  const anchors = highsIdx.map((idx) => ({
    idx,
    price: sorted[idx].high,
    time: sorted[idx].time,
  }));

  // if none, pick top highs
  if (!anchors.length) {
    const top = [...sorted].sort((a, b) => b.high - a.high).slice(0, 5);
    top.forEach((b) =>
      anchors.push({ idx: -1, price: b.high, time: b.time })
    );
  }

  // sort anchors by price desc and take top N
  anchors.sort((a, b) => b.price - a.price);
  const maxLevels = opts.maxLevels ?? 5;
  const chosen = anchors.slice(0, maxLevels);

  const levels = chosen.map((a) => ({
    type: "distribution",
    price: a.price,
    strength: 80,
  }));

  return levels;
}
