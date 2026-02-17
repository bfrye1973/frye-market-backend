// src/services/core/routes/reactionQuality.js
import express from "express";
import { computeReactionQuality } from "../logic/reactionQualityEngine.js";

export const reactionQualityRouter = express.Router();

/**
 * POST /api/v1/reaction-quality
 *
 * Body:
 * {
 *   "bars": [{open,high,low,close,volume,ts?}, ...]   // chronological
 *   "zone": { "lo": 686.0, "hi": 688.7, "side": "demand", "id": "..." }
 *   "atr": 2.15                                      // or array aligned with bars
 *   "opts": { "tf":"1h", "windowBars":6, "breakDepthAtr":0.25, "reclaimWindowBars":3 }
 * }
 */
reactionQualityRouter.post("/reaction-quality", express.json({ limit: "5mb" }), (req, res) => {
  try {
    const { bars, zone, atr, opts } = req.body || {};
    const out = computeReactionQuality({ bars, zone, atr, opts });
    res.status(200).json(out);
  } catch (err) {
    res.status(400).json({
      error: "RQE_BAD_REQUEST",
      message: err?.message || String(err),
    });
  }
});
