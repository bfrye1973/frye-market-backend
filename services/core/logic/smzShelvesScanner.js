// services/core/logic/smzShelvesScanner.js
// Script #2 — Smart Money Shelves Scanner (Acc/Dist)
// Uses 15m + 30m + 1h bars (we label it bars10m in job, but it's actually 15m now)
//
// ✅ CRITICAL FIX (LOCKED):
// - Detect shelves across FULL history (no early prune by bandLow)
// - Apply the ±bandPoints filter ONLY at the end (TradingView behavior)
//
// ✅ NEW FIXES (per user goals):
// 1) Remove accidental early-pruning: distance weighting must NOT zero-out valid shelves
//    before the final band filter.
//    -> Use rangeDistanceWeight (distance from currentPrice to shelf RANGE, not center).
// 2) Add ATH mode: when price is at/near all-time highs, prioritize actionable shelves
//    BELOW price (accumulation) and avoid “needing overhead structure.”
//
// Output objects match SMZ frontend schema:
// { type: "accumulation"|"distribution", price, priceRange:[high,low], strength:40–100 }

const DEFAULT_BAND_POINTS = 40;

// shelf window scan
const WINDOW_SIZES = [3, 5, 7];
const SHELF_MIN_WIDTH = 0.5; // points
const SHELF_MAX_WIDTH = 3.0; // points
const BODY_TO_RANGE_MAX = 0.55;
const OVERLAP_RATIO_MIN = 0.7;

// wick + breakout confirmation
const ATR_PERIOD = 50;
const STRONG_WICK_ATR = 0.7; // wick >= 0.7*ATR counts
const BREAK_EPS = 0.05; // points
const BREAK_LOOKAHEAD = 10; // bars
const DISP_MIN_ATR = 0.6; // breakout displacement confirmation

// ATH mode
const ATH_EPS_ATR = 0.25; // within 0.25*ATR of all-time high => ATH mode
const ATH_ACC_BOOST = 1.10; // slight preference for accumulation shelves at ATH
const ATH_DIST_PENALTY = 0.92; // slight downweight for distribution shelves at ATH

// output controls
const MAX_SHELVES_OUT = 12;

// ---------- helpers ----------
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

function sortBars(bars) {
  return (bars || []).filter(isFiniteBar).sort((a, b) => a.time - b.time);
}

function computeATR(bars, period = ATR_PERIOD) {
  if (!Array.isArray(bars) || bars.length < 2) return 1;
  const n = bars.length;
  const start = Math.max(1, n - period);
  let sum = 0;
  let count = 0;
  for (let i = start; i < n; i++) {
    const cur = bars[i];
    const prev = bars[i - 1];
    if (!isFiniteBar(cur) || !isFiniteBar(prev)) continue;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    sum += tr;
    count++;
  }
  const atr = count ? sum / count : 1;
  return atr > 0 ? atr : 1;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

// Distance from current price to a shelf RANGE (not center).
// - If current is inside [lo,hi] => 1.0
// - If outside => fade linearly until bandPoints
function rangeDistanceWeight(hi, lo, currentPrice, bandPoints) {
  const H = Math.max(hi, lo);
  const L = Math.min(hi, lo);

  if (!(Number.isFinite(H) && Number.isFinite(L) && Number.isFinite(currentPrice))) return 0;

  // inside shelf
  if (currentPrice >= L && currentPrice <= H) return 1;

  // distance to nearest edge
  const d = currentPrice > H ? (currentPrice - H) : (L - currentPrice);
  if (d >= bandPoints) return 0;

  return 1 - d / bandPoints;
}

// TF confirmation boost (does NOT create shelves on its own)
function tfConfirmBoost(hi, lo, bars30m, bars1h) {
  const margin = Math.max(0.5, (hi - lo) * 0.5);
  const zHi = hi + margin;
  const zLo = lo - margin;

  let hit30 = false;
  for (const b of bars30m) {
    if (b.high >= zLo && b.low <= zHi) {
      hit30 = true;
      break;
    }
  }
  let hit1h = false;
  for (const b of bars1h) {
    if (b.high >= zLo && b.low <= zHi) {
      hit1h = true;
      break;
    }
  }

  let boost = 1.0;
  if (hit30) boost += 0.2;
  if (hit1h) boost += 0.2;
  return clamp(boost, 1.0, 1.6);
}

function detectBreakout(bars, endIdx, hi, lo, center, atr) {
  const n = bars.length;
  const maxIdx = Math.min(n - 1, endIdx + BREAK_LOOKAHEAD);

  let up = false,
    down = false;
  let maxUp = 0,
    maxDown = 0;

  for (let i = endIdx + 1; i <= maxIdx; i++) {
    const b = bars[i];
    const close = b.close;

    if (!up && close > hi + BREAK_EPS) {
      const move = (close - center) / atr;
      if (move >= DISP_MIN_ATR) {
        up = true;
        maxUp = Math.max(maxUp, move);
      }
    }
    if (!down && close < lo - BREAK_EPS) {
      const move = (center - close) / atr;
      if (move >= DISP_MIN_ATR) {
        down = true;
        maxDown = Math.max(maxDown, move);
      }
    }

    maxUp = Math.max(maxUp, (b.high - center) / atr);
    maxDown = Math.max(maxDown, (center - b.low) / atr);
  }

  if (!up && !down) return { dir: "none", moveATR: 0 };
  if (up && !down) return { dir: "up", moveATR: maxUp };
  if (down && !up) return { dir: "down", moveATR: maxDown };
  return maxUp >= maxDown ? { dir: "up", moveATR: maxUp } : { dir: "down", moveATR: maxDown };
}

// ✅ stronger merge to eliminate duplicates
function mergeShelves(list) {
  if (!list.length) return [];

  const EPS = 0.75;
  const sorted = list.slice().sort((a, b) => a.priceRange[1] - b.priceRange[1]);
  const out = [];
  let cur = { ...sorted[0] };

  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.type !== cur.type) {
      out.push(cur);
      cur = { ...s };
      continue;
    }

    const [hi1, lo1] = cur.priceRange;
    const [hi2, lo2] = s.priceRange;

    const overlapHi = Math.min(hi1, hi2);
    const overlapLo = Math.max(lo1, lo2);
    const overlap = Math.max(0, overlapHi - overlapLo);

    const closeCenters = Math.abs(cur.price - s.price) <= EPS;
    const closeHighs = Math.abs(hi1 - hi2) <= EPS;
    const closeLows = Math.abs(lo1 - lo2) <= EPS;

    const shouldMerge = overlap > 0 || closeCenters || closeHighs || closeLows;

    if (shouldMerge) {
      const newHi = Math.max(hi1, hi2);
      const newLo = Math.min(lo1, lo2);
      cur.priceRange = [newHi, newLo];
      cur.price = (newHi + newLo) / 2;
      cur._score = Math.max(cur._score, s._score);
    } else {
      out.push(cur);
      cur = { ...s };
    }
  }

  out.push(cur);
  return out;
}

function overlapsBand(hi, lo, bandLow, bandHigh) {
  return hi >= bandLow && lo <= bandHigh;
}

function detectAllTimeHighMode(bars, currentPrice, atr) {
  let maxHigh = -Infinity;
  for (const b of bars) maxHigh = Math.max(maxHigh, b.high);
  if (!Number.isFinite(maxHigh) || !Number.isFinite(currentPrice)) return { athMode: false, maxHigh: null };
  const eps = Math.max(0.25, atr * ATH_EPS_ATR);
  const athMode = currentPrice >= (maxHigh - eps);
  return { athMode, maxHigh };
}

// ---------- main compute ----------
export function computeShelves({ bars10m, bars30m, bars1h, bandPoints = DEFAULT_BAND_POINTS }) {
  const b10 = sortBars(bars10m);
  const b30 = sortBars(bars30m);
  const b1h = sortBars(bars1h);

  if (b10.length < 30) return [];

  const currentPrice = b10[b10.length - 1].close;
  const bandLow = currentPrice - bandPoints;
  const bandHigh = currentPrice + bandPoints;

  const atr = computeATR(b10, ATR_PERIOD);

  const { athMode } = detectAllTimeHighMode(b10, currentPrice, atr);
  if (athMode) {
    // purely informational; job logs can show it
    // console.log("[SHELVES] ATH MODE: true");
  }

  // ✅ Full-history scan
  const startIdx = 0;

  const candidates = [];

  for (const win of WINDOW_SIZES) {
    for (let endIdx = startIdx + win - 1; endIdx < b10.length; endIdx++) {
      const sIdx = endIdx - win + 1;
      const slice = b10.slice(sIdx, endIdx + 1);

      let hi = -Infinity,
        lo = Infinity;
      let bodySum = 0,
        rangeSum = 0,
        inside = 0,
        cnt = 0;

      for (const b of slice) {
        hi = Math.max(hi, b.high);
        lo = Math.min(lo, b.low);
        const body = Math.abs(b.close - b.open);
        const range = b.high - b.low;
        bodySum += body;
        rangeSum += range;
        cnt++;

        const bodyHi = Math.max(b.open, b.close);
        const bodyLo = Math.min(b.open, b.close);
        if (bodyHi <= hi && bodyLo >= lo) inside++;
      }
      if (!cnt) continue;

      const width = hi - lo;
      if (width < SHELF_MIN_WIDTH || width > SHELF_MAX_WIDTH) continue;

      const avgBody = bodySum / cnt;
      const avgRange = rangeSum / cnt || 1e-6;
      const bodyToRange = avgBody / avgRange;
      const overlap = inside / cnt;

      if (bodyToRange > BODY_TO_RANGE_MAX) continue;
      if (overlap < OVERLAP_RATIO_MIN) continue;

      // wick bias
      let strongLower = 0,
        strongUpper = 0;
      for (const b of slice) {
        const bodyHi = Math.max(b.open, b.close);
        const bodyLo = Math.min(b.open, b.close);
        const upperWick = b.high - bodyHi;
        const lowerWick = bodyLo - b.low;
        const upN = upperWick / atr;
        const dnN = Math.abs(lowerWick) / atr;
        if (dnN >= STRONG_WICK_ATR) strongLower++;
        if (upN >= STRONG_WICK_ATR) strongUpper++;
      }

      let wickBias = "neutral";
      if (strongLower > strongUpper + 1) wickBias = "buy";
      else if (strongUpper > strongLower + 1) wickBias = "sell";

      const center = (hi + lo) / 2;

      // breakout confirmation
      const br = detectBreakout(b10, endIdx, hi, lo, center, atr);
      if (br.dir === "none") continue;

      // map to type with wick sanity
      let type = null;
      if (br.dir === "up") {
        if (wickBias === "sell") continue;
        type = "accumulation";
      } else {
        if (wickBias === "buy") continue;
        type = "distribution";
      }

      // score (0..1)
      const widthScore = 1 - (width - SHELF_MIN_WIDTH) / (SHELF_MAX_WIDTH - SHELF_MIN_WIDTH);
      const wickScore = clamp((strongLower + strongUpper) / win, 0, 1);
      const brScore = clamp(br.moveATR / 1.5, 0, 1);

      const base = 0.4 * widthScore + 0.3 * wickScore + 0.3 * brScore;

      // ✅ IMPORTANT FIX: range-based distance weight (won't early-zero valid overlaps)
      const distW = rangeDistanceWeight(hi, lo, currentPrice, bandPoints);
      if (distW <= 0) continue;

      const tfBoost = tfConfirmBoost(hi, lo, b30, b1h);

      // ✅ ATH mode bias: prioritize accumulation shelves below/near price
      let athFactor = 1.0;
      if (athMode) {
        if (type === "accumulation") athFactor *= ATH_ACC_BOOST;
        if (type === "distribution") athFactor *= ATH_DIST_PENALTY;
      }

      const final = base * distW * tfBoost * athFactor;
      if (final <= 0) continue;

      candidates.push({
        type,
        price: center,
        priceRange: [hi, lo],
        _score: final,
      });
    }
  }

  if (!candidates.length) return [];

  const mergedAll = mergeShelves(candidates);

  // ✅ FINAL BAND FILTER: overlap with band (TradingView behavior)
  const merged = mergedAll.filter((s) => {
    const hi = Number(s?.priceRange?.[0]);
    const lo = Number(s?.priceRange?.[1]);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return false;
    return overlapsBand(Math.max(hi, lo), Math.min(hi, lo), bandLow, bandHigh);
  });

  if (!merged.length) return [];

  // normalize to 40-100
  let max = 0;
  for (const s of merged) max = Math.max(max, s._score);
  if (max <= 0) max = 1;

  const out = merged
    .map((s) => {
      const rel = s._score / max;
      const strength = Math.round(40 + 60 * rel);
      return {
        type: s.type,
        price: Number(s.price.toFixed(2)),
        priceRange: [
          Number(s.priceRange[0].toFixed(2)),
          Number(s.priceRange[1].toFixed(2)),
        ],
        strength,
      };
    })
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_SHELVES_OUT);

  return out;
}
