import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  getTradingStatus,
  executeTradeTicket,
  listPaperExecutions,
  listPaperOrders,
  cancelPaperOrder,
  getRiskStatus,
} from "../logic/trading/engine8Paper.js";

import {
  runEngine8PaperExecution,
} from "../logic/trading/runEngine8PaperExecution.js";

import {
  requireEngine8Admin,
} from "../logic/trading/schwab/engine8AdminAuth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ES_SNAPSHOT_FILE = path.resolve(
  __dirname,
  "../data/strategy-snapshot-es.json"
);

const router = express.Router();

function readEsStrategySnapshot() {
  if (!fs.existsSync(ES_SNAPSHOT_FILE)) {
    return {
      ok: false,
      error: "ES_STRATEGY_SNAPSHOT_NOT_FOUND",
      snapshot: null,
    };
  }

  try {
    const snapshot = JSON.parse(
      fs.readFileSync(ES_SNAPSHOT_FILE, "utf8")
    );

    return {
      ok: true,
      error: null,
      snapshot,
    };
  } catch (err) {
    console.error(
      "[trading route] failed to read ES strategy snapshot:",
      err?.stack || err
    );

    return {
      ok: false,
      error: "ES_STRATEGY_SNAPSHOT_UNREADABLE",
      snapshot: null,
    };
  }
}

/**
 * GET /api/trading/status
 * Used by dashboard polling.
 */
router.get("/status", async (req, res) => {
  try {
    const out = await getTradingStatus();
    return res.json(out);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      rejected: true,
      reason: "ENGINE8_STATUS_ERROR",
      message: String(err?.message || err),
    });
  }
});

/**
 * GET /api/trading/risk/status
 */
router.get("/risk/status", async (req, res) => {
  try {
    const out = await getRiskStatus();
    return res.json(out);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      rejected: true,
      reason: "ENGINE8_RISK_STATUS_ERROR",
      message: String(err?.message || err),
    });
  }
});

/**
 * POST /api/trading/execute
 *
 * Legacy/manual paper TradeTicket endpoint.
 * Body = TradeTicket
 */
router.post("/execute", async (req, res) => {
  try {
    const out = await executeTradeTicket(req.body);

    return res
      .status(out?.rejected ? 409 : 200)
      .json(out);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      rejected: true,
      reason: "ENGINE8_ERROR",
      message: String(err?.message || err),
    });
  }
});

/**
 * POST /api/trading/paper/execute-canonical
 *
 * Explicit, admin-protected canonical Engine 8 paper execution.
 *
 * This route:
 * - does not rebuild the snapshot
 * - reads the frozen Engine 8 adapter result
 * - calls only the controlled Engine 8 execution gateway
 * - remains blocked unless ENGINE8_CANONICAL_EXECUTOR_ENABLED=1
 * - never calls Schwab
 */
router.post(
  "/paper/execute-canonical",
  requireEngine8Admin,
  async (req, res) => {
    try {
      const snapshotRead =
        readEsStrategySnapshot();

      if (!snapshotRead.ok) {
        return res.status(503).json({
          ok: false,
          rejected: true,
          reason: snapshotRead.error,
          reasonCodes: [
            snapshotRead.error,
            "NO_EXECUTION_ATTEMPTED",
          ],
        });
      }

      const engine8PaperOrder =
        snapshotRead.snapshot
          ?.strategies
          ?.["intraday_scalp@10m"]
          ?.engine8PaperOrder || null;

      if (!engine8PaperOrder) {
        return res.status(409).json({
          ok: false,
          rejected: true,
          reason:
            "ENGINE8_CANONICAL_ADAPTER_NOT_FOUND",
          reasonCodes: [
            "ENGINE8_CANONICAL_ADAPTER_NOT_FOUND",
            "NO_EXECUTION_ATTEMPTED",
          ],
        });
      }

      const out =
        await runEngine8PaperExecution({
          engine8PaperOrder,
          source:
            "CANONICAL_PAPER_EXECUTION_ROUTE",
        });

      let statusCode = 409;

      if (out?.ok === true) {
        statusCode = 200;
      } else if (
        out?.status ===
        "REJECTED_CANONICAL_EXECUTOR_DISABLED"
      ) {
        statusCode = 503;
      }

      return res.status(statusCode).json(out);
    } catch (err) {
      console.error(
        "[engine8 canonical route] failed:",
        err?.stack || err
      );

      return res.status(500).json({
        ok: false,
        rejected: true,
        reason:
          "ENGINE8_CANONICAL_EXECUTION_ERROR",
        reasonCodes: [
          "ENGINE8_CANONICAL_EXECUTION_ERROR",
        ],
        message: String(
          err?.message || err
        ),
      });
    }
  }
);

/**
 * GET /api/trading/executions
 */
router.get("/executions", async (req, res) => {
  try {
    const out = await listPaperExecutions();
    return res.json(out);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      rejected: true,
      reason:
        "ENGINE8_EXECUTIONS_READ_ERROR",
      message: String(err?.message || err),
    });
  }
});

/**
 * GET /api/trading/orders
 */
router.get("/orders", async (req, res) => {
  try {
    const out = await listPaperOrders();
    return res.json(out);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      rejected: true,
      reason: "ENGINE8_ORDERS_READ_ERROR",
      message: String(err?.message || err),
    });
  }
});

/**
 * POST /api/trading/cancel
 * Body: { orderId }
 */
router.post("/cancel", async (req, res) => {
  try {
    const out = await cancelPaperOrder(req.body);

    return res
      .status(out?.rejected ? 409 : 200)
      .json(out);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      rejected: true,
      reason: "ENGINE8_CANCEL_ERROR",
      message: String(err?.message || err),
    });
  }
});

export default router;
