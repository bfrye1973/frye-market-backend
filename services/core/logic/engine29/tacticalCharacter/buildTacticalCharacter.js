// services/core/logic/engine29/tacticalCharacter/buildTacticalCharacter.js

import { ENGINE29_TIMEFRAMES } from "../constants.js";
import {
  ENGINE29_MOVE_CHARACTERS,
  ENGINE29_MOVE_DIRECTIONS,
  ENGINE29_MOVE_REASON_CODES,
  ENGINE29_UNDERLYING_PRESSURE,
} from "./moveCharacterConstants.js";
import { buildEngine29EsFuturesAnchor } from "./buildEsFuturesAnchor.js";
import { detectLiquiditySweep } from "./detectLiquiditySweep.js";
import { detectFailedMove } from "./detectFailedMove.js";
import { detectBroadConfirmation } from "./detectBroadConfirmation.js";
import { detectSqueezeCharacter } from "./detectSqueezeCharacter.js";
import { detectUnderlyingPressure } from "./detectUnderlyingPressure.js";
import { resolveMoveCharacter } from "./resolveMoveCharacter.js";
import { resolveDirectionalMoveParent } from "./resolveDirectionalMoveParent.js";
import { deriveAdaptiveDirectionalMove } from "./tacticalCharacterUtils.js";

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function memberLabel(block) {
  if (!block || !block.availableCount) return "NO DATA";
  if (block.confirmed) return "CONFIRMING";
  if (block.confirmingCount > 0) return "PARTIAL";
  return "NOT CONFIRMING";
}

function pressureLabel(block) {
  if (!block || !block.availableCount) return "NO DATA";
  if (block.direction === ENGINE29_MOVE_DIRECTIONS.UP) return "POSITIVE";
  if (block.direction === ENGINE29_MOVE_DIRECTIONS.DOWN) return "NEGATIVE";
  if (block.direction === ENGINE29_MOVE_DIRECTIONS.MIXED) return "MIXED";
  return "FLAT";
}

function detectDirectionalMove(esEntry, options = {}) {
  const view = esEntry?.fastTactical;

  if (!view) {
    return {
      active: false,
      direction: ENGINE29_MOVE_DIRECTIONS.FLAT,
      available: false,
      stale: false,
      reason: "NO_30M_AUTHORITY",
      returnPct: null,
      pointMove: null,
      thresholdPct: null,
    };
  }

  const move = deriveAdaptiveDirectionalMove(view, {
    barsBack: options.directionalMoveBarsBack,
    baselineWindows: options.directionalMoveBaselineWindows,
    minAbsMovePct: options.minDirectionalMoveAbsPct,
    minAlignedFraction: options.directionalMoveMinAlignedFraction,
    minEfficiency: options.directionalMoveMinEfficiency,
  });

  return {
    ...move,
    active: move.active === true,
    authority: "30M_MULTI_BAR_DIRECTIONAL_MOVE",
  };
}

function plainEnglish(
  moveCharacter,
  direction,
  broadConfirmation,
  squeeze,
  underlyingPressure
) {
  const headlineEtfs = memberLabel(broadConfirmation?.blocks?.headlineEtfs);
  const breadth = memberLabel(broadConfirmation?.blocks?.breadth);
  const leadership = memberLabel(broadConfirmation?.blocks?.leadership);
  const credit = memberLabel(broadConfirmation?.blocks?.credit);

  let summary = "No qualified ES 30-minute directional move is active.";
  let status = "NO ACTIVE MOVE";

  if (moveCharacter === ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE) {
    summary =
      "ES has an active multi-bar 30-minute upside move. Squeeze confirmation is not required for this state.";
    status = "ES UPSIDE MOVE ACTIVE";
  } else if (
    moveCharacter === ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE
  ) {
    summary =
      "ES has an active multi-bar 30-minute downside move. Squeeze confirmation is not required for this state.";
    status = "ES DOWNSIDE MOVE ACTIVE";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.POSSIBLE_UPSIDE_SQUEEZE) {
    summary =
      "ES is moving sharply higher, but the broader market underneath it is not yet confirming the move.";
    status = "POSSIBLE ES UPSIDE SQUEEZE";
  } else if (
    moveCharacter === ENGINE29_MOVE_CHARACTERS.POSSIBLE_DOWNSIDE_SQUEEZE
  ) {
    summary =
      "ES is moving sharply lower, but the broader market underneath it is not yet confirming the selloff.";
    status = "POSSIBLE ES DOWNSIDE SQUEEZE";
  } else if (
    moveCharacter === ENGINE29_MOVE_CHARACTERS.BROAD_MOVE_CONFIRMED
  ) {
    summary =
      direction === "UP"
        ? "The ES rally is broadening across independent market internals."
        : "The ES selloff is broadening across independent market internals.";
    status =
      direction === "UP"
        ? "ES BROAD RALLY CONFIRMED"
        : direction === "DOWN"
          ? "ES BROAD SELLOFF CONFIRMED"
          : "ES BROAD MOVE CONFIRMED";
  } else if (moveCharacter === ENGINE29_MOVE_CHARACTERS.MIXED) {
    summary = "ES has an active move, but the confirmation picture is mixed.";
    status = "ES MOVE MIXED";
  } else if (
    underlyingPressure?.state === ENGINE29_UNDERLYING_PRESSURE.NEGATIVE
  ) {
    summary = underlyingPressure.headlineHoldingBetter
      ? "No qualified ES 30-minute move is active, but selling pressure is visible underneath the headline market."
      : "No qualified ES 30-minute move is active, but cross-market internals are leaning negative.";
  } else if (
    underlyingPressure?.state === ENGINE29_UNDERLYING_PRESSURE.POSITIVE
  ) {
    summary =
      "No qualified ES 30-minute move is active, but cross-market internals are leaning positive.";
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
    moveConfirmation: {
      spyQqq: headlineEtfs,
      breadth,
      leadership,
      credit,
    },
    underlyingPressure: {
      state: underlyingPressure?.state ?? null,
      headlineHoldingBetter: Boolean(
        underlyingPressure?.headlineHoldingBetter
      ),
      spyQqq: pressureLabel(underlyingPressure?.blocks?.headlineEtfs),
      breadth: pressureLabel(underlyingPressure?.blocks?.breadth),
      leadership: pressureLabel(underlyingPressure?.blocks?.leadership),
      credit: pressureLabel(underlyingPressure?.blocks?.credit),
      financials: pressureLabel(underlyingPressure?.blocks?.financials),
    },
  };
}

export function buildEngine29TacticalCharacter(
  structureBundle,
  groupBundle,
  {
    now = Date.now(),
    esAnchor = null,
    ...options
  } = {}
) {
  const symbols = structureBundle?.symbols || {};
  const detectorOptions = { ...options, esAnchor };

  const directionProbe = detectSqueezeCharacter(
    structureBundle,
    groupBundle,
    detectBroadConfirmation(
      structureBundle,
      ENGINE29_MOVE_DIRECTIONS.FLAT,
      detectorOptions
    ),
    detectorOptions
  );

  const direction =
    directionProbe?.headline?.direction ??
    ENGINE29_MOVE_DIRECTIONS.FLAT;

  const broadConfirmation = detectBroadConfirmation(
    structureBundle,
    direction,
    detectorOptions
  );

  const squeeze = detectSqueezeCharacter(
    structureBundle,
    groupBundle,
    broadConfirmation,
    detectorOptions
  );

  const underlyingPressure = detectUnderlyingPressure(
    structureBundle,
    detectorOptions
  );

  const esEntry = esAnchor?.structure || esAnchor || null;

  const directionalMove =
    detectDirectionalMove(
      esEntry,
      detectorOptions
    );

  const directionalMoveParent =
    resolveDirectionalMoveParent({
      candidate: directionalMove,
      priorParent: options.priorMoveParent || null,
      now,
    });

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
    directionalMove,
    directionalMoveParent,
  });

  const reasonCodes = unique([
    ...(broadConfirmation?.reasonCodes || []),
    ...(squeeze?.reasonCodes || []),
    ...(underlyingPressure?.reasonCodes || []),
    ...sweepCandidates.map((x) => x?.reasonCode),
    ...failedMoveCandidates.map((x) => x?.reasonCode),
    directionalMove?.stale
      ? ENGINE29_MOVE_REASON_CODES.ES_30M_DIRECTIONAL_MOVE_STALE
      : directionalMove?.active
        ? ENGINE29_MOVE_REASON_CODES.ES_30M_DIRECTIONAL_MOVE_ACTIVE
        : ENGINE29_MOVE_REASON_CODES.ES_30M_DIRECTIONAL_MOVE_NOT_ACTIVE,
  ]);

  const directVixAvailable = Boolean(
    symbols.VIX?.fastTactical && !symbols.VIX?.isProxy
  );

  if (!directVixAvailable) {
    reasonCodes.push(
      ENGINE29_MOVE_REASON_CODES.DIRECT_VOLATILITY_CONFIRMATION_MISSING
    );
  }

  if (!esEntry?.fastTactical) {
    reasonCodes.push(ENGINE29_MOVE_REASON_CODES.ES_ANCHOR_MISSING);
  }

  return {
    version: "engine29.tacticalCharacter.v2.4.moveParent",
    timestamp: new Date(now).toISOString(),
    timeframe: ENGINE29_TIMEFRAMES.FAST_TACTICAL,
    anchor: "ES",

    esResolvedSymbol:
      esAnchor?.resolvedSymbol ||
      esEntry?.sourceSymbol ||
      null,

    esLiveMonitor:
      esAnchor?.liveMonitor || null,

    esLiveMonitorAvailable:
      Boolean(esAnchor?.liveMonitorAvailable),

    esLiveMonitorFreshness:
      esAnchor?.liveMonitorFreshness || null,

    moveCharacter: resolved.moveCharacter,
    direction: resolved.direction,
    confidence: resolved.confidence,

    esImpulse: squeeze?.headline || null,
    headlineImpulse: squeeze?.headline || null,
    directionalMove,
    directionalMoveParent,
    broadConfirmation,
    underlyingPressure,
    oneHourContext: squeeze?.oneHour || null,
    liquiditySweeps: sweepCandidates,
    failedMoves: failedMoveCandidates,
    directVixAvailable,

    dataDegraded:
      Boolean(structureBundle?.dataDegraded) ||
      !directVixAvailable ||
      !esEntry?.fastTactical ||
      directionalMove?.stale === true,

    reasonCodes: unique(reasonCodes),

    display: plainEnglish(
      resolved.moveCharacter,
      resolved.direction,
      broadConfirmation,
      squeeze,
      underlyingPressure
    ),
  };
}

export async function buildEngine29TacticalCharacterWithEs(
  structureBundle,
  groupBundle,
  {
    now = Date.now(),
    esSymbol = "ES",
    ...options
  } = {}
) {
  const esAnchor = await buildEngine29EsFuturesAnchor({
    now,
    symbol: esSymbol,
  });

  return buildEngine29TacticalCharacter(
    structureBundle,
    groupBundle,
    {
      now,
      esAnchor,
      ...options,
    }
  );
}
