// src/services/core/jobs/updateSmzLevels.js
// Institutional Smart Money Zones Job — ETH + Synthetic 4H (from 1H)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js";
import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-levels.json");

// Fetch multi-timeframe bars for SPY
// ETH is already included in Polygon aggs. We ensure 4H also reflects ETH by building it from 1H.
async function loadBarsMultiTF(symbol = "SPY") {
  const [bars30mRaw, bars1hRaw] = await Promise.all([
    getBarsFromPolygon(symbol, "30m", 120),
    getBarsFromPolygon(symbol, "1h", 150),
  ]);

  console.log("[SMZ] 30m bars:", bars30mRaw?.length ?? 0);
  console.log("[SMZ] 1h  bars:", bars1hRaw?.length ?? 0);

  const bars30m = normalizeBars(bars30mRaw);
  const bars1h = normalizeBars(bars1hRaw);

  // ✅ Synthetic 4H from 1H (ETH-consistent)
  const bars4h = aggregateTo4h(bars1h);

  console.log(
    "[SMZ] Normalized bars — 30m:",
    bars30m.length,
    "1h:",
    bars1h.length,
    "4h(synth):",
    bars4h.length
  );

  console.log(
    "[SMZ] maxHigh 30m:",
    maxHigh(bars30m),
    "1h:",
    maxHigh(bars1h),
    "4h(synth):",
    maxHigh(bars4h)
  );

  console.log(
    "[SMZ] last close 30m:",
    bars30m.at(-1)?.close,
    "1h:",
    bars1h.at(-1)?.close,
    "4h(synth):",
    bars4h.at(-1)?.close
  );

  return { bars30m, bars1h, bars4h };
}

// Normalize Polygon aggregate bars to { time(sec), open, high, low, close, volume }
function normalizeBars(raw) {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((b) => {
      // already normalized
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

// Build synthetic 4H bars from 1H bars
function aggregateTo4h(bars1h) {
  if (!Array.isArray(bars1h) || bars1h.length < 8) return [];

  const out = [];
  let cur = null;

  for (const b of bars1h) {
    const block = Math.floor(b.time / (4 * 3600)) * (4 * 3600); // 4h start (sec)

    if (!cur || cur.time !== block) {
      if (cur) out.push(cur);
      cur = {
        time: block,
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
