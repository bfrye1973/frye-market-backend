// services/core/routes/marketNarrator.js
// Engine 14A (Read-only) — Market Narrator (SPY only)
//
// Purpose:
// - Produce a structured "market story" for a given timeframe (v1: 1h)
// - Uses ONLY:
//   - OHLCV bars (api/v1/ohlc)
//   - Zone context (api/v1/engine5-context)
//
// Not a signal generator. Does not change engine math.
// Output is deterministic and audit-friendly.
//
// ✅ FIXES IN THIS VERSION:
// 1) overlapPct band tightened (was too wide → always ~1.0)
// 2) Adds violentExpansion detector (2 full-bodied candles / initiative move)

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
  return { o, h, l, c, range, body, upperWick, lowerWick, bodyPct };
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

// Find nearest allowed zone from negotiated + institutional arrays
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

/* ---------------- market structure helpers ---------------- */

function summarizeImpulse(last, atr) {
  const s = candleStats(last);
  if (!s || !Number.isFinite(atr) || atr <= 0) return { impulseScore: 0, direction: "FLAT" };

  const dir = s.c > s.o ? "UP" : s.c < s.o ? "DOWN" : "FLAT";

  // Simple scoring: body dominance + range expansion vs ATR
  const rangeAtr = s.range / atr;
  const bodyDominant = s.bodyPct; // 0..1

  let score = 0;
  score += clamp(rangeAtr / 2.0, 0, 1) * 5; // up to 5
  score += clamp(bodyDominant, 0, 1) * 5; // up to 5
  return { impulseScore: Math.round(score), direction: dir };
}

function rangeHiLo(bars) {
  let hi = -Infinity,
    lo = Infinity;
  for (const b of bars) {
    const h = toNum(b.high),
      l = toNum(b.low);
    if (h == null || l == null) continue;
    if (h > hi) hi = h;
    if (l < lo) lo = l;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || !(hi > lo)) return null;
  return { hi, lo, mid: (hi + lo) / 2, width: hi - lo };
}

// Detect "balance" as compression: recent width vs ATR small + overlapping closes.
function detectBalance({ bars, atr, n = 12, maxWidthAtr = 2.25 }) {
  if (!Array.isArray(bars) || bars.length < n || !Number.isFinite(atr) || atr <= 0) return null;
  const slice = bars.slice(-n);
  const r = rangeHiLo(slice);
  if (!r) return null;

  const widthAtr = r.width / atr;
  const isBalance = widthAtr <= maxWidthAtr;

  // ✅ FIX: tighter band so overlapPct is meaningful (was too wide)
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

  if (strongImpulse)
    return { phase: "IMPULSE", details: { dir: lastClose > prevClose ? "UP" : "DOWN" } };

  return { phase: "CORRECTION", details: {} };
}

// ✅ NEW: Detect the "two full-bodied candles" violent move you care about
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
    last: { rangeAtr: Number((last.range / atr).toFixed(2)), bodyPct: Number(last.bodyPct.toFixed(2)) },
    prev: { rangeAtr: Number((prev.range / atr).toFixed(2)), bodyPct: Number((prev.bodyPct).toFixed(2)) },
  };
}

function buildIfThen({ phase, balance, zones }) {
  const out = [];
  const bHi = balance?.hi;
  const bLo = balance?.lo;

  if (Number.isFinite(bHi) && Number.isFinite(bLo)) {
    out.push(`If hold above ${bHi.toFixed(2)} → acceptance up / continuation bias`);
    out.push(`If break below ${bLo.toFixed(2)} → acceptance down / bearish continuation risk`);
  }

  if (zones?.activeZone?.lo != null && zones?.activeZone?.hi != null) {
    out.push(
      `Active zone: ${zones.activeZone.zoneType} ${Number(zones.activeZone.lo).toFixed(2)}–${Number(
        zones.activeZone.hi
      ).toFixed(2)}`
    );
  } else if (zones?.nearestAllowed?.distancePts != null) {
    out.push(
      `Near allowed zone (${zones.nearestAllowed.zoneType}) in ${zones.nearestAllowed.distancePts.toFixed(2)} pts`
    );
  }

  if (phase === "BALANCE") out.push("Balance regime: wait for edge + expansion candle; avoid mid-range churn.");
  if (phase === "EXPANSION") out.push("Expansion regime: watch for retest + acceptance; avoid chasing late bars.");
  if (phase.startsWith("ACCEPTANCE")) out.push("Acceptance regime: continuation favored; pullbacks should be smaller/controlled.");
  if (phase === "REJECTION") out.push("Rejection regime: look for follow-through away from the rejected boundary.");
  if (phase === "TRAP_RISK") out.push("Trap risk: require confirmation; avoid first breakouts without follow-through.");

  return out.slice(0, 8);
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

    const balance = detectBalance({ bars, atr, n: 12, maxWidthAtr: 2.25 });
    const { phase, details } = phaseFromBalanceAndLast({ balance, lastBar: last, prevBar: prev, atr });

    const impulse = summarizeImpulse(last, atr);

    const violentExpansion = detectViolentExpansion({ bars, atr, balance });

    const bias =
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
        : "NEUTRAL";

    const conf = balance?.isBalance
      ? Math.round(50 + clamp(1 - balance.widthAtr / 2.25, 0, 1) * 25 + impulse.impulseScore * 2)
      : Math.round(40 + impulse.impulseScore * 4);

    const ifThen = buildIfThen({ phase, balance, zones });

    return res.json({
      ok: true,
      symbol,
      tf,
      asOf: new Date().toISOString(),
      price,
      atr,
      phase,
      bias,
      confidence: clamp(conf, 0, 100),
      balance: balance
        ? {
            isBalance: balance.isBalance,
            n: balance.n,
            hi: Number(balance.hi.toFixed(2)),
            lo: Number(balance.lo.toFixed(2)),
            mid: Number(balance.mid.toFixed(2)),
            width: Number(balance.width.toFixed(2)),
            widthAtr: Number(balance.widthAtr.toFixed(2)),
            overlapPct: Number(balance.overlapPct.toFixed(2)),
          }
        : null,
      impulse: {
        direction: impulse.direction,
        impulseScore: impulse.impulseScore,
      },
      violentExpansion,
      zones,
      next: {
        keyLevels: [
          ...(balance ? [Number(balance.hi.toFixed(2)), Number(balance.lo.toFixed(2))] : []),
          ...(zones?.activeZone ? [Number(zones.activeZone.lo), Number(zones.activeZone.hi)] : []),
        ].filter((v) => Number.isFinite(v)),
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
