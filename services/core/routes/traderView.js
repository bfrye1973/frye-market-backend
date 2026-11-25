// services/core/routes/traderView.js
// Trader View v1 — GET /api/v1/trader-view?symbol=ES
//
// DISPLAY ONLY. Reads the same prebuilt ES strategy snapshot that
// /api/v1/dashboard-snapshot serves, plus the ES Master market meter, and
// returns buildTraderView(...) (schema traderView.v1, ~10 KB).
// It never writes files, never creates permission, never executes, and never
// recomputes an engine. Engine 6 remains the only source of the verdict.
//
// - Non-ES symbols -> 410 (same rule as dashboard-snapshot)
// - Snapshot missing/invalid -> 503 with the reason
// - Meter failure -> still 200, with freshness.meterAvailable=false
// - Meter cached 15s (it self-calls OHLC for 5 timeframes; don't hammer it)

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildTraderView, updateEngine3DirectionHistory, directionHistoryView } from "../logic/traderView/buildTraderView.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_SNAPSHOT_FILE = path.resolve(__dirname, "../data/strategy-snapshot-es.json");
export const METER_CACHE_MS = 15_000;
const METER_TIMEOUT_MS = 12_000;

function getSelfBaseUrl() {
  const port = process.env.PORT || 10000;
  return `http://127.0.0.1:${port}`;
}

/** Default meter source: the existing ES Master route (self-call, same pattern as futuresMarketMeter.js). */
export async function fetchMeterFromSelf(symbol = "ES") {
  const url = `${getSelfBaseUrl()}/api/v1/futures/market-meter?symbol=${encodeURIComponent(symbol)}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), METER_TIMEOUT_MS);
  try {
    const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`market-meter ${r.status}`);
    const json = await r.json();
    if (!json || json.ok === false || !json.master) throw new Error("market-meter returned no master");
    return json;
  } finally {
    clearTimeout(t);
  }
}

export function readSnapshotFile(file) {
  if (!fs.existsSync(file)) return { ok: false, error: "SNAPSHOT_NOT_READY" };
  try {
    return { ok: true, snapshot: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (err) {
    return { ok: false, error: "SNAPSHOT_INVALID_JSON", message: String(err?.message || err) };
  }
}

/**
 * Factory so tests can inject a fixture snapshot file, a fake meter and a clock.
 * Production uses the defaults via the default export.
 */
export function createTraderViewRouter({
  snapshotFile = DEFAULT_SNAPSHOT_FILE,
  getMeter = fetchMeterFromSelf,
  now = () => Date.now(),
  meterCacheMs = METER_CACHE_MS,
} = {}) {
  const router = express.Router();
  let meterCache = { at: 0, value: null, inFlight: null };
  // Engine 3 direction changes seen by this process (display only, in memory).
  let e3History = null;

  async function cachedMeter() {
    const t = now();
    if (meterCache.value && t - meterCache.at < meterCacheMs) return meterCache.value;
    if (meterCache.inFlight) return meterCache.inFlight;
    meterCache.inFlight = (async () => {
      try {
        const value = await getMeter("ES");
        meterCache = { at: now(), value, inFlight: null };
        return value;
      } catch (err) {
        meterCache.inFlight = null;
        console.warn("[trader-view] meter unavailable:", String(err?.message || err));
        return null;
      }
    })();
    return meterCache.inFlight;
  }

  router.get("/trader-view", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const symbol = String(req.query.symbol || "ES").trim().toUpperCase() || "ES";
    if (symbol !== "ES") {
      return res.status(410).json({ ok: false, error: "SPY_AND_OTHER_SYMBOL_SNAPSHOTS_RETIRED", symbol });
    }

    try {
      const read = readSnapshotFile(snapshotFile);
      if (!read.ok) return res.status(503).json({ ok: false, symbol, ...read });

      const meter = await cachedMeter();
      e3History = updateEngine3DirectionHistory(e3History, read.snapshot, { startedAt: new Date(now()).toISOString() });
      const view = buildTraderView({ snapshot: read.snapshot, meter, nowMs: now(), reactionHistory: directionHistoryView(e3History) });
      return res.json(view);
    } catch (err) {
      console.error("[/api/v1/trader-view] error:", err?.stack || err);
      return res.status(500).json({ ok: false, error: "TRADER_VIEW_FAILED", detail: String(err?.message || err) });
    }
  });

  return router;
}

export default createTraderViewRouter();
