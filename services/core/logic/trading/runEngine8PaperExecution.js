// services/core/logic/trading/runEngine8PaperExecution.js
//
// The only approved gateway for canonical Engine 8 paper execution.
//
// Snapshot construction must never import or call this file.

import {
  executeEngine8PaperOrder,
} from "./engine8PaperExecutor.js";

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function reject({
  status,
  blocker,
  reasonCode,
  engine8PaperOrder = null,
}) {
  return {
    active: true,
    engine: "engine8.paperExecutionGateway.v1",
    contractVersion: "engine8.paperExecutionGateway.v1",
    mode: "CONTROLLED_PAPER_EXECUTION_GATEWAY",

    status,
    ok: false,
    rejected: true,
    executable: false,

    blocker,
    reasonCodes: reasonCode
      ? [reasonCode]
      : [],

    planId:
      engine8PaperOrder?.planId || null,

    candidateId:
      engine8PaperOrder?.candidateId || null,

    strategyId:
      engine8PaperOrder?.strategyId || null,

    symbol:
      engine8PaperOrder?.symbol || null,

    executionId: null,
    idempotencyKey: null,
    orderId: null,
    tradeId: null,

    orderCreated: false,
    fillCreated: false,
    journalCompleted: false,

    noBrokerOrder: true,
    noSchwabCall: true,

    evaluatedAt: nowIso(),
  };
}

export async function runEngine8PaperExecution({
  engine8PaperOrder,
  source = "UNKNOWN",
} = {}) {
  const normalizedSource = upper(source);

  if (!engine8PaperOrder) {
    return reject({
      status: "REJECTED_MISSING_ENGINE8_ADAPTER",
      blocker: "ENGINE8_ADAPTER_MISSING",
      reasonCode: "NO_EXECUTION_ATTEMPTED",
    });
  }

  if (
    process.env.ENGINE8_CANONICAL_EXECUTOR_ENABLED !==
    "1"
  ) {
    return reject({
      status:
        "REJECTED_CANONICAL_EXECUTOR_DISABLED",
      blocker:
        "ENGINE8_CANONICAL_EXECUTOR_ENABLED_NOT_SET",
      reasonCode: "NO_EXECUTION_ATTEMPTED",
      engine8PaperOrder,
    });
  }

  if (process.env.ENGINE8_PAPER_ONLY !== "1") {
    return reject({
      status: "REJECTED_PAPER_MODE_DISABLED",
      blocker: "ENGINE8_PAPER_ONLY_NOT_SET",
      reasonCode: "NO_EXECUTION_ATTEMPTED",
      engine8PaperOrder,
    });
  }

  if (
    process.env.ENGINE8_KILL_SWITCH === "1"
  ) {
    return reject({
      status: "REJECTED_KILL_SWITCH_ACTIVE",
      blocker: "ENGINE8_KILL_SWITCH",
      reasonCode: "NO_EXECUTION_ATTEMPTED",
      engine8PaperOrder,
    });
  }

  if (
    process.env.ENGINE8_LIVE_TRADING_ENABLED ===
      "1" ||
    process.env.ENGINE8_ALLOW_LIVE_FUTURES === "1"
  ) {
    return reject({
      status:
        "REJECTED_LIVE_EXECUTION_FLAGS_PRESENT",
      blocker: "LIVE_EXECUTION_NOT_ALLOWED",
      reasonCode: "NO_EXECUTION_ATTEMPTED",
      engine8PaperOrder,
    });
  }

  if (
    process.env.REPLAY_MODE === "1" ||
    process.env.ENGINE12_REPLAY_MODE === "1"
  ) {
    return reject({
      status: "REJECTED_REPLAY_MODE_ACTIVE",
      blocker: "REPLAY_EXECUTION_FORBIDDEN",
      reasonCode: "NO_EXECUTION_ATTEMPTED",
      engine8PaperOrder,
    });
  }

  if (
    normalizedSource !==
    "CANONICAL_PAPER_EXECUTION_ROUTE"
  ) {
    return reject({
      status: "REJECTED_INVALID_EXECUTION_SOURCE",
      blocker:
        "UNAPPROVED_ENGINE8_EXECUTION_CALLER",
      reasonCode: "NO_EXECUTION_ATTEMPTED",
      engine8PaperOrder,
    });
  }

  if (
    upper(engine8PaperOrder.status) !==
      "READY_TO_CREATE_PAPER_ORDER" ||
    engine8PaperOrder.executable !== true
  ) {
    return reject({
      status: "REJECTED_ADAPTER_NOT_READY",
      blocker:
        `ADAPTER_STATUS_${upper(
          engine8PaperOrder.status || "UNKNOWN"
        )}`,
      reasonCode: "NO_EXECUTION_ATTEMPTED",
      engine8PaperOrder,
    });
  }

  const execution =
    await executeEngine8PaperOrder({
      engine8PaperOrder,
    });

  return {
    ...execution,
    gateway: {
      engine:
        "engine8.paperExecutionGateway.v1",
      source: normalizedSource,
      executorEnabled: true,
      paperOnly: true,
      replayMode: false,
      liveExecutionAllowed: false,
      evaluatedAt: nowIso(),
    },
  };
}

export default {
  runEngine8PaperExecution,
};
