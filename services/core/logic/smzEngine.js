// src/services/core/logic/smzEngine.js
// 🔒 Institutional STRUCTURE engine ONLY
// No shelves, no accumulation, no distribution, no micro bands.

import { scoreInstitutionalRubric as scoreInstitutional } from "./smzInstitutionalRubric.js";

const CFG = {
  MIN_TOUCHES_1H: 5,

  EXIT_CONSEC_BARS_1H: 2,

  ANCHOR_MIN_BARS_1H: 6,
  ANCHOR_MAX_BARS_1H: 24,
  ANCHOR_PREFERRED_BARS: 10,

  AVG_RANGE_ATR_MAX: 1.25,
  WIDTH_ATR_MAX: 3.25,

  STRUCT_MAX_WIDTH_PTS: 4.0, // SPY hard cap

  MIN_SCORE_GLOBAL: 75,
};

function round2(x) {
  return Math.round(x * 100) / 100;
}

function validBar(b) {
  return b && Number.isFinite(b.high) && Number.isFinite(b.low) && Number.isFinite(b.close);
}

function computeATR(bars, period = 14) {
  if (!bars || bars.length < period + 2) return 1;
  let sum = 0;
  let n = 0;
  for (let i = 1; i < bars.length; i++) {
    const c = bars[i], p = bars[i - 1];
    if (!validBar(c) || !validBar(p)) continue;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    sum += tr;
    n++;
  }
  return n ? sum / n : 1;
}

function sliceBars(bars, startIdx, endIdx) {
  if (startIdx < 0 || endIdx >= bars.length) return [];
  return bars.slice(startIdx, endIdx + 1);
}

function rangeStats(bars) {
  let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
  for (const b of bars) {
    if (!validBar(b)) continue;
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
    sum += (b.high - b.low);
    n++;
  }
  if (!n) return null;
  return {
    lo: round2(lo),
    hi: round2(hi),
    width: round2(hi - lo),
    avg: sum / n,
    bars: n,
  };
}

function exitConfirmedAfter(bars, lo, hi, endIdx) {
  let side = null;
  let count = 0;

  for (let i = endIdx + 1; i < bars.length && count < 2; i++) {
    const b = bars[i];
    if (!validBar(b)) break;

    let s = null;
    if (b.low > hi) s = "above";
    if (b.high < lo) s = "below";
    if (!s) break;

    if (!side) side = s;
    if (s !== side) break;
    count++;
  }

  return { confirmed: count >= 2, side, bars: count };
}

function findStructureWindows(bars1h, atr1h) {
  const zones = [];

  for (let end = CFG.ANCHOR_MIN_BARS_1H; end < bars1h.length - CFG.EXIT_CONSEC_BARS_1H; end++) {
    for (let len = CFG.ANCHOR_MIN_BARS_1H; len <= CFG.ANCHOR_MAX_BARS_1H; len++) {
      const start = end - (len - 1);
      if (start < 0) continue;

      const window = sliceBars(bars1h, start, end);
      const stats = rangeStats(window);
      if (!stats) continue;

      if (stats.avg > CFG.AVG_RANGE_ATR_MAX * atr1h) continue;
      if (stats.width > CFG.WIDTH_ATR_MAX * atr1h) continue;
      if (stats.width > CFG.STRUCT_MAX_WIDTH_PTS) continue;

      const exit = exitConfirmedAfter(bars1h, stats.lo, stats.hi, end);
      if (!exit.confirmed) continue;

      zones.push({
        lo: stats.lo,
        hi: stats.hi,
        width: stats.width,
        bars: stats.bars,
        startIdx: start,
        endIdx: end,
        exitSide: exit.side,
      });
    }
  }

  return zones;
}

export function computeSmartMoneyLevels(bars30m, bars1h) {
  if (!Array.isArray(bars1h) || bars1h.length < 50) return [];

  const atr1h = computeATR(bars1h);
  const candidates = findStructureWindows(bars1h, atr1h);

  const scored = candidates.map((z, i) => {
    const s = scoreInstitutional({
      lo: z.lo,
      hi: z.hi,
      bars1h,
      bars4h: [],
      currentPrice: bars1h.at(-1)?.close,
    });

    return {
      type: "institutional",
      tier: "structure",
      priceRange: [z.hi, z.lo],
      price: round2((z.hi + z.lo) / 2),
      strength: s.scoreTotal,
      details: {
        id: `smz_struct_${i + 1}`,
        anchorBars1h: z.bars,
        anchorStartTime: bars1h[z.startIdx]?.time,
        anchorEndTime: bars1h[z.endIdx]?.time,
        exitSide1h: z.exitSide,
        exitBars1h: 2,
      },
    };
  });

  return scored
    .filter((z) => z.strength >= CFG.MIN_SCORE_GLOBAL)
    .sort((a, b) => b.strength - a.strength);
}
