import fs from "fs";
import path from "path";
import crypto from "crypto";
import { readPaperStore, writePaperStore, withPaperInstructionLock } from "./engine8PaperDurableStore.js";
import { fileURLToPath } from "url";
import {
  createTradeJournalEntryFromEngine8Fill,
  applyEngine8ExecutionToJournal,
} from "../journal/tradeJournalStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// core/data
const DATA_DIR = path.resolve(__dirname, "../../data");
const LEDGER_FILE = "paper-idempotency-ledger.json";
const ORDERS_FILE = "paper-orders.json";
const EXEC_FILE = "paper-executions.json";

// ---- Config (env-based, safe defaults) ----
function cfg() {
  const allowlist = (process.env.ENGINE8_ALLOWLIST || "SPY,QQQ,ES")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  return {
    paperOnly: process.env.ENGINE8_PAPER_ONLY === "1",
    killSwitch: process.env.ENGINE8_KILL_SWITCH === "1",
    allowExitsOnStandDown: process.env.ENGINE8_ALLOW_EXITS_ON_STANDDOWN === "1",
    allowlist,
  };
}

function readJson(file, fallback) {
  return readPaperStore(file, fallback);
}

function writeJson(file, data) {
  writePaperStore(file, data);
}

function nowIso() {
  return new Date().toISOString();
}

function makePaperOrderId() {
  return `PAPER-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function normalizeSymbol(sym) {
  return String(sym || "").trim().toUpperCase();
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function normalizeAssetType(ticket) {
  return String(ticket?.assetType || "EQUITY").trim().toUpperCase();
}

function normalizeIntent(ticket) {
  return String(ticket?.intent || "").trim().toUpperCase() || null;
}

function normalizeDirection(ticket) {
  return (
    String(
      ticket?.direction ||
        ticket?.signalEvent?.direction ||
        ticket?.engine5?.bias ||
        ""
    )
      .trim()
      .toUpperCase() || null
  );
}

function isExitSide(side) {
  const s = String(side || "").toUpperCase();
  return (
    s.includes("SELL_TO_CLOSE") ||
    s.includes("BUY_TO_CLOSE") ||
    s.includes("CLOSE") ||
    s.includes("EXIT") ||
    s.includes("REDUCE")
  );
}

function inferRightFromDirection(direction) {
  if (direction === "LONG") return "CALL";
  if (direction === "SHORT") return "PUT";
  return null;
}

function normalizeOptionPrice(option = {}) {
  return (
    toNumberOrNull(option?.midPrice) ??
    toNumberOrNull(option?.avgPrice) ??
    toNumberOrNull(option?.premium) ??
    null
  );
}

function inferAtmStrike(ticket) {
  const price =
    toNumberOrNull(ticket?.signalEvent?.signalPrice) ??
    toNumberOrNull(ticket?.entry?.price) ??
    toNumberOrNull(ticket?.entry?.intendedMidpoint) ??
    toNumberOrNull(ticket?.engine5?.targets?.entryTarget);

  if (price == null) return null;
  return Math.round(price);
}

/**
 * Automatic options-entry path for Engine 15 / signal automation:
 * - intent = ENTRY
 * - assetType = OPTION
 * - direction = LONG | SHORT
 *
 * Force:
 * - side = BUY_TO_OPEN
 * - action = NEW_ENTRY
 * - LONG => CALL
 * - SHORT => PUT
 * - 0DTE (today)
 * - ATM strike
 * - premium comes from option.midPrice / option.avgPrice / option.premium
 */
function normalizeAutomationOptionContract(ticket) {
  const assetType = normalizeAssetType(ticket);
  const intent = normalizeIntent(ticket);
  const direction = normalizeDirection(ticket);

  if (
    !(
      assetType === "OPTION" &&
      intent === "ENTRY" &&
      (direction === "LONG" || direction === "SHORT")
    )
  ) {
    return null;
  }

  const normalizedPremium = normalizeOptionPrice(ticket?.option || {});

  return {
    right: inferRightFromDirection(direction),
    expiration:
      String(ticket?.option?.expiration || "").trim() ||
      nowIso().slice(0, 10), // 0DTE = today
    strike: toNumberOrNull(ticket?.option?.strike) ?? inferAtmStrike(ticket),
    contractSymbol:
      String(ticket?.option?.contractSymbol || "").trim() || null,
    midPrice: normalizedPremium,
  };
}

function normalizeOption(ticket) {
  const assetType = normalizeAssetType(ticket);
  if (assetType !== "OPTION") return null;

  const autoOption = normalizeAutomationOptionContract(ticket);
  if (autoOption) return autoOption;

  const normalizedPremium = normalizeOptionPrice(ticket?.option || {});

  return {
    right: String(ticket?.option?.right || "").trim().toUpperCase() || null,
    expiration: String(ticket?.option?.expiration || "").trim() || null,
    strike: toNumberOrNull(ticket?.option?.strike),
    contractSymbol:
      String(ticket?.option?.contractSymbol || "").trim() || null,
    midPrice: normalizedPremium,
  };
}

function normalizeSide(ticket) {
  const explicit = String(ticket?.side || "").trim().toUpperCase();
  if (explicit) return explicit;

  const assetType = normalizeAssetType(ticket);
  const intent = normalizeIntent(ticket);
  const direction = normalizeDirection(ticket);

  if (
    assetType === "OPTION" &&
    intent === "ENTRY" &&
    (direction === "LONG" || direction === "SHORT")
  ) {
    return "BUY_TO_OPEN";
  }

  if (
    assetType === "FUTURES" &&
    intent === "ENTRY" &&
    (direction === "LONG" || direction === "SHORT")
  ) {
    return direction === "LONG" ? "BUY" : "SELL";
  }

  return "";
}
function normalizeAction(ticket, side) {
  const explicit = String(ticket?.action || "").trim().toUpperCase();
  if (explicit) return explicit;

  const assetType = normalizeAssetType(ticket);
  const intent = normalizeIntent(ticket);
  const direction = normalizeDirection(ticket);

  if (
    assetType === "OPTION" &&
    intent === "ENTRY" &&
    (direction === "LONG" || direction === "SHORT")
  ) {
    return "NEW_ENTRY";
  }

  if (
    assetType === "FUTURES" &&
    intent === "ENTRY" &&
    (direction === "LONG" || direction === "SHORT")
  ) {
    return "NEW_ENTRY";
  }

  return isExitSide(side) ? "EXIT" : "NEW_ENTRY";
}
function normalizeQty(ticket) {
  const assetType = normalizeAssetType(ticket);
  const intent = normalizeIntent(ticket);
  const direction = normalizeDirection(ticket);

  if (
    assetType === "OPTION" &&
    intent === "ENTRY" &&
    (direction === "LONG" || direction === "SHORT")
  ) {
    return clampQty(ticket?.contracts ?? ticket?.qty ?? 3);
  }

  if (
    assetType === "FUTURES" &&
    intent === "ENTRY" &&
    (direction === "LONG" || direction === "SHORT")
  ) {
    return clampQty(ticket?.contracts ?? ticket?.qty);
  }

  return clampQty(ticket?.qty);
}
// -------------------- Public API --------------------

export async function getTradingStatus() {
  const c = cfg();
  return {
    ok: true,
    engine: "engine8-paper",
    paperOnly: c.paperOnly,
    killSwitch: c.killSwitch,
    allowExitsOnStandDown: c.allowExitsOnStandDown,
    allowlist: c.allowlist,
    ts: nowIso(),
  };
}

export async function getRiskStatus() {
  const c = cfg();
  return {
    ok: true,
    killSwitch: c.killSwitch,
    paperOnly: c.paperOnly,
    allowExitsOnStandDown: c.allowExitsOnStandDown,
    allowlist: c.allowlist,
    ts: nowIso(),
  };
}

export async function listPaperOrders() {
  const orders = readJson(ORDERS_FILE, []);
  return { ok: true, orders };
}

export async function listPaperExecutions() {
  const executions = readJson(EXEC_FILE, []);
  return { ok: true, executions };
}

export async function cancelPaperOrder(body) {
  const orderId = String(body?.orderId || "").trim();
  if (!orderId) {
    return { ok: false, rejected: true, reason: "MISSING_ORDER_ID" };
  }

  const orders = readJson(ORDERS_FILE, []);
  const idx = orders.findIndex((o) => o.orderId === orderId);

  if (idx === -1) {
    return { ok: false, rejected: true, reason: "ORDER_NOT_FOUND", orderId };
  }

  if (orders[idx].status === "filled") {
    return {
      ok: false,
      rejected: true,
      reason: "CANNOT_CANCEL_FILLED",
      orderId,
    };
  }

  orders[idx].status = "canceled";
  orders[idx].canceledAt = nowIso();
  writeJson(ORDERS_FILE, orders);

  return { ok: true, orderId, status: "canceled" };
}

export async function executeTradeTicket(ticket) {
  const key = String(ticket?.idempotencyKey || "").trim();
  if (!key) return { ok: false, rejected: true, reason: "MISSING_IDEMPOTENCY_KEY" };
  // Serialize the shared JSON-ledger read/modify/write across ALL processes and keys.
  return withPaperInstructionLock("__ENGINE8_PAPER_GLOBAL_WRITE__", () =>
    withPaperInstructionLock(key, () => executeTradeTicketLocked(ticket)));
}

async function executeTradeTicketLocked(ticket) {
  const c = cfg();

  const idempotencyKey = String(ticket?.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    return { ok: false, rejected: true, reason: "MISSING_IDEMPOTENCY_KEY" };
  }

  const symbol = normalizeSymbol(ticket?.symbol);
  if (!symbol) {
    return {
      ok: false,
      rejected: true,
      reason: "MISSING_SYMBOL",
      idempotencyKey,
    };
  }

  if (!c.allowlist.includes(symbol)) {
    return {
      ok: false,
      rejected: true,
      reason: "SYMBOL_NOT_ALLOWED",
      symbol,
      idempotencyKey,
    };
  }

  const strategyId = String(ticket?.strategyId || "").trim();
  if (!strategyId) {
    return {
      ok: false,
      rejected: true,
      reason: "MISSING_STRATEGY_ID",
      idempotencyKey,
      symbol,
    };
  }

  const side = normalizeSide(ticket);
  if (!side) {
    return {
      ok: false,
      rejected: true,
      reason: "MISSING_SIDE",
      idempotencyKey,
      symbol,
    };
  }

  const action = normalizeAction(ticket, side);
  const qty = normalizeQty(ticket);

  if (qty <= 0) {
    return {
      ok: false,
      rejected: true,
      reason: "SIZE_ZERO_OR_MISSING_QTY",
      idempotencyKey,
      symbol,
    };
  }

  // This executor is intrinsically PAPER-only, regardless of environment flags.
  if (ticket?.paper === false || ticket?.real === true || ticket?.live === true) {
    return {
      ok: false,
      rejected: true,
      reason: "PAPER_ONLY_ENFORCED",
      idempotencyKey,
      symbol,
    };
  }

  const ledger = readJson(LEDGER_FILE, {});
  if (ledger[idempotencyKey]) {
    if (ledger[idempotencyKey].journalStatus === "ORDER_RESERVED") {
      return { ok: false, rejected: true, duplicate: true,
        reason: "ORIGINAL_PAPER_EXECUTION_RESERVED_REQUIRES_RECONCILIATION", idempotencyKey };
    }
    return {
      ok: true,
      duplicate: true,
      idempotencyKey,
      result: ledger[idempotencyKey],
    };
  }

  const exitIntent =
    action === "EXIT" || action === "REDUCE" || isExitSide(side);

  if (c.killSwitch) {
    const rej = {
      ok: false,
      rejected: true,
      reason: "KILL_SWITCH",
      idempotencyKey,
      symbol,
    };
    ledger[idempotencyKey] = rej;
    writeJson(LEDGER_FILE, ledger);
    return rej;
  }

  const engine6perm = String(ticket?.engine6?.permission || "").toUpperCase();
  if (engine6perm === "STAND_DOWN") {
    if (!(c.allowExitsOnStandDown && exitIntent)) {
      const rej = {
        ok: false,
        rejected: true,
        reason: "ENGINE6_STAND_DOWN",
        idempotencyKey,
        symbol,
        exitIntent,
      };
      ledger[idempotencyKey] = rej;
      writeJson(LEDGER_FILE, ledger);
      return rej;
    }
  }

  const orderId =
  String(ticket?.orderId || "").trim() ||
  makePaperOrderId();
  const orderType = String(ticket?.orderType || "MARKET").toUpperCase();
  const timeInForce = String(ticket?.timeInForce || "DAY").toUpperCase();

  const intendedMid = toNumberOrNull(
    ticket?.entry?.intendedMidpoint ??
      ticket?.entry?.price ??
      ticket?.signalEvent?.signalPrice ??
      ticket?.engine5?.targets?.entryTarget
  );

  const assetType = normalizeAssetType(ticket);
  const option = normalizeOption(ticket);
  const intent = normalizeIntent(ticket);
  const direction = normalizeDirection(ticket);

  // Automatic option entry now REQUIRES premium input so avgPrice is authoritative
  if (
    assetType === "OPTION" &&
    intent === "ENTRY" &&
    (direction === "LONG" || direction === "SHORT") &&
    (option?.midPrice == null || option?.midPrice <= 0)
  ) {
    return {
      ok: false,
      rejected: true,
      reason: "MISSING_OPTION_MIDPRICE",
      message:
        "Automatic option entry requires option.midPrice (or option.avgPrice / option.premium) so avgPrice is non-null.",
      idempotencyKey,
      symbol,
      strategyId,
    };
  }

const futuresEntryPrice =
  assetType === "FUTURES" ? toNumberOrNull(ticket?.entry?.price) : null;

if (
  assetType === "FUTURES" &&
  intent === "ENTRY" &&
  (direction === "LONG" || direction === "SHORT") &&
  (futuresEntryPrice == null || futuresEntryPrice <= 0)
) {
  return {
    ok: false,
    rejected: true,
    reason: "MISSING_FUTURES_ENTRY_PRICE",
    message:
      "ES futures paper entry requires entry.price so avgPrice is non-null.",
    idempotencyKey,
    symbol,
    strategyId,
  };
}

const fillPrice =
  assetType === "OPTION"
    ? option?.midPrice ?? null
    : assetType === "FUTURES"
      ? futuresEntryPrice
      : intendedMid;

  // Reserve the instruction identity on durable storage before any fill records.
  // An interruption fails closed rather than issuing another simulated fill.
  ledger[idempotencyKey] = {
    ok: false, paper: true, status: "reserved",
    orderId, executionId: String(ticket?.executionId || orderId),
    idempotencyKey, journalStatus: "ORDER_RESERVED",
    reservedAt: nowIso(),
  };
  writeJson(LEDGER_FILE, ledger);

  const filledAt = nowIso();

  const order = {
    orderId,
    idempotencyKey,
    ts: filledAt,
    paper: true,
    symbol,
    strategyId,
    timeframe: String(ticket?.timeframe || ""),
    assetType,
    action,
    side: String(side).toUpperCase(),
    orderType,
    timeInForce,
    qty,
    intendedMidpoint: intendedMid,
    stop: toNumberOrNull(ticket?.stop?.price),
    takeProfit: toNumberOrNull(ticket?.takeProfit?.price),
    engine6: ticket?.engine6 || null,
    engine7: ticket?.engine7 || null,
    engine5: ticket?.engine5 || null,
    signalEvent: ticket?.signalEvent || null,
    entry: ticket?.entry || null,
    targets: Array.isArray(ticket?.targets) ? ticket.targets : [],
    blocks: Array.isArray(ticket?.blocks) ? ticket.blocks : [],
    sourceSignal: ticket?.sourceSignal || null,
    option: assetType === "OPTION" ? option : null,
    status: "filled",
    filledQty: qty,
    avgPrice: fillPrice,
    filledAt,
  };

  const orders = readJson(ORDERS_FILE, []);
  orders.unshift(order);
  writeJson(ORDERS_FILE, orders);

  const executions = readJson(EXEC_FILE, []);
  executions.unshift({
    ts: filledAt,
    ok: true,
    orderId,
    idempotencyKey,
    symbol,
    strategyId,
    action,
    side: order.side,
    qty,
    filledQty: qty,
    avgPrice: fillPrice,
    assetType: order.assetType,
    option,
    entry: ticket?.entry || null,
    targets: Array.isArray(ticket?.targets) ? ticket.targets : [],
    blocks: Array.isArray(ticket?.blocks) ? ticket.blocks : [],
    ourceSignal: ticket?.sourceSignal || null,
    option: assetType === "OPTION" ? option : null,
    signalEvent: ticket?.signalEvent || null,
    status: "filled",    
  });
  writeJson(EXEC_FILE, executions);

  const result = {
    ok: true,
    rejected: false,
    orderId,
    action,
    status: "filled",
    filledQty: qty,
    avgPrice: fillPrice,
    idempotencyKey,
    paper: true,
    assetType: order.assetType,
    entry: ticket?.entry || null,
    targets: Array.isArray(ticket?.targets) ? ticket.targets : [],
    blocks: Array.isArray(ticket?.blocks) ? ticket.blocks : [],
    sourceSignal: ticket?.sourceSignal || null,
    option: assetType === "OPTION" ? option : null,
    filledAt,
  };

  // Commit the exact fill and original ticket BEFORE contacting Engine 10.
  // Recovery replays only this immutable Journal delivery, never an order.
  result.journalStatus = "JOURNAL_PENDING";
  result.executionId = String(ticket?.executionId || orderId);
  ledger[idempotencyKey] = {
    ...result,
    journalDelivery: { ticket, order, result: { ...result }, action },
  };
  writeJson(LEDGER_FILE, ledger);

try {
  let journalResult = null;

  if (action === "NEW_ENTRY") {
    journalResult =
      await createTradeJournalEntryFromEngine8Fill({
        ticket,
        order,
        result,
      });
  } else if (action === "REDUCE" || action === "EXIT") {
    journalResult =
      await applyEngine8ExecutionToJournal({
        ticket,
        order,
        result,
      });
  }

  if (journalResult?.tradeId) {
    result.tradeId = journalResult.tradeId;
  }

  if (journalResult) {
    const journalCompleted =
      journalResult?.ok === true &&
      Boolean(
        journalResult?.tradeId
      );

  result.journal = {
    ok:
      journalResult?.ok === true,

  tradeId:
    journalResult?.tradeId ||
    null,

  duplicate:
    journalResult?.duplicate ===
    true,

  created:
    journalResult?.created ===
    true,

  updated:
    journalResult?.updated ===
    true,

  status:
    journalResult?.status ||
    null,

  remainingQty:
    journalResult?.remainingQty ??
    null,

  journalCompleted,
};
  }
} catch (err) {
  console.error(
    "[engine8->journal] journal sync failed:",
    err?.stack || err
  );

  result.journal = {
    ok: false,
    tradeId: null,
    status: null,
    remainingQty: null,
    journalCompleted: false,
    error: "JOURNAL_SYNC_FAILED",
  };
}

  // A failed status write must not be reported as a completed delivery.
  const completed = result.journal?.ok === true && Boolean(result.journal?.tradeId);
  result.journalStatus = completed ? "JOURNAL_COMPLETE" : "JOURNAL_PENDING";
  const currentLedger = readJson(LEDGER_FILE, {});
  if (currentLedger[idempotencyKey]?.orderId !== orderId) {
    throw new Error("ENGINE8_PAPER_FILL_IDENTITY_LOST");
  }
  currentLedger[idempotencyKey] = {
    ...result,
    journalDelivery: completed ? null : { ticket, order, result: { ...result }, action },
  };
  writeJson(LEDGER_FILE, currentLedger);

  return result;
}

const journalRetriesInFlight = new Set();

// Admin route calls this ONLY for a pre-existing persisted fill.
// No new order, execution, or fill is constructed during reconciliation.
export async function retryPaperJournalDelivery({ idempotencyKey } = {}) {
  const key = String(idempotencyKey || "").trim();
  if (!key) return { ok: false, rejected: true, reason: "MISSING_IDEMPOTENCY_KEY" };
  return withPaperInstructionLock("__ENGINE8_PAPER_GLOBAL_WRITE__", () =>
    withPaperInstructionLock(key, () => retryPaperJournalDeliveryLocked(key)));
}

async function retryPaperJournalDeliveryLocked(idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!key) return { ok: false, rejected: true, reason: "MISSING_IDEMPOTENCY_KEY" };
  if (journalRetriesInFlight.has(key)) {
    return { ok: false, rejected: true, reason: "JOURNAL_RETRY_IN_PROGRESS" };
  }
  journalRetriesInFlight.add(key);
  try {
  const ledger = readJson(LEDGER_FILE, {});
  const original = ledger[key];
  if (!original || original.status !== "filled" || original.paper !== true) {
    return { ok: false, rejected: true, reason: "PERSISTED_PAPER_FILL_NOT_FOUND" };
  }
  if (original.journalStatus === "JOURNAL_COMPLETE" && original.journal?.tradeId) {
    return { ok: true, duplicate: true, journalStatus: "JOURNAL_COMPLETE", orderId: original.orderId, tradeId: original.journal.tradeId };
  }
  const delivery = original.journalDelivery;
  if (!delivery?.ticket || !delivery?.order || !delivery?.result || delivery.order.orderId !== original.orderId) {
    return { ok: false, rejected: true, reason: "ORIGINAL_JOURNAL_DELIVERY_UNAVAILABLE" };
  }
  let journal;
  try {
    journal = delivery.action === "NEW_ENTRY"
      ? await createTradeJournalEntryFromEngine8Fill(delivery)
      : await applyEngine8ExecutionToJournal(delivery);
  } catch (error) {
    return { ok: false, journalStatus: "JOURNAL_PENDING", reason: "JOURNAL_RETRY_FAILED" };
  }
  if (journal?.ok !== true || !journal?.tradeId) {
    return { ok: false, journalStatus: "JOURNAL_PENDING", reason: "ENGINE10_ACKNOWLEDGMENT_MISSING" };
  }
  // Re-read to protect against replacing unrelated ledger entries.
  const latest = readJson(LEDGER_FILE, {});
  if (latest[key]?.orderId !== original.orderId) {
    return { ok: false, journalStatus: "JOURNAL_PENDING", reason: "PAPER_IDENTITY_CHANGED" };
  }
  latest[key] = {
    ...latest[key], tradeId: journal.tradeId,
    journal: { ...journal, journalCompleted: true },
    journalStatus: "JOURNAL_COMPLETE", journalDelivery: null,
  };
  writeJson(LEDGER_FILE, latest);
  return { ok: true, orderId: original.orderId, executionId: original.executionId,
    idempotencyKey: key, tradeId: journal.tradeId, journalStatus: "JOURNAL_COMPLETE" };
  } finally { journalRetriesInFlight.delete(key); }
}
