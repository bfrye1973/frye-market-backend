// src/services/core/logic/smzInstitutionalRubric.js
// Institutional scoring rubric (Q1–Q12) + caps, using 1H bars for trading days.
// Returns full diagnostic breakdown for every zone.

function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

function toSec(t) {
  const n = Number(t ?? 0);
  return n > 1e12 ? Math.floor(n / 1000) : n; // ms->sec
}

function dayKeyUtc(sec) {
  const d = new Date(toSec(sec) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function intersectsBarZone(b, lo, hi) {
  return Number.isFinite(b.high) && Number.isFinite(b.low) && b.high >= lo && b.low <= hi;
}

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

function uniqTradingDaysTouchingZone(bars1h, lo, hi) {
  const s = new Set();
  for (const b of bars1h) {
    if (intersectsBarZone(b, lo, hi)) s.add(dayKeyUtc(b.time));
  }
  return s.size;
}

function zoneWidth(lo, hi) { return Math.max(0, hi - lo); }

function wickClarityPoints(bars, lo, hi) {
  // average wick share on touch bars
  let sum = 0, cnt = 0;
  for (const b of bars) {
    if (!intersectsBarZone(b, lo, hi)) continue;
    const bodyHi = Math.max(b.open, b.close);
    const bodyLo = Math.min(b.open, b.close);
    const upperW = Math.max(0, b.high - bodyHi);
    const lowerW = Math.max(0, bodyLo - b.low);
    const range = Math.max(1e-6, b.high - b.low);
    const wickShare = clamp((upperW + lowerW) / range, 0, 1);
    sum += wickShare; cnt++;
  }
  const avg = cnt ? sum / cnt : 0;
  if (avg >= 0.60) return 8;
  if (avg >= 0.45) return 5;
  return 2;
}

function failedAttemptsCount(bars, lo, hi) {
  // counts distinct “pierce + reject back inside” events (upper or lower)
  const EPS = 0.10;
  let attempts = 0;
  let cooldown = 0;

  for (const b of bars) {
    if (cooldown > 0) { cooldown--; continue; }

    const upperPierce = b.high > hi + EPS && b.close <= hi;
    const lowerPierce = b.low < lo - EPS && b.close >= lo;

    if (upperPierce || lowerPierce) {
      attempts++;
      cooldown = 3; // prevent counting same cluster repeatedly
    }
  }
  return attempts;
}

function retestClustersByDay(bars1h, lo, hi) {
  // cluster touch days separated by >=2 trading days
  const days = [];
  const seen = new Set();
  for (const b of bars1h) {
    if (!intersectsBarZone(b, lo, hi)) continue;
    const k = dayKeyUtc(b.time);
    if (seen.has(k)) continue;
    seen.add(k);
    days.push(k);
  }
  days.sort();
  if (!days.length) return 0;
  let clusters = 1;
  for (let i = 1; i < days.length; i++) {
    // crude day-gap by string compare; good enough for trading-day uniqueness
    if (days[i] !== days[i - 1]) {
      // if not same day, we allow cluster breaks by count of unique days
      // treat “cluster” as separated when we miss at least one trading day; approximate by requiring 2+ unique day steps
      // (diagnostic only)
      clusters += 0; // no-op, clusters computed differently below
    }
  }
  // Better: clusters by indices of touch days in bars
  const touchIdx = [];
  for (let i = 0; i < bars1h.length; i++) if (intersectsBarZone(bars1h[i], lo, hi)) touchIdx.push(i);
  if (touchIdx.length < 3) return 1;
  clusters = 1;
  for (let i = 1; i < touchIdx.length; i++) if (touchIdx[i] - touchIdx[i - 1] >= 24) clusters++; // ~1 trading day gap on 1H
  return clusters;
}

function retestHoldPoints(bars1h, lo, hi) {
  const clusters = retestClustersByDay(bars1h, lo, hi);
  if (clusters < 2) return 0; // no retest => fails Gate 1
  // clean vs messy: how often closes violate beyond zone by >25% width on touch bars
  const w = zoneWidth(lo, hi);
  const tol = Math.max(0.15, 0.25 * w);
  let vio = 0, cnt = 0;
  for (const b of bars1h) {
    if (!intersectsBarZone(b, lo, hi)) continue;
    cnt++;
    if (b.close > hi + tol || b.close < lo - tol) vio++;
  }
  if (!cnt) return 8;
  const vioRate = vio / cnt;
  return vioRate <= 0.10 ? 12 : 8;
}

function reactionAfterLastTouchPoints(bars1h, lo, hi) {
  // after last touch, did we move away quickly?
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

function tfAgreementPoints(bars4h, lo, hi) {
  // Q7 + Q8: 4H presence + nesting quality
  let touches = 0;
  for (const b of bars4h) if (intersectsBarZone(b, lo, hi)) touches++;

  const q7 = touches >= 3 ? 10 : touches >= 1 ? 6 : 0;
  const q8 = touches >= 3 ? 5 : touches >= 1 ? 3 : 1;
  return { q7, q8 };
}

function breakoutSpeedDistancePoints(bars1h, lo, hi) {
  const atr = computeATR(bars1h, 50);
  let lastTouch = -1;
  for (let i = bars1h.length - 1; i >= 0; i--) {
    if (intersectsBarZone(bars1h[i], lo, hi)) { lastTouch = i; break; }
  }
  if (lastTouch < 0) return { q9: 1, q10: 1 };

  const center = (lo + hi) / 2;

  // speed: max excursion in next 6 bars
  let best6 = 0;
  for (let i = lastTouch + 1; i <= Math.min(bars1h.length - 1, lastTouch + 6); i++) {
    const b = bars1h[i];
    best6 = Math.max(best6, Math.abs(b.close - center) / Math.max(atr, 1e-6));
  }
  const q9 = best6 >= 1.2 ? 5 : best6 >= 0.7 ? 3 : 1;

  // distance: max excursion in next 12 bars (high/low)
  let best12 = 0;
  for (let i = lastTouch + 1; i <= Math.min(bars1h.length - 1, lastTouch + 12); i++) {
    const b = bars1h[i];
    best12 = Math.max(best12, Math.abs(b.high - center) / Math.max(atr, 1e-6));
    best12 = Math.max(best12, Math.abs(center - b.low) / Math.max(atr, 1e-6));
  }
  const q10 = best12 >= 2.0 ? 5 : best12 >= 1.2 ? 3 : 1;

  return { q9, q10 };
}

function contextPoints(bars1h, lo, hi) {
  // Q11 Location: near swing extremes in recent lookback
  const look = bars1h.slice(-120);
  const maxH = Math.max(...look.map(b => b.high));
  const minL = Math.min(...look.map(b => b.low));
  const atr = computeATR(look, 50);
  const center = (lo + hi) / 2;

  const nearHigh = Math.abs(hi - maxH) <= Math.max(0.5, 0.8 * atr);
  const nearLow  = Math.abs(lo - minL) <= Math.max(0.5, 0.8 * atr);
  const q11 = (nearHigh || nearLow) ? 5 : 3;

  // Q12 Integrity: how often closes “break” cleanly through zone
  const EPS = Math.max(0.15, 0.10 * zoneWidth(lo, hi));
  let breaks = 0;
  for (const b of look) {
    if (b.close > hi + EPS || b.close < lo - EPS) breaks++;
  }
  const q12 = breaks <= 1 ? 5 : breaks <= 3 ? 3 : 1;

  return { q11, q12 };
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

  // Q1 duration (trading days, from 1H touches)
  const days = uniqTradingDaysTouchingZone(bars1h, low, high);
  const q1 = days >= 7 ? 20 : days >= 4 ? 12 : 0;

  // Q2 tightness (points-based classification)
  const wPts = zoneWidth(low, high);
  // thresholds tuned for SPY-ish scale (diagnostic)
  const q2 = wPts <= 2.0 ? 15 : wPts <= 4.0 ? 9 : 3;

  // Q3 failed attempts
  const fa = failedAttemptsCount(bars1h, low, high);
  const q3 = fa >= 3 ? 12 : fa === 2 ? 8 : fa === 1 ? 4 : 0;

  // Q4 wick clarity
  const q4 = wickClarityPoints(bars1h, low, high);

  // Q5 retest hold (mandatory)
  const q5 = retestHoldPoints(bars1h, low, high);

  // Q6 reaction quality after retest/last touch
  const q6 = reactionAfterLastTouchPoints(bars1h, low, high);

  // Q7/Q8 timeframe agreement
  const { q7, q8 } = tfAgreementPoints(bars4h, low, high);

  // Q9/Q10 breakout speed/distance
  const { q9, q10 } = breakoutSpeedDistancePoints(bars1h, low, high);

  // Q11/Q12 context
  const { q11, q12 } = contextPoints(bars1h, low, high);

  const compression = q1 + q2;            // max 35
  const rejection   = q3 + q4;            // max 20
  const retest      = q5 + q6;            // max 20
  const tf          = q7 + q8;            // max 15
  const breakout    = q9 + q10;           // max 10
  const context     = q11 + q12;          // max 10

  let total = compression + rejection + retest + tf + breakout + context;

  // Gate 1: must have Compression + Rejection + Retest
  const hasCompression = q1 > 0 && q2 >= 9;  // duration + at least medium tight
  const hasRejection   = q3 > 0;             // at least 1 failed attempt
  const hasRetest      = q5 > 0;             // retest exists

  let capApplied = "none";
  if (!(hasCompression && hasRejection && hasRetest)) {
    total = Math.min(total, 79);
    capApplied = "79";
  }

  // Gate 2: 4H required for 100 (cap at 99 if no clear 4H presence)
  const hasClear4H = q7 === 10;
  if (!hasClear4H && total >= 100) total = 99;
  if (!hasClear4H && capApplied === "none") capApplied = "99";

  total = clamp(total, 0, 100);

  const mid = (low + high) / 2;
  const distPts = Number.isFinite(currentPrice) ? Math.abs(mid - currentPrice) : null;

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
      failedAttempts: fa,
      distancePoints: distPts == null ? null : Number(distPts.toFixed(2)),
    },
  };
}
