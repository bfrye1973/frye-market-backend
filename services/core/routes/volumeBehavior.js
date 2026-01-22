// src/services/core/routes/volumeBehavior.js
//
// Thin contract wrapper ONLY.
// No scoring changes. No logic changes.
//
// GET /api/v1/volume-behavior?symbol=SPY&tf=1h&zoneLo=475.2&zoneHi=476.1
// Optional: touchIndex, lookback, reactionScore

import express from "express";
import { computeVolumeBehavior } from "../logic/volumeBehaviorEngine.js";
import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";

export const volumeBehaviorRouter = express.Router();

volumeBehaviorRouter.get("/volume-behavior", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "1h");

    const zoneLo = req.query.zoneLo != null ? Number(req.query.zoneLo) : null;
    const zoneHi = req.query.zoneHi != null ? Number(req.query.zoneHi) : null;

    if (!(Number.isFinite(zoneLo) && Number.isFinite(zoneHi))) {
      return res.status(400).json({
        error: "MISSING_ZONE_RANGE",
        message: "Provide zoneLo and zoneHi (numbers). Engine 1 owns zone selection.",
      });
    }

    const zone = { lo: zoneLo, hi: zoneHi };

    const lookback = req.query.lookback != null ? Number(req.query.lookback) : 60;
    const touchIndex = req.query.touchIndex != null ? Number(req.query.touchIndex) : null;
    const reactionScore = req.query.reactionScore != null ? Number(req.query.reactionScore) : null;

    // ✅ polygonBars.js takes DAYS, not bar count.
    // We choose safe defaults per timeframe.
    const days =
      tf === "1m" ? 5 :
      tf === "5m" ? 10 :
      tf === "10m" ? 14 :
      tf === "15m" ? 21 :
      tf === "30m" ? 35 :
      tf === "1h" ? 60 :
      tf === "4h" ? 180 :
      120;

    const bars = await getBarsFromPolygon(symbol, tf, days, { mode: "intraday" });

    const result = computeVolumeBehavior({
      bars,
      zone,
      touchIndex,
      reactionScore,
      opts: { lookbackBars: lookback },
    });

    return res.json({
      symbol,
      tf,
      zone,
      ...result,
    });
  } catch (err) {
    return res.status(500).json({
      error: "VOLUME_BEHAVIOR_ERROR",
      message: err?.message || String(err),
    });
  }
});
