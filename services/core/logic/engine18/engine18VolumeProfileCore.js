// Copied verbatim from Frye-Dashboard src/pages/rows/RowChart/overlays/helpers/volumeProfileCore.js
// (PR #240). The file is pure and was written to be shared by the chart and Engine 18.
// Keep the two copies in sync; the chart copy is the display reference.
// src/pages/rows/RowChart/overlays/helpers/volumeProfileCore.js
//
// Volume profile calculations for the ES chart (independent implementation).
//
// Pure functions only: no DOM, no network. Shared by the chart overlay and
// usable by backend research (Engine 18) unchanged.
//
// Method:
// - Each bar's volume is spread across the price rows its high-low range
//   overlaps, in proportion to the overlap. (Assigning the whole bar volume
//   to every touched row would over-weight wide bars.)
// - POC = row with the most volume.
// - Value area = POC plus neighbouring rows, adding the larger side first,
//   until valueAreaPct (default 70%) of volume is included.
// - HVN / LVN = local peaks / troughs of a lightly smoothed profile.
// - Shelf edges = where a high-volume shelf drops into a thin area within a
//   few rows. These are the levels where "acceptance beyond the edge" tends
//   to travel quickly to the next high-volume node.
//
// The forming (last) bar is excluded by default: its volume is incomplete
// and, on streamed 5m/10m bars, currently over-counted (Engine 11 audit S1).

const DEFAULTS = {
  lookback: 500,
  rows: 120,
  valueAreaPct: 0.7,
  tickSize: 0.25,
  excludeLast: true,
  edgeGapRows: 3,
  heavyFactor: 0.6, // heavy row: >= 60% of mean row volume
  thinFactor: 0.2, // thin row: <= 20% of mean row volume
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanBars(bars) {
  if (!Array.isArray(bars)) return [];
  const out = [];
  for (const b of bars) {
    const high = num(b?.high);
    const low = num(b?.low);
    const close = num(b?.close);
    const volume = num(b?.volume);
    if (high == null || low == null || close == null || volume == null) continue;
    if (volume < 0 || high < low) continue;
    out.push({ time: b.time, high, low, close, volume });
  }
  return out;
}

export function selectProfileBars(bars, { lookback = DEFAULTS.lookback, excludeLast = DEFAULTS.excludeLast } = {}) {
  const clean = cleanBars(bars);
  const closed = excludeLast ? clean.slice(0, -1) : clean;
  const n = Math.max(1, Math.floor(lookback));
  return closed.slice(-n);
}

export function computeVolumeProfile(bars, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const used = options.preselected ? cleanBars(bars) : selectProfileBars(bars, opt);
  if (used.length < 2) return null;

  let lo = Infinity;
  let hi = -Infinity;
  let total = 0;
  for (const b of used) {
    if (b.low < lo) lo = b.low;
    if (b.high > hi) hi = b.high;
    total += b.volume;
  }
  if (!(hi > lo) || !(total > 0)) return null;

  const tick = opt.tickSize > 0 ? opt.tickSize : 0.25;
  const wantRows = Math.max(1, Math.floor(opt.rows));
  const rowSize = Math.max(tick, Math.ceil((hi - lo) / wantRows / tick) * tick);
  const nRows = Math.max(1, Math.ceil((hi - lo) / rowSize - 1e-9));
  const vol = new Array(nRows).fill(0);

  const rowOf = (price) =>
    Math.min(nRows - 1, Math.max(0, Math.floor((price - lo) / rowSize + 1e-9)));

  for (const b of used) {
    if (b.volume === 0) continue;
    const range = b.high - b.low;
    if (range <= 0) {
      vol[rowOf(b.close)] += b.volume;
      continue;
    }
    const r0 = rowOf(b.low);
    const r1 = rowOf(b.high);
    for (let r = r0; r <= r1; r++) {
      const rLo = lo + r * rowSize;
      const rHi = rLo + rowSize;
      const overlap = Math.min(b.high, rHi) - Math.max(b.low, rLo);
      if (overlap > 0) vol[r] += (b.volume * overlap) / range;
    }
  }

  // POC
  let pocIndex = 0;
  for (let r = 1; r < nRows; r++) if (vol[r] > vol[pocIndex]) pocIndex = r;
  const maxVol = vol[pocIndex];

  // Value area
  const target = total * opt.valueAreaPct;
  let inc = vol[pocIndex];
  let up = pocIndex + 1;
  let dn = pocIndex - 1;
  let top = pocIndex;
  let bot = pocIndex;
  while (inc < target && (up < nRows || dn >= 0)) {
    const vUp = up < nRows ? vol[up] : -1;
    const vDn = dn >= 0 ? vol[dn] : -1;
    if (vUp >= vDn) {
      inc += vUp;
      top = up;
      up++;
    } else {
      inc += vDn;
      bot = dn;
      dn--;
    }
  }

  const rows = vol.map((v, r) => {
    const rLo = lo + r * rowSize;
    return {
      index: r,
      lo: rLo,
      hi: rLo + rowSize,
      mid: rLo + rowSize / 2,
      volume: v,
      share: v / total,
      norm: maxVol > 0 ? v / maxVol : 0,
      inValueArea: r >= bot && r <= top,
    };
  });

  // Smoothed profile for node and edge detection
  const smooth = vol.map((_, r) => {
    let s = 0;
    let c = 0;
    for (let k = r - 1; k <= r + 1; k++) {
      if (k >= 0 && k < nRows) {
        s += vol[k];
        c++;
      }
    }
    return s / c;
  });
  // Thresholds relative to the mean row volume. Percentiles fail when a
  // profile is mostly thin rows (a fast move) or mostly heavy rows.
  const mean = total / nRows;
  const heavy = mean * opt.heavyFactor;
  const thin = mean * opt.thinFactor;
  const win = Math.max(2, Math.round(nRows / 40));

  // HVN: strict local peaks of the smoothed profile above the heavy level,
  // keeping only the larger of two peaks closer than `win` rows.
  const peaks = [];
  for (let r = 0; r < nRows; r++) {
    if (smooth[r] < heavy) continue;
    let isMax = true;
    for (let k = r - win; k <= r + win; k++) {
      if (k < 0 || k >= nRows || k === r) continue;
      if (smooth[k] > smooth[r] || (smooth[k] === smooth[r] && k < r)) {
        isMax = false;
        break;
      }
    }
    if (isMax) peaks.push(r);
  }
  const hvn = peaks.map((r) => rows[r].mid);

  // LVN: each contiguous run of thin rows inside the range, reported once.
  const lvn = [];
  const thinRuns = [];
  for (let r = 0; r < nRows; ) {
    if (smooth[r] > thin) {
      r++;
      continue;
    }
    let e = r;
    while (e + 1 < nRows && smooth[e + 1] <= thin) e++;
    if (r > 0 && e < nRows - 1) {
      thinRuns.push({ lo: rows[r].lo, hi: rows[e].hi });
      lvn.push((rows[r].lo + rows[e].hi) / 2);
    }
    r = e + 1;
  }

  // Shelf edges: a heavy row (raw volume) with a thin area within
  // edgeGapRows next to it. Raw volume is used so smoothing does not blur
  // the very edge we are looking for.
  const gap = Math.max(1, Math.floor(opt.edgeGapRows));
  const edges = [];
  for (let r = 0; r < nRows; r++) {
    if (vol[r] < heavy) continue;
    for (let k = r - 1; k >= Math.max(0, r - gap); k--) {
      if (vol[k] >= heavy) break;
      if (vol[k] <= thin) {
        edges.push({ side: "LOWER", price: rows[r].lo });
        break;
      }
    }
    for (let k = r + 1; k <= Math.min(nRows - 1, r + gap); k++) {
      if (vol[k] >= heavy) break;
      if (vol[k] <= thin) {
        edges.push({ side: "UPPER", price: rows[r].hi });
        break;
      }
    }
  }
  const shelfEdges = [];
  for (const e of edges.sort((a, b) => a.price - b.price)) {
    const prev = shelfEdges[shelfEdges.length - 1];
    if (prev && prev.side === e.side && Math.abs(prev.price - e.price) < 2 * rowSize) continue;
    shelfEdges.push(e);
  }

  return {
    schema: "frye.volumeProfile.v1",
    barsUsed: used.length,
    firstTime: used[0].time,
    lastTime: used[used.length - 1].time,
    lo,
    hi,
    rowSize,
    totalVolume: total,
    rows,
    poc: rows[pocIndex].mid,
    pocIndex,
    vah: rows[top].hi,
    val: rows[bot].lo,
    valueAreaPct: opt.valueAreaPct,
    hvn,
    lvn,
    thinRuns,
    shelfEdges,
  };
}

export function nearestNodeBelow(profile, price) {
  if (!profile) return null;
  const c = profile.hvn.filter((p) => p < price);
  return c.length ? Math.max(...c) : null;
}

export function nearestNodeAbove(profile, price) {
  if (!profile) return null;
  const c = profile.hvn.filter((p) => p > price);
  return c.length ? Math.min(...c) : null;
}

// Warning only. Never an order.
//
// The reference profile is built from bars BEFORE the recent window, so a
// breakdown does not move the edges it is measured against.
// ACCEPTED_BELOW_SHELF: the last `closesRequired` closed bars all closed more
// than `marginPts` below a LOWER shelf edge that price closed above at some
// point inside the recent window.
export function detectShelfBreak(bars, options = {}) {
  const {
    lookback = DEFAULTS.lookback,
    rows = DEFAULTS.rows,
    recentBars = 30,
    marginPts = 2,
    closesRequired = 2,
    excludeLast = true,
  } = options;

  const closed = selectProfileBars(bars, { lookback: lookback + recentBars, excludeLast });
  if (closed.length < recentBars + 20) return { status: "INSUFFICIENT_DATA" };

  const reference = computeVolumeProfile(closed.slice(0, -recentBars), {
    rows,
    preselected: true,
  });
  if (!reference) return { status: "INSUFFICIENT_DATA" };

  const recent = closed.slice(-recentBars);
  const lastN = recent.slice(-closesRequired);
  if (lastN.length < closesRequired) return { status: "INSUFFICIENT_DATA" };
  const price = lastN[lastN.length - 1].close;

  // If several edges qualify, report the one nearest to current price.
  let best = null;
  for (const e of reference.shelfEdges) {
    let cand = null;
    if (e.side === "LOWER") {
      const accepted = lastN.every((b) => b.close < e.price - marginPts);
      const wasAbove = recent.some((b) => b.close >= e.price);
      if (accepted && wasAbove) {
        cand = { status: "ACCEPTED_BELOW_SHELF", nextNode: nearestNodeBelow(reference, price) };
      }
    } else {
      const accepted = lastN.every((b) => b.close > e.price + marginPts);
      const wasBelow = recent.some((b) => b.close <= e.price);
      if (accepted && wasBelow) {
        cand = { status: "ACCEPTED_ABOVE_SHELF", nextNode: nearestNodeAbove(reference, price) };
      }
    }
    if (cand && (!best || Math.abs(price - e.price) < Math.abs(price - best.edge))) {
      best = { ...cand, edge: e.price, price };
    }
  }

  return best
    ? { ...best, marginPts, closesRequired, warningOnly: true }
    : { status: "NO_SHELF_BREAK", warningOnly: true };
}
