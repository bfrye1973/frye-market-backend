// services/core/logic/engine22/wave/buildEngine22WaveStrategy.js
// Engine 22G — Clean Wave Strategy Wrapper
//
// Purpose:
// Build the new standalone Engine 22G wave/fib strategy object.
// This keeps the new wave/fib brain OUT of the old giant engine22ScalpOpportunity.js.
//
// This is read-only.
// No trade entries.
// No paper trading.
// No live execution.
// No readiness/status changes.

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

function buildFallbackTimelineRead({ symbol, strategyId, reason = "UNKNOWN" }) {
  return {
    ok: false,
    source: "engine22.timelineRead.v1",
    severity: "neutral",
    headline: "Wave/Fib State unavailable",
    subheadline: "Engine 22G wave strategy could not build a timeline read.",
    waveStack: {},
    waveStackText: "Primary — | Intermediate — | Minor — | Minute — | Micro —",
    mainSections: [
      {
        title: "Action",
        severity: "neutral",
        lines: [
          "Wait for dashboard snapshot to populate.",
          `Reason: ${reason}`,
        ],
      },
    ],
    sideSections: [],
    action: "WAIT",
    needs: "ENGINE22G_WAVE_STRATEGY_UNAVAILABLE",
    risk: {},
    reasonCodes: [
      "ENGINE22G_TIMELINE_FALLBACK",
      reason,
    ],
    debug: {
      symbol,
      strategyId,
    },
  };
}

export function buildEngine22WaveStrategy({
  symbol = "SPY",
  strategyId = "intraday_scalp@10m",
  tf = "10m",

  engine2State = null,
  engine16 = null,
  marketMeter = null,

  currentPrice = null,
  regimeLayers = null,
  reactionContext = null,
  volumeContext = null,
  breakoutContext = null,

  snapshotNow = null,
  currentTimeSec = null,
  barsByTf = {},
} = {}) {
  const price = pickCurrentPrice({
    currentPrice,
    engine16,
    regimeLayers,
    marketMeter,
  });

  if (!engine2State || typeof engine2State !== "object") {
    const timelineRead = buildFallbackTimelineRead({
      symbol,
      strategyId,
      reason: "MISSING_ENGINE2_STATE",
    });

    return {
      ok: false,
      engine: "engine22.waveStrategy.v1",
      mode: "READ_ONLY",
      symbol,
      strategyId,
      tf,
      currentPrice: round2(price),
      waveFibState: null,
      tradeContextSummary: null,
      timelineRead,
      reasonCodes: ["MISSING_ENGINE2_STATE"],
    };
  }

  const waveFibState = analyzeWaveStack({
    symbol,
    engine2State,
    currentPrice: price,
    regimeLayers,
    reactionContext,
    volumeContext,
    snapshotNow,
    currentTimeSec,
    barsByTf,
  });

  const tradeContextSummary = waveFibState?.tradeContextSummary || null;

  const timelineRead = buildTimelineRead({
    waveFibState,
    regimeLayers,
    reactionContext,
    volumeContext,
    breakoutContext,
  });

  return {
    ok: waveFibState?.ok === true,
    engine: "engine22.waveStrategy.v1",
    mode: "READ_ONLY",

    symbol,
    strategyId,
    tf,
    currentPrice: round2(price),

    // Main Engine 22G outputs
    waveFibState,
    tradeContextSummary,
    timelineRead,

    // Convenience fields for frontend / quick jq checks
    headline: tradeContextSummary?.headline || timelineRead?.headline || null,
    bias: tradeContextSummary?.bias || null,
    action: tradeContextSummary?.action || timelineRead?.action || "WAIT",
    severity: tradeContextSummary?.severity || timelineRead?.severity || "neutral",

    activeSetup: waveFibState?.activeSetup || null,
    activeTradingDegree: waveFibState?.activeTradingDegree || null,
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
    ],
  };
}

export default buildEngine22WaveStrategy;
