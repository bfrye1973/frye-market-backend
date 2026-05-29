// services/core/logic/engine22/wave/buildEngine22WaveStrategy.js
// Engine 22G — Clean Wave Strategy Wrapper
//
// Purpose:
// Coordinate Engine 22G wave/fib strategy output.
//
// Architecture:
// - Adapters normalize market-specific input.
// - Generic wave/fib core analyzes wave state.
// - waveOpportunity is the PRE-ENGINE15 source of truth for W3/W5 opportunity.
// - timelineRead is display/read layer.
// - tradeDecision is post-Engine15 / PAPER_ONLY decision context.
//
// Locked role:
// Engine 22 finds Elliott Wave W3/W5 opportunities.
// Engine 15ES referees readiness.
// Engine 6 permits.
// Engine 7 sizes.
// Engine 8 executes only if executable=true.
//
// This file should NOT become an ES monster file.
// This file should NOT contain broker logic.
// This file should NOT route orders.
// This file stays READ_ONLY / PAPER_ONLY.

import { analyzeWaveStack } from "./analyzeWaveStack.js";
import { buildTradeContextSummary } from "./buildTradeContextSummary.js";
import { buildTimelineRead } from "./buildTimelineRead.js";
import { buildStockWaveContext } from "./adapters/buildStockWaveContext.js";
import { buildFuturesWaveContext } from "./adapters/buildFuturesWaveContext.js";
import { buildWaveTradeDecision } from "../decisions/buildWaveTradeDecision.js";
import { buildTargetClusterConfidence } from "./buildTargetClusterConfidence.js";
import { buildWaveOpportunity } from "../opportunity/buildWaveOpportunity.js";

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function normalizeSymbol(symbol) {
  const s = String(symbol || "SPY").trim().toUpperCase();
  return s || "SPY";
}

function isFuturesSymbol(symbol, marketType = null) {
  const s = normalizeSymbol(symbol);
  const mt = String(marketType || "").toUpperCase();

  return (
    mt === "FUTURES" ||
    s === "ES" ||
    s.startsWith("ES") ||
    s === "MES" ||
    s.startsWith("MES") ||
    s === "NQ" ||
    s.startsWith("NQ") ||
    s === "MNQ" ||
    s.startsWith("MNQ")
  );
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

function buildSafetyObject() {
  return {
    liveTradingEnabled: false,
    brokerCallsEnabled: false,
    orderRoutingEnabled: false,
    optionsExecutionEnabled: false,
    paperOnly: true,
    noBlindShorts: true,
  };
}

function buildSafeTradeDecision({
  symbol,
  strategyId = "intraday_scalp@10m",
  setupType = "NO_SETUP",
  reason = "Wave strategy is waiting.",
  needs = [],
  reasonCodes = [],
} = {}) {
  return {
    mode: "PAPER_ONLY",
    engine: "engine22.tradeDecision.safeFallback.v1",
    symbol,
    strategyId,
    decision: "WAIT",
    direction: "NONE",
    setupType,
    grade: "NO_TRADE",
    entryAllowed: false,
    chaseAllowed: false,
    reason,
    needs,
    reasonCodes: ["PAPER_ONLY", ...reasonCodes],
    safety: buildSafetyObject(),
  };
}

function buildIncompleteTimelineRead({ symbol, reason }) {
  return {
    ok: true,
    source: "engine22.timelineRead.v1",
    severity: "warning",
    headline: `${symbol} WAVE/FIB STATE INCOMPLETE — WAIT`,
    subheadline:
      "Engine 2 wave/fib marks are incomplete. Waiting for valid wave structure.",
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
    action: "WAIT_FOR_ENGINE2_WAVE_MARKS",
    needs: "WAIT_FOR_ENGINE2_WAVE_MARKS",
    risk: {
      chaseAllowed: false,
    },
    reasonCodes: ["TIMELINE_READ_SAFE_INCOMPLETE", reason],
  };
}

function buildIncompleteWaveOpportunity({
  symbol,
  strategyId,
  currentPrice,
  reason = "ENGINE2_WAVE_STATE_INCOMPLETE",
} = {}) {
  return {
    ok: true,
    engine: "engine22.waveOpportunity.v1",
    symbol,
    strategyId,
    currentPrice: round2(currentPrice),
    active: false,
    setupFamily: "ELLIOTT_WAVE",
    setupType: "NONE",
    rawSetup: "NO_W3_W5_OPPORTUNITY",
    degree: "unknown",
    direction: "NONE",
    readiness: "NO_SETUP",
    timing: "UNKNOWN",
    waveState: {
      primary: "UNKNOWN",
      intermediate: "UNKNOWN",
      minor: "UNKNOWN",
      minute: "UNKNOWN",
      micro: "UNKNOWN",
    },
    entryZone: {
      type: "NONE",
      lo: null,
      hi: null,
      trigger: null,
    },
    invalidation: {
      price: null,
      reason: "No valid wave state available.",
    },
    targets: {
      e100: null,
      e1272: null,
      e1618: null,
      e200: null,
      e2618: null,
    },
    chaseRisk: "UNKNOWN",
    needs: ["ENGINE2_WAVE_MARKS"],
    reasonCodes: ["NO_W3_W5_OPPORTUNITY", reason],
    summary:
      "No valid Elliott Wave 3 or Wave 5 opportunity is available because Engine 2 wave/fib marks are incomplete.",
  };
}

function buildIncompleteStrategy({
  symbol,
  strategyId,
  tf,
  currentPrice,
  marketType,
  reason = "ENGINE2_WAVE_STATE_INCOMPLETE",
} = {}) {
  const timelineRead = buildIncompleteTimelineRead({ symbol, reason });

  const tradeDecision = buildSafeTradeDecision({
    symbol,
    strategyId,
    setupType: "NO_SETUP",
    reason: `${symbol} Engine 2 wave/fib marks are incomplete.`,
    needs: ["ENGINE2_WAVE_MARKS"],
    reasonCodes: [reason],
  });

  const waveOpportunity = buildIncompleteWaveOpportunity({
    symbol,
    strategyId,
    currentPrice,
    reason,
  });

  return {
    ok: true,
    engine: "engine22.waveStrategy.v1",
    mode: "READ_ONLY",
    marketType,
    symbol,
    strategyId,
    tf,
    currentPrice: round2(currentPrice),

    headline: `${symbol} WAVE/FIB STATE INCOMPLETE — WAIT`,
    bias: "UNKNOWN",
    action: "WAIT_FOR_ENGINE2_WAVE_MARKS",
    severity: "warning",

    activeSetup: "NO_SETUP",
    activeTradingDegree: "unknown",
    chaseRisk: "UNKNOWN",

    topCandidate: null,
    hardInvalidation: null,
    reclaimLadder: null,

    waveFibState: null,
    w4Levels: null,
    tradeContextSummary: null,
    targetClusterConfidence: null,

    // Pre-Engine15 source of truth.
    waveOpportunity,

    // Display / paper-only context.
    timelineRead,
    tradeDecision,

    reasonCodes: ["ENGINE22G_WAVE_STRATEGY_SAFE_INCOMPLETE", reason],
  };
}

function buildTradeDecisionSafe({
  context,
  waveFibState,
  tradeContextSummary,
  timelineRead,
  waveOpportunity,
} = {}) {
  try {
    const decision = buildWaveTradeDecision({
      symbol: context.symbol,
      strategyId: context.strategyId,
      engine22WaveStrategy: {
        waveFibState,
        tradeContextSummary,
        timelineRead,
        waveOpportunity,
      },
      engine15: context.engine15,
      engine16: context.engine16,
      reactionContext: context.reactionContext,
      volumeContext: context.volumeContext,
    });

    if (decision && typeof decision === "object") {
      return {
        ...decision,
        mode: decision.mode || "PAPER_ONLY",
        safety: {
          ...buildSafetyObject(),
          ...(decision.safety || {}),
          liveTradingEnabled: false,
          brokerCallsEnabled: false,
          orderRoutingEnabled: false,
          optionsExecutionEnabled: false,
          paperOnly: true,
        },
      };
    }
  } catch (err) {
    return buildSafeTradeDecision({
      symbol: context.symbol,
      strategyId: context.strategyId,
      setupType:
        waveOpportunity?.setupType || waveFibState?.activeSetup || "NO_SETUP",
      reason: `Trade decision builder failed safely: ${
        err?.message || "unknown error"
      }`,
      needs: ["TRADE_DECISION_REVIEW"],
      reasonCodes: ["TRADE_DECISION_SAFE_FALLBACK"],
    });
  }

  return buildSafeTradeDecision({
    symbol: context.symbol,
    strategyId: context.strategyId,
    setupType:
      waveOpportunity?.setupType || waveFibState?.activeSetup || "NO_SETUP",
    reason: "Wave strategy is read-only. Waiting for confirmation.",
    needs: ["ENGINE15_READY_OR_PAPER_READY"],
    reasonCodes: ["READ_ONLY_WAIT"],
  });
}

function getActiveW4Levels(waveFibState) {
  const activeDegree = waveFibState?.activeTradingDegree || null;

  return (
    waveFibState?.w4Levels ||
    (activeDegree ? waveFibState?.degrees?.[activeDegree]?.w4Levels : null) ||
    null
  );
}

function buildPreEngine15WaveOpportunity({
  context,
  waveFibState,
  tradeContextSummary,
  targetClusterConfidence,
  w4Levels,
} = {}) {
  try {
    return buildWaveOpportunity({
      symbol: context.symbol,
      strategyId: context.strategyId,
      currentPrice: context.currentPrice,

      // IMPORTANT:
      // This is intentionally pre-Engine15 and must not use tradeDecision
      // or timelineRead as source of truth.
      engine22WaveStrategy: {
        waveFibState,
        tradeContextSummary,
        targetClusterConfidence,
        activeSetup: waveFibState?.activeSetup,
        activeTradingDegree: waveFibState?.activeTradingDegree,
        chaseRisk: waveFibState?.chaseRisk,
        w4Levels,
      },

      // Engine 22F read-only supportive context.
      // This context may upgrade WATCH -> ARMING only.
      // It must never create READY, GO, ALLOW, or execution.
      engine16: context.engine16,
      engine25Context: context.engine25Context,
      marketRegime: context.marketRegime,
      marketMeterContext: context.marketMeterContext,
      engine5: context.engine5,
    });
  } catch (err) {
    return {
      ok: false,
      engine: "engine22.waveOpportunity.v1",
      symbol: context?.symbol || "ES",
      strategyId: context?.strategyId || "intraday_scalp@10m",
      currentPrice: round2(context?.currentPrice),
      active: false,
      setupFamily: "ELLIOTT_WAVE",
      setupType: "NONE",
      rawSetup: "WAVE_OPPORTUNITY_ERROR",
      degree: "unknown",
      direction: "NONE",
      readiness: "NO_SETUP",
      timing: "UNKNOWN",
      waveState: {},
      entryZone: {
        type: "NONE",
        lo: null,
        hi: null,
        trigger: null,
      },
      invalidation: {
        price: null,
        reason: "Wave opportunity builder failed.",
      },
      targets: {
        e100: null,
        e1272: null,
        e1618: null,
        e200: null,
        e2618: null,
      },
      chaseRisk: "UNKNOWN",
      needs: ["FIX_ENGINE22_WAVE_OPPORTUNITY"],
      reasonCodes: ["ENGINE22_WAVE_OPPORTUNITY_ERROR"],
      summary: `Engine 22 waveOpportunity failed safely: ${
        err?.message || "unknown error"
      }`,
      debug: {
        error: String(err?.message || err),
        stack: String(err?.stack || ""),
      },
    };
  }
}

export function buildEngine22WaveStrategy(input = {}) {
  const symbol = normalizeSymbol(input?.symbol || "SPY");
  const marketType = isFuturesSymbol(symbol, input?.marketType)
    ? "FUTURES"
    : "STOCK";

  const context =
    marketType === "FUTURES"
      ? buildFuturesWaveContext({
          ...input,
          symbol,
          marketType,
        })
      : buildStockWaveContext({
          ...input,
          symbol,
          marketType,
        });

  const usableWaveState = hasUsableWaveState(context.engine2State);

  if (!usableWaveState) {
    return buildIncompleteStrategy({
      symbol: context.symbol,
      strategyId: context.strategyId,
      tf: context.tf,
      currentPrice: context.currentPrice,
      marketType: context.marketType,
      reason: "ENGINE2_WAVE_STATE_INCOMPLETE",
    });
  }

  const waveFibState = analyzeWaveStack({
    symbol: context.symbol,
    engine2State: context.engine2State,
    currentPrice: context.currentPrice,
    regimeLayers: context.regimeLayers,
    reactionContext: context.reactionContext,
    volumeContext: context.volumeContext,
    snapshotNow: context.snapshotNow,
    currentTimeSec: context.currentTimeSec,
    barsByTf: context.barsByTf,
  });

  const tradeContextSummary =
    waveFibState?.tradeContextSummary ||
    buildTradeContextSummary({
      waveFibState,
      context,
    });

  const targetClusterConfidence = buildTargetClusterConfidence({
    symbol: context.symbol,
    waveFibState,
    fibKey: "e1618",
  });

  const w4Levels = getActiveW4Levels(waveFibState);

  // PRE-ENGINE15 CONTRACT:
  // This is the clean W3/W5 wave-opportunity source that Engine 15ES should consume.
  // It must stay independent from tradeDecision and timelineRead.
  const waveOpportunity = buildPreEngine15WaveOpportunity({
    context,
    waveFibState,
    tradeContextSummary,
    targetClusterConfidence,
    w4Levels,
  });

  // DISPLAY LAYER:
  // Timeline can use Engine15 for wording, but it is not the source of opportunity truth.
  const timelineRead = buildTimelineRead({
    waveFibState,
    tradeContextSummary,
    targetClusterConfidence,
    regimeLayers: context.regimeLayers,
    reactionContext: context.reactionContext,
    volumeContext: context.volumeContext,
    breakoutContext: context.breakoutContext,
    engine15: context.engine15,
    engine16: context.engine16,
    marketType: context.marketType,
    sessionProfile: context.sessionProfile,
  });

  // POST-ENGINE15 / PAPER-ONLY CONTEXT:
  // This may look at Engine15 and confirmations, but it remains separate.
  const tradeDecision = buildTradeDecisionSafe({
    context,
    waveFibState,
    tradeContextSummary,
    timelineRead,
    waveOpportunity,
  });

  return {
    ok: waveFibState?.ok === true,
    engine: "engine22.waveStrategy.v1",
    mode: "READ_ONLY",

    marketType: context.marketType,
    symbol: context.symbol,
    strategyId: context.strategyId,
    tf: context.tf,
    currentPrice: round2(context.currentPrice),

    waveFibState,
    w4Levels,
    tradeContextSummary,
    targetClusterConfidence,

    // Primary Engine 22 contract for Engine 15ES.
    waveOpportunity,

    // Secondary/read-only layers.
    timelineRead,
    tradeDecision,

    headline: tradeContextSummary?.headline || timelineRead?.headline || null,
    bias: tradeContextSummary?.bias || null,
    action: tradeContextSummary?.action || timelineRead?.action || "WAIT",
    severity:
      tradeContextSummary?.severity || timelineRead?.severity || "neutral",

    activeSetup: waveFibState?.activeSetup || null,
    activeTradingDegree: waveFibState?.activeTradingDegree || "unknown",
    chaseRisk: waveFibState?.chaseRisk || waveOpportunity?.chaseRisk || null,

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
      "ENGINE22_WAVE_OPPORTUNITY_PRE_ENGINE15",
      ...(Array.isArray(context?.reasonCodes) ? context.reasonCodes : []),
      ...(Array.isArray(waveFibState?.reasonCodes)
        ? waveFibState.reasonCodes
        : []),
      ...(Array.isArray(tradeContextSummary?.reasonCodes)
        ? tradeContextSummary.reasonCodes
        : []),
      ...(Array.isArray(waveOpportunity?.reasonCodes)
        ? waveOpportunity.reasonCodes
        : []),
      ...(Array.isArray(tradeDecision?.reasonCodes)
        ? tradeDecision.reasonCodes
        : []),
    ],
  };
}

export default buildEngine22WaveStrategy;
