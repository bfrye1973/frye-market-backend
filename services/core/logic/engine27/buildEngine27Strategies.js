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

import {
  buildTraderDecision,
} from "./decision/buildTraderDecision.js";

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

  const engine27WaveIntelligence =
    buildWaveIntelligence({
      degreeStates,
    });

  const engine27FibIntelligence =
    buildFibIntelligence({
      engine27WaveIntelligence,
      degreeStates,
    });

  const engine27Alignment =
    buildMultiDegreeAlignment({
      engine27WaveIntelligence,
      engine27FibIntelligence,
    });

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

  /*
   * Existing Minute pipeline context.
   *
   * This remains unchanged and is passed only to the Minute lane.
   */
  const intradayPaperStrategy =
    snapshot?.strategies?.[
      "intraday_scalp@10m"
    ] || null;

  const pipelineContext =
    intradayPaperStrategy
      ? {
          engine26LocationCandidate:
            intradayPaperStrategy
              .engine26LocationCandidate ||
            null,

          strategySymbol:
            intradayPaperStrategy
              .symbol ||
            null,

          engine3AuthorizedReaction:
            intradayPaperStrategy
              .confluence
              ?.context
              ?.reaction
              ?.paperScalpReaction ||
            null,

          engine4AuthorizedParticipation:
            intradayPaperStrategy
              .analytics
              ?.engine5
              ?.context
              ?.volume
              ?.engine4AuthorizedReactionParticipation ||
            null,

          engine6Permission:
            intradayPaperStrategy
              .permission
              ?.paper ||
            null,

          engine26Planner:
            intradayPaperStrategy
              .engine26PaperTradePlan ||
            null,

          engine26ProposedGeometry:
            intradayPaperStrategy
              .engine26ProposedGeometry ||
            null,
        }
      : null;

  /*
   * Authorized Subminute Engine 26 context.
   *
   * Reads only:
   * strategies["subminute_scalp@10m"]
   *
   * No Minute fallback.
   * No search for alternate geometry.
   * No strategyTimeline attachment.
   */
  const subminuteStrategy =
    snapshot?.strategies?.[
      "subminute_scalp@10m"
    ] || null;

  const subminutePipelineContext =
    subminuteStrategy
      ? {
          engine26LocationCandidate:
            subminuteStrategy
              .engine26LocationCandidate ||
            null,

          engine26PipelineIdentity:
            subminuteStrategy
              .engine26PipelineIdentity ||
            null,

          engine26LocationContext:
            subminuteStrategy
              .engine26LocationContext ||
            null,

          engine26ControlMap:
            subminuteStrategy
              .engine26ControlMap ||
            null,

          engine26ProposedGeometry:
            subminuteStrategy
              .engine26ProposedGeometry ||
            null,
        }
      : null;

  const engine27TraderDecision =
    buildTraderDecision({
      engine27WaveIntelligence,
      engine27FibIntelligence,
      engine27Alignment,
      engine27MarketStory,
      alphaDecisions: decisions,
      pipelineContext,
      subminutePipelineContext,
    });

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

    engine27WaveIntelligence,
    engine27FibIntelligence,
    engine27Alignment,
    engine27MarketStory,
    engine27TraderDecision,

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
      "ENGINE27_TRADER_DECISION_BUILT",
      "ENGINE27_FIVE_INDEPENDENT_STRATEGIES_BUILT",
      "READ_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildEngine27Strategies;
