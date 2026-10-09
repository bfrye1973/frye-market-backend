// Engine 22 Micro Lifecycle V2 — cross-projection count consistency.
//
// This module decorates read-only Engine 22 projections with the same canonical
// Micro count reference and verifies that no projection mixes count identities.
// It does not calculate Elliott structure or mutate the source projections.

import {
  validateCanonicalMicroState,
} from "./canonicalMicroState.js";

import {
  buildMicroExecutionContext,
} from "./buildMicroExecutionContext.js";

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function canonicalRef(state) {
  return {
    sourceCountId: state.countId,
    sequenceId: state.sequenceId,
    canonicalStateVersion:
      state.canonicalStateVersion,
    revision: state.revision,
    sourceTimestamp: state.sourceTimestamp,
  };
}

function decorateProjection(value, ref) {
  if (
    value == null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return value;
  }

  return {
    ...clone(value),

    sourceCountId:
      ref.sourceCountId,

    microCanonicalRef:
      clone(ref),
  };
}

export function buildMicroProjectionBundle({
  canonicalState,
  degreeStates = null,
  currentWavelength = null,
  engine22Display = null,
} = {}) {
  const validation =
    validateCanonicalMicroState(
      canonicalState
    );

  if (!validation.ok) {
    return {
      available: false,
      reasonCodes: [
        "CANONICAL_MICRO_STATE_INVALID",
        ...validation.errors,
      ],
      degreeStates:
        clone(degreeStates),
      currentWavelength:
        clone(currentWavelength),
      microExecutionContext:
        buildMicroExecutionContext({
          canonicalState,
        }),
      engine22Display:
        clone(engine22Display),
    };
  }

  const ref =
    canonicalRef(
      canonicalState
    );

  const microExecutionContext =
    buildMicroExecutionContext({
      canonicalState,
    });

  return {
    available: true,

    sourceCountId:
      ref.sourceCountId,

    canonicalRef:
      clone(ref),

    degreeStates:
      decorateProjection(
        degreeStates,
        ref
      ),

    currentWavelength:
      decorateProjection(
        currentWavelength,
        ref
      ),

    microExecutionContext,

    engine22Display:
      decorateProjection(
        engine22Display,
        ref
      ),

    reasonCodes: [
      "ENGINE22_MICRO_PROJECTIONS_BOUND_TO_CANONICAL_COUNT",
      "PROJECTION_ONLY_NO_STRUCTURAL_OWNERSHIP",
    ],
  };
}

function readProjectionCountId(
  projection
) {
  return (
    projection?.sourceCountId ??
    projection
      ?.microCanonicalRef
      ?.sourceCountId ??
    null
  );
}

export function validateMicroProjectionConsistency({
  canonicalState,
  degreeStates = null,
  currentWavelength = null,
  microExecutionContext = null,
  engine22Display = null,
} = {}) {
  const validation =
    validateCanonicalMicroState(
      canonicalState
    );

  if (!validation.ok) {
    return {
      ok: false,
      reasonCodes: [
        "CANONICAL_MICRO_STATE_INVALID",
        ...validation.errors,
      ],
      mismatches: [],
    };
  }

  const expected =
    canonicalState.countId;

  const projections = {
    degreeStates,
    currentWavelength,
    microExecutionContext,
    engine22Display,
  };

  const mismatches = [];

  for (const [
    name,
    projection,
  ] of Object.entries(projections)) {
    if (projection == null) continue;

    const observed =
      readProjectionCountId(
        projection
      );

    if (observed == null) {
      mismatches.push({
        projection: name,
        expectedCountId: expected,
        observedCountId: null,
        reason:
          "SOURCE_COUNT_ID_MISSING",
      });

      continue;
    }

    if (
      String(observed) !==
      String(expected)
    ) {
      mismatches.push({
        projection: name,
        expectedCountId: expected,
        observedCountId: observed,
        reason:
          "SOURCE_COUNT_ID_MISMATCH",
      });
    }
  }

  return {
    ok:
      mismatches.length === 0,

    sourceCountId:
      expected,

    mismatches,

    reasonCodes:
      mismatches.length === 0
        ? [
            "ENGINE22_MICRO_PROJECTION_COUNT_IDS_MATCH",
          ]
        : [
            "ENGINE22_MICRO_PROJECTION_COUNT_MISMATCH",
            "FAIL_CLOSED",
          ],
  };
}

export default {
  buildMicroProjectionBundle,
  validateMicroProjectionConsistency,
};
