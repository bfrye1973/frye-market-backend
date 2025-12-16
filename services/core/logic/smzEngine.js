/**
 * Institutional Zone Engine — Score-Based (Diagnostic + Production)
 * ---------------------------------------------------------------
 * Goals:
 * 1) SCORING FIRST, classification second (fixes "we missed obvious zone" problem)
 * 2) Diagnostic Mode shows everything above scoreFloor with full breakdown
 * 3) Production Mode applies strict gating AFTER scoring (4H agreement, distance, etc.)
 *
 * Inputs are intentionally generic: candles per timeframe, current price, and optional 4H zones.
 *
 * Author: Frye Dashboard teammate (SMZ / Institutional Zones)
 */

// ----------------------------
// Defaults
// ----------------------------

const DEFAULT_CONFIG = {
  // Mode: "diagnostic" or "production"
  mode: "diagnostic",

  // Score floor for inclusion (diagnostic)
  scoreFloor: 70,

  // If you want to see even more (forming shelves), set to 60
  diagnosticScoreFloor: 70,

  // Production score cutoff (strict)
  productionScoreFloor: 85,

  // Recency decay — keep your value
  RECENCY_DECAY_PER_WEEK: 0.98,

  // Distance relevance filter (percent from current price)
  // Diagnostic should usually be looser; production tighter.
  maxDistancePctDiagnostic: 0.08, // 8%
  maxDistancePctProduction: 0.03, // 3%

  // Candidate generation
  lookbackBars: 420, // ~ 3 months on 1h-ish; tune per TF
  pivotLeft: 3,
  pivotRight: 3,

  // Bucketization (building raw shelves)
  bucketAtrMult: 0.60, // bucket height = ATR * mult
  minTouches: 3,

  // Scoring weights (sum does NOT need to be 100; we normalize at end)
  weights: {
    touches: 0.30,
    volumeAnomaly: 0.25,
    wickRejection: 0.20,
    holdDuration: 0.15,
    retestStrength: 0.10,
  },

  // Production-only strict institutional requirements (applied AFTER scoring)
  productionGates: {
    requireCompression: true,
    requireRejection: true,
    requireRetest: true,
    require4hAgreement: true, // key gate that can hide zones in production
  },

  // Optional: require "compression" as a precondition to even *score* (DO NOT do this in diagnostic)
  // Keep false to ensure discovery.
  scoreOnlyIfCompression: false,

  // Merge behavior (zones that overlap get merged)
  merge: {
    enabledDiagnostic: false, // diagnostic should NOT hide by merging
    enabledProduction: true,
    overlapPct: 0.55,
  },
};

// ----------------------------
// Public API
// ----------------------------

/**
 * computeZones
 * @param {Object} params
 * @param {Array<Object>} params.candles - Array of OHLCV candles for THIS timeframe.
 * @param {string} params.tf - timeframe label ("10m","1h","4h")
 * @param {number} params.currentPrice
 * @param {string|Date} [params.nowUtc] - ISO or Date
 * @param {Array<Object>} [params.zones4h] - Optional precomputed 4H zones for agreement gate
 * @param {Object} [params.config] - overrides
 * @returns {Object} result { zones, meta }
 */
export function computeZones({
  candles,
  tf,
  currentPrice,
  nowUtc = new Date().toISOString(),
  zones4h = [],
  config = {},
}) {
  const cfg = deepMerge(DEFAULT_CONFIG, config);

  // Defensive
  const safeCandles = Array.isArray(candles) ? candles.slice() : [];
  if (safeCandles.length < 50) {
    return {
      zones: [],
      meta: {
        tf,
        mode: cfg.mode,
        reason: "Not enough candles",
        candleCount: safeCandles.length,
      },
    };
  }

  const now = typeof nowUtc === "string" ? new Date(nowUtc) : nowUtc;

  // 1) Build raw candidate zones (shelves) from price action buckets
  const atr = computeATR(safeCandles, 14);
  const bucketSize = Math.max(atr * cfg.bucketAtrMult, 0.01);

  const candidates = buildBucketCandidates(safeCandles, {
    tf,
    bucketSize,
    minTouches: cfg.minTouches,
    lookbackBars: cfg.lookbackBars,
  });

  // 2) Score FIRST (do NOT gate institutional here)
  const scored = candidates
    .map((z) => scoreZone(z, safeCandles, {
      tf,
      now,
      currentPrice,
      atr,
      cfg,
    }))
    .filter(Boolean);

  // 3) Apply recency + distance penalties (still scoring-phase, not gating)
  const penalized = scored.map((z) =>
    applyPenalties(z, { now, currentPrice, cfg })
  );

  // 4) Sort by score descending
  penalized.sort((a, b) => b.score - a.score);

  // 5) Mode-specific inclusion & gating
  const mode = (cfg.mode || "diagnostic").toLowerCase();
  const isDiagnostic = mode === "diagnostic";

  const distanceLimitPct = isDiagnostic
    ? cfg.maxDistancePctDiagnostic
    : cfg.maxDistancePctProduction;

  const scoreFloor = isDiagnostic ? cfg.diagnosticScoreFloor : cfg.productionScoreFloor;

  // Include by score floor first (score-first philosophy)
  let included = penalized.filter((z) => z.score >= scoreFloor);

  // Apply distance relevance as a GATE in production, but as an INFO flag in diagnostic
  if (!isDiagnostic) {
    included = included.filter((z) => z.meta.distancePct <= distanceLimitPct);
  } else {
    included = included.map((z) => ({
      ...z,
      flags: {
        ...(z.flags || {}),
        distanceOutOfRange: z.meta.distancePct > distanceLimitPct,
      },
    }));
  }

  // Production-only institutional gates AFTER scoring
  if (!isDiagnostic) {
    included = included.filter((z) =>
      passesProductionGates(z, safeCandles, {
        cfg,
        zones4h,
        currentPrice,
      })
    );
  }

  // 6) Optional merging (disabled in diagnostic by default)
  const mergeEnabled = isDiagnostic ? cfg.merge.enabledDiagnostic : cfg.merge.enabledProduction;
  const finalZones = mergeEnabled
    ? mergeOverlappingZones(included, { overlapPct: cfg.merge.overlapPct })
    : included;

  // 7) Final labels (classification AFTER scoring)
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
// Candidate Building (Buckets)
// ----------------------------

function buildBucketCandidates(candles, { tf, bucketSize, minTouches, lookbackBars }) {
  const slice = candles.slice(Math.max(0, candles.length - lookbackBars));
  const lows = slice.map((c) => c.low);
  const highs = slice.map((c) => c.high);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);

  const buckets = new Map(); // key -> {low, high, touches, volumeSum, wickHits, bodyHits, lastTouchIndex, firstTouchIndex}

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
      // for later scoring
      touchIndices: [],
    };

    // Touch definition: candle range intersects bucket
    const intersects = c.high >= b.low && c.low <= b.high;
    if (intersects) {
      b.touches += 1;
      b.volumeSum += (c.volume || 0);
      b.firstTouchIndex = b.firstTouchIndex === null ? i : b.firstTouchIndex;
      b.lastTouchIndex = i;
      b.touchIndices.push(i);

      // Wick vs body interaction (simple but useful)
      const bodyHigh = Math.max(c.open, c.close);
      const bodyLow = Math.min(c.open, c.close);
      const bodyIntersects = bodyHigh >= b.low && bodyLow <= b.high;
      if (bodyIntersects) b.bodyHits += 1;
      else b.wickHits += 1;
    }

    buckets.set(k, b);
  }

  // Convert to candidates with minTouches
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

  // Optional: DO NOT do this in diagnostic; keep it false.
  if (cfg.scoreOnlyIfCompression && !detectCompressionNearZone(zone, candles, atr)) {
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

  // Normalize to 0–100
  const baseScore = clamp((weighted / weightSum) * 100, 0, 100);

  // Metadata (distance, last test time, etc.)
  const mid = (zone.price_low + zone.price_high) / 2;
  const distancePct = Math.abs(mid - currentPrice) / Math.max(currentPrice, 0.0001);

  // Recency proxy: lastTouchIndex mapped to candle time
  const lastIdx = r.lastTouchIndex ?? (candles.length - 1);
  const lastCandle = candles[Math.max(0, candles.length - 1 - (candles.length - 1 - lastIdx))] || candles[candles.length - 1];
  const lastTestUtc = lastCandle?.time || lastCandle?.t || null;

  return {
    id: zone.id,
    tf: zone.tf,
    price_low: zone.price_low,
    price_high: zone.price_high,
    score: round2(baseScore),

    // classify AFTER scoring
    grade: null,

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

  // Recency decay
  const weeksOld = estimateWeeksOld(zone.meta.last_test_utc, now);
  const recencyDecay = Math.pow(cfg.RECENCY_DECAY_PER_WEEK, weeksOld);
  score *= recencyDecay;

  // Distance penalty is soft (never hard-gate in diagnostic)
  // Penalize smoothly beyond half of the diagnostic distance limit.
  const softLimit = cfg.maxDistancePctDiagnostic * 0.5;
  const d = zone.meta.distancePct;
  const distancePenalty = d <= softLimit ? 1 : clamp(1 - (d - softLimit) / (cfg.maxDistancePctDiagnostic - softLimit), 0.50, 1);
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

function passesProductionGates(zone, candles, { cfg, zones4h, currentPrice }) {
  const gates = cfg.productionGates || {};

  if (gates.requireCompression) {
    if (!detectCompressionNearZone(zone, candles, cfg)) return false;
  }

  if (gates.requireRejection) {
    if (!detectRejection(zone, candles)) return false;
  }

  if (gates.requireRetest) {
    if (!detectRetest(zone, candles)) return false;
  }

  if (gates.require4hAgreement) {
    if (!has4hAgreement(zone, zones4h)) return false;
  }

  return true;
}

// ----------------------------
// Simple detectors (intentionally conservative)
// These are gates only for PRODUCTION.
// Diagnostic DOES NOT hide zones based on these.
// ----------------------------

function detectCompressionNearZone(zone, candles, cfgOrAtr) {
  // Simple compression: recent range is tight relative to historical
  const n = 30;
  const slice = candles.slice(-n);
  if (slice.length < n) return true;

  const maxH = Math.max(...slice.map((c) => c.high));
  const minL = Math.min(...slice.map((c) => c.low));
  const range = maxH - minL;

  const price = (zone.price_low + zone.price_high) / 2;
  const pct = range / Math.max(price, 0.0001);

  // if tight < ~2.0% on intraday, consider compression
  return pct <= 0.02;
}

function detectRejection(zone, candles) {
  // Rejection: wicks hit zone and closes away from it (basic)
  const n = 80;
  const slice = candles.slice(-n);
  let rej = 0;

  for (const c of slice) {
    const inZone = c.high >= zone.price_low && c.low <= zone.price_high;
    if (!inZone) continue;

    const bodyHigh = Math.max(c.open, c.close);
    const bodyLow = Math.min(c.open, c.close);

    // "rejection" if body is mostly outside zone but wick touches
    const bodyInZone = bodyHigh >= zone.price_low && bodyLow <= zone.price_high;
    if (!bodyInZone) rej += 1;
  }

  return rej >= 3;
}

function detectRetest(zone, candles) {
  // Retest: zone touched on separate swings (gapped touch indices)
  const n = 240;
  const slice = candles.slice(-n);

  let touchIndices = [];
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const hit = c.high >= zone.price_low && c.low <= zone.price_high;
    if (hit) touchIndices.push(i);
  }

  if (touchIndices.length < 3) return false;

  // Count clusters separated by >= 10 bars as distinct retests
  let clusters = 1;
  for (let i = 1; i < touchIndices.length; i++) {
    if (touchIndices[i] - touchIndices[i - 1] >= 10) clusters += 1;
  }

  return clusters >= 2;
}

function has4hAgreement(zone, zones4h) {
  if (!Array.isArray(zones4h) || zones4h.length === 0) return false;

  // Agreement = overlap with any strong 4H zone (>= 80)
  for (const z4 of zones4h) {
    const score = typeof z4.score === "number" ? z4.score : 0;
    if (score < 80) continue;

    const overlap = overlapPct(
      { low: zone.price_low, high: zone.price_high },
      { low: z4.price_low ?? z4.min ?? z4.low, high: z4.price_high ?? z4.max ?? z4.high }
    );
    if (overlap >= 0.35) return true;
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
    if (out.length === 0) {
      out.push(z);
      continue;
    }

    const last = out[out.length - 1];
    const ov = overlapPct(
      { low: last.price_low, high: last.price_high },
      { low: z.price_low, high: z.price_high }
    );

    if (ov >= threshold) {
      // Merge: widen range, keep higher score, combine diagnostics
      const mergedLow = Math.min(last.price_low, z.price_low);
      const mergedHigh = Math.max(last.price_high, z.price_high);
      const winner = last.score >= z.score ? last : z;

      out[out.length - 1] = {
        ...winner,
        price_low: round2(mergedLow),
        price_high: round2(mergedHigh),
        flags: {
          ...(winner.flags || {}),
          merged: true,
        },
      };
    } else {
      out.push(z);
    }
  }

  // Sort by score after merge
  return out.sort((a, b) => b.score - a.score);
}

// ----------------------------
// Classification (label AFTER scoring)
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
  // 3 touches is baseline, 10+ is strong
  if (touches <= 2) return 0.0;
  if (touches >= 12) return 1.0;
  return (touches - 2) / (12 - 2);
}

function scoreVolumeAnomaly(rawBucket, candles) {
  // Compare bucket volume to avg candle volume in same lookback
  const vols = candles.map((c) => c.volume || 0).filter((v) => v > 0);
  if (vols.length < 20) return 0.5;

  const avg = vols.reduce((a, b) => a + b, 0) / vols.length;
  const perTouch = rawBucket.touches > 0 ? rawBucket.volumeSum / rawBucket.touches : 0;
  const mult = avg > 0 ? perTouch / avg : 1;

  // Map: 1.0x -> 0.3, 1.5x -> 0.6, 2.5x+ -> 1.0
  if (mult <= 1.0) return 0.3;
  if (mult >= 2.5) return 1.0;
  return 0.3 + (mult - 1.0) * (0.7 / (2.5 - 1.0));
}

function scoreWickRejection(wickHits, bodyHits) {
  // Prefer wick dominance (institutional defense)
  const total = wickHits + bodyHits;
  if (total <= 0) return 0.3;

  const wickRatio = wickHits / total; // 0..1
  // 0.3 -> 0.2, 0.6 -> 0.7, 0.8 -> 1.0
  return clamp((wickRatio - 0.2) / 0.6, 0.0, 1.0);
}

function scoreHoldDuration(firstIdx, lastIdx) {
  if (firstIdx == null || lastIdx == null) return 0.3;
  const bars = Math.max(0, lastIdx - firstIdx);

  // 0..200 bars mapping
  if (bars <= 10) return 0.2;
  if (bars >= 200) return 1.0;
  return 0.2 + (bars - 10) * (0.8 / (200 - 10));
}

function scoreRetestStrength(touchIndices) {
  if (!Array.isArray(touchIndices) || touchIndices.length < 3) return 0.2;

  // Measure how "separated" touches are; more spaced touches imply multiple sessions/swings
  let gaps = 0;
  for (let i = 1; i < touchIndices.length; i++) {
    const g = touchIndices[i] - touchIndices[i - 1];
    if (g >= 8) gaps += 1;
  }

  // 0 gaps -> 0.3, 2+ gaps -> 1.0
  if (gaps <= 0) return 0.3;
  if (gaps >= 2) return 1.0;
  return 0.3 + gaps * 0.35;
}

// ----------------------------
// ATR
// ----------------------------

function computeATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 2) return 1;

  let trs = [];
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

export const computeSmartMoneyLevels = computeZones;
