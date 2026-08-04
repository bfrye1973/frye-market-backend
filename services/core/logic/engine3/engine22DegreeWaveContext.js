// services/core/logic/engine3/engine22DegreeWaveContext.js
//
// Shared Engine 3 reader for Engine 22 degreeStates.
// Purpose:
// - Let Engine 3 reaction outputs describe price action relative to the same
//   Engine 22 structure Engine 26 will use.
// - Does not create permission.
// - Does not create execution.

function safeUpper(value, fallback = "NONE") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function pickCorrectionType(degreeState) {
  return (
    degreeState?.correctionModel?.type ||
    degreeState?.correctionModel?.modelType ||
    degreeState?.correctionModels?.preferred?.type ||
    degreeState?.correctionModels?.preferred?.modelType ||
    null
  );
}

function isMinuteW3InternalIvWatch(minute) {
  const internal = minute?.internalStructure || null;
  return (
    safeUpper(minute?.activeWave) === "W3" &&
    (safeUpper(minute?.stage).includes("EXTENSION_MATURITY") ||
      safeUpper(internal?.classification) === "FAST_IMPULSE_EXTENSION") &&
    safeUpper(internal?.currentInternalWave) === "III" &&
    safeUpper(internal?.nextExpectedInternalWave) === "IV" &&
    internal?.parentWaveComplete !== true &&
    internal?.parentTransitionPossible !== true
  );
}

function inferReactionVsStructure({ direction, state, minute, subminute }) {
  const d = safeUpper(direction, "NEUTRAL");
  const s = safeUpper(state, "NO_SIGNAL");

  if (isMinuteW3InternalIvWatch(minute)) {
    if (
      d === "LONG" &&
      [
        "RECLAIMED_LEVEL",
        "WICK_BELOW_AND_RECLAIM",
        "SELLERS_TRAPPED",
      ].includes(s)
    ) {
      return "INTERNAL_IV_RECLAIM_SUPPORT";
    }

    if (
      d === "LONG" &&
      [
        "HELD_LEVEL",
        "DIP_BOUGHT_FAST",
        "ACCEPTING_VALUE",
        "BREAKOUT_HOLDING",
      ].includes(s)
    ) {
      return "INTERNAL_IV_SUPPORT_HOLD";
    }

    if (
      d === "SHORT" &&
      [
        "FAILED_RECLAIM",
        "REJECTING_VALUE",
        "BREAKOUT_FAILING",
        "LOST_LEVEL",
      ].includes(s)
    ) {
      return "INTERNAL_IV_SUPPORT_FAILURE";
    }

    if (d === "SHORT") {
      return "INTERNAL_IV_PULLBACK_REACTION";
    }

    return "STRUCTURAL_REACTION_MIXED";
  }

  const correctionType = safeUpper(pickCorrectionType(minute), "NONE");
  const tacticalText = [
    subminute?.currentRead,
    subminute?.headline,
    subminute?.nestedCorrectionContext?.tacticalFocus,
    subminute?.nestedCorrectionContext?.parentCurrentRead,
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();

  const cDownActive =
    correctionType === "ABC_DOWN" &&
    (tacticalText.includes("C_DOWN") ||
      tacticalText.includes("C DOWN") ||
      tacticalText.includes("SUBMINUTE_C"));

  if (cDownActive && d === "SHORT") {
    return "SUPPORTS_TACTICAL_C_DOWN";
  }

  if (
    cDownActive &&
    d === "LONG" &&
    [
      "HELD_LEVEL",
      "RECLAIMED_LEVEL",
      "WICK_BELOW_AND_RECLAIM",
      "DIP_BOUGHT_FAST",
      "SELLERS_TRAPPED",
      "ACCEPTING_VALUE",
      "BREAKOUT_HOLDING",
    ].includes(s)
  ) {
    return "CHALLENGES_TACTICAL_C_DOWN_SUPPORT_DEFENSE";
  }

  return "STRUCTURAL_REACTION_MIXED";
}

function buildInterpretation({ reactionVsStructure, state }) {
  if (reactionVsStructure === "INTERNAL_IV_PULLBACK_REACTION") {
    return "Price reaction is consistent with the expected internal iv pullback while Minute W3 remains active.";
  }

  if (reactionVsStructure === "INTERNAL_IV_SUPPORT_HOLD") {
    return "Price is holding structural support during the expected internal iv phase. Engine 4 participation and Engine 6 permission are still required.";
  }

  if (reactionVsStructure === "INTERNAL_IV_RECLAIM_SUPPORT") {
    return "Price has reclaimed structural support during the expected internal iv phase; Engine 4 participation is still required before watching for internal v continuation.";
  }

  if (reactionVsStructure === "INTERNAL_IV_SUPPORT_FAILURE") {
    return "Price has lost or failed to reclaim structural support; the active Minute W3 count requires review.";
  }

  if (reactionVsStructure === "SUPPORTS_TACTICAL_C_DOWN") {
    return "Price reaction supports the explicitly published tactical C-down correction path.";
  }

  if (reactionVsStructure === "CHALLENGES_TACTICAL_C_DOWN_SUPPORT_DEFENSE") {
    return "Price is holding or reclaiming support against the explicitly published tactical C-down correction path.";
  }

  return `Engine 3 reaction is ${safeUpper(
    state,
    "MIXED"
  )} relative to the current Engine 22 degree structure.`;
}

export function buildEngine22DegreeWaveContext({
  engine22WaveStrategy = null,
  reactionState = null,
  reactionDirection = null,
} = {}) {
  const degreeStates = engine22WaveStrategy?.degreeStates || null;

  if (!degreeStates || typeof degreeStates !== "object") {
    return {
      active: false,
      source: "engine22WaveStrategy.currentLifecycleState",
      fallback: true,
      reactionVsStructure: "DEGREE_STATES_MISSING",
      reasonCodes: ["ENGINE22_DEGREE_STATES_MISSING_FALLBACK_ONLY"],
    };
  }

  const minor = degreeStates.minor || {};
  const minute = degreeStates.minute || {};
  const subminute = degreeStates.subminute || {};
  const minuteInternal = minute?.internalStructure || null;
  const publishedTargetContext =
    engine22WaveStrategy?.currentLifecycleState?.targetContext || null;

  const reactionVsStructure = inferReactionVsStructure({
    direction: reactionDirection,
    state: reactionState,
    minute,
    subminute,
  });

  return {
    active: true,
    source: "engine22WaveStrategy.degreeStates",

    minor: {
      degree: "minor",
      activeWave: minor.activeWave || null,
      stage: minor.stage || null,
      headline: minor.headline || null,
      currentRead: minor.currentRead || null,
      correctionType: pickCorrectionType(minor),
    },

    minute: {
      degree: "minute",
      activeWave: minute.activeWave || null,
      stage: minute.stage || null,
      headline: minute.headline || null,
      currentRead: minute.currentRead || null,
      correctionType: pickCorrectionType(minute),
      targetModel: minute.targetModel || null,
      internalStructure: minuteInternal,
      currentInternalWave: minuteInternal?.currentInternalWave || null,
      nextExpectedInternalWave:
        minuteInternal?.nextExpectedInternalWave || null,
      classification: minuteInternal?.classification || null,
      parentWaveStillValid:
        minuteInternal?.parentWaveStillValid ?? null,
      parentWaveComplete: minuteInternal?.parentWaveComplete ?? null,
      parentTransitionPossible:
        minuteInternal?.parentTransitionPossible ?? null,
      transitionRisk: minuteInternal?.transitionRisk || null,
      supportLevel: minuteInternal?.supportLevel ?? null,
      invalidationLevel: minuteInternal?.invalidationLevel ?? null,
      nextTarget:
        publishedTargetContext?.nextTarget ??
        minute?.targetModel?.nextTarget ??
        null,
      nestedCurrentRead:
        minute?.nestedCorrectionContext?.currentRead || null,
      expectedPath:
        minute?.nestedCorrectionContext?.expectedPath || null,
      currentChildLeg:
        minute?.nestedCorrectionContext?.currentChildLeg || null,
      completionGoal:
        minute?.nestedCorrectionContext?.completionGoal || null,
    },

    subminute: {
      degree: "subminute",
      activeWave: subminute.activeWave || null,
      stage: subminute.stage || null,
      headline: subminute.headline || null,
      currentRead: subminute.currentRead || null,
      tacticalFocus:
        subminute?.nestedCorrectionContext?.tacticalFocus || null,
      parentCurrentRead:
        subminute?.nestedCorrectionContext?.parentCurrentRead || null,
    },

    reactionVsStructure,
    interpretation: buildInterpretation({
      reactionVsStructure,
      state: reactionState,
    }),

    noPermissionCreated: true,
    noExecution: true,

    reasonCodes: [
      "ENGINE22_DEGREE_STATES_CONSUMED",
      reactionVsStructure,
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildEngine22DegreeWaveContext;
