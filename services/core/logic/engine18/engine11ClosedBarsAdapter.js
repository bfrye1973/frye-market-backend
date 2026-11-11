// Engine 18 accepts Engine 11's chart-compatible OHLCV bars without mutating them.
// The caller must supply only closed bars; incomplete bars are intentionally rejected.
export function normalizeEngine11ClosedBars(rows, { asOfUnixSec, timeframeSeconds, contractSymbol } = {}) {
  if (!Array.isArray(rows)) throw Error("ENGINE18_EXPECTED_CANDLE_ARRAY");
  if (!Number.isSafeInteger(asOfUnixSec) || asOfUnixSec <= 0) throw Error("ENGINE18_ASOF_REQUIRED");
  if (!Number.isSafeInteger(timeframeSeconds) || timeframeSeconds < 60) throw Error("ENGINE18_TIMEFRAME_REQUIRED");
  if (typeof contractSymbol !== "string" || !/^ES[HMUZ]\d{1,2}$/.test(contractSymbol)) throw Error("ENGINE18_EXPLICIT_ES_CONTRACT_REQUIRED");
  const parsed = [];
  for (const b of rows) {
    if (!b || typeof b !== "object") throw Error("ENGINE18_INVALID_CANDLE");
    const t = typeof b.time === "number" ? b.time : Number(b.time);
    if (!Number.isSafeInteger(t) || t <= 0) throw Error("ENGINE18_INVALID_CANDLE_TIMESTAMP");
    // Require the entire bar interval to finish by the as-of timestamp.
    if (t + timeframeSeconds > asOfUnixSec) continue;
    const bar = {time:t,open:Number(b.open),high:Number(b.high),low:Number(b.low),close:Number(b.close),volume:Number(b.volume ?? 0)};
    if (![bar.open,bar.high,bar.low,bar.close,bar.volume].every(Number.isFinite)) throw Error("ENGINE18_INVALID_CANDLE_VALUES");
    if (parsed.length && t <= parsed.at(-1).time) throw Error("ENGINE18_DUPLICATE_OR_UNSORTED_CANDLES");
    parsed.push(bar);
  }
  return {contractSymbol,asOfUnixSec,timeframeSeconds,bars:parsed,barCount:parsed.length,source:"ENGINE11_CLOSED_CANDLES"};
}
