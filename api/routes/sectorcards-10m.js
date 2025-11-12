import express from "express";
import { runSectorModel } from "../../algos/index-sectors/10m/formulas.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await runSectorModel();
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error("sectorcards-10m error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
