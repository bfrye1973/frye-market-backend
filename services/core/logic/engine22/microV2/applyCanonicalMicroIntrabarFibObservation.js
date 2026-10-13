// Engine 22 Micro Lifecycle V2 — raw intrabar Fib-touch observation.
//
// This module may update Fib location/touch context only.
// It MUST NOT advance wave lifecycle, lock anchors, invalidate/recount,
// create permission, size, manage, execute, or journal anything.

import {
  validateCanonicalMicroState,
} from "./canonicalMicroState.js";

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

function normalizeLevels(levels) {
  return Array.isArray(levels)
    ? levels
        .map((level) => {
          const price =
            positiveNumber(level?.price);

          if (price == null) return null;

          return {
            key:
              String(level?.key || "").trim() || null,
            label:
              String(level?.label || "").trim() || null,
            price,
            status:
              String(level?.status || "WATCH")
                .trim()
                .toUpperCase(),
          };
        })
        .filter(Boolean)
    : [];
}

function levelTouched({
  direction,
  high,
  low,
  price,
} = {}) {
  if (direction === "UP") {
    return high != null && high >= price;
  }

  if (direction === "DOWN") {
    return low != null && low <= price;
  }

  return false;
}

export function applyCanonicalMicroIntrabarFibObservation(
  inputState,
  {
    sourceTimestamp = null,
    rawHigh = null,
    rawLow = null,
    levels = [],
    source = "RAW_INTRABAR_ES",
  } = {}
) {
  const validation =
    validateCanonicalMicroState(
      inputState
    );

  if (!validation.ok) {
    return {
      state: clone(inputState),
      applied: false,
      reasonCodes: [
        "INVALID_CANONICAL_MICRO_STATE",
        ...validation.errors,
      ],
    };
  }

  const next =
    clone(inputState);

  if (next.countStatus !== "ACTIVE") {
    return {
      state: next,
      applied: false,
      reasonCodes: [
        "MICRO_COUNT_NOT_ACTIVE",
      ],
    };
  }

  const wave =
    next.activeWave;

  const record =
    next.waves?.[wave];

  if (!record) {
    return {
      state: next,
      applied: false,
      reasonCodes: [
        "ACTIVE_MICRO_WAVE_RECORD_MISSING",
      ],
    };
  }

  const observationMs =
    toMs(sourceTimestamp);

  if (observationMs == null) {
    return {
      state: next,
      applied: false,
      reasonCodes: [
        "INTRABAR_SOURCE_TIMESTAMP_REQUIRED",
      ],
    };
  }

  const previousMs =
    toMs(
      record?.fibState
        ?.lastObservationTimestamp
    );

  if (
    previousMs != null &&
    observationMs <= previousMs
  ) {
    return {
      state: next,
      applied: false,
      reasonCodes: [
        observationMs === previousMs
          ? "DUPLICATE_INTRABAR_OBSERVATION"
          : "OUT_OF_ORDER_INTRABAR_OBSERVATION",
      ],
    };
  }

  const high =
    positiveNumber(rawHigh);

  const low =
    positiveNumber(rawLow);

  if (high == null && low == null) {
    return {
      state: next,
      applied: false,
      reasonCodes: [
        "RAW_INTRABAR_HIGH_OR_LOW_REQUIRED",
      ],
    };
  }

  if (
    high != null &&
    low != null &&
    high < low
  ) {
    return {
      state: next,
      applied: false,
      reasonCodes: [
        "INVALID_INTRABAR_RANGE",
      ],
    };
  }

  const normalizedLevels =
    normalizeLevels(levels);

  if (normalizedLevels.length === 0) {
    return {
      state: next,
      applied: false,
      reasonCodes: [
        "MICRO_FIB_LEVELS_REQUIRED",
      ],
    };
  }

  const previousStatuses =
    new Map(
      (record?.fibState?.levels || [])
        .map((level) => [
          String(level?.key || level?.label || ""),
          String(level?.status || "WATCH")
            .trim()
            .toUpperCase(),
        ])
    );

  const nextLevels =
    normalizedLevels.map((level) => {
      const identity =
        String(
          level.key ||
          level.label ||
          ""
        );

      const wasTouched =
        previousStatuses.get(identity) ===
        "TOUCHED";

      const touchedNow =
        levelTouched({
          direction:
            record.direction,
          high,
          low,
          price:
            level.price,
        });

      return {
        ...level,
        status:
          wasTouched || touchedNow
            ? "TOUCHED"
            : "WATCH",
      };
    });

  const touchedLevels =
    nextLevels.filter(
      (level) =>
        level.status ===
        "TOUCHED"
    );

  const lastTouchedFib =
    touchedLevels.length > 0
      ? touchedLevels[
          touchedLevels.length - 1
        ]
      : null;

  const nextFib =
    nextLevels.find(
      (level) =>
        level.status !==
        "TOUCHED"
    ) || null;

  const lifecycleBefore =
    record.lifecycle;

  record.fibState = {
    source:
      String(source || "RAW_INTRABAR_ES"),
    observationType:
      "RAW_INTRABAR",
    lastObservationTimestamp:
      sourceTimestamp,
    rawHigh:
      high,
    rawLow:
      low,
    levels:
      nextLevels,
    lastTouchedFib:
      lastTouchedFib
        ? clone(lastTouchedFib)
        : null,
    nextFib:
      nextFib
        ? clone(nextFib)
        : null,
  };

  const nextRevision =
    Number(next.revision || 0) + 1;

  next.revision =
    nextRevision;

  next.sourceTimestamp =
    sourceTimestamp;

  next.updatedAt =
    sourceTimestamp;

  next.history = [
    ...(Array.isArray(next.history)
      ? next.history
      : []),
    {
      revision:
        nextRevision,
      countId:
        next.countId,
      sequenceId:
        next.sequenceId,
      eventType:
        "INTRABAR_FIB_OBSERVATION",
      wave,
      stateBefore:
        lifecycleBefore,
      stateAfter:
        lifecycleBefore,
      anchor: null,
      sourceTimestamp,
      evidence: {
        observationType:
          "RAW_INTRABAR",
        rawHigh:
          high,
        rawLow:
          low,
        source:
          String(source || "RAW_INTRABAR_ES"),
      },
      reasonCodes: [
        "MICRO_FIB_TOUCH_CONTEXT_UPDATED",
        "FIB_TOUCH_DOES_NOT_ADVANCE_LIFECYCLE",
      ],
      authorizedCorrectionProvenance:
        null,
    },
  ];

  return {
    state: next,
    applied: true,
    reasonCodes: [
      "MICRO_FIB_TOUCH_CONTEXT_UPDATED",
      "FIB_TOUCH_DOES_NOT_ADVANCE_LIFECYCLE",
    ],
  };
}

export default {
  applyCanonicalMicroIntrabarFibObservation,
};
