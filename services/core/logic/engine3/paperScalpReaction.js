// services/core/logic/engine3/paperScalpReaction.js
//
// Engine 3 PAPER_ONLY scalp reaction advisory.
//
// Contract:
// - Reads engine3FastImbalanceReaction first when active.
// - Falls back to currentLevelAction.
// - Consumes Engine 26 locationContext when available.
// - Creates paper-only advisory only.
// - Does not create real permission.
// - Does not create real execution.
// - Does not set executable.
// - Does not set freshEntryNow.
// - Does not set readiness.
// - Engine 6 paper lane remains final referee.
//
// Output path:
// confluence.context.reaction.paperScalpReaction

import { buildEngine22DegreeWaveContext } from "./engine22DegreeWaveContext.js";
import { buildEngine26LocationReactionContext } from "./engine26LocationReactionContext.js";

const ENGINE = "engine3.paperScalpReaction.v1";

const SOURCE_CURRENT_LEVEL =
  "confluence.context.reaction.currentLevelAction";

const SOURCE_FAST_IMBALANCE =
  "confluence.context.reaction.engine3FastImbalanceReaction";

const TARGET_MODEL = {
  instrument: "ES",
  targetPoints: 10,
  exitModel: "THREE_BLOCKS",
};

const PAPER_LONG_ALLOWED_STATES = new Set([
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "SELLERS_TRAPPED",
  "RECLAIMED_LEVEL",
]);

const PAPER_LONG_CONDITIONAL_STATES = new Set([
  "HELD_LEVEL",
  "ACCEPTING_VALUE",
  "BREAKOUT_HOLDING",
]);

const PAPER_SHORT_RESEARCH_STATES = new Set([
  "FAILED_RECLAIM",
  "REJECTING_VALUE",
  "BREAKOUT_FAILING",
  "LOST_LEVEL",
  "FAILED_ACCEPTANCE_SHORT",
  "LOST_SHORT_TRIGGER_LEVEL",
]);

const BLOCKED_STATES = new Set([
  "NO_SIGNAL",
  "NO_REFERENCE_LEVEL",
  "NO_FAST_IMBALANCE",
  "NO_FAST_IMBALANCE_WATCH",
  "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST",
  "SHORT_WATCH_RECLAIM_INVALIDATION_RISK",
  "INSUFFICIENT_CANDLES",
  "CHOP_INSIDE_VALUE",
]);

const GOOD_QUALITY = new Set(["GOOD", "STRONG"]);

function safeUpper(value, fallback = "NONE") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function uniqueReasonCodes(reasonCodes = []) {
  return [...new Set(reasonCodes.filter(Boolean))];
}

function getEngine22Direction(engine22WaveStrategy) {
  return safeUpper(
    engine22WaveStrategy?.currentLifecycleState?.confirmationContext?.direction ||
      engine22WaveStrategy?.currentLifecycleState?.direction ||
      engine22WaveStrategy?.waveOpportunity?.direction ||
      engine22WaveStrategy?.direction ||
      "NONE",
    "NONE"
  );
}

function isFastReactionActive(fastImbalanceReaction) {
  return (
    fastImbalanceReaction &&
    typeof fastImbalanceReaction === "object" &&
    fastImbalanceReaction.active === true &&
    fastImbalanceReaction.fastMode === true
  );
}

function resolvePaperCurrentPrice({
  fastMode = false,
  reactionInput = null,
  fastImbalanceReaction = null,
  currentLevelAction = null,
} = {}) {
  if (fastMode === true) {
    return (
      validPrice(fastImbalanceReaction?.currentPrice) ??
      validPrice(fastImbalanceReaction?.lastCandle?.close) ??
      validPrice(reactionInput?.currentPrice) ??
      validPrice(reactionInput?.lastCandle?.close) ??
      validPrice(currentLevelAction?.currentPrice) ??
      validPrice(currentLevelAction?.lastCandle?.close) ??
      null
    );
  }

  return (
    validPrice(currentLevelAction?.currentPrice) ??
    validPrice(currentLevelAction?.lastCandle?.close) ??
    validPrice(reactionInput?.currentPrice) ??
    validPrice(reactionInput?.lastCandle?.close) ??
    null
  );
}

function setupTypeForState(state, direction, fastMode = false) {
  const s = safeUpper(state);
  const d = safeUpper(direction, "NONE");

  if (s === "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST") {
    return "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST";
  }

  if (s === "SHORT_WATCH_RECLAIM_INVALIDATION_RISK") {
    return "SHORT_WATCH_RECLAIM_INVALIDATION_RISK";
  }

  if (fastMode === true && d === "LONG") {
    if (s === "WICK_BELOW_AND_RECLAIM") return "FAST_SWEEP_RECLAIM_LONG";
    if (s === "DIP_BOUGHT_FAST") return "FAST_SWEEP_RECLAIM_LONG";
    if (s === "SELLERS_TRAPPED") return "FAST_SWEEP_RECLAIM_LONG";
    if (s === "RECLAIMED_LEVEL") return "FAST_RECLAIMED_IMBALANCE_LONG";
    if (s === "HELD_LEVEL") return "FAST_HELD_IMBALANCE_LONG";
    if (s === "ACCEPTING_VALUE") return "FAST_ACCEPTING_IMBALANCE_LONG";
    if (s === "BREAKOUT_HOLDING") return "FAST_BREAKOUT_HOLDING_LONG";
  }

  if (fastMode === true && d === "SHORT") {
    if (s === "FAILED_RECLAIM") return "FAST_FAILED_RECLAIM_SHORT_RESEARCH";
    if (s === "REJECTING_VALUE") return "FAST_REJECTING_IMBALANCE_SHORT_RESEARCH";
    if (s === "BREAKOUT_FAILING") return "FAST_BREAKOUT_FAILING_SHORT_RESEARCH";
    if (s === "LOST_LEVEL") return "FAST_LOST_IMBALANCE_SHORT_RESEARCH";
    if (s === "FAILED_ACCEPTANCE_SHORT") return "FAST_FAILED_ACCEPTANCE_SHORT_RESEARCH";
    if (s === "LOST_SHORT_TRIGGER_LEVEL") return "FAST_LOST_SHORT_TRIGGER_LEVEL_RESEARCH";
  }

  if (d === "LONG") {
    if (s === "WICK_BELOW_AND_RECLAIM") return "SWEEP_RECLAIM_LONG";
    if (s === "DIP_BOUGHT_FAST") return "DIP_BOUGHT_FAST_LONG";
    if (s === "SELLERS_TRAPPED") return "SELLERS_TRAPPED_LONG";
    if (s === "RECLAIMED_LEVEL") return "RECLAIMED_LEVEL_LONG";
    if (s === "HELD_LEVEL") return "HELD_LEVEL_LONG_CONDITIONAL";
    if (s === "ACCEPTING_VALUE") return "ACCEPTING_VALUE_LONG_CONDITIONAL";
    if (s === "BREAKOUT_HOLDING") return "BREAKOUT_HOLDING_LONG_CONDITIONAL";
  }

  if (d === "SHORT") {
    if (s === "FAILED_RECLAIM") return "FAILED_RECLAIM_SHORT_RESEARCH";
    if (s === "REJECTING_VALUE") return "REJECTING_VALUE_SHORT_RESEARCH";
    if (s === "BREAKOUT_FAILING") return "BREAKOUT_FAILING_SHORT_RESEARCH";
    if (s === "LOST_LEVEL") return "LOST_LEVEL_SHORT_RESEARCH";
    if (s === "FAILED_ACCEPTANCE_SHORT") return "FAILED_ACCEPTANCE_SHORT_RESEARCH";
    if (s === "LOST_SHORT_TRIGGER_LEVEL") return "LOST_SHORT_TRIGGER_LEVEL_RESEARCH";
  }

  return "NONE";
}

function buildBasePaperScalpReaction({
  source = SOURCE_CURRENT_LEVEL,
  reactionInput = null,
  currentLevelAction = null,
  fastImbalanceReaction = null,
  engine22WaveStrategy = null,
  engine26LocationContext = null,
  allowed = false,
  direction = "NONE",
  setupType = "NONE",
  blockers = [],
  reasonCodes = [],
  fastMode = false,
} = {}) {
  const state = safeUpper(reactionInput?.state, "NO_SIGNAL");
  const quality = safeUpper(reactionInput?.quality, "WEAK");

  const imbalance =
    fastMode === true
      ? fastImbalanceReaction?.imbalance || reactionInput?.imbalance || null
      : null;

  return {
    active: true,
    engine: ENGINE,
    source,

    allowed: allowed === true,
    mode: "PAPER_ONLY",
    researchOnly: true,

    fastMode: fastMode === true,
    earlySignal:
      fastMode === true
        ? fastImbalanceReaction?.earlySignal === true ||
          reactionInput?.earlySignal === true
        : false,

    direction,
    quality,
    setupType,
    state,

    targetModel: TARGET_MODEL,

    currentPrice: resolvePaperCurrentPrice({
      fastMode,
      reactionInput,
      fastImbalanceReaction,
      currentLevelAction,
    }),
    referenceLevel: toNum(reactionInput?.referenceLevel),
    referenceType: reactionInput?.referenceType || null,
    referenceLabel: reactionInput?.referenceLabel || null,
    distancePts:
      fastMode === true
        ? toNum(imbalance?.distancePts)
        : toNum(reactionInput?.distancePts),

    imbalance,

    currentLevelAction: currentLevelAction || null,
    fastImbalanceReaction: fastImbalanceReaction || null,
    engine26LocationContext: engine26LocationContext || null,

    lifecycleKey:
      engine22WaveStrategy?.currentLifecycleState?.key || null,

    engine22Direction: getEngine22Direction(engine22WaveStrategy),

    waveContext: buildEngine22DegreeWaveContext({
      engine22WaveStrategy,
      reactionState: state,
      reactionDirection: direction,
    }),

    requiresEngine6PaperApproval: true,
    realExecutionAuthority: false,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,

    blockers: Array.isArray(blockers) ? blockers.filter(Boolean) : [],

    reasonCodes: uniqueReasonCodes([
      "PAPER_ONLY_RESEARCH_LANE",
      "ENGINE3_PAPER_SCALP_REACTION",
      fastMode === true ? "ENGINE3_FAST_IMBALANCE_REACTION_CONSUMED" : null,
      engine26LocationContext?.active === true
        ? "ENGINE26_LOCATION_CONTEXT_CONSUMED"
        : null,
      allowed === true
        ? "ENGINE3_PAPER_SCALP_REACTION_ALLOWED"
        : "ENGINE3_PAPER_SCALP_REACTION_NOT_ALLOWED",
      ...reasonCodes,
      "NO_REAL_PERMISSION_CREATED",
      "NO_EXECUTION",
      "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
    ]),
  };
}

function buildMissingReaction({ engine22WaveStrategy } = {}) {
  return buildBasePaperScalpReaction({
    source: SOURCE_CURRENT_LEVEL,
    reactionInput: null,
    currentLevelAction: null,
    fastImbalanceReaction: null,
    engine22WaveStrategy,
    allowed: false,
    direction: "NONE",
    setupType: "NONE",
    blockers: ["CURRENT_LEVEL_ACTION_MISSING"],
    reasonCodes: [
      "CURRENT_LEVEL_ACTION_MISSING",
      "PAPER_SCALP_NOT_ALLOWED",
    ],
  });
}

function evaluateReactionForPaper({
  reactionInput,
  currentLevelAction = null,
  fastImbalanceReaction = null,
  engine22WaveStrategy = null,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
  fastMode = false,
}) {
  const source =
    fastMode === true ? SOURCE_FAST_IMBALANCE : SOURCE_CURRENT_LEVEL;

  const rawState = safeUpper(reactionInput?.state, "NO_SIGNAL");
  const rawQuality = safeUpper(reactionInput?.quality, "WEAK");
  const rawActionDirection = safeUpper(reactionInput?.direction, "NEUTRAL");

  const engine26LocationContext = buildEngine26LocationReactionContext({
    engine26StructuralContext,
    reactionInput: {
      ...reactionInput,
      state: rawState,
      quality: rawQuality,
      direction: rawActionDirection,
    },
  });

  const state = engine26LocationContext?.state || rawState;
  const quality = engine26LocationContext?.quality || rawQuality;
  const actionDirection =
    engine26LocationContext?.direction || rawActionDirection;

  const engine22Direction = getEngine22Direction(engine22WaveStrategy);

  const blockers = [];
  const reasonCodes = [
    fastMode === true ? "FAST_IMBALANCE_WATCH" : null,
    fastMode === true
      ? `FAST_IMBALANCE_STATE_${state}`
      : `CURRENT_LEVEL_ACTION_STATE_${state}`,
    fastMode === true
      ? `FAST_IMBALANCE_QUALITY_${quality}`
      : `CURRENT_LEVEL_ACTION_QUALITY_${quality}`,
    fastMode === true
      ? `FAST_IMBALANCE_DIRECTION_${actionDirection}`
      : `CURRENT_LEVEL_ACTION_DIRECTION_${actionDirection}`,
    engine22Direction ? `ENGINE22_DIRECTION_${engine22Direction}` : null,
    ...(engine26LocationContext?.reasonCodes || []),
  ];

  const qualityAllowed = GOOD_QUALITY.has(quality);

  if (!qualityAllowed) {
    blockers.push("ENGINE3_PAPER_REACTION_NOT_GOOD_OR_STRONG");
    reasonCodes.push("QUALITY_NOT_GOOD_OR_STRONG");
  }

  if (BLOCKED_STATES.has(state)) {
    blockers.push(
      fastMode === true
        ? "FAST_IMBALANCE_STATE_BLOCKED_FOR_PAPER"
        : "CURRENT_LEVEL_ACTION_STATE_BLOCKED_FOR_PAPER"
    );
    reasonCodes.push(
      fastMode === true
        ? "FAST_IMBALANCE_STATE_BLOCKED_FOR_PAPER"
        : "CURRENT_LEVEL_ACTION_STATE_BLOCKED_FOR_PAPER"
    );
  }

  if (
    reactionInput?.noExecution !== true ||
    reactionInput?.noPermissionCreated !== true
  ) {
    blockers.push(
      fastMode === true
        ? "FAST_IMBALANCE_SAFETY_FLAGS_MISSING"
        : "CURRENT_LEVEL_ACTION_SAFETY_FLAGS_MISSING"
    );
    reasonCodes.push(
      fastMode === true
        ? "FAST_IMBALANCE_SAFETY_FLAGS_MISSING"
        : "CURRENT_LEVEL_ACTION_SAFETY_FLAGS_MISSING"
    );
  }

  const isLongAllowedState = PAPER_LONG_ALLOWED_STATES.has(state);
  const isLongConditionalState = PAPER_LONG_CONDITIONAL_STATES.has(state);
  const isShortResearchState = PAPER_SHORT_RESEARCH_STATES.has(state);

  let direction = "NONE";
  let setupType = "NONE";
  let allowed = false;

  if (isLongAllowedState) {
    direction = "LONG";
    setupType = setupTypeForState(state, direction, fastMode);

    if (actionDirection !== "LONG") {
      blockers.push(
        fastMode === true
          ? "FAST_IMBALANCE_DIRECTION_NOT_LONG"
          : "CURRENT_LEVEL_ACTION_DIRECTION_NOT_LONG"
      );
      reasonCodes.push(
        fastMode === true
          ? "FAST_IMBALANCE_DIRECTION_NOT_LONG"
          : "CURRENT_LEVEL_ACTION_DIRECTION_NOT_LONG"
      );
    }

    if (
      engine22Direction &&
      engine22Direction !== "NONE" &&
      engine22Direction !== "LONG"
    ) {
      blockers.push("ENGINE22_DIRECTION_CONFLICTS_WITH_LONG_PAPER_SCALP");
      reasonCodes.push("ENGINE22_DIRECTION_CONFLICT");
    }

    allowed = blockers.length === 0;
  } else if (isLongConditionalState) {
    direction = "LONG";
    setupType = setupTypeForState(state, direction, fastMode);

    if (quality !== "STRONG") {
      blockers.push("CONDITIONAL_LONG_REQUIRES_STRONG_QUALITY");
      reasonCodes.push("CONDITIONAL_LONG_REQUIRES_STRONG_QUALITY");
    }

    if (reactionInput?.confirmed !== true) {
      blockers.push("CONDITIONAL_LONG_REQUIRES_CONFIRMED_CURRENT_ACTION");
      reasonCodes.push("CONDITIONAL_LONG_REQUIRES_CONFIRMED_CURRENT_ACTION");
    }

    if (actionDirection !== "LONG") {
      blockers.push(
        fastMode === true
          ? "FAST_IMBALANCE_DIRECTION_NOT_LONG"
          : "CURRENT_LEVEL_ACTION_DIRECTION_NOT_LONG"
      );
      reasonCodes.push(
        fastMode === true
          ? "FAST_IMBALANCE_DIRECTION_NOT_LONG"
          : "CURRENT_LEVEL_ACTION_DIRECTION_NOT_LONG"
      );
    }

    if (
      engine22Direction &&
      engine22Direction !== "NONE" &&
      engine22Direction !== "LONG"
    ) {
      blockers.push("ENGINE22_DIRECTION_CONFLICTS_WITH_LONG_PAPER_SCALP");
      reasonCodes.push("ENGINE22_DIRECTION_CONFLICT");
    }

    allowed = blockers.length === 0;
  } else if (isShortResearchState) {
    direction = "SHORT";
    setupType = setupTypeForState(state, direction, fastMode);

    reasonCodes.push(setupType);

    if (paperShortResearchEnabled !== true) {
      blockers.push("PAPER_SHORT_RESEARCH_DISABLED_V1");
      reasonCodes.push("PAPER_SHORT_RESEARCH_DISABLED_V1");
    }

    if (actionDirection !== "SHORT") {
      blockers.push(
        fastMode === true
          ? "FAST_IMBALANCE_DIRECTION_NOT_SHORT"
          : "CURRENT_LEVEL_ACTION_DIRECTION_NOT_SHORT"
      );
      reasonCodes.push(
        fastMode === true
          ? "FAST_IMBALANCE_DIRECTION_NOT_SHORT"
          : "CURRENT_LEVEL_ACTION_DIRECTION_NOT_SHORT"
      );
    }

    allowed = blockers.length === 0;
  } else {
    setupType = setupTypeForState(state, actionDirection, fastMode);
    direction = actionDirection;

    blockers.push(
      fastMode === true
        ? "FAST_IMBALANCE_STATE_NOT_PAPER_ACTIONABLE"
        : "CURRENT_LEVEL_ACTION_STATE_NOT_PAPER_ACTIONABLE"
    );
    reasonCodes.push(
      fastMode === true
        ? "FAST_IMBALANCE_STATE_NOT_PAPER_ACTIONABLE"
        : "CURRENT_LEVEL_ACTION_STATE_NOT_PAPER_ACTIONABLE"
    );
  }

  if (engine26LocationContext?.forceAllowedFalse === true) {
    allowed = false;

    if (engine26LocationContext.blocker) {
      blockers.push(engine26LocationContext.blocker);
    }

    reasonCodes.push("ENGINE26_LOCATION_FORCED_PAPER_NOT_ALLOWED");
  }

  if (!allowed) {
    reasonCodes.push("PAPER_SCALP_NOT_ALLOWED");
  } else {
    reasonCodes.push("PAPER_SCALP_REACTION_ALLOWED");
  }

  return buildBasePaperScalpReaction({
    source,
    reactionInput: {
      ...reactionInput,
      state,
      quality,
      direction: actionDirection,
    },
    currentLevelAction,
    fastImbalanceReaction,
    engine22WaveStrategy,
    engine26LocationContext,
    allowed,
    direction,
    setupType,
    blockers,
    reasonCodes,
    fastMode,
  });
}

export function buildPaperScalpReaction({
  currentLevelAction = null,
  fastImbalanceReaction = null,
  engine22WaveStrategy = null,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
} = {}) {
  const useFastReaction = isFastReactionActive(fastImbalanceReaction);

  const reactionInput = useFastReaction
    ? fastImbalanceReaction
    : currentLevelAction;

  if (!reactionInput || typeof reactionInput !== "object") {
    return buildMissingReaction({ engine22WaveStrategy });
  }

  return evaluateReactionForPaper({
    reactionInput,
    currentLevelAction,
    fastImbalanceReaction: useFastReaction ? fastImbalanceReaction : null,
    engine22WaveStrategy,
    engine26StructuralContext,
    paperShortResearchEnabled,
    fastMode: useFastReaction,
  });
}

export function attachPaperScalpReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
}) {
  const currentLevelAction =
    patchedConfluence?.context?.reaction?.currentLevelAction || null;

  const fastImbalanceReaction =
    patchedConfluence?.context?.reaction?.engine3FastImbalanceReaction || null;

  const paperScalpReaction = buildPaperScalpReaction({
    currentLevelAction,
    fastImbalanceReaction,
    engine22WaveStrategy,
    engine26StructuralContext,
    paperShortResearchEnabled,
  });

  patchedConfluence.context = patchedConfluence.context || {};
  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    paperScalpReaction,
  };

  return patchedConfluence;
}

export default buildPaperScalpReaction;
