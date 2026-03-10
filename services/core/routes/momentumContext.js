// momentumContext.js

const express = require("express");
const router = express.Router();

const buildMomentumContext = require(
  "../logic/engine45/buildMomentumContext"
);

router.get("/api/v1/momentum-context", async (req, res) => {
  const symbol = req.query.symbol || "SPY";

  try {
    const result = await buildMomentumContext(symbol);
    res.json(result);
  } catch (err) {
    res.json({
      ok: true,
      symbol,
      momentumState: "UNKNOWN"
    });
  }
});

module.exports = router;
