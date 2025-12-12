// services/core/logic/smzShelvesScanner.js
// Smart Money Shelves Scanner (Script 2)
// - Uses 10m, 30m, 1h bars
// - Looks near current price (±bandPoints, default 40)
// - Finds accumulation (blue) and distribution (red) shelves
// - Output matches SMZ level shape: { type, price, priceRange:[hi, lo], strength }

// ---------- Tunable knobs (SPY defaults) ----------

const BAND_POINTS = 40;           // ±40 points around current price
const SHELF_MIN_WIDTH = 0.5;      // in points
const SHELF_MAX_WIDTH = 3.0;      // in points
const BODY_TO_RANGE_MAX = 0.5;    // avgBody / avgRange
const RANGE_TO_ATR_MAX = 1.0;     // avgRange / ATR
const OVERLAP_RATIO_MIN = 0.7;    // % bodies fully inside band
const STRONG_WICK_ATR = 0.7;      // wick > 0.7 * ATR
const BREAK_EPS = 0.05;           // small buffer above/below shelf
const BREAK_LOOKAHEAD_BARS = 10;  // bars to look ahead for breakout
const DISP_MIN_ATR = 0.6;         // min move after breakout, normalized by ATR

const MAX_SHELVES = 12;           // cap shelves returned

// ---------- Types ----------
// Bar: { time, open, high, low, close, volume }

// ---------- Helpers ----------

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

// Simple ATR over last N bars (on 10m)
function computeATR(bars, period = 50) {
  if (!Array.isArray(bars) || bars.length < 2) return 1;
  const n = bars.length;
  const start = Math.max(1, n - period);
  let sumTR = 0;
  let count = 0;
  for (let i = start; i < n; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (!isFiniteBar(cur) || !isFiniteBar(prev)) continue;
    const tr1 = cur.high - cur.low;
    const tr2 = Math.abs(cur.high - prev.close);
    const tr3 = Math.abs(cur.low - prev.close);
    const tr = Math.max(tr1, tr2, tr3);
    sumTR += tr;
    count++;
  }
  if (count === 0) return 1;
  const atr = sumTR / count;
  return atr > 0 ? atr : 1;
}

// Distance weight: nearer shelves get higher relevance
function distanceWeight(shelfCenter, currentPrice, bandPoints = BAND_POINTS) {
  if (!Number.isFinite(currentPrice)) return 1;
  const d = Math.abs(shelfCenter - currentPrice);
  if (d >= bandPoints) return 0;
  // Linear fade: 1 at 0, 0 at bandPoints
  return 1 - d / bandPoints;
}

// ---------- Core shelf detection on 10m ----------

/**
 * Find raw shelf candidates on 10m bars using consolidation + wicks + breakout.
 *
 * @param {Array} bars10m
 * @param {Array} bars30m
 * @param {Array} bars1h
 * @param {number} bandPoints
 * @returns {Array<{ type, price, priceRange:[number,number], strength:number }>}
 */
export function computeShelves({ bars10m, bars30m, bars1h, bandPoints = BAND_POINTS }) {
  if (!Array.isArray(bars10m) || bars10m.length < 20) {
    console.warn("[SMZ Shelves] Not enough 10m bars");
    return [];
  }

  // Sort by time
  const b10 = bars10m.filter(isFiniteBar).sort((a, b) => a.time - b.time);
  const b30 = (bars30m || []).filter(isFiniteBar).sort((a, b) => a.time - b.time);
  const b1h = (bars1h || []).filter(isFiniteBar).sort((a, b) => a.time - b.time);

  const lastBar = b10[b10.length - 1];
  const currentPrice = lastBar.close;
  const bandLow = currentPrice - bandPoints;
  const bandHigh = currentPrice + bandPoints;

  const atr10 = computeATR(b10, 50);

  // Use only 10m bars inside ±bandPoints
  const idxStart = b10.findIndex((bar) => bar.high >= bandLow && bar.low <= bandHigh);
  if (idxStart === -1) {
    console.log("[SMZ Shelves] No 10m bars intersect the band");
    return [];
  }

  const candidates = [];

  // Window lengths: 3, 5, 7 bars
  const windowLengths = [3, 5, 7];
  const n = b10.length;

  for (const win of windowLengths) {
    for (let endIdx = idxStart + win - 1; endIdx < n; endIdx++) {
      const startIdx = endIdx - win + 1;
      const slice = b10.slice(startIdx, endIdx + 1);

      // Basic price band stats
      let bandHi = -Infinity;
      let bandLo = Infinity;
      let bodySum = 0;
      let rangeSum = 0;
      let bodyInsideCount = 0;
      let count = 0;

      for (const bar of slice) {
        if (!isFiniteBar(bar)) continue;
        bandHi = Math.max(bandHi, bar.high);
        bandLo = Math.min(bandLo, bar.low);
        const body = Math.abs(bar.close - bar.open);
        const range = bar.high - bar.low;
        bodySum += body;
        rangeSum += range;
        count++;

        const bodyHi = Math.max(bar.open, bar.close);
        const bodyLo = Math.min(bar.open, bar.close);
        if (bodyHi <= bandHi && bodyLo >= bandLo) {
          bodyInsideCount++;
        }
      }

      if (count === 0) continue;

      const width = bandHi - bandLo;
      if (width < SHELF_MIN_WIDTH || width > SHELF_MAX_WIDTH) continue;

      const avgBody = bodySum / count;
      const avgRange = rangeSum / count || 1e-6;
      const bodyToRange = avgBody / avgRange;
      const overlapRatio = bodyInsideCount / count;

      // Compression vs ATR
      const rangeToATR = avgRange / (atr10 || 1);

      // Consolidation test
      const isConsolidation =
        bodyToRange <= BODY_TO_RANGE_MAX &&
        rangeToATR <= RANGE_TO_ATR_MAX &&
        overlapRatio >= OVERLAP_RATIO_MIN;

      if (!isConsolidation) continue;

      // Wick behavior in the same window
      let strongLower = 0;
      let strongUpper = 0;

      for (const bar of slice) {
        const bodyHi = Math.max(bar.open, bar.close);
        const bodyLo = Math.min(bar.open, bar.close);
        const upperWick = bar.high - bodyHi;
        const lowerWick = bodyLo - bar.low;
        const upperNorm = upperWick / (atr10 || 1);
        const lowerNorm = Math.abs(lowerWick) / (atr10 || 1);
        if (lowerNorm >= STRONG_WICK_ATR) strongLower++;
        if (upperNorm >= STRONG_WICK_ATR) strongUpper++;
      }

      let wickBias = "neutral";
      if (strongLower > strongUpper + 1) wickBias = "buy";
      else if (strongUpper > strongLower + 1) wickBias = "sell";

      const center = (bandHi + bandLo) / 2;

      // Look ahead for breakout direction on 10m
      const breakout = detectBreakout(b10, endIdx, bandHi, bandLo, center, atr10);

      if (breakout.dir === "none") continue;

      // Map breakout + wickBias to shelf type
      let type = null;
      if (breakout.dir === "up") {
        // Ideally buy bias or neutral
        if (wickBias === "sell") continue; // conflict
        type = "accumulation";
      } else if (breakout.dir === "down") {
        if (wickBias === "buy") continue; // conflict
        type = "distribution";
      }

      if (!type) continue;

      // Quality score: narrowness + compression + wick cluster + breakout strength
      const widthScore = 1 - (width - SHELF_MIN_WIDTH) / (SHELF_MAX_WIDTH - SHELF_MIN_WIDTH);
      const compressScore = 1 - (rangeToATR / RANGE_TO_ATR_MAX);
      const wickScore =
        wickBias === "buy" || wickBias === "sell"
          ? Math.min((strongLower + strongUpper) / win, 1)
          : 0.3; // neutral wick bias but still a shelf

      const breakoutScore = Math.min(breakout.moveATR / DISP_MIN_ATR, 2) / 2; // 0..1

      // Distance relevance
      const distWeight = distanceWeight(center, currentPrice, bandPoints);

      // Multi-TF confirmation (simple boost if 30m/1h also show a range around this price)
      const multiTFBoost = computeMultiTFBoost(center, bandHi, bandLo, b30, b1h);

      const baseQuality =
        0.3 * widthScore +
        0.25 * compressScore +
        0.25 * wickScore +
        0.2 * breakoutScore;

      const finalScore = baseQuality * distWeight * multiTFBoost;

      if (finalScore <= 0) continue;

      candidates.push({
        type,
        price: center,
        priceRange: [bandHi, bandLo],
        strength: finalScore, // 0–1 for now, normalize later
      });
    }
  }

  if (!candidates.length) {
    console.log("[SMZ Shelves] No shelf candidates found");
    return [];
  }

  // Merge overlapping shelves of same type, keep best score
  const merged = mergeShelves(candidates);

  // Normalize 0–1 scores to 40–100 like main SMZ engine
  let maxScore = 0;
  for (const s of merged) {
    if (s.strength > maxScore) maxScore = s.strength;
  }
  if (maxScore <= 0) maxScore = 1;

  const levels = merged
    .map((s) => {
      const rel = s.strength / maxScore;
      const strength = Math.round(40 + 60 * rel); // 40–100
      return {
        type: s.type, // "accumulation" | "distribution"
        price: s.price,
        priceRange: [
          Number(s.priceRange[0].toFixed(2)),
          Number(s.priceRange[1].toFixed(2)),
        ],
        strength,
      };
    })
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_SHELVES);

  console.log(
    `[SMZ Shelves] Final shelves: ${levels.length}. ` +
      `Acc=${levels.filter((z) => z.type === "accumulation").length}, ` +
      `Dist=${levels.filter((z) => z.type === "distribution").length}`
  );

  return levels;
}

// ---------- Breakout detection ----------

function detectBreakout(bars, endIdx, bandHi, bandLo, center, atr10) {
  const n = bars.length;
  const maxIdx = Math.min(n - 1, endIdx + BREAK_LOOKAHEAD_BARS);
  let up = false;
  let down = false;
  let maxMoveUp = 0;
  let maxMoveDown = 0;

  for (let i = endIdx + 1; i <= maxIdx; i++) {
    const bar = bars[i];
    if (!isFiniteBar(bar)) continue;
    const close = bar.close;

    if (!up && close > bandHi + BREAK_EPS) {
      const move = (close - center) / (atr10 || 1);
      if (move >= DISP_MIN_ATR) {
        up = true;
        maxMoveUp = Math.max(maxMoveUp, move);
      }
    }

    if (!down && close < bandLo - BREAK_EPS) {
      const move = (center - close) / (atr10 || 1);
      if (move >= DISP_MIN_ATR) {
        down = true;
        maxMoveDown = Math.max(maxMoveDown, move);
      }
    }

    // Track extremes regardless
    const moveUp = (bar.high - center) / (atr10 || 1);
    const moveDown = (center - bar.low) / (atr10 || 1);
    if (moveUp > maxMoveUp) maxMoveUp = moveUp;
    if (moveDown > maxMoveDown) maxMoveDown = moveDown;
  }

  if (!up && !down) return { dir: "none", moveATR: 0 };
  if (up && !down) return { dir: "up", moveATR: maxMoveUp };
  if (down && !up) return { dir: "down", moveATR: maxMoveDown };

  // Both happened: pick stronger side
  if (maxMoveUp >= maxMoveDown) return { dir: "up", moveATR: maxMoveUp };
  return { dir: "down", moveATR: maxMoveDown };
}

// ---------- Multi-TF boost (very simple) ----------

function computeMultiTFBoost(center, hi, lo, bars30m, bars1h) {
  let boost = 1;

  const rangeMargin = (hi - lo) * 0.5 || 0.5;
  const zoneHi = hi + rangeMargin;
  const zoneLo = lo - rangeMargin;

  let hit30 = false;
  for (const bar of bars30m) {
    if (!isFiniteBar(bar)) continue;
    if (bar.high >= zoneLo && bar.low <= zoneHi) {
      hit30 = true;
      break;
    }
  }

  let hit1h = false;
  for (const bar of bars1h) {
    if (!isFiniteBar(bar)) continue;
    if (bar.high >= zoneLo && bar.low <= zoneHi) {
      hit1h = true;
      break;
    }
  }

  if (hit30) boost += 0.2;
  if (hit1h) boost += 0.2;

  // clamp
  if (boost > 1.6) boost = 1.6;
  return boost;
}

// ---------- Merge overlapping shelves ----------

function mergeShelves(candidates) {
  if (!candidates.length) return [];

  const sorted = candidates
    .slice()
    .sort((a, b) => a.priceRange[1] - b.priceRange[1]); // sort by low

  const merged = [];
  let current = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.type !== current.type) {
      merged.push(current);
      current = { ...s };
      continue;
    }

    const [hi1, lo1] = current.priceRange;
    const [hi2, lo2] = s.priceRange;
    const overlapHi = Math.min(hi1, hi2);
    const overlapLo = Math.max(lo1, lo2);
    const overlapWidth = Math.max(0, overlapHi - overlapLo);

    const shouldMerge =
      overlapWidth > 0 || Math.abs(current.price - s.price) <= 0.5;

    if (shouldMerge) {
      const newHi = Math.max(hi1, hi2);
      const newLo = Math.min(lo1, lo2);
      const newCenter = (newHi + newLo) / 2;
      current.priceRange = [newHi, newLo];
      current.price = newCenter;
      current.strength = Math.max(current.strength, s.strength);
    } else {
      merged.push(current);
      current = { ...s };
    }
  }

  merged.push(current);
  return merged;
}
