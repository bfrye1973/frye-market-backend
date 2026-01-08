// src/services/core/logic/smzEngine.js
// Institutional SMZ detection + scoring + TradingView-style level output.
//
// LOCKED GAME PLAN:
// 1) Detect + score globally across full provided history (no proximity in discovery)
// 2) Create preliminary regimes (bands) from scored candidates (overlap + clustering)
// 3) Apply proximity filter AFTER regimes exist: currentPrice ± 40
// 4) Select regimes: >=90 (fallback >=85, else top N)
// 5) RE-ANCHOR each selected regime using:
//    - 1H truth: strong exit = 2 consecutive 1H bars fully outside zone on same side
//    - last consolidation block BEFORE exit (start at 10 bars, auto-adjust 6–24)
//    - refine edges using 30m bars within the same time window
// 6) Enforce DISJOINT output (no overlaps) to prevent “one yellow blob”
//
// STOP CONDITION (LOCKED):
// - Timeframe of truth: 1H
// - Strong move out of zone = 2 consecutive 1H bars fully outside zone on SAME SIDE
//
// Scoring delegated to smzInstitutionalRubric.js

import { scoreInstitutionalRubric as scoreInstitutional } from "./smzInstitutionalRubric.js";

const CFG = {
  // Output band around current price (LOCKED)
  WINDOW_POINTS: 40,

  // Selection thresholds (LOCKED)
  MIN_STRENGTH_PRIMARY: 90,
  MIN_STRENGTH_FALLBACK: 85,
  FALLBACK_TOP_N: 12,

  // Candidate strictness
  MIN_TOUCHES_1H: 5,
  MIN_TOUCHES_4H: 3,

  // Bucket sizing from ATR
  BUCKET_ATR_MULT_1H: 1.0,
  BUCKET_ATR_MULT_4H: 1.2,

  // Merge/cluster (preliminary regimes)
  MERGE_OVERLAP: 0.55,
  CLUSTER_OVERLAP: 0.30,

  // Stop condition (LOCKED)
  EXIT_CONSEC_BARS_1H: 2,

  // Anchor-window (your decision: start 10, allow 6–24)
  ANCHOR_START_BARS_1H: 10,
  ANCHOR_MIN_BARS_1H: 6,
  ANCHOR_MAX_BARS_1H: 24,

  // Consolidation quality guardrails (behavior proxy, not “indicator trading”)
  // These only help the engine decide how far back to include bars.
  AVG_RANGE_ATR_MAX: 1.25,  // average bar range vs ATR
  WIDTH_ATR_MAX: 3.25,      // total consolidation height vs ATR
};

const GRID_STEP = 0.25;

function round2(x) { return Math.round(x * 100) / 100; }

function normalizeBars(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((b) => {
      const rawT = Number(b.t ?? b.time ?? 0);
      const time = rawT > 1e12 ? Math.floor(rawT / 1000) : rawT; // ms->sec if needed
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

function barOverlapsZone(bar, lo, hi) {
  return bar && Number.isFinite(bar.high) && Number.isFinite(bar.low) && (bar.high >= lo && bar.low <= hi);
}

function barOutsideSide(bar, lo, hi) {
  // returns "above" if bar fully above zone, "below" if fully below, else null
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
// Find last touch index, then require next 2 consecutive 1H bars fully outside on SAME side.
function exitConfirmed1h(bars1h, lo, hi, consec = 2) {
  const idx = lastTouchIndex1h(bars1h, lo, hi);
  if (idx < 0) return { lastTouchIndex: -1, confirmed: false, side: null, exitBars: 0 };

  let side = null;
  let exitBars = 0;

  for (let j = idx + 1; j < bars1h.length && exitBars < consec; j++) {
    const s = barOutsideSide(bars1h[j], lo, hi);
    if (!s) break; // overlap/re-entry: negotiation continues
    if (!side) side = s;
    if (s !== side) break; // must continue same direction
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
    if (b.touches >= minTouches) out.push({ tf, price_low: round2(b.low), price_high: round2(b.high) });
  }
  return out;
}

// Merge helper
function mergeTwoZones(a, b) {
  const mergedLow = round2(Math.min(a._low, b._low));
  const mergedHigh = round2(Math.max(a._high, b._high));
  const strength = Math.max(Number(a.strength ?? 0), Number(b.strength ?? 0));

  const members = []
    .concat(a.details?.members ?? [a.details?.id].filter(Boolean))
    .concat(b.details?.members ?? [b.details?.id].filter(Boolean));

  const tfs = new Set([...(a.details?.tfs ?? []), a.details?.tf, ...(b.details?.tfs ?? []), b.details?.tf].filter(Boolean));

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
    },
  };
}

// Overlap-only merge (preliminary cleanup)
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

// Cluster union to form preliminary regimes
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
    let low = Infinity, high = -Infinity, strength = 0;
    const memberIds = [];
    const tfs = new Set();
    let hasClear4H = false;

    for (const m of c.members) {
      low = Math.min(low, m._low);
      high = Math.max(high, m._high);
      strength = Math.max(strength, Number(m.strength ?? 0));

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
        members: Array.from(new Set(memberIds)),
        tfs: Array.from(tfs),
        flags: { hasClear4H },
      },
      _low: low,
      _high: high,
    };
  });

  // strongest first
  bands.sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0));
  return bands;
}

function filterToBand(zones, currentPrice, windowPts) {
  const loBand = currentPrice - windowPts;
  const hiBand = currentPrice + windowPts;
  return zones.filter((z) => z._high >= loBand && z._low <= hiBand);
}

// ---------- Anchor-window extraction (THE KEY CHANGE) ----------

function sliceBarsByIndex(bars, startIdx, endIdx) {
  if (!Array.isArray(bars) || bars.length === 0) return [];
  const s = Math.max(0, startIdx);
  const e = Math.min(bars.length - 1, endIdx);
  if (s > e) return [];
  return bars.slice(s, e + 1);
}

function meanRange(bars) {
  if (!Array.isArray(bars) || bars.length === 0) return 0;
  let sum = 0, n = 0;
  for (const b of bars) {
    if (!validBar(b)) continue;
    sum += (b.high - b.low);
    n++;
  }
  return n ? sum / n : 0;
}

function rangeHighLow(bars) {
  let lo = Infinity, hi = -Infinity;
  for (const b of (bars || [])) {
    if (!validBar(b)) continue;
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
  }
  if (lo === Infinity || hi === -Infinity) return null;
  return { lo: round2(lo), hi: round2(hi), width: round2(hi - lo) };
}

// Decide best consolidation window length (6–24), starting at 10.
// We pick the tightest (smallest width) window that still looks like consolidation:
// - avg bar range <= AVG_RANGE_ATR_MAX * ATR
// - total width <= WIDTH_ATR_MAX * ATR
function chooseConsolidationWindow(bars1h, endIdx, atr1h) {
  const minL = CFG.ANCHOR_MIN_BARS_1H;
  const maxL = CFG.ANCHOR_MAX_BARS_1H;

  let best = null;

  for (let L = minL; L <= maxL; L++) {
    const startIdx = endIdx - (L - 1);
    if (startIdx < 0) continue;

    const windowBars = sliceBarsByIndex(bars1h, startIdx, endIdx);
    const rh = rangeHighLow(windowBars);
    if (!rh) continue;

    const avgR = meanRange(windowBars);

    const avgOk = avgR <= CFG.AVG_RANGE_ATR_MAX * atr1h;
    const widthOk = rh.width <= CFG.WIDTH_ATR_MAX * atr1h;

    if (!avgOk || !widthOk) continue;

    // Prefer the tightest width; tie-breaker: closer to start-at-10
    const score = rh.width;
    const bias = Math.abs(L - CFG.ANCHOR_START_BARS_1H) * 0.01;
    const total = score + bias;

    if (!best || total < best.total) {
      best = { startIdx, endIdx, L, lo: rh.lo, hi: rh.hi, width: rh.width, total };
    }
  }

  // If nothing passes guardrails, fall back to exactly 10 bars (clamped)
  if (!best) {
    const L = Math.min(Math.max(CFG.ANCHOR_START_BARS_1H, minL), maxL);
    const startIdx = Math.max(0, endIdx - (L - 1));
    const windowBars = sliceBarsByIndex(bars1h, startIdx, endIdx);
    const rh = rangeHighLow(windowBars);
    if (rh) return { startIdx, endIdx, L, lo: rh.lo, hi: rh.hi, width: rh.width, total: rh.width };
    return null;
  }

  return best;
}

// Refine zone edges using 30m bars within the anchor time window
function refineWith30m(bars30m, startTimeSec, endTimeSec) {
  if (!Array.isArray(bars30m) || bars30m.length === 0) return null;
  const subset = bars30m.filter((b) => validBar(b) && b.time >= startTimeSec && b.time <= endTimeSec);
  const rh = rangeHighLow(subset);
  return rh ? { lo: rh.lo, hi: rh.hi } : null;
}

// Re-anchor a regime: use exit, then find last consolidation block pre-exit, refine with 30m.
function reanchorRegime(regime, bars1h, bars30m, atr1h) {
  const lo0 = regime._low;
  const hi0 = regime._high;

  const exit = exitConfirmed1h(bars1h, lo0, hi0, CFG.EXIT_CONSEC_BARS_1H);

  // If no clean exit, keep as-is (fallback behavior)
  if (!exit.confirmed || exit.lastTouchIndex < 0) {
    return {
      ...regime,
      details: {
        ...regime.details,
        facts: {
          ...(regime.details?.facts ?? {}),
          anchorMode: "no_exit_keep_original",
        },
      },
    };
  }

  // Anchor window ends at last touch (the final negotiation bar)
  const anchorEnd = exit.lastTouchIndex;

  const chosen = chooseConsolidationWindow(bars1h, anchorEnd, atr1h);
  if (!chosen) {
    return {
      ...regime,
      details: {
        ...regime.details,
        facts: {
          ...(regime.details?.facts ?? {}),
          anchorMode: "exit_no_window_keep_original",
        },
      },
    };
  }

  const startTime = bars1h[chosen.startIdx]?.time ?? null;
  const endTime = bars1h[chosen.endIdx]?.time ?? null;

  // 1H anchor bounds
  let newLo = chosen.lo;
  let newHi = chosen.hi;

  // 30m refine (if we have times)
  if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
    const refined = refineWith30m(bars30m, startTime, endTime);
    if (refined) {
      newLo = refined.lo;
      newHi = refined.hi;
    }
  }

  // If something went weird, keep original
  if (!(Number.isFinite(newLo) && Number.isFinite(newHi)) || newHi <= newLo) {
    return {
      ...regime,
      details: {
        ...regime.details,
        facts: {
          ...(regime.details?.facts ?? {}),
          anchorMode: "bad_bounds_keep_original",
        },
      },
    };
  }

  newLo = round2(newLo);
  newHi = round2(newHi);

  return {
    ...regime,
    _low: newLo,
    _high: newHi,
    priceRange: [newHi, newLo],
    price: round2((newLo + newHi) / 2),
    details: {
      ...regime.details,
      facts: {
        ...(regime.details?.facts ?? {}),
        anchorMode: "anchored_last_consolidation",
        anchorBars1h: chosen.L,
        anchorStartTime: startTime,
        anchorEndTime: endTime,
        exitSide1h: exit.side,
        exitBars1h: exit.exitBars,
      },
    },
  };
}

// Enforce disjoint final output (no overlaps)
function makeDisjoint(bands) {
  const sorted = bands.slice().sort((a, b) => a._low - b._low);
  const out = [];

  for (const z of sorted) {
    if (!out.length) { out.push({ ...z }); continue; }
    const last = out[out.length - 1];

    if (z._low < last._high) {
      const mid = round2((z._low + last._high) / 2);

      const newLastHigh = mid;
      const newCurLow = mid;

      const lastWidth = newLastHigh - last._low;
      const curWidth = z._high - newCurLow;

      // if trimming collapses one zone, keep stronger
      if (lastWidth <= 0 || curWidth <= 0) {
        const keepLast = Number(last.strength ?? 0) >= Number(z.strength ?? 0);
        if (keepLast) continue;
        out[out.length - 1] = { ...z };
        continue;
      }

      last._high = newLastHigh;
      last.priceRange = [round2(newLastHigh), round2(last._low)];
      last.price = round2((last._low + newLastHigh) / 2);

      const cur = { ...z };
      cur._low = newCurLow;
      cur.priceRange = [round2(cur._high), round2(newCurLow)];
      cur.price = round2((newCurLow + cur._high) / 2);

      out.push(cur);
    } else {
      out.push({ ...z });
    }
  }

  // return in strength order for UI
  out.sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0));
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

  const atr1h = computeATR(b1h, 14);
  const atr4h = computeATR(b4h, 14);

  const bucket1h = Math.max(0.50, atr1h * CFG.BUCKET_ATR_MULT_1H);
  const bucket4h = Math.max(0.75, atr4h * CFG.BUCKET_ATR_MULT_4H);

  const cand1h = buildBucketCandidatesGlobal(b1h, bucket1h, CFG.MIN_TOUCHES_1H, "1h");
  const cand4h = buildBucketCandidatesGlobal(b4h, bucket4h, CFG.MIN_TOUCHES_4H, "4h");

  // Score globally
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
    .sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0));

  // Preliminary regimes (global)
  const merged = mergeByOverlap(scored, CFG.MERGE_OVERLAP);
  const regimesGlobal = clusterUnionBands(merged);

  // Apply proximity only after regimes exist
  const regimesInBand = filterToBand(regimesGlobal, currentPrice, CFG.WINDOW_POINTS);

  // Selection
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

  // ✅ RE-ANCHOR each selected regime to last consolidation before strong exit
  const anchored = selected.map((z) => reanchorRegime(z, b1h, b30, atr1h));

  // ✅ enforce disjoint (no overlaps) so no yellow blob
  const disjoint = makeDisjoint(anchored);

  // Output contract-safe
  return disjoint.map((z) => ({
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
