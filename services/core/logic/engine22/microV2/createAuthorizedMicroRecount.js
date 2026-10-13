// Engine 22 Micro Lifecycle V2 — authorized recount/new-count creation.
//
// Pure count-boundary logic.
// No market fetches, no permission, sizing, execution, management, or journal writes.

import {
  createCanonicalMicroState,
  validateCanonicalMicroState,
} from "./canonicalMicroState.js";

export const MICRO_RECOUNT_REASONS = Object.freeze([
  "COMPLETED_CLOSE_INVALIDATION",
  "PARENT_DEGREE_INVALIDATION",
  "MICRO_W5_PARENT_HANDOFF",
  "DETERMINISTIC_RECOUNT_RULE",
  "MANAGER_AUTHORIZED_RECOUNT",
  "CORRUPT_OR_MISSING_STATE_RECOVERY",
]);

const REASON_SET = new Set(MICRO_RECOUNT_REASONS);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeAuthorization(value) {
  return value && typeof value === "object"
    ? value
    : {};
}

export function createAuthorizedMicroRecount({
  currentState,
  newCountId,
  newSequenceId,
  newOrigin,
  newSequenceDirection = null,
  parentDegree = null,
  parentWave = null,
  parentDirection = null,
  sourceTimestamp = null,
  authorization = null,
} = {}) {
  const validation = validateCanonicalMicroState(currentState);

  if (!validation.ok) {
    return {
      ok: false,
      reasonCodes: [
        "INVALID_CANONICAL_MICRO_STATE",
        ...validation.errors,
      ],
      previousCount: clone(currentState),
      newCount: null,
      recountRecord: null,
    };
  }

  const auth = normalizeAuthorization(authorization);
  const reasonCode = clean(auth.reasonCode).toUpperCase();

  if (auth.authorized !== true) {
    return {
      ok: false,
      reasonCodes: ["MICRO_RECOUNT_NOT_AUTHORIZED"],
      previousCount: clone(currentState),
      newCount: null,
      recountRecord: null,
    };
  }

  if (!REASON_SET.has(reasonCode)) {
    return {
      ok: false,
      reasonCodes: ["INVALID_MICRO_RECOUNT_REASON"],
      previousCount: clone(currentState),
      newCount: null,
      recountRecord: null,
    };
  }

  const allowedStatuses = new Set([
    "RECOUNT_REQUIRED",
    "INVALIDATED",
    "COMPLETE_PENDING_PARENT_HANDOFF",
  ]);

  if (
    reasonCode !== "MANAGER_AUTHORIZED_RECOUNT" &&
    reasonCode !== "CORRUPT_OR_MISSING_STATE_RECOVERY" &&
    !allowedStatuses.has(currentState.countStatus)
  ) {
    return {
      ok: false,
      reasonCodes: ["MICRO_RECOUNT_STATE_NOT_ELIGIBLE"],
      previousCount: clone(currentState),
      newCount: null,
      recountRecord: null,
    };
  }

  const nextCountId = clean(newCountId);
  const nextSequenceId = clean(newSequenceId);

  if (!nextCountId || nextCountId === currentState.countId) {
    return {
      ok: false,
      reasonCodes: ["NEW_MICRO_COUNT_ID_REQUIRED"],
      previousCount: clone(currentState),
      newCount: null,
      recountRecord: null,
    };
  }

  if (!nextSequenceId) {
    return {
      ok: false,
      reasonCodes: ["NEW_MICRO_SEQUENCE_ID_REQUIRED"],
      previousCount: clone(currentState),
      newCount: null,
      recountRecord: null,
    };
  }

  const timestamp =
    sourceTimestamp ??
    auth.sourceTimestamp ??
    null;

  let newCount;

  try {
    newCount = createCanonicalMicroState({
      countId: nextCountId,
      sequenceId: nextSequenceId,
      sequenceDirection:
        newSequenceDirection ??
        currentState.sequenceDirection,
      origin: newOrigin,
      parentDegree:
        parentDegree ??
        currentState.parentContext?.degree ??
        null,
      parentWave:
        parentWave ??
        currentState.parentContext?.wave ??
        null,
      parentDirection:
        parentDirection ??
        currentState.parentContext?.direction ??
        null,
      sourceTimestamp: timestamp,
      createdAt: timestamp,
    });
  } catch (error) {
    return {
      ok: false,
      reasonCodes: [
        "NEW_MICRO_COUNT_CREATION_FAILED",
        String(error?.message || error),
      ],
      previousCount: clone(currentState),
      newCount: null,
      recountRecord: null,
    };
  }

  const previousCount = clone(currentState);

  previousCount.countStatus = "HISTORICAL";
  previousCount.closedAt = timestamp;
  previousCount.supersededByCountId = nextCountId;
  previousCount.updatedAt = timestamp;

  const recountRecord = {
    eventType: "AUTHORIZED_MICRO_RECOUNT",
    oldCountId: currentState.countId,
    newCountId: nextCountId,
    oldSequenceId: currentState.sequenceId,
    newSequenceId: nextSequenceId,
    sourceTimestamp: timestamp,
    reasonCode,
    authorizationType:
      clean(auth.type).toUpperCase() || "UNSPECIFIED",
    authorizedBy:
      clean(auth.authorizedBy) || null,
    provenance:
      auth.provenance ?? null,
    oldCountStatus: currentState.countStatus,
    oldActiveWave: currentState.activeWave,
    newOrigin: clone(newCount.origin),
    reasonCodes: [
      "AUTHORIZED_MICRO_RECOUNT",
      reasonCode,
      "OLD_COUNT_MOVED_TO_HISTORY",
      "NEW_COUNT_STARTED_CLEAN",
    ],
  };

  const nextRevision = 1;

  newCount.revision = nextRevision;
  newCount.history = [
    {
      revision: nextRevision,
      countId: nextCountId,
      sequenceId: nextSequenceId,
      eventType: "COUNT_CREATED_FROM_AUTHORIZED_RECOUNT",
      wave: "W1",
      stateBefore: null,
      stateAfter: "DEVELOPING",
      anchor: newCount.origin.price,
      sourceTimestamp: timestamp,
      evidence: null,
      reasonCodes: [
        "COUNT_CREATED_FROM_AUTHORIZED_RECOUNT",
        reasonCode,
      ],
      authorizedCorrectionProvenance:
        recountRecord,
    },
  ];

  return {
    ok: true,
    reasonCodes: [
      "AUTHORIZED_MICRO_RECOUNT_CREATED",
      reasonCode,
    ],
    previousCount,
    newCount,
    recountRecord,
  };
}

export default {
  MICRO_RECOUNT_REASONS,
  createAuthorizedMicroRecount,
};
