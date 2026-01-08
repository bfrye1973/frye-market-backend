// src/services/core/logic/smzEngine.js
// Institutional SMZ detection + scoring + TradingView-style overlap reduction.
//
// GAME PLAN (LOCKED):
// 1) Detect + score globally across full provided history (no proximity windowing in discovery)
// 2) Build regimes globally (behavior-driven width):
//    - overlap merge
//    - merge touching/near slices ONLY if they share the same negotiation window (prevents mega-zone)
// 3) Apply proximity filter AFTER regimes exist: currentPrice ± 40
// 4) Select regimes: >=90 (fallback >=85, else top N)
// 5) Output render objects (bands). Evidence remains per-member.
//
// STOP CONDITION (LOCKED):
// - Timeframe of truth: 1H
// - Strong move out of zone = 2 consecutive 1H bars fully outside zone on SAME SIDE (above OR below)
// - This is used to define/guard regime boundaries (behavior change).
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

  // Merge controls
  MERGE_OVERLAP: 0.55,
  CLUSTER_OVERLAP: 0.30,

  // Behavior-driven "near merge" limits
  // - Allows merging touching/near slices when they belong to the SAME negotiation episode.
  // - Prevents chain-merging the entire price grid across history.
  NEAR_POINTS: 0.50,            // allow touching/near adjacency (includes gap==0)
  TOUCH_TIME_WINDOW_1H: 48,     // max distance between "last touch" times to be same negotiation (~2 days)

  // Stop condition config (LOCKED)
  EXIT_CONSEC_BARS_1H: 2,       // 2 consecutive 1H bars outside zone
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

function barOverlapsZone(bar, lo, hi) {
  return bar && Number.isFinite(bar.high) && Number.isFinite(bar.low) && (bar.high >= lo && bar.low <= hi);
}

function barOutsideSide(bar, lo, hi) {
  // returns "above" if bar is fully above zone, "below" if fully below, else null
  if (!bar || !Number.isFinite(bar.high) || !Number.isFinite(bar.low)) return null;
  if (bar.low > hi) return "above";
  if (bar.high < lo) return "below";
  return null;
}

function lastTouchIndex1h(bars1h, lo, hi) {
  if (!Array.isArray(bars1h) || bars1h.length === 0) return -1;
  for (let i = bars1h.length - 1; i >= 0; i--) {
    if (barOverlapsZone(bars1h[i], lo, hi)) return i;
  }
  return -1;
}

// STOP CONDITION (LOCKED):
// - Find last touch (overlap) index
// - Require next 2 consecutive 1H bars are fully outside on SAME side (above OR below)
function exitConfirmed1h(bars1h, lo, hi, consec = 2) {
  const idx = lastTouchIndex1h(bars1h, lo, hi);
  if (idx < 0) return { lastTouchIndex: -1, confirmed: false, side: null, exitBars: 0 };

  let side = null;
  let exitBars = 0;

  for (let j = idx + 1; j < bars1h.length && exitBars < consec; j++) {
    const s = barOutsideSide(bars1h[j], lo, hi);
    if (!s) break; // re-entry or overlap => negotiation not ended

    if (!side) side = s;
    if (s !== side) break; // must continue same direction (follow-through)

    exitBars++;
  }

  return {
    lastTouchIndex: idx,
    confirmed: exitBars >= consec,
    side,
    exitBars,
  };
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

// Merge helper: combine two zone objects into one (keeps members and uses max strength)
function mergeTwoZones(a, b) {
  const mergedLow = round2(Math.min(a._low, b._low));
  const mergedHigh = round2(Math.max(a._high, b._high));
  const strength = Math.max(Number(a.strength ?? 0), Number(b.strength ?? 0));

  const members = []
    .concat(a.details?.members ?? [a.details?.id].filter(Boolean))
    .concat(b.details?.members ?? [b.details?.id].filter(Boolean));

  const tfs = new Set([...(a.details?.tfs ?? []), a.details?.tf, ...(b.details?.tfs ?? []), b.details?.tf].filter(Boolean));

  // carry lastTouchIndex if present (use max = most recent)
  const aLT = Number(a.details?.facts?.lastTouchIndex1h ?? -1);
  const bLT = Number(b.details?.facts?.lastTouchIndex1h ?? -1);
  const lastTouch = Math.max(aLT, bLT);

  return {
    ...a,
    _low: mergedLow,
    _high: mergedHigh,
    price: round2((mergedLow + mergedHigh) / 2),
    priceRange: [mergedHigh, mergedLow],
    strength,
    details: {
      ...a.details,
      members: Array.from(new Set(members)),
      tfs: Array.from(tfs),
      facts: {
        ...(a.details?.facts ?? {}),
        lastTouchIndex1h: lastTouch,
      },
    },
  };
}

// Stage 1: overlap merge (existing behavior)
function mergeByOverlap(zones, threshold) {
  const sorted = zones.slice().sort((x, y) => x._low - y._low);
  const out = [];

  for (const z of sorted) {
    if (!out.length) { out.push(z); continue; }

    const last = out[out.length - 1];
    const ov = overlapPct({ low: last._low, high: last._high }, { low: z._low, high: z._high });

    if (ov >= threshold) out[out.length - 1] = mergeTwoZones(last, z);
    else out.push(z);
  }
  return out;
}

// Stage 2: behavior-driven near merge (touching/near slices)
// - We allow merging gap==0 ONLY if the slices share the same negotiation episode,
//   approximated by "last touch index" being close in time.
// - This prevents chain-merging across the entire year's grid.
function mergeByNearNegotiation(zones, bars1h) {
  const sorted = zones.slice().sort((a, b) => a._low - b._low);
  const out = [];

  for (const z of sorted) {
    if (!out.length) { out.push(z); continue; }

    const last = out[out.length - 1];

    const gap = round2(z._low - last._high); // can be 0 (touching), small positive, or negative (overlap)
    const nearByPrice = gap <= CFG.NEAR_POINTS; // includes touching and tiny gaps

    // compute last touch indices if missing
    const lastLo = last._low, lastHi = last._high;
    const zLo = z._low, zHi = z._high;

    const lastLT = Number(last.details?.facts?.lastTouchIndex1h);
    const zLT = Number(z.details?.facts?.lastTouchIndex1h);

    const ltA = Number.isFinite(lastLT) && lastLT >= 0 ? lastLT : lastTouchIndex1h(bars1h, lastLo, lastHi);
    const ltB = Number.isFinite(zLT) && zLT >= 0 ? zLT : lastTouchIndex1h(bars1h, zLo, zHi);

    const sameEpisode =
      ltA >= 0 &&
      ltB >= 0 &&
      Math.abs(ltA - ltB) <= CFG.TOUCH_TIME_WINDOW_1H;

    // Only near-merge when price adjacency + same negotiation episode
    if (nearByPrice && sameEpisode) {
      // merge and preserve facts
      const merged = mergeTwoZones(
        {
          ...last,
          details: {
            ...last.details,
            facts: { ...(last.details?.facts ?? {}), lastTouchIndex1h: ltA },
          },
        },
        {
          ...z,
          details: {
            ...z.details,
            facts: { ...(z.details?.facts ?? {}), lastTouchIndex1h: ltB },
          },
        }
      );
      out[out.length - 1] = merged;
    } else {
      // ensure z carries its lastTouch fact for later stages
      out.push({
        ...z,
        details: {
          ...z.details,
          facts: { ...(z.details?.facts ?? {}), lastTouchIndex1h: ltB },
        },
      });
    }
  }

  return out;
}

// Cluster union to create render-bands (loose overlap)
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

    // best member for debugging
    let bestMemberId = null;
    let bestMemberTf = null;
    let bestStrength = -Infinity;

    // also keep the most recent lastTouchIndex among members
    let lastTouchMax = -1;

    for (const m of c.members) {
      low = Math.min(low, m._low);
      high = Math.max(high, m._high);

      const s = Number(m.strength ?? 0);
      strength = Math.max(strength, s);

      if (s > bestStrength || (s === bestStrength && m.details?.tf === "4h")) {
        bestStrength = s;
        bestMemberId = m.details?.id ?? null;
        bestMemberTf = m.details?.tf ?? null;
      }

      const lt = Number(m.details?.facts?.lastTouchIndex1h ?? -1);
      if (Number.isFinite(lt)) lastTouchMax = Math.max(lastTouchMax, lt);

      if (m.details?.id) memberIds.push(m.details.id);
      if (m.details?.tf) tfs.add(m.details.tf);
      if (Array.isArray(m.details?.tfs)) m.details.tfs.forEach((x) => tfs.add(x));
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
        bestMemberId,
        bestMemberTf,
        members: Array.from(new Set(memberIds)),
        tfs: Array.from(tfs),
        flags: { hasClear4H },
        facts: {
          lastTouchIndex1h: lastTouchMax,
        },
      },
      _low: low,
      _high: high,
    };
  });

  bands.sort((a, b) => b.strength - a.strength);
  return bands;
}

function filterToBand(zones, currentPrice, windowPts) {
  const loBand = currentPrice - windowPts;
  const hiBand = currentPrice + windowPts;
  // overlap-based inclusion (best choice)
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

  // Score all candidates globally (no proximity filtering here)
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

      // attach stop-condition diagnostics (for later merges + debugging)
      const exit = exitConfirmed1h(b1h, lo, hi, CFG.EXIT_CONSEC_BARS_1H);

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
          facts: {
            ...s.facts,
            lastTouchIndex1h: exit.lastTouchIndex,
            exitConfirmed1h: exit.confirmed,
            exitSide1h: exit.side,
            exitBars1h: exit.exitBars,
          },
        },
        _low: lo,
        _high: hi,
      };
    })
    .sort((a, b) => b.strength - a.strength);

  // Consolidate globally into regimes (behavior-driven)
  const overlapMerged = mergeByOverlap(scored, CFG.MERGE_OVERLAP);
  const nearMerged = mergeByNearNegotiation(overlapMerged, b1h);
  const regimesGlobal = clusterUnionBands(nearMerged);

  // Apply proximity only AFTER regimes exist (LOCKED)
  const regimesInBand = filterToBand(regimesGlobal, currentPrice, CFG.WINDOW_POINTS);

  // Select regimes by strength (LOCKED)
  let selected = regimesInBand.filter((z) => Number(z.strength ?? 0) >= CFG.MIN_STRENGTH_PRIMARY);
  let selectionMode = `>=${CFG.MIN_STRENGTH_PRIMARY}`;

  if (selected.length === 0) {
    selected = regimesInBand.filter((z) => Number(z.strength ?? 0) >= CFG.MIN_STRENGTH_FALLBACK);
    selectionMode = `>=${CFG.MIN_STRENGTH_FALLBACK}`;
  }

  if (selected.length === 0) {
    selected = regimesInBand
      .slice()
      .sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0))
      .slice(0, CFG.FALLBACK_TOP_N);
    selectionMode = `top${CFG.FALLBACK_TOP_N}`;
  }

  selected.sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0));

  // Contract-safe output
  return selected.map((z) => ({
    type: z.type,
    price: z.price,
    priceRange: z.priceRange,
    strength: z.strength,
    details: {
      ...z.details,
      selectionMode,
    },
  }));
}
