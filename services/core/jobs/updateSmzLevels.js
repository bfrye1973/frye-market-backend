// services/core/jobs/updateSmzShelves.js
// Shelves Job — writes smz-shelves.json
//
// ✅ NEW LOCKED OUTPUT RULE (Phase 1):
// - Emit ONLY:
//    - 1 best Accumulation shelf
//    - 1 best Distribution shelf
//   within band_points
//
// ✅ Persistence:
// - Shelves persist 48 hours
// - Only replaced if a NEW overlapping shelf is stronger by a margin
//
// ✅ Manual shelves:
// - Always win vs autos of same type (if in band + active)
//
// ✅ Shelves are NEVER institutional and NEVER yellow (frontend rule)
//
// ✅ Beta truth fields:
// - strength_raw (0..100 if present)
// - confidence (0..1 if present)
// - strength (policy 65..89)

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

// Keep your current beta band unless you want to tighten later
const BAND_POINTS = 40;

const DAYS_15M = 180;
const DAYS_30M = 180;
const DAYS_1H = 180;

// Shelf scoring band (policy)
const SHELF_STRENGTH_LO = 65;
const SHELF_STRENGTH_HI = 89;

// Institutional suppression threshold
const INSTITUTIONAL_MIN = 85;

// Persistence window
const SHELF_PERSIST_HOURS = 48;

// ✅ Replacement stability guard (very important)
// A new overlapping shelf must beat the old max by at least this many points
const REPLACE_MARGIN_PTS = 3;

// Debug list size
const DEBUG_LEVELS_COUNT = 25;

const isoNow = () => new Date().toISOString();
const round2 = (x) => Math.round(Number(x) * 100) / 100;

function clampInt(x, lo, hi) {
  const n = Math.round(Number(x));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Map confidence (0..1) -> shelf band (65..89)
function mapShelfStrengthFromConfidence(conf) {
  const c = clamp01(conf);
  const mapped = Math.round(SHELF_STRENGTH_LO + (SHELF_STRENGTH_HI - SHELF_STRENGTH_LO) * c);
  return clampInt(mapped, SHELF_STRENGTH_LO, SHELF_STRENGTH_HI);
}

// Fallback confidence from raw scanner score 40..100 -> 0..1
function confidenceFromRawStrength(raw) {
  const r = Number(raw);
  if (!Number.isFinite(r)) return 0;
  return clamp01((r - 40) / 60);
}

function normalizeBars(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      const tms = Number(b.t ?? b.time ?? 0);
      const t = tms > 1e12 ? Math.floor(tms / 1000) : tms;
      return {
        time: t,
        open: Number(b.o ?? b.open ?? 0),
        high: Number(b.h ?? b.high ?? 0),
        low: Number(b.l ?? b.low ?? 0),
        close: Number(b.c ?? b.close ?? 0),
        volume: Number(b.v ?? b.volume ?? 0),
      };
    })
    .filter(
      (b) =>
        Number.isFinite(b.time) &&
        Number.isFinite(b.high) &&
        Number.isFinite(b.low) &&
        Number.isFinite(b.close)
    )
    .sort((a, b) => a.time - b.time);
}

function lastFiniteClose(bars) {
  if (!Array.isArray(bars)) return null;
  for (let i = bars.length - 1; i >= 0; i--) {
    const c = bars[i]?.close;
    if (Number.isFinite(c)) return c;
  }
  return null;
}

function normalizeRange(pr) {
  if (!Array.isArray(pr) || pr.length !== 2) return null;
  const a = Number(pr[0]);
  const b = Number(pr[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const hi = round2(Math.max(a, b));
  const lo = round2(Math.min(a, b));
  if (!(hi > lo)) return null;
  const width = hi - lo;
  const mid = (hi + lo) / 2;
  return { hi, lo, width, mid };
}

function withinBand(r, price, bandPts) {
  if (!r || !Number.isFinite(price)) return false;
  return r.hi >= price - bandPts && r.lo <= price + bandPts;
}

function rangesOverlap(aHi, aLo, bHi, bLo) {
  return !(aHi < bLo || aLo > bHi);
}

function overlapRatio(aHi, aLo, bHi, bLo) {
  const lo = Math.max(aLo, bLo);
  const hi = Math.min(aHi, bHi);
  const inter = hi - lo;
  if (inter <= 0) return 0;
  const denom = Math.min(aHi - aLo, bHi - bLo);
  return denom > 0 ? inter / denom : 0;
}

function normalizeType(t) {
  const x = String(t ?? "").toLowerCase();
  if (x === "accumulation" || x === "acc") return "accumulation";
  if (x === "distribution" || x === "dist") return "distribution";
  return null;
}

function isManualShelf(s) {
  return s?.rangeSource === "manual" || s?.locked === true || Number.isFinite(Number(s?.scoreOverride));
}

function loadPrevShelves() {
  if (!fs.existsSync(OUTFILE)) return [];
  try {
    const raw = fs.readFileSync(OUTFILE, "utf8");
    const json = JSON.parse(raw);
    return Array.isArray(json?.levels) ? json.levels : [];
  } catch {
    return [];
  }
}

function hoursSince(ts) {
  const t = Date.parse(ts || "");
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (3600 * 1000);
}

function priceInside(price, r) {
  return Number.isFinite(price) && price >= r.lo && price <= r.hi;
}

// institutional ranges that suppress shelves (>=85 only)
function loadInstitutionalRangesForSuppression() {
  if (!fs.existsSync(LEVELS_FILE)) return [];
  try {
    const raw = fs.readFileSync(LEVELS_FILE, "utf8");
    const json = JSON.parse(raw);
    const arr = Array.isArray(json?.structures_sticky) ? json.structures_sticky : [];

    return arr
      .filter((z) => {
        // exclude negotiated from suppression source list
        const id = String(z?.details?.id ?? z?.structureKey ?? "");
        if (z?.isNegotiated === true) return false;
        if (id.includes("|NEG|")) return false;

        const s = Number(z?.strength ?? NaN);
        return Number.isFinite(s) && s >= INSTITUTIONAL_MIN;
      })
      .map((z) => normalizeRange(z?.displayPriceRange ?? z?.priceRange))
      .filter(Boolean)
      .map((r) => ({ hi: r.hi, lo: r.lo }));
  } catch {
    return [];
  }
}

// convert non-manual, non-NEG structures with strength <85 into shelves
function convertStructuresToShelves(nowIso, currentPriceAnchor) {
  if (!fs.existsSync(LEVELS_FILE)) return [];
  try {
    const raw = fs.readFileSync(LEVELS_FILE, "utf8");
    const json = JSON.parse(raw);
    const arr = Array.isArray(json?.structures_sticky) ? json.structures_sticky : [];

    const out = [];

    for (const z of arr) {
      const id = String(z?.details?.id ?? z?.structureKey ?? "");
      if (z?.isNegotiated === true) continue;
      if (id.includes("|NEG|")) continue;
      if (id.startsWith("MANUAL|")) continue;

      const sRaw = Number(z?.strength ?? NaN);
      if (!Number.isFinite(sRaw)) continue;
      if (sRaw >= INSTITUTIONAL_MIN) continue;

      const r = normalizeRange(z?.displayPriceRange ?? z?.priceRange);
      if (!r) continue;

      // trader-safe type: overhead = distribution, under = accumulation
      let type = "accumulation";
      if (Number.isFinite(currentPriceAnchor)) {
        if (r.lo > currentPriceAnchor) type = "distribution";
        else if (r.hi < currentPriceAnchor) type = "accumulation";
      }

      const conf = clamp01(sRaw / 100);
      const strength = mapShelfStrengthFromConfidence(conf);

      out.push({
        type,
        priceRange: [r.hi, r.lo],
        strength,
        strength_raw: round2(sRaw),
        confidence: round2(conf),
        rangeSource: "converted_structure",
        comment: `Converted from structure (${round2(sRaw)})`,
        firstSeenUtc: nowIso,
        lastSeenUtc: nowIso,
        maxStrengthSeen: strength,
      });
    }

    return out;
  } catch {
    return [];
  }
}

// manual shelves
function loadManualShelves(nowIso) {
  if (!fs.existsSync(MANUAL_FILE)) return [];
  try {
    const raw = fs.readFileSync(MANUAL_FILE, "utf8");
    const json = JSON.parse(raw);
    const arr = Array.isArray(json?.levels) ? json.levels : [];

    return arr
      .map((s) => {
        const type = normalizeType(s?.type);
        if (!type) return null;

        const r = normalizeRange(
          Array.isArray(s?.manualRange) && s.manualRange.length === 2 ? s.manualRange : s.priceRange
        );
        if (!r) return null;

        const scoreOverride = Number.isFinite(Number(s?.scoreOverride)) ? Number(s.scoreOverride) : null;
        const base = scoreOverride ?? Number(s?.strength ?? 75);

        const strength = clampInt(base, SHELF_STRENGTH_LO, SHELF_STRENGTH_HI);

        // best-effort confidence for manual shelves
        const conf = confidenceFromRawStrength(strength);

        return {
          type,
          priceRange: [r.hi, r.lo],
          strength,
          strength_raw: null,
          confidence: round2(conf),
          rangeSource: "manual",
          locked: true,
          scoreOverride,
          comment: typeof s?.comment === "string" ? s.comment : null,
          shelfKey: s?.shelfKey ?? null,
          status: s?.status ?? "active",
          firstSeenUtc: nowIso,
          lastSeenUtc: nowIso,
          maxStrengthSeen: strength,
        };
      })
      .filter(Boolean)
      .filter((s) => String(s.status).toLowerCase() !== "inactive");
  } catch {
    return [];
  }
}

// remove autos overlapping manual same type
function removeAutosOverlappingManualSameType(autoLevels, manualLevels) {
  if (!Array.isArray(autoLevels) || !autoLevels.length) return [];
  if (!Array.isArray(manualLevels) || !manualLevels.length) return autoLevels;

  return autoLevels.filter((a) => {
    const at = normalizeType(a?.type);
    if (!at) return false;

    const ar = normalizeRange(a?.priceRange);
    if (!ar) return false;

    const overlapsSameTypeManual = manualLevels.some((m) => {
      const mt = normalizeType(m?.type);
      if (!mt || mt !== at) return false;

      const mr = normalizeRange(m?.priceRange);
      if (!mr) return false;

      return rangesOverlap(ar.hi, ar.lo, mr.hi, mr.lo);
    });

    return !overlapsSameTypeManual;
  });
}

/**
 * ✅ Stable memory merge:
 * - Keep previous shelves within band and within 48 hours
 * - Only replace if new overlaps and beats by margin, OR new is manual
 */
function mergeWithMemoryStable(current, prev, currentPrice, nowIso) {
  const out = [];

  // 1) keep prev if in band and not expired
  for (const p of prev || []) {
    const r = normalizeRange(p?.priceRange);
    if (!r) continue;
    if (!withinBand(r, currentPrice, BAND_POINTS)) continue;

    const age = hoursSince(p?.lastSeenUtc);
    if (age > SHELF_PERSIST_HOURS) continue;

    const keep = { ...p };
    if (priceInside(currentPrice, r)) keep.lastSeenUtc = nowIso;

    const s = Number(keep.strength ?? 0);
    keep.maxStrengthSeen = Number(keep.maxStrengthSeen ?? s);
    out.push(keep);
  }

  // 2) merge in current detections with margin logic
  for (const n of current || []) {
    const rn = normalizeRange(n?.priceRange);
    if (!rn) continue;
    if (!withinBand(rn, currentPrice, BAND_POINTS)) continue;

    const nType = normalizeType(n?.type);
    if (!nType) continue;

    const nStrength = Number(n?.strength ?? 0);
    const nManual = isManualShelf(n);

    let merged = false;

    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      const oType = normalizeType(o?.type);
      if (oType !== nType) continue;

      const ro = normalizeRange(o?.priceRange);
      if (!ro) continue;

      if (!rangesOverlap(rn.hi, rn.lo, ro.hi, ro.lo)) continue;

      const oMax = Number(o.maxStrengthSeen ?? o.strength ?? 0);
      const oManual = isManualShelf(o);

      // Manual always wins
      if (nManual && !oManual) {
        out[i] = {
          ...o,
          ...n,
          firstSeenUtc: o.firstSeenUtc ?? nowIso,
          lastSeenUtc: nowIso,
          maxStrengthSeen: Math.max(oMax, nStrength),
        };
        merged = true;
        break;
      }

      // If both manual or both auto: only replace if strong enough margin
      const shouldReplace =
        (nStrength >= (oMax + REPLACE_MARGIN_PTS));

      if (shouldReplace) {
        out[i] = {
          ...o,
          ...n,
          firstSeenUtc: o.firstSeenUtc ?? nowIso,
          lastSeenUtc: nowIso,
          maxStrengthSeen: Math.max(oMax, nStrength),
        };
      } else {
        // keep old, but mark it seen
        out[i] = {
          ...o,
          lastSeenUtc: nowIso,
          maxStrengthSeen: oMax,
        };
      }

      merged = true;
      break;
    }

    if (!merged) {
      out.push({
        ...n,
        firstSeenUtc: n.firstSeenUtc ?? nowIso,
        lastSeenUtc: nowIso,
        maxStrengthSeen: Number(n.strength ?? 0),
      });
    }
  }

  return out;
}

/**
 * ✅ Final selection: exactly 1 Acc + 1 Dist
 * - Manual shelves win
 * - Otherwise strongest wins
 * - Tie-breaker: tighter width wins
 */
function pickBestPerTypeStable(levels, type) {
  const items = (Array.isArray(levels) ? levels : [])
    .filter((x) => normalizeType(x?.type) === type)
    .map((x) => {
      const r = normalizeRange(x?.priceRange);
      const width = r?.width ?? Infinity;
      const manual = isManualShelf(x) ? 1 : 0;
      const strength = Number(x?.strength ?? 0);
      const maxSeen = Number(x?.maxStrengthSeen ?? strength);
      return { x, width, manual, strength, maxSeen };
    })
    .filter((o) => o.width !== Infinity);

  if (!items.length) return null;

  items.sort((a, b) => {
    // manual first
    if (b.manual !== a.manual) return b.manual - a.manual;

    // then maxStrengthSeen
    if (b.maxSeen !== a.maxSeen) return b.maxSeen - a.maxSeen;

    // then current strength
    if (b.strength !== a.strength) return b.strength - a.strength;

    // then tighter width
    return a.width - b.width;
  });

  return items[0].x;
}

async function main() {
  try {
    console.log("[SHELVES] Fetching bars (DEEP)…");

    const [bars15mRaw, bars30mRaw, bars1hRaw] = await Promise.all([
      getBarsFromPolygonDeep(SYMBOL, "15m", DAYS_15M),
      getBarsFromPolygonDeep(SYMBOL, "30m", DAYS_30M),
      getBarsFromPolygonDeep(SYMBOL, "1h", DAYS_1H),
    ]);

    const bars15m = normalizeBars(bars15mRaw || []);
    const bars30m = normalizeBars(bars30mRaw || []);
    const bars1h = normalizeBars(bars1hRaw || []);

    const currentPriceAnchor =
      lastFiniteClose(bars30m) ?? lastFiniteClose(bars1h);

    if (!Number.isFinite(currentPriceAnchor)) {
      console.warn("[SHELVES] No finite close found; skipping run safely.");
      return;
    }

    const nowIso = isoNow();
    console.log("[SHELVES] currentPriceAnchor:", round2(currentPriceAnchor));

    const prevShelves = loadPrevShelves();

    // manual shelves
    const manualAll = loadManualShelves(nowIso);
    const manualInBand = manualAll.filter((s) => withinBand(normalizeRange(s.priceRange), currentPriceAnchor, BAND_POINTS));

    // converted shelves (structures <85 -> shelves)
    const convertedAll = convertStructuresToShelves(nowIso, currentPriceAnchor);
    const convertedInBand = convertedAll.filter((s) => withinBand(normalizeRange(s.priceRange), currentPriceAnchor, BAND_POINTS));

    // auto shelves from scanner
    console.log("[SHELVES] Running shelves scanner (Acc/Dist)…");
    const shelvesRaw =
      computeShelves({
        bars10m: bars15m,
        bars30m,
        bars1h,
        bandPoints: BAND_POINTS,
      }) || [];

    const shelvesBand = shelvesRaw.filter((s) => withinBand(normalizeRange(s?.priceRange), currentPriceAnchor, BAND_POINTS));

    // manual wins overlap (same type)
    const autoNoOverlap = removeAutosOverlappingManualSameType(shelvesBand, manualInBand);

    // map auto shelves into 65–89 and preserve truth fields
    const autoMapped = autoNoOverlap
      .map((s) => {
        const type = normalizeType(s?.type);
        if (!type) return null;

        const r = normalizeRange(s?.priceRange);
        if (!r) return null;

        const raw = Number(s?.strength_raw ?? s?.strength ?? 75);
        const conf = Number.isFinite(Number(s?.confidence))
          ? clamp01(Number(s.confidence))
          : confidenceFromRawStrength(raw);

        const strength = mapShelfStrengthFromConfidence(conf);

        return {
          type,
          priceRange: [r.hi, r.lo],
          strength,
          strength_raw: Number.isFinite(raw) ? round2(raw) : null,
          confidence: round2(conf),
          rangeSource: "auto",
          firstSeenUtc: nowIso,
          lastSeenUtc: nowIso,
          maxStrengthSeen: strength,
        };
      })
      .filter(Boolean);

    const currentShelves = [...manualInBand, ...convertedInBand, ...autoMapped];

    // stable persistence merge
    const withMemory = mergeWithMemoryStable(currentShelves, prevShelves, currentPriceAnchor, nowIso);

    // suppress shelves that overlap institutional zones (>=85)
    const instRanges = loadInstitutionalRangesForSuppression();
    const suppressed = withMemory.filter((s) => {
      const r = normalizeRange(s?.priceRange);
      if (!r) return false;
      const overlapsInst = instRanges.some((z) => overlapRatio(r.hi, r.lo, z.hi, z.lo) >= 0.25);
      return !overlapsInst;
    });

    // DEBUG: top candidates before final pick
    const levels_debug = suppressed
      .slice()
      .sort((a, b) => Number(b?.strength ?? 0) - Number(a?.strength ?? 0))
      .slice(0, DEBUG_LEVELS_COUNT);

    // FINAL: exactly 1 accumulation + 1 distribution
    const bestAcc = pickBestPerTypeStable(suppressed, "accumulation");
    const bestDist = pickBestPerTypeStable(suppressed, "distribution");

    const finalLevels = [];
    if (bestAcc) finalLevels.push(bestAcc);
    if (bestDist) finalLevels.push(bestDist);

    const payload = {
      ok: true,
      meta: {
        generated_at_utc: nowIso,
        symbol: SYMBOL,
        band_points: BAND_POINTS,
        current_price_anchor: round2(currentPriceAnchor),
        institutional_min: INSTITUTIONAL_MIN,
        shelf_persist_hours: SHELF_PERSIST_HOURS,
        replace_margin_pts: REPLACE_MARGIN_PTS,
        converted_structures_in_band: convertedInBand.length,
        manual_in_band: manualInBand.length,
        auto_in_band: autoMapped.length,
        debug_levels_count: DEBUG_LEVELS_COUNT,
      },
      levels: finalLevels,
      levels_debug,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("[SHELVES] Saved shelves to:", OUTFILE);
    console.log("[SHELVES] Job complete. levels:", finalLevels.length, "debug:", levels_debug.length);
  } catch (err) {
    console.error("[SHELVES] FAILED:", err);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
