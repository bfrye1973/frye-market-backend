// src/services/core/jobs/updateSmzLevels.js
// SMZ Master Job — Institutional Zones + Acc/Dist Shelves (one run)
//
// Writes:
// 1) smz-levels.json   (institutional/yellow)
// 2) smz-shelves.json  (accumulation/blue + distribution/red)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js";
import { computeShelves } from "../logic/smzShelvesScanner.js";
import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_LEVELS = path.resolve(__dirname, "../data/smz-levels.json");
const OUT_SHELVES = path.resolve(__dirname, "../data/smz-shelves.json");

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
    .filter((b) =>
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
      cur.volume += (b.volume ?? 0);
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

async function main() {
  try {
    console.log("[SMZ] Fetching multi-TF bars…");

    // Institutional uses 30m + 1h + 4h(synth)
    const [bars30mRaw, bars1hRaw, bars15mRaw] = await Promise.all([
      getBarsFromPolygon("SPY", "30m", 120),
      getBarsFromPolygon("SPY", "1h", 150),
      // Shelves scanner uses what you call bars10m but you stated it's actually 15m now
      getBarsFromPolygon("SPY", "15m", 260),
    ]);

    const bars30m = normalizeBars(bars30mRaw);
    const bars1h = normalizeBars(bars1hRaw);
    const bars4h = aggregateTo4h(bars1h);

    const bars15m = normalizeBars(bars15mRaw);

    console.log("[SMZ] 30m bars:", bars30m.length);
    console.log("[SMZ] 1h  bars:", bars1h.length);
    console.log("[SMZ] 15m bars:", bars15m.length);

    spanInfo("30m", bars30m);
    spanInfo("1h", bars1h);
    spanInfo("4h(synth)", bars4h);

    console.log(
      "[SMZ] maxHigh 30m:", maxHigh(bars30m),
      "1h:", maxHigh(bars1h),
      "4h(synth):", maxHigh(bars4h)
    );

    console.log("[SMZ] Running Institutional engine…");
    const inst = computeSmartMoneyLevels(bars30m, bars1h, bars4h) || [];
    console.log("[SMZ] Institutional zones generated:", inst.length);

    console.log("[SMZ] Running Shelves scanner (Acc/Dist)…");
    const shelves = computeShelves({
      bars10m: bars15m,    // historical naming: shelves scanner expects bars10m, but it's 15m
      bars30m,
      bars1h,
      bandPoints: 40,
    }) || [];
    console.log("[SMZ] Shelves generated:", shelves.length);

    const now = new Date().toISOString();

    const levelsPayload = {
      ok: true,
      meta: { generated_at_utc: now },
      levels: inst,
    };

    const shelvesPayload = {
      ok: true,
      meta: { generated_at_utc: now },
      levels: shelves,
    };

    fs.mkdirSync(path.dirname(OUT_LEVELS), { recursive: true });
    fs.writeFileSync(OUT_LEVELS, JSON.stringify(levelsPayload, null, 2), "utf8");
    fs.writeFileSync(OUT_SHELVES, JSON.stringify(shelvesPayload, null, 2), "utf8");

    console.log("[SMZ] Saved institutional:", OUT_LEVELS);
    console.log("[SMZ] Saved shelves:", OUT_SHELVES);
    console.log("[SMZ] Job complete.");
  } catch (err) {
    console.error("[SMZ] FAILED:", err);

    try {
      const fallback = {
        ok: true,
        levels: [],
        note: "SMZ job error, no levels generated this run",
      };
      fs.mkdirSync(path.dirname(OUT_LEVELS), { recursive: true });
      fs.writeFileSync(OUT_LEVELS, JSON.stringify(fallback, null, 2), "utf8");
      fs.writeFileSync(OUT_SHELVES, JSON.stringify(fallback, null, 2), "utf8");
      console.log("[SMZ] Wrote fallback empty JSON files");
    } catch (inner) {
      console.error("[SMZ] Also failed to write fallback files:", inner);
    }

    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
