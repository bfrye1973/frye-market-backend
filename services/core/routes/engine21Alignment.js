import express from "express";
import { computeEngine21Alignment } from "../logic/engine21Alignment.js";

const router = express.Router();

router.get("/engine21-alignment", async (req, res) => {
  try {
    const tf = req.query.tf || "30m";
    const result = await computeEngine21Alignment({ tf });
    res.json(result);
  } catch (err) {
    console.error("[engine21-alignment] error:", err);
    res.status(500).json({
      ok: false,
      error: "ENGINE_21_FAILED",
      detail: String(err?.message || err),
    });
  }
});

export default router;
