// services/core/logic/engine27/alignment/buildMultiDegreeAlignment.js
// Engine 27C — Multi-Degree Alignment
// Reads only engine27WaveIntelligence and engine27FibIntelligence.

const DEGREE_KEYS = [
  "subminute",
  "minute",
  "minor",
  "intermediate",
  "primary",
];

const PARENT_CHILD_PAIRS = [
  ["primaryToIntermediate", "primary", "intermediate"],
  ["intermediateToMinor", "intermediate", "minor"],
  ["minorToMinute", "minor", "minute"],
  ["minuteToSubminute", "minute", "subminute"],
];

const ES_CLUSTER_TOLERANCE = 10;
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

function normalizeDirection(
  value,
  unknownAsNeutral = false
) {
  const text = upper(value);

  if (
    [
      "LONG",
      "UP",
      "BULLISH",
      "BULL",
      "BUY",
    ].includes(text)
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
    ].includes(text)
  ) {
    return "SHORT";
  }

  if (
    [
      "NEUTRAL",
      "SIDEWAYS",
      "FLAT",
      "NONE",
      "WAIT",
    ].includes(text)
  ) {
    return "NEUTRAL";
  }

  return unknownAsNeutral
    ? "NEUTRAL"
    : "UNKNOWN";
}

function normalizeWave(value) {
  const text = upper(value);

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
  ].includes(text)
    ? text
    : "UNKNOWN";
}

function normalizeMaturity(value) {
  const text = upper(value);

  return [
    "EARLY",
    "EARLY_TO_MID",
    "MID",
    "MID_TO_LATE",
    "LATE",
    "COMPLETE",
    "UNKNOWN",
    "INVALIDATED",
  ].includes(text)
    ? text
    : "UNKNOWN";
}

function isUsableWaveRecord(record) {
  if (!isObject(record)) {
    return false;
  }

  return (
    normalizeWave(
      record.currentWave
    ) !== "UNKNOWN" ||
    normalizeDirection(
      record.preferredTradeDirection
    ) !== "UNKNOWN" ||
    normalizeDirection(
      record.structuralDirection
    ) !== "UNKNOWN"
  );
}

function buildDegreeRead(
  degree,
  waveRecord,
  fibRecord
) {
  const usable =
    isUsableWaveRecord(
      waveRecord
    );

  return {
    degree,

    usable,

    currentWave:
      normalizeWave(
        waveRecord?.currentWave
      ),

    nextExpectedWave:
      normalizeWave(
        waveRecord?.nextExpectedWave
      ),

    preferredTradeDirection:
      usable
        ? normalizeDirection(
            waveRecord
              ?.preferredTradeDirection
          )
        : "UNKNOWN",

    currentLegDirection:
      normalizeDirection(
        waveRecord
          ?.currentLegDirection,
        true
      ),

    nextExpectedDirection:
      normalizeDirection(
        waveRecord
          ?.nextExpectedDirection,
        true
      ),

    stage:
      upper(
        waveRecord?.stage
      ) || "UNKNOWN",

    maturity:
      normalizeMaturity(
        waveRecord?.maturity
      ),

    nextFib:
      fibRecord?.nextFib ??
      "UNKNOWN",

    nextPrice:
      toNumber(
        fibRecord?.nextPrice
      ),

    distance:
      fibRecord?.distance ??
      null,

    currentPrice:
      toNumber(
        fibRecord?.currentPrice
      ),
  };
}

function buildCounts(
  degreeReads
) {
  const counts = {
    long: 0,
    short: 0,
    neutral: 0,
    unknown: 0,
    usable: 0,
    total:
      DEGREE_KEYS.length,
  };

  for (
    const degree
    of DEGREE_KEYS
  ) {
    const read =
      degreeReads[
        degree
      ];

    if (!read?.usable) {
      counts.unknown += 1;
      continue;
    }

    counts.usable += 1;

    if (
      read
        .preferredTradeDirection ===
      "LONG"
    ) {
      counts.long += 1;
    } else if (
      read
        .preferredTradeDirection ===
      "SHORT"
    ) {
      counts.short += 1;
    } else if (
      read
        .preferredTradeDirection ===
      "NEUTRAL"
    ) {
      counts.neutral += 1;
    } else {
      counts.unknown += 1;
    }
  }

  return counts;
}

function determineAlignmentState(
  counts
) {
  if (
    counts.usable === 0
  ) {
    return "INSUFFICIENT_DATA";
  }

  if (
    counts.long >= 2 &&
    counts.short >= 2
  ) {
    return "CONFLICTED";
  }

  if (
    counts.long === 5
  ) {
    return "STRONG_BULLISH_ALIGNMENT";
  }

  if (
    counts.long === 4
  ) {
    return "BULLISH_ALIGNMENT";
  }

  if (
    counts.long === 3
  ) {
    return "MIXED_BULLISH";
  }

  if (
    counts.short === 5
  ) {
    return "STRONG_BEARISH_ALIGNMENT";
  }

  if (
    counts.short === 4
  ) {
    return "BEARISH_ALIGNMENT";
  }

  if (
    counts.short === 3
  ) {
    return "MIXED_BEARISH";
  }

  return "BALANCED";
}

function directionForState(
  state
) {
  if (
    [
      "STRONG_BULLISH_ALIGNMENT",
      "BULLISH_ALIGNMENT",
      "MIXED_BULLISH",
    ].includes(state)
  ) {
    return "LONG";
  }

  if (
    [
      "STRONG_BEARISH_ALIGNMENT",
      "BEARISH_ALIGNMENT",
      "MIXED_BEARISH",
    ].includes(state)
  ) {
    return "SHORT";
  }

  return "NEUTRAL";
}

function confidenceFor(
  state,
  counts
) {
  if (
    state ===
    "INSUFFICIENT_DATA"
  ) {
    return "UNKNOWN";
  }

  if (
    state ===
    "CONFLICTED"
  ) {
    return "CONFLICTED";
  }

  const aligned =
    Math.max(
      counts.long,
      counts.short
    );

  if (
    aligned === 5 &&
    counts.neutral === 0 &&
    counts.unknown === 0
  ) {
    return "VERY_HIGH";
  }

  if (aligned === 4) {
    return "HIGH";
  }

  if (aligned === 3) {
    return "MODERATE";
  }

  return "LOW";
}

function buildDirectionalGroups(
  degreeReads,
  direction
) {
  const result = {
    alignedDegrees: [],
    conflictingDegrees: [],
    neutralDegrees: [],
    unknownDegrees: [],
  };

  for (
    const degree
    of DEGREE_KEYS
  ) {
    const read =
      degreeReads[
        degree
      ];

    if (
      !read?.usable ||
      read
        .preferredTradeDirection ===
        "UNKNOWN"
    ) {
      result
        .unknownDegrees
        .push(degree);

      continue;
    }

    if (
      read
        .preferredTradeDirection ===
      "NEUTRAL"
    ) {
      result
        .neutralDegrees
        .push(degree);

      continue;
    }

    if (
      direction ===
      "NEUTRAL"
    ) {
      result
        .conflictingDegrees
        .push(degree);
    } else if (
      read
        .preferredTradeDirection ===
      direction
    ) {
      result
        .alignedDegrees
        .push(degree);
    } else {
      result
        .conflictingDegrees
        .push(degree);
    }
  }

  if (
    direction ===
    "NEUTRAL"
  ) {
    result.alignedDegrees = [];
  }

  return result;
}

function parentChildStatus(
  parentRead,
  childRead
) {
  if (
    !parentRead?.usable ||
    !childRead?.usable
  ) {
    return "UNKNOWN";
  }

  const parentDirection =
    parentRead
      .preferredTradeDirection;

  const childDirection =
    childRead
      .preferredTradeDirection;

  if (
    ![
      "LONG",
      "SHORT",
    ].includes(
      parentDirection
    )
  ) {
    return "UNKNOWN";
  }

  if (
    [
      "LONG",
      "SHORT",
    ].includes(
      childDirection
    ) &&
    childDirection !==
      parentDirection
  ) {
    return "CONFLICTS_WITH_PARENT";
  }

  if (
    childDirection ===
      parentDirection &&
    childRead
      .currentLegDirection !==
      "NEUTRAL" &&
    childRead
      .currentLegDirection !==
      parentDirection
  ) {
    return "PULLS_BACK_INSIDE_PARENT";
  }

  return childDirection ===
    parentDirection
    ? "CONFIRMS_PARENT"
    : "UNKNOWN";
}

function buildWaveStageCompatibility(
  degreeReads
) {
  const output = {};

  for (
    const [
      key,
      parent,
      child,
    ]
    of PARENT_CHILD_PAIRS
  ) {
    output[key] = {
      parent,

      child,

      status:
        parentChildStatus(
          degreeReads[
            parent
          ],
          degreeReads[
            child
          ]
        ),
    };
  }

  return output;
}

function isCorrectiveDeterioration(
  read,
  higherDirection
) {
  if (
    !read?.usable ||
    ![
      "LONG",
      "SHORT",
    ].includes(
      higherDirection
    )
  ) {
    return false;
  }

  if (
    read
      .preferredTradeDirection ===
      higherDirection &&
    read
      .currentLegDirection !==
      "NEUTRAL" &&
    read
      .currentLegDirection !==
      higherDirection
  ) {
    return true;
  }

  return (
    [
      "A",
      "C",
    ].includes(
      read.currentWave
    ) &&
    read
      .currentLegDirection !==
      "NEUTRAL" &&
    read
      .currentLegDirection !==
      higherDirection
  );
}

function buildLowerDegreeWarnings(
  degreeReads,
  compatibility
) {
  const warnings = [];

  const primaryDirection =
    degreeReads
      .primary
      ?.preferredTradeDirection;

  const intermediateDirection =
    degreeReads
      .intermediate
      ?.preferredTradeDirection;

  const higherDegreesAgree =
    [
      "LONG",
      "SHORT",
    ].includes(
      primaryDirection
    ) &&
    primaryDirection ===
      intermediateDirection;

  const higherDirection =
    higherDegreesAgree
      ? primaryDirection
      : "NEUTRAL";

  for (
    const degree
    of [
      "subminute",
      "minute",
    ]
  ) {
    const read =
      degreeReads[
        degree
      ];

    const pullbackWave =
      read?.currentWave ===
        "W2" ||
      read?.currentWave ===
        "W4";

    const legOpposes =
      read
        ?.currentLegDirection !==
        "NEUTRAL" &&
      read
        ?.currentLegDirection !==
        higherDirection;

    if (
      higherDegreesAgree &&
      read?.usable &&
      read
        .preferredTradeDirection ===
        higherDirection &&
      (
        pullbackWave ||
        legOpposes
      )
    ) {
      warnings.push(
        `${degree.toUpperCase()}_PULLBACK_AGAINST_HIGHER_TREND`
      );
    }
  }

  const tacticalCompatibility = [
    compatibility
      .intermediateToMinor
      ?.status,

    compatibility
      .minorToMinute
      ?.status,

    compatibility
      .minuteToSubminute
      ?.status,
  ];

  const weakeningCount =
    tacticalCompatibility
      .filter(
        (status) =>
          [
            "PULLS_BACK_INSIDE_PARENT",
            "CONFLICTS_WITH_PARENT",
          ].includes(
            status
          )
      )
      .length;

  if (
    weakeningCount >= 2
  ) {
    warnings.push(
      "LOWER_DEGREES_WEAKENING"
    );
  }

  const oppositeDirection =
    higherDirection ===
    "LONG"
      ? "SHORT"
      : "LONG";

  const adjacentPairs = [
    [
      "minor",
      "minute",
    ],
    [
      "minute",
      "subminute",
    ],
  ];

  const reversing =
    higherDegreesAgree &&
    adjacentPairs.some(
      ([
        first,
        second,
      ]) => {
        const firstRead =
          degreeReads[
            first
          ];

        const secondRead =
          degreeReads[
            second
          ];

        const firstOpposes =
          firstRead?.usable &&
          (
            firstRead
              .preferredTradeDirection ===
              oppositeDirection ||
            isCorrectiveDeterioration(
              firstRead,
              higherDirection
            )
          );

        const secondOpposes =
          secondRead?.usable &&
          (
            secondRead
              .preferredTradeDirection ===
              oppositeDirection ||
            isCorrectiveDeterioration(
              secondRead,
              higherDirection
            )
          );

        return (
          firstOpposes &&
          secondOpposes
        );
      }
    );

  if (reversing) {
    warnings.push(
      "LOWER_DEGREES_REVERSING"
    );
  }

  if (
    higherDegreesAgree &&
    weakeningCount > 0
  ) {
    warnings.push(
      "HIGHER_DEGREES_STILL_SUPPORTIVE"
    );
  }

  if (
    degreeReads
      .primary
      ?.usable &&
    degreeReads
      .primary
      .currentWave ===
      "W5"
  ) {
    warnings.push(
      "PRIMARY_W5_MATURITY_WARNING"
    );
  }

  const lateStageCount =
    DEGREE_KEYS
      .filter(
        (degree) => {
          const read =
            degreeReads[
              degree
            ];

          return (
            read?.usable &&
            (
              read
                .currentWave ===
                "W5" ||
              [
                "LATE",
                "COMPLETE",
              ].includes(
                read.maturity
              )
            )
          );
        }
      )
      .length;

  if (
    lateStageCount >= 3
  ) {
    warnings.push(
      "MULTI_DEGREE_LATE_STAGE_WARNING"
    );
  }

  return unique(
    warnings
  );
}

function combinedMaturity(
  degreeReads
) {
  const maturities =
    DEGREE_KEYS
      .map(
        (degree) =>
          degreeReads[
            degree
          ]?.maturity
      )
      .filter(
        (value) =>
          ![
            "UNKNOWN",
            "INVALIDATED",
            undefined,
            null,
          ].includes(
            value
          )
      );

  if (
    !maturities.length
  ) {
    return "UNKNOWN";
  }

  const bucket = {
    EARLY: 1,
    EARLY_TO_MID: 2,
    MID: 3,
    MID_TO_LATE: 4,
    LATE: 5,
    COMPLETE: 5,
  };

  const values =
    maturities.map(
      (value) =>
        bucket[value]
    );

  if (
    Math.max(
      ...values
    ) -
      Math.min(
        ...values
      ) >=
    3
  ) {
    return "MIXED";
  }

  const counts =
    maturities.reduce(
      (
        result,
        value
      ) => {
        result[value] =
          (
            result[value] ||
            0
          ) + 1;

        return result;
      },
      {}
    );

  const early =
    (
      counts.EARLY ||
      0
    ) +
    (
      counts
        .EARLY_TO_MID ||
      0
    );

  const mid =
    counts.MID ||
    0;

  const late =
    (
      counts
        .MID_TO_LATE ||
      0
    ) +
    (
      counts.LATE ||
      0
    ) +
    (
      counts.COMPLETE ||
      0
    );

  if (
    early >= mid &&
    early >= late
  ) {
    return "EARLY_TO_MID";
  }

  if (
    late > early &&
    late >= mid
  ) {
    const hardLate =
      (
        counts.LATE ||
        0
      ) +
      (
        counts.COMPLETE ||
        0
      );

    return hardLate >= 2
      ? "LATE"
      : "MID_TO_LATE";
  }

  return "MID";
}

function currentPriceAssessment(
  degreeReads
) {
  const prices =
    DEGREE_KEYS
      .map(
        (degree) =>
          degreeReads[
            degree
          ]?.currentPrice
      )
      .filter(
        (price) =>
          price !== null &&
          price !== undefined
      );

  if (
    !prices.length
  ) {
    return {
      currentPrice: null,
      mismatch: false,
    };
  }

  const currentPrice =
    prices[0];

  return {
    currentPrice,

    mismatch:
      prices.some(
        (price) =>
          Math.abs(
            price -
            currentPrice
          ) >
          ES_TICK_SIZE
      ),
  };
}

function maximalClusters(
  candidates
) {
  const groups = [];

  for (
    let start = 0;
    start <
    candidates.length;
    start += 1
  ) {
    const group = [];

    for (
      let end = start;
      end <
      candidates.length;
      end += 1
    ) {
      if (
        candidates[end]
          .price -
          candidates[start]
            .price >
        ES_CLUSTER_TOLERANCE
      ) {
        break;
      }

      group.push(
        candidates[end]
      );
    }

    if (
      group.length >= 2
    ) {
      groups.push(
        group
      );
    }
  }

  return groups.filter(
    (
      candidate,
      index
    ) => {
      const candidateDegrees =
        new Set(
          candidate.map(
            (item) =>
              item.degree
          )
        );

      return !groups.some(
        (
          other,
          otherIndex
        ) => {
          if (
            index ===
              otherIndex ||
            other.length <=
              candidate.length
          ) {
            return false;
          }

          return [
            ...candidateDegrees,
          ].every(
            (degree) =>
              other.some(
                (item) =>
                  item.degree ===
                  degree
              )
          );
        }
      );
    }
  );
}

function classifyCluster(
  direction,
  zoneLo,
  zoneHi,
  currentPrice,
  mismatch
) {
  if (
    mismatch ||
    currentPrice ===
      null
  ) {
    return "UNKNOWN";
  }

  if (
    direction ===
    "LONG"
  ) {
    return currentPrice <
      zoneLo
      ? "DIRECTIONAL_MAGNET"
      : "REACTION_OR_EXHAUSTION_ZONE";
  }

  return currentPrice >
    zoneHi
    ? "DIRECTIONAL_MAGNET"
    : "REACTION_OR_EXHAUSTION_ZONE";
}

function buildFibClusters(
  degreeReads
) {
  const priceAssessment =
    currentPriceAssessment(
      degreeReads
    );

  const clusters = [];

  for (
    const direction
    of [
      "LONG",
      "SHORT",
    ]
  ) {
    const candidates =
      DEGREE_KEYS
        .map(
          (degree) => {
            const read =
              degreeReads[
                degree
              ];

            if (
              !read?.usable ||
              read
                .preferredTradeDirection !==
                direction ||
              read
                .nextPrice ===
                null ||
              [
                "UNKNOWN",
                "COMPLETE",
              ].includes(
                read.nextFib
              )
            ) {
              return null;
            }

            return {
              degree,

              label:
                read.nextFib,

              price:
                read.nextPrice,
            };
          }
        )
        .filter(Boolean)
        .sort(
          (
            left,
            right
          ) =>
            left.price -
            right.price
        );

    for (
      const group
      of maximalClusters(
        candidates
      )
    ) {
      const prices =
        group.map(
          (item) =>
            item.price
        );

      const zoneLo =
        Math.min(
          ...prices
        );

      const zoneHi =
        Math.max(
          ...prices
        );

      clusters.push({
        active: true,

        direction,

        zoneLo:
          Number(
            zoneLo.toFixed(
              2
            )
          ),

        zoneHi:
          Number(
            zoneHi.toFixed(
              2
            )
          ),

        midpoint:
          Number(
            (
              (
                zoneLo +
                zoneHi
              ) /
              2
            ).toFixed(
              2
            )
          ),

        contributingDegrees:
          DEGREE_KEYS.filter(
            (degree) =>
              group.some(
                (item) =>
                  item.degree ===
                  degree
              )
          ),

        objectives:
          group.map(
            (item) => ({
              degree:
                item.degree,

              label:
                item.label,

              price:
                Number(
                  item
                    .price
                    .toFixed(
                      2
                    )
                ),
            })
          ),

        strength:
          group.length >= 4
            ? "VERY_HIGH"
            : group.length === 3
            ? "HIGH"
            : "MODERATE",

        classification:
          classifyCluster(
            direction,
            zoneLo,
            zoneHi,
            priceAssessment
              .currentPrice,
            priceAssessment
              .mismatch
          ),
      });
    }
  }

  return {
    clusters,

    currentPriceMismatch:
      priceAssessment
        .mismatch,
  };
}

function directionalReasonCode(
  state
) {
  return {
    STRONG_BULLISH_ALIGNMENT:
      "ENGINE27_ALIGNMENT_5_OF_5_LONG",

    BULLISH_ALIGNMENT:
      "ENGINE27_ALIGNMENT_4_OF_5_LONG",

    MIXED_BULLISH:
      "ENGINE27_ALIGNMENT_3_OF_5_LONG",

    STRONG_BEARISH_ALIGNMENT:
      "ENGINE27_ALIGNMENT_5_OF_5_SHORT",

    BEARISH_ALIGNMENT:
      "ENGINE27_ALIGNMENT_4_OF_5_SHORT",

    MIXED_BEARISH:
      "ENGINE27_ALIGNMENT_3_OF_5_SHORT",

    BALANCED:
      "ENGINE27_ALIGNMENT_BALANCED",

    CONFLICTED:
      "ENGINE27_ALIGNMENT_CONFLICTED",
  }[state];
}

function buildReasonCodes({
  counts,
  alignmentState,
  compatibility,
  warnings,
  fibClusters,
  currentPriceMismatch,
}) {
  const codes = [
    "ENGINE27_ALIGNMENT_READY",
  ];

  if (
    counts.usable <
    counts.total
  ) {
    codes.push(
      "ENGINE27_ALIGNMENT_PARTIAL_DATA"
    );
  }

  codes.push(
    directionalReasonCode(
      alignmentState
    )
  );

  if (
    Object.values(
      compatibility
    ).some(
      (item) =>
        item.status ===
        "PULLS_BACK_INSIDE_PARENT"
    )
  ) {
    codes.push(
      "ENGINE27_LOWER_DEGREE_PULLBACK"
    );
  }

  const warningCodeMap = {
    LOWER_DEGREES_WEAKENING:
      "ENGINE27_LOWER_DEGREES_WEAKENING",

    LOWER_DEGREES_REVERSING:
      "ENGINE27_LOWER_DEGREES_REVERSING",

    HIGHER_DEGREES_STILL_SUPPORTIVE:
      "ENGINE27_HIGHER_DEGREES_STILL_SUPPORTIVE",

    PRIMARY_W5_MATURITY_WARNING:
      "ENGINE27_PRIMARY_W5_MATURITY_WARNING",

    MULTI_DEGREE_LATE_STAGE_WARNING:
      "ENGINE27_MULTI_DEGREE_LATE_STAGE_WARNING",
  };

  for (
    const warning
    of warnings
  ) {
    codes.push(
      warningCodeMap[
        warning
      ]
    );
  }

  if (
    fibClusters.length
  ) {
    codes.push(
      "ENGINE27_FIB_CLUSTER_FOUND"
    );
  }

  if (
    currentPriceMismatch
  ) {
    codes.push(
      "ENGINE27_ALIGNMENT_CURRENT_PRICE_MISMATCH"
    );
  }

  return unique(
    codes
  );
}

function safeFallback() {
  const degreeReads =
    Object.fromEntries(
      DEGREE_KEYS.map(
        (degree) => [
          degree,
          buildDegreeRead(
            degree,
            null,
            null
          ),
        ]
      )
    );

  return {
    active: false,

    engine:
      "engine27.multiDegreeAlignment.v1",

    mode:
      "READ_ONLY",

    direction:
      "NEUTRAL",

    alignmentState:
      "INSUFFICIENT_DATA",

    confidence:
      "UNKNOWN",

    alignedDegrees: [],

    conflictingDegrees: [],

    neutralDegrees: [],

    unknownDegrees: [
      ...DEGREE_KEYS,
    ],

    counts: {
      long: 0,
      short: 0,
      neutral: 0,

      unknown:
        DEGREE_KEYS.length,

      usable: 0,

      total:
        DEGREE_KEYS.length,
    },

    degreeReads,

    waveStageCompatibility:
      buildWaveStageCompatibility(
        degreeReads
      ),

    lowerDegreeWarnings: [],

    fibClusters: [],

    maturity:
      "UNKNOWN",

    reasonCodes: [
      "ENGINE27_ALIGNMENT_INPUT_UNAVAILABLE",
    ],
  };
}

export function buildMultiDegreeAlignment({
  engine27WaveIntelligence,
  engine27FibIntelligence,
} = {}) {
  try {
    const waves =
      isObject(
        engine27WaveIntelligence
      )
        ? engine27WaveIntelligence
        : {};

    const fibs =
      isObject(
        engine27FibIntelligence
      )
        ? engine27FibIntelligence
        : {};

    const degreeReads = {};

    for (
      const degree
      of DEGREE_KEYS
    ) {
      try {
        degreeReads[
          degree
        ] =
          buildDegreeRead(
            degree,
            waves[
              degree
            ],
            fibs[
              degree
            ]
          );
      } catch {
        degreeReads[
          degree
        ] =
          buildDegreeRead(
            degree,
            null,
            null
          );
      }
    }

    const counts =
      buildCounts(
        degreeReads
      );

    if (
      counts.usable === 0
    ) {
      return safeFallback();
    }

    const alignmentState =
      determineAlignmentState(
        counts
      );

    const direction =
      directionForState(
        alignmentState
      );

    const groups =
      buildDirectionalGroups(
        degreeReads,
        direction
      );

    const compatibility =
      buildWaveStageCompatibility(
        degreeReads
      );

    const warnings =
      buildLowerDegreeWarnings(
        degreeReads,
        compatibility
      );

    const fibResult =
      buildFibClusters(
        degreeReads
      );

    return {
      active: true,

      engine:
        "engine27.multiDegreeAlignment.v1",

      mode:
        "READ_ONLY",

      direction,

      alignmentState,

      confidence:
        confidenceFor(
          alignmentState,
          counts
        ),

      alignedDegrees:
        groups
          .alignedDegrees,

      conflictingDegrees:
        groups
          .conflictingDegrees,

      neutralDegrees:
        groups
          .neutralDegrees,

      unknownDegrees:
        groups
          .unknownDegrees,

      counts,

      degreeReads,

      waveStageCompatibility:
        compatibility,

      lowerDegreeWarnings:
        warnings,

      fibClusters:
        fibResult
          .clusters,

      maturity:
        combinedMaturity(
          degreeReads
        ),

      reasonCodes:
        buildReasonCodes({
          counts,
          alignmentState,
          compatibility,
          warnings,

          fibClusters:
            fibResult
              .clusters,

          currentPriceMismatch:
            fibResult
              .currentPriceMismatch,
        }),
    };
  } catch {
    return safeFallback();
  }
}

export default buildMultiDegreeAlignment;
