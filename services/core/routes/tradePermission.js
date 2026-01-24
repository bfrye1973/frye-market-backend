// services/core/routes/tradePermission.js
// Engine 6 — Trade Permission API
//
// ✅ Supports:
//   GET  /api/v1/trade-permission (sanity)
//   POST /api/v1/trade-permission (preferred; avoids giant querystrings)
//
// Body shape:
// {
//   symbol, tf,
//   engine5: { invalid, total, reasonCodes },
//   marketMeter: {...},
//   zoneContext: {...},
//   intent: { action: "NEW_ENTRY" }
// }

import express from "express";
import { computeTradePermission } from "../logic/engine6TradePermission.js";

export const tradePermissionRouter = express.Router();

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function buildInput(req) {
  const body = req.body || {};
  const q = req.query || {};

  const symbol = body.symbol || q.symbol || "SPY";
  const tf = body.tf || q.tf || "1h";

  const engine5 =
    body.engine5 ||
    (typeof q.engine5 === "string" ? safeJsonParse(q.engine5) : null) ||
    { invalid: false, total: 0, reasonCodes: [] };

  const marketMeter =
    body.marketMeter ||
    (typeof q.marketMeter === "string" ? safeJsonParse(q.marketMeter) : null) ||
    null;

  const zoneContext =
    body.zoneContext ||
    (typeof q.zoneContext === "string" ? safeJsonParse(q.zoneContext) : null) ||
    null;

  const intent =
    body.intent ||
    (typeof q.intent === "string" ? safeJsonParse(q.intent) : null) ||
    { action: "NEW_ENTRY" };

  return {
    symbol,
    tf,
    asOf: new Date().toISOString(),
    engine5,
    marketMeter,
    zoneContext,
    intent,
  };
}

tradePermissionRouter.get("/trade-permission", (req, res) => {
  try {
    const input = buildInput(req);
    const result = computeTradePermission(input);
    res.json({
      engine: "engine6.tradePermission",
      symbol: input.symbol,
      tf: input.tf,
      asOf: input.asOf,
      ...result,
    });
  } catch (err) {
    console.error("[engine6 GET] error:", err);
    res.status(500).json({ ok: false, error: "ENGINE6_ERROR", detail: String(err?.message || err) });
  }
});

tradePermissionRouter.post("/trade-permission", (req, res) => {
  try {
    const input = buildInput(req);
    const result = computeTradePermission(input);
    res.json({
      engine: "engine6.tradePermission",
      symbol: input.symbol,
      tf: input.tf,
      asOf: input.asOf,
      ...result,
    });
  } catch (err) {
    console.error("[engine6 POST] error:", err);
    res.status(500).json({ ok: false, error: "ENGINE6_ERROR", detail: String(err?.message || err) });
  }
});
