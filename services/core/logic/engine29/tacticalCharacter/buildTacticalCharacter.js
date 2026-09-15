// services/core/logic/engine29/tacticalCharacter/buildTacticalCharacter.js

import { ENGINE29_TIMEFRAMES } from "../constants.js";
import {
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_REASON_CODES,
} from "./moveCharacterConstants.js";
import { detectLiquiditySweep } from "./detectLiquiditySweep.js";
import { detectFailedMove } from "./detectFailedMove.js";
import { detectBroadConfirmation } from "./detectBroadConfirmation.js";
import { detectSqueezeCharacter } from "./detectSqueezeCharacter.js";
import { resolveMoveCharacter } from "./resolveMoveCharacter.js";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function memberLabel(block) {
  if (!block) return "NO DATA";
  if (block.confirmed) return "CONFIRMING";
  if (block.confirmingCount > 0) return "PARTIAL";
  return "NOT CONFIRMING";
}

function plainEnglish(moveCharacter, direction, broadConfirmation) {
  const breadth = memberLabel(broadConfirmation?.blocks?.breadth);
  const leadership = memberLabel(broadConfirmation?.blocks?.leadership);
  const credit = memberLabel(broadConfirmation?.blocks?.credit);

  let summary = "No unusual 30-minute move is active.";
  let status = "NORMAL / MIXED";

  if (moveCharacter === ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE) {
    summary = "Headline indexes are moving higher faster than the market underneath them. The move is not yet broadly confirmed.";
    status = "POSSIBLE UPSIDE SQUEEZE";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE) {
    summary = "Headline indexes are dropping faster than the market underneath them. The selloff is not yet broadly confirmed.";
    status = "POSSIBLE DOWNSIDE SQUEEZE";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED) {
    summary = direction === "UP"
      ? "The 30-minute rally is broadening beyond the headline indexes."
      : "The 30-minute selloff is broadening beyond the headline indexes.";
    status = "BROAD MOVE CONFIRMED";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_HIGH) {
    summary = "Price traded above a recent resistance/swing area but failed to hold the level on a completed 30-minute bar.";
    status = "LIQUIDITY SWEEP HIGH";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_LOW) {
    summary = "Price traded below a recent support/swing area but failed to hold the level on a completed 30-minute bar.";
    status = "LIQUIDITY SWEEP LOW";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.FAILED_BREAKOUT) {
    summary = "A completed 30-minute breakout was followed by a close back below resistance.";
    status = "FAILED BREAKOUT";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.FAILED_BREAKDOWN) {
    summary = "A completed 30-minute breakdown was followed by a close back above support.";
    status = "FAILED BREAKDOWN";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.MIXED) {
    summary = "SPY and QQQ are not moving together strongly enough to define one clean headline impulse.";
    status = "MIXED";
  }

  return {
    status,
    summary,
    underTheHood: {
      breadth,
      leadership,
      credit,
    },
  };
}

export function buildEngine29TacticalCharacter(structureBundle, groupBundle, {
  now = Date.now(),
  ...options
} = {}) {
  const symbols = structureBundle?.symbols || {};

  const initialBroad = detectBroadConfirmation(structureBundle, "UP", options);
  // Squeeze detector resolves the actual headline direction. We run once to get that direction,
  // then rebuild broad confirmation using the same direction so internals are evaluated correctly.
  const initialSqueeze = detectSqueezeCharacter(structureBundle, groupBundle, initialBroad, options);
  const direction = initialSqueeze?.headline?.direction;
  const broadConfirmation = direction === "UP" || direction === "DOWN"
    ? detectBroadConfirmation(structureBundle, direction, options)
    : initialBroad;
  const squeeze = detectSqueezeCharacter(structureBundle, groupBundle, broadConfirmation, options);

  const sweepCandidates = [symbols.SPY, symbols.QQQ]
    .filter(Boolean)
    .map((entry) => detectLiquiditySweep(entry, options));

  const failedMoveCandidates = [symbols.SPY, symbols.QQQ]
    .filter(Boolean)
    .map((entry) => detectFailedMove(entry));

  const resolved = resolveMoveCharacter({
    liquiditySweeps: sweepCandidates,
    failedMoves: failedMoveCandidates,
    squeeze,
    broadConfirmation,
  });

  const reasonCodes = unique([
    ...(broadConfirmation?.reasonCodes || []),
    ...(squeeze?.reasonCodes || []),
    ...sweepCandidates.map((x) => x?.reasonCode),
    ...failedMoveCandidates.map((x) => x?.reasonCode),
  ]);

  const directVixAvailable = Boolean(symbols.VIX?.fastTactical && !symbols.VIX?.isProxy);
  if (!directVixAvailable) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.DIRECT_VOLATILITY_CONFIRMATION_MISSING);

  return {
    version: "engine29.tacticalCharacter.v1",
    timestamp: new Date(now).toISOString(),
    timeframe: ENGINE29_TIMEFRAMES.FAST_TACTICAL,
    moveCharacter: resolved.moveCharacter,
    direction: resolved.direction,
    confidence: resolved.confidence,
    headlineImpulse: squeeze?.headline || null,
    broadConfirmation,
    oneHourContext: squeeze?.oneHour || null,
    liquiditySweeps: sweepCandidates,
    failedMoves: failedMoveCandidates,
    directVixAvailable,
    dataDegraded: Boolean(structureBundle?.dataDegraded) || !directVixAvailable,
    reasonCodes: unique(reasonCodes),
    display: plainEnglish(resolved.moveCharacter, resolved.direction, broadConfirmation),
  };
}
