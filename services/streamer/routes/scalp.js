// services/streamer/routes/scalp.js
import express from "express";
import { engine5bState } from "../engine5b/state.js";

const router = express.Router();
export default router;

// JSON status
router.get("/scalp-status", (_req, res) => {
  res.json(engine5bState);
});

// SSE events (simple heartbeat)
router.get("/scalp-events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let alive = true;
  const timer = setInterval(() => {
    if (!alive) return;
    res.write(`data: ${JSON.stringify({ type: "status", t: Date.now(), state: engine5bState })}\n\n`);
  }, 2000);

  req.on("close", () => {
    alive = false;
    clearInterval(timer);
    try { res.end(); } catch {}
  });
});
