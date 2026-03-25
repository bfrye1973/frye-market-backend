import express from "express";
import {
  listTrades,
  getTradeById
} from "../logic/journal/tradeJournalStore.js";

const router = express.Router();

/**
 * GET /api/v1/trade-journal
 * Optional query params:
 * - symbol
 * - strategyId
 * - status
 * - accountMode
 */
router.get("/trade-journal", async (req, res) => {
  try {
    const out = await listTrades({
      symbol: req.query.symbol,
      strategyId: req.query.strategyId,
      status: req.query.status,
      accountMode: req.query.accountMode
    });

    res.json(out);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "TRADE_JOURNAL_LIST_FAILED",
      detail: String(err?.message || err)
    });
  }
});

/**
 * GET /api/v1/trade-journal/:tradeId
 */
router.get("/trade-journal/:tradeId", async (req, res) => {
  try {
    const out = await getTradeById(req.params.tradeId);
    res.status(out.ok ? 200 : 404).json(out);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: "TRADE_JOURNAL_GET_FAILED",
      detail: String(err?.message || err)
    });
  }
});

export default router;
