const { fetchOhlc } = require("../utils/ohlcHelper"); // use your existing helper

// --- CONFIG ---
const SYMBOLS = ["SPY", "QQQ", "DIA", "VIX"];
const TF = "30m";

// --- EMA helper ---
function computeEMA(values, length) {
  const k = 2 / (length + 1);
  let ema = values[0];

  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }

  return ema;
}

// --- Direction logic ---
function getDirection({ price, ema10, ema20, symbol }) {
  const isBull =
    price > ema10 &&
    price > ema20 &&
    ema10 > ema20;

  const isBear =
    price < ema10 &&
    price < ema20 &&
    ema10 < ema20;

  if (symbol === "VIX") {
    if (isBear) return "BEAR_CONFIRM"; // confirms bullish equities
    if (isBull) return "BULL_CONFIRM"; // confirms bearish equities
    return "NEUTRAL";
  }

  if (isBull) return "BULL";
  if (isBear) return "BEAR";
  return "NEUTRAL";
}

// --- MAIN ENGINE ---
async function computeEngine21Alignment({ tf = TF }) {
  const components = {};
  let bullishScore = 0;
  let bearishScore = 0;

  for (const symbol of SYMBOLS) {
    const candles = await fetchOhlc({ symbol, tf });

    if (!candles || candles.length < 25) {
      components[symbol] = "NO_DATA";
      continue;
    }

    const closes = candles.map(c => c.close);

    const price = closes[closes.length - 1];
    const ema10 = computeEMA(closes.slice(-10), 10);
    const ema20 = computeEMA(closes.slice(-20), 20);

    const direction = getDirection({ price, ema10, ema20, symbol });

    components[symbol] = direction;

    // --- SCORING ---
    if (symbol === "VIX") {
      if (direction === "BEAR_CONFIRM") bullishScore += 25;
      if (direction === "BULL_CONFIRM") bearishScore += 25;
    } else {
      if (direction === "BULL") bullishScore += 25;
      if (direction === "BEAR") bearishScore += 25;
    }
  }

  // --- FINAL STATE ---
  let alignmentState = "NO_ALIGNMENT";
  let alignmentScore = Math.max(bullishScore, bearishScore);
  let bullishAligned = false;
  let bearishAligned = false;

  if (bullishScore === 100) {
    alignmentState = "FULL_BULL_ALIGNMENT";
    bullishAligned = true;
  } else if (bearishScore === 100) {
    alignmentState = "FULL_BEAR_ALIGNMENT";
    bearishAligned = true;
  } else if (bullishScore >= 75 || bearishScore >= 75) {
    alignmentState = "PARTIAL_ALIGNMENT";
  } else if (bullishScore >= 50 && bearishScore >= 50) {
    alignmentState = "MIXED_ALIGNMENT";
  }

  return {
    ok: true,
    tf,
    symbols: SYMBOLS,
    alignmentState,
    alignmentScore,
    bullishAligned,
    bearishAligned,
    bullishScore,
    bearishScore,
    components,
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  computeEngine21Alignment
};
