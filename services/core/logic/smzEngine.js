/**
 * Smart Money / Institutional Zone Engine
 * ---------------------------------------
 * Score-FIRST engine with Diagnostic + Production modes
 *
 * JOB CONTRACT (LOCKED):
 * export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) -> Array
 *
 * Engine rules:
 * - Detection → Scoring → Classification
 * - Diagnostic mode shows ALL zones >= scoreFloor
 * - Production applies gates AFTER scoring
 * - Time is standardized to UNIX SECONDS internally
 */

// ============================================================
// CONFIG
// ============================================================

const DEFAULT_CONFIG = {
  mode: "diagnostic", // "diagnostic" | "production"

  diagnosticScoreFloor: 70,
  productionScoreFloor: 85,

  RECENCY_DECAY_PER_WEEK: 0.98,

  maxDistancePctDiagnostic: 0.08,
  maxDistancePctProduction: 0.03,

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
};

// ============================================================
// JOB ENTRY POINT (ONLY EXPORT USED BY JOBS)
// ============================================================

export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  const b30 = normalizeBars(bars30m);
  const b1h = normalizeBars(bars1h);
  const b4h = normalizeBars(bars4h);

  const currentPrice =
    (b30.at(-1)?.close ?? null) ??
    (b1h.at(-1)?.close ?? null) ??
    (b4h.at(-1)?.close ?? null) ??
    0;

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return [];

  // --- 4H zones (authority) ---
  const zones4h = computeZones({
    candles: b4h,
    tf: "4h",
    currentPrice,
    config: { mode: "diagnostic" },
  }).zones;

  // --- 1H zones (support / discovery) ---
  const zones1h = computeZones({
    candles: b1h,
    tf: "1h",
    currentPrice,
    zones4h,
    config: { mode: "diagnostic" },
  }).zones;

  const merged = mergeZoneLists([...zones4h, ...zones1h]);

  // Frontend-safe output
  return merged.map((z) => ({
    type: "institutional",
    price: round2((z.price_low + z.price_high) / 2),
    priceRange: [round2(z.price_high), round2(z.price_low)],
    strength: Math.round(z.score),
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

// ============================================================
// CORE ENGINE
// ============================================================

function computeZones({ candles, tf, currentPrice, zones4h = [], config = {} }) {
  const cfg = deepMerge(DEFAULT_CONFIG, config);
  if (candles.length < 50) return { zones: [], meta: {} };

  const now = new Date();
  const atr = computeATR(candles, 14);
  const bucketSize = Math.max(atr * cfg.bucketAtrMult, 0.01);

  const candidates = buildBucketCandidates(candles, {
    tf,
    bucketSize,
    minTouches: cfg.minTouches,
    lookbackBars: cfg.lookbackBars,
  });

  let zones = candidates
    .map((c) => scoreZone(c, candles, { tf, currentPrice, now, atr, cfg }))
    .filter(Boolean)
    .map((z) => applyPenalties(z, now, cfg))
    .filter((z) =>
      cfg.mode === "diagnostic"
        ? z.score >= cfg.diagnosticScoreFloor
        : z.score >= cfg.productionScoreFloor
    );

  if (cfg.mode === "production") {
    zones = zones.filter((z) => passesProductionGates(z, candles, zones4h, cfg));
  }

  return {
    zones: zones.map((z) => ({ ...z, grade: classifyZone(z.score) })),
    meta: { tf, count: zones.length },
  };
}

// ============================================================
// CANDIDATES
// ============================================================

function buildBucketCandidates(candles, { tf, bucketSize, minTouches, lookbackBars }) {
  const slice = candles.slice(-lookbackBars);
  const minPrice = Math.min(...slice.map((c) => c.low));
  const buckets = new Map();

  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const mid = (c.high + c.low) / 2;
    const k = Math.floor((mid - minPrice) / bucketSize);

    const b =
      buckets.get(k) ??
      {
        tf,
        low: minPrice + k * bucketSize,
        high: minPrice + (k + 1) * bucketSize,
        touches: 0,
        volumeSum: 0,
        wickHits: 0,
        bodyHits: 0,
        firstTouch: null,
        lastTouch: null,
        touchIdx: [],
      };

    if (c.high >= b.low && c.low <= b.high) {
      b.touches++;
      b.volumeSum += c.volume;
      b.firstTouch ??= i;
      b.lastTouch = i;
      b.touchIdx.push(i);

      const bodyHigh = Math.max(c.open, c.close);
      const bodyLow = Math.min(c.open, c.close);
      bodyHigh >= b.low && bodyLow <= b.high ? b.bodyHits++ : b.wickHits++;
    }

    buckets.set(k, b);
  }

  return [...buckets.values()]
    .filter((b) => b.touches >= minTouches)
    .map((b) => ({
      id: `smz_${tf}_${b.low.toFixed(2)}_${b.high.toFixed(2)}`,
      tf,
      price_low: round2(b.low),
      price_high: round2(b.high),
      raw: b,
    }));
}

// ============================================================
// SCORING
// ============================================================

function scoreZone(zone, candles, { tf, currentPrice, now, cfg }) {
  const r = zone.raw;

  const breakdown = {
    touches: scoreTouches(r.touches),
    volumeAnomaly: scoreVolume(r, candles),
    wickRejection: scoreWick(r.wickHits, r.bodyHits),
    holdDuration: scoreHold(r.firstTouch, r.lastTouch),
    retestStrength: scoreRetest(r.touchIdx),
  };

  const weightSum = Object.values(cfg.weights).reduce((a, b) => a + b, 0);
  const weighted =
    breakdown.touches * cfg.weights.touches +
    breakdown.volumeAnomaly * cfg.weights.volumeAnomaly +
    breakdown.wickRejection * cfg.weights.wickRejection +
    breakdown.holdDuration * cfg.weights.holdDuration +
    breakdown.retestStrength * cfg.weights.retestStrength;

  const score = clamp((weighted / weightSum) * 100, 0, 100);
  const mid = (zone.price_low + zone.price_high) / 2;
  const distancePct = Math.abs(mid - currentPrice) / currentPrice;

  const lastIdx = r.lastTouch ?? candles.length - 1;
  const lastTime = candles[lastIdx]?.time ?? 0;

  return {
    ...zone,
    score: round2(score),
    score_breakdown: objectRound2(breakdown),
    meta: {
      distancePct: round4(distancePct),
      last_test_utc: lastTime,
    },
    flags: {},
  };
}

// ============================================================
// PENALTIES
// ============================================================

function applyPenalties(z, now, cfg) {
  const weeks = estimateWeeksOld(z.meta.last_test_utc, now);
  const decay = Math.pow(cfg.RECENCY_DECAY_PER_WEEK, weeks);
  return {
    ...z,
    score: round2(z.score * decay),
    meta: { ...z.meta, weeksOld: round2(weeks) },
  };
}

// ============================================================
// PRODUCTION GATES
// ============================================================

function passesProductionGates(z, candles, zones4h, cfg) {
  if (cfg.productionGates.require4hAgreement && !has4hAgreement(z, zones4h)) return false;
  return true;
}

// ============================================================
// HELPERS
// ============================================================

function normalizeBars(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((b) => ({
      time: b.time > 1e12 ? Math.floor(b.time / 1000) : Number(b.time),
      open: Number(b.open ?? b.o),
      high: Number(b.high ?? b.h),
      low: Number(b.low ?? b.l),
      close: Number(b.close ?? b.c),
      volume: Number(b.volume ?? b.v ?? 0),
    }))
    .filter(isFiniteBar)
    .sort((a, b) => a.time - b.time);
}

function isFiniteBar(b) {
  return (
    Number.isFinite(b.time) &&
    Number.isFinite(b.open) &&
    Number.isFinite(b.high) &&
    Number.isFinite(b.low) &&
    Number.isFinite(b.close)
  );
}

function estimateWeeksOld(sec, now) {
  if (!Number.isFinite(sec)) return 0;
  return (now.getTime() - sec * 1000) / (1000 * 60 * 60 * 24 * 7);
}

// ============================================================
// MISC
// ============================================================

function mergeZoneLists(zones) {
  return zones.sort((a, b) => b.score - a.score).slice(0, 25);
}

function classifyZone(score) {
  if (score >= 90) return "Institutional Core";
  if (score >= 80) return "Strong Shelf";
  if (score >= 70) return "Valid Shelf";
  if (score >= 60) return "Forming Shelf";
  return "Noise";
}

function computeATR(candles, p) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(
      Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      )
    );
  }
  return trs.slice(-p).reduce((a, b) => a + b, 0) / p || 1;
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => Math.round(x * 10000) / 10000;
const objectRound2 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)]));

function deepMerge(a, b) {
  const o = { ...a };
  for (const k in b) o[k] = typeof b[k] === "object" ? deepMerge(a[k] ?? {}, b[k]) : b[k];
  return o;
}

function scoreTouches(t) {
  return t >= 12 ? 1 : Math.max(0, (t - 2) / 10);
}
function scoreVolume(r, candles) {
  const avg = candles.reduce((s, c) => s + c.volume, 0) / candles.length;
  return clamp((r.volumeSum / r.touches) / avg, 0.3, 1);
}
function scoreWick(w, b) {
  return clamp(w / Math.max(1, w + b), 0, 1);
}
function scoreHold(a, b) {
  return clamp((b - a) / 200, 0.2, 1);
}
function scoreRetest(idx) {
  return idx.length >= 3 ? 1 : 0.3;
}
function has4hAgreement(z, z4) {
  return z4.some(
    (a) =>
      overlapPct(
        { low: z.price_low, high: z.price_high },
        { low: a.price_low, high: a.price_high }
      ) >= 0.35
  );
}
function overlapPct(a, b) {
  const lo = Math.max(a.low, b.low);
  const hi = Math.min(a.high, b.high);
  return Math.max(0, hi - lo) / Math.min(a.high - a.low, b.high - b.low);
}
