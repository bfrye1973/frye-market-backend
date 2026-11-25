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

function esImpulse(esAnchor, options = {}) {
  const entry = esAnchor?.structure || esAnchor || null;
  const view = entry?.fastTactical;

  if (!view) {
    return {
      anchor: "ES",
      anchorAvailable: false,
      direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      impulse: false,
      members: [],
      averageReturnPct: null,
      averagePointMove: null,
      averageImpulseMultiple: null,
    };
  }

  const move = deriveDirectionalMove(view, {
    barsBack: options.headlineBarsBack ?? ENGINE29_MOVE_CHARACTER_DEFAULTS.headlineBarsBack,
    minAbsMovePct: options.minHeadlineAbsMovePct ?? ENGINE29_MOVE_CHARACTER_DEFAULTS.minHeadlineAbsMovePct,
    baselineFraction: 1,
  });

  const impulse = (move.direction === ENGINE29_MOVE_DIRECTIONS.UP || move.direction === ENGINE29_MOVE_DIRECTIONS.DOWN)
    && Math.abs(move.returnPct ?? 0) >= (options.minHeadlineAbsMovePct ?? ENGINE29_MOVE_CHARACTER_DEFAULTS.minHeadlineAbsMovePct)
    && Number.isFinite(move.impulseMultiple)
    && move.impulseMultiple >= (options.minHeadlineImpulseMultiple ?? ENGINE29_MOVE_CHARACTER_DEFAULTS.minHeadlineImpulseMultiple);

  return {
    anchor: "ES",
    anchorAvailable: true,
    direction: move.direction,
    impulse,
    members: [{ symbol: "ES", move }],
    averageReturnPct: move.returnPct,
    averagePointMove: move.pointMove,
    averageImpulseMultiple: move.impulseMultiple,
    resolvedSymbol: esAnchor?.resolvedSymbol || entry?.sourceSymbol || null,
  };
}

function oneHourContext(groupBundle, esAnchor, options = {}) {
  const groups = groupBundle?.groups || {};
  const names = ["breadth", "leadership", "credit", "ratesDuration"];
  const states = Object.fromEntries(names.map((name) => [name, groups?.[name]?.tactical?.state ?? null]));
  const activeStressCount = Object.values(states).filter(isStressActiveGroupState).length;
  const confirmedStressCount = Object.values(states).filter((state) => (
    state === ENGINE29_GROUP_STATES.CONFIRMED || state === ENGINE29_GROUP_STATES.SEVERE
  )).length;

  const esEntry = esAnchor?.structure || esAnchor || null;
  const esOneHourMove = esEntry?.tactical
    ? deriveDirectionalMove(esEntry.tactical, {
        barsBack: 1,
        minAbsMovePct: options.minOneHourEsAbsMovePct ?? 0.08,
        baselineFraction: 0.5,
      })
    : null;

  return {
    states,
    activeStressCount,
    confirmedStressCount,
    esOneHourMove,
    esOneHourStructureState: esEntry?.tactical?.classification?.state ?? null,
    esOneHourStructureStage: esEntry?.tactical?.classification?.stage ?? null,
  };
}

export function detectSqueezeCharacter(structureBundle, groupBundle, broadConfirmation, options = {}) {
  const esAnchor = options.esAnchor || null;
  const headline = esImpulse(esAnchor, options);
  const oneHour = oneHourContext(groupBundle, esAnchor, options);
  const direction = headline.direction;

  const esOneHourOpposesFastMove = Boolean(
    oneHour?.esOneHourMove?.available
    && ((direction === ENGINE29_MOVE_DIRECTIONS.UP && oneHour.esOneHourMove.direction === ENGINE29_MOVE_DIRECTIONS.DOWN)
      || (direction === ENGINE29_MOVE_DIRECTIONS.DOWN && oneHour.esOneHourMove.direction === ENGINE29_MOVE_DIRECTIONS.UP)),
  );

  const oneHourOpposesUpside = direction === ENGINE29_MOVE_DIRECTIONS.UP
    && (oneHour.activeStressCount >= 2 || esOneHourOpposesFastMove);
  const oneHourOpposesDownside = direction === ENGINE29_MOVE_DIRECTIONS.DOWN
    && (oneHour.activeStressCount <= 1 || esOneHourOpposesFastMove);
  const broadMissing = !broadConfirmation?.broadConfirmed;

  const squeezeLike = headline.anchorAvailable
    && headline.impulse
    && broadMissing
    && (oneHourOpposesUpside || oneHourOpposesDownside || broadConfirmation?.independentBlocksConfirmed <= 1);

  let character = null;
  if (squeezeLike && direction === ENGINE29_MOVE_DIRECTIONS.UP) {
    character = ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE;
  } else if (squeezeLike && direction === ENGINE29_MOVE_DIRECTIONS.DOWN) {
    character = ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE;
  }

  const reasonCodes = [];
  if (!headline.anchorAvailable) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.ES_ANCHOR_MISSING);
  if (headline.impulse && direction === ENGINE29_MOVE_DIRECTIONS.UP) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.ES_UP_IMPULSE);
  if (headline.impulse && direction === ENGINE29_MOVE_DIRECTIONS.DOWN) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.ES_DOWN_IMPULSE);
  if (oneHour.activeStressCount >= 2) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.ONE_HOUR_STRESS_STILL_ACTIVE);
  if (oneHourOpposesUpside || oneHourOpposesDownside) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.ONE_HOUR_CONTEXT_OPPOSES_FAST_MOVE);
  if (esOneHourOpposesFastMove) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.ES_ONE_HOUR_OPPOSES_FAST_MOVE);

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
