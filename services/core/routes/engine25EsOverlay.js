// services/core/routes/engine25EsOverlay.js

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const OVERLAY_FILE = path.join(DATA_DIR, "engine25-es-overlay.json");

function readJsonSafe(file) {
  if (!fs.existsSync(file)) {
    return {
      ok: false,
      missing: true,
      file,
      error: `Missing file: ${file}`,
    };
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return {
      ok: false,
      file,
      error: `Invalid JSON: ${err.message}`,
    };
  }
}

// Engine 25 ES Overlay
router.get("/engine25/es-overlay", (_req, res) => {
  const overlay = readJsonSafe(OVERLAY_FILE);

  if (!overlay?.ok) {
    return res.status(503).json({
      ok: false,
      engine: "engine25.esOverlay.route",
      error: "engine25_es_overlay_unavailable",
      detail: overlay?.error || "Engine 25 ES overlay file is not ready.",
      dataFile: OVERLAY_FILE,
    });
  }

  return res.json({
    ok: true,
    engine: "engine25.esOverlay.route",
    servedAt: new Date().toISOString(),
    data: overlay,
  });
});

export default router;
