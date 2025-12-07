// services/core/logic/smzEngine.js
// Smart Money institutional zone engine.
//
// - Generates candidate zones where wicks + consolidation cluster,
//   followed by displacement.
// - Scores each candidate for institutional strength.
// - Clusters nearby candidates into one zone.
// - Returns top N zones with price + priceRange + strength.
//
// Used by updateSmzLevels.js via:
//   computeAccDistLevelsFromBars(mergedBars)

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

// Compute a simple ATR-like average range for normalization
function computeATR(bars, period = 50) {
  if (!Array.isArray(bars) || bars.length === 0) return 1;
  const n = Math.min(period, bars.length);
  let sum = 0;
  for (let i = bars.length - n; i < bars.length; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;
    const r = b.high - b.low;
    sum += Math.max(r, 0);
  }
  const atr = sum / n;
  return atr > 0 ? atr : 1;
}

// Build candidate anchors where wicks + range are meaningful
function findCandidateAnchors(bars, atr, opts) {
  const anchors = [];
  const minRange = (opts.minRangeMul ?? 0.6) * atr;
  const minWickMul = opts.minWickMul ?? 0.6; // wick must be > atr * minWickMul

  for (let i = 1; i < bars.length - 1; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;

    const prev = bars[i - 1];
    const next = bars[i + 1];
    if (!isFiniteBar(prev) || !isFiniteBar(next)) continue;

    const range = b.high - b.low;
    if (range < minRange) continue;

    const body = Math.abs(b.close - b.open);
    const upWick = b.high - Math.max(b.open, b.close);
    const dnWick = Math.min(b.open, b.close) - b.low;

    const hasLongUp = upWick > atr * minWickMul;
    const hasLongDn = dnWick > atr * minWickMul;

    // We treat both upper and lower wicks as potential institutional activity.
    if (!hasLongUp && !hasLongDn) continue;

    // Anchor price: upper for supply, lower for demand (for now treat all as distribution zones).
    const price = hasLongUp ? b.high : b.low;

    anchors.push({
      idx: i,
      price,
      time: b.time,
      range,
      upWick,
      dnWick,
      body,
    });
  }

  return anchors;
}

// For a given candidate price, compute zone features by scanning all bars
function computeZoneFeatures(bars, price, anchorIdx, atr, opts) {
  const halfBand = (opts.bandWidth ?? 2.0) / 2;
  const bandHi = price + halfBand;
  const bandLo = price - halfBand;

  const smallBodyMul = opts.smallBodyMul ?? 0.4; // body < atr * smallBodyMul → consolidation-ish
  const dispLookahead = opts.dispLookahead ?? 12; // bars to look ahead for displacement

  let wickScore = 0;
  let consCount = 0;
  let touchCount = 0;
  let maxDisp = 0;

  // 1) Scan all bars for wicks & consolidation around this band
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;

    const mid = (b.high + b.low) / 2;
    if (mid < bandLo || mid > bandHi) continue;

    const body = Math.abs(b.close - b.open);
    const upWick = b.high - Math.max(b.open, b.close);
    const dnWick = Math.min(b.open, b.close) - b.low;

    // Wicks contributing to institutional "interest"
    wickScore += Math.max(upWick, 0) + Math.max(dnWick, 0);

    // Consolidation: small-bodied bars hanging around the band
    if (body < atr * smallBodyMul) {
      consCount++;
    }

    // Touch
    touchCount++;
  }

  // 2) Displacement: how far price moves after leaving this band
  if (anchorIdx >= 0) {
    const anchorBar = bars[anchorIdx];
    const anchorPrice = price;
    const maxLook = Math.min(bars.length, anchorIdx + 1 + dispLookahead);
    for (let j = anchorIdx + 1; j < maxLook; j++) {
      const b = bars[j];
      if (!isFiniteBar(b)) continue;
      const mid = (b.high + b.low) / 2;
      const dist = Math.abs(mid - anchorPrice);
      if (dist > maxDisp) maxDisp = dist;
    }
  }

  return {
    bandHi,
    bandLo,
    wickScore,
    consCount,
    touchCount,
    maxDisp,
  };
}

// Score combination into a single institutional strength value
function scoreZone(features, atr, opts) {
  const wWick = opts.wWick ?? 0.8;
  const wCons = opts.wCons ?? 0.6;
  const wDisp = opts.wDisp ?? 1.0;
  const wTouch = opts.wTouch ?? 0.3;

  const normDisp = features.maxDisp / (atr || 1);

  const rawScore =
    wWick * (features.wickScore / (atr || 1)) +
    wCons * features.consCount +
    wDisp * normDisp +
    wTouch * features.touchCount;

  return rawScore;
}

// Cluster nearby zones (by band center) to avoid overlapping noise
function clusterZones(candidates, clusterTol = 1.5) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const withCenter = candidates
    .map((z) => {
      const hi = z.bandHi;
      const lo = z.bandLo;
      const center = (hi + lo) / 2;
      return { ...z, center };
    })
    .sort((a, b) => a.center - b.center);

  const clusters = [];
  for (const z of withCenter) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(z.center - last.center) <= clusterTol) {
      // merge into last cluster
      last.bandHi = Math.max(last.bandHi, z.bandHi);
      last.bandLo = Math.min(last.bandLo, z.bandLo);
      last.score = Math.max(last.score, z.score);
      last.price = (last.price + z.price) / 2; // average anchor price
      last.center = (last.center + z.center) / 2;
    } else {
      clusters.push({ ...z });
    }
  }

  return clusters;
}

// Main engine: generate candidates, score, cluster, pick top N
export function computeAccDistLevelsFromBars(bars, opts = {}) {
  if (!Array.isArray(bars) || bars.length < 50) return [];

  // 1) Normalize & compute ATR
  const sorted = [...bars].filter(isFiniteBar).sort((a, b) => a.time - b.time);
  const atr = computeATR(sorted);

  // 2) Find candidate anchors
  const anchors = findCandidateAnchors(sorted, atr, opts);
  if (!anchors.length) return [];

  // 3) For each anchor, compute zone features & score
  const candidates = [];
  for (const a of anchors) {
    const feats = computeZoneFeatures(sorted, a.price, a.idx, atr, opts);
    const score = scoreZone(feats, atr, opts);
    candidates.push({
      price: a.price,
      bandHi: feats.bandHi,
      bandLo: feats.bandLo,
      score,
    });
  }

  // 4) Cluster nearby candidates to avoid overlap noise
  const clusterTol = opts.clusterTolerance ?? 1.5; // $ tolerance between centers
  const clusters = clusterZones(candidates, clusterTol);
  if (!clusters.length) return [];

  // 5) Sort clusters by score (institutional strength) DESC
  clusters.sort((a, b) => b.score - a.score);

  // Debug: log top candidates (optional)
  const topForLog = clusters.slice(0, 10).map((z) => ({
    price: z.price,
    band: [Number(z.bandHi.toFixed(2)), Number(z.bandLo.toFixed(2))],
    score: Number(z.score.toFixed(2)),
  }));
  // This will show up in the job logs when you run updateSmzLevels.js
  console.log("[SMZ] Top zone candidates:", topForLog);

  // 6) Take top N zones
  const maxZones = opts.maxZones ?? 6;
  const selected = clusters.slice(0, maxZones);

  // 7) Map to final levels with 0–100 strength
  let maxScore = 0;
  for (const z of selected) {
    if (z.score > maxScore) maxScore = z.score;
  }
  const maxForNorm = maxScore || 1;

  const levels = selected.map((z) => {
    const hi = z.bandHi;
    const lo = z.bandLo;
    const center = (hi + lo) / 2;
    const rel = z.score / maxForNorm;
    const strength = Math.round(40 + rel * 60); // scale into [40,100]

    return {
      type: "distribution", // we can later derive accumulation vs distribution based on flow
      price: center,
      priceRange: [Number(hi.toFixed(2)), Number(lo.toFixed(2))],
      strength,
    };
  });

  return levels;
}
