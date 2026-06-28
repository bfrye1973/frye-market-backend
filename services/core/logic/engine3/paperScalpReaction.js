// services/core/logic/engine3/paperScalpReaction.js
//
// Engine 3 PAPER_ONLY scalp reaction advisory.
//
// Contract:
// - Reads currentLevelAction.
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

const ENGINE = "engine3.paperScalpReaction.v1";
const SOURCE = "confluence.context.reaction.currentLevelAction";

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
]);

const BLOCKED_STATES = new Set([
  "NO_SIGNAL",
  "NO_REFERENCE_LEVEL",
  "INSUFFICIENT_CANDLES",
  "CHOP_INSIDE_VALUE",
]);

const GOOD_QUALITY = new Set([
  "GOOD",
  "STRONG",
]);

function safeUpper(value, fallback = "NONE") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function setupTypeForState(state, direction) {
  const s = safeUpper(state);
  const d = safeUpper(direction, "NONE");

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
  }

  return "NONE";
}

function buildBasePaperScalpReaction({
  currentLevelAction = null,
  engine22WaveStrategy = null,
  allowed = false,
  direction = "NONE",
  setupType = "NONE",
  blockers = [],
  reasonCodes = [],
} = {}) {
  const state = safeUpper(currentLevelAction?.state, "NO_SIGNAL");
  const quality = safeUpper(currentLevelAction?.quality, "WEAK");

  return {
    active: true,
    engine: ENGINE,
    source: SOURCE,

    allowed: allowed === true,
    mode: "PAPER_ONLY",
    researchOnly: true,

    direction,
    quality,
    setupType,
    state,

    targetModel: TARGET_MODEL,

    currentPrice: toNum(currentLevelAction?.currentPrice),
    referenceLevel: toNum(currentLevelAction?.referenceLevel),
    referenceType: currentLevelAction?.referenceType || null,
    referenceLabel: currentLevelAction?.referenceLabel || null,
    distancePts: toNum(currentLevelAction?.distancePts),

    currentLevelAction: currentLevelAction || null,

    lifecycleKey:
      engine22WaveStrategy?.currentLifecycleState?.key || null,

    engine22Direction: getEngine22Direction(engine22WaveStrategy),

    requiresEngine6PaperApproval: true,
    realExecutionAuthority: false,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,

    blockers: Array.isArray(blockers) ? blockers.filter(Boolean) : [],

    reasonCodes: uniqueReasonCodes([
      "PAPER_ONLY_RESEARCH_LANE",
      "ENGINE3_PAPER_SCALP_REACTION",
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

function buildMissingCurrentLevelAction({ engine22WaveStrategy } = {}) {
  return buildBasePaperScalpReaction({
    currentLevelAction: null,
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

export function buildPaperScalpReaction({
  currentLevelAction = null,
  engine22WaveStrategy = null,
  paperShortResearchEnabled = false,
} = {}) {
  if (!currentLevelAction || typeof currentLevelAction !== "object") {
    return buildMissingCurrentLevelAction({ engine22WaveStrategy });
  }

  const state = safeUpper(currentLevelAction.state, "NO_SIGNAL");
  const quality = safeUpper(currentLevelAction.quality, "WEAK");
  const actionDirection = safeUpper(currentLevelAction.direction, "NEUTRAL");
  const engine22Direction = getEngine22Direction(engine22WaveStrategy);

  const blockers = [];
  const reasonCodes = [
    `CURRENT_LEVEL_ACTION_STATE_${state}`,
    `CURRENT_LEVEL_ACTION_QUALITY_${quality}`,
    `CURRENT_LEVEL_ACTION_DIRECTION_${actionDirection}`,
    engine22Direction ? `ENGINE22_DIRECTION_${engine22Direction}` : null,
  ];

  const qualityAllowed = GOOD_QUALITY.has(quality);

  if (!qualityAllowed) {
    blockers.push("ENGINE3_PAPER_REACTION_NOT_GOOD_OR_STRONG");
    reasonCodes.push("QUALITY_NOT_GOOD_OR_STRONG");
  }

  if (BLOCKED_STATES.has(state)) {
    blockers.push("CURRENT_LEVEL_ACTION_STATE_BLOCKED_FOR_PAPER");
    reasonCodes.push("CURRENT_LEVEL_ACTION_STATE_BLOCKED_FOR_PAPER");
  }

  if (
    currentLevelAction.noExecution !== true ||
    currentLevelAction.noPermissionCreated !== true
  ) {
    blockers.push("CURRENT_LEVEL_ACTION_SAFETY_FLAGS_MISSING");
    reasonCodes.push("CURRENT_LEVEL_ACTION_SAFETY_FLAGS_MISSING");
  }

  const isLongAllowedState = PAPER_LONG_ALLOWED_STATES.has(state);
  const isLongConditionalState = PAPER_LONG_CONDITIONAL_STATES.has(state);
  const isShortResearchState = PAPER_SHORT_RESEARCH_STATES.has(state);

  let direction = "NONE";
  let setupType = "NONE";
  let allowed = false;

  if (isLongAllowedState) {
    direction = "LONG";
    setupType = setupTypeForState(state, direction);

    if (actionDirection !== "LONG") {
      blockers.push("CURRENT_LEVEL_ACTION_DIRECTION_NOT_LONG");
      reasonCodes.push("CURRENT_LEVEL_ACTION_DIRECTION_NOT_LONG");
    }

    if (engine22Direction && engine22Direction !== "NONE" && engine22Direction !== "LONG") {
      blockers.push("ENGINE22_DIRECTION_CONFLICTS_WITH_LONG_PAPER_SCALP");
      reasonCodes.push("ENGINE22_DIRECTION_CONFLICT");
    }

    allowed = blockers.length === 0;
  } else if (isLongConditionalState) {
    direction = "LONG";
    setupType = setupTypeForState(state, direction);

    // Conditional states need stronger evidence in v1.
    if (quality !== "STRONG") {
      blockers.push("CONDITIONAL_LONG_REQUIRES_STRONG_QUALITY");
      reasonCodes.push("CONDITIONAL_LONG_REQUIRES_STRONG_QUALITY");
    }

    if (currentLevelAction.confirmed !== true) {
      blockers.push("CONDITIONAL_LONG_REQUIRES_CONFIRMED_CURRENT_ACTION");
      reasonCodes.push("CONDITIONAL_LONG_REQUIRES_CONFIRMED_CURRENT_ACTION");
    }

    if (actionDirection !== "LONG") {
      blockers.push("CURRENT_LEVEL_ACTION_DIRECTION_NOT_LONG");
      reasonCodes.push("CURRENT_LEVEL_ACTION_DIRECTION_NOT_LONG");
    }

    if (engine22Direction && engine22Direction !== "NONE" && engine22Direction !== "LONG") {
      blockers.push("ENGINE22_DIRECTION_CONFLICTS_WITH_LONG_PAPER_SCALP");
      reasonCodes.push("ENGINE22_DIRECTION_CONFLICT");
    }

    allowed = blockers.length === 0;
  } else if (isShortResearchState) {
    direction = "SHORT";
    setupType = setupTypeForState(state, direction);

    if (paperShortResearchEnabled !== true) {
      blockers.push("PAPER_SHORT_RESEARCH_DISABLED_V1");
      reasonCodes.push("PAPER_SHORT_RESEARCH_DISABLED_V1");
    }

    if (actionDirection !== "SHORT") {
      blockers.push("CURRENT_LEVEL_ACTION_DIRECTION_NOT_SHORT");
      reasonCodes.push("CURRENT_LEVEL_ACTION_DIRECTION_NOT_SHORT");
    }

    allowed = blockers.length === 0;
  } else {
    blockers.push("CURRENT_LEVEL_ACTION_STATE_NOT_PAPER_ACTIONABLE");
    reasonCodes.push("CURRENT_LEVEL_ACTION_STATE_NOT_PAPER_ACTIONABLE");
  }

  if (!allowed) {
    reasonCodes.push("PAPER_SCALP_NOT_ALLOWED");
  } else {
    reasonCodes.push("PAPER_SCALP_REACTION_ALLOWED");
  }

  return buildBasePaperScalpReaction({
    currentLevelAction,
    engine22WaveStrategy,
    allowed,
    direction,
    setupType,
    blockers,
    reasonCodes,
  });
}

export function attachPaperScalpReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  paperShortResearchEnabled = false,
}) {
  const currentLevelAction =
    patchedConfluence?.context?.reaction?.currentLevelAction || null;

  const paperScalpReaction = buildPaperScalpReaction({
    currentLevelAction,
    engine22WaveStrategy,
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
