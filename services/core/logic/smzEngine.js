// services/core/logic/smzEngine.js
// Smart Money Zone Engine — 12-Question Institutional Model + Relevance Filter (Option C)
// + Institutional Scoring Contract v1.0 (Explainable Score Breakdown)
//
// Entry:
//   computeSmartMoneyLevels(bars30m, bars1h, bars4h) -> SmzLevel[]
//
// SmzLevel = {
//   type: "institutional" | "accumulation" | "distribution",
//   price: number,
//   priceRange: [number, number], // [high, low]
//   strength: number,             // 40–100 (normalized)
//   details?: {
//     scoreTotal: number,
//     breakdown: { compression, rejection, retest, timeframe, breakout, context },
//     answers: Array<{ id, label, pts, max, pass }>,
//     meta: { durationDays, widthPoints, has4hAuthority, consDaysBucket, wickAttempts, retestCount }
//   }
// }

// ---------- Tunable constants (structure is fixed, numbers are knobs) ----------

const TF_WEIGHTS = {
  "30m": 0.5,
  "1h": 0.8,
  "4h": 1.2,
};

// How many zones of each type we keep
const MAX_INSTITUTIONAL_ZONES = 4;
const MAX_SHELVES = 3;
const MAX_EDGES = 3;

// Width rules (in SPY points)
const SHELF_MIN_WIDTH = 1.0;
const SHELF_MAX_WIDTH = 3.0;
const EDGE_MAX_WIDTH = 1.0;
const INSTITUTIONAL_MIN_WIDTH = 2.0;
const INSTITUTIONAL_MAX_WIDTH = 5.5;
const MAX_SPLIT_WIDTH = 6.0; // if wider than this, split into sub-zones
const INIT_BAND_HALF_WIDTH = 1.0; // starting band half-width around each bucket

// Spacing between institutional zones (avoid stacking all in one region)
const MIN_INSTITUTIONAL_GAP = 8.0; // min vertical distance between institutional centers

// Bucket size for price aggregation
const BUCKET_SIZE = 0.5;

// Recency decay (bucket-level)
const RECENCY_DECAY_PER_WEEK = 0.98; // ~2% per week

// Wick thresholds (ATR-based)
const K_WICK = 0.6; // wick > 0.6 * ATR_tf to count as tap
const WICK_SOFT_CAP = 3.0; // max normalized wick per tap

// Consolidation detection
const BODY_THRESHOLD_ATR = 0.5; // avg body < 0.5 * ATR_tf
const SHELF_MAX_WIDTH_POINTS = 3.0;

// Displacement and retest
const DISP_LOOKAHEAD_BARS = 30; // how far forward we look for displacement
const DISP_SOFT_CAP_ATR = 5.0;  // cap displacement at 5 ATR
const RETEST_BAND_WIDTH = 1.25; // band around anchor price for retests
const RETEST_LOOKAHEAD_BARS = 40;

// Scoring weights (wick / cons / displacement / retest)
const W_WICK = 1.0;
const W_CONS = 0.7;
const W_DISP = 1.2;
const W_RETEST = 0.8;

// Small gap for merging bands into zones
const MERGE_GAP = 0.5;

// ---------- Relevance filter (Option C: distance + recency) ----------

// Only keep zones within this many SPY points of current price
const RELEVANCE_DISTANCE_LIMIT_POINTS = 40; // e.g. 684 ± 40

// Only keep zones whose last activity is within this many days
const RELEVANCE_MAX_AGE_DAYS = 70; // ~10 weeks

// ---------- Institutional scoring contract constants (v1.0) ----------

// Mandatory gate: Compression + Rejection + Retest must be present to be institutional
// 4H authority required for 100: requires (B+C+D) on 4H: multiple wicks + consolidation + displacement

// “7-day consolidation” is SOFT:
// >= 7 days => full duration points
// 4–6 days => partial duration points

// ---------- Basic helpers ----------

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

function computeATR(bars, length = 50) {
  if (!Array.isArray(bars) || bars.length < length + 1) return 0;
  let sum = 0;
  for (let i = 1; i <= length; i++) {
    const cur = bars[bars.length - i];
    const prev = bars[bars.length - i - 1];
    if (!isFiniteBar(cur) || !isFiniteBar(prev)) continue;
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    sum += Math.max(tr, 0);
  }
  const atr = sum / length;
  return atr > 0 ? atr : 0;
}

// Handle both seconds and ms timestamps
function computeAgeWeeks(latestTime, barTime) {
  if (!latestTime || !barTime) return 0;
  const msMode = latestTime > 2e10 || barTime > 2e10;
  const diff = Math.max(0, latestTime - barTime);
  const diffDays = msMode ? diff / 86400000 : diff / 86400;
  return diffDays / 7;
}

function computeDaysBetween(t0, t1) {
  if (!t0 || !t1) return 0;
  const msMode = t0 > 2e10 || t1 > 2e10;
  const diff = Math.abs(t1 - t0);
  return msMode ? diff / 86400000 : diff / 86400;
}

function roundPriceToBucket(price, size) {
  if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) return price;
  return Math.round(price / size) * size;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

// ---------- Seed detection per timeframe ----------

/**
 * Seed shape:
 * {
 *   price: number,
 *   dir: "buy" | "sell" | "neutral",
 *   tf: "30m"|"1h"|"4h",
 *   barIndex: number,
 *   time: number,
 *   wickLen: number, // 0 for cons-only seeds
 *   isConsolidation: boolean
 * }
 */
function makeSeedsForTF(tf, bars, atr) {
  const seeds = [];
  if (!Array.isArray(bars) || bars.length < 10 || !atr || atr <= 0) return seeds;

  // --- Wick-based seeds ---
  const wickThreshold = K_WICK * atr;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;

    const bodyHigh = Math.max(b.open, b.close);
    const bodyLow = Math.min(b.open, b.close);
    const upperWick = b.high - bodyHigh;
    const lowerWick = bodyLow - b.low;

    if (upperWick > wickThreshold) {
      seeds.push({
        price: b.high,
        dir: "sell",
        tf,
        barIndex: i,
        time: b.time,
        wickLen: upperWick,
        isConsolidation: false,
      });
    }

    if (-lowerWick > wickThreshold) {
      seeds.push({
        price: b.low,
        dir: "buy",
        tf,
        barIndex: i,
        time: b.time,
        wickLen: Math.abs(lowerWick),
        isConsolidation: false,
      });
    }
  }

  // --- Consolidation-based seeds (shelves / bases) ---
  let minWin, maxWin;
  if (tf === "30m") {
    minWin = 8;
    maxWin = 20;
  } else if (tf === "1h") {
    minWin = 5;
    maxWin = 12;
  } else {
    // 4h
    minWin = 3;
    maxWin = 8;
  }

  const n = bars.length;
  for (let win = minWin; win <= maxWin; win += Math.max(1, Math.floor((maxWin - minWin) / 3))) {
    if (n < win) continue;
    for (let i = win - 1; i < n; i++) {
      const slice = bars.slice(i - win + 1, i + 1);
      let bandHigh = -Infinity;
      let bandLow = Infinity;
      let bodySum = 0;
      let count = 0;
      for (const s of slice) {
        if (!isFiniteBar(s)) continue;
        bandHigh = Math.max(bandHigh, s.high);
        bandLow = Math.min(bandLow, s.low);
        bodySum += Math.abs(s.close - s.open);
        count++;
      }
      if (count === 0) continue;

      const bandWidth = bandHigh - bandLow;
      const avgBody = bodySum / count;

      if (
        bandWidth > 0 &&
        bandWidth <= SHELF_MAX_WIDTH_POINTS &&
        avgBody < BODY_THRESHOLD_ATR * atr
      ) {
        const mid = (bandHigh + bandLow) / 2;
        const lastBar = slice[slice.length - 1];
        seeds.push({
          price: mid,
          dir: "neutral",
          tf,
          barIndex: Math.min(i, bars.length - 1),
          time: lastBar.time,
          wickLen: 0,
          isConsolidation: true,
        });
      }
    }
  }

  return seeds;
}

// ---------- Seed effects: displacement + retests ----------

function evaluateSeedEffects(tfBars, seed, atr) {
  if (!Array.isArray(tfBars) || tfBars.length === 0 || !Number.isFinite(atr) || atr <= 0) {
    return { dispScore: 0, retestCount: 0, upMoves: 0, downMoves: 0 };
  }

  const anchorIndex = Math.min(Math.max(seed.barIndex ?? 0, 0), tfBars.length - 1);
  const anchorPrice = seed.price;
  const maxDispIndex = Math.min(tfBars.length, anchorIndex + 1 + DISP_LOOKAHEAD_BARS);
  const maxRetestIndex = Math.min(tfBars.length, anchorIndex + 1 + RETEST_LOOKAHEAD_BARS);

  let maxDisp = 0;
  let upMoves = 0;
  let downMoves = 0;
  let retestCount = 0;

  for (let j = anchorIndex + 1; j < maxRetestIndex; j++) {
    const b = tfBars[j];
    if (!isFiniteBar(b)) continue;

    const mid = (b.high + b.low) / 2;
    const dist = Math.abs(mid - anchorPrice);
    if (j < maxDispIndex) {
      if (dist > maxDisp) maxDisp = dist;

      if (mid > anchorPrice) upMoves++;
      else if (mid < anchorPrice) downMoves++;
    }

    if (dist <= RETEST_BAND_WIDTH) {
      retestCount++;
    }
  }

  let dispRaw = atr > 0 ? maxDisp / atr : 0;
  if (!Number.isFinite(dispRaw)) dispRaw = 0;
  const dispScore = Math.min(dispRaw, DISP_SOFT_CAP_ATR);

  return { dispScore, retestCount, upMoves, downMoves };
}

// ---------- Bucket aggregation ----------

function buildBucketsFromSeeds(seeds, barsByTF, atrByTF, latestTime) {
  const bucketMap = new Map();

  for (const seed of seeds) {
    if (!Number.isFinite(seed.price)) continue;
    const tf = seed.tf;
    const tfBars = barsByTF[tf] || [];
    const atr = atrByTF[tf] || 0;
    if (!atr || atr <= 0) continue;

    const bucketPrice = roundPriceToBucket(seed.price, BUCKET_SIZE);
    if (!bucketMap.has(bucketPrice)) {
      bucketMap.set(bucketPrice, {
        price: bucketPrice,

        wickScoreByTF: { "30m": 0, "1h": 0, "4h": 0 },
        wickAttemptsByTF: { "30m": 0, "1h": 0, "4h": 0 },

        consCountByTF: { "30m": 0, "1h": 0, "4h": 0 },
        consStartByTF: { "30m": 0, "1h": 0, "4h": 0 },
        consEndByTF: { "30m": 0, "1h": 0, "4h": 0 },

        dispScoreByTF: { "30m": 0, "1h": 0, "4h": 0 },

        retestCount: 0,

        timestamps: [],
        lastTime: 0,
        tfsSeen: new Set(),

        upMoves: 0,
        downMoves: 0,

        upperWicks: 0,
        lowerWicks: 0,

        rawScore: 0,
      });
    }

    const bucket = bucketMap.get(bucketPrice);
    bucket.tfsSeen.add(tf);

    // timestamps / recency
    bucket.timestamps.push(seed.time);
    if (seed.time > bucket.lastTime) bucket.lastTime = seed.time;

    // consolidation count + duration capture
    if (seed.isConsolidation) {
      bucket.consCountByTF[tf] += 1;
      if (!bucket.consStartByTF[tf] || seed.time < bucket.consStartByTF[tf]) {
        bucket.consStartByTF[tf] = seed.time;
      }
      if (!bucket.consEndByTF[tf] || seed.time > bucket.consEndByTF[tf]) {
        bucket.consEndByTF[tf] = seed.time;
      }
    }

    // wick contribution
    if (seed.wickLen > 0) {
      const normWick = Math.min(seed.wickLen / atr, WICK_SOFT_CAP);
      bucket.wickScoreByTF[tf] += normWick;
      bucket.wickAttemptsByTF[tf] += 1;

      if (seed.dir === "sell") bucket.upperWicks += 1;
      if (seed.dir === "buy") bucket.lowerWicks += 1;
    }

    // displacement + retest effects
    const { dispScore, retestCount, upMoves, downMoves } = evaluateSeedEffects(
      tfBars,
      seed,
      atr
    );

    bucket.dispScoreByTF[tf] += dispScore;
    bucket.retestCount += retestCount;
    bucket.upMoves += upMoves;
    bucket.downMoves += downMoves;
  }

  // Score each bucket
  const buckets = [];
  for (const b of bucketMap.values()) {
    const wickScore =
      TF_WEIGHTS["30m"] * b.wickScoreByTF["30m"] +
      TF_WEIGHTS["1h"] * b.wickScoreByTF["1h"] +
      TF_WEIGHTS["4h"] * b.wickScoreByTF["4h"];

    const consScore =
      TF_WEIGHTS["30m"] * b.consCountByTF["30m"] +
      TF_WEIGHTS["1h"] * b.consCountByTF["1h"] +
      TF_WEIGHTS["4h"] * b.consCountByTF["4h"];

    const dispScoreTotal =
      TF_WEIGHTS["30m"] * b.dispScoreByTF["30m"] +
      TF_WEIGHTS["1h"] * b.dispScoreByTF["1h"] +
      TF_WEIGHTS["4h"] * b.dispScoreByTF["4h"];

    const retestScore = W_RETEST * b.retestCount;

    let rawScore =
      W_WICK * wickScore +
      W_CONS * consScore +
      W_DISP * dispScoreTotal +
      W_RETEST * retestScore;

    const ageWeeks = computeAgeWeeks(latestTime, b.lastTime || latestTime);
    const decay = Math.pow(RECENCY_DECAY_PER_WEEK, ageWeeks || 0);
    rawScore *= decay;

    b.rawScore = rawScore;
    buckets.push(b);
  }

  return buckets
    .filter((b) => b.rawScore > 0)
    .sort((a, b) => a.price - b.price);
}

// ---------- Zones from buckets ----------

function buildZonesFromBuckets(buckets) {
  if (!buckets.length) return [];

  // build initial bands per bucket
  const bands = buckets.map((b) => ({
    price: b.price,
    bandLow: b.price - INIT_BAND_HALF_WIDTH,
    bandHigh: b.price + INIT_BAND_HALF_WIDTH,
    rawScore: b.rawScore,
    tfsSeen: b.tfsSeen,

    upperWicks: b.upperWicks,
    lowerWicks: b.lowerWicks,

    wickAttemptsByTF: b.wickAttemptsByTF,
    consCountByTF: b.consCountByTF,
    consStartByTF: b.consStartByTF,
    consEndByTF: b.consEndByTF,

    dispScoreByTF: b.dispScoreByTF,
    retestCount: b.retestCount,

    upMoves: b.upMoves,
    downMoves: b.downMoves,

    lastTime: b.lastTime,
  }));

  bands.sort((a, b) => a.price - b.price);

  const zones = [];
  let current = null;

  for (const band of bands) {
    if (!current) {
      current = {
        min: band.bandLow,
        max: band.bandHigh,
        rawScore: band.rawScore,

        tfsSeen: new Set(band.tfsSeen),

        upperWicks: band.upperWicks,
        lowerWicks: band.lowerWicks,

        wickAttemptsByTF: { ...band.wickAttemptsByTF },
        consCountByTF: { ...band.consCountByTF },
        consStartByTF: { ...band.consStartByTF },
        consEndByTF: { ...band.consEndByTF },

        dispScoreByTF: { ...band.dispScoreByTF },
        retestCount: band.retestCount,

        upMoves: band.upMoves,
        downMoves: band.downMoves,

        bucketCount: 1,
        lastTime: band.lastTime,
      };
      continue;
    }

    if (band.bandLow <= current.max + MERGE_GAP) {
      current.min = Math.min(current.min, band.bandLow);
      current.max = Math.max(current.max, band.bandHigh);
      current.rawScore += band.rawScore;

      band.tfsSeen.forEach((tf) => current.tfsSeen.add(tf));

      current.upperWicks += band.upperWicks;
      current.lowerWicks += band.lowerWicks;

      // merge TF counts and time spans
      for (const tf of ["30m", "1h", "4h"]) {
        current.wickAttemptsByTF[tf] += band.wickAttemptsByTF[tf] || 0;
        current.consCountByTF[tf] += band.consCountByTF[tf] || 0;
        current.dispScoreByTF[tf] += band.dispScoreByTF[tf] || 0;

        const s0 = current.consStartByTF[tf] || 0;
        const s1 = band.consStartByTF[tf] || 0;
        if (s1 && (!s0 || s1 < s0)) current.consStartByTF[tf] = s1;

        const e0 = current.consEndByTF[tf] || 0;
        const e1 = band.consEndByTF[tf] || 0;
        if (e1 && (!e0 || e1 > e0)) current.consEndByTF[tf] = e1;
      }

      current.retestCount += band.retestCount || 0;

      current.upMoves += band.upMoves;
      current.downMoves += band.downMoves;

      current.bucketCount += 1;
      if (band.lastTime > current.lastTime) current.lastTime = band.lastTime;
    } else {
      zones.push(current);
      current = {
        min: band.bandLow,
        max: band.bandHigh,
        rawScore: band.rawScore,

        tfsSeen: new Set(band.tfsSeen),

        upperWicks: band.upperWicks,
        lowerWicks: band.lowerWicks,

        wickAttemptsByTF: { ...band.wickAttemptsByTF },
        consCountByTF: { ...band.consCountByTF },
        consStartByTF: { ...band.consStartByTF },
        consEndByTF: { ...band.consEndByTF },

        dispScoreByTF: { ...band.dispScoreByTF },
        retestCount: band.retestCount,

        upMoves: band.upMoves,
        downMoves: band.downMoves,

        bucketCount: 1,
        lastTime: band.lastTime,
      };
    }
  }
  if (current) zones.push(current);

  return splitWideZones(zones);
}

function splitWideZones(zones) {
  const out = [];
  for (const z of zones) {
    const width = z.max - z.min;
    if (width <= MAX_SPLIT_WIDTH) {
      out.push(z);
      continue;
    }

    const numSub = Math.max(2, Math.ceil(width / INSTITUTIONAL_MAX_WIDTH));
    const step = width / numSub;
    for (let i = 0; i < numSub; i++) {
      const subMin = z.min + i * step;
      const subMax = i === numSub - 1 ? z.max : z.min + (i + 1) * step;
      out.push({
        ...z,
        min: subMin,
        max: subMax,
        rawScore: z.rawScore / numSub,
      });
    }
  }
  return out;
}

// ---------- Institutional scoring breakdown (12 questions) ----------

function computeInstitutionalBreakdown(zone, latestTime) {
  const widthPoints = zone.max - zone.min;
  const wickAttempts =
    (zone.wickAttemptsByTF?.["30m"] || 0) +
    (zone.wickAttemptsByTF?.["1h"] || 0) +
    (zone.wickAttemptsByTF?.["4h"] || 0);

  const consCountTotal =
    (zone.consCountByTF?.["30m"] || 0) +
    (zone.consCountByTF?.["1h"] || 0) +
    (zone.consCountByTF?.["4h"] || 0);

  // Consolidation “days” proxy from earliest->latest consolidation seed time across TFs
  const consStarts = Object.values(zone.consStartByTF || {}).filter(Boolean);
  const consEnds = Object.values(zone.consEndByTF || {}).filter(Boolean);
  const consStart = consStarts.length ? Math.min(...consStarts) : 0;
  const consEnd = consEnds.length ? Math.max(...consEnds) : 0;
  const durationDays = consStart && consEnd ? computeDaysBetween(consStart, consEnd) : 0;

  // 4H authority requires B+C+D on 4H:
  // B: multiple 4H wicks
  // C: 4H consolidation present
  // D: 4H displacement present
  const wick4h = zone.wickAttemptsByTF?.["4h"] || 0;
  const cons4h = zone.consCountByTF?.["4h"] || 0;
  const disp4h = zone.dispScoreByTF?.["4h"] || 0;
  const has4hAuthority = wick4h >= 2 && cons4h >= 1 && disp4h >= 1.0;

  // --- 12 question scoring (exact table) ---

  // Q1 Duration (0–20) soft rule
  let q1 = 0;
  let q1Pass = false;
  if (durationDays >= 7) { q1 = 20; q1Pass = true; }
  else if (durationDays >= 4) { q1 = 12; q1Pass = true; }
  else { q1 = 0; q1Pass = false; }

  // Q2 Tightness (0–15) absolute range proxy using widthPoints
  // We keep this coarse and tunable:
  // Tight = <=2.0, Medium = <=3.5, Wide = >3.5
  let q2 = 3, q2Pass = false;
  if (widthPoints <= 2.0) { q2 = 15; q2Pass = true; }
  else if (widthPoints <= 3.5) { q2 = 9; q2Pass = true; }
  else { q2 = 3; q2Pass = false; }

  const compression = q1 + q2; // max 35
  const compressionPass = consCountTotal > 0 && (durationDays >= 4 || widthPoints <= 3.5);

  // Q3 Failed attempts (0–12) proxy: wickAttempts count
  let q3 = 4, q3Pass = false;
  if (wickAttempts >= 3) { q3 = 12; q3Pass = true; }
  else if (wickAttempts === 2) { q3 = 8; q3Pass = true; }
  else if (wickAttempts === 1) { q3 = 4; q3Pass = false; }
  else { q3 = 0; q3Pass = false; }

  // Q4 Wick clarity (0–8) proxy: wickAttempts + bucketCount implies repeated reaction density
  let q4 = 2, q4Pass = false;
  if (wickAttempts >= 6) { q4 = 8; q4Pass = true; }
  else if (wickAttempts >= 3) { q4 = 5; q4Pass = true; }
  else { q4 = 2; q4Pass = false; }

  const rejection = q3 + q4; // max 20
  const rejectionPass = wickAttempts >= 2; // multiple failed attempts

  // Q5 Retest holds (0–12): proxy: retestCount
  let q5 = 0, q5Pass = false;
  if (zone.retestCount >= 6) { q5 = 12; q5Pass = true; }
  else if (zone.retestCount >= 2) { q5 = 8; q5Pass = true; }
  else if (zone.retestCount >= 1) { q5 = 8; q5Pass = true; }
  else { q5 = 0; q5Pass = false; }

  // Q6 Retest reaction (0–8): proxy: displacement after interactions (use total disp)
  const dispTotal =
    (zone.dispScoreByTF?.["30m"] || 0) +
    (zone.dispScoreByTF?.["1h"] || 0) +
    (zone.dispScoreByTF?.["4h"] || 0);

  let q6 = 3, q6Pass = false;
  if (dispTotal >= 6) { q6 = 8; q6Pass = true; }
  else if (dispTotal >= 3) { q6 = 5; q6Pass = true; }
  else { q6 = 3; q6Pass = false; }

  const retest = q5 + q6; // max 20
  const retestPass = zone.retestCount >= 1;

  // Q7 4H presence (0–10)
  let q7 = 0, q7Pass = false;
  if (has4hAuthority) { q7 = 10; q7Pass = true; }
  else if (zone.tfsSeen?.has("4h")) { q7 = 6; q7Pass = true; }
  else { q7 = 0; q7Pass = false; }

  // Q8 Nested alignment (0–5)
  let q8 = 1, q8Pass = false;
  const has1h = zone.tfsSeen?.has("1h");
  const has30m = zone.tfsSeen?.has("30m");
  if (has1h && has30m && zone.tfsSeen?.has("4h")) { q8 = 5; q8Pass = true; }
  else if ((has1h && has30m) || (has1h && zone.tfsSeen?.has("4h"))) { q8 = 3; q8Pass = true; }
  else { q8 = 1; q8Pass = false; }

  const timeframe = q7 + q8; // max 15

  // Q9 breakout speed (0–5) proxy: dispTotal
  let q9 = 1, q9Pass = false;
  if (dispTotal >= 6) { q9 = 5; q9Pass = true; }
  else if (dispTotal >= 3) { q9 = 3; q9Pass = true; }
  else { q9 = 1; q9Pass = false; }

  // Q10 breakout distance (0–5) proxy: dispTotal
  let q10 = 1, q10Pass = false;
  if (dispTotal >= 6) { q10 = 5; q10Pass = true; }
  else if (dispTotal >= 3) { q10 = 3; q10Pass = true; }
  else { q10 = 1; q10Pass = false; }

  const breakout = q9 + q10; // max 10

  // Q11 structural location (0–5) proxy: if near current price -> more relevant
  // We avoid forcing; default mid (3). If it has4hAuthority AND duration >=4 days, treat as key (5).
  let q11 = 3, q11Pass = true;
  if (has4hAuthority && durationDays >= 4) { q11 = 5; q11Pass = true; }

  // Q12 integrity (0–5) proxy: retest holds multiple times implies integrity
  let q12 = 3, q12Pass = true;
  if (zone.retestCount >= 4) { q12 = 5; q12Pass = true; }
  else if (zone.retestCount === 0) { q12 = 1; q12Pass = false; }

  const context = q11 + q12; // max 10

  const scoreTotal = compression + rejection + retest + timeframe + breakout + context;

  const answers = [
    { id: "Q1", label: "Compression duration (>=7d full, 4–6d partial)", pts: q1, max: 20, pass: q1Pass },
    { id: "Q2", label: "Compression tightness (lower range = tighter)", pts: q2, max: 15, pass: q2Pass },
    { id: "Q3", label: "Rejection attempts (multiple failed attempts)", pts: q3, max: 12, pass: q3Pass },
    { id: "Q4", label: "Wick clarity (rejection evidence)", pts: q4, max: 8, pass: q4Pass },
    { id: "Q5", label: "Retest holds (zone respected on return)", pts: q5, max: 12, pass: q5Pass },
    { id: "Q6", label: "Retest reaction quality", pts: q6, max: 8, pass: q6Pass },
    { id: "Q7", label: "4H authority (B+C+D on 4H)", pts: q7, max: 10, pass: q7Pass },
    { id: "Q8", label: "Nested TF alignment (4H contains 1H/30m)", pts: q8, max: 5, pass: q8Pass },
    { id: "Q9", label: "Breakout speed (fast displacement)", pts: q9, max: 5, pass: q9Pass },
    { id: "Q10", label: "Breakout distance (far displacement)", pts: q10, max: 5, pass: q10Pass },
    { id: "Q11", label: "Structural context (pivot/imbalance relevance)", pts: q11, max: 5, pass: q11Pass },
    { id: "Q12", label: "Zone integrity (survives retests)", pts: q12, max: 5, pass: q12Pass },
  ];

  const breakdown = { compression, rejection, retest, timeframe, breakout, context };

  // Mandatory gate for institutional:
  const mandatoryPass = compressionPass && rejectionPass && retestPass;

  return {
    scoreTotal: clamp(Math.round(scoreTotal), 0, 100),
    breakdown,
    answers,
    meta: {
      durationDays: Number(durationDays.toFixed(2)),
      widthPoints: Number(widthPoints.toFixed(2)),
      has4hAuthority,
      wickAttempts,
      consCountTotal,
      retestCount: zone.retestCount || 0,
      mandatoryPass,
    },
  };
}

// ---------- Classification & selection ----------

function classifyAndSelectZones(zones, currentPrice, latestTime) {
  if (!zones.length) return [];

  const instCandidates = [];
  const shelfCandidates = [];
  const edgeCandidates = [];

  for (const z of zones) {
    const width = z.max - z.min;
    if (width <= 0) continue;

    const center = (z.max + z.min) / 2;
    const has4h = z.tfsSeen.has("4h");

    // relevance filters
    if (Number.isFinite(currentPrice)) {
      const dist = Math.abs(center - currentPrice);
      if (dist > RELEVANCE_DISTANCE_LIMIT_POINTS) continue;
    }

    const ageWeeks = computeAgeWeeks(latestTime, z.lastTime || latestTime);
    const ageDays = ageWeeks * 7;
    if (ageDays > RELEVANCE_MAX_AGE_DAYS) continue;

    // dir bias (existing)
    const moveTotal = z.upMoves + z.downMoves;
    let dirBias = 0;
    if (moveTotal > 0) {
      dirBias = (z.upMoves - z.downMoves) / moveTotal;
    } else {
      const wickTotal = z.upperWicks + z.lowerWicks;
      if (wickTotal > 0) dirBias = (z.lowerWicks - z.upperWicks) / wickTotal;
    }

    // compute institutional breakdown for eligibility and UI
    const details = computeInstitutionalBreakdown(z, latestTime);

    if (width <= EDGE_MAX_WIDTH) {
      edgeCandidates.push({ zone: z, center, width, rawScore: z.rawScore, dirBias });
    } else if (width >= SHELF_MIN_WIDTH && width <= SHELF_MAX_WIDTH) {
      shelfCandidates.push({ zone: z, center, width, rawScore: z.rawScore, dirBias });
    } else if (width >= INSTITUTIONAL_MIN_WIDTH && width <= INSTITUTIONAL_MAX_WIDTH) {
      // ✅ Institutional eligibility enforced by mandatory gate
      if (!details.meta.mandatoryPass) {
        continue; // not institutional
      }

      // 4H not strictly required to be institutional, but required for 100 later
      // Slight down-weight if no 4H participation
      const adjRaw = has4h ? z.rawScore : z.rawScore * 0.85;

      instCandidates.push({
        zone: z,
        center,
        width,
        rawScore: adjRaw,
        dirBias,
        details,
      });
    }
  }

  instCandidates.sort((a, b) => b.rawScore - a.rawScore);
  shelfCandidates.sort((a, b) => b.rawScore - a.rawScore);
  edgeCandidates.sort((a, b) => b.rawScore - a.rawScore);

  const selected = [];

  // Select institutional zones with spacing constraint
  const instSelected = [];
  for (const c of instCandidates) {
    if (instSelected.length >= MAX_INSTITUTIONAL_ZONES) break;
    const tooClose = instSelected.some((s) => Math.abs(s.center - c.center) < MIN_INSTITUTIONAL_GAP);
    if (tooClose) continue;
    instSelected.push(c);
  }

  for (const c of instSelected) {
    selected.push({
      type: "institutional",
      center: c.center,
      min: c.zone.min,
      max: c.zone.max,
      rawScore: c.rawScore,
      dirBias: c.dirBias,
      details: c.details,
      _has4h: c.zone.tfsSeen.has("4h"),
    });
  }

  // Shelves (accum/distribution) kept as-is (legacy)
  for (let i = 0; i < Math.min(MAX_SHELVES, shelfCandidates.length); i++) {
    const c = shelfCandidates[i];
    const type =
      c.dirBias > 0.05 ? "accumulation" : c.dirBias < -0.05 ? "distribution" : "accumulation";
    selected.push({
      type,
      center: c.center,
      min: c.zone.min,
      max: c.zone.max,
      rawScore: c.rawScore,
      dirBias: c.dirBias,
    });
  }

  // Edges
  for (let i = 0; i < Math.min(MAX_EDGES, edgeCandidates.length); i++) {
    const c = edgeCandidates[i];
    const type =
      c.dirBias > 0.05 ? "accumulation" : c.dirBias < -0.05 ? "distribution" : "distribution";
    selected.push({
      type,
      center: c.center,
      min: c.zone.min,
      max: c.zone.max,
      rawScore: c.rawScore,
      dirBias: c.dirBias,
    });
  }

  return selected;
}

/**
 * Normalize strengths 40–100 and format final output.
 * Adds:
 * - mandatory gate already enforced for institutional candidates
 * - 4H required for 100 (cap at 99 if no 4H authority)
 */
function normalizeAndFormat(zones) {
  if (!zones.length) return [];

  let maxRaw = 0;
  for (const z of zones) if (z.rawScore > maxRaw) maxRaw = z.rawScore;
  if (maxRaw <= 0) return [];

  for (const z of zones) {
    const rel = z.rawScore / maxRaw;
    let strength = Math.round(40 + 60 * rel); // 40–100

    // 4H required for 100: cap at 99 if missing 4H authority
    if (z.type === "institutional" && strength >= 100) {
      const has4hAuthority = z.details?.meta?.has4hAuthority === true;
      if (!has4hAuthority) strength = 99;
    }

    z.strength = strength;
  }

  zones.sort((a, b) => b.strength - a.strength);

  return zones.map((z) => ({
    type: z.type,
    price: z.center,
    priceRange: [Number(z.max.toFixed(2)), Number(z.min.toFixed(2))],
    strength: z.strength,
    ...(z.type === "institutional" && z.details
      ? {
          details: {
            scoreTotal: z.details.scoreTotal,
            breakdown: z.details.breakdown,
            answers: z.details.answers,
            meta: z.details.meta,
          },
        }
      : {}),
  }));
}

// ---------- Public entry ----------

export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  try {
    if (!Array.isArray(bars30m) || !Array.isArray(bars1h) || !Array.isArray(bars4h)) {
      console.warn("[SMZ] computeSmartMoneyLevels: invalid inputs");
      return [];
    }

    const tfBars = {
      "30m": bars30m.filter(isFiniteBar).sort((a, b) => a.time - b.time),
      "1h": bars1h.filter(isFiniteBar).sort((a, b) => a.time - b.time),
      "4h": bars4h.filter(isFiniteBar).sort((a, b) => a.time - b.time),
    };

    const atrByTF = {
      "30m": computeATR(tfBars["30m"], 50),
      "1h": computeATR(tfBars["1h"], 50),
      "4h": computeATR(tfBars["4h"], 50),
    };

    const latestTime = Math.max(
      tfBars["30m"].length ? tfBars["30m"][tfBars["30m"].length - 1].time : 0,
      tfBars["1h"].length ? tfBars["1h"][tfBars["1h"].length - 1].time : 0,
      tfBars["4h"].length ? tfBars["4h"][tfBars["4h"].length - 1].time : 0
    );

    if (!latestTime) {
      console.warn("[SMZ] No latest time found; empty bars?");
      return [];
    }

    let currentPrice = null;
    if (tfBars["30m"].length) currentPrice = tfBars["30m"][tfBars["30m"].length - 1].close;
    else if (tfBars["1h"].length) currentPrice = tfBars["1h"][tfBars["1h"].length - 1].close;
    else if (tfBars["4h"].length) currentPrice = tfBars["4h"][tfBars["4h"].length - 1].close;

    const seeds = [
      ...makeSeedsForTF("30m", tfBars["30m"], atrByTF["30m"]),
      ...makeSeedsForTF("1h", tfBars["1h"], atrByTF["1h"]),
      ...makeSeedsForTF("4h", tfBars["4h"], atrByTF["4h"]),
    ];

    if (!seeds.length) {
      console.log("[SMZ] No seeds generated");
      return [];
    }

    const buckets = buildBucketsFromSeeds(seeds, tfBars, atrByTF, latestTime);
    if (!buckets.length) {
      console.log("[SMZ] No buckets after scoring");
      return [];
    }

    const zones = buildZonesFromBuckets(buckets);
    if (!zones.length) {
      console.log("[SMZ] No zones from buckets");
      return [];
    }

    const classified = classifyAndSelectZones(zones, currentPrice, latestTime);
    if (!classified.length) {
      console.log("[SMZ] No classified zones selected");
      return [];
    }

    const finalLevels = normalizeAndFormat(classified);

    console.log(
      `[SMZ] Final levels: ${finalLevels.length}. ` +
        `Inst=${finalLevels.filter((z) => z.type === "institutional").length}, ` +
        `Acc=${finalLevels.filter((z) => z.type === "accumulation").length}, ` +
        `Dist=${finalLevels.filter((z) => z.type === "distribution").length}`
    );

    return finalLevels;
  } catch (err) {
    console.error("[SMZ] Error in computeSmartMoneyLevels:", err);
    return [];
  }
}
