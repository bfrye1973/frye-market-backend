// services/core/logic/engine22/wave/buildEngine22WaveStrategy.js
// Engine 22G — Clean Wave Strategy Wrapper

import { analyzeWaveStack } from "./analyzeWaveStack.js";
import { buildTimelineRead } from "./buildTimelineRead.js";

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value).replaceAll("_", " ");
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
    toNum(engine16?.regimeLayers?.trend4h?.close) ??
    toNum(regimeLayers?.tenMinute?.close) ??
    toNum(regimeLayers?.trigger10m?.close) ??
    toNum(regimeLayers?.oneHour?.close) ??
    toNum(regimeLayers?.pullback1h?.close) ??
    toNum(marketMeter?.layers?.tenMinute?.close) ??
    toNum(marketMeter?.layers?.tenMinuteEma10?.close) ??
    null
  );
}

function normalizeRegimeLayersForWaveStrategy({ engine16 = null, engine22Scalp = null, regimeLayers = null } = {}) {
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

function hasUsableWaveState(engine2State) {
  if (!engine2State || typeof engine2State !== "object") return false;

  const degrees = ["primary", "intermediate", "minor", "minute", "micro"];

  return degrees.some((degree) => {
    const block = engine2State?.[degree];
    const marks = Array.isArray(block?.marksPresent) ? block.marksPresent : [];
    const phase = String(block?.phase || "UNKNOWN").toUpperCase();

    return marks.length >= 2 && phase !== "UNKNOWN";
  });
}

function buildSafeTradeDecision({
  symbol,
  setupType = "NO_SETUP",
  reason = "Wave strategy is waiting.",
  needs = [],
  reasonCodes = [],
} = {}) {
  return {
    mode: "PAPER_ONLY",
    decision: "WAIT",
    direction: "NONE",
    setupType,
    grade: "NO_TRADE",
    entryAllowed: false,
    chaseAllowed: false,
    reason,
    needs,
    reasonCodes: ["PAPER_ONLY", ...reasonCodes],
    safety: {
      liveTradingEnabled: false,
      brokerCallsEnabled: false,
      orderRoutingEnabled: false,
      optionsExecutionEnabled: false,
      paperOnly: true,
      noBlindShorts: true,
    },
    debug: {
      symbol,
    },
  };
}

function buildIncompleteTimelineRead({ symbol, reason }) {
  return {
    ok: true,
    source: "engine22.timelineRead.v1",
    severity: "warning",
    headline: `${symbol} WAVE/FIB STATE INCOMPLETE — WAIT`,
    subheadline: "Engine 2 wave/fib marks are incomplete. Waiting for valid wave structure.",
    waveStack: {},
    waveStackText: "Primary — | Intermediate — | Minor — | Minute — | Micro —",
    mainSections: [
      {
        title: "Wave/Fib State",
        severity: "warning",
        lines: [
          `${symbol} Engine 2 wave/fib marks are incomplete.`,
          "No fake wave/fib output will be created.",
          `Reason: ${reason}`,
        ],
      },
      {
        title: "Action / Needs",
        severity: "warning",
        lines: [
          "Wait for Engine 2 wave marks.",
          "No chase.",
          "No paper entry.",
        ],
      },
    ],
    sideSections: [],
    action: "WAIT_FOR_ENGINE2_ES_WAVE_MARKS",
    needs: "WAIT_FOR_ENGINE2_WAVE_MARKS",
    risk: {
      chaseAllowed: false,
    },
    reasonCodes: [
      "TIMELINE_READ_SAFE_INCOMPLETE",
      reason,
    ],
  };
}

function buildEsWatchTradeDecision({ engine15 = null } = {}) {
  return buildSafeTradeDecision({
    symbol: "ES",
    setupType: "ES_RECLAIM_WATCH",
    reason:
      "ES has EOD long permission, but 4H and 1H are weak and 10m has no reclaim.",
    needs: [
      "10M_RECLAIM_EMA10_EMA20",
      "1H_STABILIZATION",
      "4H_IMPROVEMENT",
      "ENGINE3_REACTION_CONFIRMATION",
      "ENGINE4_PARTICIPATION_CONFIRMATION",
      "ENGINE15_READY_OR_PAPER_READY",
    ],
    reasonCodes: [
      "ES_WAIT_FOR_RECLAIM",
      "TEN_MIN_NO_TRIGGER",
      "ONE_HOUR_WEAK",
      "FOUR_HOUR_WEAK",
      engine15?.readinessLabel ? `ENGINE15_${engine15.readinessLabel}` : null,
    ].filter(Boolean),
  });
}

function buildIncompleteStrategy({
  symbol,
  strategyId,
  tf,
  currentPrice,
  reason = "ENGINE2_WAVE_STATE_INCOMPLETE",
} = {}) {
  const timelineRead = buildIncompleteTimelineRead({ symbol, reason });

  const tradeDecision = buildSafeTradeDecision({
    symbol,
    setupType: "NO_SETUP",
    reason: `${symbol} Engine 2 wave/fib marks are incomplete.`,
    needs: ["ENGINE2_WAVE_MARKS"],
    reasonCodes: [reason],
  });

  return {
    ok: true,
    engine: "engine22.waveStrategy.v1",
    mode: "READ_ONLY",
    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),

    headline: `${symbol} WAVE/FIB STATE INCOMPLETE — WAIT`,
    bias: "UNKNOWN",
    action: "WAIT_FOR_ENGINE2_ES_WAVE_MARKS",
    severity: "warning",

    activeSetup: "NO_SETUP",
    activeTradingDegree: "unknown",
    chaseRisk: "UNKNOWN",

    topCandidate: null,
    hardInvalidation: null,
    reclaimLadder: null,

    waveFibState: null,
    tradeContextSummary: null,
    timelineRead,
    tradeDecision,

    reasonCodes: [
      "ENGINE22G_WAVE_STRATEGY_SAFE_INCOMPLETE",
      reason,
    ],
  };
}

export function buildEngine22WaveStrategy({
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
  const normalizedRegimeLayers = normalizeRegimeLayersForWaveStrategy({
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

  const usableWaveState = hasUsableWaveState(engine2State);

  if (!usableWaveState) {
    return buildIncompleteStrategy({
      symbol,
      strategyId,
      tf,
      currentPrice: price,
      reason: "ENGINE2_WAVE_STATE_INCOMPLETE",
    });
  }

  const waveFibState = analyzeWaveStack({
    symbol,
    engine2State,
    currentPrice: price,
    regimeLayers: normalizedRegimeLayers,
    reactionContext,
    volumeContext,
    snapshotNow,
    currentTimeSec,
    barsByTf,
  });

  const tradeContextSummary = waveFibState?.tradeContextSummary || null;

  let timelineRead = buildTimelineRead({
    waveFibState,
    regimeLayers: normalizedRegimeLayers,
    reactionContext,
    volumeContext,
    breakoutContext,
  });

  let tradeDecision = buildSafeTradeDecision({
    symbol,
    setupType: waveFibState?.activeSetup || "NO_SETUP",
    reason: "Wave strategy is read-only. Waiting for confirmation.",
    needs: ["ENGINE15_READY_OR_PAPER_READY"],
    reasonCodes: ["READ_ONLY_WAIT"],
  });

  if (symbol === "ES") {
    const tenMinuteState = String(normalizedRegimeLayers?.tenMinute?.state || "").toUpperCase();
    const oneHourState = String(normalizedRegimeLayers?.oneHour?.state || "").toUpperCase();
    const fourHourState = String(normalizedRegimeLayers?.fourHour?.state || "").toUpperCase();

    const weakStructure =
      tenMinuteState.includes("BELOW") ||
      oneHourState.includes("BELOW") ||
      fourHourState.includes("BELOW") ||
      engine15?.readinessLabel === "WATCH";

    if (weakStructure) {
      tradeDecision = buildEsWatchTradeDecision({ engine15 });

      timelineRead = {
        ...timelineRead,
        severity: "warning",
        headline: "ES WATCH FOR RECLAIM — NO CLEAN LONG YET",
        subheadline:
          "Daily may allow long ideas, but 4H/1H are weak and 10m has not reclaimed EMA10/EMA20.",
        action: "WAIT_FOR_RECLAIM",
        needs: "WAIT_FOR_10M_RECLAIM_AND_1H_STABILIZATION",
        mainSections: [
          {
            title: "Market Read",
            severity: "warning",
            lines: [
              "ES has no clean long yet.",
              "Daily may still allow long ideas, but lower timeframes are not confirming.",
              "Wait for 10m reclaim, then 1H stabilization.",
            ],
          },
          {
            title: "Wave/Fib State",
            severity: "info",
            lines: [
              waveFibState?.summary || "ES wave/fib context is available but lower timeframe structure is weak.",
              `Active setup: ${text(waveFibState?.activeSetup)}`,
              `Active degree: ${text(waveFibState?.activeTradingDegree)}`,
              `Chase risk: ${text(waveFibState?.chaseRisk)}`,
            ],
          },
          ...(Array.isArray(timelineRead?.mainSections)
            ? timelineRead.mainSections.filter((s) =>
                ["10m Trigger Layer", "1H Pullback Layer", "4H Trend Layer", "EOD Regime Layer", "Action / Needs"].includes(s?.title)
              )
            : []),
        ],
        risk: {
          ...(timelineRead?.risk || {}),
          chaseAllowed: false,
        },
        reasonCodes: [
          ...(Array.isArray(timelineRead?.reasonCodes) ? timelineRead.reasonCodes : []),
          "ES_WAIT_FOR_RECLAIM",
          "NO_CLEAN_LONG_YET",
        ],
      };
    }
  }

  return {
    ok: waveFibState?.ok === true,
    engine: "engine22.waveStrategy.v1",
    mode: "READ_ONLY",

    symbol,
    strategyId,
    tf,
    currentPrice: round2(price),

    waveFibState,
    tradeContextSummary,
    timelineRead,
    tradeDecision,

    headline: timelineRead?.headline || tradeContextSummary?.headline || null,
    bias:
      symbol === "ES"
        ? "LONG_CAUTION"
        : tradeContextSummary?.bias || null,
    action: timelineRead?.action || tradeContextSummary?.action || "WAIT",
    severity: timelineRead?.severity || tradeContextSummary?.severity || "neutral",

    activeSetup:
      symbol === "ES" && timelineRead?.action === "WAIT_FOR_RECLAIM"
        ? "ES_RECLAIM_WATCH"
        : waveFibState?.activeSetup || null,

    activeTradingDegree: waveFibState?.activeTradingDegree || "unknown",
    chaseRisk: waveFibState?.chaseRisk || null,

    topCandidate:
      tradeContextSummary?.topCandidate ??
      waveFibState?.microW4AbcRisk?.topCandidate ??
      null,

    hardInvalidation:
      tradeContextSummary?.hardInvalidation ??
      waveFibState?.abcCorrection?.hardInvalidation ??
      waveFibState?.microW4AbcRisk?.hardInvalidation ??
      null,

    reclaimLadder:
      tradeContextSummary?.reclaimLadder ??
      waveFibState?.abcCorrection?.reclaimDisplay ??
      null,

    reasonCodes: [
      "ENGINE22G_WAVE_STRATEGY_BUILT",
      ...(Array.isArray(waveFibState?.reasonCodes) ? waveFibState.reasonCodes : []),
      ...(Array.isArray(tradeDecision?.reasonCodes) ? tradeDecision.reasonCodes : []),
    ],
  };
}

export default buildEngine22WaveStrategy;
