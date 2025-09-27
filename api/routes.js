// ./api/routes.js — Express router that returns mock options + paper trading endpoints.
// Keeps everything in-memory so your frontend works immediately.

import express from "express";

const router = express.Router();

/* ------------------------------ in-memory state ------------------------------ */
let ORDERS = [];            // [{ id, status, ...payload }]
let EXECUTIONS = [];        // [{ id, orderId, symbol, qty, price, time }]
let POSITIONS = new Map();  // symbol -> { symbol, qty, avgPrice, pnl, realizedPnl }
let KILL = false;

const nid = (p = "ORD") => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/* ---------------------------------- health ---------------------------------- */
router.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), service: "frye-market-backend" });
});

/* ---------------------------------- status ---------------------------------- */
router.get("/trading/status", (req, res) => {
  res.json({
    broker: "tos",
    mode: "PAPER",
    connected: true,
    liveEnabled: false,
    lastHeartbeat: new Date().toISOString(),
  });
});

/* ----------------------------------- risk ----------------------------------- */
router.get("/risk/status", (req, res) => {
  res.json({ killSwitch: KILL, caps: { maxOrderQty: 1000, maxDailyLoss: 2000 } });
});
router.post("/risk/kill", (req, res) => {
  KILL = true;
  res.json({ killSwitch: true });
});

/* --------------------------------- options ---------------------------------- */
// generate the next 8 Saturday expirations
function mockExpirations() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    // next Saturday + i weeks
    const add = ((6 - d.getDay() + 7) % 7) + i * 7;
    d.setDate(d.getDate() + add);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function mockChain({ side = "call" }) {
  const last = 500; // pretend underlying is 500
  const steps = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
  return steps.map((k) => {
    const strike = Math.round((last + k * 5) * 100) / 100;
    const mark = Math.max(0.15, 5 - Math.abs(k)) / 2;
    const bid = Math.max(0, mark - 0.05);
    const ask = mark + 0.05;
    const delta = side === "call" ? 0.5 - Math.abs(k) * 0.05 : -0.5 + Math.abs(k) * 0.05;
    return {
      strike,
      mark: Number(mark.toFixed(2)),
      bid: Number(bid.toFixed(2)),
      ask: Number(ask.toFixed(2)),
      delta: Number(delta.toFixed(2)),
      theta: Number((-0.04 + k * 0.002).toFixed(3)),
      gamma: Number((0.02 - Math.abs(k) * 0.0015).toFixed(3)),
      vega: Number((0.11 - Math.abs(k) * 0.002).toFixed(3)),
      oi: 1000 + Math.floor(Math.random() * 3000),
      volume: Math.floor(Math.random() * 500),
    };
  });
}

// GET /api/options/meta?symbol=SPY
router.get("/options/meta", (req, res) => {
  const { symbol = "SPY" } = req.query;
  res.json({ symbol: String(symbol).toUpperCase(), expirations: mockExpirations() });
});

// GET /api/options/chain?symbol=SPY&expiration=YYYY-MM-DD&side=call|put
router.get("/options/chain", (req, res) => {
  const { symbol = "SPY", expiration, side = "call" } = req.query;
  if (!expiration) return res.status(400).json({ ok: false, error: "Missing 'expiration' (YYYY-MM-DD)" });
  res.json(mockChain({ side: String(side).toLowerCase() }));
});

/* ---------------------------------- orders ---------------------------------- */
// lists
router.get("/trading/orders", (req, res) => res.json(ORDERS));
router.get("/trading/executions", (req, res) => res.json(EXECUTIONS));
router.get("/trading/positions", (req, res) => res.json(Array.from(POSITIONS.values())));

// place (PAPER)
router.post("/trading/orders", (req, res) => {
  if (KILL) return res.status(403).json({ ok: false, error: "Kill switch engaged" });

  const idem = req.header("X-Idempotency-Key") || "";
  const b = req.body || {};

  // validate
  if (b.assetType === "EQUITY") {
    const { symbol, side, qty, orderType } = b;
    if (!symbol || !side || !qty || !orderType) return res.status(400).json({ ok: false, error: "Missing equity fields" });
  } else if (b.assetType === "OPTION") {
    const { underlying, right, expiration, strike, qty, orderType } = b;
    if (!underlying || !right || !expiration || !strike || !qty || !orderType)
      return res.status(400).json({ ok: false, error: "Missing option fields" });
  } else {
    return res.status(400).json({ ok: false, error: "assetType must be EQUITY or OPTION" });
  }

  const now = new Date().toISOString();
  const id = nid("ORD");

  const order = {
    id,
    idempotencyKey: idem,
    status: "NEW",
    createdAt: now,
    updatedAt: now,
    ...b,
    symbol: b.symbol || b.underlying || "SPY",
  };
  ORDERS.unshift(order);

  // instant PAPER fill for MARKET; otherwise leave WORKING
  const typ = String(b.orderType).toUpperCase();
  if (typ === "MKT" || typ === "MARKET") {
    order.status = "FILLED";
    order.updatedAt = new Date().toISOString();
    const px = mockFillPrice(order);
    const exe = {
      id: nid("EXE"),
      orderId: order.id,
      symbol: order.symbol,
      qty: Number(b.qty),
      price: px,
      time: new Date().toISOString(),
    };
    EXECUTIONS.unshift(exe);
    applyPosition(exe, b.assetType);
  } else {
    order.status = "WORKING";
  }

  return res.status(201).json({ id: order.id, status: order.status });
});

// cancel
router.delete("/trading/orders/:id", (req, res) => {
  const { id } = req.params;
  const i = ORDERS.findIndex((o) => o.id === id);
  if (i === -1) return res.status(404).json({ ok: false, error: "Order not found" });
  if (ORDERS[i].status === "FILLED" || ORDERS[i].status === "CANCELLED") {
    return res.json({ id, status: ORDERS[i].status });
  }
  ORDERS[i].status = "CANCELLED";
  ORDERS[i].updatedAt = new Date().toISOString();
  return res.json({ id, status: "CANCELLED" });
});

/* --------------------------------- helpers --------------------------------- */
function mockFillPrice(order) {
  if (order.assetType === "OPTION") {
    return Number((order.limitPrice ?? order.stopPrice ?? 2.45).toFixed(2)); // premium
  }
  return Number((order.limitPrice ?? order.stopPrice ?? 500.0).toFixed(2));   // equity
}
function applyPosition(exe /*, assetType */) {
  const key = exe.symbol;
  const cur = POSITIONS.get(key) || { symbol: key, qty: 0, avgPrice: 0, pnl: 0, realizedPnl: 0 };
  const side = exe.qty >= 0 ? 1 : -1;
  const qty = Math.abs(Number(exe.qty));
  const newQty = cur.qty + side * qty;
  const newAvg = newQty === 0 ? 0 : (cur.avgPrice * cur.qty + exe.price * qty * side) / newQty;
  POSITIONS.set(key, { ...cur, qty: newQty, avgPrice: Number(newAvg.toFixed(2)) });
}

export default function buildRouter() {
  return router;
}
