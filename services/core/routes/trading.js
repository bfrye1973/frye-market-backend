import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  getTradingStatus,
  executeTradeTicket,
  retryPaperJournalDelivery,
  inspectPaperInstructionRecovery,
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

import {
  getManualPaperAccounts, initializeManualPaperAccounts,
  readManualPaperAccount,
} from "../logic/trading/manualPaperAccountStore.js";

import {
  executeManualPaperInstruction,retryManualPaperJournalOnly,
  getManualPaperAccountsOverview,
} from "../logic/trading/manualPaperOrderExecution.js";

import {
  issueManualPaperPairing,redeemManualPaperPairing,requireManualPaperSession,
} from "../logic/trading/manualPaperAccessSession.js";

function requireManualPaperOperator(req,res,next) {
  if(req.headers["x-engine8-admin-secret"])return requireEngine8Admin(req,res,next);
  return requireManualPaperSession(req,res,next);
}

const router = express.Router();

router.post("/manual-paper/access/pairing",requireEngine8Admin,async(req,res)=>{
  try{return res.json(await issueManualPaperPairing());}
  catch{return res.status(503).json({ok:false,reason:"MANUAL_PAPER_PAIRING_UNAVAILABLE"});}
});
router.post("/manual-paper/access/redeem",async(req,res)=>{
  try{
    const result=await redeemManualPaperPairing({
      pairingCode:req.body?.pairingCode,origin:req.headers.origin
    });
    return res.status(result.ok?200:401).json(result);
  }catch{return res.status(503).json({ok:false,reason:"MANUAL_PAPER_REDEMPTION_UNAVAILABLE"});}
});
router.get("/manual-paper/access/status",requireManualPaperSession,(req,res)=>{
  return res.json({ok:true,authenticated:true,scope:"MANUAL_PAPER_ONLY"});
});


/**
 * Engine 8D — server-side admin-only MANUAL PAPER execution.
 * No strategy automation, no browser secret, no REAL broker gateway.
 */
router.get("/manual-paper/overview",requireManualPaperOperator,(req,res)=>{
  try {return res.json(getManualPaperAccountsOverview());}
  catch {return res.status(503).json({ok:false,reason:"MANUAL_PAPER_OVERVIEW_BLOCKED"});}
});
router.post("/manual-paper/execute",requireManualPaperOperator,async(req,res)=>{
  try {
    const result=await executeManualPaperInstruction(req.body);
    return res.status(result.ok?200:409).json(result);
  }catch(err) {
    return res.status(503).json({ok:false,rejected:true,
      reason:"MANUAL_PAPER_EXECUTION_BLOCKED",errorCode:String(err?.code||"STORAGE_OR_JOURNAL_FAILURE")});
  }
});
router.post("/manual-paper/retry-journal",requireManualPaperOperator,async(req,res)=>{
  try {
    const result=await retryManualPaperJournalOnly({idempotencyKey:req.body?.idempotencyKey});
    return res.status(result.ok?200:409).json(result);
  }catch{return res.status(503).json({ok:false,rejected:true,reason:"MANUAL_PAPER_RETRY_BLOCKED"});}
});


/**
 * Phase 2: secure server-only seven-account initialization. No orders placed.
 * The browser MUST NOT receive the Engine 8 admin secret.
 */
router.get("/manual-paper/accounts", requireManualPaperOperator, (req,res)=>{
  try{return res.json(getManualPaperAccounts());}
  catch{return res.status(503).json({ok:false,reason:"MANUAL_PAPER_STORE_UNAVAILABLE"});}
});
router.get("/manual-paper/accounts/:accountId", requireManualPaperOperator, (req,res)=>{
  try {
    const result=readManualPaperAccount(req.params.accountId);
    return res.status(result.ok?200:404).json(result);
  } catch{return res.status(503).json({ok:false,reason:"MANUAL_PAPER_STORE_UNAVAILABLE"});}
});
router.post("/manual-paper/initialize",requireManualPaperOperator,async(req,res)=>{
  try {
    const result=await initializeManualPaperAccounts();
    return res.status(result.ok?200:409).json(result);
  } catch(err){
    return res.status(503).json({ok:false,reason:"MANUAL_PAPER_INIT_BLOCKED",errorCode:String(err?.code||"INVARIANT_OR_STORAGE_FAILURE")});
  }
});


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
  requireEngine8Admin,
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
 * Read-only admin inspection after an interrupted PAPER instruction.
 * Does not clear locks, modify Journal, create fills, or contact Schwab.
 */
router.get("/paper/recovery-status", requireEngine8Admin, (req, res) => {
  try {
    return res.json(inspectPaperInstructionRecovery({
      idempotencyKey: req.query?.idempotencyKey,
    }));
  } catch {
    return res.status(503).json({ok:false,reason:"PAPER_RECOVERY_READ_FAILED"});
  }
});

/**
 * Admin-only, Journal-only recovery of an EXISTING simulated PAPER fill.
 * Never calls executeTradeTicket or any broker.
 */
router.post("/paper/retry-journal", requireEngine8Admin, async (req, res) => {
  try {
    const out = await retryPaperJournalDelivery({ idempotencyKey: req.body?.idempotencyKey });
    return res.status(out?.ok ? 200 : 409).json(out);
  } catch (error) {
    return res.status(503).json({ ok: false, rejected: true, reason: "ENGINE8_JOURNAL_RETRY_UNAVAILABLE" });
  }
});

/**
 * POST /api/trading/cancel
 * Body: { orderId }
 */
router.post(
  "/cancel",
  requireEngine8Admin,
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
