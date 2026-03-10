// services/core/routes/momentumContext.js

import express from "express";
import { buildMomentumContext } from "../logic/engine45/buildMomentumContext.js";

export const momentumContextRouter = express.Router();

momentumContextRouter.get("/momentum-context", async (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase().trim();

  try {
    const result = await buildMomentumContext(symbol);
    res.json(result);
  } catch (err) {
    res.json({
      ok: true,
      symbol,
      smi10m: {
        k: null,
        d: null,
        direction: "UNKNOWN",
        cross: "NONE",
      },
      smi1h: {
        k: null,
        d: null,
        direction: "UNKNOWN",
        cross: "NONE",
      },
      alignment: "MIXED",
      compression: {
        active: false,
        bars: 0,
        width: 0,
      },
      momentumState: "UNKNOWN",
      detail: String(err?.message || err),
    });
  }
});

export default momentumContextRouter;
