// src/services/core/logic/smzScoreCompression.js
// Compression scorer (0–35)
// Measures TRUE absorption/compression inside the zone:
// - Duration: unique days with meaningful IN-ZONE activity (not just 1 overlap bar)
// - Tightness: how narrow the accepted in-zone closes/bodies are, normalized by ATR

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function toSec(t) {
  const n = Number(t ?? 0);
  return n > 1e12 ? Math.floor(n / 1000) : n;
}

function dayKeyUtc(sec) {
  const d = new Date(toSec(sec) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
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

function intersects(b, lo, hi) {
  return validBar(b) && b.high >= lo && b.low <= hi;
}

function computeATR(bars, period = 50) {
  if (!Array.isArray(bars) || bars.length < 2) return 1;
  const n = bars.length;
  const start = Math.max(1, n - period);

  let sum = 0,
    cnt = 0;
  for (let i = start; i < n; i++) {
    const c = bars[i],
      p = bars[i - 1];
    if (!validBar(c) || !validBar(p)) continue;
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    if (Number.isFinite(tr)) {
      sum += tr;
      cnt++;
    }
  }
  const atr = cnt ? sum / cnt : 1;
  return atr > 0 ? atr : 1;
}

/**
 * "Meaningful in-zone activity" day:
 * - at least N overlap bars OR
 * - at least M closes that land inside the zone band
 *
 * This prevents volatile passes from inflating compression days.
 */
function computeCompressionDays(bars1h, lo, hi) {
  const perDay = new Map(); // day -> { overlaps, closesIn }
  for (const b of bars1h) {
    if (!validBar(b)) continue;

    const day = dayKeyUtc(b.time);
    const row = perDay.get(day) || { overlaps: 0, closesIn: 0 };

    if (intersects(b, lo, hi)) row.overlaps++;

    // close inside zone = acceptance signal
    if (b.close >= lo && b.close <= hi) row.closesIn++;

    perDay.set(day, row);
  }

  let days = 0;
  for (const v of perDay.values()) {
    // tuned for 1H bars:
    // - overlaps >= 3 means price spent time there
    // - closesIn >= 2 means acceptance, not just a wick tag
    if (v.overlaps >= 3 || v.closesIn >= 2) days++;
  }
  return days;
}

/**
 * Tightness:
 * We measure spread of closes that occur inside zone
 * and compare it to ATR. Compression = small close-spread vs ATR.
 */
function computeTightnessNorm(bars1h, lo, hi, atr) {
  const closesIn = [];
  for (const b of bars1h) {
    if (!validBar(b)) continue;
    if (b.close >= lo && b.close <= hi) closesIn.push(b.close);
  }
  if (closesIn.length < 4) {
    // not enough evidence for tight acceptance
    return 0;
  }

  let minC = Infinity,
    maxC = -Infinity;
  for (const c of closesIn) {
    minC = Math.min(minC, c);
    maxC = Math.max(maxC, c);
  }

  const spread = Math.max(0, maxC - minC);

  // Normalize spread to ATR. Smaller spread = tighter.
  // Typical good compression is spread <= 0.35*ATR, great <= 0.20*ATR
  const spreadToAtr = spread / Math.max(atr, 1e-6);

  // Map spreadToAtr to 0..1 where 1 = tight
  // <=0.20 => 1.0, 0.35 => ~0.6, >=0.60 => 0
  const norm = clamp((0.60 - spreadToAtr) / (0.60 - 0.20), 0, 1);

  return norm;
}

/**
 * Returns 0–35 points:
 * - Duration (days) = 60% of this bucket
 * - Tightness = 40% of this bucket
 */
export function scoreCompression({ lo, hi, bars1h }) {
  const b1h = Array.isArray(bars1h) ? bars1h : [];
  const atr = computeATR(b1h, 50);

  const days = computeCompressionDays(b1h, lo, hi);

  // Duration normalization:
  // <4 days = 0, 4–6 = 0.6, 7+ = 1.0
  const durNorm = days >= 7 ? 1 : days >= 4 ? 0.6 : 0;

  const tightNorm = computeTightnessNorm(b1h, lo, hi, atr);

  const norm = 0.60 * durNorm + 0.40 * tightNorm;

  return {
    points: Math.round(norm * 35),
    facts: {
      compressionDays: days,
      atr50: +atr.toFixed(3),
      tightnessNorm: +tightNorm.toFixed(3),
    },
  };
}

