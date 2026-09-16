// services/core/logic/engine29/aggregate/resolveTacticalState.js

import {
  ENGINE29_CONFIDENCE,
  ENGINE29_GROUP_STATES,
  ENGINE29_SYMBOL_STATES,
  ENGINE29_TACTICAL_STATES,
} from "../constants.js";
import { ENGINE29_MOVE_CHARACTERS, ENGINE29_UNDERLYING_PRESSURE } from "../tacticalCharacter/moveCharacterConstants.js";
import { ENGINE29_PHASE5_REASON_CODES } from "./overallStateConstants.js";

const GROUP_KEYS = Object.freeze([
  "headlineIndex",
  "breadth",
  "leadership",
  "credit",
  "ratesDuration",
  "energyInflation",
  "volatility",
  "financialConditions",
]);

function stateOf(groupBundle, key) {
  return groupBundle?.groups?.[key]?.tactical?.state ?? null;
}

function isActive(state) {
  return [ENGINE29_GROUP_STATES.FORMING, ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(state);
}

function isConfirmed(state) {
  return [ENGINE29_GROUP_STATES.CONFIRMED, ENGINE29_GROUP_STATES.SEVERE].includes(state);
}

export function resolveEngine29TacticalState(groupBundle, moveCharacter) {
  const states = Object.fromEntries(GROUP_KEYS.map((key) => [key, stateOf(groupBundle, key)]));
  const activeGroups = GROUP_KEYS.filter((key) => isActive(states[key]));
  const confirmedGroups = GROUP_KEYS.filter((key) => isConfirmed(states[key]));
  const es1hState = moveCharacter?.oneHourContext?.esOneHourStructureState ?? null;
  const underlying = moveCharacter?.underlyingPressure?.state ?? null;
  const move = moveCharacter?.moveCharacter ?? null;
  const direction = moveCharacter?.direction ?? null;

  const downsideAcceleration =
    direction === "DOWN" &&
    [ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED, ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE].includes(move);

  const upsideRecovery =
    es1hState === ENGINE29_SYMBOL_STATES.RECOVERING ||
    move === ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE ||
    (direction === "UP" && move === ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED);

  const reasonCodes = [];
  let state = ENGINE29_TACTICAL_STATES.NORMAL;

  if (downsideAcceleration && activeGroups.length >= 3) {
    state = ENGINE29_TACTICAL_STATES.STRESS_ACCELERATING;
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.TACTICAL_STRESS_ACCELERATING);
  } else if (confirmedGroups.length >= 2 && underlying === ENGINE29_UNDERLYING_PRESSURE.NEGATIVE) {
    state = ENGINE29_TACTICAL_STATES.RISK_OFF_ACTIVE;
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.TACTICAL_RISK_OFF_ACTIVE);
  } else if (upsideRecovery && confirmedGroups.length <= 1) {
    state = ENGINE29_TACTICAL_STATES.RECOVERING;
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.TACTICAL_RECOVERING);
  } else if (activeGroups.length >= 2 || underlying === ENGINE29_UNDERLYING_PRESSURE.NEGATIVE) {
    state = ENGINE29_TACTICAL_STATES.CAUTION;
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.TACTICAL_CAUTION);
  } else {
    reasonCodes.push(ENGINE29_PHASE5_REASON_CODES.TACTICAL_NORMAL);
  }

  const confidence = moveCharacter?.confidence ?? (
    confirmedGroups.length >= 2 ? ENGINE29_CONFIDENCE.HIGH :
    activeGroups.length >= 2 ? ENGINE29_CONFIDENCE.MEDIUM :
    ENGINE29_CONFIDENCE.LOW
  );

  return {
    state,
    confidence,
    states,
    activeGroups,
    confirmedGroups,
    esOneHourStructureState: es1hState,
    underlyingPressure: underlying,
    moveCharacter: move,
    reasonCodes,
  };
}
