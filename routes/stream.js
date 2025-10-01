// routes/stream.js
// SSE endpoint for live OHLC streaming (safe + isolated)

import express from "express";

const router = express.Router();

// Fake aggregator for now (later you can plug Polygon/WebSocket)
function getBar(symbol, tf) {
  return {
    ok: true,
    type: "bar",
    symbol,
    tf,
    bar: {
      time: Math.floor(Date.now() / 1000), // seconds
      open: 600 + Math.random(),
      high: 601 + Math.random(),
      low: 599 + Math.random(),
      close: 600 + Math.random(),
      volume: Math.floor(Math.random() * 100000),
    },
  };
}

router.get("/agg", (req, res) => {
  const symbol = req.query.symbol || "SPY";
  const tf = req.query.tf || "10m";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = () => {
    const bar = getBar(symbol, tf);
    res.write(`data: ${JSON.stringify(bar)}\n\n`);
  };

  // send immediately, then every 5s
  send();
  const interval = setInterval(send, 5000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

export default router;
