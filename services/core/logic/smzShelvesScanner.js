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
// ✅ NEW (per user learning system):
// - For each emitted shelf, include a `diagnostic` object answering the core questions:
//   progress vs stall, wick behavior, acceptance vs rejection, trap/fakeout, follow-through,
//   impulse into zone, TF agreement, etc.
//
// Output objects match SMZ frontend schema (additive):
// { type: "accumulation"|"distribution", price, priceRange:[high,low], strength:40–100, diagnostic:{...} }

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

// Reaction / grading windows (diagnostics)
const REACT_LOOKAHEAD = 12; // how many bars after shelf window to measure reaction
const ACCEPT_TOL_PCT = 0.25; // close considered "near zone" within 25% of zone width

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

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

// Distance from current price to a shelf RANGE (not center).
// - If current is inside [lo,hi] => 1.0
// - If outside => fade linearly until bandPoints
function rangeDistanceWeight(hi, lo, currentPrice, bandPoints) {
  const H = Math.max(hi, lo);
  const L = Math.min(hi, lo);

  if (!(Number.isFinite(H) && Number.isFinite(L) && Number.isFinite(currentPrice))) return 0;

  if (currentPrice >= L && currentPrice <= H) return 1;

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

      // keep best diagnostics
      if (!cur._diag || (s._diag && (s._diag.q_scoreFinal ?? 0) > (cur._diag.q_scoreFinal ?? 0))) {
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
  const athMode = currentPrice >= (maxHigh - eps);
  return { athMode, maxHigh: Number.isFinite(maxHigh) ? maxHigh : null };
}

// ---------- diagnostics (questions) ----------

function computeImpulseIntoZoneScore(bars, sIdx, hi, lo, atr) {
  // Look back a few bars before the shelf window; if there was a fast move into the zone, score higher.
  // This approximates “engineered move into liquidity”.
  const lookback = 8;
  const start = Math.max(0, sIdx - lookback);
  const prev = bars[start]?.close;
  const entry = bars[sIdx]?.close;
  if (!(Number.isFinite(prev) && Number.isFinite(entry) && atr > 0)) return { impulseATR: 0, impulseScore: 0 };

  const moveATR = Math.abs(entry - prev) / atr;
  const impulseScore = clamp(moveATR / 1.5, 0, 1); // 1.5 ATR into zone => strong
  return { impulseATR: round2(moveATR), impulseScore: round2(impulseScore) };
}

function computeAcceptanceRejection(bars, endIdx, hi, lo) {
  // Over next REACT_LOOKAHEAD bars, measure:
  // - acceptance: closes stay near/inside zone
  // - rejection: closes push away beyond tolerance
  const n = bars.length;
  const maxIdx = Math.min(n - 1, endIdx + REACT_LOOKAHEAD);
  const width = Math.max(hi - lo, 1e-6);
  const tol = width * ACCEPT_TOL_PCT;

  let accept = 0;
  let reject = 0;
  let total = 0;

  for (let i = endIdx + 1; i <= maxIdx; i++) {
    const c = bars[i]?.close;
    if (!Number.isFinite(c)) continue;
    total++;

    const near =
      (c >= (lo - tol) && c <= (hi + tol));

    if (near) accept++;
    else reject++;
  }

  const acceptanceRate = total ? accept / total : 0;
  const rejectionRate = total ? reject / total : 0;

  return {
    acceptanceRate: round2(acceptanceRate),
    rejectionRate: round2(rejectionRate),
    samples: total,
  };
}

function computeWickStats(slice, atr) {
  let upperSum = 0;
  let lowerSum = 0;
  let bodySum = 0;
  let rangeSum = 0;

  let strongUpper = 0;
  let strongLower = 0;

  for (const b of slice) {
    const bodyHi = Math.max(b.open, b.close);
    const bodyLo = Math.min(b.open, b.close);
    const upperWick = b.high - bodyHi;
    const lowerWick = bodyLo - b.low;
    const body = Math.abs(b.close - b.open);
    const range = b.high - b.low;

    upperSum += Math.max(0, upperWick);
    lowerSum += Math.max(0, lowerWick);
    bodySum += Math.max(0, body);
    rangeSum += Math.max(0, range);

    const upN = (upperWick / atr);
    const dnN = (lowerWick / atr);
    if (upN >= STRONG_WICK_ATR) strongUpper++;
    if (dnN >= STRONG_WICK_ATR) strongLower++;
  }

  const totalW = upperSum + lowerSum + 1e-9;
  const upperWickRatio = upperSum / totalW;
  const lowerWickRatio = lowerSum / totalW;

  const bodyToRange = rangeSum > 0 ? (bodySum / rangeSum) : 1;

  return {
    upperWickRatio: round2(upperWickRatio),
    lowerWickRatio: round2(lowerWickRatio),
    strongUpper,
    strongLower,
    bodyToRange: round2(bodyToRange),
  };
}

function computeProgressVsStall(bars, endIdx, hi, lo, atr) {
  // Over the reaction window, how much progress did price make away from the zone mid?
  // Low progress with many interactions => “stall/absorption”
  const n = bars.length;
  const maxIdx = Math.min(n - 1, endIdx + REACT_LOOKAHEAD);
  const mid = (hi + lo) / 2;

  let bestUp = 0;
  let bestDn = 0;

  for (let i = endIdx + 1; i <= maxIdx; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;
    bestUp = Math.max(bestUp, b.high - mid);
    bestDn = Math.max(bestDn, mid - b.low);
  }

  const netProgressPts = Math.max(bestUp, bestDn);
  const netProgressATR = atr > 0 ? (netProgressPts / atr) : 0;

  // stallScore: if progressATR is low => stall is high
  const stallScore = 1 - clamp(netProgressATR / 1.2, 0, 1);

  return {
    netProgressPts: round2(netProgressPts),
    netProgressATR: round2(netProgressATR),
    stallScore: round2(stallScore),
  };
}

function buildDiagnostics({
  type,
  hi,
  lo,
  width,
  center,
  win,
  overlap,
  bodyToRange,
  wickStats,
  br,
  distW,
  tfBoost,
  athMode,
  impulse,
  acceptReject,
  progress,
}) {
  // These are the “questions” the engine is answering, in a stable format.
  return {
    // Q1: Is it tight/tradable?
    q1_widthOK: { pass: width >= SHELF_MIN_WIDTH && width <= SHELF_MAX_WIDTH, widthPts: round2(width) },

    // Q2: Is it “balanced / inside” enough? (overlap + bodyToRange)
    q2_balance: {
      pass: bodyToRange <= BODY_TO_RANGE_MAX && overlap >= OVERLAP_RATIO_MIN,
      bodyToRange,
      insideOverlap: round2(overlap),
      windowBars: win,
    },

    // Q3: Wick behavior (rejection/absorption clues)
    q3_wicks: {
      upperWickRatio: wickStats.upperWickRatio,
      lowerWickRatio: wickStats.lowerWickRatio,
      strongUpper: wickStats.strongUpper,
      strongLower: wickStats.strongLower,
    },

    // Q4: Breakout attempt and direction (did anything happen after?)
    q4_breakout: {
      dir: br.dir,
      moveATR: round2(br.moveATR),
      dispMinATR: DISP_MIN_ATR,
      lookaheadBars: BREAK_LOOKAHEAD,
    },

    // Q5: Acceptance vs rejection after formation
    q5_acceptReject: {
      acceptanceRate: acceptReject.acceptanceRate,
      rejectionRate: acceptReject.rejectionRate,
      samples: acceptReject.samples,
    },

    // Q6: Progress vs stall after formation (absorption tell)
    q6_progress: {
      netProgressPts: progress.netProgressPts,
      netProgressATR: progress.netProgressATR,
      stallScore: progress.stallScore,
    },

    // Q7: Impulse into zone (smart money / engineered move proxy)
    q7_impulseIntoZone: {
      impulseATR: impulse.impulseATR,
      impulseScore: impulse.impulseScore,
    },

    // Q8: Distance relevance (range-based)
    q8_distance: {
      distanceWeight: round2(distW),
      bandPoints: DEFAULT_BAND_POINTS,
      center: round2(center),
    },

    // Q9: TF agreement (boost proxy)
    q9_tfAgreement: {
      tfBoost: round2(tfBoost),
      // We don’t expose “hit30/hit1h” flags here because boost is already derived.
      // If you want flags, we can add them later safely.
    },

    // Q10: ATH mode context
    q10_athMode: {
      athMode: !!athMode,
      note: athMode ? "ATH bias applied (acc slightly boosted, dist slightly penalized)" : "normal",
    },

    // Q11: Type label and confidence (initial, pre-Engine3)
    q11_typeDecision: {
      type,
      // confidence proxy: combines stall + rejection + wick dominance depending on type
      typeConfidence: (() => {
        const stall = progress.stallScore; // higher = more absorption/rotation
        const rej = acceptReject.rejectionRate;
        const upW = wickStats.upperWickRatio;
        const dnW = wickStats.lowerWickRatio;

        // If accumulation: prefer lower wick + acceptance + stall/absorption
        if (type === "accumulation") {
          const conf = 0.4 * stall + 0.35 * acceptReject.acceptanceRate + 0.25 * dnW;
          return round2(clamp(conf, 0, 1));
        }
        // If distribution: prefer upper wick + rejection + stall/absorption
        const conf = 0.4 * stall + 0.35 * rej + 0.25 * upW;
        return round2(clamp(conf, 0, 1));
      })(),
      reasons: (() => {
        const r = [];
        if (progress.stallScore >= 0.65) r.push("stall_absorption");
        if (type === "distribution" && wickStats.upperWickRatio >= 0.60) r.push("upper_wick_dominance");
        if (type === "accumulation" && wickStats.lowerWickRatio >= 0.60) r.push("lower_wick_dominance");
        if (acceptReject.rejectionRate >= 0.60) r.push("rejection_high");
        if (acceptReject.acceptanceRate >= 0.60) r.push("acceptance_high");
        if (impulse.impulseScore >= 0.70) r.push("impulse_into_zone");
        if (br.moveATR >= 1.0) r.push("strong_displacement");
        return r;
      })(),
    },

    // Q12: Final score ingredients (so you can learn weighting)
    q12_scoreIngredients: {
      baseComponents: "width(0.4) + wick(0.3) + breakout(0.3)",
      distW: round2(distW),
      tfBoost: round2(tfBoost),
      athFactorApplied: !!athMode,
      scoreNote: "finalScore = base * distW * tfBoost * athFactor",
    },

    // For sorting/merging debug
    q_scoreFinal: null, // filled by caller
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

      let hi = -Infinity;
      let lo = Infinity;
      let bodySum = 0;
      let rangeSum = 0;
      let inside = 0;
      let cnt = 0;

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

      const wickStats = computeWickStats(slice, atr);

      let wickBias = "neutral";
      if (wickStats.strongLower > wickStats.strongUpper + 1) wickBias = "buy";
      else if (wickStats.strongUpper > wickStats.strongLower + 1) wickBias = "sell";

      const center = (hi + lo) / 2;

      const br = detectBreakout(b10, endIdx, hi, lo, center, atr);
      if (br.dir === "none") continue;

      let type = null;
      if (br.dir === "up") {
        if (wickBias === "sell") continue;
        type = "accumulation";
      } else {
        if (wickBias === "buy") continue;
        type = "distribution";
      }

      const widthScore = 1 - (width - SHELF_MIN_WIDTH) / (SHELF_MAX_WIDTH - SHELF_MIN_WIDTH);
      const wickScore = clamp((wickStats.strongLower + wickStats.strongUpper) / win, 0, 1);
      const brScore = clamp(br.moveATR / 1.5, 0, 1);

      const base = 0.4 * widthScore + 0.3 * wickScore + 0.3 * brScore;

      const distW = rangeDistanceWeight(hi, lo, currentPrice, bandPoints);
      if (distW <= 0) continue;

      const tfBoost = tfConfirmBoost(hi, lo, b30, b1h);

      let athFactor = 1.0;
      if (athMode) {
        if (type === "accumulation") athFactor *= ATH_ACC_BOOST;
        if (type === "distribution") athFactor *= ATH_DIST_PENALTY;
      }

      const final = base * distW * tfBoost * athFactor;
      if (final <= 0) continue;

      // diagnostics
      const impulse = computeImpulseIntoZoneScore(b10, sIdx, hi, lo, atr);
      const acceptReject = computeAcceptanceRejection(b10, endIdx, hi, lo);
      const progress = computeProgressVsStall(b10, endIdx, hi, lo, atr);

      const diag = buildDiagnostics({
        type,
        hi,
        lo,
        width,
        center,
        win,
        overlap,
        bodyToRange: round2(bodyToRange),
        wickStats,
        br,
        distW,
        tfBoost,
        athMode,
        impulse,
        acceptReject,
        progress,
      });
      diag.q_scoreFinal = round2(final);

      candidates.push({
        type,
        price: center,
        priceRange: [hi, lo],
        _score: final,
        _diag: diag,
      });
    }
  }

  if (!candidates.length) return [];

  const mergedAll = mergeShelves(candidates);

  // ✅ FINAL BAND FILTER (TradingView behavior): overlap with band
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
        diagnostic: {
          ...s._diag,
          meta: {
            atr: round2(atr),
            currentPrice: round2(currentPrice),
            bandPoints,
            bandLow: round2(bandLow),
            bandHigh: round2(bandHigh),
            athMode: !!athMode,
            allTimeHigh: Number.isFinite(maxHigh) ? round2(maxHigh) : null,
          },
        },
      };
    })
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_SHELVES_OUT);

  return out;
}
