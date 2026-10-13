// services/core/logic/engine29/alerts/detectStateTransition.js
//
// MOVE v2 alert separation:
// parent MOVE, MOVE character, LIQUIDITY, and TRAP are independent events.

import { ENGINE29_OVERALL_STATES } from "../constants.js";
import { ENGINE29_ALERT_TYPES } from "../aggregate/overallStateConstants.js";

const OVERALL_RANK = Object.freeze({
  [ENGINE29_OVERALL_STATES.NORMAL]: 0,
  [ENGINE29_OVERALL_STATES.EARLY_WARNING]: 1,
  [ENGINE29_OVERALL_STATES.BROAD_DETERIORATION]: 2,
  [ENGINE29_OVERALL_STATES.RISK_OFF_CONFIRMED]: 3,
  [ENGINE29_OVERALL_STATES.SYSTEMIC_STRESS]: 4,
});

function parentState(snapshot) {
  return (
    snapshot?.marketCharacter?.move?.parent?.state ??
    snapshot?.moveCharacter?.moveCharacter ??
    null
  );
}

function parentDirection(snapshot) {
  return (
    snapshot?.marketCharacter?.move?.parent?.direction ??
    snapshot?.moveCharacter?.direction ??
    null
  );
}

function characterType(snapshot) {
  return (
    snapshot?.marketCharacter?.move?.character?.type ??
    null
  );
}

function liquidityState(snapshot) {
  return (
    snapshot?.marketCharacter?.liquidity?.state ??
    snapshot?.trapDetection?.liquidity?.state ??
    null
  );
}

function trapState(snapshot) {
  return (
    snapshot?.marketCharacter?.trap?.state ??
    snapshot?.trapDetection?.state ??
    null
  );
}

export function detectEngine29StateTransition(previous, current) {
  if (!current) return [];
  const events = [];

  const prevOverall = previous?.overallState ?? null;
  const currOverall = current?.overallState ?? null;

  if (prevOverall && currOverall && prevOverall !== currOverall) {
    const prevRank = OVERALL_RANK[prevOverall] ?? -1;
    const currRank = OVERALL_RANK[currOverall] ?? -1;

    events.push({
      type:
        currRank > prevRank
          ? ENGINE29_ALERT_TYPES.STATE_UPGRADE
          : ENGINE29_ALERT_TYPES.STATE_DOWNGRADE,
      previous: prevOverall,
      current: currOverall,
    });
  }

  if (
    previous?.tacticalState &&
    current?.tacticalState &&
    previous.tacticalState !== current.tacticalState
  ) {
    events.push({
      type: ENGINE29_ALERT_TYPES.TACTICAL_CHANGE,
      previous: previous.tacticalState,
      current: current.tacticalState,
    });
  }

  const prevParent = parentState(previous);
  const currParent = parentState(current);

  if (currParent && currParent !== prevParent) {
    events.push({
      type: ENGINE29_ALERT_TYPES.PARENT_MOVE_CHANGE,
      previous: prevParent,
      current: currParent,
      direction: parentDirection(current),
    });
  }

  const prevCharacter = characterType(previous);
  const currCharacter = characterType(current);

  if (currCharacter !== prevCharacter) {
    events.push({
      type: ENGINE29_ALERT_TYPES.MOVE_CHARACTER_CHANGE,
      previous: prevCharacter,
      current: currCharacter,
      parent: currParent,
      parentDirection: parentDirection(current),
    });
  }

  const prevLiquidity = liquidityState(previous);
  const currLiquidity = liquidityState(current);

  if (
    currLiquidity &&
    currLiquidity !== prevLiquidity &&
    currLiquidity !== "NO_LIQUIDITY_EVENT"
  ) {
    events.push({
      type: ENGINE29_ALERT_TYPES.LIQUIDITY_EVENT,
      previous: prevLiquidity,
      current: currLiquidity,
    });
  }

  const prevTrap = trapState(previous);
  const currTrap = trapState(current);

  if (currTrap && currTrap !== prevTrap) {
    events.push({
      type: ENGINE29_ALERT_TYPES.TRAP_STATE_CHANGE,
      previous: prevTrap,
      current: currTrap,
    });
  }

  if (
    previous &&
    Boolean(previous.dataDegraded) !== Boolean(current.dataDegraded)
  ) {
    events.push({
      type: ENGINE29_ALERT_TYPES.DATA_QUALITY_CHANGE,
      previous: Boolean(previous.dataDegraded),
      current: Boolean(current.dataDegraded),
    });
  }

  return events;
}

export default detectEngine29StateTransition;
