// services/core/routes/tradePermission.js
// Engine 6 API — /api/v1/trade-permission
//
// Supports:
// POST /api/v1/trade-permission   (recommended)
//   body: { symbol, tf, asOf, engine5, marketMeter, zoneContext, intent }
//
// GET /api/v1/trade-permission?symbol=SPY&tf=1h
//   optional query overrides:
//     score, invalid, eodRisk, eodPsi, eodState, h1State, h4State
//     zoneType, withinZone, degraded, liquidityFail, reactionFailed, intent
//
// NOTE: This is a "pure gating" endpoint. It does not detect zones or compute confluence.
// The caller (frontend or Engine 5 orchestrator) should supply those inputs.

import express from "express";
import { computeTradePermission } from "../logic/engine6TradePermission.js";

export const tradePermissionRouter = express.Router();

const toBool = (v) => {
  if (typeof v === "boolean") return v;
  const s = String(v || "").toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
  if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  return false;
};

tradePermissionRouter.post("/trade-permission", (req, res) => {
  try {
    const input = req.body || {};
    const out = computeTradePermission(input);

    return res.json({
      ok: true,
      engine: "engine6.tradePermission",
      symbol: String(input.symbol || "SPY").toUpperCase(),
      tf: String(input.tf || "1h"),
      asOf: input.asOf || new Date().toISOString(),
      ...out,
    });
  } catch (err) {
    console.error("[engine6 POST /trade-permission] error:", err?.stack || err);
    return res.status(500).json({
      ok: false,
      error: "engine6_failed",
      detail: String(err?.message || err),
    });
  }
});

tradePermissionRouter.get("/trade-permission", (req, res) => {
  try {
    const q = req.query || {};
    const symbol = String(q.symbol || "SPY").toUpperCase();
    const tf = String(q.tf || "1h");
    const asOf = new Date().toISOString();

    // Minimal GET mode (for quick checks)
    const input = {
      symbol,
      tf,
      asOf,
      engine5: {
        total: q.score != null ? Number(q.score) : 0,
        invalid: q.invalid != null ? toBool(q.invalid) : false,
        reasonCodes: [],
      },
      marketMeter: {
        eod: {
          risk: q.eodRisk || "MIXED",
          psi: q.eodPsi != null ? Number(q.eodPsi) : NaN,
          state: q.eodState || "NEUTRAL",
          bias: q.eodBias || "NEUTRAL",
        },
        h1: { state: q.h1State || "NEUTRAL", bias: q.h1Bias || "NEUTRAL" },
        h4: { state: q.h4State || "NEUTRAL", bias: q.h4Bias || "NEUTRAL" },
        m10: { state: q.m10State || "NEUTRAL", bias: q.m10Bias || "NEUTRAL" },
      },
      zoneContext: {
        zoneType: q.zoneType || "NEGOTIATED",
        zoneId: q.zoneId || "",
        withinZone: q.withinZone != null ? toBool(q.withinZone) : true,
        flags: {
          degraded: q.degraded != null ? toBool(q.degraded) : false,
          liquidityFail: q.liquidityFail != null ? toBool(q.liquidityFail) : false,
          reactionFailed: q.reactionFailed != null ? toBool(q.reactionFailed) : false,
        },
        meta: {},
      },
      intent: { action: q.intent || "NEW_ENTRY" },
    };

    const out = computeTradePermission(input);

    return res.json({
      ok: true,
      engine: "engine6.tradePermission",
      symbol,
      tf,
      asOf,
      ...out,
    });
  } catch (err) {
    console.error("[engine6 GET /trade-permission] error:", err?.stack || err);
    return res.status(500).json({
      ok: false,
      error: "engine6_failed",
      detail: String(err?.message || err),
    });
  }
});
