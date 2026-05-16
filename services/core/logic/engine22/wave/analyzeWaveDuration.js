// services/core/logic/engine22/wave/analyzeWaveDuration.js
// Engine 22G — Wave Duration / Time Expectancy Model
//
// Purpose:
// Read-only duration intelligence for Elliott wave degrees.
// Measures completed wave segment durations from Engine 2 waveMarks,
// estimates active wave duration,
// and labels each degree as EARLY / NORMAL / MATURE / EXTENDED / OVERDUE.
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

// Starter expectations.
// These are not permanent truths. They are seed ranges until we build history learning.
// Hours are used because Micro/Minute can be intraday and Primary can still be represented cleanly.
const DEFAULT_EXPECTED_HOURS = {
  primary: {
    min: 60 * 24,      // ~60 days
    normal: 180 * 24,  // ~6 months
    mature: 360 * 24,  // ~1 year
    extended: 540 * 24 // ~18 months
  },
  intermediate: {
    min: 10 * 24,      // ~10 days
    normal: 45 * 24,   // ~1.5 months
    mature: 120 * 24,  // ~4 months
    extended: 240 * 24 // ~8 months
  },
  minor: {
    min: 2 * 24,       // ~2 days
    normal: 10 * 24,   // ~2 trading weeks
    mature: 25 * 24,   // ~1 month
    extended: 60 * 24  // ~2 months
  },
  minute: {
    min: 4,            // ~4 hours
    normal: 24,        // ~1 day
    mature: 72,        // ~3 days
    extended: 120      // ~5 days
  },
  micro: {
    min: 1,            // ~1 hour
    normal: 8,         // same-day wave
    mature: 24,        // ~1 day
    extended: 48       // ~2 days
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

function getNowSec({ snapshotNow = null, currentTimeSec = null } = {}) {
  const direct = toNum(currentTimeSec);
  if (direct !== null && direct > 0) return direct;

  const parsed = Date.parse(snapshotNow);
  if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);

  return Math.floor(Date.now() / 1000);
}

function buildCompletedSegments(block) {
  const segments = [];

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
    };
  }

  const values = segments
    .map((s) => Number(s.durationHours))
    .filter(Number.isFinite);

  if (!values.length) {
    return {
      count: 0,
      averageHours: null,
      averageDays: null,
      minHours: null,
      maxHours: null,
    };
  }

  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;

  return {
    count: values.length,
    averageHours: round2(avg),
    averageDays: daysFromHours(avg),
    minHours: round2(Math.min(...values)),
    maxHours: round2(Math.max(...values)),
  };
}

function analyzeDegreeDuration({
  symbol,
  degree,
  block,
  nowSec,
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
      reasonCodes: ["MISSING_ENGINE2_BLOCK"],
    };
  }

  const phase = block?.phase || "UNKNOWN";
  const confirmedPhase = block?.confirmedPhase || "UNKNOWN";
  const activeWave = PHASE_TO_ACTIVE_WAVE[upper(phase)] || "UNKNOWN";

  const expected = DEFAULT_EXPECTED_HOURS[degree] || null;
  const completedSegments = buildCompletedSegments(block);
  const completedStats = summarizeSegments(completedSegments);

  const activeSince = inferActiveSince({
    block,
    phase,
  });

  const elapsedHours = hoursBetween(activeSince.activeSinceSec, nowSec);
  const elapsedDays = daysFromHours(elapsedHours);

  const classified = classifyMaturity(elapsedHours, expected);

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

    completedSegments,
    completedStats,

    message:
      elapsedHours === null
        ? `${degree} ${phase} duration is unavailable because active start time is missing.`
        : `${degree} ${phase} has been active for ${elapsedHours} hours (${elapsedDays} days). Time state is ${classified.maturityState}.`,

    reasonCodes: [
      `${degree.toUpperCase()}_${upper(phase)}`,
      activeSince.activeSinceMark ? `ACTIVE_SINCE_${activeSince.activeSinceMark}` : "ACTIVE_START_UNAVAILABLE",
      classified.reason,
    ],
  };
}

export function analyzeWaveDuration({
  symbol = "SPY",
  engine2State = null,
  snapshotNow = null,
  currentTimeSec = null,
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

    degrees,

    summary: active
      ? `${activeDegree} ${active.phase} has been active for ${active.elapsedHours} hours (${active.elapsedDays} days). Time state is ${active.maturityState}; time risk is ${active.timeRisk}.`
      : "No active wave duration available.",

    reasonCodes: [
      "ENGINE22_WAVE_DURATION_BUILT",
      activeDegree ? `ACTIVE_DURATION_DEGREE_${activeDegree.toUpperCase()}` : "NO_ACTIVE_DURATION_DEGREE",
    ],
  };
}

export default analyzeWaveDuration;
