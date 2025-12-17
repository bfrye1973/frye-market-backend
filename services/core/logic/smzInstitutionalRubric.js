// src/services/core/logic/smzInstitutionalRubric.js
// Institutional scoring rubric (Q1–Q12) + caps, using 1H bars for trading days.
// UPDATED: Wick scoring = ANY wicks anywhere in zone, length-weighted in RAW POINTS.
// UPDATED: Retest strength = unique trading days touching the zone (1H), more days => stronger.
// Scores EVERY zone and returns full diagnostic breakdown.

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function toSec(t) {
  const n = Number(t ?? 0);
  return n > 1e12 ? Math.floor(n / 1000) : n; // ms -> sec
}

function dayKeyUtc(sec) {
  const d = new Date(toSec(sec) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function intersectsBarZone(b, lo, hi) {
  return b && Number.isFinite(b.high) && Number.isFinite(b.low) && b.high >= lo && b.low <= hi;
}

function zoneWidth(lo, hi) { return Math.max(0, hi - lo); }

function computeATR(bars, period = 50) {
  if (!Array.isArray(bars) || bars.length < 2) return 1;
  const n = bars.length;
  const start = Math.max(1, n - period);
  let sum = 0, cnt = 0;
  for (let i = start; i < n; i++) {
    const c = bars[i], p = bars[i - 1];
    if (!c || !p) continue;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    if (Number.isFinite(tr)) { sum += tr; cnt++; }
  }
  const atr = cnt ? sum / cnt : 1;
  return atr > 0 ? atr : 1;
}

// Unique trading days where 1H bars touch zone
function uniqueTouchDays(bars1h, lo, hi) {
  const s = new Set();
  for (const b of bars1h) {
    if (intersectsBarZone(b, lo, hi)) s.add(dayKeyUtc(b.time));
  }
  return s;
}

// ---------- NEW WICK MODEL (points, length-weighted, any wicks in zone) ----------
function wickTotalsInZone(bars1h, lo, hi) {
  let wickTotalPts = 0;
  let wickAvgPts = 0;
  let touchBars = 0;

  for (const b of bars1h) {
    if (!intersectsBarZone(b, lo, hi)) continue;
    touchBars++;

    const bodyHi = Math.max(b.open, b.close);
    const bodyLo = Math.min(b.open, b.close);

    const upperW = Math.max(0, b.high - bodyHi);
    const lowerW = Math.max(0, bodyLo - b.low);

    wickTotalPts += (upperW + lowerW);
  }

  wickAvgPts = touchBars ? wickTotalPts / touchBars : 0;
  return { wickTotalPts, wickAvgPts, touchBars };
}

// Q4 wick clarity points (0–8) based on *average wick length per touch bar* (raw points)
function wickClarityPoints(bars1h, lo, hi) {
  const { wickAvgPts, touchBars } = wickTotalsInZone(bars1h, lo, hi);
  // If almost no interactions, keep low
  if (touchBars < 2) return 2;

  // Thresholds are intentionally simple and SPY-friendly (points, not ATR):
  // avg wick >= 1.20 pts => strong institutional absorption
  // avg wick >= 0.70 pts => decent
  // else => weak
  if (wickAvgPts >= 1.20) return 8;
  if (wickAvgPts >= 0.70) return 5;
  return 2;
}

// Q3 failed attempts (0–12) remains, but wick is the dominant rejection evidence now
function failedAttemptsCount(bars1h, lo, hi) {
  const EPS = 0.10;
  let attempts = 0;
  let cooldown = 0;

  for (const b of bars1h) {
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

function failedAttemptsPoints(attempts) {
  if (attempts >= 3) return 12;
  if (attempts === 2) return 8;
  if (attempts === 1) return 4;
  return 0;
}

// ---------- Retest model (unique trading days) ----------
function retestDaysCount(bars1h, lo, hi) {
  return uniqueTouchDays(bars1h, lo, hi).size;
}

// Q5 retest holds (0–12): now driven primarily by how many *unique days* price tests the zone
function retestHoldPoints(bars1h, lo, hi) {
  const days = retestDaysCount(bars1h, lo, hi);

  // No tests -> no retest
  if (days <= 0) return 0;

  // 1 day test still counts (you said day counts). Multi-day = stronger.
  if (days === 1) return 8;
  if (days === 2) return 10;
  return 12; // 3+ days testing is strong institutional interest
}

// Q6 retest reaction quality (0–8): after the last touch day, how fast did it move away?
function reactionAfterLastTouchPoints(bars1h, lo, hi) {
  const atr = computeATR(bars1h, 50);
  let lastTouch = -1;
  for (let i = bars1h.length - 1; i >= 0; i--) {
    if (intersectsBarZone(bars1h[i], lo, hi)) { lastTouch = i; break; }
  }
  if (lastTouch < 0 || lastTouch >= bars1h.length - 2) return 3;

  const center = (lo + hi) / 2;
  const look = Math.min(bars1h.length - 1, lastTouch + 6);

  let best = 0;
  for (let i = lastTouch + 1; i <= look; i++) {
    const b = bars1h[i];
    best = Math.max(best, Math.abs(b.close - center) / Math.max(atr, 1e-6));
  }

  if (best >= 1.2) return 8;
  if (best >= 0.7) return 5;
  return 3;
}

// ---------- Compression model (trading days + tightness) ----------
function compressionDurationPoints(tradingDays) {
  if (tradingDays >= 7) return 20;
  if (tradingDays >= 4) return 12;
  return 0;
}

function tightnessPoints(widthPts) {
  // SPY-friendly: tighter zones score more.
  // Tight <= 2 pts, Medium <= 4 pts, Wide > 4 pts
  if (widthPts <= 2.0) return 15;
  if (widthPts <= 4.0) return 9;
  return 3;
}

// ---------- Timeframe Agreement (unchanged) ----------
function tfAgreementPoints(bars4h, lo, hi) {
  let touches = 0;
  for (const b of bars4h) if (intersectsBarZone(b, lo, hi)) touches++;
  const q7 = touches >= 3 ? 10 : touches >= 1 ? 6 : 0;
  const q8 = touches >= 3 ? 5 : touches >= 1 ? 3 : 1;
  return { q7, q8, touches4h: touches };
}

// ---------- Breakout / Displacement (unchanged) ----------
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
    best6 = Math.max(best6, Math.abs(b.close - center) / Math.max(atr, 1e-6));
  }
  const q9 = best6 >= 1.2 ? 5 : best6 >= 0.7 ? 3 : 1;

  let best12 = 0;
  for (let i = lastTouch + 1; i <= Math.min(bars1h.length - 1, lastTouch + 12); i++) {
    const b = bars1h[i];
    best12 = Math.max(best12, Math.abs(b.high - center) / Math.max(atr, 1e-6));
    best12 = Math.max(best12, Math.abs(center - b.low) / Math.max(atr, 1e-6));
  }
  const q10 = best12 >= 2.0 ? 5 : best12 >= 1.2 ? 3 : 1;

  return { q9, q10 };
}

// ---------- Structural Context (unchanged) ----------
function contextPoints(bars1h, lo, hi) {
  const look = bars1h.slice(-120);
  const maxH = Math.max(...look.map(b => b.high));
  const minL = Math.min(...look.map(b => b.low));
  const atr = computeATR(look, 50);

  const nearHigh = Math.abs(hi - maxH) <= Math.max(0.5, 0.8 * atr);
  const nearLow  = Math.abs(lo - minL) <= Math.max(0.5, 0.8 * atr);
  const q11 = (nearHigh || nearLow) ? 5 : 3;

  const EPS = Math.max(0.15, 0.10 * zoneWidth(lo, hi));
  let breaks = 0;
  for (const b of look) {
    if (b.close > hi + EPS || b.close < lo - EPS) breaks++;
  }
  const q12 = breaks <= 1 ? 5 : breaks <= 3 ? 3 : 1;

  return { q11, q12, breaks };
}

export function scoreInstitutionalRubric({ zone, bars1h, bars4h, currentPrice }) {
  const lo = zone.price_low ?? zone.low ?? zone.min ?? zone?.priceRange?.[1];
  const hi = zone.price_high ?? zone.high ?? zone.max ?? zone?.priceRange?.[0];
  const low = Number(lo), high = Number(hi);

  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
    return {
      scoreTotal: 0,
      capApplied: "79",
      q: {},
      facts: { reason: "invalid_zone_bounds" },
    };
  }

  // Trading days touching zone (1H)
  const touchDays = uniqueTouchDays(bars1h, low, high);
  const days = touchDays.size;

  // Q1/Q2 Compression
  const q1 = compressionDurationPoints(days);
  const wPts = zoneWidth(low, high);
  const q2 = tightnessPoints(wPts);

  // Q3/Q4 Rejection (Wicks are now the main driver inside the rejection bucket)
  const attempts = failedAttemptsCount(bars1h, low, high);
  const q3 = failedAttemptsPoints(attempts);
  const q4 = wickClarityPoints(bars1h, low, high);

  // Q5/Q6 Retest
  const q5 = retestHoldPoints(bars1h, low, high);
  const q6 = reactionAfterLastTouchPoints(bars1h, low, high);

  // Q7/Q8 TF agreement
  const { q7, q8, touches4h } = tfAgreementPoints(bars4h, low, high);

  // Q9/Q10 Breakout
  const { q9, q10 } = breakoutSpeedDistancePoints(bars1h, low, high);

  // Q11/Q12 Context
  const { q11, q12, breaks } = contextPoints(bars1h, low, high);

  // Subtotals (same max buckets as locked system)
  const compression = q1 + q2; // 35
  const rejection   = q3 + q4; // 20 (but q4 is now the dominant part of this bucket)
  const retest      = q5 + q6; // 20
  const tf          = q7 + q8; // 15
  const breakout    = q9 + q10;// 10
  const context     = q11 + q12;//10

  let total = compression + rejection + retest + tf + breakout + context;

  // ----- CAPS (locked) -----
  // Gate 1: Compression + Rejection + Retest must exist, otherwise cap at 79.
  // We treat:
  // - compression exists if Q1>0 and Q2>=9 (>= medium tightness)
  // - rejection exists if wick score shows at least "mixed" OR at least 1 failed attempt
  // - retest exists if Q5>0 (day or multi-day counts)
  const hasCompression = q1 > 0 && q2 >= 9;
  const hasRejection = (q4 >= 5) || (q3 > 0);   // wick-first
  const hasRetest = q5 > 0;

  let capApplied = "none";
  if (!(hasCompression && hasRejection && hasRetest)) {
    total = Math.min(total, 79);
    capApplied = "79";
  }

  // Gate 2: 4H required for 100 (cap at 99 without clear 4H presence)
  const hasClear4H = q7 === 10;
  if (!hasClear4H && total >= 100) total = 99;
  if (!hasClear4H && capApplied === "none") capApplied = "99";

  total = clamp(total, 0, 100);

  const mid = (low + high) / 2;
  const distPts = Number.isFinite(currentPrice) ? Math.abs(mid - currentPrice) : null;

  const { wickTotalPts, wickAvgPts, touchBars } = wickTotalsInZone(bars1h, low, high);

  return {
    scoreTotal: Math.round(total),
    capApplied,
    q: {
      q1_duration: q1,
      q2_tightness: q2,
      q3_failedAttempts: q3,
      q4_wickClarity: q4,
      q5_retestHold: q5,
      q6_retestReaction: q6,
      q7_4hPresence: q7,
      q8_tfNesting: q8,
      q9_speed: q9,
      q10_distance: q10,
      q11_location: q11,
      q12_integrity: q12,
    },
    facts: {
      low: Number(low.toFixed(2)),
      high: Number(high.toFixed(2)),
      widthPts: Number(wPts.toFixed(2)),
      compressionDays: days,
      retestDays: days, // using unique touch days as retest strength driver (per your rule)
      failedAttempts: attempts,
      wickTotalPts: Number(wickTotalPts.toFixed(2)),
      wickAvgPtsPerTouchBar: Number(wickAvgPts.toFixed(3)),
      wickTouchBars: touchBars,
      touches4h,
      breaks,
      distancePoints: distPts == null ? null : Number(distPts.toFixed(2)),
    },
  };
}
