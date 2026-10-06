import express from "express";
import { selectScalpOption } from "../logic/options/scalpOptionSelector.js";

const router = express.Router();

/**
 * GET /api/v1/options/scalp-select?symbol=SPY&bias=long
 *
 * Locked rules:
 * - SPY only
 * - intraday_scalp@10m only
 * - 1DTE only
 * - strike = floor(SPY) + 1
 * - long => CALL
 * - short => PUT
 */
router.get("/scalp-select", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const bias = String(req.query.bias || "").toLowerCase();

    const out = await selectScalpOption({ symbol, bias });
    res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    res.status(500).json({
      ok: false,
      reason: "SCALP_OPTION_SELECTOR_ERROR",
      message: String(err?.message || err)
    });
  }
});

export default router;
