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

function barsForTimeframe(snapshot, timeframe) {
  const posture =
    snapshot
      ?.marketMeter
      ?.layers
      ?.emaPosture ||
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
    snapshot
      ?.strategies
      ?.[
        "intraday_scalp@10m"
      ]
      ?.engine22WaveStrategy
      ?.degreeStates ||
    {}
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

  const decisions = {};

  for (const lane of lanes) {
    const sourceStrategy =
      snapshot
        ?.strategies
        ?.[lane.sourceStrategyId] ||
      null;

    const degreeState =
      degreeStates?.[lane.degree] ||
      null;

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

    mode: "READ_ONLY",

    symbol:
      snapshot?.symbol || null,

    builtAt:
      new Date().toISOString(),

    /*
     * Engine 27A canonical output.
     *
     * Contains:
     * subminute
     * minute
     * minor
     * intermediate
     * primary
     */
    engine27WaveIntelligence,

    laneCount:
      lanes.length,

    laneOrder:
      lanes.map(
        (lane) => lane.laneId
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
      "ENGINE27_FIVE_INDEPENDENT_STRATEGIES_BUILT",
      "READ_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildEngine27Strategies;
