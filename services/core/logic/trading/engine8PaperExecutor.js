// services/core/logic/trading/engine8PaperExecutor.js
//
// Engine 8 canonical paper executor.
//
// Responsibilities:
// - consume only the frozen Engine 8 adapter result
// - validate execution readiness
// - perform the final duplicate-state check
// - generate Engine 8-owned execution identity
// - build the canonical Engine 8 paper ticket
// - execute only through executeTradeTicket()
// - receive Engine 10-owned tradeId
// - accurately report journal-complete versus journal-pending
//
// Ownership:
// Engine 8 owns:
// - executionId
// - idempotencyKey
// - orderId
// - paper-order and fill lifecycle
//
// Engine 10 owns:
// - tradeId
// - durable Journal lifecycle
// - final CLOSED acknowledgement
//
// Snapshot construction remains read-only.

import crypto from "crypto";

import {
  buildCanonicalEngine8IdempotencyKey,
  getEngine8DuplicateState,
  recordEngine8ExecutionLink,
  markEngine8JournalPending,
  markEngine8JournalResolved,
} from "./engine8DuplicateState.js";
import {
  executeTradeTicket,
} from "./engine8Paper.js";

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  if (value === null || value === undefined) {
    return value;
  }

  return JSON.parse(JSON.stringify(value));
}

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function integerOrZero(value) {
  const parsed = Number(value);

  return Number.isInteger(parsed)
    ? parsed
    : 0;
}

function makeExecutionId() {
  const timestamp = Date.now();
  const suffix = crypto
    .randomBytes(4)
    .toString("hex");

  return `E8X-${timestamp}-${suffix}`;
}

function makeOrderId() {
  const timestamp = Date.now();
  const suffix = crypto
    .randomBytes(4)
    .toString("hex");

  return `E8O-${timestamp}-${suffix}`;
}

function baseResult(engine8PaperOrder) {
  return {
    active: true,

    engine:
      "engine8.canonicalPaperExecutor.v2",

    contractVersion:
      "engine8.paperExecution.v2",

    mode:
      "PAPER_ONLY_CONTROLLED_EXECUTOR",

    status:
      "NOT_EVALUATED",

    ok:
      false,

    rejected:
      false,

    duplicateBlocked:
      false,

    orderCreated:
      false,

    fillCreated:
      false,

    journalCompleted:
      false,

    journalPending:
      false,

    executionId:
      null,

    idempotencyKey:
      null,

    orderId:
      null,

    tradeId:
      null,

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

    finalContracts:
      integerOrZero(
        engine8PaperOrder?.finalContracts
      ),

    officialEntryPrice:
      numberOrNull(
        engine8PaperOrder
          ?.officialEntryPrice
      ),

    officialStopPrice:
      numberOrNull(
        engine8PaperOrder
          ?.officialStopPrice
      ),

    officialStopDistancePoints:
      numberOrNull(
        engine8PaperOrder
          ?.officialStopDistancePoints
      ),

    officialTargets:
      Array.isArray(
        engine8PaperOrder
          ?.officialTargets
      )
        ? clone(
            engine8PaperOrder
              .officialTargets
          )
        : [],

    duplicateState:
      null,

    blockers:
      [],

    reasonCodes:
      [],

    noBrokerOrder:
      true,

    noSchwabCall:
      true,

    evaluatedAt:
      nowIso(),
  };
}

function reject(
  result,
  status,
  blocker,
  reasonCode
) {
  return {
    ...result,

    status,

    ok:
      false,

    rejected:
      true,

    blockers:
      blocker
        ? [
            ...(result.blockers || []),
            blocker,
          ]
        : result.blockers || [],

    reasonCodes:
      reasonCode
        ? [
            ...(result.reasonCodes || []),
            reasonCode,
          ]
        : result.reasonCodes || [],

    evaluatedAt:
      nowIso(),
  };
}

function resolveEngine9Plan(
  engine8PaperOrder
) {
  const engine9 =
    engine8PaperOrder
      ?.engine9OfficialManagementPlan ||
    engine8PaperOrder
      ?.engine9 ||
    {};

  return {
    planId:
      engine8PaperOrder?.planId ??
      engine9?.planId ??
      null,

    planStatus:
      engine9?.planStatus ??
      engine8PaperOrder
        ?.engine9PlanStatus ??
      null,

    managementReady:
      engine9?.managementReady ===
        true,

    officialEntryPrice:
      numberOrNull(
        engine8PaperOrder
          ?.officialEntryPrice ??
        engine9?.officialEntryPrice
      ),

    officialStopPrice:
      numberOrNull(
        engine8PaperOrder
          ?.officialStopPrice ??
        engine9?.officialStopPrice
      ),

    officialStopDistancePoints:
      numberOrNull(
        engine8PaperOrder
          ?.officialStopDistancePoints ??
        engine9
          ?.officialStopDistancePoints
      ),

    officialTargets:
      Array.isArray(
        engine8PaperOrder
          ?.officialTargets
      )
        ? clone(
            engine8PaperOrder
              .officialTargets
          )
        : Array.isArray(
            engine9?.officialTargets
          )
          ? clone(
              engine9.officialTargets
            )
          : [],

    threeBlockManagement:
      clone(
        engine8PaperOrder
          ?.threeBlockManagement ??
        engine9
          ?.threeBlockManagement ??
        null
      ),

    runnerPlan:
      clone(
        engine8PaperOrder
          ?.runnerPlan ??
        engine9?.runnerPlan ??
        null
      ),
  };
}

function resolveEngine7Sizing(
  engine8PaperOrder
) {
  const engine7 =
    engine8PaperOrder
      ?.engine7PositionSizing ||
    engine8PaperOrder
      ?.engine7B ||
    engine8PaperOrder
      ?.engine7 ||
    {};

  const finalContracts =
    integerOrZero(
      engine8PaperOrder
        ?.finalContracts ??
      engine7?.finalContracts ??
      engine7?.engine7FinalContracts
    );

  const estimatedTotalRiskDollars =
    numberOrNull(
      engine8PaperOrder
        ?.estimatedTotalRiskDollars ??
      engine7
        ?.estimatedTotalRiskDollars
    );

  return {
    planId:
      engine8PaperOrder
        ?.engine7PlanId ??
      engine7?.planId ??
      engine7?.engine7PlanId ??
      null,

    status:
      engine7?.status ??
      null,

    allowed:
      engine7?.allowed === true,

    executableSizing:
      engine7
        ?.executableSizing === true,

    finalContracts,

    engine7FinalContracts:
      finalContracts,

    riskBudgetDollars:
      numberOrNull(
        engine8PaperOrder
          ?.riskBudgetDollars ??
        engine7
          ?.riskBudgetDollars
      ),

    permissionAdjustedRiskBudget:
      numberOrNull(
        engine8PaperOrder
          ?.permissionAdjustedRiskBudget ??
        engine7
          ?.permissionAdjustedRiskBudget
      ),

    officialStopDistancePoints:
      numberOrNull(
        engine8PaperOrder
          ?.officialStopDistancePoints ??
        engine7
          ?.officialStopDistancePoints
      ),

    dollarsPerPoint:
      numberOrNull(
        engine8PaperOrder
          ?.dollarsPerPoint ??
        engine7
          ?.dollarsPerPoint
      ),

    rawRiskPerContract:
      numberOrNull(
        engine8PaperOrder
          ?.rawRiskPerContract ??
        engine7
          ?.rawRiskPerContract
      ),

    estimatedSlippageRiskPerContract:
      numberOrNull(
        engine8PaperOrder
          ?.estimatedSlippageRiskPerContract ??
        engine7
          ?.estimatedSlippageRiskPerContract
      ),

    commissionDollarsPerContractRoundTrip:
      numberOrNull(
        engine8PaperOrder
          ?.commissionDollarsPerContractRoundTrip ??
        engine7
          ?.commissionDollarsPerContractRoundTrip
      ),

    effectiveRiskPerContract:
      numberOrNull(
        engine8PaperOrder
          ?.effectiveRiskPerContract ??
        engine7
          ?.effectiveRiskPerContract
      ),

    estimatedTotalRiskDollars,

    frozenOpeningRiskDollars:
      estimatedTotalRiskDollars,
  };
}

export async function prepareEngine8PaperExecution({
  engine8PaperOrder,
} = {}) {
  const result =
    baseResult(
      engine8PaperOrder
    );

  if (!engine8PaperOrder) {
    return reject(
      result,
      "REJECTED_MISSING_ENGINE8_ADAPTER",
      "ENGINE8_ADAPTER_MISSING",
      "NO_EXECUTION_PREPARED"
    );
  }

  if (
    upper(
      engine8PaperOrder.status
    ) !==
    "READY_TO_CREATE_PAPER_ORDER"
  ) {
    return reject(
      result,
      "REJECTED_ADAPTER_NOT_READY",
      `ADAPTER_STATUS_${upper(
        engine8PaperOrder.status ||
        "UNKNOWN"
      )}`,
      "NO_EXECUTION_PREPARED"
    );
  }

  if (
    engine8PaperOrder.executable !==
    true
  ) {
    return reject(
      result,
      "REJECTED_ADAPTER_NOT_EXECUTABLE",
      "ENGINE8_ADAPTER_EXECUTABLE_FALSE",
      "NO_EXECUTION_PREPARED"
    );
  }

  if (
    engine8PaperOrder.paperOnly !==
    true
  ) {
    return reject(
      result,
      "REJECTED_NOT_PAPER_ONLY",
      "PAPER_ONLY_REQUIRED",
      "NO_EXECUTION_PREPARED"
    );
  }

  if (
    engine8PaperOrder
      .realExecutionAllowed === true ||
    engine8PaperOrder
      .brokerExecutionAllowed === true ||
    engine8PaperOrder
      .schwabExecutionAllowed === true
  ) {
    return reject(
      result,
      "REJECTED_LIVE_EXECUTION_FLAGS_PRESENT",
      "LIVE_EXECUTION_NOT_ALLOWED",
      "NO_EXECUTION_PREPARED"
    );
  }

  const strategyId =
    text(
      engine8PaperOrder
        .strategyId
    );

  const candidateId =
    text(
      engine8PaperOrder
        .candidateId
    );

  const planId =
    text(
      engine8PaperOrder
        .planId
    );

  const zoneId =
    text(
      engine8PaperOrder
        .zoneId
    );

  const symbol =
    upper(
      engine8PaperOrder
        .symbol
    );

  const direction =
    upper(
      engine8PaperOrder
        .direction
    );

  const setupType =
    text(
      engine8PaperOrder
        .setupType
    );

  const snapshotTime =
    text(
      engine8PaperOrder
        .snapshotTime
    );

  if (
    !strategyId ||
    !candidateId ||
    !planId ||
    !zoneId ||
    !symbol ||
    !direction ||
    !setupType ||
    !snapshotTime
  ) {
    return reject(
      result,
      "REJECTED_MISSING_CANONICAL_IDENTITY",
      "FULL_CANONICAL_IDENTITY_REQUIRED",
      "NO_EXECUTION_PREPARED"
    );
  }

  if (
    direction !== "LONG" &&
    direction !== "SHORT"
  ) {
    return reject(
      result,
      "REJECTED_INVALID_DIRECTION",
      `INVALID_DIRECTION_${direction || "EMPTY"}`,
      "NO_EXECUTION_PREPARED"
    );
  }

  const finalContracts =
    integerOrZero(
      engine8PaperOrder
        .finalContracts
    );

  if (
    finalContracts <= 0
  ) {
    return reject(
      result,
      "REJECTED_INVALID_FINAL_CONTRACTS",
      "FINAL_CONTRACTS_MUST_BE_POSITIVE_INTEGER",
      "NO_EXECUTION_PREPARED"
    );
  }

  const officialEntryPrice =
    numberOrNull(
      engine8PaperOrder
        .officialEntryPrice
    );

  const officialStopPrice =
    numberOrNull(
      engine8PaperOrder
        .officialStopPrice
    );

  const officialStopDistancePoints =
    numberOrNull(
      engine8PaperOrder
        .officialStopDistancePoints
    );

  if (
    officialEntryPrice === null ||
    officialStopPrice === null ||
    officialStopDistancePoints ===
      null ||
    officialStopDistancePoints <= 0
  ) {
    return reject(
      result,
      "REJECTED_INVALID_OFFICIAL_GEOMETRY",
      "ENTRY_STOP_AND_STOP_DISTANCE_REQUIRED",
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

  result.duplicateState =
    duplicateState;

  const duplicateBlocked =
    duplicateState
      ?.candidateAlreadyOrdered ===
      true ||
    duplicateState
      ?.idempotencyKeyAlreadyUsed ===
      true ||
    duplicateState
      ?.openTradeForStrategy ===
      true ||
    duplicateState
      ?.activeTradeIdExists ===
      true ||
    duplicateState
      ?.orderExistsForPlanId ===
      true ||
    duplicateState
      ?.acceptanceTradeCompleted ===
      true ||
    duplicateState
      ?.newPaperOrdersAllowed ===
      false;

  if (duplicateBlocked) {
    return {
      ...reject(
        result,
        "DUPLICATE_ORDER_BLOCKED",
        "FINAL_DUPLICATE_CHECK_FAILED",
        "NO_EXECUTION_PREPARED"
      ),

      duplicateBlocked:
        true,

      idempotencyKey,
    };
  }

  const executionId =
    makeExecutionId();

  const orderId =
    makeOrderId();

  return {
    ...result,

    status:
      "READY_FOR_PAPER_EXECUTION_CALL",

    ok:
      true,

    rejected:
      false,

    duplicateBlocked:
      false,

    executionId,

    idempotencyKey,

    orderId,

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

    reasonCodes: [
      "ADAPTER_READY",
      "FINAL_DUPLICATE_CHECK_CLEAR",
      "CANONICAL_IDS_CREATED",
      "READY_FOR_CONTROLLED_EXECUTION",
    ],

    preparedAt:
      nowIso(),

    evaluatedAt:
      nowIso(),
  };
}

function buildCanonicalPaperTicket({
  engine8PaperOrder,
  preparedExecution,
}) {
  const direction =
    upper(
      engine8PaperOrder
        ?.direction
    );

  const side =
    direction === "LONG"
      ? "BUY"
      : direction === "SHORT"
        ? "SELL_SHORT"
        : null;

  const engine9Plan =
    resolveEngine9Plan(
      engine8PaperOrder
    );

  const engine7Sizing =
    resolveEngine7Sizing(
      engine8PaperOrder
    );

  const targets =
    Array.isArray(
      engine9Plan
        .officialTargets
    )
      ? clone(
          engine9Plan
            .officialTargets
        )
      : [];

  const firstTarget =
    targets.find(
      (target) =>
        Number.isFinite(
          Number(
            target?.price
          )
        )
    ) || null;

  const sourceSignal = {
    engine:
      "engine8",

    executionId:
      preparedExecution
        .executionId,

    orderId:
      preparedExecution
        .orderId,

    idempotencyKey:
      preparedExecution
        .idempotencyKey,

    planId:
      engine8PaperOrder
        .planId,

    candidateId:
      engine8PaperOrder
        .candidateId,

    zoneId:
      engine8PaperOrder
        .zoneId,

    strategyId:
      engine8PaperOrder
        .strategyId,

    symbol:
      engine8PaperOrder
        .symbol,

    direction,

    setupType:
      engine8PaperOrder
        .setupType,

    snapshotTime:
      engine8PaperOrder
        .snapshotTime,
  };

  return {
    executionId:
      preparedExecution
        .executionId,

    orderId:
      preparedExecution
        .orderId,

    idempotencyKey:
      preparedExecution
        .idempotencyKey,

    tradeId:
      null,

    planId:
      engine8PaperOrder
        .planId,

    candidateId:
      engine8PaperOrder
        .candidateId,

    zoneId:
      engine8PaperOrder
        .zoneId,

    setupType:
      engine8PaperOrder
        .setupType,

    snapshotTime:
      engine8PaperOrder
        .snapshotTime,

    paper:
      true,

    symbol:
      engine8PaperOrder
        .symbol,

    strategyId:
      engine8PaperOrder
        .strategyId,

    timeframe:
      String(
        engine8PaperOrder
          .strategyId || ""
      ).split("@")[1] || "",

    assetType:
      "FUTURES",

    action:
      "NEW_ENTRY",

    eventType:
      "NEW_ENTRY",

    intent:
      "ENTRY",

    direction,

    side,

    qty:
      engine7Sizing
        .finalContracts,

    requestedQuantity:
      engine7Sizing
        .finalContracts,

    orderType:
      "LIMIT",

    timeInForce:
      "DAY",

    entry: {
      price:
        engine9Plan
          .officialEntryPrice,

      intendedMidpoint:
        engine9Plan
          .officialEntryPrice,
    },

    stop: {
      price:
        engine9Plan
          .officialStopPrice,

      distancePoints:
        engine9Plan
          .officialStopDistancePoints,
    },

    officialEntryPrice:
      engine9Plan
        .officialEntryPrice,

    officialStopPrice:
      engine9Plan
        .officialStopPrice,

    officialStopDistancePoints:
      engine9Plan
        .officialStopDistancePoints,

    officialTargets:
      targets,

    takeProfit:
      firstTarget
        ? {
            targetId:
              firstTarget
                .targetId ||
              null,

            price:
              numberOrNull(
                firstTarget
                  .price
              ),
          }
        : null,

    targets,

    threeBlockManagement:
      clone(
        engine9Plan
          .threeBlockManagement
      ),

    runnerPlan:
      clone(
        engine9Plan
          .runnerPlan
      ),

    blocks:
      Array.isArray(
        engine9Plan
          ?.threeBlockManagement
          ?.blocks
      )
        ? clone(
            engine9Plan
              .threeBlockManagement
              .blocks
          )
        : [],

    engine9PlanStatus:
      engine9Plan
        .planStatus,

    engine9OfficialManagementPlan: {
      planId:
        engine9Plan
          .planId,

      planStatus:
        engine9Plan
          .planStatus,

      managementReady:
        engine9Plan
          .managementReady,

      officialEntryPrice:
        engine9Plan
          .officialEntryPrice,

      officialStopPrice:
        engine9Plan
          .officialStopPrice,

      officialStopDistancePoints:
        engine9Plan
          .officialStopDistancePoints,

      officialTargets:
        targets,

      threeBlockManagement:
        clone(
          engine9Plan
            .threeBlockManagement
        ),

      runnerPlan:
        clone(
          engine9Plan
            .runnerPlan
        ),
    },

    engine7PlanId:
      engine7Sizing
        .planId,

    engine7FinalContracts:
      engine7Sizing
        .finalContracts,

    riskBudgetDollars:
      engine7Sizing
        .riskBudgetDollars,

    permissionAdjustedRiskBudget:
      engine7Sizing
        .permissionAdjustedRiskBudget,

    dollarsPerPoint:
      engine7Sizing
        .dollarsPerPoint,

    rawRiskPerContract:
      engine7Sizing
        .rawRiskPerContract,

    estimatedSlippageRiskPerContract:
      engine7Sizing
        .estimatedSlippageRiskPerContract,

    commissionDollarsPerContractRoundTrip:
      engine7Sizing
        .commissionDollarsPerContractRoundTrip,

    effectiveRiskPerContract:
      engine7Sizing
        .effectiveRiskPerContract,

    estimatedTotalRiskDollars:
      engine7Sizing
        .estimatedTotalRiskDollars,

    frozenOpeningRiskDollars:
      engine7Sizing
        .frozenOpeningRiskDollars,

    engine7PositionSizing:
      clone(
        engine7Sizing
      ),

    sourceSignal,

    engine6: {
      permission:
        engine8PaperOrder
          ?.engine6
          ?.allowed === true
          ? "ALLOW"
          : "UNKNOWN",

      allowed:
        engine8PaperOrder
          ?.engine6
          ?.allowed === true,

      decision:
        engine8PaperOrder
          ?.engine6
          ?.decision ||
        null,
    },

    engine7: {
      ...clone(
        engine7Sizing
      ),
    },

    engine9: {
      planId:
        engine9Plan
          .planId,

      planStatus:
        engine9Plan
          .planStatus,

      managementReady:
        engine9Plan
          .managementReady,
    },
  };
}

function resolveJournalState(
  executionResult,
  filled
) {
  const journal =
    executionResult?.journal ||
    null;

  const tradeId =
    executionResult?.tradeId ||
    journal?.tradeId ||
    null;

  const journalAcknowledged =
    journal?.ok === true &&
    Boolean(tradeId);

  const journalPending =
    filled &&
    !journalAcknowledged;

  return {
    journal,
    tradeId,
    journalCompleted:
      journalAcknowledged,
    journalPending,
  };
}

function persistEngine8LifecycleState({
  prepared,
  executionResult,
  journalState,
  filled,
  status,
}) {
  const common = {
    executionId:
      prepared?.executionId,

    orderId:
      executionResult?.orderId ||
      prepared?.orderId ||
      null,

    idempotencyKey:
      executionResult?.idempotencyKey ||
      prepared?.idempotencyKey ||
      null,

    tradeId:
      journalState?.tradeId ||
      null,

    planId:
      prepared?.planId ||
      null,

    candidateId:
      prepared?.candidateId ||
      null,

    zoneId:
      prepared?.zoneId ||
      null,

    strategyId:
      prepared?.strategyId ||
      null,

    symbol:
      prepared?.symbol ||
      null,

    direction:
      prepared?.direction ||
      null,

    setupType:
      prepared?.setupType ||
      null,

    snapshotTime:
      prepared?.snapshotTime ||
      null,

    action:
      "NEW_ENTRY",

    status:
      status || null,
  };

  try {
    if (
      filled === true &&
      journalState?.journalCompleted === true &&
      journalState?.tradeId
    ) {
      return markEngine8JournalResolved({
        ...common,

        journalStatus:
          journalState?.journal?.status ||
          journalState?.journal?.trade?.status ||
          "OPEN",

        remainingQty:
          journalState?.journal?.remainingQty ??
          journalState?.journal?.trade?.qty?.remainingQty ??
          null,
      });
    }

    if (
      filled === true &&
      journalState?.journalPending === true
    ) {
      return markEngine8JournalPending({
        ...common,
      });
    }

    return recordEngine8ExecutionLink({
      ...common,

      executionSuccessful:
        executionResult?.ok === true,

      orderCreated:
        filled === true,

      fillCreated:
        filled === true,

      journalCompleted:
        false,

      journalPending:
        false,

      journalStatus:
        null,

      remainingQty:
        null,
    });
  } catch (error) {
    return {
      ok: false,
      written: false,
      error:
        "ENGINE8_LIFECYCLE_STATE_WRITE_FAILED",

      detail:
        String(
          error?.message ||
          error
        ),
    };
  }
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
      preparedExecution:
        prepared,
    });

  if (
    !ticket.side ||
    !Number.isInteger(
      ticket.qty
    ) ||
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

  let executionResult;

  try {
    executionResult =
      await executeTradeTicket(
        ticket
      );
  } catch (error) {
    return {
      ...prepared,

      status:
        "PAPER_EXECUTION_CALL_FAILED",

      ok:
        false,

      rejected:
        true,

      orderCreated:
        false,

      fillCreated:
        false,

      journalCompleted:
        false,

      journalPending:
        false,

      tradeId:
        null,

      ticket,

      executionResult:
        null,

      error:
        "ENGINE8_PAPER_EXECUTION_FAILED",

      detail:
        String(
          error?.message ||
          error
        ),

      reasonCodes: [
        ...prepared
          .reasonCodes,
        "EXECUTION_CALL_THROWN",
      ],

      executedAt:
        nowIso(),

      evaluatedAt:
        nowIso(),
    };
  }

  const filled =
    executionResult?.ok ===
      true &&
    upper(
      executionResult?.status
    ) === "FILLED";

  const duplicateReturned =
    executionResult
      ?.duplicate === true;

  const journalState =
    resolveJournalState(
      executionResult,
      filled
    );

  let status;

  if (
    filled &&
    journalState
      .journalCompleted
  ) {
    status =
      "PAPER_ORDER_FILLED_JOURNALED";
  } else if (
    filled &&
    journalState
      .journalPending
  ) {
    status =
      "PAPER_ORDER_FILLED_JOURNAL_PENDING";
  } else if (
    duplicateReturned
  ) {
    status =
      "DUPLICATE_ORDER_RETURNED";
  } else {
    status =
      "PAPER_ORDER_REJECTED";
  }

  const lifecycleStateWrite =
    persistEngine8LifecycleState({
      prepared,
      executionResult,
      journalState,
      filled,
      status,
    });

  const reasonCodes = [
    ...prepared.reasonCodes,
  ];

  if (
    filled &&
    journalState
      .journalCompleted
  ) {
    reasonCodes.push(
      "PAPER_FILL_PERSISTED",
      "ENGINE10_JOURNAL_ACKNOWLEDGED",
      "TRADE_ID_RESOLVED"
    );
  }

  if (
    filled &&
    journalState
      .journalPending
  ) {
    reasonCodes.push(
      "PAPER_FILL_PERSISTED",
      "ENGINE10_JOURNAL_PENDING",
      "DUPLICATE_EXECUTION_MUST_REMAIN_BLOCKED"
    );
  }

  if (duplicateReturned) {
    reasonCodes.push(
      "ENGINE8_DUPLICATE_RESULT_RETURNED"
    );
  }

  if (
    lifecycleStateWrite?.ok === true &&
    lifecycleStateWrite?.written === true
  ) {
    reasonCodes.push(
      "ENGINE8_EXECUTION_STATE_PERSISTED"
    );
  }

  if (
    lifecycleStateWrite?.ok !== true
  ) {
    reasonCodes.push(
      "ENGINE8_EXECUTION_STATE_WRITE_FAILED"
    );
  }

  return {
    ...prepared,

    status,

    ok:
      executionResult?.ok ===
      true,

    rejected:
      executionResult
        ?.rejected === true,

    duplicateBlocked:
      duplicateReturned,

    orderCreated:
      filled,

    fillCreated:
      filled,

    journalCompleted:
      journalState
        .journalCompleted,

    journalPending:
      journalState
        .journalPending,

    executionId:
      prepared
        .executionId,

    idempotencyKey:
      prepared
        .idempotencyKey,

    orderId:
      executionResult
        ?.orderId ||
      prepared
        .orderId,

    tradeId:
      journalState
        .tradeId,

    planId:
      prepared
        .planId,

    candidateId:
      prepared
        .candidateId,

    zoneId:
      prepared
        .zoneId,

    strategyId:
      prepared
        .strategyId,

    symbol:
      prepared
        .symbol,

    direction:
      prepared
        .direction,

    setupType:
      prepared
        .setupType,

    snapshotTime:
      prepared
        .snapshotTime,

    journal:
      journalState
        .journal,

    lifecycleStateWrite,

    ticket,

    executionResult,

    reasonCodes,

    noBrokerOrder:
      true,

    noSchwabCall:
      true,

    executedAt:
      nowIso(),

    evaluatedAt:
      nowIso(),
  };
}

export default {
  prepareEngine8PaperExecution,
  executeEngine8PaperOrder,
};
