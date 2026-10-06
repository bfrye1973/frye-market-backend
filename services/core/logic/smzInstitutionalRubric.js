// src/services/core/logic/smzInstitutionalRubric.js
// Frye Institutional Rubric — v2 (Compression Pocket Priority + 2-Month Memory)
//
// PURPOSE:
// - Make tight consolidation pockets the top priority
// - Reward recent (2-month) repeated tight-pocket episodes near the zone
// - Keep behavior-first approach (no candle patterns, no indicators-only logic)
// - Preserve caps: missing core/pocket -> cap85; missing clear 4H -> cap95
//
// LOOKBACK:
// - "2 months" = ~40 trading days on 1H (~40*6.5h ≈ 260 1H bars)
// - We approximate with last 260 1H bars.

import { scoreCompression } from "./smzScoreCompression.js";
import { scoreWicks } from "./smzScoreWicks.js";
import { scoreRetests } from "./smzScoreRetests.js";

/* ------------------------------- Helpers ------------------------------- */

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function validBar(b) {
  return (
    b &&
    Number.isFinite(b.high) &&
    Number.isFinite(b.low) &&
    Number.isFinite(b.open) &&
    Number.isFinite(b.close)
  );
}

function intersectsBarZone(b, lo, hi) {
  return validBar(b) && b.high >= lo && b.low <= hi;
}

function zoneWidth(lo, hi) {
  return Math.max(0, hi - lo);
}

function computeATR(bars, period = 50) {
  if (!Array.isArray(bars) || bars.length < 2) return 1;
  const n = bars.length;
  const start = Math.max(1, n - period);

  let sum = 0;
  let cnt = 0;

  for (let i = start; i < n; i++) {
    const c = bars[i];
    const p = bars[i - 1];
    if (!validBar(c) || !validBar(p)) continue;

    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );

    if (Number.isFinite(tr)) {
      sum += tr;
      cnt++;
    }
  }

  const atr = cnt ? sum / cnt : 1;
  return atr > 0 ? atr : 1;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/* -------------------- Pocket detection (inside the zone) -------------------- */
/**
 * We look for a "tight consolidation pocket" inside the zone:
 * - window length: 6–12 bars
 * - window width (maxHigh - minLow) <= 4.0 points (SPY)
 * - prefer <= 3.0 for stronger bonus
 * - bars should mostly overlap the pocket range (high overlap)
 *
 * Returns:
 * { ok, pocketLow, pocketHigh, pocketWidth, bars, startIdx, endIdx, overlapRatio }
 */
function findBestPocketInLookback(bars1h, lo, hi, lookbackBars = 120) {
  if (!Array.isArray(bars1h) || bars1h.length < 20) return { ok: false };

  const end = bars1h.length - 1;
  const start = Math.max(0, end - lookbackBars);

  const slice = bars1h.slice(start, end + 1).filter(validBar);
  if (slice.length < 20) return { ok: false };

  // scan windows 6–12
  const minW = 6;
  const maxW = 12;

  let best = null;

  for (let w = minW; w <= maxW; w++) {
    for (let i = 0; i + w - 1 < slice.length; i++) {
      const window = slice.slice(i, i + w);

      // require some interaction with zone (not totally outside)
      let anyTouches = 0;
      for (const b of window) if (intersectsBarZone(b, lo, hi)) anyTouches++;
      if (anyTouches < Math.max(3, Math.floor(w * 0.5))) continue;

      let wLow = Infinity;
      let wHigh = -Infinity;
      for (const b of window) {
        wLow = Math.min(wLow, b.low);
        wHigh = Math.max(wHigh, b.high);
      }
      const width = wHigh - wLow;

      // pocket must be tight
      if (width > 4.0) continue;

      // overlap ratio: bars overlapping the pocket range
      let overlap = 0;
      for (const b of window) {
        if (b.high >= wLow && b.low <= wHigh) overlap++;
      }
      const overlapRatio = overlap / w;

      // need high overlap (negotiation)
      if (overlapRatio < 0.85) continue;

      const score = width + (1 - overlapRatio) * 2; // prefer tightest + most overlap
      if (!best || score < best.score) {
        best = {
          ok: true,
          pocketLow: round2(wLow),
          pocketHigh: round2(wHigh),
          pocketWidth: round2(width),
          bars: w,
          startIdx: start + i,
          endIdx: start + i + w - 1,
          overlapRatio: round2(overlapRatio),
          score,
        };
      }
    }
  }

  return best || { ok: false };
}

/* -------------------- 2-month "episode" memory scan -------------------- */
/**
 * Episode definition (your rule):
 * - One episode = one cluster of pocket windows close in time.
 * - If we find many pockets within a short span, count as ONE.
 *
 * Implementation:
 * - Scan last ~260 bars (≈40 trading days @ 1H).
 * - Identify qualifying pocket windows (same criteria as above).
 * - Count episodes by clustering hits with a cooldown (e.g., 24 bars).
 *
 * Returns:
 * { episodes, bestWidth }
 */
function pocketEpisodes2m(bars1h, lo, hi) {
  if (!Array.isArray(bars1h) || bars1h.length < 60) return { episodes: 0, bestWidth: null };

  const LOOKBACK = 260;       // ~40 trading days in 1H bars
  const COOLDOWN = 24;        // cluster hits within ~1 trading day into one episode

  const end = bars1h.length - 1;
  const start = Math.max(0, end - LOOKBACK);

  const slice = bars1h.slice(start, end + 1).filter(validBar);
  if (slice.length < 60) return { episodes: 0, bestWidth: null };

  const minW = 6;
  const maxW = 12;

  let episodes = 0;
  let cooldown = 0;
  let bestWidth = null;

  for (let i = 0; i < slice.length; i++) {
    if (cooldown > 0) {
      cooldown--;
      continue;
    }

    // check if any window starting here qualifies as a pocket
    let found = false;
    let foundWidth = null;

    for (let w = minW; w <= maxW; w++) {
      if (i + w - 1 >= slice.length) break;
      const window = slice.slice(i, i + w);

      let anyTouches = 0;
      for (const b of window) if (intersectsBarZone(b, lo, hi)) anyTouches++;
      if (anyTouches < Math.max(3, Math.floor(w * 0.5))) continue;

      let wLow = Infinity;
      let wHigh = -Infinity;
      for (const b of window) {
        wLow = Math.min(wLow, b.low);
        wHigh = Math.max(wHigh, b.high);
      }
      const width = wHigh - wLow;
      if (width > 4.0) continue;

      let overlap = 0;
      for (const b of window) if (b.high >= wLow && b.low <= wHigh) overlap++;
      const overlapRatio = overlap / w;
      if (overlapRatio < 0.85) continue;

      found = true;
      foundWidth = width;
      break;
    }

    if (found) {
      episodes++;
      cooldown = COOLDOWN;

      if (Number.isFinite(foundWidth)) {
        bestWidth = bestWidth == null ? foundWidth : Math.min(bestWidth, foundWidth);
      }
    }
  }

  return { episodes, bestWidth: bestWidth == null ? null : round2(bestWidth) };
}

/* ---------------------- Updated scoring point tables ---------------------- */

// A1: compression duration points (0 / 8 / 16)
function durationPts(tradingDays) {
  if (tradingDays >= 7) return 16;
  if (tradingDays >= 4) return 8;
  return 0;
}

// A2: tightness points (4 / 12 / 20)
function tightnessPts(widthPts) {
  if (widthPts <= 2.0) return 20;
  if (widthPts <= 4.0) return 12;
  return 4;
}

// A3: pocket present points (0 / 5 / 9)
function pocketPts(pocketWidth) {
  if (!Number.isFinite(pocketWidth)) return 0;
  if (pocketWidth <= 3.0) return 9;
  if (pocketWidth <= 4.0) return 5;
  return 0;
}

// B1: failed attempts (0/4/7/10)
function failedAttemptsPoints(attempts) {
  if (attempts >= 3) return 10;
  if (attempts === 2) return 7;
  if (attempts === 1) return 4;
  return 0;
}

// B2: wick clarity (2/5/8) (keep your current behavior)
function wickClarityPointsFromModule(wickAvgPtsPerTouchBar, wickTouchBars) {
  if ((wickTouchBars ?? 0) < 2) return 2;
  if ((wickAvgPtsPerTouchBar ?? 0) >= 1.2) return 8;
  if ((wickAvgPtsPerTouchBar ?? 0) >= 0.7) return 5;
  return 2;
}

// C1: retest hold (0/6/8/10)
function retestHoldPointsFromDays(days) {
  if (days <= 0) return 0;
  if (days === 1) return 6;
  if (days === 2) return 8;
  return 10;
}

// C2: reaction after last touch (2/3/4)
function reactionAfterLastTouchPoints(bars1h, lo, hi) {
  const atr = computeATR(bars1h, 50);
  let lastTouch = -1;

  for (let i = bars1h.length - 1; i >= 0; i--) {
    if (intersectsBarZone(bars1h[i], lo, hi)) { lastTouch = i; break; }
  }
  if (lastTouch < 0 || lastTouch >= bars1h.length - 2) return 2;

  const center = (lo + hi) / 2;
  const look = Math.min(bars1h.length - 1, lastTouch + 6);

  let best = 0;
  for (let i = lastTouch + 1; i <= look; i++) {
    const b = bars1h[i];
    if (!validBar(b)) continue;
    best = Math.max(best, Math.abs(b.close - center) / Math.max(atr, 1e-6));
  }

  if (best >= 1.2) return 4;
  if (best >= 0.7) return 3;
  return 2;
}

// 4H agreement points (max 10 total)
function tfAgreementPoints(bars4h, lo, hi) {
  let touches = 0;
  for (const b of bars4h) if (intersectsBarZone(b, lo, hi)) touches++;

  const q7 = touches >= 3 ? 8 : touches >= 1 ? 6 : 0;
  const q8 = touches >= 3 ? 2 : 1; // always at least 1
  return { q7, q8, touches4h: touches };
}

// Displacement points (max 8), but can be halved later if not tight
function breakoutSpeedDistancePoints(bars1h, lo, hi) {
  const atr = computeATR(bars1h, 50);

  let lastTouch = -1;
  for (let i = bars1h.length - 1; i >= 0; i--) {
    if (intersectsBarZone(bars1h[i], lo, hi)) { lastTouch = i; break; }
  }
  if (lastTouch < 0) return { q9: 1, q10: 1 };

  const center = (lo + hi) / 2;

  let best6 = 0;
  for (let i = lastTouch + 1; i <= Math.min(bars1h.length - 1, lastTouch + 6); i++) {
    const b = bars1h[i];
    if (!validBar(b)) continue;
    best6 = Math.max(best6, Math.abs(b.close - center) / Math.max(atr, 1e-6));
  }
  const q9 = best6 >= 1.2 ? 4 : best6 >= 0.7 ? 2 : 1;

  let best12 = 0;
  for (let i = lastTouch + 1; i <= Math.min(bars1h.length - 1, lastTouch + 12); i++) {
    const b = bars1h[i];
    if (!validBar(b)) continue;
    best12 = Math.max(best12, Math.abs(b.high - center) / Math.max(atr, 1e-6));
    best12 = Math.max(best12, Math.abs(center - b.low) / Math.max(atr, 1e-6));
  }
  const q10 = best12 >= 2.0 ? 4 : best12 >= 1.2 ? 2 : 1;

  return { q9, q10 };
}

// Context reduced (max 5)
function contextPoints(bars1h, lo, hi) {
  const look = bars1h.slice(-240);
  if (!look.length) return { q11: 2, q12: 1, breaks: 0 };

  const maxH = Math.max(...look.map((b) => b.high));
  const minL = Math.min(...look.map((b) => b.low));
  const atr = computeATR(look, 50);

  const nearHigh = Math.abs(hi - maxH) <= Math.max(0.5, 0.8 * atr);
  const nearLow = Math.abs(lo - minL) <= Math.max(0.5, 0.8 * atr);
  const q11 = nearHigh || nearLow ? 3 : 2;

  const EPS = Math.max(0.15, 0.1 * zoneWidth(lo, hi));
  let breaks = 0;
  for (const b of look) {
    if (!validBar(b)) continue;
    if (b.close > hi + EPS || b.close < lo - EPS) breaks++;
  }

  const q12 = breaks <= 2 ? 2 : breaks <= 6 ? 1 : 0;
  return { q11, q12, breaks };
}

// Penalty unchanged shape
function breakPenaltyPoints(breaks) {
  if (breaks <= 2) return 0;
  if (breaks <= 6) return 6;
  if (breaks <= 12) return 12;
  return 18;
}

// Failed attempts count (keep your logic)
function failedAttemptsCount(bars1h, lo, hi) {
  const EPS = 0.10;
  let attempts = 0;
  let cooldown = 0;

  for (const b of bars1h) {
    if (!validBar(b)) continue;
    if (cooldown > 0) { cooldown--; continue; }

    const upperPierce = b.high > hi + EPS && b.close <= hi;
    const lowerPierce = b.low < lo - EPS && b.close >= lo;

    if (upperPierce || lowerPierce) {
      attempts++;
      cooldown = 3;
    }
  }
  return attempts;
}

/* ------------------------------- Main ------------------------------- */

export function scoreInstitutionalRubric(input) {
  const bars1h = Array.isArray(input?.bars1h) ? input.bars1h : [];
  const bars4h = Array.isArray(input?.bars4h) ? input.bars4h : [];
  const currentPrice = Number(input?.currentPrice);

  const lo = Number(input?.lo ?? input?.zone?.priceRange?.[1]);
  const hi = Number(input?.hi ?? input?.zone?.priceRange?.[0]);

  const low = Number(lo);
  const high = Number(hi);

  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return { scoreTotal: 0, parts: {}, flags: { reason: "invalid_zone_bounds" }, facts: {} };
  }

  const widthPts = zoneWidth(low, high);

  // Existing modules (kept)
  const comp = scoreCompression({ lo: low, hi: high, bars1h });
  const w = scoreWicks({ lo: low, hi: high, bars1h });
  const r = scoreRetests({ lo: low, hi: high, bars1h });

  const compressionDays = Number(comp?.facts?.compressionDays ?? 0);
  const attempts = failedAttemptsCount(bars1h, low, high);

  const wickAvgPts = Number(w?.facts?.wickAvgPtsPerTouchBar ?? 0);
  const wickTouchBars = Number(w?.facts?.wickTouchBars ?? 0);

  const retestDays = Number(r?.facts?.retestDays ?? 0);

  // Pocket detection now (recent lookback)
  const pocketNow = findBestPocketInLookback(bars1h, low, high, 120);
  const pocketNowWidth = pocketNow?.ok ? Number(pocketNow.pocketWidth) : null;

  // 2-month memory episodes (≈40 trading days)
  const mem = pocketEpisodes2m(bars1h, low, high);
  const episodes2m = Number(mem.episodes ?? 0);
  const bestHistWidth2m = mem.bestWidth;

  // ---------------- A) Compression dominance (max 45) ----------------
  const A1 = durationPts(compressionDays);        // 0/8/16
  const A2 = tightnessPts(widthPts);              // 4/12/20
  const A3 = pocketPts(pocketNowWidth);           // 0/5/9

  const compressionTotal = A1 + A2 + A3;          // max 45

  // ---------------- B) Rejection (max 18) ----------------
  const B1 = failedAttemptsPoints(attempts);      // 0/4/7/10
  const B2 = wickClarityPointsFromModule(wickAvgPts, wickTouchBars); // 2/5/8
  const rejectionTotal = B1 + B2;                 // max 18

  // ---------------- C) Retest (max 14) ----------------
  const C1 = retestHoldPointsFromDays(retestDays);          // 0/6/8/10
  const C2 = reactionAfterLastTouchPoints(bars1h, low, high); // 2/3/4
  const retestTotal = C1 + C2;                              // max 14

  // ---------------- D) Displacement confirm-only (max 8) ----------------
  let { q9: D1, q10: D2 } = breakoutSpeedDistancePoints(bars1h, low, high); // max 4+4
  let displacementTotal = D1 + D2; // max 8

  // If not tight (A2 < 12 => width > 4), displacement cannot rescue it
  const isTightEnough = A2 >= 12;
  if (!isTightEnough) displacementTotal = Math.round(displacementTotal / 2);

  // ---------------- E) Multi-TF (max 10) ----------------
  const tf = tfAgreementPoints(bars4h, low, high);
  const E1 = tf.q7;
  const E2 = tf.q8;
  const tfTotal = E1 + E2; // max 10

  // ---------------- F) Context reduced (max 5) ----------------
  const ctx = contextPoints(bars1h, low, high);
  const F1 = ctx.q11;
  const F2 = ctx.q12;
  const contextTotal = F1 + F2; // max 5

  // ---------------- Memory bonus (2 months) max 15 ----------------
  let memoryPts = 0;
  if (episodes2m <= 0) memoryPts = 0;
  else if (episodes2m === 1) memoryPts = 5;
  else if (episodes2m === 2) memoryPts = 9;
  else memoryPts = 15;

  // quality bump: if best historical pocket ≤3.0, treat as one tier higher
  if (bestHistWidth2m != null && bestHistWidth2m <= 3.0) {
    if (memoryPts === 5) memoryPts = 9;
    else if (memoryPts === 9) memoryPts = 15;
  }

  // ---------------- Penalty ----------------
  const penalty = breakPenaltyPoints(ctx.breaks);

  // Raw score
  const rawTotal =
    compressionTotal +
    rejectionTotal +
    retestTotal +
    displacementTotal +
    tfTotal +
    contextTotal +
    memoryPts;

  const penalized = rawTotal - penalty;

  // ---------------- Caps / Gates (LOCKED intent) ----------------
  // Core requirements now include pocket:
  const hasCompression = A1 > 0 && A2 >= 12; // duration + width <= 4
  const hasPocket = A3 > 0;                 // tight pocket exists
  const hasRejection = (B2 >= 5) || (B1 >= 7);
  const hasRetest = C1 > 0;

  const passesCore = hasCompression && hasRejection && hasRetest;

  // Clear 4H means touches >=3 -> E1==8 in this v2 table
  const hasClear4H = E1 >= 8;

  let capped = penalized;
  let capApplied = "none";

  // Missing core OR missing pocket => cap 85 (your priority rule)
  if (!passesCore || !hasPocket) {
    capped = Math.min(capped, 85);
    capApplied = !passesCore ? "cap85_missing_core" : "cap85_missing_pocket";
  } else if (!hasClear4H) {
    capped = Math.min(capped, 95);
    capApplied = "cap95_no_clear4h";
  }

  const scoreTotal = Math.round(clamp(capped, 0, 100));

  const mid = (low + high) / 2;
  const distPts = Number.isFinite(currentPrice) ? Math.abs(mid - currentPrice) : null;

  const parts = {
    compression: {
      points: compressionTotal,
      A1_duration: A1,
      A2_tightness: A2,
      A3_pocket: A3,
      modulePoints0to35: comp?.points ?? null,
    },
    rejection: {
      points: rejectionTotal,
      B1_failedAttempts: B1,
      B2_wickClarity: B2,
      wickModulePoints0to30: w?.points ?? null,
    },
    retests: {
      points: retestTotal,
      C1_hold: C1,
      C2_reaction: C2,
      retestModulePoints0to35: r?.points ?? null,
    },
    displacement: {
      points: displacementTotal,
      D1_speed: D1,
      D2_distance: D2,
      halvedIfLoose: !isTightEnough,
    },
    timeframe: {
      points: tfTotal,
      E1_4hPresence: E1,
      E2_tfNesting: E2,
      touches4h: tf.touches4h,
    },
    context: {
      points: contextTotal,
      F1_location: F1,
      F2_integrity: F2,
      breaks: ctx.breaks,
      penalty,
    },
    memory2m: {
      points: memoryPts,
      episodes2m,
      bestPocketWidth2m: bestHistWidth2m,
      oneEpisodeRule: true,
    },
  };

  const flags = {
    capApplied,
    hasCompression,
    hasPocket,
    hasRejection,
    hasRetest,
    hasClear4H,
    passesCore,
  };

  const facts = {
    low: Number(low.toFixed(2)),
    high: Number(high.toFixed(2)),
    widthPts: Number(widthPts.toFixed(2)),
    compressionDays,
    failedAttempts: attempts,
    wickTouchBars,
    retestDays,
    pocketNow: pocketNow?.ok
      ? {
          low: pocketNow.pocketLow,
          high: pocketNow.pocketHigh,
          width: pocketNow.pocketWidth,
          bars: pocketNow.bars,
          overlapRatio: pocketNow.overlapRatio,
          startIdx1h: pocketNow.startIdx,
          endIdx1h: pocketNow.endIdx,
        }
      : null,
    episodes2m,
    bestPocketWidth2m: bestHistWidth2m,
    breaks: ctx.breaks,
    penalty,
    distancePoints: distPts == null ? null : Number(distPts.toFixed(2)),
  };

  return { scoreTotal, parts, flags, facts };
}
