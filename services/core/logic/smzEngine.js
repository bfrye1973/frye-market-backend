// src/services/core/logic/smzEngine.js
// Institutional SMZ detection + scoring + HIERARCHY reduction.
// Produces clean institutional zones (yellow).
//
// IMPORTANT:
// - Detection remains bucket-based but tightened.
// - Hierarchy ensures ONE dominant zone per overlapping cluster.
// - Scoring is delegated to smzInstitutionalRubric.js

import { scoreInstitutionalRubric as scoreInstitutional } from "./smzInstitutionalRubric.js";

const CFG = {
  // Window around current price
  WINDOW_POINTS: 16,

  // Lookbacks (already handled by polygon provider; these are slice limits)
  LOOKBACK_1H: 220,
  LOOKBACK_4H: 260,

  // Candidate strictness
  MIN_TOUCHES_1H: 5,
  MIN_TOUCHES_4H: 3,

  // Bucket sizing from ATR
  BUCKET_ATR_MULT_1H: 1.0,
  BUCKET_ATR_MULT_4H: 1.2,

  // Output controls
  MAX_INSTITUTIONAL_OUT: 6,      // keep it tight: 3–6 institutional zones max
  MERGE_OVERLAP: 0.60,

  // Hierarchy controls
  CLUSTER_OVERLAP: 0.35,         // clusters overlap more loosely than merge
};

const GRID_STEP = 0.25;

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
function round2(x) { return Math.round(x * 100) / 100; }

function normalizeBars(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((b) => {
      const rawT = Number(b.t ?? b.time ?? 0);
      const time = rawT > 1e12 ? Math.floor(rawT / 1000) : rawT; // ms -> sec
      return {
        time,
        open: Number(b.o ?? b.open ?? 0),
        high: Number(b.h ?? b.high ?? 0),
        low: Number(b.l ?? b.low ?? 0),
        close: Number(b.c ?? b.close ?? 0),
        volume: Number(b.v ?? b.volume ?? 0),
      };
    })
    .filter((b) =>
      Number.isFinite(b.time) &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close)
    )
    .sort((a, b) => a.time - b.time);
}

function validBar(b) {
  return b && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close);
}

function computeATR(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 2) return 1;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    if (!validBar(c) || !validBar(p)) continue;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    trs.push(tr);
  }
  const slice = trs.slice(-period);
  const atr = slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
  return atr > 0 ? atr : 1;
}

function snapDown(x, step) { return Math.floor(x / step) * step; }
function snapUp(x, step) { return Math.ceil(x / step) * step; }

function overlapPct(a, b) {
  const lo = Math.max(a.low, b.low);
  const hi = Math.min(a.high, b.high);
  const inter = hi - lo;
  if (inter <= 0) return 0;
  const denom = Math.min(a.high - a.low, b.high - b.low);
  return denom > 0 ? inter / denom : 0;
}

function overlapsLoose(a, b, threshold) {
  return overlapPct({ low: a._low, high: a._high }, { low: b._low, high: b._high }) >= threshold;
}

// Anchored bucket candidates within price window
function buildBucketCandidates(candles, currentPrice, bucketSize, minTouches, tf, windowPts) {
  const loWin = currentPrice - windowPts;
  const hiWin = currentPrice + windowPts;

  const start = snapDown(loWin, GRID_STEP);
  const end = snapUp(hiWin, GRID_STEP);

  // bucket boundaries anchored to GRID_STEP
  const step = Math.max(GRID_STEP, snapUp(bucketSize, GRID_STEP));
  const buckets = [];

  for (let lo = start; lo < end; lo += step) {
    buckets.push({ tf, low: lo, high: lo + step, touches: 0 });
  }

  for (const c of candles) {
    if (!validBar(c)) continue;
    if (c.high < loWin || c.low > hiWin) continue;

    for (const b of buckets) {
      if (c.high >= b.low && c.low <= b.high) b.touches++;
    }
  }

  const out = [];
  for (const b of buckets) {
    if (b.touches >= minTouches) {
      out.push({ tf, price_low: round2(b.low), price_high: round2(b.high) });
    }
  }
  return out;
}

// Merge overlaps (tight)
function mergeByOverlap(zones, threshold = 0.60) {
  const sorted = zones.slice().sort((x, y) => x._low - y._low);
  const out = [];

  for (const z of sorted) {
    if (!out.length) { out.push(z); continue; }

    const last = out[out.length - 1];
    const ov = overlapPct({ low: last._low, high: last._high }, { low: z._low, high: z._high });

    if (ov >= threshold) {
      const winner = (last.strength ?? 0) >= (z.strength ?? 0) ? last : z;
      winner._low = round2(Math.min(last._low, z._low));
      winner._high = round2(Math.max(last._high, z._high));
      winner.price = round2((winner._low + winner._high) / 2);
      winner.priceRange = [round2(winner._high), round2(winner._low)];
      out[out.length - 1] = winner;
    } else {
      out.push(z);
    }
  }
  return out;
}

/**
 * HIERARCHY REDUCER:
 * Groups zones into overlap clusters, then keeps ONE dominant institutional zone per cluster.
 */
function applyHierarchy(scoredZones) {
  const zones = scoredZones.slice().sort((a, b) => b.strength - a.strength);
  const clusters = [];

  for (const z of zones) {
    let placed = false;
    for (const c of clusters) {
      // if it overlaps any member loosely, it belongs to that cluster
      if (c.members.some((m) => overlapsLoose(m, z, CFG.CLUSTER_OVERLAP))) {
        c.members.push(z);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ members: [z] });
  }

  // pick dominant in each cluster
  const dominant = [];
  for (const c of clusters) {
    // sort cluster members by score desc
    c.members.sort((a, b) => b.strength - a.strength);

    // tie-breaker: prefer clear 4H presence, then tighter bounds
    const pick = c.members.reduce((best, cur) => {
      if (!best) return cur;
      const b4 = best.details?.flags?.hasClear4H ? 1 : 0;
      const c4 = cur.details?.flags?.hasClear4H ? 1 : 0;
      if (c4 !== b4) return c4 > b4 ? cur : best;

      const bw = (best._high - best._low);
      const cw = (cur._high - cur._low);
      if (cur.strength === best.strength && cw < bw) return cur;

      return (cur.strength > best.strength) ? cur : best;
    }, null);

    dominant.push(pick);
  }

  // sort dominant by score and cap output
  dominant.sort((a, b) => b.strength - a.strength);
  return dominant.slice(0, CFG.MAX_INSTITUTIONAL_OUT);
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

  const c1h = b1h.slice(-CFG.LOOKBACK_1H);
  const c4h = b4h.slice(-CFG.LOOKBACK_4H);

  const atr1h = computeATR(c1h, 14);
  const atr4h = computeATR(c4h, 14);

  const bucket1h = Math.max(0.50, atr1h * CFG.BUCKET_ATR_MULT_1H);
  const bucket4h = Math.max(0.75, atr4h * CFG.BUCKET_ATR_MULT_4H);

  const cand1h = buildBucketCandidates(
    c1h,
    currentPrice,
    bucket1h,
    CFG.MIN_TOUCHES_1H,
    "1h",
    CFG.WINDOW_POINTS
  );

  const cand4h = buildBucketCandidates(
    c4h,
    currentPrice,
    bucket4h,
    CFG.MIN_TOUCHES_4H,
    "4h",
    CFG.WINDOW_POINTS
  );

  const scored = [...cand1h, ...cand4h]
    .map((z, idx) => {
      const lo = z.price_low;
      const hi = z.price_high;

      const s = scoreInstitutional({
        lo,
        hi,
        bars1h: c1h,
        bars4h: c4h,
        currentPrice,
      });

      return {
        type: "institutional",
        price: round2((lo + hi) / 2),
        priceRange: [round2(hi), round2(lo)],
        strength: s.scoreTotal,
        details: {
          id: `smz_${z.tf}_${idx}`,
          tf: z.tf,
          parts: s.parts,
          flags: s.flags,
          facts: s.facts,
        },
        _low: lo,
        _high: hi,
      };
    })
    .sort((a, b) => b.strength - a.strength);

  // Tight merge first, then hierarchy cluster reduce
  const merged = mergeByOverlap(scored, CFG.MERGE_OVERLAP);
  const reduced = applyHierarchy(merged);

  return reduced.map((z) => ({
    type: z.type,
    price: z.price,
    priceRange: z.priceRange,
    strength: z.strength,
    details: z.details,
  }));
}
