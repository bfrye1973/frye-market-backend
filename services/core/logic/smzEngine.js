/**
 * Institutional Zone Engine — Score-Based (Diagnostic + Production)
 * ---------------------------------------------------------------
 * Goals:
 * 1) SCORING FIRST, classification second
 * 2) Diagnostic Mode shows everything above scoreFloor with full breakdown
 * 3) Production Mode applies strict gating AFTER scoring (4H agreement, distance, etc.)
 *
 * IMPORTANT:
 * - This file exports TWO functions:
 *   1) computeZones(...) -> { zones, meta }  (generic engine)
 *   2) computeSmartMoneyLevels(bars30m,bars1h,bars4h) -> Array (job-compatible)
 *
 * The job runner expects computeSmartMoneyLevels and expects an ARRAY return.
 */

// ----------------------------
// Defaults
// ----------------------------

const DEFAULT_CONFIG = {
  mode: "diagnostic",                 // "diagnostic" or "production"

  diagnosticScoreFloor: 70,           // include zones >= 70 (diagnostic)
  productionScoreFloor: 85,           // include zones >= 85 (production)

  RECENCY_DECAY_PER_WEEK: 0.98,

  maxDistancePctDiagnostic: 0.08,     // 8% soft penalty; not a gate
  maxDistancePctProduction: 0.03,     // 3% hard gate

  lookbackBars: 420,
  bucketAtrMult: 0.60,
  minTouches: 3,

  weights: {
    touches: 0.30,
    volumeAnomaly: 0.25,
    wickRejection: 0.20,
    holdDuration: 0.15,
    retestStrength: 0.10,
  },

  productionGates: {
    requireCompression: true,
    requireRejection: true,
    requireRetest: true,
    require4hAgreement: true,
  },

  scoreOnlyIfCompression: false,

  merge: {
    enabledDiagnostic: false,
    enabledProduction: true,
    overlapPct: 0.55,
  },
};

// ----------------------------
// Public API (generic engine)
// ----------------------------

export function computeZones({
  candles,
  tf,
  currentPrice,
  nowUtc = new Date().toISOString(),
  zones4h = [],
  config = {},
}) {
  const cfg = deepMerge(DEFAULT_CONFIG, config);

  const safeCandles = Array.isArray(candles) ? candles.slice() : [];
  if (safeCandles.length < 50 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
    return {
      zones: [],
      meta: {
        tf,
        mode: cfg.mode,
        reason: "Not enough candles or invalid currentPrice",
        candleCount: safeCandles.length,
        currentPrice,
      },
    };
  }

  const now = typeof nowUtc === "string" ? new Date(nowUtc) : nowUtc;

  // 1) Candidate buckets
  const atr = computeATR(safeCandles, 14);
  const bucketSize = Math.max(atr * cfg.bucketAtrMult, 0.01);

  const candidates = buildBucketCandidates(safeCandles, {
    tf,
    bucketSize,
    minTouches: cfg.minTouches,
    lookbackBars: cfg.lookbackBars,
  });

  // 2) Score FIRST
  const scored = candidates
    .map((z) => scoreZone(z, safeCandles, { tf, now, currentPrice, atr, cfg }))
    .filter(Boolean);

  // 3) Apply penalties (still scoring phase)
  const penalized = scored.map((z) => applyPenalties(z, { now, currentPrice, cfg }));

  // 4) Sort by score descending
  penalized.sort((a, b) => b.score - a.score);

  // 5) Mode-specific inclusion & gating
  const mode = (cfg.mode || "diagnostic").toLowerCase();
  const isDiagnostic = mode === "diagnostic";

  const distanceLimitPct = isDiagnostic ? cfg.maxDistancePctDiagnostic : cfg.maxDistancePctProduction;
  const scoreFloor = isDiagnostic ? cfg.diagnosticScoreFloor : cfg.productionScoreFloor;

  let included = penalized.filter((z) => z.score >= scoreFloor);

  // Distance is a hard gate only in production
  if (!isDiagnostic) {
    included = included.filter((z) => z.meta.distancePct <= distanceLimitPct);
  } else {
    included = included.map((z) => ({
      ...z,
      flags: { ...(z.flags || {}), distanceOutOfRange: z.meta.distancePct > distanceLimitPct },
    }));
  }

  // Production gates AFTER scoring
  if (!isDiagnostic) {
    included = included.filter((z) =>
      passesProductionGates(z, safeCandles, { cfg, zones4h, currentPrice })
    );
  }

  // 6) Optional merging
  const mergeEnabled = isDiagnostic ? cfg.merge.enabledDiagnostic : cfg.merge.enabledProduction;
  const finalZones = mergeEnabled
    ? mergeOverlappingZones(included, { overlapPct: cfg.merge.overlapPct })
    : included;

  // 7) Label AFTER scoring
  const labeled = finalZones.map((z) => ({
    ...z,
    grade: classifyZone(z.score),
  }));

  return {
    zones: labeled,
    meta: {
      tf,
      mode: cfg.mode,
      candleCount: safeCandles.length,
      candidateCount: candidates.length,
      scoredCount: scored.length,
      includedCount: included.length,
      finalCount: labeled.length,
      scoreFloor,
      distanceLimitPct,
      atr,
      bucketSize,
      mergeEnabled,
    },
  };
}

// ----------------------------
// Job-compatible export
// ----------------------------
// The job expects: computeSmartMoneyLevels(bars30m,bars1h,bars4h) -> ARRAY
// We run computeZones on 4h (primary) and optionally 1h (support), then merge.

export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  const b30 = normalizeBars(bars30m);
  const b1h = normalizeBars(bars1h);
  const b4h = normalizeBars(bars4h);

  const currentPrice =
    (b30.length ? b30[b30.length - 1].close : null) ??
    (b1h.length ? b1h[b1h.length - 1].close : null) ??
    (b4h.length ? b4h[b4h.length - 1].close : null) ??
    0;

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return [];

  // First: compute 4H zones (diagnostic by default)
  const res4h = computeZones({
    candles: b4h,
    tf: "4h",
    currentPrice,
    zones4h: [],
    config: { mode: "diagnostic" }, // scoring-first diagnostic
  });

  // Optional: compute 1H zones too, then merge with 4H for more visibility
  const res1h = computeZones({
    candles: b1h,
    tf: "1h",
    currentPrice,
    zones4h: res4h.zones || [],
    config: { mode: "diagnostic" },
  });

  const merged = mergeZoneLists([...(res4h.zones || []), ...(res1h.zones || [])]);

  // Convert to the API format expected by frontend overlay:
  // { type:"institutional", price, priceRange:[hi,lo], strength, details:{...} }
  // In diagnostic mode, we still return "institutional" for this endpoint,
  // because smz-levels is the institutional overlay.
  return merged.map((z) => ({
    type: "institutional",
    price: round2((z.price_low + z.price_high) / 2),
    priceRange: [round2(z.price_high), round2(z.price_low)],
    strength: Math.round(z.score), // keep true 0–100 score in diagnostic
    details: {
      scoreTotal: z.score,
      breakdown: z.score_breakdown,
      meta: z.meta,
      flags: z.flags,
      grade: z.grade,
      tf: z.tf,
      id: z.id,
    },
  }));
}

// ----------------------------
// Candidate Building (Buckets)
// ----------------------------

function buildBucketCandidates(candles, { tf, bucketSize, minTouches, lookbackBars }) {
  const slice = candles.slice(Math.max(0, candles.length - lookbackBars));
  const lows = slice.map((c) => c.low);
  const highs = slice.map((c) => c.high);
  const minPrice = Math.min(...lows);

  const buckets = new Map();

  const bucketKey = (price) => Math.floor((price - minPrice) / bucketSize);

  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const mid = (c.high + c.low) / 2;
    const k = bucketKey(mid);

    const b = buckets.get(k) || {
      tf,
      low: minPrice + k * bucketSize,
      high: minPrice + (k + 1) * bucketSize,
      touches: 0,
      volumeSum: 0,
      wickHits: 0,
      bodyHits: 0,
      firstTouchIndex: null,
      lastTouchIndex: null,
      touchIndices: [],
    };

    const intersects = c.high >= b.low && c.low <= b.high;
    if (intersects) {
      b.touches += 1;
      b.volumeSum += c.volume || 0;
      b.firstTouchIndex = b.firstTouchIndex === null ? i : b.firstTouchIndex;
      b.lastTouchIndex = i;
      b.touchIndices.push(i);

      const bodyHigh = Math.max(c.open, c.close);
      const bodyLow = Math.min(c.open, c.close);
      const bodyIntersects = bodyHigh >= b.low && bodyLow <= b.high;
      if (bodyIntersects) b.bodyHits += 1;
      else b.wickHits += 1;
    }

    buckets.set(k, b);
  }

  const candidates = [];
  for (const b of buckets.values()) {
    if (b.touches >= minTouches) {
      candidates.push({
        id: `smz_${tf}_${b.low.toFixed(2)}_${b.high.toFixed(2)}`,
        tf,
        price_low: round2(b.low),
        price_high: round2(b.high),
        raw: b,
      });
    }
  }

  return candidates;
}

// ----------------------------
// Scoring
// ----------------------------

function scoreZone(zone, candles, { tf, now, currentPrice, atr, cfg }) {
  const r = zone.raw;

  if (cfg.scoreOnlyIfCompression && !detectCompressionNearZone(zone, candles)) {
    return null;
  }

  const touchesScore = scoreTouches(r.touches);
  const volScore = scoreVolumeAnomaly(r, candles);
  const wickScore = scoreWickRejection(r.wickHits, r.bodyHits);
  const holdScore = scoreHoldDuration(r.firstTouchIndex, r.lastTouchIndex);
  const retestScore = scoreRetestStrength(r.touchIndices);

  const breakdown = {
    touches: touchesScore,
    volumeAnomaly: volScore,
    wickRejection: wickScore,
    holdDuration: holdScore,
    retestStrength: retestScore,
  };

  const weighted =
    breakdown.touches * cfg.weights.touches +
    breakdown.volumeAnomaly * cfg.weights.volumeAnomaly +
    breakdown.wickRejection * cfg.weights.wickRejection +
    breakdown.holdDuration * cfg.weights.holdDuration +
    breakdown.retestStrength * cfg.weights.retestStrength;

  const weightSum =
    cfg.weights.touches +
    cfg.weights.volumeAnomaly +
    cfg.weights.wickRejection +
    cfg.weights.holdDuration +
    cfg.weights.retestStrength;

  const baseScore = clamp((weighted / weightSum) * 100, 0, 100);

  const mid = (zone.price_low + zone.price_high) / 2;
  const distancePct = Math.abs(mid - currentPrice) / Math.max(currentPrice, 0.0001);

  const lastIdx = r.lastTouchIndex ?? (candles.length - 1);
  const lastCandle = candles[lastIdx] || candles[candles.length - 1];
  const lastTestUtc = lastCandle?.time ?? lastCandle?.t ?? null;

  return {
    id: zone.id,
    tf: zone.tf,
    price_low: zone.price_low,
    price_high: zone.price_high,
    score: round2(baseScore),
    score_breakdown: objectRound2(breakdown),
    meta: {
      touches: r.touches,
      wickHits: r.wickHits,
      bodyHits: r.bodyHits,
      avgVolumeMultiple: estimateAvgVolumeMultiple(r, candles),
      barsHeld: (r.lastTouchIndex ?? 0) - (r.firstTouchIndex ?? 0),
      distancePct: round4(distancePct),
      last_test_utc: lastTestUtc,
    },
    flags: {},
  };
}

function applyPenalties(zone, { now, currentPrice, cfg }) {
  let score = zone.score;

  const weeksOld = estimateWeeksOld(zone.meta.last_test_utc, now);
  const recencyDecay = Math.pow(cfg.RECENCY_DECAY_PER_WEEK, weeksOld);
  score *= recencyDecay;

  // Soft distance penalty in diagnostic (never hard gate here)
  const softLimit = cfg.maxDistancePctDiagnostic * 0.5;
  const d = zone.meta.distancePct;
  const distancePenalty =
    d <= softLimit ? 1 : clamp(1 - (d - softLimit) / (cfg.maxDistancePctDiagnostic - softLimit), 0.50, 1);
  score *= distancePenalty;

  return {
    ...zone,
    score: round2(clamp(score, 0, 100)),
    meta: {
      ...zone.meta,
      weeksOld: round2(weeksOld),
      recencyDecay: round4(recencyDecay),
      distancePenalty: round4(distancePenalty),
    },
  };
}

// ----------------------------
// Production Gates (strict AFTER scoring)
// ----------------------------

function passesProductionGates(zone, candles, { cfg, zones4h }) {
  const gates = cfg.productionGates || {};

  if (gates.requireCompression && !detectCompressionNearZone(zone, candles)) return false;
  if (gates.requireRejection && !detectRejection(zone, candles)) return false;
  if (gates.requireRetest && !detectRetest(zone, candles)) return false;
  if (gates.require4hAgreement && !has4hAgreement(zone, zones4h)) return false;

  return true;
}

// ----------------------------
// Conservative detectors (production only)
// ----------------------------

function detectCompressionNearZone(_zone, candles) {
  const n = 30;
  const slice = candles.slice(-n);
  if (slice.length < n) return true;
  const maxH = Math.max(...slice.map((c) => c.high));
  const minL = Math.min(...slice.map((c) => c.low));
  const range = maxH - minL;
  const price = (slice[slice.length - 1]?.close ?? 0) || 1;
  const pct = range / Math.max(price, 0.0001);
  return pct <= 0.02;
}

function detectRejection(zone, candles) {
  const n = 80;
  const slice = candles.slice(-n);
  let rej = 0;

  for (const c of slice) {
    const inZone = c.high >= zone.price_low && c.low <= zone.price_high;
    if (!inZone) continue;

    const bodyHigh = Math.max(c.open, c.close);
    const bodyLow = Math.min(c.open, c.close);
    const bodyInZone = bodyHigh >= zone.price_low && bodyLow <= zone.price_high;

    if (!bodyInZone) rej += 1;
  }
  return rej >= 3;
}

function detectRetest(zone, candles) {
  const n = 240;
  const slice = candles.slice(-n);
  const touchIdx = [];

  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const hit = c.high >= zone.price_low && c.low <= zone.price_high;
    if (hit) touchIdx.push(i);
  }
  if (touchIdx.length < 3) return false;

  let clusters = 1;
  for (let i = 1; i < touchIdx.length; i++) {
    if (touchIdx[i] - touchIdx[i - 1] >= 10) clusters += 1;
  }
  return clusters >= 2;
}

function has4hAgreement(zone, zones4h) {
  if (!Array.isArray(zones4h) || zones4h.length === 0) return false;

  for (const z4 of zones4h) {
    const score = typeof z4.score === "number" ? z4.score : (z4?.details?.scoreTotal ?? 0);
    if (score < 80) continue;

    const a = { low: zone.price_low, high: zone.price_high };
    const b = {
      low: z4.price_low ?? z4.min ?? z4.low ?? z4.priceRange?.[1],
      high: z4.price_high ?? z4.max ?? z4.high ?? z4.priceRange?.[0],
    };
    const ov = overlapPct(a, b);
    if (ov >= 0.35) return true;
  }
  return false;
}

// ----------------------------
// Merging
// ----------------------------

function mergeOverlappingZones(zones, { overlapPct: threshold }) {
  const sorted = zones.slice().sort((a, b) => a.price_low - b.price_low);
  const out = [];

  for (const z of sorted) {
    if (!out.length) {
      out.push(z);
      continue;
    }
    const last = out[out.length - 1];

    const ov = overlapPct(
      { low: last.price_low, high: last.price_high },
      { low: z.price_low, high: z.price_high }
    );

    if (ov >= threshold) {
      const mergedLow = Math.min(last.price_low, z.price_low);
      const mergedHigh = Math.max(last.price_high, z.price_high);
      const winner = last.score >= z.score ? last : z;
      out[out.length - 1] = {
        ...winner,
        price_low: round2(mergedLow),
        price_high: round2(mergedHigh),
        flags: { ...(winner.flags || {}), merged: true },
      };
    } else {
      out.push(z);
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

// ----------------------------
// Classification (after scoring)
// ----------------------------

function classifyZone(score) {
  if (score >= 90) return "Institutional Core";
  if (score >= 80) return "Strong Shelf";
  if (score >= 70) return "Valid Shelf";
  if (score >= 60) return "Forming Shelf";
  return "Noise";
}

// ----------------------------
// Component scoring helpers (0..1)
// ----------------------------

function scoreTouches(touches) {
  if (touches <= 2) return 0.0;
  if (touches >= 12) return 1.0;
  return (touches - 2) / 10;
}

function scoreVolumeAnomaly(rawBucket, candles) {
  const vols = candles.map((c) => c.volume || 0).filter((v) => v > 0);
  if (vols.length < 20) return 0.5;

  const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
  const perTouch = rawBucket.touches > 0 ? rawBucket.volumeSum / rawBucket.touches : 0;
  const mult = avg > 0 ? perTouch / avg : 1;

  if (mult <= 1.0) return 0.3;
  if (mult >= 2.5) return 1.0;
  return 0.3 + (mult - 1.0) * (0.7 / 1.5);
}

function scoreWickRejection(wickHits, bodyHits) {
  const total = wickHits + bodyHits;
  if (total <= 0) return 0.3;
  const wickRatio = wickHits / total;
  return clamp((wickRatio - 0.2) / 0.6, 0.0, 1.0);
}

function scoreHoldDuration(firstIdx, lastIdx) {
  if (firstIdx == null || lastIdx == null) return 0.3;
  const bars = Math.max(0, lastIdx - firstIdx);
  if (bars <= 10) return 0.2;
  if (bars >= 200) return 1.0;
  return 0.2 + (bars - 10) * (0.8 / 190);
}

function scoreRetestStrength(touchIndices) {
  if (!Array.isArray(touchIndices) || touchIndices.length < 3) return 0.2;
  let gaps = 0;
  for (let i = 1; i < touchIndices.length; i++) {
    if (touchIndices[i] - touchIndices[i - 1] >= 8) gaps += 1;
  }
  if (gaps <= 0) return 0.3;
  if (gaps >= 2) return 1.0;
  return 0.65;
}

// ----------------------------
// ATR
// ----------------------------

function computeATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 2) return 1;

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    trs.push(tr);
  }

  const slice = trs.slice(-period);
  const atr = slice.reduce((a, b) => a + b, 0) / slice.length;
  return atr > 0 ? atr : 1;
}

// ----------------------------
// Misc utilities
// ----------------------------

function overlapPct(a, b) {
  const lo = Math.max(a.low, b.low);
  const hi = Math.min(a.high, b.high);
  const inter = hi - lo;
  if (inter <= 0) return 0;

  const aLen = a.high - a.low;
  const bLen = b.high - b.low;
  const denom = Math.min(aLen, bLen);
  return denom > 0 ? inter / denom : 0;
}

function estimateWeeksOld(lastTestUtc, now) {
  if (!lastTestUtc) return 0;
  const t = new Date(lastTestUtc);
  if (isNaN(t.getTime())) return 0;
  const ms = now.getTime() - t.getTime();
  if (ms <= 0) return 0;
  return ms / (1000 * 60 * 60 * 24 * 7);
}

function estimateAvgVolumeMultiple(rawBucket, candles) {
  const vols = candles.map((c) => c.volume || 0).filter((v) => v > 0);
  if (vols.length < 20) return 1;
  const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
  const perTouch = rawBucket.touches > 0 ? rawBucket.volumeSum / rawBucket.touches : 0;
  const mult = avg > 0 ? perTouch / avg : 1;
  return round2(mult);
}

function deepMerge(base, override) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(override || {})) {
    const v = override[k];
    if (v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object") {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function normalizeBars(arr) {
  const a = Array.isArray(arr) ? arr : [];
  return a
    .map((b) => ({
      time: b.time > 1e12 ? Math.floor(b.time / 1000) : b.time,
      open: Number(b.open ?? b.o ?? 0),
      high: Number(b.high ?? b.h ?? 0),
      low: Number(b.low ?? b.l ?? 0),
      close: Number(b.close ?? b.c ?? 0),
      volume: Number(b.volume ?? b.v ?? 0),
    }))
    .filter(isFiniteBar)
    .sort((x, y) => x.time - y.time);
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}
function round2(x) {
  return Math.round(x * 100) / 100;
}
function round4(x) {
  return Math.round(x * 10000) / 10000;
}
function objectRound2(obj) {
  const out = {};
  for (const k of Object.keys(obj)) out[k] = round2(obj[k]);
  return out;
}

// Merge zones from multiple TFs by overlap, keeping highest score
function mergeZoneLists(zones) {
  const list = (zones || []).slice().sort((a, b) => a.price_low - b.price_low);
  const out = [];

  for (const z of list) {
    if (!out.length) {
      out.push(z);
      continue;
    }
    const last = out[out.length - 1];
    const ov = overlapPct(
      { low: last.price_low, high: last.price_high },
      { low: z.price_low, high: z.price_high }
    );
    if (ov >= 0.35) {
      const mergedLow = Math.min(last.price_low, z.price_low);
      const mergedHigh = Math.max(last.price_high, z.price_high);
      const winner = last.score >= z.score ? last : z;
      out[out.length - 1] = {
        ...winner,
        price_low: round2(mergedLow),
        price_high: round2(mergedHigh),
        score: Math.max(last.score, z.score),
        flags: { ...(winner.flags || {}), mergedTf: true },
      };
    } else {
      out.push(z);
    }
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 25);
}
