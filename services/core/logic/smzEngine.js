// services/core/logic/smzEngine.js
// Smart Money Accumulation / Distribution engine (multi-timeframe)
//
// Usage:
//   import { computeAccDistLevels } from "../logic/smzEngine.js";
//   const levels = computeAccDistLevels(bars30m, bars1h, bars4h);
//
// barsX arrays must be ascending in time and have:
//   { time (sec), open, high, low, close, volume }

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

function measureReaction(bars, idx, direction, lookaheadBars = 15) {
  const n = bars.length;
  const b = bars[idx];
  if (!isFiniteBar(b)) return 0;

  let maxMove = 0;
  for (let j = idx + 1; j < Math.min(n, idx + 1 + lookaheadBars); j++) {
    const bj = bars[j];
    if (!isFiniteBar(bj)) continue;

    if (direction === "down") {
      const dropPct = (b.high - bj.low) / b.high;
      if (dropPct > maxMove) maxMove = dropPct;
    } else {
      const rallyPct = (bj.high - b.low) / b.low;
      if (rallyPct > maxMove) maxMove = rallyPct;
    }
  }
  return maxMove;
}

function buildZoneFrom30m(anchorPrice, anchorTimeSec, type, bars30m, opts) {
  const windowBars = opts?.clusterWindowBars ?? 8; // ±N bars of 30m
  const priceTol = opts?.clusterPriceTol ?? 3.0; // dollars around anchor
  const minWidth = opts?.minWidth ?? 1.0;
  const maxWidth = opts?.maxWidth ?? 6.0;

  if (!Array.isArray(bars30m) || bars30m.length === 0) {
    // fallback 2-point band
    return {
      type,
      priceRange: [anchorPrice + 1, anchorPrice - 1],
    };
  }

  const tfSec = 1800; // 30m in seconds
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
    // cluster failed → default band
    hi = anchorPrice + 1.5;
    lo = anchorPrice - 1.5;
  }

  // clamp width
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

  // Ensure hi > lo
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

// Combine anchors from 1h/4h and then build zones using 30m
export function computeAccDistLevels(bars30m, bars1h, bars4h, opts = {}) {
  const minMovePct = opts.minMovePct ?? 0.006; // ~0.6%
  const lookaheadBars = opts.lookaheadBars ?? 20;

  const anchors = [];

  // 4h anchors (strongest)
  if (Array.isArray(bars4h) && bars4h.length) {
    const { highs, lows } = detectSwings(bars4h, 2);
    for (const idx of highs) {
      const b = bars4h[idx];
      const move = measureReaction(bars4h, idx, "down", lookaheadBars);
      if (move >= minMovePct) {
        anchors.push({
          type: "distribution",
          price: b.high,
          time: b.time,
          strengthBase: 2, // heavier weight
          reaction: move,
        });
      }
    }
    for (const idx of lows) {
      const b = bars4h[idx];
      const move = measureReaction(bars4h, idx, "up", lookaheadBars);
      if (move >= minMovePct) {
        anchors.push({
          type: "accumulation",
          price: b.low,
          time: b.time,
          strengthBase: 2,
          reaction: move,
        });
      }
    }
  }

  // 1h anchors (medium strength)
  if (Array.isArray(bars1h) && bars1h.length) {
    const { highs, lows } = detectSwings(bars1h, 3);
    for (const idx of highs) {
      const b = bars1h[idx];
      const move = measureReaction(bars1h, idx, "down", lookaheadBars);
      if (move >= minMovePct) {
        anchors.push({
          type: "distribution",
          price: b.high,
          time: b.time,
          strengthBase: 1,
          reaction: move,
        });
      }
    }
    for (const idx of lows) {
      const b = bars1h[idx];
      const move = measureReaction(bars1h, idx, "up", lookaheadBars);
      if (move >= minMovePct) {
        anchors.push({
          type: "accumulation",
          price: b.low,
          time: b.time,
          strengthBase: 1,
          reaction: move,
        });
      }
    }
  }

  // Build zones from anchors using 30m cluster
  const zones = anchors.map((a) => {
    const z = buildZoneFrom30m(a.price, a.time, a.type, bars30m, {
      clusterWindowBars: 8,
      clusterPriceTol: 3,
      minWidth: 1,
      maxWidth: 6,
    });

    // Strength based on reaction magnitude + TF weight
    const base = a.strengthBase;
    const reactionScore = Math.min((a.reaction / minMovePct) * 50, 80); // 0–80
    const tfScore = base * 10; // 10 (1h) or 20 (4h)
    const strength = Math.round(Math.min(reactionScore + tfScore, 100));

    return {
      type: z.type,
      priceRange: z.priceRange,
      anchor: a.price,
      strength,
    };
  });

  // Cluster nearby zones of same type
  zones.sort((a, b) => {
    const ca = (a.priceRange[0] + a.priceRange[1]) / 2;
    const cb = (b.priceRange[0] + b.priceRange[1]) / 2;
    return ca - cb;
  });

  const clusterTol = opts.clusterTolerance ?? 1.5;
  const clustered = [];

  for (const z of zones) {
    const center =
      (z.priceRange[0] + z.priceRange[1]) / 2;

    const last = clustered[clustered.length - 1];
    if (
      last &&
      z.type === last.type &&
      Math.abs(center - last._center) <= clusterTol
    ) {
      // merge zones
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

  // Strip internal fields
  return clustered.map(({ _center, ...rest }) => rest);
}
