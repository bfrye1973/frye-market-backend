import express from "express";
import {
  getTradingStatus,
  executeTradeTicket,
  listPaperExecutions,
  listPaperOrders,
  cancelPaperOrder,
  getRiskStatus
} from "../logic/trading/engine8Paper.js";

const router = express.Router();

/**
 * GET /api/trading/status
 * Used by dashboard polling
 */
router.get("/status", async (req, res) => {
  const out = await getTradingStatus();
  res.json(out);
});

/**
 * GET /api/trading/risk/status
 */
router.get("/risk/status", async (req, res) => {
  const out = await getRiskStatus();
  res.json(out);
});

/**
 * POST /api/trading/execute
 * Body = TradeTicket
 */
router.post("/execute", async (req, res) => {
  try {
    const out = await executeTradeTicket(req.body);
    // 409 when rejected/duplicate is convenient for the UI to treat as “not executed”
    res.status(out.rejected ? 409 : 200).json(out);
  } catch (err) {
    res.status(500).json({
      ok: false,
      rejected: true,
      reason: "ENGINE8_ERROR",
      message: String(err?.message || err)
    });
  }
});

/**
 * GET /api/trading/executions
 */
router.get("/executions", async (req, res) => {
  const out = await listPaperExecutions();
  res.json(out);
});

/**
 * GET /api/trading/orders
 */
router.get("/orders", async (req, res) => {
  const out = await listPaperOrders();
  res.json(out);
});

/**
 * POST /api/trading/cancel
 * { orderId }
 */
router.post("/cancel", async (req, res) => {
  const out = await cancelPaperOrder(req.body);
  res.json(out);
});

export default router;
