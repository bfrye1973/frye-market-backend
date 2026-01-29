// services/core/jobs/updateSmzShelves.js
// Smart Money Shelves Job — writes smz-shelves.json (blue/red shelves)
//
// LOCKED USER RULES:
// - Manual institutionals are NEVER converted (you control them)
// - ANY institutional structure with strength < 90 becomes a shelf
// - Negotiated (|NEG|) zones are NEVER converted
// - Shelves persist for 48 hours
// - Revisiting a shelf resets its timer
// - Shelf is replaced only by a stronger overlapping shelf
// - No shelf flicker
//
// Everything else from your existing pipeline is preserved.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeShelves } from "../logic/smzShelvesScanner.js";
import { getBarsFromPolygonDeep } from "../../../api/providers/polygonBarsDeep.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-shelves.json");
const MANUAL_FILE = path.resolve(__dirname, "../data/smz-manual-shelves.json");
const LEVELS_FILE = path.resolve(__dirname, "../data/smz-levels.json");

const SYMBOL = "SPY";
const BAND_POINTS = 40;

// Lookback
const DAYS_15M = 180;
const DAYS_30M = 180;
const DAYS_1H = 180;

// Strength bands
const SHELF_MIN = 60;
const SHELF_MAX = 89;
const INSTITUTIONAL_MIN = 90;

// Persistence
const SHELF_PERSIST_HOURS = 48;

// Caps
const MAX_SHELVES_TOTAL = 8;

// ---------- helpers ----------
const isoNow = () => new Date().toISOString();
const nowMs = () => Date.now();
const HOUR_MS = 3600 * 1000;

const round2 = (x) => Math.round(Number(x) * 100) / 100;

function normalizeRange(pr) {
  if (!Array.isArray(pr) || pr.length !== 2) return null;
  const hi = Math.max(pr[0], pr[1]);
  const lo = Math.min(pr[0], pr[1]);
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) return null;
  return { hi: round2(hi), lo: round2(lo), mid: round2((hi + lo) / 2), width: hi - lo };
}

function overlaps(a, b) {
  return !(a.hi < b.lo || a.lo > b.hi);
}

function withinBand(r, price) {
  return r.hi >= price - BAND_POINTS && r.lo <= price + BAND_POINTS;
}

function clampStrength(x) {
  return Math.max(SHELF_MIN, Math.min(SHELF_MAX, Math.round(x)));
}

// ---------- Load previous shelves for memory ----------
function loadPreviousShelves() {
  if (!fs.existsSync(OUTFILE)) return [];
  try {
    const raw = fs.readFileSync(OUTFILE, "utf8");
    const json = JSON.parse(raw);
    return Array.isArray(json?.levels) ? json.levels : [];
  } catch {
    return [];
  }
}

// ---------- Manual shelves ----------
function loadManualShelves() {
  if (!fs.existsSync(MANUAL_FILE)) return [];
  try {
    const raw = fs.readFileSync(MANUAL_FILE, "utf8");
    const json = JSON.parse(raw);
    return (json?.levels || [])
      .map((s) => {
        const r = normalizeRange(s.manualRange || s.priceRange);
        if (!r) return null;
        return {
          type: s.type,
          priceRange: [r.hi, r.lo],
          strength: clampStrength(s.scoreOverride ?? s.strength ?? 75),
          rangeSource: "manual",
          firstSeenUtc: isoNow(),
          lastSeenUtc: isoNow(),
          maxStrengthSeen: clampStrength(s.scoreOverride ?? s.strength ?? 75),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------- Weak institutional → shelf ----------
function convertWeakInstitutionals() {
  if (!fs.existsSync(LEVELS_FILE)) return [];
  try {
    const raw = fs.readFileSync(LEVELS_FILE, "utf8");
    const json = JSON.parse(raw);
    const arr = json?.structures_sticky || [];

    return arr
      .filter((z) => {
        const id = String(z?.details?.id ?? z?.structureKey ?? "");
        if (id.includes("|NEG|")) return false;
        if (id.startsWith("MANUAL|")) return false;
        const s = Number(z?.strength);
        return s >= SHELF_MIN && s < INSTITUTIONAL_MIN;
      })
      .map((z) => {
        const r = normalizeRange(z.priceRange);
        if (!r) return null;
        const s = clampStrength(z.strength);
        return {
          type: "accumulation",
          priceRange: [r.hi, r.lo],
          strength: s,
          rangeSource: "weak_institutional",
          firstSeenUtc: isoNow(),
          lastSeenUtc: isoNow(),
          maxStrengthSeen: s,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------- Shelf persistence + replacement ----------
function mergeWithMemory(newShelves, previousShelves, currentPrice) {
  const now = nowMs();
  const out = [];

  for (const prev of previousShelves) {
    const rPrev = normalizeRange(prev.priceRange);
    if (!rPrev) continue;

    // Drop if expired
    const ageHrs = (now - Date.parse(prev.lastSeenUtc)) / HOUR_MS;
    if (ageHrs > SHELF_PERSIST_HOURS) continue;

    out.push(prev);
  }

  for (const next of newShelves) {
    const rNext = normalizeRange(next.priceRange);
    if (!rNext || !withinBand(rNext, currentPrice)) continue;

    let replaced = false;

    for (let i = 0; i < out.length; i++) {
      const rOld = normalizeRange(out[i].priceRange);
      if (!rOld) continue;

      if (overlaps(rNext, rOld)) {
        if (next.strength > out[i].maxStrengthSeen) {
          out[i] = {
            ...next,
            firstSeenUtc: out[i].firstSeenUtc,
            lastSeenUtc: isoNow(),
            maxStrengthSeen: next.strength,
          };
        } else {
          out[i].lastSeenUtc = isoNow(); // revisit resets timer
        }
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      out.push(next);
    }
  }

  return out;
}

// ---------- main ----------
async function main() {
  try {
    const [bars15mRaw, bars30mRaw, bars1hRaw] = await Promise.all([
      getBarsFromPolygonDeep(SYMBOL, "15m", DAYS_15M),
      getBarsFromPolygonDeep(SYMBOL, "30m", DAYS_30M),
      getBarsFromPolygonDeep(SYMBOL, "1h", DAYS_1H),
    ]);

    const bars30m = bars30mRaw || [];
    const bars1h = bars1hRaw || [];
    const currentPrice = bars30m.at(-1)?.close ?? bars1h.at(-1)?.close;
    if (!Number.isFinite(currentPrice)) throw new Error("No current price");

    const previousShelves = loadPreviousShelves();
    const manualShelves = loadManualShelves();
    const weakInstitutionShelves = convertWeakInstitutionals();

    const autoShelves =
      computeShelves({
        bars10m: bars15mRaw,
        bars30m,
        bars1h,
        bandPoints: BAND_POINTS,
      }) || [];

    const autoMapped = autoShelves
      .map((s) => {
        const r = normalizeRange(s.priceRange);
        if (!r) return null;
        return {
          type: s.type,
          priceRange: [r.hi, r.lo],
          strength: clampStrength(s.strength),
          rangeSource: "auto",
          firstSeenUtc: isoNow(),
          lastSeenUtc: isoNow(),
          maxStrengthSeen: clampStrength(s.strength),
        };
      })
      .filter(Boolean);

    const combinedNew = [...manualShelves, ...weakInstitutionShelves, ...autoMapped];
    const merged = mergeWithMemory(combinedNew, previousShelves, currentPrice);

    const final = merged
      .sort((a, b) => b.maxStrengthSeen - a.maxStrengthSeen)
      .slice(0, MAX_SHELVES_TOTAL);

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(
      OUTFILE,
      JSON.stringify(
        {
          ok: true,
          meta: {
            generated_at_utc: isoNow(),
            symbol: SYMBOL,
            current_price_anchor: round2(currentPrice),
            shelf_persist_hours: SHELF_PERSIST_HOURS,
          },
          levels: final,
        },
        null,
        2
      ),
      "utf8"
    );

    console.log("[SHELVES] Job complete. Shelves:", final.length);
  } catch (err) {
    console.error("[SHELVES] FAILED:", err);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
