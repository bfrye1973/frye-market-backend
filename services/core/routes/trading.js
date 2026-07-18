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
  runEngine8PaperLifecycleExecution,
  reconcileEngine8PaperLifecycleJournal,
  getEngine8PaperLifecycleRecord,
} from "../logic/trading/runEngine8PaperLifecycleExecution.js";

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
      fs.readFileSync(
        ES_SNAPSHOT_FILE,
        "utf8"
      )
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
      error:
        "ES_STRATEGY_SNAPSHOT_UNREADABLE",
      snapshot: null,
    };
  }
}

function statusCodeForCanonicalResult(out) {
  if (out?.ok === true) {
    return 200;
  }

  if (
    out?.status ===
      "REJECTED_CANONICAL_EXECUTOR_DISABLED" ||
    out?.status ===
      "REJECTED_PAPER_MODE_DISABLED"
  ) {
    return 503;
  }

  return 409;
}

/**
 * GET /api/trading/status
 * Used by dashboard polling.
 */
router.get("/status", async (req, res) => {
  try {
    const out =
      await getTradingStatus();

    return res.json(out);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      rejected: true,
      reason:
        "ENGINE8_STATUS_ERROR",
      message: String(
        err?.message || err
      ),
    });
  }
});

/**
 * GET /api/trading/risk/status
 */
router.get(
  "/risk/status",
  async (req, res) => {
    try {
      const out =
        await getRiskStatus();

      return res.json(out);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        rejected: true,
        reason:
          "ENGINE8_RISK_STATUS_ERROR",
        message: String(
          err?.message || err
        ),
      });
    }
  }
);

/**
 * POST /api/trading/execute
 *
 * Legacy/manual paper TradeTicket endpoint.
 * Body = TradeTicket
 */
router.post(
  "/execute",
  async (req, res) => {
    try {
      const out =
        await executeTradeTicket(
          req.body
        );

      return res
        .status(
          out?.rejected
            ? 409
            : 200
        )
        .json(out);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        rejected: true,
        reason:
          "ENGINE8_ERROR",
        message: String(
          err?.message || err
        ),
      });
    }
  }
);

/**
 * POST /api/trading/paper/execute-canonical
 *
 * Explicit, admin-protected canonical
 * Engine 8 NEW_ENTRY paper execution.
 *
 * This route:
 * - does not rebuild the snapshot
 * - reads the frozen Engine 8 adapter result
 * - calls only the controlled NEW_ENTRY gateway
 * - remains blocked unless
 *   ENGINE8_CANONICAL_EXECUTOR_ENABLED=1
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
          reason:
            snapshotRead.error,
          reasonCodes: [
            snapshotRead.error,
            "NO_EXECUTION_ATTEMPTED",
          ],
        });
      }

      const engine8PaperOrder =
        snapshotRead.snapshot
          ?.strategies
          ?.[
            "intraday_scalp@10m"
          ]
          ?.engine8PaperOrder ||
        null;

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

      return res
        .status(
          statusCodeForCanonicalResult(
            out
          )
        )
        .json(out);
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
 * POST /api/trading/paper/execute-lifecycle
 *
 * Explicit, admin-protected canonical
 * Engine 8 REDUCE / EXIT execution.
 *
 * Body example:
 * {
 *   action: "REDUCE" | "EXIT",
 *   lifecycleEventId: "BLOCK_1_EXIT",
 *   tradeId: "TRD-...",
 *   fillQuantity: 1,
 *   fillPrice: 7600.25,
 *   remainingQuantity: 2,
 *   targetId: "T1",
 *   blockId: "BLOCK_1",
 *   managementAction:
 *     "MOVE_STOP_TO_BREAKEVEN",
 *   exitReason: "TARGET_EXIT"
 * }
 */
router.post(
  "/paper/execute-lifecycle",
  requireEngine8Admin,
  async (req, res) => {
    try {
      const out =
        await runEngine8PaperLifecycleExecution({
          ...req.body,
          source:
            "CANONICAL_PAPER_LIFECYCLE_ROUTE",
        });

      return res
        .status(
          statusCodeForCanonicalResult(
            out
          )
        )
        .json(out);
    } catch (err) {
      console.error(
        "[engine8 lifecycle route] failed:",
        err?.stack || err
      );

      return res.status(500).json({
        ok: false,
        rejected: true,
        reason:
          "ENGINE8_LIFECYCLE_EXECUTION_ERROR",
        reasonCodes: [
          "ENGINE8_LIFECYCLE_EXECUTION_ERROR",
        ],
        message: String(
          err?.message || err
        ),
      });
    }
  }
);

/**
 * POST /api/trading/paper/reconcile-lifecycle
 *
 * Retries only Engine 10 journal
 * synchronization for a previously persisted
 * lifecycle fill.
 *
 * This route never resubmits the paper order.
 *
 * Body:
 * {
 *   tradeId: "TRD-...",
 *   action: "REDUCE" | "EXIT",
 *   lifecycleEventId: "..."
 * }
 */
router.post(
  "/paper/reconcile-lifecycle",
  requireEngine8Admin,
  async (req, res) => {
    try {
      const out =
        await reconcileEngine8PaperLifecycleJournal({
          ...req.body,
          source:
            "CANONICAL_PAPER_LIFECYCLE_ROUTE",
        });

      return res
        .status(
          statusCodeForCanonicalResult(
            out
          )
        )
        .json(out);
    } catch (err) {
      console.error(
        "[engine8 lifecycle reconciliation route] failed:",
        err?.stack || err
      );

      return res.status(500).json({
        ok: false,
        rejected: true,
        reason:
          "ENGINE8_LIFECYCLE_RECONCILIATION_ERROR",
        reasonCodes: [
          "ENGINE8_LIFECYCLE_RECONCILIATION_ERROR",
        ],
        message: String(
          err?.message || err
        ),
      });
    }
  }
);

/**
 * GET /api/trading/paper/lifecycle-record
 *
 * Read-only lookup for a persisted
 * Engine 8 management event.
 *
 * Query:
 * ?tradeId=TRD-...
 * &action=REDUCE
 * &lifecycleEventId=BLOCK_1_EXIT
 */
router.get(
  "/paper/lifecycle-record",
  requireEngine8Admin,
  async (req, res) => {
    try {
      const tradeId =
        String(
          req.query?.tradeId || ""
        ).trim();

      const action =
        String(
          req.query?.action || ""
        )
          .trim()
          .toUpperCase();

      const lifecycleEventId =
        String(
          req.query
            ?.lifecycleEventId || ""
        ).trim();

      if (
        !tradeId ||
        !action ||
        !lifecycleEventId
      ) {
        return res.status(400).json({
          ok: false,
          rejected: true,
          reason:
            "TRADE_ID_ACTION_AND_LIFECYCLE_EVENT_ID_REQUIRED",
        });
      }

      const record =
        getEngine8PaperLifecycleRecord({
          tradeId,
          action,
          lifecycleEventId,
        });

      if (!record) {
        return res.status(404).json({
          ok: false,
          rejected: true,
          reason:
            "ENGINE8_LIFECYCLE_RECORD_NOT_FOUND",
          tradeId,
          action,
          lifecycleEventId,
        });
      }

      return res.json({
        ok: true,
        tradeId,
        action,
        lifecycleEventId,
        record,
      });
    } catch (err) {
      console.error(
        "[engine8 lifecycle record route] failed:",
        err?.stack || err
      );

      return res.status(500).json({
        ok: false,
        rejected: true,
        reason:
          "ENGINE8_LIFECYCLE_RECORD_READ_ERROR",
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
router.get(
  "/executions",
  async (req, res) => {
    try {
      const out =
        await listPaperExecutions();

      return res.json(out);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        rejected: true,
        reason:
          "ENGINE8_EXECUTIONS_READ_ERROR",
        message: String(
          err?.message || err
        ),
      });
    }
  }
);

/**
 * GET /api/trading/orders
 */
router.get(
  "/orders",
  async (req, res) => {
    try {
      const out =
        await listPaperOrders();

      return res.json(out);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        rejected: true,
        reason:
          "ENGINE8_ORDERS_READ_ERROR",
        message: String(
          err?.message || err
        ),
      });
    }
  }
);

/**
 * POST /api/trading/cancel
 * Body: { orderId }
 */
router.post(
  "/cancel",
  async (req, res) => {
    try {
      const out =
        await cancelPaperOrder(
          req.body
        );

      return res
        .status(
          out?.rejected
            ? 409
            : 200
        )
        .json(out);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        rejected: true,
        reason:
          "ENGINE8_CANCEL_ERROR",
        message: String(
          err?.message || err
        ),
      });
    }
  }
);

export default router;
