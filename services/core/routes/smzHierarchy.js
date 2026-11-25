// services/core/routes/smzHierarchy.js
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { reduceSmzAndShelves } from "../logic/smzHierarchyReducer.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEVELS_PATH = path.resolve(__dirname, "../data/smz-levels.json");
const SHELVES_PATH = path.resolve(__dirname, "../data/smz-shelves.json");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function noCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

/**
 * GET /api/v1/smz-hierarchy?symbol=SPY&tf=1h&currentPrice=692.06
 *
 * Reads:
 * - data/smz-levels.json
 * - data/smz-shelves.json
 *
 * Returns:
 * { ok, meta, render:{institutional,shelves}, suppressed:{institutional,shelves} }
 */
router.get("/", (req, res) => {
  try {
    noCache(res);

    const symbol = String(req.query.symbol ?? "SPY").toUpperCase(); // reserved for future use
    const tf = String(req.query.tf ?? "").trim();
    let currentPrice = Number(req.query.currentPrice);

    if (!tf) {
      return res.status(400).json({ ok: false, error: "Missing required query param: tf" });
    }

    const levelsJson = readJson(LEVELS_PATH) || { levels: [], meta: {} };
    const shelvesJson = readJson(SHELVES_PATH) || { levels: [], meta: {} };

    const inst = Array.isArray(levelsJson.levels) ? levelsJson.levels : [];
    const sh = Array.isArray(shelvesJson.levels) ? shelvesJson.levels : [];

    // If currentPrice not provided, fallback to meta.current_price_anchor
    if (!Number.isFinite(currentPrice)) {
      const fallback =
        Number(levelsJson?.meta?.current_price_anchor) ||
        Number(shelvesJson?.meta?.current_price_anchor) ||
        NaN;

      if (Number.isFinite(fallback)) currentPrice = fallback;
    }

    if (!Number.isFinite(currentPrice)) {
      return res.status(400).json({
        ok: false,
        error: "Missing/invalid currentPrice and no meta.current_price_anchor available",
      });
    }

    const reduced = reduceSmzAndShelves({
      institutionalLevels: inst,
      shelfLevels: sh,
      currentPrice,
      timeframe: tf,
      windowPts: 40, // LOCKED per your request
    });

    return res.json({
      ok: true,
      meta: {
        asOfUtc: new Date().toISOString(),
        symbol,
        tf,
        currentPrice: Number(currentPrice.toFixed(2)),
      },
      ...reduced,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message ?? err) });
  }
});

export default router;
