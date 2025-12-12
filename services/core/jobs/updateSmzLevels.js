// services/core/jobs/updateSmzLevels.js
// Institutional Smart Money Zones Job (cleaned up)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js";

// Canonical Polygon provider (no more services/core/polygon)
import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-levels.json");

// Fetch multi-timeframe bars for SPY
async function loadBarsMultiTF(symbol = "SPY") {
  // Days of history – safe defaults per your spec
  const [bars30mRaw, bars1hRaw, bars4hRaw] = await Promise.all([
    getBarsFromPolygon(symbol, "30m", 120), // ~90–120 days
    getBarsFromPolygon(symbol, "1h",  150), // ~120–150 days
    getBarsFromPolygon(symbol, "4h",  180), // ~150–180 days
  ]);

  console.log("[SMZ] 30m bars:", bars30mRaw?.length ?? 0);
  console.log("[SMZ] 1h  bars:", bars1hRaw?.length ?? 0);
  console.log("[SMZ] 4h  bars:", bars4hRaw?.length ?? 0);

  return {
    bars30m: normalizeBars(bars30mRaw),
    bars1h:  normalizeBars(bars1hRaw),
    bars4h:  normalizeBars(bars4hRaw),
  };
}

// Normalize Polygon aggregate bars to { time, open, high, low, close, volume }
function normalizeBars(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      // If already normalized, pass through
      if (
        typeof b.time === "number" &&
        typeof b.open === "number" &&
        typeof b.high === "number" &&
        typeof b.low === "number" &&
        typeof b.close === "number"
      ) {
        return b;
      }

      const t = b.t ?? b.time; // Polygon: t = ms since epoch
      return {
        time: typeof t === "number" ? t : 0, // engine handles ms vs seconds
        open: Number(b.o ?? b.open  ?? 0),
        high: Number(b.h ?? b.high  ?? 0),
        low:  Number(b.l ?? b.low   ?? 0),
        close:Number(b.c ?? b.close ?? 0),
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
    console.log("[SMZ] Fetching multi-TF bars…");
    const { bars30m, bars1h, bars4h } = await loadBarsMultiTF("SPY");

    console.log(
      "[SMZ] Normalized bars — 30m:",
      bars30m.length,
      "1h:",
      bars1h.length,
      "4h:",
      bars4h.length
    );

    console.log("[SMZ] Running Smart Money engine…");
    const zones = computeSmartMoneyLevels(bars30m, bars1h, bars4h) || [];

    console.log("[SMZ] Zones generated:", zones.length);

    const payload = {
      ok: true,
      levels: zones,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("[SMZ] Saved zones to:", OUTFILE);
    console.log("[SMZ] Job complete.");
  } catch (err) {
    console.error("[SMZ] FAILED:", err);

    // Fail-safe: always keep a valid JSON contract
    try {
      const fallback = {
        ok: true,
        levels: [],
        note: "SMZ engine error, no levels generated this run",
      };
      fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
      fs.writeFileSync(OUTFILE, JSON.stringify(fallback, null, 2), "utf8");
      console.log("[SMZ] Wrote fallback empty smz-levels.json");
    } catch (inner) {
      console.error("[SMZ] Also failed to write fallback smz-levels.json:", inner);
    }

    process.exitCode = 1;
  }
}

// Allow: node services/core/jobs/updateSmzLevels.js
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
