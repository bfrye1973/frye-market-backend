// src/services/core/routes/fibLevels.js
// GET /api/v1/fib-levels?symbol=SPY&tf=1h&degree=minor&wave=W1|W4
// Reads services/core/data/fib-levels.json and returns the best match.
// Always returns JSON.

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
    const degree = req.query.degree ? String(req.query.degree).toLowerCase() : null;
    const wave = req.query.wave ? String(req.query.wave).toUpperCase() : "W1";

    if (!fs.existsSync(DATA_FILE)) {
      return res.json({
        ok: false,
        reason: "NOT_BUILT_YET",
        message: "fib-levels.json not found yet. Run node jobs/updateFibLevels.js",
        meta: { schema: "fib-levels@3", symbol, tf, degree, wave, generated_at_utc: new Date().toISOString() },
      });
    }

    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

    // New format is { ok:true, items:[...] }. Old placeholder has no items.
    const items = Array.isArray(raw?.items) ? raw.items : [];

    if (!items.length) {
      return res.json({
        ok: false,
        reason: "NOT_BUILT_YET",
        message: "fib-levels.json exists but contains no items yet. Run node jobs/updateFibLevels.js",
        meta: { schema: "fib-levels@3", symbol, tf, degree, wave, generated_at_utc: new Date().toISOString() },
      });
    }

    const match = (it) => {
      const ms = String(it?.meta?.symbol || it?.symbol || "").toUpperCase();
      const mt = String(it?.meta?.tf || it?.tf || "").toLowerCase();
      const md = String(it?.meta?.degree || it?.degree || "").toLowerCase();
      const mw = String(it?.meta?.wave || it?.wave || "W1").toUpperCase();
      if (ms !== symbol) return false;
      if (mt !== tf) return false;
      if (mw !== wave) return false;
      if (degree && md !== degree) return false;
      return true;
    };

    const matches = items.filter(match);
    const chosen = matches[0] || null;

    if (!chosen) {
      return res.json({
        ok: false,
        reason: "NO_ANCHORS",
        message: "No fib output found for requested symbol/tf/degree/wave. Check anchors + rerun job.",
        meta: { schema: "fib-levels@3", symbol, tf, degree, wave, generated_at_utc: new Date().toISOString() },
      });
    }

    return res.json(chosen);
  } catch (err) {
    return res.json({
      ok: false,
      reason: "ROUTE_ERROR",
      message: String(err?.message || err),
      meta: { schema: "fib-levels@3", generated_at_utc: new Date().toISOString() },
    });
  }
});
