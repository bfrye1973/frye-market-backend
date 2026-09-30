// services/core/logic/engine29/tacticalCharacter/resolveMoveCharacter.js

import { ENGINE29_CONFIDENCE } from "../constants.js";
import {
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_DIRECTIONS,
} from "./moveCharacterConstants.js";

function confidenceFrom({ liquiditySweep, failedMove, squeeze, broadConfirmation, directionalMoveParent }) {
  if (liquiditySweep?.detected || failedMove?.detected) return ENGINE29_CONFIDENCE.HIGH;
  if (squeeze?.squeezeLike) {
    const blockCount = squeeze?.broadConfirmationMissing ? broadConfirmation?.independentBlocksConfirmed ?? 0 : 3;
    return blockCount <= 1 ? ENGINE29_CONFIDENCE.HIGH : ENGINE29_CONFIDENCE.MEDIUM;
  }
  if (squeeze?.headline?.impulse && broadConfirmation?.broadConfirmed) return ENGINE29_CONFIDENCE.HIGH;
  if (directionalMoveParent?.active) return ENGINE29_CONFIDENCE.MEDIUM;
  if (squeeze?.headline?.direction === ENGINE29_MOVE_DIRECTIONS.MIXED) return ENGINE29_CONFIDENCE.LOW;
  return ENGINE29_CONFIDENCE.MEDIUM;
}

export function resolveMoveCharacter({
  liquiditySweeps = [],
  failedMoves = [],
  squeeze,
  broadConfirmation,
  directionalMove,
  directionalMoveParent,
} = {}) {
  const liquiditySweep = liquiditySweeps.find((x) => x?.detected) || null;
  const failedMove = failedMoves.find((x) => x?.detected) || null;

  let moveCharacter = ENGINE29_MOVE_CHARACTERS.NO_ACTIVE_MOVE;

  // The move lane owns movement character only.
  // Liquidity sweeps and failed auctions remain available as diagnostics,
  // but they no longer replace the independent move-lane state.
  if (squeeze?.squeezeLike && squeeze?.character) {
    moveCharacter = squeeze.character;
  } else if (squeeze?.headline?.impulse && broadConfirmation?.broadConfirmed) {
    moveCharacter = ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED;
  } else if (
    directionalMoveParent?.active &&
    directionalMoveParent?.direction === ENGINE29_MOVE_DIRECTIONS.UP
  ) {
    moveCharacter = ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE;
  } else if (
    directionalMoveParent?.active &&
    directionalMoveParent?.direction === ENGINE29_MOVE_DIRECTIONS.DOWN
  ) {
    moveCharacter = ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE;
  } else if (squeeze?.headline?.direction === ENGINE29_MOVE_DIRECTIONS.MIXED) {
    moveCharacter = ENGINE29_MOVE_CHARACTERS.MIXED;
  }

  return {
    moveCharacter,
    direction:
      moveCharacter === ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE ||
      moveCharacter === ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE ||
      moveCharacter === ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED ||
      moveCharacter === ENGINE29_MOVE_CHARACTERS.MIXED
        ? squeeze?.headline?.direction ?? ENGINE29_MOVE_DIRECTIONS.FLAT
        : directionalMoveParent?.active
          ? directionalMoveParent.direction
          : ENGINE29_MOVE_DIRECTIONS.FLAT,
    confidence: confidenceFrom({
      liquiditySweep,
      failedMove,
      squeeze,
      broadConfirmation,
      directionalMoveParent,
    }),
    directionalMove,
    directionalMoveParent,
    liquiditySweep,
    failedMove,
  };
}
