// services/core/routes/marketNarrator.js
// Engine 14A (Read-only) — Market Narrator (SPY only)
//
// v2 upgrades:
// ✅ Layer 1 now covers last 6 hours (6 x 1h candles)
// ✅ Detects "fast rejection" long lower wick candles and narrates them
// ✅ Adds SPX macro shelves (6800/6900/7000) mapped to SPY using fixed ratio:
//    SPX 6900 ↔ SPY 688  (user-locked mapping)
//
// Uses ONLY:
// - OHLCV bars: /api/v1/ohlc?symbol=SPY&tf=1h
// - Zone context: /api/v1/engine5-context?symbol=SPY&tf=1h
//
// Not a signal generator. Does not change engine math.
// Deterministic, audit-friendly.

import express from "express";

export const marketNarratorRouter = express.Router();

// Prefer loopback inside the same service container.
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

async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, cache: "no-store" });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { ok: r.ok, status: r.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function computeATR(bars, len = 14) {
  if (!Array.isArray(bars) || bars.length < len + 2) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high,
      l = bars[i].low,
      pc = bars[i - 1].close;
    if (![h, l, pc].every(Number.isFinite)) continue;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  if (trs.length < len) return null;

  // Wilder smoothing
  let atr = trs.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < trs.length; i++) atr = atr * ((len - 1) / len) + trs[i] * (1 / len);
  return atr;
}

function candleStats(bar) {
  const o = toNum(bar?.open),
    h = toNum(bar?.high),
    l = toNum(bar?.low),
    c = toNum(bar?.close);
  if ([o, h, l, c].some((v) => v == null)) return null;
  const range = h - l;
  const body = Math.abs(c - o);
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const bodyPct = range > 0 ? body / range : 0;
  const closePos = range > 0 ? (c - l) / range : 0.5; // 0..1
  return { o, h, l, c, range, body, upperWick, lowerWick, bodyPct, closePos };
}

/* ---------------- zone proximity helpers ---------------- */

// distance from price to zone boundary (0 if inside)
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
const SPX_TO_SPY_RATIO = 6900 / 688; // ≈ 10.02907

function buildMacroShelves({ price }) {
  const p = toNum(price);
  const mapped = SPX_SHELVES.map((lvl) => ({
    spx: lvl,
    spy: lvl / SPX_TO_SPY_RATIO,
  }));

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
      ? {
          spx: nearest.spx,
          spy: round2(nearest.spy),
          distancePts: round2(nearest.distancePts),
          side: nearest.side,
        }
      : null,
  };
}

/* ---------------- market structure helpers ---------------- */

function summarizeImpulse(bar, atr) {
  const s = candleStats(bar);
  if (!s || !Number.isFinite(atr) || atr <= 0) return { impulseScore: 0, direction: "FLAT", rangeAtr: null, bodyPct: null };

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

// Detect bullish fast rejection lower wicks in last N bars
function detectLowerWickRejections({ bars, atr, keyLevels = [], windowBars = 6 }) {
  if (!Array.isArray(bars) || bars.length < 2 || !Number.isFinite(atr) || atr <= 0) {
    return { detected: false, count: 0, strongest: null, hits: [] };
  }

  const eps = 0.15 * atr; // "touched zone" tolerance
  const slice = bars.slice(-windowBars);

  const hits = [];

  for (let i = 0; i < slice.length; i++) {
    const b = slice[i];
    const s = candleStats(b);
    if (!s) continue;

    // Long lower wick + strong close (upper half)
    const wickToBody = s.body > 0 ? s.lowerWick / s.body : (s.lowerWick > 0 ? 99 : 0);
    const longLowerWick = wickToBody >= 1.25;
    const strongClose = s.closePos >= 0.60;

    if (!(longLowerWick && strongClose)) continue;

    // Did it probe into a key level?
    let touched = null;
    for (const lvl of keyLevels) {
      const L = toNum(lvl);
      if (L == null) continue;
      // low at or below level (+eps), and close back above it → “bought up quickly”
      if (s.l <= (L + eps) && s.c >= (L - eps)) {
        touched = L;
        break;
      }
    }

    hits.push({
      indexFromEnd: slice.length - 1 - i,
      low: round2(s.l),
      close: round2(s.c),
      wickToBody: round2(wickToBody),
      closePos: round2(s.closePos),
      touchedLevel: touched != null ? round2(touched) : null,
    });
  }

  // Pick strongest by wickToBody
  let strongest = null;
  for (const h of hits) {
    if (!strongest || (h.wickToBody ?? 0) > (strongest.wickToBody ?? 0)) strongest = h;
  }

  return {
    detected: hits.length > 0,
    count: hits.length,
    strongest,
    hits: hits.slice(-6),
  };
}

function buildKeyLevels({ balance, zones, macroShelves }) {
  const levels = [];

  if (balance?.hi != null) levels.push(balance.hi);
  if (balance?.lo != null) levels.push(balance.lo);

  if (zones?.activeZone?.lo != null) levels.push(zones.activeZone.lo);
  if (zones?.activeZone?.hi != null) levels.push(zones.activeZone.hi);

  if (zones?.nearestAllowed?.lo != null) levels.push(zones.nearestAllowed.lo);
  if (zones?.nearestAllowed?.hi != null) levels.push(zones.nearestAllowed.hi);

  // macro shelf mapped to SPY
  if (macroShelves?.nearest?.spy != null) levels.push(macroShelves.nearest.spy);
  if (Array.isArray(macroShelves?.spyMapped)) {
    for (const v of macroShelves.spyMapped) levels.push(v);
  }

  // uniq + numbers
  const uniq = [];
  for (const v of levels.map(toNum).filter((x) => x != null)) {
    const r = round2(v);
    if (!uniq.includes(r)) uniq.push(r);
  }
  return uniq.sort((a, b) => a - b);
}

function buildLayer1RecentNarrative({ bars, atr, zones, keyLevels }) {
  const windowBars = 6;
  const slice = bars.slice(-windowBars);

  // Classify last 6 bars roughly
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

  let sequence = "MIXED_ROTATION";
  if (hasUpImpulse && !hasDownImpulse) sequence = "BUYERS_PUSH";
  if (hasDownImpulse && !hasUpImpulse) sequence = "SELLERS_PUSH";
  if (hasUpImpulse && hasDownImpulse) sequence = "PUSH_AND_PULLBACK";

  const wickInfo = detectLowerWickRejections({ bars, atr, keyLevels, windowBars });

  // Narrative text with wick detail (your requested behavior)
  let text = "";
  if (sequence === "BUYERS_PUSH") text = "Last 6 hours: buyers pushed with expanding candles and limited hesitation.";
  else if (sequence === "SELLERS_PUSH") text = "Last 6 hours: sellers pushed with expanding candles and limited bounce.";
  else if (sequence === "PUSH_AND_PULLBACK") text = "Last 6 hours: push-and-pullback sequence (initiative move met with counter-pressure).";
  else text = "Last 6 hours: mixed rotation with no clean directional dominance.";

  if (wickInfo.detected && wickInfo.strongest) {
    const s = wickInfo.strongest;
    if (s.touchedLevel != null) {
      text += ` Notable bullish defense: a long lower wick probed down into ${s.touchedLevel.toFixed(2)} and was bought up quickly, closing at ${s.close.toFixed(2)}.`;
    } else {
      text += ` Notable bullish defense: a long lower wick was bought up quickly (close ${s.close.toFixed(2)}).`;
    }
  }

  return {
    windowBars,
    sequence,
    barTypes: types,
    lowerWickRejections: wickInfo,
    text,
  };
}

function buildLayer2CurrentNarrative({ price, phase, zones, macroShelves, impulse, violentExpansion }) {
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
    text += `Macro shelf check: SPX ${macroShelves.nearest.spx} maps to ~SPY ${macroShelves.nearest.spy.toFixed(2)} (price is ${macroShelves.nearest.side} by ${macroShelves.nearest.distancePts.toFixed(2)}). `;
  }

  if (violentExpansion?.signal) {
    text += `We recently printed a violent 2-bar expansion ${violentExpansion.direction}. `;
  } else if (impulse?.impulseScore != null) {
    text += `Latest impulse score is ${impulse.impulseScore}/10 (${impulse.direction}). `;
  }

  return {
    phase,
    inAllowedZone: inAllowed,
    nearAllowedPts: near,
    text,
  };
}

function buildLayer3NextNarrative({ zones, balance, macroShelves, price }) {
  const out = {
    decision: [],
    confirmations: [],
    invalidations: [],
    text: "",
  };

  const bHi = toNum(balance?.hi);
  const bLo = toNum(balance?.lo);

  if (bHi != null && bLo != null) {
    out.confirmations.push({ if: `Decisive close above ${bHi.toFixed(2)}`, then: "Acceptance up / continuation bias" });
    out.invalidations.push({ if: `Decisive close below ${bLo.toFixed(2)}`, then: "Acceptance down / bearish continuation risk" });
    out.decision.push({ level: round2(bHi), label: "Balance High" });
    out.decision.push({ level: round2(bLo), label: "Balance Low" });
  }

  // Macro shelf guidance
  if (macroShelves?.nearest?.spx != null) {
    out.decision.push({ level: macroShelves.nearest.spy, label: `Macro shelf (SPX ${macroShelves.nearest.spx})` });
  }

  // Zone-relative "what I'm looking for"
  if (zones?.activeZone?.lo != null && zones?.activeZone?.hi != null) {
    const lo = Number(zones.activeZone.lo);
    const hi = Number(zones.activeZone.hi);
    const mid = (Math.min(lo, hi) + Math.max(lo, hi)) / 2;

    out.confirmations.push({ if: `Hold above zone high ${hi.toFixed(2)}`, then: "Acceptance / continuation inside higher range" });
    out.invalidations.push({ if: `Lose midline ${mid.toFixed(2)}`, then: "Shift back into balance / rejection risk" });

    out.text =
      `What I'm looking for next: hold above ${hi.toFixed(2)} for acceptance, or lose midline ${mid.toFixed(2)} for rejection back into value.`;
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

      out.confirmations.push({ if: `Re-enter ${z.zoneType} ${lo.toFixed(2)}–${hi.toFixed(2)}`, then: "Eligible for zone-based reading (no chase rule)" });
      out.invalidations.push({ if: `Continue away from zone`, then: "Remain stand-down / avoid chase" });

      out.text =
        `What I'm looking for next: price is ${d.toFixed(2)} pts from ${z.zoneType} zone. I want a clean re-entry into ${lo.toFixed(2)}–${hi.toFixed(2)} before considering a setup.`;
      return out;
    }
  }

  out.text = "What I'm looking for next: no nearby allowed zone. Wait for price to approach negotiated/institutional structure.";
  return out;
}

/* ---------------- route ---------------- */
// GET /api/v1/market-narrator?symbol=SPY&tf=1h
marketNarratorRouter.get("/market-narrator", async (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tf = String(req.query.tf || "1h");

  if (symbol !== "SPY") {
    return res.json({ ok: false, error: "SPY_ONLY_V1", meta: { symbol, supported: ["SPY"] } });
  }

  try {
    // Bars
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

    // Zone context
    const ctxUrl = new URL(`${CORE_BASE}/api/v1/engine5-context`);
    ctxUrl.searchParams.set("symbol", symbol);
    ctxUrl.searchParams.set("tf", tf);

    const ctxResp = await fetchJson(ctxUrl.toString(), { timeoutMs: 15000 });
    const ctx = ctxResp.ok && ctxResp.json ? ctxResp.json : null;

    const price = toNum(ctx?.meta?.current_price) ?? toNum(ctx?.meta?.currentPrice) ?? toNum(last?.close) ?? null;

    const negotiated = ctx?.render?.negotiated || [];
    const institutional = ctx?.render?.institutional || [];

    const nearest = nearestAllowedZone({ price, negotiated, institutional });

    const inAllowed = Boolean(ctx?.active?.negotiated && price != null) || Boolean(ctx?.active?.institutional && price != null);

    const zones = {
      inAllowedZone: Boolean(inAllowed),
      activeZone: ctx?.active?.negotiated
        ? { zoneType: "NEGOTIATED", ...ctx.active.negotiated }
        : ctx?.active?.institutional
        ? { zoneType: "INSTITUTIONAL", ...ctx.active.institutional }
        : null,
      nearestAllowed: nearest
        ? {
            zoneType: nearest.zoneType,
            zoneId: nearest.id,
            lo: nearest.lo,
            hi: nearest.hi,
            distancePts: nearest.distancePts,
          }
        : null,
    };

    const macroShelves = buildMacroShelves({ price });

    const balance = detectBalance({ bars, atr, n: 12, maxWidthAtr: 2.25 });
    const { phase, details } = phaseFromBalanceAndLast({ balance, lastBar: last, prevBar: prev, atr });

    const impulse = summarizeImpulse(last, atr);
    const violentExpansion = detectViolentExpansion({ bars, atr, balance });

    const keyLevels = buildKeyLevels({ balance, zones, macroShelves });

    // LAYER 1/2/3
    const layer1 = buildLayer1RecentNarrative({ bars, atr, zones, keyLevels });
    const layer2 = buildLayer2CurrentNarrative({ price, phase, zones, macroShelves, impulse, violentExpansion });
    const layer3 = buildLayer3NextNarrative({ zones, balance, macroShelves, price });

    const narrativeText =
      `${layer1.text} ` +
      `${layer2.text} ` +
      `${layer3.text}`;

    // Convenience ifThen
    const ifThen = (() => {
      const arr = [];
      const bHi = balance?.hi;
      const bLo = balance?.lo;
      if (Number.isFinite(bHi) && Number.isFinite(bLo)) {
        arr.push(`If hold above ${bHi.toFixed(2)} → acceptance up / continuation bias`);
        arr.push(`If break below ${bLo.toFixed(2)} → acceptance down / bearish continuation risk`);
      }
      if (zones?.activeZone?.lo != null && zones?.activeZone?.hi != null) {
        arr.push(`Active zone: ${zones.activeZone.zoneType} ${Number(zones.activeZone.lo).toFixed(2)}–${Number(zones.activeZone.hi).toFixed(2)}`);
      } else if (zones?.nearestAllowed?.distancePts != null) {
        arr.push(`Near allowed zone (${zones.nearestAllowed.zoneType}) in ${zones.nearestAllowed.distancePts.toFixed(2)} pts`);
      }
      if (macroShelves?.nearest?.spx != null) {
        arr.push(`Macro shelf: SPX ${macroShelves.nearest.spx} ≈ SPY ${macroShelves.nearest.spy.toFixed(2)}`);
      }
      return arr.slice(0, 8);
    })();

    return res.json({
      ok: true,
      symbol,
      tf,
      asOf: new Date().toISOString(),

      price,
      atr,

      phase,
      bias:
        phase === "ACCEPTANCE_UP"
          ? "BULLISH"
          : phase === "ACCEPTANCE_DOWN"
          ? "BEARISH"
          : phase === "EXPANSION"
          ? details?.dir === "UP"
            ? "BULLISH"
            : "BEARISH"
          : phase === "REJECTION"
          ? details?.dir === "UP"
            ? "BULLISH_REVERSAL_RISK"
            : "BEARISH_REVERSAL_RISK"
          : "NEUTRAL",

      confidence: clamp(
        balance?.isBalance
          ? Math.round(50 + clamp(1 - balance.widthAtr / 2.25, 0, 1) * 25 + impulse.impulseScore * 2)
          : Math.round(40 + impulse.impulseScore * 4),
        0,
        100
      ),

      balance: balance
        ? {
            isBalance: balance.isBalance,
            n: balance.n,
            hi: round2(balance.hi),
            lo: round2(balance.lo),
            mid: round2(balance.mid),
            width: round2(balance.width),
            widthAtr: round2(balance.widthAtr),
            overlapPct: round2(balance.overlapPct),
          }
        : null,

      impulse: {
        direction: impulse.direction,
        impulseScore: impulse.impulseScore,
        rangeAtr: impulse.rangeAtr,
        bodyPct: impulse.bodyPct,
      },

      violentExpansion,
      zones,
      macroShelves,

      layer1,
      layer2,
      layer3,

      narrativeText,

      next: {
        keyLevels: keyLevels,
        ifThen,
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
