const TIMEFRAME_DURATION_MS = Object.freeze({
  "1m": 1 * 60 * 1000,
  "5m": 5 * 60 * 1000,
  "10m": 10 * 60 * 1000,
});

const STATES = Object.freeze({
  COMPLETED: "COMPLETED",
  FORMING: "FORMING",
  COMPLETION_UNKNOWN: "COMPLETION_UNKNOWN",
  NO_BARS: "NO_BARS",
});

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function barTimeSeconds(bar) {
  return finiteNumber(bar?.time ?? bar?.t ?? bar?.tSec);
}

function immutableSortedBars(bars) {
  return bars
    .map((bar, inputIndex) => ({
      bar: bar && typeof bar === "object" ? { ...bar } : bar,
      inputIndex,
      timeSeconds: barTimeSeconds(bar),
    }))
    .sort((a, b) => {
      if (a.timeSeconds == null && b.timeSeconds == null) {
        return a.inputIndex - b.inputIndex;
      }
      if (a.timeSeconds == null) return 1;
      if (b.timeSeconds == null) return -1;
      return a.timeSeconds - b.timeSeconds || a.inputIndex - b.inputIndex;
    });
}

export function deriveCandleCompletionTruth({
  bars = [],
  timeframe,
  evaluationTimeMs,
} = {}) {
  const sourceBars = Array.isArray(bars) ? bars : [];
  const timeframeDurationMs = TIMEFRAME_DURATION_MS[timeframe] ?? null;
  const evaluatedAtMs = finiteNumber(evaluationTimeMs);
  const sorted = immutableSortedBars(sourceBars);
  const completedBars = [];
  const formingBars = [];
  const completionUnknownBars = [];
  const classified = [];

  for (const item of sorted) {
    const barStartTimeMs =
      item.timeSeconds == null ? null : item.timeSeconds * 1000;
    const expectedCloseTimeMs =
      barStartTimeMs != null && timeframeDurationMs != null
        ? barStartTimeMs + timeframeDurationMs
        : null;

    let completionState = STATES.COMPLETION_UNKNOWN;
    if (expectedCloseTimeMs != null && evaluatedAtMs != null) {
      completionState =
        expectedCloseTimeMs <= evaluatedAtMs
          ? STATES.COMPLETED
          : STATES.FORMING;
    }

    const entry = {
      ...item,
      barStartTimeMs,
      expectedCloseTimeMs,
      completionState,
    };
    classified.push(entry);

    if (completionState === STATES.COMPLETED) completedBars.push(item.bar);
    else if (completionState === STATES.FORMING) formingBars.push(item.bar);
    else completionUnknownBars.push(item.bar);
  }

  const latest = classified[classified.length - 1] || null;
  const latestForming = [...classified]
    .reverse()
    .find((entry) => entry.completionState === STATES.FORMING) || null;

  const reasonCodes = [];
  if (!sourceBars.length) reasonCodes.push("NO_BARS");
  if (timeframeDurationMs == null) reasonCodes.push("UNSUPPORTED_TIMEFRAME");
  if (evaluatedAtMs == null) reasonCodes.push("INVALID_EVALUATION_TIME_MS");
  if (completionUnknownBars.length) reasonCodes.push("CANDLE_COMPLETION_UNKNOWN");
  if (formingBars.length) reasonCodes.push("FORMING_CANDLE_PRESENT");
  if (completedBars.length) reasonCodes.push("COMPLETED_CANDLE_PRESENT");

  return {
    timeframe: timeframe || null,
    timeframeDurationMs,
    evaluationTimeMs: evaluatedAtMs,
    completedBars,
    formingBar: latestForming?.bar || null,
    completionUnknownBars,
    allBars: sorted.map((item) => item.bar),
    latestBarStartTimeMs: latest?.barStartTimeMs ?? null,
    latestExpectedCloseTimeMs: latest?.expectedCloseTimeMs ?? null,
    latestBarCompletionState:
      sourceBars.length === 0
        ? STATES.NO_BARS
        : latest?.completionState || STATES.COMPLETION_UNKNOWN,
    reasonCodes,
  };
}

export default deriveCandleCompletionTruth;
