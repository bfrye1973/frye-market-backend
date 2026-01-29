// services/core/jobs/updateSmzShelves.js
// Shelves Job — writes smz-shelves.json
//
// LOCKED USER RULES:
// - Institutional threshold = 85–100 (suppresses shelves inside by overlap filter)
// - Any non-manual, non-NEG sticky structure with strength < 85 becomes a shelf
// - Shelves persist 48 hours; revisit resets timer; stronger overlap replaces
// - Manual shelves override autos
// - Auto shelves come from scanner (computeShelves)
// - Cluster + cap + no-touch preserved
//
// IMPORTANT FIXES:
// - bars are normalized before using .close (prevents "No finite close")
// - withinBand helper included (no ReferenceError)

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

const DAYS_15M = 180;
const DAYS_30M = 180;
const DAYS_1H = 180;

const SHELF_STRENGTH_LO = 60;
const SHELF_STRENGTH_HI = 89;

const INSTITUTIONAL_MIN = 85;  // ✅ 85–100
const SHELF_PERSIST_HOURS = 48;

const SHELF_CLUSTER_OVERLAP = 0.55;
const SHELF_CLUSTER_GAP_PTS = 0.60;
const MAX_SHELVES_TOTAL = 8;

const isoNow = () => new Date().toISOString();
const round2 = (x) => Math.round(Number(x) * 100) / 100;

function clampInt(x, lo, hi) {
  const n = Math.round(Number(x));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
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
        const id = String(z?.details?.id ?? z?.structureKey ?? "");
        if (id.includes("|NEG|")) return false;
        const s = Number(z?.strength ?? NaN);
        return Number.isFinite(s) && s >= INSTITUTIONAL_MIN;
      })
      .map((z) => normalizeRange(z?.priceRange))
      .filter(Boolean)
      .map((r) => ({ hi: r.hi, lo: r.lo }));
  } catch {
    return [];
  }
}

// convert non-manual, non-NEG structures with strength <85 into shelves
function convertStructuresToShelves(nowIso) {
  if (!fs.existsSync(LEVELS_FILE)) return [];
  try {
    const raw = fs.readFileSync(LEVELS_FILE, "utf8");
    const json = JSON.parse(raw);
    const arr = Array.isArray(json?.structures_sticky) ? json.structures_sticky : [];

    const out = [];

    for (const z of arr) {
      const id = String(z?.details?.id ?? z?.structureKey ?? "");
      if (id.includes("|NEG|")) continue;
      if (id.startsWith("MANUAL|")) continue; // user controls manual institutionals

      const sRaw = Number(z?.strength ?? NaN);
      if (!Number.isFinite(sRaw)) continue;
      if (sRaw >= INSTITUTIONAL_MIN) continue; // 85+ stays institutional

      const r = normalizeRange(z?.priceRange);
      if (!r) continue;

      const facts = z?.details?.facts ?? {};
      const exitSide = facts?.exitSide1h ?? null;
      const type =
        exitSide === "below" ? "distribution" :
        exitSide === "above" ? "accumulation" :
        "accumulation";

      const strength = clampInt(sRaw, SHELF_STRENGTH_LO, SHELF_STRENGTH_HI);

      out.push({
        type,
        priceRange: [r.hi, r.lo],
        strength,
        strength_raw: round2(sRaw),
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

        return {
          type,
          priceRange: [r.hi, r.lo],
          strength,
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

  const out = autoLevels.filter((a) => {
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

  return out;
}

// clustering + cap + no-touch (kept)
function shelfOverlapRatio(a, b) {
  const ar = normalizeRange(a?.priceRange);
  const br = normalizeRange(b?.priceRange);
  if (!ar || !br) return 0;
  const interLo = Math.max(ar.lo, br.lo);
  const interHi = Math.min(ar.hi, br.hi);
  const inter = interHi - interLo;
  if (inter <= 0) return 0;
  const denom = Math.min(ar.width, br.width);
  return denom > 0 ? inter / denom : 0;
}

function shelfBelongsToCluster(s, rep) {
  const sr = normalizeRange(s?.priceRange);
  const rr = normalizeRange(rep?.priceRange);
  if (!sr || !rr) return false;

  const ov = shelfOverlapRatio(s, rep);
  if (ov >= SHELF_CLUSTER_OVERLAP) return true;

  const gap = rangeGapPts(sr.hi, sr.lo, rr.hi, rr.lo);
  if (gap <= SHELF_CLUSTER_GAP_PTS) return true;

  return false;
}

function pickBestOfType(items, type) {
  const list = (items || [])
    .filter((x) => normalizeType(x?.type) === type)
    .slice()
    .sort((a, b) => {
      const ma = isManualShelf(a) ? 1 : 0;
      const mb = isManualShelf(b) ? 1 : 0;
      if (mb !== ma) return mb - ma;
      const sb = Number(b?.strength ?? 0) - Number(a?.strength ?? 0);
      if (sb !== 0) return sb;
      const aw = normalizeRange(a?.priceRange)?.width ?? Infinity;
      const bw = normalizeRange(b?.priceRange)?.width ?? Infinity;
      return aw - bw;
    });

  return list[0] ?? null;
}

function collapseShelvesByCluster(levels) {
  const list = Array.isArray(levels) ? levels.slice() : [];
  if (!list.length) return [];

  list.sort((a, b) => Number(b?.strength ?? 0) - Number(a?.strength ?? 0));

  const clusters = [];

  for (const s of list) {
    const sr = normalizeRange(s?.priceRange);
    const st = normalizeType(s?.type);
    if (!sr || !st) continue;

    let placed = false;

    for (const c of clusters) {
      if (shelfBelongsToCluster(s, c.rep)) {
        c.members.push(s);

        const rep = c.rep;
        const repManual = isManualShelf(rep) ? 1 : 0;
        const sManual = isManualShelf(s) ? 1 : 0;

        if (sManual > repManual) c.rep = s;
        else if (sManual === repManual) {
          const ss = Number(s?.strength ?? 0);
          const rs = Number(rep?.strength ?? 0);
          if (ss > rs) c.rep = s;
          else if (ss === rs) {
            const sw = sr.width;
            const rw = normalizeRange(rep?.priceRange)?.width ?? Infinity;
            if (sw < rw) c.rep = s;
          }
        }

        placed = true;
        break;
      }
    }

    if (!placed) clusters.push({ rep: s, members: [s] });
  }

  const out = [];

  for (const c of clusters) {
    const bestAcc = pickBestOfType(c.members, "accumulation");
    const bestDist = pickBestOfType(c.members, "distribution");
    if (bestAcc) out.push(bestAcc);
    if (bestDist) out.push(bestDist);
  }

  out.sort((a, b) => Number(b?.strength ?? 0) - Number(a?.strength ?? 0));
  return out;
}

function applyGlobalCap(levels, maxTotal = MAX_SHELVES_TOTAL) {
  const list = Array.isArray(levels) ? levels.slice() : [];
  if (list.length <= maxTotal) return list;
  return list
    .slice()
    .sort((a, b) => Number(b?.strength ?? 0) - Number(a?.strength ?? 0))
    .slice(0, maxTotal);
}

function applyNoTouchWinnerPass(levels) {
  const list = Array.isArray(levels) ? levels.slice() : [];
  if (!list.length) return [];

  list.sort((a, b) => Number(b?.strength ?? 0) - Number(a?.strength ?? 0));

  const kept = [];
  for (const s of list) {
    const sr = normalizeRange(s?.priceRange);
    if (!sr) continue;

    const touchesExisting = kept.some((k) => {
      const kr = normalizeRange(k?.priceRange);
      if (!kr) return false;
      return rangesOverlap(sr.hi, sr.lo, kr.hi, kr.lo);
    });

    if (!touchesExisting) kept.push(s);
  }

  return kept;
}

// persistence merge: keep last 48h; revisit resets; stronger overlap replaces
function mergeWithMemory(current, prev, currentPrice, nowIso) {
  const out = [];

  // keep prev within band and not expired; revisit resets if price inside
  for (const p of prev || []) {
    const r = normalizeRange(p?.priceRange);
    if (!r) continue;
    if (!withinBand(r, currentPrice, BAND_POINTS)) continue;

    const age = hoursSince(p?.lastSeenUtc);
    if (age > SHELF_PERSIST_HOURS) continue;

    const updated = { ...p };
    if (priceInside(currentPrice, r)) updated.lastSeenUtc = nowIso;
    if (!updated.maxStrengthSeen) updated.maxStrengthSeen = Number(updated.strength ?? 0);
    out.push(updated);
  }

  // merge in current detections/conversions
  for (const n of current || []) {
    const rn = normalizeRange(n?.priceRange);
    if (!rn) continue;
    if (!withinBand(rn, currentPrice, BAND_POINTS)) continue;

    let merged = false;

    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      const ro = normalizeRange(o?.priceRange);
      if (!ro) continue;

      if (normalizeType(o?.type) !== normalizeType(n?.type)) continue;
      if (!rangesOverlap(rn.hi, rn.lo, ro.hi, ro.lo)) continue;

      const oldMax = Number(o.maxStrengthSeen ?? o.strength ?? 0);
      const newS = Number(n.strength ?? 0);

      if (newS > oldMax) {
        out[i] = {
          ...o,
          ...n,
          firstSeenUtc: o.firstSeenUtc ?? nowIso,
          lastSeenUtc: nowIso,
          maxStrengthSeen: newS,
        };
      } else {
        out[i] = { ...o, lastSeenUtc: nowIso, maxStrengthSeen: oldMax };
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
    const bars1h  = normalizeBars(bars1hRaw || []);

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

    // converted shelves
    const convertedAll = convertStructuresToShelves(nowIso);
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

    // remap auto strengths into 60–89 and normalize object shape
    const autoMapped = autoNoOverlap
      .map((s) => {
        const type = normalizeType(s?.type);
        if (!type) return null;
        const r = normalizeRange(s?.priceRange);
        if (!r) return null;
        const strength = clampInt(Number(s?.strength ?? 75), SHELF_STRENGTH_LO, SHELF_STRENGTH_HI);
        return {
          type,
          priceRange: [r.hi, r.lo],
          strength,
          rangeSource: "auto",
          firstSeenUtc: nowIso,
          lastSeenUtc: nowIso,
          maxStrengthSeen: strength,
        };
      })
      .filter(Boolean);

    const currentShelves = [...manualInBand, ...convertedInBand, ...autoMapped];

    // persistence merge
    const withMemory = mergeWithMemory(currentShelves, prevShelves, currentPriceAnchor, nowIso);

    // suppress shelves inside institutionals (>=85)
    const instRanges = loadInstitutionalRangesForSuppression();
    const suppressed = withMemory.filter((s) => {
      const r = normalizeRange(s?.priceRange);
      if (!r) return false;
      const overlapsInst = instRanges.some((z) => overlapRatio(r.hi, r.lo, z.hi, z.lo) >= 0.25);
      return !overlapsInst;
    });

    const collapsed = collapseShelvesByCluster(suppressed);
    const capped = applyGlobalCap(collapsed, MAX_SHELVES_TOTAL);
    const finalLevels = applyNoTouchWinnerPass(capped);

    const payload = {
      ok: true,
      meta: {
        generated_at_utc: nowIso,
        symbol: SYMBOL,
        band_points: BAND_POINTS,
        current_price_anchor: round2(currentPriceAnchor),
        institutional_min: INSTITUTIONAL_MIN,
        shelf_persist_hours: SHELF_PERSIST_HOURS,
        converted_structures_in_band: convertedInBand.length,
        manual_in_band: manualInBand.length,
        auto_in_band: autoMapped.length,
      },
      levels: finalLevels,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("[SHELVES] Saved shelves to:", OUTFILE);
    console.log("[SHELVES] Job complete. levels:", finalLevels.length);
  } catch (err) {
    console.error("[SHELVES] FAILED:", err);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
