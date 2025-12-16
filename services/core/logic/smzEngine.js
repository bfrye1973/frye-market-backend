// services/core/logic/smzEngine.js
// DIAGNOSTIC MODE — Return all significant zones (strength >= 70)
// Purpose: show what the algo is grading so we can tune (esp 679–682.50)
//
// Output: { type, price, priceRange:[hi,lo], strength, debug:{...} }

const TF_WEIGHTS = {
  "30m": 0.5,
  "1h": 0.8,
  "4h": 1.2,
};

// Width rules (SPY points)
const SHELF_MIN_WIDTH = 1.0;
const SHELF_MAX_WIDTH = 3.0;
const EDGE_MAX_WIDTH = 1.0;
const INSTITUTIONAL_MIN_WIDTH = 2.0;
const INSTITUTIONAL_MAX_WIDTH = 6.5; // loosened for diagnostic

// Initial band half width around each bucket
const INIT_BAND_HALF_WIDTH = 1.0;

// Bucket size
const BUCKET_SIZE = 0.5;

// Wick thresholds
const K_WICK = 0.6;
const WICK_SOFT_CAP = 3.0;

// Consolidation detection
const BODY_THRESHOLD_ATR = 0.5;
const SHELF_MAX_WIDTH_POINTS = 3.0;

// Displacement & retest
const DISP_LOOKAHEAD_BARS = 30;
const DISP_SOFT_CAP_ATR = 6.0;
const RETEST_BAND_WIDTH = 1.25;
const RETEST_LOOKAHEAD_BARS = 40;

// Score weights (raw components)
const W_WICK = 1.0;
const W_CONS = 0.7;
const W_DISP = 1.2;
const W_RETEST = 0.8;

// Merge gap
const MERGE_GAP = 0.5;

// Relevance filters — LOOSENED for diagnostic
const RELEVANCE_DISTANCE_LIMIT_POINTS = 120;
const RELEVANCE_MAX_AGE_DAYS = 200;

// Diagnostic output floor
const MIN_STRENGTH_KEEP = 70;
// Safety cap
const MAX_OUTPUT_ZONES = 50;

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
function computeAgeDays(latestTime, barTime) {
  if (!latestTime || !barTime) return 0;
  const msMode = latestTime > 2e10 || barTime > 2e10;
  const diff = Math.max(0, latestTime - barTime);
  return msMode ? diff / 86400000 : diff / 86400;
}

function roundPriceToBucket(price, size) {
  if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) return price;
  return Math.round(price / size) * size;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

// ---------- Seed detection per TF ----------

function makeSeedsForTF(tf, bars, atr) {
  const seeds = [];
  if (!Array.isArray(bars) || bars.length < 10 || !atr || atr <= 0) return seeds;

  const wickThreshold = K_WICK * atr;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;

    const bodyHigh = Math.max(b.open, b.close);
    const bodyLow = Math.min(b.open, b.close);
    const upperWick = b.high - bodyHigh;
    const lowerWick = bodyLow - b.low; // positive

    // upper wick seed
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

    // ✅ FIX: lower wick seed (your old code had -lowerWick > threshold which breaks this)
    if (lowerWick > wickThreshold) {
      seeds.push({
        price: b.low,
        dir: "buy",
        tf,
        barIndex: i,
        time: b.time,
        wickLen: lowerWick,
        isConsolidation: false,
      });
    }
  }

  // Consolidation seeds
  let minWin, maxWin;
  if (tf === "30m") {
    minWin = 8;
    maxWin = 20;
  } else if (tf === "1h") {
    minWin = 5;
    maxWin = 12;
  } else {
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
      if (!count) continue;

      const bandWidth = bandHigh - bandLow;
      const avgBody = bodySum / count;

      if (bandWidth > 0 && bandWidth <= SHELF_MAX_WIDTH_POINTS && avgBody < BODY_THRESHOLD_ATR * atr) {
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

// ---------- Seed effects ----------

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
      maxDisp = Math.max(maxDisp, dist);
      if (mid > anchorPrice) upMoves++;
      else if (mid < anchorPrice) downMoves++;
    }

    if (dist <= RETEST_BAND_WIDTH) retestCount++;
  }

  const dispRaw = atr > 0 ? maxDisp / atr : 0;
  const dispScore = clamp(dispRaw, 0, DISP_SOFT_CAP_ATR);

  return { dispScore, retestCount, upMoves, downMoves };
}

// ---------- Buckets ----------

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
        tfsSeen: new Set(),

        // component accumulation (for debug)
        wickScoreByTF: { "30m": 0, "1h": 0, "4h": 0 },
        consCountByTF: { "30m": 0, "1h": 0, "4h": 0 },
        dispScoreByTF: { "30m": 0, "1h": 0, "4h": 0 },

        wickAttempts: 0,
        upperWicks: 0,
        lowerWicks: 0,

        retestCount: 0,
        upMoves: 0,
        downMoves: 0,

        lastTime: 0,
        rawScore: 0,

        // debug totals (computed later)
        dbg: {
          wickScore: 0,
          consScore: 0,
          dispScore: 0,
          retestScore: 0,
          ageDays: 0,
        },
      });
    }

    const b = bucketMap.get(bucketPrice);
    b.tfsSeen.add(tf);

    if (seed.time > b.lastTime) b.lastTime = seed.time;

    // consolidation count
    if (seed.isConsolidation) {
      b.consCountByTF[tf] += 1;
    }

    // wick seed contribution
    if (seed.wickLen > 0) {
      const normWick = Math.min(seed.wickLen / atr, WICK_SOFT_CAP);
      b.wickScoreByTF[tf] += normWick;
      b.wickAttempts += 1;
      if (seed.dir === "sell") b.upperWicks += 1;
      if (seed.dir === "buy") b.lowerWicks += 1;
    }

    // displacement + retests
    const eff = evaluateSeedEffects(tfBars, seed, atr);
    b.dispScoreByTF[tf] += eff.dispScore;
    b.retestCount += eff.retestCount;
    b.upMoves += eff.upMoves;
    b.downMoves += eff.downMoves;
  }

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

    const dispScore =
      TF_WEIGHTS["30m"] * b.dispScoreByTF["30m"] +
      TF_WEIGHTS["1h"] * b.dispScoreByTF["1h"] +
      TF_WEIGHTS["4h"] * b.dispScoreByTF["4h"];

    const retestScore = b.retestCount;

    let raw =
      W_WICK * wickScore +
      W_CONS * consScore +
      W_DISP * dispScore +
      W_RETEST * retestScore;

    const ageDays = computeAgeDays(latestTime, b.lastTime || latestTime);
    // recency decay
    raw *= Math.pow(RECENCY_DECAY_PER_WEEK, ageDays / 7);

    b.rawScore = raw;

    b.dbg.wickScore = wickScore;
    b.dbg.consScore = consScore;
    b.dbg.dispScore = dispScore;
    b.dbg.retestScore = retestScore;
    b.dbg.ageDays = ageDays;

    buckets.push(b);
  }

  return buckets.filter((b) => b.rawScore > 0).sort((a, b) => a.price - b.price);
}

// ---------- Zones ----------

function buildZonesFromBuckets(buckets) {
  if (!buckets.length) return [];

  const bands = buckets.map((b) => ({
    low: b.price - INIT_BAND_HALF_WIDTH,
    high: b.price + INIT_BAND_HALF_WIDTH,
    price: b.price,

    rawScore: b.rawScore,
    lastTime: b.lastTime,
    tfsSeen: b.tfsSeen,

    // debug accumulators
    wickScore: b.dbg.wickScore,
    consScore: b.dbg.consScore,
    dispScore: b.dbg.dispScore,
    retestScore: b.dbg.retestScore,
    retestCount: b.retestCount,
    wickAttempts: b.wickAttempts,
    upperWicks: b.upperWicks,
    lowerWicks: b.lowerWicks,
  }));

  bands.sort((a, b) => a.price - b.price);

  const zones = [];
  let cur = null;

  for (const band of bands) {
    if (!cur) {
      cur = {
        min: band.low,
        max: band.high,
        rawScore: band.rawScore,
        lastTime: band.lastTime,
        tfsSeen: new Set(band.tfsSeen),

        wickScore: band.wickScore,
        consScore: band.consScore,
        dispScore: band.dispScore,
        retestScore: band.retestScore,

        retestCount: band.retestCount,
        wickAttempts: band.wickAttempts,
        upperWicks: band.upperWicks,
        lowerWicks: band.lowerWicks,
      };
      continue;
    }

    if (band.low <= cur.max + MERGE_GAP) {
      cur.min = Math.min(cur.min, band.low);
      cur.max = Math.max(cur.max, band.high);
      cur.rawScore += band.rawScore;
      cur.wickScore += band.wickScore;
      cur.consScore += band.consScore;
      cur.dispScore += band.dispScore;
      cur.retestScore += band.retestScore;

      cur.retestCount += band.retestCount;
      cur.wickAttempts += band.wickAttempts;
      cur.upperWicks += band.upperWicks;
      cur.lowerWicks += band.lowerWicks;

      band.tfsSeen.forEach((tf) => cur.tfsSeen.add(tf));
      if (band.lastTime > cur.lastTime) cur.lastTime = band.lastTime;
    } else {
      zones.push(cur);
      cur = {
        min: band.low,
        max: band.high,
        rawScore: band.rawScore,
        lastTime: band.lastTime,
        tfsSeen: new Set(band.tfsSeen),

        wickScore: band.wickScore,
        consScore: band.consScore,
        dispScore: band.dispScore,
        retestScore: band.retestScore,

        retestCount: band.retestCount,
        wickAttempts: band.wickAttempts,
        upperWicks: band.upperWicks,
        lowerWicks: band.lowerWicks,
      };
    }
  }
  if (cur) zones.push(cur);

  return zones;
}

// ---------- Classification (diagnostic) ----------

function classifyZones(zones, currentPrice, latestTime) {
  const out = [];

  for (const z of zones) {
    const width = z.max - z.min;
    if (width <= 0) continue;

    const center = (z.max + z.min) / 2;
    const ageDays = computeAgeDays(latestTime, z.lastTime || latestTime);

    // Diagnostic relevance: if currentPrice not valid, skip distance filter
    let distPts = null;
    if (Number.isFinite(currentPrice)) {
      distPts = Math.abs(center - currentPrice);
      if (distPts > RELEVANCE_DISTANCE_LIMIT_POINTS) continue;
    }
    if (ageDays > RELEVANCE_MAX_AGE_DAYS) continue;

    // Determine type by width
    let type = "institutional";
    if (width <= EDGE_MAX_WIDTH) type = "edge";
    else if (width >= SHELF_MIN_WIDTH && width <= SHELF_MAX_WIDTH) type = "shelf";
    else if (width >= INSTITUTIONAL_MIN_WIDTH && width <= INSTITUTIONAL_MAX_WIDTH) type = "institutional";
    else type = "ignore";

    if (type === "ignore") continue;

    // Convert shelves/edges to accumulation/distribution using wick bias / moves
    let finalType = type;
    if (type === "shelf" || type === "edge") {
      // Use rejection direction proxy: lowerWicks => buy bias, upperWicks => sell bias
      const wickTotal = z.upperWicks + z.lowerWicks;
      let dirBias = 0;
      if (wickTotal > 0) dirBias = (z.lowerWicks - z.upperWicks) / wickTotal;

      finalType = dirBias >= 0 ? "accumulation" : "distribution";
    } else {
      finalType = "institutional";
    }

    out.push({
      type: finalType,
      center,
      min: z.min,
      max: z.max,
      rawScore: z.rawScore,
      debug: {
        widthPoints: Number(width.toFixed(2)),
        ageDays: Number(ageDays.toFixed(2)),
        distPts: distPts == null ? null : Number(distPts.toFixed(2)),
        tfsSeen: Array.from(z.tfsSeen),
        wickScore: Number(z.wickScore.toFixed(2)),
        consScore: Number(z.consScore.toFixed(2)),
        dispScore: Number(z.dispScore.toFixed(2)),
        retestScore: Number(z.retestScore.toFixed(2)),
        wickAttempts: z.wickAttempts,
        retestCount: z.retestCount,
        upperWicks: z.upperWicks,
        lowerWicks: z.lowerWicks,
      },
    });
  }

  return out;
}

// ---------- Normalize + filter >=70 ----------

function normalizeAndFilter(candidates) {
  if (!candidates.length) return [];

  let maxRaw = 0;
  for (const c of candidates) maxRaw = Math.max(maxRaw, c.rawScore);
  if (maxRaw <= 0) return [];

  const withStrength = candidates.map((c) => {
    const rel = c.rawScore / maxRaw;
    const strength = Math.round(40 + 60 * rel);
    return {
      type: c.type,
      price: Number(c.center.toFixed(2)),
      priceRange: [Number(c.max.toFixed(2)), Number(c.min.toFixed(2))],
      strength,
      debug: c.debug,
    };
  });

  // Keep only >=70 for diagnostic calibration
  const filtered = withStrength
    .filter((c) => c.strength >= MIN_STRENGTH_KEEP)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_OUTPUT_ZONES);

  return filtered;
}

// ---------- Public entry ----------

export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  try {
    const tfBars = {
      "30m": (bars30m || []).filter(isFiniteBar).sort((a, b) => a.time - b.time),
      "1h": (bars1h || []).filter(isFiniteBar).sort((a, b) => a.time - b.time),
      "4h": (bars4h || []).filter(isFiniteBar).sort((a, b) => a.time - b.time),
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
    if (!latestTime) return [];

    const currentPrice =
      tfBars["30m"].length ? tfBars["30m"][tfBars["30m"].length - 1].close
      : tfBars["1h"].length ? tfBars["1h"][tfBars["1h"].length - 1].close
      : tfBars["4h"].length ? tfBars["4h"][tfBars["4h"].length - 1].close
      : null;

    const seeds = [
      ...makeSeedsForTF("30m", tfBars["30m"], atrByTF["30m"]),
      ...makeSeedsForTF("1h", tfBars["1h"], atrByTF["1h"]),
      ...makeSeedsForTF("4h", tfBars["4h"], atrByTF["4h"]),
    ];
    if (!seeds.length) return [];

    const buckets = buildBucketsFromSeeds(seeds, tfBars, atrByTF, latestTime);
    const zones = buildZonesFromBuckets(buckets);
    const classified = classifyZones(zones, currentPrice, latestTime);
    return normalizeAndFilter(classified);
  } catch (e) {
    console.error("[SMZ] computeSmartMoneyLevels error:", e);
    return [];
  }
}
