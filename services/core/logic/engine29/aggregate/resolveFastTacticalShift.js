// services/core/logic/engine29/aggregate/resolveFastTacticalShift.js

import { ENGINE29_SYMBOL_STATES } from "../constants.js";
import {
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_DIRECTIONS,
  ENGINE29_UNDERLYING_PRESSURE,
} from "../tacticalCharacter/moveCharacterConstants.js";
import {
  ENGINE29_FAST_SHIFT_STATES,
  ENGINE29_PHASE5_REASON_CODES,
} from "./overallStateConstants.js";

export function resolveEngine29FastTacticalShift(moveCharacter) {
  const move = moveCharacter?.moveCharacter ?? ENGINE29_MOVE_CHARACTERS.NO_ACTIVE_MOVE;
  const direction = moveCharacter?.direction ?? ENGINE29_MOVE_DIRECTIONS.FLAT;
  const underlying = moveCharacter?.underlyingPressure?.state ?? ENGINE29_UNDERLYING_PRESSURE.INSUFFICIENT_DATA;
  const es30mState = moveCharacter?.esFastStructureState ?? moveCharacter?.esImpulse?.structureState ?? null;

  let state = ENGINE29_FAST_SHIFT_STATES.NEUTRAL;
  const reasonCodes = [];

  if (move === ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE) {
    state = ENGINE29_FAST_SHIFT_STATES.POSSIBLE_UPSIDE_SQUEEZE;
  } else if (move === ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE) {
    state = ENGINE29_FAST_SHIFT_STATES.POSSIBLE_DOWNSIDE_SQUEEZE;
  } else if (move === ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_HIGH) {
    state = ENGINE29_FAST_SHIFT_STATES.LIQUIDITY_SWEEP_HIGH;
  } else if (move === ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_LOW) {
    state = ENGINE29_FAST_SHIFT_STATES.LIQUIDITY_SWEEP_LOW;
  } else if (move === ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED && direction === ENGINE29_MOVE_DIRECTIONS.UP) {
    state = ENGINE29_FAST_SHIFT_STATES.BROAD_MOVE_UP;
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_BUYING_PRESSURE);
  } else if (move === ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED && direction === ENGINE29_MOVE_DIRECTIONS.DOWN) {
    state = ENGINE29_FAST_SHIFT_STATES.BROAD_MOVE_DOWN;
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_SELLING_PRESSURE);
  } else if (underlying === ENGINE29_UNDERLYING_PRESSURE.NEGATIVE) {
    state = ENGINE29_FAST_SHIFT_STATES.SELLING_PRESSURE_INCREASING;
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_SELLING_PRESSURE);
  } else if (underlying === ENGINE29_UNDERLYING_PRESSURE.POSITIVE) {
    state = ENGINE29_FAST_SHIFT_STATES.BUYING_PRESSURE_INCREASING;
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_BUYING_PRESSURE);
  } else if (es30mState === ENGINE29_SYMBOL_STATES.RECOVERING) {
    state = ENGINE29_FAST_SHIFT_STATES.RECOVERY_ATTEMPT;
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_RECOVERY_ATTEMPT);
  } else if (underlying === ENGINE29_UNDERLYING_PRESSURE.NEUTRAL || direction === ENGINE29_MOVE_DIRECTIONS.FLAT) {
    state = ENGINE29_FAST_SHIFT_STATES.STABILIZING;
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_STABILIZING);
  } else {
    state = ENGINE29_FAST_SHIFT_STATES.MIXED;
  }

  return {
    state,
    moveCharacter: move,
    direction,
    underlyingPressure: underlying,
    reasonCodes: [...new Set(reasonCodes)],
  };
}
