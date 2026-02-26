// services/core/routes/reactionScore.js
//
// Engine 3 (Reaction Score) — wrapper
//
// LOCKED (Engine 5 alignment):
// - Engine 3 must follow Engine 5 zone truth: active.negotiated -> active.shelf -> active.institutional
// - Scalp fallback if no active contains price: nearest.shelf
// - Engine 3 must NOT pick from render arrays.
//
// FIX (this version):
// - Engine 5B calls E3 with lo/hi only (no id/type/source). We enrich zone metadata by matching
//   request lo/hi against engine5-context active zone bounds using a tolerance.
// - This allows negotiated arming logic to work during /scalp-status.
//
// SCALP TEST ARMING (v1):
// - Base: Arm on wick probe OR control candle, only inside NEGOTIATED zone.
// - Optional testing switch: E3_TOUCH_ARMS_NEGOTIATED=1
//   -> Arm whenever price is inside inferred negotiated zone.
//
// NOTE:
// - Engine 5B uses stage===ARMED; CONFIRMED is not required for scalp GO.

import express from "express";
import { computeReactionQuality } from "../logic/reactionQualityEngine.js";

export const reactionScoreRouter = express.Router();

/* -------------------- utils -------------------- */

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

function abs(x) {
  return Math.abs(x);
}

function boundsMatch(reqLo, reqHi, actLo, actHi, eps = 1e-3) {
  // eps=0.001 is safe for 2-decimal zone bounds
  if (![reqLo, reqHi, actLo, actHi].every(Number.isFinite)) return false;
  return abs(reqLo - actLo) <= eps && abs(reqHi - actHi) <= eps;
}

/* -------------------- mode + side -------------------- */

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

/* -------------------- candle logic -------------------- */

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

  // scalp fallback
  const ns = ctx?.nearest?.shelf || null;
  if (ns && ns.lo != null && ns.hi != null) {
    return { ...ns, zoneType: "SHELF", _source: "NEAREST_SHELF_SCALP_REF" };
  }

  return null;
}

function isNegotiatedByMeta(zoneType, zoneId) {
  if (String(zoneType || "").toUpperCase() === "NEGOTIATED") return true;
  const id = String(zoneId || "").toUpperCase();
  return id.includes("|NEG|");
}

/* -------------------- reason codes -------------------- */

function buildReasonCodes({ inZoneNow, stage, rqe, mode }) {
  const codes = [];

  // Engine 5B resets on NOT_IN_ZONE; only emit when truly out and not armed.
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

    // Bars
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

    // Engine5 context
    const ctxUrl = `${base}/api/v1/engine5-context?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(timeframe)}`;
    const ctxResp = await fetchJson(ctxUrl);
    const ctx = (ctxResp.ok && ctxResp.json) ? ctxResp.json : null;

    const currentPrice =
      toNum(ctx?.meta?.current_price) ??
      toNum(ctx?.meta?.currentPrice) ??
      lastCloseFallback ??
      null;

    // Requested zone (Engine5B passes lo/hi only)
    const reqLo = toNum(req.query.lo);
    const reqHi = toNum(req.query.hi);
    let zoneId = req.query.zoneId ? String(req.query.zoneId) : null;
    let zoneSource = req.query.source ? String(req.query.source) : null;

    // Active picked zone (Engine5 truth)
    const picked = pickZoneFromEngine5Context(ctx);

    // Resolve bounds:
    // - if request provides lo/hi, use them
    // - else use picked zone
    let lo = reqLo;
    let hi = reqHi;

    if ((lo == null || hi == null) && picked) {
      lo = toNum(picked.lo);
      hi = toNum(picked.hi);
      zoneId = zoneId ?? (picked.id ? String(picked.id) : null);
      zoneSource = zoneSource ?? (picked._source || null);
    }

    // Enrich metadata by matching request bounds to active zone bounds
    // This is the critical fix for /scalp-status.
    let inferredZoneType = null;
    let inferredZoneId = null;
    let inferredSource = null;

    if (picked && lo != null && hi != null) {
      const pLo = toNum(picked.lo);
      const pHi = toNum(picked.hi);

      if (boundsMatch(lo, hi, pLo, pHi, 1e-3)) {
        inferredZoneType = String(picked.zoneType || "").toUpperCase() || null;
        inferredZoneId = picked.id ? String(picked.id) : null;
        inferredSource = "ACTIVE";
      }
    }

    if (!zoneId && inferredZoneId) zoneId = inferredZoneId;
    if (!zoneSource && inferredSource) zoneSource = inferredSource;

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

    // containment padding (same as your earlier)
    let pad = 0;
    if (chosenMode === "scalp") pad = 1.30;
    else pad = Math.min(0.10 * atrVal, 1.00);

    const loPad = lo - pad;
    const hiPad = hi + pad;

    const inZoneNow = within(currentPrice, loPad, hiPad);

    // negotiated classification (inferred or by id)
    const negotiatedZone = isNegotiatedByMeta(inferredZoneType, zoneId);

    // RQE compute (kept)
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

    // SCALP ARMING RULES (v1)
    const a = candleAnatomy(lastBar);
    const o = Number(lastBar?.open);
    const h = Number(lastBar?.high);
    const l = Number(lastBar?.low);
    const c = Number(lastBar?.close);

    // Wick probes (requires probe beyond edge + close back inside)
    const wickProbeShort =
      negotiatedZone &&
      inZoneNow &&
      (a.upperWick != null && a.body != null && a.upperWick >= a.body) &&
      Number.isFinite(h) && h > hi &&
      Number.isFinite(c) && c <= hi;

    const wickProbeLong =
      negotiatedZone &&
      inZoneNow &&
      (a.lowerWick != null && a.body != null && a.lowerWick >= a.body) &&
      Number.isFinite(l) && l < lo &&
      Number.isFinite(c) && c >= lo;

    const ctrl = detectControlCandle(lastBar, atrVal);

    // Direction-aware control (recommended)
    const controlArms =
      negotiatedZone &&
      inZoneNow &&
      (
        (side === "demand" && ctrl.control === "BUYER") ||
        (side === "supply" && ctrl.control === "SELLER")
      );

    // Optional testing flag: arm on zone touch whenever inside negotiated
    const touchArmsEnabled = String(process.env.E3_TOUCH_ARMS_NEGOTIATED || "").trim() === "1";
    const touchArms = Boolean(touchArmsEnabled && negotiatedZone && inZoneNow);

    let stage = "IDLE";
    let armed = false;

    if (chosenMode === "scalp") {
      if (touchArms || wickProbeShort || wickProbeLong || controlArms) {
        armed = true;
        stage = "ARMED";
      }
    }

    const reasonCodes = buildReasonCodes({ inZoneNow, stage, rqe, mode: chosenMode });

    // Keep score visible if in zone or armed (so UI shows activity)
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

      // diagnostics
      side,
      direction: side === "supply" ? "SHORT" : "LONG",
      inZoneNow,

      negotiatedZone,
      inferredZoneType,
      inferredSource: inferredSource,
      inferredFromActiveMatch: inferredZoneType != null,

      touchArmsEnabled,
      touchArms,

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
