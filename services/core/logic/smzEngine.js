// ============================================================================
//  Smart Money Zone Engine  (Institutional Zones + Accum/Dist Zones)
//  OPTION A: Combined Analysis from 30m + 1h + 4h
// ============================================================================

/**
 * A bar looks like:
 * { time, open, high, low, close, volume }
 */

const MAX_ZONE_WIDTH = 5.0;      // max allowed zone size in points
const MIN_TOUCHES = 3;           // minimum wick hits or consolidation touches
const MAX_ZONES = 6;             // final number of zones returned

// ============================================================================
// 1. Detect Wick Touches
// ============================================================================
function detectWickTouches(bars) {
  let touches = [];

  for (let i = 1; i < bars.length - 1; i++) {
    const b = bars[i];

    const wickHigh = b.high - Math.max(b.open, b.close);
    const wickLow  = Math.min(b.open, b.close) - b.low;

    const isHighTouch = wickHigh >= 0.15 && wickHigh <= 0.80;
    const isLowTouch  = wickLow  >= 0.15 && wickLow  <= 0.80;

    if (isHighTouch) {
      touches.push({ price: b.high, dir: "sell", time: b.time });
    }
    if (isLowTouch) {
      touches.push({ price: b.low, dir: "buy", time: b.time });
    }
  }

  return touches;
}

// ============================================================================
// 2. Detect Consolidation Blocks
// ============================================================================
function detectConsolidationZones(bars, tfLabel) {
  let zones = [];

  const WINDOW = tfLabel === "30m" ? 20 :
                 tfLabel === "1h"  ? 30 :
                                     40;

  for (let i = WINDOW; i < bars.length; i++) {
    const slice = bars.slice(i - WINDOW, i);

    const highs = slice.map(b => b.high);
    const lows  = slice.map(b => b.low);

    const zoneHigh = Math.max(...highs);
    const zoneLow  = Math.min(...lows);

    const width = zoneHigh - zoneLow;
    if (width <= MAX_ZONE_WIDTH && width >= 1.0) {
      zones.push({
        low: zoneLow,
        high: zoneHigh,
        strength: 10,
      });
    }
  }

  return zones;
}

// ============================================================================
// 3. Merge Wick Touches Into Price Buckets
// ============================================================================
function bucketTouches(touches) {
  touches.sort((a, b) => a.price - b.price);

  let buckets = [];
  let bucket = [];

  for (const t of touches) {
    if (bucket.length === 0) {
      bucket.push(t);
      continue;
    }

    const last = bucket[bucket.length - 1];
    if (Math.abs(t.price - last.price) <= 1.25) {
      bucket.push(t);
    } else {
      buckets.push(bucket);
      bucket = [t];
    }
  }
  if (bucket.length) buckets.push(bucket);

  return buckets;
}

// ============================================================================
// 4. Build Zones From Buckets
// ============================================================================
function buildZonesFromBuckets(buckets) {
  let zones = [];

  for (const bucket of buckets) {
    if (bucket.length < MIN_TOUCHES) continue;

    const prices = bucket.map(b => b.price);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const width = high - low;
    if (width > MAX_ZONE_WIDTH) continue;

    const buys = bucket.filter(b => b.dir === "buy").length;
    const sells = bucket.filter(b => b.dir === "sell").length;

    const type = buys > sells ? "accumulation"
                              : "distribution";

    zones.push({
      type,
      low,
      high,
      strength: bucket.length,
    });
  }

  return zones;
}

// ============================================================================
// 5. Merge All Zones (Consolidation + Wick Buckets) Across TFs
// ============================================================================
function mergeZones(allZones) {
  allZones.sort((a, b) => a.low - b.low);

  let merged = [];
  let current = null;

  for (const z of allZones) {
    if (!current) {
      current = { ...z };
      continue;
    }
    if (z.low <= current.high + 1.25) {
      current.low = Math.min(current.low, z.low);
      current.high = Math.max(current.high, z.high);
      current.strength += z.strength;
    } else {
      merged.push(current);
      current = { ...z };
    }
  }
  if (current) merged.push(current);

  for (const z of merged) {
    if (z.high - z.low > MAX_ZONE_WIDTH) {
      const mid = (z.high + z.low) / 2;
      z.high = mid + MAX_ZONE_WIDTH / 2;
      z.low  = mid - MAX_ZONE_WIDTH / 2;
    }
  }

  return merged;
}

// ============================================================================
// 6. Rank + Return Best Final Zones
// ============================================================================
function finalizeZones(zones) {
  zones.sort((a, b) => b.strength - a.strength);
  zones = zones.slice(0, MAX_ZONES);

  return zones.map(z => ({
    type: z.type,
    strength: z.strength,
    priceRange: [Number(z.low.toFixed(2)), Number(z.high.toFixed(2))]
  }));
}

// ============================================================================
// 7. MAIN ENGINE ENTRY POINT
// ============================================================================
export function computeSmartMoneyZones(bars30, bars1h, bars4h) {

  const touches30 = detectWickTouches(bars30);
  const touches1h = detectWickTouches(bars1h);
  const touches4h = detectWickTouches(bars4h);

  const buckets = bucketTouches([
    ...touches30,
    ...touches1h,
    ...touches4h
  ]);

  const wickZones = buildZonesFromBuckets(buckets);
  const cons30 = detectConsolidationZones(bars30, "30m");
  const cons1h = detectConsolidationZones(bars1h, "1h");
  const cons4h = detectConsolidationZones(bars4h, "4h");

  const merged = mergeZones([...wickZones, ...cons30, ...cons1h, ...cons4h]);

  return finalizeZones(merged);
}
