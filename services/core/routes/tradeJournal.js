import express from "express";
import {
  listTrades,
  getTradeById,
  ingestRealBrokerFill
} from "../logic/journal/tradeJournalStore.js";

const router = express.Router();

function requireEngine8Admin(req, res, next) {
  const expected = String(
    process.env.ENGINE8_ADMIN_SECRET || ""
  ).trim();

  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: "ENGINE8_ADMIN_SECRET_NOT_CONFIGURED"
    });
  }

  const received = String(
    req.get("X-Engine8-Admin-Secret") || ""
  ).trim();

  if (!received || received !== expected) {
    return res.status(401).json({
      ok: false,
      error: "ENGINE8_ADMIN_AUTH_FAILED"
    });
  }

  next();
}

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
 * POST /api/v1/trade-journal/real-fill
 *
 * Protected Engine 8 -> Engine 10 boundary for one normalized
 * READ-ONLY Schwab REAL broker fill.
 *
 * This route has no Schwab client and no broker-write authority.
 */
router.post(
  "/trade-journal/real-fill",
  requireEngine8Admin,
  async (req, res) => {
    try {
      const out = await ingestRealBrokerFill(
        req.body || {}
      );

      if (out.ok) {
        return res.status(200).json(out);
      }

      const clientErrors = new Set([
        "INVALID_REAL_BROKER_FILL",
        "AMBIGUOUS_REAL_CAMPAIGN_MATCH",
        "REAL_FILL_OUT_OF_ORDER",
        "REAL_FILL_OUT_OF_ORDER_AFTER_CLOSED_CAMPAIGN",
        "REAL_OPEN_CAMPAIGN_NOT_FOUND",
        "REAL_EXIT_QUANTITY_EXCEEDS_REMAINING_QUANTITY",
        "REAL_FIFO_LOTS_INSUFFICIENT"
      ]);

      return res
        .status(clientErrors.has(out.error) ? 409 : 400)
        .json(out);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "REAL_TRADE_JOURNAL_INGEST_FAILED",
        detail: String(err?.message || err)
      });
    }
  }
);

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
