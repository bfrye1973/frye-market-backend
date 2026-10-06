// services/core/logic/engine22/wave/adapters/buildFuturesWaveContext.js
// Engine 22G — Futures Wave Context Adapter
//
// Purpose:
// Normalize futures-specific inputs for Engine 22 wave/fib strategy.
//
// Important:
// This adapter does not make trade decisions.
// It only carries backend-normalized context forward into Engine 22.
//
// Engine 22 may use this context to classify wave opportunity lifecycle,
// but Engine 15ES and Engine 6 remain the final decision/permission gates.

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function normalizeSymbol(symbol) {
  const s = String(symbol || "ES").trim().toUpperCase();
  return s || "ES";
}

function tickSizeForFutures(symbol) {
  const s = normalizeSymbol(symbol);

  if (s === "ES" || s.startsWith("ES")) return 0.25;
  if (s === "MES" || s.startsWith("MES")) return 0.25;
  if (s === "NQ" || s.startsWith("NQ")) return 0.25;
  if (s === "MNQ" || s.startsWith("MNQ")) return 0.25;

  return 0.25;
}

function normalizeFuturesRegimeLayers({
  engine16 = null,
  regimeLayers = null,
  engine22Scalp = null,
} = {}) {
  const e16 = engine16?.regimeLayers || {};
  const provided = regimeLayers || {};
  const e22 = engine22Scalp?.regimeLayers || {};

  return {
    tenMinute:
      e16.trigger10m ||
      e16.tenMinute ||
      provided.trigger10m ||
      provided.tenMinute ||
      e22.trigger10m ||
      e22.tenMinute ||
      null,

    oneHour:
      e16.pullback1h ||
      e16.oneHour ||
      provided.pullback1h ||
      provided.oneHour ||
      e22.pullback1h ||
      e22.oneHour ||
      null,

    fourHour:
      e16.trend4h ||
      e16.fourHour ||
      provided.trend4h ||
      provided.fourHour ||
      e22.trend4h ||
      e22.fourHour ||
      null,

    eod:
      e16.regimeEod ||
      e16.eod ||
      provided.regimeEod ||
      provided.eod ||
      e22.regimeEod ||
      e22.eod ||
      null,
  };
}

function pickCurrentPrice({
  currentPrice = null,
  engine16 = null,
  regimeLayers = null,
  marketMeter = null,
} = {}) {
  return (
    toNum(currentPrice) ??
    toNum(engine16?.latestClose) ??
    toNum(engine16?.regimeLayers?.trigger10m?.close) ??
    toNum(engine16?.regimeLayers?.tenMinute?.close) ??
    toNum(engine16?.regimeLayers?.pullback1h?.close) ??
    toNum(engine16?.regimeLayers?.oneHour?.close) ??
    toNum(engine16?.regimeLayers?.trend4h?.close) ??
    toNum(engine16?.regimeLayers?.fourHour?.close) ??
    toNum(engine16?.regimeLayers?.regimeEod?.close) ??
    toNum(engine16?.regimeLayers?.eod?.close) ??
    toNum(regimeLayers?.tenMinute?.close) ??
    toNum(regimeLayers?.oneHour?.close) ??
    toNum(regimeLayers?.fourHour?.close) ??
    toNum(regimeLayers?.eod?.close) ??
    toNum(marketMeter?.price) ??
    toNum(marketMeter?.currentPrice) ??
    null
  );
}

export function buildFuturesWaveContext(input = {}) {
  const {
    symbol: rawSymbol = "ES",
    strategyId = "intraday_scalp@10m",
    tf = "10m",

    engine2State = null,
    engine15 = null,
    engine16 = null,

    // Existing tactical/context inputs.
    marketMeter = null,
    engine22Scalp = null,

    // Engine 22F pass-through context.
    // These are read-only supportive/diagnostic inputs.
    // They must not create trades, READY, ALLOW, or execution by themselves.
    engine25Context = null,
    marketRegime = null,
    marketMeterContext = null,
    engine5 = null,

    currentPrice = null,
    regimeLayers = null,
    reactionContext = null,
    volumeContext = null,
    breakoutContext = null,

    snapshotNow = null,
    currentTimeSec = null,
    barsByTf = {},
  } = input || {};

  const symbol = normalizeSymbol(rawSymbol);

  const normalizedRegimeLayers = normalizeFuturesRegimeLayers({
    engine16,
    regimeLayers,
    engine22Scalp,
  });

  const price = pickCurrentPrice({
    currentPrice,
    engine16,
    regimeLayers: normalizedRegimeLayers,
    marketMeter,
  });

  return {
    marketType: "FUTURES",
    symbol,
    strategyId,
    tf,
    tickSize: tickSizeForFutures(symbol),

    currentPrice: price,

    engine2State,
    engine15,
    engine16,

    regimeLayers: normalizedRegimeLayers,

    reactionContext,
    volumeContext,
    breakoutContext,

    sessionProfile: {
      type: "FUTURES_NEAR_24H",
      timezone: "America/Phoenix",
    },

    marketMeter,
    engine22Scalp,

    // Engine 22F read-only supportive context.
    engine25Context,
    marketRegime,
    marketMeterContext,
    engine5,

    snapshotNow,
    currentTimeSec,
    barsByTf,

    reasonCodes: [
      "FUTURES_WAVE_CONTEXT_BUILT",
      symbol === "ES" ? "ES_FUTURES_CONTEXT" : "GENERIC_FUTURES_CONTEXT",
      engine25Context ? "ENGINE25_CONTEXT_AVAILABLE" : "ENGINE25_CONTEXT_MISSING",
      marketRegime ? "MARKET_REGIME_CONTEXT_AVAILABLE" : "MARKET_REGIME_CONTEXT_MISSING",
    ],
  };
}

export default buildFuturesWaveContext;
