const TICK_SIZE_ES = 0.25;

const V1_SETUP_CLASS =
  "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";
const V2_SETUP_CLASS =
  "NEGOTIATED_ZONE_ROTATION";

function toNum(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundToTick(value, tick = TICK_SIZE_ES) {
  const n = toNum(value);
  if (n == null) return null;

  return Number(
    (
      Math.round(n / tick) *
      tick
    ).toFixed(2)
  );
}

function roundPts(value) {
  const n = toNum(value);
  return n == null
    ? null
    : Number(n.toFixed(2));
}

function safeUpper(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function classifyGeometryObjective(
  availableRewardPoints
) {
  const reward = toNum(availableRewardPoints);

  if (reward == null || reward < 10) {
    return "GEOMETRY_INSUFFICIENT";
  }

  if (reward < 15) {
    return "GEOMETRY_10_POINT_AVAILABLE";
  }

  if (reward < 20) {
    return "GEOMETRY_15_POINT_AVAILABLE";
  }

  return "GEOMETRY_EXCEPTIONAL";
}

export function evaluateStrategy1Geometry({
  symbol,
  strategyId,
  permission,
  engine26LocationCandidate,
  engine26GeometryHandoff,
} = {}) {
  const candidate =
    engine26LocationCandidate &&
    typeof engine26LocationCandidate === "object"
      ? engine26LocationCandidate
      : null;

  const handoff =
    engine26GeometryHandoff &&
    typeof engine26GeometryHandoff === "object"
      ? engine26GeometryHandoff
      : null;

  const paper =
    permission?.paper &&
    typeof permission.paper === "object"
      ? permission.paper
      : null;

  const paperIdentity =
    paper?.identity &&
    typeof paper.identity === "object"
      ? paper.identity
      : null;

  const lockedPaperDirection = safeUpper(
    paper?.direction
  );

  const lockedPaperPackageValid =
    paper?.allowed === true &&
    paper?.paperAllowed === true &&
    paper?.locked === true &&
    ["LONG", "SHORT"].includes(
      lockedPaperDirection
    );

  const setupClass =
    (lockedPaperPackageValid
      ? paper?.setupClass ??
        paperIdentity?.setupClass
      : null) ??
    candidate?.setupClass ??
    handoff?.setupClass ??
    null;

  const candidateIdentityVersion =
    (lockedPaperPackageValid
      ? paper?.candidateIdentityVersion ??
        paperIdentity?.candidateIdentityVersion
      : null) ??
    candidate?.candidateIdentityVersion ??
    handoff?.candidateIdentityVersion ??
    null;

  const readableLaneId =
    (lockedPaperPackageValid
      ? paper?.laneId ?? paperIdentity?.laneId
      : null) ??
    candidate?.laneId ??
    handoff?.laneId;

  const readableStrategyId =
    (lockedPaperPackageValid
      ? paper?.strategyId ??
        paperIdentity?.strategyId
      : null) ??
    candidate?.strategyId ??
    handoff?.strategyId ??
    strategyId;

  const isReadableStrategy1 =
    [V1_SETUP_CLASS, V2_SETUP_CLASS].includes(
      setupClass
    ) &&
    readableLaneId === "minute" &&
    readableStrategyId === "intraday_scalp@10m";

  if (!isReadableStrategy1) return null;

  const laneId =
    (lockedPaperPackageValid
      ? paper?.laneId ?? paperIdentity?.laneId
      : null) ??
    candidate?.laneId ??
    handoff?.laneId ??
    null;

  const candidateId =
    (lockedPaperPackageValid
      ? paper?.candidateId ??
        paperIdentity?.candidateId
      : null) ??
    candidate?.candidateId ??
    null;

  const zoneId =
    (lockedPaperPackageValid
      ? paper?.zoneId ?? paperIdentity?.zoneId
      : null) ??
    candidate?.zoneId ??
    null;

  const resolvedStrategyId =
    (lockedPaperPackageValid
      ? paper?.strategyId ??
        paperIdentity?.strategyId
      : null) ??
    candidate?.strategyId ??
    strategyId ??
    null;

  const resolvedSymbol =
    (lockedPaperPackageValid
      ? paper?.symbol ?? paperIdentity?.symbol
      : null) ??
    candidate?.symbol ??
    symbol ??
    null;

  const snapshotTime =
    candidate?.snapshotTime ??
    handoff?.snapshotTime ??
    null;

  const direction = lockedPaperPackageValid
    ? lockedPaperDirection
    : safeUpper(
        candidate?.directionBias ??
        candidate?.tradeDirectionBias ??
        candidate?.direction ??
        handoff?.direction ??
        "NEUTRAL"
      );

  const directionState = safeUpper(
    candidate?.directionState ??
    handoff?.directionState ??
    ""
  );

  const longReversalWatch =
    directionState === "LONG_REVERSAL_WATCH";

  const contactState = safeUpper(
    candidate?.contactState ??
    handoff?.contactState ??
    ""
  );

  const negotiatedLineContact =
    contactState === "NEGOTIATED_LINE_CONTACT" &&
    directionState === "SHORT_REVERSAL_WATCH";

  const directionalResolved =
    lockedPaperPackageValid ||
    (
      longReversalWatch !== true &&
      negotiatedLineContact !== true &&
      ["LONG", "SHORT"].includes(direction)
    );

  const setupType =
    candidate?.setupType ??
    setupClass;

  const setupGrade =
    (lockedPaperPackageValid
      ? paper?.setupGrade ??
        paperIdentity?.setupGrade
      : null) ??
    candidate?.setupGrade ??
    handoff?.setupGrade ??
    null;

  const identitySetupKey =
    (lockedPaperPackageValid
      ? paper?.identitySetupKey ??
        paperIdentity?.identitySetupKey
      : null) ??
    candidate?.identitySetupKey ??
    handoff?.identitySetupKey ??
    null;

  const entryZone =
    handoff?.entryZone ??
    candidate?.entryZone ??
    null;

  const targetZone =
    handoff?.targetZone ??
    candidate?.targetZone ??
    null;

  const locationInvalidationBoundary =
    toNum(
      handoff?.locationInvalidationBoundary ??
      candidate?.locationInvalidationBoundary
    );

  const permissionReady =
    lockedPaperPackageValid;

  const lockedIdentityMatches =
    !lockedPaperPackageValid ||
    (
      (paper?.candidateId ??
        paperIdentity?.candidateId ??
        candidate?.candidateId) ===
        candidate?.candidateId &&
      (paper?.zoneId ??
        paperIdentity?.zoneId ??
        candidate?.zoneId) ===
        candidate?.zoneId &&
      (paper?.laneId ??
        paperIdentity?.laneId ??
        candidate?.laneId) ===
        candidate?.laneId &&
      (paper?.strategyId ??
        paperIdentity?.strategyId ??
        candidate?.strategyId) ===
        candidate?.strategyId &&
      (paper?.symbol ??
        paperIdentity?.symbol ??
        candidate?.symbol) ===
        candidate?.symbol &&
      (paper?.setupClass ??
        paperIdentity?.setupClass ??
        candidate?.setupClass) ===
        candidate?.setupClass &&
      (paper?.setupGrade ??
        paperIdentity?.setupGrade ??
        candidate?.setupGrade) ===
        candidate?.setupGrade &&
      (paper?.identitySetupKey ??
        paperIdentity?.identitySetupKey ??
        candidate?.identitySetupKey) ===
        candidate?.identitySetupKey &&
      (paper?.candidateIdentityVersion ??
        paperIdentity?.candidateIdentityVersion ??
        candidate?.candidateIdentityVersion) ===
        candidate?.candidateIdentityVersion
    );

  const identityMatches =
    Boolean(candidate) &&
    Boolean(handoff) &&
    Boolean(laneId) &&
    Boolean(resolvedStrategyId) &&
    Boolean(candidateId) &&
    Boolean(zoneId) &&
    Boolean(resolvedSymbol) &&
    Boolean(setupClass) &&
    Boolean(setupGrade) &&
    Boolean(identitySetupKey) &&
    Boolean(candidateIdentityVersion) &&
    Boolean(snapshotTime) &&
    candidateId === handoff?.candidateId &&
    zoneId === handoff?.zoneId &&
    laneId === handoff?.laneId &&
    resolvedStrategyId === handoff?.strategyId &&
    resolvedSymbol === handoff?.symbol &&
    lockedIdentityMatches &&
    (
      lockedPaperPackageValid ||
      direction === safeUpper(
        handoff?.direction ??
        candidate?.directionBias ??
        candidate?.direction
      )
    ) &&
    setupClass === handoff?.setupClass &&
    setupGrade === handoff?.setupGrade &&
    identitySetupKey === handoff?.identitySetupKey &&
    candidateIdentityVersion ===
      handoff?.candidateIdentityVersion;

  const candidateInvalidated =
    safeUpper(candidate?.status) === "INVALIDATED" ||
    candidate?.invalidationFacts
      ?.completedCloseInvalidationConfirmed === true;

  const proposedEntryPrice =
    directionalResolved
      ? roundToTick(entryZone?.midline)
      : null;

  const proposedStopPrice =
    directionalResolved
      ? roundToTick(locationInvalidationBoundary)
      : null;

  const target1Price =
    !directionalResolved
      ? null
      : direction === "SHORT"
      ? roundToTick(targetZone?.high)
      : roundToTick(targetZone?.low);

  const target2Price =
    directionalResolved
      ? roundToTick(targetZone?.midline)
      : null;

  const stopValid =
    direction === "LONG"
      ? (
          proposedStopPrice != null &&
          toNum(entryZone?.low) != null &&
          proposedStopPrice < toNum(entryZone.low)
        )
      : direction === "SHORT"
      ? (
          proposedStopPrice != null &&
          toNum(entryZone?.high) != null &&
          proposedStopPrice > toNum(entryZone.high)
        )
      : false;

  const targetValid =
    direction === "LONG"
      ? (
          target1Price != null &&
          target2Price != null &&
          proposedEntryPrice != null &&
          toNum(entryZone?.high) != null &&
          target1Price > toNum(entryZone.high) &&
          target1Price > proposedEntryPrice &&
          target2Price >= target1Price
        )
      : direction === "SHORT"
      ? (
          target1Price != null &&
          target2Price != null &&
          proposedEntryPrice != null &&
          toNum(entryZone?.low) != null &&
          target1Price < toNum(entryZone.low) &&
          target1Price < proposedEntryPrice &&
          target2Price <= target1Price
        )
      : false;

  const distanceToTargetZoneLow =
    proposedEntryPrice != null &&
    toNum(targetZone?.low) != null
      ? roundPts(
          Math.abs(
            toNum(targetZone.low) -
            proposedEntryPrice
          )
        )
      : null;

  const distanceToTargetZoneMidline =
    proposedEntryPrice != null &&
    toNum(targetZone?.midline) != null
      ? roundPts(
          Math.abs(
            toNum(targetZone.midline) -
            proposedEntryPrice
          )
        )
      : null;

  const availableRewardPoints =
    proposedEntryPrice != null &&
    target1Price != null
      ? direction === "SHORT"
        ? roundPts(
            proposedEntryPrice - target1Price
          )
        : roundPts(
            target1Price - proposedEntryPrice
          )
      : null;

  const geometryObjectiveStatus =
    directionalResolved
      ? classifyGeometryObjective(
          availableRewardPoints
        )
      : "WAITING_FOR_DIRECTIONAL_RESOLUTION";

  const rawGeometryMathematicallyAvailable =
    directionalResolved &&
    geometryObjectiveStatus !==
      "GEOMETRY_INSUFFICIENT";

  const geometryFeasible =
    rawGeometryMathematicallyAvailable &&
    identityMatches &&
    candidateInvalidated !== true;

  let status = geometryObjectiveStatus;

  if (!identityMatches) {
    status = "IDENTITY_MISMATCH";
  } else if (candidateInvalidated) {
    status = "CANDIDATE_INVALIDATED";
  } else if (
    !lockedPaperPackageValid &&
    negotiatedLineContact
  ) {
    status =
      "WAITING_FOR_DIRECTIONAL_RESOLUTION";
  } else if (
    !lockedPaperPackageValid &&
    longReversalWatch
  ) {
    status =
      "WAITING_FOR_DIRECTIONAL_RESOLUTION";
  } else if (!directionalResolved) {
    status =
      "WAITING_FOR_DIRECTIONAL_RESOLUTION";
  } else if (
    !entryZone ||
    proposedEntryPrice == null
  ) {
    status = "WAITING_FOR_ENTRY_ZONE";
  } else if (
    !targetZone ||
    target1Price == null ||
    target2Price == null
  ) {
    status = "WAITING_FOR_TARGET_ZONE";
  } else if (
    locationInvalidationBoundary == null
  ) {
    status =
      "WAITING_FOR_INVALIDATION_BOUNDARY";
  } else if (!stopValid) {
    status = "INVALID_STOP_GEOMETRY";
  } else if (!targetValid) {
    status = "INVALID_TARGET_GEOMETRY";
  }

  const geometryReady =
    identityMatches &&
    !candidateInvalidated &&
    directionalResolved &&
    Boolean(entryZone) &&
    Boolean(targetZone) &&
    proposedEntryPrice != null &&
    proposedStopPrice != null &&
    target1Price != null &&
    target2Price != null &&
    stopValid &&
    targetValid &&
    geometryFeasible;

  const proposedStopDistancePoints =
    proposedEntryPrice != null &&
    proposedStopPrice != null
      ? roundPts(
          Math.abs(
            proposedEntryPrice -
            proposedStopPrice
          )
        )
      : null;

  const target1RewardPoints =
    availableRewardPoints;

  const target2RewardPoints =
    proposedEntryPrice != null &&
    target2Price != null
      ? direction === "SHORT"
        ? roundPts(
            proposedEntryPrice - target2Price
          )
        : roundPts(
            target2Price - proposedEntryPrice
          )
      : null;

  const target1RiskReward =
    proposedStopDistancePoints > 0 &&
    target1RewardPoints != null
      ? Number(
          (
            target1RewardPoints /
            proposedStopDistancePoints
          ).toFixed(2)
        )
      : null;

  const target2RiskReward =
    proposedStopDistancePoints > 0 &&
    target2RewardPoints != null
      ? Number(
          (
            target2RewardPoints /
            proposedStopDistancePoints
          ).toFixed(2)
        )
      : null;

  const targetApproachWarningLow =
    direction === "SHORT"
      ? target1Price != null
        ? roundToTick(target1Price + 5)
        : null
      : target1Price != null
      ? roundToTick(target1Price - 7)
      : null;

  const targetApproachWarningHigh =
    direction === "SHORT"
      ? target1Price != null
        ? roundToTick(target1Price + 7)
        : null
      : target1Price != null
      ? roundToTick(target1Price - 5)
      : null;

  const proposedTargets =
    directionalResolved
      ? [
          {
            targetId: "TARGET_1_ZONE_TOUCH",
            sequence: 1,
            price: target1Price,
            purpose:
              "FIRST_PROFIT_NEXT_NEGOTIATED_ZONE_TOUCH",
            contracts: 1,
          },
          {
            targetId: "TARGET_2_ZONE_MIDLINE",
            sequence: 2,
            price: target2Price,
            purpose:
              "SECOND_PROFIT_NEXT_NEGOTIATED_ZONE_MIDLINE",
            contracts: 1,
          },
          {
            targetId: "TARGET_3_ZONE_MIDLINE_TESTING",
            sequence: 3,
            // Kept null in the legacy proposal array for compatibility.
            // The frozen testing lifecycle below owns the actual Block 3
            // midline intent; no EMA20 runner handoff exists.
            price: null,
            purpose:
              "THIRD_PROFIT_TARGET_ZONE_MIDLINE_TESTING",
            contracts: 1,
            runnerHandoffRequired: false,
          },
        ]
      : [];

  const runnerHandoffRequired = false;
  const runnerHandoff = null;

  const testingExitLifecycle = {
    active: directionalResolved,
    mode: "SIMPLIFIED_THREE_BLOCK_TESTING",
    block1: {
      exitIntent: "FIRST_ENTRY_INTO_TARGET_ZONE",
      price: target1Price,
    },
    block2: {
      exitIntent: "TARGET_ZONE_MIDLINE",
      price: target2Price,
    },
    block3: {
      exitIntent: "TARGET_ZONE_MIDLINE",
      price: target2Price,
    },
    fullCompletionBoundary:
      target2Price,
    remainingRunnerExpected: false,
    ema20RunnerEnabled: false,
    executionAuthorityCreated: false,
  };

  return {
    active: geometryReady,
    geometryReady,
    geometryFeasible,
    rawGeometryMathematicallyAvailable,
    status,

    engine: "engine26B.proposedGeometry.v2",
    contractVersion:
      "engine26.proposedGeometry.v2",
    geometryContractVersion:
      "engine26b.strategy1.v2",

    laneId,
    strategyId: resolvedStrategyId,
    candidateId,
    zoneId,
    symbol: resolvedSymbol,
    direction,
    directionState:
      directionState || null,
    contactState:
      contactState || null,
    chainArmed:
      candidate?.chainArmed === true ||
      handoff?.chainArmed === true,
    expectedReversalDirection:
      candidate?.expectedReversalDirection ??
      handoff?.expectedReversalDirection ??
      null,
    priorCandidateId:
      candidate?.priorCandidateId ??
      handoff?.priorCandidateId ??
      null,
    priorZoneId:
      candidate?.priorZoneId ??
      handoff?.priorZoneId ??
      null,
    priorRotationDirection:
      candidate?.priorRotationDirection ??
      handoff?.priorRotationDirection ??
      null,
    priorRotationCompletionState:
      candidate?.priorRotationCompletionState ??
      handoff?.priorRotationCompletionState ??
      null,
    priorRotationFullyComplete:
      candidate?.priorRotationFullyComplete === true ||
      handoff?.priorRotationFullyComplete === true,
    remainingRunnerExpected:
      candidate?.remainingRunnerExpected ??
      handoff?.remainingRunnerExpected ??
      false,
    completionBoundary:
      candidate?.completionBoundary ??
      handoff?.completionBoundary ??
      null,
    completedTargetZoneId:
      candidate?.completedTargetZoneId ??
      handoff?.completedTargetZoneId ??
      null,
    completedTargetZone:
      candidate?.completedTargetZone ??
      handoff?.completedTargetZone ??
      null,
    promotionReason:
      candidate?.promotionReason ??
      handoff?.promotionReason ??
      null,
    promotedFromTargetCompletion:
      candidate?.promotedFromTargetCompletion === true ||
      handoff?.promotedFromTargetCompletion === true,
    shortConfirmed: false,
    automaticDirectionFlip: false,
    negotiatedLineContact,
    longReversalWatch,
    directionResolvedAt:
      candidate?.directionResolvedAt ??
      handoff?.directionResolvedAt ??
      null,
    candidateLifecycleStartTime:
      candidate?.candidateLifecycleStartTime ??
      handoff?.candidateLifecycleStartTime ??
      null,
    directionalEvidence:
      candidate?.directionalEvidence ??
      handoff?.directionalEvidence ??
      null,
    ema10Posture:
      candidate?.ema10Posture ??
      handoff?.ema10Posture ??
      null,
    directionalResolved,
    setupType,
    setupClass,
    setupGrade,
    identitySetupKey,
    candidateIdentityVersion,

    entryZone,
    targetZone,
    locationInvalidationBoundary,
    locationStopReference:
      proposedStopPrice,

    proposedEntryPrice,
    proposedStopPrice,
    proposedStopDistancePoints,
    proposedTargets,
    testingExitLifecycle,
    remainingRunnerExpected: false,
    ema20RunnerEnabled: false,
    runnerHandoff,

    minimumObjectivePoints: 10,
    preferredObjectivePoints: 15,
    availableRewardPoints,
    distanceToTargetZoneLow,
    distanceToTargetZoneMidline,
    geometryObjectiveStatus,

    targetApproachWarningLow:
      !lockedPaperPackageValid &&
      negotiatedLineContact
        ? null
        : targetApproachWarningLow,
    targetApproachWarningHigh:
      !lockedPaperPackageValid &&
      negotiatedLineContact
        ? null
        : targetApproachWarningHigh,
    targetApproachWarningOwner:
      "ENGINE26B_GEOMETRY_ONLY",
    earlyWeaknessExitOwner: "ENGINE9",

    target1Price,
    target1Trigger:
      "FIRST_TOUCH_OF_TARGET_ZONE",
    target1RewardPoints,
    target1RiskReward,

    target2Price,
    target2Trigger:
      "TARGET_ZONE_MIDLINE",
    target2RewardPoints,
    target2RiskReward,

    target3Status:
      "TARGET_ZONE_MIDLINE_TESTING",
    target3Price:
      directionalResolved ? target2Price : null,
    runnerHandoffRequired,
    runnerHandoff,

    candidateStatus:
      candidateInvalidated
        ? "INVALIDATED"
        : candidate?.status ?? "ACTIVE",

    lifecycleStatus:
      geometryReady
        ? "GEOMETRY_READY"
        : status,

    permissionReady,
    lockedPaperPackageValid,
    geometryDirectionSource:
      lockedPaperPackageValid
        ? "ENGINE6_LOCKED_PAPER_PERMISSION"
        : "ENGINE26A_LOCATION_DIRECTION",
    permissionAuthority: "ENGINE6",
    planningPermissionConsumed:
      permissionReady,
    plannerProgressionAllowed:
      geometryReady && permissionReady,

    proposalOnly: true,
    plannerOnly: true,
    official: false,
    officialPlanOwner: "ENGINE9",

    nonExecutable: true,
    noPermissionCreated: true,
    noSizingCreated: true,
    noManagementCreated: true,
    noTradeCreated: true,
    noOrderCreated: true,
    noFillCreated: true,
    noExecution: true,
    noJournalWrite: true,

    requiresEngine7Sizing: true,
    requiresEngine9Management: true,
    requiresEngine8Execution: true,

    candidateIdentityPreserved:
      identityMatches,

    snapshotTime,

    warnings:
      geometryReady
        ? permissionReady
          ? []
          : ["ENGINE6_PERMISSION_NOT_READY"]
        : [status],

    reasonCodes: [
      "ENGINE26B_STRATEGY1_V2_BRANCH",
      geometryReady
        ? "ENGINE26B_STRATEGY1_GEOMETRY_READY"
        : status,
      !lockedPaperPackageValid &&
      longReversalWatch
        ? "ENGINE26B_LONG_REVERSAL_WATCH_NON_ACTIONABLE"
        : null,
      !lockedPaperPackageValid &&
      negotiatedLineContact
        ? "ENGINE26B_NEGOTIATED_LINE_CONTACT_NON_ACTIONABLE"
        : null,
      negotiatedLineContact
        ? "ENGINE26B_FULL_TARGET_COMPLETION"
        : null,
      negotiatedLineContact
        ? "ENGINE26B_CHAIN_ARMED_DIRECTION_UNRESOLVED"
        : null,
      negotiatedLineContact
        ? "ENGINE26B_NO_AUTOMATIC_SHORT"
        : null,
      geometryObjectiveStatus,
      identityMatches
        ? "ENGINE26A_IDENTITY_PRESERVED"
        : "ENGINE26A_IDENTITY_NOT_PRESERVED",
      permissionReady
        ? "ENGINE6_FAST_INTRADAY_PAPER_ALLOW_CONSUMED"
        : "ENGINE6_PERMISSION_SEPARATE_FROM_GEOMETRY",
      "SIMPLIFIED_THREE_BLOCK_TESTING_LIFECYCLE",
      "BLOCK_1_TARGET_ZONE_ENTRY",
      "BLOCKS_2_AND_3_TARGET_ZONE_MIDLINE",
      "EMA20_RUNNER_DISABLED",
      "NO_PERMISSION_CREATED",
      "NO_SIZING_CREATED",
      "NO_MANAGEMENT_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default evaluateStrategy1Geometry;
