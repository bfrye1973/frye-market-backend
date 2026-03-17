import express from "express";
import { maybeSendInstantGoAlert } from "../../core/logic/alerts/instantGoPushover.js";

export const pushoverTestRouter = express.Router();

pushoverTestRouter.post("/test-pushover", async (req, res) => {
  const prevGo = { signal: false };
  const nextGo = {
    signal: true,
    direction: "LONG",
    triggerType: "TEST_PUSH",
    triggerLine: 0,
    atUtc: new Date().toISOString(),
    price: null,
    reasonCodes: ["TEST_PUSHOVER"],
    cooldownUntilMs: Date.now() - 1, // not in cooldown
  };

  const out = await maybeSendInstantGoAlert({
    symbol: "SPY",
    prevGo,
    nextGo,
  });

  res.json({ ok: true, out });
});
