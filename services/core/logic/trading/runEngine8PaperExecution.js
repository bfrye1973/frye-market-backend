// services/core/logic/trading/runEngine8PaperExecution.js
//
// The only approved gateway for canonical Engine 8 paper execution.
//
// Snapshot construction must never import or call this file.
//
// Responsibilities:
// - enforce controlled execution environment
// - reject replay or live execution
// - consume only a frozen READY Engine 8 adapter result
// - call the canonical Engine 8 paper executor
// - expose execution and Engine 10 Journal outcomes accurately
// - preserve journal-pending truth after an authoritative fill
//
// This gateway does not generate tradeId.
// Engine 10 owns tradeId.
//
// This gateway does not yet activate the final acceptance lock.
// Final acceptance locking belongs to the REDUCE/EXIT lifecycle path after
// Engine 10 acknowledges CLOSED with remainingQty === 0.

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

function nonEmptyString(value) {
  const normalized = text(value);
  return normalized || null;
}

function buildGatewayMetadata({
  source,
  executorEnabled,
  paperOnly,
  replayMode,
  liveExecutionAllowed,
}) {
  return {
    engine:
      "engine8.paperExecutionGateway.v2",

    contractVersion:
      "engine8.paperExecutionGateway.v2",

    source:
      source || "UNKNOWN",

    executorEnabled:
      executorEnabled === true,

    paperOnly:
      paperOnly === true,

    replayMode:
      replayMode === true,

    liveExecutionAllowed:
      liveExecutionAllowed === true,

    evaluatedAt:
      nowIso(),
  };
}

function reject({
  status,
  blocker,
  reasonCode,
  engine8PaperOrder = null,
  source = "UNKNOWN",
}) {
  return {
    active: true,

    engine:
      "engine8.paperExecutionGateway.v2",

    contractVersion:
      "engine8.paperExecutionGateway.v2",

    mode:
      "CONTROLLED_PAPER_EXECUTION_GATEWAY",

    status,

    ok:
      false,

    rejected:
      true,

    executable:
      false,

    blocker:
      blocker || null,

    reasonCodes:
      reasonCode
        ? [reasonCode]
        : [],

    planId:
      engine8PaperOrder?.planId ??
      null,

    candidateId:
      engine8PaperOrder?.candidateId ??
      null,

    zoneId:
      engine8PaperOrder?.zoneId ??
      null,

    strategyId:
      engine8PaperOrder?.strategyId ??
      null,

    symbol:
      engine8PaperOrder?.symbol ??
      null,

    direction:
      engine8PaperOrder?.direction ??
      null,

    setupType:
      engine8PaperOrder?.setupType ??
      null,

    snapshotTime:
      engine8PaperOrder?.snapshotTime ??
      null,

    executionId:
      null,

    idempotencyKey:
      null,

    orderId:
      null,

    tradeId:
      null,

    orderCreated:
      false,

    fillCreated:
      false,

    journalCompleted:
      false,

    journalPending:
      false,

    acceptanceTradeCompleted:
      false,

    acceptanceLockActivated:
      false,

    newPaperOrdersAllowed:
      null,

    noBrokerOrder:
      true,

    noSchwabCall:
      true,

    gateway:
      buildGatewayMetadata({
        source,
        executorEnabled:
          process.env
            .ENGINE8_CANONICAL_EXECUTOR_ENABLED ===
          "1",

        paperOnly:
          process.env
            .ENGINE8_PAPER_ONLY ===
          "1",

        replayMode:
          process.env.REPLAY_MODE ===
            "1" ||
          process.env
            .ENGINE12_REPLAY_MODE ===
            "1",

        liveExecutionAllowed:
          process.env
            .ENGINE8_LIVE_TRADING_ENABLED ===
            "1" ||
          process.env
            .ENGINE8_ALLOW_LIVE_FUTURES ===
            "1",
      }),

    evaluatedAt:
      nowIso(),
  };
}

function resolveJournalAcknowledgement(
  execution
) {
  const journal =
    execution?.journal ||
    execution?.executionResult?.journal ||
    null;

  const tradeId =
    nonEmptyString(
      execution?.tradeId ||
      journal?.tradeId ||
      execution
        ?.executionResult
        ?.tradeId
    );

  const status =
    upper(
      journal?.status ||
      journal?.trade?.status ||
      execution
        ?.executionResult
        ?.journal
        ?.status
    ) || null;

  const remainingQtyRaw =
    journal?.remainingQty ??
    journal?.trade?.qty?.remainingQty ??
    execution
      ?.executionResult
      ?.journal
      ?.remainingQty ??
    null;

  const parsedRemainingQty =
    remainingQtyRaw === null ||
    remainingQtyRaw === undefined ||
    remainingQtyRaw === ""
      ? null
      : Number(remainingQtyRaw);

  const remainingQty =
    Number.isFinite(parsedRemainingQty)
      ? parsedRemainingQty
      : null;

  const journalCompleted =
    execution?.journalCompleted ===
      true ||
    (
      journal?.ok === true &&
      Boolean(tradeId)
    );

  const journalPending =
    execution?.fillCreated === true &&
    journalCompleted !== true;

  const closedAcknowledged =
    journal?.ok === true &&
    status === "CLOSED" &&
    remainingQty === 0 &&
    Boolean(tradeId);

  return {
    journal,
    tradeId,
    status,
    remainingQty,
    journalCompleted,
    journalPending,
    closedAcknowledged,
  };
}

function resolveGatewayStatus({
  execution,
  journalState,
}) {
  const executionStatus =
    upper(execution?.status);

  if (
    execution?.fillCreated === true &&
    journalState.journalCompleted ===
      true
  ) {
    return executionStatus ||
      "PAPER_ORDER_FILLED_JOURNALED";
  }

  if (
    execution?.fillCreated === true &&
    journalState.journalPending ===
      true
  ) {
    return "PAPER_ORDER_FILLED_JOURNAL_PENDING";
  }

  if (
    execution?.duplicateBlocked ===
      true ||
    executionStatus ===
      "DUPLICATE_ORDER_RETURNED" ||
    executionStatus ===
      "DUPLICATE_ORDER_BLOCKED"
  ) {
    return executionStatus ||
      "DUPLICATE_ORDER_BLOCKED";
  }

  return executionStatus ||
    "PAPER_EXECUTION_RESULT_UNKNOWN";
}

export async function runEngine8PaperExecution({
  engine8PaperOrder,
  source = "UNKNOWN",
} = {}) {
  const normalizedSource =
    upper(source);

  if (!engine8PaperOrder) {
    return reject({
      status:
        "REJECTED_MISSING_ENGINE8_ADAPTER",

      blocker:
        "ENGINE8_ADAPTER_MISSING",

      reasonCode:
        "NO_EXECUTION_ATTEMPTED",

      source:
        normalizedSource,
    });
  }

  if (
    process.env
      .ENGINE8_CANONICAL_EXECUTOR_ENABLED !==
    "1"
  ) {
    return reject({
      status:
        "REJECTED_CANONICAL_EXECUTOR_DISABLED",

      blocker:
        "ENGINE8_CANONICAL_EXECUTOR_ENABLED_NOT_SET",

      reasonCode:
        "NO_EXECUTION_ATTEMPTED",

      engine8PaperOrder,

      source:
        normalizedSource,
    });
  }

  if (
    process.env
      .ENGINE8_PAPER_ONLY !==
    "1"
  ) {
    return reject({
      status:
        "REJECTED_PAPER_MODE_DISABLED",

      blocker:
        "ENGINE8_PAPER_ONLY_NOT_SET",

      reasonCode:
        "NO_EXECUTION_ATTEMPTED",

      engine8PaperOrder,

      source:
        normalizedSource,
    });
  }

  if (
    process.env
      .ENGINE8_KILL_SWITCH ===
    "1"
  ) {
    return reject({
      status:
        "REJECTED_KILL_SWITCH_ACTIVE",

      blocker:
        "ENGINE8_KILL_SWITCH",

      reasonCode:
        "NO_EXECUTION_ATTEMPTED",

      engine8PaperOrder,

      source:
        normalizedSource,
    });
  }

  const liveExecutionAllowed =
    process.env
      .ENGINE8_LIVE_TRADING_ENABLED ===
      "1" ||
    process.env
      .ENGINE8_ALLOW_LIVE_FUTURES ===
      "1";

  if (liveExecutionAllowed) {
    return reject({
      status:
        "REJECTED_LIVE_EXECUTION_FLAGS_PRESENT",

      blocker:
        "LIVE_EXECUTION_NOT_ALLOWED",

      reasonCode:
        "NO_EXECUTION_ATTEMPTED",

      engine8PaperOrder,

      source:
        normalizedSource,
    });
  }

  const replayMode =
    process.env.REPLAY_MODE ===
      "1" ||
    process.env
      .ENGINE12_REPLAY_MODE ===
      "1";

  if (replayMode) {
    return reject({
      status:
        "REJECTED_REPLAY_MODE_ACTIVE",

      blocker:
        "REPLAY_EXECUTION_FORBIDDEN",

      reasonCode:
        "NO_EXECUTION_ATTEMPTED",

      engine8PaperOrder,

      source:
        normalizedSource,
    });
  }

  if (
    normalizedSource !==
    "CANONICAL_PAPER_EXECUTION_ROUTE"
  ) {
    return reject({
      status:
        "REJECTED_INVALID_EXECUTION_SOURCE",

      blocker:
        "UNAPPROVED_ENGINE8_EXECUTION_CALLER",

      reasonCode:
        "NO_EXECUTION_ATTEMPTED",

      engine8PaperOrder,

      source:
        normalizedSource,
    });
  }

  if (
    upper(
      engine8PaperOrder.status
    ) !==
      "READY_TO_CREATE_PAPER_ORDER" ||
    engine8PaperOrder.executable !==
      true
  ) {
    return reject({
      status:
        "REJECTED_ADAPTER_NOT_READY",

      blocker:
        `ADAPTER_STATUS_${upper(
          engine8PaperOrder.status ||
          "UNKNOWN"
        )}`,

      reasonCode:
        "NO_EXECUTION_ATTEMPTED",

      engine8PaperOrder,

      source:
        normalizedSource,
    });
  }

  let execution;

  try {
    execution =
      await executeEngine8PaperOrder({
        engine8PaperOrder,
      });
  } catch (error) {
    return {
      ...reject({
        status:
          "ENGINE8_EXECUTOR_THROWN",

        blocker:
          "ENGINE8_EXECUTOR_UNHANDLED_ERROR",

        reasonCode:
          "EXECUTION_GATEWAY_CAUGHT_ERROR",

        engine8PaperOrder,

        source:
          normalizedSource,
      }),

      error:
        "ENGINE8_EXECUTION_GATEWAY_FAILED",

      detail:
        String(
          error?.message ||
          error
        ),

      evaluatedAt:
        nowIso(),
    };
  }

  const journalState =
    resolveJournalAcknowledgement(
      execution
    );

  const gatewayStatus =
    resolveGatewayStatus({
      execution,
      journalState,
    });

  const reasonCodes = [
    ...(Array.isArray(
      execution?.reasonCodes
    )
      ? execution.reasonCodes
      : []),
  ];

  if (
    journalState.journalPending ===
    true
  ) {
    if (
      !reasonCodes.includes(
        "ENGINE10_JOURNAL_PENDING"
      )
    ) {
      reasonCodes.push(
        "ENGINE10_JOURNAL_PENDING"
      );
    }

    if (
      !reasonCodes.includes(
        "NEW_EXECUTION_MUST_REMAIN_BLOCKED"
      )
    ) {
      reasonCodes.push(
        "NEW_EXECUTION_MUST_REMAIN_BLOCKED"
      );
    }
  }

  if (
    journalState.closedAcknowledged ===
    true
  ) {
    reasonCodes.push(
      "ENGINE10_CLOSED_ACKNOWLEDGED"
    );
  }

  return {
    ...execution,

    status:
      gatewayStatus,

    tradeId:
      journalState.tradeId,

    journal:
      journalState.journal,

    journalCompleted:
      journalState.journalCompleted,

    journalPending:
      journalState.journalPending,

    journalStatus:
      journalState.status,

    journalRemainingQty:
      journalState.remainingQty,

    finalClosedAcknowledgement:
      journalState.closedAcknowledged,

    // The opening-order gateway must not activate this by itself.
    // A separate REDUCE/EXIT lifecycle gateway will set it after
    // Engine 10 returns CLOSED and remainingQty === 0.
    acceptanceTradeCompleted:
      false,

    acceptanceLockActivated:
      false,

    reasonCodes,

    gateway:
      buildGatewayMetadata({
        source:
          normalizedSource,

        executorEnabled:
          true,

        paperOnly:
          true,

        replayMode:
          false,

        liveExecutionAllowed:
          false,
      }),

    evaluatedAt:
      nowIso(),
  };
}

export default {
  runEngine8PaperExecution,
};
