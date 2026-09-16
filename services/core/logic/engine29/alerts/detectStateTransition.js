// services/core/logic/engine29/alerts/detectStateTransition.js

import { ENGINE29_OVERALL_STATES } from "../constants.js";
import { ENGINE29_ALERT_TYPES } from "../aggregate/overallStateConstants.js";
import { ENGINE29_MOVE_CHARACTERS } from "../tacticalCharacter/moveCharacterConstants.js";

const OVERALL_RANK = Object.freeze({
  [ENGINE29_OVERALL_STATES.NORMAL]: 0,
  [ENGINE29_OVERALL_STATES.EARLY_WARNING]: 1,
  [ENGINE29_OVERALL_STATES.BROAD_DETERIORATION]: 2,
  [ENGINE29_OVERALL_STATES.RISK_OFF_CONFIRMED]: 3,
  [ENGINE29_OVERALL_STATES.SYSTEMIC_STRESS]: 4,
});

const LIQUIDITY_CHARACTERS = new Set([
  ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE,
  ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE,
  ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_HIGH,
  ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_LOW,
  ENGINE29_MOVE_CHARACTERS.FAILED_BREAKOUT,
  ENGINE29_MOVE_CHARACTERS.FAILED_BREAKDOWN,
]);

export function detectEngine29StateTransition(previous, current) {
  if (!current) return [];
  const events = [];

  const prevOverall = previous?.overallState ?? null;
  const currOverall = current?.overallState ?? null;
  if (prevOverall && currOverall && prevOverall !== currOverall) {
    const prevRank = OVERALL_RANK[prevOverall] ?? -1;
    const currRank = OVERALL_RANK[currOverall] ?? -1;
    events.push({
      type: currRank > prevRank ? ENGINE29_ALERT_TYPES.STATE_UPGRADE : ENGINE29_ALERT_TYPES.STATE_DOWNGRADE,
      previous: prevOverall,
      current: currOverall,
    });
  }

  if (previous?.tacticalState && current?.tacticalState && previous.tacticalState !== current.tacticalState) {
    events.push({
      type: ENGINE29_ALERT_TYPES.TACTICAL_CHANGE,
      previous: previous.tacticalState,
      current: current.tacticalState,
    });
  }

  const prevMove = previous?.moveCharacter?.moveCharacter ?? null;
  const currMove = current?.moveCharacter?.moveCharacter ?? null;
  if (currMove && currMove !== prevMove) {
    events.push({
      type: LIQUIDITY_CHARACTERS.has(currMove)
        ? ENGINE29_ALERT_TYPES.LIQUIDITY_EVENT
        : ENGINE29_ALERT_TYPES.MOVE_CHARACTER_CHANGE,
      previous: prevMove,
      current: currMove,
      direction: current?.moveCharacter?.direction ?? null,
    });
  }

  if (previous && Boolean(previous.dataDegraded) !== Boolean(current.dataDegraded)) {
    events.push({
      type: ENGINE29_ALERT_TYPES.DATA_QUALITY_CHANGE,
      previous: Boolean(previous.dataDegraded),
      current: Boolean(current.dataDegraded),
    });
  }

  return events;
}
