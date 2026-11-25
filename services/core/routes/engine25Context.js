// services/core/routes/engine25Context.js

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const ENGINE25_CONTEXT_FILE = path.join(DATA_DIR, "engine25-context.json");

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

router.get("/engine25/context", (_req, res) => {
  try {
    const context = readJsonFile(ENGINE25_CONTEXT_FILE);

    if (!context) {
      return res.status(404).json({
        ok: false,
        error: "missing_engine25_context",
        message: "Run node jobs/buildEngine25Context.js first.",
      });
    }

    return res.json(context);
  } catch (err) {
    console.error("[engine25Context] failed:", err?.stack || err);

    return res.status(500).json({
      ok: false,
      error: "engine25_context_error",
      detail: String(err?.message || err),
    });
  }
});

export default router;
