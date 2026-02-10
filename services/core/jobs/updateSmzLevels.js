// services/core/jobs/updateSmzLevels.js
// Engine 1 SMZ job (stable + auto negotiated + institutional spacing)
// - Runs smzEngine (LOCKED — DO NOT MODIFY)
// - Updates sticky registry (AUTO ONLY)
// - Loads manual structures from smz-manual-structures.json (SOURCE OF TRUTH)
// - Writes smz-levels.json for frontend
//
// ✅ NEW:
// - Auto-detect NEGOTIATED zones inside institutional parents using acceptance density
// - Emit negotiated zones as separate objects (turquoise overlay)
// - Enforce institutional parent min-gap (6 pts) to prevent overlapping institutional blobs
//
// LOCKED REQUIREMENTS (per user):
// ✅ smzEngine.js untouched
// ✅ manual zones persist across runs
// ✅ manual zones NOT stored in registry
// ✅ manual zones immune to caps/cleanup/overlap suppression
// ✅ structures_sticky: manual first, then auto, then negotiated
// ✅ AUTO institutional max width = 4.0 pts
// ✅ manual structures ALWAYS emitted (not band-limited)
// ✅ if engine compute fails, still emit manual structures (never go blind)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js"; // LOCKED
import { getBarsFromPolygonDeep } from "../../../api/providers/polygonBarsDeep.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-levels.json");
const STICKY_FILE = path.resolve(__dirname, "../data/smz-structures-registry.json");
const MANUAL_FILE = path.resolve(__dirname, "../data/smz-manual-structures.json");

// Lookbacks
const DAYS_30M = 180;
const DAYS_1H = 365;

// Sticky settings
const STICKY_ROUND_STEP = 0.25;
const STICKY_KEEP_WITHIN_BAND_PTS = 40; // AUTO ONLY
const STICKY_ARCHIVE_DAYS = 30;
const STICKY_MAX_WITHIN_BAND = 12;

const STICKY_INCLUDE_MICRO_MIN_STRENGTH = 80;

// Institutional “monster” guard (AUTO ONLY)
const STRUCT_AUTO_MAX_WIDTH_PTS = 4.0;

// Debug/beta
const DEBUG_LEVELS_COUNT = 25;
const INSTITUTIONAL_MIN = 85;
const SMZ_PRIME_MIN = 90;

// Institutional spacing (prevents overlapping parents)
const INST_MIN_GAP_PTS = 6.0;

// Acceptance density tightening
const DENSITY_STEP = 0.25;
const DENSITY_LOOKBACK_1H_BARS = 90;
const DENSITY_MIN_CLOSES = 10;
const DENSITY_TARGET_COVERAGE = 0.55;
const DENSITY_MAX_TIGHT_WIDTH = 2.6;
const DENSITY_MIN_IMPROVEMENT = 0.6;

const isoNow = () => new Date().toISOString();
const round2 = (x) => Math.round(Number(x) * 100) / 100;

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function confidenceFromInstitutionalStrength(strength) {
  const s = Number(strength);
  if (!Number.isFinite(s)) return 0;
  return clamp01((s - 75) / 25);
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

function aggregateTo4h(bars1h) {
  if (!Array.isArray(bars1h) || bars1h.length < 8) return [];
  const out = [];
  let cur = null;

  for (const b of bars1h) {
    const block = Math.floor(b.time / (4 * 3600)) * (4 * 3600);
    if (!cur || cur.time !== block) {
      if (cur) out.push(cur);
      cur = {
        time: block,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume ?? 0,
      };
    } else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume += b.volume ?? 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function snapStep(x, step) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / step) * step;
}

function rangesOverlap(hiA, loA, hiB, loB) {
  const aHi = Math.max(Number(hiA), Number(loA));
  const aLo = Math.min(Number(hiA), Number(loA));
  const bHi = Math.max(Number(hiB), Number(loB));
  const bLo = Math.min(Number(hiB), Number(loB));
  if (![aHi, aLo, bHi, bLo].every(Number.isFinite)) return false;
  return !(aHi < bLo || aLo > bHi);
}

function rangeFromPriceRange(pr) {
  if (!Array.isArray(pr) || pr.length !== 2) return null;
  const a = Number(pr[0]);
  const b = Number(pr[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return { hi, lo, width: hi - lo };
}

/* -------------------------
   Acceptance Density Tightening (display core)
------------------------- */
function tightenDisplayRangeByCloseDensity(bars1h, pr) {
  const r = rangeFromPriceRange(pr);
  if (!r) return null;

  const hi = r.hi;
  const lo = r.lo;
  const width = r.width;

  if (!(width > 1.4 && width <= STRUCT_AUTO_MAX_WIDTH_PTS + 0.25)) return null;

  const slice = Array.isArray(bars1h) ? bars1h.slice(-DENSITY_LOOKBACK_1H_BARS) : [];
  if (slice.length < 30) return null;

  const closes = [];
  for (const b of slice) {
    const c = Number(b?.close);
    if (!Number.isFinite(c)) continue;
    if (c >= lo && c <= hi) closes.push(c);
  }
  if (closes.length < DENSITY_MIN_CLOSES) return null;

  const bins = new Map();
  const snap = (x) => Math.round(x / DENSITY_STEP) * DENSITY_STEP;
  for (const c of closes) {
    const k = snap(c);
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }

  let peakK = null;
  let peakCount = -1;
  for (const [k, count] of bins.entries()) {
    if (count > peakCount) {
      peakCount = count;
      peakK = k;
    }
  }
  if (peakK == null) return null;

  const keys = Array.from(bins.keys()).sort((a, b) => a - b);
  const idx = keys.indexOf(peakK);
  if (idx < 0) return null;

  const total = closes.length;
  const target = Math.ceil(total * DENSITY_TARGET_COVERAGE);

  let left = idx;
  let right = idx;
  let covered = bins.get(peakK) ?? 0;

  const bandWidth = () => (keys[right] - keys[left]) + DENSITY_STEP;

  while (covered < target) {
    const canLeft = left > 0;
    const canRight = right < keys.length - 1;
    if (!canLeft && !canRight) break;

    const nextLeftK = canLeft ? keys[left - 1] : null;
    const nextRightK = canRight ? keys[right + 1] : null;
    const leftCount = canLeft ? (bins.get(nextLeftK) ?? 0) : -1;
    const rightCount = canRight ? (bins.get(nextRightK) ?? 0) : -1;

    if (rightCount > leftCount) {
      right++;
      covered += rightCount;
    } else {
      left--;
      covered += leftCount;
    }

    if (bandWidth() > DENSITY_MAX_TIGHT_WIDTH) break;
  }

  const newLo = round2(keys[left]);
  const newHi = round2(keys[right] + DENSITY_STEP);
  const newWidth = newHi - newLo;

  if (!(newHi > newLo)) return null;
  if (newWidth > DENSITY_MAX_TIGHT_WIDTH) return null;
  if ((width - newWidth) < DENSITY_MIN_IMPROVEMENT) return null;

  const coverage = round2(covered / total);

  return {
    displayPriceRange: [newHi, newLo],
    displayWidthPts: round2(newWidth),
    coverage,
    closesInZone: total,
  };
}

/* ---------------- Manual structures ---------------- */

function normalizeManualStructure(s) {
  const mr = Array.isArray(s?.manualRange) ? s.manualRange : null;
  const pr = Array.isArray(s?.priceRange) ? s.priceRange : null;

  const hi0 = Number(mr?.[0] ?? pr?.[0]);
  const lo0 = Number(mr?.[1] ?? pr?.[1]);
  if (!Number.isFinite(hi0) || !Number.isFinite(lo0)) return null;

  const hi = round2(Math.max(hi0, lo0));
  const lo = round2(Math.min(hi0, lo0));
  if (!(hi > lo)) return null;

  const structureKey =
    typeof s?.structureKey === "string" && s.structureKey.length
      ? s.structureKey
      : `MANUAL|SPY|${lo.toFixed(2)}-${hi.toFixed(2)}`;

  const notes = typeof s?.notes === "string" ? s.notes : null;
  const isNegotiated = structureKey.includes("|NEG|") || (notes && notes.toUpperCase().includes("NEGOTIATED"));

  return {
    structureKey,
    symbol: "SPY",
    tier: "structure",
    manualRange: [hi, lo],
    priceRange: [hi, lo],
    locked: true,
    rangeSource: "manual",
    status: "active",
    stickyConfirmed: true,
    ...(notes ? { notes } : {}),
    isNegotiated: !!isNegotiated,
  };
}

function loadManualStructures() {
  if (!fs.existsSync(MANUAL_FILE)) return [];
  try {
    const raw = fs.readFileSync(MANUAL_FILE, "utf8");
    const json = JSON.parse(raw);
    const arr = Array.isArray(json?.structures) ? json.structures : [];
    return arr.map(normalizeManualStructure).filter(Boolean);
  } catch {
    return [];
  }
}

function manualOverlapsAny(manualList, hi, lo) {
  for (const m of manualList || []) {
    const r = Array.isArray(m?.manualRange) ? m.manualRange : m?.priceRange;
    if (!Array.isArray(r) || r.length !== 2) continue;
    if (rangesOverlap(hi, lo, r[0], r[1])) return true;
  }
  return false;
}

function manualStructureRanges(manualStructures) {
  return (manualStructures || [])
    .map((m) => {
      const r = Array.isArray(m?.manualRange) ? m.manualRange : m?.priceRange;
      const rr = rangeFromPriceRange(r);
      return rr ? { hi: rr.hi, lo: rr.lo } : null;
    })
    .filter(Boolean);
}

function filterLiveLevelsByManualAndWidth(levelsLive, manualStructures) {
  const manual = manualStructureRanges(manualStructures);
  const kept = [];

  for (const z of levelsLive || []) {
    const tier = String(z?.tier ?? "");
    if (tier !== "structure") {
      kept.push(z);
      continue;
    }

    const r = rangeFromPriceRange(z?.priceRange);
    if (!r) {
      kept.push(z);
      continue;
    }

    const overlapsManual = manual.some((m) => rangesOverlap(r.hi, r.lo, m.hi, m.lo));
    if (overlapsManual) continue;

    if (r.width > STRUCT_AUTO_MAX_WIDTH_PTS) continue;

    kept.push(z);
  }

  return kept;
}

/* ---------------- Sticky registry (AUTO ONLY) ---------------- */

function loadSticky() {
  try {
    if (!fs.existsSync(STICKY_FILE))
      return { ok: true, meta: { created_at_utc: isoNow() }, structures: [] };
    const raw = fs.readFileSync(STICKY_FILE, "utf8");
    const json = JSON.parse(raw);
    return {
      ok: true,
      meta: json?.meta ?? { created_at_utc: isoNow() },
      structures: Array.isArray(json?.structures) ? json.structures : [],
    };
  } catch {
    return { ok: true, meta: { created_at_utc: isoNow(), recovered: true }, structures: [] };
  }
}

function saveSticky(store) {
  fs.mkdirSync(path.dirname(STICKY_FILE), { recursive: true });
  fs.writeFileSync(STICKY_FILE, JSON.stringify(store, null, 2), "utf8");
}

function isManualLike(s) {
  return !!(
    s &&
    (s.rangeSource === "manual" ||
      (Array.isArray(s.manualRange) && s.manualRange.length === 2) ||
      (typeof s.structureKey === "string" && s.structureKey.startsWith("MANUAL|")))
  );
}

function stripManualFromRegistryStore(store) {
  const structures = (store?.structures || []).filter((s) => !isManualLike(s));
  return { ...(store || {}), structures };
}

function structureKeyFromRange(hi, lo) {
  const qHi = snapStep(hi, STICKY_ROUND_STEP);
  const qLo = snapStep(lo, STICKY_ROUND_STEP);
  return `SPY|mixed|hi=${qHi?.toFixed(2)}|lo=${qLo?.toFixed(2)}`;
}

/* ---------------- AUTO negotiated zone emitter ---------------- */

function buildAutoNegotiatedZone({ parentId, parentStrength, parentConfidence, acceptance }) {
  const pr = acceptance?.displayPriceRange;
  if (!Array.isArray(pr) || pr.length !== 2) return null;

  const hi = Number(pr[0]);
  const lo = Number(pr[1]);
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || !(hi > lo)) return null;

  const key = `AUTO|SPY|NEG|${lo.toFixed(2)}-${hi.toFixed(2)}|PARENT=${parentId}`;

  return {
    type: "institutional",
    tier: "structure_sticky",
    priceRange: [round2(hi), round2(lo)],
    displayPriceRange: [round2(hi), round2(lo)],
    strength: parentStrength,
    strength_raw: parentStrength,
    confidence: parentConfidence,
    isNegotiated: true,
    details: {
      id: key,
      facts: {
        negotiated: {
          source: "auto_detected",
          parentId,
          coverage: acceptance.coverage,
          closesInZone: acceptance.closesInZone,
          displayWidthPts: acceptance.displayWidthPts,
        },
      },
    },
  };
}

/* ---------------- Institutional min-gap reducer ---------------- */

function institutionalPriorityScore(z, ownsNeg) {
  const id = String(z?.details?.id ?? z?.structureKey ?? "");
  const isManual = id.startsWith("MANUAL|") ? 1 : 0;
  const strength = Number(z?.strength_raw ?? z?.strength ?? 0);
  const stickyFacts = z?.details?.facts?.sticky ?? {};
  const timesSeen = Number(stickyFacts?.timesSeen ?? 0);
  return (isManual * 1_000_000) + (ownsNeg ? 100_000 : 0) + (strength * 1_000) + timesSeen;
}

function getMidFromZone(z) {
  const pr = z?.displayPriceRange ?? z?.priceRange;
  if (!Array.isArray(pr) || pr.length !== 2) return null;
  const a = Number(pr[0]);
  const b = Number(pr[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (!(hi > lo)) return null;
  return (hi + lo) / 2;
}

function enforceInstitutionalMinGap(parents, ownedNegParentIds = new Set()) {
  const list = (Array.isArray(parents) ? parents.slice() : [])
    .map((z) => {
      const id = String(z?.details?.id ?? z?.structureKey ?? "");
      const mid = getMidFromZone(z);
      const ownsNeg = ownedNegParentIds.has(id);
      const score = institutionalPriorityScore(z, ownsNeg);
      return { z, id, mid, score };
    })
    .filter((x) => Number.isFinite(x.mid));

  list.sort((a, b) => b.score - a.score);

  const kept = [];
  for (const item of list) {
    const tooClose = kept.some((k) => Math.abs(item.mid - k.mid) < INST_MIN_GAP_PTS);
    if (!tooClose) kept.push(item);
  }

  return kept.map((k) => k.z);
}

/* ---------------- main ---------------- */

async function main() {
  const manualStructures = loadManualStructures();

  try {
    const [bars30mRaw, bars1hRaw] = await Promise.all([
      getBarsFromPolygonDeep("SPY", "30m", DAYS_30M),
      getBarsFromPolygonDeep("SPY", "1h", DAYS_1H),
    ]);

    const bars30m = normalizeBars(bars30mRaw);
    const bars1h = normalizeBars(bars1hRaw);
    const bars4h = aggregateTo4h(bars1h);

    const currentPrice =
      (bars30m.length ? bars30m[bars30m.length - 1].close : null) ??
      (bars1h.length ? bars1h[bars1h.length - 1].close : null);

    // Engine compute (locked)
    let levelsEngineRaw = [];
    try {
      levelsEngineRaw = computeSmartMoneyLevels(bars30m, bars1h, bars4h) || [];
    } catch {
      levelsEngineRaw = [];
    }

    // filter live structures by manual overlap + max width
    let levelsLive = filterLiveLevelsByManualAndWidth(levelsEngineRaw, manualStructures);

    // add truth fields + acceptance tightening
    levelsLive = (levelsLive || []).map((z) => {
      const raw = Number(z?.strength ?? NaN);
      const conf = confidenceFromInstitutionalStrength(raw);
      const id = String(z?.details?.id ?? "");
      const notes = z?.details?.facts?.notes ?? z?.details?.notes ?? null;
      const isNeg = id.includes("|NEG|") || (typeof notes === "string" && notes.toUpperCase().includes("NEGOTIATED"));

      const tight = tightenDisplayRangeByCloseDensity(bars1h, z?.priceRange);

      return {
        ...z,
        strength_raw: Number.isFinite(raw) ? round2(raw) : null,
        confidence: round2(conf),
        isNegotiated: !!isNeg,
        displayPriceRange: tight?.displayPriceRange ?? z?.priceRange,
        details: {
          ...(z.details ?? {}),
          facts: {
            ...(z.details?.facts ?? {}),
            ...(tight ? { acceptanceTightened: true, acceptance: tight } : {}),
          },
        },
      };
    });

    // Sticky candidates
    const stickyCandidates = levelsLive.filter((z) => {
      const t = z?.tier ?? "";
      if (t === "structure") return true;
      if (t === "micro" && Number(z?.strength ?? 0) >= STICKY_INCLUDE_MICRO_MIN_STRENGTH) return true;
      return false;
    });

    // Update registry (AUTO ONLY)
    let store = stripManualFromRegistryStore(loadSticky());
    const list = (store.structures || []).slice();
    const nowIso = isoNow();

    const byKey = new Map();
    for (const s of list) if (s?.structureKey) byKey.set(s.structureKey, s);

    for (const z of stickyCandidates || []) {
      const pr = z?.priceRange;
      if (!Array.isArray(pr) || pr.length !== 2) continue;

      const hi = Number(pr[0]);
      const lo = Number(pr[1]);
      if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) continue;

      if (manualOverlapsAny(manualStructures, hi, lo)) continue;
      if ((hi - lo) > STRUCT_AUTO_MAX_WIDTH_PTS) continue;

      const key = structureKeyFromRange(hi, lo);
      const existing = byKey.get(key);

      if (existing) {
        existing.lastSeenUtc = nowIso;
        existing.timesSeen = Number(existing.timesSeen ?? 0) + 1;
        existing.maxStrengthSeen = Math.max(Number(existing.maxStrengthSeen ?? 0), Number(z.strength ?? 0));
        existing.status = "active";
      } else {
        const entry = {
          structureKey: key,
          priceRange: [round2(hi), round2(lo)],
          firstSeenUtc: nowIso,
          lastSeenUtc: nowIso,
          timesSeen: 1,
          maxStrengthSeen: Number(z.strength ?? 0),
          status: "active",
          stickyConfirmed: false,
          confirmedUtc: null,
          exits: [],
          distinctExitCount: 0,
        };
        list.push(entry);
        byKey.set(key, entry);
      }
    }

    const newStore = {
      ok: true,
      meta: { ...(store.meta ?? {}), updated_at_utc: nowIso },
      structures: list.filter((s) => !isManualLike(s)),
    };
    saveSticky(newStore);

    // Emit manual (always)
    const emittedManual = (manualStructures || []).map((m) => {
      const isNeg = !!m.isNegotiated;
      const pr = m.manualRange ?? m.priceRange;
      return {
        type: "institutional",
        tier: "structure_sticky",
        priceRange: pr,
        displayPriceRange: pr,
        strength: 100,
        strength_raw: 100,
        confidence: 1,
        isNegotiated: isNeg,
        details: { id: m.structureKey, facts: { sticky: { ...m, source: "manual_file" } } },
      };
    });

    // Select autos within band (capped)
    const bandLo = Number.isFinite(currentPrice) ? currentPrice - STICKY_KEEP_WITHIN_BAND_PTS : -Infinity;
    const bandHi = Number.isFinite(currentPrice) ? currentPrice + STICKY_KEEP_WITHIN_BAND_PTS : Infinity;

    const autosWithinBand = list
      .filter((s) => s?.status === "active")
      .filter((s) => {
        const pr = s.priceRange;
        if (!Array.isArray(pr) || pr.length !== 2) return false;
        const hi = Math.max(Number(pr[0]), Number(pr[1]));
        const lo = Math.min(Number(pr[0]), Number(pr[1]));
        if (!(hi >= bandLo && lo <= bandHi)) return false;
        return !manualOverlapsAny(manualStructures, hi, lo);
      })
      .sort((a, b) => Number(b.maxStrengthSeen ?? 0) - Number(a.maxStrengthSeen ?? 0))
      .slice(0, STICKY_MAX_WITHIN_BAND);

    const emittedAutos = [];
    const emittedAutoNegotiated = [];

    for (const s of autosWithinBand) {
      const raw = round2(Number(s.maxStrengthSeen ?? 0));
      const conf = round2(confidenceFromInstitutionalStrength(raw));
      const tight = tightenDisplayRangeByCloseDensity(bars1h, s.priceRange);

      const parentObj = {
        type: "institutional",
        tier: "structure_sticky",
        priceRange: s.priceRange,
        displayPriceRange: tight?.displayPriceRange ?? s.priceRange,
        strength: raw,
        strength_raw: raw,
        confidence: conf,
        isNegotiated: false,
        details: {
          id: s.structureKey,
          facts: {
            sticky: s,
            ...(tight ? { acceptanceTightened: true, acceptance: tight } : {}),
          },
        },
      };

      emittedAutos.push(parentObj);

      if (
        tight &&
        Number(tight.coverage ?? 0) >= DENSITY_TARGET_COVERAGE &&
        Number(tight.displayWidthPts ?? 999) <= DENSITY_MAX_TIGHT_WIDTH &&
        Number(tight.closesInZone ?? 0) >= DENSITY_MIN_CLOSES
      ) {
        const neg = buildAutoNegotiatedZone({
          parentId: s.structureKey,
          parentStrength: raw,
          parentConfidence: conf,
          acceptance: tight,
        });
        if (neg) emittedAutoNegotiated.push(neg);
      }
    }

    // Owned NEG parents set (so those parents survive spacing)
    const ownedNegParents = new Set(
      (emittedAutoNegotiated || [])
        .map((z) => {
          const m = String(z?.details?.id ?? "").match(/\|PARENT=([^|]+)$/);
          return m ? m[1] : null;
        })
        .filter(Boolean)
    );

    // Enforce spacing on AUTO institutionals only
    const emittedAutosSpaced = enforceInstitutionalMinGap(emittedAutos, ownedNegParents);

    const levels_debug = levelsLive
      .slice()
      .sort((a, b) => Number(b?.strength_raw ?? 0) - Number(a?.strength_raw ?? 0))
      .slice(0, DEBUG_LEVELS_COUNT);

    const payload = {
      ok: true,
      meta: {
        generated_at_utc: isoNow(),
        current_price: Number.isFinite(currentPrice) ? round2(currentPrice) : null,
        lookback_days: { "30m": DAYS_30M, "1h": DAYS_1H },
        manual_file: path.basename(MANUAL_FILE),
        manual_structures_loaded: manualStructures.length,
        institutional_min: INSTITUTIONAL_MIN,
        smz_prime_min: SMZ_PRIME_MIN,
        debug_levels_count: DEBUG_LEVELS_COUNT,
        acceptance_density: {
          lookback_1h_bars: DENSITY_LOOKBACK_1H_BARS,
          target_coverage: DENSITY_TARGET_COVERAGE,
          max_tight_width: DENSITY_MAX_TIGHT_WIDTH,
        },
        auto_negotiated_emitted: emittedAutoNegotiated.length,
        inst_min_gap_pts: INST_MIN_GAP_PTS,
      },
      levels: levelsLive,
      levels_debug,
      pockets_active: [],
      structures_sticky: [...emittedManual, ...emittedAutosSpaced, ...emittedAutoNegotiated],
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");
    console.log("[SMZ] Saved:", OUTFILE);
  } catch (err) {
    console.error("[SMZ] FAILED:", err);

    // fallback: manual only
    const manualStructures2 = loadManualStructures();
    const fallbackStructuresSticky = (manualStructures2 || []).map((m) => {
      const pr = m.manualRange ?? m.priceRange;
      return {
        type: "institutional",
        tier: "structure_sticky",
        priceRange: pr,
        displayPriceRange: pr,
        strength: 100,
        strength_raw: 100,
        confidence: 1,
        isNegotiated: !!m.isNegotiated,
        details: { id: m.structureKey, facts: { sticky: { ...m, source: "manual_file" } } },
      };
    });

    const fallback = {
      ok: true,
      meta: {
        generated_at_utc: isoNow(),
        current_price: null,
        manual_file: path.basename(MANUAL_FILE),
        manual_structures_loaded: manualStructures2.length,
        note: "SMZ job error — emitted manual structures only",
      },
      levels: [],
      levels_debug: [],
      pockets_active: [],
      structures_sticky: fallbackStructuresSticky,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(fallback, null, 2), "utf8");
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
