// services/core/routes/smzLevels.js
import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

// Path to the generated Smart Money JSON file
const levelsPath = path.resolve("services/core/data/smz-levels.json");

router.get("/", async (req, res) => {
  try {
    if (!fs.existsSync(levelsPath)) {
      return res.json({ ok: true, levels: [], note: "No SMZ levels generated yet" });
    }

    const raw = fs.readFileSync(levelsPath, "utf8");
    const json = JSON.parse(raw);

    res.json({ ok: true, ...json });
  } catch (err) {
    console.error("[/api/v1/smz-levels] error:", err);
    res.status(500).json({ ok: false, error: "Failed to load Smart Money levels" });
  }
});

export default router;
