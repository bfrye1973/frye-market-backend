// services/core/routes/chartOverlay.js
// GET /api/v1/chart-overlay?symbol=SPY&tf=30m

import express from "express";
import computeChartOverlay from "../logic/engine17ChartOverlay.js";

export const chartOverlayRouter = express.Router();

chartOverlayRouter.get("/chart-overlay", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || req.query.timeframe || "30m").toLowerCase();

    const result = await computeChartOverlay({ symbol, tf });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "ENGINE17_ERROR",
      detail: err?.message || String(err),
    });
  }
});

export default chartOverlayRouter;
