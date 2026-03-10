// services/core/logic/engine45/buildMomentumContext.js

import { computeSMI, detectCross } from "./computeSMI.js";
import { detectCompression } from "./detectCompression.js";

const CACHE_TTL_MS = 10_000;
const cache = new Map();

const DEFAULT_SETTINGS = {
  lengthK: 12,
  lengthD: 7,
  lengthEMA: 5,
};

function getBaseUrl() {
  const port = Number(process.env.PORT) || 8080;
  return process.env.CORE_INTERNAL_BASE_URL || `http://127.0.0.1:${port}`;
}

async function fetchBars(symbol, tf) {
  const baseUrl = getBaseUrl();
  const url = new URL("/api/v1/ohlc", baseUrl);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("tf", tf);
  url.searchParams.set("limit", "120");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`OHLC fetch failed (${tf}) status=${res.status}`);
  }

  const data = await res.json();
  if (!data?.ok || !Array.isArray(data?.bars)) {
    throw new Error(`OHLC payload invalid (${tf})`);
  }

  return data.bars;
}

function buildDirection(k, d) {
  if (k > d) return "UP";
  if (k < d) return "DOWN";
  return "FLAT";
}

function buildAlignment(dir10, dir1h) {
  if (dir10 === "UP" && dir1h === "UP") return "BULLISH";
  if (dir10 === "DOWN" && dir1h === "DOWN") return "BEARISH";
  return "MIXED";
}

function round2(v) {
  return Number((Number(v) || 0).toFixed(2));
}

function unknownPayload(symbol, detail = null) {
  return {
    ok: true,
    symbol,
    smi10m: {
      k: null,
      d: null,
      direction: "UNKNOWN",
      cross: "NONE",
    },
    smi1h: {
      k: null,
      d: null,
      direction: "UNKNOWN",
      cross: "NONE",
    },
    alignment: "MIXED",
    compression: {
      active: false,
      bars: 0,
      width: 0,
    },
    momentumState: "UNKNOWN",
    ...(detail ? { detail } : {}),
  };
}

export async function buildMomentumContext(symbol = "SPY") {
  const sym = String(symbol || "SPY").toUpperCase().trim();
  const now = Date.now();

  const cached = cache.get(sym);
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const [bars10m, bars1h] = await Promise.all([
      fetchBars(sym, "10m"),
      fetchBars(sym, "1h"),
    ]);

    const smi10 = computeSMI(
      bars10m,
      DEFAULT_SETTINGS.lengthK,
      DEFAULT_SETTINGS.lengthD,
      DEFAULT_SETTINGS.lengthEMA
    );
    const smi1h = computeSMI(
      bars1h,
      DEFAULT_SETTINGS.lengthK,
      DEFAULT_SETTINGS.lengthD,
      DEFAULT_SETTINGS.lengthEMA
    );

    if (!smi10?.smi?.length || !smi10?.signal?.length || !smi1h?.smi?.length || !smi1h?.signal?.length) {
      const fallback = unknownPayload(sym, "insufficient_smi_data");
      cache.set(sym, { ts: now, data: fallback });
      return fallback;
    }

    const k10 = smi10.smi[smi10.smi.length - 1];
    const d10 = smi10.signal[smi10.signal.length - 1];
    const k1h = smi1h.smi[smi1h.smi.length - 1];
    const d1h = smi1h.signal[smi1h.signal.length - 1];

    const dir10 = buildDirection(k10, d10);
    const dir1h = buildDirection(k1h, d1h);

    const cross10 = detectCross(smi10.smi, smi10.signal, 3);
    const cross1h = detectCross(smi1h.smi, smi1h.signal, 3);

    const compression = detectCompression(smi10.smi, smi10.signal, {
      lookback: 10,
      threshold: 5,
      minBars: 4,
    });

    let momentumState = "NORMAL";
    if (compression.active && cross10 !== "NONE") {
      momentumState = "EXPANDING";
    } else if (compression.active) {
      momentumState = "COILING";
    }

    const result = {
      ok: true,
      symbol: sym,
      smi10m: {
        k: round2(k10),
        d: round2(d10),
        direction: dir10,
        cross: cross10,
      },
      smi1h: {
        k: round2(k1h),
        d: round2(d1h),
        direction: dir1h,
        cross: cross1h,
      },
      alignment: buildAlignment(dir10, dir1h),
      compression,
      momentumState,
    };

    cache.set(sym, { ts: now, data: result });
    return result;
  } catch (err) {
    const fallback = unknownPayload(sym, String(err?.message || err));
    cache.set(sym, { ts: now, data: fallback });
    return fallback;
  }
}
