// services/core/logic/smzEngine.js
// Smart Money Accumulation / Distribution engine (30m-only, robust)
//
// Usage:
//   import { computeAccDistLevels } from "../logic/smzEngine.js";
//   const levels = computeAccDistLevels(bars30m, bars1h, bars4h);
//
// bars30m: ascending 30m bars [{ time, open, high, low, close, volume }, ...]

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

// Simple swing detection on 30m
function detectSwings(bars, lookback = 3) {
  const highs = [];
  const lows = [];
  const n = bars.length;
  if (!Array.isArray(bars) || n < lookback * 2 + 1) return { highs, lows };

  for (let i = lookback; i < n - lookback; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;

    let isHigh = true;
    let isLow = true;

    for (let k = 1; k <= lookback; k++) {
      const prev = bars[i - k];
      const next = bars[i + k];
      if (!isFiniteBar(prev) || !isFiniteBar(next)) {
        isHigh = false;
        isLow = false;
        break;
      }
      if (prev.high >= b.high || next.high >= b.high) isHigh = false;
      if (prev.low <= b.low || next.low <= b.low) isLow = false;
    }

    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }

  return { highs, lows };
}

// Build a band around an anchor using nearby 30m bars
function buildZoneFrom30m(anchorPrice, anchorTimeSec, type, bars30m, opts) {
  const windowBars = opts?.clusterWindowBars ?? 8;  // ±N 30m bars
  const priceTol = opts?.clusterPriceTol ?? 4.0;    // dollars around anchor
  const minWidth = opts?.minWidth ?? 1.0;
  const maxWidth = opts?.maxWidth ?? 6.0;

  if (!Array.isArray(bars30m) || bars30m.length === 0) {
    return {
      type,
      priceRange: [anchorPrice + 1, anchorPrice - 1],
    };
  }

  const tfSec = 1800; // 30m
  const t = anchorTimeSec;
  const tMin = t - windowBars * tfSec;
  const tMax = t + windowBars * tfSec;

  let hi = -Infinity;
  let lo = Infinity;

  for (const b of bars30m) {
    if (!isFiniteBar(b)) continue;
    if (b.time < tMin || b.time > tMax) continue;

    const mid = (b.high + b.low) / 2;
    if (Math.abs(mid - anchorPrice) > priceTol) continue;

    if (b.high > hi) hi = b.high;
    if (b.low < lo) lo = b.low;
  }

  if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
    // If clustering fails, just build a symmetric band around anchor
    hi = anchorPrice + 2.0;
    lo = anchorPrice - 2.0;
  }

  // enforce min/max width
  let width = hi - lo;
  if (width < minWidth) {
    const pad = (minWidth - width) / 2;
    hi += pad;
    lo -= pad;
    width = hi - lo;
  }
  if (width > maxWidth) {
    const center = (hi + lo) / 2;
    hi = center + maxWidth / 2;
    lo = center - maxWidth / 2;
  }

  if (hi < lo) {
    const tmp = hi;
    hi = lo;
    lo = tmp;
  }

  return {
    type,
    priceRange: [hi, lo],
  };
}

// Main engine: swings on 30m only, always returns some zones
export function computeAccDistLevels(bars30m, _bars1h, _bars4h, opts = {}) {
  const bars = Array.isArray(bars30m) ? [...bars30m] : [];
  bars.sort((a, b) => (a.time || 0) - (b.time || 0));

  if (bars.length < 20) return [];

  const { highs, lows } = detectSwings(bars, 3);

  // Fallback anchors if swing detection fails
  let distAnchors = highs.map((idx) => ({
    idx,
    price: bars[idx].high,
    time: bars[idx].time,
  }));
  let accumAnchors = lows.map((idx) => ({
    idx,
    price: bars[idx].low,
    time: bars[idx].time,
  }));

  if (!distAnchors.length) {
    // take top highs as anchors
    const sortedHighs = [...bars]
      .filter(isFiniteBar)
      .sort((a, b) => b.high - a.high)
      .slice(0, 5);
    distAnchors = sortedHighs.map((b) => ({
      idx: -1,
      price: b.high,
      time: b.time,
    }));
  }

  if (!accumAnchors.length) {
    const sortedLows = [...bars]
      .filter(isFiniteBar)
      .sort((a, b) => a.low - b.low)
      .slice(0, 3);
    accumAnchors = sortedLows.map((b) => ({
      idx: -1,
      price: b.low,
      time: b.time,
    }));
  }

  // pick strongest anchors
  distAnchors.sort((a, b) => b.price - a.price);
  accumAnchors.sort((a, b) => a.price - b.price);

  const maxDist = opts.maxDist ?? 5;
  const maxAccum = opts.maxAccum ?? 3;

  const chosenDist = distAnchors.slice(0, maxDist);
  const chosenAccum = accumAnchors.slice(0, maxAccum);

  const zones = [];

  for (const a of chosenDist) {
    const z = buildZoneFrom30m(
      a.price,
      a.time,
      "distribution",
      bars,
      {
        clusterWindowBars: 8,
        clusterPriceTol: 4,
        minWidth: 1,
        maxWidth: 6,
      }
    );
    zones.push({
      type: "distribution",
      priceRange: z.priceRange,
      anchor: a.price,
      strength: 85,
    });
  }

  for (const a of chosenAccum) {
    const z = buildZoneFrom30m(
      a.price,
      a.time,
      "accumulation",
      bars,
      {
        clusterWindowBars: 8,
        clusterPriceTol: 4,
        minWidth: 1,
        maxWidth: 6,
      }
    );
    zones.push({
      type: "accumulation",
      priceRange: z.priceRange,
      anchor: a.price,
      strength: 85,
    });
  }

  // Cluster overlapping zones of same type
  zones.sort((a, b) => {
    const ca = (a.priceRange[0] + a.priceRange[1]) / 2;
    const cb = (b.priceRange[0] + b.priceRange[1]) / 2;
    return ca - cb;
  });

  const clusterTol = opts.clusterTolerance ?? 1.5;
  const clustered = [];

  for (const z of zones) {
    const center = (z.priceRange[0] + z.priceRange[1]) / 2;
    const last = clustered[clustered.length - 1];

    if (
      last &&
      z.type === last.type &&
      Math.abs(center - last._center) <= clusterTol
    ) {
      last.priceRange = [
        Math.max(last.priceRange[0], z.priceRange[0]),
        Math.min(last.priceRange[1], z.priceRange[1]),
      ];
      last.strength = Math.max(last.strength, z.strength);
      last._center = (last._center + center) / 2;
    } else {
      clustered.push({
        type: z.type,
        priceRange: [...z.priceRange],
        strength: z.strength,
        _center: center,
      });
    }
  }

  return clustered.map(({ _center, ...rest }) => rest);
}
