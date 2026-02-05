// services/core/jobs/updateSmzShelves.js
// Shelves Job — writes smz-shelves.json
//
// ✅ GOAL (LOCKED):
// - Shelves are stable context zones between institutional parents.
// - Emit 1 best Acc + 1 best Dist per institutional interval.
// - Persist 48 hours, only replace if clearly stronger.
// - Manual shelves override autos.
// - Shelves NEVER yellow (frontend rule).
//
// ✅ FIXES INCLUDED:
// - Interval selection using Engine1 institutional anchors (smz-levels.json)
// - 48h persistence + replace margin guard
// - Final SAME-TYPE overlap de-dupe (prevents double distribution near 691)
// - Keeps levels_debug for audit
//
// NOTE:
// - Max shelf width is handled in smzShelvesScanner.js (you already set max width = 2.0 there)

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

// You can tighten later (6–10 recommended), but leaving as-is per your current beta
const BAND_POINTS = 40;

const DAYS_15M = 180;
const DAYS_30M = 180;
const DAYS_1H = 180;

// Shelf display band (policy)
const SHELF_STRENGTH_LO = 65;
const SHELF_STRENGTH_HI = 89;

// Institutional threshold (for suppression + anchor selection)
const INSTITUTIONAL_MIN = 85;

// Persistence
const SHELF_PERSIST_HOURS = 48;

// Stability guard: only replace if new is >= oldMax + margin
const REPLACE_MARGIN_PTS = 3;

// Debug
const DEBUG_LEVELS_COUNT = 25;

// Prevent too many intervals cluttering output
const MAX_INTERVALS_OUT = 6;

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

// If confidence missing: raw scanner score 40..100 -> 0..1
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
  return { hi, lo, width: round2(hi - lo), mid: round2((hi + lo) / 2) };
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

/**
 * Institutional anchors from Engine1 output:
 * - from smz-levels.json structures_sticky
 * - exclude negotiated
 * - include manual, and autos >=85
 * - prefer displayPriceRange if present (tighter is more correct)
 */
function loadInstitutionalAnchors(currentPriceAnchor) {
  if (!fs.existsSync(LEVELS_FILE)) return [];
  try {
    const raw = fs.readFileSync(LEVELS_FILE, "utf8");
    const json = JSON.parse(raw);

    const arr = Array.isArray(json?.structures_sticky) ? json.structures_sticky : [];
    const anchors = [];

    for (const z of arr) {
      const id = String(z?.details?.id ?? "");
      if (z?.isNegotiated === true) continue;
      if (id.includes("|NEG|")) continue;

      const s = Number(z?.strength_raw ?? z?.strength);
      if (!Number.isFinite(s)) continue;

      // manual always allowed; autos only if institutional strength
      const isManual = id.startsWith("MANUAL|");
      if (!isManual && s < INSTITUTIONAL_MIN) continue;

      const r = normalizeRange(z?.displayPriceRange ?? z?.priceRange);
      if (!r) continue;

      // only anchors near current band (prevents far-away anchors creating extra intervals)
      if (!withinBand(r, currentPriceAnchor, BAND_POINTS)) continue;

      anchors.push({ id, ...r, strength: s, isManual });
    }

    anchors.sort((a, b) => a.mid - b.mid);

    // merge near-identical midpoints (keep stronger/manual)
    const out = [];
    for (const a of anchors) {
      if (!out.length) out.push(a);
      else {
        const prev = out[out.length - 1];
        if (Math.abs(a.mid - prev.mid) < 0.25) {
          const aRank = (a.isManual ? 1000 : 0) + a.strength;
          const pRank = (prev.isManual ? 1000 : 0) + prev.strength;
          if (aRank > pRank) out[out.length - 1] = a;
        } else out.push(a);
      }
    }

    return out;
  } catch {
    return [];
  }
}

/**
 * Build intervals between anchors using midpoint boundaries.
 * Intervals are within the overall band around current price.
 */
function buildIntervalsFromAnchors(anchors, currentPriceAnchor) {
  const bandLo = round2(currentPriceAnchor - BAND_POINTS);
  const bandHi = round2(currentPriceAnchor + BAND_POINTS);

  if (!anchors.length) return [{ key: "GLOBAL", lo: bandLo, hi: bandHi }];

  const mids = anchors.map((a) => a.mid);
  const boundaries = [];
  for (let i = 0; i < mids.length - 1; i++) boundaries.push(round2((mids[i] + mids[i + 1]) / 2));

  const intervals = [];

  // first
  intervals.push({ key: "I0", lo: bandLo, hi: boundaries[0] ?? bandHi });

  // middle + last
  for (let i = 1; i < mids.length; i++) {
    const lo = boundaries[i - 1] ?? bandLo;
    const hi = boundaries[i] ?? bandHi;
    intervals.push({ key: `I${i}`, lo, hi });
  }

  // keep only intervals that intersect band; cap count
  return intervals
    .filter((it) => it.hi >= bandLo && it.lo <= bandHi)
    .slice(0, MAX_INTERVALS_OUT);
}

/**
 * Institutional suppression ranges (>=85, non-NEG)
 */
function loadInstitutionalRangesForSuppression() {
  if (!fs.existsSync(LEVELS_FILE)) return [];
  try {
    const raw = fs.readFileSync(LEVELS_FILE, "utf8");
    const json = JSON.parse(raw);
    const arr = Array.isArray(json?.structures_sticky) ? json.structures_sticky : [];

    return arr
      .filter((z) => {
        const id = String(z?.details?.id ?? "");
        if (z?.isNegotiated === true) return false;
        if (id.includes("|NEG|")) return false;
        const s = Number(z?.strength_raw ?? z?.strength);
        return Number.isFinite(s) && s >= INSTITUTIONAL_MIN;
      })
      .map((z) => normalizeRange(z?.displayPriceRange ?? z?.priceRange))
      .filter(Boolean)
      .map((r) => ({ hi: r.hi, lo: r.lo }));
  } catch {
    return [];
  }
}

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

/**
 * Convert weak structures (<85) to shelves (optional support)
 * Type chosen trader-safe: overhead = distribution, under = accumulation.
 */
function convertStructuresToShelves(nowIso, currentPriceAnchor) {
  if (!fs.existsSync(LEVELS_FILE)) return [];
  try {
    const raw = fs.readFileSync(LEVELS_FILE, "utf8");
    const json = JSON.parse(raw);
    const arr = Array.isArray(json?.structures_sticky) ? json.structures_sticky : [];

    const out = [];
    for (const z of arr) {
      const id = String(z?.details?.id ?? "");
      if (z?.isNegotiated === true) continue;
      if (id.includes("|NEG|")) continue;
      if (id.startsWith("MANUAL|")) continue;

      const sRaw = Number(z?.strength_raw ?? z?.strength);
      if (!Number.isFinite(sRaw)) continue;
      if (sRaw >= INSTITUTIONAL_MIN) continue;

      const r = normalizeRange(z?.displayPriceRange ?? z?.priceRange);
      if (!r) continue;

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
 * Stable 48h persistence merge with margin replace.
 */
function mergeWithMemoryStable(current, prev, currentPrice, nowIso) {
  const out = [];

  // keep prev if in band and not expired
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

  // merge in current detections
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

      // manual always overrides
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

      // replace only if margin
      const shouldReplace = nStrength >= (oMax + REPLACE_MARGIN_PTS);

      if (shouldReplace) {
        out[i] = {
          ...o,
          ...n,
          firstSeenUtc: o.firstSeenUtc ?? nowIso,
          lastSeenUtc: nowIso,
          maxStrengthSeen: Math.max(oMax, nStrength),
        };
      } else {
        out[i] = { ...o, lastSeenUtc: nowIso, maxStrengthSeen: oMax };
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
 * Interval membership by mid price.
 */
function intervalContainsMid(interval, mid) {
  return mid >= interval.lo && mid <= interval.hi;
}

/**
 * Pick best per type inside interval.
 */
function pickBestPerTypeInInterval(levels, interval, type) {
  const items = (Array.isArray(levels) ? levels : [])
    .filter((x) => normalizeType(x?.type) === type)
    .map((x) => {
      const r = normalizeRange(x?.priceRange);
      if (!r) return null;
      if (!intervalContainsMid(interval, r.mid)) return null;

      const manual = isManualShelf(x) ? 1 : 0;
      const strength = Number(x?.strength ?? 0);
      const maxSeen = Number(x?.maxStrengthSeen ?? strength);

      // center preference reduces edge spam
      const center = (interval.lo + interval.hi) / 2;
      const distToCenter = Math.abs(r.mid - center);

      return { x, manual, strength, maxSeen, width: r.width, distToCenter };
    })
    .filter(Boolean);

  if (!items.length) return null;

  items.sort((a, b) => {
    if (b.manual !== a.manual) return b.manual - a.manual;
    if (b.maxSeen !== a.maxSeen) return b.maxSeen - a.maxSeen;
    if (b.strength !== a.strength) return b.strength - a.strength;
    if (a.distToCenter !== b.distToCenter) return a.distToCenter - b.distToCenter;
    return a.width - b.width;
  });

  return items[0].x;
}

/**
 * FINAL cleanup: remove same-type overlapping shelves (prevents double distribution near 691)
 * - If overlapRatio >= 0.25, keep stronger
 * - Prefer auto over converted_structure on ties
 */
function dedupeOverlappingShelvesSameType(levels) {
  const list = Array.isArray(levels) ? levels.slice() : [];

  list.sort((a, b) => {
    const sa = Number(a?.strength ?? 0);
    const sb = Number(b?.strength ?? 0);
    if (sb !== sa) return sb - sa;

    const aAuto = String(a?.rangeSource) === "auto" ? 1 : 0;
    const bAuto = String(b?.rangeSource) === "auto" ? 1 : 0;
    if (bAuto !== aAuto) return bAuto - aAuto;

    return 0;
  });

  const kept = [];
  for (const s of list) {
    const sr = normalizeRange(s?.priceRange);
    if (!sr) continue;

    const st = normalizeType(s?.type);
    if (!st) continue;

    const overlapsSameType = kept.some((k) => {
      const kt = normalizeType(k?.type);
      if (kt !== st) return false;

      const kr = normalizeRange(k?.priceRange);
      if (!kr) return false;

      return overlapRatio(sr.hi, sr.lo, kr.hi, kr.lo) >= 0.25;
    });

    if (!overlapsSameType) kept.push(s);
  }

  return kept;
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

    const currentPriceAnchor = lastFiniteClose(bars30m) ?? lastFiniteClose(bars1h);
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

    // converted shelves
    const convertedAll = convertStructuresToShelves(nowIso, currentPriceAnchor);
    const convertedInBand = convertedAll.filter((s) => withinBand(normalizeRange(s.priceRange), currentPriceAnchor, BAND_POINTS));

    // auto shelves from scanner
    console.log("[SHELVES] Running shelves scanner…");
    const shelvesRaw =
      computeShelves({ bars10m: bars15m, bars30m, bars1h, bandPoints: BAND_POINTS }) || [];

    const shelvesBand = shelvesRaw.filter((s) => withinBand(normalizeRange(s?.priceRange), currentPriceAnchor, BAND_POINTS));

    // manual wins overlap (same type)
    const autoNoOverlap = removeAutosOverlappingManualSameType(shelvesBand, manualInBand);

    // map autos to policy strength
    const autoMapped = autoNoOverlap
      .map((s) => {
        const type = normalizeType(s?.type);
        if (!type) return null;

        const r = normalizeRange(s?.priceRange);
        if (!r) return null;

        const raw = Number(s?.strength_raw ?? s?.strength ?? 75);
        const conf = Number.isFinite(Number(s?.confidence)) ? clamp01(Number(s.confidence)) : confidenceFromRawStrength(raw);
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

    // suppress shelves inside institutional parents
    const instRanges = loadInstitutionalRangesForSuppression();
    const suppressed = withMemory.filter((s) => {
      const r = normalizeRange(s?.priceRange);
      if (!r) return false;
      const overlapsInst = instRanges.some((z) => overlapRatio(r.hi, r.lo, z.hi, z.lo) >= 0.25);
      return !overlapsInst;
    });

    // debug list (audit)
    const levels_debug = suppressed
      .slice()
      .sort((a, b) => Number(b?.strength ?? 0) - Number(a?.strength ?? 0))
      .slice(0, DEBUG_LEVELS_COUNT);

    // build institutional intervals and pick 1+1 per interval
    const anchors = loadInstitutionalAnchors(currentPriceAnchor);
    const intervals = buildIntervalsFromAnchors(anchors, currentPriceAnchor);

    const picked = [];
    for (const it of intervals) {
      const bestAcc = pickBestPerTypeInInterval(suppressed, it, "accumulation");
      const bestDist = pickBestPerTypeInInterval(suppressed, it, "distribution");
      if (bestAcc) picked.push(bestAcc);
      if (bestDist) picked.push(bestDist);
    }

    // de-dupe exact duplicates first
    const seen = new Set();
    const dedup = [];
    for (const s of picked) {
      const r = normalizeRange(s?.priceRange);
      if (!r) continue;
      const key = `${normalizeType(s?.type)}|${r.lo}-${r.hi}|${String(s?.rangeSource ?? "")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(s);
    }

    // FINAL de-dupe: remove same-type overlap stacks
    const finalLevels = dedupeOverlappingShelvesSameType(dedup);

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
        institutional_anchors_in_band: anchors.length,
        intervals_out: intervals.length,
      },
      levels: finalLevels,
      levels_debug,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("[SHELVES] Saved:", OUTFILE);
    console.log("[SHELVES] levels:", finalLevels.length, "debug:", levels_debug.length);
  } catch (err) {
    console.error("[SHELVES] FAILED:", err);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
