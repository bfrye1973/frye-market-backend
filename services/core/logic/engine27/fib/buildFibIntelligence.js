// services/core/logic/engine27/fib/buildFibIntelligence.js
// Engine 27B — Fibonacci Intelligence
//
// Consumes only:
// - engine27WaveIntelligence
// - engine22WaveStrategy.degreeStates
//
// Owns only:
// - anchor validation
// - retracement ladders
// - extension ladders
// - completed / next / remaining Fibonacci objectives
//
// Does not create:
// - decisions
// - alignment
// - confidence
// - permission
// - geometry
// - tickets
// - execution
// - dashboard output

const DEGREE_KEYS = [
  "subminute",
  "minute",
  "minor",
  "intermediate",
  "primary",
];

const RETRACEMENT_RATIOS = {
  r236: 0.236,
  r382: 0.382,
  r500: 0.5,
  r618: 0.618,
  r786: 0.786,
};

const EXTENSION_RATIOS = {
  e100: 1.0,
  e1168: 1.168,
  e1272: 1.272,
  e1618: 1.618,
  e200: 2.0,
  e2618: 2.618,
};

const ES_TICK_SIZE = 0.25;

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

function unique(values) {
  return [
    ...new Set(
      values.filter(Boolean)
    ),
  ];
}

function toFiniteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function toPositivePrice(value) {
  const number =
    toFiniteNumber(value);

  return (
    number !== null &&
    number > 0
  )
    ? number
    : null;
}

function roundToTick(
  value,
  tick = ES_TICK_SIZE
) {
  const number =
    toFiniteNumber(value);

  if (number === null) {
    return null;
  }

  return Number(
    (
      Math.round(
        number / tick
      ) * tick
    ).toFixed(2)
  );
}

function roundDistance(value) {
  const number =
    toFiniteNumber(value);

  if (number === null) {
    return null;
  }

  return Number(
    number.toFixed(2)
  );
}

function normalizeWave(value) {
  const text =
    upper(value);

  if (
    [
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
    ].includes(text)
  ) {
    return text;
  }

  return "UNKNOWN";
}

function normalizeDirection(value) {
  const text =
    upper(value);

  if (
    [
      "UP",
      "LONG",
      "BULLISH",
      "BULL",
      "BUY",
    ].includes(text)
  ) {
    return "BULLISH";
  }

  if (
    [
      "DOWN",
      "SHORT",
      "BEARISH",
      "BEAR",
      "SELL",
    ].includes(text)
  ) {
    return "BEARISH";
  }

  return "UNKNOWN";
}

function readMarkPrice(mark) {
  if (
    toPositivePrice(mark) !== null
  ) {
    return toPositivePrice(mark);
  }

  if (!isObject(mark)) {
    return null;
  }

  const candidates = [
    mark.price,
    mark.p,
    mark.value,
    mark.level,
    mark.close,
  ];

  for (
    const candidate
    of candidates
  ) {
    const price =
      toPositivePrice(candidate);

    if (price !== null) {
      return price;
    }
  }

  return null;
}

function readNamedPrice(
  source,
  keys
) {
  if (!isObject(source)) {
    return null;
  }

  for (
    const key
    of keys
  ) {
    const price =
      readMarkPrice(
        source[key]
      );

    if (price !== null) {
      return price;
    }
  }

  return null;
}

function resolveAnchorSource(
  degreeState
) {
  if (!isObject(degreeState)) {
    return {
      source: null,
      sourcePath: null,
    };
  }

  const candidates = [
    {
      source:
        degreeState.confirmedAnchors,
      sourcePath:
        "degreeState.confirmedAnchors",
    },
    {
      source:
        degreeState.anchors,
      sourcePath:
        "degreeState.anchors",
    },
    {
      source:
        degreeState.waveMarks,
      sourcePath:
        "degreeState.waveMarks",
    },
    {
      source:
        degreeState.structure
          ?.waveMarks,
      sourcePath:
        "degreeState.structure.waveMarks",
    },
  ];

  for (
    const candidate
    of candidates
  ) {
    if (
      isObject(
        candidate.source
      )
    ) {
      return candidate;
    }
  }

  return {
    source: null,
    sourcePath: null,
  };
}

function unwrapWaveMarks(source) {
  if (!isObject(source)) {
    return {};
  }

  if (
    isObject(
      source.waveMarks
    )
  ) {
    return source.waveMarks;
  }

  return source;
}

function explicitAnchorValue(
  source,
  keys
) {
  return readNamedPrice(
    source,
    keys
  );
}

function markPrice(
  marks,
  wave
) {
  return readNamedPrice(
    marks,
    [
      wave,
      wave.toLowerCase(),
      `wave${wave.replace("W", "")}`,
      `Wave${wave.replace("W", "")}`,
    ]
  );
}

function inferDirection(
  {
    explicitDirection,
    waveStart,
    waveEnd,
  }
) {
  const normalized =
    normalizeDirection(
      explicitDirection
    );

  if (
    normalized !== "UNKNOWN"
  ) {
    return normalized;
  }

  if (
    waveStart !== null &&
    waveEnd !== null
  ) {
    if (
      waveEnd > waveStart
    ) {
      return "BULLISH";
    }

    if (
      waveEnd < waveStart
    ) {
      return "BEARISH";
    }
  }

  return "UNKNOWN";
}

function buildAnchorContract({
  currentWave,
  source,
  sourcePath,
  waveDirection,
}) {
  const marks =
    unwrapWaveMarks(source);

  let waveStart =
    explicitAnchorValue(
      source,
      [
        "waveStart",
        "start",
        "anchorStart",
      ]
    );

  let waveEnd =
    explicitAnchorValue(
      source,
      [
        "waveEnd",
        "end",
        "anchorEnd",
      ]
    );

  let projectionBase =
    explicitAnchorValue(
      source,
      [
        "projectionBase",
        "base",
        "projection",
      ]
    );

  let startKey = null;
  let endKey = null;
  let projectionBaseKey =
    projectionBase !== null
      ? "projectionBase"
      : null;

  if (
    currentWave === "W2"
  ) {
    waveStart =
      waveStart ??
      explicitAnchorValue(
        source,
        [
          "w1Low",
          "W1_LOW",
          "low",
          "a",
        ]
      );

    waveEnd =
      waveEnd ??
      explicitAnchorValue(
        source,
        [
          "w1High",
          "W1_HIGH",
          "high",
          "b",
        ]
      );

    startKey = "W1_START";
    endKey = "W1_END";
  }

  if (
    currentWave === "W3"
  ) {
    waveStart =
      waveStart ??
      explicitAnchorValue(
        source,
        [
          "w1Low",
          "W1_LOW",
          "low",
          "a",
        ]
      );

    waveEnd =
      waveEnd ??
      explicitAnchorValue(
        source,
        [
          "w1High",
          "W1_HIGH",
          "high",
          "b",
        ]
      );

    projectionBase =
      projectionBase ??
      markPrice(
        marks,
        "W2"
      );

    startKey = "W1_START";
    endKey = "W1_END";

    if (
      projectionBase !== null &&
      projectionBaseKey === null
    ) {
      projectionBaseKey = "W2";
    }
  }

  if (
    currentWave === "W4"
  ) {
    waveStart =
      waveStart ??
      markPrice(
        marks,
        "W2"
      );

    waveEnd =
      waveEnd ??
      markPrice(
        marks,
        "W3"
      );

    startKey = "W2";
    endKey = "W3";
  }

  if (
    currentWave === "W5"
  ) {
    waveStart =
      waveStart ??
      markPrice(
        marks,
        "W2"
      );

    waveEnd =
      waveEnd ??
      markPrice(
        marks,
        "W3"
      );

    projectionBase =
      projectionBase ??
      markPrice(
        marks,
        "W4"
      );

    startKey = "W2";
    endKey = "W3";

    if (
      projectionBase !== null &&
      projectionBaseKey === null
    ) {
      projectionBaseKey = "W4";
    }
  }

  const direction =
    inferDirection({
      explicitDirection:
        waveDirection,
      waveStart,
      waveEnd,
    });

  const waveLength =
    (
      waveStart !== null &&
      waveEnd !== null
    )
      ? Math.abs(
          waveEnd -
          waveStart
        )
      : null;

  return {
    waveStart:
      waveStart !== null
        ? roundToTick(
            waveStart
          )
        : null,

    waveEnd:
      waveEnd !== null
        ? roundToTick(
            waveEnd
          )
        : null,

    projectionBase:
      projectionBase !== null
        ? roundToTick(
            projectionBase
          )
        : null,

    waveLength:
      waveLength !== null &&
      waveLength > 0
        ? roundToTick(
            waveLength
          )
        : null,

    direction,

    source:
      sourcePath,

    timestamp:
      source?.timestamp ??
      source?.updatedAt ??
      source?.confirmedAt ??
      null,

    startKey,
    endKey,
    projectionBaseKey,
  };
}

function purposeForLevel({
  degreeKey,
  currentWave,
  label,
  ladderType,
}) {
  const degree =
    degreeKey.toUpperCase();

  if (
    currentWave === "W3" &&
    ladderType === "EXTENSION"
  ) {
    return `${degree}_W3_OBJECTIVE`;
  }

  if (
    currentWave === "W5" &&
    ladderType === "EXTENSION"
  ) {
    return `${degree}_W5_OBJECTIVE`;
  }

  if (
    currentWave === "W2" &&
    ladderType === "RETRACEMENT"
  ) {
    return `${degree}_W2_PULLBACK_OBJECTIVE`;
  }

  if (
    currentWave === "W4" &&
    ladderType === "RETRACEMENT"
  ) {
    return `${degree}_W4_PULLBACK_OBJECTIVE`;
  }

  return `${degree}_${currentWave}_${label}_REFERENCE`;
}

function levelStatus({
  currentPrice,
  targetPrice,
  direction,
}) {
  if (
    currentPrice === null ||
    targetPrice === null ||
    direction === "UNKNOWN"
  ) {
    return "UNKNOWN";
  }

  if (
    direction === "BULLISH"
  ) {
    return (
      currentPrice >=
      targetPrice
    )
      ? "REACHED"
      : "NOT_REACHED";
  }

  return (
    currentPrice <=
    targetPrice
  )
    ? "REACHED"
    : "NOT_REACHED";
}

function buildFibLevel({
  degreeKey,
  currentWave,
  label,
  ratio,
  price,
  currentPrice,
  direction,
  ladderType,
}) {
  const targetPrice =
    roundToTick(price);

  return {
    label,
    ratio,
    price:
      targetPrice,

    status:
      levelStatus({
        currentPrice,
        targetPrice,
        direction,
      }),

    purpose:
      purposeForLevel({
        degreeKey,
        currentWave,
        label,
        ladderType,
      }),

    distance:
      (
        currentPrice !== null &&
        targetPrice !== null
      )
        ? roundDistance(
            Math.abs(
              targetPrice -
              currentPrice
            )
          )
        : null,
  };
}

function buildRetracements({
  degreeKey,
  currentWave,
  anchors,
  currentPrice,
}) {
  const output = {};

  const start =
    toFiniteNumber(
      anchors.waveStart
    );

  const end =
    toFiniteNumber(
      anchors.waveEnd
    );

  const length =
    toFiniteNumber(
      anchors.waveLength
    );

  if (
    start === null ||
    end === null ||
    length === null ||
    length <= 0 ||
    anchors.direction === "UNKNOWN"
  ) {
    return output;
  }

  for (
    const [
      label,
      ratio,
    ]
    of Object.entries(
      RETRACEMENT_RATIOS
    )
  ) {
    const rawPrice =
      anchors.direction === "BULLISH"
        ? end -
          length * ratio
        : end +
          length * ratio;

    output[label] =
      buildFibLevel({
        degreeKey,
        currentWave,
        label,
        ratio,
        price: rawPrice,
        currentPrice,
        direction:
          anchors.direction === "BULLISH"
            ? "BEARISH"
            : "BULLISH",
        ladderType:
          "RETRACEMENT",
      });
  }

  return output;
}

function buildExtensions({
  degreeKey,
  currentWave,
  anchors,
  currentPrice,
}) {
  const output = {};

  const base =
    toFiniteNumber(
      anchors.projectionBase
    );

  const length =
    toFiniteNumber(
      anchors.waveLength
    );

  if (
    base === null ||
    length === null ||
    length <= 0 ||
    anchors.direction === "UNKNOWN"
  ) {
    return output;
  }

  const sign =
    anchors.direction === "BEARISH"
      ? -1
      : 1;

  for (
    const [
      label,
      ratio,
    ]
    of Object.entries(
      EXTENSION_RATIOS
    )
  ) {
    output[label] =
      buildFibLevel({
        degreeKey,
        currentWave,
        label,
        ratio,
        price:
          base +
          sign *
          length *
          ratio,
        currentPrice,
        direction:
          anchors.direction,
        ladderType:
          "EXTENSION",
      });
  }

  return output;
}

function activeLadderType(
  currentWave
) {
  if (
    [
      "W2",
      "W4",
    ].includes(
      currentWave
    )
  ) {
    return "RETRACEMENT";
  }

  if (
    [
      "W3",
      "W5",
      "C",
    ].includes(
      currentWave
    )
  ) {
    return "EXTENSION";
  }

  return "UNKNOWN";
}

function objectiveDirection({
  ladderType,
  anchors,
}) {
  if (
    ladderType === "EXTENSION"
  ) {
    return anchors.direction;
  }

  if (
    ladderType === "RETRACEMENT"
  ) {
    if (
      anchors.direction === "BULLISH"
    ) {
      return "BEARISH";
    }

    if (
      anchors.direction === "BEARISH"
    ) {
      return "BULLISH";
    }
  }

  return "UNKNOWN";
}

function orderedLevels(
  ladder,
  ladderType
) {
  const labels =
    ladderType === "RETRACEMENT"
      ? Object.keys(
          RETRACEMENT_RATIOS
        )
      : Object.keys(
          EXTENSION_RATIOS
        );

  return labels
    .map(
      (label) =>
        ladder?.[label] ||
        null
    )
    .filter(Boolean);
}

function deriveCurrentObjective({
  currentPrice,
  ladder,
  ladderType,
  direction,
}) {
  const levels =
    orderedLevels(
      ladder,
      ladderType
    );

  if (
    levels.length === 0
  ) {
    return {
      currentFib: {
        lastCompleted:
          "UNKNOWN",
        next:
          "UNKNOWN",
      },

      completedFibLevels: [],

      nextFib:
        "UNKNOWN",

      nextPrice:
        null,

      distance:
        null,

      remainingTargets: [],
    };
  }

  if (
    currentPrice === null ||
    direction === "UNKNOWN"
  ) {
    return {
      currentFib: {
        lastCompleted:
          "UNKNOWN",
        next:
          levels[0]?.label ||
          "UNKNOWN",
      },

      completedFibLevels: [],

      nextFib:
        levels[0]?.label ||
        "UNKNOWN",

      nextPrice:
        levels[0]?.price ??
        null,

      distance:
        null,

      remainingTargets:
        levels.slice(1),
    };
  }

  const completed =
    levels.filter(
      (level) =>
        level.status ===
        "REACHED"
    );

  const nextIndex =
    levels.findIndex(
      (level) =>
        level.status !==
        "REACHED"
    );

  const next =
    nextIndex >= 0
      ? levels[nextIndex]
      : null;

  return {
    currentFib: {
      lastCompleted:
        completed[
          completed.length - 1
        ]?.label ||
        "NONE",

      next:
        next?.label ||
        "COMPLETE",
    },

    completedFibLevels:
      completed,

    nextFib:
      next?.label ||
      "COMPLETE",

    nextPrice:
      next?.price ??
      null,

    distance:
      next?.distance ??
      null,

    remainingTargets:
      nextIndex >= 0
        ? levels.slice(
            nextIndex + 1
          )
        : [],
  };
}

function expectedCorrectionFor(
  {
    degreeKey,
    currentWave,
  }
) {
  const degreeLabel =
    degreeKey.charAt(0).toUpperCase() +
    degreeKey.slice(1);

  const map = {
    W1: {
      nextWave: "W2",
      type: "RETRACEMENT",
      description:
        `${degreeLabel} W2 Pullback`,
    },

    W2: {
      nextWave: "W3",
      type: "EXTENSION",
      description:
        `${degreeLabel} W3 Advance`,
    },

    W3: {
      nextWave: "W4",
      type: "RETRACEMENT",
      description:
        `${degreeLabel} W4 Pullback`,
    },

    W4: {
      nextWave: "W5",
      type: "EXTENSION",
      description:
        `${degreeLabel} W5 Advance`,
    },

    W5: {
      nextWave: "A",
      type: "CORRECTION",
      description:
        `${degreeLabel} Wave A Correction`,
    },
  };

  return (
    map[currentWave] || {
      nextWave:
        "UNKNOWN",
      type:
        "UNKNOWN",
      description:
        "UNKNOWN",
    }
  );
}

function resolveCurrentPrice({
  engine27WaveIntelligence,
  waveIntelligence,
  degreeState,
}) {
  const candidates = [
    engine27WaveIntelligence
      ?.currentPrice,
    waveIntelligence
      ?.currentPrice,
    degreeState
      ?.currentPrice,
  ];

  for (
    const candidate
    of candidates
  ) {
    const price =
      toPositivePrice(
        candidate
      );

    if (
      price !== null
    ) {
      return roundToTick(
        price
      );
    }
  }

  return null;
}

function unknownDegreeResult({
  degreeKey,
  currentWave = "UNKNOWN",
  currentPrice = null,
  reasonCodes = [],
}) {
  return {
    degree:
      degreeKey,

    currentWave,

    currentPrice,

    anchors: {
      waveStart: null,
      waveEnd: null,
      projectionBase: null,
      waveLength: null,
      direction: "UNKNOWN",
      source: null,
      timestamp: null,
      startKey: null,
      endKey: null,
      projectionBaseKey: null,
    },

    retracements: {},

    extensions: {},

    activeLadder:
      "UNKNOWN",

    currentFib: {
      lastCompleted:
        "UNKNOWN",
      next:
        "UNKNOWN",
    },

    completedFibLevels: [],

    nextFib:
      "UNKNOWN",

    nextPrice:
      null,

    distance:
      null,

    remainingTargets: [],

    expectedCorrection:
      expectedCorrectionFor({
        degreeKey,
        currentWave,
      }),

    reasonCodes:
      unique([
        "ENGINE27_FIB_UNKNOWN",
        ...reasonCodes,
      ]),
  };
}

function buildDegreeFibIntelligence({
  degreeKey,
  waveIntelligence,
  degreeState,
  engine27WaveIntelligence,
}) {
  const currentWave =
    normalizeWave(
      waveIntelligence
        ?.currentWave
    );

  const currentPrice =
    resolveCurrentPrice({
      engine27WaveIntelligence,
      waveIntelligence,
      degreeState,
    });

  const {
    source,
    sourcePath,
  } =
    resolveAnchorSource(
      degreeState
    );

  if (!source) {
    return unknownDegreeResult({
      degreeKey,
      currentWave,
      currentPrice,
      reasonCodes: [
        "ENGINE27_FIB_ANCHOR_SOURCE_UNAVAILABLE",
      ],
    });
  }

  const anchors =
    buildAnchorContract({
      currentWave,
      source,
      sourcePath,
      waveDirection:
        waveIntelligence
          ?.currentLegDirection ??
        waveIntelligence
          ?.structuralDirection ??
        degreeState
          ?.direction,
    });

  const retracements =
    buildRetracements({
      degreeKey,
      currentWave,
      anchors,
      currentPrice,
    });

  const extensions =
    buildExtensions({
      degreeKey,
      currentWave,
      anchors,
      currentPrice,
    });

  const ladderType =
    activeLadderType(
      currentWave
    );

  const ladder =
    ladderType ===
    "RETRACEMENT"
      ? retracements
      : ladderType ===
        "EXTENSION"
      ? extensions
      : {};

  const direction =
    objectiveDirection({
      ladderType,
      anchors,
    });

  const objective =
    deriveCurrentObjective({
      currentPrice,
      ladder,
      ladderType,
      direction,
    });

  const anchorsComplete =
    anchors.waveStart !== null &&
    anchors.waveEnd !== null &&
    anchors.waveLength !== null;

  const projectionComplete =
    anchors.projectionBase !== null;

  const activeLadderAvailable =
    Object.keys(
      ladder
    ).length > 0;

  return {
    degree:
      degreeKey,

    currentWave,

    currentPrice,

    anchors,

    retracements,

    extensions,

    activeLadder:
      ladderType,

    ...objective,

    expectedCorrection:
      expectedCorrectionFor({
        degreeKey,
        currentWave,
      }),

    reasonCodes:
      unique([
        anchorsComplete
          ? "ENGINE27_FIB_ANCHORS_COMPLETE"
          : "ENGINE27_FIB_UNKNOWN",

        projectionComplete
          ? "ENGINE27_FIB_PROJECTION_BASE_AVAILABLE"
          : null,

        currentPrice === null
          ? "ENGINE27_FIB_CURRENT_PRICE_UNAVAILABLE"
          : null,

        activeLadderAvailable
          ? "ENGINE27_FIB_READY"
          : "ENGINE27_FIB_UNKNOWN",

        objective.nextFib !==
        "UNKNOWN"
          ? "ENGINE27_FIB_CURRENT_TARGET"
          : null,

        (
          objective.nextFib !==
            "UNKNOWN" &&
          objective.nextFib !==
            "COMPLETE"
        )
          ? "ENGINE27_FIB_NEXT_OBJECTIVE"
          : null,
      ]),
  };
}

export function buildFibIntelligence({
  engine27WaveIntelligence,
  degreeStates,
} = {}) {
  const waves =
    isObject(
      engine27WaveIntelligence
    )
      ? engine27WaveIntelligence
      : {};

  const states =
    isObject(
      degreeStates
    )
      ? degreeStates
      : {};

  const output = {};

  for (
    const degreeKey
    of DEGREE_KEYS
  ) {
    try {
      output[
        degreeKey
      ] =
        buildDegreeFibIntelligence({
          degreeKey,
          waveIntelligence:
            waves[
              degreeKey
            ] ||
            null,

          degreeState:
            states[
              degreeKey
            ] ||
            null,

          engine27WaveIntelligence:
            waves,
        });
        } catch {
      output[degreeKey] = unknownDegreeResult({
        degreeKey,
        currentWave: normalizeWave(waves[degreeKey]?.currentWave),

        currentPrice: resolveCurrentPrice({
          engine27WaveIntelligence: waves,
          waveIntelligence: waves[degreeKey] || null,
          degreeState: states[degreeKey] || null,
        }),

        reasonCodes: ["ENGINE27_FIB_SAFE_FALLBACK"],
      });
    }
  }

  return output;
}

export default buildFibIntelligence;
