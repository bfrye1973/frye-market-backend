// src/services/core/jobs/updateSmzLevels.js
// Institutional Smart Money Zones Job — writes ONLY smz-levels.json (yellow)
//
// Efficient lookback plan (LOCKED):
// - 1h = 365 days
// - 30m = 180 days
// - 4h is synthesized from 1h (so effectively 365 days)
//
// Uses DEEP provider (jobs only), chart provider remains untouched.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { computeSmartMoneyLevels } from "../logic/smzEngine.js";
import { getBarsFromPolygonDeep } from "../../../api/providers/polygonBarsDeep.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUTFILE = path.resolve(__dirname, "../data/smz-levels.json");

// ✅ Lookback days (LOCKED)
const DAYS_30M = 180;
const DAYS_1H = 365;

// Normalize Polygon aggregate bars to { time(sec), open, high, low, close, volume }
function normalizeBars(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((b) => {
      const tms = Number(b.t ?? b.time ?? 0); // Polygon often ms
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
    const block = Math.floor(b.time / (4 * 3600)) * (4 * 3600);
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
      cur.volume += b.volume ?? 0;
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

function spanInfo(label, bars) {
  if (!Array.isArray(bars) || bars.length === 0) {
    console.log(`[SMZ] COVERAGE ${label}: none`);
    return;
  }
  const first = bars[0].time;
  const last = bars[bars.length - 1].time;
  const days = (last - first) / 86400;

  console.log(
    `[SMZ] COVERAGE ${label}:`,
    "bars =", bars.length,
    "| from =", new Date(first * 1000).toISOString(),
    "| to =", new Date(last * 1000).toISOString(),
    "| spanDays =", days.toFixed(1)
  );
}

async function main() {
  try {
    console.log("[SMZ] Fetching multi-TF bars (DEEP)…");

    const [bars30mRaw, bars1hRaw] = await Promise.all([
      getBarsFromPolygonDeep("SPY", "30m", DAYS_30M),
      getBarsFromPolygonDeep("SPY", "1h", DAYS_1H),
    ]);

    const bars30m = normalizeBars(bars30mRaw);
    const bars1h = normalizeBars(bars1hRaw);
    const bars4h = aggregateTo4h(bars1h);

    console.log("[SMZ] 30m bars:", bars30m.length);
    console.log("[SMZ] 1h  bars:", bars1h.length);

    spanInfo("30m", bars30m);
    spanInfo("1h", bars1h);
    spanInfo("4h(synth)", bars4h);

    console.log(
      "[SMZ] maxHigh 30m:",
      maxHigh(bars30m),
      "1h:",
      maxHigh(bars1h),
      "4h(synth):",
      maxHigh(bars4h)
    );

    console.log("[SMZ] Running Institutional engine…");
    const zones = computeSmartMoneyLevels(bars30m, bars1h, bars4h) || [];
    console.log("[SMZ] Institutional zones generated:", zones.length);

    const payload = {
      ok: true,
      meta: {
        generated_at_utc: new Date().toISOString(),
        lookback_days: { "30m": DAYS_30M, "1h": DAYS_1H, "4h(synth)": DAYS_1H },
      },
      levels: zones,
    };

    fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
    fs.writeFileSync(OUTFILE, JSON.stringify(payload, null, 2), "utf8");

    console.log("[SMZ] Saved institutional zones to:", OUTFILE);
    console.log("[SMZ] Job complete.");
  } catch (err) {
    console.error("[SMZ] FAILED:", err);

    try {
      const fallback = {
        ok: true,
        levels: [],
        note: "SMZ institutional job error, no levels generated this run",
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
