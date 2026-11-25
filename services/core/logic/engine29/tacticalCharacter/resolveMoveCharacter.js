// services/core/logic/engine29/tacticalCharacter/resolveMoveCharacter.js
//
// MOVE v2 compatibility resolver.
//
// Authority contract:
// - directionalMoveParent is the ONLY canonical MOVE direction authority.
// - squeeze, broad confirmation, liquidity, failed-move diagnostics, and
//   10m/20m evidence may describe the move but may not manufacture, reverse,
//   or terminate the parent.
// - legacy moveCharacter/direction are one-way projections FROM parent only.

import { ENGINE29_CONFIDENCE } from "../constants.js";
import {
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_DIRECTIONS,
} from "./moveCharacterConstants.js";

function parentState(parent) {
  if (
    parent?.active === true &&
    parent?.direction === ENGINE29_MOVE_DIRECTIONS.UP
  ) {
    return ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE;
  }

  if (
    parent?.active === true &&
    parent?.direction === ENGINE29_MOVE_DIRECTIONS.DOWN
  ) {
    return ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE;
  }

  return ENGINE29_MOVE_CHARACTERS.NO_ACTIVE_MOVE;
}

function parentDirection(parent) {
  if (
    parent?.active === true &&
    (
      parent?.direction === ENGINE29_MOVE_DIRECTIONS.UP ||
      parent?.direction === ENGINE29_MOVE_DIRECTIONS.DOWN
    )
  ) {
    return parent.direction;
  }

  return ENGINE29_MOVE_DIRECTIONS.FLAT;
}

function confidenceFromParent(parent) {
  if (parent?.stale === true) return ENGINE29_CONFIDENCE.LOW;
  if (parent?.active === true) return ENGINE29_CONFIDENCE.MEDIUM;
  return ENGINE29_CONFIDENCE.LOW;
}

export function resolveMoveCharacter({
  liquiditySweeps = [],
  failedMoves = [],
  squeeze = null,
  broadConfirmation = null,
  directionalMove = null,
  directionalMoveParent = null,
} = {}) {
  const liquiditySweep =
    liquiditySweeps.find((entry) => entry?.detected) || null;

  const failedMove =
    failedMoves.find((entry) => entry?.detected) || null;

  const moveCharacter = parentState(directionalMoveParent);
  const direction = parentDirection(directionalMoveParent);

  return {
    // Legacy compatibility projection. These fields MUST remain derived from
    // parent only during MOVE v2 migration.
    moveCharacter,
    direction,
    confidence: confidenceFromParent(directionalMoveParent),

    directionalMove,
    directionalMoveParent,

    // Companion evidence only. None of these may feed back into parent.
    squeeze,
    broadConfirmation,
    liquiditySweep,
    failedMove,

    authority: "PARENT_MOVE_ONLY",
    legacyProjectionFromParent: true,
  };
}

export default resolveMoveCharacter;
