const express = require("express");
const router = express.Router();

const { computeEngine21Alignment } = require("../logic/engine21Alignment");

router.get("/api/v1/engine21-alignment", async (req, res) => {
  try {
    const tf = req.query.tf || "30m";

    const result = await computeEngine21Alignment({ tf });

    return res.json(result);
  } catch (err) {
    console.error("Engine 21 error:", err);
    return res.status(500).json({
      ok: false,
      error: "ENGINE_21_FAILED"
    });
  }
});

module.exports = router;
