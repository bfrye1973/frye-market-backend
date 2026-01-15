// services/core/jobs/updateSmzLevels.js
// Engine 1 SMZ job (stable version - NO pocket/micro merge)
// - Runs smzEngine (LOCKED)
// - Updates sticky registry (AUTO ONLY)
// - Loads manual structures from smz-manual-structures.json (SOURCE OF TRUTH)
// - Writes smz-levels.json for frontend
//
// LOCKED REQUIREMENTS (per user):
// ✅ smzEngine.js untouched
// ✅ frontend overlay untouched
// ✅ manual zones persist across runs/deploy/backfill
// ✅ manual zones NOT stored in registry
// ✅ manual zones immune to caps/cleanup/overlap suppression
// ✅ structures_sticky: manual first, then auto

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js";
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
const STICKY_KEEP_WITHIN_BAND_PTS = 40; // +/- 40 pts from current price
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

// Active pockets
const POCKET_FIND_DAYS_1H = 180;
const POCKET_WINDOW_PTS = 40;
const POCKET_MAX_WIDTH_PTS = 4.0;
const POCKET_MIN_BARS = 3;
const POCKET_MAX_BARS = 12;
const POCKET_MIN_ACCEPT_PCT = 0.65;
const POCKET_RECENT_END_BARS_1H = 70;
const POCKET_CLUSTER_OVERLAP = 0.55;
const POCKET_CLUSTER_MID_PTS = 0.60;
const POCKET_MAX_RETURN = 10;

const STRUCT_LINK_NEAR_PTS = 1.0;

// ---------------- tiny helpers ----------------

const isoNow = () => new Date().toISOString();
const round2 = (x) => Math.round(Number(x) * 100) / 100;

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

// ---------------- Manual structures (SOURCE OF TRUTH) ----------------

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
    // Optional pass-through fields (kept if present)
    ...(s?.notes ? { notes: s.notes } : {}),
  };
}

function loadManualStructures() {
  if (!fs.existsSync(MANUAL_FILE)) {
    console.log(`[SMZ] Manual file not found (ok): ${MANUAL_FILE}`);
    return [];
  }
  try {
    const raw = fs.readFileSync(MANUAL_FILE, "utf8");
    const json = JSON.parse(raw);
    const arr = Array.isArray(json?.structures) ? json.structures : [];
    const out = arr.map(normalizeManualStructure).filter(Boolean);

    console.log(`[SMZ] Manual structures loaded: ${out.length} (${MANUAL_FILE})`);
    return out;
  } catch (e) {
    console.warn(`[SMZ] Manual file failed to load: ${MANUAL_FILE} :: ${e?.message}`);
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

// ---------------- Sticky store (AUTO ONLY) ----------------

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

// Safety: registry is AUTO ONLY — strip anything manual-like.
function stripManualFromRegistryStore(store) {
  const before = Array.isArray(store?.structures) ? store.structures.length : 0;
  const structures = (store?.structures || []).filter((s) => !isManualLike(s));
  const after = structures.length;
  if (before !== after) {
    console.log(`[SMZ] Stripped manual from registry store: ${before} -> ${after}`);
  }
  return { ...(store || {}), structures };
}

function structureKeyFromRange(hi, lo) {
  const qHi = snapStep(hi, STICKY_ROUND_STEP);
  const qLo = snapStep(lo, STICKY_ROUND_STEP);
  return `SPY|mixed|hi=${qHi?.toFixed(2)}|lo=${qLo?.toFixed(2)}`;
}

function barOverlapsRange(b, lo, hi) {
  return b && Number.isFinite(b.high) && Number.isFinite(b.low) && b.high >= lo && b.low <= hi;
}

function exitConfirmedAfterIndex(bars, lo, hi, endIdx, consec = 2) {
  const outside = (bar) => {
    if (!bar || !Number.isFinite(bar.high) || !Number.isFinite(bar.low)) return null;
    if (bar.low > hi) return "above";
    if (bar.high < lo) return "below";
    return null;
  };

  let side = null;
  let count = 0;
  for (let i = endIdx + 1; i < bars.length && count < consec; i++) {
    const s = outside(bars[i]);
    if (!s) break;
    if (!side) side = s;
    if (s !== side) break;
    count++;
  }
  return { confirmed: count >= consec, side, bars: count };
}

function recordExitEvent(existing, facts, nowIso) {
  const exitBars = Number(facts?.exitBars1h ?? 0);
  const exitSide = facts?.exitSide1h ?? null;
  const anchorEndTime = Number(facts?.anchorEndTime ?? NaN);

  if (
    !(
      exitBars >= 2 &&
      (exitSide === "above" || exitSide === "below") &&
      Number.isFinite(anchorEndTime)
    )
  )
    return;

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

// One-time backfill (simple) — AUTO ONLY
function runStickyBackfillOnce(store, bars1h) {
  const meta = store.meta ?? {};
  if (meta.backfill_done_utc) return store;

  console.log("[SMZ][BACKFILL] Running one-time sticky backfill…");

  let loAll = Infinity,
    hiAll = -Infinity;
  for (const b of bars1h || []) {
    if (!b || !Number.isFinite(b.low) || !Number.isFinite(b.high)) continue;
    loAll = Math.min(loAll, b.low);
    hiAll = Math.max(hiAll, b.high);
  }
  if (!Number.isFinite(loAll) || !Number.isFinite(hiAll) || hiAll <= loAll) return store;

  const start = Math.floor(loAll / STICKY_BACKFILL_BUCKET_STEP) * STICKY_BACKFILL_BUCKET_STEP;
  const end = Math.ceil(hiAll / STICKY_BACKFILL_BUCKET_STEP) * STICKY_BACKFILL_BUCKET_STEP;

  const candidates = [];
  for (let lo = start; lo < end; lo += STICKY_BACKFILL_BUCKET_SIZE) {
    const hi = lo + STICKY_BACKFILL_BUCKET_SIZE;

    let touches = 0;
    for (const b of bars1h) if (barOverlapsRange(b, lo, hi)) touches++;
    if (touches < STICKY_BACKFILL_TOUCHES_MIN) continue;

    const exits = [];
    for (let i = 0; i < bars1h.length - 3; i++) {
      if (!barOverlapsRange(bars1h[i], lo, hi)) continue;

      let lastTouch = i;
      while (lastTouch + 1 < bars1h.length && barOverlapsRange(bars1h[lastTouch + 1], lo, hi))
        lastTouch++;

      const e = exitConfirmedAfterIndex(bars1h, lo, hi, lastTouch, 2);
      if (!e.confirmed) {
        i = lastTouch;
        continue;
      }

      const anchorEndTime = bars1h[lastTouch]?.time;
      if (!Number.isFinite(anchorEndTime)) {
        i = lastTouch;
        continue;
      }

      exits.push({ side: e.side, exitBars: e.bars, anchorEndTime });
      i = lastTouch;
    }

    exits.sort((a, b) => a.anchorEndTime - b.anchorEndTime);
    const distinct = [];
    for (const ev of exits) {
      if (!distinct.length) distinct.push(ev);
      else if (ev.anchorEndTime - distinct[distinct.length - 1].anchorEndTime >= STICKY_EXIT_MIN_SEP_SEC)
        distinct.push(ev);
    }

    if (distinct.length < STICKY_CONFIRM_EXITS_REQUIRED) continue;

    const strength = Math.min(100, touches * 1.5 + distinct.length * 15);
    candidates.push({ lo: round2(lo), hi: round2(hi), strength, exits: distinct });
  }

  candidates.sort((a, b) => b.strength - a.strength);
  const top = candidates.slice(0, STICKY_BACKFILL_MAX_NEW);

  const nowIso = isoNow();

  for (const c of top) {
    const key = structureKeyFromRange(c.hi, c.lo);
    if (store.structures.some((s) => s.structureKey === key)) continue;

    store.structures.push({
      structureKey: key,
      priceRange: [c.hi, c.lo],
      firstSeenUtc: nowIso,
      lastSeenUtc: nowIso,
      timesSeen: 1,
      maxStrengthSeen: c.strength,
      status: "active",
      stickyConfirmed: true,
      confirmedUtc: nowIso,
      exits: (c.exits || []).map((e) => ({ ...e, recordedUtc: nowIso })),
      distinctExitCount: c.exits?.length ?? 0,
      backfilled: true,
    });
  }

  store.meta = { ...(store.meta ?? {}), backfill_done_utc: nowIso, backfill_added: top.length };
  console.log("[SMZ][BACKFILL] Added confirmed sticky zones:", top.length);
  return store;
}

/**
 * Build structures_sticky = manual first + auto (capped).
 * Updates registry with AUTO candidates only.
 */
function updateStickyFromLive(stickyCandidates, currentPrice, bars1hAll, manualStructures) {
  // 1) Load registry (auto-only), then strip any manual pollution
  let store = stripManualFromRegistryStore(loadSticky());

  // 2) Optional one-time backfill (auto-only)
  if (STICKY_BACKFILL_ONCE && Array.isArray(bars1hAll) && bars1hAll.length > 100) {
    store = runStickyBackfillOnce(store, bars1hAll);
    store = stripManualFromRegistryStore(store);
  }

  // Operate on a working list of AUTO entries only
  const list = (store.structures || []).slice();
  const nowIso = isoNow();

  const byKey = new Map();
  for (const s of list) if (s?.structureKey) byKey.set(s.structureKey, s);

  // 3) Update AUTO entries from live candidates, but NEVER allow autos to overlap manual
  for (const z of stickyCandidates || []) {
    const pr = z?.priceRange;
    if (!Array.isArray(pr) || pr.length !== 2) continue;

    const hi = Number(pr[0]),
      lo = Number(pr[1]);
    if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) continue;

    // Manual zones always win: do not add/update autos that overlap manual
    if (manualOverlapsAny(manualStructures, hi, lo)) continue;

    const key = structureKeyFromRange(hi, lo);
    const existing = byKey.get(key);

    if (existing) {
      existing.lastSeenUtc = nowIso;
      existing.timesSeen = Number(existing.timesSeen ?? 0) + 1;
      existing.maxStrengthSeen = Math.max(Number(existing.maxStrengthSeen ?? 0), Number(z.strength ?? 0));
      existing.status = "active";

      const facts = z?.details?.facts ?? {};
      recordExitEvent(existing, facts, nowIso);

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

      const facts = z?.details?.facts ?? {};
      recordExitEvent(entry, facts, nowIso);

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

  // 4) Archive logic applies ONLY to autos (manual not in registry)
  const bandLo = currentPrice - STICKY_KEEP_WITHIN_BAND_PTS;
  const bandHi = currentPrice + STICKY_KEEP_WITHIN_BAND_PTS;
  const cutoffMs = Date.now() - STICKY_ARCHIVE_DAYS * 24 * 3600 * 1000;

  for (const s of list) {
    if (!s || s.status === "archived") continue;
    if (s.stickyConfirmed) continue;

    const pr = s.priceRange;
    if (!Array.isArray(pr) || pr.length !== 2) continue;

    const hi = Number(pr[0]),
      lo = Number(pr[1]);
    const lastSeenMs = Date.parse(s.lastSeenUtc || "");
    const old = Number.isFinite(lastSeenMs) ? lastSeenMs < cutoffMs : false;
    const inBand = hi >= bandLo && lo <= bandHi;

    if (old && !inBand) {
      s.status = "archived";
      s.archivedUtc = nowIso;
    }
  }

  // 5) Select autos within band (capped), excluding any overlapping manual
  const activeInBandAutos = list
    .filter((s) => s?.status === "active")
    .filter((s) => {
      const pr = s.priceRange;
      if (!Array.isArray(pr) || pr.length !== 2) return false;
      const hi = Math.max(Number(pr[0]), Number(pr[1]));
      const lo = Math.min(Number(pr[0]), Number(pr[1]));
      if (!(hi >= bandLo && lo <= bandHi)) return false;

      // safety: remove autos overlapping manual
      return !manualOverlapsAny(manualStructures, hi, lo);
    });

  const autosSorted = activeInBandAutos.sort((a, b) => {
    const sa = Number(b.maxStrengthSeen ?? 0) - Number(a.maxStrengthSeen ?? 0);
    if (sa !== 0) return sa;
    return Number(b.timesSeen ?? 0) - Number(a.timesSeen ?? 0);
  });

  const autosWithinBand = autosSorted.slice(0, STICKY_MAX_WITHIN_BAND);

  // 6) Persist registry (AUTO ONLY)
  const newStore = {
    ok: true,
    meta: { ...(store.meta ?? {}), updated_at_utc: nowIso },
    structures: list.filter((s) => !isManualLike(s)),
  };
  saveSticky(newStore);

  // 7) Emit manual first (uncapped), then autos (capped)
  const manualInBand = (manualStructures || []).filter((m) => {
    const r = m?.manualRange ?? m?.priceRange;
    if (!Array.isArray(r) || r.length !== 2) return false;
    const hi = Math.max(Number(r[0]), Number(r[1]));
    const lo = Math.min(Number(r[0]), Number(r[1]));
    return hi >= bandLo && lo <= bandHi;
  });

  console.log(
    `[SMZ] Emitting sticky structures: manual ${manualInBand.length} + auto ${autosWithinBand.length} = ${
      manualInBand.length + autosWithinBand.length
    }`
  );

  const emittedManual = manualInBand.map((m) => ({
    type: "institutional",
    tier: "structure_sticky",
    priceRange: m.manualRange ?? m.priceRange,
    strength: 100,
    details: { id: m.structureKey, facts: { sticky: { ...m, source: "manual_file" } } },
  }));

  const emittedAutos = autosWithinBand.map((s) => ({
    type: "institutional",
    tier: "structure_sticky",
    priceRange: s.priceRange,
    strength: round2(Number(s.maxStrengthSeen ?? 0)),
    details: { id: s.structureKey, facts: { sticky: s } },
  }));

  return [...emittedManual, ...emittedAutos];
}

// ---------------- Active pockets ----------------

function median(values) {
  const arr = (values || [])
    .filter((x) => Number.isFinite(x))
    .slice()
    .sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function closeAcceptancePct(bars, lo, hi) {
  let n = 0;
  let inside = 0;
  for (const b of bars) {
    if (!b || !Number.isFinite(b.close)) continue;
    n++;
    if (b.close >= lo && b.close <= hi) inside++;
  }
  return n ? inside / n : 0;
}

function historyBoostScore(barsHist, lo, hi, mid) {
  let touches = 0,
    midHits = 0;
  for (const b of barsHist) {
    if (!b || !Number.isFinite(b.high) || !Number.isFinite(b.low) || !Number.isFinite(b.close)) continue;
    if (b.high >= lo && b.low <= hi) touches++;
    if (Number.isFinite(mid) && Math.abs(b.close - mid) <= 0.25) midHits++;
  }
  const touchScore = Math.min(65, touches * 1.1);
  const midScore = Math.min(35, midHits * 2.0);
  return { touches, midHits, score: round2(touchScore + midScore) };
}

function computeActivePockets({ bars1hAll, currentPrice }) {
  const nowSec = bars1hAll.at(-1)?.time ?? Math.floor(Date.now() / 1000);

  const cutoffFind = nowSec - POCKET_FIND_DAYS_1H * 86400;
  const barsFind = bars1hAll.filter((b) => b.time >= cutoffFind);

  const winLo = currentPrice - POCKET_WINDOW_PTS;
  const winHi = currentPrice + POCKET_WINDOW_PTS;

  const recentEndMinIdx = Math.max(0, barsFind.length - POCKET_RECENT_END_BARS_1H);

  const pockets = [];

  for (let endIdx = 0; endIdx < barsFind.length - 3; endIdx++) {
    if (endIdx < recentEndMinIdx) continue;

    for (let w = POCKET_MIN_BARS; w <= POCKET_MAX_BARS; w++) {
      const startIdx = endIdx - (w - 1);
      if (startIdx < 0) continue;

      const win = barsFind.slice(startIdx, endIdx + 1);

      let lo = Infinity,
        hi = -Infinity;
      const closes = [];

      for (const b of win) {
        lo = Math.min(lo, b.low);
        hi = Math.max(hi, b.high);
        closes.push(b.close);
      }

      const width = hi - lo;
      if (!Number.isFinite(width) || width <= 0) continue;
      if (width > POCKET_MAX_WIDTH_PTS) continue;

      const mid = median(closes);
      if (!Number.isFinite(mid)) continue;

      const accept = closeAcceptancePct(win, lo, hi);
      if (accept < POCKET_MIN_ACCEPT_PCT) continue;

      const exit = exitConfirmedAfterIndex(barsFind, lo, hi, endIdx, 2);
      if (exit.confirmed) continue;

      if (!(hi >= winLo && lo <= winHi)) continue;

      const tightScore = Math.max(0, 60 - width * 12);
      const durScore = Math.min(25, w * 2.5);
      const accScore = Math.min(15, (accept - 0.5) * 30);
      const strengthNow = round2(Math.min(100, tightScore + durScore + accScore));

      const distMid = Math.abs(mid - currentPrice);
      const rel = Math.max(0, 1 - Math.min(1, distMid / POCKET_WINDOW_PTS));
      const relevanceScore = round2(rel * 100);

      const h = historyBoostScore(bars1hAll, lo, hi, mid);
      const strengthHistory = h.score;

      const strengthTotal = round2(
        Math.min(100, strengthNow * 0.55 + relevanceScore * 0.30 + strengthHistory * 0.15)
      );

      pockets.push({
        type: "institutional",
        tier: "pocket_active",
        status: "building",
        priceRange: [round2(hi), round2(lo)],
        price: round2((hi + lo) / 2),
        negotiationMid: round2(mid),
        barsCount: w,
        acceptancePct: round2(accept),
        strengthNow,
        relevanceScore,
        strengthHistory,
        strengthTotal,
        window: { startTime: win[0]?.time ?? null, endTime: win[win.length - 1]?.time ?? null },
      });
    }
  }

  pockets.sort((a, b) => (b.strengthTotal ?? 0) - (a.strengthTotal ?? 0));

  const clusters = [];
  const getHL = (p) => {
    const pr = p?.priceRange;
    if (!Array.isArray(pr) || pr.length < 2) return null;
    let hi = Number(pr[0]),
      lo = Number(pr[1]);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    if (lo > hi) [lo, hi] = [hi, lo];
    return { hi, lo, mid: Number(p.negotiationMid) };
  };

  for (const p of pockets) {
    const r = getHL(p);
    if (!r) continue;

    let placed = false;
    for (const c of clusters) {
      const rr = getHL(c.rep);
      if (!rr) continue;

      const interLo = Math.max(r.lo, rr.lo);
      const interHi = Math.min(r.hi, rr.hi);
      const inter = interHi - interLo;
      const denom = Math.min(r.hi - r.lo, rr.hi - rr.lo);
      const ov = inter > 0 && denom > 0 ? inter / denom : 0;

      const midDist = Math.abs(r.mid - rr.mid);

      if (ov >= POCKET_CLUSTER_OVERLAP || midDist <= POCKET_CLUSTER_MID_PTS) {
        c.members.push(p);
        if ((p.strengthTotal ?? 0) > (c.rep.strengthTotal ?? 0)) c.rep = p;
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ rep: p, members: [p] });
  }

  return clusters.map((c) => c.rep).slice(0, POCKET_MAX_RETURN);
}

function isStructureLinked(pocket, liveStructures) {
  const pr = pocket?.priceRange;
  if (!Array.isArray(pr) || pr.length < 2) return false;
  const pHi = Number(pr[0]);
  const pLo = Number(pr[1]);
  const pMid = Number.isFinite(pocket?.negotiationMid) ? pocket.negotiationMid : (pHi + pLo) / 2;

  for (const s of liveStructures || []) {
    const sr = s?.priceRange;
    if (!Array.isArray(sr) || sr.length < 2) continue;
    const sHi = Number(sr[0]);
    const sLo = Number(sr[1]);
    const sMid = (sHi + sLo) / 2;

    const near =
      Math.abs(pMid - sMid) <= STRUCT_LINK_NEAR_PTS ||
      Math.abs(pMid - sHi) <= STRUCT_LINK_NEAR_PTS ||
      Math.abs(pMid - sLo) <= STRUCT_LINK_NEAR_PTS;

    if (near) return true;

    const interLo = Math.max(pLo, sLo);
    const interHi = Math.min(pHi, sHi);
    if (interHi > interLo) return true;
  }
  return false;
}

// ---------------- main ----------------

async function main() {
  try {
    console.log("[SMZ] Fetching bars (DEEP)...");
    const [bars30mRaw, bars1hRaw] = await Promise.all([
      getBarsFromPolygonDeep("SPY", "30m", DAYS_30M),
      getBarsFromPolygonDeep("SPY", "1h", DAYS_1H),
    ]);

    const bars30m = normalizeBars(bars30mRaw);
    const bars1h = normalizeBars(bars1hRaw);
    const bars4h = aggregateTo4h(bars1h);

    const currentPrice = bars30m.at(-1)?.close ?? bars1h.at(-1)?.close ?? null;
    if (!Number.isFinite(currentPrice)) throw new Error("Could not determine currentPrice.");

    console.log("[SMZ] currentPrice:", round2(currentPrice));

    // Load manual structures (SOURCE OF TRUTH)
    const manualStructures = loadManualStructures();

    console.log("[SMZ] Running engine...");
    let levelsLive = computeSmartMoneyLevels(bars30m, bars1h, bars4h) || [];
    console.log("[SMZ] levels generated:", levelsLive.length);

    const liveStructures = levelsLive.filter((z) => (z?.tier ?? "") === "structure");

    const stickyCandidates = levelsLive.filter((z) => {
      const t = z?.tier ?? "";
      if (t === "structure") return true;
      if (t === "micro" && Number(z?.strength ?? 0) >= STICKY_INCLUDE_MICRO_MIN_STRENGTH) return true;
      return false;
    });

    const structuresSticky = updateStickyFromLive(
      stickyCandidates,
      currentPrice,
      bars1h,
      manualStructures
    );

    const pocketsActive = computeActivePockets({ bars1hAll: bars1h, currentPrice });

    const pocketsTagged = (pocketsActive || []).map((p) => {
      const linked = isStructureLinked(p, liveStructures);
      return { ...p, lane: linked ? "structure_linked" : "emerging", structureLinked: linked };
    });

    const payload = {
      ok: true,
      meta: {
        generated_at_utc: isoNow(),
        current_price: round2(currentPrice),
        lookback_days: { "30m": DAYS_30M, "1h": DAYS_1H },
        manual_file: path.basename(MANUAL_FILE),
        manual_structures_loaded: manualStructures.length,
      },
      levels: levelsLive,
      pockets_active: pocketsTagged,
      structures_sticky: structuresSticky,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("[SMZ] Saved:", OUTFILE);
    console.log("[SMZ] Job complete.");
  } catch (err) {
    console.error("[SMZ] FAILED:", err);

    // write safe fallback
    const fallback = {
      ok: true,
      levels: [],
      pockets_active: [],
      structures_sticky: [],
      note: "SMZ job error",
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
