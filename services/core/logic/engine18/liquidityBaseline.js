// Engine 18 — Liquidity Intelligence Engine (research-only, deterministic baseline).
// No orders, external feeds, chart mutations, or unapproved price transformations.
export const ENGINE18_SCHEMA = "engine18.liquidityBaseline.v1";
const TICK = 0.25;
function validBar(b) {
  return b && Number.isFinite(b.time) &&
    ["open", "high", "low", "close"].every(k => Number.isFinite(b[k])) &&
    b.high >= Math.max(b.open, b.close, b.low) &&
    b.low <= Math.min(b.open, b.close, b.high) &&
    (!("volume" in b) || (Number.isFinite(b.volume) && b.volume >= 0));
}
function toTick(price) { return Math.round(price / TICK) * TICK; }
function idFor(side, kind, sourceTime, price) {
  return [side, kind, sourceTime, price.toFixed(2)].join(":");
}
function captureLevel(map, side, kind, sourceTime, price) {
  const rounded = toTick(price);
  const id = idFor(side, kind, sourceTime, rounded);
  map.set(id, { id, side, kind, sourceTime, price: rounded, evidence: "OHLCV_INFERRED", confirmedRestingLiquidity: false });
}
/**
 * Evaluates only candles supplied as-of the last candle in the array. No future data.
 * High/low sweeps use the PREVIOUS lookback bars; no lookahead pivot labeling.
 * "Raids" are candidate OHLC sweeps, not evidence of hidden stops being executed.
 */
export function analyzeEngine18Candles({ bars, symbol = "ES", contractSymbol, lookback = 20, equalToleranceTicks = 2 } = {}) {
  if (symbol !== "ES") throw new Error("ENGINE18_ES_ONLY");
  if (!Array.isArray(bars) || !bars.length) throw new Error("ENGINE18_BARS_REQUIRED");
  if (!Number.isInteger(lookback) || lookback < 3 || lookback > 500) throw new Error("ENGINE18_INVALID_LOOKBACK");
  if (!Number.isInteger(equalToleranceTicks) || equalToleranceTicks < 0 || equalToleranceTicks > 20) throw new Error("ENGINE18_INVALID_EQUAL_TOLERANCE");
  for (let i = 0; i < bars.length; i++) {
    if (!validBar(bars[i]) || (i > 0 && bars[i].time <= bars[i - 1].time)) throw new Error("ENGINE18_INVALID_OR_UNSORTED_BARS");
  }
  const levels = new Map();
  const events = [];
  for (let i = lookback; i < bars.length; i++) {
    // Levels in a live snapshot must represent the latest as-of window, not obsolete past windows.
    levels.clear();
    const prior = bars.slice(i - lookback, i);
    const now = bars[i];
    const highest = prior.reduce((best, b) => b.high > best.high ? b : best, prior[0]);
    const lowest = prior.reduce((best, b) => b.low < best.low ? b : best, prior[0]);
    captureLevel(levels, "BUY_SIDE", "PRIOR_WINDOW_HIGH", highest.time, highest.high);
    captureLevel(levels, "SELL_SIDE", "PRIOR_WINDOW_LOW", lowest.time, lowest.low);
    const atHigh = prior.filter(b => Math.abs(b.high - highest.high) <= equalToleranceTicks * TICK).length;
    const atLow = prior.filter(b => Math.abs(b.low - lowest.low) <= equalToleranceTicks * TICK).length;
    if (atHigh >= 2) captureLevel(levels, "BUY_SIDE", "EQUAL_HIGHS_CANDIDATE", highest.time, highest.high);
    if (atLow >= 2) captureLevel(levels, "SELL_SIDE", "EQUAL_LOWS_CANDIDATE", lowest.time, lowest.low);
    const highSweep = now.high > highest.high && now.close < highest.high;
    const lowSweep = now.low < lowest.low && now.close > lowest.low;
    const highBreak = now.close > highest.high;
    const lowBreak = now.close < lowest.low;
    if (highSweep) events.push({ time: now.time, type: "BUY_SIDE_SWEEP_CANDIDATE", level: toTick(highest.high), direction: "DOWN_REJECTION", evidence: "OHLCV_ONLY" });
    if (lowSweep) events.push({ time: now.time, type: "SELL_SIDE_SWEEP_CANDIDATE", level: toTick(lowest.low), direction: "UP_REJECTION", evidence: "OHLCV_ONLY" });
    if (highBreak) events.push({ time: now.time, type: "BUY_SIDE_BREAKOUT_CANDIDATE", level: toTick(highest.high), direction: "UP_CONTINUATION_UNCONFIRMED", evidence: "OHLCV_ONLY" });
    if (lowBreak) events.push({ time: now.time, type: "SELL_SIDE_BREAKDOWN_CANDIDATE", level: toTick(lowest.low), direction: "DOWN_CONTINUATION_UNCONFIRMED", evidence: "OHLCV_ONLY" });
  }
  const latestClose = bars.at(-1).close;
  const latestLevels = [...levels.values()].filter(l => Number.isFinite(l.price));
  // Only the event's available bar-close is used; no post-event outcome is implied.
  return {
    schema: ENGINE18_SCHEMA, engine: 18, researchOnly: true, noExecution: true,
    signalMaturity: "UNVALIDATED_BASELINE", priceBasis: "UNRECONCILED",
    symbol, contractSymbol: contractSymbol || null, tickSize: TICK,
    asOfUnixSec: bars.at(-1).time, lastClose: latestClose,
    barsEvaluated: bars.length, lookback, levels: latestLevels,
    events, latestEvent: events.at(-1) || null,
    limitations: ["OHLCV does not reveal hidden stops or resting depth", "No probabilities until calibrated forward testing", "No cross-contract normalization without explicit source basis"]
  };
}
