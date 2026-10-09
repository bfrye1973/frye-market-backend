// Engine 22 Micro Lifecycle V2 — deterministic W1-W5 reducer.
//
// Pure state transition logic.
// No market fetches, no permission, no sizing, no execution, no journal writes.

import {
  MICRO_WAVES,
  validateCanonicalMicroState,
} from "./canonicalMicroState.js";

const WAVE_SET = new Set(MICRO_WAVES);

const NEXT_WAVE = Object.freeze({
  W1: "W2",
  W2: "W3",
  W3: "W4",
  W4: "W5",
  W5: null,
});

const VALID_EVENT_TYPES = new Set([
  "UPDATE_DEVELOPING_ANCHOR",
  "MARK_COMPLETION_CANDIDATE",
  "CONFIRM_COMPLETION",
  "LOCK_WAVE",
  "MARK_INVALIDATED",
  "MARK_RECOUNT_REQUIRED",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0
    ? n
    : null;
}

function toMs(value) {
  if (value == null || value === "") return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1e12
      ? numeric * 1000
      : numeric;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function normalizedReasonCodes(value) {
  return Array.isArray(value)
    ? [...new Set(
        value
          .map((code) =>
            String(code || "")
              .trim()
              .toUpperCase()
          )
          .filter(Boolean)
      )]
    : [];
}

function hasReason(codes, reason) {
  return codes.includes(reason);
}

function isCompletedFiveMinuteEvidence(evidence) {
  return (
    evidence &&
    evidence.timeframe === "5m" &&
    evidence.closed === true &&
    toMs(evidence.sourceTimestamp) != null
  );
}

function requiresRetracementReaction(wave) {
  return wave === "W2" || wave === "W4";
}

function validateCandidateEvidence(wave, evidence) {
  if (!isCompletedFiveMinuteEvidence(evidence)) {
    return {
      ok: false,
      reason:
        "COMPLETED_FIVE_MIN_EVIDENCE_REQUIRED",
    };
  }

  const codes =
    normalizedReasonCodes(
      evidence.reasonCodes
    );

  const base =
    hasReason(
      codes,
      "ANCHOR_REJECTION"
    ) &&
    hasReason(
      codes,
      "FIVE_MIN_SWING_BREAK"
    );

  const retracementOk =
    !requiresRetracementReaction(wave) ||
    hasReason(
      codes,
      "RETRACEMENT_REACTION"
    );

  return {
    ok:
      base &&
      retracementOk,
    reason:
      !base
        ? "COMPLETION_CANDIDATE_EVIDENCE_INCOMPLETE"
        : !retracementOk
        ? "RETRACEMENT_REACTION_REQUIRED"
        : null,
  };
}

function validateConfirmationEvidence(evidence) {
  if (!isCompletedFiveMinuteEvidence(evidence)) {
    return {
      ok: false,
      reason:
        "COMPLETED_FIVE_MIN_EVIDENCE_REQUIRED",
    };
  }

  const codes =
    normalizedReasonCodes(
      evidence.reasonCodes
    );

  const twoClose =
    hasReason(
      codes,
      "TWO_CLOSE_CONFIRMATION"
    );

  const swingPlusDisplacement =
    hasReason(
      codes,
      "FIVE_MIN_SWING_BREAK"
    ) &&
    hasReason(
      codes,
      "FIVE_MIN_DISPLACEMENT"
    );

  return {
    ok:
      twoClose ||
      swingPlusDisplacement,
    reason:
      twoClose ||
      swingPlusDisplacement
        ? null
        : "CONFIRMATION_EVIDENCE_INCOMPLETE",
  };
}

function staleOrDuplicate({
  waveRecord,
  evidence,
} = {}) {
  const incoming =
    toMs(
      evidence?.sourceTimestamp
    );

  const previous =
    toMs(
      waveRecord
        ?.lastEvidenceTimestamp
    );

  if (incoming == null) {
    return {
      stale: true,
      reason:
        "EVIDENCE_TIMESTAMP_REQUIRED",
    };
  }

  if (
    previous != null &&
    incoming <= previous
  ) {
    return {
      stale: true,
      reason:
        incoming === previous
          ? "DUPLICATE_COMPLETED_FIVE_MIN_OBSERVATION"
          : "OUT_OF_ORDER_COMPLETED_FIVE_MIN_OBSERVATION",
    };
  }

  return {
    stale: false,
    reason: null,
  };
}

function transitionResult({
  state,
  applied,
  reasonCodes,
} = {}) {
  return {
    state,
    applied:
      applied === true,
    reasonCodes:
      normalizedReasonCodes(
        reasonCodes
      ),
  };
}

function appendTransition({
  next,
  event,
  wave,
  stateBefore,
  stateAfter,
  anchor = null,
  evidence = null,
  reasonCodes = [],
} = {}) {
  const nextRevision =
    Number(next.revision || 0) + 1;

  const timestamp =
    evidence?.sourceTimestamp ??
    event?.sourceTimestamp ??
    next.sourceTimestamp ??
    null;

  const record = {
    revision:
      nextRevision,

    countId:
      next.countId,

    sequenceId:
      next.sequenceId,

    eventType:
      event.type,

    wave,

    stateBefore,
    stateAfter,

    anchor:
      positiveNumber(anchor),

    sourceTimestamp:
      timestamp,

    evidence:
      evidence
        ? clone(evidence)
        : null,

    reasonCodes:
      normalizedReasonCodes(
        reasonCodes
      ),

    authorizedCorrectionProvenance:
      event
        ?.authorizedCorrectionProvenance ??
      null,
  };

  next.revision =
    nextRevision;

  next.updatedAt =
    timestamp;

  next.sourceTimestamp =
    timestamp;

  next.history = [
    ...(Array.isArray(next.history)
      ? next.history
      : []),
    record,
  ];

  return record;
}

export function reduceCanonicalMicroState(
  inputState,
  event = {}
) {
  const validation =
    validateCanonicalMicroState(
      inputState
    );

  if (!validation.ok) {
    return transitionResult({
      state:
        clone(inputState),
      applied: false,
      reasonCodes: [
        "INVALID_CANONICAL_MICRO_STATE",
        ...validation.errors,
      ],
    });
  }

  const type =
    String(event?.type || "")
      .trim()
      .toUpperCase();

  if (!VALID_EVENT_TYPES.has(type)) {
    return transitionResult({
      state:
        clone(inputState),
      applied: false,
      reasonCodes: [
        "INVALID_MICRO_EVENT_TYPE",
      ],
    });
  }

  const next =
    clone(inputState);

  const wave =
    String(
      event?.wave ||
      next.activeWave ||
      ""
    )
      .trim()
      .toUpperCase();

  if (!WAVE_SET.has(wave)) {
    return transitionResult({
      state: next,
      applied: false,
      reasonCodes: [
        "INVALID_MICRO_WAVE",
      ],
    });
  }

  if (
    type !==
      "MARK_INVALIDATED" &&
    type !==
      "MARK_RECOUNT_REQUIRED" &&
    wave !== next.activeWave
  ) {
    return transitionResult({
      state: next,
      applied: false,
      reasonCodes: [
        "NON_ACTIVE_MICRO_WAVE_TRANSITION_FORBIDDEN",
      ],
    });
  }

  if (
    next.countStatus !==
      "ACTIVE" &&
    type !==
      "MARK_RECOUNT_REQUIRED"
  ) {
    return transitionResult({
      state: next,
      applied: false,
      reasonCodes: [
        "MICRO_COUNT_NOT_ACTIVE",
      ],
    });
  }

  const record =
    next.waves[wave];

  if (
    type ===
    "UPDATE_DEVELOPING_ANCHOR"
  ) {
    if (
      record.lifecycle !==
      "DEVELOPING"
    ) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "DEVELOPING_ANCHOR_UPDATE_NOT_ALLOWED_AFTER_CANDIDATE",
        ],
      });
    }

    const anchor =
      positiveNumber(
        event.anchor
      );

    if (anchor == null) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "DEVELOPING_ANCHOR_REQUIRED",
        ],
      });
    }

    const oldAnchor =
      positiveNumber(
        record.developingAnchor
      );

    const improves =
      oldAnchor == null ||
      (
        record.direction === "UP" &&
        anchor > oldAnchor
      ) ||
      (
        record.direction === "DOWN" &&
        anchor < oldAnchor
      );

    if (!improves) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "DEVELOPING_ANCHOR_DID_NOT_EXTEND_WAVE",
        ],
      });
    }

    const before =
      record.lifecycle;

    record.developingAnchor =
      anchor;

    if (!record.startedAt) {
      record.startedAt =
        event.sourceTimestamp ??
        null;
    }

    appendTransition({
      next,
      event: {
        ...event,
        type,
      },
      wave,
      stateBefore:
        before,
      stateAfter:
        before,
      anchor,
      reasonCodes: [
        "MICRO_DEVELOPING_ANCHOR_UPDATED",
      ],
    });

    return transitionResult({
      state: next,
      applied: true,
      reasonCodes: [
        "MICRO_DEVELOPING_ANCHOR_UPDATED",
      ],
    });
  }

  if (
    type ===
    "MARK_COMPLETION_CANDIDATE"
  ) {
    if (
      record.lifecycle !==
      "DEVELOPING"
    ) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "INVALID_CANDIDATE_STATE_TRANSITION",
        ],
      });
    }

    const anchor =
      positiveNumber(
        event.anchor ??
        record.developingAnchor
      );

    if (anchor == null) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "COMPLETION_CANDIDATE_ANCHOR_REQUIRED",
        ],
      });
    }

    const evidence =
      event.evidence || null;

    const evidenceCheck =
      validateCandidateEvidence(
        wave,
        evidence
      );

    if (!evidenceCheck.ok) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          evidenceCheck.reason,
        ],
      });
    }

    const freshness =
      staleOrDuplicate({
        waveRecord:
          record,
        evidence,
      });

    if (freshness.stale) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          freshness.reason,
        ],
      });
    }

    const before =
      record.lifecycle;

    record.lifecycle =
      "COMPLETION_CANDIDATE";

    record.candidateAnchor =
      anchor;

    record.candidateAt =
      evidence.sourceTimestamp;

    record.lastEvidenceTimestamp =
      evidence.sourceTimestamp;

    record.completionEvidence =
      clone(evidence);

    record.reasonCodes =
      normalizedReasonCodes(
        evidence.reasonCodes
      );

    appendTransition({
      next,
      event: {
        ...event,
        type,
      },
      wave,
      stateBefore:
        before,
      stateAfter:
        record.lifecycle,
      anchor,
      evidence,
      reasonCodes:
        evidence.reasonCodes,
    });

    return transitionResult({
      state: next,
      applied: true,
      reasonCodes: [
        "MICRO_COMPLETION_CANDIDATE_ACCEPTED",
      ],
    });
  }

  if (
    type ===
    "CONFIRM_COMPLETION"
  ) {
    if (
      record.lifecycle !==
      "COMPLETION_CANDIDATE"
    ) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "CONFIRMATION_REQUIRES_COMPLETION_CANDIDATE",
        ],
      });
    }

    const evidence =
      event.evidence || null;

    const evidenceCheck =
      validateConfirmationEvidence(
        evidence
      );

    if (!evidenceCheck.ok) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          evidenceCheck.reason,
        ],
      });
    }

    const freshness =
      staleOrDuplicate({
        waveRecord:
          record,
        evidence,
      });

    if (freshness.stale) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          freshness.reason,
        ],
      });
    }

    const anchor =
      positiveNumber(
        event.anchor ??
        record.candidateAnchor
      );

    if (anchor == null) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "CONFIRMED_ANCHOR_REQUIRED",
        ],
      });
    }

    const before =
      record.lifecycle;

    record.lifecycle =
      "CONFIRMED";

    record.confirmedAnchor =
      anchor;

    record.confirmedAt =
      evidence.sourceTimestamp;

    record.lastEvidenceTimestamp =
      evidence.sourceTimestamp;

    record.structuralEvidence =
      clone(evidence);

    record.reasonCodes =
      normalizedReasonCodes([
        ...record.reasonCodes,
        ...normalizedReasonCodes(
          evidence.reasonCodes
        ),
      ]);

    appendTransition({
      next,
      event: {
        ...event,
        type,
      },
      wave,
      stateBefore:
        before,
      stateAfter:
        record.lifecycle,
      anchor,
      evidence,
      reasonCodes:
        evidence.reasonCodes,
    });

    return transitionResult({
      state: next,
      applied: true,
      reasonCodes: [
        "MICRO_WAVE_COMPLETION_CONFIRMED",
      ],
    });
  }

  if (
    type ===
    "LOCK_WAVE"
  ) {
    if (
      record.lifecycle !==
      "CONFIRMED"
    ) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "LOCK_REQUIRES_CONFIRMED_WAVE",
        ],
      });
    }

    if (
      event.countId != null &&
      String(event.countId) !==
        String(next.countId)
    ) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "MICRO_COUNT_ID_MISMATCH",
        ],
      });
    }

    if (
      event.nextWaveContextCreated !==
        true
    ) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "NEXT_WAVE_CONTEXT_REQUIRED_BEFORE_LOCK",
        ],
      });
    }

    if (
      next.invalidationState !==
        "CLEAR"
    ) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "MICRO_INVALIDATION_PREVENTS_LOCK",
        ],
      });
    }

    const anchor =
      positiveNumber(
        record.confirmedAnchor
      );

    if (anchor == null) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "CONFIRMED_ANCHOR_REQUIRED",
        ],
      });
    }

    const before =
      record.lifecycle;

    record.lifecycle =
      "LOCKED";

    record.lockedAnchor =
      anchor;

    record.lockedAt =
      event.sourceTimestamp ??
      record.confirmedAt ??
      null;

    const nextWave =
      NEXT_WAVE[wave];

    if (nextWave) {
      next.activeWave =
        nextWave;

      if (
        !next.waves[nextWave].startedAt
      ) {
        next.waves[nextWave].startedAt =
          event.sourceTimestamp ??
          record.lockedAt ??
          null;
      }
    } else {
      next.countStatus =
        "COMPLETE_PENDING_PARENT_HANDOFF";
    }

    appendTransition({
      next,
      event: {
        ...event,
        type,
      },
      wave,
      stateBefore:
        before,
      stateAfter:
        record.lifecycle,
      anchor,
      reasonCodes: [
        "MICRO_WAVE_LOCKED",
        nextWave
          ? `MICRO_${nextWave}_ACTIVATED`
          : "MICRO_SEQUENCE_COMPLETED",
      ],
    });

    return transitionResult({
      state: next,
      applied: true,
      reasonCodes: [
        "MICRO_WAVE_LOCKED",
        nextWave
          ? `MICRO_${nextWave}_ACTIVATED`
          : "MICRO_SEQUENCE_COMPLETED",
      ],
    });
  }

  if (
    type ===
    "MARK_INVALIDATED"
  ) {
    if (
      next.countStatus !==
      "ACTIVE"
    ) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "MICRO_COUNT_NOT_ACTIVE",
        ],
      });
    }

    const before =
      record.lifecycle;

    next.countStatus =
      "INVALIDATED";

    next.invalidationState =
      "INVALIDATED";

    next.invalidation = {
      price:
        positiveNumber(
          event.price
        ),
      sourceTimestamp:
        event.sourceTimestamp ??
        null,
      reasonCodes:
        normalizedReasonCodes(
          event.reasonCodes
        ),
    };

    appendTransition({
      next,
      event: {
        ...event,
        type,
      },
      wave,
      stateBefore:
        before,
      stateAfter:
        before,
      reasonCodes: [
        "MICRO_COUNT_INVALIDATED",
        ...normalizedReasonCodes(
          event.reasonCodes
        ),
      ],
    });

    return transitionResult({
      state: next,
      applied: true,
      reasonCodes: [
        "MICRO_COUNT_INVALIDATED",
      ],
    });
  }

  if (
    type ===
    "MARK_RECOUNT_REQUIRED"
  ) {
    if (
      next.countStatus ===
      "HISTORICAL"
    ) {
      return transitionResult({
        state: next,
        applied: false,
        reasonCodes: [
          "HISTORICAL_COUNT_CANNOT_RECOUNT",
        ],
      });
    }

    next.countStatus =
      "RECOUNT_REQUIRED";

    next.invalidationState =
      next.invalidationState ===
        "INVALIDATED"
        ? "INVALIDATED"
        : "RECOUNT_REQUIRED";

    appendTransition({
      next,
      event: {
        ...event,
        type,
      },
      wave,
      stateBefore:
        record.lifecycle,
      stateAfter:
        record.lifecycle,
      reasonCodes: [
        "MICRO_RECOUNT_REQUIRED",
        ...normalizedReasonCodes(
          event.reasonCodes
        ),
      ],
    });

    return transitionResult({
      state: next,
      applied: true,
      reasonCodes: [
        "MICRO_RECOUNT_REQUIRED",
      ],
    });
  }

  return transitionResult({
    state: next,
    applied: false,
    reasonCodes: [
      "UNHANDLED_MICRO_EVENT",
    ],
  });
}

export default {
  reduceCanonicalMicroState,
};
