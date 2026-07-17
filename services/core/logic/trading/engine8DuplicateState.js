// services/core/logic/trading/engine8DuplicateState.js
//
// Engine 8 duplicate, lifecycle-linkage, journal-pending,
// and acceptance-lock state service.
//
// Read responsibilities:
// - inspect paper orders
// - inspect idempotency ledger
// - inspect Engine 10 Journal
// - inspect Engine 8 lifecycle mappings
// - inspect acceptance lock
//
// Write responsibilities:
// - persist executionId/orderId/idempotencyKey/planId -> tradeId linkage
// - mark Journal synchronization pending or complete
// - activate the final acceptance lock only after Engine 10 confirms:
//     status === "CLOSED"
//     remainingQty === 0
//     tradeId present
//
// This module never creates orders, fills, Journal trades, or broker calls.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");

const ORDERS_FILE = path.join(
  DATA_DIR,
  "paper-orders.json"
);

const LEDGER_FILE = path.join(
  DATA_DIR,
  "paper-idempotency-ledger.json"
);

const JOURNAL_FILE = path.join(
  DATA_DIR,
  "trade-journal.json"
);

const ACCEPTANCE_FILE = path.join(
  DATA_DIR,
  "engine8-paper-acceptance-state.json"
);

const LIFECYCLE_FILE = path.join(
  DATA_DIR,
  "engine8-paper-execution-state.json"
);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true,
    });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(
        filePath,
        "utf8"
      )
    );
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  ensureDataDir();

  const tempPath =
    `${filePath}.tmp`;

  fs.writeFileSync(
    tempPath,
    JSON.stringify(value, null, 2),
    "utf8"
  );

  fs.renameSync(
    tempPath,
    filePath
  );
}

function text(value) {
  return String(
    value ?? ""
  ).trim();
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

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(
      String(value),
      "utf8"
    )
    .digest("hex")
    .slice(0, 24);
}

function normalizeLifecycleState(raw) {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw)
  ) {
    return {
      version:
        raw.version ||
        "engine8.paperExecutionState.v1",

      executions:
        raw.executions &&
        typeof raw.executions ===
          "object" &&
        !Array.isArray(
          raw.executions
        )
          ? raw.executions
          : {},

      updatedAt:
        raw.updatedAt ||
        null,
    };
  }

  return {
    version:
      "engine8.paperExecutionState.v1",

    executions:
      {},

    updatedAt:
      null,
  };
}

function normalizeAcceptanceState(raw) {
  const safe =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw)
      ? raw
      : {};

  return {
    version:
      safe.version ||
      "engine8.paperAcceptanceState.v1",

    acceptanceTradeCompleted:
      safe.acceptanceTradeCompleted ===
      true,

    newPaperOrdersAllowed:
      safe.newPaperOrdersAllowed !==
      false,

    tradeId:
      text(safe.tradeId) ||
      null,

    executionId:
      text(safe.executionId) ||
      null,

    orderId:
      text(safe.orderId) ||
      null,

    idempotencyKey:
      text(
        safe.idempotencyKey
      ) || null,

    planId:
      text(safe.planId) ||
      null,

    candidateId:
      text(safe.candidateId) ||
      null,

    strategyId:
      text(safe.strategyId) ||
      null,

    closedAt:
      text(safe.closedAt) ||
      null,

    activatedAt:
      text(safe.activatedAt) ||
      null,

    updatedAt:
      text(safe.updatedAt) ||
      null,

    reason:
      text(safe.reason) ||
      null,
  };
}

function orderIsOpen(order) {
  const status =
    upper(order?.status);

  return [
    "CREATED",
    "NEW",
    "OPEN",
    "WORKING",
    "PENDING",
    "PARTIALLY_FILLED",
  ].includes(status);
}

function tradeIsOpen(trade) {
  return (
    upper(trade?.status) ===
    "OPEN"
  );
}

function lifecycleRecordIsBlocking(
  record
) {
  if (!record) return false;

  if (
    record.journalPending ===
    true
  ) {
    return true;
  }

  if (
    record.executionSuccessful ===
      true &&
    !text(record.tradeId)
  ) {
    return true;
  }

  if (
    [
      "PREPARED",
      "ORDER_CREATED",
      "FILL_CREATED",
      "JOURNAL_PENDING",
      "OPEN",
    ].includes(
      upper(record.status)
    )
  ) {
    return true;
  }

  return false;
}

export function buildCanonicalEngine8IdempotencyKey({
  strategyId,
  candidateId,
  planId,
  intent = "ENTRY",
}) {
  const normalizedStrategyId =
    text(strategyId);

  const normalizedCandidateId =
    text(candidateId);

  const normalizedPlanId =
    text(planId);

  const normalizedIntent =
    upper(intent) || "ENTRY";

  if (
    !normalizedStrategyId ||
    !normalizedCandidateId ||
    !normalizedPlanId
  ) {
    return null;
  }

  const identity = [
    normalizedStrategyId,
    normalizedCandidateId,
    normalizedPlanId,
    normalizedIntent,
  ].join("|");

  return (
    `ENGINE8:PAPER:${stableHash(identity)}`
  );
}

export function getEngine8ExecutionState() {
  return normalizeLifecycleState(
    readJson(
      LIFECYCLE_FILE,
      {}
    )
  );
}

export function getEngine8AcceptanceState() {
  return normalizeAcceptanceState(
    readJson(
      ACCEPTANCE_FILE,
      {}
    )
  );
}

export function findEngine8ExecutionLink({
  executionId = null,
  orderId = null,
  idempotencyKey = null,
  tradeId = null,
  planId = null,
} = {}) {
  const state =
    getEngine8ExecutionState();

  const records =
    Object.values(
      state.executions
    );

  const normalizedExecutionId =
    text(executionId);

  const normalizedOrderId =
    text(orderId);

  const normalizedIdempotencyKey =
    text(idempotencyKey);

  const normalizedTradeId =
    text(tradeId);

  const normalizedPlanId =
    text(planId);

  if (
    normalizedExecutionId &&
    state.executions[
      normalizedExecutionId
    ]
  ) {
    return (
      state.executions[
        normalizedExecutionId
      ]
    );
  }

  return (
    records.find((record) => {
      if (
        normalizedOrderId &&
        text(record?.orderId) ===
          normalizedOrderId
      ) {
        return true;
      }

      if (
        normalizedIdempotencyKey &&
        text(
          record?.idempotencyKey
        ) ===
          normalizedIdempotencyKey
      ) {
        return true;
      }

      if (
        normalizedTradeId &&
        text(record?.tradeId) ===
          normalizedTradeId
      ) {
        return true;
      }

      if (
        normalizedPlanId &&
        text(record?.planId) ===
          normalizedPlanId
      ) {
        return true;
      }

      return false;
    }) || null
  );
}

export function recordEngine8ExecutionLink({
  executionId,
  orderId = null,
  idempotencyKey = null,
  tradeId = null,

  planId = null,
  candidateId = null,
  zoneId = null,
  strategyId = null,
  symbol = null,
  direction = null,
  setupType = null,
  snapshotTime = null,

  action = "NEW_ENTRY",
  status = null,

  executionSuccessful = false,
  orderCreated = false,
  fillCreated = false,

  journalCompleted = false,
  journalPending = false,

  journalStatus = null,
  remainingQty = null,

  createdAt = null,
  updatedAt = null,
} = {}) {
  const normalizedExecutionId =
    text(executionId);

  if (!normalizedExecutionId) {
    return {
      ok: false,
      written: false,
      error:
        "EXECUTION_ID_REQUIRED",
    };
  }

  const state =
    getEngine8ExecutionState();

  const previous =
    state.executions[
      normalizedExecutionId
    ] || {};

  const timestamp =
    updatedAt ||
    nowIso();

  const record = {
    executionId:
      normalizedExecutionId,

    orderId:
      text(orderId) ||
      previous.orderId ||
      null,

    idempotencyKey:
      text(idempotencyKey) ||
      previous.idempotencyKey ||
      null,

    tradeId:
      text(tradeId) ||
      previous.tradeId ||
      null,

    planId:
      text(planId) ||
      previous.planId ||
      null,

    candidateId:
      text(candidateId) ||
      previous.candidateId ||
      null,

    zoneId:
      text(zoneId) ||
      previous.zoneId ||
      null,

    strategyId:
      text(strategyId) ||
      previous.strategyId ||
      null,

    symbol:
      text(symbol) ||
      previous.symbol ||
      null,

    direction:
      upper(direction) ||
      previous.direction ||
      null,

    setupType:
      text(setupType) ||
      previous.setupType ||
      null,

    snapshotTime:
      text(snapshotTime) ||
      previous.snapshotTime ||
      null,

    action:
      upper(action) ||
      previous.action ||
      "NEW_ENTRY",

    status:
      upper(status) ||
      previous.status ||
      "UNKNOWN",

    executionSuccessful:
      executionSuccessful ===
        true ||
      previous.executionSuccessful ===
        true,

    orderCreated:
      orderCreated === true ||
      previous.orderCreated ===
        true,

    fillCreated:
      fillCreated === true ||
      previous.fillCreated ===
        true,

    journalCompleted:
      journalCompleted ===
        true,

    journalPending:
      journalPending ===
        true,

    journalStatus:
      upper(journalStatus) ||
      previous.journalStatus ||
      null,

    remainingQty:
      numberOrNull(
        remainingQty
      ) ??
      numberOrNull(
        previous.remainingQty
      ),

    createdAt:
      previous.createdAt ||
      createdAt ||
      timestamp,

    updatedAt:
      timestamp,
  };

  state.executions[
    normalizedExecutionId
  ] = record;

  state.updatedAt =
    timestamp;

  writeJson(
    LIFECYCLE_FILE,
    state
  );

  return {
    ok: true,
    written: true,
    executionId:
      normalizedExecutionId,
    tradeId:
      record.tradeId,
    record,
  };
}

export function markEngine8JournalPending({
  executionId,
  orderId = null,
  idempotencyKey = null,
  planId = null,
  candidateId = null,
  zoneId = null,
  strategyId = null,
  symbol = null,
  direction = null,
  setupType = null,
  snapshotTime = null,
  action = "NEW_ENTRY",
  status =
    "PAPER_ORDER_FILLED_JOURNAL_PENDING",
} = {}) {
  return recordEngine8ExecutionLink({
    executionId,
    orderId,
    idempotencyKey,
    tradeId:
      null,

    planId,
    candidateId,
    zoneId,
    strategyId,
    symbol,
    direction,
    setupType,
    snapshotTime,

    action,
    status,

    executionSuccessful:
      true,

    orderCreated:
      true,

    fillCreated:
      true,

    journalCompleted:
      false,

    journalPending:
      true,

    journalStatus:
      "PENDING",
  });
}

export function markEngine8JournalResolved({
  executionId,
  orderId = null,
  idempotencyKey = null,
  tradeId,

  planId = null,
  candidateId = null,
  zoneId = null,
  strategyId = null,
  symbol = null,
  direction = null,
  setupType = null,
  snapshotTime = null,

  action = "NEW_ENTRY",
  status =
    "PAPER_ORDER_FILLED_JOURNALED",

  journalStatus = "OPEN",
  remainingQty = null,
} = {}) {
  const normalizedTradeId =
    text(tradeId);

  if (!normalizedTradeId) {
    return {
      ok: false,
      written: false,
      error:
        "TRADE_ID_REQUIRED",
    };
  }

  return recordEngine8ExecutionLink({
    executionId,
    orderId,
    idempotencyKey,
    tradeId:
      normalizedTradeId,

    planId,
    candidateId,
    zoneId,
    strategyId,
    symbol,
    direction,
    setupType,
    snapshotTime,

    action,
    status,

    executionSuccessful:
      true,

    orderCreated:
      true,

    fillCreated:
      true,

    journalCompleted:
      true,

    journalPending:
      false,

    journalStatus,
    remainingQty,
  });
}

export function markEngine8AcceptanceTradeCompleted({
  executionId,
  orderId = null,
  idempotencyKey = null,
  tradeId,

  planId = null,
  candidateId = null,
  strategyId = null,

  journalStatus,
  remainingQty,
  closedAt = null,
} = {}) {
  const normalizedExecutionId =
    text(executionId);

  const normalizedTradeId =
    text(tradeId);

  const normalizedJournalStatus =
    upper(journalStatus);

  const normalizedRemainingQty =
    numberOrNull(
      remainingQty
    );

  const validClosedAcknowledgement =
    Boolean(
      normalizedExecutionId &&
      normalizedTradeId &&
      normalizedJournalStatus ===
        "CLOSED" &&
      normalizedRemainingQty ===
        0
    );

  if (
    !validClosedAcknowledgement
  ) {
    return {
      ok: false,
      updated: false,
      error:
        "ENGINE10_CLOSED_ACKNOWLEDGEMENT_REQUIRED",

      requirements: {
        executionIdPresent:
          Boolean(
            normalizedExecutionId
          ),

        tradeIdPresent:
          Boolean(
            normalizedTradeId
          ),

        journalStatusClosed:
          normalizedJournalStatus ===
          "CLOSED",

        remainingQtyZero:
          normalizedRemainingQty ===
          0,
      },
    };
  }

  const timestamp =
    nowIso();

  const state = {
    version:
      "engine8.paperAcceptanceState.v1",

    acceptanceTradeCompleted:
      true,

    newPaperOrdersAllowed:
      false,

    tradeId:
      normalizedTradeId,

    executionId:
      normalizedExecutionId,

    orderId:
      text(orderId) ||
      null,

    idempotencyKey:
      text(
        idempotencyKey
      ) || null,

    planId:
      text(planId) ||
      null,

    candidateId:
      text(candidateId) ||
      null,

    strategyId:
      text(strategyId) ||
      null,

    closedAt:
      text(closedAt) ||
      timestamp,

    activatedAt:
      timestamp,

    updatedAt:
      timestamp,

    reason:
      "ENGINE10_CLOSED_ACKNOWLEDGED",
  };

  writeJson(
    ACCEPTANCE_FILE,
    state
  );

  recordEngine8ExecutionLink({
    executionId:
      normalizedExecutionId,

    orderId,
    idempotencyKey,

    tradeId:
      normalizedTradeId,

    planId,
    candidateId,
    strategyId,

    action:
      "EXIT",

    status:
      "ACCEPTANCE_TRADE_COMPLETED",

    executionSuccessful:
      true,

    orderCreated:
      true,

    fillCreated:
      true,

    journalCompleted:
      true,

    journalPending:
      false,

    journalStatus:
      "CLOSED",

    remainingQty:
      0,

    updatedAt:
      timestamp,
  });

  return {
    ok: true,
    updated: true,

    acceptanceTradeCompleted:
      true,

    newPaperOrdersAllowed:
      false,

    tradeId:
      normalizedTradeId,

    executionId:
      normalizedExecutionId,

    closedAt:
      state.closedAt,

    state,
  };
}

export function resetEngine8AcceptanceState({
  reason =
    "MANUAL_RESET",
} = {}) {
  const timestamp =
    nowIso();

  const state = {
    version:
      "engine8.paperAcceptanceState.v1",

    acceptanceTradeCompleted:
      false,

    newPaperOrdersAllowed:
      true,

    tradeId:
      null,

    executionId:
      null,

    orderId:
      null,

    idempotencyKey:
      null,

    planId:
      null,

    candidateId:
      null,

    strategyId:
      null,

    closedAt:
      null,

    activatedAt:
      null,

    updatedAt:
      timestamp,

    reason:
      text(reason) ||
      "MANUAL_RESET",
  };

  writeJson(
    ACCEPTANCE_FILE,
    state
  );

  return {
    ok: true,
    updated: true,
    state,
  };
}

export function getEngine8DuplicateState({
  strategyId,
  candidateId,
  planId,
  idempotencyKey = null,
} = {}) {
  const normalizedStrategyId =
    text(strategyId);

  const normalizedCandidateId =
    text(candidateId);

  const normalizedPlanId =
    text(planId);

  const canonicalIdempotencyKey =
    text(idempotencyKey) ||
    buildCanonicalEngine8IdempotencyKey({
      strategyId:
        normalizedStrategyId,

      candidateId:
        normalizedCandidateId,

      planId:
        normalizedPlanId,

      intent:
        "ENTRY",
    });

  const ordersRaw =
    readJson(
      ORDERS_FILE,
      []
    );

  const orders =
    Array.isArray(ordersRaw)
      ? ordersRaw
      : [];

  const ledgerRaw =
    readJson(
      LEDGER_FILE,
      {}
    );

  const ledger =
    ledgerRaw &&
    typeof ledgerRaw ===
      "object" &&
    !Array.isArray(ledgerRaw)
      ? ledgerRaw
      : {};

  const journalRaw =
    readJson(
      JOURNAL_FILE,
      []
    );

  const trades =
    Array.isArray(journalRaw)
      ? journalRaw
      : [];

  const acceptanceState =
    getEngine8AcceptanceState();

  const lifecycleState =
    getEngine8ExecutionState();

  const lifecycleRecords =
    Object.values(
      lifecycleState.executions
    );

  const candidateAlreadyOrdered =
    Boolean(
      normalizedCandidateId &&
      orders.some(
        (order) =>
          text(
            order?.candidateId ||
            order?.sourceSignal
              ?.candidateId
          ) ===
          normalizedCandidateId
      )
    );

  const orderExistsForPlanId =
    Boolean(
      normalizedPlanId &&
      orders.some(
        (order) =>
          text(
            order?.planId ||
            order?.sourceSignal
              ?.planId
          ) ===
          normalizedPlanId
      )
    );

  const idempotencyKeyAlreadyUsed =
    Boolean(
      canonicalIdempotencyKey &&
      Object.prototype
        .hasOwnProperty.call(
          ledger,
          canonicalIdempotencyKey
        )
    );

  const matchingLifecycleRecord =
    lifecycleRecords.find(
      (record) =>
        (
          normalizedCandidateId &&
          text(
            record?.candidateId
          ) ===
            normalizedCandidateId
        ) ||
        (
          normalizedPlanId &&
          text(record?.planId) ===
            normalizedPlanId
        ) ||
        (
          canonicalIdempotencyKey &&
          text(
            record
              ?.idempotencyKey
          ) ===
            canonicalIdempotencyKey
        )
    ) || null;

  const journalPendingExecution =
    Boolean(
      lifecycleRecords.some(
        (record) =>
          lifecycleRecordIsBlocking(
            record
          )
      )
    );

  const openTradeForStrategy =
    Boolean(
      normalizedStrategyId &&
      (
        orders.some(
          (order) =>
            text(
              order?.strategyId
            ) ===
              normalizedStrategyId &&
            orderIsOpen(order)
        ) ||
        trades.some(
          (trade) =>
            text(
              trade?.strategyId
            ) ===
              normalizedStrategyId &&
            tradeIsOpen(trade)
        ) ||
        lifecycleRecords.some(
          (record) =>
            text(
              record?.strategyId
            ) ===
              normalizedStrategyId &&
            lifecycleRecordIsBlocking(
              record
            )
        )
      )
    );

  const activeTrade =
    trades.find(
      (trade) =>
        text(
          trade?.strategyId
        ) ===
          normalizedStrategyId &&
        tradeIsOpen(trade)
    ) || null;

  const activeTradeIdExists =
    Boolean(
      text(activeTrade?.tradeId) ||
      text(
        matchingLifecycleRecord
          ?.tradeId
      )
    );

  const acceptanceTradeCompleted =
    acceptanceState
      .acceptanceTradeCompleted ===
      true;

  const newPaperOrdersAllowed =
    acceptanceState
      .newPaperOrdersAllowed !==
      false;

  return {
    candidateAlreadyOrdered,

    idempotencyKeyAlreadyUsed,

    openTradeForStrategy,

    activeTradeIdExists,

    orderExistsForPlanId,

    acceptanceTradeCompleted,

    newPaperOrdersAllowed,

    journalPendingExecution,

    canonicalIdempotencyKey,

    existingActiveTradeId:
      activeTrade?.tradeId ||
      matchingLifecycleRecord
        ?.tradeId ||
      null,

    existingExecutionId:
      matchingLifecycleRecord
        ?.executionId ||
      null,

    existingOrderId:
      matchingLifecycleRecord
        ?.orderId ||
      null,

    existingPlanId:
      matchingLifecycleRecord
        ?.planId ||
      null,

    existingJournalPending:
      matchingLifecycleRecord
        ?.journalPending ===
      true,

    acceptanceState,

    inspectedFiles: {
      ordersFileExists:
        fs.existsSync(
          ORDERS_FILE
        ),

      ledgerFileExists:
        fs.existsSync(
          LEDGER_FILE
        ),

      journalFileExists:
        fs.existsSync(
          JOURNAL_FILE
        ),

      acceptanceFileExists:
        fs.existsSync(
          ACCEPTANCE_FILE
        ),

      lifecycleFileExists:
        fs.existsSync(
          LIFECYCLE_FILE
        ),
    },
  };
}

export default {
  buildCanonicalEngine8IdempotencyKey,

  getEngine8DuplicateState,

  getEngine8ExecutionState,

  getEngine8AcceptanceState,

  findEngine8ExecutionLink,

  recordEngine8ExecutionLink,

  markEngine8JournalPending,

  markEngine8JournalResolved,

  markEngine8AcceptanceTradeCompleted,

  resetEngine8AcceptanceState,
};
