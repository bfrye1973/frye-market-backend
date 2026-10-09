// Engine 26 Strategy 1 — read-only Engine 22 Micro timing shadow.
//
// Phase 9B migration gate only.
// This module reads Engine 22 microExecutionContext and publishes diagnostics
// alongside Engine 26. It MUST NOT change candidate identity, location,
// direction, reaction eligibility, permission, sizing, management, execution,
// or journal state.

function upper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function clone(value) {
  return value == null
    ? value
    : JSON.parse(JSON.stringify(value));
}

export function buildEngine26MicroTimingShadow({
  engine22WaveStrategy = null,
  engine26LocationCandidate = null,
} = {}) {
  const micro =
    engine22WaveStrategy
      ?.microExecutionContext ||
    null;

  if (!micro || typeof micro !== "object") {
    return {
      engine:
        "engine26.microTimingShadow.v1",
      available: false,
      mode: "SHADOW_ONLY",
      affectsCandidate: false,
      affectsIdentity: false,
      affectsPermission: false,
      affectsSizing: false,
      affectsExecution: false,
      reasonCodes: [
        "ENGINE22_MICRO_EXECUTION_CONTEXT_UNAVAILABLE",
        "ENGINE26_MICRO_TIMING_SHADOW_ONLY",
      ],
    };
  }

  const countStatus =
    upper(micro.countStatus);

  const timingState =
    upper(micro.microTimingState);

  const lifecycle =
    upper(micro.lifecycle);

  const activeWave =
    upper(micro.activeWave);

  const waveDirection =
    upper(micro.waveDirection);

  const sourceCountId =
    String(
      micro.sourceCountId || ""
    ).trim() || null;

  const canonicalStateVersion =
    micro.canonicalStateVersion ??
    null;

  const sourceTimestamp =
    micro.sourceTimestamp ??
    null;

  const identityComplete =
    sourceCountId != null &&
    canonicalStateVersion != null &&
    sourceTimestamp != null;

  const structuralTimingReady =
    timingState === "TIMING_READY" &&
    countStatus === "ACTIVE" &&
    identityComplete;

  const producerAutomationEligible =
    micro.automationEligible === true;

  const productionTimingEligible =
    structuralTimingReady &&
    producerAutomationEligible;

  const candidateDirection =
    upper(
      engine26LocationCandidate
        ?.currentObservationDirection ??
      engine26LocationCandidate
        ?.direction ??
      engine26LocationCandidate
        ?.directionBias
    ) || "UNKNOWN";

  return {
    engine:
      "engine26.microTimingShadow.v1",

    available: true,

    mode:
      "SHADOW_ONLY",

    source:
      "engine22WaveStrategy.microExecutionContext",

    sourceCountId,

    canonicalStateVersion,

    sourceTimestamp,

    sequenceId:
      micro.sequenceId ??
      null,

    activeWave,
    waveDirection,
    lifecycle,
    microTimingState:
      timingState,
    countStatus,

    origin:
      clone(micro.origin),

    lockedWaveAnchor:
      clone(
        micro.lockedWaveAnchor
      ),

    developingAnchor:
      micro.developingAnchor ??
      null,

    candidateAnchor:
      micro.candidateAnchor ??
      null,

    confirmedAnchor:
      micro.confirmedAnchor ??
      null,

    lastTouchedFib:
      clone(
        micro.lastTouchedFib
      ),

    nextFib:
      clone(
        micro.nextFib
      ),

    invalidation:
      clone(
        micro.invalidation
      ),

    invalidationState:
      micro.invalidationState ??
      null,

    fiveMinuteEvidence:
      clone(
        micro.fiveMinuteEvidence
      ),

    structuralEvidence:
      clone(
        micro.structuralEvidence
      ),

    identityComplete,

    structuralTimingReady,

    producerAutomationEligible,

    productionTimingEligible,

    candidateObservation: {
      candidateId:
        engine26LocationCandidate
          ?.candidateId ??
        null,

      zoneId:
        engine26LocationCandidate
          ?.zoneId ??
        null,

      direction:
        candidateDirection,

      comparisonToMicroWave:
        candidateDirection ===
          "UNKNOWN" ||
        !["UP","DOWN"].includes(
          waveDirection
        )
          ? "NOT_COMPARABLE"
          : (
              candidateDirection ===
                "LONG" &&
              waveDirection === "UP"
            ) ||
            (
              candidateDirection ===
                "SHORT" &&
              waveDirection === "DOWN"
            )
          ? "SAME_DIRECTION_DIAGNOSTIC_ONLY"
          : "DIFFERENT_DIRECTION_DIAGNOSTIC_ONLY",
    },

    affectsCandidate: false,
    affectsIdentity: false,
    affectsLocation: false,
    affectsReactionEligibility: false,
    affectsPermission: false,
    affectsSizing: false,
    affectsManagement: false,
    affectsExecution: false,
    affectsJournal: false,

    reasonCodes: [
      "ENGINE26_READS_ENGINE22_MICRO_TIMING_SHADOW",
      identityComplete
        ? "MICRO_TIMING_IDENTITY_COMPLETE"
        : "MICRO_TIMING_IDENTITY_INCOMPLETE",
      structuralTimingReady
        ? "MICRO_STRUCTURAL_TIMING_READY_DIAGNOSTIC"
        : "MICRO_STRUCTURAL_TIMING_NOT_READY",
      producerAutomationEligible
        ? "ENGINE22_PRODUCER_AUTOMATION_ELIGIBLE"
        : "ENGINE22_PRODUCER_AUTOMATION_NOT_ELIGIBLE",
      productionTimingEligible
        ? "MICRO_PRODUCTION_TIMING_ELIGIBLE"
        : "MICRO_PRODUCTION_TIMING_BLOCKED",
      "SHADOW_ONLY",
      "NO_CANDIDATE_MUTATION",
      "NO_IDENTITY_MUTATION",
      "NO_PERMISSION_CREATED",
      "NO_SIZING",
      "NO_EXECUTION",
    ],
  };
}

export default buildEngine26MicroTimingShadow;
