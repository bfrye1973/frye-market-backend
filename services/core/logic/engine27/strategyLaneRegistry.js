export const ENGINE27_STRATEGY_LANES = Object.freeze([
  Object.freeze({
    laneId: "subminute",
    strategyId: "subminute_scalp@10m",
    displayName: "Subminute",
    degree: "subminute",
    triggerTimeframe: "10m",
    contextTimeframes: ["1h"],
    sourceStrategyId: "intraday_scalp@10m",
    engine15Required: false,
    geometrySupported: true,
  }),
  Object.freeze({
    laneId: "minute",
    strategyId: "intraday_scalp@10m",
    displayName: "Minute",
    degree: "minute",
    triggerTimeframe: "10m",
    contextTimeframes: ["1h"],
    sourceStrategyId: "intraday_scalp@10m",
    engine15Required: false,
    geometrySupported: true,
  }),
  Object.freeze({
    laneId: "minor",
    strategyId: "minor_swing@1h",
    displayName: "Minor",
    degree: "minor",
    triggerTimeframe: "1h",
    contextTimeframes: ["4h"],
    sourceStrategyId: "minor_swing@1h",
    engine15Required: false,
    geometrySupported: false,
  }),
  Object.freeze({
    laneId: "intermediate",
    strategyId: "intermediate_long@4h",
    displayName: "Intermediate",
    degree: "intermediate",
    triggerTimeframe: "4h",
    contextTimeframes: ["1d"],
    sourceStrategyId: "intermediate_long@4h",
    engine15Required: true,
    geometrySupported: false,
  }),
  Object.freeze({
    laneId: "primary",
    strategyId: "primary_position@1d",
    displayName: "Primary",
    degree: "primary",
    triggerTimeframe: "1d",
    contextTimeframes: [],
    sourceStrategyId: "intermediate_long@4h",
    engine15Required: true,
    geometrySupported: false,
  }),
]);

export function getEngine27StrategyLanes() {
  return ENGINE27_STRATEGY_LANES.map((lane) => ({ ...lane }));
}

export default ENGINE27_STRATEGY_LANES;
