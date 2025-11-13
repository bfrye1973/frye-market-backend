// api/routes.js — Express Router exporting options + paper-trading mock endpoints
// Everything is in-memory so the UI lights up immediately.

import express from "express";
import sectorcards10m from "./sectorcards-10m.js";


const router = express.Router();

/* ------------------------------ in-memory state ------------------------------ */
let ORDERS = [];            // [{ id, status, ...payload }]
let EXECUTIONS = [];        // [{ id, orderId, symbol, qty, price, time }]
let POSITIONS = new Map();  // symbol -> { symbol, qty, avgPrice, pnl, realizedPnl }
let KILL = false;

const nid = (p = "ORD") =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

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
// next 8 Saturday expirations
function mockExpirations() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    const add = ((6 - d.getDay() + 7) % 7) + i * 7; // next Sat + i weeks
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
      mark: +mark.toFixed(2),
      bid: +bid.toFixed(2),
      ask: +ask.toFixed(2),
      delta: +delta.toFixed(2),
      theta: +(-0.04 + k * 0.002).toFixed(3),
      gamma: +(0.02 - Math.abs(k) * 0.0015).toFixed(3),
      vega: +(0.11 - Math.abs(k) * 0.002).toFixed(3),
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
  const { expiration, side = "call" } = req.query;
  if (!expiration)
    return res.status(400).json({ ok: false, error: "Missing 'expiration' (YYYY-MM-DD)" });
  res.json(mockChain({ side: String(side).toLowerCase() }));
});

/* ---------------------------------- orders ---------------------------------- */
// lists
router.get("/trading/orders",     (req, res) => res.json(ORDERS));
router.get("/trading/executions", (req, res) => res.json(EXECUTIONS));
router.get("/trading/positions",  (req, res) => res.json(Array.from(POSITIONS.values())));

// place (PAPER)
router.post("/trading/orders", (req, res) => {
  if (KILL) return res.status(403).json({ ok: false, error: "Kill switch engaged" });

  const b = req.body || {};
  const idem = req.header("X-Idempotency-Key") || "";

  // validate payloads
  if (b.assetType === "EQUITY") {
    const { symbol, side, qty, orderType } = b;
    if (!symbol || !side || !qty || !orderType)
      return res.status(400).json({ ok: false, error: "Missing equity fields" });
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

  // instant PAPER fill for market orders; others left WORKING
  const typ = String(b.orderType).toUpperCase();
  if (typ === "MKT" || typ === "MARKET") {
    order.status = "FILLED";
    order.updatedAt = new Date().toISOString();
    const px =
      b.assetType === "OPTION"
        ? +(b.limitPrice ?? b.stopPrice ?? 2.45).toFixed(2) // premium per contract
        : +(b.limitPrice ?? b.stopPrice ?? 500.0).toFixed(2); // equity price
    const exe = {
      id: nid("EXE"),
      orderId: order.id,
      symbol: order.symbol,
      qty: Number(b.qty),
      price: px,
      time: new Date().toISOString(),
    };
    EXECUTIONS.unshift(exe);

    // very simple position math
    const key = exe.symbol;
    const cur = POSITIONS.get(key) || { symbol: key, qty: 0, avgPrice: 0, pnl: 0, realizedPnl: 0 };
    const side = exe.qty >= 0 ? 1 : -1;
    const q = Math.abs(Number(exe.qty));
    const newQty = cur.qty + side * q;
    const newAvg = newQty === 0 ? 0 : (cur.avgPrice * cur.qty + exe.price * q * side) / newQty;
    POSITIONS.set(key, { ...cur, qty: newQty, avgPrice: +newAvg.toFixed(2) });
  } else {
    order.status = "WORKING";
  }

  res.status(201).json({ id: order.id, status: order.status });
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
  res.json({ id, status: "CANCELLED" });
});
router.use("/live/sectorcards-10m", sectorcards10m);

export default router; // <- default export: an Express Router
