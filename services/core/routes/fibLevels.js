// src/services/core/routes/fibLevels.js
// GET /api/v1/fib-levels?symbol=SPY&tf=1h&degree=minor&wave=W1|W4
// Reads data/fib-levels.json (multi-degree, multi-wave) and returns the best match.
// Always returns JSON (never throws raw errors).

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
        message: "fib-levels.json not found yet. Run updateFibLevels.js",
        meta: {
          schema: "fib-levels@2",
          symbol,
          tf,
          degree,
          wave,
          generated_at_utc: new Date().toISOString(),
        },
      });
    }

    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));

    const items = Array.isArray(raw?.items) ? raw.items : [];

    // Filter helpers (supports both top-level fields and meta fields)
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

    // If degree omitted, allow returning the first symbol+tf+wave match.
    let chosen = matches[0] || null;

    if (!chosen && !degree) {
      chosen =
        items.find((it) => {
          const ms = String(it?.meta?.symbol || it?.symbol || "").toUpperCase();
          const mt = String(it?.meta?.tf || it?.tf || "").toLowerCase();
          const mw = String(it?.meta?.wave || it?.wave || "W1").toUpperCase();
          return ms === symbol && mt === tf && mw === wave;
        }) || null;
    }

    if (!chosen) {
      return res.json({
        ok: false,
        reason: "NO_ANCHORS",
        message:
          "No fib output found for requested symbol/tf/degree/wave. Ensure anchors exist and are active, then run updateFibLevels.js.",
        meta: {
          schema: "fib-levels@2",
          symbol,
          tf,
          degree,
          wave,
          generated_at_utc: new Date().toISOString(),
        },
      });
    }

    return res.json(chosen);
  } catch (err) {
    return res.json({
      ok: false,
      reason: "ROUTE_ERROR",
      message: String(err?.message || err),
      meta: { schema: "fib-levels@2", generated_at_utc: new Date().toISOString() },
    });
  }
});
