// services/core/jobs/updateSmzShelves.js
// Shelves Job — 30m detection + 1h confirmation
// Writes smz-shelves.json
//
// ✅ Locked now:
// - Detection = 30m only
// - Confirmation = 1h only
// - Shelves stable profit targets (48h persistence + margin replacement)
// - Output is cleaned (no stacked same-type shelves too close)

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

const DAYS_30M = 180;
const DAYS_1H = 365;

const SHELF_STRENGTH_LO = 65;
const SHELF_STRENGTH_HI = 89;

const INSTITUTIONAL_MIN = 85;
const SHELF_PERSIST_HOURS = 48;

const REPLACE_MARGIN_PTS = 6;
const REPLACE_BIG_WIN_PTS = 12;
const MIN_HOLD_MINUTES = 60;

const SAME_TYPE_OVERLAP_DEDUPE_RATIO = 0.25;
const SAME_TYPE_GAP_PTS = 0.75;

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
function mapShelfStrengthFromConfidence(conf) {
  const c = clamp01(conf);
  const mapped = Math.round(SHELF_STRENGTH_LO + (SHELF_STRENGTH_HI - SHELF_STRENGTH_LO) * c);
  return clampInt(mapped, SHELF_STRENGTH_LO, SHELF_STRENGTH_HI);
}
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

function rangeGapPts(aHi, aLo, bHi, bLo) {
  if (rangesOverlap(aHi, aLo, bHi, bLo)) return 0;
  if (aHi < bLo) return bLo - aHi;
  if (bHi < aLo) return aLo - bHi;
  return 0;
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

function minutesSince(ts) {
  const t = Date.parse(ts || "");
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (60 * 1000);
}
function hoursSince(ts) {
  const t = Date.parse(ts || "");
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (3600 * 1000);
}
function priceInside(price, r) {
  return Number.isFinite(price) && price >= r.lo && price <= r.hi;
}

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

function mergeWithMemoryStable(current, prev, currentPrice, nowIso) {
  const out = [];

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

      if (nManual && !oManual) {
        out[i] = { ...o, ...n, firstSeenUtc: o.firstSeenUtc ?? nowIso, lastSeenUtc: nowIso, maxStrengthSeen: Math.max(oMax, nStrength) };
        merged = true;
        break;
      }

      const ageMin = minutesSince(o.firstSeenUtc);
      const need = (ageMin < MIN_HOLD_MINUTES) ? (oMax + REPLACE_BIG_WIN_PTS) : (oMax + REPLACE_MARGIN_PTS);

      if (nStrength >= need) {
        out[i] = { ...o, ...n, firstSeenUtc: o.firstSeenUtc ?? nowIso, lastSeenUtc: nowIso, maxStrengthSeen: Math.max(oMax, nStrength) };
      } else {
        out[i] = { ...o, lastSeenUtc: nowIso, maxStrengthSeen: oMax };
      }

      merged = true;
      break;
    }

    if (!merged) {
      out.push({ ...n, firstSeenUtc: n.firstSeenUtc ?? nowIso, lastSeenUtc: nowIso, maxStrengthSeen: Number(n.strength ?? 0) });
    }
  }

  return out;
}

function dedupeSameTypeClose(levels) {
  const list = Array.isArray(levels) ? levels.slice() : [];
  list.sort((a, b) => Number(b?.strength ?? 0) - Number(a?.strength ?? 0));

  const kept = [];
  for (const s of list) {
    const sr = normalizeRange(s?.priceRange);
    if (!sr) continue;

    const st = normalizeType(s?.type);
    if (!st) continue;

    const dupe = kept.some((k) => {
      const kt = normalizeType(k?.type);
      if (kt !== st) return false;

      const kr = normalizeRange(k?.priceRange);
      if (!kr) return false;

      const ov = overlapRatio(sr.hi, sr.lo, kr.hi, kr.lo);
      const gap = rangeGapPts(sr.hi, sr.lo, kr.hi, kr.lo);

      return ov >= SAME_TYPE_OVERLAP_DEDUPE_RATIO || gap <= SAME_TYPE_GAP_PTS;
    });

    if (!dupe) kept.push(s);
  }
  return kept;
}

async function main() {
  try {
    const [bars30mRaw, bars1hRaw] = await Promise.all([
      getBarsFromPolygonDeep(SYMBOL, "30m", DAYS_30M),
      getBarsFromPolygonDeep(SYMBOL, "1h", DAYS_1H),
    ]);

    const bars30m = normalizeBars(bars30mRaw || []);
    const bars1h = normalizeBars(bars1hRaw || []);

    const currentPriceAnchor = lastFiniteClose(bars30m) ?? lastFiniteClose(bars1h);
    if (!Number.isFinite(currentPriceAnchor)) return;

    const nowIso = isoNow();
    const prevShelves = loadPrevShelves();

    const manualAll = loadManualShelves(nowIso);
    const manualInBand = manualAll.filter((s) => withinBand(normalizeRange(s.priceRange), currentPriceAnchor, BAND_POINTS));

    // 30m detection + 1h confirmation
    const shelvesRaw = computeShelves({ bars30m, bars1h, bandPoints: BAND_POINTS }) || [];

    // map to policy scoring
    const autoMapped = shelvesRaw
      .map((s) => {
        const type = normalizeType(s?.type);
        if (!type) return null;

        const r = normalizeRange(s?.priceRange);
        if (!r) return null;

        const raw = Number(s?.strength_raw ?? 75);
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

    const currentShelves = [...manualInBand, ...autoMapped];

    const withMemory = mergeWithMemoryStable(currentShelves, prevShelves, currentPriceAnchor, nowIso);

    // suppress inside institutional
    const instRanges = loadInstitutionalRangesForSuppression();
    const suppressed = withMemory.filter((s) => {
      const r = normalizeRange(s?.priceRange);
      if (!r) return false;
      const overlapsInst = instRanges.some((z) => overlapRatio(r.hi, r.lo, z.hi, z.lo) >= 0.25);
      return !overlapsInst;
    });

    // FINAL: keep only 1 best acc + 1 best dist overall (profit target map)
    const bestAcc = suppressed.filter(s => normalizeType(s?.type) === "accumulation")
      .sort((a,b)=> Number(b?.maxStrengthSeen ?? b?.strength ?? 0) - Number(a?.maxStrengthSeen ?? a?.strength ?? 0))[0] ?? null;

    const bestDist = suppressed.filter(s => normalizeType(s?.type) === "distribution")
      .sort((a,b)=> Number(b?.maxStrengthSeen ?? b?.strength ?? 0) - Number(a?.maxStrengthSeen ?? a?.strength ?? 0))[0] ?? null;

    let finalLevels = [];
    if (bestAcc) finalLevels.push(bestAcc);
    if (bestDist) finalLevels.push(bestDist);

    finalLevels = dedupeSameTypeClose(finalLevels);

    const levels_debug = suppressed
      .slice()
      .sort((a, b) => Number(b?.strength ?? 0) - Number(a?.strength ?? 0))
      .slice(0, DEBUG_LEVELS_COUNT);

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
        min_hold_minutes: MIN_HOLD_MINUTES,
        debug_levels_count: DEBUG_LEVELS_COUNT,
      },
      levels: finalLevels,
      levels_debug,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");
  } catch (e) {
    console.error("[SHELVES] FAILED:", e);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
