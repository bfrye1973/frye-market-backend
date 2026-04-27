// services/core/routes/reactionScore.js
//
// Engine 3 (Reaction Score) — wrapper
//
// LOCKED (Engine 5 alignment):
// - Engine 3 must follow Engine 5 zone truth: active.negotiated -> active.shelf -> active.institutional
// - Scalp fallback if no active contains price: nearest.shelf
// - Engine 3 must NOT pick from render arrays.
//
// FIX:
// - Engine 5B calls E3 with lo/hi only (no id/type/source). We enrich zone metadata by matching
//   request lo/hi against engine5-context active zone bounds using a tolerance.
// - This allows negotiated arming logic to work during /scalp-status.
//
// SCALP ARMING:
// - Arm on wick probe OR control candle, only inside NEGOTIATED zone.
//
// NOTE:
// - Engine 5B uses stage===ARMED; CONFIRMED is not required for scalp GO.
//
// UPGRADES:
// 1) Add ARMED candle metadata:
//    armedCandleHigh / armedCandleLow / armedCandleTimeMs / armedCandleTimeSec
// 2) Make bounds inference stable for bounds-only callers:
//    - wider epsilon + 2dp compare
//    - consistently populate zone.id + negotiatedZone when matching active zone

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

function round2(x) {
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

function boundsMatch(reqLo, reqHi, actLo, actHi, eps = 1e-2) {
  if (![reqLo, reqHi, actLo, actHi].every(Number.isFinite)) return false;

  const direct =
    abs(reqLo - actLo) <= eps &&
    abs(reqHi - actHi) <= eps;

  if (direct) return true;

  const rReqLo = round2(reqLo);
  const rReqHi = round2(reqHi);
  const rActLo = round2(actLo);
  const rActHi = round2(actHi);

  return (
    rReqLo != null &&
    rReqHi != null &&
    rActLo != null &&
    rActHi != null &&
    rReqLo === rActLo &&
    rReqHi === rActHi
  );
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
  for (let i = len; i < trs.length; i++) {
    atr = ((atr * (len - 1)) + trs[i]) / len;
  }

  return atr;
}

/* -------------------- candle logic -------------------- */

function candleAnatomy(bar) {
  if (!bar) {
    return { upperWick: null, lowerWick: null, body: null, range: null, bodyPct: null };
  }

  const o = Number(bar.open);
  const h = Number(bar.high);
  const l = Number(bar.low);
  const c = Number(bar.close);

  if (![o, h, l, c].every(Number.isFinite)) {
    return { upperWick: null, lowerWick: null, body: null, range: null, bodyPct: null };
  }

  const body = Math.abs(c - o);
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const range = h - l;
  const bodyPct = range > 0 ? (body / range) : null;

  return { upperWick, lowerWick, body, range, bodyPct };
}

function detectControlCandle(bar, atr) {
  const o = Number(bar?.open);
  const h = Number(bar?.high);
  const l = Number(bar?.low);
  const c = Number(bar?.close);

  if (![o, h, l, c].every(Number.isFinite)) {
    return { control: "NONE", bodyPct: null, bodyAtr: null };
  }

  const range = h - l;
  if (!(range > 0) || !Number.isFinite(atr) || atr <= 0) {
    return { control: "NONE", bodyPct: null, bodyAtr: null };
  }

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

  if (!inZoneNow && stage !== "ARMED") codes.push("NOT_IN_ZONE");

  if (rqe?.reason === "NO_TOUCH" || rqe?.flags?.NO_TOUCH) {
    codes.push("NO_TOUCH");
    return Array.from(new Set(codes));
  }

  if (mode === "scalp" && Number.isFinite(rqe?.exitBars) && rqe.exitBars > 2) {
    codes.push("SLOW_REACTION");
  }

  if (
    Number.isFinite(rqe?.displacementAtrRaw) &&
    rqe.displacementAtrRaw < (mode === "scalp" ? 0.15 : 0.20)
  ) {
    codes.push("WEAK_DISPLACEMENT");
  }

  if (rqe?.structureState === "FAILURE") codes.push("FAILURE");
  if (rqe?.structureState === "FAKEOUT_RECLAIM") codes.push("RECLAIM");

  return Array.from(new Set(codes));
}

/* -------------------- time helpers -------------------- */

function inferTimeMsFromBar(bar) {
  const t = toNum(bar?.time);
  if (t == null) return null;
  if (t > 1e12) return Math.round(t);
  if (t > 1e9) return Math.round(t * 1000);
  return null;
}

function inferTimeSecFromBar(bar) {
  const t = toNum(bar?.time);
  if (t == null) return null;
  if (t > 1e12) return Math.floor(t / 1000);
  if (t > 1e9) return Math.floor(t);
  return null;
}

/* -------------------- route -------------------- */

reactionScoreRouter.get("/reaction-score", async (req, res) => {
  try {
    const { symbol, tf, mode, strategyId } = req.query;

    if (!symbol || !tf) {
      return res.status(400).json({
        ok: false,
        invalid: true,
        reactionScore: 0,
        structureState: "HOLD",
        reasonCodes: ["MISSING_SYMBOL_OR_TF"],
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

    const sym = String(symbol).toUpperCase();
    const timeframe = String(tf);

    const chosenMode = resolveMode({ mode, strategyId });
    const side = resolveSideFromQuery(req);
    const p = presetOpts(chosenMode);

    const base = getBaseUrl(req);

    const ohlcUrl =
      `${base}/api/v1/ohlc?symbol=${encodeURIComponent(sym)}` +
      `&tf=${encodeURIComponent(timeframe)}&limit=250`;

    const barsResp = await fetchJson(ohlcUrl);

    if (!barsResp.ok || !Array.isArray(barsResp.json)) {
      return res.status(502).json({
        ok: false,
        invalid: true,
        reactionScore: 0,
        structureState: "HOLD",
        reasonCodes: ["BARS_UNAVAILABLE"],
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
        mode: chosenMode,
      });
    }

    const fullBars = barsResp.json
      .map(b => ({
        time: toNum(b.time),
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume ?? 0),
      }))
      .filter(b => [b.open, b.high, b.low, b.close].every(Number.isFinite));

    const bars = fullBars.length > p.lookbackBars
      ? fullBars.slice(-p.lookbackBars)
      : fullBars;

    const lastBar = bars[bars.length - 1] || null;

    const lastCloseFallback = Number.isFinite(fullBars[fullBars.length - 1]?.close)
      ? fullBars[fullBars.length - 1].close
      : null;

    const atrVal = computeATR(fullBars, 14) || computeATR(fullBars, 10) || null;

    if (!atrVal || !Number.isFinite(atrVal) || atrVal <= 0) {
      return res.json({
        ok: true,
        invalid: false,
        reactionScore: 0,
        structureState: "HOLD",
        reasonCodes: ["ATR_UNAVAILABLE"],
        zone: null,
        rejectionSpeed: 0,
        displacementAtr: 0,
        reclaimOrFailure: 0,
        touchQuality: 0,
        samples: 0,
        price: lastCloseFallback,
        atr: null,
        armed: false,
        stage: "IDLE",
        compression: null,
        mode: chosenMode,
      });
    }

    const ctxUrl =
      `${base}/api/v1/engine5-context?symbol=${encodeURIComponent(sym)}` +
      `&tf=${encodeURIComponent(timeframe)}`;

    const ctxResp = await fetchJson(ctxUrl);
    const ctx = (ctxResp.ok && ctxResp.json) ? ctxResp.json : null;

    const currentPrice =
      toNum(ctx?.meta?.current_price) ??
      toNum(ctx?.meta?.currentPrice) ??
      lastCloseFallback ??
      null;

    const reqLo = toNum(req.query.lo);
    const reqHi = toNum(req.query.hi);

    let zoneId = req.query.zoneId ? String(req.query.zoneId) : null;
    let zoneSource = req.query.source ? String(req.query.source) : null;

    const picked = pickZoneFromEngine5Context(ctx);

    let lo = reqLo;
    let hi = reqHi;

    if ((lo == null || hi == null) && picked) {
      lo = toNum(picked.lo);
      hi = toNum(picked.hi);
      zoneId = zoneId ?? (picked.id ? String(picked.id) : null);
      zoneSource = zoneSource ?? (picked._source || null);
    }

    let inferredZoneType = null;
    let inferredZoneId = null;
    let inferredSource = null;

    if (picked && lo != null && hi != null) {
      const pLo = toNum(picked.lo);
      const pHi = toNum(picked.hi);

      if (boundsMatch(lo, hi, pLo, pHi, 1e-2)) {
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
        ok: true,
        invalid: false,
        reactionScore: 0,
        structureState: "HOLD",
        reasonCodes: ["NOT_IN_ZONE"],
        zone,
        rejectionSpeed: 0,
        displacementAtr: 0,
        reclaimOrFailure: 0,
        touchQuality: 0,
        samples: 0,
        price: currentPrice,
        atr: atrVal,
        armed: false,
        stage: "IDLE",
        compression: null,
        mode: chosenMode,
      });
    }

    let pad = 0;
    if (chosenMode === "scalp") {
      pad = 1.30;
    } else {
      pad = Math.min(0.10 * atrVal, 1.00);
    }

    const loPad = lo - pad;
    const hiPad = hi + pad;

    const inZoneNow = within(currentPrice, loPad, hiPad);

    const negotiatedZone = isNegotiatedByMeta(inferredZoneType, zoneId);

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

    const rejectionSpeed = Number.isFinite(rqe.rejectionSpeedPoints)
      ? rqe.rejectionSpeedPoints * 2.5
      : 0;

    const displacementAtr = Number.isFinite(rqe.displacementPoints)
      ? rqe.displacementPoints * 2.5
      : 0;

    const reclaimOrFailure =
      rqe.structureState === "HOLD" ? 10 :
      rqe.structureState === "FAKEOUT_RECLAIM" ? 5 :
      rqe.structureState === "FAILURE" ? 0 : 0;

    const a = candleAnatomy(lastBar);

    const h = Number(lastBar?.high);
    const l = Number(lastBar?.low);
    const c = Number(lastBar?.close);

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

    const controlArms =
      negotiatedZone &&
      inZoneNow &&
      (
        (side === "demand" && ctrl.control === "BUYER") ||
        (side === "supply" && ctrl.control === "SELLER")
      );

    let stage = "IDLE";
    let armed = false;

    if (chosenMode === "scalp") {
      if (wickProbeShort || wickProbeLong || controlArms) {
        armed = true;
        stage = "ARMED";
      }
    }

    const reasonCodes = buildReasonCodes({ inZoneNow, stage, rqe, mode: chosenMode });

    const inScope = inZoneNow || stage === "ARMED";
    const reactionScoreOut = inScope ? rqe.reactionScore : 0;
    const touchQuality = (inScope && rqe.touchIndex != null) ? 10 : 0;

    const structureStateOut =
      rqe.structureState === "FAKEOUT_RECLAIM" ? "RECLAIM" : rqe.structureState;

    let armedCandleHigh = null;
    let armedCandleLow = null;
    let armedCandleTimeMs = null;
    let armedCandleTimeSec = null;

    if (stage === "ARMED") {
      armedCandleHigh = Number.isFinite(h) ? h : null;
      armedCandleLow = Number.isFinite(l) ? l : null;
      armedCandleTimeMs = inferTimeMsFromBar(lastBar);
      armedCandleTimeSec = inferTimeSecFromBar(lastBar);
    }

    return res.json({
      ok: true,
      invalid: false,

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

      side,
      direction: side === "supply" ? "SHORT" : "LONG",
      inZoneNow,

      negotiatedZone,
      inferredZoneType,
      inferredSource,
      inferredFromActiveMatch: inferredZoneType != null,

      wickProbeShort,
      wickProbeLong,

      controlCandle: ctrl.control,
      controlBodyPct: ctrl.bodyPct,
      controlBodyAtr: ctrl.bodyAtr,

      candle: a,
      padded: { lo: loPad, hi: hiPad, pad },

      armedCandleHigh,
      armedCandleLow,
      armedCandleTimeMs,
      armedCandleTimeSec,
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
