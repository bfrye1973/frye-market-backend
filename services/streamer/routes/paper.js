// services/streamer/routes/paper.js
// Paper-trading module: in-memory positions + orders + SSE status
// Endpoints:
//   POST /paper/execute   → place a paper order (instant fill MVP)
//   POST /paper/mark      → update last price for PnL
//   GET  /paper/positions → current positions
//   GET  /paper/orders    → recent orders
//   GET  /paper/status    → SSE stream of { positions, orders }

import express from "express";

const paperRouter = express.Router();

/* ------------------------ In-memory state ------------------------ */
const state = {
  positions: Object.create(null), // symbol -> { qty, avgPrice, last, realizedPnL, updated }
  orders: [],                     // [{ id, ts, symbol, side, qty, price, status }]
  clients: new Set(),             // Set<res> for SSE
};

let orderSeq = 1;
const nowSec = () => Math.floor(Date.now() / 1000);

function pushOrder(o) {
  state.orders.push(o);
  if (state.orders.length > 1000) state.orders.shift();
}

function snapshot() {
  const positions = Object.fromEntries(
    Object.entries(state.positions).map(([sym, p]) => {
      const unreal = (p.last != null && p.qty)
        ? (p.last - p.avgPrice) * p.qty
        : 0;
      return [sym, {
        qty: p.qty,
        avgPrice: p.avgPrice,
        last: p.last ?? null,
        realizedPnL: p.realizedPnL || 0,
        unrealizedPnL: unreal,
        updated: p.updated || 0,
      }];
    })
  );
  return { ts: nowSec(), positions, orders: state.orders.slice(-200) };
}

function broadcast() {
  const msg = `data: ${JSON.stringify({ ok:true, type:"paper/status", snapshot: snapshot() })}\n\n`;
  for (const res of state.clients) { try { res.write(msg); } catch {} }
}

/* --------------------------- Fills & Marks --------------------------- */
function applyFill(symbol, side, qty, price) {
  const now = nowSec();
  const p = state.positions[symbol] || { qty: 0, avgPrice: 0, last: null, realizedPnL: 0, updated: now };
  let newQty = p.qty;
  let realized = p.realizedPnL || 0;

  if (side === "BUY") {
    const cost = p.avgPrice * p.qty + price * qty;
    newQty = p.qty + qty;
    const newAvg = newQty > 0 ? cost / newQty : 0;
    state.positions[symbol] = { ...p, qty: newQty, avgPrice: newAvg, last: price, realizedPnL: realized, updated: now };
  } else if (side === "SELL") {
    const sellQty = Math.min(qty, Math.abs(p.qty));
    const pnlPerShare = (price - p.avgPrice) * Math.sign(p.qty || 1); // assumes long for MVP
    realized += pnlPerShare * sellQty;
    newQty = p.qty - sellQty;
    const newAvg = newQty > 0 ? p.avgPrice : 0; // reset avg when flat
    state.positions[symbol] = { ...p, qty: newQty, avgPrice: newAvg, last: price, realizedPnL: realized, updated: now };
  } else {
    throw new Error("Invalid side");
  }
}

function recordMark(symbol, lastPrice) {
  const p = state.positions[symbol] || { qty: 0, avgPrice: 0, last: null, realizedPnL: 0, updated: nowSec() };
  state.positions[symbol] = { ...p, last: lastPrice, updated: nowSec() };
}

/* ------------------------------ Routes ------------------------------ */

// Place a paper order (instant fill MVP)
paperRouter.post("/execute", express.json({ limit: "16kb" }), (req, res) => {
  try {
    const { symbol, side, qty, price, ts } = req.body || {};
    const sym = String(symbol || "").toUpperCase();
    const s = String(side || "").toUpperCase();
    const q = Number(qty || 0);
    const px = Number(price || 0);
    const t = Number.isFinite(ts) ? ts : nowSec();

    if (!sym || (s !== "BUY" && s !== "SELL") || !Number.isFinite(q) || q <= 0 || !Number.isFinite(px) || px <= 0) {
      return res.status(400).json({ ok:false, error:"Invalid order payload. Expect {symbol, side:BUY|SELL, qty>0, price>0}" });
    }

    const id = `PAPER-${t}-${orderSeq++}`;
    applyFill(sym, s, q, px);
    pushOrder({ id, ts: t, symbol: sym, side: s, qty: q, price: px, status: "filled" });
    recordMark(sym, px);
    broadcast();

    return res.json({ ok:true, orderId:id, status:"filled" });
  } catch (e) {
    return res.status(500).json({ ok:false, error:String(e?.message || e) });
  }
});

// Update last price (for unrealized PnL)
paperRouter.post("/mark", express.json({ limit: "8kb" }), (req, res) => {
  const { symbol, last } = req.body || {};
  const sym = String(symbol || "").toUpperCase();
  const px = Number(last);
  if (!sym || !Number.isFinite(px) || px <= 0) {
    return res.status(400).json({ ok:false, error:"Invalid mark. Expect {symbol, last>0}" });
  }
  recordMark(sym, px);
  broadcast();
  return res.json({ ok:true });
});

// Snapshots
paperRouter.get("/positions", (_req, res) => res.json({ ok:true, positions: snapshot().positions }));
paperRouter.get("/orders", (_req, res) => res.json({ ok:true, orders: state.orders.slice(-200) }));

// Live SSE status (positions + recent orders)
paperRouter.get("/status", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  state.clients.add(res);
  // initial snapshot
  res.write(`data: ${JSON.stringify({ ok:true, type:"paper/status", snapshot: snapshot() })}\n\n`);

  const ping = setInterval(() => { try { res.write(":ping\n\n"); } catch {} }, 15000);

  req.on("close", () => {
    clearInterval(ping);
    state.clients.delete(res);
    try { res.end(); } catch {}
  });
});

export default paperRouter;
