// services/core/logic/engine22/wave/lifecycle/core/resolveCurrentLifecycleState.js
// Engine 22 lifecycle current-state resolver
//
// Purpose:
// Choose the single current Engine 22 lifecycle state from already-built waveFibState.
//
// Safety contract:
// - Read-only.
// - No broker logic.
// - No execution.
// - No Engine 6 permission changes.
// - Paper-trade candidate context only.

function readDegreeLifecycle(waveFibState, degree) {
  return waveFibState?.lifecycle?.degreeLifecycle?.[degree] || null;
}

function readDegreeState(waveFibState, degree) {
  return waveFibState?.degrees?.[degree] || null;
}

function normalizeDegreeKey(degree) {
  return String(degree || "").trim().toLowerCase();
}

function getActiveDegreeKeys(waveFibState = null) {
  if (!waveFibState || typeof waveFibState !== "object") return null;

  if (!Array.isArray(waveFibState.activeDegreeKeys)) return null;

  return waveFibState.activeDegreeKeys
    .map((key) => normalizeDegreeKey(key))
    .filter(Boolean);
}

function isActiveDegree(waveFibState = null, degree = "") {
  const keys = getActiveDegreeKeys(waveFibState);

  // Backward-compatible fallback:
  // if no active JSON metadata exists, legacy behavior is allowed.
  if (!keys) return true;

  return keys.includes(normalizeDegreeKey(degree));
}

function buildConfirmationContext({
  waveFibState,
  key,
  mode = "CONTROLLED_PULLBACK_OR_RECLAIM",
  direction = "LONG",
} = {}) {
  return {
    active: true,
    mode,
    direction,

    reactionRequired: true,
    reactionFocus: "CONTROLLED_PULLBACK_OR_RECLAIM",

    participationRequired: true,
    participationFocus: "VOLUME_ON_RECLAIM",

    reference: {
      currentPrice: waveFibState?.currentPrice ?? null,
      triggerLevels: null,
      zones: null,
      priceProgress: {
        intermediate:
          waveFibState?.degrees?.intermediate?.extensionProgress || null,
        minor: waveFibState?.degrees?.minor?.extensionProgress || null,
        minute: waveFibState?.degrees?.minute?.extensionProgress || null,
      },
      emaContext: waveFibState?.emaContext || null,
    },

    noExecution: true,
    noPermissionCreated: true,
    noChase: true,

    reasonCodes: [
      "ENGINE22_CONFIRMATION_CONTEXT",
      key,
      mode,
      "LONG_BIAS",
      "REACTION_REQUIRED",
      "PARTICIPATION_REQUIRED",
      "NO_EXECUTION",
      "NO_PERMISSION_CREATED",
      "NO_CHASE",
    ],
  };
}

export function resolveCurrentLifecycleState({ waveFibState } = {}) {
  const intermediateLifecycle = readDegreeLifecycle(
    waveFibState,
    "intermediate"
  );
  const minorLifecycle = readDegreeLifecycle(waveFibState, "minor");
  const minuteLifecycle = readDegreeLifecycle(waveFibState, "minute");

  const intermediate = readDegreeState(waveFibState, "intermediate");
  const minor = readDegreeState(waveFibState, "minor");
  const minute = readDegreeState(waveFibState, "minute");

  const onlyIntermediateActive =
    isActiveDegree(waveFibState, "intermediate") &&
    !isActiveDegree(waveFibState, "minor") &&
    !isActiveDegree(waveFibState, "minute");

  if (
    onlyIntermediateActive &&
    intermediateLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE"
  ) {
    const key = "INTERMEDIATE_W2_COMPLETE_W3_LAUNCH_WATCH";

    return {
      key,
      headline:
        "INTERMEDIATE W2 COMPLETE — WATCH W3 LAUNCH / RECLAIM CONFIRMATION",
      sourcePath: "waveFibState.lifecycle.degreeLifecycle",
      priority: 1,

      degree: "intermediate",
      wave: "W3",
      tacticalDegree: "minor/minute",
      tacticalWave: "NOT_YET_FORMED",

      action: "WAIT_FOR_W3_LAUNCH_RECLAIM_OR_CONTROLLED_PULLBACK_CONFIRMATION",
      direction: "LONG",
      bias: "BULLISH_W3_LAUNCH_WATCH",

      active: false,
      readOnly: true,
      noExecution: true,
      tradeableOpportunityBlocked: true,

      paperTradeCandidate: true,
      paperTradeAllowedOnlyAfterConfirmation: true,

      readiness: "WATCH",
      setupEligible: false,
      executionBias: "LONG",

      activeDegreeKeys: waveFibState?.activeDegreeKeys || null,

      confirmationContext: buildConfirmationContext({
        waveFibState,
        key,
        mode: "CONTROLLED_PULLBACK_OR_RECLAIM",
        direction: "LONG",
      }),

      intermediate: {
        phase: intermediate?.phase || null,
        confirmedPhase: intermediate?.confirmedPhase || null,
        targets: intermediate?.fibProjection?.levels || null,
        extensionProgress: intermediate?.extensionProgress || null,
      },

      minor: {
        phase: minor?.phase || null,
        confirmedPhase: minor?.confirmedPhase || null,
        inactiveDegree: minor?.inactiveDegree === true,
      },

      minute: {
        phase: minute?.phase || null,
        confirmedPhase: minute?.confirmedPhase || null,
        inactiveDegree: minute?.inactiveDegree === true,
      },

      needs: [
        "NO_CHASE",
        "WAIT_FOR_W3_LAUNCH_RECLAIM_OR_CONTROLLED_PULLBACK",
        "MINOR_STRUCTURE_NOT_YET_FORMED",
        "MINUTE_STRUCTURE_NOT_YET_FORMED",
        "ENGINE3_REACTION_CONFIRMATION",
        "ENGINE4_PARTICIPATION_CONFIRMATION",
        "ENGINE15_READY_REQUIRED",
        "ENGINE6_FINAL_PERMISSION_REQUIRED",
      ],

      reasonCodes: [
        "ENGINE22_CURRENT_LIFECYCLE_STATE_BUILT",
        "ACTIVE_WAVE_STATE_DEGREES_ENFORCED",
        "INTERMEDIATE_ACTIVE",
        "MINOR_INACTIVE_NOT_IN_ACTIVE_WAVE_STATE",
        "MINUTE_INACTIVE_NOT_IN_ACTIVE_WAVE_STATE",
        "INTERMEDIATE_W2_MARKED",
        "WATCH_W3_LAUNCH_CONFIRMATION",
        "PAPER_TRADE_CANDIDATE_ONLY",
        "NO_EXECUTION",
        "NO_CHASE",
      ],
    };
  }

  const allNestedW3 =
    intermediateLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE" &&
    minorLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE" &&
    minuteLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE";

  if (!allNestedW3) {
    return null;
  }

  const key = "INTERMEDIATE_W3_MINOR_MINUTE_W3_CONTINUATION_WATCH";

  return {
    key,
    headline:
      "INTERMEDIATE W3 ACTIVE — MINOR / MINUTE W3 CONTINUATION WATCH",
    sourcePath: "waveFibState.lifecycle.degreeLifecycle",
    priority: 1,

    degree: "intermediate",
    wave: "W3",
    tacticalDegree: "minor/minute",
    tacticalWave: "W3",

    action: "WAIT_FOR_CONTROLLED_PULLBACK_OR_RECLAIM_CONFIRMATION",
    direction: "LONG",
    bias: "BULLISH_CONTINUATION",

    active: false,
    readOnly: true,
    noExecution: true,
    tradeableOpportunityBlocked: true,

    paperTradeCandidate: true,
    paperTradeAllowedOnlyAfterConfirmation: true,

    confirmationContext: buildConfirmationContext({
      waveFibState,
      key,
      mode: "CONTROLLED_PULLBACK_OR_RECLAIM",
      direction: "LONG",
    }),

    intermediate: {
      phase: intermediate?.phase || null,
      confirmedPhase: intermediate?.confirmedPhase || null,
      targets: intermediate?.fibProjection?.levels || null,
      extensionProgress: intermediate?.extensionProgress || null,
    },

    minor: {
      phase: minor?.phase || null,
      confirmedPhase: minor?.confirmedPhase || null,
      targets: minor?.fibProjection?.levels || null,
      extensionProgress: minor?.extensionProgress || null,
    },

    minute: {
      phase: minute?.phase || null,
      confirmedPhase: minute?.confirmedPhase || null,
      targets: minute?.fibProjection?.levels || null,
      extensionProgress: minute?.extensionProgress || null,
    },

    needs: [
      "NO_CHASE",
      "WAIT_FOR_CONTROLLED_PULLBACK_OR_RECLAIM",
      "ENGINE3_REACTION_CONFIRMATION",
      "ENGINE4_PARTICIPATION_CONFIRMATION",
      "ENGINE15_READY_REQUIRED",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
    ],

    reasonCodes: [
      "ENGINE22_CURRENT_LIFECYCLE_STATE_BUILT",
      "INTERMEDIATE_W3_ACTIVE",
      "MINOR_W3_ACTIVE",
      "MINUTE_W3_ACTIVE",
      "BULLISH_CONTINUATION_CONTEXT",
      "PAPER_TRADE_CANDIDATE_ONLY",
      "NO_EXECUTION",
      "NO_CHASE",
    ],
  };
}

export default resolveCurrentLifecycleState;
