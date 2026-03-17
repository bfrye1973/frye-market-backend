import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// core/data
const DATA_DIR = path.resolve(__dirname, "../../data");
const LEDGER_FILE = path.resolve(DATA_DIR, "paper-idempotency-ledger.json"); // map idempotencyKey -> saved result
const ORDERS_FILE = path.resolve(DATA_DIR, "paper-orders.json");             // list of orders
const EXEC_FILE = path.resolve(DATA_DIR, "paper-executions.json");           // list of execution attempts

// ---- Config (env-based, safe defaults) ----
//
// ENGINE8_PAPER_ONLY=1           -> refuse any ticket that claims paper:false
// ENGINE8_KILL_SWITCH=1          -> block all NEW entries (and exits too, unless allowExits enabled)
// ENGINE8_ALLOW_EXITS_ON_STANDDOWN=1 -> allow exits even if Engine6 says STAND_DOWN
// ENGINE8_ALLOWLIST=SPY,QQQ      -> allowed symbols
//
function cfg() {
  const allowlist = (process.env.ENGINE8_ALLOWLIST || "SPY,QQQ")
    .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);

  return {
    paperOnly: process.env.ENGINE8_PAPER_ONLY === "1",
    killSwitch: process.env.ENGINE8_KILL_SWITCH === "1",
    allowExitsOnStandDown: process.env.ENGINE8_ALLOW_EXITS_ON_STANDDOWN === "1",
    allowlist
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
  // deterministic-ish unique id
  return `PAPER-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function isExitSide(side) {
  // Keep it simple; supports equities + options text
  const s = String(side || "").toUpperCase();
  return (
    s.includes("SELL") ||          // SELL, SELL_SHORT, SELL_TO_CLOSE
    s.includes("CLOSE") ||
    s.includes("EXIT")
  );
}

function normalizeSymbol(sym) {
  return String(sym || "").trim().toUpperCase();
}

function requiredString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return 0;
  // qty must be integer >= 0
  return Math.max(0, Math.floor(n));
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
    ts: nowIso()
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
    ts: nowIso()
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
  const idx = orders.findIndex(o => o.orderId === orderId);

  if (idx === -1) {
    return { ok: false, rejected: true, reason: "ORDER_NOT_FOUND", orderId };
  }

  // If already filled, we can’t cancel (paper mimic)
  if (orders[idx].status === "filled") {
    return { ok: false, rejected: true, reason: "CANNOT_CANCEL_FILLED", orderId };
  }

  orders[idx].status = "canceled";
  orders[idx].canceledAt = nowIso();
  writeJson(ORDERS_FILE, orders);

  return { ok: true, orderId, status: "canceled" };
}

/**
 * POST /api/trading/execute
 * Enforces:
 * - idempotency required + dedupe
 * - kill switch
 * - engine6.permission
 * - engine7 sizing (qty > 0)
 * - allowlist symbol
 * - paperOnly enforcement
 */
export async function executeTradeTicket(ticket) {
  const c = cfg();

  // -------- Validate required fields --------
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

  // Engine 7 sizing: prefer qty as final.
  const qty = clampQty(ticket?.qty);
  if (qty <= 0) {
    // If they used finalR only, we still refuse — Engine8 must not compute size.
    return { ok: false, rejected: true, reason: "SIZE_ZERO_OR_MISSING_QTY", idempotencyKey, symbol };
  }

  // Paper-only enforcement
  const paper = ticket?.paper !== false; // default true
  if (c.paperOnly && paper === false) {
    return { ok: false, rejected: true, reason: "PAPER_ONLY_ENFORCED", idempotencyKey, symbol };
  }

  // -------- Idempotency dedupe --------
  const ledger = readJson(LEDGER_FILE, {});
  if (ledger[idempotencyKey]) {
    return {
      ok: true,
      duplicate: true,
      idempotencyKey,
      result: ledger[idempotencyKey]
    };
  }

  // -------- Safety rails (kill + permission) --------
  const exitIntent = isExitSide(side);

  if (c.killSwitch) {
    // kill switch blocks everything by default (safest)
    const rej = { ok: false, rejected: true, reason: "KILL_SWITCH", idempotencyKey, symbol };
    // store in ledger so repeats don’t spam logs
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
        exitIntent
      };
      ledger[idempotencyKey] = rej;
      writeJson(LEDGER_FILE, ledger);
      return rej;
    }
  }

  // -------- Create a paper order --------
  const orderId = makePaperOrderId();
  const orderType = String(ticket?.orderType || "MARKET").toUpperCase();
  const timeInForce = String(ticket?.timeInForce || "DAY").toUpperCase();

  // We “fill immediately” for Phase 1.
  const intendedMid = toNumberOrNull(ticket?.entry?.intendedMidpoint ?? ticket?.engine5?.targets?.entryTarget);
  const fillPrice = intendedMid; // for paper v1 use intended midpoint as avg fill if provided

  const order = {
    orderId,
    idempotencyKey,
    ts: nowIso(),
    paper: true,
    symbol,
    strategyId,
    timeframe: String(ticket?.timeframe || ""),
    assetType: String(ticket?.assetType || "EQUITY").toUpperCase(),
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
    status: "filled",
    filledQty: qty,
    avgPrice: fillPrice,
    filledAt: nowIso()
  };

  // persist orders + executions
  const orders = readJson(ORDERS_FILE, []);
  orders.unshift(order);
  writeJson(ORDERS_FILE, orders);

  const executions = readJson(EXEC_FILE, []);
  executions.unshift({
    ts: nowIso(),
    ok: true,
    orderId,
    idempotencyKey,
    symbol,
    strategyId,
    side: order.side,
    qty,
    status: "filled"
  });
  writeJson(EXEC_FILE, executions);

  const result = {
    ok: true,
    rejected: false,
    orderId,
    status: "filled",
    filledQty: qty,
    avgPrice: fillPrice,
    idempotencyKey,
    paper: true
  };

  // write idempotency ledger after success
  ledger[idempotencyKey] = result;
  writeJson(LEDGER_FILE, ledger);

  return result;
}
