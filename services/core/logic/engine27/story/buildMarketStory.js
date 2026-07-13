// services/core/logic/engine27/story/buildMarketStory.js
// Engine 27D — Market Story
//
// Canonical inputs:
// - engine27WaveIntelligence
// - engine27FibIntelligence
// - engine27Alignment
//
// Engine 27D explains the current market structure.
// It does not create decisions, permissions, geometry,
// alerts, tickets, execution, or dashboard output.

const ENGINE_NAME =
  "engine27.marketStory.v1";

const DEGREE_ORDER = [
  "primary",
  "intermediate",
  "minor",
  "minute",
  "subminute",
];

const FIB_TIE_BREAK_ORDER = [
  "subminute",
  "minute",
  "minor",
  "intermediate",
  "primary",
];

const DEGREE_LABELS = {
  primary: "Primary",
  intermediate: "Intermediate",
  minor: "Minor",
  minute: "Minute",
  subminute: "Subminute",
};

const BULLISH_ALIGNMENT_STATES =
  new Set([
    "STRONG_BULLISH_ALIGNMENT",
    "BULLISH_ALIGNMENT",
    "MIXED_BULLISH",
  ]);

const BEARISH_ALIGNMENT_STATES =
  new Set([
    "STRONG_BEARISH_ALIGNMENT",
    "BEARISH_ALIGNMENT",
    "MIXED_BEARISH",
  ]);

const MIXED_ALIGNMENT_STATES =
  new Set([
    "BALANCED",
    "CONFLICTED",
    "INSUFFICIENT_DATA",
  ]);

const WARNING_PRIORITY = [
  "SUBMINUTE_STRUCTURE_INVALIDATED",
  "LOWER_DEGREES_REVERSING",
  "MULTI_DEGREE_LATE_STAGE_WARNING",
  "LOWER_DEGREES_WEAKENING",
  "SUBMINUTE_INTERNAL_PULLBACK",
  "PRIMARY_W5_MATURITY_WARNING",
  "ALIGNMENT_CURRENT_PRICE_MISMATCH",
  "HIGHER_DEGREES_STILL_SUPPORTIVE",
  "MINUTE_PULLBACK_AGAINST_HIGHER_TREND",
];

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function upper(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function lower(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function unique(values) {
  return [
    ...new Set(
      values.filter(Boolean)
    ),
  ];
}

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function formatDegreeName(degree) {
  return (
    DEGREE_LABELS[degree] ||
    String(degree || "")
  );
}

function formatPrice(value) {
  const number =
    toNumber(value);

  if (number === null) {
    return null;
  }

  return number.toFixed(2);
}

function formatConfidence(value) {
  const confidence =
    upper(value);

  return confidence
    ? confidence.replaceAll(
        "_",
        " "
      )
    : "UNKNOWN";
}

function normalizeDirection(value) {
  const direction =
    upper(value);

  if (
    [
      "LONG",
      "UP",
      "BULLISH",
      "BULL",
      "BUY",
    ].includes(direction)
  ) {
    return "LONG";
  }

  if (
    [
      "SHORT",
      "DOWN",
      "BEARISH",
      "BEAR",
      "SELL",
    ].includes(direction)
  ) {
    return "SHORT";
  }

  return "NEUTRAL";
}

function normalizeWave(value) {
  const wave =
    upper(value);

  return [
    "W1",
    "W2",
    "W3",
    "W4",
    "W5",
    "A",
    "B",
    "C",
    "D",
    "E",
  ].includes(wave)
    ? wave
    : "UNKNOWN";
}

function normalizeInternalWave(value) {
  const wave =
    lower(value);

  return [
    "i",
    "ii",
    "iii",
    "iv",
    "v",
    "a",
    "b",
    "c",
    "d",
    "e",
  ].includes(wave)
    ? wave
    : "unknown";
}

function normalizeWarningCode(value) {
  const text =
    upper(value);

  if (!text) {
    return null;
  }

  if (
    text.includes(
      "SUBMINUTE_STRUCTURE_INVALIDATED"
    )
  ) {
    return "SUBMINUTE_STRUCTURE_INVALIDATED";
  }

  if (
    text.includes(
      "LOWER_DEGREES_REVERSING"
    )
  ) {
    return "LOWER_DEGREES_REVERSING";
  }

  if (
    text.includes(
      "MULTI_DEGREE_LATE_STAGE_WARNING"
    )
  ) {
    return "MULTI_DEGREE_LATE_STAGE_WARNING";
  }

  if (
    text.includes(
      "LOWER_DEGREES_WEAKENING"
    )
  ) {
    return "LOWER_DEGREES_WEAKENING";
  }

  if (
    text.includes(
      "SUBMINUTE_INTERNAL_PULLBACK"
    ) ||
    text.includes(
      "SUBMINUTE_PULLBACK_AGAINST_HIGHER_TREND"
    )
  ) {
    return "SUBMINUTE_INTERNAL_PULLBACK";
  }

  if (
    text.includes(
      "PRIMARY_W5_MATURITY_WARNING"
    )
  ) {
    return "PRIMARY_W5_MATURITY_WARNING";
  }

  if (
    text.includes(
      "ALIGNMENT_CURRENT_PRICE_MISMATCH"
    )
  ) {
    return "ALIGNMENT_CURRENT_PRICE_MISMATCH";
  }

  if (
    text.includes(
      "HIGHER_DEGREES_STILL_SUPPORTIVE"
    )
  ) {
    return "HIGHER_DEGREES_STILL_SUPPORTIVE";
  }

  if (
    text.includes(
      "MINUTE_PULLBACK_AGAINST_HIGHER_TREND"
    )
  ) {
    return "MINUTE_PULLBACK_AGAINST_HIGHER_TREND";
  }

  return null;
}

function safeUnavailableStory() {
  return {
    active: false,

    engine:
      ENGINE_NAME,

    mode:
      "READ_ONLY",

    headline:
      "Market Story Unavailable",

    summary:
      "Market story unavailable.",

    marketStructure:
      "Market structure is unavailable.",

    waveSummary:
      "Wave intelligence is unavailable.",

    fibSummary:
      "Fibonacci intelligence is unavailable.",

    alignmentSummary:
      "Alignment intelligence is unavailable.",

    warningSummary:
      "Structural warnings are unavailable.",

    outlook:
      "No structural outlook is available.",

    reasonCodes: [
      "ENGINE27_STORY_INPUT_UNAVAILABLE",
    ],
  };
}

function isUsableWaveRecord(record) {
  if (!isObject(record)) {
    return false;
  }

  const currentWave =
    normalizeWave(
      record.currentWave
    );

  const direction =
    normalizeDirection(
      record.preferredTradeDirection
    );

  return (
    currentWave !== "UNKNOWN" ||
    [
      "LONG",
      "SHORT",
    ].includes(direction)
  );
}

function getUsableWaveEntries(
  waveIntelligence
) {
  return DEGREE_ORDER
    .map((degree) => ({
      degree,

      record:
        waveIntelligence[
          degree
        ],
    }))
    .filter(({ record }) =>
      isUsableWaveRecord(
        record
      )
    );
}

function classifyStoryDirection(
  alignment,
  waveEntries
) {
  const alignmentDirection =
    normalizeDirection(
      alignment.direction
    );

  const alignmentState =
    upper(
      alignment.alignmentState
    );

  if (
    alignmentDirection ===
      "LONG" &&
    BULLISH_ALIGNMENT_STATES.has(
      alignmentState
    )
  ) {
    return "BULLISH";
  }

  if (
    alignmentDirection ===
      "SHORT" &&
    BEARISH_ALIGNMENT_STATES.has(
      alignmentState
    )
  ) {
    return "BEARISH";
  }

  if (
    alignmentDirection ===
      "NEUTRAL" ||
    MIXED_ALIGNMENT_STATES.has(
      alignmentState
    )
  ) {
    return "MIXED";
  }

  const counts =
    waveEntries.reduce(
      (
        result,
        { record }
      ) => {
        const direction =
          normalizeDirection(
            record
              ?.preferredTradeDirection
          );

        if (
          direction === "LONG"
        ) {
          result.long += 1;
        } else if (
          direction === "SHORT"
        ) {
          result.short += 1;
        } else {
          result.neutral += 1;
        }

        return result;
      },
      {
        long: 0,
        short: 0,
        neutral: 0,
      }
    );

  if (
    counts.long >
    counts.short
  ) {
    return "BULLISH";
  }

  if (
    counts.short >
    counts.long
  ) {
    return "BEARISH";
  }

  return "MIXED";
}

function readSubminutePullbackContext({
  waveIntelligence,
  alignment,
}) {
  const subminute =
    waveIntelligence
      ?.subminute;

  if (!isObject(subminute)) {
    return {
      state: "NONE",
      active: false,
    };
  }

  const currentWave =
    normalizeWave(
      subminute.currentWave
    );

  const internalWave =
    normalizeInternalWave(
      subminute.internalWave
    );

  const previousInternalWave =
    normalizeInternalWave(
      subminute.previousInternalWave
    );

  const nextExpectedInternalWave =
    normalizeInternalWave(
      subminute
        .nextExpectedInternalWave
    );

  const currentLegDirection =
    normalizeDirection(
      subminute
        .currentLegDirection
    );

  const preferredTradeDirection =
    normalizeDirection(
      subminute
        .preferredTradeDirection
    );

  const pullbackClassification =
    upper(
      subminute
        .pullbackClassification
    );

  const parentWaveStillValid =
    subminute
      .parentWaveStillValid ===
    true;

  const parentWaveComplete =
    subminute
      .parentWaveComplete ===
    true;

  const parentTransitionPossible =
    subminute
      .parentTransitionPossible ===
    true;

  const invalidationBreached =
    subminute
      .invalidationBreached ===
    true;

  const invalidationLevel =
    toNumber(
      subminute
        .invalidationLevel
    );

  const supportLevel =
    toNumber(
      subminute
        .supportLevel
    );

  const transitionRisk =
    upper(
      subminute
        .transitionRisk
    ) || "UNKNOWN";

  const compatibilityStatus =
    upper(
      alignment
        ?.waveStageCompatibility
        ?.minuteToSubminute
        ?.status
    );

  const alignmentWarnings = [
    ...(
      Array.isArray(
        alignment
          ?.lowerDegreeWarnings
      )
        ? alignment
            .lowerDegreeWarnings
        : []
    ),

    ...(
      Array.isArray(
        alignment
          ?.reasonCodes
      )
        ? alignment
            .reasonCodes
        : []
    ),
  ];

  const hasAlignmentPullbackWarning =
    alignmentWarnings.some(
      (warning) =>
        normalizeWarningCode(
          warning
        ) ===
        "SUBMINUTE_INTERNAL_PULLBACK"
    );

  const engine27AReportsPullback =
    currentWave === "W3" &&
    internalWave === "iv" &&
    currentLegDirection ===
      "SHORT" &&
    preferredTradeDirection ===
      "LONG" &&
    pullbackClassification ===
      "INTERNAL_PULLBACK";

  const engine27CConfirmsRelationship =
    compatibilityStatus ===
      "PULLS_BACK_INSIDE_PARENT" ||
    hasAlignmentPullbackWarning;

  if (
    invalidationBreached
  ) {
    return {
      state:
        "INVALIDATED",

      active:
        false,

      currentWave,

      internalWave,

      previousInternalWave,

      nextExpectedInternalWave,

      currentLegDirection,

      preferredTradeDirection,

      parentWaveStillValid,

      parentWaveComplete,

      parentTransitionPossible,

      transitionRisk,

      invalidationLevel,

      invalidationBreached,

      supportLevel,

      compatibilityStatus,

      engine27CConfirmsRelationship,
    };
  }

  if (
    parentWaveComplete
  ) {
    return {
      state:
        "PARENT_COMPLETE",

      active:
        false,

      currentWave,

      internalWave,

      previousInternalWave,

      nextExpectedInternalWave,

      currentLegDirection,

      preferredTradeDirection,

      parentWaveStillValid,

      parentWaveComplete,

      parentTransitionPossible,

      transitionRisk,

      invalidationLevel,

      invalidationBreached,

      supportLevel,

      compatibilityStatus,

      engine27CConfirmsRelationship,
    };
  }

  if (
    parentTransitionPossible
  ) {
    return {
      state:
        "PARENT_TRANSITION_POSSIBLE",

      active:
        engine27AReportsPullback,

      currentWave,

      internalWave,

      previousInternalWave,

      nextExpectedInternalWave,

      currentLegDirection,

      preferredTradeDirection,

      parentWaveStillValid,

      parentWaveComplete,

      parentTransitionPossible,

      transitionRisk,

      invalidationLevel,

      invalidationBreached,

      supportLevel,

      compatibilityStatus,

      engine27CConfirmsRelationship,
    };
  }

  if (
    engine27AReportsPullback &&
    parentWaveStillValid
  ) {
    return {
      state:
        "ACTIVE_INTERNAL_PULLBACK",

      active:
        true,

      currentWave,

      internalWave,

      previousInternalWave,

      nextExpectedInternalWave,

      currentLegDirection,

      preferredTradeDirection,

      parentWaveStillValid,

      parentWaveComplete,

      parentTransitionPossible,

      transitionRisk,

      invalidationLevel,

      invalidationBreached,

      supportLevel,

      compatibilityStatus,

      engine27CConfirmsRelationship,
    };
  }

  return {
    state:
      "NONE",

    active:
      false,

    currentWave,

    internalWave,

    previousInternalWave,

    nextExpectedInternalWave,

    currentLegDirection,

    preferredTradeDirection,

    parentWaveStillValid,

    parentWaveComplete,

    parentTransitionPossible,

    transitionRisk,

    invalidationLevel,

    invalidationBreached,

    supportLevel,

    compatibilityStatus,

    engine27CConfirmsRelationship,
  };
}

function buildHeadline({
  classification,
  alignment,
  warnings,
  pullbackContext,
}) {
  const alignedCount =
    Array.isArray(
      alignment.alignedDegrees
    )
      ? alignment
          .alignedDegrees
          .length
      : toNumber(
          alignment
            ?.counts
            ?.usable
        );

  if (
    pullbackContext.state ===
    "INVALIDATED"
  ) {
    return (
      "Subminute Internal Continuation Structure Invalidated"
    );
  }

  if (
    pullbackContext.state ===
      "ACTIVE_INTERNAL_PULLBACK" ||
    pullbackContext.state ===
      "PARENT_TRANSITION_POSSIBLE"
  ) {
    return (
      "Subminute Internal Pullback Inside a Bullishly Aligned Structure"
    );
  }

  if (
    warnings.includes(
      "LOWER_DEGREES_REVERSING"
    )
  ) {
    return (
      "Lower Degrees Reversing Against the Higher-Timeframe Structure"
    );
  }

  if (
    warnings.includes(
      "LOWER_DEGREES_WEAKENING"
    )
  ) {
    return (
      "Lower Degrees Weakening Inside the Broader Structure"
    );
  }

  if (
    classification ===
      "BULLISH" &&
    alignedCount === 5
  ) {
    return (
      "Five Degrees Remain Bullishly Aligned"
    );
  }

  if (
    classification ===
      "BEARISH" &&
    alignedCount === 5
  ) {
    return (
      "Five Degrees Remain Bearishly Aligned"
    );
  }

  if (
    classification ===
    "BULLISH"
  ) {
    return (
      "Market Structure Remains Bullishly Aligned"
    );
  }

  if (
    classification ===
    "BEARISH"
  ) {
    return (
      "Market Structure Remains Bearishly Aligned"
    );
  }

  return (
    "Market Structure Remains Mixed"
  );
}

function buildMarketStructure({
  classification,
  waveEntries,
  alignment,
}) {
  const totalUsable =
    waveEntries.length;

  const counts =
    alignment?.counts;

  const longCount =
    toNumber(
      counts?.long
    ) ??
    waveEntries.filter(
      ({ record }) =>
        normalizeDirection(
          record
            ?.preferredTradeDirection
        ) === "LONG"
    ).length;

  const shortCount =
    toNumber(
      counts?.short
    ) ??
    waveEntries.filter(
      ({ record }) =>
        normalizeDirection(
          record
            ?.preferredTradeDirection
        ) === "SHORT"
    ).length;

  if (
    classification ===
      "BULLISH" &&
    totalUsable === 5 &&
    longCount === 5
  ) {
    return (
      "All five Elliott Wave degrees remain structurally aligned to the upside."
    );
  }

  if (
    classification ===
      "BEARISH" &&
    totalUsable === 5 &&
    shortCount === 5
  ) {
    return (
      "All five Elliott Wave degrees remain structurally aligned to the downside."
    );
  }

  if (
    classification ===
    "BULLISH"
  ) {
    return `${longCount} of ${totalUsable} usable Elliott Wave degrees remain structurally bullish.`;
  }

  if (
    classification ===
    "BEARISH"
  ) {
    return `${shortCount} of ${totalUsable} usable Elliott Wave degrees remain structurally bearish.`;
  }

  return (
    "The Elliott Wave structure is currently mixed across the available degrees."
  );
}

function groupDegreesByWave(
  waveEntries
) {
  const groups =
    new Map();

  for (
    const {
      degree,
      record,
    }
    of waveEntries
  ) {
    const wave =
      normalizeWave(
        record?.currentWave
      );

    if (
      wave === "UNKNOWN"
    ) {
      continue;
    }

    if (
      !groups.has(wave)
    ) {
      groups.set(
        wave,
        []
      );
    }

    groups
      .get(wave)
      .push(
        formatDegreeName(
          degree
        )
      );
  }

  return groups;
}

function joinDegreeNames(names) {
  if (
    names.length === 1
  ) {
    return names[0];
  }

  if (
    names.length === 2
  ) {
    return `${names[0]} and ${names[1]}`;
  }

  return `${names
    .slice(0, -1)
    .join(", ")}, and ${
    names[
      names.length - 1
    ]
  }`;
}

function buildStandardWaveSummary(
  waveEntries
) {
  const groups =
    groupDegreesByWave(
      waveEntries
    );

  if (
    groups.size === 0
  ) {
    return (
      "No usable current-wave summary is available."
    );
  }

  const clauses = [];

  for (
    const [
      wave,
      degrees,
    ]
    of groups
  ) {
    clauses.push(
      `${joinDegreeNames(
        degrees
      )} ${
        degrees.length === 1
          ? "remains"
          : "remain"
      } in ${wave}`
    );
  }

  if (
    clauses.length === 1
  ) {
    return `${clauses[0]}.`;
  }

  if (
    clauses.length === 2
  ) {
    return `${clauses[0]} while ${clauses[1]}.`;
  }

  return `${clauses
    .slice(0, -1)
    .join(", ")}, while ${
    clauses[
      clauses.length - 1
    ]
  }.`;
}

function buildNestedPullbackWaveSummary({
  waveEntries,
  pullbackContext,
}) {
  const higherEntries =
    waveEntries.filter(
      ({ degree }) =>
        degree !==
        "subminute"
    );

  const higherSummary =
    buildStandardWaveSummary(
      higherEntries
    );

  const supportText =
    pullbackContext
      .supportLevel !== null
      ? `support at ${formatPrice(
          pullbackContext
            .supportLevel
        )}`
      : "support";

  const invalidationText =
    pullbackContext
      .invalidationLevel !==
      null
      ? ` without breaching ${formatPrice(
          pullbackContext
            .invalidationLevel
        )}`
      : "";

  if (
    pullbackContext.state ===
    "INVALIDATED"
  ) {
    const levelText =
      pullbackContext
        .invalidationLevel !==
        null
        ? ` after ${formatPrice(
            pullbackContext
              .invalidationLevel
          )} was breached`
        : "";

    return `${higherSummary} The Subminute W3 internal-continuation structure has been invalidated${levelText}; Engine 22 must establish the next wave structure.`;
  }

  if (
    pullbackContext.state ===
    "PARENT_COMPLETE"
  ) {
    return `${higherSummary} Subminute W3 has completed according to the upstream structure, so internal wave v is no longer presented as the active continuation case.`;
  }

  if (
    pullbackContext.state ===
    "PARENT_TRANSITION_POSSIBLE"
  ) {
    return `${higherSummary} Subminute remains in W3 while internal wave iv pulls back with the current leg moving down; a transition toward a full Subminute W4 is possible, but it is not yet confirmed.`;
  }

  return `${higherSummary} Subminute remains in W3 while an internal wave iv pullback develops with the current leg moving down; internal wave v remains possible if ${supportText} holds and the pullback completes${invalidationText}, while a full Subminute W4 is not confirmed.`;
}

function buildWaveSummary({
  waveEntries,
  pullbackContext,
}) {
  if (
    [
      "ACTIVE_INTERNAL_PULLBACK",
      "PARENT_TRANSITION_POSSIBLE",
      "PARENT_COMPLETE",
      "INVALIDATED",
    ].includes(
      pullbackContext.state
    )
  ) {
    return (
      buildNestedPullbackWaveSummary({
        waveEntries,
        pullbackContext,
      })
    );
  }

  return (
    buildStandardWaveSummary(
      waveEntries
    )
  );
}

function buildActiveFibObjectives({
  fibIntelligence,
  waveIntelligence,
}) {
  const tieOrder =
    new Map(
      FIB_TIE_BREAK_ORDER.map(
        (
          degree,
          index
        ) => [
          degree,
          index,
        ]
      )
    );

  return FIB_TIE_BREAK_ORDER
    .map((degree) => {
      const fib =
        fibIntelligence[
          degree
        ];

      const wave =
        waveIntelligence[
          degree
        ];

      if (
        !isObject(fib) ||
        !isObject(wave)
      ) {
        return null;
      }

      const nextFib =
        upper(
          fib.nextFib
        );

      const nextPrice =
        toNumber(
          fib.nextPrice
        );

      const distance =
        toNumber(
          fib.distance
        );

      const direction =
        normalizeDirection(
          wave
            .preferredTradeDirection
        );

      if (
        !nextFib ||
        [
          "UNKNOWN",
          "COMPLETE",
        ].includes(nextFib) ||
        nextPrice === null ||
        distance === null ||
        distance < 0 ||
        ![
          "LONG",
          "SHORT",
        ].includes(direction)
      ) {
        return null;
      }

      return {
        degree,

        wave:
          normalizeWave(
            fib.currentWave ??
            wave.currentWave
          ),

        nextFib:
          String(
            fib.nextFib
          ).trim(),

        nextPrice,

        distance,

        direction,
      };
    })
    .filter(Boolean)
    .sort(
      (
        left,
        right
      ) => {
        if (
          left.distance !==
          right.distance
        ) {
          return (
            left.distance -
            right.distance
          );
        }

        return (
          tieOrder.get(
            left.degree
          ) -
          tieOrder.get(
            right.degree
          )
        );
      }
    );
}

function describeFibObjective(
  objective
) {
  const degree =
    formatDegreeName(
      objective.degree
    );

  const wave =
    objective.wave !==
    "UNKNOWN"
      ? `${objective.wave} `
      : "";

  return `${degree} ${wave}${objective.nextFib} at ${formatPrice(
    objective.nextPrice
  )}`;
}

function buildFibSummary({
  objectives,
  pullbackContext,
}) {
  if (
    objectives.length === 0
  ) {
    return (
      "No active Fibonacci objective is currently available."
    );
  }

  const selected =
    objectives.slice(
      0,
      2
    );

  const descriptions =
    selected.map(
      describeFibObjective
    );

  const pullbackActive =
    [
      "ACTIVE_INTERNAL_PULLBACK",
      "PARENT_TRANSITION_POSSIBLE",
    ].includes(
      pullbackContext.state
    );

  if (
    descriptions.length === 1
  ) {
    if (pullbackActive) {
      return `The nearest structural continuation objective remains ${descriptions[0]}, but the Subminute continuation path is pending completion of internal wave iv.`;
    }

    return `The nearest active Fibonacci objective is ${descriptions[0]}.`;
  }

  if (pullbackActive) {
    return `The nearest structural continuation objectives remain ${descriptions[0]} and ${descriptions[1]}, but the Subminute continuation path is pending completion of internal wave iv.`;
  }

  return `The nearest active Fibonacci objectives are ${descriptions[0]} and ${descriptions[1]}.`;
}

function buildAlignmentSummary(
  alignment
) {
  const counts =
    alignment?.counts || {};

  const usable =
    toNumber(
      counts.usable
    );

  const alignedCount =
    Array.isArray(
      alignment.alignedDegrees
    )
      ? alignment
          .alignedDegrees
          .length
      : null;

  const confidence =
    formatConfidence(
      alignment.confidence
    );

  const direction =
    normalizeDirection(
      alignment.direction
    );

  const denominator =
    usable ??
    toNumber(
      counts.total
    ) ??
    5;

  if (
    alignedCount !== null &&
    direction === "LONG"
  ) {
    return `${alignedCount} of ${denominator} degrees remain aligned to the upside, with ${confidence} structural confidence.`;
  }

  if (
    alignedCount !== null &&
    direction === "SHORT"
  ) {
    return `${alignedCount} of ${denominator} degrees remain aligned to the downside, with ${confidence} structural confidence.`;
  }

  return `Overall structural alignment is ${upper(
    alignment.alignmentState
  ).replaceAll(
    "_",
    " "
  )}, with ${confidence} confidence.`;
}

function collectWarnings({
  alignment,
  waveIntelligence,
  pullbackContext,
}) {
  const rawWarnings = [
    ...(
      Array.isArray(
        alignment
          .lowerDegreeWarnings
      )
        ? alignment
            .lowerDegreeWarnings
        : []
    ),

    ...(
      Array.isArray(
        alignment.reasonCodes
      )
        ? alignment
            .reasonCodes
        : []
    ),
  ];

  let warnings =
    unique(
      rawWarnings
        .map(
          normalizeWarningCode
        )
        .filter(Boolean)
    );

  if (
    pullbackContext.state ===
    "INVALIDATED"
  ) {
    warnings.push(
      "SUBMINUTE_STRUCTURE_INVALIDATED"
    );

    warnings =
      warnings.filter(
        (warning) =>
          warning !==
          "SUBMINUTE_INTERNAL_PULLBACK"
      );
  } else if (
    [
      "ACTIVE_INTERNAL_PULLBACK",
      "PARENT_TRANSITION_POSSIBLE",
    ].includes(
      pullbackContext.state
    )
  ) {
    warnings.push(
      "SUBMINUTE_INTERNAL_PULLBACK"
    );
  }

  if (
    !warnings.includes(
      "PRIMARY_W5_MATURITY_WARNING"
    ) &&
    normalizeWave(
      waveIntelligence
        ?.primary
        ?.currentWave
    ) === "W5"
  ) {
    warnings.push(
      "PRIMARY_W5_MATURITY_WARNING"
    );
  }

  warnings =
    unique(
      warnings
    );

  return warnings.sort(
    (
      left,
      right
    ) => {
      const leftIndex =
        WARNING_PRIORITY.indexOf(
          left
        );

      const rightIndex =
        WARNING_PRIORITY.indexOf(
          right
        );

      return (
        (
          leftIndex === -1
            ? Number.MAX_SAFE_INTEGER
            : leftIndex
        ) -
        (
          rightIndex === -1
            ? Number.MAX_SAFE_INTEGER
            : rightIndex
        )
      );
    }
  );
}

function warningText(warning) {
  const map = {
    SUBMINUTE_STRUCTURE_INVALIDATED:
      "The Subminute W3 internal-continuation structure has been invalidated.",

    LOWER_DEGREES_REVERSING:
      "Lower degrees are reversing against the higher-timeframe structure.",

    MULTI_DEGREE_LATE_STAGE_WARNING:
      "Multiple degrees are in late-stage wave development.",

    LOWER_DEGREES_WEAKENING:
      "Lower-degree structure is weakening.",

    SUBMINUTE_INTERNAL_PULLBACK:
      "The immediate warning is an active Subminute internal iv pullback.",

    PRIMARY_W5_MATURITY_WARNING:
      "Primary W5 maturity remains the broader structural caution.",

    ALIGNMENT_CURRENT_PRICE_MISMATCH:
      "Current-price inputs are inconsistent across the degree records.",

    HIGHER_DEGREES_STILL_SUPPORTIVE:
      "Higher degrees remain structurally supportive.",

    MINUTE_PULLBACK_AGAINST_HIGHER_TREND:
      "Minute is pulling back against the higher-degree trend.",
  };

  return (
    map[warning] ||
    null
  );
}

function buildWarningSummary({
  warnings,
  classification,
  pullbackContext,
}) {
  if (
    pullbackContext.state ===
    "INVALIDATED"
  ) {
    const levelText =
      pullbackContext
        .invalidationLevel !==
        null
        ? ` after the published ${formatPrice(
            pullbackContext
              .invalidationLevel
          )} invalidation level was breached`
        : "";

    return `The Subminute W3 internal-continuation structure has been invalidated${levelText}.`;
  }

  const hasPullback =
    warnings.includes(
      "SUBMINUTE_INTERNAL_PULLBACK"
    );

  const hasPrimaryWarning =
    warnings.includes(
      "PRIMARY_W5_MATURITY_WARNING"
    );

  if (
    hasPullback &&
    hasPrimaryWarning
  ) {
    return (
      "The immediate warning is an active Subminute internal iv pullback, while Primary W5 maturity remains the broader structural caution."
    );
  }

  if (hasPullback) {
    if (
      classification ===
      "BULLISH"
    ) {
      return (
        "The immediate warning is an active Subminute internal iv pullback, while the broader five-degree bullish structure remains intact."
      );
    }

    return (
      "The immediate warning is an active Subminute internal iv pullback."
    );
  }

  if (
    warnings.length === 0
  ) {
    return (
      "No active structural warnings."
    );
  }

  const selected =
    warnings
      .map(
        warningText
      )
      .filter(Boolean)
      .slice(
        0,
        2
      );

  if (
    selected.length === 0
  ) {
    return (
      "No active structural warnings."
    );
  }

  return selected.join(" ");
}

function buildOutlook({
  classification,
  objectives,
  waveEntries,
  warnings,
  pullbackContext,
}) {
  if (
    pullbackContext.state ===
    "INVALIDATED"
  ) {
    return (
      "The current Subminute continuation interpretation is no longer valid, and the next structural outlook depends on Engine 22 establishing a new wave count."
    );
  }

  if (
    pullbackContext.state ===
    "PARENT_COMPLETE"
  ) {
    return (
      "The parent Subminute W3 has completed according to the upstream structure, so the next outlook depends on confirmation of the following parent-wave transition."
    );
  }

  if (
    pullbackContext.state ===
    "PARENT_TRANSITION_POSSIBLE"
  ) {
    return (
      "A transition from Subminute W3 toward a full Subminute W4 is possible, but it is not yet confirmed."
    );
  }

  if (
    pullbackContext.state ===
    "ACTIVE_INTERNAL_PULLBACK"
  ) {
    return (
      "Current structure favors waiting for the internal iv pullback to complete and for bullish continuation confirmation before internal wave v is treated as active."
    );
  }

  const nextExpectedWaves =
    waveEntries
      .map(
        ({
          degree,
          record,
        }) => ({
          degree,

          nextWave:
            normalizeWave(
              record
                ?.nextExpectedWave
            ),
        })
      )
      .filter(
        (item) =>
          item.nextWave !==
          "UNKNOWN"
      );

  const lowerDegreeW4Expected =
    nextExpectedWaves.some(
      (item) =>
        [
          "subminute",
          "minute",
          "minor",
          "intermediate",
        ].includes(
          item.degree
        ) &&
        item.nextWave ===
          "W4"
    );

  const hasObjectives =
    objectives.length > 0;

  if (
    classification ===
      "BULLISH" &&
    hasObjectives &&
    lowerDegreeW4Expected
  ) {
    return (
      "Current structure favors continued upside toward the nearest objectives before the next expected lower-degree W4 corrective sequence develops."
    );
  }

  if (
    classification ===
      "BEARISH" &&
    hasObjectives &&
    lowerDegreeW4Expected
  ) {
    return (
      "Current structure favors continued downside toward the nearest objectives before the next expected lower-degree W4 corrective sequence develops."
    );
  }

  if (
    classification ===
      "BULLISH" &&
    hasObjectives
  ) {
    return (
      "Current structure favors continued upside toward the nearest active Fibonacci objectives."
    );
  }

  if (
    classification ===
      "BEARISH" &&
    hasObjectives
  ) {
    return (
      "Current structure favors continued downside toward the nearest active Fibonacci objectives."
    );
  }

  if (
    warnings.includes(
      "LOWER_DEGREES_REVERSING"
    )
  ) {
    return (
      "The immediate structural outlook is mixed while lower degrees reverse against the higher-timeframe structure."
    );
  }

  if (
    classification ===
    "BULLISH"
  ) {
    return (
      "The broader structure remains supportive, although no active Fibonacci objective is currently available."
    );
  }

  if (
    classification ===
    "BEARISH"
  ) {
    return (
      "The broader structure remains bearish, although no active Fibonacci objective is currently available."
    );
  }

  return (
    "The immediate structural outlook remains mixed until the degree structure becomes more clearly aligned."
  );
}

function limitToSummaryWordCount(
  text
) {
  const words =
    String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  if (
    words.length <= 150
  ) {
    return words.join(" ");
  }

  return `${words
    .slice(0, 149)
    .join(" ")}.`;
}

function buildSummary({
  marketStructure,
  waveSummary,
  fibSummary,
  alignmentSummary,
  warningSummary,
  outlook,
}) {
  return (
    limitToSummaryWordCount(
      [
        marketStructure,
        waveSummary,
        fibSummary,
        alignmentSummary,
        warningSummary,
        outlook,
      ].join(" ")
    )
  );
}

function buildStoryReasonCodes({
  classification,
  warnings,
  partialData,
  noActiveFibObjective,
  pullbackContext,
}) {
  const codes = [
    "ENGINE27_STORY_READY",
  ];

  if (
    classification ===
    "BULLISH"
  ) {
    codes.push(
      "ENGINE27_STORY_BULLISH"
    );
  } else if (
    classification ===
    "BEARISH"
  ) {
    codes.push(
      "ENGINE27_STORY_BEARISH"
    );
  } else {
    codes.push(
      "ENGINE27_STORY_MIXED"
    );
  }

  if (
    pullbackContext.state ===
    "INVALIDATED"
  ) {
    codes.push(
      "ENGINE27_STORY_SUBMINUTE_STRUCTURE_INVALIDATED"
    );
  } else if (
    [
      "ACTIVE_INTERNAL_PULLBACK",
      "PARENT_TRANSITION_POSSIBLE",
    ].includes(
      pullbackContext.state
    )
  ) {
    codes.push(
      "ENGINE27_STORY_SUBMINUTE_INTERNAL_PULLBACK"
    );
  }

  const warningReasonCodeMap = {
    LOWER_DEGREES_WEAKENING:
      "ENGINE27_STORY_LOWER_DEGREES_WEAKENING",

    LOWER_DEGREES_REVERSING:
      "ENGINE27_STORY_LOWER_DEGREES_REVERSING",

    MULTI_DEGREE_LATE_STAGE_WARNING:
      "ENGINE27_STORY_MULTI_DEGREE_LATE_STAGE",

    PRIMARY_W5_MATURITY_WARNING:
      "ENGINE27_STORY_PRIMARY_W5_WARNING",
  };

  for (
    const warning
    of warnings
  ) {
    codes.push(
      warningReasonCodeMap[
        warning
      ]
    );
  }

  if (partialData) {
    codes.push(
      "ENGINE27_STORY_PARTIAL_DATA"
    );
  }

  if (
    noActiveFibObjective
  ) {
    codes.push(
      "ENGINE27_STORY_NO_ACTIVE_FIB_OBJECTIVE"
    );
  }

  return unique(
    codes
  );
}

export function buildMarketStory({
  engine27WaveIntelligence,
  engine27FibIntelligence,
  engine27Alignment,
} = {}) {
  try {
    if (
      !isObject(
        engine27WaveIntelligence
      ) ||
      !isObject(
        engine27FibIntelligence
      ) ||
      !isObject(
        engine27Alignment
      ) ||
      engine27Alignment
        .active !== true
    ) {
      return safeUnavailableStory();
    }

    const waveEntries =
      getUsableWaveEntries(
        engine27WaveIntelligence
      );

    if (
      waveEntries.length === 0
    ) {
      return safeUnavailableStory();
    }

    const classification =
      classifyStoryDirection(
        engine27Alignment,
        waveEntries
      );

    const pullbackContext =
      readSubminutePullbackContext({
        waveIntelligence:
          engine27WaveIntelligence,

        alignment:
          engine27Alignment,
      });

    const objectives =
      buildActiveFibObjectives({
        fibIntelligence:
          engine27FibIntelligence,

        waveIntelligence:
          engine27WaveIntelligence,
      });

    const warnings =
      collectWarnings({
        alignment:
          engine27Alignment,

        waveIntelligence:
          engine27WaveIntelligence,

        pullbackContext,
      });

    const marketStructure =
      buildMarketStructure({
        classification,
        waveEntries,

        alignment:
          engine27Alignment,
      });

    const waveSummary =
      buildWaveSummary({
        waveEntries,
        pullbackContext,
      });

    const fibSummary =
      buildFibSummary({
        objectives,
        pullbackContext,
      });

    const alignmentSummary =
      buildAlignmentSummary(
        engine27Alignment
      );

    const warningSummary =
      buildWarningSummary({
        warnings,
        classification,
        pullbackContext,
      });

    const outlook =
      buildOutlook({
        classification,
        objectives,
        waveEntries,
        warnings,
        pullbackContext,
      });

    const headline =
      buildHeadline({
        classification,

        alignment:
          engine27Alignment,

        warnings,
        pullbackContext,
      });

    const summary =
      buildSummary({
        marketStructure,
        waveSummary,
        fibSummary,
        alignmentSummary,
        warningSummary,
        outlook,
      });

    const alignmentUsable =
      toNumber(
        engine27Alignment
          ?.counts
          ?.usable
      );

    const alignmentTotal =
      toNumber(
        engine27Alignment
          ?.counts
          ?.total
      );

    const partialData =
      waveEntries.length <
        DEGREE_ORDER.length ||
      (
        alignmentUsable !==
          null &&
        alignmentTotal !==
          null &&
        alignmentUsable <
          alignmentTotal
      );

    return {
      active: true,

      engine:
        ENGINE_NAME,

      mode:
        "READ_ONLY",

      headline,

      summary,

      marketStructure,

      waveSummary,

      fibSummary,

      alignmentSummary,

      warningSummary,

      outlook,

      reasonCodes:
        buildStoryReasonCodes({
          classification,
          warnings,
          partialData,

          noActiveFibObjective:
            objectives.length ===
            0,

          pullbackContext,
        }),
    };
  } catch {
    return safeUnavailableStory();
  }
}

export default buildMarketStory;
