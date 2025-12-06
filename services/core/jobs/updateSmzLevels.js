// services/core/jobs/updateSmzLevels.js
// Smart Money Zone updater (manual/cron job)
//
// Usage (from repo root):
//   node services/core/jobs/updateSmzLevels.js

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { computeAccDistLevels } from "../logic/smzEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function fetchBars(symbol, timeframe, limit = 300) {
  const base =
    process.env.CORE_BASE_URL ||
    "https://frye-market-backend-1.onrender.com";

  const url =
    `${base.replace(/\/+$/, "")}/api/v1/ohlc` +
    `?symbol=${encodeURIComponent(symbol)}` +
    `&timeframe=${encodeURIComponent(timeframe)}` +
    `&limit=${encodeURIComponent(String(limit))}`;

  console.log("[SMZ] Fetching", timeframe, "bars from:", url);

  const r = await fetch(url);
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    throw new Error(`Failed ${timeframe}: ${r.status} ${txt}`);
  }

  const json = await r.json();
  const bars = Array.isArray(json) ? json : json.bars || [];

  console.log(`[SMZ] ${timeframe} returned ${bars.length} bars`);
  return bars;
}

async function updateSmzLevels() {
  try {
    const symbol = "SPY";

    // 1) Fetch higher timeframe bars (30m, 1h, 4h)
    const [bars30m, bars1h, bars4h] = await Promise.all([
      fetchBars(symbol, "30m", 500),
      fetchBars(symbol, "1h", 500),
      fetchBars(symbol, "4h", 500),
    ]);

    console.log(
      "[SMZ] Total bars:",
      "30m", bars30m.length,
      "1h", bars1h.length,
      "4h", bars4h.length
    );

    // 2) Run Smart Money engine
    console.log("[SMZ] Computing Acc/Dist levels...");
    const levels = computeAccDistLevels(bars30m, bars1h, bars4h);
    console.log(`[SMZ] Detected ${levels.length} Smart Money levels`);

    // 3) Save to services/core/data/smz-levels.json
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

// Run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateSmzLevels();
}

export default updateSmzLevels;
