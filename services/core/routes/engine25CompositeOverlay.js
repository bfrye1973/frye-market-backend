// services/core/routes/engine25CompositeOverlay.js

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.join(
  __dirname,
  "..",
  "data",
  "engine25-composite-overlay-6mo.json"
);

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

router.get("/engine25/composite-overlay-6mo", (_req, res) => {
  try {
    const data = readJsonFile(DATA_FILE);

    if (!data) {
      return res.status(404).json({
        ok: false,
        error: "missing_engine25_composite_overlay_file",
        message:
          "Missing engine25-composite-overlay-6mo.json. Run node jobs/buildEngine25CompositeOverlay6mo.js first.",
        file: "data/engine25-composite-overlay-6mo.json",
      });
    }

    return res.json(data);
  } catch (err) {
    console.error("[engine25CompositeOverlay] failed:", err?.stack || err);

    return res.status(500).json({
      ok: false,
      error: "engine25_composite_overlay_error",
      detail: String(err?.message || err),
    });
  }
});

export default router;
