// src/services/core/routes/reactionScore.js
//
// Thin contract wrapper ONLY.
// NO scoring changes.
// NO new logic.
// Purpose: lock response fields + echo scored zone.
// NOTE: Bars/ATR intentionally NOT fetched yet (to avoid crashes).

import express from "express";
import { computeReactionQuality } from "../logic/reactionQualityEngine.js";
import { getActiveZone } from "../logic/activeZoneResolver.js";

export const reactionScoreRouter = express.Router();

/**
 * GET /api/v1/reaction-score
 *
 * Required:
 *   symbol=SPY
 *   tf=1h
 *
 * Optional:
 *   zoneId=
 *   source=institutional|shelf
 *   lo=
 *   hi=
 */
reactionScoreRouter.get("/reaction-score", async (req, res) => {
  try {
    const { symbol, tf, zoneId, source, lo, hi } = req.query;

    if (!symbol || !tf) {
      return res.status(400).json({
        ok: false,
        invalid: true,
        reasonCodes: ["MISSING_SYMBOL_OR_TF"]
      });
    }

    // 1) Resolve active zone (NO new logic)
    const zone = getActiveZone({
      symbol,
      tf,
      zoneId,
      source,
      lo: lo ? Number(lo) : undefined,
      hi: hi ? Number(hi) : undefined
    });

    if (!zone) {
      return res.json({
        ok: true,
        reactionScore: 0,
        reasonCodes: ["NO_ACTIVE_ZONE"]
      });
    }

    // ------------------------------------------------------------
    // TEMPORARY SAFE EXIT (NO BARS YET — DO NOT CRASH SERVER)
    // ------------------------------------------------------------
    return res.json({
      ok: true,
      reactionScore: 0,
      invalid: false,
      reasonCodes: ["NOT_IN_ZONE"],

      zone: {
        id: zone.id ?? null,
        source: zone.source ?? null,
        lo: zone.lo,
        hi: zone.hi
      },

      rejectionSpeed: 0,
      displacementAtr: 0,
      reclaimOrFailure: 0,
      touchQuality: 0,

      samples: 0,
      price: null,
      atr: null,
      structureState: "HOLD"
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      invalid: true,
      reasonCodes: ["REACTION_SCORE_ERROR"],
      message: err.message
    });
  }
});
