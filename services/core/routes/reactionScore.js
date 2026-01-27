// services/core/routes/reactionScore.js
//
// Engine 3 (Reaction) — thin wrapper that FIXES false NOT_IN_ZONE.
// No behavioral scoring implemented here (still placeholders),
// BUT we correctly resolve zone lo/hi and verify containment using Engine 1 truth.
//
// Purpose:
// - Lock response fields
// - Echo resolved zone (id/source/lo/hi)
// - Fix negotiated zoneId resolution
// - Fix NOT_IN_ZONE false positives by using meta.current_price

import express from "express";

export const reactionScoreRouter = express.Router();

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
    const r = await fetch(url, { signal: controller.signal });
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

function findZoneById(ctx, zoneId) {
  if (!ctx || !zoneId) return null;

  // 1) Active zones first (authoritative)
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

  // 2) Render arrays next (display list)
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

/**
 * GET /api/v1/reaction-score?symbol=SPY&tf=1h&zoneId=...&source=shelf&lo=...&hi=...
 *
 * Behavior:
 * - If lo/hi provided -> use them
 * - Else if zoneId provided -> resolve lo/hi via /engine5-context (active first, then render arrays)
 * - Determine withinZone using meta.current_price
 * - reasonCodes:
 *    - [] if withinZone
 *    - ["NOT_IN_ZONE"] otherwise
 *
 * Scoring:
 * - Still placeholders (0) until full Engine 3 behavior is plugged back in.
 */
reactionScoreRouter.get("/reaction-score", async (req, res) => {
  const { symbol, tf, zoneId, source } = req.query;
  const qLo = req.query.lo;
  const qHi = req.query.hi;

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
    });
  }

  const sym = String(symbol).toUpperCase();
  const timeframe = String(tf);

  // Start with any explicit lo/hi from query
  let lo = toNum(qLo);
  let hi = toNum(qHi);
  let resolvedSource = source ? String(source) : null;

  // Fetch engine5-context if we need current_price OR need to resolve zoneId
  let ctx = null;
  let currentPrice = null;

  const needCtx = true; // always use Engine 1 price truth for containment
  if (needCtx) {
    const base = getBaseUrl(req);
    const ctxUrl = `${base}/api/v1/engine5-context?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(timeframe)}`;
    const ctxResp = await fetchJson(ctxUrl);

    if (ctxResp.ok && ctxResp.json) {
      ctx = ctxResp.json;
      // Support both meta.current_price and meta.current_price (already in your engine5-context)
      currentPrice =
        toNum(ctx?.meta?.current_price) ??
        toNum(ctx?.meta?.currentPrice) ??
        null;
    }
  }

  // If lo/hi missing, resolve from zoneId via context
  if ((lo == null || hi == null) && zoneId && ctx) {
    const z = findZoneById(ctx, zoneId);
    if (z) {
      lo = toNum(z.lo);
      hi = toNum(z.hi);
      resolvedSource = resolvedSource || z._source || null;
    }
  }

  const inZone = within(currentPrice, lo, hi);

  const zone = {
    id: zoneId ?? null,
    source: resolvedSource,
    lo,
    hi,
  };

  return res.json({
    ok: true,
    invalid: false,

    // LOCKED NAMES (placeholders for now)
    reactionScore: 0,
    structureState: "HOLD",
    reasonCodes: inZone ? [] : ["NOT_IN_ZONE"],

    // ECHO ZONE (LOCKED)
    zone,

    // explainability placeholders (LOCKED)
    rejectionSpeed: 0,
    displacementAtr: 0,
    reclaimOrFailure: 0,
    touchQuality: inZone ? 10 : 0, // small helpful truth: touch exists if inside
    samples: 0,
    price: currentPrice,
    atr: null,
  });
});
