// services/core/logic/engine45/buildMomentumContext.js

import { computeSMI, detectCross } from "./computeSMI.js";
import { detectCompression } from "./detectCompression.js";
import detectCompressionRelease from "./detectCompressionRelease.js";

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

  url.searchParams.set("symbol", String(symbol || "SPY").toUpperCase().trim());
  url.searchParams.set("timeframe", String(tf || "10m").trim());
  url.searchParams.set("limit", "120");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      detail = "";
    }

    throw new Error(
      `OHLC fetch failed (${tf}) status=${res.status}${detail ? ` detail=${detail.slice(0, 300)}` : ""}`
    );
  }

  const data = await res.json();

  console.log(
    `[engine45] OHLC ${tf} payload:`,
    JSON.stringify(data).slice(0, 500)
  );

  let bars = null;

  if (Array.isArray(data)) {
    bars = data;
  } else if (Array.isArray(data?.bars)) {
    bars = data.bars;
  } else if (Array.isArray(data?.data?.bars)) {
    bars = data.data.bars;
  } else if (Array.isArray(data?.rows)) {
    bars = data.rows;
  }

  if (!Array.isArray(bars)) {
    throw new Error(
      `OHLC payload invalid (${tf}) keys=${Object.keys(data || {}).join(",")}`
    );
  }

  const normalized = bars
    .map((b) => {
      const time = Number(b?.time);
      const open = Number(b?.open);
      const high = Number(b?.high);
      const low = Number(b?.low);
      const close = Number(b?.close);
      const volume = Number(b?.volume ?? 0);

      if (
        !Number.isFinite(time) ||
        !Number.isFinite(open) ||
        !Number.isFinite(high) ||
        !Number.isFinite(low) ||
        !Number.isFinite(close)
      ) {
        return null;
      }

      return {
        time,
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      };
    })
    .filter(Boolean);

  if (!normalized.length) {
    throw new Error(`OHLC payload empty/invalid after normalize (${tf})`);
  }

  return normalized;
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

function buildSlopeBlock(release) {
  return {
    smi10m: round2(release?.slope?.smi ?? 0),
    signal10m: round2(release?.slope?.signal ?? 0),
    expanding: release?.slope?.expanding === true,
    widthNow: round2(release?.slope?.widthNow ?? 0),
    widthPrev: round2(release?.slope?.widthPrev ?? 0),
  };
}

function buildCompressionSignalBlock(release) {
  return {
    state: String(release?.state || "NONE").toUpperCase(),
    quality: String(release?.quality || "NONE").toUpperCase(),
    tightness: Number.isFinite(Number(release?.tightness))
      ? Number(release.tightness)
      : 0,
    releaseBarsAgo:
      release?.releaseBarsAgo == null ? null : Number(release.releaseBarsAgo),
    early: release?.early === true,
  };
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
    compressionSignal: {
      state: "NONE",
      quality: "NONE",
      tightness: 0,
      releaseBarsAgo: null,
      early: false,
    },
    slope: {
      smi10m: 0,
      signal10m: 0,
      expanding: false,
      widthNow: 0,
      widthPrev: 0,
    },
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

    if (
      !smi10?.smi?.length ||
      !smi10?.signal?.length ||
      !smi1h?.smi?.length ||
      !smi1h?.signal?.length
    ) {
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

    const release = detectCompressionRelease(
      smi10.smi,
      smi10.signal,
      compression,
      {
        lookback: 10,
        crossWindow: 3,
      }
    );

    let momentumState = "NORMAL";

    if (compression.active && cross10 !== "NONE") {
      momentumState = "EXPANDING";
    } else if (compression.active) {
      momentumState = "COILING";
    }

    // Phase 2 override with better release-state awareness
    if (
      release?.state === "RELEASING_UP" ||
      release?.state === "RELEASING_DOWN"
    ) {
      momentumState = "EXPANDING";
    } else if (release?.state === "COILING") {
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

      compression: {
        active: compression.active === true,
        bars: Number.isFinite(Number(compression?.bars))
          ? Number(compression.bars)
          : 0,
        width: round2(compression?.width ?? 0),
      },

      momentumState,

      compressionSignal: buildCompressionSignalBlock(release),

      slope: buildSlopeBlock(release),
    };

    cache.set(sym, { ts: now, data: result });
    return result;
  } catch (err) {
    const fallback = unknownPayload(sym, String(err?.message || err));
    cache.set(sym, { ts: now, data: fallback });
    return fallback;
  }
}

export default buildMomentumContext;
