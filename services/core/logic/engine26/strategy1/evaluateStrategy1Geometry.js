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

  const setupClass =
    candidate?.setupClass ??
    handoff?.setupClass ??
    null;

  const candidateIdentityVersion =
    candidate?.candidateIdentityVersion ??
    handoff?.candidateIdentityVersion ??
    null;

  const isReadableStrategy1 =
    [V1_SETUP_CLASS, V2_SETUP_CLASS].includes(
      setupClass
    ) &&
    (
      candidate?.laneId ??
      handoff?.laneId
    ) === "minute" &&
    (
      candidate?.strategyId ??
      handoff?.strategyId ??
      strategyId
    ) === "intraday_scalp@10m";

  if (!isReadableStrategy1) return null;

  const laneId =
    candidate?.laneId ??
    handoff?.laneId ??
    null;

  const candidateId =
    candidate?.candidateId ?? null;

  const zoneId =
    candidate?.zoneId ?? null;

  const resolvedStrategyId =
    candidate?.strategyId ??
    strategyId ??
    null;

  const resolvedSymbol =
    candidate?.symbol ??
    symbol ??
    null;

  const snapshotTime =
    candidate?.snapshotTime ??
    handoff?.snapshotTime ??
    null;

  const direction = safeUpper(
    candidate?.directionBias ??
    candidate?.tradeDirectionBias ??
    candidate?.direction ??
    handoff?.direction ??
    "NEUTRAL"
  );

  const directionalResolved =
    ["LONG", "SHORT"].includes(direction);

  const setupType =
    candidate?.setupType ??
    setupClass;

  const setupGrade =
    candidate?.setupGrade ??
    handoff?.setupGrade ??
    null;

  const identitySetupKey =
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
    paper?.decision ===
      "FAST_INTRADAY_PAPER_ALLOW" &&
    paper?.allowed === true &&
    paper?.planningAllowed === true;

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
    direction === safeUpper(
      handoff?.direction ??
      candidate?.directionBias ??
      candidate?.direction
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

  const proposedTargets = [
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
      targetId: "TARGET_3_ENGINE9_RUNNER",
      sequence: 3,
      price: null,
      purpose: "ENGINE9_RUNNER_HANDOFF",
      contracts: 1,
      runnerHandoffRequired: true,
    },
  ];

  const runnerTarget =
    proposedTargets.find(
      (target) =>
        target?.targetId ===
        "TARGET_3_ENGINE9_RUNNER"
    ) || null;

  const runnerHandoffRequired =
    geometryReady === true &&
    runnerTarget?.purpose ===
      "ENGINE9_RUNNER_HANDOFF" &&
    runnerTarget?.price === null &&
    runnerTarget?.runnerHandoffRequired === true;

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
      candidate?.directionState ??
      handoff?.directionState ??
      null,
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

    minimumObjectivePoints: 10,
    preferredObjectivePoints: 15,
    availableRewardPoints,
    distanceToTargetZoneLow,
    distanceToTargetZoneMidline,
    geometryObjectiveStatus,

    targetApproachWarningLow,
    targetApproachWarningHigh,
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
      "ENGINE9_RUNNER_HANDOFF",
    target3Price: null,
    runnerHandoffRequired,

    candidateStatus:
      candidateInvalidated
        ? "INVALIDATED"
        : candidate?.status ?? "ACTIVE",

    lifecycleStatus:
      geometryReady
        ? "GEOMETRY_READY"
        : status,

    permissionReady,
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
      geometryObjectiveStatus,
      identityMatches
        ? "ENGINE26A_IDENTITY_PRESERVED"
        : "ENGINE26A_IDENTITY_NOT_PRESERVED",
      permissionReady
        ? "ENGINE6_FAST_INTRADAY_PAPER_ALLOW_CONSUMED"
        : "ENGINE6_PERMISSION_SEPARATE_FROM_GEOMETRY",
      "TWO_NUMERIC_TARGETS_ONLY",
      "ENGINE9_RUNNER_HANDOFF_PRICE_NULL",
      "NO_PERMISSION_CREATED",
      "NO_SIZING_CREATED",
      "NO_MANAGEMENT_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default evaluateStrategy1Geometry;
