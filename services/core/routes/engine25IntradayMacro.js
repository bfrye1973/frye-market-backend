// services/core/routes/engine25IntradayMacro.js
// Read-only diagnostic route for Engine 25 Intraday Macro v0.1.
//
// GET /api/v1/engine25/intraday-macro
// - Reads the latest generated data/engine25-intraday-macro.json
// - Does NOT fetch providers
// - Does NOT run the update job
// - Does NOT mutate Engine 6 / Strategy 1 / execution state

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_FILE = path.join(
  CORE_DIR,
  "data",
  "engine25-intraday-macro.json"
);

function readLatestIntradayMacro() {
  if (!fs.existsSync(DATA_FILE)) {
    return {
      ok: false,
      engine: "engine25.intradayMacro.v0.1",
      error: "INTRADAY_MACRO_NOT_AVAILABLE",
      sourceFile: DATA_FILE,
    };
  }

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    return {
      ok: false,
      engine: "engine25.intradayMacro.v0.1",
      error: "INTRADAY_MACRO_FILE_INVALID",
      detail: error?.message || String(error),
      sourceFile: DATA_FILE,
    };
  }
}

router.get("/engine25/intraday-macro", (_req, res) => {
  const payload = readLatestIntradayMacro();
  res.status(payload?.ok === false ? 503 : 200).json(payload);
});

export default router;
