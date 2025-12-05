// services/core/logic/smzEngine.js
// Smart Money Accumulation / Distribution engine

export function computeAccDistLevelsFromBars(bars, opts = {}) {
  if (!Array.isArray(bars) || bars.length < 20) return [];

  const swingLookback = opts.swingLookback ?? 3;
  const lookaheadBars = opts.lookaheadBars ?? 15;
  const minMovePct = opts.minMovePct ?? 0.006;
  const clusterTolerance = opts.clusterTolerance ?? 1.0;

  const levels = [];

  const isSwingHigh = (i) => {
    const h = bars[i].high;
    for (let k = 1; k <= swingLookback; k++) {
      if (i - k < 0 || i + k >= bars.length) return false;
      if (bars[i - k].high >= h || bars[i + k].high >= h) return false;
    }
    return true;
  };

  const isSwingLow = (i) => {
    const l = bars[i].low;
    for (let k = 1; k <= swingLookback; k++) {
      if (i - k < 0 || i + k >= bars.length) return false;
      if (bars[i - k].low <= l || bars[i + k].low <= l) return false;
    }
    return true;
  };

  for (let i = swingLookback; i < bars.length - swingLookback; i++) {
    const b = bars[i];

    // Distribution: swing high → downside reaction
    if (isSwingHigh(i)) {
      const anchor = b.high;
      let maxDropPct = 0;
      let touchCount = 0;

      for (let j = i + 1; j < Math.min(bars.length, i + 1 + lookaheadBars); j++) {
        const bj = bars[j];
        const dropPct = (anchor - bj.low) / anchor;
        if (dropPct > maxDropPct) maxDropPct = dropPct;
        const mid = (bj.high + bj.low) / 2;
        if (Math.abs(mid - anchor) <= 0.4) touchCount++;
      }

      if (maxDropPct >= minMovePct && touchCount >= 2) {
        const strength = Math.round(
          40 * Math.min(maxDropPct / minMovePct, 2) +
          10 * Math.min(touchCount, 5)
        );

        levels.push({
          type: "distribution",
          price: anchor,
          strength: Math.min(strength, 100),
        });
      }
    }

    // Accumulation: swing low → upside reaction
    if (isSwingLow(i)) {
      const anchor = bars[i].low;
      let maxRallyPct = 0;
      let touchCount = 0;

      for (let j = i + 1; j < Math.min(bars.length, i + 1 + lookaheadBars); j++) {
        const bj = bars[j];
        const rallyPct = (bj.high - anchor) / anchor;
        if (rallyPct > maxRallyPct) maxRallyPct = rallyPct;
        const mid = (bj.high + bj.low) / 2;
        if (Math.abs(mid - anchor) <= 0.4) touchCount++;
      }

      if (maxRallyPct >= minMovePct && touchCount >= 2) {
        const hi = anchor + 1;
        const lo = anchor;

        const strength = Math.round(
          40 * Math.min(maxRallyPct / minMovePct, 2) +
          10 * Math.min(touchCount, 5)
        );

        levels.push({
          type: "accumulation",
          priceRange: [hi, lo],
          strength: Math.min(strength, 100),
        });
      }
    }
  }

  // Cluster zones
  levels.sort((a, b) => {
    const pa = a.price ?? ((a.priceRange[0] + a.priceRange[1]) / 2);
    const pb = b.price ?? ((b.priceRange[0] + b.priceRange[1]) / 2);
    return pa - pb;
  });

  const clustered = [];
  for (const lvl of levels) {
    const center = lvl.price ?? (lvl.priceRange[0] + lvl.priceRange[1]) / 2;
    const last = clustered[clustered.length - 1];

    if (
      last &&
      Math.abs(center - last._center) <= clusterTolerance &&
      lvl.type === last.type
    ) {
      last.strength = Math.max(last.strength, lvl.strength);

      if (lvl.priceRange && last.priceRange) {
        last.priceRange = [
          Math.max(last.priceRange[0], lvl.priceRange[0]),
          Math.min(last.priceRange[1], lvl.priceRange[1]),
        ];
      } else if (lvl.price && last.price) {
        last.price = (last.price + lvl.price) / 2;
      }

      last._center = (last._center + center) / 2;
    } else {
      clustered.push({ ...lvl, _center: center });
    }
  }

  return clustered.map(({ _center, ...zone }) => zone);
}
