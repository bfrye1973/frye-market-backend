// src/services/core/jobs/updateSmzShelves.js
// Smart Money Shelves Job — writes ONLY smz-shelves.json (blue/red)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeShelves } from "../logic/smzShelvesScanner.js";
import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-shelves.json");

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
    return;
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
}

async function main() {
  try {
    console.log("[SHELVES] Fetching bars…");

    // Shelves scanner uses bars10m name but you stated it's actually 15m now.
    const [bars15mRaw, bars30mRaw, bars1hRaw] = await Promise.all([
      getBarsFromPolygon("SPY", "15m", 260),
      getBarsFromPolygon("SPY", "30m", 120),
      getBarsFromPolygon("SPY", "1h", 150),
    ]);

    const bars15m = normalizeBars(bars15mRaw);
    const bars30m = normalizeBars(bars30mRaw);
    const bars1h = normalizeBars(bars1hRaw);

    console.log("[SHELVES] 15m bars:", bars15m.length);
    console.log("[SHELVES] 30m bars:", bars30m.length);
    console.log("[SHELVES] 1h  bars:", bars1h.length);

    spanInfo("15m", bars15m);
    spanInfo("30m", bars30m);
    spanInfo("1h", bars1h);

    console.log("[SHELVES] Running shelves scanner (Acc/Dist)…");
    const shelves = computeShelves({
      bars10m: bars15m, // historical naming
      bars30m,
      bars1h,
      bandPoints: 40,
    }) || [];

    console.log("[SHELVES] Shelves generated:", shelves.length);

    const payload = {
      ok: true,
      meta: { generated_at_utc: new Date().toISOString() },
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
