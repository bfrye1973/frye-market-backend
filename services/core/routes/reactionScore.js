// services/core/routes/reactionScore.js
//
// Engine 3 (Reaction) — thin wrapper ONLY.
// - Locks response fields
// - Echoes resolved zone (id/source/lo/hi)
// - Resolves zoneId via /engine5-context (active first, then render arrays)
// - Uses meta.current_price for containment
// - Fetches bars via existing /api/v1/ohlc route
// - Computes ATR locally
// - Presets by mode: scalp | swing | long
// - Calls computeReactionQuality() (math engine)
//
// DIAGNOSTICS:
// - zonePosition
// - rejectionCandidate/reasons (upper-wick rejection helper)
// - candle anatomy
//
// ✅ SAFE WRAPPER IMPROVEMENTS:
// - If caller does NOT pass zoneId/lo/hi, auto-pick active zone from engine5-context:
//   negotiated_active -> shelf_active -> institutional_active
//
// ✅ ENGINE 3 GAMEPLAN IMPLEMENTED (Negotiated zones only):
// 1) Wick Arm → Re-entry Trigger (2-candle pattern)
//    - SHORT: Candle#1 upper wick probe + close back inside -> ARMED
//             Candle#2 wicks back into zone -> TRIGGERED (short)
//    - LONG:  Candle#1 lower wick probe + close back inside -> ARMED
//             Candle#2 wicks back into zone -> TRIGGERED (long)
//    (Per your instruction: "re-entry only needs to wick inside zone")
//
// 2) Control Candle ("buyers/sellers have control")
//    - bodyPct >= 0.65
//    - close near extreme (top/bottom 20%)
//    - bodyAtr >= 0.25 (30m/1h friendly; still works for 10m)
//
// 3) Control Flip reversal (only if flip candle wicks into negotiated zone)
//    - SELLER_CONTROL then within 1–3 bars BUYER_CONTROL (LONG)
//    - BUYER_CONTROL then within 1–3 bars SELLER_CONTROL (SHORT)
//    - Must wick into negotiated zone (turquoise)
//
// Notes:
// - All negotiated-only by design to match your strategy.
// - If passing lo/hi manually, include source=negotiated_manual to enable negotiated-only triggers.

import express from "express";
import { computeReactionQuality } from "../logic/reactionQualityEngine.js";

export const reactionScoreRouter = express.Router();

/* -------------------- helpers -------------------- */

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function getBaseUrl(req) {
  const proto =
    (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim() ||
    req.protocol;
  return `${proto}://${req.get("host")}`;
}

async function fetchJson(url, { timeoutMs = 12000 } = {}) {
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

function within(price, lo, hi) {
  if (price == null || lo == null || hi == null) return false;
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return price >= a && price <= b;
}

function barTouchesZone(bar, lo, hi) {
  if (!bar || lo == null || hi == null) return false;
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const h = Number(bar.high);
  const l = Number(bar.low);
  if (!Number.isFinite(h) || !Number.isFinite(l)) return false;
  // overlap test
  return l <= b && h >= a;
}

function findZoneById(ctx, zoneId) {
  if (!ctx || !zoneId) return null;

  const act = ctx.active || {};
  const activeCandidates = [
    { z: act.negotiated, source: "negotiated_active" },
    { z: act.shelf, source: "shelf_active" },
    { z: act.institutional, source: "institutional_active" },
  ];
  for (const c of activeCandidates) {
    if (c.z && String(c.z.id || "") === String(zoneId)) {
      return { ...c.z, _source: c.source };
    }
  }

  const r = ctx.render || {};
  const arrays = [
    { arr: r.negotiated, source: "negotiated_render" },
    { arr: r.shelves, source: "shelves_render" },
    { arr: r.institutional, source: "institutional_render" },
  ];
  for (const a of arrays) {
    const list = Array.isArray(a.arr) ? a.arr : [];
    for (const z of list) {
      if (z && String(z.id || "") === String(zoneId)) {
        return { ...z, _source: a.source };
      }
    }
  }

  return null;
}

/* -------------------- preset mapping (LOCKED) -------------------- */

function resolveMode({ mode, strategyId }) {
  const m = (mode || "").toString().toLowerCase().trim();
  if (m === "scalp" || m === "swing" || m === "long") return m;

  const sid = (strategyId || "").toString().trim();
  if (sid === "intraday_scalp@10m") return "scalp";
  if (sid === "minor_swing@1h") return "swing";
  if (sid === "intermediate_long@4h") return "long";

  return "swing";
}

function presetOpts(mode) {
  if (mode === "scalp") return { lookbackBars: 80, windowBars: 2, breakDepthAtr: 0.25, reclaimWindowBars: 1 };
  if (mode === "long")  return { lookbackBars: 25, windowBars: 10, breakDepthAtr: 0.25, reclaimWindowBars: 5 };
  return { lookbackBars: 40, windowBars: 6, breakDepthAtr: 0.25, reclaimWindowBars: 3 };
}

/* -------------------- ATR -------------------- */

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
  for (let i = len; i < trs.length; i++) atr = ((atr * (len - 1)) + trs[i]) / len;
  return atr;
}

/* -------------------- ARMED/STAGE helpers -------------------- */

function compressionN(bars, atr, n) {
  if (!Array.isArray(bars) || bars.length < n || !Number.isFinite(atr) || atr <= 0) return null;
  const lastN = bars.slice(-n);
  const maxH = Math.max(...lastN.map(b => b.high));
  const minL = Math.min(...lastN.map(b => b.low));
  return (maxH - minL) / atr;
}

function stagePreset(mode) {
  if (mode === "scalp")
    return {
      compBars: 3,
      compMax: 1.05,
      triggerExitBarsMax: 2,
      confirmScore: 7.0
    };

  if (mode === "swing") return { compBars: 5, compMax: 0.45, triggerExitBarsMax: 3, confirmScore: 7.0 };
  return { compBars: 8, compMax: 0.55, triggerExitBarsMax: 4, confirmScore: 7.0 };
}

function buildReasonCodes({ inScope, rqe, mode }) {
  const codes = [];
  if (!inScope) codes.push("NOT_IN_ZONE");

  if (rqe?.reason === "NO_TOUCH" || rqe?.flags?.NO_TOUCH) {
    codes.push("NO_TOUCH");
    return Array.from(new Set(codes));
  }

  if (mode === "scalp" && Number.isFinite(rqe?.exitBars) && rqe.exitBars > 2) codes.push("SLOW_REACTION");
  if (Number.isFinite(rqe?.displacementAtrRaw) && rqe.displacementAtrRaw < (mode === "scalp" ? 0.15 : 0.20))
    codes.push("WEAK_DISPLACEMENT");

  if (rqe?.structureState === "FAILURE") codes.push("FAILURE");
  if (rqe?.structureState === "FAKEOUT_RECLAIM") codes.push("RECLAIM");

  return Array.from(new Set(codes));
}

/* -------------------- candle diagnostics -------------------- */

function candleAnatomy(bar) {
  if (!bar) return { upperWick: null, lowerWick: null, body: null, range: null, bodyPct: null };
  const o = Number(bar.open), h = Number(bar.high), l = Number(bar.low), c = Number(bar.close);
  if (![o, h, l, c].every(Number.isFinite)) return { upperWick: null, lowerWick: null, body: null, range: null, bodyPct: null };
  const body = Math.abs(c - o);
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const range = h - l;
  const bodyPct = range > 0 ? (body / range) : null;
  return { upperWick, lowerWick, body, range, bodyPct };
}

function zonePosition(price, lo, hi) {
  if (price == null || lo == null || hi == null) return "UNKNOWN";
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const mid = (a + b) / 2;

  if (price > b) return "ABOVE_ZONE";
  if (price < a) return "BELOW_ZONE";

  const upperBand = mid + (b - mid) * 0.5;
  const lowerBand = mid - (mid - a) * 0.5;

  if (price >= upperBand) return "UPPER_BAND";
  if (price <= lowerBand) return "LOWER_BAND";
  return "MIDLINE";
}

// Existing upper rejection helper (kept)
function buildUpperRejectionDiagnostics({ bar, lo, hi }) {
  const { upperWick, body, range } = candleAnatomy(bar);
  const h = bar ? Number(bar.high) : null;
  const c = bar ? Number(bar.close) : null;

  const attemptedAbove = (h != null && hi != null) ? (h > hi) : false;
  const closeBackInside = (c != null && hi != null) ? (c <= hi) : false;
  const wickRule = (upperWick != null && body != null) ? (upperWick >= body) : false;

  const rejectionCandidate = Boolean(wickRule && attemptedAbove && closeBackInside);

  const rejectionReasons = [];
  if (wickRule) rejectionReasons.push("UPPER_WICK_GE_BODY");
  if (attemptedAbove) rejectionReasons.push("ATTEMPTED_ABOVE_ZONE_HI");
  if (closeBackInside) rejectionReasons.push("CLOSE_BACK_INSIDE_ZONE");

  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const mid = (a + b) / 2;

  return {
    candle: { upperWick, body, range, attemptedAbove, closeBackInside },
    rejectionCandidate,
    rejectionReasons,
    nextConfirmDown: `Confirm rejection if price breaks below midline ${mid.toFixed(2)} then fails to reclaim`,
    nextConfirmUp: `Confirm acceptance if price holds above zoneHi ${b.toFixed(2)} after breakout`,
  };
}

/* -------------------- control candle detection -------------------- */

function detectControlCandle(bar, atr) {
  const o = Number(bar?.open), h = Number(bar?.high), l = Number(bar?.low), c = Number(bar?.close);
  if (![o, h, l, c].every(Number.isFinite)) return { control: "NONE", bodyPct: null, bodyAtr: null };

  const range = h - l;
  if (!(range > 0) || !Number.isFinite(atr) || atr <= 0) return { control: "NONE", bodyPct: null, bodyAtr: null };

  const body = Math.abs(c - o);
  const bodyPct = body / range;
  const bodyAtr = body / atr;

  // Your chosen test rule (recommended starter)
  const bodyDominant = bodyPct >= 0.65;
  const bigEnough = bodyAtr >= 0.25;

  // Close near extreme (top/bottom 20%)
  const closeNearLow = c <= (l + 0.20 * range);
  const closeNearHigh = c >= (h - 0.20 * range);

  if (bodyDominant && bigEnough) {
    if (c < o && closeNearLow) return { control: "SELLER", bodyPct, bodyAtr };
    if (c > o && closeNearHigh) return { control: "BUYER", bodyPct, bodyAtr };
  }

  return { control: "NONE", bodyPct, bodyAtr };
}

/* -------------------- direction parsing (SAFE) -------------------- */

function resolveSideFromQuery(req) {
  const directionRaw = String(req.query.direction || "").toUpperCase().trim();
  const sideRaw = String(req.query.side || "").toLowerCase().trim();

  if (sideRaw === "supply" || sideRaw === "short" || sideRaw === "bearish") return "supply";
  if (sideRaw === "demand" || sideRaw === "long" || sideRaw === "bullish") return "demand";

  if (directionRaw === "SHORT" || directionRaw === "SELL" || directionRaw === "BEAR") return "supply";
  if (directionRaw === "LONG" || directionRaw === "BUY" || directionRaw === "BULL") return "demand";

  return "demand";
}

/* -------------------- route -------------------- */

reactionScoreRouter.get("/reaction-score", async (req, res) => {
  try {
    const { symbol, tf, zoneId, source, mode, strategyId } = req.query;
    const qLo = req.query.lo;
    const qHi = req.query.hi;

    if (!symbol || !tf) {
      return res.status(400).json({
        ok: false, invalid: true,
        reactionScore: 0, structureState: "HOLD", reasonCodes: ["MISSING_SYMBOL_OR_TF"],
        zone: null,
        rejectionSpeed: 0, displacementAtr: 0, reclaimOrFailure: 0, touchQuality: 0,
        samples: 0, price: null, atr: null,
        armed: false, stage: "IDLE", compression: null,
        mode: null,
      });
    }

    const sym = String(symbol).toUpperCase();
    const timeframe = String(tf);

    const chosenMode = resolveMode({ mode, strategyId });
    const p = presetOpts(chosenMode);
    const sp = stagePreset(chosenMode);

    const side = resolveSideFromQuery(req);

    let lo = toNum(qLo);
    let hi = toNum(qHi);
    let resolvedSource = source ? String(source) : null;

    const base = getBaseUrl(req);

    // engine5-context (price truth + optional zoneId resolution)
    const ctxUrl = `${base}/api/v1/engine5-context?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(timeframe)}`;
    const ctxResp = await fetchJson(ctxUrl);
    const ctx = (ctxResp.ok && ctxResp.json) ? ctxResp.json : null;

    const currentPrice =
      toNum(ctx?.meta?.current_price) ??
      toNum(ctx?.meta?.currentPrice) ??
      null;

    // 1) If caller passed zoneId and lo/hi missing -> resolve by id
    if ((lo == null || hi == null) && zoneId && ctx) {
      const z = findZoneById(ctx, zoneId);
      if (z) {
        lo = toNum(z.lo);
        hi = toNum(z.hi);
        resolvedSource = resolvedSource || z._source || null;
      }
    }

    // 2) Auto-pick active zone if caller did not pass zone args
    let autoPickedId = null;
    if ((lo == null || hi == null) && !zoneId && ctx) {
      const act = ctx.active || {};
      const pick =
        act.negotiated ? { ...act.negotiated, _source: "negotiated_active" } :
        act.shelf ? { ...act.shelf, _source: "shelf_active" } :
        act.institutional ? { ...act.institutional, _source: "institutional_active" } :
        null;

      if (pick) {
        lo = toNum(pick.lo);
        hi = toNum(pick.hi);
        autoPickedId = pick.id ? String(pick.id) : null;
        resolvedSource = resolvedSource || pick._source || null;
      }
    }

    const zone = {
      id: (zoneId ?? autoPickedId) ?? null,
      source: resolvedSource,
      lo,
      hi
    };

    // If still no zone bounds -> safe idle
    if (lo == null || hi == null) {
      return res.json({
        ok: true, invalid: false,
        reactionScore: 0, structureState: "HOLD", reasonCodes: ["NOT_IN_ZONE"],
        zone,
        rejectionSpeed: 0, displacementAtr: 0, reclaimOrFailure: 0, touchQuality: 0,
        samples: 0, price: currentPrice, atr: null,
        armed: false, stage: "IDLE", compression: null,
        mode: chosenMode,
      });
    }

    // bars via /ohlc
    const ohlcUrl = `${base}/api/v1/ohlc?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(timeframe)}&limit=250`;
    const barsResp = await fetchJson(ohlcUrl);
    if (!barsResp.ok || !Array.isArray(barsResp.json)) {
      return res.status(502).json({
        ok: false, invalid: true,
        reactionScore: 0, structureState: "HOLD", reasonCodes: ["BARS_UNAVAILABLE"],
        zone,
        rejectionSpeed: 0, displacementAtr: 0, reclaimOrFailure: 0, touchQuality: 0,
        samples: 0, price: currentPrice, atr: null,
        armed: false, stage: "IDLE", compression: null,
        mode: chosenMode,
      });
    }

    const fullBars = barsResp.json
      .map(b => ({
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume ?? 0),
      }))
      .filter(b => [b.open, b.high, b.low, b.close].every(Number.isFinite));

    const bars = fullBars.length > p.lookbackBars ? fullBars.slice(-p.lookbackBars) : fullBars;

    // ATR required
    const atrVal = computeATR(fullBars, 14) || computeATR(fullBars, 10) || null;
    if (!atrVal || !Number.isFinite(atrVal) || atrVal <= 0) {
      return res.json({
        ok: true, invalid: false,
        reactionScore: 0, structureState: "HOLD", reasonCodes: ["ATR_UNAVAILABLE"],
        zone,
        rejectionSpeed: 0, displacementAtr: 0, reclaimOrFailure: 0, touchQuality: 0,
        samples: 0, price: currentPrice, atr: null,
        armed: false, stage: "IDLE", compression: null,
        mode: chosenMode,
      });
    }

    // Zone padding (deviation)
    let pad = 0;
    if (chosenMode === "scalp") pad = 1.30;
    else pad = Math.min(0.10 * atrVal, 1.00);

    const loPad = lo - pad;
    const hiPad = hi + pad;

    const inZoneNow = within(currentPrice, loPad, hiPad);

    // Negotiated-only gating for your strategy (turquoise)
    const isNegotiatedZone = String(resolvedSource || "").toLowerCase().includes("negotiated");

    // Compute core reaction (RQE)
    const rqe = computeReactionQuality({
      bars,
      zone: { lo, hi, side, id: (zoneId ?? autoPickedId) ?? null },
      atr: atrVal,
      opts: {
        tf: timeframe,
        windowBars: p.windowBars,
        breakDepthAtr: p.breakDepthAtr,
        reclaimWindowBars: p.reclaimWindowBars,
      },
    });

    // touch window diagnostics
    const barsAgo = (rqe?.touchIndex == null) ? null : (bars.length - 1 - rqe.touchIndex);
    const reactionWindowBars = Math.max(2, p.windowBars + 1);
    const touchedRecently = (barsAgo != null && barsAgo >= 0 && barsAgo <= reactionWindowBars);

    // Grab last bars for pattern logic
    const lastBar = bars[bars.length - 1] || null;
    const prevBar = bars[bars.length - 2] || null;
    const prev2Bar = bars[bars.length - 3] || null;
    const prev3Bar = bars[bars.length - 4] || null;

    // Existing rejection diagnostics (upper-wick)
    const rej = buildUpperRejectionDiagnostics({ bar: lastBar, lo, hi });

    // Anatomy for wick-arm logic (needs upper + lower)
    const aLast = candleAnatomy(lastBar);
    const aPrev = candleAnatomy(prevBar);

    const lastO = Number(lastBar?.open);
    const lastC = Number(lastBar?.close);
    const lastH = Number(lastBar?.high);
    const lastL = Number(lastBar?.low);

    const prevO = Number(prevBar?.open);
    const prevC = Number(prevBar?.close);
    const prevH = Number(prevBar?.high);
    const prevL = Number(prevBar?.low);

    // ------------------------
    // 1) WICK ARM (Candle #1)
    // ------------------------
    // SHORT arm: upper wick >= body, attempted above zoneHi, close back inside (<= hi), and candle touches zone
    const lastAttemptAbove = Number.isFinite(lastH) && lastH > hi;
    const lastCloseBackInsideFromAbove = Number.isFinite(lastC) && lastC <= hi;
    const lastUpperWickRule = (aLast.upperWick != null && aLast.body != null) ? (aLast.upperWick >= aLast.body) : false;
    const lastTouchesZone = barTouchesZone(lastBar, lo, hi);
    const wickArmShortNow = Boolean(isNegotiatedZone && lastTouchesZone && lastUpperWickRule && lastAttemptAbove && lastCloseBackInsideFromAbove);

    // LONG arm: lower wick >= body, attempted below zoneLo, close back inside (>= lo), and candle touches zone
    const lastAttemptBelow = Number.isFinite(lastL) && lastL < lo;
    const lastCloseBackInsideFromBelow = Number.isFinite(lastC) && lastC >= lo;
    const lastLowerWickRule = (aLast.lowerWick != null && aLast.body != null) ? (aLast.lowerWick >= aLast.body) : false;
    const wickArmLongNow = Boolean(isNegotiatedZone && lastTouchesZone && lastLowerWickRule && lastAttemptBelow && lastCloseBackInsideFromBelow);

    // Arm on previous candle (needed for re-entry trigger today)
    const prevTouchesZone = barTouchesZone(prevBar, lo, hi);
    const prevUpperWickRule = (aPrev.upperWick != null && aPrev.body != null) ? (aPrev.upperWick >= aPrev.body) : false;
    const prevLowerWickRule = (aPrev.lowerWick != null && aPrev.body != null) ? (aPrev.lowerWick >= aPrev.body) : false;
    const prevAttemptAbove = Number.isFinite(prevH) && prevH > hi;
    const prevAttemptBelow = Number.isFinite(prevL) && prevL < lo;
    const prevCloseBackInsideFromAbove = Number.isFinite(prevC) && prevC <= hi;
    const prevCloseBackInsideFromBelow = Number.isFinite(prevC) && prevC >= lo;

    const wickArmShortPrev = Boolean(isNegotiatedZone && prevTouchesZone && prevUpperWickRule && prevAttemptAbove && prevCloseBackInsideFromAbove);
    const wickArmLongPrev = Boolean(isNegotiatedZone && prevTouchesZone && prevLowerWickRule && prevAttemptBelow && prevCloseBackInsideFromBelow);

    // -----------------------------------
    // 2) RE-ENTRY TRIGGER (Candle #2)
    // -----------------------------------
    // Per your rule: trigger only needs to WICK inside zone (touch overlap), not close inside.
    const reEntryTouchesZoneNow = barTouchesZone(lastBar, lo, hi);

    const wickReEntryTriggerShort = Boolean(side === "supply" && wickArmShortPrev && reEntryTouchesZoneNow);
    const wickReEntryTriggerLong = Boolean(side === "demand" && wickArmLongPrev && reEntryTouchesZoneNow);

    // ------------------------
    // 3) CONTROL CANDLE
    // ------------------------
    const ctrlLast = detectControlCandle(lastBar, atrVal);
    const ctrlPrev = detectControlCandle(prevBar, atrVal);
    const ctrlPrev2 = detectControlCandle(prev2Bar, atrVal);
    const ctrlPrev3 = detectControlCandle(prev3Bar, atrVal);

    // ------------------------
    // 4) CONTROL FLIP (Negotiated only)
    // ------------------------
    // Flip candle must wick into negotiated zone (touch overlap)
    const flipWicksIntoZoneNow = Boolean(isNegotiatedZone && reEntryTouchesZoneNow);

    // For LONG: recent SELLER control (within last 1–3 bars) then BUYER control now
    const hadRecentSellerControl =
      (ctrlPrev.control === "SELLER") ||
      (ctrlPrev2.control === "SELLER") ||
      (ctrlPrev3.control === "SELLER");

    const hadRecentBuyerControl =
      (ctrlPrev.control === "BUYER") ||
      (ctrlPrev2.control === "BUYER") ||
      (ctrlPrev3.control === "BUYER");

    const controlFlipLong = Boolean(
      side === "demand" &&
      flipWicksIntoZoneNow &&
      ctrlLast.control === "BUYER" &&
      hadRecentSellerControl
    );

    const controlFlipShort = Boolean(
      side === "supply" &&
      flipWicksIntoZoneNow &&
      ctrlLast.control === "SELLER" &&
      hadRecentBuyerControl
    );

    // ------------------------
    // Existing computed metrics
    // ------------------------
    const rejectionSpeed = Number.isFinite(rqe.rejectionSpeedPoints) ? rqe.rejectionSpeedPoints * 2.5 : 0;
    const displacementAtr = Number.isFinite(rqe.displacementPoints) ? rqe.displacementPoints * 2.5 : 0;
    const reclaimOrFailure =
      rqe.structureState === "HOLD" ? 10 :
      rqe.structureState === "FAKEOUT_RECLAIM" ? 5 :
      rqe.structureState === "FAILURE" ? 0 : 0;

    // ------------------------
    // ARMED / STAGE
    // ------------------------
    const comp = compressionN(bars, atrVal, sp.compBars);
    const isTight = comp != null && comp <= sp.compMax;

    let armed = false;
    let stage = "IDLE";

    // Arm conditions (negotiated-only):
    // - In zone now OR touched recently, AND
    //   - tight compression OR wick arm candle now (Candle #1)
    const wickArmNowMatchesSide = (side === "supply") ? wickArmShortNow : wickArmLongNow;

    if (isNegotiatedZone && (inZoneNow || touchedRecently) && (isTight || (chosenMode === "scalp" && wickArmNowMatchesSide))) {
      armed = true;
      stage = "ARMED";
    }

    // TRIGGER conditions:
    // A) Your primary entry: wick-arm previous candle -> re-entry wick touches zone now (Candle #2)
    const primaryReEntryTrigger = Boolean(isNegotiatedZone && (wickReEntryTriggerShort || wickReEntryTriggerLong));

    // B) Control flip entry
    const controlFlipTrigger = Boolean(controlFlipLong || controlFlipShort);

    // C) Fallback: fast confirmed exit per RQE (kept, but not relied upon)
    const fastExitTrigger = Boolean(Number.isFinite(rqe?.exitBars) && rqe.exitBars <= sp.triggerExitBarsMax);

    if (primaryReEntryTrigger || controlFlipTrigger || fastExitTrigger) {
      stage = "TRIGGERED";
    }

    // CONFIRMED: quality threshold; scalp requires ARMED/TRIGGERED
    if (
      Number.isFinite(rqe?.reactionScore) &&
      rqe.reactionScore >= sp.confirmScore &&
      (chosenMode !== "scalp" || stage === "TRIGGERED" || armed === true)
    ) {
      stage = "CONFIRMED";
    }

    // Scope: if we are in the reaction window or have triggered/confirmed, do NOT zero outputs
    const inScope = Boolean(
      (isNegotiatedZone && (inZoneNow || touchedRecently)) ||
      stage === "TRIGGERED" ||
      stage === "CONFIRMED"
    );

    const touchQuality = (inScope && rqe.touchIndex != null) ? 10 : 0;

    const reasonCodes = buildReasonCodes({ inScope, rqe, mode: chosenMode });

    const reactionScoreOut = inScope ? rqe.reactionScore : 0;
    const structureStateOut = rqe.structureState === "FAKEOUT_RECLAIM" ? "RECLAIM" : rqe.structureState;

    const pos = zonePosition(currentPrice, lo, hi);

    // Basic exit label (diagnostic)
    const exitedUp = Number.isFinite(lastC) && lastC > hiPad;
    const exitedDown = Number.isFinite(lastC) && lastC < loPad;
    const triggeredExit =
      side === "demand" ? (exitedUp ? "EXIT_UP" : "NONE") : (exitedDown ? "EXIT_DOWN" : "NONE");

    // Signal label (diagnostic)
    let signalType = "NONE";
    if (primaryReEntryTrigger) signalType = "WICK_REENTRY";
    else if (controlFlipTrigger) signalType = "CONTROL_FLIP";
    else if (fastExitTrigger) signalType = "FAST_EXIT";

    // Return response
    return res.json({
      ok: true,
      invalid: false,

      // LOCKED fields
      reactionScore: reactionScoreOut,
      structureState: structureStateOut,
      reasonCodes,
      zone: zone,

      rejectionSpeed,
      displacementAtr,
      reclaimOrFailure,
      touchQuality,

      samples: rqe.windowBars,
      price: currentPrice,
      atr: rqe.atr,

      armed,
      stage,
      compression: comp,

      mode: chosenMode,

      // Safe additions (diagnostics)
      side,
      direction: side === "supply" ? "SHORT" : "LONG",
      isNegotiatedZone,

      zonePosition: pos,

      // Existing upper rejection diagnostics (still useful)
      rejectionCandidate: rej.rejectionCandidate,
      rejectionReasons: rej.rejectionReasons,
      nextConfirmDown: rej.nextConfirmDown,
      nextConfirmUp: rej.nextConfirmUp,

      // Wick arm + trigger diagnostics
      wickArmNow: wickArmNowMatchesSide,
      wickArmPrev: (side === "supply") ? wickArmShortPrev : wickArmLongPrev,
      reEntryTouchesZoneNow,
      primaryReEntryTrigger,

      // Control diagnostics
      controlCandle: ctrlLast.control,
      controlBodyPct: ctrlLast.bodyPct,
      controlBodyAtr: ctrlLast.bodyAtr,

      controlFlipTrigger,
      signalType,
      triggeredExit,

      touchedRecently,
      barsSinceTouch: barsAgo,
      inScope,

      diagnostics: {
        candle: {
          last: aLast,
          prev: aPrev
        },
        zone: {
          lo,
          hi,
          mid: ((Math.min(lo, hi) + Math.max(lo, hi)) / 2),
          padded: { lo: loPad, hi: hiPad, pad },
        },
        controlRecent: {
          prev: ctrlPrev.control,
          prev2: ctrlPrev2.control,
          prev3: ctrlPrev3.control,
        }
      },
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      invalid: true,
      reactionScore: 0,
      structureState: "HOLD",
      reasonCodes: ["REACTION_SCORE_ERROR"],
      message: err?.message || String(err),
      zone: null,
      rejectionSpeed: 0,
      displacementAtr: 0,
      reclaimOrFailure: 0,
      touchQuality: 0,
      samples: 0,
      price: null,
      atr: null,
      armed: false,
      stage: "IDLE",
      compression: null,
      mode: null,
    });
  }
});
