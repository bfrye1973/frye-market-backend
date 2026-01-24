// services/core/routes/engine5Context.js
// Engine 1 — LOCATION CONTEXT ONLY
//
// Responsibilities (LOCKED):
// - Surface zones that exist
// - Answer: what zones are interacting with price?
// - NO permission, NO scoring, NO deletion of data
//
// Shelves rules (LOCKED):
// - Persist 48 hours after last seen
// - Surface ONLY between institutional zones
// - May touch institutional zones by <= $0.50
// - Must not penetrate deeper than $0.50
// - Max 2 shelves per institutional gap
// - Replacement only if strength >= old + 7
//
// Negotiated zones are handled elsewhere (separate overlay / endpoint)

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEVELS_FILE = path.resolve(__dirname, "../data/smz-levels.json");
const SHELVES_FILE = path.resolve(__dirname, "../data/smz-shelves.json");

// ---------------- constants (LOCKED) ----------------
const SHELF_PERSIST_HOURS = 48;
const MAX_SHELVES_PER_GAP = 2;
const REPLACEMENT_STRENGTH_DELTA = 7;
const INST_OVERLAP_TOLERANCE = 0.50;

// ---------------- helpers ----------------
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function nowUtc() {
  return Date.now();
}

function hoursBetween(tsUtc) {
  return (nowUtc() - new Date(tsUtc).getTime()) / 36e5;
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
  return { hi, lo, mid: round2((hi + lo) / 2), width: round2(hi - lo) };
}

// overlap penetration (positive = overlap depth)
function penetrationDepth(a, b) {
  return Math.max(0, Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo));
}

// ---------------- route ----------------
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

  // ---------------- institutional zones ----------------
  const institutional = (Array.isArray(levelsJson?.structures_sticky)
    ? levelsJson.structures_sticky
    : []
  )
    .map((z) => {
      const r = normalizeRange(z?.priceRange);
      if (!r) return null;
      return {
        id: z?.details?.id ?? `INST|${symbol}|${r.lo}|${r.hi}`,
        lo: r.lo,
        hi: r.hi,
        mid: r.mid,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.hi - a.hi);

  // ---------------- build institutional gaps ----------------
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

  // ---------------- shelves (raw) ----------------
  const rawShelves = Array.isArray(shelvesJson?.levels)
    ? shelvesJson.levels
    : [];

  // ---------------- shelf surfacing pipeline ----------------
  const shelfCandidates = [];

  for (const s of rawShelves) {
    const r = normalizeRange(s?.priceRange);
    if (!r) continue;

    // 48h persistence
    const updatedUtc = shelvesJson?.meta?.generated_at_utc;
    if (!updatedUtc || hoursBetween(updatedUtc) > SHELF_PERSIST_HOURS) continue;

    // institutional penetration check
    let blocked = false;
    for (const inst of institutional) {
      const p = penetrationDepth(r, inst);
      if (p > INST_OVERLAP_TOLERANCE) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    // assign gap
    const gap = gaps.find((g) => r.mid <= g.hi && r.mid >= g.lo);
    if (!gap) continue;

    shelfCandidates.push({
      id: `${symbol}|${s.type}|${r.lo}|${r.hi}`,
      type: s.type,
      lo: r.lo,
      hi: r.hi,
      mid: r.mid,
      width: r.width,
      strength: Number(s.strength) || 0,
      updatedUtc,
      gapId: gap.gapId,
      isManual: s.rangeSource === "manual" || s.locked === true,
    });
  }

  // ---------------- replacement + cap per gap ----------------
  const shelvesByGap = {};

  for (const shelf of shelfCandidates) {
    const list = shelvesByGap[shelf.gapId] || [];

    let replaced = false;

    for (let i = 0; i < list.length; i++) {
      const existing = list[i];

      if (existing.isManual && !shelf.isManual) continue;

      const delta = shelf.strength - existing.strength;
      const widthOk =
        shelf.width <= existing.width * 1.25 || delta >= 20;

      if (delta >= REPLACEMENT_STRENGTH_DELTA && widthOk) {
        list[i] = shelf;
        replaced = true;
        break;
      }
    }

    if (!replaced) list.push(shelf);
    shelvesByGap[shelf.gapId] = list;
  }

  // cap to max 2 per gap
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

  // ---------------- final response ----------------
  return res.json({
    ok: true,
    meta: {
      symbol,
      generated_at_utc: generatedAt,
      rules: {
        shelf_persist_hours: SHELF_PERSIST_HOURS,
        max_shelves_per_gap: MAX_SHELVES_PER_GAP,
        replacement_strength_delta: REPLACEMENT_STRENGTH_DELTA,
        institutional_overlap_tolerance: INST_OVERLAP_TOLERANCE,
      },
    },
    render: {
      institutional,
      shelves,
    },
  });
});

export { router as engine5ContextRouter };
export default router;
