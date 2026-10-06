// services/core/logic/engine22/wave/analyzeWaveDuration.js
// Engine 22G — Wave Duration / Time Expectancy Model
//
// Purpose:
// Read-only duration intelligence for Elliott wave degrees.
// Measures completed wave segment durations from Engine 2 waveMarks,
// estimates active wave duration,
// and labels each degree as EARLY / NORMAL / MATURE / EXTENDED / OVERDUE.
//
// Upgrade:
// Supports both calendar/clock time and market-bar time.
// Market bars are better for learning because SPY and ES trade different schedules.
//
// This does not create trades.
// This does not change readiness/status/entries.
// Manual Engine 2 marks remain truth for v1.

const DEGREE_ORDER = ["primary", "intermediate", "minor", "minute", "micro"];

const PHASE_TO_ACTIVE_WAVE = {
  IN_W1: "W1",
  IN_W2: "W2",
  IN_W3: "W3",
  IN_W4: "W4",
  IN_W5: "W5",
  COMPLETE_W5: "COMPLETE_W5",
  IN_A: "A",
  IN_B: "B",
  IN_C: "C",
  COMPLETE_C: "COMPLETE_C",
};

const DEGREE_TO_BAR_TF = {
  primary: "1d",
  intermediate: "1h",
  minor: "1h",
  minute: "10m",
  micro: "10m",
};

const TF_TO_HOURS_PER_BAR = {
  "1m": 1 / 60,
  "5m": 5 / 60,
  "10m": 10 / 60,
  "15m": 15 / 60,
  "30m": 30 / 60,
  "1h": 1,
  "4h": 4,
  "1d": 6.5, // SPY RTH-style estimate. ES daily still measured by bar count, not this estimate.
};

// Starter expectations by clock hours.
// These are seed ranges until we build historical learning.
const DEFAULT_EXPECTED_HOURS = {
  primary: {
    min: 60 * 24,
    normal: 180 * 24,
    mature: 360 * 24,
    extended: 540 * 24,
  },
  intermediate: {
    min: 10 * 24,
    normal: 45 * 24,
    mature: 120 * 24,
    extended: 240 * 24,
  },
  minor: {
    min: 2 * 24,
    normal: 10 * 24,
    mature: 25 * 24,
    extended: 60 * 24,
  },
  minute: {
    min: 4,
    normal: 24,
    mature: 72,
    extended: 120,
  },
  micro: {
    min: 1,
    normal: 8,
    mature: 24,
    extended: 48,
  },
};

// Starter expectations by market bars.
// These are more important than raw clock time for learning.
const DEFAULT_EXPECTED_BARS = {
  primary: {
    tf: "1d",
    min: 20,
    normal: 120,
    mature: 250,
    extended: 375,
  },
  intermediate: {
    tf: "1h",
    min: 40,
    normal: 180,
    mature: 480,
    extended: 960,
  },
  minor: {
    tf: "1h",
    min: 12,
    normal: 60,
    mature: 150,
    extended: 360,
  },
  minute: {
    tf: "10m",
    min: 12,
    normal: 39,
    mature: 117,
    extended: 195,
  },
  micro: {
    tf: "10m",
    min: 3,
    normal: 24,
    mature: 72,
    extended: 144,
  },
};

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;

  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function upper(x) {
  return String(x || "").trim().toUpperCase();
}

function isRealTimeSec(x) {
  const n = Number(x);
  return Number.isFinite(n) && n > 0;
}

function markTimeSec(block, key) {
  const t = Number(block?.waveMarks?.[key]?.tSec);
  return isRealTimeSec(t) ? t : null;
}

function markTimeText(block, key) {
  return block?.waveMarks?.[key]?.t ?? null;
}

function markPrice(block, key) {
  const p = toNum(block?.waveMarks?.[key]?.p);
  return p !== null && p > 0 ? p : null;
}

function hoursBetween(startSec, endSec) {
  const s = Number(startSec);
  const e = Number(endSec);

  if (!isRealTimeSec(s) || !isRealTimeSec(e) || e <= s) return null;

  return round2((e - s) / 3600);
}

function daysFromHours(hours) {
  const h = Number(hours);
  return Number.isFinite(h) ? round2(h / 24) : null;
}

function classifyMaturity(elapsedHours, expected) {
  const h = Number(elapsedHours);

  if (!Number.isFinite(h) || h < 0 || !expected) {
    return {
      maturityState: "UNKNOWN",
      timeRisk: "UNKNOWN",
      reason: "MISSING_ELAPSED_OR_EXPECTED_TIME",
    };
  }

  if (h < expected.min) {
    return {
      maturityState: "EARLY",
      timeRisk: "LOW",
      reason: "ELAPSED_BELOW_MIN_EXPECTED_RANGE",
    };
  }

  if (h < expected.normal) {
    return {
      maturityState: "NORMAL",
      timeRisk: "NORMAL",
      reason: "ELAPSED_WITHIN_NORMAL_EXPECTED_RANGE",
    };
  }

  if (h < expected.mature) {
    return {
      maturityState: "MATURE",
      timeRisk: "ELEVATED",
      reason: "ELAPSED_ABOVE_NORMAL_EXPECTED_RANGE",
    };
  }

  if (h < expected.extended) {
    return {
      maturityState: "EXTENDED",
      timeRisk: "HIGH",
      reason: "ELAPSED_ABOVE_MATURE_EXPECTED_RANGE",
    };
  }

  return {
    maturityState: "OVERDUE",
    timeRisk: "VERY_HIGH",
    reason: "ELAPSED_ABOVE_EXTENDED_EXPECTED_RANGE",
  };
}

function classifyBarMaturity(elapsedBars, expected) {
  if (elapsedBars === null || elapsedBars === undefined || elapsedBars === "") {
    return {
      maturityStateByBars: "UNKNOWN",
      timeRiskByBars: "UNKNOWN",
      reason: "BARS_UNAVAILABLE",
    };
  }

  const bars = Number(elapsedBars);

  if (!Number.isFinite(bars) || bars < 0 || !expected) {
    return {
      maturityStateByBars: "UNKNOWN",
      timeRiskByBars: "UNKNOWN",
      reason: "MISSING_ELAPSED_BARS_OR_EXPECTED_BARS",
    };
  }

  if (bars < expected.min) {
    return {
      maturityStateByBars: "EARLY",
      timeRiskByBars: "LOW",
      reason: "BARS_BELOW_MIN_EXPECTED_RANGE",
    };
  }

  if (bars < expected.normal) {
    return {
      maturityStateByBars: "NORMAL",
      timeRiskByBars: "NORMAL",
      reason: "BARS_WITHIN_NORMAL_EXPECTED_RANGE",
    };
  }

  if (bars < expected.mature) {
    return {
      maturityStateByBars: "MATURE",
      timeRiskByBars: "ELEVATED",
      reason: "BARS_ABOVE_NORMAL_EXPECTED_RANGE",
    };
  }

  if (bars < expected.extended) {
    return {
      maturityStateByBars: "EXTENDED",
      timeRiskByBars: "HIGH",
      reason: "BARS_ABOVE_MATURE_EXPECTED_RANGE",
    };
  }

  return {
    maturityStateByBars: "OVERDUE",
    timeRiskByBars: "VERY_HIGH",
    reason: "BARS_ABOVE_EXTENDED_EXPECTED_RANGE",
  };
}

function getNowSec({ snapshotNow = null, currentTimeSec = null } = {}) {
  const direct = toNum(currentTimeSec);
  if (direct !== null && direct > 0) return direct;

  const parsed = Date.parse(snapshotNow);
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);

  return Math.floor(Date.now() / 1000);
}

function normalizeBarTimeSec(bar) {
  const raw = bar?.time ?? bar?.t ?? bar?.tSec ?? bar?.timestamp;

  if (raw === null || raw === undefined) return null;

  const n = Number(raw);

  if (Number.isFinite(n)) {
    // If milliseconds, convert to seconds.
    if (n > 10_000_000_000) return Math.floor(n / 1000);
    return Math.floor(n);
  }

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);

  return null;
}

function normalizeBars(bars = []) {
  if (!Array.isArray(bars)) return [];

  return bars
    .map((bar) => ({
      ...bar,
      _tSec: normalizeBarTimeSec(bar),
    }))
    .filter((bar) => isRealTimeSec(bar._tSec))
    .sort((a, b) => a._tSec - b._tSec);
}

function countBarsBetween({ bars, startSec, endSec }) {
  const s = Number(startSec);
  const e = Number(endSec);

  if (!isRealTimeSec(s) || !isRealTimeSec(e) || e <= s) {
    return null;
  }

  const normalized = normalizeBars(bars);

  if (!normalized.length) return null;

  // Count completed bars after the start mark and up to the end/current time.
  return normalized.filter((bar) => bar._tSec > s && bar._tSec <= e).length;
}

function estimateTradingHoursFromBars({ bars, tf }) {
  const count = Number(bars);
  if (!Number.isFinite(count)) return null;

  const hoursPerBar = TF_TO_HOURS_PER_BAR[tf] ?? null;
  if (!Number.isFinite(hoursPerBar)) return null;

  return round2(count * hoursPerBar);
}

function buildCompletedSegments(block, barsByTf = {}, degree = null) {
  const segments = [];

  const tf = DEGREE_TO_BAR_TF[degree] || block?.tf || null;
  const bars = barsByTf?.[tf] || [];

  const pairs = [
    { wave: "W2", startKey: "W1", endKey: "W2" },
    { wave: "W3", startKey: "W2", endKey: "W3" },
    { wave: "W4", startKey: "W3", endKey: "W4" },
    { wave: "W5", startKey: "W4", endKey: "W5" },
    { wave: "B", startKey: "A", endKey: "B" },
    { wave: "C", startKey: "B", endKey: "C" },
  ];

  for (const pair of pairs) {
    const startSec = markTimeSec(block, pair.startKey);
    const endSec = markTimeSec(block, pair.endKey);
    const durationHours = hoursBetween(startSec, endSec);

    if (durationHours === null) continue;

    const elapsedBars = countBarsBetween({
      bars,
      startSec,
      endSec,
    });

    segments.push({
      wave: pair.wave,
      startKey: pair.startKey,
      endKey: pair.endKey,
      startTime: markTimeText(block, pair.startKey),
      endTime: markTimeText(block, pair.endKey),
      startPrice: round2(markPrice(block, pair.startKey)),
      endPrice: round2(markPrice(block, pair.endKey)),
      durationHours,
      durationDays: daysFromHours(durationHours),
      barTimeframe: tf,
      elapsedBars,
      estimatedTradingHoursFromBars: estimateTradingHoursFromBars({
        bars: elapsedBars,
        tf,
      }),
    });
  }

  return segments;
}

function inferActiveSince({ block, phase }) {
  const p = upper(phase);

  const map = {
    IN_W1: null,
    IN_W2: "W1",
    IN_W3: "W2",
    IN_W4: "W3",
    IN_W5: "W4",
    IN_A: "W5",
    IN_B: "A",
    IN_C: "B",
  };

  const activeSinceMark = map[p] || null;

  if (!activeSinceMark) {
    return {
      activeSinceMark: null,
      activeSinceTime: null,
      activeSinceSec: null,
      activeSincePrice: null,
    };
  }

  return {
    activeSinceMark,
    activeSinceTime: markTimeText(block, activeSinceMark),
    activeSinceSec: markTimeSec(block, activeSinceMark),
    activeSincePrice: round2(markPrice(block, activeSinceMark)),
  };
}

function summarizeSegments(segments = []) {
  if (!Array.isArray(segments) || !segments.length) {
    return {
      count: 0,
      averageHours: null,
      averageDays: null,
      minHours: null,
      maxHours: null,
      averageBars: null,
      minBars: null,
      maxBars: null,
    };
  }

  const hourValues = segments
    .map((s) => Number(s.durationHours))
    .filter(Number.isFinite);

  const barValues = segments
    .map((s) => Number(s.elapsedBars))
    .filter(Number.isFinite);

  const out = {
    count: hourValues.length,
    averageHours: null,
    averageDays: null,
    minHours: null,
    maxHours: null,
    averageBars: null,
    minBars: null,
    maxBars: null,
  };

  if (hourValues.length) {
    const sum = hourValues.reduce((a, b) => a + b, 0);
    const avg = sum / hourValues.length;

    out.averageHours = round2(avg);
    out.averageDays = daysFromHours(avg);
    out.minHours = round2(Math.min(...hourValues));
    out.maxHours = round2(Math.max(...hourValues));
  }

  if (barValues.length) {
    const sum = barValues.reduce((a, b) => a + b, 0);
    const avg = sum / barValues.length;

    out.averageBars = round2(avg);
    out.minBars = Math.min(...barValues);
    out.maxBars = Math.max(...barValues);
  }

  return out;
}

function analyzeDegreeDuration({
  symbol,
  degree,
  block,
  nowSec,
  barsByTf = {},
}) {
  if (!block || typeof block !== "object") {
    return {
      ok: false,
      symbol,
      degree,
      phase: "UNKNOWN",
      activeWave: "UNKNOWN",
      maturityState: "UNKNOWN",
      timeRisk: "UNKNOWN",
      maturityStateByBars: "UNKNOWN",
      timeRiskByBars: "UNKNOWN",
      reasonCodes: ["MISSING_ENGINE2_BLOCK"],
    };
  }

  const phase = block?.phase || "UNKNOWN";
  const confirmedPhase = block?.confirmedPhase || "UNKNOWN";
  const activeWave = PHASE_TO_ACTIVE_WAVE[upper(phase)] || "UNKNOWN";

  const expected = DEFAULT_EXPECTED_HOURS[degree] || null;
  const expectedBars = DEFAULT_EXPECTED_BARS[degree] || null;

  const barTimeframe = DEGREE_TO_BAR_TF[degree] || block?.tf || null;
  const bars = barsByTf?.[barTimeframe] || [];

  const completedSegments = buildCompletedSegments(block, barsByTf, degree);
  const completedStats = summarizeSegments(completedSegments);

  const activeSince = inferActiveSince({
    block,
    phase,
  });

  const elapsedHours = hoursBetween(activeSince.activeSinceSec, nowSec);
  const elapsedDays = daysFromHours(elapsedHours);

  const elapsedBars = countBarsBetween({
    bars,
    startSec: activeSince.activeSinceSec,
    endSec: nowSec,
  });

  const estimatedTradingHoursFromBars = estimateTradingHoursFromBars({
    bars: elapsedBars,
    tf: barTimeframe,
  });

  const classified = classifyMaturity(elapsedHours, expected);
  const classifiedBars = classifyBarMaturity(elapsedBars, expectedBars);

  return {
    ok: true,
    symbol,
    degree,
    tf: block?.tf || null,

    phase,
    confirmedPhase,
    activeWave,

    activeSinceMark: activeSince.activeSinceMark,
    activeSinceTime: activeSince.activeSinceTime,
    activeSincePrice: activeSince.activeSincePrice,

    elapsedHours,
    elapsedDays,

    barDuration: {
      barTimeframe,
      elapsedBars,
      estimatedTradingHoursFromBars,
      expectedBars: expectedBars
        ? {
            min: expectedBars.min,
            normal: expectedBars.normal,
            mature: expectedBars.mature,
            extended: expectedBars.extended,
          }
        : null,
      maturityStateByBars: classifiedBars.maturityStateByBars,
      timeRiskByBars: classifiedBars.timeRiskByBars,
      reason: classifiedBars.reason,
      barsAvailable: Array.isArray(bars) ? bars.length : 0,
    },

    expectedRangeHours: expected
      ? {
          min: expected.min,
          normal: expected.normal,
          mature: expected.mature,
          extended: expected.extended,
        }
      : null,

    expectedRangeDays: expected
      ? {
          min: daysFromHours(expected.min),
          normal: daysFromHours(expected.normal),
          mature: daysFromHours(expected.mature),
          extended: daysFromHours(expected.extended),
        }
      : null,

    maturityState: classified.maturityState,
    timeRisk: classified.timeRisk,

    maturityStateByBars: classifiedBars.maturityStateByBars,
    timeRiskByBars: classifiedBars.timeRiskByBars,

    completedSegments,
    completedStats,

    message:
      elapsedHours === null
        ? `${degree} ${phase} duration is unavailable because active start time is missing.`
        : `${degree} ${phase} has been active for ${elapsedHours} clock hours (${elapsedDays} days), with ${elapsedBars ?? "unknown"} ${barTimeframe || ""} market bars. Clock state is ${classified.maturityState}; bar state is ${classifiedBars.maturityStateByBars}.`,

    reasonCodes: [
      `${degree.toUpperCase()}_${upper(phase)}`,
      activeSince.activeSinceMark ? `ACTIVE_SINCE_${activeSince.activeSinceMark}` : "ACTIVE_START_UNAVAILABLE",
      classified.reason,
      classifiedBars.reason,
    ],
  };
}

export function analyzeWaveDuration({
  symbol = "SPY",
  engine2State = null,
  snapshotNow = null,
  currentTimeSec = null,
  barsByTf = {},
} = {}) {
  const nowSec = getNowSec({
    snapshotNow,
    currentTimeSec,
  });

  if (!engine2State || typeof engine2State !== "object") {
    return {
      ok: false,
      engine: "engine22.waveDuration.v1",
      symbol,
      nowSec,
      degrees: {},
      reasonCodes: ["MISSING_ENGINE2_STATE"],
    };
  }

  const degrees = {};

  for (const degree of DEGREE_ORDER) {
    degrees[degree] = analyzeDegreeDuration({
      symbol,
      degree,
      block: engine2State?.[degree] || null,
      nowSec,
      barsByTf,
    });
  }

  const activeDegree =
    ["micro", "minute", "minor", "intermediate", "primary"].find((degree) => {
      const d = degrees?.[degree];
      return d?.ok && d?.activeWave !== "UNKNOWN";
    }) || null;

  const active = activeDegree ? degrees[activeDegree] : null;

  return {
    ok: true,
    engine: "engine22.waveDuration.v1",
    symbol,
    nowSec,
    nowIso: new Date(nowSec * 1000).toISOString(),

    activeDegree,
    activeWave: active?.activeWave || "UNKNOWN",
    activePhase: active?.phase || "UNKNOWN",
    activeMaturityState: active?.maturityState || "UNKNOWN",
    activeTimeRisk: active?.timeRisk || "UNKNOWN",
    activeMaturityStateByBars: active?.maturityStateByBars || "UNKNOWN",
    activeTimeRiskByBars: active?.timeRiskByBars || "UNKNOWN",

    degrees,

    summary: active
      ? `${activeDegree} ${active.phase} has been active for ${active.elapsedHours} clock hours and ${active.barDuration?.elapsedBars ?? "unknown"} ${active.barDuration?.barTimeframe || ""} bars. Clock state is ${active.maturityState}; bar state is ${active.maturityStateByBars}.`
      : "No active wave duration available.",

    reasonCodes: [
      "ENGINE22_WAVE_DURATION_BUILT",
      activeDegree ? `ACTIVE_DURATION_DEGREE_${activeDegree.toUpperCase()}` : "NO_ACTIVE_DURATION_DEGREE",
    ],
  };
}

export default analyzeWaveDuration;
