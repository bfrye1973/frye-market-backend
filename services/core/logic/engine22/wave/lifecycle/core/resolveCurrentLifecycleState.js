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

export function resolveCurrentLifecycleState({ waveFibState } = {}) {
  const intermediateLifecycle = readDegreeLifecycle(
    waveFibState,
    "intermediate"
  );
  const minorLifecycle = readDegreeLifecycle(waveFibState, "minor");
  const minuteLifecycle = readDegreeLifecycle(waveFibState, "minute");

  const allNestedW3 =
    intermediateLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE" &&
    minorLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE" &&
    minuteLifecycle?.lifecycleState === "W3_EXTENSION_ACTIVE";

  if (!allNestedW3) {
    return null;
  }

  const intermediate = readDegreeState(waveFibState, "intermediate");
  const minor = readDegreeState(waveFibState, "minor");
  const minute = readDegreeState(waveFibState, "minute");

  return {
    key: "INTERMEDIATE_W3_MINOR_MINUTE_W3_CONTINUATION_WATCH",
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
