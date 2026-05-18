// services/core/logic/engine22/wave/adapters/buildStockWaveContext.js
// Engine 22G stock/ETF adapter
// Normalizes SPY / stock / ETF inputs into one clean context shape.

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
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
    toNum(regimeLayers?.tenMinute?.close) ??
    toNum(regimeLayers?.trigger10m?.close) ??
    toNum(marketMeter?.layers?.tenMinute?.close) ??
    toNum(marketMeter?.layers?.tenMinuteEma10?.close) ??
    null
  );
}

function normalizeRegimeLayers({ engine16 = null, engine22Scalp = null, regimeLayers = null } = {}) {
  const fromProvided = regimeLayers || {};
  const fromEngine22 = engine22Scalp?.regimeLayers || {};
  const fromEngine16 = engine16?.regimeLayers || {};

  return {
    tenMinute:
      fromProvided.tenMinute ||
      fromProvided.trigger10m ||
      fromEngine22.tenMinute ||
      fromEngine22.trigger10m ||
      fromEngine16.tenMinute ||
      fromEngine16.trigger10m ||
      null,

    oneHour:
      fromProvided.oneHour ||
      fromProvided.pullback1h ||
      fromEngine22.oneHour ||
      fromEngine22.pullback1h ||
      fromEngine16.oneHour ||
      fromEngine16.pullback1h ||
      null,

    fourHour:
      fromProvided.fourHour ||
      fromProvided.trend4h ||
      fromEngine22.fourHour ||
      fromEngine22.trend4h ||
      fromEngine16.fourHour ||
      fromEngine16.trend4h ||
      null,

    eod:
      fromProvided.eod ||
      fromProvided.regimeEod ||
      fromEngine22.eod ||
      fromEngine22.regimeEod ||
      fromEngine16.eod ||
      fromEngine16.regimeEod ||
      null,
  };
}

export function buildStockWaveContext({
  symbol = "SPY",
  strategyId = "intraday_scalp@10m",
  tf = "10m",

  engine2State = null,
  engine15 = null,
  engine16 = null,
  marketMeter = null,
  engine22Scalp = null,

  currentPrice = null,
  regimeLayers = null,
  reactionContext = null,
  volumeContext = null,
  breakoutContext = null,

  snapshotNow = null,
  currentTimeSec = null,
  barsByTf = {},
} = {}) {
  const normalizedRegimeLayers = normalizeRegimeLayers({
    engine16,
    engine22Scalp,
    regimeLayers,
  });

  const price = pickCurrentPrice({
    currentPrice,
    engine16,
    regimeLayers: normalizedRegimeLayers,
    marketMeter,
  });

  return {
    marketType: "STOCK",
    symbol,
    strategyId,
    tf,
    tickSize: 0.01,

    currentPrice: price,
    engine2State,
    engine15,
    engine16,

    regimeLayers: normalizedRegimeLayers,
    reactionContext,
    volumeContext,
    breakoutContext,

    sessionProfile: {
      type: "STOCK_RTH_EXTENDED",
      timezone: "America/Phoenix",
    },

    marketMeter,
    engine22Scalp,
    snapshotNow,
    currentTimeSec,
    barsByTf,

    reasonCodes: ["STOCK_WAVE_CONTEXT_BUILT"],
  };
}

export default buildStockWaveContext;
