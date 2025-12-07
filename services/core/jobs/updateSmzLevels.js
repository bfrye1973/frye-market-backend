// services/core/jobs/updateSmzLevels.js
// Institutional Smart Money Zones Rebuild Job

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// YOUR real institutional algo
import { computeSmartMoneyLevels } from "../logic/smzEngine.js";

// YOUR real polygon fetcher (existing file)
import { getPolygonBars } from "../polygon/polygonBars.js";  


// Resolve ESM pathing
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-levels.json");


// Pull merged institutional data feed
async function loadMergedBars(symbol = "SPY") {
  const bars30m = await getPolygonBars(symbol, "30m", 1500);
  const bars1h  = await getPolygonBars(symbol, "1h", 700);
  const bars4h  = await getPolygonBars(symbol, "4h", 400);

  console.log("[SMZ] 30m returned", bars30m.length, "bars");
  console.log("[SMZ] 1h  returned", bars1h.length, "bars");
  console.log("[SMZ] 4h  returned", bars4h.length, "bars");

  const merged = [...bars30m, ...bars1h, ...bars4h];
  merged.sort((a,b) => a.time - b.time);

  console.log("[SMZ] Total merged bars:", merged.length);
  return merged;
}


// MAIN JOB
(async () => {
  try {
    console.log("[SMZ] Fetching merged bars...");
    const bars = await loadMergedBars("SPY");

    console.log("[SMZ] Running institutional scoring engine...");
    const zones = computeSmartMoneyLevels(bars);

    console.log("[SMZ] Zones generated:", zones.length);

    fs.writeFileSync(
      OUTFILE,
      JSON.stringify({ ok: true, levels: zones }, null, 2)
    );

    console.log("[SMZ] Saved to:", OUTFILE);
    console.log("[SMZ] Job complete.");
  } 
  catch (err) {
    console.error("[SMZ] FAILED:", err);
    process.exit(1);
  }
})();
