// services/core/routes/smzLevels.js
// Smart Money Zones API — INSTITUTIONAL ONLY
// NO CACHE, ALWAYS LATEST FILE
// 🔒 MICRO LEVELS ARE FILTERED OUT AT THE API BOUNDARY

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

// ESM dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Absolute path to generated SMZ output
const LEVELS_PATH = path.resolve(__dirname, "../data/smz-levels.json");

router.get("/", (req, res) => {
  // 🔥 CRITICAL: prevent browser / CDN caching
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (!fs.existsSync(LEVELS_PATH)) {
    return res.json({
      ok: true,
      levels: [],
      note: "SMZ levels file not generated yet",
    });
  }

  const raw = fs.readFileSync(LEVELS_PATH, "utf8");
  const json = JSON.parse(raw);

  // -------------------------------
  // 🔒 FILTER OUT MICRO LEVELS
  // -------------------------------
  const levelsRaw = Array.isArray(json.levels) ? json.levels : [];

  const levelsFiltered = levelsRaw.filter(
    (lvl) => lvl && lvl.tier !== "micro"
  );

  // Preserve everything else (meta, symbol, etc.)
  res.json({
    ...json,
    levels: levelsFiltered,
  });
});

export default router;
