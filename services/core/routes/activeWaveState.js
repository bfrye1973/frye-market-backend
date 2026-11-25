// services/core/routes/activeWaveState.js
// GET /api/v1/waves/active?symbol=ES
// Returns the complete active wave state file unchanged.
//
// Phase 1 contract:
// - ES is the only supported symbol.
// - symbol defaults to ES.
// - Active wave state is read from:
//   data/waves/active/active-wave-state-es.json
// - This route does not calculate Elliott waves or fib levels.

import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPPORTED_SYMBOLS = new Set(["ES"]);
const SYMBOL_PATTERN = /^[A-Z0-9._-]{1,20}$/;

const ACTIVE_WAVE_FILES = {
  ES: {
    relative: "data/waves/active/active-wave-state-es.json",
    absolute: path.resolve(
      __dirname,
      "../data/waves/active/active-wave-state-es.json"
    ),
  },
};

const activeWaveStateRouter = Router();

activeWaveStateRouter.get("/waves/active", (req, res) => {
  const symbol = String(req.query.symbol || "ES").toUpperCase().trim();

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  if (!SYMBOL_PATTERN.test(symbol) || !SUPPORTED_SYMBOLS.has(symbol)) {
    return res.status(400).json({
      ok: false,
      error: "UNSUPPORTED_SYMBOL",
      symbol,
      supportedSymbols: Array.from(SUPPORTED_SYMBOLS),
    });
  }

  const file = ACTIVE_WAVE_FILES[symbol];

  if (!file || !fs.existsSync(file.absolute)) {
    return res.status(404).json({
      ok: false,
      error: "ACTIVE_WAVE_STATE_NOT_FOUND",
      symbol,
      file: file?.relative || null,
    });
  }

  try {
    const raw = fs.readFileSync(file.absolute, "utf8");
    const payload = JSON.parse(raw);

    // Return the canonical active-wave-state document unchanged.
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: "ACTIVE_WAVE_STATE_READ_FAILED",
      symbol,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

export { activeWaveStateRouter };
export default activeWaveStateRouter;
