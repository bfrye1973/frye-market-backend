// services/core/logic/engine29/tacticalCharacter/detectSqueezeCharacter.js

import { ENGINE29_GROUP_STATES } from "../constants.js";
import {
  ENGINE29_MOVE_CHARACTER_DEFAULTS,
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_DIRECTIONS,
  ENGINE29_MOVE_REASON_CODES,
} from "./moveCharacterConstants.js";
import {
  deriveDirectionalMove,
  isStressActiveGroupState,
} from "./tacticalCharacterUtils.js";

function directHeadline(structureBundle) {
  const symbols = structureBundle?.symbols || {};
  return [symbols.SPY, symbols.QQQ].filter((entry) => entry?.fastTactical);
}

function headlineImpulse(structureBundle, options = {}) {
  const entries = directHeadline(structureBundle);
  const moves = entries.map((entry) => ({
    symbol: entry.canonicalSymbol,
    move: deriveDirectionalMove(entry.fastTactical, {
      barsBack: options.headlineBarsBack ?? ENGINE29_MOVE_CHARACTER_DEFAULTS.headlineBarsBack,
      minAbsMovePct: options.minHeadlineAbsMovePct ?? ENGINE29_MOVE_CHARACTER_DEFAULTS.minHeadlineAbsMovePct,
      baselineFraction: 1,
    }),
  })).filter((x) => x.move.available);

  if (!moves.length) {
    return {
      direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      impulse: false,
      members: [],
      averageReturnPct: null,
      averageImpulseMultiple: null,
    };
  }

  const up = moves.filter((x) => x.move.direction === ENGINE29_MOVE_DIRECTIONS.UP);
  const down = moves.filter((x) => x.move.direction === ENGINE29_MOVE_DIRECTIONS.DOWN);

  let direction = ENGINE29_MOVE_DIRECTIONS.FLAT;
  if (up.length === moves.length) direction = ENGINE29_MOVE_DIRECTIONS.UP;
  else if (down.length === moves.length) direction = ENGINE29_MOVE_DIRECTIONS.DOWN;
  else if (up.length || down.length) direction = ENGINE29_MOVE_DIRECTIONS.MIXED;

  const averageReturnPct = moves.reduce((sum, x) => sum + (x.move.returnPct || 0), 0) / moves.length;
  const impulseValues = moves.map((x) => x.move.impulseMultiple).filter(Number.isFinite);
  const averageImpulseMultiple = impulseValues.length
    ? impulseValues.reduce((sum, n) => sum + n, 0) / impulseValues.length
    : null;

  const impulse = (direction === ENGINE29_MOVE_DIRECTIONS.UP || direction === ENGINE29_MOVE_DIRECTIONS.DOWN)
    && Math.abs(averageReturnPct) >= (options.minHeadlineAbsMovePct ?? ENGINE29_MOVE_CHARACTER_DEFAULTS.minHeadlineAbsMovePct)
    && Number.isFinite(averageImpulseMultiple)
    && averageImpulseMultiple >= (options.minHeadlineImpulseMultiple ?? ENGINE29_MOVE_CHARACTER_DEFAULTS.minHeadlineImpulseMultiple);

  return {
    direction,
    impulse,
    members: moves,
    averageReturnPct,
    averageImpulseMultiple,
  };
}

function oneHourContext(groupBundle) {
  const groups = groupBundle?.groups || {};
  const names = ["breadth", "leadership", "credit", "ratesDuration"];
  const states = Object.fromEntries(names.map((name) => [name, groups?.[name]?.tactical?.state ?? null]));
  const activeStressCount = Object.values(states).filter(isStressActiveGroupState).length;
  const confirmedStressCount = Object.values(states).filter((state) => (
    state === ENGINE29_GROUP_STATES.CONFIRMED || state === ENGINE29_GROUP_STATES.SEVERE
  )).length;
  return { states, activeStressCount, confirmedStressCount };
}

export function detectSqueezeCharacter(structureBundle, groupBundle, broadConfirmation, options = {}) {
  const headline = headlineImpulse(structureBundle, options);
  const oneHour = oneHourContext(groupBundle);
  const direction = headline.direction;

  const oneHourOpposesUpside = direction === ENGINE29_MOVE_DIRECTIONS.UP && oneHour.activeStressCount >= 2;
  const oneHourOpposesDownside = direction === ENGINE29_MOVE_DIRECTIONS.DOWN && oneHour.activeStressCount <= 1;
  const broadMissing = !broadConfirmation?.broadConfirmed;

  const squeezeLike = headline.impulse
    && broadMissing
    && (oneHourOpposesUpside || oneHourOpposesDownside || broadConfirmation?.independentBlocksConfirmed <= 1);

  let character = null;
  if (squeezeLike && direction === ENGINE29_MOVE_DIRECTIONS.UP) {
    character = ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE;
  } else if (squeezeLike && direction === ENGINE29_MOVE_DIRECTIONS.DOWN) {
    character = ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE;
  }

  const reasonCodes = [];
  if (headline.impulse && direction === ENGINE29_MOVE_DIRECTIONS.UP) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.HEADLINE_UP_IMPULSE);
  if (headline.impulse && direction === ENGINE29_MOVE_DIRECTIONS.DOWN) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.HEADLINE_DOWN_IMPULSE);
  if (direction === ENGINE29_MOVE_DIRECTIONS.MIXED) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.HEADLINE_MIXED);
  if (oneHour.activeStressCount >= 2) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.ONE_HOUR_STRESS_STILL_ACTIVE);
  if (oneHourOpposesUpside || oneHourOpposesDownside) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.ONE_HOUR_CONTEXT_OPPOSES_FAST_MOVE);

  return {
    squeezeLike,
    character,
    direction,
    headline,
    oneHour,
    broadConfirmationMissing: broadMissing,
    reasonCodes,
  };
}
