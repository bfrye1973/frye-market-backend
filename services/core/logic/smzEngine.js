// services/core/logic/smzEngine.js
// Simple Smart Money engine (distribution levels) with top + bottom anchors and clustering.
//
// Input: merged bars (30m + 1h + 4h) in ascending time
//   [{ time, open, high, low, close, volume }, ...]
//
// Output: array of levels:
//   { type: "distribution", price, priceRange: [hi, lo], strength }

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

// Build initial bands around anchors (swing highs)
function buildBaseLevels(bars, opts = {}) {
  if (!Array.isArray(bars) || bars.length < 20) return [];

  const bandWidth = opts.bandWidth ?? 2.0; // total width ($)
  const half = bandWidth / 2;

  const sorted = [...bars].filter(isFiniteBar).sort((a, b) => a.time - b.time);
  const highsIdx = detectSwingHighs(sorted, 3);

  // Build anchor list
  const anchors = highsIdx.map((idx) => ({
    idx,
    price: sorted[idx].high,
    time: sorted[idx].time,
  }));

  // If none, fall back to top highs
  if (!anchors.length) {
    const top = [...sorted].sort((a, b) => b.high - a.high).slice(0, 8);
    top.forEach((b) =>
      anchors.push({ idx: -1, price: b.high, time: b.time })
    );
  }

  if (!anchors.length) return [];

  // Sort anchors by price ASCENDING
  anchors.sort((a, b) => a.price - b.price);

  // Take a few from the bottom (deep zones) and a few from the top (upper zones)
  const lowCount = opts.lowLevels ?? 2;   // bottom shelves
  const highCount = opts.topLevels ?? 3;  // top shelves

  const chosen = [];
  const used = new Set();

  // Bottom anchors
  for (let i = 0; i < anchors.length && chosen.length < lowCount; i++) {
    chosen.push(anchors[i]);
    used.add(anchors[i].price);
  }

  // Top anchors
  for (let i = anchors.length - 1; i >= 0 && chosen.length < lowCount + highCount; i--) {
    if (used.has(anchors[i].price)) continue;
    chosen.push(anchors[i]);
  }

  // Build levels around chosen anchors
  const levels = chosen.map((a) => {
    const price = a.price;
    const hi = price + half;
    const lo = price - half;
    return {
      type: "distribution",
      price,
      priceRange: [hi, lo],
      strength: 80,
    };
  });

  return levels;
}

// Cluster overlapping / nearby levels into single institutional zones
function clusterLevels(levels, clusterTol = 1.0) {
  if (!Array.isArray(levels) || levels.length === 0) return [];

  const withCenter = levels
    .filter((lvl) => lvl && (typeof lvl.price === "number" || Array.isArray(lvl.priceRange)))
    .map((lvl) => {
      let hi, lo;
      if (Array.isArray(lvl.priceRange) && lvl.priceRange.length === 2) {
        hi = Number(lvl.priceRange[0]);
        lo = Number(lvl.priceRange[1]);
      } else {
        const price = Number(lvl.price);
        hi = price + 1;
        lo = price - 1;
      }
      if (hi < lo) {
        const tmp = hi;
        hi = lo;
        lo = tmp;
      }
      const center = (hi + lo) / 2;
      return {
        type: lvl.type || "distribution",
        price: lvl.price,
        priceRange: [hi, lo],
        strength: Number(lvl.strength ?? 80),
        _center: center,
      };
    });

  // Sort by center price ascending
  withCenter.sort((a, b) => a._center - b._center);

  const clustered = [];
  for (const z of withCenter) {
    const last = clustered[clustered.length - 1];
    if (
      last &&
      z.type === last.type &&
      Math.abs(z._center - last._center) <= clusterTol
    ) {
      // Merge
      const hi = Math.max(last.priceRange[0], z.priceRange[0]);
      const lo = Math.min(last.priceRange[1], z.priceRange[1]);
      last.priceRange = [hi, lo];
      last.strength = Math.max(last.strength, z.strength);
      last._center = (last._center + z._center) / 2;
    } else {
      clustered.push({ ...z });
    }
  }

  // Strip _center
  return clustered.map(({ _center, ...rest }) => rest);
}

// PUBLIC API: used by updateSmzLevels.js
export function computeAccDistLevelsFromBars(bars, opts = {}) {
  // 1) Build base levels (top + bottom shelves)
  const baseLevels = buildBaseLevels(bars, opts);

  // 2) Cluster to remove overlaps
  const clusterTol = opts.clusterTolerance ?? 1.0; // $1 between centers
  const merged = clusterLevels(baseLevels, clusterTol);

  return merged;
}
