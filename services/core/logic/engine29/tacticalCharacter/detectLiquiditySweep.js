// services/core/logic/engine29/tacticalCharacter/detectLiquiditySweep.js

import {
  ENGINE29_MOVE_CHARACTER_DEFAULTS,
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_REASON_CODES,
} from "./moveCharacterConstants.js";
import {
  completedBars,
  finite,
  medianBarRangePct,
} from "./tacticalCharacterUtils.js";

function excursionPct(level, extreme) {
  const l = finite(level);
  const e = finite(extreme);
  if (!Number.isFinite(l) || !Number.isFinite(e) || l === 0) return null;
  return (Math.abs(e - l) / Math.abs(l)) * 100;
}

function sweepThresholdPct(view, options = {}) {
  const baselineRange = medianBarRangePct(view);
  return Math.max(
    options.minSweepExcursionPct ?? ENGINE29_MOVE_CHARACTER_DEFAULTS.minSweepExcursionPct,
    Number.isFinite(baselineRange)
      ? baselineRange * (options.sweepRangeFraction ?? ENGINE29_MOVE_CHARACTER_DEFAULTS.sweepRangeFraction)
      : 0,
  );
}

export function detectLiquiditySweep(symbolEntry, options = {}) {
  const view = symbolEntry?.fastTactical;
  const bars = completedBars(view);
  const bar = bars.at(-1) || null;
  const support = finite(view?.levels?.recentSupport);
  const resistance = finite(view?.levels?.recentResistance);

  if (!bar) {
    return { detected: false, character: null, reasonCode: null, symbol: symbolEntry?.canonicalSymbol ?? null };
  }

  const thresholdPct = sweepThresholdPct(view, options);
  const highExcursionPct = excursionPct(resistance, bar.high);
  const lowExcursionPct = excursionPct(support, bar.low);

  const sweptHigh = Number.isFinite(resistance)
    && Number.isFinite(finite(bar.high))
    && Number.isFinite(finite(bar.close))
    && bar.high > resistance
    && bar.close <= resistance
    && Number.isFinite(highExcursionPct)
    && highExcursionPct >= thresholdPct;

  const sweptLow = Number.isFinite(support)
    && Number.isFinite(finite(bar.low))
    && Number.isFinite(finite(bar.close))
    && bar.low < support
    && bar.close >= support
    && Number.isFinite(lowExcursionPct)
    && lowExcursionPct >= thresholdPct;

  if (sweptHigh) {
    return {
      detected: true,
      character: ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_HIGH,
      reasonCode: ENGINE29_MOVE_REASON_CODES.SWEEP_ABOVE_RESISTANCE_FAILED_HOLD,
      symbol: symbolEntry?.canonicalSymbol ?? null,
      level: resistance,
      extreme: finite(bar.high),
      close: finite(bar.close),
      excursionPct: highExcursionPct,
      thresholdPct,
      time: bar.time ?? null,
    };
  }

  if (sweptLow) {
    return {
      detected: true,
      character: ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_LOW,
      reasonCode: ENGINE29_MOVE_REASON_CODES.SWEEP_BELOW_SUPPORT_FAILED_HOLD,
      symbol: symbolEntry?.canonicalSymbol ?? null,
      level: support,
      extreme: finite(bar.low),
      close: finite(bar.close),
      excursionPct: lowExcursionPct,
      thresholdPct,
      time: bar.time ?? null,
    };
  }

  return {
    detected: false,
    character: null,
    reasonCode: null,
    symbol: symbolEntry?.canonicalSymbol ?? null,
    thresholdPct,
  };
}
