// services/core/jobs/updateSmzLevels.js
// Smart Money Zone updater (manual/cron job)
//
// Usage (from repo root):
//   node services/core/jobs/updateSmzLevels.js

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

// Import your Smart Money engine (backend version)
import { computeAccDistLevelsFromBars } from "../logic/smzEngine.js";

// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Helper: fetch OHLC from your backend /api/v1/ohlc ---
async function fetchBars(symbol, timeframe, limit = 300) {
  const url =
    `https://frye-market-backend-1.onrender.com/api/v1/ohlc` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=${encodeURIComponent(timeframe)}` +
    `&limit=${encodeURIComponent(String(limit))}`;

  console.log("[SMZ] Fetching", timeframe, "bars from:", url);

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Failed fetching ${timeframe}: ${r.status} ${txt}`);
  }

  const json = await r.json();
  const bars = Array.isArray(json) ? json : json.bars || [];

  console.log(`[SMZ] ${timeframe} returned ${bars.length} bars`);
  return bars;
}

// --- Main job ---
async function updateSmzLevels() {
  try {
    const symbol = "SPY";

    // 1) Fetch higher timeframe bars (30m, 1h, 4h)
    const bars30m = await fetchBars(symbol, "30m", 500);
    const bars1h  = await fetchBars(symbol, "1h",  500);
    const bars4h  = await fetchBars(symbol, "4h",  500);

    // 2) Merge and sort by time
    const merged = [...bars30m, ...bars1h, ...bars4h].sort(
      (a, b) => (a.time || 0) - (b.time || 0)
    );
    console.log("[SMZ] Total merged bars:", merged.length);

    if (merged.length < 20) {
      console.warn("[SMZ] Not enough bars to compute levels");
    }

    // 3) Run Smart Money engine
    console.log("[SMZ] Computing Acc/Dist levels...");
    const levels = computeAccDistLevelsFromBars(merged);
    console.log(`[SMZ] Detected ${levels.length} Smart Money levels`);

    // 4) Save to services/core/data/smz-levels.json
    const outPath = path.resolve(__dirname, "../data/smz-levels.json");
    const payload = { levels };

    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
    console.log("[SMZ] Wrote smz-levels.json to:", outPath);
    console.log("[SMZ] Done.");
  } catch (err) {
    console.error("[SMZ] updateSmzLevels failed:", err);
    process.exit(1);
  }
}

// Run directly: node services/core/jobs/updateSmzLevels.js
if (import.meta.url === `file://${process.argv[1]}`) {
  updateSmzLevels();
}

export default updateSmzLevels;
