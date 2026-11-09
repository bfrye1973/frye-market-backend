// Engine 16 — structural tracker research prototype.
// Research-only: no trade permissions, no Engine 22 count mutation, no live candle writes.
// Inputs must be validated, chronological CLOSED bars on a declared price basis.
export const ENGINE16_SCHEMA = "engine16.structuralTracker.v1";
export const FIB_RETRACEMENTS = Object.freeze([0.236, 0.382, 0.5, 0.618, 0.786, 0.886]);
export const FIB_EXTENSIONS = Object.freeze([0.618, 1, 1.272, 1.618, 2, 2.618]);

function finite(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(name + " must be finite");
  return value;
}
function tickRound(price, tickSize) {
  finite(price, "price");
  if (!(finite(tickSize, "tickSize") > 0)) throw new RangeError("tickSize must be positive");
  return Number((Math.round(price / tickSize) * tickSize).toFixed(10));
}
function assertBar(bar) {
  if (!bar || !Number.isFinite(Date.parse(bar.time))) throw new TypeError("bar.time must be an ISO timestamp");
  for (const key of ["open", "high", "low", "close"]) finite(bar[key], "bar." + key);
  if (bar.low > bar.high || bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high) {
    throw new RangeError("Invalid OHLC bounds");
  }
  if (bar.closed !== true) throw new Error("Unclosed candles cannot confirm structures");
}
function validateBars(bars) {
  if (!Array.isArray(bars)) throw new TypeError("bars must be an array");
  let previous = -Infinity;
  for (const bar of bars) {
    assertBar(bar);
    const timestamp = Date.parse(bar.time);
    if (timestamp <= previous) throw new Error("bars must have strictly increasing timestamps");
    previous = timestamp;
  }
}
/** Price anchors are immutable caller-provided observations. */
export function fibonacciLevels({ start, end, direction, tickSize = 0.25 }) {
  finite(start, "start"); finite(end, "end");
  if (!["UP", "DOWN"].includes(direction)) throw new Error("direction must be UP or DOWN");
  if ((direction === "UP" && end <= start) || (direction === "DOWN" && end >= start)) throw new Error("anchors contradict direction");
  const distance = Math.abs(end - start);
  const sign = direction === "UP" ? 1 : -1;
  return {
    anchors: { start, end }, direction, tickSize, formula: "retracement=end-sign*length*ratio; extension=start+sign*length*ratio",
    retracements: FIB_RETRACEMENTS.map(ratio => ({ ratio, price: tickRound(end - sign * distance * ratio, tickSize) })),
    extensions: FIB_EXTENSIONS.map(ratio => ({ ratio, price: tickRound(start + sign * distance * ratio, tickSize) }))
  };
}
/** Strict, gap-only FVG discovery; mitigation is a separate versioned lifecycle concern. */
export function detectFvg(bars, { symbol = "ES", timeframe = "1h", tickSize = 0.25 } = {}) {
  validateBars(bars);
  const zones = [];
  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2], c = bars[i];
    let direction, lower, upper;
    if (c.low > a.high) { direction = "BULLISH"; lower = a.high; upper = c.low; }
    else if (c.high < a.low) { direction = "BEARISH"; lower = c.high; upper = a.low; }
    else continue;
    if (tickRound(upper - lower, tickSize) <= 0) continue;
    zones.push({
      id: [symbol, timeframe, a.time, c.time, direction].join(":"),
      symbol, timeframe, createdAt: c.time, direction,
      lower: tickRound(lower, tickSize), upper: tickRound(upper, tickSize),
      midpoint: tickRound((lower + upper) / 2, tickSize),
      status: "UNTOUCHED", confirmedByClosedCandle: true
    });
  }
  return zones;
}
/** Confirm a pivot only after 'strength' bars on BOTH sides have closed. */
export function confirmedPivots(bars, { strength = 2 } = {}) {
  validateBars(bars);
  if (!Number.isInteger(strength) || strength < 1) throw new RangeError("strength must be a positive integer");
  const pivots = [];
  for (let i = strength; i < bars.length - strength; i++) {
    const b = bars[i], neighbors = bars.slice(i - strength, i + strength + 1).filter((_, j) => j !== strength);
    if (neighbors.every(x => b.high > x.high)) pivots.push({ id: b.time + ":HIGH", time: b.time, price: b.high, kind: "HIGH", confirmationTime: bars[i + strength].time });
    if (neighbors.every(x => b.low < x.low)) pivots.push({ id: b.time + ":LOW", time: b.time, price: b.low, kind: "LOW", confirmationTime: bars[i + strength].time });
  }
  return pivots;
}
/** A-B-C is only a three-swing research candidate; not an orthodox validated Elliott count. */
export function abcCandidates(pivots) {
  const result = [];
  for (let i = 0; i + 3 < pivots.length; i++) {
    const [start, a, b, c] = pivots.slice(i, i + 4);
    const bearish = [start.kind, a.kind, b.kind, c.kind].join() === "HIGH,LOW,HIGH,LOW";
    const bullish = [start.kind, a.kind, b.kind, c.kind].join() === "LOW,HIGH,LOW,HIGH";
    if (!bearish && !bullish) continue;
    if (bearish && !(b.price < start.price && c.price < a.price)) continue;
    if (bullish && !(b.price > start.price && c.price > a.price)) continue;
    result.push({
      id: "ABC:" + [start.id, a.id, b.id, c.id].join("|"),
      direction: bearish ? "DOWN" : "UP",
      anchors: { start, A: a, B: b, C: c },
      status: "DISCOVERED",
      confidence: "UNVALIDATED_SWING_CANDIDATE",
      orthodoxSubdivisionsVerified: false
    });
  }
  return result;
}
/** Pure deterministic research snapshot; never consults future bars or external state. */
export function computeEngine16Research({ bars, symbol = "ES", timeframe = "1h", priceBasis, tickSize = 0.25, pivotStrength = 2 }) {
  if (!priceBasis || typeof priceBasis !== "string") throw new Error("Explicit priceBasis is required");
  validateBars(bars);
  const pivotMap = confirmedPivots(bars, { strength: pivotStrength });
  return {
    schema: ENGINE16_SCHEMA, researchOnly: true, noExecution: true,
    symbol, timeframe, priceBasis, asOf: bars.at(-1)?.time ?? null,
    pivotMap, patterns: abcCandidates(pivotMap),
    fvgZones: detectFvg(bars, { symbol, timeframe, tickSize }),
    fibModels: [], smtEvidence: [], alternativeScenarios: [],
    version: 1
  };
}
