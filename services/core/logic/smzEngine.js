// services/core/logic/smzEngine.js
// Smart Money Zone Engine — 12-Question Institutional Model + Relevance Filter (Option C)

const TF_WEIGHTS = {
  "30m": 0.5,
  "1h": 0.8,
  "4h": 1.2,
};

// ✅ Focus institutional on what matters now (you want 680–684, 671–673, 652–655)
const MAX_INSTITUTIONAL_ZONES = 3; // was 4 (drop irrelevant like 639–642)
const MAX_SHELVES = 3;
const MAX_EDGES = 3;

// Width rules (in SPY points)
const SHELF_MIN_WIDTH = 1.0;
const SHELF_MAX_WIDTH = 3.0;
const EDGE_MAX_WIDTH = 1.0;
const INSTITUTIONAL_MIN_WIDTH = 2.0;
const INSTITUTIONAL_MAX_WIDTH = 5.5;
const MAX_SPLIT_WIDTH = 6.0;
const INIT_BAND_HALF_WIDTH = 1.0;

// Spacing between institutional zones
const MIN_INSTITUTIONAL_GAP = 4.0; // was 8.0 (allows 679–682.5 + 671–673 to coexist)

// Bucket size for price aggregation
const BUCKET_SIZE = 0.5;

// Recency decay
const RECENCY_DECAY_PER_WEEK = 0.98;

// Wick thresholds (ATR-based)
const K_WICK = 0.6;
const WICK_SOFT_CAP = 3.0;

// Consolidation detection
const BODY_THRESHOLD_ATR = 0.5;
const SHELF_MAX_WIDTH_POINTS = 3.0;

// Displacement and retest
const DISP_LOOKAHEAD_BARS = 30;
const DISP_SOFT_CAP_ATR = 5.0;
const RETEST_BAND_WIDTH = 1.25;
const RETEST_LOOKAHEAD_BARS = 40;

// Scoring weights
const W_WICK = 1.0;
const W_CONS = 0.7;
const W_DISP = 1.2;
const W_RETEST = 0.8;

const MERGE_GAP = 0.5;

// Relevance filter
const RELEVANCE_DISTANCE_LIMIT_POINTS = 40;
const RELEVANCE_MAX_AGE_DAYS = 70;

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

// ---------- seeds ----------
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
    const lowerWick = bodyLow - b.low; // positive number

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

    // ✅ FIX: lower wick condition was wrong (was -lowerWick > threshold)
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

  // consolidation seeds
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

// ---------- effects ----------
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

    if (dist <= RETEST_BAND_WIDTH) retestCount++;
  }

  let dispRaw = atr > 0 ? maxDisp / atr : 0;
  if (!Number.isFinite(dispRaw)) dispRaw = 0;
  const dispScore = Math.min(dispRaw, DISP_SOFT_CAP_ATR);

  return { dispScore, retestCount, upMoves, downMoves };
}

// ---------- buckets ----------
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

    if (seed.time > bucket.lastTime) bucket.lastTime = seed.time;

    if (seed.isConsolidation) bucket.consCountByTF[tf] += 1;

    if (seed.wickLen > 0) {
      const normWick = Math.min(seed.wickLen / atr, WICK_SOFT_CAP);
      bucket.wickScoreByTF[tf] += normWick;
      if (seed.dir === "sell") bucket.upperWicks += 1;
      if (seed.dir === "buy") bucket.lowerWicks += 1;
    }

    const { dispScore, retestCount, upMoves, downMoves } = evaluateSeedEffects(tfBars, seed, atr);
    bucket.dispScoreByTF[tf] += dispScore;
    bucket.retestCount += retestCount;
    bucket.upMoves += upMoves;
    bucket.downMoves += downMoves;
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
    rawScore *= Math.pow(RECENCY_DECAY_PER_WEEK, ageWeeks || 0);

    b.rawScore = rawScore;
    buckets.push(b);
  }

  return buckets.filter((b) => b.rawScore > 0).sort((a, b) => a.price - b.price);
}

// ---------- zones ----------
function buildZonesFromBuckets(buckets) {
  if (!buckets.length) return [];

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
        upMoves: band.upMoves,
        downMoves: band.downMoves,
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
      current.upMoves += band.upMoves;
      current.downMoves += band.downMoves;
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
        upMoves: band.upMoves,
        downMoves: band.downMoves,
        lastTime: band.lastTime,
      };
    }
  }
  if (current) zones.push(current);

  return zones;
}

// ---------- selection + normalize ----------
function classifyAndSelectZones(zones, currentPrice, latestTime) {
  const instCandidates = [];

  for (const z of zones) {
    const width = z.max - z.min;
    if (width < INSTITUTIONAL_MIN_WIDTH || width > INSTITUTIONAL_MAX_WIDTH) continue;

    const center = (z.max + z.min) / 2;

    // relevance
    if (Number.isFinite(currentPrice)) {
      const dist = Math.abs(center - currentPrice);
      if (dist > RELEVANCE_DISTANCE_LIMIT_POINTS) continue;
    }

    const ageWeeks = computeAgeWeeks(latestTime, z.lastTime || latestTime);
    if (ageWeeks * 7 > RELEVANCE_MAX_AGE_DAYS) continue;

    // Prefer 4H participation
    const has4h = z.tfsSeen.has("4h");

    // ✅ Prefer zones closer to current price
    const distPts = Number.isFinite(currentPrice) ? Math.abs(center - currentPrice) : 9999;

    const scoreForSort = z.rawScore * (has4h ? 1.0 : 0.85) - distPts * 0.05;

    instCandidates.push({
      zone: z,
      center,
      scoreForSort,
      distPts,
      has4h,
    });
  }

  instCandidates.sort((a, b) => b.scoreForSort - a.scoreForSort);

  const picked = [];
  for (const c of instCandidates) {
    if (picked.length >= MAX_INSTITUTIONAL_ZONES) break;
    const tooClose = picked.some((p) => Math.abs(p.center - c.center) < MIN_INSTITUTIONAL_GAP);
    if (tooClose) continue;
    picked.push(c);
  }

  // Normalize to 40–100
  let maxRaw = 0;
  for (const p of picked) maxRaw = Math.max(maxRaw, p.zone.rawScore);
  if (maxRaw <= 0) maxRaw = 1;

  return picked.map((p) => {
    const rel = p.zone.rawScore / maxRaw;
    const strength = Math.round(40 + 60 * rel);
    return {
      type: "institutional",
      price: p.center,
      priceRange: [Number(p.zone.max.toFixed(2)), Number(p.zone.min.toFixed(2))],
      strength,
    };
  });
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

    return classifyAndSelectZones(zones, currentPrice, latestTime);
  } catch (e) {
    console.error("[SMZ] computeSmartMoneyLevels error:", e);
    return [];
  }
}
