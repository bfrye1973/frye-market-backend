// services/core/routes/smzHierarchy.js
import express from "express";
import { reduceSmzAndShelves } from "../logic/smzHierarchyReducer.js";

const router = express.Router();

function noCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Fetch failed ${r.status} ${r.statusText}: ${t}`);
  }
  return r.json();
}

/**
 * CONTRACT: Backend reads /api/v1/smz-levels + /api/v1/smz-shelves, runs reducer,
 * and frontend consumes ONLY /api/v1/smz-hierarchy.
 *
 * GET /api/v1/smz-hierarchy?symbol=SPY&tf=1h&currentPrice=674.12
 *
 * Query:
 * - symbol (optional, default SPY)
 * - tf (required): 30m | 1h | 4h | 1D  (reducer maps 1D -> 4h)
 * - currentPrice (required; fallback to meta.current_price_anchor if missing)
 */
async function handler(req, res) {
  try {
    noCache(res);

    const symbol = String(req.query.symbol ?? "SPY").toUpperCase();
    const tf = String(req.query.tf ?? "").trim();

    if (!tf) {
      return res.status(400).json({ ok: false, error: "Missing required query param: tf" });
    }

    // Prefer runtime truth
    let currentPrice = Number(req.query.currentPrice);

    // Base URL to call this same backend service (no guessing external hosts)
    const base =
      process.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ||
      `${req.protocol}://${req.get("host")}`;

    const levelsUrl = `${base}/api/v1/smz-levels?symbol=${encodeURIComponent(symbol)}`;
    const shelvesUrl = `${base}/api/v1/smz-shelves?symbol=${encodeURIComponent(symbol)}`;

    const [levelsJson, shelvesJson] = await Promise.all([
      fetchJson(levelsUrl),
      fetchJson(shelvesUrl),
    ]);

    const inst = Array.isArray(levelsJson?.levels) ? levelsJson.levels : [];
    const sh = Array.isArray(shelvesJson?.levels) ? shelvesJson.levels : [];

    // Fallback only if query param missing/invalid
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
        error:
          "Missing/invalid required query param: currentPrice (and no meta.current_price_anchor fallback available)",
      });
    }

    // Reducer enforces:
    // - ONE dominant institutional zone (or null)
    // - shelves only overlap selected zone
    // - max 1 accumulation + 1 distribution shelf
    // - tf filtering (1D -> 4h)
    const reduced = reduceSmzAndShelves({
      institutionalLevels: inst,
      shelfLevels: sh,
      currentPrice,
      timeframe: tf,
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
}

/**
 * IMPORTANT:
 * This router should be mounted under "/api/v1".
 * Then this path becomes: /api/v1/smz-hierarchy
 */
router.get("/smz-hierarchy", handler);

// Backward compatibility: if this router is mounted directly at "/api/v1/smzHierarchy"
router.get("/", handler);

export default router;
