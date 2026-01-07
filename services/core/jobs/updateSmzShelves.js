// src/services/core/jobs/updateSmzShelves.js
// Smart Money Shelves Job — writes ONLY smz-shelves.json (blue/red)
//
// Uses DEEP provider (jobs only), chart provider remains untouched.
//
// Includes your existing hard fixes:
// 1) Anchor shelves “current price” to 30m/1h (not 15m)
// 2) Filter shelves to ±BAND_POINTS around currentPriceAnchor
// 3) Re-grade shelves strength into 60–89 (reserving 90–100 for institutional zones)
//
// Efficient lookback plan (LOCKED for shelves):
// - 15m = 180 days
// - 30m = 180 days
// - 1h  = 180 days

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeShelves } from "../logic/smzShelvesScanner.js";
import { getBarsFromPolygonDeep } from "../../../api/providers/polygonBarsDeep.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-shelves.json");

// Config
const SYMBOL = "SPY";
const BAND_POINTS = 40;

// ✅ Lookback days (LOCKED for shelves)
const DAYS_15M = 180;
const DAYS_30M = 180;
const DAYS_1H = 180;

// Shelves strength band (LOCKED)
const SHELF_STRENGTH_LO = 60;
const SHELF_STRENGTH_HI = 89;

// Normalize Polygon aggregate bars to { time(sec), open, high, low, close, volume }
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

function spanInfo(label, bars) {
  if (!Array.isArray(bars) || bars.length === 0) {
    console.log(`[SHELVES] COVERAGE ${label}: none`);
    return { first: null, last: null, spanDays: null };
  }

  const first = bars[0].time;
  const last = bars[bars.length - 1].time;
  const days = (last - first) / 86400;

  console.log(
    `[SHELVES] COVERAGE ${label}:`,
    "bars =", bars.length,
    "| from =", new Date(first * 1000).toISOString(),
    "| to =", new Date(last * 1000).toISOString(),
    "| spanDays =", days.toFixed(1)
  );

  return { first, last, spanDays: days };
}

function lastClose(bars) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const c = bars[bars.length - 1]?.close;
  return Number.isFinite(c) ? c : null;
}

function pickCurrentPriceAnchor({ bars30m, bars1h }) {
  const c30 = lastClose(bars30m);
  const c1h = lastClose(bars1h);

  if (Number.isFinite(c30) && Number.isFinite(c1h)) {
    const diff = Math.abs(c30 - c1h);
    if (diff > 5) {
      console.warn("[SHELVES] WARNING: 30m vs 1h close mismatch:", { c30, c1h, diff });
    }
    return c30;
  }

  return Number.isFinite(c30) ? c30 : (Number.isFinite(c1h) ? c1h : null);
}

function filterShelvesToBand(levels, currentPrice, bandPoints) {
  if (!Array.isArray(levels)) return [];
  if (!Number.isFinite(currentPrice)) return levels;

  const lo = currentPrice - bandPoints;
  const hi = currentPrice + bandPoints;

  return levels.filter((s) => {
    const pr = s?.priceRange;
    if (!Array.isArray(pr) || pr.length !== 2) return false;
    const zHi = Number(pr[0]);
    const zLo = Number(pr[1]);
    if (!Number.isFinite(zHi) || !Number.isFinite(zLo)) return false;
    return !(zHi < lo || zLo > hi);
  });
}

function remapShelvesStrengthToBand(levels, lo = SHELF_STRENGTH_LO, hi = SHELF_STRENGTH_HI) {
  if (!Array.isArray(levels) || levels.length === 0) {
    return { levels, minRaw: null, maxRaw: null };
  }

  const rawVals = levels
    .map((x) => Number(x?.strength))
    .filter((n) => Number.isFinite(n));

  if (rawVals.length === 0) {
    return { levels, minRaw: null, maxRaw: null };
  }

  const minRaw = Math.min(...rawVals);
  const maxRaw = Math.max(...rawVals);

  if (maxRaw === minRaw) {
    const mapped = levels.map((x) => ({
      ...x,
      strength_raw: Number(x?.strength ?? 0),
      strength: hi,
    }));
    return { levels: mapped, minRaw, maxRaw };
  }

  const mapped = levels.map((x) => {
    const raw = Number(x?.strength ?? 0);
    const t = (raw - minRaw) / (maxRaw - minRaw);
    const scaled = lo + (hi - lo) * t;
    const strength = Math.max(lo, Math.min(hi, Math.round(scaled)));
    return { ...x, strength_raw: raw, strength };
  });

  return { levels: mapped, minRaw, maxRaw };
}

async function main() {
  try {
    console.log("[SHELVES] Fetching bars (DEEP)…");

    const [bars15mRaw, bars30mRaw, bars1hRaw] = await Promise.all([
      getBarsFromPolygonDeep(SYMBOL, "15m", DAYS_15M),
      getBarsFromPolygonDeep(SYMBOL, "30m", DAYS_30M),
      getBarsFromPolygonDeep(SYMBOL, "1h", DAYS_1H),
    ]);

    const bars15m = normalizeBars(bars15mRaw);
    const bars30m = normalizeBars(bars30mRaw);
    const bars1h = normalizeBars(bars1hRaw);

    console.log("[SHELVES] 15m bars:", bars15m.length);
    console.log("[SHELVES] 30m bars:", bars30m.length);
    console.log("[SHELVES] 1h  bars:", bars1h.length);

    const s15 = spanInfo("15m", bars15m);
    const s30 = spanInfo("30m", bars30m);
    const s1h = spanInfo("1h", bars1h);

    console.log("[SHELVES] last close 15m:", lastClose(bars15m));
    console.log("[SHELVES] last close 30m:", lastClose(bars30m));
    console.log("[SHELVES] last close 1h :", lastClose(bars1h));

    const currentPriceAnchor = pickCurrentPriceAnchor({ bars30m, bars1h });
    if (!Number.isFinite(currentPriceAnchor)) {
      throw new Error("Cannot determine currentPriceAnchor from 30m/1h bars");
    }

    console.log("[SHELVES] currentPriceAnchor (from 30m/1h):", currentPriceAnchor.toFixed(2));

    console.log("[SHELVES] Running shelves scanner (Acc/Dist)…");
    const shelvesRaw =
      computeShelves({
        bars10m: bars15m, // historical naming
        bars30m,
        bars1h,
        bandPoints: BAND_POINTS,
      }) || [];

    const shelvesBand = filterShelvesToBand(shelvesRaw, currentPriceAnchor, BAND_POINTS);

    console.log("[SHELVES] Shelves generated (raw):", shelvesRaw.length);
    console.log("[SHELVES] Shelves kept (band filtered):", shelvesBand.length);

    const { levels: shelves, minRaw, maxRaw } = remapShelvesStrengthToBand(
      shelvesBand,
      SHELF_STRENGTH_LO,
      SHELF_STRENGTH_HI
    );

    console.log("[SHELVES] Strength remap:", {
      band: `${SHELF_STRENGTH_LO}-${SHELF_STRENGTH_HI}`,
      minRaw,
      maxRaw,
    });

    const payload = {
      ok: true,
      meta: {
        generated_at_utc: new Date().toISOString(),
        symbol: SYMBOL,
        band_points: BAND_POINTS,
        current_price_anchor: Number(currentPriceAnchor.toFixed(2)),
        lookback_days: { "15m": DAYS_15M, "30m": DAYS_30M, "1h": DAYS_1H },
        coverage: { "15m": s15, "30m": s30, "1h": s1h },
        strength_band: {
          lo: SHELF_STRENGTH_LO,
          hi: SHELF_STRENGTH_HI,
          min_raw: Number.isFinite(minRaw) ? Number(minRaw) : null,
          max_raw: Number.isFinite(maxRaw) ? Number(maxRaw) : null,
        },
      },
      levels: shelves,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("[SHELVES] Saved shelves to:", OUTFILE);
    console.log("[SHELVES] Job complete.");
  } catch (err) {
    console.error("[SHELVES] FAILED:", err);

    try {
      const fallback = {
        ok: true,
        levels: [],
        note: "SMZ shelves job error, no shelves generated this run",
      };
      fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
      fs.writeFileSync(OUTFILE, JSON.stringify(fallback, null, 2), "utf8");
      console.log("[SHELVES] Wrote fallback empty smz-shelves.json");
    } catch (inner) {
      console.error("[SHELVES] Also failed to write fallback smz-shelves.json:", inner);
    }

    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
