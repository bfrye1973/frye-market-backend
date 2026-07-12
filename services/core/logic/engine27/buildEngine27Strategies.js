// services/core/logic/engine27/buildEngine27Strategies.js

import {
  getEngine27StrategyLanes,
} from "./strategyLaneRegistry.js";

import {
  buildHigherTimeframeWickContext,
} from "./buildHigherTimeframeWickContext.js";

import {
  buildEngine27StrategyDecision,
} from "./buildStrategyDecision.js";

import {
  buildWaveIntelligence,
} from "./wave/buildWaveIntelligence.js";

import {
  buildFibIntelligence,
} from "./fib/buildFibIntelligence.js";

import {
  buildMultiDegreeAlignment,
} from "./alignment/buildMultiDegreeAlignment.js";

import {
  buildMarketStory,
} from "./story/buildMarketStory.js";

function barsForTimeframe(snapshot, timeframe) {
  const posture =
    snapshot?.marketMeter?.layers?.emaPosture ||
    snapshot?.emaPosture ||
    {};

  if (timeframe === "10m") {
    return posture?.tenMinute?.bars || [];
  }

  if (timeframe === "1h") {
    return posture?.oneHour?.bars || [];
  }

  if (timeframe === "4h") {
    return posture?.fourHour?.bars || [];
  }

  if (timeframe === "1d") {
    return posture?.daily?.bars || [];
  }

  return [];
}

function getDegreeStates(snapshot) {
  return (
    snapshot?.strategies?.["intraday_scalp@10m"]
      ?.engine22WaveStrategy
      ?.degreeStates || {}
  );
}

export function buildEngine27Strategies({
  snapshot,
} = {}) {
  const lanes =
    getEngine27StrategyLanes();

  const degreeStates =
    getDegreeStates(snapshot);

  /*
   * Engine 27A — Wave Intelligence
   *
   * Reads only:
   * engine22WaveStrategy.degreeStates
   *
   * Does not create:
   * - Fibonacci projections
   * - trade permission
   * - sizing
   * - geometry
   * - tickets
   * - execution
   * - journal records
   */
  const engine27WaveIntelligence =
    buildWaveIntelligence({
      degreeStates,
    });

  /*
   * Engine 27B — Fibonacci Intelligence
   *
   * Reads only:
   * - engine27WaveIntelligence
   * - engine22WaveStrategy.degreeStates
   *
   * Does not create:
   * - trade decisions
   * - alignment
   * - confidence
   * - permission
   * - sizing
   * - geometry
   * - tickets
   * - execution
   * - dashboard output
   */
  const engine27FibIntelligence =
    buildFibIntelligence({
      engine27WaveIntelligence,
      degreeStates,
    });

  /*
   * Engine 27C — Multi-Degree Alignment
   *
   * Reads only:
   * - engine27WaveIntelligence
   * - engine27FibIntelligence
   *
   * Does not create:
   * - wave intelligence
   * - Fibonacci calculations
   * - trade decisions
   * - permission
   * - sizing
   * - geometry
   * - tickets
   * - execution
   * - market-story prose
   * - alerts
   * - dashboard output
   */
  const engine27Alignment =
    buildMultiDegreeAlignment({
      engine27WaveIntelligence,
      engine27FibIntelligence,
    });

  /*
   * Engine 27D — Market Story
   *
   * Reads only:
   * - engine27WaveIntelligence
   * - engine27FibIntelligence
   * - engine27Alignment
   *
   * Creates only:
   * - concise market-structure narrative
   *
   * Does not create:
   * - trade decisions
   * - permission
   * - sizing
   * - geometry
   * - tickets
   * - execution
   * - alerts
   * - dashboard output
   */
  const engine27MarketStory =
    buildMarketStory({
      engine27WaveIntelligence,
      engine27FibIntelligence,
      engine27Alignment,
    });

  const decisions = {};

  for (const lane of lanes) {
    const sourceStrategy =
      snapshot?.strategies?.[
        lane.sourceStrategyId
      ] || null;

    const degreeState =
      degreeStates?.[
        lane.degree
      ] || null;

    const triggerBars =
      barsForTimeframe(
        snapshot,
        lane.triggerTimeframe
      );

    const contextTf =
      lane.contextTimeframes?.[0] ||
      null;

    const higherTimeframeContext =
      contextTf
        ? buildHigherTimeframeWickContext({
            bars: barsForTimeframe(
              snapshot,
              contextTf
            ),
            timeframe: contextTf,
            completedBarsOnly: true,
            sampleSize: 3,
          })
        : null;

    decisions[lane.laneId] =
      buildEngine27StrategyDecision({
        lane,
        degreeState,
        sourceStrategy,
        triggerBars,
        higherTimeframeContext,
      });
  }

  return {
    active: true,

    engine:
      "engine27.multiStrategyDecision.v1",

    mode:
      "READ_ONLY",

    symbol:
      snapshot?.symbol ||
      null,

    builtAt:
      new Date().toISOString(),

    /*
     * Engine 27A canonical output.
     */
    engine27WaveIntelligence,

    /*
     * Engine 27B canonical output.
     */
    engine27FibIntelligence,

    /*
     * Engine 27C canonical output.
     */
    engine27Alignment,

    /*
     * Engine 27D canonical output.
     */
    engine27MarketStory,

    laneCount:
      lanes.length,

    laneOrder:
      lanes.map(
        (lane) =>
          lane.laneId
      ),

    lanes,

    decisions,

    noPermissionCreated: true,
    noSizingCreated: true,
    noTicketCreated: true,
    noExecution: true,
    noJournalWrite: true,

    reasonCodes: [
      "ENGINE27_WAVE_INTELLIGENCE_BUILT",
      "ENGINE27_FIB_INTELLIGENCE_BUILT",
      "ENGINE27_ALIGNMENT_BUILT",
      "ENGINE27_MARKET_STORY_BUILT",
      "ENGINE27_FIVE_INDEPENDENT_STRATEGIES_BUILT",
      "READ_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildEngine27Strategies;
