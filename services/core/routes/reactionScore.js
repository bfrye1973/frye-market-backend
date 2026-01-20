// src/services/core/routes/reactionScore.js
//
// Thin contract wrapper ONLY.
// No scoring changes. No logic changes.
// Purpose: lock response fields + echo scored zone.

import express from "express";
import { computeReactionQuality } from "../logic/reactionQualityEngine.js";
import { getBarsForSymbolTf } from "../data/ohlcProvider.js"; // existing provider
import { getActiveZone } from "../logic/activeZoneResolver.js"; // institutional|shelf selector

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

    // 2) Get bars + ATR (existing infra)
    const { bars, atr } = await getBarsForSymbolTf(symbol, tf);

    // 3) Compute (UNCHANGED)
    const rqe = computeReactionQuality({
      bars,
      zone,
      atr,
      opts: { tf }
    });

    // 4) NOT IN ZONE gate (contract rule)
    if (rqe.flags?.NO_TOUCH) {
      return res.json({
        ok: true,
        reactionScore: 0,
        reasonCodes: ["NOT_IN_ZONE"]
      });
    }

    // 5) Locked response contract
    res.json({
      ok: true,
      reactionScore: rqe.reactionScore,          // LOCKED NAME
      invalid: false,
      reasonCodes: [],

      zone: {                                   // ECHO ZONE (LOCKED)
        id: zone.id ?? null,
        source: zone.source ?? null,
        lo: zone.lo,
        hi: zone.hi
      },

      rejectionSpeed: rqe.rejectionSpeedPoints * 2.5, // normalized 0–10
      displacementAtr: rqe.displacementPoints * 2.5,  // normalized 0–10
      reclaimOrFailure: rqe.structurePoints * 5,      // HOLD=10, RECLAIM=5, FAIL=0
      touchQuality: rqe.touchIndex != null ? 10 : 0,

      samples: rqe.windowBars,
      price: bars[bars.length - 1]?.close,
      atr: rqe.atr,
      structureState: rqe.structureState            // LOCKED NAME
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      invalid: true,
      reasonCodes: ["REACTION_SCORE_ERROR"],
      message: err.message
    });
  }
});
