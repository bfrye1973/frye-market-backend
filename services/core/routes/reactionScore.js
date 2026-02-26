// services/core/routes/reactionScore.js
//
// Engine 3 (Reaction) — thin wrapper ONLY.
// ALIGNMENT (LOCKED by Engine 5 teammate):
// - Engine 3 MUST use Engine 5-selected active zone (containment-first).
// - Engine 3 MUST NOT pick zones from render arrays.
// - Scalp GO uses E3 stage===ARMED (NOT CONFIRMED).
//
// THIS TEST VERSION (v1):
// - ARMED fires early when inside ACTIVE NEGOTIATED zone AND
//   (wick probe OR control candle) on the most recent bar.
// - Keeps computeReactionQuality() for scoring/diagnostics but does not require it to ARM.
//
// Notes:
// - If caller provides lo/hi or zoneId, we still respect it (manual testing / debugging).
// - Auto-zone selection comes ONLY from engine5-context activeZone/active.* (never render arrays).

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

function zoneTypeIsNegotiated(z) {
  const t = String(z?.zoneType || z?.type || z?.kind || "").toUpperCase();
  const id = String(z?.id || "").toUpperCase();
  // Accept either explicit zoneType or ID containing "|NEG|"
  return t === "NEGOTIATED" || id.includes("|NEG|");
}

function resolveSideFromQuery(req) {
  const directionRaw = String(req.query.direction || "").toUpperCase().trim();
  const sideRaw = String(req.query.side || "").toLowerCase().trim();

  if (sideRaw === "supply" || sideRaw === "short" || sideRaw === "bearish") return "supply";
  if (sideRaw === "demand" || sideRaw === "long" || sideRaw === "bullish") return "demand";

  if (directionRaw === "SHORT" || directionRaw === "SELL" || directionRaw === "BEAR") return "supply";
  if (directionRaw === "LONG" || directionRaw === "BUY" || directionRaw === "BULL") return "demand";

  return "demand";
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

function stagePreset(mode) {
  if (mode === "scalp") return { compBars: 3, compMax: 1.05, triggerExitBarsMax: 2, confirmScore: 7.0 };
  if (mode === "swing") return { compBars: 5, compMax: 0.45, triggerExitBarsMax: 3, confirmScore: 7.0 };
  return { compBars: 8, compMax: 0.55, triggerExitBarsMax: 4, confirmScore: 7.0 };
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

/* -------------------- candle + control detection -------------------- */

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

// v1 control candle (your recommended starter)
function detectControlCandle(bar, atr) {
  const o = Number(bar?.open), h = Number(bar?.high), l = Number(bar?.low), c = Number(bar?.close);
  if (![o, h, l, c].every(Number.isFinite)) return { control: "NONE", bodyPct: null, bodyAtr: null };

  const range = h - l;
  if (!(range > 0) || !Number.isFinite(atr) || atr <= 0) return { control: "NONE", bodyPct: null, bodyAtr: null };

  const body = Math.abs(c - o);
  const bodyPct = body / range;
  const bodyAtr = body / atr;

  const bodyDominant = bodyPct >= 0.65;
  const bigEnough = bodyAtr >= 0.25;

  const closeNearLow = c <= (l + 0.20 * range);
  const closeNearHigh = c >= (h - 0.20 * range);

  if (bodyDominant && bigEnough) {
    if (c < o && closeNearLow) return { control: "SELLER", bodyPct, bodyAtr };
    if (c > o && closeNearHigh) return { control: "BUYER", bodyPct, bodyAtr };
  }
  return { control: "NONE", bodyPct, bodyAtr };
}

/* -------------------- Engine 5 context zone selection (LOCKED) -------------------- */

function pickZoneFromEngine5Context(ctx) {
  // Canonical (preferred): ctx.zones.activeZone
  const az =
    ctx?.zones?.activeZone ||
    ctx?.zones?.active_zone ||
    ctx?.activeZone ||
    null;

  if (az && az.lo != null && az.hi != null) {
    return { ...az, _source: "engine5_activeZone" };
  }

  // Older/alt shape: ctx.active.{negotiated,shelf,institutional}
  const act = ctx?.active || null;
  if (act) {
    if (act.negotiated?.lo != null && act.negotiated?.hi != null) return { ...act.negotiated, _source: "active.negotiated" };
    if (act.shelf?.lo != null && act.shelf?.hi != null) return { ...act.shelf, _source: "active.shelf" };
    if (act.institutional?.lo != null && act.institutional?.hi != null) return { ...act.institutional, _source: "active.institutional" };
  }

  const ns =
    ctx?.zones?.nearestShelf ||
    ctx?.zones?.nearest_shelf ||
    ctx?.zones?.nearestAllowed ||
    ctx?.nearestShelf ||
    ctx?.nearestAllowed ||
    ctx?.nearest?.shelf ||     // ✅ your actual shape
    null;

  if (ns && ns.lo != null && ns.hi != null) {
    return {
    ...ns,
    lo: toNum(ns.lo),
    hi: toNum(ns.hi),
    _source: "NEAREST_SHELF_SCALP_REF",
  };
}

return null;

/* -------------------- reason codes -------------------- */

function buildReasonCodes({ inZoneNow, rqe, mode, stage }) {
  const codes = [];

  // Engine 5B resets on NOT_IN_ZONE, so only emit it if we are truly not in zone AND not armed.
  if (!inZoneNow && stage !== "ARMED") codes.push("NOT_IN_ZONE");

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

    // Bars
    const base = getBaseUrl(req);
    const ohlcUrl = `${base}/api/v1/ohlc?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(timeframe)}&limit=250`;
    const barsResp = await fetchJson(ohlcUrl);
    if (!barsResp.ok || !Array.isArray(barsResp.json)) {
      return res.status(502).json({
        ok: false, invalid: true,
        reactionScore: 0, structureState: "HOLD", reasonCodes: ["BARS_UNAVAILABLE"],
        zone: null,
        rejectionSpeed: 0, displacementAtr: 0, reclaimOrFailure: 0, touchQuality: 0,
        samples: 0, price: null, atr: null,
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
    const lastBar = bars[bars.length - 1] || null;

    const lastCloseFallback = Number.isFinite(fullBars[fullBars.length - 1]?.close)
      ? fullBars[fullBars.length - 1].close
      : null;

    // ATR
    const atrVal = computeATR(fullBars, 14) || computeATR(fullBars, 10) || null;
    if (!atrVal || !Number.isFinite(atrVal) || atrVal <= 0) {
      return res.json({
        ok: true, invalid: false,
        reactionScore: 0, structureState: "HOLD", reasonCodes: ["ATR_UNAVAILABLE"],
        zone: null,
        rejectionSpeed: 0, displacementAtr: 0, reclaimOrFailure: 0, touchQuality: 0,
        samples: 0, price: lastCloseFallback, atr: null,
        armed: false, stage: "IDLE", compression: null,
        mode: chosenMode,
      });
    }

    // Zone padding
    let pad = 0;
    if (chosenMode === "scalp") pad = 1.30;
    else pad = Math.min(0.10 * atrVal, 1.00);

    // Engine 5 context
    const ctxUrl = `${base}/api/v1/engine5-context?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(timeframe)}`;
    const ctxResp = await fetchJson(ctxUrl);
    const ctx = (ctxResp.ok && ctxResp.json) ? ctxResp.json : null;

    const currentPrice =
      toNum(ctx?.meta?.current_price) ??
      toNum(ctx?.meta?.currentPrice) ??
      lastCloseFallback ??
      null;

    // Resolve zone (manual inputs supported, but canonical is Engine 5 activeZone)
    let lo = toNum(qLo);
    let hi = toNum(qHi);
    let resolvedSource = source ? String(source) : null;
    let pickedZone = null;

    if (lo != null && hi != null) {
      pickedZone = { id: zoneId ?? null, lo, hi, _source: resolvedSource || "caller_bounds" };
    } else {
      pickedZone = pickZoneFromEngine5Context(ctx);
      if (pickedZone) {
        lo = toNum(pickedZone.lo);
        hi = toNum(pickedZone.hi);
        resolvedSource = resolvedSource || pickedZone._source || "engine5_activeZone";
      }
    }

    const zone = {
      id: (zoneId ?? pickedZone?.id) ?? null,
      source: resolvedSource,
      lo,
      hi,
    };

    if (lo == null || hi == null || currentPrice == null) {
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

    const loPad = lo - pad;
    const hiPad = hi + pad;

    const inZoneNow = within(currentPrice, loPad, hiPad);

    // Active negotiated check (turquoise only)
    const isNegotiated = zoneTypeIsNegotiated(pickedZone) || String(zone.id || "").includes("|NEG|");

    // Compute RQE (kept for scoring/diagnostics)
    const rqe = computeReactionQuality({
      bars,
      zone: { lo, hi, side, id: zone.id ?? null },
      atr: atrVal,
      opts: {
        tf: timeframe,
        windowBars: p.windowBars,
        breakDepthAtr: p.breakDepthAtr,
        reclaimWindowBars: p.reclaimWindowBars,
      },
    });

    // Metrics (locked)
    const rejectionSpeed = Number.isFinite(rqe.rejectionSpeedPoints) ? rqe.rejectionSpeedPoints * 2.5 : 0;
    const displacementAtr = Number.isFinite(rqe.displacementPoints) ? rqe.displacementPoints * 2.5 : 0;
    const reclaimOrFailure =
      rqe.structureState === "HOLD" ? 10 :
      rqe.structureState === "FAKEOUT_RECLAIM" ? 5 :
      rqe.structureState === "FAILURE" ? 0 : 0;

    // ARMED TEST RULES (v1)
    const a = candleAnatomy(lastBar);
    const o = Number(lastBar?.open), h = Number(lastBar?.high), l = Number(lastBar?.low), c = Number(lastBar?.close);

    // Wick probe SHORT: upper wick >= body, attempted above zoneHi, close back inside (<= hi)
    const wickProbeShort =
      isNegotiated &&
      inZoneNow &&
      (a.upperWick != null && a.body != null && a.upperWick >= a.body) &&
      Number.isFinite(h) && h > hi &&
      Number.isFinite(c) && c <= hi;

    // Wick probe LONG: lower wick >= body, attempted below zoneLo, close back inside (>= lo)
    const wickProbeLong =
      isNegotiated &&
      inZoneNow &&
      (a.lowerWick != null && a.body != null && a.lowerWick >= a.body) &&
      Number.isFinite(l) && l < lo &&
      Number.isFinite(c) && c >= lo;

    // Control candle (buyer/seller control)
    const ctrl = detectControlCandle(lastBar, atrVal);
    const controlArms =
      isNegotiated &&
      inZoneNow &&
      (ctrl.control === "SELLER" || ctrl.control === "BUYER");

    // Stage / armed (scalp-first)
    let stage = "IDLE";
    let armed = false;

    if (chosenMode === "scalp") {
      if (wickProbeShort || wickProbeLong || controlArms) {
        armed = true;
        stage = "ARMED";
      }
    } else {
      // keep legacy behavior for swing/long for now (no change)
      // (We can extend later once scalp is stable.)
      armed = false;
      stage = "IDLE";
    }

    // Compression diagnostic (kept)
    let compression = null;
    try {
      const n = sp.compBars;
      if (Array.isArray(bars) && bars.length >= n) {
        const lastN = bars.slice(-n);
        const maxH = Math.max(...lastN.map(b => b.high));
        const minL = Math.min(...lastN.map(b => b.low));
        compression = (maxH - minL) / atrVal;
      }
    } catch {}

    const reasonCodes = buildReasonCodes({ inZoneNow, rqe, mode: chosenMode, stage });

    // For scalp testing: keep reactionScore if in zone OR armed, else 0
    const inScope = inZoneNow || stage === "ARMED";
    const reactionScoreOut = inScope ? rqe.reactionScore : 0;
    const touchQuality = (inScope && rqe.touchIndex != null) ? 10 : 0;

    const structureStateOut = rqe.structureState === "FAKEOUT_RECLAIM" ? "RECLAIM" : rqe.structureState;

    return res.json({
      ok: true,
      invalid: false,

      // LOCKED fields
      reactionScore: reactionScoreOut,
      structureState: structureStateOut,
      reasonCodes,
      zone,

      rejectionSpeed,
      displacementAtr,
      reclaimOrFailure,
      touchQuality,

      samples: rqe.windowBars,
      price: currentPrice,
      atr: rqe.atr,

      armed,
      stage,
      compression,

      mode: chosenMode,

      // diagnostics (safe additions)
      side,
      direction: side === "supply" ? "SHORT" : "LONG",
      isNegotiatedZone: !!isNegotiated,

      wickProbeShort: !!wickProbeShort,
      wickProbeLong: !!wickProbeLong,

      controlCandle: ctrl.control,
      controlBodyPct: ctrl.bodyPct,
      controlBodyAtr: ctrl.bodyAtr,

      candle: a,
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
