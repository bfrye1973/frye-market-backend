// Engine 22 Micro Lifecycle V2 — canonical state schema foundation.
//
// This module defines the single canonical durable Micro count shape.
// It does not read market data, decide wave transitions, create permission,
// size trades, execute orders, or write journal state.

export const ENGINE22_MICRO_CANONICAL_SCHEMA =
  "engine22.microCanonicalState.v2";

export const MICRO_DEGREE = "MICRO";

export const MICRO_WAVES = Object.freeze([
  "W1",
  "W2",
  "W3",
  "W4",
  "W5",
]);

export const MICRO_LIFECYCLE_STATES = Object.freeze([
  "DEVELOPING",
  "COMPLETION_CANDIDATE",
  "CONFIRMED",
  "LOCKED",
]);

export const MICRO_COUNT_STATUSES = Object.freeze([
  "ACTIVE",
  "COMPLETE_PENDING_PARENT_HANDOFF",
  "INVALIDATED",
  "RECOUNT_REQUIRED",
  "HISTORICAL",
]);

export const MICRO_TIMING_STATES = Object.freeze([
  "OBSERVE",
  "SETUP_DEVELOPING",
  "REVERSAL_WINDOW",
  "TRANSITION_CONFIRMING",
  "TIMING_READY",
  "INVALIDATED",
  "RECOUNT_REQUIRED",
]);

const LIFECYCLE_SET = new Set(MICRO_LIFECYCLE_STATES);
const COUNT_STATUS_SET = new Set(MICRO_COUNT_STATUSES);
const WAVE_SET = new Set(MICRO_WAVES);

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? n
    : null;
}

function normalizeDirection(value) {
  const direction =
    String(value || "")
      .trim()
      .toUpperCase();

  return direction === "UP" ||
    direction === "DOWN"
    ? direction
    : null;
}

function oppositeDirection(direction) {
  return direction === "UP"
    ? "DOWN"
    : direction === "DOWN"
    ? "UP"
    : null;
}

export function expectedMicroWaveDirection(
  wave,
  sequenceDirection
) {
  const direction =
    normalizeDirection(
      sequenceDirection
    );

  if (!WAVE_SET.has(wave) || !direction) {
    return null;
  }

  return wave === "W1" ||
    wave === "W3" ||
    wave === "W5"
    ? direction
    : oppositeDirection(direction);
}

export function createEmptyMicroWaveRecord({
  wave,
  sequenceDirection,
} = {}) {
  if (!WAVE_SET.has(wave)) {
    throw new TypeError(
      "INVALID_MICRO_WAVE"
    );
  }

  const direction =
    expectedMicroWaveDirection(
      wave,
      sequenceDirection
    );

  if (!direction) {
    throw new TypeError(
      "INVALID_MICRO_SEQUENCE_DIRECTION"
    );
  }

  return {
    wave,
    direction,
    lifecycle: "DEVELOPING",

    developingAnchor: null,
    candidateAnchor: null,
    confirmedAnchor: null,
    lockedAnchor: null,

    startedAt: null,
    candidateAt: null,
    confirmedAt: null,
    lockedAt: null,

    lastEvidenceTimestamp: null,

    completionEvidence: null,
    structuralEvidence: null,

    fibState: null,

    invalidation: null,
    invalidationState: "CLEAR",

    reasonCodes: [],
  };
}

export function createCanonicalMicroState({
  countId,
  sequenceId,
  sequenceDirection,
  origin,
  parentDegree = null,
  parentWave = null,
  parentDirection = null,
  sourceTimestamp = null,
  createdAt = null,
} = {}) {
  const cleanCountId =
    String(countId || "").trim();

  const cleanSequenceId =
    String(sequenceId || "").trim();

  const direction =
    normalizeDirection(
      sequenceDirection
    );

  const originPrice =
    positiveNumber(
      origin?.price ?? origin
    );

  if (!cleanCountId) {
    throw new TypeError(
      "MICRO_COUNT_ID_REQUIRED"
    );
  }

  if (!cleanSequenceId) {
    throw new TypeError(
      "MICRO_SEQUENCE_ID_REQUIRED"
    );
  }

  if (!direction) {
    throw new TypeError(
      "MICRO_SEQUENCE_DIRECTION_REQUIRED"
    );
  }

  if (originPrice == null) {
    throw new TypeError(
      "MICRO_ORIGIN_PRICE_REQUIRED"
    );
  }

  const parentDir =
    parentDirection == null
      ? null
      : normalizeDirection(
          parentDirection
        );

  if (
    parentDirection != null &&
    !parentDir
  ) {
    throw new TypeError(
      "INVALID_MICRO_PARENT_DIRECTION"
    );
  }

  const waves =
    Object.fromEntries(
      MICRO_WAVES.map(
        (wave) => [
          wave,
          createEmptyMicroWaveRecord({
            wave,
            sequenceDirection:
              direction,
          }),
        ]
      )
    );

  return {
    schema:
      ENGINE22_MICRO_CANONICAL_SCHEMA,

    canonicalStateVersion: 2,

    countId:
      cleanCountId,

    sequenceId:
      cleanSequenceId,

    revision: 0,

    degree:
      MICRO_DEGREE,

    sequenceDirection:
      direction,

    countStatus:
      "ACTIVE",

    activeWave:
      "W1",

    origin: {
      price:
        originPrice,
      timestamp:
        origin?.timestamp ??
        null,
      source:
        origin?.source ??
        null,
    },

    parentContext: {
      degree:
        parentDegree,
      wave:
        parentWave,
      direction:
        parentDir,
    },

    waves,

    currentPrice: null,

    invalidation: null,
    invalidationState: "CLEAR",

    sourceTimestamp:
      sourceTimestamp ??
      null,

    freshness: {
      status: "UNKNOWN",
      sourceTimestamp:
        sourceTimestamp ??
        null,
    },

    history: [],

    createdAt:
      createdAt ??
      sourceTimestamp ??
      null,

    updatedAt:
      createdAt ??
      sourceTimestamp ??
      null,

    noPermissionCreated: true,
    noExecution: true,
    noSizing: true,
    noManagement: true,
    noJournalMutation: true,
  };
}

export function validateCanonicalMicroState(
  state
) {
  const errors = [];

  if (!isObject(state)) {
    return {
      ok: false,
      errors: [
        "MICRO_CANONICAL_STATE_REQUIRED",
      ],
    };
  }

  if (
    state.schema !==
    ENGINE22_MICRO_CANONICAL_SCHEMA
  ) {
    errors.push(
      "MICRO_CANONICAL_SCHEMA_MISMATCH"
    );
  }

  if (
    !String(
      state.countId || ""
    ).trim()
  ) {
    errors.push(
      "MICRO_COUNT_ID_REQUIRED"
    );
  }

  if (
    !String(
      state.sequenceId || ""
    ).trim()
  ) {
    errors.push(
      "MICRO_SEQUENCE_ID_REQUIRED"
    );
  }

  const direction =
    normalizeDirection(
      state.sequenceDirection
    );

  if (!direction) {
    errors.push(
      "INVALID_MICRO_SEQUENCE_DIRECTION"
    );
  }

  if (
    !COUNT_STATUS_SET.has(
      state.countStatus
    )
  ) {
    errors.push(
      "INVALID_MICRO_COUNT_STATUS"
    );
  }

  if (
    !WAVE_SET.has(
      state.activeWave
    )
  ) {
    errors.push(
      "INVALID_MICRO_ACTIVE_WAVE"
    );
  }

  if (
    positiveNumber(
      state?.origin?.price
    ) == null
  ) {
    errors.push(
      "INVALID_MICRO_ORIGIN"
    );
  }

  for (const wave of MICRO_WAVES) {
    const record =
      state?.waves?.[wave];

    if (!isObject(record)) {
      errors.push(
        `MISSING_${wave}_RECORD`
      );
      continue;
    }

    if (
      !LIFECYCLE_SET.has(
        record.lifecycle
      )
    ) {
      errors.push(
        `INVALID_${wave}_LIFECYCLE`
      );
    }

    const expectedDirection =
      expectedMicroWaveDirection(
        wave,
        direction
      );

    if (
      expectedDirection &&
      record.direction !==
        expectedDirection
    ) {
      errors.push(
        `INVALID_${wave}_DIRECTION`
      );
    }

    if (
      record.lifecycle === "LOCKED" &&
      positiveNumber(
        record.lockedAnchor
      ) == null
    ) {
      errors.push(
        `LOCKED_${wave}_ANCHOR_REQUIRED`
      );
    }
  }

  if (
    !Array.isArray(
      state.history
    )
  ) {
    errors.push(
      "MICRO_HISTORY_MUST_BE_ARRAY"
    );
  }

  for (const key of [
    "noPermissionCreated",
    "noExecution",
    "noSizing",
    "noManagement",
    "noJournalMutation",
  ]) {
    if (state[key] !== true) {
      errors.push(
        `MICRO_AUTHORITY_GUARD_${key.toUpperCase()}`
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export default {
  ENGINE22_MICRO_CANONICAL_SCHEMA,
  MICRO_DEGREE,
  MICRO_WAVES,
  MICRO_LIFECYCLE_STATES,
  MICRO_COUNT_STATUSES,
  MICRO_TIMING_STATES,
  expectedMicroWaveDirection,
  createEmptyMicroWaveRecord,
  createCanonicalMicroState,
  validateCanonicalMicroState,
};
