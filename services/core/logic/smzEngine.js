// /services/core/logic/smzEngine.js
// Smart Money Zone Engine (Phase 1)
// - Computes institutional zones (yellow) + accumulation / distribution shelves (blue / red)
// - Based 100% on wick + candle behavior + consolidation + displacement
// - Designed for SPY scale; thresholds are in points and ATR-normalized

/**
 * Bar shape assumed (per TF):
 * {
 *   time:   number,  // unix seconds
 *   open:   number,
 *   high:   number,
 *   low:    number,
 *   close:  number,
 *   volume: number
 * }
 */

const TF_SPECS = [
  { name: "30m", weight: 1.0 },
  { name: "1h",  weight: 1.4 },
  { name: "4h",  weight: 1.8 },
];

// ---------- CONFIG (TUNED FOR SPY) ----------

// ATR
const ATR_PERIOD = 50;

// Shelf window
const WIN_MIN = 3;   // bars
const WIN_MAX = 7;   // bars

// Price widths (in points)
const MIN_SHELF_WIDTH = 0.5;
const MAX_SHELF_WIDTH = 3.0;   // ≤ 3 pts = shelf
const MAX_INSTITUTIONAL_WIDTH = 6.0; // 3–6 pts = institutional

// Range / body constraints for shelves
const BODY_TO_RANGE_MAX = 0.4;
const RANGE_TO_ATR_MAX = 0.9;
const OVERLAP_RATIO_MIN = 0.7;

// Wick strength (relative to ATR)
const K_STRONG_WICK = 0.7;
const K_MED_WICK = 0.4;

// Price clustering and merging
const PRICE_CLUSTER_EPS = 0.75;       // cluster seeds within this
const MERGE_WINDOW_TIME_GAP = 2;      // bars
const MERGE_ZONE_PRICE_EPS = 0.5;     // merge zones closer than this

// Breakout / displacement
const BREAK_EPS = 0.1;                // small buffer
const DISP_MIN_ATR = 0.7;             // minimum ATR-normalized move for "real" breakout
const DISP_LOOKAHEAD_BARS = 20;

// Scoring weights
const WICK_W1 = 0.6;
const WICK_W2 = 0.3;
const WICK_W3 = 0.1;

const SHELF_S1 = 0.3; // rangeTightness
const SHELF_S2 = 0.25; // volCompression
const SHELF_S3 = 0.2; // overlapFactor
const SHELF_S4 = 0.25; // wickFactor

// Shelf filtering
const SHELF_MIN_STRENGTH = 0.35; // 0–1 pre-normalized

// Global strength normalization (40–100)
const MIN_STRENGTH = 40;
const MAX_STRENGTH = 100;

// Time filters (optional – can tweak or disable)
const MAX_ZONE_AGE_DAYS = 90;   // ignore zones older than this
const MAX_DISTANCE_FROM_PRICE = 40; // in points, from last close

// ---------- Utility ----------

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeATR(bars, period = ATR_PERIOD) {
  if (!bars || bars.length === 0) return [];

  const atr = new Array(bars.length).fill(0);
  let prevClose = bars[0].close;
  let trSum = 0;
  let count = 0;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const high = bar.high;
    const low = bar.low;
    const close = bar.close;

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    const tr = Math.max(tr1, tr2, tr3);

    prevClose = close;

    if (count < period) {
      trSum += tr;
      count += 1;
      atr[i] = trSum / count;
    } else {
      // classic Wilder smoothing
      const prevAtr = atr[i - 1];
      atr[i] = (prevAtr * (period - 1) + tr) / period;
    }
  }
  return atr;
}

function unixNowSec() {
  return Math.floor(Date.now() / 1000);
}

function daysBetweenUnix(t1, t2) {
  const diff = Math.abs(t1 - t2);
  return diff / (60 * 60 * 24);
}

// ---------- Per-candle stats (body, range, wicks) ----------

function buildCandleStats(bars, atr) {
  return bars.map((bar, i) => {
    const o = bar.open;
    const h = bar.high;
    const l = bar.low;
    const c = bar.close;
    const a = atr[i] || 1e-6;

    const body = Math.abs(c - o);
    const range = h - l;

    const upperWick = h - Math.max(c, o);
    const lowerWick = Math.min(c, o) - l;

    const upperNorm = upperWick / a;
    const lowerNorm = lowerWick / a;

    const isStrongUpper = upperNorm >= K_STRONG_WICK;
    const isStrongLower = lowerNorm >= K_STRONG_WICK;
    const isMedUpper = upperNorm >= K_MED_WICK;
    const isMedLower = lowerNorm >= K_MED_WICK;

    return {
      body,
      range,
      upperWick,
      lowerWick,
      upperNorm,
      lowerNorm,
      isStrongUpper,
      isStrongLower,
      isMedUpper,
      isMedLower,
      atr: a
    };
  });
}

// ---------- Shelf Window Detection ----------

function findShelfWindowCandidates(bars, candleStats) {
  const n = bars.length;
  const candidates = [];

  for (let s = 0; s < n; s++) {
    for (let len = WIN_MIN; len <= WIN_MAX; len++) {
      const e = s + len - 1;
      if (e >= n) break;

      let hi = -Infinity;
      let lo = Infinity;
      let sumBody = 0;
      let sumRange = 0;
      let sumATR = 0;

      for (let j = s; j <= e; j++) {
        const bar = bars[j];
        const stats = candleStats[j];
        if (bar.high > hi) hi = bar.high;
        if (bar.low < lo) lo = bar.low;
        sumBody += stats.body;
        sumRange += stats.range;
        sumATR += stats.atr;
      }

      const width = hi - lo;
      if (width < MIN_SHELF_WIDTH || width > MAX_SHELF_WIDTH) {
        continue;
      }

      const count = e - s + 1;
      const avgBody = sumBody / count;
      const avgRange = sumRange / count;
      const avgATR = sumATR / count || 1e-6;

      const bodyToRange = avgBody / (avgRange || 1e-6);
      const rangeToATR = avgRange / (avgATR || 1e-6);
      if (bodyToRange > BODY_TO_RANGE_MAX) continue;   // bodies too big
      if (rangeToATR > RANGE_TO_ATR_MAX) continue;     // not compressed vs ATR

      // overlap: % of bars whose body is fully inside [lo, hi]
      let overlapCount = 0;
      for (let j = s; j <= e; j++) {
        const bar = bars[j];
        const bodyHi = Math.max(bar.open, bar.close);
        const bodyLo = Math.min(bar.open, bar.close);
        if (bodyHi <= hi && bodyLo >= lo) {
          overlapCount += 1;
        }
      }
      const overlapRatio = overlapCount / count;
      if (overlapRatio < OVERLAP_RATIO_MIN) continue;

      candidates.push({
        tf: null, // filled by caller
        startIndex: s,
        endIndex: e,
        timeStart: bars[s].time,
        timeEnd: bars[e].time,
        priceLo: lo,
        priceHi: hi,
        width,
        avgBody,
        avgRange,
        avgATR,
        overlapRatio,
      });
    }
  }

  return candidates;
}

// ---------- Merge shelf windows into ShelfCandidates ----------

function mergeShelfWindows(shelfWindows) {
  if (shelfWindows.length === 0) return [];

  // sort by priceLo
  const sorted = shelfWindows.slice().sort((a, b) => a.priceLo - b.priceLo);

  const merged = [];
  let current = { ...sorted[0], windowCount: 1 };

  for (let i = 1; i < sorted.length; i++) {
    const win = sorted[i];
    const overlapLo = Math.max(current.priceLo, win.priceLo);
    const overlapHi = Math.min(current.priceHi, win.priceHi);
    const overlapWidth = Math.max(0, overlapHi - overlapLo);

    const timeGap =
      win.startIndex - current.endIndex >= 0
        ? win.startIndex - current.endIndex
        : current.startIndex - win.endIndex;

    const shouldMerge =
      overlapWidth >= MIN_SHELF_WIDTH * 0.5 &&
      timeGap <= MERGE_WINDOW_TIME_GAP;

    if (shouldMerge) {
      // merge windows
      current.priceLo = Math.min(current.priceLo, win.priceLo);
      current.priceHi = Math.max(current.priceHi, win.priceHi);
      current.width = current.priceHi - current.priceLo;
      current.timeStart = Math.min(current.timeStart, win.timeStart);
      current.timeEnd = Math.max(current.timeEnd, win.timeEnd);
      current.startIndex = Math.min(current.startIndex, win.startIndex);
      current.endIndex = Math.max(current.endIndex, win.endIndex);

      // recompute averages (simple)
      current.avgBody = (current.avgBody * current.windowCount + win.avgBody) / (current.windowCount + 1);
      current.avgRange = (current.avgRange * current.windowCount + win.avgRange) / (current.windowCount + 1);
      current.avgATR = (current.avgATR * current.windowCount + win.avgATR) / (current.windowCount + 1);
      current.overlapRatio = (current.overlapRatio * current.windowCount + win.overlapRatio) / (current.windowCount + 1);
      current.windowCount += 1;
    } else {
      merged.push(current);
      current = { ...win, windowCount: 1 };
    }
  }
  merged.push(current);
  return merged;
}

// ---------- Wick clustering / bias for ShelfCandidates ----------

function attachWickStatsToShelves(shelfCandidates, bars, candleStats) {
  for (const shelf of shelfCandidates) {
    let sumUpWickNorm = 0;
    let sumDownWickNorm = 0;
    let strongUpCount = 0;
    let strongDownCount = 0;
    let maxUpWickNorm = 0;
    let maxDownWickNorm = 0;
    let totalTouches = 0;

    const s = Math.max(0, shelf.startIndex - 1);
    const e = Math.min(bars.length - 1, shelf.endIndex + 1);

    for (let j = s; j <= e; j++) {
      const bar = bars[j];
      const stats = candleStats[j];
      // consider bars whose body intersects shelf price range
      const bodyHi = Math.max(bar.open, bar.close);
      const bodyLo = Math.min(bar.open, bar.close);

      if (bodyHi < shelf.priceLo || bodyLo > shelf.priceHi) {
        continue;
      }

      totalTouches += 1;
      sumUpWickNorm += stats.upperNorm;
      sumDownWickNorm += stats.lowerNorm;

      if (stats.isStrongUpper) strongUpCount += 1;
      if (stats.isStrongLower) strongDownCount += 1;

      if (stats.upperNorm > maxUpWickNorm) maxUpWickNorm = stats.upperNorm;
      if (stats.lowerNorm > maxDownWickNorm) maxDownWickNorm = stats.lowerNorm;
    }

    if (totalTouches === 0) {
      shelf.wickScore = 0;
      shelf.wickBias = "neutral";
      shelf.strongUpCount = 0;
      shelf.strongDownCount = 0;
      shelf.totalTouches = 0;
      continue;
    }

    const upWickDensity = strongUpCount / totalTouches;
    const downWickDensity = strongDownCount / totalTouches;
    const sumNorm = sumUpWickNorm + sumDownWickNorm || 1e-6;

    const wickScoreBase =
      WICK_W1 * (sumNorm / totalTouches) +
      WICK_W2 * (strongUpCount + strongDownCount) +
      WICK_W3 * (maxUpWickNorm + maxDownWickNorm);

    const buyPressure =
      downWickDensity + 0.5 * (sumDownWickNorm / sumNorm);
    const sellPressure =
      upWickDensity + 0.5 * (sumUpWickNorm / sumNorm);

    let wickBias = "neutral";
    const BIAS_THRESH = 0.1;
    if (buyPressure - sellPressure > BIAS_THRESH) wickBias = "buy";
    else if (sellPressure - buyPressure > BIAS_THRESH) wickBias = "sell";

    shelf.wickScore = wickScoreBase;
    shelf.wickBias = wickBias;
    shelf.strongUpCount = strongUpCount;
    shelf.strongDownCount = strongDownCount;
    shelf.totalTouches = totalTouches;
  }

  return shelfCandidates;
}

// ---------- Shelf structural strength ----------

function computeShelfStrength(shelf) {
  // 0–1 scaled components
  const width = shelf.width || (shelf.priceHi - shelf.priceLo);
  const rangeTightness = clamp(MAX_SHELF_WIDTH / (width || 1e-6), 0, 1);
  const volCompression = clamp(1 - (shelf.avgRange / (shelf.avgATR || 1e-6)), 0, 1);
  const overlapFactor = clamp((shelf.windowCount || 1) / 4, 0, 1); // 4+ windows = max
  const wickFactor = clamp(shelf.wickScore / 5, 0, 1); // rough scaling

  const strength =
    SHELF_S1 * rangeTightness +
    SHELF_S2 * volCompression +
    SHELF_S3 * overlapFactor +
    SHELF_S4 * wickFactor;

  return clamp(strength, 0, 1);
}

// ---------- Shelf breakout direction (Accum vs Dist) ----------

function classifyShelfBreakoutDirection(shelf, bars, candleStats) {
  const n = bars.length;
  const endIndex = shelf.endIndex;
  const hi = shelf.priceHi;
  const lo = shelf.priceLo;
  const center = (hi + lo) / 2;

  const maxIndex = Math.min(n - 1, endIndex + DISP_LOOKAHEAD_BARS);
  let maxUpMove = 0;
  let maxDownMove = 0;

  let upBreak = false;
  let downBreak = false;

  for (let i = endIndex + 1; i <= maxIndex; i++) {
    const bar = bars[i];
    const stats = candleStats[i];
    const close = bar.close;
    const atr = stats.atr || 1e-6;

    if (!upBreak && close > hi + BREAK_EPS) {
      const move = (close - center) / atr;
      if (move >= DISP_MIN_ATR) {
        upBreak = true;
        maxUpMove = Math.max(maxUpMove, move);
      }
    }

    if (!downBreak && close < lo - BREAK_EPS) {
      const move = (center - close) / atr;
      if (move >= DISP_MIN_ATR) {
        downBreak = true;
        maxDownMove = Math.max(maxDownMove, move);
      }
    }

    // track extremes regardless
    const upMove = (bar.high - center) / atr;
    const downMove = (center - bar.low) / atr;
    if (upMove > maxUpMove) maxUpMove = upMove;
    if (downMove > maxDownMove) maxDownMove = downMove;
  }

  let breakoutDir = "none";
  if (upBreak && !downBreak) breakoutDir = "up";
  else if (downBreak && !upBreak) breakoutDir = "down";
  else if (upBreak && downBreak) {
    // rare; pick stronger move
    breakoutDir = maxUpMove >= maxDownMove ? "up" : "down";
  }

  shelf.breakoutDir = breakoutDir;

  let type = "neutral";
  if (breakoutDir === "up") type = "accumulation";
  else if (breakoutDir === "down") type = "distribution";

  shelf.zoneType = type;
  return shelf;
}

// ---------- Convert shelves to zone objects ----------

function shelvesToZones(shelfCandidates) {
  const zones = [];

  for (const shelf of shelfCandidates) {
    const shelfStrength = computeShelfStrength(shelf);
    if (shelfStrength < SHELF_MIN_STRENGTH) continue;

    const hi = shelf.priceHi;
    const lo = shelf.priceLo;
    const center = (hi + lo) / 2;

    let type = shelf.zoneType || "neutral";
    if (type === "neutral") continue; // optional: skip neutral shelves

    zones.push({
      type, // "accumulation" or "distribution"
      price: center,
      priceRange: [hi, lo],
      // raw strength will be normalized with institutional later
      _rawStrength: shelfStrength,
      // meta
      _width: hi - lo,
      _source: "shelf",
    });
  }

  return zones;
}

// ---------- Institutional Seed Detection (simplified but aligned) ----------

function findInstitutionalSeeds(bars, candleStats) {
  // Very compact version of 12-question model:
  // 1) strong wick activity
  // 2) consolidation
  // 3) displacement + retests
  const seeds = [];

  const n = bars.length;
  if (n === 0) return seeds;

  // Basic wick-driven seeds
  for (let i = 1; i < n - 1; i++) {
    const bar = bars[i];
    const stats = candleStats[i];

    const strongUpper = stats.isStrongUpper;
    const strongLower = stats.isStrongLower;

    if (!strongUpper && !strongLower) continue;

    const levelPrice = strongUpper ? bar.high : bar.low;

    seeds.push({
      index: i,
      time: bar.time,
      price: levelPrice,
      wickSide: strongUpper ? "upper" : "lower",
      baseBarIndex: i,
    });
  }

  // basic consolidation seeds (mid-price of tight windows that didn't become shelves)
  // reuse shelf window finder but with broader width maybe; for now, keep seeds from wicks only.

  return seeds;
}

// ---------- Bucket institutional seeds into price clusters ----------

function bucketSeedsByPrice(seeds, bars, candleStats, tfWeight) {
  if (seeds.length === 0) return [];

  // Sort seeds by price
  const sorted = seeds.slice().sort((a, b) => a.price - b.price);
  const buckets = [];
  let current = {
    priceCenter: sorted[0].price,
    priceHi: sorted[0].price,
    priceLo: sorted[0].price,
    seedIndices: [sorted[0].index],
    wickSides: [sorted[0].wickSide],
  };

  for (let i = 1; i < sorted.length; i++) {
    const seed = sorted[i];
    const center = current.priceCenter;
    if (Math.abs(seed.price - center) <= PRICE_CLUSTER_EPS) {
      current.priceHi = Math.max(current.priceHi, seed.price);
      current.priceLo = Math.min(current.priceLo, seed.price);
      current.priceCenter = (current.priceHi + current.priceLo) / 2;
      current.seedIndices.push(seed.index);
      current.wickSides.push(seed.wickSide);
    } else {
      buckets.push(current);
      current = {
        priceCenter: seed.price,
        priceHi: seed.price,
        priceLo: seed.price,
        seedIndices: [seed.index],
        wickSides: [seed.wickSide],
      };
    }
  }
  buckets.push(current);

  // Enrich buckets with simple scores: wickScore, dispScore, retestCount, tfWeight
  for (const bucket of buckets) {
    let sumUpWickNorm = 0;
    let sumDownWickNorm = 0;
    let strongUpCount = 0;
    let strongDownCount = 0;

    for (const idx of bucket.seedIndices) {
      const stats = candleStats[idx];
      sumUpWickNorm += stats.upperNorm;
      sumDownWickNorm += stats.lowerNorm;
      if (stats.isStrongUpper) strongUpCount++;
      if (stats.isStrongLower) strongDownCount++;
    }
    const touches = bucket.seedIndices.length;
    const sumNorm = sumUpWickNorm + sumDownWickNorm || 1e-6;

    const wickScore =
      (sumNorm / touches) +
      0.5 * (strongUpCount + strongDownCount);

    // displacement + retests (simplified)
    // look ahead from earliest seed
    const firstIdx = Math.min(...bucket.seedIndices);
    const price = bucket.priceCenter;
    const maxIndex = Math.min(bars.length - 1, firstIdx + DISP_LOOKAHEAD_BARS);
    let maxMoveUp = 0;
    let maxMoveDown = 0;
    let retestCount = 0;

    for (let i = firstIdx + 1; i <= maxIndex; i++) {
      const bar = bars[i];
      const stats = candleStats[i];
      const atr = stats.atr || 1e-6;

      const upMove = (bar.high - price) / atr;
      const downMove = (price - bar.low) / atr;

      if (upMove > maxMoveUp) maxMoveUp = upMove;
      if (downMove > maxMoveDown) maxMoveDown = downMove;

      // retest: mid-price inside ±cluster width
      const mid = (bar.high + bar.low) / 2;
      const clusterHalf = (bucket.priceHi - bucket.priceLo) / 2 || 0.5;
      if (Math.abs(mid - price) <= clusterHalf) {
        retestCount += 1;
      }
    }

    const dispScore = Math.max(maxMoveUp, maxMoveDown);

    bucket.wickScore = wickScore;
    bucket.dispScore = dispScore;
    bucket.retestCount = retestCount;
    bucket.tfWeight = tfWeight;
  }

  return buckets;
}

// ---------- Convert institutional buckets to zones ----------

function bucketsToInstitutionalZones(buckets) {
  const zones = [];

  for (const bucket of buckets) {
    const hi = bucket.priceHi;
    const lo = bucket.priceLo;
    const center = bucket.priceCenter;
    const width = hi - lo;

    if (width <= MAX_SHELF_WIDTH || width > MAX_INSTITUTIONAL_WIDTH) {
      // too narrow (shelf) or too wide (unclean)
      continue;
    }

    // Score: combine wickScore, dispScore, retests, tfWeight
    const wickScoreNorm = clamp(bucket.wickScore / 5, 0, 1);
    const dispScoreNorm = clamp(bucket.dispScore / 3, 0, 1);
    const retestNorm = clamp(bucket.retestCount / 5, 0, 1);
    const tfNorm = clamp(bucket.tfWeight / 2, 0, 1);

    const raw = 0.35 * wickScoreNorm +
                0.35 * dispScoreNorm +
                0.2  * retestNorm +
                0.1  * tfNorm;

    zones.push({
      type: "institutional",
      price: center,
      priceRange: [hi, lo],
      _rawStrength: raw,
      _width: width,
      _source: "institutional",
    });
  }

  return zones;
}

// ---------- Merge + normalize zones across TFs ----------

function mergeZones(zones) {
  if (zones.length === 0) return [];

  // First: merge by overlapping price ranges for same type
  const sorted = zones.slice().sort((a, b) => a.priceRange[1] - b.priceRange[1]); // sort by low

  const merged = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const z = sorted[i];
    if (z.type !== current.type) {
      merged.push(current);
      current = { ...z };
      continue;
    }

    const [hi1, lo1] = current.priceRange;
    const [hi2, lo2] = z.priceRange;
    const overlapHi = Math.min(hi1, hi2);
    const overlapLo = Math.max(lo1, lo2);
    const overlapWidth = Math.max(0, overlapHi - overlapLo);

    const shouldMerge =
      overlapWidth >= MERGE_ZONE_PRICE_EPS ||
      Math.abs(current.price - z.price) <= MERGE_ZONE_PRICE_EPS;

    if (shouldMerge) {
      const newHi = Math.max(hi1, hi2);
      const newLo = Math.min(lo1, lo2);
      const newCenter = (newHi + newLo) / 2;
      const newWidth = newHi - newLo;

      current.priceRange = [newHi, newLo];
      current.price = newCenter;
      current._width = newWidth;
      current._rawStrength = Math.max(current._rawStrength, z._rawStrength);
    } else {
      merged.push(current);
      current = { ...z };
    }
  }
  merged.push(current);

  return merged;
}

function normalizeStrength(zones, latestPrice, latestTime) {
  if (zones.length === 0) return [];

  let maxRaw = 0;
  for (const z of zones) {
    if (z._rawStrength > maxRaw) maxRaw = z._rawStrength;
  }
  if (maxRaw <= 0) maxRaw = 1;

  const levels = [];

  for (const z of zones) {
    const center = z.price;
    const dist = Math.abs(center - latestPrice);

    // filter old / far zones (optional)
    // time-based filter: skip if older than MAX_ZONE_AGE_DAYS from latestTime
    // NOTE: Our zones don't store creation time yet; you can extend with _time if needed.

    if (dist > MAX_DISTANCE_FROM_PRICE) continue;

    const rawNorm = z._rawStrength / maxRaw;
    const strength =
      MIN_STRENGTH + rawNorm * (MAX_STRENGTH - MIN_STRENGTH);

    levels.push({
      type: z.type,
      price: z.price,
      priceRange: z.priceRange,
      strength: Math.round(strength),
    });
  }

  // sort by strength desc
  levels.sort((a, b) => b.strength - a.strength);
  return levels;
}

// ---------- Main entry point ----------

function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  // ... keep the whole body exactly as it is ...
}

module.exports = { computeSmartMoneyLevels };

  const allZones = [];

  const tfInputs = [
    { bars: bars30m, spec: TF_SPECS[0] },
    { bars: bars1h,  spec: TF_SPECS[1] },
    { bars: bars4h,  spec: TF_SPECS[2] },
  ];

  for (const tf of tfInputs) {
    const { bars, spec } = tf;
    if (!bars || bars.length === 0) continue;

    const atr = computeATR(bars, ATR_PERIOD);
    const candleStats = buildCandleStats(bars, atr);

    // 1) Micro shelves (accum / dist)
    let shelfWindows = findShelfWindowCandidates(bars, candleStats);
    shelfWindows = shelfWindows.map(w => ({ ...w, tf: spec.name }));
    let shelfCandidates = mergeShelfWindows(shelfWindows);
    shelfCandidates = attachWickStatsToShelves(shelfCandidates, bars, candleStats);
    shelfCandidates = shelfCandidates.map(shelf =>
      classifyShelfBreakoutDirection(shelf, bars, candleStats)
    );
    const shelfZones = shelvesToZones(shelfCandidates);
    for (const z of shelfZones) {
      // boost raw strength slightly by TF weight
      z._rawStrength = z._rawStrength * spec.weight;
      z._source = "shelf_" + spec.name;
      allZones.push(z);
    }

    // 2) Institutional zones
    const seeds = findInstitutionalSeeds(bars, candleStats);
    const buckets = bucketSeedsByPrice(seeds, bars, candleStats, spec.weight);
    const instZones = bucketsToInstitutionalZones(buckets);
    for (const z of instZones) {
      z._rawStrength = z._rawStrength * spec.weight;
      z._source = "inst_" + spec.name;
      allZones.push(z);
    }
  }

  if (allZones.length === 0) {
    return [];
  }

  // Merge overlapping zones and normalize strength
  const mergedZones = mergeZones(allZones);

  const latestTF = bars30m && bars30m.length ? bars30m : (bars1h && bars1h.length ? bars1h : bars4h);
  const latestBar = latestTF[latestTF.length - 1];
  const latestPrice = latestBar.close;
  const latestTime = latestBar.time || now;

  const levels = normalizeStrength(mergedZones, latestPrice, latestTime);
  return levels;
}

module.exports = {
  computeSmartMoneyLevels,
};
