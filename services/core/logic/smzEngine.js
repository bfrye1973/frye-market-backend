// src/services/core/logic/smzEngine.js
// Detect zones + score via rubric (separate file). Diagnostic output.

import { scoreInstitutionalRubric } from "./smzInstitutionalRubric.js";

const CFG = {
  WINDOW_POINTS: 30,
  LOOKBACK_1H: 150,   // bars used for detection per TF
  LOOKBACK_4H: 180,
  MIN_TOUCHES: 3,
  BUCKET_ATR_MULT: 0.60,
  MAX_OUT: 30,
};

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function round2(x) { return Math.round(x * 100) / 100; }

function normalizeBars(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((b) => ({
      time: (Number(b.t ?? b.time ?? 0) > 1e12) ? Math.floor(Number(b.t ?? b.time) / 1000) : Number(b.t ?? b.time ?? 0),
      open: Number(b.o ?? b.open ?? 0),
      high: Number(b.h ?? b.high ?? 0),
      low: Number(b.l ?? b.low ?? 0),
      close: Number(b.c ?? b.close ?? 0),
      volume: Number(b.v ?? b.volume ?? 0),
    }))
    .filter((b) =>
      Number.isFinite(b.time) &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close)
    )
    .sort((a, b) => a.time - b.time);
}

function computeATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 2) return 1;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
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

function buildBucketCandidates(candles, bucketSize, minTouches, tf) {
  const lows = candles.map((c) => c.low);
  const minPrice = Math.min(...lows);
  const buckets = new Map();

  const keyFor = (price) => Math.floor((price - minPrice) / bucketSize);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const mid = (c.high + c.low) / 2;
    const k = keyFor(mid);

    const b = buckets.get(k) || {
      tf,
      low: minPrice + k * bucketSize,
      high: minPrice + (k + 1) * bucketSize,
      touches: 0,
    };

    if (c.high >= b.low && c.low <= b.high) b.touches++;
    buckets.set(k, b);
  }

  const out = [];
  for (const b of buckets.values()) {
    if (b.touches >= minTouches) {
      out.push({
        tf,
        price_low: round2(b.low),
        price_high: round2(b.high),
      });
    }
  }
  return out;
}

function overlapPct(a, b) {
  const lo = Math.max(a.low, b.low);
  const hi = Math.min(a.high, b.high);
  const inter = hi - lo;
  if (inter <= 0) return 0;
  const denom = Math.min(a.high - a.low, b.high - b.low);
  return denom > 0 ? inter / denom : 0;
}

function mergeByOverlap(zones, threshold = 0.45) {
  const sorted = zones.slice().sort((x, y) => x.price_low - y.price_low);
  const out = [];
  for (const z of sorted) {
    if (!out.length) { out.push(z); continue; }
    const last = out[out.length - 1];
    const ov = overlapPct(
      { low: last.price_low, high: last.price_high },
      { low: z.price_low, high: z.price_high }
    );
    if (ov >= threshold) {
      // keep the higher score zone, widen bounds
      const winner = (last.strength ?? 0) >= (z.strength ?? 0) ? last : z;
      winner.price_low = round2(Math.min(last.price_low, z.price_low));
      winner.price_high = round2(Math.max(last.price_high, z.price_high));
      out[out.length - 1] = winner;
    } else {
      out.push(z);
    }
  }
  return out;
}

export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  const b30 = normalizeBars(bars30m);
  const b1h = normalizeBars(bars1h);
  const b4h = normalizeBars(bars4h);

  const currentPrice =
    b30.at(-1)?.close ??
    b1h.at(-1)?.close ??
    b4h.at(-1)?.close ??
    null;

  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return [];

  const loWin = currentPrice - CFG.WINDOW_POINTS;
  const hiWin = currentPrice + CFG.WINDOW_POINTS;

  const c1h = b1h.slice(-CFG.LOOKBACK_1H);
  const c4h = b4h.slice(-CFG.LOOKBACK_4H);

  const atr1h = computeATR(c1h, 14);
  const atr4h = computeATR(c4h, 14);

  const bucket1h = Math.max(0.25, atr1h * CFG.BUCKET_ATR_MULT);
  const bucket4h = Math.max(0.50, atr4h * CFG.BUCKET_ATR_MULT);

  const cand1h = buildBucketCandidates(c1h, bucket1h, CFG.MIN_TOUCHES, "1h");
  const cand4h = buildBucketCandidates(c4h, bucket4h, CFG.MIN_TOUCHES, "4h");

  // score EVERY zone (A), but keep analysis within price window (relevant price only)
  const scored = [...cand1h, ...cand4h]
    .filter((z) => {
      const mid = (z.price_low + z.price_high) / 2;
      return mid >= loWin && mid <= hiWin;
    })
    .map((z, idx) => {
      const rubric = scoreInstitutionalRubric({
        zone: z,
        bars1h: c1h,
        bars4h: c4h,
        currentPrice,
      });

      return {
        type: "institutional",
        price: round2((z.price_low + z.price_high) / 2),
        priceRange: [round2(z.price_high), round2(z.price_low)],
        strength: rubric.scoreTotal,
        details: {
          id: `smz_${z.tf}_${idx}`,
          tf: z.tf,
          capApplied: rubric.capApplied,
          q: rubric.q,
          facts: rubric.facts,
        },
        // internal for merge
        tf: z.tf,
        price_low: z.price_low,
        price_high: z.price_high,
      };
    });

  // sort + light merge (diagnostic-friendly)
  const sorted = scored.sort((a, b) => b.strength - a.strength);
  const merged = mergeByOverlap(sorted, 0.55);

  return merged.slice(0, CFG.MAX_OUT).map((z) => ({
    type: z.type,
    price: z.price,
    priceRange: z.priceRange,
    strength: z.strength,
    details: z.details,
  }));
}
