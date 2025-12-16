/**
 * SMZ Engine — Diagnostic First
 * Goal: surface zones near current price (e.g., 676–690)
 * Change: proximity-to-current-price BOOSTS score
 * IMPORTANT: accepts BOTH bar shapes:
 *  - Polygon: {t,o,h,l,c,v}
 *  - Normalized: {time,open,high,low,close,volume}
 */

const CONFIG = {
  diagnosticScoreFloor: 20,
  PRICE_WINDOW_POINTS: 30,

  PROXIMITY_MAX_POINTS: 30,
  PROXIMITY_WEIGHT: 0.35,

  lookbackBars: 420,
  bucketAtrMult: 0.6,
  minTouches: 3,

  weights: { touches: 0.30, volume: 0.25, wick: 0.20, hold: 0.15, retest: 0.10 },
};

export function computeSmartMoneyLevels(bars30m, bars1h, bars4h) {
  const b30 = norm(bars30m);
  const b1h = norm(bars1h);
  const b4h = norm(bars4h);

  const currentPrice =
    b30.at(-1)?.close ??
    b1h.at(-1)?.close ??
    b4h.at(-1)?.close ??
    null;

  if (!Number.isFinite(currentPrice)) return [];

  const z1h = computeZones(b1h, "1h", currentPrice);
  const z4h = computeZones(b4h, "4h", currentPrice);

  return [...z1h, ...z4h]
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
    .map((z) => ({
      type: "institutional",
      price: round2((z.low + z.high) / 2),
      priceRange: [round2(z.high), round2(z.low)],
      strength: Math.round(z.score),
      details: z.details,
    }));
}

function computeZones(candles, tf, currentPrice) {
  if (!Array.isArray(candles) || candles.length < 50) return [];

  const atr = ATR(candles, 14);
  const bucketSize = Math.max(atr * CONFIG.bucketAtrMult, 0.01);

  return buckets(candles.slice(-CONFIG.lookbackBars), bucketSize, tf)
    .map((b) => scoreZone(b, candles, currentPrice))
    .filter((z) => {
      const inWindow = Math.abs(z.mid - currentPrice) <= CONFIG.PRICE_WINDOW_POINTS;
      return inWindow && z.score >= CONFIG.diagnosticScoreFloor;
    })
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

  const distPts = Math.abs(b.mid - currentPrice);
  const proximity = 1 - Math.min(distPts / CONFIG.PROXIMITY_MAX_POINTS, 1);

  const score =
    (base * (1 - CONFIG.PROXIMITY_WEIGHT) + proximity * CONFIG.PROXIMITY_WEIGHT) * 100;

  return {
    tf: b.tf,
    low: b.low,
    high: b.high,
    mid: b.mid,
    score,
    details: {
      tf: b.tf,
      score: round2(score),
      breakdown: { touches: t, volume: v, wick: w, hold: h, retest: r, proximity },
      meta: {
        distancePoints: round2(distPts),
        touches: b.touches,
        wickHits: b.wickHits,
        bodyHits: b.bodyHits,
        barsHeld: (b.last ?? 0) - (b.first ?? 0),
      },
    },
  };
}

/* ---------- detection ---------- */

function buckets(candles, size, tf) {
  const minP = Math.min(...candles.map((c) => c.low));
  const m = new Map();

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const mid = (c.high + c.low) / 2;
    const k = Math.floor((mid - minP) / size);

    const b =
      m.get(k) ||
      {
        tf,
        low: minP + k * size,
        high: minP + (k + 1) * size,
        touches: 0,
        volumeSum: 0,
        wickHits: 0,
        bodyHits: 0,
        first: null,
        last: null,
        idx: [],
      };

    if (c.high >= b.low && c.low <= b.high) {
      b.touches++;
      b.volumeSum += c.volume || 0;
      b.first ??= i;
      b.last = i;
      b.idx.push(i);

      const bh = Math.max(c.open, c.close);
      const bl = Math.min(c.open, c.close);
      bh >= b.low && bl <= b.high ? b.bodyHits++ : b.wickHits++;
    }

    m.set(k, b);
  }

  return [...m.values()]
    .filter((b) => b.touches >= CONFIG.minTouches)
    .map((b) => ({ ...b, mid: (b.low + b.high) / 2 }));
}

/* ---------- scoring helpers ---------- */

const scoreTouches = (t) => Math.min(1, Math.max(0, (t - 2) / 10));
const scoreRetest = (idx) => (idx.length >= 3 ? 1 : 0.3);
const scoreHold = (a, b) => Math.min(1, Math.max(0.2, (b - a) / 200));
const scoreWick = (w, b) => (w + b === 0 ? 0 : w / (w + b));

function scoreVolume(b, candles) {
  const vols = candles.map((c) => c.volume || 0).filter((x) => x > 0);
  if (vols.length < 20) return 0.5;

  const avg = vols.reduce((s, x) => s + x, 0) / vols.length;
  const perTouch = b.touches > 0 ? b.volumeSum / b.touches : 0;
  const mult = avg > 0 ? perTouch / avg : 1;

  if (mult <= 1.0) return 0.3;
  if (mult >= 2.5) return 1.0;
  return 0.3 + (mult - 1.0) * (0.7 / 1.5);
}

/* ---------- utils ---------- */

function norm(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((b) => {
      const rawT = Number(b.t ?? b.time ?? 0);
      const sec = rawT > 1e12 ? Math.floor(rawT / 1000) : rawT;

      const open = Number(b.o ?? b.open);
      const high = Number(b.h ?? b.high);
      const low = Number(b.l ?? b.low);
      const close = Number(b.c ?? b.close);
      const volume = Number(b.v ?? b.volume ?? 0);

      return { time: sec, open, high, low, close, volume };
    })
    .filter(
      (b) =>
        Number.isFinite(b.time) &&
        Number.isFinite(b.open) &&
        Number.isFinite(b.high) &&
        Number.isFinite(b.low) &&
        Number.isFinite(b.close) &&
        b.time > 0
    )
    .sort((a, b) => a.time - b.time);
}

function ATR(c, p) {
  const t = [];
  for (let i = 1; i < c.length; i++) {
    t.push(
      Math.max(
        c[i].high - c[i].low,
        Math.abs(c[i].high - c[i - 1].close),
        Math.abs(c[i].low - c[i - 1].close)
      )
    );
  }
  return t.slice(-p).reduce((a, b) => a + b, 0) / p || 1;
}

const round2 = (x) => Math.round(x * 100) / 100;
