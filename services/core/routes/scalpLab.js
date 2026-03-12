// services/core/routes/scalpLab.js

import express from "express";
import { computeEngine14 } from "../logic/engine14/index.js";

const router = express.Router();

const CACHE_TTL_MS = Number(process.env.ENGINE14_CACHE_TTL_MS || 7000);
const cache = new Map();

function getCacheKey(symbol) {
  return `engine14:${String(symbol || "SPY").toUpperCase()}`;
}

router.get("/scalp-lab", async (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const key = getCacheKey(symbol);
  const now = Date.now();

  try {
    const cached = cache.get(key);
    if (cached && now - cached.ts < CACHE_TTL_MS) {
      return res.json({
        ...cached.payload,
        cache: { hit: true, ttlMs: CACHE_TTL_MS },
      });
    }

    const payload = await computeEngine14({ symbol });
    cache.set(key, { ts: now, payload });

    return res.json({
      ...payload,
      cache: { hit: false, ttlMs: CACHE_TTL_MS },
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      symbol,
      error: "ENGINE14_COMPUTE_FAILED",
      message: err?.message || "Unknown error",
    });
  }
});

export default router;
