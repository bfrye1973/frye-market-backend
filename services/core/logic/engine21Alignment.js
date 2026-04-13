// services/core/logic/engine21Alignment.js
// Engine 21 — Cross-Index Alignment (ESM)

import { fetchOhlc } from "../utils/ohlcHelper.js";

// --- CONFIG ---
const SYMBOLS = ["SPY", "QQQ", "DIA", "VIX"];
const DEFAULT_TF = "30m";
const MIN_BARS_REQUIRED = 25;
const SCORE_PER_COMPONENT = 25;

// --- HELPERS ---
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractClose(bar) {
  if (!bar || typeof bar !== "object") return null;

  return (
    toNumber(bar.c) ??
    toNumber(bar.close) ??
    toNumber(bar.C) ??
    null
  );
}

function computeEMA(values, length) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!Number.isInteger(length) || length <= 0) return null;
  if (values.length < length) return null;

  const k = 2 / (length + 1);

  let ema = values[0];
  for (let i = 1; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
  }

  return ema;
}

function getDirection({ price, ema10, ema20, symbol }) {
  const hasValidInputs =
    Number.isFinite(price) &&
    Number.isFinite(ema10) &&
    Number.isFinite(ema20);

  if (!hasValidInputs) return "NO_DATA";

  const isBull = price > ema10 && price > ema20 && ema10 > ema20;
  const isBear = price < ema10 && price < ema20 && ema10 < ema20;

  if (symbol === "VIX") {
    if (isBear) return "BEAR_CONFIRM";
    if (isBull) return "BULL_CONFIRM";
    return "NEUTRAL";
  }

  if (isBull) return "BULL";
  if (isBear) return "BEAR";
  return "NEUTRAL";
}

function buildComponentPayload({
  symbol,
  price,
  ema10,
  ema20,
  direction,
  barCount,
}) {
  return {
    symbol,
    price,
    ema10,
    ema20,
    direction,
    barCount,
  };
}

// --- MAIN ENGINE ---
export async function computeEngine21Alignment({ tf = DEFAULT_TF } = {}) {
  const components = {};
  let bullishScore = 0;
  let bearishScore = 0;

  for (const symbol of SYMBOLS) {
    try {
      const candles = await fetchOhlc({ symbol, tf });

      if (!Array.isArray(candles) || candles.length < MIN_BARS_REQUIRED) {
        components[symbol] = buildComponentPayload({
          symbol,
          price: null,
          ema10: null,
          ema20: null,
          direction: "NO_DATA",
          barCount: Array.isArray(candles) ? candles.length : 0,
        });
        continue;
      }

      const closes = candles
        .map(extractClose)
        .filter((v) => Number.isFinite(v));

      if (closes.length < MIN_BARS_REQUIRED) {
        components[symbol] = buildComponentPayload({
          symbol,
          price: null,
          ema10: null,
          ema20: null,
          direction: "NO_DATA",
          barCount: closes.length,
        });
        continue;
      }

      const price = closes[closes.length - 1];
      const ema10 = computeEMA(closes.slice(-10), 10);
      const ema20 = computeEMA(closes.slice(-20), 20);

      const direction = getDirection({
        price,
        ema10,
        ema20,
        symbol,
      });

      components[symbol] = buildComponentPayload({
        symbol,
        price,
        ema10,
        ema20,
        direction,
        barCount: closes.length,
      });

      if (symbol === "VIX") {
        if (direction === "BEAR_CONFIRM") bullishScore += SCORE_PER_COMPONENT;
        if (direction === "BULL_CONFIRM") bearishScore += SCORE_PER_COMPONENT;
      } else {
        if (direction === "BULL") bullishScore += SCORE_PER_COMPONENT;
        if (direction === "BEAR") bearishScore += SCORE_PER_COMPONENT;
      }
    } catch (err) {
      components[symbol] = {
        symbol,
        price: null,
        ema10: null,
        ema20: null,
        direction: "ERROR",
        error: String(err?.message || err),
        barCount: 0,
      };
    }
  }

  let alignmentState = "NO_ALIGNMENT";
  let bullishAligned = false;
  let bearishAligned = false;

  const alignmentScore = Math.max(bullishScore, bearishScore);

  if (bullishScore === 100) {
    alignmentState = "FULL_BULL_ALIGNMENT";
    bullishAligned = true;
  } else if (bearishScore === 100) {
    alignmentState = "FULL_BEAR_ALIGNMENT";
    bearishAligned = true;
  } else if (bullishScore >= 75 || bearishScore >= 75) {
    alignmentState = "PARTIAL_ALIGNMENT";
  } else if (bullishScore > 0 && bearishScore > 0) {
    alignmentState = "MIXED_ALIGNMENT";
  }

  return {
    ok: true,
    tf,
    symbols: [...SYMBOLS],
    alignmentState,
    alignmentScore,
    bullishAligned,
    bearishAligned,
    bullishScore,
    bearishScore,
    components,
    updatedAt: new Date().toISOString(),
  };
}
