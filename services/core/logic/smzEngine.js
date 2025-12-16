/**
 * Institutional Zone Engine — Score-Based (Diagnostic + Production)
 * ---------------------------------------------------------------
 * LOCKED BEHAVIOR:
 * - SCORING FIRST, classification second
 * - Diagnostic mode shows everything ABOVE score floor
 * - HARD PRICE FILTER: zones MUST be within ±30 points of current price
 *
 * This file exports:
 * 1) computeZones(...) -> internal engine
 * 2) computeSmartMoneyLevels(bars30m,bars1h,bars4h) -> JOB ENTRY
 *
 * TIME STANDARD:
 * - All internal times = UNIX SECONDS
 * - Polygon gives ms → normalized to seconds
 */

// --------------------------------------------------
// CONFIG (LOCKED)
// --------------------------------------------------

const DEFAULT_CONFIG = {
  mode: "diagnostic",

  diagnosticScoreFloor: 30,   // lowered so we SEE shelves
  productionScoreFloor: 85,

  PRICE_WINDOW_POINTS: 30,    // HARD ±30 point relevance filter

  RECENCY_DECAY_PER_WEEK: 0.98,

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
};

// --------------------------------------------------
// JOB ENTRY POINT (ONLY THING JOB CALLS)
// --------------------------------------------------

export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  const b30 = normalizeBars(bars30m);
  const b1h = normalizeBars(bars1h);
  const b4h = normalizeBars(bars4h);

  const currentPrice =
    b30.at(-1)?.close ??
    b1h.at(-1)?.close ??
    b4h.at(-1)?.close ??
    null;

  if (!Number.isFinite(currentPrice)) return [];

  // 4H + 1H merged in diagnostic
  const z4h = computeZones({ candles: b4h, tf: "4h", currentPrice });
  const z1h = computeZones({ candles: b1h, tf: "1h", currentPrice });

  const merged = mergeZoneLists([...z4h, ...z1h]);

  return merged.map(z => ({
    type: "institutional",
    price: round2((z.price_low + z.price_high) / 2),
    priceRange: [round2(z.price_high), round2(z.price_low)],
    strength: Math.round(z.score),
    details: {
      tf: z.tf,
      score: z.score,
      breakdown: z.score_breakdown,
      meta: z.meta,
      grade: z.grade,
    }
  }));
}

// --------------------------------------------------
// CORE ENGINE
// --------------------------------------------------

function computeZones({ candles, tf, currentPrice }) {
  if (!Array.isArray(candles) || candles.length < 50) return [];

  const cfg = DEFAULT_CONFIG;
  const atr = computeATR(candles, 14);
  const bucketSize = Math.max(atr * cfg.bucketAtrMult, 0.01);

  const candidates = buildBucketCandidates(candles, {
    tf,
    bucketSize,
    minTouches: cfg.minTouches,
    lookbackBars: cfg.lookbackBars,
  });

  const scored = candidates
    .map(z => scoreZone(z, candles, currentPrice, atr))
    .filter(Boolean)

    // 🔒 HARD PRICE FILTER (THIS IS THE KEY CHANGE)
    .filter(z => {
      const mid = (z.price_low + z.price_high) / 2;
      return Math.abs(mid - currentPrice) <= cfg.PRICE_WINDOW_POINTS;
    })

    // Diagnostic score floor
    .filter(z => z.score >= cfg.diagnosticScoreFloor)

    .sort((a, b) => b.score - a.score)

    .map(z => ({
      ...z,
      grade: classifyZone(z.score),
    }));

  return scored;
}

// --------------------------------------------------
// CANDIDATE GENERATION
// --------------------------------------------------

function buildBucketCandidates(candles, { tf, bucketSize, minTouches, lookbackBars }) {
  const slice = candles.slice(-lookbackBars);
  const minPrice = Math.min(...slice.map(c => c.low));
  const buckets = new Map();

  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const mid = (c.high + c.low) / 2;
    const key = Math.floor((mid - minPrice) / bucketSize);

    const b = buckets.get(key) || {
      tf,
      low: minPrice + key * bucketSize,
      high: minPrice + (key + 1) * bucketSize,
      touches: 0,
      volumeSum: 0,
      wickHits: 0,
      bodyHits: 0,
      firstIdx: null,
      lastIdx: null,
      touchIdx: [],
    };

    if (c.high >= b.low && c.low <= b.high) {
      b.touches++;
      b.volumeSum += c.volume;
      b.firstIdx ??= i;
      b.lastIdx = i;
      b.touchIdx.push(i);

      const bodyHigh = Math.max(c.open, c.close);
      const bodyLow = Math.min(c.open, c.close);
      bodyHigh >= b.low && bodyLow <= b.high ? b.bodyHits++ : b.wickHits++;
    }

    buckets.set(key, b);
  }

  return [...buckets.values()]
    .filter(b => b.touches >= minTouches)
    .map(b => ({
      id: `smz_${tf}_${b.low.toFixed(2)}_${b.high.toFixed(2)}`,
      tf,
      price_low: round2(b.low),
      price_high: round2(b.high),
      raw: b,
    }));
}

// --------------------------------------------------
// SCORING
// --------------------------------------------------

function scoreZone(zone, candles, currentPrice, atr) {
  const r = zone.raw;

  const breakdown = {
    touches: scoreTouches(r.touches),
    volumeAnomaly: scoreVolume(r, candles),
    wickRejection: scoreWick(r.wickHits, r.bodyHits),
    holdDuration: scoreHold(r.firstIdx, r.lastIdx),
    retestStrength: scoreRetest(r.touchIdx),
  };

  const weights = DEFAULT_CONFIG.weights;
  const weighted =
    breakdown.touches * weights.touches +
    breakdown.volumeAnomaly * weights.volumeAnomaly +
    breakdown.wickRejection * weights.wickRejection +
    breakdown.holdDuration * weights.holdDuration +
    breakdown.retestStrength * weights.retestStrength;

  const score = clamp(weighted * 100, 0, 100);

  const mid = (zone.price_low + zone.price_high) / 2;
  const distPct = Math.abs(mid - currentPrice) / currentPrice;

  return {
    ...zone,
    score: round2(score),
    score_breakdown: objectRound2(breakdown),
    meta: {
      touches: r.touches,
      wickHits: r.wickHits,
      bodyHits: r.bodyHits,
      barsHeld: (r.lastIdx ?? 0) - (r.firstIdx ?? 0),
      distancePct: round4(distPct),
    },
    flags: {},
  };
}

// --------------------------------------------------
// CLASSIFICATION
// --------------------------------------------------

function classifyZone(score) {
  if (score >= 90) return "Institutional Core";
  if (score >= 80) return "Strong Shelf";
  if (score >= 70) return "Valid Shelf";
  if (score >= 60) return "Forming Shelf";
  return "Shelf";
}

// --------------------------------------------------
// UTILITIES
// --------------------------------------------------

function normalizeBars(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map(b => {
      const t = Number(b.t ?? b.time ?? 0);
      const sec = t > 1e12 ? Math.floor(t / 1000) : t;
      return {
        time: sec,
        open: Number(b.o ?? b.open),
        high: Number(b.h ?? b.high),
        low: Number(b.l ?? b.low),
        close: Number(b.c ?? b.close),
        volume: Number(b.v ?? b.volume ?? 0),
      };
    })
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

function computeATR(candles, p) {
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    trs.push(Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    ));
  }
  return trs.slice(-p).reduce((a, b) => a + b, 0) / p || 1;
}

function mergeZoneLists(zones) {
  return zones.sort((a, b) => b.score - a.score).slice(0, 20);
}

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round2 = x => Math.round(x * 100) / 100;
const round4 = x => Math.round(x * 10000) / 10000;
const objectRound2 = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)]));

function scoreTouches(t) { return Math.min(1, Math.max(0, (t - 2) / 10)); }
function scoreVolume(r, c) {
  const avg = c.reduce((s, x) => s + x.volume, 0) / c.length;
  return clamp((r.volumeSum / r.touches) / avg, 0.3, 1);
}
function scoreWick(w, b) { return clamp(w / Math.max(1, w + b), 0, 1); }
function scoreHold(a, b) { return clamp((b - a) / 200, 0.2, 1); }
function scoreRetest(idx) { return idx.length >= 3 ? 1 : 0.3; }
