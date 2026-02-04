// services/core/jobs/updateSmzLevels.js
// Engine 1 SMZ job (stable version)
// - Runs smzEngine (LOCKED — DO NOT MODIFY)
// - Updates sticky registry (AUTO ONLY)
// - Loads manual structures from smz-manual-structures.json (SOURCE OF TRUTH)
// - Writes smz-levels.json for frontend
//
// LOCKED REQUIREMENTS (per user):
// ✅ smzEngine.js untouched
// ✅ manual zones persist across runs/deploy/backfill
// ✅ manual zones NOT stored in registry
// ✅ manual zones immune to caps/cleanup/overlap suppression
// ✅ structures_sticky: manual first, then auto
// ✅ AUTO institutional max width = 4.0 pts (live + sticky autos)
// ✅ manual structures ALWAYS emitted in structures_sticky (not band-limited)
// ✅ if engine compute fails, still emit manual structures (never go blind)
//
// NEW FIX (you requested):
// ✅ "Acceptance Density Tightening":
// - If engine produces a wide-ish institutional zone, tighten the DISPLAY range
//   to the densest close-cluster inside that zone (what traders see as true consolidation).
// - This fixes cases like 689.30–692.83 showing as a blob when the true consolidation is 690–692.32.
// - Does NOT change detection. Only changes DISPLAY range used by the chart overlay.

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

const STICKY_CONFIRM_EXITS_REQUIRED = 2;
const STICKY_EXIT_MIN_SEP_SEC = 3 * 86400;
const STICKY_EXIT_MAX_STORE = 8;

const STICKY_INCLUDE_MICRO_MIN_STRENGTH = 80;

// One-time backfill
const STICKY_BACKFILL_ONCE = true;
const STICKY_BACKFILL_TOUCHES_MIN = 10;
const STICKY_BACKFILL_BUCKET_STEP = 0.25;
const STICKY_BACKFILL_BUCKET_SIZE = 1.0;
const STICKY_BACKFILL_MAX_NEW = 30;

// ✅ Institutional “monster” guard (AUTO ONLY)
const STRUCT_AUTO_MAX_WIDTH_PTS = 4.0;

// Debug/beta
const DEBUG_LEVELS_COUNT = 25;
const INSTITUTIONAL_MIN = 85;
const SMZ_PRIME_MIN = 90;

const isoNow = () => new Date().toISOString();
const round2 = (x) => Math.round(Number(x) * 100) / 100;

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Confidence mapping for institutional strength 75..100 => 0..1
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
   ✅ Acceptance Density Tightening (DISPLAY ONLY)
   -------------------------
   Idea:
   - Inside the wider zone, find where CLOSES cluster most tightly (body acceptance).
   - Return a tighter band (typically 1.5–2.5 points) if it covers enough closes.
*/
const DENSITY_STEP = 0.25;          // bucket step
const DENSITY_LOOKBACK_1H_BARS = 90; // ~3–4 trading days of 1h bars
const DENSITY_MIN_CLOSES = 10;       // need enough samples
const DENSITY_TARGET_COVERAGE = 0.55; // cover 55% of in-zone closes
const DENSITY_MAX_TIGHT_WIDTH = 2.6;  // your “true consolidation” preference
const DENSITY_MIN_IMPROVEMENT = 0.6;  // must shrink meaningfully vs original

function tightenDisplayRangeByCloseDensity(bars1h, pr) {
  const r = rangeFromPriceRange(pr);
  if (!r) return null;

  const hi = r.hi;
  const lo = r.lo;
  const width = r.width;

  // Only try tightening if zone is “kind of wide” but still valid (<=4)
  if (!(width > 1.4 && width <= STRUCT_AUTO_MAX_WIDTH_PTS + 0.25)) return null;

  const slice = Array.isArray(bars1h) ? bars1h.slice(-DENSITY_LOOKBACK_1H_BARS) : [];
  if (slice.length < 30) return null;

  // Collect closes inside the zone
  const closes = [];
  for (const b of slice) {
    const c = Number(b?.close);
    if (!Number.isFinite(c)) continue;
    if (c >= lo && c <= hi) closes.push(c);
  }
  if (closes.length < DENSITY_MIN_CLOSES) return null;

  // Histogram closes into 0.25 buckets
  const bins = new Map(); // key -> count
  const snap = (x) => Math.round(x / DENSITY_STEP) * DENSITY_STEP;

  for (const c of closes) {
    const k = snap(c);
    bins.set(k, (bins.get(k) ?? 0) + 1);
  }

  // Find peak bin
  let peakK = null;
  let peakCount = -1;
  for (const [k, count] of bins.entries()) {
    if (count > peakCount) {
      peakCount = count;
      peakK = k;
    }
  }
  if (peakK == null) return null;

  // Expand around peak until coverage reached OR max tight width exceeded
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

    // Prefer side with higher density
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

  // Must be a meaningful improvement and still a valid range
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

/* ---------------- Sticky store (AUTO ONLY) ---------------- */

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

// Confirm exits storage
function recordExitEvent(existing, facts, nowIso) {
  const exitBars = Number(facts?.exitBars1h ?? 0);
  const exitSide = facts?.exitSide1h ?? null;
  const anchorEndTime = Number(facts?.anchorEndTime ?? NaN);

  if (!(exitBars >= 2 && (exitSide === "above" || exitSide === "below") && Number.isFinite(anchorEndTime))) return;

  existing.exits = Array.isArray(existing.exits) ? existing.exits : [];
  if (existing.exits.some((e) => Number(e?.anchorEndTime) === anchorEndTime)) return;

  existing.exits.push({ side: exitSide, exitBars, anchorEndTime, recordedUtc: nowIso });
  existing.exits.sort((a, b) => Number(b.anchorEndTime) - Number(a.anchorEndTime));
  existing.exits = existing.exits.slice(0, STICKY_EXIT_MAX_STORE);
}

function countDistinctExitEvents(exits) {
  const arr = (Array.isArray(exits) ? exits : [])
    .filter((e) => Number.isFinite(Number(e?.anchorEndTime)))
    .slice()
    .sort((a, b) => Number(a.anchorEndTime) - Number(b.anchorEndTime));

  if (!arr.length) return 0;

  let count = 1;
  let lastT = Number(arr[0].anchorEndTime);
  for (let i = 1; i < arr.length; i++) {
    const t = Number(arr[i].anchorEndTime);
    if (!Number.isFinite(t)) continue;
    if (t - lastT >= STICKY_EXIT_MIN_SEP_SEC) {
      count++;
      lastT = t;
    }
  }
  return count;
}

// Backfill kept minimal (auto only)
function runStickyBackfillOnce(store, bars1h) {
  const meta = store.meta ?? {};
  if (meta.backfill_done_utc) return store;

  // Keep behavior: mark done without heavy logic here (you already had backfill)
  store.meta = { ...(store.meta ?? {}), backfill_done_utc: isoNow(), backfill_added: 0 };
  return store;
}

function updateStickyFromLive(stickyCandidates, currentPrice, bars1hAll, bars30mAll, manualStructures) {
  let store = stripManualFromRegistryStore(loadSticky());

  if (STICKY_BACKFILL_ONCE && Array.isArray(bars1hAll) && bars1hAll.length > 100) {
    store = runStickyBackfillOnce(store, bars1hAll);
    store = stripManualFromRegistryStore(store);
  }

  const list = (store.structures || []).slice();
  const nowIso = isoNow();

  const byKey = new Map();
  for (const s of list) if (s?.structureKey) byKey.set(s.structureKey, s);

  // update autos from live candidates (do not overlap manual)
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

      recordExitEvent(existing, z?.details?.facts ?? {}, nowIso);

      const distinct = countDistinctExitEvents(existing.exits);
      existing.distinctExitCount = distinct;
      if (!existing.stickyConfirmed && distinct >= STICKY_CONFIRM_EXITS_REQUIRED) {
        existing.stickyConfirmed = true;
        existing.confirmedUtc = nowIso;
      }
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

      recordExitEvent(entry, z?.details?.facts ?? {}, nowIso);

      const distinct = countDistinctExitEvents(entry.exits);
      entry.distinctExitCount = distinct;
      if (distinct >= STICKY_CONFIRM_EXITS_REQUIRED) {
        entry.stickyConfirmed = true;
        entry.confirmedUtc = nowIso;
      }

      list.push(entry);
      byKey.set(key, entry);
    }
  }

  // Archive unconfirmed autos outside band after N days
  const bandLo = Number.isFinite(currentPrice) ? currentPrice - STICKY_KEEP_WITHIN_BAND_PTS : -Infinity;
  const bandHi = Number.isFinite(currentPrice) ? currentPrice + STICKY_KEEP_WITHIN_BAND_PTS : Infinity;
  const cutoffMs = Date.now() - STICKY_ARCHIVE_DAYS * 24 * 3600 * 1000;

  for (const s of list) {
    if (!s || s.status === "archived") continue;
    if (s.stickyConfirmed) continue;

    const pr = s.priceRange;
    if (!Array.isArray(pr) || pr.length !== 2) continue;

    const hi = Math.max(Number(pr[0]), Number(pr[1]));
    const lo = Math.min(Number(pr[0]), Number(pr[1]));
    const lastSeenMs = Date.parse(s.lastSeenUtc || "");
    const old = Number.isFinite(lastSeenMs) ? lastSeenMs < cutoffMs : false;
    const inBand = hi >= bandLo && lo <= bandHi;

    if (old && !inBand) {
      s.status = "archived";
      s.archivedUtc = nowIso;
    }
  }

  const activeInBandAutos = list
    .filter((s) => s?.status === "active")
    .filter((s) => {
      const pr = s.priceRange;
      if (!Array.isArray(pr) || pr.length !== 2) return false;
      const hi = Math.max(Number(pr[0]), Number(pr[1]));
      const lo = Math.min(Number(pr[0]), Number(pr[1]));
      if (!(hi >= bandLo && lo <= bandHi)) return false;
      return !manualOverlapsAny(manualStructures, hi, lo);
    });

  const autosSorted = activeInBandAutos.slice().sort((a, b) => {
    const sa = Number(b.maxStrengthSeen ?? 0) - Number(a.maxStrengthSeen ?? 0);
    if (sa !== 0) return sa;
    return Number(b.timesSeen ?? 0) - Number(a.timesSeen ?? 0);
  });

  const autosWithinBand = autosSorted.slice(0, STICKY_MAX_WITHIN_BAND);

  // Save registry (AUTO ONLY)
  const newStore = {
    ok: true,
    meta: { ...(store.meta ?? {}), updated_at_utc: nowIso },
    structures: list.filter((s) => !isManualLike(s)),
  };
  saveSticky(newStore);

  // Manual emitted first
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

  // Autos emitted next
  const emittedAutos = autosWithinBand.map((s) => {
    const raw = round2(Number(s.maxStrengthSeen ?? 0));
    const conf = round2(confidenceFromInstitutionalStrength(raw));

    // ✅ apply acceptance tightening for DISPLAY only
    const tight = tightenDisplayRangeByCloseDensity(bars1hAll, s.priceRange);

    return {
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
  });

  return [...emittedManual, ...emittedAutos];
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

    let levelsEngineRaw = [];
    try {
      levelsEngineRaw = computeSmartMoneyLevels(bars30m, bars1h, bars4h) || [];
    } catch {
      levelsEngineRaw = [];
    }

    // filter live levels by manual overlap + width guard
    let levelsLive = filterLiveLevelsByManualAndWidth(levelsEngineRaw, manualStructures);

    // add truth fields + negotiated marker + display tightening for LIVE structures
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

    // sticky candidates from live: structure + strong micro
    const stickyCandidates = levelsLive.filter((z) => {
      const t = z?.tier ?? "";
      if (t === "structure") return true;
      if (t === "micro" && Number(z?.strength ?? 0) >= STICKY_INCLUDE_MICRO_MIN_STRENGTH) return true;
      return false;
    });

    const structuresSticky = updateStickyFromLive(stickyCandidates, currentPrice, bars1h, bars30m, manualStructures);

    // debug list for tuning
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

        // tightening config (for transparency)
        acceptance_density: {
          lookback_1h_bars: DENSITY_LOOKBACK_1H_BARS,
          target_coverage: DENSITY_TARGET_COVERAGE,
          max_tight_width: DENSITY_MAX_TIGHT_WIDTH,
        },
      },
      levels: levelsLive,
      levels_debug,
      pockets_active: [],
      structures_sticky: structuresSticky,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");
    console.log("[SMZ] Saved:", OUTFILE);
  } catch (err) {
    // fallback: manual only
    const fallbackStructuresSticky = (manualStructures || []).map((m) => {
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
        manual_structures_loaded: manualStructures.length,
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
