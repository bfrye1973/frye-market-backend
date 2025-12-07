// services/core/jobs/updateSmzLevels.js
// Rebuild Smart Money Zones using our institutional algo engine

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js";
import { getBars } from "../polygon/getBars.js";   // your polygon fetcher

// ---------------------------------------------------------------------------
// Resolve __dirname (ESM-safe)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Output file
const OUTFILE = path.resolve(__dirname, "../data/smz-levels.json");

// ---------------------------------------------------------------------------
// Helper: fetch multiple timeframes & merge
async function loadMergedBars(symbol = "SPY") {
  const bars30m = await getBars(symbol, "30m", 1500);
  const bars1h  = await getBars(symbol, "1h", 700);
  const bars4h  = await getBars(symbol, "4h", 400);

  console.log("[SMZ] 30m returned", bars30m.length, "bars");
  console.log("[SMZ] 1h  returned", bars1h.length, "bars");
  console.log("[SMZ] 4h  returned", bars4h.length, "bars");

  const merged = [...bars30m, ...bars1h, ...bars4h];
  merged.sort((a, b) => a.time - b.time);

  console.log("[SMZ] Total merged bars:", merged.length);
  return merged;
}

// ---------------------------------------------------------------------------
// MAIN
(async () => {
  try {
    console.log("[SMZ] Fetching raw bars...");
    const bars = await loadMergedBars("SPY");

    console.log("[SMZ] Computing institutional zones...");
    const zones = computeSmartMoneyLevels(bars);

    console.log("[SMZ] Detected", zones.length, "zones");

    console.log("[SMZ] Saving to:", OUTFILE);
    fs.writeFileSync(
      OUTFILE,
      JSON.stringify({ ok: true, levels: zones }, null, 2)
    );

    console.log("[SMZ] Done.");
  } catch (err) {
    console.error("[SMZ] FAILED:", err);
    process.exit(1);
  }
})();
