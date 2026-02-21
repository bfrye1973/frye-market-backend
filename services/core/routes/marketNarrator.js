// services/core/routes/marketNarrator.js
// Engine 14A (Read-only) — Market Narrator (SPY only)
//
// v4 upgrades:
// ✅ style=descriptive → EXACTLY 3 paragraphs every time
// ✅ Layer 1 covers last 24 hours (6 x 1h candles)
// ✅ Wick detectors:
//    - lower wick buyback (bullish defense / absorption)
//    - upper wick rejection (seller rejection / supply)
// ✅ SPX macro shelves (6800/6900/7000) mapped to SPY using fixed ratio (SPX 6900 ↔ SPY 688)
// ✅ Engine 2 context (Minor=1h, Intermediate=4h)
// ✅ Fib levels derived from Engine 2 anchors (W1/W2) + “near fib” narrative guidance
//
// Uses ONLY:
// - OHLCV bars: /api/v1/ohlc?symbol=SPY&tf=1h
// - Zone context: /api/v1/engine5-context?symbol=SPY&tf=1h
// - Engine 2 already-calculated anchors via /api/v1/fib-levels (read-only) if needed
//
// Not a signal generator. Does not change engine math.

import express from "express";

export const marketNarratorRouter = express.Router();

const CORE_BASE = process.env.CORE_BASE || "http://127.0.0.1:10000";

/* ---------------- helpers ---------------- */

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function round2(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : null;
}

// ✅ Backward-compat helper (prevents crashes if old code still calls extractW1W2Anchors)
function extractW1W2Anchors(payload) {
  const w1 = payload?.anchors?.waveMarks?.W1?.p;
  const w2 = payload?.anchors?.waveMarks?.W2?.p;

  const p1 = toNum(w1);
  const p2 = toNum(w2);

  if (!p1 || p1 <= 0 || !p2 || p2 <= 0) return null;

  return { W1: p1, W2: p2 };
}
async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: r.ok, status: r.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

// ✅ Backward-compat helper (prevents crashes if old code still calls computeFibLevelsFromW1W2)
function computeFibLevelsFromW1W2({ W1, W2 }) {
  const a = toNum(W1);
  const b = toNum(W2);
  if (a == null || b == null) return null;

  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const range = hi - lo;
  if (!(range > 0)) return null;

  const retr = [0.382, 0.5, 0.618, 0.786].map((r) => ({
    tag: `${Math.round(r * 1000) / 10}%`,
    price: round2(hi - range * r),
    kind: "RETRACEMENT",
  }));

  const ext = [1.0, 1.272, 1.618].map((e) => ({
    tag: `${e.toFixed(3)}x`,
    price: round2(hi + range * (e - 1.0)),
    kind: "EXTENSION",
  }));

  const base = [
    { tag: "LOW", price: round2(lo), kind: "ANCHOR" },
    { tag: "HIGH", price: round2(hi), kind: "ANCHOR" },
  ];

  const levels = [...base, ...retr, ...ext]
    .filter((x) => x.price != null)
    .sort((x, y) => x.price - y.price);

  return { lo: round2(lo), hi: round2(hi), range: round2(range), levels };
}

function computeATR(bars, len = 14) {
  if (!Array.isArray(bars) || bars.length < len + 2) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high, l = bars[i].low, pc = bars[i - 1].close;
    if (![h, l, pc].every(Number.isFinite)) continue;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  if (trs.length < len) return null;

  let atr = trs.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < trs.length; i++) atr = atr * ((len - 1) / len) + trs[i] * (1 / len);
  return atr;
}

function candleStats(bar) {
  const o = toNum(bar?.open), h = toNum(bar?.high), l = toNum(bar?.low), c = toNum(bar?.close);
  if ([o, h, l, c].some(v => v == null)) return null;

  const range = h - l;
  const body = Math.abs(c - o);
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const bodyPct = range > 0 ? body / range : 0;
  const closePos = range > 0 ? (c - l) / range : 0.5; // 0..1

  return { o, h, l, c, range, body, upperWick, lowerWick, bodyPct, closePos };
}

/* ---------------- zone proximity helpers ---------------- */

function distToZone(price, z) {
  const p = toNum(price);
  const lo = toNum(z?.lo);
  const hi = toNum(z?.hi);
  if (p == null || lo == null || hi == null) return null;

  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);

  if (p >= a && p <= b) return 0;
  return p < a ? a - p : p - b;
}

function nearestAllowedZone({ price, negotiated = [], institutional = [] }) {
  let best = null;

  const scan = (arr, zoneType) => {
    const list = Array.isArray(arr) ? arr : [];
    for (const z of list) {
      const d = distToZone(price, z);
      if (d == null) continue;
      if (!best || d < best.distancePts) {
        best = {
          zoneType,
          id: z?.id ?? null,
          lo: z?.lo ?? null,
          hi: z?.hi ?? null,
          mid: z?.mid ?? null,
          strength: z?.strength ?? null,
          distancePts: d,
        };
      }
    }
  };

  scan(negotiated, "NEGOTIATED");
  scan(institutional, "INSTITUTIONAL");

  return best;
}

/* ---------------- SPX macro shelves (fixed mapping) ---------------- */
// User locked: SPX 6900 ↔ SPY 688
const SPX_SHELVES = [6800, 6900, 7000];
const SPX_TO_SPY_RATIO = 6900 / 688;

function buildMacroShelves({ price }) {
  const p = toNum(price);
  const mapped = SPX_SHELVES.map((lvl) => ({ spx: lvl, spy: lvl / SPX_TO_SPY_RATIO }));

  let nearest = null;
  if (p != null) {
    for (const m of mapped) {
      const d = Math.abs(p - m.spy);
      if (!nearest || d < nearest.distancePts) {
        nearest = {
          spx: m.spx,
          spy: m.spy,
          distancePts: d,
          side: p > m.spy ? "ABOVE" : p < m.spy ? "BELOW" : "ON",
        };
      }
    }
  }

  return {
    source: "SPX_ROUND_NUMBERS_FIXED",
    ratio: round2(SPX_TO_SPY_RATIO),
    spxLevels: SPX_SHELVES.slice(),
    spyMapped: mapped.map((m) => round2(m.spy)),
    nearest: nearest
      ? { spx: nearest.spx, spy: round2(nearest.spy), distancePts: round2(nearest.distancePts), side: nearest.side }
      : null,
  };
}

/* ---------------- Engine 2: wave + fib (read-only) ---------------- */

// LOCKED (per your CSV reality):
// - minor uses 1h
// - intermediate uses 1h (NOT 4h) because anchors exist there today
const ENGINE2_CTX = {
  minor: { tf: "1h", degree: "minor", wave: "W1" },
  intermediate: { tf: "1h", degree: "intermediate", wave: "W1" },
};

// Pull fib-levels payload (anchors + fib + signals are already computed by Engine 2)
async function fetchFibLevels({ symbol, tf, degree, wave }) {
  const u = new URL(`${CORE_BASE}/api/v1/fib-levels`);
  u.searchParams.set("symbol", symbol);
  u.searchParams.set("tf", tf);
  u.searchParams.set("degree", degree);
  u.searchParams.set("wave", wave);
  const r = await fetchJson(u.toString(), { timeoutMs: 15000 });
  return r?.ok && r?.json ? r.json : null;
}

/**
 * Engine 2 fib-levels@3 schema (confirmed):
 * payload.anchors.low/high
 * payload.anchors.waveMarks.W1/W2/W3/W4 (with p/t/tSec)
 * payload.signals.tag (e.g. "W2")
 * payload.fib.r382/r500/r618/invalidation
 *
 * We treat 0 or missing as NOT real.
 */
function isRealPrice(p) {
  const n = Number(p);
  return Number.isFinite(n) && n > 0;
}

function getWaveMark(payload, key) {
  const p = payload?.anchors?.waveMarks?.[key]?.p;
  return isRealPrice(p) ? Number(p) : null;
}

// Extract W1/W2 prices (and low/high if present)
function extractWaveContext(payload) {
  if (!payload || !payload.ok) return null;

  const low = payload?.anchors?.low;
  const high = payload?.anchors?.high;

  const ctx = {
    low: isRealPrice(low) ? Number(low) : null,
    high: isRealPrice(high) ? Number(high) : null,
    direction: payload?.anchors?.direction || null,
    tag: payload?.signals?.tag ?? payload?.anchors?.context ?? null, // usually "W2"
    waveMarks: {
      W1: getWaveMark(payload, "W1"),
      W2: getWaveMark(payload, "W2"),
      W3: getWaveMark(payload, "W3"),
      W4: getWaveMark(payload, "W4"),
    },
    fib: payload?.fib || null, // already computed by Engine 2
  };

  return ctx;
}

// Convert Engine 2 fib object into a consistent list for "nearest fib level" logic
function buildFibLevelsFromEngine2(payload) {
  const ctx = extractWaveContext(payload);
  if (!ctx) return null;

  // Prefer Engine2's computed fib levels directly
  const f = ctx.fib || {};
  const levels = [];

  // Anchors
  if (ctx.low != null) levels.push({ tag: "LOW", kind: "ANCHOR", price: round2(ctx.low) });
  if (ctx.high != null) levels.push({ tag: "HIGH", kind: "ANCHOR", price: round2(ctx.high) });

  // Retracements (Engine 2 naming)
  if (isRealPrice(f.r382)) levels.push({ tag: "38.2%", kind: "RETRACEMENT", price: round2(f.r382) });
  if (isRealPrice(f.r500)) levels.push({ tag: "50.0%", kind: "RETRACEMENT", price: round2(f.r500) });
  if (isRealPrice(f.r618)) levels.push({ tag: "61.8%", kind: "RETRACEMENT", price: round2(f.r618) });

  // Invalidation (important line)
  if (isRealPrice(f.invalidation)) levels.push({ tag: "INVALIDATION", kind: "RISK_LINE", price: round2(f.invalidation) });

  // Keep levels sorted and unique
  const uniq = [];
  for (const l of levels) {
    if (l?.price == null) continue;
    const key = `${l.kind}|${l.tag}|${l.price}`;
    if (!uniq.find((x) => `${x.kind}|${x.tag}|${x.price}` === key)) uniq.push(l);
  }
  uniq.sort((a, b) => a.price - b.price);

  return {
    ok: true,
    meta: payload?.meta || null,
    tag: ctx.tag,
    direction: ctx.direction,
    waveMarks: ctx.waveMarks,
    levels: uniq,
  };
}

// Wave 3 target projection when W3 mark is missing (W3 pending):
// target = W2 + ratio * (W1_high - W1_low)
function computeWave3TargetsFromW1({ payload }) {
  const ctx = extractWaveContext(payload);
  if (!ctx) return null;

  const w1Low = ctx.low;
  const w1High = ctx.high;
  const w2 = ctx.waveMarks?.W2;

  // Need W1 low/high AND W2 mark
  if (w1Low == null || w1High == null || w2 == null) return null;

  const wave1Len = Math.abs(w1High - w1Low);
  if (!(wave1Len > 0)) return null;

  const dir = (ctx.direction || "up").toLowerCase(); // usually "up"
  const ratios = [1.0, 1.272, 1.618];

  const targets = ratios.map((r) => {
    const t = dir === "down" ? (w2 - r * wave1Len) : (w2 + r * wave1Len);
    return { ratio: r, price: round2(t) };
  });

  return {
    w3Pending: ctx.waveMarks?.W3 == null, // true when W3 mark not set
    wave1Len: round2(wave1Len),
    w2: round2(w2),
    direction: dir,
    targets,
    primary618: targets.find((t) => t.ratio === 1.618)?.price ?? null,
  };
}

function nearestFibLevel({ price, fib, atr }) {
  const p = toNum(price);
  if (p == null || !fib?.levels?.length) return null;

  let best = null;
  for (const lvl of fib.levels) {
    const d = Math.abs(p - lvl.price);
    if (!best || d < best.distancePts) best = { ...lvl, distancePts: d };
  }

  const dPts = best ? best.distancePts : null;
  const nearPts = dPts != null ? round2(dPts) : null;
  const nearAtr = (dPts != null && Number.isFinite(atr) && atr > 0) ? round2(dPts / atr) : null;

  return best
    ? { tag: best.tag, kind: best.kind, price: best.price, distancePts: nearPts, distanceAtr: nearAtr }
    : null;
}

/* ---------------- market structure helpers ---------------- */

function summarizeImpulse(bar, atr) {
  const s = candleStats(bar);
  if (!s || !Number.isFinite(atr) || atr <= 0) {
    return { impulseScore: 0, direction: "FLAT", rangeAtr: null, bodyPct: null };
  }

  const dir = s.c > s.o ? "UP" : s.c < s.o ? "DOWN" : "FLAT";
  const rangeAtr = s.range / atr;
  const bodyDominant = s.bodyPct;

  let score = 0;
  score += clamp(rangeAtr / 2.0, 0, 1) * 5;
  score += clamp(bodyDominant, 0, 1) * 5;

  return {
    impulseScore: Math.round(score),
    direction: dir,
    rangeAtr: round2(rangeAtr),
    bodyPct: round2(bodyDominant),
  };
}

function computeWave3Targets({ wave1Low, wave1High, wave2Price, direction = "up" }) {
  const lo = toNum(wave1Low);
  const hi = toNum(wave1High);
  const w2 = toNum(wave2Price);
  if (lo == null || hi == null || w2 == null) return null;

  const wave1Len = Math.abs(hi - lo);
  if (!(wave1Len > 0)) return null;

  const ratios = [1.0, 1.272, 1.618];

  const targets = ratios.map((r) => {
    const price =
      direction === "down"
        ? (w2 - r * wave1Len)
        : (w2 + r * wave1Len);

    return { ratio: r, price: round2(price) };
  });

  return {
    wave1Len: round2(wave1Len),
    wave2Price: round2(w2),
    direction,
    targets,
  };
}
function rangeHiLo(bars) {
  let hi = -Infinity, lo = Infinity;
  for (const b of bars) {
    const h = toNum(b.high), l = toNum(b.low);
    if (h == null || l == null) continue;
    if (h > hi) hi = h;
    if (l < lo) lo = l;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || !(hi > lo)) return null;
  return { hi, lo, mid: (hi + lo) / 2, width: hi - lo };
}

function detectBalance({ bars, atr, n = 12, maxWidthAtr = 2.25 }) {
  if (!Array.isArray(bars) || bars.length < n || !Number.isFinite(atr) || atr <= 0) return null;
  const slice = bars.slice(-n);
  const r = rangeHiLo(slice);
  if (!r) return null;

  const widthAtr = r.width / atr;
  const isBalance = widthAtr <= maxWidthAtr;

  // tighter overlap band
  const bandLo = r.mid - 0.25 * r.width;
  const bandHi = r.mid + 0.25 * r.width;

  let inside = 0;
  for (const b of slice) {
    const c = toNum(b.close);
    if (c != null && c >= bandLo && c <= bandHi) inside++;
  }
  const overlapPct = inside / slice.length;

  return {
    isBalance: Boolean(isBalance && overlapPct >= 0.55),
    n,
    hi: r.hi,
    lo: r.lo,
    mid: r.mid,
    width: r.width,
    widthAtr,
    overlapPct,
  };
}

function phaseFromBalanceAndLast({ balance, lastBar, prevBar, atr }) {
  const last = candleStats(lastBar);
  const prev = candleStats(prevBar);
  if (!last || !prev || !balance || !Number.isFinite(atr) || atr <= 0) {
    return { phase: "UNKNOWN", details: {} };
  }

  const { hi, lo } = balance;
  const lastClose = last.c;
  const prevClose = prev.c;

  const outsideUp = lastClose > hi;
  const outsideDown = lastClose < lo;
  const backInside = lastClose <= hi && lastClose >= lo;

  const lastRangeAtr = last.range / atr;
  const lastBodyPct = last.bodyPct;
  const strongImpulse = lastRangeAtr >= 1.1 && lastBodyPct >= 0.55;

  const acceptanceUp = prevClose > hi && lastClose > hi;
  const acceptanceDown = prevClose < lo && lastClose < lo;

  const wickAbove = last.h > hi && backInside;
  const wickBelow = last.l < lo && backInside;

  const weakBreak = (outsideUp || outsideDown) && !strongImpulse;

  if (balance.isBalance) {
    if (acceptanceUp) return { phase: "ACCEPTANCE_UP", details: { hi, lo } };
    if (acceptanceDown) return { phase: "ACCEPTANCE_DOWN", details: { hi, lo } };

    if ((outsideUp || outsideDown) && strongImpulse) {
      return { phase: "EXPANSION", details: { dir: outsideUp ? "UP" : "DOWN", hi, lo } };
    }

    if (wickAbove || wickBelow) {
      return { phase: "REJECTION", details: { dir: wickAbove ? "DOWN" : "UP", hi, lo } };
    }

    if (weakBreak) return { phase: "TRAP_RISK", details: { hi, lo } };

    return { phase: "BALANCE", details: { hi, lo } };
  }

  if (strongImpulse) return { phase: "IMPULSE", details: { dir: lastClose > prevClose ? "UP" : "DOWN" } };
  return { phase: "CORRECTION", details: {} };
}

function detectViolentExpansion({ bars, atr, balance }) {
  if (!Array.isArray(bars) || bars.length < 3 || !Number.isFinite(atr) || atr <= 0) {
    return { signal: false };
  }

  const last = candleStats(bars[bars.length - 1]);
  const prev = candleStats(bars[bars.length - 2]);
  if (!last || !prev) return { signal: false };

  const lastStrong = last.range / atr >= 1.1 && last.bodyPct >= 0.55;
  const prevStrong = prev.range / atr >= 1.1 && prev.bodyPct >= 0.55;

  const lastDir = last.c > last.o ? "UP" : last.c < last.o ? "DOWN" : "FLAT";
  const prevDir = prev.c > prev.o ? "UP" : prev.c < prev.o ? "DOWN" : "FLAT";
  const sameDir = lastDir !== "FLAT" && lastDir === prevDir;

  const hi = toNum(balance?.hi);
  const lo = toNum(balance?.lo);
  const brokeUp = hi != null ? prev.c > hi || last.c > hi : false;
  const brokeDown = lo != null ? prev.c < lo || last.c < lo : false;

  const signal = Boolean(lastStrong && prevStrong && sameDir);

  return {
    signal,
    direction: signal ? lastDir : null,
    bars: signal ? 2 : 0,
    brokeBalance: signal ? Boolean(brokeUp || brokeDown) : false,
    brokeDir: signal ? (brokeUp ? "UP" : brokeDown ? "DOWN" : null) : null,
    last: { rangeAtr: round2(last.range / atr), bodyPct: round2(last.bodyPct) },
    prev: { rangeAtr: round2(prev.range / atr), bodyPct: round2(prev.bodyPct) },
  };
}

/* ---------------- Layer narratives ---------------- */

function buildKeyLevels({ balance, zones, macroShelves, fibMinor, fibInter }) {
  const levels = [];

  if (balance?.hi != null) levels.push(balance.hi);
  if (balance?.lo != null) levels.push(balance.lo);

  if (zones?.activeZone?.lo != null) levels.push(zones.activeZone.lo);
  if (zones?.activeZone?.hi != null) levels.push(zones.activeZone.hi);

  if (zones?.nearestAllowed?.lo != null) levels.push(zones.nearestAllowed.lo);
  if (zones?.nearestAllowed?.hi != null) levels.push(zones.nearestAllowed.hi);

  if (macroShelves?.nearest?.spy != null) levels.push(macroShelves.nearest.spy);
  if (Array.isArray(macroShelves?.spyMapped)) macroShelves.spyMapped.forEach(v => levels.push(v));

  // Add a few nearest fib levels (minor + intermediate)
  const addFib = (fib) => {
    if (!fib?.levels?.length) return;
    for (const lvl of fib.levels) levels.push(lvl.price);
  };
  addFib(fibMinor);
  addFib(fibInter);

  const uniq = [];
  for (const v of levels.map(toNum).filter(x => x != null)) {
    const r = round2(v);
    if (!uniq.includes(r)) uniq.push(r);
  }
  return uniq.sort((a, b) => a - b);
}

// Wick rejection detector (lower/upper)
function detectWickRejections({ bars, atr, keyLevels = [], windowBars = 24, side = "LOWER" }) {
  if (!Array.isArray(bars) || bars.length < 2 || !Number.isFinite(atr) || atr <= 0) {
    return { detected: false, count: 0, strongest: null, hits: [] };
  }

  const eps = 0.15 * atr;
  const slice = bars.slice(-windowBars);
  const hits = [];

  for (let i = 0; i < slice.length; i++) {
    const b = slice[i];
    const s = candleStats(b);
    if (!s) continue;

    const wick = side === "LOWER" ? s.lowerWick : s.upperWick;
    const wickToBody = s.body > 0 ? wick / s.body : (wick > 0 ? 99 : 0);

    const longWick = wickToBody >= 1.25;
    const strongClose = side === "LOWER" ? (s.closePos >= 0.60) : (s.closePos <= 0.40);

    if (!(longWick && strongClose)) continue;

    let touched = null;
    for (const lvl of keyLevels) {
      const L = toNum(lvl);
      if (L == null) continue;

      if (side === "LOWER") {
        if (s.l <= (L + eps) && s.c >= (L - eps)) { touched = L; break; }
      } else {
        if (s.h >= (L - eps) && s.c <= (L + eps)) { touched = L; break; }
      }
    }

    hits.push({
      indexFromEnd: slice.length - 1 - i,
      high: round2(s.h),
      low: round2(s.l),
      close: round2(s.c),
      wickToBody: round2(wickToBody),
      closePos: round2(s.closePos),
      touchedLevel: touched != null ? round2(touched) : null,
    });
  }

  let strongest = null;
  for (const h of hits) {
    if (!strongest || (h.wickToBody ?? 0) > (strongest.wickToBody ?? 0)) strongest = h;
  }

  return { detected: hits.length > 0, count: hits.length, strongest, hits: hits.slice(-6) };
}

function buildLayer1RecentNarrative({ bars, atr, keyLevels }) {
  const windowBars = 24;
  const slice = bars.slice(-windowBars);

  const types = slice.map((b) => {
    const s = candleStats(b);
    if (!s || !Number.isFinite(atr) || atr <= 0) return "UNKNOWN";
    const dir = s.c > s.o ? "UP" : s.c < s.o ? "DOWN" : "FLAT";
    const rangeAtr = s.range / atr;
    const strong = rangeAtr >= 1.1 && s.bodyPct >= 0.55;

    if (strong && dir === "UP") return "IMPULSE_UP";
    if (strong && dir === "DOWN") return "IMPULSE_DOWN";
    if (s.bodyPct <= 0.25 && rangeAtr <= 0.9) return "HESITATION";
    return dir === "UP" ? "UP_BAR" : dir === "DOWN" ? "DOWN_BAR" : "FLAT";
  });

  const hasUpImpulse = types.includes("IMPULSE_UP");
  const hasDownImpulse = types.includes("IMPULSE_DOWN");
  const hesitations = types.filter(t => t === "HESITATION").length;

  let sequence = "MIXED_ROTATION";
  if (hasUpImpulse && !hasDownImpulse && hesitations <= 2) sequence = "BUYERS_PUSH";
  if (hasDownImpulse && !hasUpImpulse && hesitations <= 2) sequence = "SELLERS_PUSH";
  if (hasUpImpulse && hasDownImpulse) sequence = "PUSH_AND_PULLBACK";

  const lowerWicks = detectWickRejections({ bars, atr, keyLevels, windowBars, side: "LOWER" });
  const upperWicks = detectWickRejections({ bars, atr, keyLevels, windowBars, side: "UPPER" });

  let text = "";
  if (sequence === "BUYERS_PUSH") text = "Last 24 hours: buyers pushed with expanding candles and limited hesitation.";
  else if (sequence === "SELLERS_PUSH") text = "Last 24 hours: sellers pushed with expanding candles and limited bounce.";
  else if (sequence === "PUSH_AND_PULLBACK") text = "Last 24 hours: push-and-pullback sequence (initiative move met with counter-pressure).";
  else text = "Last 24 hours: mixed rotation with no clean directional dominance.";

  if (lowerWicks.detected && lowerWicks.strongest) {
    const s = lowerWicks.strongest;
    if (s.touchedLevel != null) {
      text += ` Bullish defense: a long lower wick probed into ${s.touchedLevel.toFixed(2)} and was bought up quickly, closing at ${s.close.toFixed(2)}.`;
    } else {
      text += ` Bullish defense: a long lower wick was bought up quickly (close ${s.close.toFixed(2)}).`;
    }
  }

  if (upperWicks.detected && upperWicks.strongest) {
    const s = upperWicks.strongest;
    if (s.touchedLevel != null) {
      text += ` Seller rejection: a long upper wick tagged ${s.touchedLevel.toFixed(2)} and was sold back down, closing at ${s.close.toFixed(2)}.`;
    } else {
      text += ` Seller rejection: a long upper wick was sold back down (close ${s.close.toFixed(2)}).`;
    }
  }

  return { windowBars, sequence, barTypes: types, lowerWickRejections: lowerWicks, upperWickRejections: upperWicks, text };
}

function buildLayer2CurrentNarrative({ price, phase, zones, macroShelves, impulse, fibCtx }) {
  const inAllowed = Boolean(zones?.inAllowedZone);
  const near = zones?.nearestAllowed?.distancePts != null ? zones.nearestAllowed.distancePts : null;

  let text = `Right now: phase is ${phase}. `;

  if (inAllowed && zones?.activeZone) {
    text += `Price ${price != null ? price.toFixed(2) : ""} is inside ${zones.activeZone.zoneType} zone ${Number(zones.activeZone.lo).toFixed(2)}–${Number(zones.activeZone.hi).toFixed(2)}. `;
  } else if (near != null) {
    text += `Price ${price != null ? price.toFixed(2) : ""} is outside allowed zones, but near ${zones.nearestAllowed.zoneType} by ${near.toFixed(2)} pts. `;
  } else {
    text += `Price ${price != null ? price.toFixed(2) : ""} is not near an allowed zone. `;
  }

  if (macroShelves?.nearest?.spx != null && macroShelves?.nearest?.spy != null) {
    text += `Macro shelf: SPX ${macroShelves.nearest.spx} maps to ~SPY ${macroShelves.nearest.spy.toFixed(2)} (price is ${macroShelves.nearest.side} by ${macroShelves.nearest.distancePts.toFixed(2)}). `;
  }

  if (fibCtx?.summary) text += `${fibCtx.summary} `;

  if (impulse?.impulseScore != null) {
    text += `Latest impulse score is ${impulse.impulseScore}/10 (${impulse.direction}). `;
  }

  return { phase, inAllowedZone: inAllowed, nearAllowedPts: near, text };
}

function buildLayer3NextNarrative({ zones, balance, macroShelves, fibCtx }) {
  const out = { decision: [], confirmations: [], invalidations: [], text: "" };

  const bHi = toNum(balance?.hi);
  const bLo = toNum(balance?.lo);

  if (bHi != null && bLo != null) {
    out.confirmations.push({ if: `Decisive close above ${bHi.toFixed(2)}`, then: "Acceptance up / continuation bias" });
    out.invalidations.push({ if: `Decisive close below ${bLo.toFixed(2)}`, then: "Acceptance down / bearish continuation risk" });
    out.decision.push({ level: round2(bHi), label: "Balance High" });
    out.decision.push({ level: round2(bLo), label: "Balance Low" });
  }

  if (macroShelves?.nearest?.spx != null) {
    out.decision.push({ level: macroShelves.nearest.spy, label: `Macro shelf (SPX ${macroShelves.nearest.spx})` });
  }

  if (fibCtx?.nextRules?.length) {
    fibCtx.nextRules.forEach(r => out.confirmations.push(r));
  }

  if (zones?.activeZone?.lo != null && zones?.activeZone?.hi != null) {
    const lo = Number(zones.activeZone.lo);
    const hi = Number(zones.activeZone.hi);
    const mid = (Math.min(lo, hi) + Math.max(lo, hi)) / 2;

    out.confirmations.push({ if: `Hold above zone high ${hi.toFixed(2)}`, then: "Acceptance / continuation inside higher range" });
    out.invalidations.push({ if: `Lose midline ${mid.toFixed(2)}`, then: "Shift back into balance / rejection risk" });

    out.text = `What I'm watching next: hold above ${hi.toFixed(2)} for acceptance, or lose midline ${mid.toFixed(2)} for rejection back into value.`;
    return out;
  }

  if (zones?.nearestAllowed?.distancePts != null) {
    const z = zones.nearestAllowed;
    const lo = toNum(z.lo);
    const hi = toNum(z.hi);
    const d = toNum(z.distancePts);

    if (lo != null && hi != null && d != null) {
      out.decision.push({ level: round2(lo), label: `${z.zoneType} lo` });
      out.decision.push({ level: round2(hi), label: `${z.zoneType} hi` });

      out.confirmations.push({ if: `Re-enter ${z.zoneType} ${lo.toFixed(2)}–${hi.toFixed(2)}`, then: "Eligible for zone-based reading (no chase)" });
      out.invalidations.push({ if: `Continue away from zone`, then: "Remain stand-down / avoid chase" });

      out.text = `What I'm watching next: price is ${d.toFixed(2)} pts from ${z.zoneType}. I want a clean re-entry into ${lo.toFixed(2)}–${hi.toFixed(2)} before considering a setup.`;
      return out;
    }
  }

  out.text = "What I'm watching next: no nearby allowed zone. Wait for price to approach negotiated/institutional structure.";
  return out;
}

/* ---------------- Narrative formatting ---------------- */

function buildNarrativeTextDescriptive({ layer1, layer2, layer3 }) {
  const p1 = layer1?.text || "Last 24 hours: no recent narrative available.";
  const p2 = layer2?.text || "Right now: no current narrative available.";
  const p3 = layer3?.text || "What I'm watching next: no next-step narrative available.";
  return `${p1}\n\n${p2}\n\n${p3}`;
}

/* ---------------- route ---------------- */
// GET /api/v1/market-narrator?symbol=SPY&tf=1h&style=descriptive
marketNarratorRouter.get("/market-narrator", async (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tf = String(req.query.tf || "1h");
  const style = String(req.query.style || "").toLowerCase().trim();

  if (symbol !== "SPY") {
    return res.json({ ok: false, error: "SPY_ONLY_V1", meta: { symbol, supported: ["SPY"] } });
  }

  try {
    // 1) Bars
    const ohlcUrl = new URL(`${CORE_BASE}/api/v1/ohlc`);
    ohlcUrl.searchParams.set("symbol", symbol);
    ohlcUrl.searchParams.set("tf", tf);
    ohlcUrl.searchParams.set("limit", "250");

    const barsResp = await fetchJson(ohlcUrl.toString(), { timeoutMs: 20000 });
    if (!barsResp.ok || !Array.isArray(barsResp.json) || barsResp.json.length < 30) {
      return res.status(502).json({
        ok: false,
        error: "BARS_UNAVAILABLE",
        meta: { symbol, tf },
        detail: barsResp.text?.slice(0, 200) || "no bars",
      });
    }

    const bars = barsResp.json
      .map((b) => ({
        time: b.time ?? b.t ?? null,
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume ?? 0),
      }))
      .filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite));

    const atr = computeATR(bars, 14) || computeATR(bars, 10) || null;
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];

    // 2) Zones (engine5-context)
    const ctxUrl = new URL(`${CORE_BASE}/api/v1/engine5-context`);
    ctxUrl.searchParams.set("symbol", symbol);
    ctxUrl.searchParams.set("tf", tf);

    const ctxResp = await fetchJson(ctxUrl.toString(), { timeoutMs: 15000 });
    const ctx = ctxResp.ok && ctxResp.json ? ctxResp.json : null;

    const price = toNum(ctx?.meta?.current_price) ?? toNum(ctx?.meta?.currentPrice) ?? toNum(last?.close) ?? null;

    const negotiated = ctx?.render?.negotiated || [];
    const institutional = ctx?.render?.institutional || [];

    const nearest = nearestAllowedZone({ price, negotiated, institutional });

    const inAllowed =
      Boolean(ctx?.active?.negotiated && price != null) ||
      Boolean(ctx?.active?.institutional && price != null);

    const zones = {
      inAllowedZone: Boolean(inAllowed),
      activeZone: ctx?.active?.negotiated
        ? { zoneType: "NEGOTIATED", ...ctx.active.negotiated }
        : ctx?.active?.institutional
        ? { zoneType: "INSTITUTIONAL", ...ctx.active.institutional }
        : null,
      nearestAllowed: nearest
        ? { zoneType: nearest.zoneType, zoneId: nearest.id, lo: nearest.lo, hi: nearest.hi, distancePts: nearest.distancePts }
        : null,
    };

    const macroShelves = buildMacroShelves({ price });

    // 3) Engine 2 context + fib (minor + intermediate)
    const [fibMinorRaw, fibInterRaw] = await Promise.all([
      fetchFibLevels({ symbol, ...ENGINE2_CTX.minor }).catch(() => null),
      fetchFibLevels({ symbol, ...ENGINE2_CTX.intermediate }).catch(() => null),
    ]);

    const minorAnch = fibMinorRaw ? extractW1W2Anchors(fibMinorRaw) : null;
    const interAnch = fibInterRaw ? extractW1W2Anchors(fibInterRaw) : null;

    const fibMinor = minorAnch ? computeFibLevelsFromW1W2(minorAnch) : null;
    const fibInter = interAnch ? computeFibLevelsFromW1W2(interAnch) : null;

    const nearestMinor = nearestFibLevel({ price, fib: fibMinor, atr });
    const nearestInter = nearestFibLevel({ price, fib: fibInter, atr });

    const engine2 = {
      minor: {
        tf: ENGINE2_CTX.minor.tf,
        degree: ENGINE2_CTX.minor.degree,
        wave: ENGINE2_CTX.minor.wave,
        ok: Boolean(fibMinorRaw?.ok),
        phase: fibMinorRaw?.phase ?? fibMinorRaw?.signals?.phase ?? fibMinorRaw?.meta?.phase ?? "UNKNOWN",
        anchorTag: fibMinorRaw?.anchorTag ?? fibMinorRaw?.signals?.tag ?? null,
        fibScore: fibMinorRaw?.fibScore ?? 0,
        invalidated: Boolean(fibMinorRaw?.invalidated ?? fibMinorRaw?.signals?.invalidated),
        anchors: minorAnch ? { W1: minorAnch.W1, W2: minorAnch.W2 } : null,
        nearestLevel: nearestMinor,
      },
      intermediate: {
        tf: ENGINE2_CTX.intermediate.tf,
        degree: ENGINE2_CTX.intermediate.degree,
        wave: ENGINE2_CTX.intermediate.wave,
        ok: Boolean(fibInterRaw?.ok),
        phase: fibInterRaw?.phase ?? fibInterRaw?.signals?.phase ?? fibInterRaw?.meta?.phase ?? "UNKNOWN",
        anchorTag: fibInterRaw?.anchorTag ?? fibInterRaw?.signals?.tag ?? null,
        fibScore: fibInterRaw?.fibScore ?? 0,
        invalidated: Boolean(fibInterRaw?.invalidated ?? fibInterRaw?.signals?.invalidated),
        anchors: interAnch ? { W1: interAnch.W1, W2: interAnch.W2 } : null,
        nearestLevel: nearestInter,
      },
    };

    // Build a short fib summary for paragraph 2 + rules for paragraph 3
    const fibCtx = (() => {
      const parts = [];
      const rules = [];

      const add = (name, near) => {
        if (!near) return;
        if (near.distancePts != null && near.distancePts <= 0.35) {
          parts.push(`${name} fib: near ${near.kind.toLowerCase()} ${near.tag} at ${near.price.toFixed(2)} (within ${near.distancePts.toFixed(2)} pts).`);
          rules.push({ if: `Respect fib ${near.tag} (${name})`, then: "Watch for rejection vs acceptance at this line" });
        } else if (near.distanceAtr != null && near.distanceAtr <= 0.25) {
          parts.push(`${name} fib: near ${near.tag} at ${near.price.toFixed(2)} (~${near.distanceAtr.toFixed(2)} ATR away).`);
        }
      };

      add("Minor", nearestMinor);
      add("Intermediate", nearestInter);

      return {
        summary: parts.length ? parts.join(" ") : "",
        nextRules: rules,
      };
    })();

    // 4) Market regime
    const balance = detectBalance({ bars, atr, n: 12, maxWidthAtr: 2.25 });
    const { phase, details } = phaseFromBalanceAndLast({ balance, lastBar: last, prevBar: prev, atr });

    const impulse = summarizeImpulse(last, atr);
    const violentExpansion = detectViolentExpansion({ bars, atr, balance });

    // key levels (include fib levels too)
    const keyLevels = buildKeyLevels({ balance, zones, macroShelves, fibMinor, fibInter });

    // LAYER 1/2/3
    const layer1 = buildLayer1RecentNarrative({ bars, atr, keyLevels });
    const layer2 = buildLayer2CurrentNarrative({ price, phase, zones, macroShelves, impulse, fibCtx });
    const layer3 = buildLayer3NextNarrative({ zones, balance, macroShelves, fibCtx });

    const narrativeText =
      style === "descriptive"
        ? buildNarrativeTextDescriptive({ layer1, layer2, layer3 })
        : `${layer1.text} ${layer2.text} ${layer3.text}`;

    return res.json({
      ok: true,
      symbol,
      tf,
      asOf: new Date().toISOString(),

      price,
      atr,

      phase,
      bias:
        phase === "ACCEPTANCE_UP" ? "BULLISH" :
        phase === "ACCEPTANCE_DOWN" ? "BEARISH" :
        phase === "EXPANSION" ? (details?.dir === "UP" ? "BULLISH" : "BEARISH") :
        phase === "REJECTION" ? (details?.dir === "UP" ? "BULLISH_REVERSAL_RISK" : "BEARISH_REVERSAL_RISK") :
        "NEUTRAL",

      confidence: clamp(
        balance?.isBalance
          ? Math.round(50 + clamp(1 - balance.widthAtr / 2.25, 0, 1) * 25 + impulse.impulseScore * 2)
          : Math.round(40 + impulse.impulseScore * 4),
        0,
        100
      ),

      balance: balance ? {
        isBalance: balance.isBalance,
        n: balance.n,
        hi: round2(balance.hi),
        lo: round2(balance.lo),
        mid: round2(balance.mid),
        width: round2(balance.width),
        widthAtr: round2(balance.widthAtr),
        overlapPct: round2(balance.overlapPct),
      } : null,

      impulse: {
        direction: impulse.direction,
        impulseScore: impulse.impulseScore,
        rangeAtr: impulse.rangeAtr,
        bodyPct: impulse.bodyPct,
      },

      violentExpansion,

      zones,
      macroShelves,

      engine2,
      fib: {
        minor: fibMinor,
        intermediate: fibInter,
      },

      layer1,
      layer2,
      layer3,

      narrativeText,

      next: {
        keyLevels,
      },
    });

  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "MARKET_NARRATOR_ERROR",
      message: String(e?.message || e),
    });
  }
});

export default marketNarratorRouter;
