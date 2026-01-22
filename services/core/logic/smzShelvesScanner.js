// services/core/logic/smzShelvesScanner.js
// Smart Money Shelves Scanner (Acc/Dist)
//
// LOCKED:
// - Detect shelves across FULL history
// - Apply ±bandPoints filter ONLY at the end
//
// UPDATED (per user):
// - Relevance must be 5–7 days, with most weight on last 3 days
// - Type (accumulation vs distribution) must be decided by RECENT BEHAVIOR, not breakout direction
//
// Output (additive diagnostic only):
// { type, price, priceRange:[high,low], strength, diagnostic:{...} }

const DEFAULT_BAND_POINTS = 40;

// shelf window scan
const WINDOW_SIZES = [3, 5, 7];
const SHELF_MIN_WIDTH = 0.5; // points
const SHELF_MAX_WIDTH = 3.0; // points
const BODY_TO_RANGE_MAX = 0.55;
const OVERLAP_RATIO_MIN = 0.7;

// wick + breakout confirmation
const ATR_PERIOD = 50;
const STRONG_WICK_ATR = 0.7;
const BREAK_EPS = 0.05;
const BREAK_LOOKAHEAD = 10;
const DISP_MIN_ATR = 0.6;

// Relevance windows (15m bars)
const BARS_PER_DAY_15M = 26; // trading day approx
const REL_3D_BARS = 3 * BARS_PER_DAY_15M; // 78 bars
const REL_7D_BARS = 7 * BARS_PER_DAY_15M; // 182 bars

// weighting: 3 days matters most
const REL_W_3D = 0.7;
const REL_W_7D = 0.3;

// acceptance tolerance relative to shelf width
const ACCEPT_TOL_PCT = 0.25;

// ATH mode (kept, but now secondary to relevance)
const ATH_EPS_ATR = 0.25;
const ATH_ACC_BOOST = 1.10;
const ATH_DIST_PENALTY = 0.92;

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

// distance from current price to shelf RANGE (not center)
function rangeDistanceWeight(hi, lo, currentPrice, bandPoints) {
  const H = Math.max(hi, lo);
  const L = Math.min(hi, lo);
  if (!(Number.isFinite(H) && Number.isFinite(L) && Number.isFinite(currentPrice))) return 0;

  if (currentPrice >= L && currentPrice <= H) return 1;

  const d = currentPrice > H ? (currentPrice - H) : (L - currentPrice);
  if (d >= bandPoints) return 0;
  return 1 - d / bandPoints;
}

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

      // keep best relevance diagnostics
      if (
        !cur._diag ||
        (s._diag && (s._diag?.relevance?.weightedScore ?? 0) > (cur._diag?.relevance?.weightedScore ?? 0))
      ) {
        cur._diag = s._diag;
      }
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
  const athMode = currentPrice >= maxHigh - eps;
  return { athMode, maxHigh: Number.isFinite(maxHigh) ? maxHigh : null };
}

// ---------- relevance metrics (5–7 days, weighted to last 3) ----------
// ✅ UPDATED Q3 + Q5 HERE ONLY
function computeBehaviorOverWindow(bars, hi, lo, startIdx) {
  const H = Math.max(hi, lo);
  const L = Math.min(hi, lo);
  const width = Math.max(H - L, 1e-6);
  const tol = width * ACCEPT_TOL_PCT;

  let total = 0;

  // Old accept/reject counters (kept for reference, but no longer decisive)
  let acceptNear = 0;
  let rejectFar = 0;

  // ✅ Q3: wick-touch frequency counters (THIS is the key change)
  let upperWickTouches = 0; // repeated rejection at top edge
  let lowerWickTouches = 0; // repeated rejection at bottom edge (or liquidity grabs)

  // Failed pushes (stronger “trap” signals)
  let failedPushUp = 0;
  let failedPushDown = 0;

  // ✅ Q5: acceptance requires sustained closes + progress
  let closesAbove = 0; // closes above zone (beyond tol)
  let closesBelow = 0; // closes below zone (beyond tol)

  // Progress over time
  let firstClose = null;
  let lastClose = null;

  // Stall tracking (time passes but no extension)
  const mid = (H + L) / 2;
  let bestUp = 0;
  let bestDn = 0;

  for (let i = startIdx; i < bars.length; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;

    total++;

    const c = b.close;
    if (firstClose == null) firstClose = c;
    lastClose = c;

    // old near/far (for visibility)
    const near = c >= (L - tol) && c <= (H + tol);
    if (near) acceptNear++;
    else rejectFar++;

    // ✅ Q3: wick-touch frequency (not wick size)
    // upper wick touch: price traded into/above top edge but did NOT close above it
    if (b.high >= H && c <= H) upperWickTouches++;

    // lower wick touch: price traded into/below bottom edge but did NOT close below it
    if (b.low <= L && c >= L) lowerWickTouches++;

    // failed pushes (strong)
    if (b.high > H && c < H) failedPushUp++;
    if (b.low < L && c > L) failedPushDown++;

    // ✅ Q5: sustained closes beyond zone edges (acceptance/rejection proof)
    if (c > (H + tol)) closesAbove++;
    if (c < (L - tol)) closesBelow++;

    // stall tracking
    bestUp = Math.max(bestUp, b.high - mid);
    bestDn = Math.max(bestDn, mid - b.low);
  }

  const acceptanceRate = total ? acceptNear / total : 0;
  const rejectionRate = total ? rejectFar / total : 0;

  // wick touch rates
  const upperTouchRate = total ? upperWickTouches / total : 0;
  const lowerTouchRate = total ? lowerWickTouches / total : 0;

  // wick bias (frequency-based)
  let wickBias = "neutral";
  if (upperWickTouches >= lowerWickTouches + 2) wickBias = "distribution";
  else if (lowerWickTouches >= upperWickTouches + 2) wickBias = "accumulation";

  // net progress over time (simple, human-readable)
  const netProgressSigned = (firstClose != null && lastClose != null) ? (lastClose - firstClose) : 0;

  // stall score (higher means more stall)
  const netExcursionPts = Math.max(bestUp, bestDn);
  const progNorm = clamp(netExcursionPts / (width * 3), 0, 1);
  const stallScore = 1 - progNorm;

  // sustained close threshold
  const sustainMin = Math.max(2, Math.floor(total * 0.15));
  const sustainedClosesAbove = closesAbove >= sustainMin;
  const sustainedClosesBelow = closesBelow >= sustainMin;

  // ✅ New Q5 interpretation
  // - If price repeatedly tests but cannot sustain closes through the edge → rejection
  // - If price can sustain closes through the edge → acceptance (for that side)
  //
  // For distribution we care about: failedPushUp + upperWickTouches + stall + no sustainedClosesAbove
  // For accumulation we care about: failedPushDown + lowerWickTouches + stall + no sustainedClosesBelow

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

    // legacy visibility
    acceptanceRate: round2(acceptanceRate),
    rejectionRate: round2(rejectionRate),

    // ✅ Q3
    upperWickTouches,
    lowerWickTouches,
    upperTouchRate: round2(upperTouchRate),
    lowerTouchRate: round2(lowerTouchRate),
    wickBias,

    // traps
    failedPushUp,
    failedPushDown,

    // ✅ Q5
    closesAbove,
    closesBelow,
    sustainedClosesAbove,
    sustainedClosesBelow,
    netProgressSignedPts: round2(netProgressSigned),

    // stall
    stallScore: round2(stallScore),

    // final behavior scores (0..1)
    distScore: round2(clamp(distScore, 0, 1)),
    accScore: round2(clamp(accScore, 0, 1)),
  };
}

function decideTypeByRelevance({ b10, hi, lo }) {
  const n = b10.length;
  const idx3 = Math.max(0, n - REL_3D_BARS);
  const idx7 = Math.max(0, n - REL_7D_BARS);

  const w3 = computeBehaviorOverWindow(b10, hi, lo, idx3);
  const w7 = computeBehaviorOverWindow(b10, hi, lo, idx7);

  const distWeighted = round2(REL_W_3D * w3.distScore + REL_W_7D * w7.distScore);
  const accWeighted = round2(REL_W_3D * w3.accScore + REL_W_7D * w7.accScore);

  const typeByRelevance = distWeighted > accWeighted ? "distribution" : "accumulation";
  const confidence = round2(Math.abs(distWeighted - accWeighted));

  return {
    window3d: w3,
    window7d: w7,
    distWeighted,
    accWeighted,
    typeByRelevance,
    confidence,
    weightedScore: round2(Math.max(distWeighted, accWeighted)),
  };
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
  const { athMode, maxHigh } = detectAllTimeHighMode(b10, currentPrice, atr);

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

      const center = (hi + lo) / 2;

      const br = detectBreakout(b10, endIdx, hi, lo, center, atr);
      if (br.dir === "none") continue;

      // Formation type (for reference only)
      let typeFormation = null;
      if (br.dir === "up") typeFormation = "accumulation";
      else typeFormation = "distribution";

      // scoring (unchanged)
      let strongLower = 0,
        strongUpper = 0;
      for (const b of slice) {
        const bodyHi = Math.max(b.open, b.close);
        const bodyLo = Math.min(b.open, b.close);
        const upperWick = b.high - bodyHi;
        const lowerWick = bodyLo - b.low;
        if (upperWick / atr >= STRONG_WICK_ATR) strongUpper++;
        if (lowerWick / atr >= STRONG_WICK_ATR) strongLower++;
      }

      const widthScore = 1 - (width - SHELF_MIN_WIDTH) / (SHELF_MAX_WIDTH - SHELF_MIN_WIDTH);
      const wickScore = clamp((strongLower + strongUpper) / win, 0, 1);
      const brScore = clamp(br.moveATR / 1.5, 0, 1);
      const base = 0.4 * widthScore + 0.3 * wickScore + 0.3 * brScore;

      const distW = rangeDistanceWeight(hi, lo, currentPrice, bandPoints);
      if (distW <= 0) continue;

      const tfBoost = tfConfirmBoost(hi, lo, b30, b1h);

      let athFactor = 1.0;
      if (athMode) {
        if (typeFormation === "accumulation") athFactor *= ATH_ACC_BOOST;
        if (typeFormation === "distribution") athFactor *= ATH_DIST_PENALTY;
      }

      const final = base * distW * tfBoost * athFactor;
      if (final <= 0) continue;

      const relevance = decideTypeByRelevance({ b10, hi, lo });
      const typeFinal = relevance.typeByRelevance;

      candidates.push({
        type: typeFinal,
        price: center,
        priceRange: [hi, lo],
        _score: final,
        _diag: {
          formation: {
            typeFormation,
            breakoutDir: br.dir,
            lookaheadBars: BREAK_LOOKAHEAD,
            moveATR: round2(br.moveATR),
          },
          relevance: {
            rule: "5–7 days, weighted to last 3 days",
            weights: { w3d: REL_W_3D, w7d: REL_W_7D },
            typeByRelevance: relevance.typeByRelevance,
            confidence: relevance.confidence,
            distWeighted: relevance.distWeighted,
            accWeighted: relevance.accWeighted,
            weightedScore: relevance.weightedScore,
            window3d: relevance.window3d,
            window7d: relevance.window7d,
          },
          meta: {
            currentPrice: round2(currentPrice),
            bandPoints,
            bandLow: round2(bandLow),
            bandHigh: round2(bandHigh),
            atr: round2(atr),
            athMode: !!athMode,
            allTimeHigh: Number.isFinite(maxHigh) ? round2(maxHigh) : null,
          },
        },
      });
    }
  }

  if (!candidates.length) return [];

  const mergedAll = mergeShelves(candidates);

  // ✅ HARD GUARD: merging can create monster shelves. Enforce width AFTER merge.
  const mergedAllTight = mergedAll.filter((s) => {
    const hi = Number(s?.priceRange?.[0]);
    const lo = Number(s?.priceRange?.[1]);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return false;

    const width = Math.abs(hi - lo);
    return width >= SHELF_MIN_WIDTH && width <= SHELF_MAX_WIDTH;
  });

  const merged = mergedAllTight.filter((s) => {
    const hi = Number(s?.priceRange?.[0]);
    const lo = Number(s?.priceRange?.[1]);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return false;
    return overlapsBand(Math.max(hi, lo), Math.min(hi, lo), bandLow, bandHigh);
  });

  if (!merged.length) return [];

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
        priceRange: [Number(s.priceRange[0].toFixed(2)), Number(s.priceRange[1].toFixed(2))],
        strength,
        diagnostic: s._diag,
      };
    })
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_SHELVES_OUT);

  return out;
}
