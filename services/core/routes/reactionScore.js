// services/core/routes/reactionScore.js
//
// Engine 3 (Reaction Score) — wrapper
//
// LOCKED (per Engine 5 teammate):
// - Engine 3 MUST follow Engine 5 zone selection truth:
//   containment-first active.* (negotiated -> shelf -> institutional)
//   scalp fallback: nearest.shelf
// - Engine 3 MUST NOT pick from render arrays.
//
// TEST MODE (to get signals firing fast):
// - For SCALP: stage becomes ARMED if we are INSIDE ACTIVE NEGOTIATED zone and:
//    A) Wick probe candle (upper/lower wick >= body + probe beyond edge + close back inside), OR
//    B) Control candle (bodyPct>=0.65 + close near extreme + bodyAtr>=0.25)
//
// NOTE:
// - Engine 5B scalp GO uses stage===ARMED. We do NOT require CONFIRMED.

import express from "express";
import { computeReactionQuality } from "../logic/reactionQualityEngine.js";

export const reactionScoreRouter = express.Router();

/* -------------------- small utils -------------------- */

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

function within(price, lo, hi) {
  if (price == null || lo == null || hi == null) return false;
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return price >= a && price <= b;
}

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
  // scalp lookback higher for diagnostics; arming is still strict (must be in-zone)
  if (mode === "scalp")
    return { lookbackBars: 80, windowBars: 2, breakDepthAtr: 0.25, reclaimWindowBars: 1 };
  if (mode === "long")
    return { lookbackBars: 25, windowBars: 10, breakDepthAtr: 0.25, reclaimWindowBars: 5 };
  return { lookbackBars: 40, windowBars: 6, breakDepthAtr: 0.25, reclaimWindowBars: 3 };
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

/* -------------------- ATR -------------------- */

function computeATR(bars, len = 14) {
  if (!Array.isArray(bars) || bars.length < len + 2) return null;

  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    if (![h, l, pc].every(Number.isFinite)) continue;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  if (trs.length < len) return null;

  let atr = trs.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < trs.length; i++) atr = ((atr * (len - 1)) + trs[i]) / len;
  return atr;
}

/* -------------------- candle analysis -------------------- */

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

/* -------------------- Engine 5 zone selection (LOCKED) -------------------- */

function pickZoneFromEngine5Context(ctx) {
  // 1) containment-first: active.negotiated -> active.shelf -> active.institutional
  const act = ctx?.active || {};
  if (act.negotiated && act.negotiated.lo != null && act.negotiated.hi != null) {
    return { ...act.negotiated, zoneType: "NEGOTIATED", _source: "active.negotiated" };
  }
  if (act.shelf && act.shelf.lo != null && act.shelf.hi != null) {
    return { ...act.shelf, zoneType: "SHELF", _source: "active.shelf" };
  }
  if (act.institutional && act.institutional.lo != null && act.institutional.hi != null) {
    return { ...act.institutional, zoneType: "INSTITUTIONAL", _source: "active.institutional" };
  }

  // 2) scalp deterministic fallback: nearest.shelf
  const ns = ctx?.nearest?.shelf || null;
  if (ns && ns.lo != null && ns.hi != null) {
    return { ...ns, zoneType: "SHELF", _source: "NEAREST_SHELF_SCALP_REF" };
  }

  return null;
}

function isNegotiatedZone(zone) {
  const id = String(zone?.id || "").toUpperCase();
  const zt = String(zone?.zoneType || zone?.type || "").toUpperCase();
  return zt === "NEGOTIATED" || id.includes("|NEG|");
}

/* -------------------- reason codes -------------------- */

function buildReasonCodes({ inZoneNow, stage, rqe, mode }) {
  const codes = [];

  // Engine 5B resets when NOT_IN_ZONE; only emit if not in zone AND not armed
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
    const { symbol, tf, mode, strategyId } = req.query;

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
    const side = resolveSideFromQuery(req);
    const p = presetOpts(chosenMode);

    const base = getBaseUrl(req);

    // 1) Get bars first
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

    const lastCloseFallback = Number.isFinite(fullBars[fullBars.length - 1]?.close)
      ? fullBars[fullBars.length - 1].close
      : null;

    const atrVal = computeATR(fullBars, 14) || computeATR(fullBars, 10) || null;

    const bars = fullBars.length > p.lookbackBars ? fullBars.slice(-p.lookbackBars) : fullBars;
    const lastBar = bars[bars.length - 1] || null;

    // If ATR unavailable, still return something safe
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

    // 2) Engine 5 context
    const ctxUrl = `${base}/api/v1/engine5-context?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(timeframe)}`;
    const ctxResp = await fetchJson(ctxUrl);
    const ctx = (ctxResp.ok && ctxResp.json) ? ctxResp.json : null;

    const currentPrice =
      toNum(ctx?.meta?.current_price) ??
      toNum(ctx?.meta?.currentPrice) ??
      lastCloseFallback ??
      null;

    // 3) Resolve zone: caller lo/hi overrides, else engine5 picked zone
    let lo = toNum(req.query.lo);
    let hi = toNum(req.query.hi);
    let zoneObj = null;
    let zoneSource = req.query.source ? String(req.query.source) : null;
    let zoneId = req.query.zoneId ? String(req.query.zoneId) : null;

    if (lo != null && hi != null) {
      zoneObj = { id: zoneId ?? null, lo, hi, zoneType: "MANUAL", _source: zoneSource || "caller_bounds" };
    } else {
      zoneObj = pickZoneFromEngine5Context(ctx);
      if (zoneObj) {
        lo = toNum(zoneObj.lo);
        hi = toNum(zoneObj.hi);
        zoneId = zoneId ?? (zoneObj.id ? String(zoneObj.id) : null);
        zoneSource = zoneSource || zoneObj._source || null;
      }
    }

    const zone = {
      id: zoneId,
      source: zoneSource,
      lo,
      hi,
    };

    if (lo == null || hi == null || currentPrice == null) {
      return res.json({
        ok: true, invalid: false,
        reactionScore: 0, structureState: "HOLD", reasonCodes: ["NOT_IN_ZONE"],
        zone,
        rejectionSpeed: 0, displacementAtr: 0, reclaimOrFailure: 0, touchQuality: 0,
        samples: 0, price: currentPrice, atr: atrVal,
        armed: false, stage: "IDLE", compression: null,
        mode: chosenMode,
      });
    }

    // Padding for containment check (kept from your prior logic)
    let pad = 0;
    if (chosenMode === "scalp") pad = 1.30;
    else pad = Math.min(0.10 * atrVal, 1.00);

    const loPad = lo - pad;
    const hiPad = hi + pad;

    const inZoneNow = within(currentPrice, loPad, hiPad);

    // 4) Compute RQE (kept for scoring/diagnostics)
    const rqe = computeReactionQuality({
      bars,
      zone: { lo, hi, side, id: zoneId ?? null },
      atr: atrVal,
      opts: {
        tf: timeframe,
        windowBars: p.windowBars,
        breakDepthAtr: p.breakDepthAtr,
        reclaimWindowBars: p.reclaimWindowBars,
      },
    });

    const rejectionSpeed = Number.isFinite(rqe.rejectionSpeedPoints) ? rqe.rejectionSpeedPoints * 2.5 : 0;
    const displacementAtr = Number.isFinite(rqe.displacementPoints) ? rqe.displacementPoints * 2.5 : 0;
    const reclaimOrFailure =
      rqe.structureState === "HOLD" ? 10 :
      rqe.structureState === "FAKEOUT_RECLAIM" ? 5 :
      rqe.structureState === "FAILURE" ? 0 : 0;

    // 5) ARMED logic (SCALP testing)
    let stage = "IDLE";
    let armed = false;

    const negotiated = isNegotiatedZone(zoneObj);

    // Only arm if negotiated + in zone now (your intraday scalp contract)
    const a = candleAnatomy(lastBar);
    const o = Number(lastBar?.open), h = Number(lastBar?.high), l = Number(lastBar?.low), c = Number(lastBar?.close);

    const wickProbeShort =
      negotiated &&
      inZoneNow &&
      (a.upperWick != null && a.body != null && a.upperWick >= a.body) &&
      Number.isFinite(h) && h > hi &&
      Number.isFinite(c) && c <= hi;

    const wickProbeLong =
      negotiated &&
      inZoneNow &&
      (a.lowerWick != null && a.body != null && a.lowerWick >= a.body) &&
      Number.isFinite(l) && l < lo &&
      Number.isFinite(c) && c >= lo;

    const ctrl = detectControlCandle(lastBar, atrVal);
    const controlArms =
      negotiated &&
      inZoneNow &&
      (ctrl.control === "SELLER" || ctrl.control === "BUYER");

    if (chosenMode === "scalp") {
      if (wickProbeShort || wickProbeLong || controlArms) {
        armed = true;
        stage = "ARMED";
      }
    }

    const reasonCodes = buildReasonCodes({ inZoneNow, stage, rqe, mode: chosenMode });

    // For scalp testing: show score if in zone OR armed
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
      compression: null,

      mode: chosenMode,

      // Diagnostics (safe additions)
      side,
      direction: side === "supply" ? "SHORT" : "LONG",
      inZoneNow,
      negotiatedZone: negotiated,

      wickProbeShort,
      wickProbeLong,

      controlCandle: ctrl.control,
      controlBodyPct: ctrl.bodyPct,
      controlBodyAtr: ctrl.bodyAtr,

      candle: a,
      padded: { lo: loPad, hi: hiPad, pad },
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
