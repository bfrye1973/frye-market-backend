// services/core/logic/engine27/decision/buildTraderDecision.js
// Engine 27E — Trader Decision
//
// Canonical inputs:
// - engine27WaveIntelligence
// - engine27FibIntelligence
// - engine27Alignment
// - engine27MarketStory
// - existing Engine 27 Alpha lane decisions
//
// Engine 27E owns:
// - normalized trader decision state
// - lane-specific readiness
// - actionable waiting conditions
// - trader-facing recommended action
// - read-only paper-pipeline visibility
//
// Engine 27E does not own:
// - permission creation
// - position sizing
// - geometry creation
// - entry, stop, or target creation
// - ticket creation
// - broker calls
// - Schwab calls
// - execution
// - journal writes

const ENGINE_NAME =
  "engine27.traderDecision.v1";

const LANE_ORDER = [
  "subminute",
  "minute",
  "minor",
  "intermediate",
  "primary",
];

const FAST_LANES = new Set([
  "subminute",
  "minute",
]);

const LANE_REGISTRY = {
  subminute: {
    laneId: "subminute",
    degree: "subminute",
    strategyId: "subminute_scalp@10m",
    displayName: "Subminute",
  },

  minute: {
    laneId: "minute",
    degree: "minute",
    strategyId: "intraday_scalp@10m",
    displayName: "Minute",
  },

  minor: {
    laneId: "minor",
    degree: "minor",
    strategyId: "minor_swing@1h",
    displayName: "Minor",
  },

  intermediate: {
    laneId: "intermediate",
    degree: "intermediate",
    strategyId: "intermediate_long@4h",
    displayName: "Intermediate",
  },

  primary: {
    laneId: "primary",
    degree: "primary",
    strategyId: "primary_position@1d",
    displayName: "Primary",
  },
};

const PARENT_COMPATIBILITY_PATHS = {
  subminute: "minuteToSubminute",
  minute: "minorToMinute",
  minor: "intermediateToMinor",
  intermediate: "primaryToIntermediate",
  primary: null,
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
  "UNKNOWN",
]);

const VALID_PARENT_COMPATIBILITY = new Set([
  "CONFIRMS_PARENT",
  "PULLS_BACK_INSIDE_PARENT",
  "CONFLICTS_WITH_PARENT",
  "UNKNOWN",
]);

const ALLOWED_PERMISSION_DECISIONS = new Set([
  "FAST_INTRADAY_PAPER_ALLOW",
  "PAPER_ALLOW",
]);

const OPPORTUNITY_PRIORITY = [
  "TRIGGERED",
  "READY",
  "ALMOST_READY",
  "APPROACHING",
  "SETTING_UP",
  "ACTIVE",
  "IDLE",
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

function safeArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function normalizeIdentityValue(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function buildPipelineIdentity({
  engine26LocationCandidate = null,
  engine26Planner = null,
  engine3AuthorizedReaction = null,
  engine4AuthorizedParticipation = null,
  engine6Permission = null,
} = {}) {
  const candidateIds = [
    engine26LocationCandidate?.candidateId,
    engine26Planner?.candidateId,
    engine3AuthorizedReaction?.candidateId,
    engine4AuthorizedParticipation?.candidateId,
    engine6Permission?.candidateId,
  ]
    .map(normalizeIdentityValue)
    .filter(Boolean);

  const zoneIds = [
    engine26LocationCandidate?.zoneId,
    engine26Planner?.zoneId,
    engine3AuthorizedReaction?.zoneId,
    engine4AuthorizedParticipation?.zoneId,
    engine6Permission?.zoneId,
  ]
    .map(normalizeIdentityValue)
    .filter(Boolean);

  const candidateId =
    candidateIds[0] ?? null;

  const zoneId =
    zoneIds[0] ?? null;

  const candidateIdConsistent =
    candidateIds.length <= 1 ||
    candidateIds.every(
      (value) => value === candidateId
    );

  const zoneIdConsistent =
    zoneIds.length <= 1 ||
    zoneIds.every(
      (value) => value === zoneId
    );

  return {
    candidateId,
    zoneId,

    strategyId:
      normalizeIdentityValue(
        engine26LocationCandidate?.strategyId ??
        engine26Planner?.strategyId ??
        engine3AuthorizedReaction?.strategyId ??
        engine4AuthorizedParticipation?.strategyId ??
        engine6Permission?.strategyId
      ),

    symbol:
      normalizeIdentityValue(
        engine26LocationCandidate?.symbol ??
        engine26Planner?.symbol ??
        engine3AuthorizedReaction?.symbol ??
        engine4AuthorizedParticipation?.symbol ??
        engine6Permission?.symbol
      ),

    setupType:
      normalizeIdentityValue(
        engine26LocationCandidate?.setupType ??
        engine26Planner?.setupType ??
        engine3AuthorizedReaction?.setupType ??
        engine4AuthorizedParticipation?.setupType ??
        engine6Permission?.setupType
      ),

    snapshotTime:
      normalizeIdentityValue(
        engine26LocationCandidate?.snapshotTime ??
        engine26Planner?.snapshotTime ??
        engine3AuthorizedReaction?.snapshotTime ??
        engine4AuthorizedParticipation?.snapshotTime ??
        engine6Permission?.snapshotTime
      ),

    candidateIdConsistent,
    zoneIdConsistent,

    consistent:
      candidateIdConsistent &&
      zoneIdConsistent,

    complete:
      Boolean(
        candidateId &&
        zoneId
      ),
  };
}

function buildExplicitPipelineReadiness({
  engine26Planner = null,
  engine3AuthorizedReaction = null,
  engine4AuthorizedParticipation = null,
  engine6Permission = null,
} = {}) {
  const engine3State =
    upper(
      engine3AuthorizedReaction
        ?.authorizedReactionState
    );

  const engine4Status =
    upper(
      engine4AuthorizedParticipation
        ?.status
    );

  const engine6Decision =
    upper(
      engine6Permission?.decision
    );

  const plannerStatus =
    upper(
      engine26Planner?.status
    );

  return {
    available:
      Boolean(
        engine3AuthorizedReaction ||
        engine4AuthorizedParticipation ||
        engine6Permission ||
        engine26Planner
      ),

    reactionReady:
      engine3AuthorizedReaction
        ?.authorized === true &&
      engine3AuthorizedReaction
        ?.allowed === true &&
      engine3State ===
        "REACTION_CONFIRMED",

    participationReady:
      engine4AuthorizedParticipation
        ?.allowed === true &&
      engine4AuthorizedParticipation
        ?.confirmed === true &&
      engine4AuthorizedParticipation
        ?.hardBlocked !== true &&
      engine4Status ===
        "PARTICIPATION_CONFIRMED",

    permissionReady:
      engine6Permission
        ?.allowed === true &&
      ALLOWED_PERMISSION_DECISIONS.has(
        engine6Decision
      ),

    plannerReady:
      engine26Planner
        ?.active === true &&
      [
        "FAST_INTRADAY_PAPER_TICKET_READY",
        "READY_TO_PAPER_EXECUTE",
      ].includes(
        plannerStatus
      ),

    engine3State:
      engine3State || null,

    engine4Status:
      engine4Status || null,

    engine6Decision:
      engine6Decision || null,

    plannerStatus:
      plannerStatus || null,
  };
}

function normalizeDirection(value) {
  const direction = upper(value);

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
  const wave = upper(value);

  return VALID_WAVES.has(wave)
    ? wave
    : "UNKNOWN";
}

function normalizeInternalWave(value) {
  const wave = String(value ?? "")
    .trim();

  if (!wave) {
    return "UNKNOWN";
  }

  const normalized = wave.toLowerCase();

  if (
    [
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
    ].includes(normalized)
  ) {
    return normalized;
  }

  return "UNKNOWN";
}

function normalizeProximity(value) {
  const proximity = upper(value);

  if (
    [
      "FAR",
      "APPROACHING",
      "AT_LEVEL",
      "UNKNOWN",
    ].includes(proximity)
  ) {
    return proximity;
  }

  return "UNKNOWN";
}

function defaultCurrentFib() {
  return {
    lastCompleted: "UNKNOWN",
    next: "UNKNOWN",
  };
}

function normalizeCurrentFib(value) {
  if (!isObject(value)) {
    return defaultCurrentFib();
  }

  return {
    lastCompleted:
      value.lastCompleted ??
      "UNKNOWN",

    next:
      value.next ??
      "UNKNOWN",
  };
}

function isValidInternalPullback(wave) {
  return (
    upper(
      wave?.pullbackClassification
    ) === "INTERNAL_PULLBACK" &&
    wave?.parentWaveStillValid === true &&
    wave?.parentWaveComplete !== true &&
    wave?.parentTransitionPossible !== true &&
    wave?.invalidationBreached !== true &&
    wave?.invalidated !== true
  );
}

function resolveDirection({
  degree,
  alpha,
  wave,
  alignment,
}) {
  /*
   * A valid nested internal pullback preserves the parent
   * continuation direction.
   *
   * Example:
   * - Parent Subminute W3 = LONG
   * - Internal wave iv leg = DOWN
   * - Engine 3 tactical reaction = SHORT
   *
   * Engine 27E must remain LONG because the SHORT reaction is
   * occurring inside a still-valid internal correction.
   */
  if (
    isValidInternalPullback(
      wave
    )
  ) {
    const parentDirection =
      normalizeDirection(
        wave?.parentWaveDirection
      );

    if (
      [
        "LONG",
        "SHORT",
      ].includes(
        parentDirection
      )
    ) {
      return parentDirection;
    }

    const preferredDirection =
      normalizeDirection(
        wave?.preferredTradeDirection
      );

    if (
      [
        "LONG",
        "SHORT",
      ].includes(
        preferredDirection
      )
    ) {
      return preferredDirection;
    }

    const structuralDirection =
      normalizeDirection(
        wave?.structuralDirection
      );

    if (
      [
        "LONG",
        "SHORT",
      ].includes(
        structuralDirection
      )
    ) {
      return structuralDirection;
    }
  }

  /*
   * Outside a valid internal pullback, fast tactical lanes may
   * temporarily follow the approved Alpha reaction direction.
   */
  if (
    FAST_LANES.has(
      degree
    )
  ) {
    const tacticalDirection =
      normalizeDirection(
        alpha
          ?.reaction
          ?.direction
      );

    if (
      [
        "LONG",
        "SHORT",
      ].includes(
        tacticalDirection
      )
    ) {
      return tacticalDirection;
    }
  }

  const waveDirection =
    normalizeDirection(
      wave
        ?.preferredTradeDirection
    );

  if (
    [
      "LONG",
      "SHORT",
    ].includes(
      waveDirection
    )
  ) {
    return waveDirection;
  }

  const alphaDirection =
    normalizeDirection(
      alpha?.direction
    );

  if (
    [
      "LONG",
      "SHORT",
    ].includes(
      alphaDirection
    )
  ) {
    return alphaDirection;
  }

  const alignmentDirection =
    normalizeDirection(
      alignment?.direction
    );

  if (
    [
      "LONG",
      "SHORT",
    ].includes(
      alignmentDirection
    )
  ) {
    return alignmentDirection;
  }

  return "NEUTRAL";
}

function resolveParentCompatibility({
  degree,
  alignment,
}) {
  const path =
    PARENT_COMPATIBILITY_PATHS[
      degree
    ];

  if (!path) {
    return "UNKNOWN";
  }

  const status = upper(
    alignment
      ?.waveStageCompatibility
      ?.[path]
      ?.status
  );

  return VALID_PARENT_COMPATIBILITY.has(
    status
  )
    ? status
    : "UNKNOWN";
}

function resolveHigherDegreeSupport({
  degree,
  direction,
  alignment,
}) {
  if (
    ![
      "LONG",
      "SHORT",
    ].includes(direction)
  ) {
    return false;
  }

  const alignmentDirection =
    normalizeDirection(
      alignment?.direction
    );

  const conflictingDegrees =
    safeArray(
      alignment
        ?.conflictingDegrees
    );

  return (
    direction ===
      alignmentDirection &&
    !conflictingDegrees.includes(
      degree
    )
  );
}

function resolveHigherTimeframeConflict({
  direction,
  alpha,
}) {
  if (
    direction === "LONG"
  ) {
    return (
      alpha
        ?.higherTimeframeContext
        ?.conflictsWithLong === true
    );
  }

  if (
    direction === "SHORT"
  ) {
    return (
      alpha
        ?.higherTimeframeContext
        ?.conflictsWithShort === true
    );
  }

  return false;
}

function resolvePermissionReady(alpha) {
  const permission =
    alpha
      ?.permissionContext ||
    {};

  const decision = upper(
    permission.engine6Decision
  );

  return (
    ALLOWED_PERMISSION_DECISIONS.has(
      decision
    ) &&
    permission.engine6Allowed ===
      true
  );
}

function resolvePlannerReady({
  degree,
  alpha,
}) {
  if (
    !FAST_LANES.has(
      degree
    )
  ) {
    return false;
  }

  return (
    upper(
      alpha
        ?.plannerContext
        ?.status
    ) ===
      "FAST_INTRADAY_PAPER_TICKET_READY" &&
    alpha
      ?.plannerContext
      ?.ready === true
  );
}

function resolveInvalidated({
  alpha,
  wave,
}) {
  return (
    upper(
      alpha?.decision
    ) ===
      "INVALIDATED" ||
    wave?.invalidated ===
      true ||
    wave?.invalidationBreached ===
      true ||
    upper(
      wave?.stage
    ) ===
      "INVALIDATED"
  );
}

function resolveReactionReady(alpha) {
  return (
    alpha
      ?.reaction
      ?.confirmed ===
      true &&
    alpha
      ?.reaction
      ?.directionMatches !==
      false
  );
}

function resolveParticipationReady(
  alpha
) {
  return (
    alpha
      ?.participation
      ?.allowed ===
      true &&
    alpha
      ?.participation
      ?.hardBlocked !==
      true
  );
}

function resolveStructureReady({
  alpha,
  wave,
  direction,
  invalidated,
}) {
  return (
    alpha?.active === true &&
    normalizeWave(
      wave?.currentWave
    ) !== "UNKNOWN" &&
    [
      "LONG",
      "SHORT",
    ].includes(direction) &&
    invalidated !== true
  );
}

function buildReadiness({
  degree,
  alpha,
  wave,
  direction,
  proximity,
}) {
  const invalidated =
    resolveInvalidated({
      alpha,
      wave,
    });

  const structureReady =
    resolveStructureReady({
      alpha,
      wave,
      direction,
      invalidated,
    });

  const priceReady =
    proximity ===
    "AT_LEVEL";

  const reactionReady =
    resolveReactionReady(
      alpha
    );

  const participationReady =
    resolveParticipationReady(
      alpha
    );

  const permissionReady =
    resolvePermissionReady(
      alpha
    );

  const plannerReady =
    resolvePlannerReady({
      degree,
      alpha,
    });

  return {
    structureReady,
    priceReady,
    reactionReady,
    participationReady,
    permissionReady,
    plannerReady,
    invalidated,
  };
}

function buildWaitingFor({
  degree,
  alpha,
  wave,
  proximity,
  readiness,
  higherTimeframeConflict,
}) {
  const waitingFor = [];

  const currentWave =
    normalizeWave(
      wave?.currentWave
    );

  const validInternalPullback =
    isValidInternalPullback(
      wave
    );

  if (
    currentWave ===
    "UNKNOWN"
  ) {
    waitingFor.push(
      "ENGINE27_INTELLIGENCE_INPUT"
    );
  }

  if (
    validInternalPullback
  ) {
    waitingFor.push(
      "INTERNAL_PULLBACK_COMPLETION"
    );
  } else if (
    readiness
      .structureReady !==
      true &&
    currentWave !==
      "UNKNOWN" &&
    readiness
      .invalidated !==
      true
  ) {
    waitingFor.push(
      "STRUCTURAL_RECLAIM"
    );
  }

  if (
    proximity === "FAR"
  ) {
    waitingFor.push(
      "PRICE_TO_APPROACH_ACTIVE_LEVEL"
    );
  }

  if (
    readiness
      .reactionReady !==
    true
  ) {
    waitingFor.push(
      "ENGINE3_DIRECTIONAL_REACTION"
    );
  }

  if (
    alpha
      ?.participation
      ?.hardBlocked ===
      true
  ) {
    waitingFor.push(
      "ENGINE4_HARD_BLOCK_TO_CLEAR"
    );
  } else if (
    readiness
      .participationReady !==
      true
  ) {
    waitingFor.push(
      "ENGINE4_PARTICIPATION"
    );
  }

  if (
    readiness
      .permissionReady !==
    true
  ) {
    if (
      alpha
        ?.permissionContext
        ?.engine15Required ===
      true
    ) {
      waitingFor.push(
        "ENGINE15_APPROVAL"
      );
    } else if (
      FAST_LANES.has(
        degree
      )
    ) {
      waitingFor.push(
        "ENGINE6_FAST_PAPER_PERMISSION"
      );
    } else {
      waitingFor.push(
        "ENGINE6_PERMISSION"
      );
    }
  }

  if (
    FAST_LANES.has(
      degree
    ) &&
    readiness
      .plannerReady !==
      true
  ) {
    waitingFor.push(
      "ENGINE26_PLANNER_GEOMETRY"
    );
  }

  if (
    higherTimeframeConflict
  ) {
    waitingFor.push(
      "HIGHER_TIMEFRAME_CONFLICT_TO_CLEAR"
    );
  }

  if (
    !validInternalPullback &&
    [
      "W2",
      "W4",
    ].includes(
      currentWave
    ) &&
    readiness
      .structureReady ===
      true
  ) {
    waitingFor.push(
      `${currentWave}_COMPLETION`
    );
  }

  return unique(
    waitingFor
  );
}

function countMajorMissing({
  degree,
  readiness,
  higherTimeframeConflict,
}) {
  const checks = [
    readiness.reactionReady,
    readiness.participationReady,
    readiness.permissionReady,
    !higherTimeframeConflict,
  ];

  if (
    FAST_LANES.has(
      degree
    )
  ) {
    checks.push(
      readiness.plannerReady
    );
  }

  return checks.filter(
    (value) =>
      value !== true
  ).length;
}

function determineDecisionState({
  degree,
  alpha,
  wave,
  proximity,
  readiness,
  higherTimeframeConflict,
}) {
  if (
    readiness.invalidated ===
    true
  ) {
    return "INVALIDATED";
  }

  const alphaDecision =
    upper(
      alpha?.decision
    );

  const currentWave =
    normalizeWave(
      wave?.currentWave
    );

  if (
    !isObject(alpha) ||
    currentWave ===
      "UNKNOWN" ||
    alphaDecision ===
      "IGNORE" ||
    alpha?.active !== true
  ) {
    return "IDLE";
  }

  /*
   * A valid internal pullback remains SETTING_UP regardless of:
   * - price being at an active level
   * - permission already being allowed
   * - planner geometry already being ready
   *
   * The parent continuation setup cannot become READY until the
   * internal pullback has completed.
   */
  if (
    isValidInternalPullback(
      wave
    )
  ) {
    return "SETTING_UP";
  }

  if (
    readiness
      .structureReady !==
    true
  ) {
    return "SETTING_UP";
  }

  if (
    proximity === "FAR"
  ) {
    return "SETTING_UP";
  }

  if (
    proximity ===
    "APPROACHING"
  ) {
    return "APPROACHING";
  }

  if (
    proximity ===
    "AT_LEVEL"
  ) {
    const majorMissing =
      countMajorMissing({
        degree,
        readiness,
        higherTimeframeConflict,
      });

    if (
      majorMissing === 0
    ) {
      return "READY";
    }

    if (
      majorMissing === 1
    ) {
      return "ALMOST_READY";
    }

    return "APPROACHING";
  }

  if (
    alphaDecision ===
    "WATCH"
  ) {
    return "APPROACHING";
  }

  return "SETTING_UP";
}

function buildBlockers({
  alpha,
  readiness,
}) {
  return unique([
    readiness.invalidated
      ? "STRATEGY_INVALIDATED"
      : null,

    alpha
      ?.participation
      ?.hardBlocked ===
      true
      ? "ENGINE4_HARD_BLOCK"
      : null,
  ]);
}

function buildWarnings({
  degree,
  alpha,
  wave,
  alignment,
  parentCompatibility,
  higherTimeframeConflict,
  readiness,
}) {
  const alignmentWarnings =
    safeArray(
      alignment
        ?.lowerDegreeWarnings
    );

  const warnings = [];

  if (
    isValidInternalPullback(
      wave
    )
  ) {
    warnings.push(
      "INTERNAL_PULLBACK_ACTIVE"
    );
  }

  if (
    parentCompatibility ===
    "CONFLICTS_WITH_PARENT"
  ) {
    warnings.push(
      "PARENT_CHILD_CONFLICT"
    );
  }

  if (
    alignmentWarnings.includes(
      "LOWER_DEGREES_REVERSING"
    )
  ) {
    warnings.push(
      "LOWER_DEGREES_REVERSING"
    );
  }

  if (
    alignmentWarnings.includes(
      "MULTI_DEGREE_LATE_STAGE_WARNING"
    )
  ) {
    warnings.push(
      "MULTI_DEGREE_LATE_STAGE_WARNING"
    );
  }

  if (
    degree === "primary" &&
    alignmentWarnings.includes(
      "PRIMARY_W5_MATURITY_WARNING"
    )
  ) {
    warnings.push(
      "PRIMARY_W5_MATURITY_WARNING"
    );
  }

  if (
    higherTimeframeConflict
  ) {
    warnings.push(
      "HIGHER_TIMEFRAME_WICK_CONFLICT"
    );
  }

  if (
    FAST_LANES.has(
      degree
    ) &&
    readiness.plannerReady !==
      true
  ) {
    warnings.push(
      "ENGINE26_PLANNER_UNAVAILABLE"
    );
  }

  if (
    readiness.permissionReady !==
      true
  ) {
    warnings.push(
      alpha
        ?.permissionContext
        ?.engine15Required ===
        true
        ? "ENGINE15_APPROVAL_UNAVAILABLE"
        : "ENGINE6_PERMISSION_UNAVAILABLE"
    );
  }

  if (
    parentCompatibility ===
    "PULLS_BACK_INSIDE_PARENT"
  ) {
    warnings.push(
      "NORMAL_PULLBACK_CONTEXT"
    );
  }

  return unique(
    warnings
  );
}

function buildRecommendedAction({
  degree,
  decisionState,
  proximity,
  readiness,
  wave,
  currentWave,
  geometryToolRecommended,
}) {
  if (
    decisionState ===
    "INVALIDATED"
  ) {
    return (
      "DO_NOT_TRADE_INVALIDATED_SETUP"
    );
  }

  if (
    decisionState ===
    "IDLE"
  ) {
    return "NO_ACTION";
  }

  if (
    isValidInternalPullback(
      wave
    )
  ) {
    return (
      "WAIT_FOR_PULLBACK_COMPLETION"
    );
  }

  if (
    [
      "W2",
      "W4",
    ].includes(
      currentWave
    ) &&
    decisionState !==
      "READY"
  ) {
    return (
      "WAIT_FOR_PULLBACK_COMPLETION"
    );
  }

  if (
    decisionState ===
    "SETTING_UP"
  ) {
    return (
      "MONITOR_STRUCTURE"
    );
  }

  if (
    decisionState ===
    "APPROACHING"
  ) {
    if (
      readiness
        .reactionReady !==
      true
    ) {
      return "WATCH_REACTION";
    }

    if (
      proximity ===
      "APPROACHING"
    ) {
      return (
        "WATCH_PRICE_APPROACH"
      );
    }

    return (
      "MONITOR_STRUCTURE"
    );
  }

  if (
    decisionState ===
    "ALMOST_READY"
  ) {
    if (
      readiness
        .reactionReady !==
        true ||
      readiness
        .participationReady !==
        true
    ) {
      return "WATCH_REACTION";
    }

    if (
      FAST_LANES.has(
        degree
      ) &&
      readiness
        .plannerReady !==
        true
    ) {
      return (
        "PREPARE_GEOMETRY"
      );
    }

    return (
      "MONITOR_STRUCTURE"
    );
  }

  if (
    decisionState ===
    "READY"
  ) {
    if (
      FAST_LANES.has(
        degree
      ) &&
      readiness
        .plannerReady ===
        true
    ) {
      return (
        "REVIEW_PLANNER_TICKET"
      );
    }

    if (
      geometryToolRecommended
    ) {
      return (
        "OPEN_GEOMETRY_TOOL"
      );
    }

    return (
      "PREPARE_GEOMETRY"
    );
  }

  if (
    decisionState ===
    "ACTIVE"
  ) {
    return (
      "TRACK_ACTIVE_SETUP"
    );
  }

  return "NO_ACTION";
}

function buildReasonCodes({
  degree,
  decisionState,
  direction,
  wave,
  readiness,
  parentCompatibility,
  higherDegreeSupport,
  higherTimeframeConflict,
  warnings,
}) {
  return unique([
    `ENGINE27_TRADER_${decisionState}`,

    `ENGINE27_TRADER_${degree.toUpperCase()}_LANE`,

    `ENGINE27_TRADER_DIRECTION_${direction}`,

    isValidInternalPullback(
      wave
    )
      ? "ENGINE27_TRADER_INTERNAL_PULLBACK_ACTIVE"
      : null,

    isValidInternalPullback(
      wave
    )
      ? "ENGINE27_TRADER_WAITING_FOR_INTERNAL_PULLBACK_COMPLETION"
      : null,

    readiness.reactionReady !==
      true
      ? "ENGINE27_TRADER_REACTION_MISSING"
      : null,

    readiness.participationReady !==
      true
      ? "ENGINE27_TRADER_PARTICIPATION_MISSING"
      : null,

    readiness.permissionReady !==
      true
      ? "ENGINE27_TRADER_PERMISSION_MISSING"
      : null,

    readiness.plannerReady ===
      true
      ? "ENGINE27_TRADER_PLANNER_READY"
      : null,

    parentCompatibility ===
      "CONFLICTS_WITH_PARENT"
      ? "ENGINE27_TRADER_PARENT_CONFLICT"
      : null,

    parentCompatibility ===
      "PULLS_BACK_INSIDE_PARENT"
      ? "ENGINE27_TRADER_PULLBACK_INSIDE_PARENT"
      : null,

    higherDegreeSupport
      ? "ENGINE27_TRADER_ALIGNMENT_SUPPORTIVE"
      : "ENGINE27_TRADER_ALIGNMENT_CONFLICTED",

    higherTimeframeConflict
      ? "ENGINE27_TRADER_HIGHER_TIMEFRAME_CONFLICT"
      : null,

    warnings.includes(
      "PRIMARY_W5_MATURITY_WARNING"
    )
      ? "ENGINE27_TRADER_PRIMARY_W5_WARNING"
      : null,

    readiness.invalidated
      ? "ENGINE27_TRADER_INVALIDATED"
      : null,
  ]);
}

function safeUnavailableLane(
  degree
) {
  const registry =
    LANE_REGISTRY[
      degree
    ];

  return {
    active: false,

    engine: ENGINE_NAME,

    mode: "READ_ONLY",

    laneId:
      registry.laneId,

    degree:
      registry.degree,

    strategyId:
      registry.strategyId,

    displayName:
      registry.displayName,

    decisionState:
      "IDLE",

    direction:
      "NEUTRAL",

    currentWave:
      "UNKNOWN",

    nextExpectedWave:
      "UNKNOWN",

    internalWave:
      "UNKNOWN",

    previousInternalWave:
      "UNKNOWN",

    nextExpectedInternalWave:
      "UNKNOWN",

    pullbackClassification:
      "UNKNOWN",

    parentWaveStillValid:
      null,

    parentWaveComplete:
      null,

    parentTransitionPossible:
      null,

    transitionRisk:
      "UNKNOWN",

    invalidationLevel:
      null,

    invalidationBreached:
      false,

    supportLevel:
      null,

    currentPrice:
      null,

    currentFib:
      defaultCurrentFib(),

    nextFib:
      "UNKNOWN",

    nextPrice:
      null,

    distanceToNextFib:
      null,

    structuralContext: {
      alignmentDirection:
        "NEUTRAL",

      alignmentState:
        "INSUFFICIENT_DATA",

      confidence:
        "UNKNOWN",

      parentCompatibility:
        "UNKNOWN",

      higherDegreeSupport:
        false,

      warnings: [
        "ENGINE27_TRADER_DECISION_INPUT_UNAVAILABLE",
      ],
    },

    readiness: {
      structureReady:
        false,

      priceReady:
        false,

      reactionReady:
        false,

      participationReady:
        false,

      permissionReady:
        false,

      plannerReady:
        false,

      invalidated:
        false,
    },

    waitingFor: [
      "ENGINE27_INTELLIGENCE_INPUT",
    ],

    blockers: [],

    warnings: [
      "ENGINE27_TRADER_DECISION_INPUT_UNAVAILABLE",
    ],

    recommendedAction:
      "NO_ACTION",

    geometryToolRecommended:
      false,

    paperPipeline: {
      available:
        false,

      engine6Decision:
        null,

      engine6Allowed:
        false,

      plannerStatus:
        null,

      plannerReady:
        false,

      paperOnly:
        false,

      realExecutionAllowed:
        false,

      brokerExecutionAllowed:
        false,

      schwabExecutionAllowed:
        false,
    },

    marketStoryContext: {
      headline:
        "Market Story Unavailable",

      outlook:
        "No structural outlook is available.",
    },

    noPermissionCreated:
      true,

    noSizingCreated:
      true,

    noGeometryCreated:
      true,

    noTicketCreated:
      true,

    noExecution:
      true,

    noJournalWrite:
      true,

    reasonCodes: [
      "ENGINE27_TRADER_INPUT_UNAVAILABLE",
    ],
  };
}

function buildLaneDecision({
  degree,
  wave,
  fib,
  alignment,
  story,
  alpha,
  pipelineContext = null,
}) {
  if (
    !isObject(alpha) ||
    !isObject(wave)
  ) {
    return safeUnavailableLane(
      degree
    );
  }

  const registry =
    LANE_REGISTRY[
      degree
    ];

  const direction =
    resolveDirection({
      degree,
      alpha,
      wave,
      alignment,
    });

  const proximity =
    normalizeProximity(
      alpha.proximity
    );

  const currentWave =
    normalizeWave(
      wave.currentWave
    );

  const nextExpectedWave =
    normalizeWave(
      wave.nextExpectedWave
    );

  const internalWave =
    normalizeInternalWave(
      wave.internalWave
    );

  const previousInternalWave =
    normalizeInternalWave(
      wave.previousInternalWave
    );

  const nextExpectedInternalWave =
    normalizeInternalWave(
      wave.nextExpectedInternalWave
    );

  const pullbackClassification =
    upper(
      wave.pullbackClassification
    ) ||
    "UNKNOWN";

  const currentPrice =
    toNumber(
      fib?.currentPrice
    ) ??
    toNumber(
      alpha.currentPrice
    );

  const currentFib =
    normalizeCurrentFib(
      fib?.currentFib
    );

  const nextFib =
    fib?.nextFib ??
    "UNKNOWN";

  const nextPrice =
    toNumber(
      fib?.nextPrice
    );

  const distanceToNextFib =
    fib?.distance ??
    null;

  const parentCompatibility =
    resolveParentCompatibility({
      degree,
      alignment,
    });

  const higherDegreeSupport =
    resolveHigherDegreeSupport({
      degree,
      direction,
      alignment,
    });

  const higherTimeframeConflict =
    resolveHigherTimeframeConflict({
      direction,
      alpha,
    });

  const legacyReadiness =
    buildReadiness({
      degree,
      alpha,
      wave,
      direction,
      proximity,
    });

  const explicitPipelineReadiness =
    buildExplicitPipelineReadiness({
      engine26Planner:
        pipelineContext?.engine26Planner ||
        null,

      engine3AuthorizedReaction:
        pipelineContext
          ?.engine3AuthorizedReaction ||
        null,

      engine4AuthorizedParticipation:
        pipelineContext
          ?.engine4AuthorizedParticipation ||
        null,

      engine6Permission:
        pipelineContext?.engine6Permission ||
        null,
    });

  const readiness =
    FAST_LANES.has(degree) &&
    explicitPipelineReadiness.available
      ? {
          ...legacyReadiness,

          reactionReady:
            explicitPipelineReadiness
              .reactionReady,

          participationReady:
            explicitPipelineReadiness
              .participationReady,

          permissionReady:
            explicitPipelineReadiness
              .permissionReady,

          plannerReady:
            explicitPipelineReadiness
              .plannerReady,
        }
      : legacyReadiness;

  const pipelineIdentity =
    buildPipelineIdentity({
      engine26LocationCandidate:
        pipelineContext
          ?.engine26LocationCandidate ||
        null,

      engine26Planner:
        pipelineContext?.engine26Planner ||
        null,

      engine3AuthorizedReaction:
        pipelineContext
          ?.engine3AuthorizedReaction ||
        null,

      engine4AuthorizedParticipation:
        pipelineContext
          ?.engine4AuthorizedParticipation ||
        null,

      engine6Permission:
        pipelineContext?.engine6Permission ||
        null,
    });

  const decisionState =
    determineDecisionState({
      degree,
      alpha,
      wave,
      proximity,
      readiness,
      higherTimeframeConflict,
    });

  const waitingFor =
    buildWaitingFor({
      degree,
      alpha,
      wave,
      proximity,
      readiness,
      higherTimeframeConflict,
    });

  const blockers =
    buildBlockers({
      alpha,
      readiness,
    });

  const warnings =
    buildWarnings({
      degree,
      alpha,
      wave,
      alignment,
      parentCompatibility,
      higherTimeframeConflict,
      readiness,
    });

  const geometryToolRecommended =
    alpha
      .geometryToolRecommended ===
      true &&
    [
      "READY",
      "TRIGGERED",
    ].includes(
      decisionState
    ) &&
    readiness.invalidated !==
      true &&
    readiness.reactionReady ===
      true &&
    !isValidInternalPullback(
      wave
    );

  const recommendedAction =
    buildRecommendedAction({
      degree,
      decisionState,
      proximity,
      readiness,
      wave,
      currentWave,
      geometryToolRecommended,
    });

  const permissionContext =
    alpha
      .permissionContext ||
    {};

  const plannerContext =
    alpha
      .plannerContext ||
    {};

  return {
    active: true,

    engine: ENGINE_NAME,

    mode: "READ_ONLY",

    laneId:
      alpha.laneId ||
      registry.laneId,

    degree:
      alpha.degree ||
      registry.degree,

    strategyId:
      alpha.strategyId ||
      registry.strategyId,

    displayName:
      alpha.displayName ||
      registry.displayName,

    candidateId:
      pipelineIdentity.candidateId,

    zoneId:
      pipelineIdentity.zoneId,

    symbol:
      pipelineIdentity.symbol,

    setupType:
      pipelineIdentity.setupType,

    snapshotTime:
      pipelineIdentity.snapshotTime,

    pipelineIdentity: {
      complete:
        pipelineIdentity.complete,

      consistent:
        pipelineIdentity.consistent,

      candidateIdConsistent:
        pipelineIdentity
          .candidateIdConsistent,

      zoneIdConsistent:
        pipelineIdentity
          .zoneIdConsistent,
    },

    decisionState,

    direction,

    currentWave,

    nextExpectedWave,

    internalWave,

    previousInternalWave,

    nextExpectedInternalWave,

    pullbackClassification,

    parentWaveStillValid:
      wave.parentWaveStillValid ??
      null,

    parentWaveComplete:
      wave.parentWaveComplete ??
      null,

    parentTransitionPossible:
      wave.parentTransitionPossible ??
      null,

    transitionRisk:
      upper(
        wave.transitionRisk
      ) ||
      "UNKNOWN",

    invalidationLevel:
      toNumber(
        wave.invalidationLevel
      ),

    invalidationBreached:
      wave.invalidationBreached ===
      true,

    supportLevel:
      toNumber(
        wave.supportLevel
      ),

    currentPrice,

    currentFib,

    nextFib,

    nextPrice,

    distanceToNextFib,

    structuralContext: {
      alignmentDirection:
        normalizeDirection(
          alignment?.direction
        ),

      alignmentState:
        upper(
          alignment
            ?.alignmentState
        ) ||
        "INSUFFICIENT_DATA",

      confidence:
        upper(
          alignment
            ?.confidence
        ) ||
        "UNKNOWN",

      parentCompatibility,

      higherDegreeSupport,

      warnings: [
        ...warnings,
      ],
    },

    readiness,

    waitingFor,

    blockers,

    warnings,

    recommendedAction,

    geometryToolRecommended,

    paperPipeline: {
      available:
        explicitPipelineReadiness.available
          ? true
          : plannerContext
              .available === true,

      explicitAuthorizedInputs:
        explicitPipelineReadiness.available,

      engine3State:
        explicitPipelineReadiness
          .engine3State,

      engine4Status:
        explicitPipelineReadiness
          .engine4Status,

      engine6Decision:
        explicitPipelineReadiness
          .engine6Decision ??
        permissionContext
          .engine6Decision ??
        null,

      engine6Allowed:
        explicitPipelineReadiness.available
          ? explicitPipelineReadiness
              .permissionReady
          : permissionContext
              .engine6Allowed === true,

      plannerStatus:
        explicitPipelineReadiness
          .plannerStatus ??
        plannerContext
          .status ??
        null,

      plannerReady:
        readiness.plannerReady,

      reactionReady:
        readiness.reactionReady,

      participationReady:
        readiness.participationReady,

      permissionReady:
        readiness.permissionReady,

      identityComplete:
        pipelineIdentity.complete,

      identityConsistent:
        pipelineIdentity.consistent,

      paperOnly:
        permissionContext
          .paperOnly === true,

      realExecutionAllowed:
        permissionContext
          .realExecutionAllowed === true,

      brokerExecutionAllowed:
        permissionContext
          .brokerExecutionAllowed === true,

      schwabExecutionAllowed:
        permissionContext
          .schwabExecutionAllowed === true,
    },

      engine6Decision:
        permissionContext
          .engine6Decision ??
        null,

      engine6Allowed:
        permissionContext
          .engine6Allowed ===
        true,

      plannerStatus:
        plannerContext
          .status ??
        null,

      plannerReady:
        readiness
          .plannerReady,

      paperOnly:
        permissionContext
          .paperOnly ===
        true,

      realExecutionAllowed:
        permissionContext
          .realExecutionAllowed ===
        true,

      brokerExecutionAllowed:
        permissionContext
          .brokerExecutionAllowed ===
        true,

      schwabExecutionAllowed:
        permissionContext
          .schwabExecutionAllowed ===
        true,
    },

    marketStoryContext: {
      headline:
        story?.headline ||
        "Market Story Unavailable",

      outlook:
        story?.outlook ||
        "No structural outlook is available.",
    },

    noPermissionCreated:
      true,

    noSizingCreated:
      true,

    noGeometryCreated:
      true,

    noTicketCreated:
      true,

    noExecution:
      true,

    noJournalWrite:
      true,

    reasonCodes:
      buildReasonCodes({
        degree,
        decisionState,
        direction,
        wave,
        readiness,
        parentCompatibility,
        higherDegreeSupport,
        higherTimeframeConflict,
        warnings,
      }),
  };
}

function buildHighestPriorityDecision(
  decisions
) {
  for (
    const state
    of OPPORTUNITY_PRIORITY
  ) {
    for (
      const degree
      of LANE_ORDER
    ) {
      const decision =
        decisions[
          degree
        ];

      if (
        decision
          ?.decisionState !==
        state
      ) {
        continue;
      }

      if (
        decision
          .decisionState ===
        "INVALIDATED"
      ) {
        continue;
      }

      return {
        degree:
          decision.degree,

        laneId:
          decision.laneId,

        strategyId:
          decision.strategyId,

        displayName:
          decision.displayName,

        decisionState:
          decision
            .decisionState,

        direction:
          decision.direction,

        recommendedAction:
          decision
            .recommendedAction,
      };
    }
  }

  return null;
}

function buildAggregateReasonCodes({
  active,
  decisions,
}) {
  const codes = [
    active
      ? "ENGINE27_TRADER_DECISIONS_READY"
      : "ENGINE27_TRADER_INPUT_UNAVAILABLE",
  ];

  for (
    const degree
    of LANE_ORDER
  ) {
    const decision =
      decisions[
        degree
      ];

    if (
      decision?.active !==
      true
    ) {
      continue;
    }

    codes.push(
      `ENGINE27_TRADER_${degree.toUpperCase()}_${decision.decisionState}`
    );
  }

  return unique(
    codes
  );
}

export function buildTraderDecision({
  engine27WaveIntelligence,
  engine27FibIntelligence,
  engine27Alignment,
  engine27MarketStory,
  alphaDecisions,
} = {}) {
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

  const alignment =
    isObject(
      engine27Alignment
    )
      ? engine27Alignment
      : {};

  const story =
    isObject(
      engine27MarketStory
    )
      ? engine27MarketStory
      : {};

  const alpha =
    isObject(
      alphaDecisions
    )
      ? alphaDecisions
      : {};

  const decisions = {};

  for (
    const degree
    of LANE_ORDER
  ) {
    try {
      decisions[
        degree
      ] =
        buildLaneDecision({
          degree,

          wave:
            waves[
              degree
            ] ||
            null,

          fib:
            fibs[
              degree
            ] ||
            null,

          alignment,

          story,

          alpha:
            alpha[
              degree
            ] ||
            null,
        });
    } catch {
      decisions[
        degree
      ] =
        safeUnavailableLane(
          degree
        );
    }
  }

  const usableDegrees =
    LANE_ORDER.filter(
      (degree) =>
        decisions[
          degree
        ]?.active ===
        true
    );

  const active =
    usableDegrees.length >
    0;

  const readyDegrees =
    LANE_ORDER.filter(
      (degree) =>
        decisions[
          degree
        ]?.decisionState ===
        "READY"
    );

  const triggeredDegrees =
    LANE_ORDER.filter(
      (degree) =>
        decisions[
          degree
        ]?.decisionState ===
        "TRIGGERED"
    );

  const approachingDegrees =
    LANE_ORDER.filter(
      (degree) =>
        [
          "APPROACHING",
          "ALMOST_READY",
        ].includes(
          decisions[
            degree
          ]?.decisionState
        )
    );

  const invalidatedDegrees =
    LANE_ORDER.filter(
      (degree) =>
        decisions[
          degree
        ]?.decisionState ===
        "INVALIDATED"
    );

  return {
    active,

    engine: ENGINE_NAME,

    mode: "READ_ONLY",

    laneOrder: [
      ...LANE_ORDER,
    ],

    decisions,

    readyDegrees,

    triggeredDegrees,

    approachingDegrees,

    invalidatedDegrees,

    highestPriorityDecision:
      buildHighestPriorityDecision(
        decisions
      ),

    noPermissionCreated:
      true,

    noSizingCreated:
      true,

    noGeometryCreated:
      true,

    noTicketCreated:
      true,

    noExecution:
      true,

    noJournalWrite:
      true,

    reasonCodes:
      buildAggregateReasonCodes({
        active,
        decisions,
      }),
  };
}

export default buildTraderDecision;
