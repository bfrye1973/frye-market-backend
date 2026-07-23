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

const STRATEGY1_SETUP_CLASS =
  "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";

const STRATEGY1_LANE_ID =
  "minute";

const STRATEGY1_STRATEGY_ID =
  "intraday_scalp@10m";

const STRATEGY1_IDENTITY_FIELDS = [
  "laneId",
  "strategyId",
  "candidateId",
  "zoneId",
  "setupClass",
  "identitySetupKey",
  "candidateIdentityVersion",
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
  engine26PipelineIdentity = null,
  engine26LocationContext = null,
  engine26ControlMap = null,
  engine26ProposedGeometry = null,
  engine26Planner = null,
  engine3AuthorizedReaction = null,
  engine4AuthorizedParticipation = null,
  engine6Permission = null,
} = {}) {
  const identitySources = [
    engine26PipelineIdentity,
    engine26LocationCandidate?.pipelineIdentity,
    engine26LocationCandidate,
    engine26LocationContext,
    engine26ControlMap,
    engine26ProposedGeometry,
    engine26Planner,
    engine3AuthorizedReaction,
    engine4AuthorizedParticipation,
    engine6Permission,
  ].filter(isObject);

  const candidateIds = identitySources
    .map((source) =>
      normalizeIdentityValue(
        source?.candidateId
      )
    )
    .filter(Boolean);

  const zoneIds = identitySources
    .map((source) =>
      normalizeIdentityValue(
        source?.zoneId
      )
    )
    .filter(Boolean);

  const laneIds = identitySources
    .map((source) =>
      normalizeIdentityValue(
        source?.laneId
      )
    )
    .filter(Boolean);

  const strategyIds = identitySources
    .map((source) =>
      normalizeIdentityValue(
        source?.strategyId
      )
    )
    .filter(Boolean);

  const candidateId =
    normalizeIdentityValue(
      engine26PipelineIdentity
        ?.candidateId
    ) ??
    candidateIds[0] ??
    null;

  const zoneId =
    normalizeIdentityValue(
      engine26PipelineIdentity
        ?.zoneId
    ) ??
    zoneIds[0] ??
    null;

  const laneId =
    normalizeIdentityValue(
      engine26PipelineIdentity
        ?.laneId
    ) ??
    laneIds[0] ??
    null;

  const strategyId =
    normalizeIdentityValue(
      engine26PipelineIdentity
        ?.strategyId
    ) ??
    strategyIds[0] ??
    null;

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

  const laneIdConsistent =
    laneIds.length <= 1 ||
    laneIds.every(
      (value) => value === laneId
    );

  const strategyIdConsistent =
    strategyIds.length <= 1 ||
    strategyIds.every(
      (value) => value === strategyId
    );

  const consistent =
    candidateIdConsistent &&
    zoneIdConsistent &&
    laneIdConsistent &&
    strategyIdConsistent;

  const complete =
    Boolean(
      candidateId &&
      zoneId &&
      laneId &&
      strategyId &&
      consistent &&
      (
        engine26PipelineIdentity
          ?.complete === true ||
        engine26LocationCandidate
          ?.pipelineIdentity
          ?.complete === true
      )
    );

  return {
    candidateId,
    zoneId,
    laneId,
    strategyId,

    symbol:
      normalizeIdentityValue(
        engine26PipelineIdentity?.symbol ??
        engine26LocationCandidate?.symbol ??
        engine26LocationContext?.symbol ??
        engine26ControlMap?.symbol ??
        engine26ProposedGeometry?.symbol ??
        engine26Planner?.symbol ??
        engine3AuthorizedReaction?.symbol ??
        engine4AuthorizedParticipation?.symbol ??
        engine6Permission?.symbol
      ),

    setupType:
      normalizeIdentityValue(
        engine26PipelineIdentity?.setupType ??
        engine26LocationCandidate?.setupType ??
        engine26ProposedGeometry?.setupType ??
        engine26Planner?.setupType ??
        engine3AuthorizedReaction?.setupType ??
        engine4AuthorizedParticipation?.setupType ??
        engine6Permission?.setupType
      ),

    snapshotTime:
      normalizeIdentityValue(
        engine26PipelineIdentity?.snapshotTime ??
        engine26LocationCandidate?.snapshotTime ??
        engine26LocationContext?.snapshotTime ??
        engine26ControlMap?.snapshotTime ??
        engine26ProposedGeometry?.snapshotTime ??
        engine26Planner?.snapshotTime ??
        engine3AuthorizedReaction?.snapshotTime ??
        engine4AuthorizedParticipation?.snapshotTime ??
        engine6Permission?.snapshotTime
      ),

    candidateIdConsistent,
    zoneIdConsistent,
    laneIdConsistent,
    strategyIdConsistent,
    consistent,
    complete,
  };
}

function isValidSubminuteProposedGeometry({
  engine26ProposedGeometry = null,
  pipelineIdentity = null,
} = {}) {
  if (
    !isObject(
      engine26ProposedGeometry
    ) ||
    !isObject(
      pipelineIdentity
    )
  ) {
    return false;
  }

  return (
    pipelineIdentity.complete ===
      true &&
    pipelineIdentity.consistent ===
      true &&
    pipelineIdentity.laneId ===
      "subminute" &&
    pipelineIdentity.strategyId ===
      "subminute_scalp@10m" &&
    engine26ProposedGeometry
      .laneId ===
      pipelineIdentity.laneId &&
    engine26ProposedGeometry
      .strategyId ===
      pipelineIdentity.strategyId &&
    engine26ProposedGeometry
      .candidateId ===
      pipelineIdentity.candidateId &&
    engine26ProposedGeometry
      .zoneId ===
      pipelineIdentity.zoneId &&
    engine26ProposedGeometry
      .active === true &&
    upper(
      engine26ProposedGeometry
        .lifecycleStatus
    ) ===
      "PROPOSED_GEOMETRY_AVAILABLE" &&
    engine26ProposedGeometry
      .candidateIdentityPreserved ===
      true &&
    engine26ProposedGeometry
      .proposalOnly === true &&
    engine26ProposedGeometry
      .plannerOnly === true &&
    engine26ProposedGeometry
      .official !== true &&
    engine26ProposedGeometry
      .nonExecutable === true &&
    engine26ProposedGeometry
      .noExecution === true
  );
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

function normalizeStrategy1IdentityValue(value) {
  return normalizeIdentityValue(value);
}

function isStrategy1Candidate(candidate) {
  return (
    isObject(candidate) &&
    normalizeStrategy1IdentityValue(
      candidate.laneId
    ) === STRATEGY1_LANE_ID &&
    normalizeStrategy1IdentityValue(
      candidate.strategyId
    ) === STRATEGY1_STRATEGY_ID &&
    upper(
      candidate.setupClass
    ) === STRATEGY1_SETUP_CLASS
  );
}

function identityFieldMatches({
  source,
  field,
  canonicalValue,
}) {
  if (!isObject(source)) {
    return false;
  }

  const sourceValue =
    normalizeStrategy1IdentityValue(
      source[field]
    );

  /*
   * Engine 3 and Engine 6 do not currently repeat every descriptive
   * Strategy 1 identity field. Missing optional repetitions do not
   * create or repair identity. Any value that is present must match
   * the canonical Engine 26A candidate exactly.
   */
  if (sourceValue === null) {
    return true;
  }

  return sourceValue === canonicalValue;
}

function buildStrategy1Identity({
  engine26LocationCandidate = null,
  engine3AuthorizedReaction = null,
  engine4AuthorizedParticipation = null,
  engine6Permission = null,
  engine26ProposedGeometry = null,
} = {}) {
  const candidate =
    isObject(engine26LocationCandidate)
      ? engine26LocationCandidate
      : null;

  const canonical = Object.fromEntries(
    STRATEGY1_IDENTITY_FIELDS.map(
      (field) => [
        field,
        normalizeStrategy1IdentityValue(
          candidate?.[field]
        ),
      ]
    )
  );

  const canonicalComplete =
    isStrategy1Candidate(candidate) &&
    STRATEGY1_IDENTITY_FIELDS.every(
      (field) => Boolean(canonical[field])
    );

  const requiredContracts = {
    engine26LocationCandidate:
      candidate,
    engine3AuthorizedReaction,
    engine4AuthorizedParticipation,
    engine6Permission,
    engine26ProposedGeometry,
  };

  const contractsPresent =
    Object.values(requiredContracts).every(
      isObject
    );

  const contractMatches = {};

  for (
    const [name, source]
    of Object.entries(requiredContracts)
  ) {
    contractMatches[name] =
      isObject(source) &&
      STRATEGY1_IDENTITY_FIELDS.every(
        (field) =>
          identityFieldMatches({
            source,
            field,
            canonicalValue:
              canonical[field],
          })
      );
  }

  const fieldConsistent =
    Object.fromEntries(
      STRATEGY1_IDENTITY_FIELDS.map(
        (field) => [
          field,
          Object.values(
            requiredContracts
          ).every(
            (source) =>
              identityFieldMatches({
                source,
                field,
                canonicalValue:
                  canonical[field],
              })
          ),
        ]
      )
    );

  const consistent =
    canonicalComplete &&
    contractsPresent &&
    Object.values(
      contractMatches
    ).every(Boolean) &&
    Object.values(
      fieldConsistent
    ).every(Boolean);

  return {
    ...canonical,

    setupGrade:
      normalizeStrategy1IdentityValue(
        candidate?.setupGrade
      ),

    complete:
      canonicalComplete &&
      contractsPresent,

    consistent,

    contractsPresent,

    contractMatches,
    fieldConsistent,
  };
}

function isNumericPrice(value) {
  const number = Number(value);

  return (
    Number.isFinite(number) &&
    number > 0
  );
}

function isValidStrategy1Geometry(
  geometry
) {
  if (!isObject(geometry)) {
    return false;
  }

  const targets =
    Array.isArray(
      geometry.proposedTargets
    )
      ? geometry.proposedTargets
      : [];

  const target1 = targets[0];
  const target2 = targets[1];
  const target3 = targets[2];

  return (
    geometry.active === true &&
    upper(
      geometry.lifecycleStatus
    ) ===
      "PROPOSED_GEOMETRY_AVAILABLE" &&
    isNumericPrice(
      geometry.proposedEntryPrice
    ) &&
    isNumericPrice(
      geometry.proposedStopPrice
    ) &&
    isNumericPrice(
      target1?.price
    ) &&
    isNumericPrice(
      target2?.price
    ) &&
    target3?.price === null &&
    upper(
      target3?.purpose
    ) ===
      "ENGINE9_RUNNER_HANDOFF" &&
    target3
      ?.runnerHandoffRequired ===
      true
  );
}

function buildStrategy1Readiness({
  engine26LocationCandidate = null,
  engine3AuthorizedReaction = null,
  engine4AuthorizedParticipation = null,
  engine6Permission = null,
  engine26ProposedGeometry = null,
} = {}) {
  const identity =
    buildStrategy1Identity({
      engine26LocationCandidate,
      engine3AuthorizedReaction,
      engine4AuthorizedParticipation,
      engine6Permission,
      engine26ProposedGeometry,
    });

  const invalidated =
    engine26LocationCandidate
      ?.invalidated === true;

  const identityReady =
    identity.complete === true &&
    identity.consistent === true;

  const reactionReady =
    identityReady &&
    invalidated !== true &&
    engine3AuthorizedReaction
      ?.reactionConfirmed === true;

  const participationReady =
    identityReady &&
    invalidated !== true &&
    engine4AuthorizedParticipation
      ?.participationConfirmed ===
      true &&
    engine4AuthorizedParticipation
      ?.hardBlocked !== true;

  const permissionReady =
    identityReady &&
    invalidated !== true &&
    upper(
      engine6Permission?.decision
    ) ===
      "FAST_INTRADAY_PAPER_ALLOW" &&
    engine6Permission?.allowed ===
      true &&
    engine6Permission
      ?.planningAllowed === true;

  const geometryReady =
    isValidStrategy1Geometry(
      engine26ProposedGeometry
    );

  const plannerReady =
    identityReady &&
    invalidated !== true &&
    geometryReady;

  return {
    available:
      Boolean(
        engine26LocationCandidate ||
        engine3AuthorizedReaction ||
        engine4AuthorizedParticipation ||
        engine6Permission ||
        engine26ProposedGeometry
      ),

    applies:
      [
        engine26LocationCandidate,
        engine3AuthorizedReaction,
        engine4AuthorizedParticipation,
        engine6Permission,
        engine26ProposedGeometry,
      ].some(
        (source) =>
          isObject(source) &&
          (
            upper(
              source.setupClass
            ) ===
              STRATEGY1_SETUP_CLASS ||
            upper(
              source.identitySetupKey
            ) ===
              STRATEGY1_SETUP_CLASS
          )
      ),

    identity,

    reactionReady,
    participationReady,
    permissionReady,
    plannerReady,
    invalidated,

    geometryReady,

    reactionState:
      upper(
        engine3AuthorizedReaction
          ?.reactionState
      ) || null,

    authorizedReactionState:
      upper(
        engine3AuthorizedReaction
          ?.authorizedReactionState
      ) || null,

    participationState:
      upper(
        engine4AuthorizedParticipation
          ?.participationState
      ) || null,

    hardBlocked:
      engine4AuthorizedParticipation
        ?.hardBlocked === true,

    engine6Decision:
      upper(
        engine6Permission?.decision
      ) || null,

    allowed:
      engine6Permission?.allowed ===
      true,

    planningAllowed:
      engine6Permission
        ?.planningAllowed === true,

    plannerStatus:
      upper(
        engine26ProposedGeometry
          ?.lifecycleStatus
      ) || null,
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
  subminuteGeometryReady = false,
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
      true &&
    !(
      degree === "subminute" &&
      subminuteGeometryReady === true
    )
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
  subminutePipelineContext = null,
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

  const pipelineIdentity =
    degree === "subminute"
      ? buildPipelineIdentity({
          engine26LocationCandidate:
            subminutePipelineContext
              ?.engine26LocationCandidate ||
            null,

          engine26PipelineIdentity:
            subminutePipelineContext
              ?.engine26PipelineIdentity ||
            null,

          engine26LocationContext:
            subminutePipelineContext
              ?.engine26LocationContext ||
            null,

          engine26ControlMap:
            subminutePipelineContext
              ?.engine26ControlMap ||
            null,

          engine26ProposedGeometry:
            subminutePipelineContext
              ?.engine26ProposedGeometry ||
            null,
        })
      : buildPipelineIdentity({
          engine26LocationCandidate:
            pipelineContext
              ?.engine26LocationCandidate ||
            null,

          engine26ProposedGeometry:
            pipelineContext
              ?.engine26ProposedGeometry ||
            null,

          engine26Planner:
            pipelineContext
              ?.engine26Planner ||
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
            pipelineContext
              ?.engine6Permission ||
            null,
        });

  const subminuteGeometryReady =
    degree === "subminute" &&
    isValidSubminuteProposedGeometry({
      engine26ProposedGeometry:
        subminutePipelineContext
          ?.engine26ProposedGeometry ||
        null,

      pipelineIdentity,
    });

  const strategy1Readiness =
    degree === "minute"
      ? buildStrategy1Readiness({
          engine26LocationCandidate:
            pipelineContext
              ?.engine26LocationCandidate ||
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
            pipelineContext
              ?.engine6Permission ||
            null,

          engine26ProposedGeometry:
            pipelineContext
              ?.engine26ProposedGeometry ||
            null,
        })
      : null;

  const readiness =
    degree === "subminute"
      ? {
          ...legacyReadiness,

          plannerReady:
            subminuteGeometryReady,
        }
      : (
          degree === "minute" &&
          strategy1Readiness
            ?.applies === true
            ? (() => {
                const invalidated =
                  legacyReadiness
                    .invalidated === true ||
                  strategy1Readiness
                    .invalidated === true;

                return {
                  ...legacyReadiness,

                  reactionReady:
                    invalidated
                      ? false
                      : strategy1Readiness
                          .reactionReady,

                  participationReady:
                    invalidated
                      ? false
                      : strategy1Readiness
                          .participationReady,

                  permissionReady:
                    invalidated
                      ? false
                      : strategy1Readiness
                          .permissionReady,

                  plannerReady:
                    invalidated
                      ? false
                      : strategy1Readiness
                          .plannerReady,

                  invalidated,
                };
              })()
            : (
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
                  : legacyReadiness
              )
        );

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

  if (
    strategy1Readiness
      ?.applies === true &&
    (
      strategy1Readiness
        .identity.complete !== true ||
      strategy1Readiness
        .identity.consistent !== true
    )
  ) {
    waitingFor.unshift(
      "ENGINE26_PIPELINE_IDENTITY_MATCH"
    );
  }

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
      subminuteGeometryReady,
    });

  if (
    strategy1Readiness
      ?.applies === true &&
    (
      strategy1Readiness
        .identity.complete !== true ||
      strategy1Readiness
        .identity.consistent !== true
    )
  ) {
    warnings.push(
      "ENGINE26_PIPELINE_IDENTITY_MISMATCH"
    );
  }

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

  const publicPipelineIdentity =
    strategy1Readiness
      ?.applies === true
      ? strategy1Readiness
          .identity
      : pipelineIdentity;

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
      publicPipelineIdentity
        .candidateId ??
      null,

    zoneId:
      publicPipelineIdentity
        .zoneId ??
      null,

    setupClass:
      publicPipelineIdentity
        .setupClass ??
      null,

    setupGrade:
      publicPipelineIdentity
        .setupGrade ??
      null,

    identitySetupKey:
      publicPipelineIdentity
        .identitySetupKey ??
      null,

    candidateIdentityVersion:
      publicPipelineIdentity
        .candidateIdentityVersion ??
      null,

    symbol:
      publicPipelineIdentity
        .symbol ??
      pipelineIdentity.symbol ??
      null,

    setupType:
      pipelineIdentity.setupType,

    snapshotTime:
      pipelineIdentity.snapshotTime,

    pipelineIdentity: {
      laneId:
        publicPipelineIdentity
          .laneId ??
        null,

      strategyId:
        publicPipelineIdentity
          .strategyId ??
        null,

      candidateId:
        publicPipelineIdentity
          .candidateId ??
        null,

      zoneId:
        publicPipelineIdentity
          .zoneId ??
        null,

      setupClass:
        publicPipelineIdentity
          .setupClass ??
        null,

      identitySetupKey:
        publicPipelineIdentity
          .identitySetupKey ??
        null,

      candidateIdentityVersion:
        publicPipelineIdentity
          .candidateIdentityVersion ??
        null,

      complete:
        publicPipelineIdentity
          .complete === true,

      consistent:
        publicPipelineIdentity
          .consistent === true,

      candidateIdConsistent:
        publicPipelineIdentity
          .candidateIdConsistent ??
        publicPipelineIdentity
          .fieldConsistent
          ?.candidateId ??
        false,

      zoneIdConsistent:
        publicPipelineIdentity
          .zoneIdConsistent ??
        publicPipelineIdentity
          .fieldConsistent
          ?.zoneId ??
        false,

      laneIdConsistent:
        publicPipelineIdentity
          .laneIdConsistent ??
        publicPipelineIdentity
          .fieldConsistent
          ?.laneId ??
        false,

      strategyIdConsistent:
        publicPipelineIdentity
          .strategyIdConsistent ??
        publicPipelineIdentity
          .fieldConsistent
          ?.strategyId ??
        false,

      contractMatches:
        publicPipelineIdentity
          .contractMatches ??
        null,
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
        degree === "subminute"
          ? Boolean(
              subminutePipelineContext
                ?.engine26LocationCandidate ||
              subminutePipelineContext
                ?.engine26PipelineIdentity ||
              subminutePipelineContext
                ?.engine26LocationContext ||
              subminutePipelineContext
                ?.engine26ControlMap ||
              subminutePipelineContext
                ?.engine26ProposedGeometry
            )
          : (
              explicitPipelineReadiness.available
                ? true
                : plannerContext
                    .available === true
            ),

      explicitAuthorizedInputs:
        degree === "subminute"
          ? Boolean(
              subminutePipelineContext
            )
          : explicitPipelineReadiness.available,

      engine3State:
        strategy1Readiness
          ?.applies === true
          ? (
              strategy1Readiness
                .authorizedReactionState ??
              strategy1Readiness
                .reactionState
            )
          : explicitPipelineReadiness
              .engine3State,

      engine4Status:
        strategy1Readiness
          ?.applies === true
          ? strategy1Readiness
              .participationState
          : explicitPipelineReadiness
              .engine4Status,

      engine6Decision:
        strategy1Readiness
          ?.applies === true
          ? strategy1Readiness
              .engine6Decision
          : (
              explicitPipelineReadiness
                .engine6Decision ??
              permissionContext
                .engine6Decision ??
              null
            ),

      engine6Allowed:
        degree === "subminute"
          ? permissionContext
              .engine6Allowed === true
          : (
              strategy1Readiness
                ?.applies === true
                ? strategy1Readiness
                    .allowed
                : (
                    explicitPipelineReadiness.available
                      ? explicitPipelineReadiness
                          .permissionReady
                      : permissionContext
                          .engine6Allowed === true
                  )
            ),

      planningAllowed:
        strategy1Readiness
          ?.applies === true
          ? strategy1Readiness
              .planningAllowed
          : null,

      plannerStatus:
        degree === "subminute"
          ? (
              subminutePipelineContext
                ?.engine26ProposedGeometry
                ?.lifecycleStatus ??
              null
            )
          : (
              strategy1Readiness
                ?.applies === true
                ? strategy1Readiness
                    .plannerStatus
                : (
                    explicitPipelineReadiness
                      .plannerStatus ??
                    plannerContext
                      .status ??
                    null
                  )
            ),

      plannerReady:
        readiness.plannerReady,

      reactionReady:
        readiness.reactionReady,

      participationReady:
        readiness.participationReady,

      permissionReady:
        readiness.permissionReady,

      identityComplete:
        publicPipelineIdentity
          .complete === true,

      identityConsistent:
        publicPipelineIdentity
          .consistent === true,

      executable: false,

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
      unique([
        ...buildReasonCodes({
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

        strategy1Readiness
          ?.applies === true &&
        strategy1Readiness
          .identity.consistent === true
          ? "ENGINE27_TRADER_STRATEGY1_IDENTITY_MATCHED"
          : null,

        strategy1Readiness
          ?.applies === true &&
        strategy1Readiness
          .identity.consistent !== true
          ? "ENGINE27_TRADER_STRATEGY1_IDENTITY_MISMATCH"
          : null,

        strategy1Readiness
          ?.applies === true &&
        strategy1Readiness
          .geometryReady === true
          ? "ENGINE27_TRADER_ENGINE9_RUNNER_HANDOFF_ACCEPTED"
          : null,
      ]),
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
  pipelineContext = null,
  subminutePipelineContext = null,
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

          pipelineContext:
            degree === "minute"
              ? pipelineContext
              : null,

          subminutePipelineContext:
            degree === "subminute"
              ? subminutePipelineContext
              : null,
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
