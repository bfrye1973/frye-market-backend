// src/services/core/jobs/updateSmzLevels.js
// Institutional Smart Money Zones Job — writes smz-levels.json
//
// Adds:
// ✅ Sticky STRUCTURE registry (structures persist across runs)
// ✅ pockets_active de-overlap clustering (reduces overlapping spam)
// ✅ Option C lanes: structure_linked vs emerging
//
// Uses DEEP provider (jobs only), chart provider remains untouched.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js";
import { getBarsFromPolygonDeep } from "../../../api/providers/polygonBarsDeep.js";
import {
  loadRegistry,
  saveRegistry,
  mergeStructuresIntoRegistry,
} from "../logic/smzStructureRegistry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-levels.json");
const REGISTRY_FILE = path.resolve(__dirname, "../data/smz-structures-registry.json");

// ✅ Lookback days (LOCKED)
const DAYS_30M = 180;
const DAYS_1H = 365;

// ✅ Active pocket settings (LOCKED for now, tweak later if needed)
const POCKET_FIND_DAYS_1H = 180;      // find pockets from last 6 months
const POCKET_WINDOW_PTS = 40;         // only pockets within ±40 points of current price
const POCKET_MAX_WIDTH_PTS = 4.0;     // SPY hard cap
const POCKET_MIN_BARS = 3;
const POCKET_MAX_BARS = 12;
const POCKET_MIN_ACCEPT_PCT = 0.65;   // % closes inside window

// Pocket overlap reduction (NEW, to prevent spam)
const POCKET_CLUSTER_OVERLAP = 0.55;   // overlap ratio to consider same pocket cluster
const POCKET_CLUSTER_MID_PTS = 0.60;   // midline proximity to cluster
const POCKET_MAX_RETURN = 10;          // return top N pockets after clustering

// Lane classification (Option C)
const STRUCT_LINK_NEAR_PTS = 1.0;      // if within 1pt of structure edges/mid, call it linked

// Normalize Polygon aggregate bars to { time(sec), open, high, low, close, volume }
function normalizeBars(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      const tms = Number(b.t ?? b.time ?? 0); // Polygon often ms
      const t = tms > 1e12 ? Math.floor(tms / 1000) : tms; // -> sec
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
        Number.isFinite(b.open) &&
        Number.isFinite(b.high) &&
        Number.isFinite(b.low) &&
        Number.isFinite(b.close)
    )
    .sort((a, b) => a.time - b.time);
}

// Build synthetic 4H bars from 1H bars
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

function maxHigh(bars) {
  if (!Array.isArray(bars) || !bars.length) return null;
  let m = -Infinity;
  for (const b of bars) if (Number.isFinite(b.high)) m = Math.max(m, b.high);
  return m === -Infinity ? null : Number(m.toFixed(2));
}

function spanInfo(label, bars) {
  if (!Array.isArray(bars) || bars.length === 0) {
    console.log(`[SMZ] COVERAGE ${label}: none`);
    return;
  }
  const first = bars[0].time;
  const last = bars[bars.length - 1].time;
  const days = (last - first) / 86400;

  console.log(
    `[SMZ] COVERAGE ${label}:`,
    "bars =", bars.length,
    "| from =", new Date(first * 1000).toISOString(),
    "| to =", new Date(last * 1000).toISOString(),
    "| spanDays =", days.toFixed(1)
  );
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

function median(values) {
  const arr = (values || []).filter((x) => Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function closeAcceptancePct(bars, lo, hi) {
  let n = 0, inside = 0;
  for (const b of bars) {
    if (!b || !Number.isFinite(b.close)) continue;
    n++;
    if (b.close >= lo && b.close <= hi) inside++;
  }
  return n ? inside / n : 0;
}

function barOutsideSide(bar, lo, hi) {
  if (!bar || !Number.isFinite(bar.high) || !Number.isFinite(bar.low)) return null;
  if (bar.low > hi) return "above";
  if (bar.high < lo) return "below";
  return null;
}

// Confirm violent exit after a window end index (2 consecutive bars fully outside, same side)
function exitConfirmedAfterIndex(bars, lo, hi, endIdx, consec = 2) {
  let side = null;
  let count = 0;

  for (let i = endIdx + 1; i < bars.length && count < consec; i++) {
    const s = barOutsideSide(bars[i], lo, hi);
    if (!s) break;
    if (!side) side = s;
    if (s !== side) break;
    count++;
  }

  return { confirmed: count >= consec, side, bars: count };
}

function historyBoostScore(barsHist, lo, hi, mid) {
  // simple + stable: count touches + midline-close hits
  let touches = 0;
  let midHits = 0;

  for (const b of barsHist) {
    if (!b || !Number.isFinite(b.high) || !Number.isFinite(b.low) || !Number.isFinite(b.close)) continue;
    if (b.high >= lo && b.low <= hi) touches++;
    if (Number.isFinite(mid) && Math.abs(b.close - mid) <= 0.25) midHits++;
  }

  // Convert to a 0..100 scale-ish (caps prevent runaway)
  const touchScore = Math.min(65, touches * 1.1);
  const midScore = Math.min(35, midHits * 2.0);

  return {
    touches,
    midHits,
    score: round2(touchScore + midScore),
  };
}

function computeATR(barsAsc, period = 14) {
  if (!Array.isArray(barsAsc) || barsAsc.length < period + 2) return 1;
  let sum = 0;
  let n = 0;
  for (let i = 1; i < barsAsc.length; i++) {
    const c = barsAsc[i];
    const p = barsAsc[i - 1];
    if (!c || !p) continue;
    if (![c.high, c.low, p.close].every(Number.isFinite)) continue;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close)
    );
    if (Number.isFinite(tr)) {
      sum += tr;
      n++;
    }
  }
  const use = Math.max(1, Math.min(n, period));
  return use ? sum / use : 1;
}

function overlapRatioRange(aHi, aLo, bHi, bLo) {
  const lo = Math.max(aLo, bLo);
  const hi = Math.min(aHi, bHi);
  const inter = hi - lo;
  if (inter <= 0) return 0;
  const denom = Math.min(aHi - aLo, bHi - bLo);
  return denom > 0 ? inter / denom : 0;
}

function isStructureLinked(pocket, structures) {
  const pr = pocket?.priceRange;
  if (!Array.isArray(pr) || pr.length < 2) return false;
  const pHi = Number(pr[0]);
  const pLo = Number(pr[1]);
  const pMid = Number.isFinite(pocket?.negotiationMid) ? pocket.negotiationMid : (pHi + pLo) / 2;

  for (const s of structures || []) {
    const sr = s?.priceRange;
    if (!Array.isArray(sr) || sr.length < 2) continue;
    const sHi = Number(sr[0]);
    const sLo = Number(sr[1]);
    const sMid = (sHi + sLo) / 2;

    const ov = overlapRatioRange(pHi, pLo, sHi, sLo);
    if (ov >= 0.15) return true; // any meaningful overlap

    // or near boundary/mid
    const near =
      Math.abs(pMid - sMid) <= STRUCT_LINK_NEAR_PTS ||
      Math.abs(pMid - sHi) <= STRUCT_LINK_NEAR_PTS ||
      Math.abs(pMid - sLo) <= STRUCT_LINK_NEAR_PTS;

    if (near) return true;
  }
  return false;
}

// ✅ Active pockets finder (forming, no violent exit yet)
function computeActivePockets({ bars1hAll, currentPrice }) {
  const nowSec = bars1hAll.at(-1)?.time ?? Math.floor(Date.now() / 1000);

  const cutoffFind = nowSec - POCKET_FIND_DAYS_1H * 86400;
  const barsFind = bars1hAll.filter((b) => b.time >= cutoffFind);

  const winLo = currentPrice - POCKET_WINDOW_PTS;
  const winHi = currentPrice + POCKET_WINDOW_PTS;

  const pockets = [];

  for (let endIdx = 0; endIdx < barsFind.length - 3; endIdx++) {
    for (let w = POCKET_MIN_BARS; w <= POCKET_MAX_BARS; w++) {
      const startIdx = endIdx - (w - 1);
      if (startIdx < 0) continue;

      const win = barsFind.slice(startIdx, endIdx + 1);

      let lo = Infinity, hi = -Infinity;
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

      // Must be BUILDING: no violent 2-bar exit right after this window
      const exit = exitConfirmedAfterIndex(barsFind, lo, hi, endIdx, 2);
      if (exit.confirmed) continue;

      // Must be relevant to current price band (±40)
      if (!(hi >= winLo && lo <= winHi)) continue;

      // StrengthNow: tightness + duration + acceptance
      const tightScore = Math.max(0, 60 - width * 12);
      const durScore = Math.min(25, w * 2.5);
      const accScore = Math.min(15, (accept - 0.5) * 30);
      const strengthNow = round2(Math.min(100, tightScore + durScore + accScore));

      // Relevance: closer to current price = higher
      const distMid = Math.abs(mid - currentPrice);
      const rel = Math.max(0, 1 - Math.min(1, distMid / POCKET_WINDOW_PTS)); // 0..1
      const relevanceScore = round2(rel * 100);

      // History boost: use full 365d bars
      const h = historyBoostScore(bars1hAll, lo, hi, mid);
      const strengthHistory = h.score;

      const strengthTotal = round2(
        Math.min(100,
          strengthNow * 0.55 +
          relevanceScore * 0.30 +
          strengthHistory * 0.15
        )
      );

      pockets.push({
        type: "institutional",
        tier: "pocket_active",
        status: "building",
        priceRange: [round2(hi), round2(lo)], // [high, low]
        price: round2((hi + lo) / 2),
        negotiationMid: round2(mid),
        barsCount: w,
        acceptancePct: round2(accept),
        strengthNow,
        relevanceScore,
        strengthHistory,
        strengthTotal,
        history: {
          touches: h.touches,
          midHits: h.midHits,
        },
        window: {
          startTime: win[0]?.time ?? null,
          endTime: win[win.length - 1]?.time ?? null,
        },
      });
    }
  }

  // NEW: cluster overlapping pockets → keep best representative per cluster
  pockets.sort((a, b) => (b.strengthTotal ?? 0) - (a.strengthTotal ?? 0));

  const clusters = []; // each cluster is { rep, members[] }

  const getHL = (p) => {
    const pr = p?.priceRange;
    if (!Array.isArray(pr) || pr.length < 2) return null;
    let hi = Number(pr[0]);
    let lo = Number(pr[1]);
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

      const ov = overlapRatioRange(r.hi, r.lo, rr.hi, rr.lo);
      const midDist = Math.abs(r.mid - rr.mid);

      if (ov >= POCKET_CLUSTER_OVERLAP || midDist <= POCKET_CLUSTER_MID_PTS) {
        // same cluster
        c.members.push(p);

        // keep best rep by strengthTotal then relevance
        const rep = c.rep;
        const repScore = (rep.strengthTotal ?? 0) * 1.0 + (rep.relevanceScore ?? 0) * 0.2;
        const pScore = (p.strengthTotal ?? 0) * 1.0 + (p.relevanceScore ?? 0) * 0.2;
        if (pScore > repScore) c.rep = p;

        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ rep: p, members: [p] });
  }

  const reps = clusters
    .map((c) => ({
      ...c.rep,
      cluster: {
        size: c.members.length,
        bestOf: c.members.length,
      },
    }))
    .sort((a, b) => {
      const ra = (a.relevanceScore ?? 0);
      const rb = (b.relevanceScore ?? 0);
      if (rb !== ra) return rb - ra;
      return (b.strengthTotal ?? 0) - (a.strengthTotal ?? 0);
    })
    .slice(0, POCKET_MAX_RETURN);

  return reps;
}

async function main() {
  try {
    console.log("[SMZ] Fetching multi-TF bars (DEEP)…");

    const [bars30mRaw, bars1hRaw] = await Promise.all([
      getBarsFromPolygonDeep("SPY", "30m", DAYS_30M),
      getBarsFromPolygonDeep("SPY", "1h", DAYS_1H),
    ]);

    const bars30m = normalizeBars(bars30mRaw);
    const bars1h = normalizeBars(bars1hRaw);
    const bars4h = aggregateTo4h(bars1h);

    console.log("[SMZ] 30m bars:", bars30m.length);
    console.log("[SMZ] 1h  bars:", bars1h.length);

    spanInfo("30m", bars30m);
    spanInfo("1h", bars1h);
    spanInfo("4h(synth)", bars4h);

    console.log(
      "[SMZ] maxHigh 30m:",
      maxHigh(bars30m),
      "1h:",
      maxHigh(bars1h),
      "4h(synth):",
      maxHigh(bars4h)
    );

    const currentPrice =
      bars30m.at(-1)?.close ??
      bars1h.at(-1)?.close ??
      null;

    if (!Number.isFinite(currentPrice)) {
      throw new Error("Could not determine currentPrice from bars.");
    }

    const atr1h = computeATR(bars1h, 14);

    console.log("[SMZ] currentPrice:", currentPrice, "| atr1h:", round2(atr1h));

    console.log("[SMZ] Running Institutional engine…");
    const zonesFresh = computeSmartMoneyLevels(bars30m, bars1h, bars4h) || [];
    console.log("[SMZ] Institutional zones generated:", zonesFresh.length);

    // Separate fresh STRUCTURES from other levels
    const freshStructures = zonesFresh.filter((z) => (z?.tier ?? "") === "structure");
    const freshNonStructure = zonesFresh.filter((z) => (z?.tier ?? "") !== "structure");

    // ✅ Sticky registry merge
    console.log("[SMZ] Loading structure registry…");
    const registry = loadRegistry(REGISTRY_FILE);

    console.log("[SMZ] Merging structures into registry…");
    const { updatedRegistry, activeStructures } = mergeStructuresIntoRegistry({
      registry,
      freshStructures,
      bars1h,
      currentPrice,
      atr1h,
      opts: {
        // tuned to preserve majors without exploding count
        MATCH_OVERLAP: 0.50,
        MATCH_MID_ATR: 0.90,
        LOCK_STRENGTH: 90,
        LOCK_CONFIRMATIONS: 2,
        ARCHIVE_DIST_ATR: 10,
        ARCHIVE_TOUCH_LOOKBACK: 160,
      },
    });

    saveRegistry(REGISTRY_FILE, updatedRegistry);

    console.log("[SMZ] Registry active structures:", activeStructures.length);
    console.log("[SMZ] Registry total structures (incl archived):", updatedRegistry.structures?.length ?? 0);

    // ✅ Active pockets (building now) — clustered
    console.log("[SMZ] Computing active pockets (building)…");
    const pocketsActive = computeActivePockets({
      bars1hAll: bars1h,
      currentPrice,
    });

    // Option C tagging: structure_linked vs emerging
    const pocketsTagged = pocketsActive.map((p) => {
      const linked = isStructureLinked(p, activeStructures);
      return {
        ...p,
        lane: linked ? "structure_linked" : "emerging",
        structureLinked: linked,
      };
    });

    console.log("[SMZ] Active pockets (clustered) returned:", pocketsTagged.length);
    const linkedCount = pocketsTagged.filter((p) => p.structureLinked).length;
    console.log("[SMZ] Active pockets linked:", linkedCount, "| emerging:", pocketsTagged.length - linkedCount);

    // Payload levels:
    // - STRUCTURES come from registry (sticky)
    // - Non-structure from fresh engine (completed pockets, etc.)
    const levelsOut = [
      ...activeStructures,
      ...freshNonStructure,
    ];

    const payload = {
      ok: true,
      meta: {
        generated_at_utc: new Date().toISOString(),
        lookback_days: { "30m": DAYS_30M, "1h": DAYS_1H, "4h(synth)": DAYS_1H },
        current_price: round2(currentPrice),
        atr_1h: round2(atr1h),
        registry: {
          file: path.basename(REGISTRY_FILE),
          active_structures: activeStructures.length,
          total_structures_including_archived: updatedRegistry.structures?.length ?? 0,
        },
        pocket_settings: {
          find_days_1h: POCKET_FIND_DAYS_1H,
          window_points: POCKET_WINDOW_PTS,
          max_width_pts: POCKET_MAX_WIDTH_PTS,
          min_bars: POCKET_MIN_BARS,
          max_bars: POCKET_MAX_BARS,
          min_accept_pct: POCKET_MIN_ACCEPT_PCT,
          cluster_overlap: POCKET_CLUSTER_OVERLAP,
          cluster_mid_pts: POCKET_CLUSTER_MID_PTS,
          max_return: POCKET_MAX_RETURN,
          structure_link_near_pts: STRUCT_LINK_NEAR_PTS,
        },
      },
      levels: levelsOut,
      pockets_active: pocketsTagged,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("[SMZ] Saved institutional zones to:", OUTFILE);
    console.log("[SMZ] Job complete.");
  } catch (err) {
    console.error("[SMZ] FAILED:", err);

    try {
      const fallback = {
        ok: true,
        levels: [],
        pockets_active: [],
        note: "SMZ institutional job error, no levels generated this run",
      };
      fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
      fs.writeFileSync(OUTFILE, JSON.stringify(fallback, null, 2), "utf8");
      console.log("[SMZ] Wrote fallback empty smz-levels.json");
    } catch (inner) {
      console.error("[SMZ] Also failed to write fallback smz-levels.json:", inner);
    }

    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
