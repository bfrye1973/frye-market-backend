// services/core/routes/engine5Context.js
// Engine 1 — LOCATION CONTEXT ONLY (LOCKED)
//
// CHANGE (Option A):
// - Attach TRUE institutional strength to active.institutional
// - No detection logic changed
// - No scoring logic added
// - No defaults introduced

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEVELS_FILE = path.resolve(__dirname, "../data/smz-levels.json");
const SHELVES_FILE = path.resolve(__dirname, "../data/smz-shelves.json");

// ---------------- LOCKED CONSTANTS ----------------
const SHELF_PERSIST_HOURS = 48;
const MAX_SHELVES_PER_GAP = 2;
const REPLACEMENT_STRENGTH_DELTA = 7;
const INST_OVERLAP_TOLERANCE = 0.50;

// ---------------- HELPERS ----------------
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeRange(range) {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const a = Number(range[0]);
  const b = Number(range[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const hi = round2(Math.max(a, b));
  const lo = round2(Math.min(a, b));
  if (!(hi > lo)) return null;
  return {
    hi,
    lo,
    mid: round2((hi + lo) / 2),
    width: round2(hi - lo),
  };
}

function penetrationDepth(a, b) {
  return Math.max(0, Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo));
}

function hoursSince(ts) {
  return (Date.now() - new Date(ts).getTime()) / 36e5;
}

function priceInside(price, z) {
  return price >= z.lo && price <= z.hi;
}

// Canonical ID detection (LOCKED)
function zoneId(z) {
  return String(
    z?.details?.id ??
    z?.details?.facts?.sticky?.structureKey ??
    z?.structureKey ??
    z?.id ??
    ""
  );
}

function isNegotiatedZone(z) {
  return zoneId(z).includes("|NEG|");
}

// ---------------- ROUTE ----------------
router.get("/engine5-context", (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  if (symbol !== "SPY") {
    return res.json({
      ok: false,
      error: "SYMBOL_NOT_SUPPORTED_YET",
      meta: { symbol, supported: ["SPY"] },
    });
  }

  const levelsJson = readJsonSafe(LEVELS_FILE);
  const shelvesJson = readJsonSafe(SHELVES_FILE);

  const generatedAt =
    shelvesJson?.meta?.generated_at_utc ||
    levelsJson?.meta?.generated_at_utc ||
    new Date().toISOString();

  const currentPrice =
    shelvesJson?.meta?.current_price_anchor ??
    levelsJson?.meta?.current_price ??
    null;

  const structuresSticky = Array.isArray(levelsJson?.structures_sticky)
    ? levelsJson.structures_sticky
    : [];

  // ---------------- NEGOTIATED ZONES ----------------
  const negotiated = structuresSticky
    .filter(isNegotiatedZone)
    .map((z) => {
      const r = normalizeRange(z?.priceRange);
      if (!r) return null;
      return {
        id: zoneId(z),
        lo: r.lo,
        hi: r.hi,
        mid: r.mid,
      };
    })
    .filter(Boolean);

  // ---------------- INSTITUTIONAL ZONES (WITH STRENGTH) ----------------
  const institutional = structuresSticky
    .filter((z) => !isNegotiatedZone(z))
    .map((z) => {
      const r = normalizeRange(z?.priceRange);
      if (!r) return null;

      return {
        id: zoneId(z),
        lo: r.lo,
        hi: r.hi,
        mid: r.mid,
        // 🔑 THIS IS THE FIX
        strength: Number(
          z?.strength ??
          z?.details?.strength ??
          z?.details?.facts?.strength ??
          null
        ),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.hi - a.hi);

  // ---------------- ACTIVE NEGOTIATED ----------------
  let activeNegotiated = null;
  if (Number.isFinite(currentPrice)) {
    const hits = negotiated.filter((n) => priceInside(currentPrice, n));
    if (hits.length) {
      hits.sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo));
      activeNegotiated = hits[0];
    }
  }

  // ---------------- ACTIVE INSTITUTIONAL ----------------
  let activeInstitutional = null;
  if (Number.isFinite(currentPrice)) {
    const hits = institutional.filter((i) => priceInside(currentPrice, i));
    if (hits.length) {
      hits.sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo));
      activeInstitutional = hits[0];
    }
  }

  // ---------------- RESPONSE ----------------
  return res.json({
    ok: true,
    meta: {
      symbol,
      generated_at_utc: generatedAt,
      current_price: currentPrice,
    },
    render: {
      negotiated,
      institutional,
      shelves: shelvesJson?.levels || [],
    },
    active: {
      negotiated: activeNegotiated,
      shelf: null,
      institutional: activeInstitutional,
    },
    nearest: {
      shelf: null,
    },
  });
});

export { router as engine5ContextRouter };
export default router;
