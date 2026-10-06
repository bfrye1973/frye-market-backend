// services/core/routes/smzLevels.js
// Smart Money Zones API — INSTITUTIONAL ONLY
// NO CACHE, ALWAYS LATEST FILE
// 🔒 MICRO LEVELS ARE FILTERED OUT AT THE API BOUNDARY
// ✅ pockets_active is preserved and returned for chart overlays

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEVELS_PATH = path.resolve(__dirname, "../data/smz-levels.json");

router.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (!fs.existsSync(LEVELS_PATH)) {
    return res.json({
      ok: true,
      levels: [],
      pockets_active: [],
      note: "SMZ levels file not generated yet",
    });
  }

  const raw = fs.readFileSync(LEVELS_PATH, "utf8");
  const json = JSON.parse(raw);

  // Filter MICRO out of levels only (structures + pockets remain)
  const levelsRaw = Array.isArray(json.levels) ? json.levels : [];
  const levelsFiltered = levelsRaw.filter((lvl) => lvl && lvl.tier !== "micro");

  // ✅ Preserve pockets_active (do not filter it)
  const pocketsActive = Array.isArray(json.pockets_active) ? json.pockets_active : [];

  res.json({
    ...json,
    levels: levelsFiltered,
    pockets_active: pocketsActive,
  });
});

export default router;
