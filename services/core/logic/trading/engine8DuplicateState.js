// services/core/logic/trading/engine8DuplicateState.js
// Engine 8 — read-only duplicate and acceptance-lock inspection.
//
// This module never creates orders, fills, journal entries, or broker calls.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../../data");

const ORDERS_FILE = path.join(DATA_DIR, "paper-orders.json");
const LEDGER_FILE = path.join(
  DATA_DIR,
  "paper-idempotency-ledger.json"
);
const JOURNAL_FILE = path.join(DATA_DIR, "trade-journal.json");
const ACCEPTANCE_FILE = path.join(
  DATA_DIR,
  "engine8-paper-acceptance-state.json"
);

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(filePath, "utf8")
    );
  } catch {
    return fallback;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex")
    .slice(0, 24);
}

export function buildCanonicalEngine8IdempotencyKey({
  strategyId,
  candidateId,
  planId,
  intent = "ENTRY",
}) {
  const normalizedStrategyId = text(strategyId);
  const normalizedCandidateId = text(candidateId);
  const normalizedPlanId = text(planId);
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

  return `ENGINE8:PAPER:${stableHash(identity)}`;
}

function orderIsOpen(order) {
  const status = upper(order?.status);

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
  return upper(trade?.status) === "OPEN";
}

export function getEngine8DuplicateState({
  strategyId,
  candidateId,
  planId,
  idempotencyKey = null,
} = {}) {
  const normalizedStrategyId = text(strategyId);
  const normalizedCandidateId = text(candidateId);
  const normalizedPlanId = text(planId);

  const canonicalIdempotencyKey =
    text(idempotencyKey) ||
    buildCanonicalEngine8IdempotencyKey({
      strategyId: normalizedStrategyId,
      candidateId: normalizedCandidateId,
      planId: normalizedPlanId,
      intent: "ENTRY",
    });

  const ordersRaw = readJson(ORDERS_FILE, []);
  const orders = Array.isArray(ordersRaw)
    ? ordersRaw
    : [];

  const ledgerRaw = readJson(LEDGER_FILE, {});
  const ledger =
    ledgerRaw &&
    typeof ledgerRaw === "object" &&
    !Array.isArray(ledgerRaw)
      ? ledgerRaw
      : {};

  const journalRaw = readJson(JOURNAL_FILE, []);
  const trades = Array.isArray(journalRaw)
    ? journalRaw
    : [];

  const acceptanceRaw = readJson(
    ACCEPTANCE_FILE,
    {}
  );

  const candidateAlreadyOrdered =
    Boolean(
      normalizedCandidateId &&
      orders.some(
        (order) =>
          text(order?.candidateId) ===
          normalizedCandidateId
      )
    );

  const orderExistsForPlanId =
    Boolean(
      normalizedPlanId &&
      orders.some(
        (order) =>
          text(order?.planId) ===
          normalizedPlanId
      )
    );

  const idempotencyKeyAlreadyUsed =
    Boolean(
      canonicalIdempotencyKey &&
      Object.prototype.hasOwnProperty.call(
        ledger,
        canonicalIdempotencyKey
      )
    );

  const openTradeForStrategy =
    Boolean(
      normalizedStrategyId &&
      (
        orders.some(
          (order) =>
            text(order?.strategyId) ===
              normalizedStrategyId &&
            orderIsOpen(order)
        ) ||
        trades.some(
          (trade) =>
            text(trade?.strategyId) ===
              normalizedStrategyId &&
            tradeIsOpen(trade)
        )
      )
    );

  const activeTrade =
    trades.find(
      (trade) =>
        text(trade?.strategyId) ===
          normalizedStrategyId &&
        tradeIsOpen(trade)
    ) || null;

  const activeTradeIdExists =
    Boolean(text(activeTrade?.tradeId));

  const acceptanceTradeCompleted =
    acceptanceRaw
      ?.acceptanceTradeCompleted === true;

  const newPaperOrdersAllowed =
    acceptanceRaw
      ?.newPaperOrdersAllowed !== false;

  return {
    candidateAlreadyOrdered,
    idempotencyKeyAlreadyUsed,
    openTradeForStrategy,
    activeTradeIdExists,
    orderExistsForPlanId,
    acceptanceTradeCompleted,
    newPaperOrdersAllowed,

    canonicalIdempotencyKey,

    existingActiveTradeId:
      activeTrade?.tradeId || null,

    inspectedFiles: {
      ordersFileExists:
        fs.existsSync(ORDERS_FILE),

      ledgerFileExists:
        fs.existsSync(LEDGER_FILE),

      journalFileExists:
        fs.existsSync(JOURNAL_FILE),

      acceptanceFileExists:
        fs.existsSync(ACCEPTANCE_FILE),
    },
  };
}

export default {
  buildCanonicalEngine8IdempotencyKey,
  getEngine8DuplicateState,
};
