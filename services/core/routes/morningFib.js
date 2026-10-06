// services/core/routes/morningFib.js
// GET /api/v1/morning-fib?symbol=SPY&tf=30m

import express from "express";
import { readFile } from "fs/promises";
import { computeMorningFib } from "../logic/engine16MorningFib.js";

export const morningFibRouter = express.Router();

morningFibRouter.get("/morning-fib", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || req.query.timeframe || "30m").toLowerCase();

    let engine2Context = null;

    try {
      const snapshotPath =
        "/opt/render/project/src/services/core/data/strategy-snapshot.json";
      const raw = await readFile(snapshotPath, "utf8");
      const parsed = JSON.parse(raw);

      const strat = parsed?.strategies?.["intraday_scalp@10m"];
      const engine2 = strat?.engine2 ?? null;

      if (engine2) {
        engine2Context = {
          primary: parsed?.engine2State?.primary ?? null,
          intermediate: parsed?.engine2State?.intermediate ?? null,
          minor: engine2,
        };
      }
    } catch {
      engine2Context = null;
    }

    const result = await computeMorningFib({
      symbol,
      tf,
      includeZones: true,
      includeVolume: true,
      engine2Context,
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
