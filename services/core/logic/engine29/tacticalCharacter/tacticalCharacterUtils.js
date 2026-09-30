// services/core/logic/engine29/tacticalCharacter/tacticalCharacterUtils.js

import { ENGINE29_GROUP_STATES } from "../constants.js";
import {
  ENGINE29_MOVE_CHARACTER_DEFAULTS,
  ENGINE29_MOVE_DIRECTIONS,
} from "./moveCharacterConstants.js";

export function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function pctChange(from, to) {
  const a = finite(from);
  const b = finite(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

export function median(values = []) {
  const clean = values.map(finite).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

export function medianAbsoluteDeviation(values = []) {
  const clean = values.map(finite).filter(Number.isFinite);
  const center = median(clean);
  if (!Number.isFinite(center)) return null;
  return median(clean.map((value) => Math.abs(value - center)));
}

export function completedBars(view) {
  return (view?.bars || []).filter((bar) => bar?.completed && Number.isFinite(finite(bar.close)));
}

export function latestCompletedBars(view, count = 2) {
  const bars = completedBars(view);
  return bars.slice(Math.max(0, bars.length - count));
}

export function oneBarAbsReturns(view, lookback = ENGINE29_MOVE_CHARACTER_DEFAULTS.baselineBars) {
  const bars = completedBars(view).slice(-(lookback + 1));
  const out = [];
  for (let i = 1; i < bars.length; i += 1) {
    const r = pctChange(bars[i - 1]?.close, bars[i]?.close);
    if (Number.isFinite(r)) out.push(Math.abs(r));
  }
  return out;
}

export function medianAbsReturn(view, lookback = ENGINE29_MOVE_CHARACTER_DEFAULTS.baselineBars) {
  return median(oneBarAbsReturns(view, lookback));
}

export function medianBarRangePct(view, lookback = ENGINE29_MOVE_CHARACTER_DEFAULTS.baselineBars) {
  const bars = completedBars(view).slice(-lookback);
  const ranges = bars.map((bar) => {
    const high = finite(bar.high);
    const low = finite(bar.low);
    const close = finite(bar.close);
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || close === 0) return null;
    return ((high - low) / Math.abs(close)) * 100;
  }).filter(Number.isFinite);
  return median(ranges);
}

export function deriveDirectionalMove(view, {
  barsBack = ENGINE29_MOVE_CHARACTER_DEFAULTS.headlineBarsBack,
  minAbsMovePct = ENGINE29_MOVE_CHARACTER_DEFAULTS.minInternalDirectionalPct,
  baselineFraction = ENGINE29_MOVE_CHARACTER_DEFAULTS.internalBaselineFraction,
} = {}) {
  const bars = completedBars(view);
  if (bars.length < barsBack + 1) {
    return {
      direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      returnPct: null,
      pointMove: null,
      thresholdPct: null,
      impulseMultiple: null,
      available: false,
    };
  }

  const latest = bars.at(-1);
  const anchor = bars.at(-(barsBack + 1));
  const returnPct = pctChange(anchor.close, latest.close);
  const pointMove = Number.isFinite(Number(latest.close)) && Number.isFinite(Number(anchor.close))
    ? Number(latest.close) - Number(anchor.close)
    : null;
  const baseline = medianAbsReturn(view);
  const thresholdPct = Math.max(
    minAbsMovePct,
    Number.isFinite(baseline) ? baseline * baselineFraction : 0,
  );
  const impulseMultiple = Number.isFinite(baseline) && baseline > 0 && Number.isFinite(returnPct)
    ? Math.abs(returnPct) / baseline
    : null;

  let direction = ENGINE29_MOVE_DIRECTIONS.FLAT;
  if (Number.isFinite(returnPct) && returnPct >= thresholdPct) direction = ENGINE29_MOVE_DIRECTIONS.UP;
  else if (Number.isFinite(returnPct) && returnPct <= -thresholdPct) direction = ENGINE29_MOVE_DIRECTIONS.DOWN;

  return {
    direction,
    returnPct,
    pointMove,
    thresholdPct,
    impulseMultiple,
    baselineMedianAbsReturnPct: baseline,
    available: true,
    anchorTime: anchor.time ?? null,
    latestTime: latest.time ?? null,
    anchorClose: Number(anchor.close),
    latestClose: Number(latest.close),
  };
}

function sameWindowAbsReturns(bars, barsBack, baselineWindows) {
  const historicalEnd = bars.length - 1;
  const startIndex = Math.max(barsBack, historicalEnd - baselineWindows);
  const values = [];

  for (let end = startIndex; end < historicalEnd; end += 1) {
    const anchor = bars[end - barsBack];
    const latest = bars[end];
    const move = pctChange(anchor?.close, latest?.close);
    if (Number.isFinite(move)) values.push(Math.abs(move));
  }

  return values;
}

function windowPathMetrics(windowBars) {
  const stepReturns = [];
  for (let i = 1; i < windowBars.length; i += 1) {
    const value = pctChange(windowBars[i - 1]?.close, windowBars[i]?.close);
    if (Number.isFinite(value)) stepReturns.push(value);
  }

  const anchor = windowBars.at(0);
  const latest = windowBars.at(-1);
  const netReturn = pctChange(anchor?.close, latest?.close);
  const direction = Number.isFinite(netReturn) && netReturn > 0
    ? ENGINE29_MOVE_DIRECTIONS.UP
    : Number.isFinite(netReturn) && netReturn < 0
      ? ENGINE29_MOVE_DIRECTIONS.DOWN
      : ENGINE29_MOVE_DIRECTIONS.FLAT;

  const alignedCount = stepReturns.filter((value) =>
    direction === ENGINE29_MOVE_DIRECTIONS.UP ? value > 0 :
    direction === ENGINE29_MOVE_DIRECTIONS.DOWN ? value < 0 :
    false
  ).length;

  const pathTravel = stepReturns.reduce((sum, value) => sum + Math.abs(value), 0);
  const efficiency = Number.isFinite(netReturn) && pathTravel > 0
    ? Math.abs(netReturn) / pathTravel
    : 0;

  return {
    direction,
    stepReturns,
    alignedCount,
    alignedFraction: stepReturns.length ? alignedCount / stepReturns.length : 0,
    pathTravelPct: pathTravel,
    efficiency,
  };
}

export function deriveAdaptiveDirectionalMove(view, {
  barsBack = ENGINE29_MOVE_CHARACTER_DEFAULTS.directionalMoveBarsBack,
  baselineWindows = ENGINE29_MOVE_CHARACTER_DEFAULTS.directionalMoveBaselineWindows,
  minAbsMovePct = ENGINE29_MOVE_CHARACTER_DEFAULTS.directionalMoveMinAbsPct,
  minAlignedFraction = ENGINE29_MOVE_CHARACTER_DEFAULTS.directionalMoveMinAlignedFraction,
  minEfficiency = ENGINE29_MOVE_CHARACTER_DEFAULTS.directionalMoveMinEfficiency,
} = {}) {
  if (view?.freshness?.stale === true) {
    return {
      direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      returnPct: null,
      pointMove: null,
      thresholdPct: null,
      baselineMedianWindowAbsReturnPct: null,
      baselineMadWindowAbsReturnPct: null,
      abnormalityMultiple: null,
      alignedFraction: null,
      efficiency: null,
      available: false,
      stale: true,
      reason: view?.freshness?.reason || "STALE_30M_AUTHORITY",
    };
  }

  const bars = completedBars(view);
  if (bars.length < barsBack + 2) {
    return {
      direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      returnPct: null,
      pointMove: null,
      thresholdPct: null,
      baselineMedianWindowAbsReturnPct: null,
      baselineMadWindowAbsReturnPct: null,
      abnormalityMultiple: null,
      alignedFraction: null,
      efficiency: null,
      available: false,
      stale: false,
      reason: "INSUFFICIENT_COMPLETED_30M_BARS",
    };
  }

  const currentWindow = bars.slice(-(barsBack + 1));
  const anchor = currentWindow.at(0);
  const latest = currentWindow.at(-1);
  const returnPct = pctChange(anchor?.close, latest?.close);
  const pointMove = Number.isFinite(Number(latest?.close)) && Number.isFinite(Number(anchor?.close))
    ? Number(latest.close) - Number(anchor.close)
    : null;

  const historical = sameWindowAbsReturns(bars, barsBack, baselineWindows);
  const baselineMedian = median(historical);
  const baselineMad = medianAbsoluteDeviation(historical);
  const adaptiveComponent =
    (Number.isFinite(baselineMedian) ? baselineMedian : 0) +
    (Number.isFinite(baselineMad) ? baselineMad : 0);
  const thresholdPct = Math.max(minAbsMovePct, adaptiveComponent);

  const path = windowPathMetrics(currentWindow);
  const displacementPass =
    Number.isFinite(returnPct) &&
    Math.abs(returnPct) >= thresholdPct;
  const persistencePass =
    path.alignedFraction >= minAlignedFraction;
  const efficiencyPass =
    path.efficiency >= minEfficiency;

  const active =
    displacementPass &&
    persistencePass &&
    efficiencyPass &&
    (
      path.direction === ENGINE29_MOVE_DIRECTIONS.UP ||
      path.direction === ENGINE29_MOVE_DIRECTIONS.DOWN
    );

  const direction = active
    ? path.direction
    : ENGINE29_MOVE_DIRECTIONS.FLAT;

  return {
    direction,
    rawDirection: path.direction,
    active,
    returnPct,
    pointMove,
    thresholdPct,
    baselineMedianWindowAbsReturnPct: baselineMedian,
    baselineMadWindowAbsReturnPct: baselineMad,
    abnormalityMultiple:
      Number.isFinite(baselineMedian) &&
      baselineMedian > 0 &&
      Number.isFinite(returnPct)
        ? Math.abs(returnPct) / baselineMedian
        : null,
    alignedFraction: path.alignedFraction,
    alignedCount: path.alignedCount,
    stepCount: path.stepReturns.length,
    efficiency: path.efficiency,
    pathTravelPct: path.pathTravelPct,
    displacementPass,
    persistencePass,
    efficiencyPass,
    available: true,
    stale: false,
    reason: active ? "ACTIVE_30M_DIRECTIONAL_MOVE" : "NO_QUALIFIED_30M_DIRECTIONAL_MOVE",
    anchorTime: anchor?.time ?? null,
    latestTime: latest?.time ?? null,
    anchorClose: Number(anchor?.close),
    latestClose: Number(latest?.close),
  };
}

export function groupStateRank(state) {
  if (state === ENGINE29_GROUP_STATES.SEVERE) return 4;
  if (state === ENGINE29_GROUP_STATES.CONFIRMED) return 3;
  if (state === ENGINE29_GROUP_STATES.FORMING) return 2;
  if (state === ENGINE29_GROUP_STATES.HEALTHY) return 1;
  if (state === ENGINE29_GROUP_STATES.RECOVERING) return 0;
  return null;
}

export function isStressActiveGroupState(state) {
  const rank = groupStateRank(state);
  return Number.isFinite(rank) && rank >= 2;
}

export function isConfirmedStressGroupState(state) {
  const rank = groupStateRank(state);
  return Number.isFinite(rank) && rank >= 3;
}

export function sameDirection(direction, move) {
  return Boolean(move?.available && move.direction === direction);
}

export function oppositeDirection(direction, move) {
  if (!move?.available) return false;
  if (direction === ENGINE29_MOVE_DIRECTIONS.UP) return move.direction === ENGINE29_MOVE_DIRECTIONS.DOWN;
  if (direction === ENGINE29_MOVE_DIRECTIONS.DOWN) return move.direction === ENGINE29_MOVE_DIRECTIONS.UP;
  return false;
}
