// src/services/core/jobs/updateSmzLevels.js
// Institutional Smart Money Zones Job — writes smz-levels.json
//
// ✅ levels = authoritative output from computeSmartMoneyLevels()
// ✅ structures_sticky = overlay-only snapshots (non-authoritative)
// ✅ pockets_active = active pockets near price (2-week recent), clustered, lane-tagged
// ✅ NEW: ATH wick shelf pocket (tier:"pocket_active") that overrides weak top pockets near ATH
//
// Uses DEEP provider (jobs only), chart provider remains untouched.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js";
import { getBarsFromPolygonDeep } from "../../../api/providers/polygonBarsDeep.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-levels.json");
const STICKY_FILE = path.resolve(__dirname, "../data/smz-structures-registry.json");

// ✅ Lookback days (LOCKED)
const DAYS_30M = 180;
const DAYS_1H = 365;

// ✅ Active pocket settings
const POCKET_FIND_DAYS_1H = 180;      // find pockets in last 6 months
const POCKET_WINDOW_PTS = 40;         // only pockets within ±40 pts of current price
const POCKET_MAX_WIDTH_PTS = 4.0;     // hard cap
const POCKET_MIN_BARS = 3;
const POCKET_MAX_BARS = 12;
const POCKET_MIN_ACCEPT_PCT = 0.65;

// ✅ "Building now" = last ~2 weeks of 1H bars
const POCKET_RECENT_END_BARS_1H = 70;

// ✅ Pocket overlap reduction
const POCKET_CLUSTER_OVERLAP = 0.55;
const POCKET_CLUSTER_MID_PTS = 0.60;
const POCKET_MAX_RETURN = 10;

// ✅ Option C tagging
const STRUCT_LINK_NEAR_PTS = 1.0;

// ✅ Pocket exclusion near structures (your rule)
// NOTE: We allow ATH wick shelf pocket to bypass this filter.
const POCKET_STRUCT_BUFFER_PTS = 1.5;

// ✅ Sticky snapshots (overlay-only)
const STICKY_ROUND_STEP = 0.25;
const STICKY_KEEP_WITHIN_BAND_PTS = POCKET_WINDOW_PTS;
const STICKY_ARCHIVE_DAYS = 30;
const STICKY_MAX_WITHIN_BAND = 12;

// ✅ ATH wick shelf pocket (NEW)
const ATH_LOOKBACK_BARS_1H = 900;      // ~180 days of 1H bars
const ATH_WICK_BAND_PTS = 0.30;        // wick tags within this of ATH
const ATH_SHELF_DEPTH_PTS = 1.25;      // pocket depth below ATH (0.8–1.5 tune)
const ATH_MIN_WICK_TAGS = 3;           // minimum wick tags
const ATH_CLOSE_CLUSTER_PTS = 1.25;    // closes must cluster tight below ATH
const ATH_NEAR_PRICE_PTS = 3.0;        // only consider ATH shelf if price is within 3 pts of ATH

// ---------------- Helpers ----------------

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
        Number.isFinite(b.open) &&
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
  return Math.round(Number(x) * 100) / 100;
}

function isoNow() {
  return new Date().toISOString();
}

function snapStep(x, step) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.round(n / step) * step;
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

// Touches include wicks
function historyBoostScore(barsHist, lo, hi, mid) {
  let touches = 0;
  let midHits = 0;

  for (const b of barsHist) {
    if (!b || !Number.isFinite(b.high) || !Number.isFinite(b.low) || !Number.isFinite(b.close)) continue;
    if (b.high >= lo && b.low <= hi) touches++;
    if (Number.isFinite(mid) && Math.abs(b.close - mid) <= 0.25) midHits++;
  }

  const touchScore = Math.min(65, touches * 1.1);
  const midScore = Math.min(35, midHits * 2.0);

  return { touches, midHits, score: round2(touchScore + midScore) };
}

function overlapRatioRange(aHi, aLo, bHi, bLo) {
  const lo = Math.max(aLo, bLo);
  const hi = Math.min(aHi, bHi);
  const inter = hi - lo;
  if (inter <= 0) return 0;
  const denom = Math.min(aHi - aLo, bHi - bLo);
  return denom > 0 ? inter / denom : 0;
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

    const ov = overlapRatioRange(pHi, pLo, sHi, sLo);
    if (ov >= 0.15) return true;

    const near =
      Math.abs(pMid - sMid) <= STRUCT_LINK_NEAR_PTS ||
      Math.abs(pMid - sHi) <= STRUCT_LINK_NEAR_PTS ||
      Math.abs(pMid - sLo) <= STRUCT_LINK_NEAR_PTS;

    if (near) return true;
  }
  return false;
}

// ---------------- Sticky snapshot store (overlay-only) ----------------

function loadSticky() {
  try {
    if (!fs.existsSync(STICKY_FILE)) {
      return { ok: true, meta: { created_at_utc: isoNow() }, structures: [] };
    }
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

function structureKeyFromRange(hi, lo) {
  const qHi = snapStep(hi, STICKY_ROUND_STEP);
  const qLo = snapStep(lo, STICKY_ROUND_STEP);
  return `SPY|mixed|hi=${qHi?.toFixed(2)}|lo=${qLo?.toFixed(2)}`;
}

function updateStickyFromLive(liveStructures, currentPrice) {
  const store = loadSticky();
  const list = store.structures.slice();
  const now = isoNow();

  const byKey = new Map();
  for (const s of list) if (s?.structureKey) byKey.set(s.structureKey, s);

  for (const z of liveStructures || []) {
    const pr = z?.priceRange;
    if (!Array.isArray(pr) || pr.length < 2) continue;
    const hi = Number(pr[0]);
    const lo = Number(pr[1]);
    if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) continue;

    const key = structureKeyFromRange(hi, lo);
    const existing = byKey.get(key);

    if (existing) {
      existing.lastSeenUtc = now;
      existing.timesSeen = Number(existing.timesSeen ?? 0) + 1;
      existing.maxStrengthSeen = Math.max(Number(existing.maxStrengthSeen ?? 0), Number(z.strength ?? 0));
      existing.status = "active";
    } else {
      const entry = {
        structureKey: key,
        priceRange: [round2(hi), round2(lo)],
        firstSeenUtc: now,
        lastSeenUtc: now,
        timesSeen: 1,
        maxStrengthSeen: Number(z.strength ?? 0),
        status: "active",
      };
      list.push(entry);
      byKey.set(key, entry);
    }
  }

  const bandLo = currentPrice - STICKY_KEEP_WITHIN_BAND_PTS;
  const bandHi = currentPrice + STICKY_KEEP_WITHIN_BAND_PTS;
  const cutoffMs = Date.now() - STICKY_ARCHIVE_DAYS * 24 * 3600 * 1000;

  for (const s of list) {
    if (!s || s.status === "archived") continue;
    const pr = s.priceRange;
    if (!Array.isArray(pr) || pr.length < 2) continue;

    const hi = Number(pr[0]);
    const lo = Number(pr[1]);

    const lastSeenMs = Date.parse(s.lastSeenUtc || "");
    const old = Number.isFinite(lastSeenMs) ? lastSeenMs < cutoffMs : false;
    const inBand = hi >= bandLo && lo <= bandHi;

    if (old && !inBand) {
      s.status = "archived";
      s.archivedUtc = now;
    }
  }

  const withinBand = list
    .filter((s) => s?.status === "active")
    .filter((s) => {
      const pr = s.priceRange;
      if (!Array.isArray(pr) || pr.length < 2) return false;
      const hi = Number(pr[0]);
      const lo = Number(pr[1]);
      return hi >= bandLo && lo <= bandHi;
    })
    .sort((a, b) => {
      const sa = Number(a.maxStrengthSeen ?? 0);
      const sb = Number(b.maxStrengthSeen ?? 0);
      if (sb !== sa) return sb - sa;
      const ta = Number(a.timesSeen ?? 0);
      const tb = Number(b.timesSeen ?? 0);
      if (tb !== ta) return tb - ta;
      return Date.parse(b.lastSeenUtc || "1970-01-01") - Date.parse(a.lastSeenUtc || "1970-01-01");
    })
    .slice(0, STICKY_MAX_WITHIN_BAND);

  const newStore = {
    ok: true,
    meta: { ...(store.meta ?? {}), updated_at_utc: now },
    structures: list,
  };
  saveSticky(newStore);

  return withinBand.map((s) => ({
    type: "institutional",
    tier: "structure_sticky",
    priceRange: s.priceRange,
    strength: round2(Number(s.maxStrengthSeen ?? 0)),
    details: {
      id: s.structureKey,
      facts: {
        sticky: {
          structureKey: s.structureKey,
          firstSeenUtc: s.firstSeenUtc,
          lastSeenUtc: s.lastSeenUtc,
          timesSeen: s.timesSeen,
          maxStrengthSeen: s.maxStrengthSeen,
        },
      },
    },
  }));
}

// ---------------- ATH wick shelf detector (NEW) ----------------

function detectAthWickShelf(bars1hAll, currentPrice) {
  if (!Array.isArray(bars1hAll) || bars1hAll.length < 50) return null;

  const recent = bars1hAll.slice(-ATH_LOOKBACK_BARS_1H);
  if (recent.length < 50) return null;

  let ath = -Infinity;
  for (const b of recent) {
    if (b && Number.isFinite(b.high)) ath = Math.max(ath, b.high);
  }
  if (!Number.isFinite(ath) || ath <= 0) return null;
  ath = round2(ath);

  // Only consider if price is near ATH
  if (Math.abs(currentPrice - ath) > ATH_NEAR_PRICE_PTS) return null;

  const shelfLo = round2(ath - ATH_SHELF_DEPTH_PTS);
  const shelfHi = ath;

  const lastN = POCKET_RECENT_END_BARS_1H;
  const recent2w = bars1hAll.slice(-lastN);
  if (recent2w.length < 20) return null;

  let wickTags = 0;
  const closes = [];

  for (const b of recent2w) {
    if (!b || !Number.isFinite(b.high) || !Number.isFinite(b.close) || !Number.isFinite(b.low)) continue;

    // Wick tag near ATH with rejection close below wick band
    if (b.high >= (ath - ATH_WICK_BAND_PTS) && b.close < (ath - ATH_WICK_BAND_PTS)) {
      wickTags++;
    }

    if (b.close <= ath && b.close >= shelfLo) closes.push(b.close);
  }

  if (wickTags < ATH_MIN_WICK_TAGS) return null;
  if (closes.length < 10) return null;

  const cMin = Math.min(...closes);
  const cMax = Math.max(...closes);
  const closeClusterWidth = cMax - cMin;

  if (closeClusterWidth > ATH_CLOSE_CLUSTER_PTS) return null;

  return {
    ath,
    priceRange: [shelfHi, shelfLo],
    negotiationMid: round2((shelfHi + shelfLo) / 2),
    wickTags,
    closeClusterWidth: round2(closeClusterWidth),
  };
}

// ---------------- Pocket proximity filter ----------------

function pocketTooCloseToAnyStructure(pocket, structures, bufferPts = 1.5) {
  // Allow ATH wick shelf pocket to bypass this rule (your request)
  if (pocket?.lane === "ath_wick_shelf") return false;

  const pr = pocket?.priceRange;
  if (!Array.isArray(pr) || pr.length < 2) return true;

  const pHi = Number(pr[0]);
  const pLo = Number(pr[1]);
  if (!Number.isFinite(pHi) || !Number.isFinite(pLo) || pHi <= pLo) return true;

  for (const s of structures || []) {
    const sr = s?.priceRange;
    if (!Array.isArray(sr) || sr.length < 2) continue;

    const sHi = Number(sr[0]);
    const sLo = Number(sr[1]);
    if (!Number.isFinite(sHi) || !Number.isFinite(sLo) || sHi <= sLo) continue;

    // overlap/touch => reject
    if (pHi >= sLo && pLo <= sHi) return true;

    // outside but within buffer => reject
    if (pLo > sHi) {
      const gap = pLo - sHi;
      if (gap <= bufferPts) return true;
    }
    if (pHi < sLo) {
      const gap = sLo - pHi;
      if (gap <= bufferPts) return true;
    }
  }
  return false;
}

// ---------------- Active pockets (clustered + recent) ----------------

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
        Math.min(
          100,
          strengthNow * 0.55 +
            relevanceScore * 0.30 +
            strengthHistory * 0.15
        )
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
        history: { touches: h.touches, midHits: h.midHits },
        window: {
          startTime: win[0]?.time ?? null,
          endTime: win[win.length - 1]?.time ?? null,
        },
      });
    }
  }

  // Cluster overlapping pockets -> keep best rep
  pockets.sort((a, b) => (b.strengthTotal ?? 0) - (a.strengthTotal ?? 0));

  const clusters = [];
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
        c.members.push(p);

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
      cluster: { size: c.members.length },
    }))
    .sort((a, b) => {
      const ra = (a.relevanceScore ?? 0);
      const rb = (b.relevanceScore ?? 0);
      if (rb !== ra) return rb - ra;
      return (b.strengthTotal ?? 0) - (a.strengthTotal ?? 0);
    })
    .slice(0, POCKET_MAX_RETURN);

  // ✅ ATH wick shelf override
  const athShelf = detectAthWickShelf(bars1hAll, currentPrice);
  if (athShelf) {
    const [hi, lo] = athShelf.priceRange;

    // remove reps overlapping the ATH shelf
    const filtered = reps.filter((p) => {
      const pr = Array.isArray(p?.priceRange) ? p.priceRange : null;
      if (!pr) return true;
      const pHi = pr[0], pLo = pr[1];
      if (!Number.isFinite(pHi) || !Number.isFinite(pLo)) return true;
      return !(pHi >= lo && pLo <= hi);
    });

    const athPocket = {
      type: "institutional",
      tier: "pocket_active",
      status: "building",
      priceRange: [hi, lo],
      price: round2((hi + lo) / 2),
      negotiationMid: athShelf.negotiationMid,
      barsCount: POCKET_RECENT_END_BARS_1H,
      acceptancePct: null,
      strengthNow: 90,
      relevanceScore: 100,
      strengthHistory: 80,
      strengthTotal: 92, // ensures red in overlay (90+)
      history: { wickTags: athShelf.wickTags },
      window: { startTime: null, endTime: null },
      lane: "ath_wick_shelf",
      structureLinked: false,
      ath: athShelf.ath,
      facts: {
        closeClusterWidth: athShelf.closeClusterWidth,
        wickTags: athShelf.wickTags,
      },
    };

    return [athPocket, ...filtered].slice(0, POCKET_MAX_RETURN);
  }

  return reps;
}

// ---------------- Main ----------------

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

    if (!Number.isFinite(currentPrice)) throw new Error("Could not determine currentPrice from bars.");

    console.log("[SMZ] currentPrice:", currentPrice);

    console.log("[SMZ] Running Institutional engine…");
    const levelsLive = computeSmartMoneyLevels(bars30m, bars1h, bars4h) || [];
    console.log("[SMZ] Institutional levels generated:", levelsLive.length);

    const liveStructures = levelsLive.filter((z) => (z?.tier ?? "") === "structure");

    console.log("[SMZ] Updating sticky snapshot store…");
    const structuresSticky = updateStickyFromLive(liveStructures, currentPrice);
    console.log("[SMZ] structures_sticky (within band):", structuresSticky.length);

    console.log("[SMZ] Computing active pockets (building)…");
    const pocketsActive = computeActivePockets({ bars1hAll: bars1h, currentPrice });

    // Option C lane tagging (keep ATH lane as-is)
    const pocketsTagged = (pocketsActive || []).map((p) => {
      if (p?.lane === "ath_wick_shelf") return p;
      const linked = isStructureLinked(p, liveStructures);
      return { ...p, lane: linked ? "structure_linked" : "emerging", structureLinked: linked };
    });

    // Filter out pockets too close to structures (except ATH wick shelf)
    const pocketsClean = pocketsTagged.filter(
      (p) => !pocketTooCloseToAnyStructure(p, liveStructures, POCKET_STRUCT_BUFFER_PTS)
    );

    const linkedCount = pocketsClean.filter((p) => p.structureLinked).length;
    console.log(
      "[SMZ] Active pockets returned:",
      pocketsClean.length,
      "| linked:",
      linkedCount,
      "| emerging:",
      pocketsClean.length - linkedCount
    );

    const payload = {
      ok: true,
      meta: {
        generated_at_utc: new Date().toISOString(),
        lookback_days: { "30m": DAYS_30M, "1h": DAYS_1H, "4h(synth)": DAYS_1H },
        current_price: round2(currentPrice),
        sticky: {
          file: path.basename(STICKY_FILE),
          round_step: STICKY_ROUND_STEP,
          band_pts: STICKY_KEEP_WITHIN_BAND_PTS,
          within_band_cap: STICKY_MAX_WITHIN_BAND,
          archive_days: STICKY_ARCHIVE_DAYS,
        },
        pocket_settings: {
          find_days_1h: POCKET_FIND_DAYS_1H,
          window_points: POCKET_WINDOW_PTS,
          max_width_pts: POCKET_MAX_WIDTH_PTS,
          min_bars: POCKET_MIN_BARS,
          max_bars: POCKET_MAX_BARS,
          min_accept_pct: POCKET_MIN_ACCEPT_PCT,
          recent_end_bars_1h: POCKET_RECENT_END_BARS_1H,
          cluster_overlap: POCKET_CLUSTER_OVERLAP,
          cluster_mid_pts: POCKET_CLUSTER_MID_PTS,
          max_return: POCKET_MAX_RETURN,
          structure_link_near_pts: STRUCT_LINK_NEAR_PTS,
          struct_buffer_pts: POCKET_STRUCT_BUFFER_PTS,
          ath: {
            lookback_bars_1h: ATH_LOOKBACK_BARS_1H,
            wick_band_pts: ATH_WICK_BAND_PTS,
            shelf_depth_pts: ATH_SHELF_DEPTH_PTS,
            min_wick_tags: ATH_MIN_WICK_TAGS,
            close_cluster_pts: ATH_CLOSE_CLUSTER_PTS,
            near_price_pts: ATH_NEAR_PRICE_PTS,
          },
        },
      },
      levels: levelsLive,
      pockets_active: pocketsClean,
      structures_sticky: structuresSticky,
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
        structures_sticky: [],
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
