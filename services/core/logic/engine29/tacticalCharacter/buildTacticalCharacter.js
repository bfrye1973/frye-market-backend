// services/core/logic/engine29/tacticalCharacter/buildTacticalCharacter.js

import { ENGINE29_TIMEFRAMES } from "../constants.js";
import {
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_REASON_CODES,
} from "./moveCharacterConstants.js";
import { buildEngine29EsFuturesAnchor } from "./buildEsFuturesAnchor.js";
import { detectLiquiditySweep } from "./detectLiquiditySweep.js";
import { detectFailedMove } from "./detectFailedMove.js";
import { detectBroadConfirmation } from "./detectBroadConfirmation.js";
import { detectSqueezeCharacter } from "./detectSqueezeCharacter.js";
import { resolveMoveCharacter } from "./resolveMoveCharacter.js";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function memberLabel(block) {
  if (!block || !block.availableCount) return "NO DATA";
  if (block.confirmed) return "CONFIRMING";
  if (block.confirmingCount > 0) return "PARTIAL";
  return "NOT CONFIRMING";
}

function plainEnglish(moveCharacter, direction, broadConfirmation, squeeze) {
  const headlineEtfs = memberLabel(broadConfirmation?.blocks?.headlineEtfs);
  const breadth = memberLabel(broadConfirmation?.blocks?.breadth);
  const leadership = memberLabel(broadConfirmation?.blocks?.leadership);
  const credit = memberLabel(broadConfirmation?.blocks?.credit);

  let summary = "No unusual ES 30-minute move is active.";
  let status = "NO ACTIVE SQUEEZE";

  if (moveCharacter === ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE) {
    summary = "ES is moving sharply higher, but the broader market underneath it is not yet confirming the move.";
    status = "POSSIBLE ES UPSIDE SQUEEZE";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE) {
    summary = "ES is moving sharply lower, but the broader market underneath it is not yet confirming the selloff.";
    status = "POSSIBLE ES DOWNSIDE SQUEEZE";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED) {
    summary = direction === "UP"
      ? "The ES rally is broadening across independent market internals."
      : "The ES selloff is broadening across independent market internals.";
    status = "ES BROAD MOVE CONFIRMED";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_HIGH) {
    summary = "ES traded above a recent 30-minute resistance/swing area but failed to hold it on a completed bar.";
    status = "ES LIQUIDITY SWEEP HIGH";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.LIQUIDITY_SWEEP_LOW) {
    summary = "ES traded below a recent 30-minute support/swing area but reclaimed it on a completed bar.";
    status = "ES LIQUIDITY SWEEP LOW";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.FAILED_BREAKOUT) {
    summary = "An ES 30-minute breakout was followed by a close back below resistance.";
    status = "ES FAILED BREAKOUT";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.FAILED_BREAKDOWN) {
    summary = "An ES 30-minute breakdown was followed by a close back above support.";
    status = "ES FAILED BREAKDOWN";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.MIXED) {
    summary = "ES has an active move, but the confirmation picture is mixed.";
    status = "ES MOVE MIXED";
  }

  return {
    status,
    summary,
    es: {
      direction: squeeze?.headline?.direction ?? null,
      returnPct: squeeze?.headline?.averageReturnPct ?? null,
      pointMove: squeeze?.headline?.averagePointMove ?? null,
      impulseMultiple: squeeze?.headline?.averageImpulseMultiple ?? null,
      resolvedSymbol: squeeze?.headline?.resolvedSymbol ?? null,
    },
    underTheHood: {
      spyQqq: headlineEtfs,
      breadth,
      leadership,
      credit,
    },
  };
}

export function buildEngine29TacticalCharacter(structureBundle, groupBundle, {
  now = Date.now(),
  esAnchor = null,
  ...options
} = {}) {
  const symbols = structureBundle?.symbols || {};
  const detectorOptions = { ...options, esAnchor };

  // First pass determines ES direction. Then all internals are evaluated against ES.
  const initialBroad = detectBroadConfirmation(structureBundle, "UP", detectorOptions);
  const initialSqueeze = detectSqueezeCharacter(structureBundle, groupBundle, initialBroad, detectorOptions);
  const direction = initialSqueeze?.headline?.direction;
  const broadConfirmation = direction === "UP" || direction === "DOWN"
    ? detectBroadConfirmation(structureBundle, direction, detectorOptions)
    : initialBroad;
  const squeeze = detectSqueezeCharacter(structureBundle, groupBundle, broadConfirmation, detectorOptions);

  const esEntry = esAnchor?.structure || esAnchor || null;
  const sweepCandidates = esEntry?.fastTactical
    ? [detectLiquiditySweep(esEntry, detectorOptions)]
    : [];

  const failedMoveCandidates = esEntry?.fastTactical
    ? [detectFailedMove(esEntry)]
    : [];

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
  if (!esEntry?.fastTactical) reasonCodes.push(ENGINE29_MOVE_REASON_CODES.ES_ANCHOR_MISSING);

  return {
    version: "engine29.tacticalCharacter.v2.esAnchor",
    timestamp: new Date(now).toISOString(),
    timeframe: ENGINE29_TIMEFRAMES.FAST_TACTICAL,
    anchor: "ES",
    esResolvedSymbol: esAnchor?.resolvedSymbol || esEntry?.sourceSymbol || null,
    moveCharacter: resolved.moveCharacter,
    direction: resolved.direction,
    confidence: resolved.confidence,
    esImpulse: squeeze?.headline || null,
    // Compatibility alias for older consumers.
    headlineImpulse: squeeze?.headline || null,
    broadConfirmation,
    oneHourContext: squeeze?.oneHour || null,
    liquiditySweeps: sweepCandidates,
    failedMoves: failedMoveCandidates,
    directVixAvailable,
    dataDegraded: Boolean(structureBundle?.dataDegraded) || !directVixAvailable || !esEntry?.fastTactical,
    reasonCodes: unique(reasonCodes),
    display: plainEnglish(resolved.moveCharacter, resolved.direction, broadConfirmation, squeeze),
  };
}

// Convenience path for jobs/routes: fetch the live ES anchor using Frye's existing
// futures provider, then resolve move character in one call.
export async function buildEngine29TacticalCharacterWithEs(structureBundle, groupBundle, {
  now = Date.now(),
  esSymbol = "ES",
  ...options
} = {}) {
  const esAnchor = await buildEngine29EsFuturesAnchor({ now, symbol: esSymbol });
  return buildEngine29TacticalCharacter(structureBundle, groupBundle, {
    now,
    esAnchor,
    ...options,
  });
}
