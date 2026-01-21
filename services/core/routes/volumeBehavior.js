// src/services/core/routes/volumeBehavior.js
//
// Thin contract wrapper ONLY.
// No scoring changes. No logic changes.
//
// GET /api/v1/volume-behavior?symbol=SPY&tf=1h&zoneLo=475.2&zoneHi=476.1
// Optional: touchIndex, lookback, reactionScore
//
// NOTE: Bars retrieval must be wired to your existing provider.
// I left a single function stub `fetchBars(...)` for you to connect.

import express from "express";
import { computeVolumeBehavior } from "../logic/volumeBehaviorEngine.js";

export const volumeBehaviorRouter = express.Router();

async function fetchBars(/* symbol, tf, limit */) {
  // ✅ WIRE THIS to your existing bars provider (Polygon / cached JSON / etc.)
  // Must return bars in ascending time order, newest last:
  // [{ t, o, h, l, c, v }, ...]
  //
  // If you tell me the exact provider file you use in core (one path),
  // I’ll replace this stub with the correct import + call in one shot.
  throw new Error("fetchBars() not wired");
}

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

    // Bars count: we need enough to compute AVGV20 + pullback/reversal windows.
    // Safe default:
    const limit = Math.max(120, lookback + 40);

    const bars = await fetchBars(symbol, tf, limit);

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
