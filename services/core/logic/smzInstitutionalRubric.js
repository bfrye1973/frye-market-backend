// src/services/core/logic/smzInstitutionalRubric.js
// UPDATED: Compression days count if price is INSIDE zone at any point that day
// (open/close inside OR full candle inside OR overlap). Uses 1H bars for trading days.
// Wicks: ANY wicks inside zone, length-weighted in raw points.
// Retests: unique trading days inside/touching zone.

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function toSec(t) {
  const n = Number(t ?? 0);
  return n > 1e12 ? Math.floor(n / 1000) : n; // ms->sec
}

function dayKeyUtc(sec) {
  const d = new Date(toSec(sec) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function validBar(b) {
  return b && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.open) && Number.isFinite(b.close);
}

function intersectsBarZone(b, lo, hi) {
  return validBar(b) && b.high >= lo && b.low <= hi;
}

function anyInsideZone(b, lo, hi) {
  // counts “inside” time, not just touching edges
  // True if:
  // - open inside OR close inside OR candle fully inside OR overlaps
  if (!validBar(b)) return false;

  const openInside = b.open >= lo && b.open <= hi;
  const closeInside = b.close >= lo && b.close <= hi;
  const fullyInside = b.high <= hi && b.low >= lo;
  const overlaps = intersectsBarZone(b, lo, hi);

  return openInside || closeInside || fullyInside || overlaps;
}

function zoneWidth(lo, hi) { return Math.max(0, hi - lo); }

function computeATR(bars, period = 50) {
  if (!Array.isArray(bars) || bars.length < 2) return 1;
  const n = bars.length;
  const start = Math.max(1, n - period);
  let sum = 0, cnt = 0;
  for (let i = start; i < n; i++) {
    const c = bars[i], p = bars[i - 1];
    if (!c || !p || !validBar(c) || !validBar(p)) continue;
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

// ✅ UPDATED: “compression days” = any day price is inside/overlapping zone at any point
function uniqueDaysInZone(bars1h, lo, hi) {
  const s = new Set();
  for (const b of bars1h) {
    if (anyInsideZone(b, lo, hi)) s.add(dayKeyUtc(b.time));
  }
  return s;
}

// ---------- WICK MODEL (points, length-weighted, any wicks in zone) ----------
function wickTotalsInZone(bars1h, lo, hi) {
  let wickTotalPts = 0;
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

  const wickAvgPts = touchBars ? wickTotalPts / touchBars : 0;
  return { wickTotalPts, wickAvgPts, touchBars };
}

// Q4 (0–8) based on avg wick length per touch bar (raw points)
function wickClarityPoints(bars1h, lo, hi) {
  const { wickAvgPts, touchBars } = wickTotalsInZone(bars1h, lo, hi);
  if (touchBars < 2) return 2;
  if (wickAvgPts >= 1.20) return 8;
  if (wickAvgPts >= 0.70) return 5;
  return 2;
}

// Failed attempts (still useful, but wicks are primary)
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

function failedAttemptsPoints(attempts) {
  if (attempts >= 3) return 12;
  if (attempts === 2) return 8;
  if (attempts === 1) return 4;
  return 0;
}

// ---------- Retests (unique trading days in zone) ----------
function retestDaysCount(bars1h, lo, hi) {
  return uniqueDaysInZone(bars1h, lo, hi).size;
}

function retestHoldPoints(bars1h, lo, hi) {
  const days = retestDaysCount(bars1h, lo, hi);
  if (days <= 0) return 0;
  if (days === 1) return 8;
  if (days === 2) return 10;
  return 12;
}

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
    if (!validBar(b)) continue;
    best = Math.max(best, Math.abs(b.close - center) / Math.max(atr, 1e-6));
  }

  if (best >= 1.2) return 8;
  if (best >= 0.7) return 5;
  return 3;
}

// ---------- Compression ----------
function compressionDurationPoints(tradingDays) {
  if (tradingDays >= 7) return 20;
  if (tradingDays >= 4) return 12;
  return 0;
}

function tightnessPoints(widthPts) {
  if (widthPts <= 2.0) return 15;
  if (widthPts <= 4.0) return 9;
  return 3;
}

// ---------- TF agreement ----------
function tfAgreementPoints(bars4h, lo, hi) {
  let touches = 0;
  for (const b of bars4h) if (intersectsBarZone(b, lo, hi)) touches++;
  const q7 = touches >= 3 ? 10 : touches >= 1 ? 6 : 0;
  const q8 = touches >= 3 ? 5 : touches >= 1 ? 3 : 1;
  return { q7, q8, touches4h: touches };
}

// ---------- Breakout ----------
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
  const q9 = best6 >= 1.2 ? 5 : best6 >= 0.7 ? 3 : 1;

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

// ---------- Context ----------
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
    if (!validBar(b)) continue;
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
    return { scoreTotal: 0, capApplied: "79", q: {}, facts: { reason: "invalid_zone_bounds" } };
  }

  // ✅ UPDATED: compressionDays counts “inside” days
  const daysSet = uniqueDaysInZone(bars1h, low, high);
  const days = daysSet.size;

  const q1 = compressionDurationPoints(days);
  const wPts = zoneWidth(low, high);
  const q2 = tightnessPoints(wPts);

  const attempts = failedAttemptsCount(bars1h, low, high);
  const q3 = failedAttemptsPoints(attempts);
  const q4 = wickClarityPoints(bars1h, low, high);

  const q5 = retestHoldPoints(bars1h, low, high);
  const q6 = reactionAfterLastTouchPoints(bars1h, low, high);

  const { q7, q8, touches4h } = tfAgreementPoints(bars4h, low, high);
  const { q9, q10 } = breakoutSpeedDistancePoints(bars1h, low, high);
  const { q11, q12, breaks } = contextPoints(bars1h, low, high);

  const compression = q1 + q2; // 35
  const rejection   = q3 + q4; // 20
  const retest      = q5 + q6; // 20
  const tf          = q7 + q8; // 15
  const breakout    = q9 + q10;// 10
  const context     = q11 + q12;//10

  let total = compression + rejection + retest + tf + breakout + context;

  // Gate 1 cap 79
  const hasCompression = q1 > 0 && q2 >= 9;
  const hasRejection = (q4 >= 5) || (q3 > 0);
  const hasRetest = q5 > 0;

  let capApplied = "none";
  if (!(hasCompression && hasRejection && hasRetest)) {
    total = Math.min(total, 79);
    capApplied = "79";
  }

  // Gate 2 cap 99 without clear 4H
  const hasClear4H = q7 === 10;
  if (!hasClear4H && total >= 100) total = 99;
  if (!hasClear4H && capApplied === "none") capApplied = "99";

  total = clamp(total, 0, 100);

  const mid = (low + high) / 2;
  const distPts = Number.isFinite(currentPrice) ? Math.abs(mid - currentPrice) : null;

  const { wickTotalPts, wickAvgPts, touchBars } = wickTotalsInZone(bars1h, low, high);
  const retestDays = retestDaysCount(bars1h, low, high);

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
      retestDays,
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
