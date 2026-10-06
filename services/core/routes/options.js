import express from "express";
import {
  optionsStatus,
  listExpirations,
  getChain,
  selectContract
} from "../logic/options/optionsService.js";

const router = express.Router();

/**
 * GET /api/v1/options/status
 */
router.get("/status", async (req, res) => {
  res.json(await optionsStatus());
});

/**
 * GET /api/v1/options/expirations?symbol=SPY
 * SPY only (locked)
 */
router.get("/expirations", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    res.json(await listExpirations(symbol));
  } catch (err) {
    res.status(500).json({ ok: false, reason: "OPTIONS_ERROR", message: String(err?.message || err) });
  }
});

/**
 * GET /api/v1/options/chain?symbol=SPY&exp=YYYY-MM-DD&right=CALL|PUT
 * Returns a normalized chain list including openInterest + volume (when available)
 */
router.get("/chain", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const exp = String(req.query.exp || "").trim();
    const right = String(req.query.right || "CALL").toUpperCase();
    res.json(await getChain({ symbol, exp, right }));
  } catch (err) {
    res.status(500).json({ ok: false, reason: "OPTIONS_ERROR", message: String(err?.message || err) });
  }
});

/**
 * GET /api/v1/options/select?symbol=SPY&strategyId=intraday_scalp@10m&bias=BULL|BEAR
 * Applies your locked selection rules:
 * - scalp: strike = floor(spot)+1, exp = nearest >= today
 * - swing: exp ~ 7-14 days (target +10); strike via OI/Vol scoring (ATM±5)
 * - long: exp ~ 28-35 days (target +30); strike via OI/Vol scoring (ATM±10)
 * - BULL => CALL, BEAR => PUT
 */
router.get("/select", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const strategyId = String(req.query.strategyId || "").trim();
    const bias = String(req.query.bias || "BULL").toUpperCase();
    res.json(await selectContract({ symbol, strategyId, bias }));
  } catch (err) {
    res.status(500).json({ ok: false, reason: "OPTIONS_ERROR", message: String(err?.message || err) });
  }
});

export default router;
