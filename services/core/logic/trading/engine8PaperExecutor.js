// services/core/logic/trading/engine8PaperExecutor.js
//
// Engine 8 canonical paper executor.
//
// Phase 1:
// - consumes only the frozen Engine 8 adapter result
// - validates readiness
// - performs a final duplicate-state check
// - generates executionId, idempotencyKey, and orderId
// - does NOT create an order yet
// - does NOT call Schwab
// - does NOT write to Engine 10

import crypto from "crypto";

import {
  buildCanonicalEngine8IdempotencyKey,
  getEngine8DuplicateState,
} from "./engine8DuplicateState.js";
import {
  executeTradeTicket,
} from "./engine8Paper.js";


function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function makeExecutionId() {
  const timestamp = Date.now();
  const suffix = crypto.randomBytes(4).toString("hex");

  return `E8X-${timestamp}-${suffix}`;
}

function makeOrderId() {
  const timestamp = Date.now();
  const suffix = crypto.randomBytes(4).toString("hex");

  return `E8O-${timestamp}-${suffix}`;
}

function baseResult(engine8PaperOrder) {
  return {
    active: true,
    engine: "engine8.canonicalPaperExecutor.v1",
    contractVersion: "engine8.paperExecution.v1",
    mode: "PAPER_ONLY_CONTROLLED_EXECUTOR",

    status: "NOT_EVALUATED",
    ok: false,
    rejected: false,
    duplicateBlocked: false,
    orderCreated: false,
    fillCreated: false,
    journalCompleted: false,

    executionId: null,
    idempotencyKey: null,
    orderId: null,
    tradeId: null,

    planId: engine8PaperOrder?.planId || null,
    candidateId: engine8PaperOrder?.candidateId || null,
    zoneId: engine8PaperOrder?.zoneId || null,
    strategyId: engine8PaperOrder?.strategyId || null,
    symbol: engine8PaperOrder?.symbol || null,
    direction: engine8PaperOrder?.direction || null,
    setupType: engine8PaperOrder?.setupType || null,
    snapshotTime: engine8PaperOrder?.snapshotTime || null,

    finalContracts:
      Number(engine8PaperOrder?.finalContracts) || 0,

    officialEntryPrice:
      engine8PaperOrder?.officialEntryPrice ?? null,

    officialStopPrice:
      engine8PaperOrder?.officialStopPrice ?? null,

    officialTargets:
      Array.isArray(engine8PaperOrder?.officialTargets)
        ? engine8PaperOrder.officialTargets
        : [],

    duplicateState: null,
    blockers: [],
    reasonCodes: [],

    noBrokerOrder: true,
    noSchwabCall: true,

    evaluatedAt: nowIso(),
  };
}

function reject(result, status, blocker, reasonCode) {
  return {
    ...result,
    status,
    ok: false,
    rejected: true,
    blockers: blocker
      ? [...result.blockers, blocker]
      : result.blockers,
    reasonCodes: reasonCode
      ? [...result.reasonCodes, reasonCode]
      : result.reasonCodes,
    evaluatedAt: nowIso(),
  };
}

export async function prepareEngine8PaperExecution({
  engine8PaperOrder,
} = {}) {
  const result = baseResult(engine8PaperOrder);

  if (!engine8PaperOrder) {
    return reject(
      result,
      "REJECTED_MISSING_ENGINE8_ADAPTER",
      "ENGINE8_ADAPTER_MISSING",
      "NO_EXECUTION_PREPARED"
    );
  }

  if (
    upper(engine8PaperOrder.status) !==
    "READY_TO_CREATE_PAPER_ORDER"
  ) {
    return reject(
      result,
      "REJECTED_ADAPTER_NOT_READY",
      `ADAPTER_STATUS_${upper(
        engine8PaperOrder.status || "UNKNOWN"
      )}`,
      "NO_EXECUTION_PREPARED"
    );
  }

  if (engine8PaperOrder.executable !== true) {
    return reject(
      result,
      "REJECTED_ADAPTER_NOT_EXECUTABLE",
      "ENGINE8_ADAPTER_EXECUTABLE_FALSE",
      "NO_EXECUTION_PREPARED"
    );
  }

  if (engine8PaperOrder.paperOnly !== true) {
    return reject(
      result,
      "REJECTED_NOT_PAPER_ONLY",
      "PAPER_ONLY_REQUIRED",
      "NO_EXECUTION_PREPARED"
    );
  }

  if (
    engine8PaperOrder.realExecutionAllowed === true ||
    engine8PaperOrder.brokerExecutionAllowed === true ||
    engine8PaperOrder.schwabExecutionAllowed === true
  ) {
    return reject(
      result,
      "REJECTED_LIVE_EXECUTION_FLAGS_PRESENT",
      "LIVE_EXECUTION_NOT_ALLOWED",
      "NO_EXECUTION_PREPARED"
    );
  }

  const strategyId = text(
    engine8PaperOrder.strategyId
  );

  const candidateId = text(
    engine8PaperOrder.candidateId
  );

  const planId = text(
    engine8PaperOrder.planId
  );

  if (!strategyId || !candidateId || !planId) {
    return reject(
      result,
      "REJECTED_MISSING_CANONICAL_IDENTITY",
      "STRATEGY_CANDIDATE_PLAN_REQUIRED",
      "NO_EXECUTION_PREPARED"
    );
  }

  const idempotencyKey =
    buildCanonicalEngine8IdempotencyKey({
      strategyId,
      candidateId,
      planId,
      intent: "ENTRY",
    });

  if (!idempotencyKey) {
    return reject(
      result,
      "REJECTED_IDEMPOTENCY_KEY_FAILURE",
      "IDEMPOTENCY_KEY_NOT_CREATED",
      "NO_EXECUTION_PREPARED"
    );
  }

  const duplicateState =
    getEngine8DuplicateState({
      strategyId,
      candidateId,
      planId,
      idempotencyKey,
    });

  result.duplicateState = duplicateState;

  const duplicateBlocked =
    duplicateState.candidateAlreadyOrdered === true ||
    duplicateState.idempotencyKeyAlreadyUsed === true ||
    duplicateState.openTradeForStrategy === true ||
    duplicateState.activeTradeIdExists === true ||
    duplicateState.orderExistsForPlanId === true ||
    duplicateState.acceptanceTradeCompleted === true ||
    duplicateState.newPaperOrdersAllowed === false;

  if (duplicateBlocked) {
    return {
      ...reject(
        result,
        "DUPLICATE_ORDER_BLOCKED",
        "FINAL_DUPLICATE_CHECK_FAILED",
        "NO_EXECUTION_PREPARED"
      ),
      duplicateBlocked: true,
      idempotencyKey,
    };
  }

  const executionId = makeExecutionId();
  const orderId = makeOrderId();

  return {
    ...result,

    status: "READY_FOR_PAPER_EXECUTION_CALL",
    ok: true,
    rejected: false,
    duplicateBlocked: false,

    executionId,
    idempotencyKey,
    orderId,
    tradeId: null,

    orderCreated: false,
    fillCreated: false,
    journalCompleted: false,

    reasonCodes: [
      "ADAPTER_READY",
      "FINAL_DUPLICATE_CHECK_CLEAR",
      "CANONICAL_IDS_CREATED",
      "EXECUTION_CALL_NOT_YET_ENABLED",
    ],

    preparedAt: nowIso(),
    evaluatedAt: nowIso(),
  };
}

function buildCanonicalPaperTicket({
  engine8PaperOrder,
  preparedExecution,
}) {
  const direction = upper(
    engine8PaperOrder?.direction
  );

  const side =
    direction === "LONG"
      ? "BUY"
      : direction === "SHORT"
        ? "SELL_SHORT"
        : null;

  const targets =
    Array.isArray(
      engine8PaperOrder?.officialTargets
    )
      ? engine8PaperOrder.officialTargets
      : [];

  const firstTarget =
    targets.find(
      (target) =>
        Number.isFinite(
          Number(target?.price)
        )
    ) || null;

  return {
    executionId:
      preparedExecution.executionId,

    orderId:
      preparedExecution.orderId,

    idempotencyKey:
      preparedExecution.idempotencyKey,

    paper: true,
    symbol: engine8PaperOrder.symbol,
    strategyId:
      engine8PaperOrder.strategyId,

    timeframe:
      String(
        engine8PaperOrder.strategyId || ""
      ).split("@")[1] || "",

    assetType: "FUTURES",
    action: "NEW_ENTRY",
    intent: "ENTRY",
    direction,
    side,

    qty:
      Number(
        engine8PaperOrder.finalContracts
      ),

    orderType: "LIMIT",
    timeInForce: "DAY",

    entry: {
      price:
        Number(
          engine8PaperOrder
            .officialEntryPrice
        ),
    },

    stop: {
      price:
        Number(
          engine8PaperOrder
            .officialStopPrice
        ),
    },

    takeProfit: firstTarget
      ? {
          targetId:
            firstTarget.targetId || null,
          price:
            Number(firstTarget.price),
        }
      : null,

    targets,

    blocks:
      Array.isArray(
        engine8PaperOrder
          ?.threeBlockManagement
          ?.blocks
      )
        ? engine8PaperOrder
            .threeBlockManagement.blocks
        : [],

    sourceSignal: {
      engine: "engine8",
      planId:
        engine8PaperOrder.planId,
      candidateId:
        engine8PaperOrder.candidateId,
      zoneId:
        engine8PaperOrder.zoneId,
      setupType:
        engine8PaperOrder.setupType,
      direction,
      snapshotTime:
        engine8PaperOrder.snapshotTime,
    },

    engine6: {
      permission:
        engine8PaperOrder?.engine6
          ?.allowed === true
          ? "ALLOW"
          : "UNKNOWN",
      decision:
        engine8PaperOrder?.engine6
          ?.decision || null,
    },

    engine7: {
      status:
        engine8PaperOrder?.engine7B
          ?.status || null,
      finalContracts:
        Number(
          engine8PaperOrder
            .finalContracts
        ),
    },

    engine9: {
      planId:
        engine8PaperOrder.planId,
      planStatus:
        engine8PaperOrder?.engine9
          ?.planStatus || null,
      managementReady:
        engine8PaperOrder?.engine9
          ?.managementReady === true,
    },
  };
}

export async function executeEngine8PaperOrder({
  engine8PaperOrder,
} = {}) {
  const prepared =
    await prepareEngine8PaperExecution({
      engine8PaperOrder,
    });

  if (
    prepared.status !==
      "READY_FOR_PAPER_EXECUTION_CALL" ||
    prepared.ok !== true
  ) {
    return prepared;
  }

  const ticket =
    buildCanonicalPaperTicket({
      engine8PaperOrder,
      preparedExecution: prepared,
    });

  if (
    !ticket.side ||
    !Number.isInteger(ticket.qty) ||
    ticket.qty <= 0
  ) {
    return reject(
      {
        ...prepared,
        ticket,
      },
      "REJECTED_INVALID_EXECUTION_TICKET",
      "INVALID_SIDE_OR_QTY",
      "NO_ORDER_CREATED"
    );
  }

  const executionResult =
    await executeTradeTicket(ticket);

  const filled =
    executionResult?.ok === true &&
    upper(executionResult?.status) ===
      "FILLED";

  const journalCompleted =
    executionResult?.journal?.ok ===
      true &&
    Boolean(executionResult?.tradeId);

  return {
    ...prepared,

    status: filled
      ? "PAPER_ORDER_FILLED"
      : executionResult?.duplicate === true
        ? "DUPLICATE_ORDER_RETURNED"
        : "PAPER_ORDER_REJECTED",

    ok: executionResult?.ok === true,
    rejected:
      executionResult?.rejected === true,

    orderCreated: filled,
    fillCreated: filled,
    journalCompleted,

    executionId:
      prepared.executionId,

    idempotencyKey:
      prepared.idempotencyKey,

    orderId:
      executionResult?.orderId ||
      prepared.orderId,

    tradeId:
      executionResult?.tradeId || null,

    ticket,
    executionResult,

    noBrokerOrder: true,
    noSchwabCall: true,

    executedAt: nowIso(),
    evaluatedAt: nowIso(),
  };
}

export default {
  prepareEngine8PaperExecution, 
  executeEngine8PaperOrder,
};
