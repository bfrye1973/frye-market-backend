/**
 * SMZ Engine — Diagnostic
 * - Only analyze zones within ±30 points of current price
 * - Use FIXED 1.0 point buckets inside that window (forces detection 676–690)
 * - Proximity boosts score
 * - Supports both bar shapes: {t,o,h,l,c,v} and {time,open,high,low,close,volume}
 */

const CFG = {
  diagnosticScoreFloor: 10,
  WINDOW_POINTS: 30,

  // fixed bucket settings (key change)
  FIXED_BUCKET_SIZE: 1.0,     // 1 point bins
  MIN_TOUCHES: 2,             // easier to form shelves near current price

  lookbackBars: 420,

  PROXIMITY_MAX_POINTS: 30,
  PROXIMITY_WEIGHT: 0.40,     // stronger push to “now”

  weights: { touches: 0.25, volume: 0.20, wick: 0.15, hold: 0.15, retest: 0.10, proximity: 0.15 },
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
    .slice(0, 30)
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

  const slice = candles.slice(-CFG.lookbackBars);

  // HARD window: only consider candles that touch the window
  const loWin = currentPrice - CFG.WINDOW_POINTS;
  const hiWin = currentPrice + CFG.WINDOW_POINTS;

  const windowCandles = slice.filter((c) => c.high >= loWin && c.low <= hiWin);
  if (windowCandles.length < 30) return [];

  const candidates = buildFixedBuckets(windowCandles, tf, loWin, hiWin, CFG.FIXED_BUCKET_SIZE);

  const scored = candidates
    .map((b) => scoreBucket(b, windowCandles, currentPrice))
    .filter((z) => z.score >= CFG.diagnosticScoreFloor)
    .sort((a, b) => b.score - a.score);

  return scored;
}

/* ---------------- fixed bucket builder ---------------- */

function buildFixedBuckets(candles, tf, loWin, hiWin, size) {
  const start = Math.floor(loWin / size) * size;
  const end = Math.ceil(hiWin / size) * size;

  const buckets = [];
  for (let low = start; low < end; low += size) {
    buckets.push({
      tf,
      low,
      high: low + size,
      mid: low + size / 2,
      touches: 0,
      volumeSum: 0,
      wickHits: 0,
      bodyHits: 0,
      first: null,
      last: null,
      idx: [],
    });
  }

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];

    for (const b of buckets) {
      if (c.high < b.low || c.low > b.high) continue;

      b.touches++;
      b.volumeSum += c.volume || 0;
      b.first ??= i;
      b.last = i;
      b.idx.push(i);

      const bh = Math.max(c.open, c.close);
      const bl = Math.min(c.open, c.close);
      bh >= b.low && bl <= b.high ? b.bodyHits++ : b.wickHits++;
    }
  }

  return buckets.filter((b) => b.touches >= CFG.MIN_TOUCHES);
}

/* ---------------- scoring ---------------- */

function scoreBucket(b, candles, currentPrice) {
  const distPts = Math.abs(b.mid - currentPrice);
  const proximity = 1 - Math.min(distPts / CFG.PROXIMITY_MAX_POINTS, 1);

  const t = scoreTouches(b.touches);
  const v = scoreVolume(b, candles);
  const w = scoreWick(b.wickHits, b.bodyHits);
  const h = scoreHold(b.first, b.last);
  const r = scoreRetest(b.idx);

  const base =
    t * CFG.weights.touches +
    v * CFG.weights.volume +
    w * CFG.weights.wick +
    h * CFG.weights.hold +
    r * CFG.weights.retest +
    proximity * CFG.weights.proximity;

  const score = clamp(base, 0, 1) * 100;

  return {
    tf: b.tf,
    low: b.low,
    high: b.high,
    mid: b.mid,
    score,
    details: {
      tf: b.tf,
      score: round2(score),
      breakdown: { touches: t, volume: v, wick: w, hold: h, retest: r, proximity: round2(proximity) },
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

/* ---------------- helpers ---------------- */

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
    .filter((b) =>
      Number.isFinite(b.time) &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close) &&
      b.time > 0
    )
    .sort((a, b) => a.time - b.time);
}

const scoreTouches = (t) => Math.min(1, Math.max(0, (t - 1) / 10));
const scoreRetest = (idx) => (idx.length >= 3 ? 1 : 0.4);
const scoreHold = (a, b) => Math.min(1, Math.max(0.2, (Number(b) - Number(a)) / 200));
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

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round2 = (x) => Math.round(x * 100) / 100;
