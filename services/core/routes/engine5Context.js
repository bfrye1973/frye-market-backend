import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// routes/ -> services/core/routes
// data/ is one level up from routes/
const LEVELS_FILE = path.resolve(__dirname, "../data/smz-levels.json");
const SHELVES_FILE = path.resolve(__dirname, "../data/smz-shelves.json");

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function normalizeRange(priceRange) {
  if (!Array.isArray(priceRange) || priceRange.length !== 2) return null;
  const a = Number(priceRange[0]);
  const b = Number(priceRange[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const hi = round2(Math.max(a, b));
  const lo = round2(Math.min(a, b));
  if (!(hi > lo)) return null;
  return { hi, lo };
}

function readJsonSafe(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function shelfId(symbol, type, lo, hi) {
  return `${symbol}|${type}|${lo.toFixed(2)}|${hi.toFixed(2)}`;
}

function institutionalId(symbol, lo, hi, upstreamId = null) {
  if (typeof upstreamId === "string" && upstreamId.trim()) return upstreamId;
  return `${symbol}|institutional|${lo.toFixed(2)}|${hi.toFixed(2)}`;
}

router.get("/engine5-context", (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();

  // v1 is SPY-only for truth; allow param for future
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

  // ---------- Institutional (structures_sticky) ----------
  const structuresSticky = Array.isArray(levelsJson?.structures_sticky)
    ? levelsJson.structures_sticky
    : [];

  const institutional = structuresSticky
    .map((z) => {
      const r = normalizeRange(z?.priceRange);
      if (!r) return null;

      // strength: manual is emitted as 100 by job; autos have strength already
      const strength = Number.isFinite(Number(z?.strength)) ? round2(z.strength) : 0;

      const facts = z?.details?.facts ?? {};
      const sticky = facts?.sticky ?? {};

      return {
        id: institutionalId(symbol, r.lo, r.hi, z?.details?.id ?? null),
        lo: r.lo,
        hi: r.hi,
        strength, // 0–100 historical institutional quality
        details: {
          facts: {
            sticky: {
              status: sticky?.status ?? null,
              archivedUtc: sticky?.archivedUtc ?? null,
              distinctExitCount:
                Number.isFinite(Number(sticky?.distinctExitCount))
                  ? Number(sticky.distinctExitCount)
                  : null,
              exits: Array.isArray(sticky?.exits) ? sticky.exits : [],
            },
            // keep stable keys even if null (Engine 5 expects these)
            exitSide1h: facts?.exitSide1h ?? null,
            exitBars1h:
              Number.isFinite(Number(facts?.exitBars1h)) ? Number(facts.exitBars1h) : null,
          },
        },
      };
    })
    .filter(Boolean);

  // ---------- Shelves (smz-shelves levels[]) ----------
  const shelfLevels = Array.isArray(shelvesJson?.levels) ? shelvesJson.levels : [];

  const shelves = shelfLevels
    .map((s) => {
      const type = String(s?.type ?? "").toLowerCase();
      if (type !== "accumulation" && type !== "distribution") return null;

      const r = normalizeRange(s?.priceRange);
      if (!r) return null;

      const strength = Number.isFinite(Number(s?.strength)) ? Math.round(Number(s.strength)) : 0;

      return {
        id: shelfId(symbol, type, r.lo, r.hi),
        type,
        lo: r.lo,
        hi: r.hi,
        readiness: strength, // ✅ per your choice: readiness = strength
        strength,
        updatedUtc: shelvesJson?.meta?.generated_at_utc ?? generatedAt,
      };
    })
    .filter(Boolean);

  return res.json({
    ok: true,
    meta: {
      symbol,
      generated_at_utc: generatedAt,
      sources: {
        smz_levels: path.basename(LEVELS_FILE),
        smz_shelves: path.basename(SHELVES_FILE),
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
