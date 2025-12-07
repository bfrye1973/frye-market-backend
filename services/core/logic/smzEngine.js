// services/core/logic/smzEngine.js
// Smart Money institutional zone engine — MULTI-TF VERSION
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
// This implementation follows the 12/06 spec:
// - Uses 30m / 1h / 4h separately
// - Wick + consolidation + reaction candidates
// - Price buckets → clusters → bands
// - TF weights: 4h=1.2, 1h=0.8, 30m=0.5
// - Recency decay ~2% per week
// - Max 4 institutional, 3 shelves, 3 edges

const TF_WEIGHTS = {
  "30m": 0.5,
  "1h": 0.8,
  "4h": 1.2,
};

const MAX_INSTITUTIONAL_ZONES = 4;
const MAX_SHELVES = 3;
const MAX_EDGES = 3;

const MAX_ZONE_WIDTH = 5.0; // institutional soft cap
const MIN_ZONE_WIDTH = 0.5; // below this is effectively an "edge"

const SHELF_MIN_WIDTH = 0.75;
const SHELF_MAX_WIDTH = 3.0;
const SHELF_SWEET_MAX = 2.5;

const BUCKET_SIZE = 0.5; // round to nearest 0.5
const CLUSTER_GAP = 1.5; // max gap between bucket centers in same cluster

const RECENCY_DECAY_PER_WEEK = 0.98; // ~2% per week

const WICK_MIN_ATR_MULT = 0.4;
const WICK_MAX_ATR_MULT = 3.0; // soft cap
const MAX_RANGE_POINTS = 8.0;  // clamp extreme ranges

// ---- Basic helpers ----

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

// Handles both seconds and ms timestamps.
function computeAgeWeeks(latestTime, barTime) {
  if (!latestTime || !barTime) return 0;
  const msMode = latestTime > 2e10 || barTime > 2e10; // crude but ok
  const diff = Math.max(0, latestTime - barTime);
  const diffDays = msMode ? diff / 86400000 : diff / 86400;
  return diffDays / 7;
}

function roundPriceToBucket(price, size) {
  if (!isFinite(price) || !isFinite(size) || size <= 0) return price;
  return Math.round(price / size) * size;
}

// ---- Candidate generation per timeframe ----

function buildCandidatesForTF(tf, bars, latestTime) {
  if (!Array.isArray(bars) || bars.length < 50) return [];

  const tfWeight = TF_WEIGHTS[tf] || 1.0;
  const atr = computeATR(bars, 50);
  if (!atr || atr <= 0) return [];

  const candidates = [];

  // 1) Wick-based candidates
  const wickMin = WICK_MIN_ATR_MULT * atr;
  const wickMax = WICK_MAX_ATR_MULT * atr;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (!isFiniteBar(b)) continue;

    const bodyHigh = Math.max(b.open, b.close);
    const bodyLow = Math.min(b.open, b.close);
    let upperWick = b.high - bodyHigh;
    let lowerWick = bodyLow - b.low;

    // upper wick
    if (upperWick > wickMin) {
      upperWick = Math.min(upperWick, wickMax);
      const score = (upperWick / atr) * tfWeight;
      const ageWeeks = computeAgeWeeks(latestTime, b.time);
      candidates.push({
        price: b.high,
        tf,
        wickScore: score,
        consScore: 0,
        reactionScore: 0,
        ageWeeks,
        upperWicks: 1,
        lowerWicks: 0,
      });
    }

    // lower wick
    if (-lowerWick > wickMin) {
      lowerWick = Math.max(lowerWick, -wickMax);
      const score = (Math.abs(lowerWick) / atr) * tfWeight;
      const ageWeeks = computeAgeWeeks(latestTime, b.time);
      candidates.push({
        price: b.low,
        tf,
        wickScore: score,
        consScore: 0,
        reactionScore: 0,
        ageWeeks,
        upperWicks: 0,
        lowerWicks: 1,
      });
    }
  }

  // 2) Consolidation / shelf candidates
  const [minWin, maxWin] =
    tf === "30m" ? [8, 20] :
    tf === "1h"  ? [5, 12] :
                   [4, 8]; // 4h

  const n = bars.length;
  for (let win = minWin; win <= maxWin; win += Math.max(1, Math.floor((maxWin - minWin) / 3))) {
    if (n < win) continue;
    for (let i = win - 1; i < n; i++) {
      const slice = bars.slice(i - win + 1, i + 1);
      const highs = slice.map(b => b.high);
      const lows  = slice.map(b => b.low);
      const bandHigh = Math.max(...highs);
      const bandLow  = Math.min(...lows);
      let width = bandHigh - bandLow;
      if (width <= 0) continue;

      if (width > MAX_RANGE_POINTS) width = MAX_RANGE_POINTS;

      const isShelfWidth         = width >= SHELF_MIN_WIDTH && width <= SHELF_MAX_WIDTH;
      const isInstitutionalWidth = width > SHELF_MAX_WIDTH && width <= MAX_ZONE_WIDTH;
      if (!isShelfWidth && !isInstitutionalWidth) continue;

      const mid = (bandHigh + bandLow) / 2;
      const ageWeeks = computeAgeWeeks(latestTime, slice[slice.length - 1].time);

      // smaller width = higher cons score for shelves
      let consBase = isShelfWidth
        ? (SHELF_SWEET_MAX / width)   // 1–2.5pts → strong shelves
        : (width / MAX_ZONE_WIDTH);   // 2–5pts → institutional

      if (consBase < 0) consBase = 0;

      const consScore = consBase * tfWeight;
      candidates.push({
        price: mid,
        tf,
        wickScore: 0,
        consScore,
        reactionScore: 0,
        ageWeeks,
        upperWicks: 0,
        lowerWicks: 0,
      });
    }
  }

  // 3) Reaction-based candidates (wick + cons at same bucket)
  const map = new Map();
  for (const c of candidates) {
    const key = roundPriceToBucket(c.price, BUCKET_SIZE);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(c);
  }

  for (const [bucketPrice, arr] of map.entries()) {
    let consSum = 0;
    let wickSum = 0;
    for (const c of arr) {
      consSum += c.consScore;
      wickSum += c.wickScore;
    }
    if (consSum > 0 && wickSum > 0) {
      const bonus = Math.min(consSum, wickSum) * 0.5;
      const ageWeeksAvg =
        arr.reduce((s, c) => s + c.ageWeeks, 0) / arr.length;
      candidates.push({
        price: bucketPrice,
        tf,
        wickScore: 0,
        consScore: 0,
        reactionScore: bonus,
        ageWeeks: ageWeeksAvg,
        upperWicks: 0,
        lowerWicks: 0,
      });
    }
  }

  return candidates;
}

// ---- Bucketize, cluster, zone-building ----

function bucketizeCandidates(candidates) {
  const bucketsMap = new Map();

  for (const c of candidates) {
    const bucketPrice = roundPriceToBucket(c.price, BUCKET_SIZE);
    const tfWeight = TF_WEIGHTS[c.tf] || 1.0;
    const decay = Math.pow(RECENCY_DECAY_PER_WEEK, c.ageWeeks || 0);

    const baseScore = (c.wickScore + c.consScore + c.reactionScore) * decay;
    if (baseScore <= 0) continue;

    if (!bucketsMap.has(bucketPrice)) {
      bucketsMap.set(bucketPrice, {
        price: bucketPrice,
        score: 0,
        touches: 0,
        upperWicks: 0,
        lowerWicks: 0,
        tfWeightScore: 0,
      });
    }

    const b = bucketsMap.get(bucketPrice);
    b.score += baseScore;
    b.touches += 1;
    b.upperWicks += c.upperWicks || 0;
    b.lowerWicks += c.lowerWicks || 0;
    b.tfWeightScore += tfWeight;
  }

  return Array.from(bucketsMap.values()).sort((a, b) => a.price - b.price);
}

function clusterBuckets(buckets) {
  if (!buckets.length) return [];
  const clusters = [];
  let current = {
    buckets: [],
    minPrice: buckets[0].price,
    maxPrice: buckets[0].price,
    rawScore: 0,
    upperWicks: 0,
    lowerWicks: 0,
  };

  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    if (!current.buckets.length) {
      current.buckets.push(b);
      current.minPrice = b.price;
      current.maxPrice = b.price;
      current.rawScore = b.score;
      current.upperWicks = b.upperWicks;
      current.lowerWicks = b.lowerWicks;
      continue;
    }

    const prev = current.buckets[current.buckets.length - 1];
    const gap = Math.abs(b.price - prev.price);

    if (gap <= CLUSTER_GAP) {
      current.buckets.push(b);
      current.minPrice = Math.min(current.minPrice, b.price);
      current.maxPrice = Math.max(current.maxPrice, b.price);
      current.rawScore += b.score;
      current.upperWicks += b.upperWicks;
      current.lowerWicks += b.lowerWicks;
    } else {
      clusters.push(current);
      current = {
        buckets: [b],
        minPrice: b.price,
        maxPrice: b.price,
        rawScore: b.score,
        upperWicks: b.upperWicks,
        lowerWicks: b.lowerWicks,
      };
    }
  }

  if (current.buckets.length) clusters.push(current);
  return clusters;
}

function buildZonesFromClusters(clusters) {
  const zones = [];

  for (const cl of clusters) {
    const span = cl.maxPrice - cl.minPrice;
    if (span <= 0) continue;

    const numSubZones =
      span > MAX_ZONE_WIDTH ? Math.ceil(span / MAX_ZONE_WIDTH) : 1;

    const step = span / numSubZones;

    for (let i = 0; i < numSubZones; i++) {
      const bandLow =
        cl.minPrice + i * step;
      const bandHigh =
        i === numSubZones - 1 ? cl.maxPrice : cl.minPrice + (i + 1) * step;

      const width = bandHigh - bandLow;
      if (width <= 0) continue;

      const center = (bandHigh + bandLow) / 2;
      const widthFactor = Math.max(0.2, 1 - width / (MAX_ZONE_WIDTH * 2));

      const wickTotal = cl.upperWicks + cl.lowerWicks || 1;
      const wickBias = (cl.upperWicks - cl.lowerWicks) / wickTotal; // -1..+1

      let type;
      if (width >= SHELF_MIN_WIDTH && width <= SHELF_MAX_WIDTH) {
        // shelves
        if (wickBias > 0.1) type = "distribution";
        else if (wickBias < -0.1) type = "accumulation";
        else type = "accumulation";
      } else if (width > SHELF_MAX_WIDTH && width <= MAX_ZONE_WIDTH) {
        type = "institutional";
      } else if (width < SHELF_MIN_WIDTH) {
        // edges → thin acc/dist lines
        type = wickBias > 0 ? "distribution" : "accumulation";
      } else {
        // ultra wide: still institutional, but already split
        type = "institutional";
      }

      const baseScore = (cl.rawScore / numSubZones) * widthFactor;

      zones.push({
        type,
        price: center,
        priceRange: [bandHigh, bandLow],
        strength: baseScore, // temporary, normalized later
      });
    }
  }

  return zones;
}

function normalizeStrengthAndFilter(zones) {
  if (!zones.length) return [];

  const maxRaw = zones.reduce(
    (m, z) => (z.strength > m ? z.strength : m),
    0
  );
  if (maxRaw <= 0) return [];

  // Normalize to 40–100
  for (const z of zones) {
    const norm = (z.strength / maxRaw) * 60; // 0–60
    z.strength = Math.round(40 + norm);      // 40–100
  }

  zones.sort((a, b) => b.strength - a.strength);

  const institutional = zones.filter(z => z.type === "institutional");
  const nonInst = zones.filter(z => z.type !== "institutional");

  const final = [];

  // top institutional
  final.push(...institutional.slice(0, MAX_INSTITUTIONAL_ZONES));

  const shelves = [];
  const edges = [];

  for (const z of nonInst) {
    const width = z.priceRange[0] - z.priceRange[1];
    if (width <= 0) continue;
    if (width <= MIN_ZONE_WIDTH * 1.2) edges.push(z);
    else shelves.push(z);
  }

  shelves.sort((a, b) => b.strength - a.strength);
  edges.sort((a, b) => b.strength - a.strength);

  final.push(...shelves.slice(0, MAX_SHELVES));
  final.push(...edges.slice(0, MAX_EDGES));

  // de-dupe similar bands
  const uniq = [];
  for (const z of final) {
    const key = `${Math.round(z.price * 10) / 10}-${z.type}`;
    if (uniq.find(u => `${Math.round(u.price * 10) / 10}-${u.type}` === key)) {
      continue;
    }
    uniq.push(z);
  }

  uniq.sort((a, b) => b.strength - a.strength);
  return uniq;
}

// ---- PUBLIC ENTRY ----

export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  try {
    if (!Array.isArray(bars30m) || !Array.isArray(bars1h) || !Array.isArray(bars4h)) {
      console.warn("[SMZ] computeSmartMoneyLevels: invalid inputs");
      return [];
    }

    const latestTime = Math.max(
      bars30m.length ? bars30m[bars30m.length - 1].time : 0,
      bars1h.length  ? bars1h[bars1h.length - 1].time  : 0,
      bars4h.length  ? bars4h[bars4h.length - 1].time  : 0
    );

    const candidates = [
      ...buildCandidatesForTF("30m", bars30m, latestTime),
      ...buildCandidatesForTF("1h",  bars1h,  latestTime),
      ...buildCandidatesForTF("4h",  bars4h,  latestTime),
    ];

    if (!candidates.length) {
      console.log("[SMZ] No candidates generated");
      return [];
    }

    const buckets  = bucketizeCandidates(candidates);
    if (!buckets.length) {
      console.log("[SMZ] No buckets after aggregation");
      return [];
    }

    const clusters = clusterBuckets(buckets);
    if (!clusters.length) {
      console.log("[SMZ] No clusters formed");
      return [];
    }

    let zones = buildZonesFromClusters(clusters);
    if (!zones.length) {
      console.log("[SMZ] No zones from clusters");
      return [];
    }

    zones = normalizeStrengthAndFilter(zones);

    console.log(
      `[SMZ] Final zones: ${zones.length}. ` +
      `Inst=${zones.filter(z => z.type === "institutional").length}, ` +
      `Acc=${zones.filter(z => z.type === "accumulation").length}, ` +
      `Dist=${zones.filter(z => z.type === "distribution").length}`
    );

    return zones;
  } catch (err) {
    console.error("[SMZ] Error in computeSmartMoneyLevels:", err);
    return [];
  }
}
