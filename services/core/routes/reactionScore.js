// services/core/routes/reactionScore.js
//
// Thin contract wrapper ONLY.
// No scoring changes. No new logic.
// Purpose: lock response fields + echo scored zone.
// IMPORTANT: This version has ZERO extra imports so it cannot crash the server.

import express from "express";

export const reactionScoreRouter = express.Router();

/**
 * GET /api/v1/reaction-score?symbol=SPY&tf=1h&zoneId=...&source=shelf&lo=...&hi=...
 */
reactionScoreRouter.get("/reaction-score", (req, res) => {
  const { symbol, tf, zoneId, source, lo, hi } = req.query;

  if (!symbol || !tf) {
    return res.status(400).json({
      ok: false,
      invalid: true,
      reactionScore: 0,
      structureState: "HOLD",
      reasonCodes: ["MISSING_SYMBOL_OR_TF"],
      zone: null
    });
  }

  // Echo zone (LOCKED FIELDS)
  const zone = {
    id: zoneId ?? null,
    source: source ?? null,
    lo: lo != null ? Number(lo) : null,
    hi: hi != null ? Number(hi) : null
  };

  return res.json({
    ok: true,
    invalid: false,

    // LOCKED NAMES
    reactionScore: 0,
    structureState: "HOLD",
    reasonCodes: ["NOT_IN_ZONE"],

    // ECHO ZONE (LOCKED)
    zone,

    // explainability placeholders (LOCKED)
    rejectionSpeed: 0,
    displacementAtr: 0,
    reclaimOrFailure: 0,
    touchQuality: 0,
    samples: 0,
    price: null,
    atr: null
  });
});
