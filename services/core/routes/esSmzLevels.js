// services/core/routes/esSmzLevels.js
// Engine 1B — ES Manual Institutional / Negotiated Levels Route
//
// Reads:
// services/core/data/es-smz-manual-structures.json
//
// Endpoint:
// GET /api/v1/es-smz-levels?symbol=ES
//
// Purpose:
// - Give Engine 17 a clean ES-only levels route
// - Prevent SPY negotiated zones from carrying into ES chart
// - Return a shape similar to SPY smz-levels.json

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANUAL_STRUCTURES_PATH = path.resolve(
  __dirname,
  "../data/es-smz-manual-structures.json"
);

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeRange(priceRange) {
  if (!Array.isArray(priceRange) || priceRange.length !== 2) return null;

  const a = toNumber(priceRange[0]);
  const b = toNumber(priceRange[1]);

  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const hi = Math.max(a, b);
  const lo = Math.min(a, b);

  if (!(hi > lo)) return null;

  return [hi, lo];
}

function manualStructureToSticky(s) {
  const pr = normalizeRange(s?.displayPriceRange || s?.priceRange || s?.manualRange);
  if (!pr) return null;

  const isNegotiated =
    s?.isNegotiated === true ||
    String(s?.structureKey || "").includes("|NEG|") ||
    String(s?.notes || "").toUpperCase().includes("NEGOTIATED");

  return {
    type: "institutional",
    tier: "structure_sticky",
    symbol: "ES",
    priceRange: pr,
    displayPriceRange: pr,
    strength: 100,
    strength_raw: 100,
    confidence: 1,
    isNegotiated,
    locked: true,
    rangeSource: "manual",
    status: s?.status || "active",
    details: {
      id: s?.structureKey || `MANUAL|ES|${pr[1].toFixed(2)}-${pr[0].toFixed(2)}`,
      facts: {
        sticky: {
          ...s,
          source: "es_manual_file",
        },
      },
    },
  };
}

router.get("/", async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const symbol = String(req.query.symbol || "ES").toUpperCase();

    if (symbol !== "ES") {
      return res.status(400).json({
        ok: false,
        error: "This route is ES-only. Use symbol=ES.",
        symbol,
      });
    }

    if (!fs.existsSync(MANUAL_STRUCTURES_PATH)) {
      return res.json({
        ok: true,
        symbol: "ES",
        levels: [],
        levels_debug: [],
        pockets_active: [],
        structures_sticky: [],
        note: "No ES manual structures generated yet",
      });
    }

    const raw = fs.readFileSync(MANUAL_STRUCTURES_PATH, "utf8");
    const json = JSON.parse(raw);

    const structures = Array.isArray(json?.structures) ? json.structures : [];

    const structuresSticky = structures
      .map(manualStructureToSticky)
      .filter(Boolean);

    const levelsDebug = structuresSticky;

    res.json({
      ok: true,
      symbol: "ES",
      meta: {
        generated_at_utc: new Date().toISOString(),
        source: "es-smz-manual-structures.json",
        manual_structures_loaded: structures.length,
        structures_sticky_count: structuresSticky.length,
        route: "/api/v1/es-smz-levels",
      },
      levels: [],
      levels_debug: levelsDebug,
      pockets_active: [],
      structures_sticky: structuresSticky,
    });
  } catch (err) {
    console.error("[/api/v1/es-smz-levels] error:", err);

    res.status(500).json({
      ok: false,
      symbol: "ES",
      error: "Failed to load ES SMZ levels",
      detail: String(err?.message || err),
    });
  }
});

export default router;
