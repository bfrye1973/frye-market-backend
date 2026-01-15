// src/services/core/routes/fibLevels.js
// GET /api/v1/fib-levels?symbol=SPY&tf=1h
// Reads fib-levels.json and returns it (or a filtered variant).

import fs from "fs";
import path from "path";
import { Router } from "express";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE = path.resolve(__dirname, "../data/fib-levels.json");

export const fibLevelsRouter = Router();

fibLevelsRouter.get("/fib-levels", (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "1h").toLowerCase();

    if (!fs.existsSync(DATA_FILE)) {
      return res.json({
        ok: false,
        reason: "NOT_BUILT_YET",
        message: "fib-levels.json not found yet. Run updateFibLevels.js",
        meta: { schema: "fib-levels@1", symbol, tf, generated_at_utc: new Date().toISOString() }
      });
    }

    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

    // v1 is SPY 1h only; still accept query and echo meta
    if (raw?.meta) {
      raw.meta.symbol = symbol;
      raw.meta.tf = tf;
    }

    return res.json(raw);
  } catch (err) {
    return res.json({
      ok: false,
      reason: "ROUTE_ERROR",
      message: String(err?.message || err),
      meta: { schema: "fib-levels@1", generated_at_utc: new Date().toISOString() }
    });
  }
});
