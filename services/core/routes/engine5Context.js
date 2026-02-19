// services/core/routes/engine5Context.js
// Engine 1 — LOCATION CONTEXT ONLY (LOCKED)
// FULL SAFE VERSION — NO STRUCTURE REMOVED

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

function shelfDistance(price, shelf) {
  if (priceInside(price, shelf)) return { side: "INSIDE", distancePts: 0 };
  if (price > shelf.hi) return { side: "ABOVE", distancePts: round2(price - shelf.hi) };
  return { side: "BELOW", distancePts: round2(shelf.lo - price) };
}

function toNum(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "string" && x.trim() === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// ---------------- SAFE PRICE FETCH ----------------
async function fetchLastCloseAsPrice({ symbol, tf }) {
  const url = `https://frye-market-backend-1.onrender.com/api/v1/ohlc?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&limit=5`;

  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const last = data[data.length - 1];
    const c = toNum(last?.close);
    return c;
  } catch {
    return null;
  }
}

// ---------------- ROUTE ----------------
router.get("/engine5-context", async (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const tf = String(req.query.tf || "10m");

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

  // ---------------- PRICE RESOLUTION ----------------
  let currentPrice =
    shelvesJson?.meta?.current_price_anchor ??
    levelsJson?.meta?.current_price ??
    null;

  if (!Number.isFinite(Number(currentPrice))) {
    const lastClose = await fetchLastCloseAsPrice({ symbol, tf });
    if (Number.isFinite(Number(lastClose))) {
      currentPrice = Number(lastClose);
    }
  }

  const cpNum = toNum(currentPrice);

  const structuresSticky = Array.isArray(levelsJson?.structures_sticky)
    ? levelsJson.structures_sticky
    : [];

  // ---------------- NEGOTIATED ----------------
  const negotiated = structuresSticky
    .filter(isNegotiatedZone)
    .map((z) => {
      const r = normalizeRange(z?.priceRange);
      if (!r) return null;
      return { id: zoneId(z), lo: r.lo, hi: r.hi, mid: r.mid };
    })
    .filter(Boolean);

  // ---------------- INSTITUTIONAL ----------------
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
        strength:
          toNum(z?.strength) ??
          toNum(z?.details?.strength) ??
          toNum(z?.details?.facts?.strength) ??
          null,
        details: z?.details ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.hi - a.hi);

  // ---------------- ACTIVE ZONES ----------------
  let activeNegotiated = null;
  let activeInstitutional = null;

  if (cpNum !== null) {
    activeNegotiated =
      negotiated.find((n) => priceInside(cpNum, n)) ?? null;

    activeInstitutional =
      institutional.find((i) => priceInside(cpNum, i)) ?? null;
  }

  // ---------------- SHELVES ----------------
  const rawShelves = Array.isArray(shelvesJson?.levels)
    ? shelvesJson.levels
    : [];

  const shelves = rawShelves
    .map((s) => {
      const r = normalizeRange(s?.priceRange);
      if (!r) return null;
      return {
        id: `${symbol}|${String(s?.type ?? "shelf")}|${r.lo}|${r.hi}`,
        type: String(s?.type ?? "").toLowerCase(),
        lo: r.lo,
        hi: r.hi,
        strength: Number(s?.strength) || 0,
      };
    })
    .filter(Boolean);

  let activeShelf = null;
  if (cpNum !== null) {
    activeShelf =
      shelves.find((s) => priceInside(cpNum, s)) ?? null;
  }

  // ---------------- RESPONSE ----------------
  return res.json({
    ok: true,
    meta: {
      symbol,
      tf,
      generated_at_utc: generatedAt,
      current_price: cpNum,
      currentPrice: cpNum,
      rules: {
        shelf_persist_hours: SHELF_PERSIST_HOURS,
        replacement_strength_delta: REPLACEMENT_STRENGTH_DELTA,
        institutional_overlap_tolerance: INST_OVERLAP_TOLERANCE,
        max_shelves_per_gap: MAX_SHELVES_PER_GAP,
      },
    },
    render: {
      negotiated,
      institutional: institutional.map(({ details, ...rest }) => rest),
      shelves,
    },
    active: {
      negotiated: activeNegotiated,
      shelf: activeShelf,
      institutional: activeInstitutional,
    },
    nearest: { shelf: null },
  });
});

export { router as engine5ContextRouter };
export default router;
