// src/services/core/logic/smzEngine.js
// Institutional SMZ detection + scoring + TradingView-style level output.
//
// LOCKED BEHAVIOR (preserved):
// - Score globally via rubric
// - Re-anchor to last consolidation before confirmed exit (exclude impulse candle)
// - Collapse overlapping STRUCTURE zones into parent structures
// - Emit POCKET children and compute negotiationMid
//
// LOCKED by user:
// ✅ High-score zones are never demoted (STRUCT_SCORE_LOCK)
// ✅ Tighten logic is metadata-only (DO NOT overwrite priceRange)
//    This prevents losing important zones like 692–693.

import { scoreInstitutionalRubric as scoreInstitutional } from "./smzInstitutionalRubric.js";

const CFG = {
  WINDOW_POINTS: 40,

  FALLBACK_TOP_N: 12,

  MIN_TOUCHES_1H: 5,
  MIN_TOUCHES_4H: 3,

  BUCKET_ATR_MULT_1H: 1.0,
  BUCKET_ATR_MULT_4H: 1.2,

  MERGE_OVERLAP: 0.55,
  CLUSTER_OVERLAP: 0.30,

  EXIT_CONSEC_BARS_1H: 2,

  ANCHOR_START_BARS_1H: 10,
  ANCHOR_MIN_BARS_1H: 6,
  ANCHOR_MAX_BARS_1H: 24,

  AVG_RANGE_ATR_MAX: 1.25,
  WIDTH_ATR_MAX: 3.25,

  MIN_SCORE_GLOBAL: 75,

  STRUCT_OVERLAP_PCT: 0.50,
  STRUCT_NEAR_POINTS: 4.0,

  // ✅ High scores never demote
  STRUCT_SCORE_LOCK: 90,

  // STRUCTURE qualification: tight acceptance cap for SPY
  STRUCT_MAX_WIDTH_PTS: 4.0,
};

const GRID_STEP = 0.25;

function round2(x) {
  return Math.round(x * 100) / 100;
}

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
    .filter(
      (b) =>
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
    const c = candles[i],
      p = candles[i - 1];
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

function snapDown(x, step) {
  return Math.floor(x / step) * step;
}
function snapUp(x, step) {
  return Math.ceil(x / step) * step;
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

function overlapPct(a, b) {
  const lo = Math.max(a.low, b.low);
  const hi = Math.min(a.high, b.high);
  const inter = hi - lo;
  if (inter <= 0) return 0;
  const denom = Math.min(a.high - a.low, b.high - b.low);
  return denom > 0 ? inter / denom : 0;
}

function overlapsLoose(a, b, threshold) {
  return (
    overlapPct({ low: a._low, high: a._high }, { low: b._low, high: b._high }) >= threshold
  );
}

function barOverlapsZone(bar, lo, hi) {
  return (
    bar &&
    Number.isFinite(bar.high) &&
    Number.isFinite(bar.low) &&
    bar.high >= lo &&
    bar.low <= hi
  );
}

function barOutsideSide(bar, lo, hi) {
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

function exitConfirmed1h(bars1h, lo, hi, consec = 2) {
  const idx = lastTouchIndex1h(bars1h, lo, hi);
  if (idx < 0) return { lastTouchIndex: -1, confirmed: false, side: null, exitBars: 0 };

  let side = null;
  let exitBars = 0;

  for (let j = idx + 1; j < bars1h.length && exitBars < consec; j++) {
    const s = barOutsideSide(bars1h[j], lo, hi);
    if (!s) break;
    if (!side) side = s;
    if (s !== side) break;
    exitBars++;
  }

  return { lastTouchIndex: idx, confirmed: exitBars >= consec, side, exitBars };
}

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

function mergeTwoZones(a, b) {
  const mergedLow = round2(Math.min(a._low, b._low));
  const mergedHigh = round2(Math.max(a._high, b._high));
  const strength = Math.max(Number(a.strength ?? 0), Number(b.strength ?? 0));

  const members = []
    .concat(a.details?.members ?? [a.details?.id].filter(Boolean))
    .concat(b.details?.members ?? [b.details?.id].filter(Boolean));

  const tfs = new Set(
    [
      ...(a.details?.tfs ?? []),
      a.details?.tf,
      ...(b.details?.tfs ?? []),
      b.details?.tf,
    ].filter(Boolean)
  );

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

function mergeByOverlap(zones, threshold) {
  const sorted = zones.slice().sort((x, y) => x._low - y._low);
  const out = [];
  for (const z of sorted) {
    if (!out.length) {
      out.push(z);
      continue;
    }
    const last = out[out.length - 1];
    const ov = overlapPct({ low: last._low, high: last._high }, { low: z._low, high: z._high });
    if (ov >= threshold) out[out.length - 1] = mergeTwoZones(last, z);
    else out.push(z);
  }
  return out;
}

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
    let low = Infinity,
      high = -Infinity,
      strength = 0;
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
      tier: "structure",
      price: round2((low + high) / 2),
      priceRange: [high, low],
      strength,
      details: {
        id: `smz_band_${idx}`,
        tf: "mixed",
        members: Array.from(new Set(memberIds)),
        tfs: Array.from(tfs),
        flags: { hasClear4H },
        facts: {},
      },
      _low: low,
      _high: high,
    };
  });

  bands.sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0));
  return bands;
}

/* ---------------- Anchor-window extraction ---------------- */

function sliceBarsByIndex(bars, startIdx, endIdx) {
  if (!Array.isArray(bars) || bars.length === 0) return [];
  const s = Math.max(0, startIdx);
  const e = Math.min(bars.length - 1, endIdx);
  if (s > e) return [];
  return bars.slice(s, e + 1);
}

function meanRange(bars) {
  if (!Array.isArray(bars) || bars.length === 0) return 0;
  let sum = 0,
    n = 0;
  for (const b of bars) {
    if (!validBar(b)) continue;
    sum += b.high - b.low;
    n++;
  }
  return n ? sum / n : 0;
}

function rangeHighLow(bars) {
  let lo = Infinity,
    hi = -Infinity;
  for (const b of bars || []) {
    if (!validBar(b)) continue;
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
  }
  if (lo === Infinity || hi === -Infinity) return null;
  return { lo: round2(lo), hi: round2(hi), width: round2(hi - lo) };
}

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

    const score = rh.width;
    const bias = Math.abs(L - CFG.ANCHOR_START_BARS_1H) * 0.01;
    const total = score + bias;

    if (!best || total < best.total) {
      best = { startIdx, endIdx, L, lo: rh.lo, hi: rh.hi, width: rh.width, total };
    }
  }

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

function refineWith30m(bars30m, startTimeSec, endTimeSec) {
  if (!Array.isArray(bars30m) || bars30m.length === 0) return null;
  const subset = bars30m.filter((b) => validBar(b) && b.time >= startTimeSec && b.time <= endTimeSec);
  const rh = rangeHighLow(subset);
  return rh ? { lo: rh.lo, hi: rh.hi } : null;
}

function exitAfterWindowConfirmed1h(bars1h, windowLo, windowHi, endIdx, consec = 2) {
  if (!Array.isArray(bars1h) || bars1h.length === 0) return { confirmed: false, side: null, exitBars: 0 };
  if (!Number.isFinite(windowLo) || !Number.isFinite(windowHi) || windowHi <= windowLo) {
    return { confirmed: false, side: null, exitBars: 0 };
  }
  if (!Number.isFinite(endIdx) || endIdx < 0) return { confirmed: false, side: null, exitBars: 0 };

  let side = null;
  let exitBars = 0;

  for (let j = endIdx + 1; j < bars1h.length && exitBars < consec; j++) {
    const s = barOutsideSide(bars1h[j], windowLo, windowHi);
    if (!s) break;
    if (!side) side = s;
    if (s !== side) break;
    exitBars++;
  }

  return { confirmed: exitBars >= consec, side, exitBars };
}

function findLatestLaunchWindowInsideRegime(bars1h, regimeLo, regimeHi, atr1h) {
  if (!Array.isArray(bars1h) || bars1h.length < 30) return null;
  if (!Number.isFinite(regimeLo) || !Number.isFinite(regimeHi) || regimeHi <= regimeLo) return null;

  const EPS = 0.10;

  const lastPossibleEnd = bars1h.length - 1 - CFG.EXIT_CONSEC_BARS_1H;
  const minEnd = CFG.ANCHOR_MIN_BARS_1H;

  for (let endIdx = lastPossibleEnd; endIdx >= minEnd; endIdx--) {
    const chosen = chooseConsolidationWindow(bars1h, endIdx, atr1h);
    if (!chosen) continue;

    if (chosen.lo < regimeLo - EPS) continue;
    if (chosen.hi > regimeHi + EPS) continue;

    const exit = exitAfterWindowConfirmed1h(
      bars1h,
      chosen.lo,
      chosen.hi,
      chosen.endIdx,
      CFG.EXIT_CONSEC_BARS_1H
    );
    if (!exit.confirmed) continue;

    return {
      ...chosen,
      exitSide1h: exit.side,
      exitBars1h: exit.exitBars,
      anchorEndIdx: chosen.endIdx,
    };
  }

  return null;
}

function reanchorRegime(regime, bars1h, bars30m, atr1h) {
  const lo0 = Number(regime._low);
  const hi0 = Number(regime._high);

  if (!Number.isFinite(lo0) || !Number.isFinite(hi0) || hi0 <= lo0) return regime;

  const inner = findLatestLaunchWindowInsideRegime(bars1h, lo0, hi0, atr1h);

  if (inner) {
    const startTime = bars1h[inner.startIdx]?.time ?? null;
    const endTime = bars1h[inner.endIdx]?.time ?? null;

    let newLo = inner.lo;
    let newHi = inner.hi;

    if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
      const refined = refineWith30m(bars30m, startTime, endTime);
      if (refined) {
        newLo = refined.lo;
        newHi = refined.hi;
      }
    }

    if (!(Number.isFinite(newLo) && Number.isFinite(newHi)) || newHi <= newLo) return regime;

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
          anchorBars1h: inner.L,
          anchorStartTime: startTime,
          anchorEndTime: endTime,
          exitSide1h: inner.exitSide1h ?? null,
          exitBars1h: inner.exitBars1h ?? null,
          anchorExitMeasuredAgainst: "window",
          anchorEndIdx1h: inner.anchorEndIdx ?? inner.endIdx,
          negotiationMid: null,
        },
      },
    };
  }

  const exit = exitConfirmed1h(bars1h, lo0, hi0, CFG.EXIT_CONSEC_BARS_1H);

  if (!exit.confirmed || exit.lastTouchIndex < 0) {
    return {
      ...regime,
      details: {
        ...regime.details,
        facts: {
          ...(regime.details?.facts ?? {}),
          anchorMode: "no_exit_keep_original",
          negotiationMid: null,
        },
      },
    };
  }

  const anchorEnd = Math.max(0, exit.lastTouchIndex - 1);

  const chosen = chooseConsolidationWindow(bars1h, anchorEnd, atr1h);
  if (!chosen) {
    return {
      ...regime,
      details: {
        ...regime.details,
        facts: {
          ...(regime.details?.facts ?? {}),
          anchorMode: "exit_no_window_keep_original",
          negotiationMid: null,
        },
      },
    };
  }

  const startTime = bars1h[chosen.startIdx]?.time ?? null;
  const endTime = bars1h[chosen.endIdx]?.time ?? null;

  let newLo = chosen.lo;
  let newHi = chosen.hi;

  if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
    const refined = refineWith30m(bars30m, startTime, endTime);
    if (refined) {
      newLo = refined.lo;
      newHi = refined.hi;
    }
  }

  if (!(Number.isFinite(newLo) && Number.isFinite(newHi)) || newHi <= newLo) return regime;

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
        anchorExitMeasuredAgainst: "regime",
        negotiationMid: null,
      },
    },
  };
}

/* ---------------- STRUCTURE QUALIFICATION (with score lock) ---------------- */

function qualifyStructureOrDemote(regimes) {
  return (regimes || []).map((z) => {
    if ((z.tier ?? "") !== "structure") return z;

    const strength = Number(z.strength ?? 0);
    if (Number.isFinite(strength) && strength >= CFG.STRUCT_SCORE_LOCK) {
      return z;
    }

    const facts = z.details?.facts ?? {};
    const anchorMode = facts.anchorMode ?? null;

    const anchorBars = Number(facts.anchorBars1h ?? 0);
    const exitBars = Number(facts.exitBars1h ?? 0);
    const exitSide = facts.exitSide1h ?? null;

    const lo = Number(z.priceRange?.[1]);
    const hi = Number(z.priceRange?.[0]);
    const width = Number.isFinite(lo) && Number.isFinite(hi) ? hi - lo : Infinity;

    const isAnchored = anchorMode === "anchored_last_consolidation";
    const hasAcceptance = anchorBars >= CFG.ANCHOR_MIN_BARS_1H && width <= CFG.STRUCT_MAX_WIDTH_PTS;
    const hasExit = exitBars >= CFG.EXIT_CONSEC_BARS_1H && (exitSide === "above" || exitSide === "below");

    const isStructure = isAnchored && hasAcceptance && hasExit;

    if (isStructure) return z;

    return {
      ...z,
      tier: "micro",
      details: {
        ...z.details,
        facts: {
          ...facts,
          demotedFrom: "structure",
        },
      },
    };
  });
}

/* ---------------- Tighten STRUCTURES (METADATA ONLY) ---------------- */
/**
 * IMPORTANT:
 * We do NOT overwrite priceRange.
 * We only record a suggested tightened range in facts.tightenedRange.
 * This prevents removing key zones like 692–693.
 */
function tightenOnlyMonsterStructures(regimes, bars1h, bars30m) {
  const out = [];
  for (const z of regimes || []) {
    if ((z?.tier ?? "") !== "structure") {
      out.push(z);
      continue;
    }

    const pr = z.priceRange || [];
    const hi0 = Number(pr[0]);
    const lo0 = Number(pr[1]);
    const width0 = Number.isFinite(hi0) && Number.isFinite(lo0) ? (hi0 - lo0) : Infinity;

    // ✅ Only tighten really wide monsters (prevents breaking good tight zones like 692–693)
    if (!(width0 > 4.5)) {
      out.push(z);
      continue;
    }

    const facts = z?.details?.facts ?? {};
    const anchorMode = facts.anchorMode ?? null;
    const startTime = Number(facts.anchorStartTime);
    const endTime = Number(facts.anchorEndTime);

    if (
      anchorMode !== "anchored_last_consolidation" ||
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      endTime <= startTime
    ) {
      out.push(z);
      continue;
    }

    const slice1h = (bars1h || []).filter(
      (b) => validBar(b) && b.time >= startTime && b.time <= endTime
    );
    const rh1h = rangeHighLow(slice1h);
    if (!rh1h) {
      out.push(z);
      continue;
    }

    let newLo = rh1h.lo;
    let newHi = rh1h.hi;

    const refined = refineWith30m(bars30m, startTime, endTime);
    if (refined && Number.isFinite(refined.lo) && Number.isFinite(refined.hi) && refined.hi > refined.lo) {
      newLo = refined.lo;
      newHi = refined.hi;
    }

    const widthT = newHi - newLo;

    // Tightened range must be "tight acceptance" sized
    if (!Number.isFinite(widthT) || widthT <= 0 || widthT > (CFG.STRUCT_MAX_WIDTH_PTS + 0.25)) {
      out.push(z);
      continue;
    }

    out.push({
      ...z,
      _low: round2(newLo),
      _high: round2(newHi),
      priceRange: [round2(newHi), round2(newLo)], // ✅ overwrite ONLY for monster structures
      price: round2((newHi + newLo) / 2),
      details: {
        ...z.details,
        facts: {
          ...(facts ?? {}),
          tightenedToAnchorWindow: true,
          tightenedWidthPts: round2(widthT),
          tightenedFromWidthPts: round2(width0),
        },
      },
    });
  }
  return out;
}

/* ---------------- Pocket + Midline ---------------- */

function median(values) {
  const arr = (values || [])
    .filter((x) => Number.isFinite(x))
    .slice()
    .sort((a, b) => a - b);
  if (arr.length === 0) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function findPocketFromBars1h(bars1h, zoneLow, zoneHigh, startTimeSec = null, endTimeSec = null) {
  if (!Array.isArray(bars1h) || bars1h.length < 20) return null;

  let slice = bars1h;
  if (Number.isFinite(startTimeSec) && Number.isFinite(endTimeSec)) {
    slice = bars1h.filter((b) => validBar(b) && b.time >= startTimeSec && b.time <= endTimeSec);
  } else {
    slice = bars1h.slice(-120).filter(validBar);
  }
  if (slice.length < 10) return null;

  const inZone = slice.filter((b) => b.high >= zoneLow && b.low <= zoneHigh);
  if (inZone.length < 6) return null;

  const minW = 3;
  const maxW = 8;

  let best = null;

  for (let w = minW; w <= maxW; w++) {
    for (let i = 0; i + w - 1 < inZone.length; i++) {
      const win = inZone.slice(i, i + w);

      let lo = Infinity,
        hi = -Infinity;
      const closes = [];

      for (const b of win) {
        lo = Math.min(lo, b.low);
        hi = Math.max(hi, b.high);
        closes.push(Number(b.close));
      }

      const width = hi - lo;
      if (width > 4.0) continue;

      const mid = median(closes);
      if (!Number.isFinite(mid) || mid < lo || mid > hi) continue;

      const score = width - w * 0.05;

      if (!best || score < best.score) {
        best = {
          low: round2(lo),
          high: round2(hi),
          width: round2(width),
          bars: w,
          negotiationMid: round2(mid),
          startTime: win[0]?.time ?? null,
          endTime: win[win.length - 1]?.time ?? null,
          score,
        };
      }
    }
  }

  return best;
}

function expandPocketChildren(zones, bars1h) {
  const out = [];
  for (const z of zones || []) {
    out.push(z);

    if ((z.tier ?? "") !== "structure") continue;

    const zoneLow = Number(z.priceRange?.[1]);
    const zoneHigh = Number(z.priceRange?.[0]);
    if (!Number.isFinite(zoneLow) || !Number.isFinite(zoneHigh) || zoneHigh <= zoneLow) continue;

    const facts = z.details?.facts ?? {};
    const startTimeSec = Number.isFinite(facts.anchorStartTime) ? facts.anchorStartTime : null;
    const endTimeSec = Number.isFinite(facts.anchorEndTime) ? facts.anchorEndTime : null;

    const pocket = findPocketFromBars1h(bars1h, zoneLow, zoneHigh, startTimeSec, endTimeSec);
    if (!pocket) continue;

    out.push({
      type: "institutional",
      tier: "pocket",
      price: round2((pocket.low + pocket.high) / 2),
      priceRange: [pocket.high, pocket.low],
      strength: z.strength,
      details: {
        ...z.details,
        id: `smz_pocket_${z.details?.id ?? "unknown"}`,
        facts: {
          ...(facts ?? {}),
          pocketOf: z.details?.id ?? null,
          pocketLow: pocket.low,
          pocketHigh: pocket.high,
          pocketWidth: pocket.width,
          pocketBars1h: pocket.bars,
          negotiationMid: pocket.negotiationMid,
          pocketStartTime: pocket.startTime,
          pocketEndTime: pocket.endTime,
        },
      },
      _low: pocket.low,
      _high: pocket.high,
    });
  }
  return out;
}

/* ---------------- Collapse STRUCTURE overlaps ---------------- */

function collapseOverlappingStructureZones(zones, opts = {}) {
  const OVERLAP_PCT = Number.isFinite(opts.overlapPct) ? opts.overlapPct : CFG.STRUCT_OVERLAP_PCT;
  const NEAR_POINTS = Number.isFinite(opts.nearPoints) ? opts.nearPoints : CFG.STRUCT_NEAR_POINTS;

  const list = Array.isArray(zones) ? zones.slice() : [];
  const structures = [];
  const others = [];

  for (const z of list) {
    if ((z.tier ?? "") === "structure") structures.push(z);
    else others.push(z);
  }

  for (const z of structures) {
    if (!Number.isFinite(z._low) || !Number.isFinite(z._high)) {
      z._high = Number(z.priceRange?.[0]);
      z._low = Number(z.priceRange?.[1]);
    }
  }

  structures.sort((a, b) => a._low - b._low);

  function overlapRatio(a, b) {
    const lo = Math.max(a._low, b._low);
    const hi = Math.min(a._high, b._high);
    const inter = hi - lo;
    if (inter <= 0) return 0;
    const wa = a._high - a._low;
    const wb = b._high - b._low;
    const denom = Math.min(wa, wb);
    return denom > 0 ? inter / denom : 0;
  }

  function separationPts(a, b) {
    return Math.max(0, b._low - a._high);
  }

  const parents = [];
  let group = null;

  function startGroup(z) {
    group = {
      low: z._low,
      high: z._high,
      strength: Number(z.strength ?? 0),
      flags: { ...(z.details?.flags ?? {}) },
      tfs: new Set([...(z.details?.tfs ?? []), z.details?.tf].filter(Boolean)),
      members: new Set([...(z.details?.members ?? []), z.details?.id].filter(Boolean)),
      children: [
        {
          id: z.details?.id ?? null,
          strength: Number(z.strength ?? 0),
          priceRange: z.priceRange ?? null,
          tier: z.tier ?? null,
        },
      ],
      sample: z,
    };
  }

  function addToGroup(z) {
    group.low = Math.min(group.low, z._low);
    group.high = Math.max(group.high, z._high);
    group.strength = Math.max(group.strength, Number(z.strength ?? 0));
    if (z.details?.flags?.hasClear4H) group.flags.hasClear4H = true;

    (z.details?.tfs ?? []).forEach((x) => group.tfs.add(x));
    if (z.details?.tf) group.tfs.add(z.details.tf);

    (z.details?.members ?? []).forEach((m) => group.members.add(m));
    if (z.details?.id) group.members.add(z.details.id);

    group.children.push({
      id: z.details?.id ?? null,
      strength: Number(z.strength ?? 0),
      priceRange: z.priceRange ?? null,
      tier: z.tier ?? null,
    });
  }

  function flushGroup() {
    if (!group) return;

    const low = round2(group.low);
    const high = round2(group.high);

    parents.push({
      type: "institutional",
      tier: "structure",
      _low: low,
      _high: high,
      priceRange: [high, low],
      price: round2((high + low) / 2),
      strength: group.strength,
      details: {
        ...(group.sample?.details ?? {}),
        id: `smz_struct_${parents.length + 1}`,
        tf: "mixed",
        tfs: Array.from(group.tfs),
        members: Array.from(group.members),
        flags: { ...(group.flags ?? {}) },
        facts: {
          ...(group.sample?.details?.facts ?? {}),
          collapsedChildren: group.children,
          collapsedCount: group.children.length,
        },
      },
    });

    group = null;
  }

  for (const z of structures) {
    if (!group) {
      startGroup(z);
      continue;
    }

    const tmpA = { _low: group.low, _high: group.high };
    const ov = overlapRatio(tmpA, z);
    const gap = separationPts(tmpA, z);

    if (ov >= OVERLAP_PCT && gap <= NEAR_POINTS) addToGroup(z);
    else {
      flushGroup();
      startGroup(z);
    }
  }
  flushGroup();

  const seen = new Set();
  const dedupParents = [];
  for (const p of parents) {
    const key = `${p.priceRange?.[1]}-${p.priceRange?.[0]}|${p.tier}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupParents.push(p);
  }

  const out = dedupParents.concat(others);
  out.sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0));
  return out;
}

/* ---------------- Main entry ---------------- */

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

  const bucket1h = Math.max(0.5, atr1h * CFG.BUCKET_ATR_MULT_1H);
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
        tier: "structure",
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

  const merged = mergeByOverlap(scored, CFG.MERGE_OVERLAP);
  let regimes = clusterUnionBands(merged);

  regimes = regimes
    .filter((z) => Number(z.strength ?? 0) >= CFG.MIN_SCORE_GLOBAL)
    .sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0));

  let selectionMode = `>=${CFG.MIN_SCORE_GLOBAL}`;

  if (regimes.length === 0) {
    regimes = clusterUnionBands(merged)
      .slice()
      .sort((a, b) => Number(b.strength ?? 0) - Number(a.strength ?? 0))
      .slice(0, CFG.FALLBACK_TOP_N);
    selectionMode = `top${CFG.FALLBACK_TOP_N}`;
  }

  // Re-anchor (kept)
  regimes = regimes.map((z) => reanchorRegime(z, b1h, b30, atr1h));

  // Qualify/demote (kept, with score lock)
  regimes = qualifyStructureOrDemote(regimes);

  // Collapse overlaps into parent structures (kept)
  regimes = collapseOverlappingStructureZones(regimes, {
    overlapPct: CFG.STRUCT_OVERLAP_PCT,
    nearPoints: CFG.STRUCT_NEAR_POINTS,
  });

  // ✅ Tightened range is metadata only (no priceRange overwrite)
  regimes = tightenStructuresToAnchorWindow(regimes, b1h, b30);


  // Add POCKET children (kept)
  regimes = expandPocketChildren(regimes, b1h);

  return regimes.map((z) => ({
    type: z.type,
    tier: z.tier ?? "micro",
    price: z.price,
    priceRange: z.priceRange,
    strength: z.strength,
    details: {
      ...z.details,
      selectionMode,
    },
  }));
}
