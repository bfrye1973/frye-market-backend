// routes/alignment.cjs
const express = require("express");
const router = express.Router();

router.get("/", async (req, res) => {
  const strat = String(req.query.strategy || "").toLowerCase();
  if (strat !== "alignment") return res.json({ status: "live", items: [] });

  // TEMP stub so UI has fresh data (replace later with real logic)
  const ts = new Date().toISOString();
  return res.json({
    status: "live",
    signal: {
      timestamp: ts,
      strategy: "alignment",
      direction: "none",          // "long" | "short" | "none"
      confirm_count: 4,           // 0..6 over {SPY,QQQ,IWM,MDY,DIA,VIX}
      streak_bars: 1,
      confidence: 65,
      members: {
        SPY: { ok: true }, QQQ: { ok: true },
        IWM: { ok: false }, MDY: { ok: true },
        DIA: { ok: false }, "I:VIX": { ok: true }
      }
    }
  });
});

module.exports = router;
