// Engine 22 Micro Lifecycle V2 — machine-facing execution/timing projection.
//
// IMPORTANT:
// This contract DOES NOT own Elliott structure.
// It projects the canonical durable Micro count for downstream automation.
// No permission, sizing, execution, management, or journal authority.

import {
  validateCanonicalMicroState,
} from "./canonicalMicroState.js";

export const ENGINE22_MICRO_EXECUTION_CONTEXT_SCHEMA =
  "engine22.microExecutionContext.v1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function latestLockedWave(state) {
  const waves = ["W5", "W4", "W3", "W2", "W1"];

  for (const wave of waves) {
    const record = state?.waves?.[wave];

    if (
      record?.lifecycle === "LOCKED" &&
      Number.isFinite(
        Number(record?.lockedAnchor)
      )
    ) {
      return {
        wave,
        anchor: Number(record.lockedAnchor),
        direction: record.direction,
        lockedAt: record.lockedAt ?? null,
      };
    }
  }

  return null;
}

function timingStateFromCanonical(state) {
  if (state.countStatus === "INVALIDATED") {
    return "INVALIDATED";
  }

  if (state.countStatus === "RECOUNT_REQUIRED") {
    return "RECOUNT_REQUIRED";
  }

  const active =
    state?.waves?.[state.activeWave];

  const lastHistory =
    Array.isArray(state.history)
      ? state.history.at(-1)
      : null;

  if (
    lastHistory?.eventType === "LOCK_WAVE"
  ) {
    return "TIMING_READY";
  }

  if (!active) {
    return "OBSERVE";
  }

  if (
    active.lifecycle ===
    "COMPLETION_CANDIDATE"
  ) {
    return "REVERSAL_WINDOW";
  }

  if (
    active.lifecycle === "CONFIRMED"
  ) {
    return "TRANSITION_CONFIRMING";
  }

  if (
    active.lifecycle === "DEVELOPING"
  ) {
    return active.developingAnchor != null
      ? "SETUP_DEVELOPING"
      : "OBSERVE";
  }

  if (
    active.lifecycle === "LOCKED"
  ) {
    return "TIMING_READY";
  }

  return "OBSERVE";
}

export function buildMicroExecutionContext({
  canonicalState,
} = {}) {
  const validation =
    validateCanonicalMicroState(
      canonicalState
    );

  if (!validation.ok) {
    return {
      schema:
        ENGINE22_MICRO_EXECUTION_CONTEXT_SCHEMA,
      available: false,
      reasonCodes: [
        "CANONICAL_MICRO_STATE_INVALID",
        ...validation.errors,
      ],
      noPermissionCreated: true,
      noExecution: true,
      noSizing: true,
      noManagement: true,
      noJournalMutation: true,
    };
  }

  const state =
    clone(canonicalState);

  const active =
    state.waves[state.activeWave];

  const locked =
    latestLockedWave(state);

  const fibState =
    active?.fibState
      ? clone(active.fibState)
      : null;

  return {
    schema:
      ENGINE22_MICRO_EXECUTION_CONTEXT_SCHEMA,

    available: true,

    sourceCountId:
      state.countId,

    sequenceId:
      state.sequenceId,

    canonicalStateVersion:
      state.canonicalStateVersion,

    revision:
      state.revision,

    sourceTimestamp:
      state.sourceTimestamp,

    degree:
      "MICRO",

    parentDegree:
      state.parentContext?.degree ??
      null,

    parentWave:
      state.parentContext?.wave ??
      null,

    parentDirection:
      state.parentContext?.direction ??
      null,

    activeWave:
      state.activeWave,

    waveDirection:
      active?.direction ??
      null,

    lifecycle:
      active?.lifecycle ??
      null,

    microTimingState:
      timingStateFromCanonical(state),

    countStatus:
      state.countStatus,

    origin:
      clone(state.origin),

    lockedWaveAnchor:
      locked
        ? {
            wave:
              locked.wave,
            price:
              locked.anchor,
            direction:
              locked.direction,
            lockedAt:
              locked.lockedAt,
          }
        : null,

    developingAnchor:
      active?.developingAnchor ??
      null,

    candidateAnchor:
      active?.candidateAnchor ??
      null,

    confirmedAnchor:
      active?.confirmedAnchor ??
      null,

    currentPrice:
      state.currentPrice ??
      null,

    fibState,

    lastTouchedFib:
      fibState?.lastTouchedFib ??
      null,

    nextFib:
      fibState?.nextFib ??
      null,

    retracementDepth:
      fibState?.retracementDepth ??
      null,

    invalidation:
      clone(state.invalidation),

    invalidationState:
      state.invalidationState,

    freshness:
      clone(state.freshness),

    fiveMinuteEvidence:
      active?.completionEvidence
        ? clone(active.completionEvidence)
        : null,

    structuralEvidence:
      active?.structuralEvidence
        ? clone(active.structuralEvidence)
        : null,

    reasonCodes: [
      "MICRO_EXECUTION_CONTEXT_PROJECTED_FROM_CANONICAL_STATE",
      "TIMING_CONTEXT_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
      "NO_SIZING",
    ],

    noPermissionCreated: true,
    noExecution: true,
    noSizing: true,
    noManagement: true,
    noJournalMutation: true,
  };
}

export default {
  ENGINE22_MICRO_EXECUTION_CONTEXT_SCHEMA,
  buildMicroExecutionContext,
};
