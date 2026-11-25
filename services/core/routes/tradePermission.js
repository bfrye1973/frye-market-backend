// services/core/routes/tradePermission.js
// Engine 6 — Trade Permission API (v1 + v2 side-by-side)

import express from "express";

// v1 legacy
import { computeTradePermission as computeLegacy } from "../logic/engine6TradePermission.js";

// v2 market mind
import { computeEngine6MarketMindPermission as computeV2 } from "../logic/engine6MarketMindPermission.js";

export const tradePermissionRouter = express.Router();

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ---------------------------
   Build input for v1 legacy
   --------------------------- */
function buildInputV1(req) {
  const body = req.body || {};
  const q = req.query || {};

  const symbol = body.symbol || q.symbol || "SPY";
  const tf = body.tf || q.tf || "1h";

  const strategyType =
    body.strategyType ||
    q.strategyType ||
    "UNKNOWN";

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

  // ✅ NEW: accept marketRegime
  const marketRegime =
    body.marketRegime ||
    (typeof q.marketRegime === "string" ? safeJsonParse(q.marketRegime) : null) ||
    null;

  return {
    symbol,
    tf,
    strategyType,
    asOf: new Date().toISOString(),
    engine5,
    marketMeter,
    marketRegime, // 🔥 IMPORTANT
    zoneContext,
    intent,
  };
}

/* ---------------------------
   Build input for v2 MarketMind
   --------------------------- */
function buildInputV2(req) {
  const body = req.body || {};
  const q = req.query || {};

  const symbol = body.symbol || q.symbol || "SPY";
  const strategyId = body.strategyId || q.strategyId || "minor_swing@1h";

  const market =
    body.market ||
    (typeof q.market === "string" ? safeJsonParse(q.market) : null) || {
      score10m: null,
      score1h: null,
      score4h: null,
      scoreEOD: null,
      scoreMaster: null,
    };

  const setup =
    body.setup ||
    (typeof q.setup === "string" ? safeJsonParse(q.setup) : null) || {
      setupScore: 0,
      label: "D",
      invalid: false,
    };

  return {
    symbol,
    strategyId,
    market,
    setup,
  };
}

/* ---------------------------
   v1 legacy handlers
   --------------------------- */
tradePermissionRouter.get("/trade-permission", (req, res) => {
  try {
    const input = buildInputV1(req);
    const result = computeLegacy(input);

    res.json({
      engine: "engine6.tradePermission.v1",
      symbol: input.symbol,
      tf: input.tf,
      asOf: input.asOf,
      ...result,
    });
  } catch (err) {
    console.error("[engine6 v1 GET] error:", err);
    res.status(500).json({
      ok: false,
      error: "ENGINE6_V1_ERROR",
      detail: String(err?.message || err),
    });
  }
});

tradePermissionRouter.post("/trade-permission", (req, res) => {
  try {
    const input = buildInputV1(req);
    const result = computeLegacy(input);

    res.json({
      engine: "engine6.tradePermission.v1",
      symbol: input.symbol,
      tf: input.tf,
      asOf: input.asOf,
      ...result,
    });
  } catch (err) {
    console.error("[engine6 v1 POST] error:", err);
    res.status(500).json({
      ok: false,
      error: "ENGINE6_V1_ERROR",
      detail: String(err?.message || err),
    });
  }
});

/* ---------------------------
   v2 MarketMind handlers
   --------------------------- */
tradePermissionRouter.get("/trade-permission-v2", (req, res) => {
  try {
    const input = buildInputV2(req);
    const result = computeV2({
      strategyId: input.strategyId,
      market: input.market,
      setup: input.setup,
    });

    res.json({
      engine: "engine6.marketMind.v2",
      symbol: input.symbol,
      strategyId: input.strategyId,
      asOf: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    console.error("[engine6 v2 GET] error:", err);
    res.status(500).json({
      ok: false,
      error: "ENGINE6_V2_ERROR",
      detail: String(err?.message || err),
    });
  }
});

tradePermissionRouter.post("/trade-permission-v2", (req, res) => {
  try {
    const input = buildInputV2(req);
    const result = computeV2({
      strategyId: input.strategyId,
      market: input.market,
      setup: input.setup,
    });

    res.json({
      engine: "engine6.marketMind.v2",
      symbol: input.symbol,
      strategyId: input.strategyId,
      asOf: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    console.error("[engine6 v2 POST] error:", err);
    res.status(500).json({
      ok: false,
      error: "ENGINE6_V2_ERROR",
      detail: String(err?.message || err),
    });
  }
});
