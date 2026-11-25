// Strictly authenticated metadata-only immutable Engine29 receipt proof.
// Never expose raw JSON, arbitrary files, environment values or secrets.
import express from "express";
import {
  authenticateEngine29Verifier,
  verifyEngine29Receipt,
} from "../logic/engine29/verifyImmutableReceipt.js";

const router = express.Router();

router.get("/engine29/receipt-verify", (req, res) => {
  res.set("Cache-Control", "no-store");
  const authorization = authenticateEngine29Verifier(
    req.get("X-ENGINE-CRON-TOKEN"), process.env.ENGINE_CRON_TOKEN
  );
  if (!authorization.ok) return res.status(authorization.status).json({
    ok:false, exists:false, verified:false, exactMatch:false,
    reason: authorization.reason,
  });

  try {
    // Accept only explicit scalars; arrays/objects cannot become file paths.
    const result = verifyEngine29Receipt({
      date:req.query.date,
      filename:req.query.filename,
      replayDate:req.query.replayDate,
      replayTime:req.query.replayTime,
    });
    return res.status(result.status).json(result.body);
  } catch {
    // Never include filesystem paths, request tokens, or internal error text.
    return res.status(500).json({
      ok:false, exists:false, verified:false, exactMatch:false,
      reason:"VERIFY_INTERNAL_ERROR",
    });
  }
});

export default router;
