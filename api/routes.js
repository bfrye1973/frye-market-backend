// api/routes.js (ESM)
// Drop-in router for Render/Express backends.
// Provides working mock endpoints so your frontend is alive immediately.
// Later, replace the MOCK_* functions with real Thinkorswim/Schwab calls.

import express from "express";

const router = express.Router();

/* ----------------------------- simple in-memory ---------------------------- */
let ORDERS = [];          // [{ id, status, ... }]
let EXECUTIONS = [];      // [{ id, orderId, symbol, qty, price, time }]
let POSITIONS = new Map(); // symbol -> { symbol, qty, avgPrice, pnl:0, realizedPnl:0 }
let KILL_SWITCH = false;

// Generate a simple id
const nid = (p = "ORD") => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/* --------------------------------- health --------------------------------- */
router.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), service: "frye-market-backend" });
});

/* ------------------------------- trading status --------------------------- */
router.get("/trading/status", (req, res) => {
  // Mode PAPER by default; LIVE remains read-only until you enable it.
  res.json({ broker: "tos", mode: "PAPER", connected: true, liveEnabled: false, lastHeartbeat: new Date().toISOString() });
});

/* ----------------------------------- risk --------------------------------- */
router.get("/risk/status", (req, res) => {
  res.json({
    killSwitch: KILL_SWITCH,
    caps: { maxOrderQty: 1000, maxDailyLoss: 2000 },
  });
});

router.post("/risk/kill", (req, res) => {
  KILL_SWITCH = true;
  res.json({ killSwitch: true });
});

/* --------------------------------- options -------------------------------- */
// MOCK: expirations (next 8 Saturdays)
function MOCK_expirations(symbol = "SPY") {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7) + i * 7); // next Sat + i weeks
    const iso = d.toISOString().slice(0, 10);
    out.push(iso);
  }
  return out;
}

// MOCK: simple chain generator around a center strike
function MOCK_chain({ symbol = "SPY", expiration, side = "call" }) {
  // Pick a notional underlying price (you can swap to real quote later)
  const last = 500; // pretend SPY @ 500
  const steps = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
  return steps.map((k) => {
    const strike = Math.round((last + k * 5) * 100) / 100;
    const m = Math.max(0.2, 5 - Math.abs(k)) / 2; // mark ~ premium
    const bid = Math.max(0, m - 0.05);
    const ask = m + 0.05;
    const delta = side === "call" ? 0.5 - Math.abs(k) * 0.05 : -0.5 + Math.abs(k) * 0.05;
    return {
      strike,
      mark: Number(m.toFixed(2)),
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
  res.json({ symbol: String(symbol).toUpperCase(), expirations: MOCK_expirations(symbol) });
});

// GET /api/options/chain?symbol=SPY&expiration=YYYY-MM-DD&side=call|put
router.get("/options/chain", (req, res) => {
  const { symbol = "SPY", expiration, side = "call" } = req.query;
  if (!expiration) return res.status(400).json({ ok: false, error: "Missing 'expiration' (YYYY-MM-DD)" });
  const rows = MOCK_chain({ symbol, expiration, side: String(side).toLowerCase() });
  res.json(rows);
});

/* --------------------------------- orders --------------------------------- */
// Lists
router.get("/trading/orders", (req, res) => res.json(ORDERS));
router.get("/trading/executions", (req, res) => res.json(EXECUTIONS));
router.get("/trading/positions", (req, res) => res.json(Array.from(POSITIONS.values())));

// Place (PAPER)
router.post("/trading/orders", express.json(), (req, res) => {
  if (KILL_SWITCH) return res.status(403).json({ ok: false, error: "Kill switch engaged" });

  const idem = req.header("X-Idempotency-Key") || "";
  const body = req.body || {};

  // Basic validation
  if (body.assetType === "EQUITY") {
    const { symbol, side, qty, orderType } = body;
    if (!symbol || !side || !qty || !orderType) return res.status(400).json({ ok: false, error: "Missing equity fields" });
  } else if (body.assetType === "OPTION") {
    const { underlying, right, expiration, strike, qty, orderType } = body;
    if (!underlying || !right || !expiration || !strike || !qty || !orderType)
      return res.status(400).json({ ok: false, error: "Missing option fields" });
  } else {
    return res.status(400).json({ ok: false, error: "assetType must be EQUITY or OPTION" });
  }

  const id = nid("ORD");
  const now = new Date().toISOString();

  const order = {
    id,
    idempotencyKey: idem,
    status: "NEW",
    createdAt: now,
    updatedAt: now,
    ...body,
    symbol: body.symbol || body.underlying || "SPY",
  };
  ORDERS.unshift(order);

  // PAPER fill logic: immediately fill MARKET orders, leave others as WORKING
  if (String(body.orderType).toUpperCase() === "MKT" || String(body.orderType).toUpperCase() === "MARKET") {
    order.status = "FILLED";
    order.updatedAt = new Date().toISOString();
    const px = mockFillPrice(order);
    const ex = { id: nid("EXE"), orderId: order.id, symbol: order.symbol, qty: Number(body.qty), price: px, time: new Date().toISOString() };
    EXECUTIONS.unshift(ex);
    applyPosition(ex, body.assetType);
  } else {
    order.status = "WORKING";
  }

  res.status(201).json({ id: order.id, status: order.status });
});

// Cancel
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

/* ------------------------------- helpers ---------------------------------- */
function mockFillPrice(order) {
  // fake fill price based on assetType
  if (order.assetType === "OPTION") {
    // per-contract price (premium)
    return Number((order.limitPrice ?? order.stopPrice ?? 2.45).toFixed(2));
  }
  // equity
  return Number((order.limitPrice ?? order.stopPrice ?? 500.0).toFixed(2));
}

function applyPosition(exe, assetType) {
  // Track positions by 'symbol' only (simple).
  const key = exe.symbol;
  const cur = POSITIONS.get(key) || { symbol: key, qty: 0, avgPrice: 0, pnl: 0, realizedPnl: 0 };
  const side = +exe.qty >= 0 ? 1 : -1;
  const qty = Math.abs(Number(exe.qty));
  // P&L math simplified for demo
  const newQty = cur.qty + side * qty;
  const newAvg = newQty === 0 ? 0 : (cur.avgPrice * cur.qty + exe.price * qty * side) / newQty;
  POSITIONS.set(key, { ...cur, qty: newQty, avgPrice: Number(newAvg.toFixed(2)) });
}

export default router;
