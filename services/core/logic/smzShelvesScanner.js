// services/core/logic/smzShelvesScanner.js
// Smart Money Shelves Scanner (Acc/Dist)
//
// ✅ NEW LOCK (per user):
// - Detection timeframe = 30m (primary)
// - Confirmation timeframe = 1h (secondary)
// - No 15m detection (too noisy)
//
// Output:
// { type, price, priceRange:[high,low], strength_raw (40..100), confidence (0..1), diagnostic:{...} }

const DEFAULT_BAND_POINTS = 40;

// shelf window scan (30m bars)
const WINDOW_SIZES = [4, 6, 8]; // ~2h, 3h, 4h consolidations
const SHELF_MIN_WIDTH = 0.5; // points
const SHELF_MAX_WIDTH = 2.0; // points (you already wanted max 2)
const BODY_TO_RANGE_MAX = 0.55;
const OVERLAP_RATIO_MIN = 0.7;

// wick + breakout confirmation
const ATR_PERIOD = 50;
const STRONG_WICK_ATR = 0.7;
const BREAK_EPS = 0.05;
const BREAK_LOOKAHEAD = 8;      // 30m bars
const DISP_MIN_ATR = 0.6;

// Relevance windows (30m bars)
const BARS_PER_DAY_30M = 13;
const REL_3D_BARS = 3 * BARS_PER_DAY_30M; // 39
const REL_7D_BARS = 7 * BARS_PER_DAY_30M; // 91
const REL_W_3D = 0.7;
const REL_W_7D = 0.3;

const ACCEPT_TOL_PCT = 0.25;

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

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

// distance from current price to shelf RANGE
function rangeDistanceWeight(hi, lo, currentPrice, bandPoints) {
  const H = Math.max(hi, lo);
  const L = Math.min(hi, lo);
  if (!(Number.isFinite(H) && Number.isFinite(L) && Number.isFinite(currentPrice))) return 0;

  if (currentPrice >= L && currentPrice <= H) return 1;

  const d = currentPrice > H ? (currentPrice - H) : (L - currentPrice);
  if (d >= bandPoints) return 0;
  return 1 - d / bandPoints;
}

// 1h confirmation (secondary)
function tfConfirmBoost(hi, lo, bars1h) {
  const margin = Math.max(0.5, (hi - lo) * 0.6);
  const zHi = hi + margin;
  const zLo = lo - margin;

  let hit1h = false;
  for (const b of bars1h) {
    if (b.high >= zLo && b.low <= zHi) {
      hit1h = true;
      break;
    }
  }

  let boost = 1.0;
  if (hit1h) boost += 0.25;
  return clamp(boost, 1.0, 1.35);
}

function barOutsideSide(bar, lo, hi) {
  if (!bar || !Number.isFinite(bar.high) || !Number.isFinite(bar.low)) return null;
  if (bar.low > hi) return "above";
  if (bar.high < lo) return "below";
  return null;
}

function detectBreakout(bars, endIdx, hi, lo, center, atr) {
  const n = bars.length;
  const maxIdx = Math.min(n - 1, endIdx + BREAK_LOOKAHEAD);

  let up = false, down = false;
  let maxUp = 0, maxDown = 0;

  for (let i = endIdx + 1; i <= maxIdx; i++) {
    const b = bars[i];
    const c = b.close;

    if (!up && c > hi + BREAK_EPS) {
      const move = (c - center) / atr;
      if (move >= DISP_MIN_ATR) { up = true; maxUp = Math.max(maxUp, move); }
    }
    if (!down && c < lo - BREAK_EPS) {
      const move = (center - c) / atr;
      if (move >= DISP_MIN_ATR) { down = true; maxDown = Math.max(maxDown, move); }
    }

    maxUp = Math.max(maxUp, (b.high - center) / atr);
    maxDown = Math.max(maxDown, (center - b.low) / atr);
  }

  if (!up && !down) return { dir: "none", moveATR: 0 };
  if (up && !down) return { dir: "up", moveATR: maxUp };
  if (down && !up) return { dir: "down", moveATR: maxDown };
  return maxUp >= maxDown ? { dir: "up", moveATR: maxUp } : { dir: "down", moveATR: maxDown };
}

function overlapsBand(hi, lo, bandLow, bandHigh) {
  return hi >= bandLow && lo <= bandHigh;
}

// ---------- relevance metrics (30m) ----------
function computeBehaviorOverWindow(bars, hi, lo, startIdx) {
  const H = Math.max(hi, lo);
  const L = Math.min(hi, lo);
  const width = Math.max(H - L, 1e-6);
  const tol = width * ACCEPT_TOL_PCT;

  let total = 0;
  let upperWickTouches = 0;
  let lowerWickTouches = 0;
  let failedPushUp = 0;
  let failedPushDown = 0;
  let closesAbove = 0;
  let closesBelow = 0;

  const mid = (H + L) / 2;
  let bestUp = 0;
  let bestDn = 0;

  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;
    total++;

    const c = b.close;

    if (b.high >= H && c <= H) upperWickTouches++;
    if (b.low <= L && c >= L) lowerWickTouches++;

    if (b.high > H && c < H) failedPushUp++;
    if (b.low < L && c > L) failedPushDown++;

    if (c > (H + tol)) closesAbove++;
    if (c < (L - tol)) closesBelow++;

    bestUp = Math.max(bestUp, b.high - mid);
    bestDn = Math.max(bestDn, mid - b.low);
  }

  const upperTouchRate = total ? upperWickTouches / total : 0;
  const lowerTouchRate = total ? lowerWickTouches / total : 0;

  const sustainMin = Math.max(2, Math.floor(total * 0.15));
  const sustainedClosesAbove = closesAbove >= sustainMin;
  const sustainedClosesBelow = closesBelow >= sustainMin;

  const netExcursionPts = Math.max(bestUp, bestDn);
  const progNorm = clamp(netExcursionPts / (width * 3), 0, 1);
  const stallScore = 1 - progNorm;

  const distScore =
    0.35 * clamp(upperTouchRate, 0, 1) +
    0.25 * clamp(failedPushUp > 0 ? 1 : 0, 0, 1) +
    0.20 * stallScore +
    0.20 * clamp(!sustainedClosesAbove ? 1 : 0, 0, 1);

  const accScore =
    0.35 * clamp(lowerTouchRate, 0, 1) +
    0.25 * clamp(failedPushDown > 0 ? 1 : 0, 0, 1) +
    0.20 * stallScore +
    0.20 * clamp(!sustainedClosesBelow ? 1 : 0, 0, 1);

  return {
    samples: total,
    upperWickTouches,
    lowerWickTouches,
    sustainedClosesAbove,
    sustainedClosesBelow,
    stallScore: round2(stallScore),
    distScore: round2(clamp(distScore, 0, 1)),
    accScore: round2(clamp(accScore, 0, 1)),
  };
}

function decideTypeByRelevance({ bars30m, hi, lo }) {
  const n = bars30m.length;
  const idx3 = Math.max(0, n - REL_3D_BARS);
  const idx7 = Math.max(0, n - REL_7D_BARS);

  const w3 = computeBehaviorOverWindow(bars30m, hi, lo, idx3);
  const w7 = computeBehaviorOverWindow(bars30m, hi, lo, idx7);

  const distWeighted = round2(REL_W_3D * w3.distScore + REL_W_7D * w7.distScore);
  const accWeighted = round2(REL_W_3D * w3.accScore + REL_W_7D * w7.accScore);

  const typeByRelevance = distWeighted > accWeighted ? "distribution" : "accumulation";
  const confidence = round2(Math.abs(distWeighted - accWeighted));
  const weightedScore = round2(Math.max(distWeighted, accWeighted));

  return { w3, w7, distWeighted, accWeighted, typeByRelevance, confidence, weightedScore };
}

// ---------- main compute ----------
export function computeShelves({ bars30m, bars1h, bandPoints = DEFAULT_BAND_POINTS }) {
  const b30 = sortBars(bars30m);
  const b1h = sortBars(bars1h);

  if (b30.length < 40) return [];

  const currentPrice = b30[b30.length - 1].close;
  const bandLow = currentPrice - bandPoints;
  const bandHigh = currentPrice + bandPoints;

  const atr = computeATR(b30, ATR_PERIOD);

  const candidates = [];

  for (const win of WINDOW_SIZES) {
    for (let endIdx = win - 1; endIdx < b30.length; endIdx++) {
      const sIdx = endIdx - win + 1;
      const slice = b30.slice(sIdx, endIdx + 1);

      let hi = -Infinity, lo = Infinity;
      let bodySum = 0, rangeSum = 0, inside = 0, cnt = 0;

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

      const center = (hi + lo) / 2;

      const br = detectBreakout(b30, endIdx, hi, lo, center, atr);
      if (br.dir === "none") continue;

      const distW = rangeDistanceWeight(hi, lo, currentPrice, bandPoints);
      if (distW <= 0) continue;

      const tfBoost = tfConfirmBoost(hi, lo, b1h);

      const baseWidthScore = 1 - (width - SHELF_MIN_WIDTH) / (SHELF_MAX_WIDTH - SHELF_MIN_WIDTH);
      const brScore = clamp(br.moveATR / 1.5, 0, 1);
      const base = 0.55 * baseWidthScore + 0.45 * brScore;

      const final = base * distW * tfBoost;
      if (final <= 0) continue;

      const rel = decideTypeByRelevance({ bars30m: b30, hi, lo });
      const typeFinal = rel.typeByRelevance;

      candidates.push({
        type: typeFinal,
        price: round2(center),
        priceRange: [round2(hi), round2(lo)],
        _score: final,
        _diag: {
          formation: { breakoutDir: br.dir, moveATR: round2(br.moveATR), winBars: win },
          relevance: {
            typeByRelevance: rel.typeByRelevance,
            confidence: rel.confidence,
            distWeighted: rel.distWeighted,
            accWeighted: rel.accWeighted,
            weightedScore: rel.weightedScore,
          },
          meta: { currentPrice: round2(currentPrice), bandPoints, atr: round2(atr) },
        },
      });
    }
  }

  if (!candidates.length) return [];

  // Keep only candidates in band
  const merged = candidates.filter((s) =>
    overlapsBand(Math.max(s.priceRange[0], s.priceRange[1]), Math.min(s.priceRange[0], s.priceRange[1]), bandLow, bandHigh)
  );

  if (!merged.length) return [];

  // Normalize raw strength 40..100 based on relative score
  let max = 0;
  for (const s of merged) max = Math.max(max, s._score);
  if (max <= 0) max = 1;

  const out = merged
    .map((s) => {
      const rel = s._score / max;
      const strength_raw = Math.round(40 + 60 * rel);
      const confidence = round2(rel); // 0..1 proxy
      return {
        type: s.type,
        price: s.price,
        priceRange: s.priceRange,
        strength_raw,
        confidence,
        diagnostic: s._diag,
      };
    })
    .sort((a, b) => b.strength_raw - a.strength_raw)
    .slice(0, MAX_SHELVES_OUT);

  return out;
}
