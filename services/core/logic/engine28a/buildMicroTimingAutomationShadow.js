// Engine 28A — Strategy 1 Micro timing automation acceptance shadow.
//
// Read-only cross-engine diagnostic for the approved Engine 22 Micro timing
// architecture. This module answers one question only:
//
// "If Engine 22 Micro were eventually authorized as Strategy 1 timing context,
// which canonical downstream gate is currently first to prevent a paper entry?"
//
// It creates NO permission, candidate, sizing, management, execution, or journal
// state. Engine 22 producer automation eligibility remains a hard acceptance gate.

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function exactDirection(value) {
  const v = upper(value);
  return ["LONG", "SHORT"].includes(v) ? v : null;
}

function waveDirectionToTradeDirection(value) {
  const v = upper(value);
  return v === "UP"
    ? "LONG"
    : v === "DOWN"
    ? "SHORT"
    : null;
}

function stage(name, state, proof = {}) {
  return {
    stage: name,
    state,
    proof,
  };
}

export function buildMicroTimingAutomationShadow(strategy = {}) {
  const micro =
    strategy?.engine22WaveStrategy?.microExecutionContext ||
    null;

  const e26Shadow =
    strategy?.engine26MicroTimingShadow ||
    null;

  const e26 =
    strategy?.engine26LocationCandidate ||
    null;

  const e3 =
    strategy
      ?.confluence
      ?.context
      ?.reaction
      ?.paperScalpReaction ||
    null;

  const e4 =
    strategy
      ?.confluence
      ?.context
      ?.volume
      ?.engine4AuthorizedReactionParticipation ||
    null;

  const e6 =
    strategy?.permission?.paper ||
    null;

  const stages = [];

  const base = {
    active: true,
    engine:
      "engine28a.microTimingAutomationShadow.v1",
    mode:
      "READ_ONLY_ACCEPTANCE_SHADOW",
    strategyId:
      "intraday_scalp@10m",
    symbol:
      "ES",
    affectsEngine22: false,
    affectsEngine26: false,
    affectsEngine3: false,
    affectsEngine4: false,
    affectsEngine6: false,

    // Explicit ownership guardrails use both owner names and authority names so
    // downstream diagnostics cannot mistake this read-only contract for a gate.
    affectsCandidate: false,
    affectsIdentity: false,
    affectsLocation: false,
    affectsReactionEligibility: false,
    affectsParticipation: false,
    affectsPermission: false,
    affectsSizing: false,
    affectsManagement: false,
    affectsExecution: false,
    affectsJournal: false,
    paperOrderCreated: false,
    noPermissionCreated: true,
    noExecution: true,
  };

  if (!micro || typeof micro !== "object") {
    return {
      ...base,
      shadowStatus:
        "WAIT_ENGINE22_MICRO",
      firstWaitingStage:
        "engine22Micro",
      hypotheticalPaperTimingReady:
        false,
      productionActivationEligible:
        false,
      stages: [
        stage(
          "engine22Micro",
          "WAITING",
          {
            microExecutionContextPresent:
              false,
          }
        ),
      ],
      reasonCodes: [
        "ENGINE22_MICRO_EXECUTION_CONTEXT_MISSING",
        "SHADOW_ONLY",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const microCountActive =
    upper(micro.countStatus) === "ACTIVE";

  const microTimingReady =
    upper(micro.microTimingState) ===
      "TIMING_READY" &&
    microCountActive;

  const producerAutomationEligible =
    micro.automationEligible === true;

  const microDirection =
    waveDirectionToTradeDirection(
      micro.waveDirection
    );

  stages.push(
    stage(
      "engine22Micro",
      microTimingReady
        ? "PASS_TIMING"
        : "WAITING",
      {
        sourceCountId:
          micro.sourceCountId ?? null,
        canonicalStateVersion:
          micro.canonicalStateVersion ??
          null,
        sourceTimestamp:
          micro.sourceTimestamp ?? null,
        activeWave:
          micro.activeWave ?? null,
        waveDirection:
          micro.waveDirection ?? null,
        lifecycle:
          micro.lifecycle ?? null,
        microTimingState:
          micro.microTimingState ?? null,
        countStatus:
          micro.countStatus ?? null,
        automationEligible:
          producerAutomationEligible,
      }
    )
  );

  if (!microTimingReady) {
    return {
      ...base,
      sourceCountId:
        micro.sourceCountId ?? null,
      shadowStatus:
        "WAIT_ENGINE22_MICRO",
      firstWaitingStage:
        "engine22Micro",
      hypotheticalPaperTimingReady:
        false,
      productionActivationEligible:
        false,
      stages,
      reasonCodes: [
        "MICRO_TIMING_NOT_READY",
        "SHADOW_ONLY",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const e26Present =
    e26 &&
    typeof e26 === "object" &&
    e26.candidateId != null &&
    e26.zoneId != null;

  const e26Direction =
    exactDirection(
      e26?.currentObservationDirection ??
      e26?.direction
    );

  stages.push(
    stage(
      "engine26A",
      e26Present
        ? "PASS_CONTEXT"
        : "WAITING",
      {
        candidateId:
          e26?.candidateId ?? null,
        zoneId:
          e26?.zoneId ?? null,
        direction:
          e26Direction ??
          e26?.currentObservationDirection ??
          e26?.direction ??
          null,
        timingShadowAvailable:
          e26Shadow?.available === true,
        timingSourceCountId:
          e26Shadow?.sourceCountId ??
          null,
      }
    )
  );

  if (!e26Present) {
    return {
      ...base,
      sourceCountId:
        micro.sourceCountId ?? null,
      shadowStatus:
        "WAIT_ENGINE26_LOCATION",
      firstWaitingStage:
        "engine26A",
      hypotheticalPaperTimingReady:
        false,
      productionActivationEligible:
        false,
      stages,
      reasonCodes: [
        "ENGINE26_LOCATION_IDENTITY_INCOMPLETE",
        "SHADOW_ONLY",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const e3Direction =
    exactDirection(e3?.direction);

  const e3Pass =
    e3?.allowed === true &&
    e3?.reactionConfirmed === true &&
    e3?.engine3Strategy1QualifiedForEngine6 ===
      true &&
    e3Direction != null;

  stages.push(
    stage(
      "engine3",
      e3Pass
        ? "PASS"
        : "WAITING",
      {
        state:
          e3?.state ?? null,
        direction:
          e3?.direction ?? null,
        allowed:
          e3?.allowed === true,
        reactionConfirmed:
          e3?.reactionConfirmed === true,
        qualifiedForEngine6:
          e3?.engine3Strategy1QualifiedForEngine6 ===
          true,
        blockers:
          arr(e3?.blockers),
      }
    )
  );

  if (!e3Pass) {
    return {
      ...base,
      sourceCountId:
        micro.sourceCountId ?? null,
      shadowStatus:
        "WAIT_ENGINE3_REACTION",
      firstWaitingStage:
        "engine3",
      hypotheticalPaperTimingReady:
        false,
      productionActivationEligible:
        false,
      stages,
      reasonCodes: [
        "ENGINE3_CANONICAL_REACTION_NOT_QUALIFIED",
        "SHADOW_ONLY",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const e4Direction =
    exactDirection(e4?.direction);

  const e4Pass =
    e4?.participationConfirmed === true &&
    e4?.allowed === true &&
    e4?.hardBlocked !== true &&
    e4Direction != null &&
    e4Direction === e3Direction;

  stages.push(
    stage(
      "engine4",
      e4Pass
        ? "PASS"
        : "WAITING",
      {
        participationState:
          e4?.participationState ?? null,
        direction:
          e4?.direction ?? null,
        participationConfirmed:
          e4?.participationConfirmed === true,
        allowed:
          e4?.allowed === true,
        hardBlocked:
          e4?.hardBlocked === true,
        blockers:
          arr(e4?.blockers),
      }
    )
  );

  if (!e4Pass) {
    return {
      ...base,
      sourceCountId:
        micro.sourceCountId ?? null,
      shadowStatus:
        "WAIT_ENGINE4_PARTICIPATION",
      firstWaitingStage:
        "engine4",
      hypotheticalPaperTimingReady:
        false,
      productionActivationEligible:
        false,
      stages,
      reasonCodes: [
        "ENGINE4_CANONICAL_PARTICIPATION_NOT_CONFIRMED",
        "SHADOW_ONLY",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const e6Direction =
    exactDirection(e6?.direction);

  const e6Pass =
    e6?.allowed === true &&
    e6Direction != null &&
    e6Direction === e3Direction;

  stages.push(
    stage(
      "engine6",
      e6Pass
        ? "PASS"
        : "WAITING",
      {
        decision:
          e6?.decision ?? null,
        direction:
          e6?.direction ?? null,
        allowed:
          e6?.allowed === true,
        blockers:
          arr(e6?.blockers),
      }
    )
  );

  if (!e6Pass) {
    return {
      ...base,
      sourceCountId:
        micro.sourceCountId ?? null,
      shadowStatus:
        "WAIT_ENGINE6_PERMISSION",
      firstWaitingStage:
        "engine6",
      hypotheticalPaperTimingReady:
        false,
      productionActivationEligible:
        false,
      stages,
      reasonCodes: [
        "ENGINE6_PAPER_PERMISSION_NOT_ALLOWED",
        "SHADOW_ONLY",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  const downstreamDirection =
    e6Direction;

  const microDirectionAligned =
    microDirection == null ||
    microDirection ===
      downstreamDirection;

  const candidateDirectionAligned =
    e26Direction == null ||
    e26Direction ===
      downstreamDirection;

  const allCanonicalGatesPass =
    microTimingReady &&
    e26Present &&
    e3Pass &&
    e4Pass &&
    e6Pass &&
    microDirectionAligned &&
    candidateDirectionAligned;

  const hypotheticalPaperTimingReady =
    allCanonicalGatesPass;

  // Producer eligibility is intentionally the final safety gate.
  // During Phase 9A it is false, so this contract can never activate trading.
  const productionActivationEligible =
    hypotheticalPaperTimingReady &&
    producerAutomationEligible === true;

  return {
    ...base,

    sourceCountId:
      micro.sourceCountId ?? null,

    microDirection,
    downstreamDirection,

    microDirectionAligned,
    candidateDirectionAligned,

    hypotheticalPaperTimingReady,

    producerAutomationEligible,

    productionActivationEligible,

    firstWaitingStage:
      productionActivationEligible
        ? null
        : producerAutomationEligible
        ? null
        : "engine22ProducerAuthorization",

    shadowStatus:
      productionActivationEligible
        ? "ACCEPTANCE_GATES_PASS_PRODUCER_AUTHORIZED"
        : hypotheticalPaperTimingReady
        ? "WOULD_BE_PAPER_TIMING_READY_PRODUCER_BLOCKED"
        : "DIRECTION_ALIGNMENT_BLOCKED",

    stages,

    reasonCodes: [
      hypotheticalPaperTimingReady
        ? "ALL_CANONICAL_TIMING_VALIDATION_GATES_PASS"
        : "CANONICAL_DIRECTION_ALIGNMENT_NOT_COMPLETE",
      producerAutomationEligible
        ? "ENGINE22_PRODUCER_AUTOMATION_ELIGIBLE"
        : "ENGINE22_PRODUCER_AUTOMATION_NOT_ELIGIBLE",
      productionActivationEligible
        ? "PRODUCTION_ACTIVATION_ELIGIBLE"
        : "PRODUCTION_ACTIVATION_BLOCKED",
      "SHADOW_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_SIZING",
      "NO_EXECUTION",
    ],
  };
}

export default buildMicroTimingAutomationShadow;
