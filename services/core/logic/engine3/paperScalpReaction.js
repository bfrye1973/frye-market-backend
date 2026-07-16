// services/core/logic/engine3/paperScalpReaction.js
//
// Engine 3 PAPER_ONLY scalp reaction advisory.
//
// Contract:
// - Reads engine3FastImbalanceReaction first when active.
// - Falls back to currentLevelAction.
// - Consumes engine26ReactionHandoff as the authorized location contract.
// - Preserves legacy engine26StructuralContext compatibility.
// - Preserves candidateId and zoneId.
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

const ENGINE = "engine3.paperScalpReaction.v2";

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

  // New authorized-location states.
  "WAITING_FOR_ENGINE26_LOCATION",
  "WATCHING_AUTHORIZED_LOCATION",
  "REACTION_FAILED",
  "REACTION_INVALIDATED",
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
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validPrice(value) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? number
    : null;
}

function uniqueReasonCodes(reasonCodes = []) {
  return [
    ...new Set(
      reasonCodes.filter(Boolean)
    ),
  ];
}

function getEngine22Direction(engine22WaveStrategy) {
  return safeUpper(
    engine22WaveStrategy
      ?.currentLifecycleState
      ?.confirmationContext
      ?.direction ||

      engine22WaveStrategy
        ?.currentLifecycleState
        ?.direction ||

      engine22WaveStrategy
        ?.waveOpportunity
        ?.direction ||

      engine22WaveStrategy
        ?.direction ||

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
  engine26LocationContext = null,
} = {}) {
  if (fastMode === true) {
    return (
      validPrice(fastImbalanceReaction?.currentPrice) ??
      validPrice(fastImbalanceReaction?.lastCandle?.close) ??
      validPrice(reactionInput?.currentPrice) ??
      validPrice(reactionInput?.lastCandle?.close) ??
      validPrice(currentLevelAction?.currentPrice) ??
      validPrice(currentLevelAction?.lastCandle?.close) ??
      validPrice(engine26LocationContext?.currentPrice) ??
      null
    );
  }

  return (
    validPrice(currentLevelAction?.currentPrice) ??
    validPrice(currentLevelAction?.lastCandle?.close) ??
    validPrice(reactionInput?.currentPrice) ??
    validPrice(reactionInput?.lastCandle?.close) ??
    validPrice(engine26LocationContext?.currentPrice) ??
    null
  );
}

function setupTypeForState(
  state,
  direction,
  fastMode = false
) {
  const normalizedState = safeUpper(state);
  const normalizedDirection = safeUpper(
    direction,
    "NONE"
  );

  if (
    normalizedState ===
    "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST"
  ) {
    return "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST";
  }

  if (
    normalizedState ===
    "SHORT_WATCH_RECLAIM_INVALIDATION_RISK"
  ) {
    return "SHORT_WATCH_RECLAIM_INVALIDATION_RISK";
  }

  if (
    normalizedState ===
    "WAITING_FOR_ENGINE26_LOCATION"
  ) {
    return "WAITING_FOR_ENGINE26_LOCATION";
  }

  if (
    normalizedState ===
    "WATCHING_AUTHORIZED_LOCATION"
  ) {
    return "WATCHING_AUTHORIZED_LOCATION";
  }

  if (
    normalizedState ===
    "REACTION_INVALIDATED"
  ) {
    return "AUTHORIZED_REACTION_INVALIDATED";
  }

  if (
    normalizedState ===
    "REACTION_FAILED"
  ) {
    return "AUTHORIZED_REACTION_FAILED";
  }

  if (
    fastMode === true &&
    normalizedDirection === "LONG"
  ) {
    if (
      normalizedState ===
      "WICK_BELOW_AND_RECLAIM"
    ) {
      return "FAST_SWEEP_RECLAIM_LONG";
    }

    if (
      normalizedState ===
      "DIP_BOUGHT_FAST"
    ) {
      return "FAST_SWEEP_RECLAIM_LONG";
    }

    if (
      normalizedState ===
      "SELLERS_TRAPPED"
    ) {
      return "FAST_SWEEP_RECLAIM_LONG";
    }

    if (
      normalizedState ===
      "RECLAIMED_LEVEL"
    ) {
      return "FAST_RECLAIMED_IMBALANCE_LONG";
    }

    if (
      normalizedState ===
      "HELD_LEVEL"
    ) {
      return "FAST_HELD_IMBALANCE_LONG";
    }

    if (
      normalizedState ===
      "ACCEPTING_VALUE"
    ) {
      return "FAST_ACCEPTING_IMBALANCE_LONG";
    }

    if (
      normalizedState ===
      "BREAKOUT_HOLDING"
    ) {
      return "FAST_BREAKOUT_HOLDING_LONG";
    }
  }

  if (
    fastMode === true &&
    normalizedDirection === "SHORT"
  ) {
    if (
      normalizedState ===
      "FAILED_RECLAIM"
    ) {
      return "FAST_FAILED_RECLAIM_SHORT_RESEARCH";
    }

    if (
      normalizedState ===
      "REJECTING_VALUE"
    ) {
      return "FAST_REJECTING_IMBALANCE_SHORT_RESEARCH";
    }

    if (
      normalizedState ===
      "BREAKOUT_FAILING"
    ) {
      return "FAST_BREAKOUT_FAILING_SHORT_RESEARCH";
    }

    if (
      normalizedState ===
      "LOST_LEVEL"
    ) {
      return "FAST_LOST_IMBALANCE_SHORT_RESEARCH";
    }

    if (
      normalizedState ===
      "FAILED_ACCEPTANCE_SHORT"
    ) {
      return "FAST_FAILED_ACCEPTANCE_SHORT_RESEARCH";
    }

    if (
      normalizedState ===
      "LOST_SHORT_TRIGGER_LEVEL"
    ) {
      return "FAST_LOST_SHORT_TRIGGER_LEVEL_RESEARCH";
    }
  }

  if (normalizedDirection === "LONG") {
    if (
      normalizedState ===
      "WICK_BELOW_AND_RECLAIM"
    ) {
      return "SWEEP_RECLAIM_LONG";
    }

    if (
      normalizedState ===
      "DIP_BOUGHT_FAST"
    ) {
      return "DIP_BOUGHT_FAST_LONG";
    }

    if (
      normalizedState ===
      "SELLERS_TRAPPED"
    ) {
      return "SELLERS_TRAPPED_LONG";
    }

    if (
      normalizedState ===
      "RECLAIMED_LEVEL"
    ) {
      return "RECLAIMED_LEVEL_LONG";
    }

    if (
      normalizedState ===
      "HELD_LEVEL"
    ) {
      return "HELD_LEVEL_LONG_CONDITIONAL";
    }

    if (
      normalizedState ===
      "ACCEPTING_VALUE"
    ) {
      return "ACCEPTING_VALUE_LONG_CONDITIONAL";
    }

    if (
      normalizedState ===
      "BREAKOUT_HOLDING"
    ) {
      return "BREAKOUT_HOLDING_LONG_CONDITIONAL";
    }
  }

  if (normalizedDirection === "SHORT") {
    if (
      normalizedState ===
      "FAILED_RECLAIM"
    ) {
      return "FAILED_RECLAIM_SHORT_RESEARCH";
    }

    if (
      normalizedState ===
      "REJECTING_VALUE"
    ) {
      return "REJECTING_VALUE_SHORT_RESEARCH";
    }

    if (
      normalizedState ===
      "BREAKOUT_FAILING"
    ) {
      return "BREAKOUT_FAILING_SHORT_RESEARCH";
    }

    if (
      normalizedState ===
      "LOST_LEVEL"
    ) {
      return "LOST_LEVEL_SHORT_RESEARCH";
    }

    if (
      normalizedState ===
      "FAILED_ACCEPTANCE_SHORT"
    ) {
      return "FAILED_ACCEPTANCE_SHORT_RESEARCH";
    }

    if (
      normalizedState ===
      "LOST_SHORT_TRIGGER_LEVEL"
    ) {
      return "LOST_SHORT_TRIGGER_LEVEL_RESEARCH";
    }
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
  const state = safeUpper(
    reactionInput?.state,
    "NO_SIGNAL"
  );

  const quality = safeUpper(
    reactionInput?.quality,
    "WEAK"
  );

  const imbalance =
    fastMode === true
      ? (
          fastImbalanceReaction?.imbalance ||
          reactionInput?.imbalance ||
          null
        )
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
        ? (
            fastImbalanceReaction?.earlySignal === true ||
            reactionInput?.earlySignal === true
          )
        : false,

    direction,
    quality,
    setupType,
    state,

    // New authorized-location identity.
    authorized:
      engine26LocationContext?.authorized === true,

    authorizedReactionState:
      engine26LocationContext?.state || null,

    authorizedReactionRawState:
      engine26LocationContext?.rawState || state,

    candidateId:
      engine26LocationContext?.candidateId ?? null,

    zoneId:
      engine26LocationContext?.zoneId ?? null,

    strategyId:
      engine26LocationContext?.strategyId ?? null,

    symbol:
      engine26LocationContext?.symbol ?? null,

    timeframe:
      engine26LocationContext?.timeframe ?? null,

    snapshotTime:
      engine26LocationContext?.snapshotTime ?? null,

    tradeDirectionBias:
      engine26LocationContext
        ?.tradeDirectionBias ?? null,

    expectedReactionDirection:
      engine26LocationContext
        ?.expectedReactionDirection ?? null,

    expectedReactions:
      Array.isArray(
        engine26LocationContext?.expectedReactions
      )
        ? engine26LocationContext.expectedReactions
        : [],

    reactionExpected:
      engine26LocationContext
        ?.reactionExpected ?? null,

    authorizeEngine3Evaluation:
      engine26LocationContext
        ?.authorizeEngine3Evaluation === true,

    targetModel: TARGET_MODEL,

    currentPrice: resolvePaperCurrentPrice({
      fastMode,
      reactionInput,
      fastImbalanceReaction,
      currentLevelAction,
      engine26LocationContext,
    }),

    referenceLevel:
      toNum(reactionInput?.referenceLevel),

    referenceType:
      reactionInput?.referenceType || null,

    referenceLabel:
      reactionInput?.referenceLabel || null,

    distancePts:
      fastMode === true
        ? toNum(imbalance?.distancePts)
        : toNum(reactionInput?.distancePts),

    imbalance,

    currentLevelAction:
      currentLevelAction || null,

    fastImbalanceReaction:
      fastImbalanceReaction || null,

    engine26LocationContext:
      engine26LocationContext || null,

    lifecycleKey:
      engine22WaveStrategy
        ?.currentLifecycleState
        ?.key || null,

    engine22Direction:
      getEngine22Direction(
        engine22WaveStrategy
      ),

    waveContext:
      buildEngine22DegreeWaveContext({
        engine22WaveStrategy,
        reactionState: state,
        reactionDirection: direction,
      }),

    requiresEngine6PaperApproval: true,

    realExecutionAuthority: false,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,

    blockers:
      Array.isArray(blockers)
        ? blockers.filter(Boolean)
        : [],

    reasonCodes:
      uniqueReasonCodes([
        "PAPER_ONLY_RESEARCH_LANE",
        "ENGINE3_PAPER_SCALP_REACTION",

        fastMode === true
          ? "ENGINE3_FAST_IMBALANCE_REACTION_CONSUMED"
          : null,

        engine26LocationContext?.active === true
          ? "ENGINE26_LOCATION_CONTEXT_CONSUMED"
          : null,

        engine26LocationContext?.authorized === true
          ? "ENGINE26_AUTHORIZED_LOCATION_CONSUMED"
          : null,

        engine26LocationContext?.candidateId
          ? "CANDIDATE_ID_PRESERVED"
          : null,

        engine26LocationContext?.zoneId
          ? "ZONE_ID_PRESERVED"
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

function buildMissingReaction({
  engine22WaveStrategy,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
} = {}) {
  const engine26LocationContext =
    buildEngine26LocationReactionContext({
      engine26ReactionHandoff,
      engine26StructuralContext,
      reactionInput: null,
    });

  const waitingForEngine26 =
    engine26LocationContext?.state ===
    "WAITING_FOR_ENGINE26_LOCATION";

  return buildBasePaperScalpReaction({
    source: SOURCE_CURRENT_LEVEL,

    reactionInput: {
      state:
        engine26LocationContext?.state ||
        "NO_SIGNAL",

      quality:
        engine26LocationContext?.quality ||
        "WEAK",

      direction:
        engine26LocationContext?.direction ||
        "NEUTRAL",
    },

    currentLevelAction: null,
    fastImbalanceReaction: null,
    engine22WaveStrategy,
    engine26LocationContext,

    allowed: false,
    direction: "NONE",

    setupType:
      waitingForEngine26
        ? "WAITING_FOR_ENGINE26_LOCATION"
        : "NONE",

    blockers: [
      waitingForEngine26
        ? "WAITING_FOR_ENGINE26_LOCATION"
        : "CURRENT_LEVEL_ACTION_MISSING",
    ],

    reasonCodes: [
      ...(engine26LocationContext?.reasonCodes || []),

      waitingForEngine26
        ? "WAITING_FOR_ENGINE26_LOCATION"
        : "CURRENT_LEVEL_ACTION_MISSING",

      "PAPER_SCALP_NOT_ALLOWED",
    ],
  });
}

function evaluateReactionForPaper({
  reactionInput,
  currentLevelAction = null,
  fastImbalanceReaction = null,
  engine22WaveStrategy = null,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
  fastMode = false,
}) {
  const source =
    fastMode === true
      ? SOURCE_FAST_IMBALANCE
      : SOURCE_CURRENT_LEVEL;

  const rawState = safeUpper(
    reactionInput?.state,
    "NO_SIGNAL"
  );

  const rawQuality = safeUpper(
    reactionInput?.quality,
    "WEAK"
  );

  const rawActionDirection = safeUpper(
    reactionInput?.direction,
    "NEUTRAL"
  );

  const engine26LocationContext =
    buildEngine26LocationReactionContext({
      engine26ReactionHandoff,
      engine26StructuralContext,

      reactionInput: {
        ...reactionInput,
        state: rawState,
        quality: rawQuality,
        direction: rawActionDirection,
      },
    });

  /*
   * Preserve the observed reaction state for existing Engine 3/6 behavior.
   *
   * The new authorization lifecycle is exposed separately as:
   * engine26LocationContext.state
   *
   * Example:
   * observed state = REJECTING_VALUE
   * authorization state = REACTION_CONFIRMED
   */
  const observedState =
    safeUpper(
      engine26LocationContext?.rawState ||
        rawState,
      rawState
    );

  const authorizationState =
    safeUpper(
      engine26LocationContext?.state,
      observedState
    );

  const quality =
    safeUpper(
      engine26LocationContext?.quality ||
        rawQuality,
      rawQuality
    );

  const actionDirection =
    safeUpper(
      engine26LocationContext?.direction ||
        rawActionDirection,
      rawActionDirection
    );

  const engine22Direction =
    getEngine22Direction(
      engine22WaveStrategy
    );

  const blockers = [];

  const reasonCodes = [
    fastMode === true
      ? "FAST_IMBALANCE_WATCH"
      : null,

    fastMode === true
      ? `FAST_IMBALANCE_STATE_${observedState}`
      : `CURRENT_LEVEL_ACTION_STATE_${observedState}`,

    `ENGINE26_AUTHORIZATION_STATE_${authorizationState}`,

    fastMode === true
      ? `FAST_IMBALANCE_QUALITY_${quality}`
      : `CURRENT_LEVEL_ACTION_QUALITY_${quality}`,

    fastMode === true
      ? `FAST_IMBALANCE_DIRECTION_${actionDirection}`
      : `CURRENT_LEVEL_ACTION_DIRECTION_${actionDirection}`,

    engine22Direction
      ? `ENGINE22_DIRECTION_${engine22Direction}`
      : null,

    ...(engine26LocationContext?.reasonCodes || []),
  ];

  const authorizationBlocked =
    engine26LocationContext?.forceAllowedFalse === true;

  const qualityAllowed =
    GOOD_QUALITY.has(quality);

  if (!qualityAllowed) {
    blockers.push(
      "ENGINE3_PAPER_REACTION_NOT_GOOD_OR_STRONG"
    );

    reasonCodes.push(
      "QUALITY_NOT_GOOD_OR_STRONG"
    );
  }

  if (
    BLOCKED_STATES.has(
      authorizationState
    )
  ) {
    blockers.push(
      authorizationState ===
      "WAITING_FOR_ENGINE26_LOCATION"
        ? "WAITING_FOR_ENGINE26_LOCATION"
        : "ENGINE26_AUTHORIZED_REACTION_STATE_BLOCKED"
    );

    reasonCodes.push(
      `ENGINE26_AUTHORIZED_STATE_${authorizationState}`
    );
  }

  if (
    BLOCKED_STATES.has(
      observedState
    )
  ) {
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

  const isLongAllowedState =
    PAPER_LONG_ALLOWED_STATES.has(
      observedState
    );

  const isLongConditionalState =
    PAPER_LONG_CONDITIONAL_STATES.has(
      observedState
    );

  const isShortResearchState =
    PAPER_SHORT_RESEARCH_STATES.has(
      observedState
    );

  let direction = "NONE";
  let setupType = "NONE";
  let allowed = false;

  if (isLongAllowedState) {
    direction = "LONG";

    setupType =
      setupTypeForState(
        observedState,
        direction,
        fastMode
      );

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
      blockers.push(
        "ENGINE22_DIRECTION_CONFLICTS_WITH_LONG_PAPER_SCALP"
      );

      reasonCodes.push(
        "ENGINE22_DIRECTION_CONFLICT"
      );
    }

    allowed =
      blockers.length === 0;
  } else if (
    isLongConditionalState
  ) {
    direction = "LONG";

    setupType =
      setupTypeForState(
        observedState,
        direction,
        fastMode
      );

    if (quality !== "STRONG") {
      blockers.push(
        "CONDITIONAL_LONG_REQUIRES_STRONG_QUALITY"
      );

      reasonCodes.push(
        "CONDITIONAL_LONG_REQUIRES_STRONG_QUALITY"
      );
    }

    if (
      reactionInput?.confirmed !== true
    ) {
      blockers.push(
        "CONDITIONAL_LONG_REQUIRES_CONFIRMED_CURRENT_ACTION"
      );

      reasonCodes.push(
        "CONDITIONAL_LONG_REQUIRES_CONFIRMED_CURRENT_ACTION"
      );
    }

    if (
      actionDirection !== "LONG"
    ) {
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
      blockers.push(
        "ENGINE22_DIRECTION_CONFLICTS_WITH_LONG_PAPER_SCALP"
      );

      reasonCodes.push(
        "ENGINE22_DIRECTION_CONFLICT"
      );
    }

    allowed =
      blockers.length === 0;
  } else if (
    isShortResearchState
  ) {
    direction = "SHORT";

    setupType =
      setupTypeForState(
        observedState,
        direction,
        fastMode
      );

    reasonCodes.push(setupType);

    if (
      paperShortResearchEnabled !== true
    ) {
      blockers.push(
        "PAPER_SHORT_RESEARCH_DISABLED_V1"
      );

      reasonCodes.push(
        "PAPER_SHORT_RESEARCH_DISABLED_V1"
      );
    }

    if (
      actionDirection !== "SHORT"
    ) {
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

    allowed =
      blockers.length === 0;
  } else {
    setupType =
      setupTypeForState(
        authorizationBlocked
          ? authorizationState
          : observedState,
        actionDirection,
        fastMode
      );

    direction =
      actionDirection;

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

  if (authorizationBlocked) {
    allowed = false;

    if (
      engine26LocationContext?.blocker
    ) {
      blockers.push(
        engine26LocationContext.blocker
      );
    }

    reasonCodes.push(
      "ENGINE26_LOCATION_FORCED_PAPER_NOT_ALLOWED"
    );
  }

  if (!allowed) {
    reasonCodes.push(
      "PAPER_SCALP_NOT_ALLOWED"
    );
  } else {
    reasonCodes.push(
      "PAPER_SCALP_REACTION_ALLOWED"
    );
  }

  return buildBasePaperScalpReaction({
    source,

    reactionInput: {
      ...reactionInput,

      // Keep existing observed state for compatibility.
      state: observedState,
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
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
} = {}) {
  const useFastReaction =
    isFastReactionActive(
      fastImbalanceReaction
    );

  const reactionInput =
    useFastReaction
      ? fastImbalanceReaction
      : currentLevelAction;

  if (
    !reactionInput ||
    typeof reactionInput !== "object"
  ) {
    return buildMissingReaction({
      engine22WaveStrategy,
      engine26ReactionHandoff,
      engine26StructuralContext,
    });
  }

  return evaluateReactionForPaper({
    reactionInput,
    currentLevelAction,

    fastImbalanceReaction:
      useFastReaction
        ? fastImbalanceReaction
        : null,

    engine22WaveStrategy,
    engine26ReactionHandoff,
    engine26StructuralContext,
    paperShortResearchEnabled,
    fastMode: useFastReaction,
  });
}

export function attachPaperScalpReactionToConfluence({
  patchedConfluence,
  engine22WaveStrategy,
  engine26ReactionHandoff = null,
  engine26StructuralContext = null,
  paperShortResearchEnabled = false,
}) {
  const currentLevelAction =
    patchedConfluence
      ?.context
      ?.reaction
      ?.currentLevelAction ||
    null;

  const fastImbalanceReaction =
    patchedConfluence
      ?.context
      ?.reaction
      ?.engine3FastImbalanceReaction ||
    null;

  const paperScalpReaction =
    buildPaperScalpReaction({
      currentLevelAction,
      fastImbalanceReaction,
      engine22WaveStrategy,
      engine26ReactionHandoff,
      engine26StructuralContext,
      paperShortResearchEnabled,
    });

  patchedConfluence.context =
    patchedConfluence.context || {};

  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    paperScalpReaction,
  };

  return patchedConfluence;
}

export default buildPaperScalpReaction;
