// src/services/core/jobs/updateSmzShelves.js
// Smart Money Shelves Job — writes ONLY smz-shelves.json (blue/red)
//
// HARD FIXES ADDED:
// 1) Detect timeframe window mismatch (e.g., 15m pulling old months)
// 2) Anchor shelves “current price” to 30m/1h (not 15m), so shelves stay near live market
// 3) Filter output shelves to stay within ±bandPoints of currentPriceAnchor
//
// Output schema unchanged:
// { ok:true, meta:{generated_at_utc}, levels:[{type:"accumulation"|"distribution", price, priceRange:[hi,lo], strength}] }

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeShelves } from "../logic/smzShelvesScanner.js";
import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-shelves.json");

// Config
const SYMBOL = "SPY";
const BAND_POINTS = 40;

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
  // Anchor to the most trustworthy “current market” close among higher TFs.
  // 15m can be stale if provider returns older window.
  const c30 = lastClose(bars30m);
  const c1h = lastClose(bars1h);

  if (Number.isFinite(c30) && Number.isFinite(c1h)) {
    // If they disagree too much, log it but still prefer 30m (closest to “now” in this job)
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

    // keep if any overlap with band
    return !(zHi < lo || zLo > hi);
  });
}

async function main() {
  try {
    console.log("[SHELVES] Fetching bars…");

    // Shelves scanner expects bars10m naming, but you stated it's actually 15m now.
    // We keep that mapping, but we DO NOT trust 15m for current price anchor.
    const [bars15mRaw, bars30mRaw, bars1hRaw] = await Promise.all([
      getBarsFromPolygon(SYMBOL, "15m", 260),
      getBarsFromPolygon(SYMBOL, "30m", 120),
      getBarsFromPolygon(SYMBOL, "1h", 150),
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

    // Last closes (proves stale windows instantly)
    console.log("[SHELVES] last close 15m:", lastClose(bars15m));
    console.log("[SHELVES] last close 30m:", lastClose(bars30m));
    console.log("[SHELVES] last close 1h :", lastClose(bars1h));

    // Detect mismatch (if 15m ends far earlier than 30m/1h)
    if (s15?.last && s30?.last) {
      const lagDays = (s30.last - s15.last) / 86400;
      if (lagDays > 2) {
        console.warn(
          "[SHELVES] WARNING: 15m window appears stale vs 30m by days:",
          lagDays.toFixed(1)
        );
      }
    }

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

    // Hard-filter shelves to the SAME band around the true current price
    const shelves = filterShelvesToBand(shelvesRaw, currentPriceAnchor, BAND_POINTS);

    console.log("[SHELVES] Shelves generated (raw):", shelvesRaw.length);
    console.log("[SHELVES] Shelves kept (band filtered):", shelves.length);

    const payload = {
      ok: true,
      meta: {
        generated_at_utc: new Date().toISOString(),
        symbol: SYMBOL,
        band_points: BAND_POINTS,
        current_price_anchor: Number(currentPriceAnchor.toFixed(2)),
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
