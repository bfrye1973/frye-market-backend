// buildMomentumContext.js

const axios = require("axios");
const { computeSMI, detectCross } = require("./computeSMI");
const detectCompression = require("./detectCompression");

const cache = {};
const CACHE_TTL = 10000;

async function fetchBars(symbol, tf) {
  const res = await axios.get(
    `http://localhost:10000/api/v1/ohlc`,
    {
      params: {
        symbol,
        tf,
        limit: 120
      }
    }
  );

  if (!res.data || !res.data.bars) {
    throw new Error("OHLC fetch failed");
  }

  return res.data.bars;
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

async function buildMomentumContext(symbol = "SPY") {
  const cached = cache[symbol];

  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  try {
    const bars10m = await fetchBars(symbol, "10m");
    const bars1h = await fetchBars(symbol, "1h");

    const smi10 = computeSMI(bars10m);
    const smi1h = computeSMI(bars1h);

    const k10 = smi10.smi.at(-1);
    const d10 = smi10.signal.at(-1);

    const k1h = smi1h.smi.at(-1);
    const d1h = smi1h.signal.at(-1);

    const dir10 = buildDirection(k10, d10);
    const dir1h = buildDirection(k1h, d1h);

    const cross10 = detectCross(smi10.smi, smi10.signal);
    const cross1h = detectCross(smi1h.smi, smi1h.signal);

    const compression = detectCompression(
      smi10.smi,
      smi10.signal
    );

    let momentumState = "NORMAL";

    if (compression.active && cross10 !== "NONE") {
      momentumState = "EXPANDING";
    } else if (compression.active) {
      momentumState = "COILING";
    }

    const result = {
      ok: true,
      symbol,

      smi10m: {
        k: Number(k10.toFixed(2)),
        d: Number(d10.toFixed(2)),
        direction: dir10,
        cross: cross10
      },

      smi1h: {
        k: Number(k1h.toFixed(2)),
        d: Number(d1h.toFixed(2)),
        direction: dir1h,
        cross: cross1h
      },

      alignment: buildAlignment(dir10, dir1h),

      compression,

      momentumState
    };

    cache[symbol] = {
      time: Date.now(),
      data: result
    };

    return result;
  } catch (err) {
    return {
      ok: true,
      symbol,
      momentumState: "UNKNOWN"
    };
  }
}

module.exports = buildMomentumContext;
