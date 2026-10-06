// services/core/logic/engine29/aggregate/resolveFastTacticalShift.js
//
// MOVE v2:
// - fast tactical describes current 30m pressure.
// - it never acts as parent MOVE authority.
// - squeeze/broad confirmation are companion character fields elsewhere.

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
  const parentState =
    moveCharacter?.moveCharacter ??
    ENGINE29_MOVE_CHARACTERS.NO_ACTIVE_MOVE;

  const parentDirection =
    moveCharacter?.direction ??
    ENGINE29_MOVE_DIRECTIONS.FLAT;

  const underlying =
    moveCharacter?.underlyingPressure?.state ??
    ENGINE29_UNDERLYING_PRESSURE.INSUFFICIENT_DATA;

  const es30mState =
    moveCharacter?.esFastStructureState ??
    moveCharacter?.esImpulse?.structureState ??
    null;

  let state = ENGINE29_FAST_SHIFT_STATES.NEUTRAL;
  const reasonCodes = [];

  if (
    parentState === ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE &&
    parentDirection === ENGINE29_MOVE_DIRECTIONS.DOWN
  ) {
    if (underlying === ENGINE29_UNDERLYING_PRESSURE.NEGATIVE) {
      state = ENGINE29_FAST_SHIFT_STATES.SELLING_PRESSURE_INCREASING;
      reasonCodes.push(
        ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_SELLING_PRESSURE
      );
    } else if (underlying === ENGINE29_UNDERLYING_PRESSURE.POSITIVE) {
      state = ENGINE29_FAST_SHIFT_STATES.RECOVERY_ATTEMPT;
      reasonCodes.push(
        ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_RECOVERY_ATTEMPT
      );
    } else {
      state = ENGINE29_FAST_SHIFT_STATES.STABILIZING;
      reasonCodes.push(
        ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_STABILIZING
      );
    }
  } else if (
    parentState === ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE &&
    parentDirection === ENGINE29_MOVE_DIRECTIONS.UP
  ) {
    if (underlying === ENGINE29_UNDERLYING_PRESSURE.POSITIVE) {
      state = ENGINE29_FAST_SHIFT_STATES.BUYING_PRESSURE_INCREASING;
      reasonCodes.push(
        ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_BUYING_PRESSURE
      );
    } else {
      state = ENGINE29_FAST_SHIFT_STATES.STABILIZING;
      reasonCodes.push(
        ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_STABILIZING
      );
    }
  } else if (underlying === ENGINE29_UNDERLYING_PRESSURE.NEGATIVE) {
    state = ENGINE29_FAST_SHIFT_STATES.SELLING_PRESSURE_INCREASING;
    reasonCodes.push(
      ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_SELLING_PRESSURE
    );
  } else if (underlying === ENGINE29_UNDERLYING_PRESSURE.POSITIVE) {
    state = ENGINE29_FAST_SHIFT_STATES.BUYING_PRESSURE_INCREASING;
    reasonCodes.push(
      ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_BUYING_PRESSURE
    );
  } else if (es30mState === ENGINE29_SYMBOL_STATES.RECOVERING) {
    state = ENGINE29_FAST_SHIFT_STATES.RECOVERY_ATTEMPT;
    reasonCodes.push(
      ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_RECOVERY_ATTEMPT
    );
  } else if (
    underlying === ENGINE29_UNDERLYING_PRESSURE.NEUTRAL ||
    parentDirection === ENGINE29_MOVE_DIRECTIONS.FLAT
  ) {
    state = ENGINE29_FAST_SHIFT_STATES.STABILIZING;
    reasonCodes.push(
      ENGINE29_PHASE5_REASON_CODES.FAST_SHIFT_STABILIZING
    );
  } else {
    state = ENGINE29_FAST_SHIFT_STATES.MIXED;
  }

  return {
    state,
    authority: "THIRTY_MINUTE_PRESSURE_ONLY",
    parentMoveState: parentState,
    parentMoveDirection: parentDirection,
    underlyingPressure: underlying,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

export default resolveEngine29FastTacticalShift;
