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

function vixRead(moveCharacter, liveMonitor, trapSide) {
  const directAvailable =
    moveCharacter?.directVixAvailable === true;

  const rawMove10 =
    liveMonitor?.metrics?.vix?.move10;

  const move10 =
    rawMove10 === null || rawMove10 === undefined || rawMove10 === ""
      ? null
      : Number(rawMove10);

  const available =
    directAvailable &&
    Number.isFinite(move10);

  const supportsTrap =
    available &&
    (
      (trapSide === ENGINE29_TRAP_SIDES.BULL && move10 > 0) ||
      (trapSide === ENGINE29_TRAP_SIDES.BEAR && move10 < 0)
    );

  const opposesTrap =
    available &&
    (
      (trapSide === ENGINE29_TRAP_SIDES.BULL && move10 < 0) ||
      (trapSide === ENGINE29_TRAP_SIDES.BEAR && move10 > 0)
    );

  return {
    available,
    directAvailable,
    move10: Number.isFinite(move10) ? move10 : null,
    supportsTrap,
    opposesTrap,
  };
}

export function buildEngine29TrapCrossMarketConfirmation({
  moveCharacter = null,
  liveMonitor = null,
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

  const volatility =
    vixRead(
      moveCharacter,
      liveMonitor,
      trapSide
    );

  const secondarySupportsTrap =
    confirming.length >= 2 &&
    opposing.length === 0 &&
    volatility.opposesTrap !== true;

  const secondaryOpposesTrap =
    opposing.length >= 2 ||
    volatility.opposesTrap === true;

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

    secondarySupportsTrap,

    secondaryOpposesTrap,

    blocks,
    volatility,

    reasonCodes: [
      confirming.length >= 2
        ? "ENGINE29_SECONDARY_BLOCKS_SUPPORT_TRAP"
        : null,
      opposing.length >= 2
        ? "ENGINE29_SECONDARY_BLOCKS_OPPOSE_TRAP"
        : null,
      volatility.supportsTrap
        ? "DIRECT_VIX_SUPPORTS_TRAP"
        : null,
      volatility.opposesTrap
        ? "DIRECT_VIX_OPPOSES_TRAP"
        : null,
    ].filter(Boolean),
  };
}

export default buildEngine29TrapCrossMarketConfirmation;
