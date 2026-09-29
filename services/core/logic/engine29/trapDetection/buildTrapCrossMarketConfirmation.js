// services/core/logic/engine29/trapDetection/buildTrapCrossMarketConfirmation.js
// Engine 29 — secondary cross-market trap confirmation.
//
// Primary participation authority remains Engine 25 scanner breadth + stock volume.
// This module only interprets Engine 29's existing fast cross-market blocks.

import { ENGINE29_TRAP_SIDES } from "./trapConstants.js";

function blockDirection(block) {
  return block?.direction || null;
}

function pressureBlock(moveCharacter, key) {
  return moveCharacter?.underlyingPressure?.blocks?.[key] || null;
}

function vixRead(moveCharacter, trapSide) {
  const symbolMoves =
    moveCharacter?.liveMonitor?.symbolMoves ||
    null;

  const directAvailable =
    moveCharacter?.directVixAvailable === true;

  // Existing move-character object does not expose a dedicated VIX direction
  // block here. Preserve VIX as availability/context only in Phase B3 rather
  // than inventing a second volatility calculation.
  return {
    available: directAvailable,
    supportsTrap: null,
    opposesTrap: null,
    note:
      trapSide === ENGINE29_TRAP_SIDES.NONE
        ? null
        : "Direct VIX remains contextual until the existing live VIX move is handed into this adapter.",
    symbolMoves,
  };
}

export function buildEngine29TrapCrossMarketConfirmation({
  moveCharacter = null,
  trapSide = ENGINE29_TRAP_SIDES.NONE,
} = {}) {
  const blocks = {
    headline:
      pressureBlock(
        moveCharacter,
        "headlineEtfs"
      ),
    breadth:
      pressureBlock(
        moveCharacter,
        "breadth"
      ),
    leadership:
      pressureBlock(
        moveCharacter,
        "leadership"
      ),
    credit:
      pressureBlock(
        moveCharacter,
        "credit"
      ),
    financials:
      pressureBlock(
        moveCharacter,
        "financials"
      ),
  };

  const desiredDirection =
    trapSide === ENGINE29_TRAP_SIDES.BULL
      ? "DOWN"
      : trapSide === ENGINE29_TRAP_SIDES.BEAR
        ? "UP"
        : null;

  const relevantKeys = [
    "leadership",
    "credit",
    "financials",
  ];

  const confirming = [];
  const opposing = [];
  const neutral = [];

  for (const key of relevantKeys) {
    const direction =
      blockDirection(blocks[key]);

    if (!desiredDirection || !direction) {
      neutral.push(key);
      continue;
    }

    if (direction === desiredDirection) {
      confirming.push(key);
    } else if (
      direction === "UP" ||
      direction === "DOWN"
    ) {
      opposing.push(key);
    } else {
      neutral.push(key);
    }
  }

  return {
    version:
      "engine29.trapCrossMarketConfirmation.v1",
    authority: "SECONDARY_CONFIRMATION_ONLY",
    trapSide,
    desiredDirection,

    confirmingBlocks: confirming,
    opposingBlocks: opposing,
    neutralBlocks: neutral,

    confirmationCount: confirming.length,
    opposingCount: opposing.length,

    secondarySupportsTrap:
      confirming.length >= 2 &&
      opposing.length === 0,

    secondaryOpposesTrap:
      opposing.length >= 2,

    blocks,
    volatility:
      vixRead(moveCharacter, trapSide),

    reasonCodes: [
      confirming.length >= 2
        ? "ENGINE29_SECONDARY_BLOCKS_SUPPORT_TRAP"
        : null,
      opposing.length >= 2
        ? "ENGINE29_SECONDARY_BLOCKS_OPPOSE_TRAP"
        : null,
    ].filter(Boolean),
  };
}

export default buildEngine29TrapCrossMarketConfirmation;
