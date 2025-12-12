// services/core/jobs/updateSmzShelves.js
// Script #2 Job — runs Smart Money Shelves Scanner (Acc/Dist)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeShelves } from "../logic/smzShelvesScanner.js";
import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-shelves.json");

// Fetch multi-timeframe bars for SPY
async function loadBars(symbol = "SPY") {
  const [bars10mRaw, bars30mRaw, bars1hRaw] = await Promise.all([
    getBarsFromPolygon(symbol, "10m", 10),  // ~2–3 days
    getBarsFromPolygon(symbol, "30m", 20),  // ~5–7 days
    getBarsFromPolygon(symbol, "1h",  40),  // ~10–14 days
  ]);

  return {
    bars10m: normalizeBars(bars10mRaw),
    bars30m: normalizeBars(bars30mRaw),
    bars1h:  normalizeBars(bars1hRaw),
  };
}

// Normalize Polygon bars → engine format
function normalizeBars(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      const t = b.t ?? b.time;
      return {
        time: typeof t === "number" ? t : 0,
        open: Number(b.o ?? b.open ?? 0),
        high: Number(b.h ?? b.high ?? 0),
        low:  Number(b.l ?? b.low  ?? 0),
        close:Number(b.c ?? b.close?? 0),
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

async function main() {
  try {
    console.log("[SMZ Shelves] Fetching bars…");
    const { bars10m, bars30m, bars1h } = await loadBars("SPY");

    console.log(
      "[SMZ Shelves] Bars:",
      "10m =", bars10m.length,
      "30m =", bars30m.length,
      "1h =", bars1h.length
    );

    console.log("[SMZ Shelves] Running shelves scanner…");
    const shelves = computeShelves({
      bars10m,
      bars30m,
      bars1h,
      bandPoints: 40,
    }) || [];

    console.log("[SMZ Shelves] Shelves found:", shelves.length);

    const payload = {
      ok: true,
      shelves,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("[SMZ Shelves] Saved to:", OUTFILE);
    console.log("[SMZ Shelves] Job complete.");
  } catch (err) {
    console.error("[SMZ Shelves] FAILED:", err);

    try {
      const fallback = {
        ok: true,
        shelves: [],
        note: "Shelves job error",
      };
      fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
      fs.writeFileSync(OUTFILE, JSON.stringify(fallback, null, 2), "utf8");
      console.log("[SMZ Shelves] Wrote fallback empty smz-shelves.json");
    } catch (inner) {
      console.error("[SMZ Shelves] Also failed fallback write:", inner);
    }

    process.exitCode = 1;
  }
}

// Allow manual execution
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
