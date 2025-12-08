// services/core/logic/smzEngine.js
// Smart Money Zone Engine — 12-Question Institutional Model
//
// Entry:
//   computeSmartMoneyLevels(bars30m, bars1h, bars4h) -> SmzLevel[]
//
// SmzLevel = {
//   type: "institutional" | "accumulation" | "distribution",
//   price: number,
//   priceRange: [number, number], // [high, low]
//   strength: number              // 0–100
// }
//
// This engine implements the conceptual model we agreed on:
// - Wick-based seeds
// - Consolidation shelves
// - Displacement + retests
// - TF weighting (4h > 1h > 30m)
// - ATR-normalized scores
// - Recency decay (~2% per week)
// - Buckets → zones → classification → normalization

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

// Recency decay
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

function roundPriceToBucket(price, size) {
  if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) return price;
  return Math.round(price / size) * size;
}

// ---------- Seed detection per timeframe ----------

/**
 * Build wick + consolidation seeds for a single timeframe.
 *
 * @param {"30m"|"1h"|"4h"} tf
 * @param {Array} bars
 * @param {number} atr
 * @returns {Array} seeds
 *
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

/**
 * Evaluate displacement and retests for a single seed in its timeframe.
 *
 * @param {Array} tfBars
 * @param {Object} seed
 * @param {number} atr
 * @returns {{dispScore: number, retestCount: number, upMoves: number, downMoves: number}}
 */
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

/**
 * Aggregate seeds into price buckets and compute raw scores per bucket.
 *
 * @param {Array} seeds
 * @param {Object} barsByTF
 * @param {Object} atrByTF
 * @param {number} latestTime
 * @returns {Array} buckets
 */
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
        consCountByTF: { "30m": 0, "1h": 0, "4h": 0 },
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

    // consolidation count
    if (seed.isConsolidation) {
      bucket.consCountByTF[tf] += 1;
    }

    // wick contribution
    if (seed.wickLen > 0) {
      const normWick = Math.min(seed.wickLen / atr, WICK_SOFT_CAP);
      bucket.wickScoreByTF[tf] += normWick;
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

  // Filter out very weak buckets
  return buckets
    .filter((b) => b.rawScore > 0)
    .sort((a, b) => a.price - b.price);
}

// ---------- Zones from buckets ----------

/**
 * Merge buckets into raw zones (bands).
 *
 * @param {Array} buckets
 * @returns {Array} zones
 *
 * Zone shape:
 * {
 *   min: number,
 *   max: number,
 *   rawScore: number,
 *   tfsSeen: Set,
 *   upperWicks: number,
 *   lowerWicks: number,
 *   upMoves: number,
 *   downMoves: number,
 *   bucketCount: number
 * }
 */
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
    upMoves: b.upMoves,
    downMoves: b.downMoves,
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
        upMoves: band.upMoves,
        downMoves: band.downMoves,
        bucketCount: 1,
      };
      continue;
    }

    // if overlapping or close, merge
    if (band.bandLow <= current.max + MERGE_GAP) {
      current.min = Math.min(current.min, band.bandLow);
      current.max = Math.max(current.max, band.bandHigh);
      current.rawScore += band.rawScore;
      band.tfsSeen.forEach((tf) => current.tfsSeen.add(tf));
      current.upperWicks += band.upperWicks;
      current.lowerWicks += band.lowerWicks;
      current.upMoves += band.upMoves;
      current.downMoves += band.downMoves;
      current.bucketCount += 1;
    } else {
      zones.push(current);
      current = {
        min: band.bandLow,
        max: band.bandHigh,
        rawScore: band.rawScore,
        tfsSeen: new Set(band.tfsSeen),
        upperWicks: band.upperWicks,
        lowerWicks: band.lowerWicks,
        upMoves: band.upMoves,
        downMoves: band.downMoves,
        bucketCount: 1,
      };
    }
  }
  if (current) zones.push(current);

  return splitWideZones(zones);
}

/**
 * Split ultra-wide zones into sub-zones of institutional width.
 *
 * @param {Array} zones
 * @returns {Array} zones
 */
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
        min: subMin,
        max: subMax,
        rawScore: z.rawScore / numSub,
        tfsSeen: new Set(z.tfsSeen),
        upperWicks: z.upperWicks,
        lowerWicks: z.lowerWicks,
        upMoves: z.upMoves,
        downMoves: z.downMoves,
        bucketCount: z.bucketCount,
      });
    }
  }
  return out;
}

// ---------- Classification & selection ----------

/**
 * Classify zones into institutional / shelves / edges and select top ones.
 *
 * @param {Array} zones
 * @returns {Array} finalZones with { type, center, min, max, rawScore }
 */
function classifyAndSelectZones(zones) {
  if (!zones.length) return [];

  const instCandidates = [];
  const shelfCandidates = [];
  const edgeCandidates = [];

  for (const z of zones) {
    const width = z.max - z.min;
    if (width <= 0) continue;

    const center = (z.max + z.min) / 2;
    const has4h = z.tfsSeen.has("4h");

    // Direction from displacement moves; fallback to wick bias
    const moveTotal = z.upMoves + z.downMoves;
    let dirBias = 0;
    if (moveTotal > 0) {
      dirBias = (z.upMoves - z.downMoves) / moveTotal; // -1..+1
    } else {
      const wickTotal = z.upperWicks + z.lowerWicks;
      if (wickTotal > 0) {
        dirBias = (z.lowerWicks - z.upperWicks) / wickTotal; // + => buy bias
      }
    }

    if (width <= EDGE_MAX_WIDTH) {
      edgeCandidates.push({ zone: z, center, width, rawScore: z.rawScore, dirBias });
    } else if (width >= SHELF_MIN_WIDTH && width <= SHELF_MAX_WIDTH) {
      shelfCandidates.push({ zone: z, center, width, rawScore: z.rawScore, dirBias });
    } else if (width >= INSTITUTIONAL_MIN_WIDTH && width <= INSTITUTIONAL_MAX_WIDTH && has4h) {
      instCandidates.push({ zone: z, center, width, rawScore: z.rawScore, dirBias });
    } else if (width >= INSTITUTIONAL_MIN_WIDTH && width <= INSTITUTIONAL_MAX_WIDTH) {
      // weaker institutional candidate (no 4h), still allow
      instCandidates.push({ zone: z, center, width, rawScore: z.rawScore * 0.8, dirBias });
    } else {
      // ignore overly wide or tiny weird stuff
      continue;
    }
  }

  // sort by rawScore descending
  instCandidates.sort((a, b) => b.rawScore - a.rawScore);
  shelfCandidates.sort((a, b) => b.rawScore - a.rawScore);
  edgeCandidates.sort((a, b) => b.rawScore - a.rawScore);

  const selected = [];

  // Select institutional zones with spacing constraint
  const instSelected = [];
  for (const c of instCandidates) {
    if (instSelected.length >= MAX_INSTITUTIONAL_ZONES) break;
    const tooClose = instSelected.some(
      (s) => Math.abs(s.center - c.center) < MIN_INSTITUTIONAL_GAP
    );
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
    });
  }

  // Shelves
  for (let i = 0; i < Math.min(MAX_SHELVES, shelfCandidates.length); i++) {
    const c = shelfCandidates[i];
    const type =
      c.dirBias > 0.05
        ? "accumulation"
        : c.dirBias < -0.05
        ? "distribution"
        : "accumulation";
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
      c.dirBias > 0.05
        ? "accumulation"
        : c.dirBias < -0.05
        ? "distribution"
        : "distribution";
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
 *
 * @param {Array} zones
 * @returns {Array} SmzLevel[]
 */
function normalizeAndFormat(zones) {
  if (!zones.length) return [];

  let maxRaw = 0;
  for (const z of zones) {
    if (z.rawScore > maxRaw) maxRaw = z.rawScore;
  }
  if (maxRaw <= 0) return [];

  for (const z of zones) {
    const rel = z.rawScore / maxRaw;
    const strength = Math.round(40 + 60 * rel); // 40–100
    z.strength = strength;
  }

  zones.sort((a, b) => b.strength - a.strength);

  return zones.map((z) => ({
    type: z.type,
    price: z.center,
    priceRange: [Number(z.max.toFixed(2)), Number(z.min.toFixed(2))],
    strength: z.strength,
  }));
}

// ---------- Public entry ----------

/**
 * Main engine entry point.
 *
 * @param {Array} bars30m
 * @param {Array} bars1h
 * @param {Array} bars4h
 * @returns {Array} SmzLevel[]
 */
export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  try {
    if (!Array.isArray(bars30m) || !Array.isArray(bars1h) || !Array.isArray(bars4h)) {
      console.warn("[SMZ] computeSmartMoneyLevels: invalid inputs");
      return [];
    }

    // Normalize / filter / sort bars by time
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

    // Build seeds for each TF
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

    const classified = classifyAndSelectZones(zones);
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
