// src/services/core/logic/smzEngine.js
// Institutional SMZ detection + scoring + TradingView-style overlap reduction.
//
// MODE (what we’re doing now):
// 1) Detect + score globally across full provided history
// 2) Filter to currentPrice ± 40
// 3) Select ALL zones >= 90 (no max cap)
// 4) Merge overlaps into TradingView-style bands
//
// ✅ MISSING GUARDRAIL (now added):
// If selection yields ZERO zones, we automatically relax selection:
//   - try >= 85
//   - else return top N by score inside the band
//
// Scoring delegated to smzInstitutionalRubric.js

import { scoreInstitutionalRubric as scoreInstitutional } from "./smzInstitutionalRubric.js";

const CFG = {
  // Output filter band (LOCKED)
  WINDOW_POINTS: 40,

  // Primary institutional band (LOCKED target)
  MIN_STRENGTH_PRIMARY: 90,

  // Guardrail fallback threshold
  MIN_STRENGTH_FALLBACK: 85,

  // If still empty, return top N in band so output is never empty
  FALLBACK_TOP_N: 12,

  // Candidate strictness
  MIN_TOUCHES_1H: 5,
  MIN_TOUCHES_4H: 3,

  // Bucket sizing from ATR
  BUCKET_ATR_MULT_1H: 1.0,
  BUCKET_ATR_MULT_4H: 1.2,

  // Merge/cluster controls (TradingView-style)
  MERGE_OVERLAP: 0.55,
  CLUSTER_OVERLAP: 0.30,
};

const GRID_STEP = 0.25;

function round2(x) { return Math.round(x * 100) / 100; }

function normalizeBars(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((b) => {
      const rawT = Number(b.t ?? b.time ?? 0);
      const time = rawT > 1e12 ? Math.floor(rawT / 1000) : rawT;
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

function minLow(candles) {
  let m = Infinity;
  for (const c of candles) if (validBar(c)) m = Math.min(m, c.low);
  return m === Infinity ? null : m;
}

function maxHigh(candles) {
  let m = -Infinity;
  for (const c of candles) if (validBar(c)) m = Math.max(m, c.high);
  return m === -Infinity ? null : m;
}

// GLOBAL bucket candidates across full price range
function buildBucketCandidatesGlobal(candles, bucketSize, minTouches, tf) {
  const loAll = minLow(candles);
  const hiAll = maxHigh(candles);
  if (!Number.isFinite(loAll) || !Number.isFinite(hiAll) || hiAll <= loAll) return [];

  const start = snapDown(loAll, GRID_STEP);
  const end = snapUp(hiAll, GRID_STEP);

  const step = Math.max(GRID_STEP, snapUp(bucketSize, GRID_STEP));

  const buckets = [];
  for (let lo = start; lo < end; lo += step) {
    buckets.push({ tf, low: lo, high: lo + step, touches: 0 });
  }

  for (const c of candles) {
    if (!validBar(c)) continue;
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

// Tight merge similar slices
function mergeByOverlap(zones, threshold) {
  const sorted = zones.slice().sort((x, y) => x._low - y._low);
  const out = [];

  for (const z of sorted) {
    if (!out.length) { out.push(z); continue; }

    const last = out[out.length - 1];
    const ov = overlapPct({ low: last._low, high: last._high }, { low: z._low, high: z._high });

    if (ov >= threshold) {
      const mergedLow = round2(Math.min(last._low, z._low));
      const mergedHigh = round2(Math.max(last._high, z._high));
      const strength = Math.max(Number(last.strength ?? 0), Number(z.strength ?? 0));

      const members = []
        .concat(last.details?.members ?? [last.details?.id].filter(Boolean))
        .concat(z.details?.members ?? [z.details?.id].filter(Boolean));

      const tfs = new Set([last.details?.tf, z.details?.tf].filter(Boolean));

      out[out.length - 1] = {
        ...last,
        _low: mergedLow,
        _high: mergedHigh,
        price: round2((mergedLow + mergedHigh) / 2),
        priceRange: [mergedHigh, mergedLow],
        strength,
        details: {
          ...last.details,
          members,
          tfs: Array.from(tfs),
        },
      };
    } else {
      out.push(z);
    }
  }
  return out;
}

// TradingView-style cluster union: merge overlapping zones into one band per cluster
function clusterUnionBands(zones) {
  const input = zones.slice().sort((a, b) => a._low - b._low);
  const clusters = [];

  for (const z of input) {
    let placed = false;
    for (const c of clusters) {
      if (c.members.some((m) => overlapsLoose(m, z, CFG.CLUSTER_OVERLAP))) {
        c.members.push(z);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ members: [z] });
  }

  const bands = clusters.map((c, idx) => {
    let low = Infinity;
    let high = -Infinity;
    let strength = 0;

    const memberIds = [];
    const tfs = new Set();
    let hasClear4H = false;

    for (const m of c.members) {
      low = Math.min(low, m._low);
      high = Math.max(high, m._high);
      strength = Math.max(strength, Number(m.strength ?? 0));
      if (m.details?.id) memberIds.push(m.details.id);
      if (m.details?.tf) tfs.add(m.details.tf);
      if (m.details?.flags?.hasClear4H) hasClear4H = true;
      if (Array.isArray(m.details?.members)) memberIds.push(...m.details.members);
    }

    low = round2(low);
    high = round2(high);

    return {
      type: "institutional",
      price: round2((low + high) / 2),
      priceRange: [high, low],
      strength,
      details: {
        id: `smz_band_${idx}`,
        tf: "mixed",
        members: Array.from(new Set(memberIds)),
        tfs: Array.from(tfs),
        flags: { hasClear4H },
      },
      _low: low,
      _high: high,
    };
  });

  // Keep score order (strongest first)
  bands.sort((a, b) => b.strength - a.strength);
  return bands;
}

function filterToBand(zones, currentPrice, windowPts) {
  const loBand = currentPrice - windowPts;
  const hiBand = currentPrice + windowPts;
  return zones.filter((z) => z._high >= loBand && z._low <= hiBand);
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

  const atr1h = computeATR(b1h, 14);
  const atr4h = computeATR(b4h, 14);

  const bucket1h = Math.max(0.50, atr1h * CFG.BUCKET_ATR_MULT_1H);
  const bucket4h = Math.max(0.75, atr4h * CFG.BUCKET_ATR_MULT_4H);

  const cand1h = buildBucketCandidatesGlobal(b1h, bucket1h, CFG.MIN_TOUCHES_1H, "1h");
  const cand4h = buildBucketCandidatesGlobal(b4h, bucket4h, CFG.MIN_TOUCHES_4H, "4h");

  const scored = [...cand1h, ...cand4h]
    .map((z, idx) => {
      const lo = z.price_low;
      const hi = z.price_high;

      const s = scoreInstitutional({
        lo,
        hi,
        bars1h: b1h,
        bars4h: b4h,
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

  const merged = mergeByOverlap(scored, CFG.MERGE_OVERLAP);
  const banded = filterToBand(merged, currentPrice, CFG.WINDOW_POINTS);

  // --- PRIMARY selection: all >=90 ---
  let selected = banded.filter((z) => Number(z.strength ?? 0) >= CFG.MIN_STRENGTH_PRIMARY);
  let selectionMode = `>=${CFG.MIN_STRENGTH_PRIMARY}`;

  // ✅ GUARDRAIL: if empty, relax to >=85
  if (selected.length === 0) {
    selected = banded.filter((z) => Number(z.strength ?? 0) >= CFG.MIN_STRENGTH_FALLBACK);
    selectionMode = `>=${CFG.MIN_STRENGTH_FALLBACK}`;
  }

  // ✅ GUARDRAIL: if still empty, return top N in-band by score
  if (selected.length === 0) {
    selected = banded
      .slice()
      .sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0))
      .slice(0, CFG.FALLBACK_TOP_N);
    selectionMode = `top${CFG.FALLBACK_TOP_N}`;
  }

  const bands = clusterUnionBands(selected).map((z) => ({
    type: z.type,
    price: z.price,
    priceRange: z.priceRange,
    strength: z.strength,
    details: {
      ...z.details,
      selectionMode, // ✅ tells you if we used the guardrail
    },
  }));

  return bands;
}
