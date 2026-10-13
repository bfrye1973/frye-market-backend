// Engine 22 Micro Lifecycle V2 — legacy-to-V2 production migration bridge.
//
// TEMPORARY MIGRATION ROLE:
// - Reads the existing production Micro sequence.
// - Creates/updates a V2 canonical SHADOW count for comparison.
// - Never drives Engine 26, permission, sizing, execution, management or journal.
// - Never allows a legacy regression to move a V2 locked/confirmed lifecycle backward.
//
// This bridge is intentionally isolated so it can be removed once V2 is fed
// directly from raw intrabar + completed-5m canonical observations.

import {
  createCanonicalMicroState,
  validateCanonicalMicroState,
} from "./canonicalMicroState.js";

const RANK = Object.freeze({
  DEVELOPING: 0,
  COMPLETION_CANDIDATE: 1,
  CONFIRMED: 2,
  LOCKED: 3,
});

function clone(value) {
  return value == null
    ? value
    : JSON.parse(JSON.stringify(value));
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? n
    : null;
}

function upper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function canonicalActiveWave(value) {
  const v = upper(value);
  if (v === "W3_WATCH") return "W3";
  return ["W1","W2","W3","W4","W5"].includes(v)
    ? v
    : "W1";
}

function lifecycle(value) {
  const v = upper(value);
  return Object.hasOwn(RANK, v)
    ? v
    : "DEVELOPING";
}

function safeIdPart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "")
    .slice(0, 40);
}

export function legacyMicroCountIdentity({
  symbol = "ES",
  legacySequence = null,
} = {}) {
  const origin =
    positive(legacySequence?.origin) ??
    positive(legacySequence?.anchorProvenance?.price);

  const timestamp =
    legacySequence?.anchorProvenance?.timestamp ??
    "UNKNOWN_TIME";

  if (origin == null) return null;

  const stem = [
    String(symbol || "ES").toUpperCase(),
    "MICRO",
    safeIdPart(timestamp) || "UNKNOWN",
    String(origin).replace(".", "_"),
  ].join("-");

  return {
    countId: `${stem}-COUNT`,
    sequenceId: `${stem}-SEQUENCE`,
    origin: {
      price: origin,
      timestamp:
        legacySequence?.anchorProvenance?.timestamp ??
        null,
      source:
        legacySequence?.anchorProvenance?.source ??
        "LEGACY_MICRO_MIGRATION",
    },
  };
}

function legacyWaveView(
  legacySequence,
  wave
) {
  if (wave === "W1") {
    const completion =
      legacySequence?.w1Completion || {};

    return {
      lifecycle:
        lifecycle(completion.state),
      candidateAnchor:
        positive(
          legacySequence?.candidateW1High
        ),
      confirmedAnchor:
        positive(
          legacySequence?.confirmedW1High ??
          completion?.anchor
        ),
      lockedAnchor:
        upper(completion.state) === "LOCKED"
          ? positive(
              legacySequence?.confirmedW1High ??
              completion?.anchor
            )
          : null,
      evidence:
        clone(completion?.evidence),
      reasonCodes:
        Array.isArray(completion?.reasonCodes)
          ? [...completion.reasonCodes]
          : [],
    };
  }

  if (wave === "W2") {
    const completion =
      legacySequence?.w2Completion || {};

    return {
      lifecycle:
        lifecycle(completion.state),
      candidateAnchor:
        positive(
          legacySequence?.w2CandidateLow ??
          legacySequence?.confirmedW2Low
        ),
      confirmedAnchor:
        positive(
          legacySequence?.confirmedW2Low ??
          completion?.anchor
        ),
      lockedAnchor:
        upper(completion.state) === "LOCKED"
          ? positive(
              legacySequence?.confirmedW2Low ??
              completion?.anchor
            )
          : null,
      evidence:
        clone(completion?.evidence),
      reasonCodes:
        Array.isArray(completion?.reasonCodes)
          ? [...completion.reasonCodes]
          : [],
    };
  }

  return {
    lifecycle: "DEVELOPING",
    candidateAnchor: null,
    confirmedAnchor: null,
    lockedAnchor: null,
    evidence: null,
    reasonCodes: [],
  };
}

function legacyFibState(
  legacySequence,
  activeWave
) {
  const levels =
    activeWave === "W1"
      ? legacySequence?.projectedW1
      : activeWave === "W2"
      ? legacySequence?.projectedW2
      : [];

  if (!Array.isArray(levels) || levels.length === 0) {
    return null;
  }

  const normalized = levels
    .map((entry) => ({
      key:
        entry?.key ?? null,
      label:
        entry?.label ?? null,
      price:
        positive(entry?.price),
      status:
        upper(entry?.status || "WATCH"),
    }))
    .filter((entry) => entry.price != null);

  if (normalized.length === 0) return null;

  const touched =
    normalized.filter(
      (entry) =>
        entry.status === "TOUCHED" ||
        entry.status === "CONFIRMED"
    );

  return {
    source:
      "LEGACY_MICRO_MIGRATION_SHADOW",
    observationType:
      "LEGACY_PROJECTION_MIRROR",
    lastObservationTimestamp:
      null,
    rawHigh: null,
    rawLow: null,
    levels: normalized,
    lastTouchedFib:
      touched.at(-1) ?? null,
    nextFib:
      normalized.find(
        (entry) =>
          entry.status !== "TOUCHED" &&
          entry.status !== "CONFIRMED"
      ) ?? null,
  };
}

export function buildCanonicalMicroMigrationShadow({
  symbol = "ES",
  legacySequence = null,
  existingCanonicalState = null,
  currentPrice = null,
  sourceTimestamp = null,
  parentDegree = "SUBMINUTE",
  parentWave = null,
  parentDirection = null,
} = {}) {
  if (!legacySequence || typeof legacySequence !== "object") {
    return {
      available: false,
      canonicalState: null,
      comparison: null,
      reasonCodes: [
        "LEGACY_MICRO_SEQUENCE_REQUIRED",
      ],
    };
  }

  const identity =
    legacyMicroCountIdentity({
      symbol,
      legacySequence,
    });

  if (!identity) {
    return {
      available: false,
      canonicalState: null,
      comparison: null,
      reasonCodes: [
        "LEGACY_MICRO_ORIGIN_REQUIRED",
      ],
    };
  }

  let state = null;

  const existingValidation =
    validateCanonicalMicroState(
      existingCanonicalState
    );

  if (
    existingValidation.ok &&
    existingCanonicalState.countId === identity.countId
  ) {
    state = clone(existingCanonicalState);
  } else {
    state =
      createCanonicalMicroState({
        countId:
          identity.countId,
        sequenceId:
          identity.sequenceId,
        sequenceDirection:
          "UP",
        origin:
          identity.origin,
        parentDegree,
        parentWave,
        parentDirection,
        sourceTimestamp,
        createdAt:
          sourceTimestamp,
      });

    state.migration = {
      mode:
        "SHADOW_LEGACY_MIRROR",
      source:
        "engine22.currentWavelength.v1",
      automationEligible:
        false,
    };
  }

  const legacyActive =
    canonicalActiveWave(
      legacySequence.activeWave
    );

  for (const wave of ["W1","W2","W3","W4","W5"]) {
    const legacy =
      legacyWaveView(
        legacySequence,
        wave
      );

    const current =
      state.waves[wave];

    const incomingRank =
      RANK[legacy.lifecycle] ?? 0;

    const currentRank =
      RANK[current.lifecycle] ?? 0;

    if (incomingRank >= currentRank) {
      current.lifecycle =
        legacy.lifecycle;

      current.candidateAnchor =
        legacy.candidateAnchor ??
        current.candidateAnchor;

      current.confirmedAnchor =
        legacy.confirmedAnchor ??
        current.confirmedAnchor;

      if (legacy.lifecycle === "LOCKED") {
        current.lockedAnchor =
          legacy.lockedAnchor ??
          current.lockedAnchor;
      }

      if (legacy.evidence) {
        current.structuralEvidence =
          clone(legacy.evidence);
      }

      current.reasonCodes = [
        ...new Set([
          ...(current.reasonCodes || []),
          ...legacy.reasonCodes,
          "LEGACY_MICRO_MIGRATION_SHADOW",
        ]),
      ];
    }
  }

  // Never allow legacy state to move the canonical shadow backward.
  const activeOrder = ["W1","W2","W3","W4","W5"];
  const currentIndex =
    activeOrder.indexOf(state.activeWave);

  const legacyIndex =
    activeOrder.indexOf(legacyActive);

  if (legacyIndex > currentIndex) {
    state.activeWave =
      legacyActive;
  }

  const active =
    state.waves[state.activeWave];

  const fib =
    legacyFibState(
      legacySequence,
      state.activeWave
    );

  if (fib) {
    active.fibState =
      fib;
  }

  const price =
    positive(currentPrice);

  if (price != null) {
    state.currentPrice =
      price;
  }

  if (sourceTimestamp != null) {
    state.sourceTimestamp =
      sourceTimestamp;

    state.updatedAt =
      sourceTimestamp;

    state.freshness = {
      status:
        "SHADOW_MIGRATION_CURRENT_BUILD",
      sourceTimestamp,
    };
  }

  state.migration = {
    ...(state.migration || {}),
    mode:
      "SHADOW_LEGACY_MIRROR",
    source:
      "engine22.currentWavelength.v1",
    automationEligible:
      false,
    legacyActiveWave:
      legacySequence.activeWave ??
      null,
    canonicalActiveWave:
      state.activeWave,
  };

  const legacyLifecycle =
    legacyActive === "W1"
      ? lifecycle(
          legacySequence?.w1Completion?.state
        )
      : legacyActive === "W2"
      ? lifecycle(
          legacySequence?.w2Completion?.state
        )
      : "DEVELOPING";

  const canonicalLifecycle =
    state.waves[state.activeWave]?.lifecycle ??
    null;

  const comparison = {
    sourceCountId:
      state.countId,
    legacyActiveWave:
      legacyActive,
    canonicalActiveWave:
      state.activeWave,
    activeWaveMatches:
      legacyActive === state.activeWave,
    legacyLifecycle,
    canonicalLifecycle,
    lifecycleMatches:
      legacyLifecycle === canonicalLifecycle,
    automationEligible:
      false,
    status:
      legacyActive === state.activeWave &&
      legacyLifecycle === canonicalLifecycle
        ? "MATCH"
        : "SHADOW_MISMATCH",
  };

  return {
    available: true,
    canonicalState:
      state,
    comparison,
    reasonCodes: [
      "MICRO_V2_PRODUCTION_MIGRATION_SHADOW",
      "LEGACY_OUTPUT_REMAINS_PRODUCTION_AUTHORITY",
      "ENGINE26_NOT_AUTHORIZED",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default {
  legacyMicroCountIdentity,
  buildCanonicalMicroMigrationShadow,
};
