// services/core/routes/morningFib.js
// GET /api/v1/morning-fib?symbol=SPY&tf=30m

import express from "express";
import { computeMorningFib } from "../logic/engine16MorningFib.js";

export const morningFibRouter = express.Router();

morningFibRouter.get("/morning-fib", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || req.query.timeframe || "30m").toLowerCase();

    const result = await computeMorningFib({
      symbol,
      tf,
      includeZones: true,
      includeVolume: true,
    });

    const status =
      result?.ok === false && result?.error === "OHLC_UNAVAILABLE" ? 502 : 200;

    return res.status(status).json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      context: "NONE",
      state: "NO_IMPULSE",
      error: "ENGINE16_ERROR",
      detail: err?.message || String(err),
    });
  }
});

export default morningFibRouter;
