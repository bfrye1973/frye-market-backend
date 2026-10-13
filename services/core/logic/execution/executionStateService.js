import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// go from services/core/logic/execution → services/core/data
const DATA_DIR = path.resolve(__dirname, "../../data");
const ORDERS_FILE = path.join(DATA_DIR, "paper-orders.json");

function readOrders() {
  try {
    if (!fs.existsSync(ORDERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function toNumberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(arr, index) {
  if (!Array.isArray(arr)) return null;
  return toNumberOrNull(arr[index]);
}

function normalizeStop(trade) {
  if (typeof trade?.stop === "object") {
    return toNumberOrNull(trade.stop?.price);
  }

  return toNumberOrNull(trade?.stop);
}

function normalizeDirection(trade) {
  const explicit =
    String(
      trade?.direction ||
        trade?.sourceSignal?.direction ||
        trade?.signalEvent?.direction ||
        ""
    )
      .trim()
      .toUpperCase() || null;

  if (explicit) return explicit;

  if (trade?.option?.right === "PUT") return "SHORT";
  if (trade?.option?.right === "CALL") return "LONG";

  const side = String(trade?.side || "").toUpperCase();
  if (side === "SELL") return "SHORT";
  if (side === "BUY") return "LONG";

  return null;
}

function buildOptionExecutionState(trade) {
  const entryUnderlyingPrice = toNumberOrNull(trade.signalEvent?.signalPrice);

  return {
    ok: true,
    status: "ENTERED",
    trade: {
      tradeId: `${trade.symbol}:${trade.strategyId}:${trade.filledAt}`,
      orderId: trade.orderId,
      symbol: trade.symbol,
      strategyId: trade.strategyId,
      direction: normalizeDirection(trade),
      assetType: trade.assetType,
      right: trade.option?.right,
      expiration: trade.option?.expiration,
      strike: trade.option?.strike,
      entryPrice: trade.avgPrice,
      entryUnderlyingPrice,
      qty: trade.filledQty,
      openedAt: trade.filledAt,
    },
    levels: {
      entry: entryUnderlyingPrice,
      stop: null,
      tp1: null,
      tp2: null,
    },
    pnl: {
      open: true,
      realized: 0,
      unrealized: null,
    },
  };
}

function buildFuturesExecutionState(trade) {
  const entryPrice =
    toNumberOrNull(trade.avgPrice) ??
    toNumberOrNull(trade.entry?.price) ??
    toNumberOrNull(trade.intendedMidpoint);

  return {
    ok: true,
    status: "ENTERED",
    trade: {
      tradeId: `${trade.symbol}:${trade.strategyId}:${trade.filledAt}`,
      orderId: trade.orderId,
      symbol: trade.symbol,
      strategyId: trade.strategyId,
      direction: normalizeDirection(trade),
      assetType: "FUTURES",
      entryPrice,
      entryUnderlyingPrice: entryPrice,
      qty: trade.filledQty ?? trade.qty,
      openedAt: trade.filledAt,
      blocks: trade.blocks || [],
    },
    levels: {
      entry: entryPrice,
      stop: normalizeStop(trade),
      tp1: firstNumber(trade.targets, 0),
      tp2: firstNumber(trade.targets, 1),
    },
    pnl: {
      open: true,
      realized: 0,
      unrealized: null,
    },
  };
}

export function getExecutionState(symbol, strategyId) {
  const orders = readOrders();

  const normalizedSymbol = String(symbol || "").trim().toUpperCase();
  const normalizedStrategyId = String(strategyId || "").trim();

  // orders are written newest-first, so find() returns most recent matching entry
  const trade = orders.find(
    (o) =>
      String(o.symbol || "").toUpperCase() === normalizedSymbol &&
      String(o.strategyId || "") === normalizedStrategyId &&
      o.action === "NEW_ENTRY" &&
      o.status === "filled"
  );

  if (!trade) {
    return {
      ok: true,
      status: "NO_TRADE",
      trade: null,
      levels: null,
      pnl: null,
    };
  }

  const assetType = String(trade.assetType || "").toUpperCase();

  if (assetType === "FUTURES") {
    return buildFuturesExecutionState(trade);
  }

  return buildOptionExecutionState(trade);
}
