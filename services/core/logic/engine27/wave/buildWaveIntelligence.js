// services/core/logic/engine27/wave/buildWaveIntelligence.js
// Engine 27A — Wave Intelligence
// Consumes only engine22WaveStrategy.degreeStates.

const DEGREE_KEYS = [
  "subminute",
  "minute",
  "minor",
  "intermediate",
  "primary",
];

const DEGREE_LABELS = {
  subminute: "Subminute",
  minute: "Minute",
  minor: "Minor",
  intermediate: "Intermediate",
  primary: "Primary",
};

const PARENT_DEGREES = {
  subminute: "minute",
  minute: "minor",
  minor: "intermediate",
  intermediate: "primary",
  primary: null,
};

const PREVIOUS_WAVE = {
  W1: "C",
  W2: "W1",
  W3: "W2",
  W4: "W3",
  W5: "W4",
  A: "W5",
  B: "A",
  C: "B",
  D: "C",
  E: "D",
  UNKNOWN: "UNKNOWN",
};

const NEXT_WAVE = {
  W1: "W2",
  W2: "W3",
  W3: "W4",
  W4: "W5",
  W5: "A",
  A: "B",
  B: "C",
  C: "W1",
  D: "E",
  E: "UNKNOWN",
  UNKNOWN: "UNKNOWN",
};

const VALID_WAVES = new Set([
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
]);

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

function normalizeWave(value) {
  const text = upper(value);

  if (!text) {
    return "UNKNOWN";
  }

  if (VALID_WAVES.has(text)) {
    return text;
  }

  const impulseMatch = text.match(
    /(?:^|[^A-Z0-9])W(?:AVE)?[\s_-]*([1-5])(?:$|[^A-Z0-9])/
  );

  if (impulseMatch) {
    return `W${impulseMatch[1]}`;
  }

  const correctionMatch = text.match(
    /(?:^|[^A-Z0-9])(?:WAVE[\s_-]*)?([A-E])(?:$|[^A-Z0-9])/
  );

  if (correctionMatch) {
    return correctionMatch[1];
  }

  return "UNKNOWN";
}

function resolveCurrentWave(state) {
  if (!isObject(state)) {
    return "UNKNOWN";
  }

  const candidates = [
    state.activeWave,
    state.currentWave,
    state.wave,
    state.lifecycle?.currentWave,
    state.currentRead,
  ];

  for (const candidate of candidates) {
    const normalized =
      normalizeWave(candidate);

    if (normalized !== "UNKNOWN") {
      return normalized;
    }
  }

  return "UNKNOWN";
}

function isTriangleState(state) {
  if (!isObject(state)) {
    return false;
  }

  const candidates = [
    state.correctionType,
    state.correctionModel?.type,
    state.correctionModel?.preferredType,
    state.correctionModels?.type,
    state.correctionModels?.preferredType,
    state.lifecycle?.correctionType,
    state.lifecycle?.modelType,
    state.nestedCorrectionContext
      ?.correctionType,
    state.nestedCorrectionContext
      ?.parentCorrectionType,
    state.headline,
    state.currentRead,
  ];

  return candidates.some((value) => {
    const text = upper(value);

    return (
      text.includes("TRIANGLE") ||
      text.includes("ABCDE")
    );
  });
}

function resolveNextWave(
  currentWave,
  state
) {
  if (
    currentWave === "C" &&
    isTriangleState(state)
  ) {
    return "D";
  }

  return (
    NEXT_WAVE[currentWave] ||
    "UNKNOWN"
  );
}

function normalizeTradeDirection(
  value,
  {
    allowUpDown = true,
  } = {}
) {
  const text = upper(value);

  if (!text) {
    return null;
  }

  const longPattern =
    /(?:^|[^A-Z0-9])(LONG|BULLISH|BULL|BUY)(?:$|[^A-Z0-9])/;

  const shortPattern =
    /(?:^|[^A-Z0-9])(SHORT|BEARISH|BEAR|SELL)(?:$|[^A-Z0-9])/;

  const neutralPattern =
    /(?:^|[^A-Z0-9])(NEUTRAL|SIDEWAYS|NONE|UNKNOWN|WAIT)(?:$|[^A-Z0-9])/;

  if (
    longPattern.test(text) ||
    (
      allowUpDown &&
      /(?:^|[^A-Z0-9])UP(?:$|[^A-Z0-9])/.test(
        text
      )
    )
  ) {
    return "LONG";
  }

  if (
    shortPattern.test(text) ||
    (
      allowUpDown &&
      /(?:^|[^A-Z0-9])DOWN(?:$|[^A-Z0-9])/.test(
        text
      )
    )
  ) {
    return "SHORT";
  }

  if (neutralPattern.test(text)) {
    return "NEUTRAL";
  }

  return null;
}

function normalizeLegDirection(value) {
  const text = upper(value);

  if (!text) {
    return null;
  }

  const tokens = text.match(
    /LONG|SHORT|BULLISH|BEARISH|BULL|BEAR|BUY|SELL|\bUP\b|\bDOWN\b|NEUTRAL|SIDEWAYS|NONE|UNKNOWN/g
  );

  if (!tokens?.length) {
    return null;
  }

  const token =
    tokens[tokens.length - 1];

  if (
    [
      "LONG",
      "BULLISH",
      "BULL",
      "BUY",
      "UP",
    ].includes(token)
  ) {
    return "UP";
  }

  if (
    [
      "SHORT",
      "BEARISH",
      "BEAR",
      "SELL",
      "DOWN",
    ].includes(token)
  ) {
    return "DOWN";
  }

  return "NEUTRAL";
}

function firstNormalized(
  candidates,
  normalizer,
  fallback
) {
  for (const candidate of candidates) {
    const normalized =
      normalizer(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return fallback;
}

function resolveStructuralDirection(
  state
) {
  if (!isObject(state)) {
    return "NEUTRAL";
  }

  return firstNormalized(
    [
      state.structuralDirection,
      state.structureDirection,
      state.lifecycle?.structuralDirection,
      state.lifecycle?.structureDirection,
      state.trendDirection,
      state.trendBias,
      state.biasDirection,
      state.bias,
      state.direction,
    ],
    (value) =>
      normalizeTradeDirection(
        value,
        {
          allowUpDown: true,
        }
      ),
    "NEUTRAL"
  );
}

function resolveCurrentLegDirection(
  state
) {
  if (!isObject(state)) {
    return "NEUTRAL";
  }

  const explicit =
    firstNormalized(
      [
        state.currentLegDirection,
        state.legDirection,
        state.activeLegDirection,
        state.currentDirection,
        state.lifecycle
          ?.currentLegDirection,
        state.lifecycle
          ?.legDirection,
        state.lifecycle
          ?.currentDirection,
        state.nestedCorrectionContext
          ?.currentLegDirection,
        state.nestedCorrectionContext
          ?.currentDirection,
        state.nestedCorrectionContext
          ?.currentChildDirection,
        state.correctionModel
          ?.currentLegDirection,
        state.correctionModel
          ?.direction,
      ],
      normalizeLegDirection,
      null
    );

  if (explicit) {
    return explicit;
  }

  return (
    normalizeLegDirection(
      state.direction
    ) ||
    "NEUTRAL"
  );
}

function resolveNextExpectedDirection(
  state
) {
  if (!isObject(state)) {
    return "NEUTRAL";
  }

  return firstNormalized(
    [
      state.nextExpectedDirection,
      state.nextDirection,
      state.lifecycle
        ?.nextExpectedDirection,
      state.lifecycle
        ?.nextDirection,
      state.nestedCorrectionContext
        ?.nextExpectedDirection,
      state.nestedCorrectionContext
        ?.nextDirection,
      state.nestedCorrectionContext
        ?.nextExpected,
      state.nestedCorrectionContext
        ?.expectedPath,
    ],
    normalizeLegDirection,
    "NEUTRAL"
  );
}

function resolvePreferredTradeDirection(
  state,
  structuralDirection
) {
  if (!isObject(state)) {
    return "NEUTRAL";
  }

  return firstNormalized(
    [
      state.preferredTradeDirection,
      state.tradeDirection,
      state.preferredDirection,
      state.lifecycle
        ?.preferredTradeDirection,
      state.lifecycle
        ?.preferredDirection,
      structuralDirection,
    ],
    (value) =>
      normalizeTradeDirection(value),
    "NEUTRAL"
  );
}

function collectStageText(state) {
  return [
    state?.stage,
    state?.status,
    state?.state,
    state?.lifecycle?.stage,
    state?.lifecycle?.status,
    state?.activeWave,
    state?.currentWave,
  ].map(upper);
}

function resolveStage(
  state,
  hasWave
) {
  if (!isObject(state)) {
    return "WATCH";
  }

  const stageValues =
    collectStageText(state);

  const hasText = (pattern) =>
    stageValues.some((value) =>
      pattern.test(value)
    );

  const invalidated =
    state.invalidated === true ||
    state.isInvalidated === true ||
    state.lifecycle
      ?.invalidated === true ||
    hasText(/INVALID/);

  if (invalidated) {
    return "INVALIDATED";
  }

  const complete =
    state.complete === true ||
    state.completed === true ||
    state.isComplete === true ||
    state.lifecycle?.complete === true ||
    state.lifecycle
      ?.completed === true ||
    hasText(/COMPLETE|COMPLETED/);

  if (complete) {
    return "COMPLETE";
  }

  const active =
    state.active === true ||
    state.isActive === true ||
    state.lifecycle?.active === true ||
    hasText(
      /(?:^|[^A-Z0-9])ACTIVE(?:$|[^A-Z0-9])/
    );

  if (
    active &&
    hasWave
  ) {
    return "ACTIVE";
  }

  const watch =
    state.watch === true ||
    state.watchOnly === true ||
    state.lifecycle?.watch === true ||
    hasText(/WATCH/);

  if (watch) {
    return "WATCH";
  }

  const projected =
    state.projected === true ||
    state.isProjected === true ||
    state.lifecycle
      ?.projected === true ||
    hasText(/PROJECTED/);

  if (projected) {
    return "PROJECTED";
  }

  return "WATCH";
}

function normalizeMaturity(value) {
  const text = upper(value);

  if (!text) {
    return null;
  }

  if (text.includes("INVALID")) {
    return "INVALIDATED";
  }

  if (
    text.includes("COMPLETE") ||
    text.includes("COMPLETED")
  ) {
    return "COMPLETE";
  }

  if (
    /(?:^|[^A-Z0-9])EARLY(?:$|[^A-Z0-9])/.test(
      text
    ) ||
    text.includes("FORMING") ||
    text.includes("STARTING")
  ) {
    return "EARLY";
  }

  if (
    /(?:^|[^A-Z0-9])MID(?:$|[^A-Z0-9])/.test(
      text
    ) ||
    text.includes("MIDDLE") ||
    text.includes("DEVELOPING") ||
    text.includes("IN_PROGRESS") ||
    text.includes("IN PROGRESS")
  ) {
    return "MID";
  }

  if (
    /(?:^|[^A-Z0-9])LATE(?:$|[^A-Z0-9])/.test(
      text
    ) ||
    text.includes("MATURE") ||
    text.includes("EXTENDED") ||
    text.includes("EXHAUST") ||
    text.includes("NEAR_COMPLETE") ||
    text.includes("NEAR COMPLETE") ||
    text.includes("COMPLETING")
  ) {
    return "LATE";
  }

  if (
    text === "UNKNOWN" ||
    text === "NONE"
  ) {
    return "UNKNOWN";
  }

  return null;
}

function resolveMaturity({
  state,
  currentWave,
  stage,
}) {
  if (stage === "INVALIDATED") {
    return "INVALIDATED";
  }

  if (stage === "COMPLETE") {
    return "COMPLETE";
  }

  if (currentWave === "UNKNOWN") {
    return "UNKNOWN";
  }

  const waveState =
    state?.waveStates?.[
      currentWave
    ] ||
    state?.waves?.[
      currentWave
    ] ||
    state?.marks?.[
      currentWave
    ] ||
    state?.activeWaveState ||
    null;

  return firstNormalized(
    [
      state?.maturity,
      state?.waveMaturity,
      state?.lifecycle?.maturity,
      state?.lifecycle
        ?.waveMaturity,
      waveState?.maturity,
      waveState?.waveMaturity,
      waveState?.status,
      waveState?.stage,
      state?.correctionModel
        ?.maturity,
      state?.correctionModel?.stage,
    ],
    normalizeMaturity,
    "UNKNOWN"
  );
}

function waveText(wave) {
  if (/^W[1-5]$/.test(wave)) {
    return `Wave ${wave.slice(1)}`;
  }

  if (
    [
      "A",
      "B",
      "C",
      "D",
      "E",
    ].includes(wave)
  ) {
    return `Wave ${wave}`;
  }

  return "an unknown wave";
}

function stageText(stage) {
  const labels = {
    ACTIVE: "Active",
    WATCH: "Watch",
    PROJECTED: "Projected",
    COMPLETE: "Complete",
    INVALIDATED: "Invalidated",
  };

  return labels[stage] || stage;
}

function buildHeadline({
  degree,
  currentWave,
  stage,
  unavailable,
}) {
  if (unavailable) {
    return `${degree} Wave State Unavailable`;
  }

  return `${degree} ${currentWave} ${stageText(
    stage
  )}`;
}

function buildCurrentRead({
  degree,
  currentWave,
  currentLegDirection,
  stage,
  unavailable,
}) {
  if (unavailable) {
    return `${degree} wave state is unavailable.`;
  }

  const wave =
    waveText(currentWave);

  if (stage === "INVALIDATED") {
    return `${degree} ${wave} is invalidated.`;
  }

  if (stage === "COMPLETE") {
    return `${degree} ${wave} is complete.`;
  }

  if (stage === "PROJECTED") {
    return `${degree} ${wave} is projected.`;
  }

  if (stage === "WATCH") {
    return `${degree} ${wave} is on watch.`;
  }

  if (
    currentLegDirection === "UP"
  ) {
    return `${degree} is currently advancing in ${wave}.`;
  }

  if (
    currentLegDirection === "DOWN"
  ) {
    return `${degree} is currently declining in ${wave}.`;
  }

  return `${degree} is currently in ${wave}.`;
}

function buildAction({
  currentWave,
  nextExpectedWave,
  stage,
  unavailable,
}) {
  if (unavailable) {
    return "WAIT_FOR_ENGINE22_STATE";
  }

  if (stage === "INVALIDATED") {
    return "WAIT_FOR_NEW_ENGINE22_STRUCTURE";
  }

  if (stage === "COMPLETE") {
    if (currentWave === "E") {
      return "WAIT_FOR_TRIANGLE_RESOLUTION";
    }

    if (
      nextExpectedWave ===
      "UNKNOWN"
    ) {
      return "WAIT_FOR_ENGINE22_CONFIRMATION";
    }

    return `WATCH_FOR_${nextExpectedWave}`;
  }

  if (stage === "PROJECTED") {
    return `WATCH_PROJECTED_${currentWave}`;
  }

  if (stage === "WATCH") {
    return `WATCH_${currentWave}`;
  }

  if (
    [
      "W2",
      "W4",
    ].includes(currentWave)
  ) {
    return `WAIT_FOR_${currentWave}_COMPLETION`;
  }

  if (
    [
      "W1",
      "W3",
      "W5",
    ].includes(currentWave)
  ) {
    return "TRACK_CONTINUATION";
  }

  if (
    [
      "A",
      "B",
      "C",
      "D",
      "E",
    ].includes(currentWave)
  ) {
    return "TRACK_CORRECTION";
  }

  return "TRACK_STRUCTURE";
}

function buildReasonCodes({
  degreeKey,
  currentWave,
  structuralDirection,
  currentLegDirection,
  nextExpectedWave,
  nextExpectedDirection,
  preferredTradeDirection,
  stage,
  maturity,
  active,
  invalidated,
  unavailable,
}) {
  return unique([
    unavailable
      ? "ENGINE27_WAVE_STATE_UNAVAILABLE"
      : null,

    `ENGINE27_DEGREE_${degreeKey.toUpperCase()}`,

    `ENGINE27_WAVE_${currentWave}`,

    `ENGINE27_STAGE_${stage}`,

    `ENGINE27_DIRECTION_${structuralDirection}`,

    `ENGINE27_CURRENT_LEG_${currentLegDirection}`,

    `ENGINE27_NEXT_${nextExpectedWave}`,

    `ENGINE27_NEXT_DIRECTION_${nextExpectedDirection}`,

    `ENGINE27_PREFERRED_${preferredTradeDirection}`,

    `ENGINE27_MATURITY_${maturity}`,

    active
      ? "ENGINE27_WAVE_ACTIVE"
      : "ENGINE27_WAVE_INACTIVE",

    invalidated
      ? "ENGINE27_WAVE_INVALIDATED"
      : null,
  ]);
}

function buildDegreeIntelligence(
  degreeKey,
  state
) {
  const degree =
    DEGREE_LABELS[degreeKey];

  const currentWave =
    resolveCurrentWave(state);

  const hasWave =
    currentWave !== "UNKNOWN";

  const unavailable =
    !isObject(state) ||
    !hasWave;

  const stage =
    resolveStage(
      state,
      hasWave
    );

  const invalidated =
    stage === "INVALIDATED";

  const active =
    stage === "ACTIVE" &&
    hasWave &&
    !invalidated;

  const structuralDirection =
    resolveStructuralDirection(
      state
    );

  const currentLegDirection =
    resolveCurrentLegDirection(
      state
    );

  const nextExpectedWave =
    resolveNextWave(
      currentWave,
      state
    );

  const nextExpectedDirection =
    resolveNextExpectedDirection(
      state
    );

  const preferredTradeDirection =
    resolvePreferredTradeDirection(
      state,
      structuralDirection
    );

  const maturity =
    resolveMaturity({
      state,
      currentWave,
      stage,
    });

  const parentKey =
    PARENT_DEGREES[
      degreeKey
    ];

  const output = {
    degree,

    currentWave,

    previousWave:
      PREVIOUS_WAVE[
        currentWave
      ] ||
      "UNKNOWN",

    nextExpectedWave,

    structuralDirection,

    currentLegDirection,

    nextExpectedDirection,

    preferredTradeDirection,

    stage,

    maturity,

    active,

    invalidated,

    parentDegree:
      parentKey
        ? DEGREE_LABELS[
            parentKey
          ]
        : null,

    parentWave: null,

    currentRead:
      buildCurrentRead({
        degree,
        currentWave,
        currentLegDirection,
        stage,
        unavailable,
      }),

    action:
      buildAction({
        currentWave,
        nextExpectedWave,
        stage,
        unavailable,
      }),

    headline:
      buildHeadline({
        degree,
        currentWave,
        stage,
        unavailable,
      }),

    reasonCodes: [],
  };

  output.reasonCodes =
    buildReasonCodes({
      degreeKey,
      currentWave,
      structuralDirection,
      currentLegDirection,
      nextExpectedWave,
      nextExpectedDirection,
      preferredTradeDirection,
      stage,
      maturity,
      active,
      invalidated,
      unavailable,
    });

  return output;
}

export function buildWaveIntelligence({
  degreeStates,
} = {}) {
  const states =
    isObject(degreeStates)
      ? degreeStates
      : {};

  const engine27WaveIntelligence =
    {};

  for (
    const degreeKey
    of DEGREE_KEYS
  ) {
    engine27WaveIntelligence[
      degreeKey
    ] =
      buildDegreeIntelligence(
        degreeKey,
        states[
          degreeKey
        ] ||
          null
      );
  }

  for (
    const degreeKey
    of DEGREE_KEYS
  ) {
    const parentKey =
      PARENT_DEGREES[
        degreeKey
      ];

    if (!parentKey) {
      engine27WaveIntelligence[
        degreeKey
      ].parentDegree = null;

      engine27WaveIntelligence[
        degreeKey
      ].parentWave = null;

      continue;
    }

    const parentWave =
      engine27WaveIntelligence[
        parentKey
      ]?.currentWave ||
      "UNKNOWN";

    engine27WaveIntelligence[
      degreeKey
    ].parentWave =
      parentWave;

    engine27WaveIntelligence[
      degreeKey
    ].reasonCodes =
      unique([
        ...engine27WaveIntelligence[
          degreeKey
        ].reasonCodes,

        `ENGINE27_PARENT_${parentKey.toUpperCase()}_${parentWave}`,
      ]);
  }

  return engine27WaveIntelligence;
}

export default buildWaveIntelligence;
