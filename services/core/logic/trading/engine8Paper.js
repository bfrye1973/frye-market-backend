import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  createTradeJournalEntryFromEngine8Fill,
  applyEngine8ExecutionToJournal,
} from "../journal/tradeJournalStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// core/data
const DATA_DIR = path.resolve(__dirname, "../../data");
const LEDGER_FILE = path.resolve(DATA_DIR, "paper-idempotency-ledger.json");
const ORDERS_FILE = path.resolve(DATA_DIR, "paper-orders.json");
const EXEC_FILE = path.resolve(DATA_DIR, "paper-executions.json");

// ---- Config (env-based, safe defaults) ----
function cfg() {
  const allowlist = (process.env.ENGINE8_ALLOWLIST || "SPY,QQQ")
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

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function makePaperOrderId() {
  return `PAPER-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function isExitSide(side) {
  const s = String(side || "").toUpperCase();
  return (
    s.includes("SELL") ||
    s.includes("CLOSE") ||
    s.includes("EXIT")
  );
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

function normalizeAction(ticket, side) {
  const explicit = String(ticket?.action || "").trim().toUpperCase();
  if (explicit) return explicit;

  return isExitSide(side) ? "EXIT" : "NEW_ENTRY";
}

function normalizeAssetType(ticket) {
  return String(ticket?.assetType || "EQUITY").trim().toUpperCase();
}

function normalizeOption(ticket) {
  const assetType = normalizeAssetType(ticket);
  if (assetType !== "OPTION") return null;

  return {
    right: String(ticket?.option?.right || "").trim().toUpperCase() || null,
    expiration: String(ticket?.option?.expiration || "").trim() || null,
    strike: toNumberOrNull(ticket?.option?.strike),
    contractSymbol: String(ticket?.option?.contractSymbol || "").trim() || null,
    midPrice: toNumberOrNull(ticket?.option?.midPrice),
  };
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
    return { ok: false, rejected: true, reason: "CANNOT_CANCEL_FILLED", orderId };
  }

  orders[idx].status = "canceled";
  orders[idx].canceledAt = nowIso();
  writeJson(ORDERS_FILE, orders);

  return { ok: true, orderId, status: "canceled" };
}

export async function executeTradeTicket(ticket) {
  const c = cfg();

  const idempotencyKey = String(ticket?.idempotencyKey || "").trim();
  if (!idempotencyKey) {
    return { ok: false, rejected: true, reason: "MISSING_IDEMPOTENCY_KEY" };
  }

  const symbol = normalizeSymbol(ticket?.symbol);
  if (!symbol) {
    return { ok: false, rejected: true, reason: "MISSING_SYMBOL", idempotencyKey };
  }

  if (!c.allowlist.includes(symbol)) {
    return { ok: false, rejected: true, reason: "SYMBOL_NOT_ALLOWED", symbol, idempotencyKey };
  }

  const strategyId = String(ticket?.strategyId || "").trim();
  if (!strategyId) {
    return { ok: false, rejected: true, reason: "MISSING_STRATEGY_ID", idempotencyKey, symbol };
  }

  const side = String(ticket?.side || "").trim();
  if (!side) {
    return { ok: false, rejected: true, reason: "MISSING_SIDE", idempotencyKey, symbol };
  }

  const action = normalizeAction(ticket, side);

  const qty = clampQty(ticket?.qty);
  if (qty <= 0) {
    return { ok: false, rejected: true, reason: "SIZE_ZERO_OR_MISSING_QTY", idempotencyKey, symbol };
  }

  const paper = ticket?.paper !== false;
  if (c.paperOnly && paper === false) {
    return { ok: false, rejected: true, reason: "PAPER_ONLY_ENFORCED", idempotencyKey, symbol };
  }

  const ledger = readJson(LEDGER_FILE, {});
  if (ledger[idempotencyKey]) {
    return {
      ok: true,
      duplicate: true,
      idempotencyKey,
      result: ledger[idempotencyKey],
    };
  }

  const exitIntent = action === "EXIT" || action === "REDUCE" || isExitSide(side);

  if (c.killSwitch) {
    const rej = { ok: false, rejected: true, reason: "KILL_SWITCH", idempotencyKey, symbol };
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

  const orderId = makePaperOrderId();
  const orderType = String(ticket?.orderType || "MARKET").toUpperCase();
  const timeInForce = String(ticket?.timeInForce || "DAY").toUpperCase();

  const intendedMid = toNumberOrNull(
    ticket?.entry?.intendedMidpoint ?? ticket?.engine5?.targets?.entryTarget
  );
  const fillPrice = intendedMid;
  const assetType = normalizeAssetType(ticket);
  const option = normalizeOption(ticket);
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
    option,
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
    option,
    filledAt,
  };

  ledger[idempotencyKey] = result;
  writeJson(LEDGER_FILE, ledger);

  try {
    if (action === "NEW_ENTRY") {
      await createTradeJournalEntryFromEngine8Fill({
        ticket,
        order,
        result,
      });
    } else if (action === "REDUCE" || action === "EXIT") {
      await applyEngine8ExecutionToJournal({
        ticket,
        order,
        result,
      });
    }
  } catch (err) {
    console.error("[engine8->journal] journal sync failed:", err?.stack || err);
  }

  return result;
}
