// services/core/jobs/updateSmzLevels.js
// Smart Money Zone updater (runs manually or via cron)

import fs from "fs";
import path from "path";
import fetch from "node-fetch";

// === Smart Money Engine (your Acc/Dist algorithm) ===
import { computeAccDistLevelsFromBars } from "../../scripts/build_accdist_levels.js"; 
// NOTE: This must point to the engine file where your compute function lives.
// If it's in a different place, tell me the path and I’ll adjust.

// === OHLC Fetch Helper ===
async function fetchBars(symbol, timeframe, limit = 300) {
  const url =
    `https://frye-market-backend-1.onrender.com/api/v1/ohlc?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed fetching ${timeframe}: ${r.status}`);

  const json = await r.json();
  return json;
}

// === MAIN JOB ===
async function updateSmzLevels() {
  try {
    const symbol = "SPY";

    console.log("[SMZ] Fetching OHLC bars...");

    const tf30 = await fetchBars(symbol, "30m", 500);
    const tf1h = await fetchBars(symbol, "1h", 500);
    const tf4h = await fetchBars(symbol, "4h", 500);

    console.log("[SMZ] Received:",
      tf30.count, "bars (30m),",
      tf1h.count, "bars (1h),",
      tf4h.count, "bars (4h)"
    );

    // Merge all timeframes into one dataset for stronger confidence
    const mergedBars = [
      ...(tf30.bars || []),
      ...(tf1h.bars || []),
      ...(tf4h.bars || [])
    ].sort((a, b) => a.time - b.time);

    console.log("[SMZ] Total merged bars:", mergedBars.length);

    // --- Run Smart Money Engine ---
    console.log("[SMZ] Computing Acc/Dist Levels...");
    const levels = computeAccDistLevelsFromBars(mergedBars);

    console.log(`[SMZ] Detected ${levels.length} Smart Money levels.`);

    // --- Save output ---
    const outPath = path.resolve("services/core/data/smz-levels.json");
    fs.writeFileSync(outPath, JSON.stringify({ levels }, null, 2));

    console.log("[SMZ] Saved smz-levels.json to:", outPath);
    console.log("[SMZ] Update complete.");
  } catch (err) {
    console.error("[SMZ] Job failed:", err);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateSmzLevels();
}

export default updateSmzLevels;
