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
// - Calls computeReactionQuality() (no engine math changes)
//
// NEW (DIAGNOSTICS ONLY):
// - Adds C-level breakdown fields:
//   zonePosition, rejectionCandidate, rejectionReasons, nextConfirmDown/Up
//   candle anatomy diagnostics: upperWick, body, range, closeBackInsideZone
//
// ✅ NEW (SAFE WRAPPER IMPROVEMENT):
// - If caller does NOT pass zoneId/lo/hi, auto-pick active zone from engine5-context:
//   negotiated_active -> shelf_active -> institutional_active
// - This prevents the strategy/dashboard from "stopping" when the caller omits zone args.
// - No engine math changes.

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
  if (mode === "scalp") return { lookbackBars: 12, windowBars: 2, breakDepthAtr: 0.25, reclaimWindowBars: 1 };
  if (mode === "long")  return { lookbackBars: 25, windowBars: 10, breakDepthAtr: 0.25, reclaimWindowBars: 5 };
  return { lookbackBars: 15, windowBars: 6, breakDepthAtr: 0.25, reclaimWindowBars: 3 };
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

/* -------------------- ARMED/STAGE -------------------- */

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

function buildReasonCodes({ inZone, rqe, mode }) {
  const codes = [];
  if (!inZone) codes.push("NOT_IN_ZONE");

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

/* -------------------- NEW: candle + rejection diagnostics -------------------- */

function candleAnatomy(bar) {
  if (!bar) return { upperWick: null, body: null, range: null };
  const o = Number(bar.open), h = Number(bar.high), l = Number(bar.low), c = Number(bar.close);
  if (![o, h, l, c].every(Number.isFinite)) return { upperWick: null, body: null, range: null };
  const body = Math.abs(c - o);
  const upperWick = h - Math.max(o, c);
  const range = h - l;
  return { upperWick, body, range };
}

function zonePosition(price, lo, hi) {
  if (price == null || lo == null || hi == null) return "UNKNOWN";
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const mid = (a + b) / 2;

  if (price > b) return "ABOVE_ZONE";
  if (price < a) return "BELOW_ZONE";

  // Inside zone
  const upperBand = mid + (b - mid) * 0.5; // top half of upper half
  const lowerBand = mid - (mid - a) * 0.5;

  if (price >= upperBand) return "UPPER_BAND";
  if (price <= lowerBand) return "LOWER_BAND";
  return "MIDLINE";
}

function buildRejectionDiagnostics({ lastBar, lo, hi }) {
  // User-locked rule for "rejection begins":
  // A) upperWick >= body
  // B) close back inside zone (attempt above + close <= hi)
  const { upperWick, body, range } = candleAnatomy(lastBar);

  const h = lastBar ? Number(lastBar.high) : null;
  const c = lastBar ? Number(lastBar.close) : null;

  const attemptedAbove = (h != null && hi != null) ? (h > hi) : false;
  const closeBackInside = (c != null && hi != null) ? (c <= hi) : false;

  const wickRule = (upperWick != null && body != null) ? (upperWick >= body) : false;

  const rejectionCandidate = Boolean(wickRule && attemptedAbove && closeBackInside);

  const rejectionReasons = [];
  if (wickRule) rejectionReasons.push("UPPER_WICK_GE_BODY");
  if (attemptedAbove) rejectionReasons.push("ATTEMPTED_ABOVE_ZONE_HI");
  if (closeBackInside) rejectionReasons.push("CLOSE_BACK_INSIDE_ZONE");

  // Next confirms (simple, readable)
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

    // ✅ 2) NEW: If caller did NOT pass zoneId/lo/hi -> auto-pick active zone
    // This ensures dashboard/strategy can call reaction-score without needing to pipe zone params.
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

    // If still no zone bounds -> stay alive, return idle safely (DO NOT break dashboard)
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
    // ✅ SAFE FIX: use tf= (your OHLC endpoint expects tf, not timeframe)
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

    // ATR is REQUIRED for Engine 3 compute + compression scoring
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

    // containment uses padded bounds
    const inZone = within(currentPrice, loPad, hiPad);

    // Compute Engine 3 reaction (UNCHANGED MATH) using ORIGINAL zone bounds (lo/hi)
    const rqe = computeReactionQuality({
      bars,
      zone: { lo, hi, side: "demand", id: (zoneId ?? autoPickedId) ?? null },
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

    const touchQuality = (inZone && rqe.touchIndex != null) ? 10 : 0;

    // ARMED/STAGE
    const comp = compressionN(bars, atrVal, sp.compBars);
    const isTight = comp != null && comp <= sp.compMax;

    const lastClose = bars[bars.length - 1]?.close ?? null;
    const exitedZone = Number.isFinite(lastClose) && (lastClose > hiPad || lastClose < loPad);

    let armed = false;
    let stage = "IDLE";

    if (inZone && isTight) { armed = true; stage = "ARMED"; }

    if (exitedZone && Number.isFinite(rqe.exitBars) && rqe.exitBars <= sp.triggerExitBarsMax) {
      stage = "TRIGGERED";
    }

    if (
      Number.isFinite(rqe.reactionScore) &&
      rqe.reactionScore >= sp.confirmScore &&
      (chosenMode !== "scalp" || stage === "TRIGGERED" || armed === true)
    ) {
      stage = "CONFIRMED";
    }

    if (!inZone && stage !== "TRIGGERED") {
      armed = false;
      stage = "IDLE";
    }

    const reasonCodes = buildReasonCodes({ inZone, rqe, mode: chosenMode });

    const reactionScoreOut = inZone ? rqe.reactionScore : 0;

    const structureStateOut = rqe.structureState === "FAKEOUT_RECLAIM" ? "RECLAIM" : rqe.structureState;

    // --------- NEW: C-level diagnostics (no math changes) ----------
    const pos = zonePosition(currentPrice, lo, hi);
    const rej = buildRejectionDiagnostics({ lastBar: bars[bars.length - 1], lo, hi });

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

      // NEW fields (safe additions)
      zonePosition: pos,
      rejectionCandidate: rej.rejectionCandidate,
      rejectionReasons: rej.rejectionReasons,
      nextConfirmDown: rej.nextConfirmDown,
      nextConfirmUp: rej.nextConfirmUp,
      diagnostics: {
        candle: rej.candle,
        zone: {
          lo,
          hi,
          mid: ((Math.min(lo, hi) + Math.max(lo, hi)) / 2),
          padded: { lo: loPad, hi: hiPad, pad },
        },
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
