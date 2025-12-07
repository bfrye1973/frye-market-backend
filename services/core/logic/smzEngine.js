// services/core/logic/smzEngine.js
// FINAL INSTITUTIONAL ENGINE (Option B soft-cap ~6 pts)

export function computeMajorZones(barsAsc) {
  if (!Array.isArray(barsAsc) || barsAsc.length === 0) return [];

  // -------- PARAMETERS --------
  const LOOKBACK = 1200;                     // ~3–4 months of 30m/1h bars
  const CLUSTER_WINDOW = 12;                 // bars scanned per window
  const WICK_TOL = 0.35;                     // how close wicks must be (pts)
  const SOFT_CAP = 6.2;                      // Option B soft max zone width
  const HARD_CAP = 8.5;                      // absolute emergency width limit
  const MIN_TOUCHES = 5;                     // wick touches required for zone

  // restrict bars
  const bars = barsAsc.slice(-LOOKBACK);

  // convert bars → wick levels
  const wickLevels = [];
  for (let b of bars) {
    wickLevels.push(b.high);
    wickLevels.push(b.low);
  }
  wickLevels.sort((a, b) => a - b);

  // -------- step 1: detect wick clusters --------
  const clusters = [];
  let cur = [wickLevels[0]];

  for (let i = 1; i < wickLevels.length; i++) {
    const w = wickLevels[i];
    if (Math.abs(w - cur[cur.length - 1]) <= WICK_TOL) {
      cur.push(w);
    } else {
      if (cur.length >= MIN_TOUCHES) clusters.push(cur.slice());
      cur = [w];
    }
  }
  if (cur.length >= MIN_TOUCHES) clusters.push(cur);

  if (clusters.length === 0) return [];

  // -------- step 2: convert clusters → raw footprints --------
  let footprints = clusters.map(c => {
    const lo = Math.min(...c);
    const hi = Math.max(...c);
    return {
      type: "institutional",
      min: lo,
      max: hi,
      width: hi - lo,
      touches: c.length
    };
  });

  // -------- step 3: merge overlapping footprints --------
  footprints.sort((a, b) => a.min - b.min);

  const merged = [];
  let curZ = footprints[0];

  for (let i = 1; i < footprints.length; i++) {
    let z = footprints[i];

    const overlap =
      z.min <= curZ.max + WICK_TOL &&
      z.max >= curZ.min - WICK_TOL;

    if (overlap) {
      curZ.min = Math.min(curZ.min, z.min);
      curZ.max = Math.max(curZ.max, z.max);
      curZ.width = curZ.max - curZ.min;
      curZ.touches += z.touches;
    } else {
      merged.push(curZ);
      curZ = z;
    }
  }
  merged.push(curZ);

  // -------- step 4: apply SOFT CAP (Option B) --------
  let finalZones = [];

  for (let z of merged) {
    if (z.width <= SOFT_CAP) {
      finalZones.push(z);
      continue;
    }

    // if footprint slightly wider (soft-cap overflow)
    if (z.width > SOFT_CAP && z.width <= HARD_CAP) {
      // split into up to 2 zones
      const mid = z.min + SOFT_CAP;
      finalZones.push({
        type: "institutional",
        min: z.min,
        max: mid,
        width: SOFT_CAP,
        touches: z.touches
      });
      finalZones.push({
        type: "institutional",
        min: mid,
        max: z.max,
        width: z.max - mid,
        touches: z.touches
      });
      continue;
    }

    // if somehow huge footprint (rare)
    let start = z.min;
    while (start < z.max) {
      const end = Math.min(start + SOFT_CAP, z.max);
      finalZones.push({
        type: "institutional",
        min: start,
        max: end,
        width: end - start,
        touches: z.touches
      });
      start = end;
    }
  }

  // clean final
  return finalZones.map(z => ({
    type: "institutional",
    price: Number(((z.min + z.max) / 2).toFixed(2)),
    priceRange: [Number(z.min.toFixed(2)), Number(z.max.toFixed(2))],
    strength: z.touches
  }));
}

// MAIN EXPORT
export function computeSmartMoneyLevels(barsAsc) {
  if (!Array.isArray(barsAsc) || barsAsc.length === 0) {
    return [];
  }

  const majorZones = computeMajorZones(barsAsc);

  return majorZones;
}
