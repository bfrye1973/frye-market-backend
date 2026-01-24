// services/core/routes/engine5Context.js
// Engine 1 — LOCATION CONTEXT ONLY (LOCKED)
//
// Responsibilities:
// - Surface zones that exist
// - Answer: what zone is price interacting with right now?
// - NO scoring, NO permission, NO gating
//
// LOCKED RULES:
// - Negotiated zones = highest priority (never filtered)
// - Shelves persist 48h
// - Shelves may overlap institutional zones by <= $0.50
// - Shelves deeper than $0.50 inside institutionals are NOT surfaced
// - Shelves only surface BETWEEN institutionals (gaps)
// - Max 2 shelves per gap
// - Shelf replacement requires strength +7
// - Explicit active.* zones are returned

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

// ✅ Canonical ID detection (matches frontend overlay behavior)
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

  // Prefer shelves job anchor (it’s what you already use operationally)
  const currentPrice =
    shelvesJson?.meta?.current_price_anchor ??
    levelsJson?.meta?.current_price ??
    null;

  const structuresSticky = Array.isArray(levelsJson?.structures_sticky)
    ? levelsJson.structures_sticky
    : [];

  // ---------------- NEGOTIATED ZONES (NEVER FILTERED) ----------------
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

  // ---------------- INSTITUTIONAL ZONES ----------------
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
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.hi - a.hi);

  // ---------------- ACTIVE NEGOTIATED ----------------
  let activeNegotiated = null;
  if (Number.isFinite(currentPrice)) {
    // if multiple, pick tightest (most precise) as "active"
    const hits = negotiated.filter((n) => priceInside(currentPrice, n));
    if (hits.length) {
      hits.sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo)); // narrowest first
      activeNegotiated = hits[0];
    }
  }

  // ---------------- ACTIVE INSTITUTIONAL ----------------
  let activeInstitutional = null;
  if (Number.isFinite(currentPrice)) {
    const hits = institutional.filter((i) => priceInside(currentPrice, i));
    if (hits.length) {
      // prefer narrowest container if multiple
      hits.sort((a, b) => (a.hi - a.lo) - (b.hi - b.lo));
      activeInstitutional = hits[0];
    }
  }

  // ---------------- BUILD INSTITUTIONAL GAPS ----------------
  const gaps = [];
  if (institutional.length === 0) {
    gaps.push({ gapId: "ALL", hi: Infinity, lo: -Infinity });
  } else {
    gaps.push({ gapId: "TOP", hi: Infinity, lo: institutional[0].hi });
    for (let i = 0; i < institutional.length - 1; i++) {
      gaps.push({
        gapId: `MID_${i}`,
        hi: institutional[i].lo,
        lo: institutional[i + 1].hi,
      });
    }
    gaps.push({
      gapId: "BOTTOM",
      hi: institutional[institutional.length - 1].lo,
      lo: -Infinity,
    });
  }

  // ---------------- SHELVES (SURFACING) ----------------
  const rawShelves = Array.isArray(shelvesJson?.levels)
    ? shelvesJson.levels
    : [];

  const shelfCandidates = [];

  for (const s of rawShelves) {
    const r = normalizeRange(s?.priceRange);
    if (!r) continue;

    // 48h persistence (based on shelves job timestamp)
    const updatedUtc = shelvesJson?.meta?.generated_at_utc;
    if (!updatedUtc || hoursSince(updatedUtc) > SHELF_PERSIST_HOURS) continue;

    // Institutional overlap tolerance: block only if penetration > $0.50
    let blocked = false;
    for (const inst of institutional) {
      const p = penetrationDepth(r, inst);
      if (p > INST_OVERLAP_TOLERANCE) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    // Assign gap by midpoint (only between institutionals)
    const gap = gaps.find((g) => r.mid <= g.hi && r.mid >= g.lo);
    if (!gap) continue;

    shelfCandidates.push({
      id: `${symbol}|${String(s?.type ?? "shelf")}|${r.lo}|${r.hi}`,
      type: String(s?.type ?? "").toLowerCase(),
      lo: r.lo,
      hi: r.hi,
      mid: r.mid,
      width: r.width,
      strength: Number(s?.strength) || 0,
      gapId: gap.gapId,
      isManual: s?.rangeSource === "manual" || s?.locked === true,
    });
  }

  // ---------------- REPLACEMENT + CAP PER GAP ----------------
  const shelvesByGap = {};

  for (const shelf of shelfCandidates) {
    const list = shelvesByGap[shelf.gapId] || [];
    let replaced = false;

    for (let i = 0; i < list.length; i++) {
      const old = list[i];

      // manual shelf cannot be replaced by auto
      if (old.isManual && !shelf.isManual) continue;

      const delta = shelf.strength - old.strength;
      const widthOk = shelf.width <= old.width * 1.25 || delta >= 20;

      if (delta >= REPLACEMENT_STRENGTH_DELTA && widthOk) {
        list[i] = shelf;
        replaced = true;
        break;
      }
    }

    if (!replaced) list.push(shelf);
    shelvesByGap[shelf.gapId] = list;
  }

  const shelves = Object.values(shelvesByGap)
    .flatMap((list) =>
      list
        .sort((a, b) => b.strength - a.strength)
        .slice(0, MAX_SHELVES_PER_GAP)
    )
    .map((s) => ({
      id: s.id,
      type: s.type,
      lo: s.lo,
      hi: s.hi,
      strength: s.strength,
      gapId: s.gapId,
    }));

  // ---------------- ACTIVE SHELF ----------------
  let activeShelf = null;
  if (Number.isFinite(currentPrice)) {
    const hits = shelves.filter((s) => priceInside(currentPrice, s));
    if (hits.length) {
      hits.sort((a, b) => b.strength - a.strength);
      activeShelf = hits[0];
    }
  }

  // ---------------- RESPONSE ----------------
  return res.json({
    ok: true,
    meta: {
      symbol,
      generated_at_utc: generatedAt,
      current_price: currentPrice,
      rules: {
        shelf_persist_hours: SHELF_PERSIST_HOURS,
        replacement_strength_delta: REPLACEMENT_STRENGTH_DELTA,
        institutional_overlap_tolerance: INST_OVERLAP_TOLERANCE,
        max_shelves_per_gap: MAX_SHELVES_PER_GAP,
      },
    },
    render: {
      negotiated,
      institutional,
      shelves,
    },
    active: {
      negotiated: activeNegotiated,
      shelf: activeShelf,
      institutional: activeInstitutional,
    },
  });
});

export { router as engine5ContextRouter };
export default router;
