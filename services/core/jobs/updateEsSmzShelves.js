// services/core/jobs/updateEsSmzShelves.js
// Engine 1B — ES Futures Imbalance Shelves Job
//
// Purpose:
// - Detect ES futures accumulation/distribution shelves
// - 30m = detection
// - 1h  = confirmation
// - Uses futures OHLC route only
// - Writes data/es-smz-shelves.json
//
// Important:
// - Does NOT touch SPY shelves
// - Does NOT create negotiated zones
// - Does NOT feed Engine 15 / Engine 22 yet
// - ES prices are rounded to 0.25 tick increments

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeShelves } from "../logic/esSmzShelvesScanner.js";
import { fetchFuturesBars as fetchFuturesBarsFromProvider } from "../providers/futuresOhlcProvider.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/es-smz-shelves.json");
const MANUAL_FILE = path.resolve(__dirname, "../data/es-smz-manual-shelves.json");

const SYMBOL = "ES";

// Same model as SPY shelves:
// 30m detection + 1h confirmation.
const DETECTION_TF = "30m";
const CONFIRM_TF = "1h";

const LIMIT_30M = 1000;
const LIMIT_1H = 1000;

// Keep same first-pass policy as SPY.
const BAND_POINTS = 40;

const SHELF_STRENGTH_LO = 65;
const SHELF_STRENGTH_HI = 89;

const SHELF_PERSIST_HOURS = 48;
const REPLACE_MARGIN_PTS = 6;
const REPLACE_BIG_WIN_PTS = 12;
const MIN_HOLD_MINUTES = 60;

const SAME_TYPE_OVERLAP_DEDUPE_RATIO = 0.25;
const SAME_TYPE_GAP_PTS = 0.75;

const DEBUG_LEVELS_COUNT = 25;
const ES_TICK_SIZE = 0.25;

const isoNow = () => new Date().toISOString();

function round2(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function roundToTick(price, tick = ES_TICK_SIZE) {
  if (price === null || price === undefined || price === "") return null;

  const n = Number(price);
  if (!Number.isFinite(n)) return null;

  return Number((Math.round(n / tick) * tick).toFixed(2));
}

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
  const mapped = Math.round(
    SHELF_STRENGTH_LO + (SHELF_STRENGTH_HI - SHELF_STRENGTH_LO) * c
  );
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
        Number.isFinite(b.open) &&
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

  const hi = roundToTick(Math.max(a, b));
  const lo = roundToTick(Math.min(a, b));

  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  if (!(hi > lo)) return null;

  return {
    hi,
    lo,
    width: roundToTick(hi - lo),
    mid: roundToTick((hi + lo) / 2),
  };
}

function normalizeType(t) {
  const x = String(t ?? "").toLowerCase();

  if (x === "accumulation" || x === "acc") return "accumulation";
  if (x === "distribution" || x === "dist") return "distribution";

  return null;
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

function isManualShelf(s) {
  return (
    s?.rangeSource === "manual" ||
    s?.locked === true ||
    Number.isFinite(Number(s?.scoreOverride))
  );
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

function loadManualShelves(nowIso) {
  // Optional ES manual shelf file.
  // This is NOT negotiated zones.
  // If file does not exist, ES Engine 1B still runs clean.
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
          Array.isArray(s?.manualRange) && s.manualRange.length === 2
            ? s.manualRange
            : s.priceRange
        );
        if (!r) return null;

        const scoreOverride = Number.isFinite(Number(s?.scoreOverride))
          ? Number(s.scoreOverride)
          : null;

        const base = scoreOverride ?? Number(s?.strength ?? 75);
        const strength = clampInt(base, SHELF_STRENGTH_LO, SHELF_STRENGTH_HI);
        const conf = confidenceFromRawStrength(strength);

        return {
          id: s?.id ?? `${SYMBOL}|${type}|manual|${r.lo}|${r.hi}`,
          symbol: SYMBOL,
          type,
          price: r.mid,
          priceRange: [r.hi, r.lo],
          lo: r.lo,
          hi: r.hi,
          mid: r.mid,
          strength,
          strength_raw: null,
          confidence: round2(conf),
          timeframe: DETECTION_TF,
          rangeSource: "manual",
          active: true,
          locked: true,
          scoreOverride,
          comment: typeof s?.comment === "string" ? s.comment : null,
          shelfKey: s?.shelfKey ?? null,
          status: s?.status ?? "active",
          firstSeenUtc: nowIso,
          lastSeenUtc: nowIso,
          maxStrengthSeen: strength,
          diagnostic: s?.diagnostic ?? {
            reason: "MANUAL_ES_SHELF",
          },
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

    if (priceInside(currentPrice, r)) {
      keep.lastSeenUtc = nowIso;
    }

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

      const ageMin = minutesSince(o.firstSeenUtc);
      const need =
        ageMin < MIN_HOLD_MINUTES
          ? oMax + REPLACE_BIG_WIN_PTS
          : oMax + REPLACE_MARGIN_PTS;

      if (nStrength >= need) {
        out[i] = {
          ...o,
          ...n,
          firstSeenUtc: o.firstSeenUtc ?? nowIso,
          lastSeenUtc: nowIso,
          maxStrengthSeen: Math.max(oMax, nStrength),
        };
      } else {
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

function dedupeSameTypeClose(levels) {
  const list = Array.isArray(levels) ? levels.slice() : [];

  list.sort(
    (a, b) =>
      Number(b?.strength ?? 0) - Number(a?.strength ?? 0)
  );

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

      return (
        ov >= SAME_TYPE_OVERLAP_DEDUPE_RATIO ||
        gap <= SAME_TYPE_GAP_PTS
      );
    });

    if (!dupe) kept.push(s);
  }

  return kept;
}

function sanitizeDiagnosticForEs(diag, type) {
  const d = diag && typeof diag === "object" ? diag : {};

  const rel = d?.relevance || {};
  const w3 = rel?.w3 || {};
  const w7 = rel?.w7 || {};

  const lowerTouches =
    Number(w3?.lowerWickTouches ?? 0) + Number(w7?.lowerWickTouches ?? 0);

  const upperTouches =
    Number(w3?.upperWickTouches ?? 0) + Number(w7?.upperWickTouches ?? 0);

  const reason =
    type === "accumulation"
      ? "SELLERS_FAILED_AT_LOW"
      : "BUYERS_FAILED_AT_HIGH";

  return {
    ...d,
    wickTouches:
      type === "accumulation" ? lowerTouches : upperTouches,
    failedBreakdowns:
      type === "accumulation" ? lowerTouches : 0,
    failedBreakouts:
      type === "distribution" ? upperTouches : 0,
    acceptance:
      type === "accumulation" ? "HELD_LOWER_ZONE" : "REJECTED_UPPER_ZONE",
    reason,
  };
}

function normalizeShelfForEs(s, nowIso) {
  const type = normalizeType(s?.type);
  if (!type) return null;

  const r = normalizeRange(s?.priceRange);
  if (!r) return null;

  const raw = Number(s?.strength_raw ?? 75);
  const conf = Number.isFinite(Number(s?.confidence))
    ? clamp01(Number(s.confidence))
    : confidenceFromRawStrength(raw);

  const strength = mapShelfStrengthFromConfidence(conf);

  return {
    id: `${SYMBOL}|${type}|${r.lo.toFixed(2)}|${r.hi.toFixed(2)}`,
    symbol: SYMBOL,
    type,
    price: r.mid,
    priceRange: [r.hi, r.lo],
    lo: r.lo,
    hi: r.hi,
    mid: r.mid,
    strength,
    strength_raw: Number.isFinite(raw) ? round2(raw) : null,
    confidence: round2(conf),
    timeframe: DETECTION_TF,
    confirmTimeframe: CONFIRM_TF,
    rangeSource: "auto",
    active: true,
    firstSeenUtc: nowIso,
    lastSeenUtc: nowIso,
    maxStrengthSeen: strength,
    diagnostic: sanitizeDiagnosticForEs(s?.diagnostic, type),
  };
}

async function fetchFuturesBars(symbol, timeframe, limit = 1000) {
  const result = await fetchFuturesBarsFromProvider({
    symbol,
    timeframe,
    limit,
  });

  const bars = normalizeBars(result?.bars || []);

  console.log("[Engine1B ES] provider futures fetch", {
    symbol,
    timeframe,
    limit,
    productCode: result?.productCode ?? null,
    resolvedSymbol: result?.resolvedSymbol ?? null,
    resolution: result?.resolution ?? null,
    count: result?.count ?? null,
    barsLen: bars.length,
    first: bars[0] ?? null,
    last: bars[bars.length - 1] ?? null,
  });

  return bars;
}
async function main() {
  try {
    const [bars30m, bars1h] = await Promise.all([
      fetchFuturesBars(SYMBOL, DETECTION_TF, LIMIT_30M),
      fetchFuturesBars(SYMBOL, CONFIRM_TF, LIMIT_1H),
    ]);
    if (!bars30m.length || !bars1h.length) {
      throw new Error(
        `[Engine1B ES] Missing ES futures bars: 30m=${bars30m.length}, 1h=${bars1h.length}`
      );
    }
    const currentPriceRaw =
      lastFiniteClose(bars30m) ?? lastFiniteClose(bars1h);

    const currentPriceAnchor = roundToTick(currentPriceRaw);

    if (!Number.isFinite(currentPriceAnchor)) {
      throw new Error("[Engine1B ES] No valid ES current price anchor");
    }

    const nowIso = isoNow();
    const prevShelves = loadPrevShelves();

    const manualAll = loadManualShelves(nowIso);
    const manualInBand = manualAll.filter((s) =>
      withinBand(normalizeRange(s.priceRange), currentPriceAnchor, BAND_POINTS)
    );

    const shelvesRaw =
      computeShelves({
        bars30m,
        bars1h,
        bandPoints: BAND_POINTS,
      }) || [];

    const autoMapped = shelvesRaw
      .map((s) => normalizeShelfForEs(s, nowIso))
      .filter(Boolean);

    const currentShelves = [...manualInBand, ...autoMapped];

    const withMemory = mergeWithMemoryStable(
      currentShelves,
      prevShelves,
      currentPriceAnchor,
      nowIso
    );

    // For ES v1:
    // Keep only best accumulation + best distribution, same final model as SPY.
    const bestAcc =
      withMemory
        .filter((s) => normalizeType(s?.type) === "accumulation")
        .sort(
          (a, b) =>
            Number(b?.maxStrengthSeen ?? b?.strength ?? 0) -
            Number(a?.maxStrengthSeen ?? a?.strength ?? 0)
        )[0] ?? null;

    const bestDist =
      withMemory
        .filter((s) => normalizeType(s?.type) === "distribution")
        .sort(
          (a, b) =>
            Number(b?.maxStrengthSeen ?? b?.strength ?? 0) -
            Number(a?.maxStrengthSeen ?? a?.strength ?? 0)
        )[0] ?? null;

    let finalLevels = [];

    if (bestAcc) finalLevels.push(bestAcc);
    if (bestDist) finalLevels.push(bestDist);

    finalLevels = dedupeSameTypeClose(finalLevels);

    const levels_debug = withMemory
      .slice()
      .sort(
        (a, b) =>
          Number(b?.strength ?? 0) - Number(a?.strength ?? 0)
      )
      .slice(0, DEBUG_LEVELS_COUNT);

    const payload = {
      ok: true,
      symbol: SYMBOL,
      current_price: currentPriceAnchor,
      generated_at_utc: nowIso,
      meta: {
        generated_at_utc: nowIso,
        symbol: SYMBOL,
        mode: "ES_ENGINE_1B_IMBALANCE_V1",
        source: "futures_ohlc",
        route: "/api/v1/futures/ohlc",
        detection_timeframe: DETECTION_TF,
        confirmation_timeframe: CONFIRM_TF,
        timeframes: [DETECTION_TF, CONFIRM_TF],
        band_points: BAND_POINTS,
        tick_size: ES_TICK_SIZE,
        current_price_anchor: currentPriceAnchor,
        shelf_persist_hours: SHELF_PERSIST_HOURS,
        replace_margin_pts: REPLACE_MARGIN_PTS,
        min_hold_minutes: MIN_HOLD_MINUTES,
        debug_levels_count: DEBUG_LEVELS_COUNT,
        bars: {
          bars30m: bars30m.length,
          bars1h: bars1h.length,
          last30mTime: bars30m[bars30m.length - 1]?.time ?? null,
          last1hTime: bars1h[bars1h.length - 1]?.time ?? null,
        },
      },
      levels: finalLevels,
      levels_debug,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log(
      `[Engine1B ES] wrote ${OUTFILE} levels=${finalLevels.length} debug=${levels_debug.length} price=${currentPriceAnchor}`
    );
  } catch (e) {
    console.error("[Engine1B ES] FAILED:", e);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
