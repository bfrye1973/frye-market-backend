// services/core/jobs/updateSmzLevels.js
// Institutional Smart Money Zones Job — FIXED (uses synthetic 4H from 1H)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js";
import { getBarsFromPolygon } from "../../api/providers/polygonBars.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-levels.json");

// Fetch multi-timeframe bars for SPY
// IMPORTANT: We DO NOT call Polygon "4h" anymore (entitlement/feed mismatch).
// We build 4H bars locally by aggregating the 1H bars.
async function loadBarsMultiTF(symbol = "SPY") {
  const [bars30mRaw, bars1hRaw] = await Promise.all([
    getBarsFromPolygon(symbol, "30m", 120), // ~90–120 days
    getBarsFromPolygon(symbol, "1h", 150),  // ~120–150 days
  ]);

  console.log("[SMZ] 30m bars:", bars30mRaw?.length ?? 0);
  console.log("[SMZ] 1h  bars:", bars1hRaw?.length ?? 0);

  const bars30m = normalizeBars(bars30mRaw);
  const bars1h  = normalizeBars(bars1hRaw);
  const bars4h  = aggregateTo4h(bars1h);

  console.log("[SMZ] Normalized bars — 30m:", bars30m.length, "1h:", bars1h.length, "4h(synth):", bars4h.length);

  // quick sanity
  console.log("[SMZ] maxHigh 30m:", maxHigh(bars30m), "1h:", maxHigh(bars1h), "4h(synth):", maxHigh(bars4h));

  return { bars30m, bars1h, bars4h };
}

// Normalize Polygon aggregate bars to { time, open, high, low, close, volume }
// Output time is kept as the numeric value we receive; engine can handle ms/sec.
// (We only force seconds inside aggregateTo4h where we need 4H blocks.)
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
        time: typeof t === "number" ? t : 0,
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

// Build synthetic 4H bars from 1H bars (avoids Polygon 4H entitlement/feed mismatch)
function aggregateTo4h(bars1h) {
  if (!Array.isArray(bars1h) || bars1h.length < 8) return [];

  const toSec = (t) => (t > 1e12 ? Math.floor(t / 1000) : t); // ms -> sec

  const out = [];
  let cur = null;

  for (const b of bars1h) {
    const tSec = toSec(b.time);
    const block = Math.floor(tSec / (4 * 3600)) * (4 * 3600); // 4H block start (sec)

    if (!cur || cur.time !== block) {
      if (cur) out.push(cur);
      cur = {
        time: block, // seconds
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
  for (const b of bars) {
    if (Number.isFinite(b.high)) m = Math.max(m, b.high);
  }
  return m === -Infinity ? null : Number(m.toFixed(2));
}

async function main() {
  try {
    console.log("[SMZ] Fetching multi-TF bars…");
    const { bars30m, bars1h, bars4h } = await loadBarsMultiTF("SPY");

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
