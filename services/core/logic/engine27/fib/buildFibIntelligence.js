// services/core/logic/engine27/fib/buildFibIntelligence.js
// Engine 27B — Fibonacci Intelligence
//
// Canonical inputs:
// - engine27WaveIntelligence
// - engine22WaveStrategy.degreeStates
//
// Engine 27B owns:
// - anchor normalization
// - retracement ladders
// - extension ladders
// - current Fib position
// - completed Fib levels
// - next Fib objective
// - remaining Fib objectives
// - validation against Engine 22 reference levels
//
// Engine 27B does not own:
// - decisions
// - alignment
// - confidence
// - permission
// - sizing
// - geometry
// - execution
// - dashboard presentation

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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function toNumber(value) {
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

function toPrice(value) {
  const number = toNumber(value);

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
  const number = toNumber(value);

  if (number === null) {
    return null;
  }

  return Number(
    (
      Math.round(number / tick) *
      tick
    ).toFixed(2)
  );
}

function roundDistance(value) {
  const number = toNumber(value);

  return number === null
    ? null
    : Number(number.toFixed(2));
}

function normalizeWave(value) {
  const wave = String(value || "")
    .trim()
    .toUpperCase();

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
    ].includes(wave)
  ) {
    return wave;
  }

  return "UNKNOWN";
}

function normalizeDirection(value) {
  const direction = String(value || "")
    .trim()
    .toUpperCase();

  if (
    [
      "UP",
      "LONG",
      "BULLISH",
      "BULL",
      "BUY",
    ].includes(direction)
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
    ].includes(direction)
  ) {
    return "BEARISH";
  }

  return "UNKNOWN";
}

function readMarkPrice(mark) {
  const direct = toPrice(mark);

  if (direct !== null) {
    return direct;
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

  for (const candidate of candidates) {
    const price = toPrice(candidate);

    if (price !== null) {
      return price;
    }
  }

  return null;
}

function readFirstPrice(
  source,
  keys
) {
  if (!isObject(source)) {
    return null;
  }

  for (const key of keys) {
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
      sourceType: null,
    };
  }

  const candidates = [
    {
      source:
        degreeState
          ?.targetModel
          ?.anchorModel,

      sourcePath:
        "degreeState.targetModel.anchorModel",

      sourceType:
        "TARGET_MODEL_ANCHOR_MODEL",
    },

    {
      source:
        degreeState.confirmedAnchors,

      sourcePath:
        "degreeState.confirmedAnchors",

      sourceType:
        "CONFIRMED_ANCHORS",
    },

    {
      source:
        degreeState.anchors,

      sourcePath:
        "degreeState.anchors",

      sourceType:
        "ANCHORS",
    },

    {
      source:
        degreeState.waveMarks,

      sourcePath:
        "degreeState.waveMarks",

      sourceType:
        "WAVE_MARKS",
    },

    {
      source:
        degreeState
          ?.structure
          ?.waveMarks,

      sourcePath:
        "degreeState.structure.waveMarks",

      sourceType:
        "STRUCTURE_WAVE_MARKS",
    },
  ];

  for (const candidate of candidates) {
    if (isObject(candidate.source)) {
      return candidate;
    }
  }

  return {
    source: null,
    sourcePath: null,
    sourceType: null,
  };
}

function resolveGenericAnchors({
  source,
  currentWave,
}) {
  const marks =
    isObject(source.waveMarks)
      ? source.waveMarks
      : source;

  let waveStart =
    readFirstPrice(
      source,
      [
        "waveStart",
        "impulseStart",
        "start",
        "anchorStart",
        "low",
        "a",
      ]
    );

  let waveEnd =
    readFirstPrice(
      source,
      [
        "waveEnd",
        "impulseEnd",
        "end",
        "anchorEnd",
        "high",
        "b",
      ]
    );

  let projectionBase =
    readFirstPrice(
      source,
      [
        "projectionBase",
        "base",
        "projection",
      ]
    );

  if (
    currentWave === "W3" &&
    projectionBase === null
  ) {
    projectionBase =
      readMarkPrice(
        marks?.W2
      );
  }

  if (currentWave === "W4") {
    waveStart =
      waveStart ??
      readMarkPrice(
        marks?.W2
      );

    waveEnd =
      waveEnd ??
      readMarkPrice(
        marks?.W3
      );
  }

  if (currentWave === "W5") {
    waveStart =
      waveStart ??
      readMarkPrice(
        marks?.W2
      );

    waveEnd =
      waveEnd ??
      readMarkPrice(
        marks?.W3
      );

    projectionBase =
      projectionBase ??
      readMarkPrice(
        marks?.W4
      );
  }

  return {
    waveStart,
    waveEnd,
    projectionBase,
    suppliedWaveLength:
      readFirstPrice(
        source,
        [
          "waveLength",
          "range",
          "length",
        ]
      ),
  };
}

function buildAnchorContract({
  source,
  sourcePath,
  sourceType,
  currentWave,
  directionInput,
}) {
  let waveStart = null;
  let waveEnd = null;
  let projectionBase = null;
  let suppliedWaveLength = null;

  if (
    sourceType ===
    "TARGET_MODEL_ANCHOR_MODEL"
  ) {
    waveStart =
      toPrice(
        source.impulseStart
      );

    waveEnd =
      toPrice(
        source.impulseEnd
      );

    projectionBase =
      toPrice(
        source.projectionBase
      );

    suppliedWaveLength =
      toPrice(
        source.range
      );
  } else {
    const generic =
      resolveGenericAnchors({
        source,
        currentWave,
      });

    waveStart =
      generic.waveStart;

    waveEnd =
      generic.waveEnd;

    projectionBase =
      generic.projectionBase;

    suppliedWaveLength =
      generic.suppliedWaveLength;
  }

  const calculatedWaveLength =
    (
      waveStart !== null &&
      waveEnd !== null
    )
      ? Math.abs(
          waveEnd -
          waveStart
        )
      : null;

  const waveLength =
    suppliedWaveLength ??
    calculatedWaveLength;

  let direction =
    normalizeDirection(
      directionInput
    );

  if (
    direction === "UNKNOWN" &&
    waveStart !== null &&
    waveEnd !== null
  ) {
    direction =
      waveEnd > waveStart
        ? "BULLISH"
        : waveEnd < waveStart
        ? "BEARISH"
        : "UNKNOWN";
  }

  return {
    waveStart:
      waveStart !== null
        ? roundToTick(waveStart)
        : null,

    waveEnd:
      waveEnd !== null
        ? roundToTick(waveEnd)
        : null,

    projectionBase:
      projectionBase !== null
        ? roundToTick(
            projectionBase
          )
        : null,

    waveLength:
      waveLength !== null
        ? roundToTick(
            waveLength
          )
        : null,

    direction,

    source:
      sourcePath,

    timestamp:
      source.timestamp ??
      source.updatedAt ??
      source.confirmedAt ??
      null,

    startKey:
      sourceType ===
      "TARGET_MODEL_ANCHOR_MODEL"
        ? "impulseStart"
        : "waveStart",

    endKey:
      sourceType ===
      "TARGET_MODEL_ANCHOR_MODEL"
        ? "impulseEnd"
        : "waveEnd",

    projectionBaseKey:
      "projectionBase",

    waveLengthKey:
      suppliedWaveLength !== null
        ? (
            sourceType ===
            "TARGET_MODEL_ANCHOR_MODEL"
              ? "range"
              : "waveLength"
          )
        : "calculatedRange",
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

  if (direction === "BULLISH") {
    return currentPrice >= targetPrice
      ? "REACHED"
      : "NOT_REACHED";
  }

  return currentPrice <= targetPrice
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
  const retracements = {};

  if (
    anchors.waveEnd === null ||
    anchors.waveLength === null ||
    anchors.direction === "UNKNOWN"
  ) {
    return retracements;
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
        ? anchors.waveEnd -
          anchors.waveLength *
          ratio
        : anchors.waveEnd +
          anchors.waveLength *
          ratio;

    retracements[label] =
      buildFibLevel({
        degreeKey,
        currentWave,
        label,
        ratio,
        price:
          rawPrice,
        currentPrice,

        direction:
          anchors.direction ===
          "BULLISH"
            ? "BEARISH"
            : "BULLISH",

        ladderType:
          "RETRACEMENT",
      });
  }

  return retracements;
}

function buildExtensions({
  degreeKey,
  currentWave,
  anchors,
  currentPrice,
}) {
  const extensions = {};

  if (
    anchors.projectionBase === null ||
    anchors.waveLength === null ||
    anchors.direction === "UNKNOWN"
  ) {
    return extensions;
  }

  const sign =
    anchors.direction ===
    "BEARISH"
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
    const rawPrice =
      anchors.projectionBase +
      sign *
      anchors.waveLength *
      ratio;

    extensions[label] =
      buildFibLevel({
        degreeKey,
        currentWave,
        label,
        ratio,
        price:
          rawPrice,
        currentPrice,
        direction:
          anchors.direction,
        ladderType:
          "EXTENSION",
      });
  }

  return extensions;
}

function getActiveLadderType(
  currentWave
) {
  if (
    [
      "W2",
      "W4",
    ].includes(currentWave)
  ) {
    return "RETRACEMENT";
  }

  if (
    [
      "W3",
      "W5",
      "C",
    ].includes(currentWave)
  ) {
    return "EXTENSION";
  }

  return "UNKNOWN";
}

function orderedLevels(
  ladder,
  ladderType
) {
  const labels =
    ladderType ===
    "RETRACEMENT"
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

function buildCurrentObjective({
  currentPrice,
  ladder,
  ladderType,
}) {
  const levels =
    orderedLevels(
      ladder,
      ladderType
    );

  if (!levels.length) {
    return {
      currentFib: {
        lastCompleted:
          "UNKNOWN",
        next:
          "UNKNOWN",
      },

      completedFibLevels: [],
      nextFib: "UNKNOWN",
      nextPrice: null,
      distance: null,
      remainingTargets: [],
    };
  }

  if (currentPrice === null) {
    return {
      currentFib: {
        lastCompleted:
          "UNKNOWN",
        next:
          levels[0].label,
      },

      completedFibLevels: [],
      nextFib:
        levels[0].label,
      nextPrice:
        levels[0].price,
      distance:
        null,
      remainingTargets:
        levels.slice(1),
    };
  }

  const completedFibLevels =
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

  const nextLevel =
    nextIndex >= 0
      ? levels[nextIndex]
      : null;

  return {
    currentFib: {
      lastCompleted:
        completedFibLevels[
          completedFibLevels.length - 1
        ]?.label ||
        "NONE",

      next:
        nextLevel?.label ||
        "COMPLETE",
    },

    completedFibLevels,

    nextFib:
      nextLevel?.label ||
      "COMPLETE",

    nextPrice:
      nextLevel?.price ??
      null,

    distance:
      nextLevel?.distance ??
      null,

    remainingTargets:
      nextIndex >= 0
        ? levels.slice(
            nextIndex + 1
          )
        : [],
  };
}

function expectedCorrectionFor({
  degreeKey,
  currentWave,
}) {
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
      nextWave: "UNKNOWN",
      type: "UNKNOWN",
      description: "UNKNOWN",
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

  for (const candidate of candidates) {
    const price = toPrice(candidate);

    if (price !== null) {
      return roundToTick(price);
    }
  }

  return null;
}

function getEngine22ReferencePrice(
  referenceLevels,
  label
) {
  if (!isObject(referenceLevels)) {
    return null;
  }

  const direct =
    toPrice(
      referenceLevels[label]
    );

  if (direct !== null) {
    return roundToTick(direct);
  }

  const numericLabels = {
    e100: "1.000",
    e1168: "1.168",
    e1272: "1.272",
    e1618: "1.618",
    e200: "2.000",
    e2618: "2.618",
  };

  const numericLabel =
    numericLabels[label];

  if (!numericLabel) {
    return null;
  }

  const numericPrice =
    toPrice(
      referenceLevels[
        numericLabel
      ]
    );

  return numericPrice !== null
    ? roundToTick(
        numericPrice
      )
    : null;
}

function buildValidation({
  extensions,
  referenceLevels,
}) {
  const differences = [];

  if (!isObject(referenceLevels)) {
    return {
      source:
        "degreeState.targetModel.levels",

      available:
        false,

      matches:
        true,

      differences,
    };
  }

  for (
    const label
    of Object.keys(
      EXTENSION_RATIOS
    )
  ) {
    const engine27Price =
      toPrice(
        extensions?.[
          label
        ]?.price
      );

    const engine22Price =
      getEngine22ReferencePrice(
        referenceLevels,
        label
      );

    if (
      engine27Price === null ||
      engine22Price === null
    ) {
      continue;
    }

    const differencePoints =
      roundDistance(
        Math.abs(
          engine27Price -
          engine22Price
        )
      );

    if (
      differencePoints >
      ES_TICK_SIZE
    ) {
      differences.push({
        label,

        engine27Price:
          roundToTick(
            engine27Price
          ),

        engine22Price:
          roundToTick(
            engine22Price
          ),

        differencePoints,
      });
    }
  }

  return {
    source:
      "degreeState.targetModel.levels",

    available:
      true,

    matches:
      differences.length === 0,

    differences,
  };
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
      waveLengthKey: null,
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
    nextFib: "UNKNOWN",
    nextPrice: null,
    distance: null,
    remainingTargets: [],

    expectedCorrection:
      expectedCorrectionFor({
        degreeKey,
        currentWave,
      }),

    validation: {
      source:
        "degreeState.targetModel.levels",

      available:
        false,

      matches:
        true,

      differences: [],
    },

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
    sourceType,
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
      source,
      sourcePath,
      sourceType,
      currentWave,

      directionInput:
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

  const activeLadder =
    getActiveLadderType(
      currentWave
    );

  const activeLevels =
    activeLadder ===
    "RETRACEMENT"
      ? retracements
      : activeLadder ===
        "EXTENSION"
      ? extensions
      : {};

  const objective =
    buildCurrentObjective({
      currentPrice,
      ladder:
        activeLevels,
      ladderType:
        activeLadder,
    });

  const validation =
    buildValidation({
      extensions,

      referenceLevels:
        degreeState
          ?.targetModel
          ?.levels,
    });

  const anchorsComplete =
    anchors.waveStart !== null &&
    anchors.waveEnd !== null &&
    anchors.waveLength !== null;

  const projectionComplete =
    anchors.projectionBase !== null;

  const activeLadderAvailable =
    Object.keys(
      activeLevels
    ).length > 0;

  return {
    degree:
      degreeKey,

    currentWave,

    currentPrice,

    anchors,

    retracements,

    extensions,

    activeLadder,

    ...objective,

    expectedCorrection:
      expectedCorrectionFor({
        degreeKey,
        currentWave,
      }),

    validation,

    reasonCodes:
      unique([
        anchorsComplete
          ? "ENGINE27_FIB_ANCHORS_COMPLETE"
          : "ENGINE27_FIB_UNKNOWN",

        sourceType ===
        "TARGET_MODEL_ANCHOR_MODEL"
          ? "ENGINE27_FIB_ENGINE22_ANCHOR_MODEL_CONSUMED"
          : null,

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

        (
          validation.available ===
            true &&
          validation.matches ===
            false
        )
          ? "ENGINE27_FIB_ENGINE22_VALIDATION_MISMATCH"
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
      output[degreeKey] =
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
      output[degreeKey] =
        unknownDegreeResult({
          degreeKey,

          currentWave:
            normalizeWave(
              waves[
                degreeKey
              ]?.currentWave
            ),

          currentPrice:
            resolveCurrentPrice({
              engine27WaveIntelligence:
                waves,

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
            }),

          reasonCodes: [
            "ENGINE27_FIB_SAFE_FALLBACK",
          ],
        });
    }
  }

  return output;
}

export default buildFibIntelligence;
