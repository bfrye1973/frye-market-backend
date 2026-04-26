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

export function getExecutionState(symbol, strategyId) {
  const orders = readOrders();

  // find most recent NEW_ENTRY for this strategy
  const trade = orders.find(
    (o) =>
      o.symbol === symbol &&
      o.strategyId === strategyId &&
      o.action === "NEW_ENTRY"
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

  return {
    ok: true,
    status: "ENTERED",
    trade: {
      tradeId: `${trade.symbol}:${trade.strategyId}:${trade.filledAt}`,
      orderId: trade.orderId,
      direction: trade.option?.right === "PUT" ? "SHORT" : "LONG",
      assetType: trade.assetType,
      right: trade.option?.right,
      expiration: trade.option?.expiration,
      strike: trade.option?.strike,
      entryPrice: trade.avgPrice,
      entryUnderlyingPrice: trade.signalEvent?.signalPrice,
      qty: trade.filledQty,
      openedAt: trade.filledAt,
    },
    levels: {
      entry: trade.signalEvent?.signalPrice,
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
