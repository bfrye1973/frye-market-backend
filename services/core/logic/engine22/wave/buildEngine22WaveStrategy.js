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
//6f
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
import { resolveCurrentLifecycleState } from "./lifecycle/core/resolveCurrentLifecycleState.js";
import { buildDegreeStates } from "./buildDegreeStates.js";

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

function allowActiveWaveStateFallback(context = {}) {
  const symbol = normalizeSymbol(context?.symbol || "SPY");
  const strategyId = String(context?.strategyId || "").trim();

  // ES active-wave-state is now the manager-approved canonical structural source
  // when Engine 2 runtime marks are temporarily incomplete.
  // This lets analyzeWaveStack load active-wave-state-es.json and still publish
  // waveFibState.activeStructures -> degreeStates.
  if (!isFuturesSymbol(symbol, context?.marketType)) return false;

  return strategyId === "intraday_scalp@10m";
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

function getPostMinor5DownImpulse(waveFibState = null) {
  const downImpulse =
    waveFibState?.lifecycle?.postAbcReset?.downImpulse || null;

  const state = String(downImpulse?.state || "").toUpperCase();

  if (
    state === "POST_MINOR_5_CORRECTIVE_BOUNCE_WATCH" ||
    state === "MINOR_DOWN_IMPULSE_COMPLETE_AT_LOW"
  ) {
    return downImpulse;
  }

  return null;
}

function buildPostMinor5CorrectiveBounceOpportunity({
  baseOpportunity = null,
  context,
  waveFibState,
  tradeContextSummary,
  downImpulse,
} = {}) {
  const currentPrice =
    downImpulse?.currentPrice ??
    context?.currentPrice ??
    waveFibState?.currentPrice ??
    null;

  const completedLow =
    downImpulse?.completedLow ??
    downImpulse?.marks?.w5Low ??
    null;

  const waveCHigh =
    downImpulse?.waveCHigh ??
    waveFibState?.lifecycle?.postAbcReset?.abcUp?.waveCHigh ??
    null;

  const originLow =
    downImpulse?.originLow ??
    waveFibState?.lifecycle?.postAbcReset?.abcUp?.originLow ??
    null;

  const structuralBLow =
    downImpulse?.structuralBLow ??
    waveFibState?.lifecycle?.postAbcReset?.abcUp?.effectiveWaveBLow ??
    null;

  return {
    ...(baseOpportunity || {}),
    ok: true,
    engine: "engine22.waveOpportunity.v1",
    symbol: context?.symbol || baseOpportunity?.symbol || "ES",
    strategyId:
      context?.strategyId ||
      baseOpportunity?.strategyId ||
      "intraday_scalp@10m",
    currentPrice: round2(currentPrice),

    active: false,
    setupFamily: "ELLIOTT_WAVE",
    setupType: "POST_MINOR_5_CORRECTIVE_BOUNCE_WATCH",
    rawSetup: "POST_MINOR_5_CORRECTIVE_BOUNCE_WATCH",
    degree: "minor",
    direction: "NONE",
    readiness: "WATCH",
    timing: "POST_IMPULSE_BOUNCE_WATCH",
    chaseRisk: "HIGH",

    entryZone: {
      type: "NONE",
      lo: null,
      hi: null,
      trigger: null,
    },

    invalidation: {
      price: round2(completedLow),
      reason:
        "If price loses the completed Minor W5 low again, the corrective bounce watch fails and downside continuation risk returns.",
    },

    targets: {
      e100: null,
      e1272: null,
      e1618: null,
      e200: null,
      e2618: null,
    },

    completedImpulse: {
      degree: "minor",
      completedLow: round2(completedLow),
      completedTime: downImpulse?.completedTime || null,
      waveCHigh: round2(waveCHigh),
      originLow: round2(originLow),
      structuralBLow: round2(structuralBLow),
      currentPrice: round2(currentPrice),
      reclaimedOrigin: downImpulse?.reclaimedOrigin === true,
      reclaimedStructuralB: downImpulse?.reclaimedStructuralB === true,
      reclaimedWaveCHigh: downImpulse?.reclaimedWaveCHigh === true,
      belowWaveCHigh: downImpulse?.belowWaveCHigh === true,
    },

    bothPaths: {
      correctiveBouncePath:
        "If price holds above the completed Minor W5 low, watch corrective A/B/C bounce or reclaim-test structure.",
      failurePath:
        "If price loses the completed Minor W5 low, the bounce watch fails and downside continuation risk returns.",
      reclaimPath:
        "If price reclaims the prior C/W2 high, the higher-timeframe decision shifts upward and the completed-down impulse read may need reassessment.",
    },

    needs: [
      "WATCH_CORRECTIVE_BOUNCE_STRUCTURE",
      "WAIT_FOR_HTF_DECISION",
      "HOLD_ABOVE_COMPLETED_W5_LOW",
      "RECLAIM_TEST_REQUIRED",
      "NO_AUTOMATIC_LONG",
      "NO_AUTOMATIC_SHORT",
      "NO_EXECUTION",
    ],

    reasonCodes: [
      "POST_MINOR_5_CORRECTIVE_BOUNCE_WATCH",
      "MINOR_5_DOWN_COMPLETE",
      "BOTH_PATHS_TRACKED",
      "READ_ONLY",
      "NO_AUTOMATIC_LONG",
      "NO_AUTOMATIC_SHORT",
      "NO_EXECUTION",
      ...(Array.isArray(baseOpportunity?.reasonCodes)
        ? baseOpportunity.reasonCodes
        : []),
      ...(Array.isArray(tradeContextSummary?.reasonCodes)
        ? tradeContextSummary.reasonCodes
        : []),
      ...(Array.isArray(downImpulse?.reasonCodes)
        ? downImpulse.reasonCodes
        : []),
    ],

    summary:
      "Minor 5 down is complete. Current rally is a corrective bounce / reclaim test. Watch both paths: reclaim continuation toward higher-timeframe decision, or bounce failure back below the completed W5 low.",
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

function markPrice(mark) {
  const direct = Number(mark?.price ?? mark?.p);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const high = Number(mark?.high?.price ?? mark?.high?.p);
  if (Number.isFinite(high) && high > 0) return high;

  const low = Number(mark?.low?.price ?? mark?.low?.p);
  if (Number.isFinite(low) && low > 0) return low;

  return null;
}

function markTime(mark) {
  return (
    mark?.time ??
    mark?.t ??
    mark?.high?.time ??
    mark?.low?.time ??
    null
  );
}

function calcBullishExtensions({ base, range }) {
  const b = Number(base);
  const r = Number(range);

  if (!Number.isFinite(b) || !Number.isFinite(r) || r <= 0) {
    return {
      e100: null,
      e1272: null,
      e1618: null,
      e200: null,
      e2618: null,
    };
  }

  return {
    e100: round2(b + r * 1.0),
    e1272: round2(b + r * 1.272),
    e1618: round2(b + r * 1.618),
    e200: round2(b + r * 2.0),
    e2618: round2(b + r * 2.618),
  };
}

function calcRetracementsFromHigh({ start, high }) {
  const s = Number(start);
  const h = Number(high);

  if (!Number.isFinite(s) || !Number.isFinite(h) || h <= s) {
    return {
      r236: null,
      r382: null,
      r500: null,
      r618: null,
      r786: null,
    };
  }

  const range = h - s;

  return {
    r236: round2(h - range * 0.236),
    r382: round2(h - range * 0.382),
    r500: round2(h - range * 0.5),
    r618: round2(h - range * 0.618),
    r786: round2(h - range * 0.786),
  };
}

function firstNonNull(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      typeof value !== "number"
    ) {
      return value;
    }
  }
  return null;
}

function getActiveStructuresFromWaveFibState(waveFibState, engine2State) {
  return (
    waveFibState?.activeStructures ||
    waveFibState?.activeWaveState?.activeStructures ||
    engine2State?.activeStructures ||
    {}
  );
}

function buildIntermediateLongTermLifecycleView({
  context,
  waveFibState,
  currentLifecycleState,
}) {
  const structures = getActiveStructuresFromWaveFibState(
    waveFibState,
    context?.engine2State
  );

  const intermediate =
    structures?.intermediate ||
    context?.engine2State?.intermediate ||
    null;

  const marks = intermediate?.marks || intermediate?.waveMarks || {};

  const w1High = firstNonNull(
    markPrice(marks?.W1),
    markPrice(intermediate?.marks?.W1),
    markPrice(context?.engine2State?.intermediate?.waveMarks?.W1)
  );

  const w2Low = firstNonNull(
    markPrice(marks?.W2),
    markPrice(intermediate?.marks?.W2),
    markPrice(context?.engine2State?.intermediate?.waveMarks?.W2)
  );

  const currentPrice = round2(
    context?.currentPrice ??
      waveFibState?.currentPrice ??
      currentLifecycleState?.currentPrice
  );

  const range =
    Number.isFinite(Number(w1High)) && Number.isFinite(Number(w2Low))
      ? Math.abs(Number(w1High) - Number(w2Low))
      : null;

  const levels =
    range && w2Low
      ? calcBullishExtensions({
          base: w2Low,
          range,
        })
      : {
          e100: null,
          e1272: null,
          e1618: null,
          e200: null,
          e2618: null,
        };

  const nextTarget =
    Object.values(levels).find(
      (level) =>
        Number.isFinite(Number(level)) &&
        Number.isFinite(Number(currentPrice)) &&
        Number(level) > Number(currentPrice)
    ) ?? null;

  return {
    key: "INTERMEDIATE_W3_ACTIVE",
    label: "Intermediate W3 active",
    source: "engine22.lifecycleViews.longTerm",
    activeDegree: "intermediate",
    activeWave:
      intermediate?.activeWave ||
      waveFibState?.activeStructures?.intermediate?.activeWave ||
      "W3",
    direction: "LONG",
    contextOnly: true,
    noExecution: true,

    anchors: {
      w1High: round2(w1High),
      w1Time: markTime(marks?.W1),
      w2Low: round2(w2Low),
      w2Time: markTime(marks?.W2),
      currentPrice,
    },

    fibMap: {
      source: "INTERMEDIATE_W2_TO_W3_EXTENSION",
      purpose: "Higher-timeframe destination map. Not an intraday entry signal.",
      anchorHigh: round2(w1High),
      projectionBase: round2(w2Low),
      range: round2(range),
      levels,
      nextTarget,
      higherTargets: Object.values(levels).filter(
        (level) =>
          Number.isFinite(Number(level)) &&
          Number.isFinite(Number(currentPrice)) &&
          Number(level) > Number(currentPrice)
      ),
    },

    status: "CONTEXT_ONLY",
    summary:
      "Intermediate W3 is active. This is the higher-timeframe bullish context and target roadmap, not a standalone scalp trigger.",
    reasonCodes: [
      "ENGINE22_LIFECYCLE_VIEW_LONG_TERM_BUILT",
      "INTERMEDIATE_W3_ACTIVE_CONTEXT",
      "NO_EXECUTION",
    ],
  };
}

function buildMinuteIntradayScalpLifecycleView({
  context,
  waveFibState,
  currentLifecycleState,
  waveOpportunity,
}) {
  const structures = getActiveStructuresFromWaveFibState(
    waveFibState,
    context?.engine2State
  );

  const minute =
    structures?.minute ||
    context?.engine2State?.minute ||
    null;

  const marks = minute?.marks || minute?.waveMarks || {};

  const w1Low = firstNonNull(
    markPrice(marks?.W1?.low),
    round2(marks?.W1?.low?.price),
    round2(marks?.W1?.low?.p),
    markPrice(context?.engine2State?.activeStructures?.minute?.marks?.W1?.low),
    round2(context?.engine2State?.activeStructures?.minute?.marks?.W1?.low?.price),
    markPrice(context?.engine2State?.minute?.waveMarks?.W1?.low),
    markPrice(context?.engine2State?.minute?.waveMarks?.W1)
  );

  const w1High = firstNonNull(
    markPrice(marks?.W1?.high),
    round2(marks?.W1?.high?.price),
    round2(marks?.W1?.high?.p),
    markPrice(context?.engine2State?.activeStructures?.minute?.marks?.W1?.high),
    round2(context?.engine2State?.activeStructures?.minute?.marks?.W1?.high?.price),
    markPrice(context?.engine2State?.minute?.waveMarks?.W1?.high),
    markPrice(context?.engine2State?.minute?.waveMarks?.W1)
  );

  const w2Low = firstNonNull(
    markPrice(marks?.W2),
    markPrice(context?.engine2State?.minute?.waveMarks?.W2)
  );

  const w3High = firstNonNull(
    markPrice(marks?.W3),
    markPrice(context?.engine2State?.minute?.waveMarks?.W3)
  );

  const currentPrice = round2(
    context?.currentPrice ??
      waveFibState?.currentPrice ??
      currentLifecycleState?.currentPrice
  );

  const pullbackLevels = calcRetracementsFromHigh({
    start: w2Low,
    high: w3High,
  });

  const preferredW4Zone =
    Number.isFinite(Number(pullbackLevels.r500)) &&
    Number.isFinite(Number(pullbackLevels.r618))
      ? {
          label: "0.5–0.618 Minute W4 pullback zone",
          lo: Math.min(pullbackLevels.r500, pullbackLevels.r618),
          hi: Math.max(pullbackLevels.r500, pullbackLevels.r618),
        }
      : null;

  const triggerLevels =
    currentLifecycleState?.confirmationContext?.reference || {};

  return {
    key:
      currentLifecycleState?.key ||
      "MINUTE_W3_COMPLETE_W4_PULLBACK_WATCH",
    label:
      currentLifecycleState?.headline ||
      "Minute W4 pullback — wait for reclaim",
    source: "engine22.lifecycleViews.intradayScalp",

    activeDegree: "minute",
    activeWave:
      minute?.activeWave ||
      waveFibState?.activeStructures?.minute?.activeWave ||
      "W4",
    parentDegree: minute?.parentDegree || "intermediate",
    parentWave: minute?.parentWave || "W3",

    direction: "LONG_AFTER_CONFIRMATION",
    paperScalpContext: true,
    noChase: true,
    noExecution: true,

    anchors: {
      w1Low: round2(w1Low),
      w1High: round2(w1High),
      w2Low: round2(w2Low),
      w3High: round2(w3High),
      w3Time: markTime(marks?.W3),
      currentPrice,
    },

    fibMap: {
      source: "MINUTE_W3_RETRACE_FOR_W4",
      purpose:
        "Intraday paper-scalp location map. Watch these W4 pullback / reclaim levels; not an entry signal by itself.",
      wave3Start: round2(w2Low),
      wave3High: round2(w3High),
      currentPrice,
      pullbackLevels,
      preferredW4Zone,
      reclaimLevels: {
        reclaimLevel: round2(triggerLevels?.reclaimLevel),
        triggerLevel: round2(triggerLevels?.triggerLevel),
        priorCandleHigh: round2(triggerLevels?.priorCandleHigh),
        localRangeHigh: round2(triggerLevels?.localRangeHigh),
      },
      invalidationLevel: round2(
        triggerLevels?.invalidationLevel ??
          w2Low
      ),
      ifW4HoldsNextTargets: {
        source: "WAVE_OPPORTUNITY_TARGETS_IF_AVAILABLE",
        e100: round2(waveOpportunity?.targets?.e100),
        e1272: round2(waveOpportunity?.targets?.e1272),
        e1618: round2(waveOpportunity?.targets?.e1618),
        e200: round2(waveOpportunity?.targets?.e200),
        e2618: round2(waveOpportunity?.targets?.e2618),
      },
    },

    playbookContext: {
      topImbalanceLabel: "MINUTE_W3_TOP_POSSIBLE",
      pullbackLabel: "WATCH_W4_PULLBACK",
      chaseLabel: "LONG_CHASE_BLOCKED",
      permissionRequired: "ENGINE6_PAPER_ALLOW_REQUIRED",
    },

    status: "WATCH_ONLY",
    summary:
      "Minute W3 may be complete and Minute W4 pullback is being watched. Do not chase vertical price. Wait for controlled pullback, reclaim hold, Engine 3/4 confirmation, Engine 15 readiness, and Engine 6 paper permission.",
    reasonCodes: [
      "ENGINE22_LIFECYCLE_VIEW_INTRADAY_SCALP_BUILT",
      "MINUTE_W4_PULLBACK_WATCH",
      "NO_CHASE",
      "NO_EXECUTION",
    ],
  };
}

function buildLifecycleViews({
  context,
  waveFibState,
  currentLifecycleState,
  waveOpportunity,
}) {
  const longTerm = buildIntermediateLongTermLifecycleView({
    context,
    waveFibState,
    currentLifecycleState,
  });

  const intradayScalp = buildMinuteIntradayScalpLifecycleView({
    context,
    waveFibState,
    currentLifecycleState,
    waveOpportunity,
  });

  return {
    source: "engine22.lifecycleViews.v1",
    longTerm,
    intradayScalp,
    reasonCodes: [
      "ENGINE22_LIFECYCLE_VIEWS_BUILT",
      "LONG_TERM_AND_INTRADAY_SCALP_SPLIT",
      "FIB_MAPS_ATTACHED_TO_EACH_LIFECYCLE",
      "NO_EXECUTION",
    ],
  };
}

function buildLifecycleContextForEngine26({
  lifecycleViews,
  currentLifecycleState,
} = {}) {
  const longTerm = lifecycleViews?.longTerm || null;
  const intraday = lifecycleViews?.intradayScalp || null;

  const longTermFib = longTerm?.fibMap || {};
  const intradayFib = intraday?.fibMap || {};
  const intradayAnchors = intraday?.anchors || {};

  const preferredW4Zone = intradayFib?.preferredW4Zone || null;

  return {
    source: "engine22.lifecycleContext.v1",
    purpose: "COMPACT_CONTEXT_FOR_ENGINE26_IMBALANCE_WATCH",
    noExecution: true,
    noPermissionCreated: true,

    longTermLifecycle: longTerm
      ? {
          active: true,
          key: longTerm.key || "INTERMEDIATE_W3_ACTIVE",
          lifecycle: longTerm.key || "INTERMEDIATE_W3_ACTIVE",
          activeWave: "INTERMEDIATE_W3",
          activeDegree: longTerm.activeDegree || "intermediate",
          direction: longTerm.direction || "LONG",
          purpose: "HIGHER_TIMEFRAME_CONTEXT_ONLY",

          currentPrice: longTerm?.anchors?.currentPrice ?? null,
          w1High: longTerm?.anchors?.w1High ?? null,
          w2Low: longTerm?.anchors?.w2Low ?? null,

          nextTarget: longTermFib?.nextTarget ?? null,
          higherTargets: Array.isArray(longTermFib?.higherTargets)
            ? longTermFib.higherTargets
            : [],

          noExecution: true,
          noPermissionCreated: true,

          summary:
            longTerm.summary ||
            "Intermediate W3 is active. This is higher-timeframe context only, not a standalone scalp trigger.",

          reasonCodes: [
            "ENGINE22_LONG_TERM_LIFECYCLE_CONTEXT",
            "HIGHER_TIMEFRAME_CONTEXT_ONLY",
            "NO_EXECUTION",
            "NO_PERMISSION_CREATED",
          ],
        }
      : {
          active: false,
          key: "NO_LONG_TERM_LIFECYCLE_CONTEXT",
          lifecycle: "NO_LONG_TERM_LIFECYCLE_CONTEXT",
          activeWave: null,
          direction: "NONE",
          purpose: "HIGHER_TIMEFRAME_CONTEXT_ONLY",
          noExecution: true,
          noPermissionCreated: true,
          reasonCodes: ["ENGINE22_LONG_TERM_LIFECYCLE_CONTEXT_MISSING"],
        },

    intradayScalpLifecycle: intraday
      ? {
          active: true,
          key: "MINUTE_W4_PULLBACK_WAIT_FOR_RECLAIM",
          lifecycle: "MINUTE_W4_PULLBACK_WAIT_FOR_RECLAIM",
          sourceKey:
            intraday.key ||
            currentLifecycleState?.key ||
            "MINUTE_W3_COMPLETE_W4_PULLBACK_WATCH",

          activeWave: "MINUTE_W4",
          activeDegree: intraday.activeDegree || "minute",
          parentWave: "INTERMEDIATE_W3",
          parentDegree: intraday.parentDegree || "intermediate",

          direction: intraday.direction || "LONG_AFTER_CONFIRMATION",
          action:
            currentLifecycleState?.action ||
            "WAIT_FOR_RECLAIM_HOLD_OR_CONTROLLED_PULLBACK_CONFIRMATION",

          currentPrice: intradayAnchors.currentPrice ?? null,
          w3High: intradayAnchors.w3High ?? null,

          preferredW4Zone: preferredW4Zone
            ? {
                lo: preferredW4Zone.lo ?? null,
                hi: preferredW4Zone.hi ?? null,
                label:
                  preferredW4Zone.label ||
                  "0.5–0.618 Minute W4 pullback zone",
              }
            : null,

          pullbackLevels: intradayFib?.pullbackLevels || null,
          invalidation: intradayFib?.invalidationLevel ?? null,
          ifW4HoldsNextTargets:
            intradayFib?.ifW4HoldsNextTargets || null,

          noChase: true,
          noExecution: true,
          noPermissionCreated: true,

          requiresEngine3Confirmation: true,
          requiresEngine4Participation: true,
          requiresEngine15Readiness: true,
          requiresEngine6Permission: true,

          engine26Use: {
            allowedAsContext: true,
            labelForTopImbalance:
              "TOP_IMBALANCE_ACTIVE_MINUTE_W4_PULLBACK_WAIT_FOR_RECLAIM",
            labelForLowerImbalance: "W4_PULLBACK_SUPPORT_TEST",
            topImbalanceContext: [
              "TOP_IMBALANCE_ACTIVE",
              "INTERMEDIATE_W3_CONTEXT",
              "MINUTE_W4_PULLBACK_WAIT_FOR_RECLAIM",
              "DO_NOT_CHASE_LONG",
              "WATCH_7500_ACCEPTANCE_OR_REJECTION",
            ],
            lowerImbalanceContext: [
              "BOTTOM_IMBALANCE_ACTIVE",
              "W4_PULLBACK_SUPPORT_TEST",
              "WATCH_SWEEP_RECLAIM_OR_SUPPORT_FAILURE",
              "DIRECTION_NOT_ASSUMED",
            ],
            directionAssumption: "NONE_UNTIL_ENGINE3_ENGINE4_CONFIRM",
            ticketAuthority: "ENGINE6_PAPER_ALLOW_REQUIRED",
          },

          summary:
            intraday.summary ||
            "Minute W3 may be complete and Minute W4 pullback is being watched. Do not chase vertical price. Wait for controlled pullback, reclaim hold, Engine 3/4 confirmation, Engine 15 readiness, and Engine 6 permission.",

          reasonCodes: [
            "ENGINE22_INTRADAY_SCALP_LIFECYCLE_CONTEXT",
            "MINUTE_W4_PULLBACK_WAIT_FOR_RECLAIM",
            "ENGINE26_CONTEXT_ONLY",
            "NO_CHASE",
            "NO_EXECUTION",
            "NO_PERMISSION_CREATED",
            "ENGINE6_PAPER_ALLOW_REQUIRED",
          ],
        }
      : {
          active: false,
          key: "NO_INTRADAY_SCALP_LIFECYCLE_CONTEXT",
          lifecycle: "NO_INTRADAY_SCALP_LIFECYCLE_CONTEXT",
          activeWave: null,
          parentWave: null,
          direction: "NONE",
          noExecution: true,
          noPermissionCreated: true,
          reasonCodes: ["ENGINE22_INTRADAY_SCALP_LIFECYCLE_CONTEXT_MISSING"],
        },

    relationship: {
      engine22Role: "WAVE_CONTEXT_ONLY",
      engine26Role: "MANUAL_IMBALANCE_ALARM_AND_SCALP_COORDINATOR",
      directionAuthority: "ENGINE3_ENGINE4_FAST_READS",
      readinessAuthority: "ENGINE15",
      permissionAuthority: "ENGINE6",
      ticketRule: "NO_ENGINE26_TICKET_UNTIL_ENGINE6_PAPER_ALLOW",
    },

    reasonCodes: [
      "ENGINE22_LIFECYCLE_CONTEXT_FOR_ENGINE26_BUILT",
      "LONG_TERM_AND_INTRADAY_SCALP_SPLIT",
      "ENGINE22_CONTEXT_ONLY",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
    ],
  };
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
  const activeWaveStateFallbackAllowed = allowActiveWaveStateFallback(context);

  const engine2FallbackReasonCodes = [];

  if (!usableWaveState && activeWaveStateFallbackAllowed) {
    engine2FallbackReasonCodes.push(
      "ENGINE2_WAVE_STATE_INCOMPLETE",
      "ACTIVE_WAVE_STATE_FALLBACK_ALLOWED",
      "ENGINE22_ACTIVE_WAVE_STATE_FALLBACK_USED"
    );
  }

  if (!usableWaveState && !activeWaveStateFallbackAllowed) {
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

    // Engine 22D lifecycle context bridge.
    // Read-only only. Does not create trades, shorts, permission, or execution.
    marketMeterContext: context.marketMeterContext,
    marketRegime: context.marketRegime,
    engine25Context: context.engine25Context,
  });

  const tradeContextSummary =
    waveFibState?.tradeContextSummary ||
    buildTradeContextSummary({
      waveFibState,
      context,
    });

  const currentLifecycleState = resolveCurrentLifecycleState({ waveFibState });
  const degreeStates = buildDegreeStates({
  waveFibState,
  activeStructures: waveFibState?.activeStructures,
  markMaturity: waveFibState?.markMaturity,
  symbol: context.symbol,
  tf: context.tf,
  currentPrice: context.currentPrice,
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
  let waveOpportunity = buildPreEngine15WaveOpportunity({
    context,
    waveFibState,
    tradeContextSummary,
    targetClusterConfidence,
    w4Levels,
  });

  const postMinor5DownImpulse = getPostMinor5DownImpulse(waveFibState);

  if (postMinor5DownImpulse) {
    waveOpportunity = buildPostMinor5CorrectiveBounceOpportunity({
      baseOpportunity: waveOpportunity,
      context,
      waveFibState,
      tradeContextSummary,
      downImpulse: postMinor5DownImpulse,
    });
  }

  if (currentLifecycleState?.key) {
    const isIntermediateLaunchWatch =
      currentLifecycleState.key === "INTERMEDIATE_W2_COMPLETE_W3_LAUNCH_WATCH";

    waveOpportunity = {
      ...(waveOpportunity || {}),
      setupFamily: "ELLIOTT_WAVE",
      setupType: currentLifecycleState.key,
      rawSetup: currentLifecycleState.key,
      degree: currentLifecycleState.degree || "intermediate",
      tacticalDegree: currentLifecycleState.tacticalDegree || "minor/minute",
      readiness: currentLifecycleState.readiness || "WATCH",
      direction: currentLifecycleState.direction || "LONG",
      active: false,
      noExecution: true,
      tradeableOpportunityBlocked:
        currentLifecycleState.tradeableOpportunityBlocked === true,
      executionBlocked: currentLifecycleState.executionBlocked === true,
      confirmationRequired: currentLifecycleState.confirmationRequired === true,
      timing: isIntermediateLaunchWatch
        ? "W3_LAUNCH_WATCH"
        : "W3_CONTINUATION_WATCH",
      chaseRisk: "BLOCKED",
      needs: currentLifecycleState.needs,
      summary: isIntermediateLaunchWatch
        ? "Intermediate W2 is marked complete at the active wave-state low. Watch for W3 launch, reclaim, or controlled pullback confirmation. Minor and Minute structures are not yet re-formed. No chase, no automatic long, no execution."
        : "Intermediate W3 is active with Minor and Minute W3 continuation context. This is a bullish paper-trade candidate watch only. No chase, no automatic long, no execution. Wait for controlled pullback or reclaim confirmation plus Engine 3, Engine 4, Engine 15, and Engine 6 confirmation.",
      reasonCodes: [
        ...(Array.isArray(waveOpportunity?.reasonCodes)
          ? waveOpportunity.reasonCodes
          : []),
        "ENGINE22_CURRENT_LIFECYCLE_STATE_MIRRORED_TO_WAVE_OPPORTUNITY",
      ],
    };
  }
  // DISPLAY LAYER:
  // Timeline can use Engine15 for wording, but it is not the source of opportunity truth.
  const lifecycleViews = buildLifecycleViews({
    context,
    waveFibState,
    currentLifecycleState,
    waveOpportunity,
  });

  const lifecycleContext = buildLifecycleContextForEngine26({
    lifecycleViews,
    currentLifecycleState,
  });
  const timelineReadBase = buildTimelineRead({
    waveFibState,
    tradeContextSummary,
    targetClusterConfidence,
    regimeLayers: context.regimeLayers,
    reactionContext: context.reactionContext,
    volumeContext: context.volumeContext,
    breakoutContext: context.breakoutContext,
    engine15: context.engine15,
    engine16: context.engine16,

    // Engine 22F timeline context.
    // Display/read-only only. Does not change readiness or permission.
    engine25Context: context.engine25Context,
    marketRegime: context.marketRegime,
    marketMeterContext: context.marketMeterContext,

    marketType: context.marketType,
    sessionProfile: context.sessionProfile,
  });

  const timelineRead = currentLifecycleState?.key
    ? {
        ...(timelineReadBase || {}),
        lifecycleViews,
        lifecycleContext,
        headline: currentLifecycleState.headline,
        subheadline:
          currentLifecycleState.key === "INTERMEDIATE_W2_COMPLETE_W3_LAUNCH_WATCH"
            ? "Intermediate W2 is marked complete from active wave state. Watch for W3 launch / reclaim confirmation. Minor and Minute structures are not yet re-formed."
            : "Intermediate W3 is active with Minor and Minute W3 continuation context. This is a bullish continuation watch only — no chase, no automatic execution.",
        action: currentLifecycleState.action,
        bias: currentLifecycleState.bias,
        direction: currentLifecycleState.direction,
        needs: currentLifecycleState.needs,
        reasonCodes: [
          ...(Array.isArray(timelineReadBase?.reasonCodes)
            ? timelineReadBase.reasonCodes
            : []),
          "ENGINE22_CURRENT_LIFECYCLE_STATE_MIRRORED_TO_TIMELINE_READ",
        ],
      }
     : {
        ...(timelineReadBase || {}),
        lifecycleViews,
      };
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
    degreeStates,
    w4Levels,
    tradeContextSummary,
    targetClusterConfidence,

    // Primary Engine 22 contract for Engine 15ES.
    waveOpportunity,

    // Secondary/read-only layers.
    lifecycleViews,
    lifecycleContext,
    timelineRead,
    tradeDecision,

    // Canonical Engine 22 lifecycle state.
    // Downstream engines should consume this instead of stale display text.
    currentLifecycleState,

    headline:
      currentLifecycleState?.headline ||
      tradeContextSummary?.headline ||
      timelineRead?.headline ||
      null,
    bias: currentLifecycleState?.bias || tradeContextSummary?.bias || null,
    action:
      currentLifecycleState?.action ||
      tradeContextSummary?.action ||
      timelineRead?.action ||
      "WAIT",
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
      ...engine2FallbackReasonCodes,
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
