// services/core/routes/tradePermission.js
// Engine 6 — Trade Permission API
//
// GET /api/v1/trade-permission
//
// NOTE:
// - This endpoint EXPECTS the frontend or caller to supply
//   engine5, marketMeter, and zoneContext.
// - We do NOT guess or infer missing data.
// - This keeps Engine 6 pure and safe.

import express from "express";
import { computeTradePermission } from "../logic/engine6TradePermission.js";

export const tradePermissionRouter = express.Router();

tradePermissionRouter.get("/trade-permission", (req, res) => {
  try {
    const input = {
      symbol: req.query.symbol || "SPY",
      tf: req.query.tf || "1h",
      asOf: new Date().toISOString(),

      engine5: req.query.engine5
        ? JSON.parse(req.query.engine5)
        : req.body?.engine5,

      marketMeter: req.query.marketMeter
        ? JSON.parse(req.query.marketMeter)
        : req.body?.marketMeter,

      zoneContext: req.query.zoneContext
        ? JSON.parse(req.query.zoneContext)
        : req.body?.zoneContext,

      intent: req.query.intent
        ? JSON.parse(req.query.intent)
        : req.body?.intent || { action: "NEW_ENTRY" },
    };

    const result = computeTradePermission(input);

    return res.json({
      engine: "engine6.tradePermission",
      symbol: input.symbol,
      tf: input.tf,
      asOf: input.asOf,
      ...result,
    });
  } catch (err) {
    console.error("[engine6] error:", err);
    return res.status(500).json({
      ok: false,
      error: "ENGINE6_ERROR",
      detail: String(err?.message || err),
    });
  }
});
