// services/core/routes/tradePermission.js
// Engine 6 — Trade Permission API
//
// ✅ Supports:
//   GET     /api/v1/trade-permission (sanity / simple testing)
//   POST    /api/v1/trade-permission (preferred; avoids giant querystrings)
//   OPTIONS /api/v1/trade-permission (explicit preflight)
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

/**
 * ✅ Deterministic CORS (route-level belt + suspenders)
 * - Echo request Origin when present
 * - If no Origin (curl/direct), default to dashboard origin
 */
function applyCors(req, res) {
  const origin = req.headers.origin;
  const allowOrigin = origin || "https://frye-dashboard.onrender.com";

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-Idempotency-Key"
  );
  // Do NOT set Allow-Credentials unless you use credentials: "include"
  // res.setHeader("Access-Control-Allow-Credentials", "true");
}

function buildInput(req) {
  const body = req.body || {};
  const q = req.query || {};

  const symbol = String(body.symbol || q.symbol || "SPY").toUpperCase();
  const tf = String(body.tf || q.tf || "1h");

  const engine5 =
    body.engine5 ||
    (typeof q.engine5 === "string" ? safeJsonParse(q.engine5) : null) || {
      invalid: false,
      total: 0,
      reasonCodes: [],
    };

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
    (typeof q.intent === "string" ? safeJsonParse(q.intent) : null) || {
      action: "NEW_ENTRY",
    };

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

// ✅ Explicit OPTIONS handler (removes any ambiguity for preflight)
tradePermissionRouter.options("/trade-permission", (req, res) => {
  applyCors(req, res);
  return res.sendStatus(204);
});

tradePermissionRouter.get("/trade-permission", (req, res) => {
  applyCors(req, res);

  try {
    const input = buildInput(req);
    const result = computeTradePermission(input);

    return res.json({
      ok: true,
      engine: "engine6.tradePermission",
      symbol: input.symbol,
      tf: input.tf,
      asOf: input.asOf,
      ...result,
    });
  } catch (err) {
    console.error("[engine6 GET] error:", err);
    applyCors(req, res);
    return res.status(500).json({
      ok: false,
      error: "ENGINE6_ERROR",
      detail: String(err?.message || err),
    });
  }
});

tradePermissionRouter.post("/trade-permission", (req, res) => {
  applyCors(req, res);

  try {
    const input = buildInput(req);
    const result = computeTradePermission(input);

    return res.json({
      ok: true,
      engine: "engine6.tradePermission",
      symbol: input.symbol,
      tf: input.tf,
      asOf: input.asOf,
      ...result,
    });
  } catch (err) {
    console.error("[engine6 POST] error:", err);
    applyCors(req, res);
    return res.status(500).json({
      ok: false,
      error: "ENGINE6_ERROR",
      detail: String(err?.message || err),
    });
  }
});
