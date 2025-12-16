// src/services/core/jobs/updateSmzLevels.js
// Institutional Smart Money Zones Job — FIXED (correct polygon import path)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js";

// ✅ CORRECT PATH from: src/services/core/jobs/*  ->  src/api/providers/*
import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-levels.json");

// Fetch multi-timeframe bars for SPY
async function loadBarsMultiTF(symbol = "SPY") {
  const [bars30mRaw, bars1hRaw, bars4hRaw] = await Promise.all([
    getBarsFromPolygon(symbol, "30m", 120),
    getBarsFromPolygon(symbol, "1h", 150),
    getBarsFromPolygon(symbol, "4h", 30), // last ~30 days is enough
  ]);

  console.log("[SMZ] 30m bars:", bars30mRaw?.length ?? 0);
  console.log("[SMZ] 1h  bars:", bars1hRaw?.length ?? 0);
  console.log("[SMZ] 4h  bars:", bars4hRaw?.length ?? 0);

  const bars30m = normalizeBars(bars30mRaw);
  const bars1h = normalizeBars(bars1hRaw);
  const bars4h = normalizeBars(bars4hRaw);

  console.log(
    "[SMZ] Normalized bars — 30m:",
    bars30m.length,
    "1h:",
    bars1h.length,
    "4h:",
    bars4h.length
  );

  console.log("[SMZ] maxHigh 30m:", maxHigh(bars30m), "1h:", maxHigh(bars1h), "4h:", maxHigh(bars4h));
  console.log("[SMZ] last close 30m:", bars30m.at(-1)?.close, "1h:", bars1h.at(-1)?.close, "4h:", bars4h.at(-1)?.close);

  return { bars30m, bars1h, bars4h };
}

// Normalize Polygon aggregate bars to { time, open, high, low, close, volume }
// Output time is seconds (ms -> sec), stable for all engines.
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
        const t = b.time > 1e12 ? Math.floor(b.time / 1000) : b.time;
        return { ...b, time: t };
      }

      const tms = Number(b.t ?? b.time ?? 0); // Polygon: ms
      const t = tms > 1e12 ? Math.floor(tms / 1000) : tms; // -> sec

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

function maxHigh(bars) {
  if (!Array.isArray(bars) || !bars.length) return null;
  let m = -Infinity;
  for (const b of bars) if (Number.isFinite(b.high)) m = Math.max(m, b.high);
  return m === -Infinity ? null : Number(m.toFixed(2));
}

async function main() {
  try {
    console.log("[SMZ] Fetching multi-TF bars…");
    const { bars30m, bars1h, bars4h } = await loadBarsMultiTF("SPY");

    console.log("[SMZ] Running Smart Money engine…");
    const zones = computeSmartMoneyLevels(bars30m, bars1h, bars4h) || [];

    console.log("[SMZ] Zones generated:", zones.length);

    const payload = { ok: true, levels: zones };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("[SMZ] Saved zones to:", OUTFILE);
    console.log("[SMZ] Job complete.");
  } catch (err) {
    console.error("[SMZ] FAILED:", err);

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

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
