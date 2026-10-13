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

function broadConfirmationState(broadConfirmation) {
  if (!broadConfirmation?.usable) return "NOT_APPLICABLE";
  if (broadConfirmation?.broadConfirmed === true) return "BROAD_CONFIRMED";
  if ((broadConfirmation?.independentBlocksConfirmed ?? 0) === 0) return "NARROW";
  return "MIXED_CONFIRMATION";
}

function buildMoveCharacterLayer({
  parent,
  squeeze,
  broadConfirmation,
} = {}) {
  const parentActive = parent?.active === true;
  const parentDirection = parentActive
    ? parent?.direction ?? ENGINE29_MOVE_DIRECTIONS.FLAT
    : ENGINE29_MOVE_DIRECTIONS.FLAT;

  const squeezeDirection =
    squeeze?.headline?.direction ?? ENGINE29_MOVE_DIRECTIONS.FLAT;

  const squeezeActive =
    squeeze?.squeezeLike === true &&
    (
      squeezeDirection === ENGINE29_MOVE_DIRECTIONS.UP ||
      squeezeDirection === ENGINE29_MOVE_DIRECTIONS.DOWN
    );

  const broadState = broadConfirmationState(broadConfirmation);

  let type = null;
  if (squeezeActive) {
    type = "POSSIBLE_SQUEEZE";
  } else if (parentActive && broadState === "BROAD_CONFIRMED") {
    type = "BROAD_CONFIRMED";
  } else if (parentActive && broadState === "NARROW") {
    type = "NARROW";
  } else if (parentActive && broadState === "MIXED_CONFIRMATION") {
    type = "MIXED_CONFIRMATION";
  } else if (parentActive) {
    type = "ORDINARY";
  }

  return {
    // Summary/presentation only. Nested evidence below is canonical and may coexist.
    type,

    squeeze: {
      active: squeezeActive,
      direction: squeezeActive ? squeezeDirection : ENGINE29_MOVE_DIRECTIONS.FLAT,
      state: squeezeActive ? "POSSIBLE_SQUEEZE" : "NONE",
      counterToParent:
        parentActive &&
        squeezeActive &&
        squeezeDirection !== parentDirection,
      impulsePct: squeeze?.headline?.averageReturnPct ?? null,
      pointMove: squeeze?.headline?.averagePointMove ?? null,
      impulseMultiple: squeeze?.headline?.averageImpulseMultiple ?? null,
      broadConfirmationMissing:
        squeeze?.broadConfirmationMissing === true,
      reasonCodes: squeeze?.reasonCodes || [],
    },

    broadConfirmation: {
      state: broadState,
      // Manager-approved semantic name: this is the parent direction being evaluated.
      targetDirection:
        broadConfirmation?.targetDirection ??
        parentDirection,
      confirmed: broadConfirmation?.broadConfirmed === true,
      headlineEtfsConfirmed:
        broadConfirmation?.headlineEtfsConfirmed === true,
      independentBlocksConfirmed:
        broadConfirmation?.independentBlocksConfirmed ?? 0,
      blocks: broadConfirmation?.blocks || null,
      reasonCodes: broadConfirmation?.reasonCodes || [],
    },

    participationQuality: broadState,
    reasonCodes: unique([
      ...(squeeze?.reasonCodes || []),
      ...(broadConfirmation?.reasonCodes || []),
    ]),
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

  let summary = "No qualified ES 30-minute parent move is active.";
  let status = "NO ACTIVE MOVE";

  if (moveCharacter === ENGINE29_MOVE_CHARACTERS.UPSIDE_MOVE_ACTIVE) {
    summary = "ES has an active canonical 30-minute upside parent move.";
    status = "ES UPSIDE MOVE ACTIVE";
  } else if (
    moveCharacter === ENGINE29_MOVE_CHARACTERS.DOWNSIDE_MOVE_ACTIVE
  ) {
    summary = "ES has an active canonical 30-minute downside parent move.";
    status = "ES DOWNSIDE MOVE ACTIVE";
  } else if (
    underlyingPressure?.state === ENGINE29_UNDERLYING_PRESSURE.NEGATIVE
  ) {
    summary = underlyingPressure.headlineHoldingBetter
      ? "No qualified ES 30-minute parent move is active, but selling pressure is visible underneath the headline market."
      : "No qualified ES 30-minute parent move is active, but cross-market internals are leaning negative.";
  } else if (
    underlyingPressure?.state === ENGINE29_UNDERLYING_PRESSURE.POSITIVE
  ) {
    summary =
      "No qualified ES 30-minute parent move is active, but cross-market internals are leaning positive.";
  }

  if (squeeze?.squeezeLike === true) {
    const squeezeDirection = squeeze?.headline?.direction;
    summary += ` A possible ${String(squeezeDirection || "counter").toLowerCase()} squeeze is present as MOVE character evidence only.`;
  }

  if (broadConfirmation?.broadConfirmed === true) {
    summary += " Broad internals confirm the canonical parent direction.";
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
  const esEntry = esAnchor?.structure || esAnchor || null;

  // MOVE v2 authority order:
  // 1) completed-30m adaptive candidate
  // 2) persistent canonical parent
  // 3) companion character/confirmation evidence
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

  const parentDirection =
    directionalMoveParent?.active === true
      ? directionalMoveParent?.direction ?? ENGINE29_MOVE_DIRECTIONS.FLAT
      : ENGINE29_MOVE_DIRECTIONS.FLAT;

  // Canonical broad confirmation evaluates ONLY the parent direction.
  const broadConfirmation = detectBroadConfirmation(
    structureBundle,
    parentDirection,
    detectorOptions
  );

  // Squeeze remains independent character evidence. It may point opposite
  // the parent, but it cannot change parent identity.
  const squeezeDirectionProbe = detectSqueezeCharacter(
    structureBundle,
    groupBundle,
    detectBroadConfirmation(
      structureBundle,
      ENGINE29_MOVE_DIRECTIONS.FLAT,
      detectorOptions
    ),
    detectorOptions
  );

  const squeezeDirection =
    squeezeDirectionProbe?.headline?.direction ??
    ENGINE29_MOVE_DIRECTIONS.FLAT;

  const squeezeBroadConfirmation = detectBroadConfirmation(
    structureBundle,
    squeezeDirection,
    detectorOptions
  );

  const squeeze = detectSqueezeCharacter(
    structureBundle,
    groupBundle,
    squeezeBroadConfirmation,
    detectorOptions
  );

  const character = buildMoveCharacterLayer({
    parent: directionalMoveParent,
    squeeze,
    broadConfirmation,
  });

  const underlyingPressure = detectUnderlyingPressure(
    structureBundle,
    detectorOptions
  );

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
    version: "engine29.tacticalCharacter.v3.moveV2",
    timestamp: new Date(now).toISOString(),
    timeframe: ENGINE29_TIMEFRAMES.FAST_TACTICAL,
    anchor: "ES",
    authority: "CANONICAL_PARENT_MOVE_V2",

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

    // Legacy compatibility projection FROM parent only.
    moveCharacter: resolved.moveCharacter,
    direction: resolved.direction,
    confidence: resolved.confidence,

    // Canonical MOVE v2 layers.
    parent: directionalMoveParent,
    character,

    esImpulse: squeeze?.headline || null,
    headlineImpulse: squeeze?.headline || null,
    directionalMove,
    directionalMoveParent,

    // Canonical confirmation is parent-targeted.
    broadConfirmation,

    // Short-impulse confirmation remains squeeze-local diagnostic evidence.
    squeezeBroadConfirmation,
    squeeze,

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
