// services/core/logic/trading/engine8AcceptanceState.js
//
// Engine 8 acceptance-state ownership.
//
// This module owns the one-time acceptance lock:
//
// acceptanceTradeCompleted = true
// newPaperOrdersAllowed = false
//
// It must only be activated after Engine 10 confirms:
// - trade status CLOSED
// - remainingQty === 0
// - journalCompleted === true
// - valid tradeId
//
// NEW_ENTRY and REDUCE must never activate this state.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(
  __dirname,
  "../../data"
);

const ACCEPTANCE_STATE_FILE = path.resolve(
  DATA_DIR,
  "engine8-paper-acceptance-state.json"
);

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
      recursive: true,
    });
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  ensureDataDir();

  const tempFile = `${file}.tmp`;

  fs.writeFileSync(
    tempFile,
    JSON.stringify(value, null, 2)
  );

  fs.renameSync(tempFile, file);
}

function defaultAcceptanceState() {
  return {
    engine:
      "engine8.paperAcceptanceState.v1",

    contractVersion:
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

    symbol:
      null,

    action:
      null,

    engine10Status:
      null,

    remainingQty:
      null,

    journalCompleted:
      false,

    closedAt:
      null,

    reason:
      null,

    updatedAt:
      null,
  };
}

export function getEngine8AcceptanceState() {
  const stored = readJson(
    ACCEPTANCE_STATE_FILE,
    {}
  );

  return {
    ...defaultAcceptanceState(),
    ...(stored &&
    typeof stored === "object" &&
    !Array.isArray(stored)
      ? stored
      : {}),
  };
}

export function markEngine8AcceptanceTradeCompleted({
  tradeId,
  executionId,
  orderId,
  idempotencyKey,
  planId,
  candidateId,
  strategyId,
  symbol,
  action,
  engine10Status,
  remainingQty,
  journalCompleted,
  closedAt = null,
} = {}) {
  const normalizedTradeId = text(tradeId);
  const normalizedExecutionId =
    text(executionId);

  const normalizedAction =
    upper(action);

  const normalizedEngine10Status =
    upper(engine10Status);

  const numericRemainingQty =
    Number(remainingQty);

  if (normalizedAction !== "EXIT") {
    return {
      ok: false,
      rejected: true,
      reason:
        "ACCEPTANCE_LOCK_REQUIRES_FINAL_EXIT",
      acceptanceLockActivated: false,
      state:
        getEngine8AcceptanceState(),
    };
  }

  if (!normalizedTradeId) {
    return {
      ok: false,
      rejected: true,
      reason:
        "ACCEPTANCE_LOCK_REQUIRES_TRADE_ID",
      acceptanceLockActivated: false,
      state:
        getEngine8AcceptanceState(),
    };
  }

  if (!normalizedExecutionId) {
    return {
      ok: false,
      rejected: true,
      reason:
        "ACCEPTANCE_LOCK_REQUIRES_EXECUTION_ID",
      acceptanceLockActivated: false,
      state:
        getEngine8AcceptanceState(),
    };
  }

  if (
    journalCompleted !== true
  ) {
    return {
      ok: false,
      rejected: true,
      reason:
        "ACCEPTANCE_LOCK_REQUIRES_JOURNAL_COMPLETION",
      acceptanceLockActivated: false,
      state:
        getEngine8AcceptanceState(),
    };
  }

  if (
    normalizedEngine10Status !==
    "CLOSED"
  ) {
    return {
      ok: false,
      rejected: true,
      reason:
        "ACCEPTANCE_LOCK_REQUIRES_CLOSED_STATUS",
      acceptanceLockActivated: false,
      state:
        getEngine8AcceptanceState(),
    };
  }

  if (
    !Number.isFinite(
      numericRemainingQty
    ) ||
    numericRemainingQty !== 0
  ) {
    return {
      ok: false,
      rejected: true,
      reason:
        "ACCEPTANCE_LOCK_REQUIRES_ZERO_REMAINING_QTY",
      acceptanceLockActivated: false,
      state:
        getEngine8AcceptanceState(),
    };
  }

  const existing =
    getEngine8AcceptanceState();

  if (
    existing
      .acceptanceTradeCompleted ===
      true
  ) {
    const sameTrade =
      text(existing.tradeId) ===
      normalizedTradeId;

    return {
      ok: true,
      rejected: false,
      duplicate: true,
      reason: sameTrade
        ? "ACCEPTANCE_LOCK_ALREADY_SET_FOR_TRADE"
        : "ACCEPTANCE_LOCK_ALREADY_SET",
      acceptanceLockActivated:
        false,
      state: existing,
    };
  }

  const completedAt =
    closedAt || nowIso();

  const nextState = {
    engine:
      "engine8.paperAcceptanceState.v1",

    contractVersion:
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
      text(orderId) || null,

    idempotencyKey:
      text(idempotencyKey) || null,

    planId:
      text(planId) || null,

    candidateId:
      text(candidateId) || null,

    strategyId:
      text(strategyId) || null,

    symbol:
      upper(symbol) || null,

    action:
      normalizedAction,

    engine10Status:
      normalizedEngine10Status,

    remainingQty:
      numericRemainingQty,

    journalCompleted:
      true,

    closedAt:
      completedAt,

    reason:
      "ENGINE10_CONFIRMED_FINAL_CLOSE",

    updatedAt:
      nowIso(),
  };

  writeJsonAtomic(
    ACCEPTANCE_STATE_FILE,
    nextState
  );

  return {
    ok: true,
    rejected: false,
    duplicate: false,
    reason:
      "ENGINE8_ACCEPTANCE_LOCK_ACTIVATED",
    acceptanceLockActivated:
      true,
    state: nextState,
  };
}

export default {
  getEngine8AcceptanceState,
  markEngine8AcceptanceTradeCompleted,
};
