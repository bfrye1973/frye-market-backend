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
import { buildReactionReadiness } from "./buildReactionReadiness.js";

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
  diagnosticFastImbalanceReaction = fastImbalanceReaction,
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

    // Phase D1 additive downstream handoff aliases.
    // Both fields are assigned only from the final Engine 3 production truth.
    participationEvaluationEligible:
      allowed === true,

    engine3Strategy1QualifiedForEngine6:
      allowed === true,

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

    laneId:
      engine26LocationContext?.laneId ?? null,

    strategyId:
      engine26LocationContext?.strategyId ?? null,

    symbol:
      engine26LocationContext?.symbol ?? null,

    setupClass:
      engine26LocationContext?.setupClass ?? null,

    setupGrade:
      engine26LocationContext?.setupGrade ?? null,

    identitySetupKey:
      engine26LocationContext?.identitySetupKey ?? null,

    candidateIdentityVersion:
      engine26LocationContext?.candidateIdentityVersion ?? null,

    armed:
      engine26LocationContext?.armed === true,

    chainArmed:
      engine26LocationContext?.chainArmed === true,

    contactState:
      engine26LocationContext?.contactState ?? null,

    directionState:
      engine26LocationContext?.directionState ?? null,

    canonicalIdentity:
      engine26LocationContext?.canonicalIdentity || null,

    sourceIdentity:
      engine26LocationContext?.sourceIdentity || null,

    identityComparison:
      engine26LocationContext?.identityComparison || null,

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
evaluationAuthorized:
  engine26LocationContext
    ?.authorizeEngine3Evaluation === true,

reactionConfirmed:
  engine26LocationContext?.confirmed === true &&
  engine26LocationContext?.state === "REACTION_CONFIRMED",

reactionState:
  engine26LocationContext?.state || state,

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

  const paperScalpReaction =
    buildBasePaperScalpReaction({
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

  const reactionReadiness =
    buildReactionReadiness({
      selectedSource: "NONE",
      reactionInput: null,
      currentLevelAction: null,
      fastImbalanceReaction: null,

      observedState:
        engine26LocationContext?.rawState ??
        null,

      authorizationState:
        engine26LocationContext?.state ??
        null,

      actionDirection:
        engine26LocationContext?.direction ??
        null,

      quality:
        engine26LocationContext?.quality ??
        null,

      engine26LocationContext,

      productionAllowed:
        paperScalpReaction.allowed,

      productionBlockers:
        paperScalpReaction.blockers,

      productionReasonCodes:
        paperScalpReaction.reasonCodes,

      sourceSelectionReason:
        "NO_USABLE_REACTION_INPUT",
    });

  return {
    ...paperScalpReaction,
    reactionReadiness: {
      ...reactionReadiness,
      canonicalIdentity:
        engine26LocationContext?.canonicalIdentity || null,
      sourceIdentity:
        engine26LocationContext?.sourceIdentity || null,
      identityComparison:
        engine26LocationContext?.identityComparison || null,
    },
  };
}

function evaluateReactionForPaper({
  reactionInput,
  currentLevelAction = null,
  fastImbalanceReaction = null,
  diagnosticFastImbalanceReaction = fastImbalanceReaction,
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

  // Phase C: selected Engine 3 reaction facts remain branch-authoritative.
  // Engine 26 authorization quality/direction are transported separately.
  const quality = rawQuality;
  const actionDirection = rawActionDirection;

  const engine22Direction =
    getEngine22Direction(
      engine22WaveStrategy
    );

  const blockers = [];

  const identityMismatches = Array.isArray(
    engine26LocationContext?.identityComparison?.mismatches
  )
    ? engine26LocationContext.identityComparison.mismatches
    : [];

  blockers.push(...identityMismatches);

  const reasonCodes = [
    ...identityMismatches,
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
    engine26LocationContext?.forceAllowedFalse === true ||
    identityMismatches.length > 0;

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
      if (!blockers.includes(engine26LocationContext.blocker)) {
        blockers.push(engine26LocationContext.blocker);
      }
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

  const paperScalpReaction =
    buildBasePaperScalpReaction({
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

  const reactionReadiness =
    buildReactionReadiness({
      selectedSource:
        fastMode === true
          ? "FAST_IMBALANCE"
          : "CURRENT_LEVEL_ACTION",

      reactionInput,
      currentLevelAction,
      fastImbalanceReaction:
        diagnosticFastImbalanceReaction,

      observedState,
      authorizationState,
      actionDirection,
      quality,

      engine26LocationContext,

      productionAllowed:
        paperScalpReaction.allowed,

      productionBlockers:
        paperScalpReaction.blockers,

      productionReasonCodes:
        paperScalpReaction.reasonCodes,

      sourceSelectionReason:
        fastMode === true
          ? "Fast imbalance source had production priority because active and fastMode were both true."
          : (
              diagnosticFastImbalanceReaction != null &&
              typeof diagnosticFastImbalanceReaction === "object"
                ? "Fast imbalance source existed but was not production-eligible because active and fastMode were not both true."
                : "No production-eligible fast imbalance source was available."
            ),
    });

  return {
    ...paperScalpReaction,
    reactionReadiness: {
      ...reactionReadiness,
      canonicalIdentity:
        engine26LocationContext?.canonicalIdentity || null,
      sourceIdentity:
        engine26LocationContext?.sourceIdentity || null,
      identityComparison:
        engine26LocationContext?.identityComparison || null,
    },
  };
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

    diagnosticFastImbalanceReaction:
      fastImbalanceReaction,

    engine22WaveStrategy,
    engine26ReactionHandoff,
    engine26StructuralContext,
    paperShortResearchEnabled,
    fastMode: useFastReaction,
  });
}


const STRATEGY1_CANONICAL_IDENTITY_FIELDS = [
  "symbol",
  "laneId",
  "strategyId",
  "candidateId",
  "zoneId",
  "candidateIdentityVersion",
];

const STRATEGY1_CANONICAL_LONG_STATES = new Set([
  "HELD_LEVEL",
  "RECLAIMED_LEVEL",
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "SELLERS_TRAPPED",
  "ACCEPTING_VALUE",
  "BREAKOUT_HOLDING",
]);

const STRATEGY1_CANONICAL_SHORT_STATES = new Set([
  "LOST_LEVEL",
  "FAILED_RECLAIM",
  "REJECTING_VALUE",
  "BREAKOUT_FAILING",
  "FAILED_ACCEPTANCE_SHORT",
  "LOST_SHORT_TRIGGER_LEVEL",
]);

function strategy1IdentityAligned(observation1m, engine26ReactionHandoff) {
  if (
    !observation1m ||
    typeof observation1m !== "object" ||
    !engine26ReactionHandoff ||
    typeof engine26ReactionHandoff !== "object"
  ) {
    return false;
  }

  return STRATEGY1_CANONICAL_IDENTITY_FIELDS.every((field) => {
    const observed = observation1m?.[field];
    const expected = engine26ReactionHandoff?.[field];

    return (
      observed != null &&
      observed !== "" &&
      expected != null &&
      expected !== "" &&
      observed === expected
    );
  });
}

function resolveStrategy1CanonicalReaction({
  observation1m = null,
  validation5m = null,
  productionReaction = null,
  engine26ReactionHandoff = null,
} = {}) {
  const observedState = safeUpper(
    observation1m?.state,
    "NO_SIGNAL"
  );

  const observedDirection = safeUpper(
    observation1m?.direction,
    "NEUTRAL"
  );

  const identityAligned = strategy1IdentityAligned(
    observation1m,
    engine26ReactionHandoff
  );

  const observationPresent =
    observation1m != null &&
    typeof observation1m === "object";

  const observationActive =
    observation1m?.active === true;

  const observationFresh =
    observation1m?.stale === false;

  const candleCompleted =
    observation1m?.currentCandleStatus === "COMPLETED" ||
    observation1m?.candleState === "COMPLETED";

  const longState =
    STRATEGY1_CANONICAL_LONG_STATES.has(observedState);

  const shortState =
    STRATEGY1_CANONICAL_SHORT_STATES.has(observedState);

  const directionalStateAligned =
    (observedDirection === "LONG" && longState) ||
    (observedDirection === "SHORT" && shortState);

  const neutralState =
    observedDirection === "NEUTRAL" &&
    !longState &&
    !shortState;

  const observationUsable =
    observationPresent &&
    observationActive &&
    observationFresh &&
    candleCompleted &&
    identityAligned &&
    (directionalStateAligned || neutralState);

  let state = "NO_SIGNAL";
  let direction = "NEUTRAL";
  let sourceTimeframe = null;
  let reactionTimeframe = null;
  let resolutionStatus = "NO_USABLE_1M_CANONICAL_EVIDENCE";
  let resolutionReason = "ONE_MINUTE_EVIDENCE_UNUSABLE";

  if (observationUsable) {
    state = observedState;
    direction = directionalStateAligned
      ? observedDirection
      : "NEUTRAL";
    sourceTimeframe = "1m";
    reactionTimeframe = "1m";
    resolutionStatus =
      direction === "NEUTRAL"
        ? "CANONICAL_1M_NEUTRAL"
        : "CANONICAL_1M_DIRECTIONAL";
    resolutionReason =
      direction === "NEUTRAL"
        ? "FRESH_COMPLETED_1M_NEUTRAL_REACTION"
        : "FRESH_COMPLETED_1M_DIRECTIONAL_REACTION";
  } else if (!observationPresent) {
    resolutionReason = "ONE_MINUTE_OBSERVATION_MISSING";
  } else if (!identityAligned) {
    resolutionReason = "ONE_MINUTE_IDENTITY_MISMATCH";
  } else if (observation1m?.stale === true) {
    resolutionReason = "ONE_MINUTE_OBSERVATION_STALE";
  } else if (!candleCompleted) {
    resolutionReason = "ONE_MINUTE_CANDLE_NOT_COMPLETED";
  } else if (!observationActive) {
    resolutionReason = "ONE_MINUTE_OBSERVATION_INACTIVE";
  } else if (!directionalStateAligned && !neutralState) {
    resolutionReason = "ONE_MINUTE_STATE_DIRECTION_NOT_USABLE";
  }

  return {
    state,
    direction,
    sourceTimeframe,
    reactionTimeframe,
    resolutionStatus,
    resolutionReason,
    observationUsable,
    identityAligned,
    observedState,
    observedDirection,
    validationState:
      validation5m?.validationState || null,
    validationTimeframe:
      validation5m?.sourceTimeframe || null,
    broaderContextDirection:
      productionReaction?.direction || null,
    broaderContextState:
      productionReaction?.state || null,
  };
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

  const observation1m =
    patchedConfluence
      ?.context
      ?.reaction
      ?.engine3ReactionObservation1m ||
    null;

  const validation5m =
    patchedConfluence
      ?.context
      ?.reaction
      ?.engine3ReactionValidation5m ||
    null;

  /*
   * Preserve the complete pre-Phase-3E production reaction as the
   * broader 10m context. This object remains diagnostic/contextual
   * and must not own the canonical Strategy 1 direction when valid
   * 1m evidence is available.
   */
  const broaderReaction10m =
    buildPaperScalpReaction({
      currentLevelAction,
      fastImbalanceReaction,
      engine22WaveStrategy,
      engine26ReactionHandoff,
      engine26StructuralContext,
      paperShortResearchEnabled,
    });

  const canonicalResolution =
    resolveStrategy1CanonicalReaction({
      observation1m,
      validation5m,
      productionReaction: broaderReaction10m,
      engine26ReactionHandoff,
    });

  const paperScalpReaction = {
    ...broaderReaction10m,

    /*
     * Phase 3E canonical Strategy 1 truth.
     *
     * 1m owns immediate canonical state/direction when the evidence
     * is fresh, completed, usable, and identity-aligned.
     * 5m remains validation only.
     * 10m remains broader context only.
     */
    state: canonicalResolution.state,
    direction: canonicalResolution.direction,
    reactionTimeframe:
      canonicalResolution.reactionTimeframe,
    sourceTimeframe:
      canonicalResolution.sourceTimeframe,

    canonicalResolutionStatus:
      canonicalResolution.resolutionStatus,
    canonicalResolutionReason:
      canonicalResolution.resolutionReason,
    canonicalObservationUsable:
      canonicalResolution.observationUsable,
    canonicalIdentityAligned:
      canonicalResolution.identityAligned,

    validationTimeframe:
      canonicalResolution.validationTimeframe,

    /*
     * Preserve the complete original 10m production reaction without
     * discarding any existing diagnostic fields.
     */
    broaderReaction10m,

    supportingBarTime:
      observation1m?.supportingBarTime ?? null,

    evaluationTimeMs:
      observation1m?.evaluationTimeMs ??
      observation1m?.observedAt ??
      null,

    currentCandleStatus:
      observation1m?.currentCandleStatus || null,

    priorCandleStatus:
      observation1m?.priorCandleStatus || null,

    currentCandle:
      observation1m?.currentCandle || null,

    priorCandle:
      observation1m?.priorCandle || null,

    lastCandle:
      observation1m?.currentCandle ||
      broaderReaction10m?.lastCandle ||
      null,

    candleClosed:
      observation1m?.currentCandleStatus === "COMPLETED"
        ? true
        : observation1m?.currentCandleStatus === "FORMING"
        ? false
        : null,

    priorCandleCompleted:
      observation1m?.priorCandleStatus === "COMPLETED"
        ? true
        : observation1m?.priorCandleStatus === "FORMING"
        ? false
        : null,

    candleSourceFresh:
      observation1m?.stale === false &&
      validation5m?.stale === false,

    reactionObservation1m:
      observation1m,

    reactionValidation5m:
      validation5m,
  };

  patchedConfluence.context =
    patchedConfluence.context || {};

  patchedConfluence.context.reaction = {
    ...(patchedConfluence.context.reaction || {}),
    paperScalpReaction,
  };

  return patchedConfluence;
}

export default buildPaperScalpReaction;
