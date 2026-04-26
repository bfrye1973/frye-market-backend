import express from "express";
import { getExecutionState } from "../logic/execution/executionStateService.js";

const router = express.Router();

router.get("/", (req, res) => {
  const symbol = req.query.symbol;
  const strategyId = req.query.strategyId;

  if (!symbol || !strategyId) {
    return res.status(400).json({
      ok: false,
      reason: "MISSING_PARAMS",
    });
  }

  const state = getExecutionState(symbol, strategyId);
  res.json(state);
});

export default router;
