// src/services/core/logic/smzInstitutionalRubric.js
// Institutional SMZ rubric scorer (diagnostic truth).
// - Scoring ONLY (no detection).
// - No hard caps/gates applied; flags report what WOULD be required.
// - Uses modular scorers for Compression/Wicks/Retests to avoid “fake” inflation.
//
// Output contract (required by smzEngine.js):
// { scoreTotal, parts, flags, facts }

import { scoreCompression } from "./smzScoreCompression.js";
import { scoreWicks } from "./smzScoreWicks.js";
import { scoreRetests } from "./smzScoreRetests.js";

/* ------------------------------- Helpers ------------------------------- */

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function toSec(t) {
  const n = Number(t ?? 0);
  return n > 1e12 ? Math.floor(n / 1000) : n;
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

/* ---------------------- Q helpers (same rubric style) ---------------------- */

// Q1 duration (0/12/20) based on compression trading days
function compressionDurationPoints(tradingDays) {
  if (tradingDays >= 7) return 20;
  if (tradingDays >= 4) return 12;
  return 0;
}

// Q2 tightness (3/9/15) based on zone width (pts)
function tightnessPoints(widthPts) {
  if (widthPts <= 2.0) return 15;
  if (widthPts <= 4.0) return 9;
  return 3;
}

// Q3 failed attempts count -> points (0/4/8/12)
function failedAttemptsCount(bars1h, lo, hi) {
  const EPS = 0.10; // points
  let attempts = 0;
  let cooldown = 0;

  for (const b of bars1h) {
    if (!validBar(b)) continue;
    if (cooldown > 0) {
      cooldown--;
      continue;
    }

    // “Pierce then fail” attempt
    const upperPierce = b.high > hi + EPS && b.close <= hi;
    const lowerPierce = b.low < lo - EPS && b.close >= lo;

    if (upperPierce || lowerPierce) {
      attempts++;
      cooldown = 3; // avoid counting clustered bars as separate attempts
    }
  }

  return attempts;
}

function failedAttemptsPoints(attempts) {
  if (attempts >= 3) return 12;
  if (attempts === 2) return 8;
  if (attempts === 1) return 4;
  return 0;
}

// Q4 wick clarity points (2/5/8) derived from wick module facts
function wickClarityPointsFromModule(wickAvgPtsPerTouchBar, wickTouchBars) {
  // Maintain same rubric thresholds you used before:
  // - >=1.20 strong, >=0.70 mixed, else weak
  if ((wickTouchBars ?? 0) < 2) return 2;
  if ((wickAvgPtsPerTouchBar ?? 0) >= 1.2) return 8;
  if ((wickAvgPtsPerTouchBar ?? 0) >= 0.7) return 5;
  return 2;
}

// Q5 retest holds (0/8/10/12) based on retestDays
function retestHoldPointsFromDays(days) {
  if (days <= 0) return 0;
  if (days === 1) return 8;
  if (days === 2) return 10;
  return 12;
}

// Q6 reaction (3/5/8) using ATR-scaled displacement after last touch
function reactionAfterLastTouchPoints(bars1h, lo, hi) {
  const atr = computeATR(bars1h, 50);
  let lastTouch = -1;

  for (let i = bars1h.length - 1; i >= 0; i--) {
    if (intersectsBarZone(bars1h[i], lo, hi)) {
      lastTouch = i;
      break;
    }
  }

  if (lastTouch < 0 || lastTouch >= bars1h.length - 2) return 3;

  const center = (lo + hi) / 2;
  const look = Math.min(bars1h.length - 1, lastTouch + 6);

  let best = 0;
  for (let i = lastTouch + 1; i <= look; i++) {
    const b = bars1h[i];
    if (!validBar(b)) continue;
    best = Math.max(best, Math.abs(b.close - center) / Math.max(atr, 1e-6));
  }

  if (best >= 1.2) return 8;
  if (best >= 0.7) return 5;
  return 3;
}

// Q7/Q8 TF agreement
function tfAgreementPoints(bars4h, lo, hi) {
  let touches = 0;
  for (const b of bars4h) if (intersectsBarZone(b, lo, hi)) touches++;

  const q7 = touches >= 3 ? 10 : touches >= 1 ? 6 : 0;
  const q8 = touches >= 3 ? 5 : touches >= 1 ? 3 : 1;

  return { q7, q8, touches4h: touches };
}

// Q9/Q10 breakout speed/distance (low priority)
function breakoutSpeedDistancePoints(bars1h, lo, hi) {
  const atr = computeATR(bars1h, 50);

  let lastTouch = -1;
  for (let i = bars1h.length - 1; i >= 0; i--) {
    if (intersectsBarZone(bars1h[i], lo, hi)) {
      lastTouch = i;
      break;
    }
  }
  if (lastTouch < 0) return { q9: 1, q10: 1 };

  const center = (lo + hi) / 2;

  // Speed: best move within 6 bars
  let best6 = 0;
  for (let i = lastTouch + 1; i <= Math.min(bars1h.length - 1, lastTouch + 6); i++) {
    const b = bars1h[i];
    if (!validBar(b)) continue;
    best6 = Math.max(best6, Math.abs(b.close - center) / Math.max(atr, 1e-6));
  }
  const q9 = best6 >= 1.2 ? 5 : best6 >= 0.7 ? 3 : 1;

  // Distance: best excursion within 12 bars
  let best12 = 0;
  for (let i = lastTouch + 1; i <= Math.min(bars1h.length - 1, lastTouch + 12); i++) {
    const b = bars1h[i];
    if (!validBar(b)) continue;
    best12 = Math.max(best12, Math.abs(b.high - center) / Math.max(atr, 1e-6));
    best12 = Math.max(best12, Math.abs(center - b.low) / Math.max(atr, 1e-6));
  }
  const q10 = best12 >= 2.0 ? 5 : best12 >= 1.2 ? 3 : 1;

  return { q9, q10 };
}

// Q11/Q12 structural context
function contextPoints(bars1h, lo, hi) {
  const look = bars1h.slice(-120);
  if (!look.length) return { q11: 3, q12: 1, breaks: 0 };

  const maxH = Math.max(...look.map((b) => b.high));
  const minL = Math.min(...look.map((b) => b.low));
  const atr = computeATR(look, 50);

  const nearHigh = Math.abs(hi - maxH) <= Math.max(0.5, 0.8 * atr);
  const nearLow = Math.abs(lo - minL) <= Math.max(0.5, 0.8 * atr);

  const q11 = nearHigh || nearLow ? 5 : 3;

  const EPS = Math.max(0.15, 0.1 * zoneWidth(lo, hi));
  let breaks = 0;
  for (const b of look) {
    if (!validBar(b)) continue;
    if (b.close > hi + EPS || b.close < lo - EPS) breaks++;
  }

  const q12 = breaks <= 1 ? 5 : breaks <= 3 ? 3 : 1;

  return { q11, q12, breaks };
}

/* ------------------------------ Main Export ------------------------------ */

export function scoreInstitutionalRubric(input) {
  const bars1h = Array.isArray(input?.bars1h) ? input.bars1h : [];
  const bars4h = Array.isArray(input?.bars4h) ? input.bars4h : [];
  const currentPrice = Number(input?.currentPrice);

  // Support BOTH call styles:
  // A) { lo, hi, bars1h, bars4h, currentPrice }
  // B) { zone, bars1h, bars4h, currentPrice }
  const lo =
    Number(input?.lo) ??
    Number(
      input?.zone?.price_low ??
        input?.zone?.low ??
        input?.zone?.min ??
        input?.zone?.priceRange?.[1]
    );

  const hi =
    Number(input?.hi) ??
    Number(
      input?.zone?.price_high ??
        input?.zone?.high ??
        input?.zone?.max ??
        input?.zone?.priceRange?.[0]
    );

  const low = Number(lo);
  const high = Number(hi);

  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return {
      scoreTotal: 0,
      parts: {},
      flags: { reason: "invalid_zone_bounds" },
      facts: { reason: "invalid_zone_bounds" },
    };
  }

  const widthPts = zoneWidth(low, high);

  // ✅ MODULES (truth sources)
  const comp = scoreCompression({ lo: low, hi: high, bars1h }); // 0..35
  const w = scoreWicks({ lo: low, hi: high, bars1h }); // 0..30
  const r = scoreRetests({ lo: low, hi: high, bars1h }); // 0..35

  // Map module facts into Q-scale (keep your familiar Q1–Q12 structure)
  const compressionDays = Number(comp?.facts?.compressionDays ?? 0);

  const q1 = compressionDurationPoints(compressionDays); // 0/12/20
  const q2 = tightnessPoints(widthPts); // 3/9/15

  const attempts = failedAttemptsCount(bars1h, low, high);
  const q3 = failedAttemptsPoints(attempts); // 0/4/8/12

  const wickAvgPts = Number(w?.facts?.wickAvgPtsPerTouchBar ?? 0);
  const wickTouchBars = Number(w?.facts?.wickTouchBars ?? 0);
  const q4 = wickClarityPointsFromModule(wickAvgPts, wickTouchBars); // 2/5/8

  const retestDays = Number(r?.facts?.retestDays ?? 0);
  const q5 = retestHoldPointsFromDays(retestDays); // 0/8/10/12
  const q6 = reactionAfterLastTouchPoints(bars1h, low, high); // 3/5/8

  const { q7, q8, touches4h } = tfAgreementPoints(bars4h, low, high); // 0..10 and 1..5
  const { q9, q10 } = breakoutSpeedDistancePoints(bars1h, low, high); // 1..5
  const { q11, q12, breaks } = contextPoints(bars1h, low, high); // 3/5 and 1/3/5

  // Total points (legacy style) — then clamped to 0–100 for UI
  const rawTotal =
    (q1 + q2) +
    (q3 + q4) +
    (q5 + q6) +
    (q7 + q8) +
    (q9 + q10) +
    (q11 + q12);

  const scoreTotal = Math.round(clamp(rawTotal, 0, 100));

  // Flags (diagnostic gates only — no caps applied)
  const hasCompression = q1 > 0 && q2 >= 9;
  const hasRejection = q4 >= 5 || q3 > 0;
  const hasRetest = q5 > 0;
  const hasClear4H = q7 === 10;

  const mid = (low + high) / 2;
  const distPts = Number.isFinite(currentPrice) ? Math.abs(mid - currentPrice) : null;

  // Parts: preserve the “bucket” view for teammate debugging
  const parts = {
    compression: {
      points: q1 + q2,
      q1_duration: q1,
      q2_tightness: q2,
      modulePoints0to35: comp?.points ?? null,
    },
    rejection: {
      points: q3 + q4,
      q3_failedAttempts: q3,
      q4_wickClarity: q4,
      wickModulePoints0to30: w?.points ?? null,
    },
    retests: {
      points: q5 + q6,
      q5_retestHold: q5,
      q6_retestReaction: q6,
      retestModulePoints0to35: r?.points ?? null,
    },
    timeframe: {
      points: q7 + q8,
      q7_4hPresence: q7,
      q8_tfNesting: q8,
    },
    displacement: {
      points: q9 + q10,
      q9_speed: q9,
      q10_distance: q10,
    },
    context: {
      points: q11 + q12,
      q11_location: q11,
      q12_integrity: q12,
    },
  };

  const flags = {
    capApplied: "none",
    wouldCap79: !(hasCompression && hasRejection && hasRetest),
    wouldCap99: !hasClear4H,
    hasCompression,
    hasRejection,
    hasRetest,
    hasClear4H,
  };

  const facts = {
    low: Number(low.toFixed(2)),
    high: Number(high.toFixed(2)),
    widthPts: Number(widthPts.toFixed(2)),

    compressionDays,
    failedAttempts: attempts,

    // Wick facts (module truth)
    wickTotalPts: Number((w?.facts?.wickTotalPts ?? 0).toFixed(2)),
    wickAvgPtsPerTouchBar: Number((w?.facts?.wickAvgPtsPerTouchBar ?? 0).toFixed(3)),
    wickTouchBars: wickTouchBars,

    // Retest facts (module truth)
    retestDays: retestDays,
    retestReaction0to8: Number(r?.facts?.retestReaction0to8 ?? null),

    // TF + context facts
    touches4h,
    breaks,

    // Current distance
    distancePoints: distPts == null ? null : Number(distPts.toFixed(2)),
  };

  return { scoreTotal, parts, flags, facts };
}
