// services/core/logic/engine29/tacticalCharacter/detectUnderlyingPressure.js

import {
  ENGINE29_MOVE_DIRECTIONS,
  ENGINE29_MOVE_REASON_CODES,
  ENGINE29_UNDERLYING_PRESSURE,
} from "./moveCharacterConstants.js";
import { deriveDirectionalMove } from "./tacticalCharacterUtils.js";

function buildBlock(symbols, names, requiredConfirming = 1, options = {}) {
  const members = names
    .map((name) => symbols?.[name])
    .filter((entry) => entry?.fastTactical)
    .map((entry) => ({
      symbol: entry.canonicalSymbol,
      move: deriveDirectionalMove(entry.fastTactical, options),
    }));

  const available = members.filter((m) => m.move.available);
  const up = available.filter((m) => m.move.direction === ENGINE29_MOVE_DIRECTIONS.UP);
  const down = available.filter((m) => m.move.direction === ENGINE29_MOVE_DIRECTIONS.DOWN);

  let direction = ENGINE29_MOVE_DIRECTIONS.FLAT;
  if (up.length >= requiredConfirming && up.length > down.length) direction = ENGINE29_MOVE_DIRECTIONS.UP;
  else if (down.length >= requiredConfirming && down.length > up.length) direction = ENGINE29_MOVE_DIRECTIONS.DOWN;
  else if (up.length && down.length) direction = ENGINE29_MOVE_DIRECTIONS.MIXED;

  return {
    availableCount: available.length,
    direction,
    upCount: up.length,
    downCount: down.length,
    members,
  };
}

export function detectUnderlyingPressure(structureBundle, options = {}) {
  const symbols = structureBundle?.symbols || {};

  const blocks = {
    headlineEtfs: buildBlock(symbols, ["SPY", "QQQ"], 1, options),
    breadth: buildBlock(symbols, ["IWM", "MDY", "RSP"], 2, options),
    leadership: buildBlock(symbols, ["SMH", "SOX", "XLK"], 2, options),
    credit: buildBlock(symbols, ["HYG", "JNK", "LQD"], 2, options),
    financials: buildBlock(symbols, ["XLF", "KRE"], 1, options),
  };

  const independent = [blocks.breadth, blocks.leadership, blocks.credit, blocks.financials];
  const upBlocks = independent.filter((b) => b.direction === ENGINE29_MOVE_DIRECTIONS.UP).length;
  const downBlocks = independent.filter((b) => b.direction === ENGINE29_MOVE_DIRECTIONS.DOWN).length;

  let state = ENGINE29_UNDERLYING_PRESSURE.NEUTRAL;
  if (!independent.some((b) => b.availableCount > 0)) {
    state = ENGINE29_UNDERLYING_PRESSURE.INSUFFICIENT_DATA;
  } else if (upBlocks >= 2 && downBlocks === 0) {
    state = ENGINE29_UNDERLYING_PRESSURE.POSITIVE;
  } else if (downBlocks >= 2 && upBlocks === 0) {
    state = ENGINE29_UNDERLYING_PRESSURE.NEGATIVE;
  } else if (upBlocks > 0 && downBlocks > 0) {
    state = ENGINE29_UNDERLYING_PRESSURE.MIXED;
  } else if (blocks.breadth.direction === ENGINE29_MOVE_DIRECTIONS.DOWN
      && (blocks.credit.direction === ENGINE29_MOVE_DIRECTIONS.DOWN || blocks.financials.direction === ENGINE29_MOVE_DIRECTIONS.DOWN)) {
    state = ENGINE29_UNDERLYING_PRESSURE.NEGATIVE;
  } else if (blocks.breadth.direction === ENGINE29_MOVE_DIRECTIONS.UP
      && (blocks.credit.direction === ENGINE29_MOVE_DIRECTIONS.UP || blocks.financials.direction === ENGINE29_MOVE_DIRECTIONS.UP)) {
    state = ENGINE29_UNDERLYING_PRESSURE.POSITIVE;
  }

  const reasonCode = state === ENGINE29_UNDERLYING_PRESSURE.POSITIVE
    ? ENGINE29_MOVE_REASON_CODES.UNDERLYING_PRESSURE_POSITIVE
    : state === ENGINE29_UNDERLYING_PRESSURE.NEGATIVE
      ? ENGINE29_MOVE_REASON_CODES.UNDERLYING_PRESSURE_NEGATIVE
      : state === ENGINE29_UNDERLYING_PRESSURE.MIXED
        ? ENGINE29_MOVE_REASON_CODES.UNDERLYING_PRESSURE_MIXED
        : ENGINE29_MOVE_REASON_CODES.UNDERLYING_PRESSURE_NEUTRAL;

  const headlineHoldingBetter = state === ENGINE29_UNDERLYING_PRESSURE.NEGATIVE
    && blocks.headlineEtfs.direction !== ENGINE29_MOVE_DIRECTIONS.DOWN;
  const headlineLagging = state === ENGINE29_UNDERLYING_PRESSURE.POSITIVE
    && blocks.headlineEtfs.direction !== ENGINE29_MOVE_DIRECTIONS.UP;

  return {
    state,
    upIndependentBlocks: upBlocks,
    downIndependentBlocks: downBlocks,
    headlineHoldingBetter,
    headlineLagging,
    blocks,
    reasonCodes: [reasonCode],
  };
}
