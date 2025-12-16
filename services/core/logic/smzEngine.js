/**
 * SMZ Engine — Diagnostic First
 * CHANGE: distance-to-current-price BOOSTS score
 * GOAL: surface zones near 676–690
 */

const CONFIG = {
  diagnosticScoreFloor: 20,
  PRICE_WINDOW_POINTS: 30,
  PROXIMITY_MAX_POINTS: 30, // full boost inside this range
  PROXIMITY_WEIGHT: 0.35,   // how strong proximity matters
  lookbackBars: 420,
  bucketAtrMult: 0.6,
  minTouches: 3,
  weights: {
    touches: 0.30,
    volume: 0.25,
    wick: 0.20,
    hold: 0.15,
    retest: 0.10,
  },
};

export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  const b30 = norm(bars30m);
  const b1h = norm(bars1h);
  const b4h = norm(bars4h);

  const currentPrice =
    b30.at(-1)?.close ??
    b1h.at(-1)?.close ??
    b4h.at(-1)?.close;

  if (!Number.isFinite(currentPrice)) return [];

  const z1h = computeZones(b1h, "1h", currentPrice);
  const z4h = computeZones(b4h, "4h", currentPrice);

  return [...z1h, ...z4h]
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map(z => ({
      type: "institutional",
      price: round2((z.low + z.high) / 2),
      priceRange: [z.high, z.low],
      strength: Math.round(z.score),
      details: z.details,
    }));
}

function computeZones(candles, tf, currentPrice) {
  if (candles.length < 50) return [];

  const atr = ATR(candles, 14);
  const bucketSize = Math.max(atr * CONFIG.bucketAtrMult, 0.01);

  return buckets(candles, bucketSize, tf)
    .map(b => scoreZone(b, candles, currentPrice))
    .filter(z =>
      Math.abs(z.mid - currentPrice) <= CONFIG.PRICE_WINDOW_POINTS &&
      z.score >= CONFIG.diagnosticScoreFloor
    )
    .sort((a, b) => b.score - a.score);
}

function scoreZone(b, candles, currentPrice) {
  const t = scoreTouches(b.touches);
  const v = scoreVolume(b, candles);
  const w = scoreWick(b.wickHits, b.bodyHits);
  const h = scoreHold(b.first, b.last);
  const r = scoreRetest(b.idx);

  const base =
    t * CONFIG.weights.touches +
    v * CONFIG.weights.volume +
    w * CONFIG.weights.wick +
    h * CONFIG.weights.hold +
    r * CONFIG.weights.retest;

  const dist = Math.abs(b.mid - currentPrice);
  const proximity =
    1 - Math.min(dist / CONFIG.PROXIMITY_MAX_POINTS, 1);

  const score =
    (base * (1 - CONFIG.PROXIMITY_WEIGHT) +
      proximity * CONFIG.PROXIMITY_WEIGHT) * 100;

  return {
    tf: b.tf,
    low: b.low,
    high: b.high,
    mid: b.mid,
    score,
    details: {
      tf: b.tf,
      score: round2(score),
      breakdown: { touches: t, volume: v, wick: w, hold: h, retest: r },
      meta: { distance: round2(dist) },
    },
  };
}

/* ---------- detection ---------- */

function buckets(candles, size, tf) {
  const minP = Math.min(...candles.map(c => c.low));
  const m = new Map();

  candles.forEach((c, i) => {
    const mid = (c.high + c.low) / 2;
    const k = Math.floor((mid - minP) / size);
    const b =
      m.get(k) ||
      { tf, low: minP + k * size, high: minP + (k + 1) * size,
        touches: 0, wickHits: 0, bodyHits: 0,
        first: null, last: null, idx: [] };

    if (c.high >= b.low && c.low <= b.high) {
      b.touches++;
      b.first ??= i;
      b.last = i;
      b.idx.push(i);
      const bh = Math.max(c.open, c.close);
      const bl = Math.min(c.open, c.close);
      bh >= b.low && bl <= b.high ? b.bodyHits++ : b.wickHits++;
    }
    m.set(k, b);
  });

  return [...m.values()]
    .filter(b => b.touches >= CONFIG.minTouches)
    .map(b => ({ ...b, mid: (b.low + b.high) / 2 }));
}

/* ---------- scoring helpers ---------- */

const scoreTouches = t => Math.min(1, Math.max(0, (t - 2) / 10));
const scoreRetest = i => (i.length >= 3 ? 1 : 0.3);
const scoreHold = (a, b) => Math.min(1, Math.max(0.2, (b - a) / 200));
const scoreWick = (w, b) => (w + b === 0 ? 0 : w / (w + b));

function scoreVolume(b, candles) {
  const avg = candles.reduce((s, c) => s + c.volume, 0) / candles.length;
  return Math.min(1, Math.max(0.3, (b.volumeSum || 1) / avg));
}

/* ---------- utils ---------- */

function norm(arr) {
  return (arr || [])
    .map(b => ({
      time: b.t > 1e12 ? Math.floor(b.t / 1000) : b.t,
      open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v || 0,
    }))
    .filter(b => Number.isFinite(b.close))
    .sort((a, b) => a.time - b.time);
}

function ATR(c, p) {
  const t = [];
  for (let i = 1; i < c.length; i++) {
    t.push(Math.max(
      c[i].high - c[i].low,
      Math.abs(c[i].high - c[i - 1].close),
      Math.abs(c[i].low - c[i - 1].close)
    ));
  }
  return t.slice(-p).reduce((a, b) => a + b, 0) / p || 1;
}

const round2 = x => Math.round(x * 100) / 100;
