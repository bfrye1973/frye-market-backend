// services/core/logic/engine7/v2/buildProposedSizingPreview.js
//
// Engine 7A — Proposed-Geometry Sizing Preview
//
// Purpose:
// - Consume Engine 26B proposed geometry.
// - Calculate informational ES contract sizing.
// - Remain non-executable at all times.
// - Never create permission, direction, geometry, orders, or fills.
//
// Permanent input:
// strategies["intraday_scalp@10m"].engine26ProposedGeometry
//
// Permanent output:
// strategies["intraday_scalp@10m"].engine7SizingPreview

const ENGINE = "engine7A.proposedSizingPreview.v2";
const CONTRACT_VERSION = "engine7.proposedSizingPreview.v1";

const ES_SYMBOL = "ES";
const ES_TICK_SIZE = 0.25;
const ES_DOLLARS_PER_POINT = 50;

const STRATEGY1_SETUP_CLASS =
  "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";
const STRATEGY1_LANE_ID = "minute";
const STRATEGY1_STRATEGY_ID = "intraday_scalp@10m";
const STRATEGY1_REQUESTED_CONTRACTS = 3;

const STRATEGY1_ALLOCATION = Object.freeze([
  Object.freeze({
    contractBlock: 1,
    contracts: 1,
    purpose: "TARGET_1_ZONE_TOUCH",
  }),
  Object.freeze({
    contractBlock: 2,
    contracts: 1,
    purpose: "TARGET_2_ZONE_MIDLINE",
  }),
  Object.freeze({
    contractBlock: 3,
    contracts: 1,
    purpose: "ENGINE9_RUNNER_HANDOFF",
  }),
]);

const STRATEGY1_THREE_CONTRACT_ALLOCATION = Object.freeze({
  block1Contracts: 1,
  block1Purpose: "TARGET_1_ZONE_TOUCH",
  block2Contracts: 1,
  block2Purpose: "TARGET_2_ZONE_MIDLINE",
  block3Contracts: 1,
  block3Purpose: "ENGINE9_RUNNER_HANDOFF",
  totalContracts: 3,
});

function isStrategy1PaperDataCollectionEnabled() {
  return process.env.ENGINE_STRATEGY1_PAPER_DATA_COLLECTION === "1";
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeString(value) {
  return String(value || "").trim();
}

function safeUpper(value) {
  return safeString(value).toUpperCase();
}

function round2(value) {
  const number = toNumber(value);
  return number == null ? null : Number(number.toFixed(2));
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function isPositiveNumber(value) {
  const number = toNumber(value);
  return number != null && number > 0;
}

function normalizeTargets(rawTargets) {
  if (Array.isArray(rawTargets)) {
    return rawTargets.filter(Boolean);
  }

  if (rawTargets && typeof rawTargets === "object") {
    return Object.entries(rawTargets)
      .filter(([key]) => key !== "labels")
      .map(([targetId, value]) => {
        const price =
          toNumber(value?.price) ??
          toNumber(value);

        if (price == null) return null;

        return {
          targetId,
          price,
          label:
            rawTargets?.labels?.[targetId] ??
            value?.label ??
            null,
        };
      })
      .filter(Boolean);
  }

  return [];
}

function normalizeEngine6Permission(engine6Permission) {
  const source =
    engine6Permission?.paper &&
    typeof engine6Permission.paper === "object"
      ? engine6Permission.paper
      : engine6Permission || {};

  const decision = safeUpper(
    source?.decision ??
      source?.permission
  );

  const allowed =
    source?.allowed === true ||
    ["ALLOW", "PAPER_ALLOW", "FAST_INTRADAY_PAPER_ALLOW"].includes(
      decision
    );

  const sizeMultiplier =
    toNumber(source?.sizeMultiplier);

  return {
    decision: decision || null,
    allowed,
    explicitAllowed: source?.allowed === true,
    sizeMultiplier,
    planningAllowed: source?.planningAllowed === true,
    laneId: source?.laneId ?? null,
    candidateId: source?.candidateId ?? null,
    zoneId: source?.zoneId ?? null,
    strategyId: source?.strategyId ?? null,
    symbol: source?.symbol ?? null,
    direction: source?.direction ?? null,
    setupType: source?.setupType ?? null,
    setupClass: source?.setupClass ?? null,
    setupGrade: source?.setupGrade ?? null,
    identitySetupKey: source?.identitySetupKey ?? null,
    candidateIdentityVersion:
      source?.candidateIdentityVersion ?? null,
    snapshotTime: source?.snapshotTime ?? null,
    reasonCodes: Array.isArray(source?.reasonCodes)
      ? source.reasonCodes
      : [],
  };
}

function normalizeEngine27Readiness(engine27Readiness) {
  const source =
    engine27Readiness &&
    typeof engine27Readiness === "object"
      ? engine27Readiness
      : {};

  const decisionState = safeUpper(
    source?.decisionState ??
      source?.state ??
      source?.readinessState ??
      source?.readiness
  );

  const ready =
    source?.ready === true ||
    source?.traderReady === true ||
    source?.readiness?.ready === true ||
    decisionState === "READY";

  return {
    decisionState: decisionState || null,
    ready,
    reactionReady: source?.reactionReady === true,
    participationReady: source?.participationReady === true,
    permissionReady: source?.permissionReady === true,
    plannerReady: source?.plannerReady === true,
    invalidated: source?.invalidated === true,
    laneId: source?.laneId ?? null,
    candidateId: source?.candidateId ?? null,
    zoneId: source?.zoneId ?? null,
    strategyId: source?.strategyId ?? null,
    symbol: source?.symbol ?? null,
    direction: source?.direction ?? null,
    setupType: source?.setupType ?? null,
    setupClass: source?.setupClass ?? null,
    setupGrade: source?.setupGrade ?? null,
    identitySetupKey: source?.identitySetupKey ?? null,
    candidateIdentityVersion:
      source?.candidateIdentityVersion ?? null,
    snapshotTime: source?.snapshotTime ?? null,
    reasonCodes: Array.isArray(source?.reasonCodes)
      ? source.reasonCodes
      : [],
  };
}


function normalizeIdentityValue(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function strategy1Identity(source = {}) {
  return {
    laneId: normalizeIdentityValue(source?.laneId),
    strategyId: normalizeIdentityValue(source?.strategyId),
    candidateId: normalizeIdentityValue(source?.candidateId),
    zoneId: normalizeIdentityValue(source?.zoneId),
    symbol: normalizeIdentityValue(source?.symbol),
    setupClass: normalizeIdentityValue(source?.setupClass),
    setupGrade: normalizeIdentityValue(source?.setupGrade),
    identitySetupKey:
      normalizeIdentityValue(source?.identitySetupKey),
    candidateIdentityVersion:
      normalizeIdentityValue(source?.candidateIdentityVersion),
  };
}

function compareStrategy1Identity(reference, candidate, sourceLabel) {
  const fields = [
    "laneId",
    "strategyId",
    "candidateId",
    "zoneId",
    "symbol",
    "setupClass",
    "setupGrade",
    "identitySetupKey",
    "candidateIdentityVersion",
  ];

  const mismatches = [];

  for (const field of fields) {
    if (reference[field] == null) {
      mismatches.push(`ENGINE26B_${field.toUpperCase()}_MISSING`);
      continue;
    }

    if (candidate[field] == null) {
      mismatches.push(`${sourceLabel}_${field.toUpperCase()}_MISSING`);
      continue;
    }

    if (reference[field] !== candidate[field]) {
      mismatches.push(`${sourceLabel}_${field.toUpperCase()}_MISMATCH`);
    }
  }

  return mismatches;
}

function strategy1TargetPurpose(target) {
  return safeUpper(
    target?.purpose ??
      target?.role ??
      target?.targetPurpose ??
      target?.targetType
  );
}

function buildStrategy1Targets(rawTargets) {
  const targets = Array.isArray(rawTargets)
    ? rawTargets.filter(Boolean)
    : [];

  const target1 = targets[0] || null;
  const target2 = targets[1] || null;
  const target3 = targets[2] || null;

  return {
    targets,
    target1,
    target2,
    target3,
    target1Price: toNumber(target1?.price ?? target1),
    target2Price: toNumber(target2?.price ?? target2),
    target3Purpose: strategy1TargetPurpose(target3),
    target3Price:
      target3 && Object.prototype.hasOwnProperty.call(target3, "price")
        ? target3.price
        : undefined,
  };
}

function buildStrategy1Phase7Preview({
  geometry,
  engine6,
  engine27,
  riskConfig,
  snapshotTime,
}) {
  const base = makeBaseOutput({
    geometry,
    engine6,
    engine27,
    snapshotTime,
  });

  const identity = strategy1Identity(geometry);
  const engine6Identity = strategy1Identity(engine6);
  const engine27Identity = strategy1Identity(engine27);

  const testingDataCollectionMode =
    isStrategy1PaperDataCollectionEnabled() &&
    identity.laneId === STRATEGY1_LANE_ID &&
    identity.strategyId === STRATEGY1_STRATEGY_ID &&
    identity.setupClass === STRATEGY1_SETUP_CLASS;

  const identityReasons = [
    ...compareStrategy1Identity(identity, engine6Identity, "ENGINE6"),
    ...compareStrategy1Identity(identity, engine27Identity, "ENGINE27E"),
  ];

  if (identity.laneId !== STRATEGY1_LANE_ID) {
    identityReasons.push("ENGINE7A_STRATEGY1_LANE_MISMATCH");
  }

  if (identity.strategyId !== STRATEGY1_STRATEGY_ID) {
    identityReasons.push("ENGINE7A_STRATEGY1_STRATEGY_MISMATCH");
  }

  if (identity.setupClass !== STRATEGY1_SETUP_CLASS) {
    identityReasons.push("ENGINE7A_STRATEGY1_SETUP_CLASS_MISMATCH");
  }

  const riskValidation = validateRiskConfig(riskConfig);
  const entryPrice = toNumber(geometry?.proposedEntryPrice);
  const stopPrice = toNumber(geometry?.proposedStopPrice);
  const providedStopDistance =
    toNumber(geometry?.proposedStopDistancePoints);
  const calculatedStopDistance =
    entryPrice != null && stopPrice != null
      ? round2(Math.abs(entryPrice - stopPrice))
      : null;
  const stopDistanceDifference =
    calculatedStopDistance != null && providedStopDistance != null
      ? round2(Math.abs(calculatedStopDistance - providedStopDistance))
      : null;

  const targetRead = buildStrategy1Targets(
    geometry?.proposedTargets
  );

  const engine6Ready =
    engine6.decision === "FAST_INTRADAY_PAPER_ALLOW" &&
    engine6.explicitAllowed === true &&
    engine6.planningAllowed === true;

  const geometryReady =
    geometry?.geometryReady === true;

  const geometryValid =
    isPositiveNumber(entryPrice) &&
    isPositiveNumber(stopPrice) &&
    stopPrice < entryPrice &&
    isPositiveNumber(providedStopDistance) &&
    stopDistanceDifference != null &&
    stopDistanceDifference <= ES_TICK_SIZE;

  const target1Ready =
    isPositiveNumber(targetRead.target1Price);
  const target2Ready =
    isPositiveNumber(targetRead.target2Price);
  const runnerReady =
    targetRead.target3Purpose === "ENGINE9_RUNNER_HANDOFF" &&
    targetRead.target3Price === null &&
    geometry?.runnerHandoffRequired === true;

  const engine27Ready =
    engine27.reactionReady === true &&
    engine27.participationReady === true &&
    engine27.permissionReady === true &&
    engine27.plannerReady === true &&
    engine27.invalidated !== true;

  const config = riskValidation.config;
  const rawRiskPerContract =
    riskValidation.valid && calculatedStopDistance != null
      ? round2(calculatedStopDistance * config.dollarsPerPoint)
      : null;
  const slippageRisk =
    riskValidation.valid
      ? round2(
          config.estimatedSlippagePointsPerSide *
            2 *
            config.dollarsPerPoint
        )
      : null;
  const riskPerContract =
    rawRiskPerContract != null && slippageRisk != null
      ? round2(
          rawRiskPerContract +
            slippageRisk +
            config.commissionDollarsPerContractRoundTrip
        )
      : null;
  const uncappedSupported =
    riskPerContract != null && riskPerContract > 0
      ? Math.floor(config.riskBudgetDollars / riskPerContract)
      : 0;
  const riskSupportedContracts = riskValidation.valid
    ? Math.max(0, Math.min(uncappedSupported, config.maximumContracts))
    : 0;
  const proposedContracts = Math.min(
    STRATEGY1_REQUESTED_CONTRACTS,
    riskSupportedContracts
  );
  const riskLimited =
    riskValidation.valid &&
    riskSupportedContracts < STRATEGY1_REQUESTED_CONTRACTS;

  const invalidated =
    engine27.invalidated === true ||
    safeUpper(geometry?.candidateStatus).includes("INVALIDATED") ||
    safeUpper(geometry?.lifecycleStatus).includes("INVALIDATED");

  const nonRiskGatesPass =
    identityReasons.length === 0 &&
    identity.laneId === STRATEGY1_LANE_ID &&
    identity.strategyId === STRATEGY1_STRATEGY_ID &&
    identity.setupClass === STRATEGY1_SETUP_CLASS &&
    invalidated !== true &&
    engine6Ready === true &&
    geometryReady === true &&
    geometryValid === true &&
    target1Ready === true &&
    target2Ready === true &&
    runnerReady === true &&
    engine27Ready === true;

  const testingThreeContractPlanQualified =
    testingDataCollectionMode === true &&
    riskValidation.valid === true &&
    nonRiskGatesPass === true;

  const paperTestingContracts =
    testingThreeContractPlanQualified
      ? STRATEGY1_REQUESTED_CONTRACTS
      : 0;

  const testingRiskOverrideApplied =
    testingThreeContractPlanQualified === true;

  const blockers = unique([
    ...identityReasons,
    !engine6Ready ? "ENGINE6_PLANNING_PERMISSION_REQUIRED" : null,
    !geometryReady ? "ENGINE26B_GEOMETRY_READY_REQUIRED" : null,
    !geometryValid ? "ENGINE26B_GEOMETRY_INVALID" : null,
    !target1Ready ? "ENGINE26B_TARGET1_REQUIRED" : null,
    !target2Ready ? "ENGINE26B_TARGET2_REQUIRED" : null,
    !runnerReady ? "ENGINE26B_RUNNER_HANDOFF_REQUIRED" : null,
    !engine27.reactionReady ? "ENGINE27E_REACTION_READY_REQUIRED" : null,
    !engine27.participationReady ? "ENGINE27E_PARTICIPATION_READY_REQUIRED" : null,
    !engine27.permissionReady ? "ENGINE27E_PERMISSION_READY_REQUIRED" : null,
    !engine27.plannerReady ? "ENGINE27E_PLANNER_READY_REQUIRED" : null,
    invalidated ? "ENGINE27E_CANDIDATE_INVALIDATED" : null,
    !riskValidation.valid ? riskValidation.status : null,
    riskLimited ? "ENGINE7A_RISK_SUPPORTS_FEWER_THAN_THREE" : null,
  ]);

  const threeContractPlanQualified =
    blockers.length === 0 &&
    riskSupportedContracts >= STRATEGY1_REQUESTED_CONTRACTS;
  const sizingReady = threeContractPlanQualified;

  let sizingState = "WAITING_FOR_UPSTREAM";
  let status = "STRATEGY1_PRELIMINARY_SIZING_WAITING";

  if (invalidated) {
    sizingState = "INVALIDATED";
    status = "CANDIDATE_INVALIDATED";
  } else if (identityReasons.length > 0) {
    sizingState = "IDENTITY_MISMATCH";
    status = "PROPOSED_GEOMETRY_IDENTITY_MISMATCH";
  } else if (!riskValidation.valid) {
    sizingState = "RISK_EVIDENCE_UNAVAILABLE";
    status = riskValidation.status;
  } else if (riskLimited) {
    sizingState = "RISK_LIMITED";
    status = "STRATEGY1_RISK_LIMITED";
  } else if (sizingReady) {
    sizingState = "THREE_CONTRACT_PREVIEW_READY";
    status = "STRATEGY1_THREE_CONTRACT_PREVIEW_READY";
  }

  return {
    ...base,
    active: true,

    laneId: identity.laneId,
    strategyId: identity.strategyId,
    candidateId: identity.candidateId,
    zoneId: identity.zoneId,
    symbol: identity.symbol,
    setupClass: identity.setupClass,
    setupGrade: identity.setupGrade,
    identitySetupKey: identity.identitySetupKey,
    candidateIdentityVersion:
      identity.candidateIdentityVersion,

    proposedEntryPrice: entryPrice,
    proposedStopPrice: stopPrice,
    proposedStopDistancePoints: providedStopDistance,
    providedStopDistancePoints: providedStopDistance,
    calculatedStopDistancePoints: calculatedStopDistance,
    stopDistanceDifferencePoints: stopDistanceDifference,
    proposedTargets: targetRead.targets,
    runnerHandoffRequired:
      geometry?.runnerHandoffRequired === true,

    engine6Permission: engine6.decision,
    engine6Allowed: engine6.explicitAllowed === true,
    engine6PlanningAllowed:
      engine6.planningAllowed === true,

    reactionReady: engine27.reactionReady === true,
    participationReady:
      engine27.participationReady === true,
    permissionReady:
      engine27.permissionReady === true,
    plannerReady: engine27.plannerReady === true,
    invalidated,

    geometryReady,
    target1Ready,
    target2Ready,
    runnerHandoffReady: runnerReady,

    riskBudgetDollars:
      config?.riskBudgetDollars ?? null,
    dollarsPerPoint:
      config?.dollarsPerPoint ?? ES_DOLLARS_PER_POINT,
    minimumContracts:
      config?.minimumContracts ?? null,
    maximumContracts:
      config?.maximumContracts ?? null,
    rawRiskPerContract,
    estimatedSlippageRiskPerContract: slippageRisk,
    commissionDollarsPerContractRoundTrip:
      config?.commissionDollarsPerContractRoundTrip ?? null,
    estimatedRiskPerContract: riskPerContract,

    threeContractPlanRequested: true,
    requestedContracts: STRATEGY1_REQUESTED_CONTRACTS,
    threeContractPlanQualified,
    riskSupportedContracts,
    proposedContracts,
    estimatedContracts: proposedContracts,
    estimatedRiskDollars:
      riskPerContract == null
        ? 0
        : round2(proposedContracts * riskPerContract),
    riskLimited,

    productionRiskBudgetDollars:
      config?.riskBudgetDollars ?? null,
    productionRiskSupportedContracts:
      riskSupportedContracts,
    productionEstimatedRiskDollars:
      riskPerContract == null
        ? 0
        : round2(proposedContracts * riskPerContract),
    productionThreeContractPlanQualified:
      threeContractPlanQualified,
    productionRiskLimited:
      riskLimited,

    testingDataCollectionMode,
    paperTestingContracts,
    testingThreeContractPlanQualified,
    testingRiskOverrideApplied,

    allocation: STRATEGY1_ALLOCATION.map((block) => ({
      ...block,
    })),
    threeContractAllocation: {
      ...STRATEGY1_THREE_CONTRACT_ALLOCATION,
    },
    totalContracts:
      sizingReady ? STRATEGY1_REQUESTED_CONTRACTS : proposedContracts,
    target1Contracts: sizingReady ? 1 : 0,
    target2Contracts: sizingReady ? 1 : 0,
    runnerContracts: sizingReady ? 1 : 0,

    sizingReady,
    sizingState,
    sizingPreviewAvailable:
      riskValidation.valid && geometryValid,
    allowedPreview: sizingReady,

    executableSizing: false,
    nonExecutable: true,
    noPermissionCreated: true,
    noOfficialPlanCreated: true,
    noManagementCreated: true,
    noRunnerTargetCreated: true,
    noOrderCreated: true,
    noFillCreated: true,
    noJournalEventCreated: true,
    noBrokerOrder: true,
    noExecution: true,

    status,
    blockers,
    warnings: [],
    reasonCodes: unique([
      "ENGINE7A_STRATEGY1_PHASE7_APPLIED",
      engine6Ready ? "ENGINE6_PLANNING_PERMISSION_READY" : null,
      geometryReady ? "ENGINE26B_GEOMETRY_READY" : null,
      engine27Ready ? "ENGINE27E_FULLY_READY" : null,
      runnerReady ? "ENGINE9_RUNNER_HANDOFF_PRESERVED" : null,
      sizingReady ? "ENGINE7A_THREE_CONTRACT_PREVIEW_READY" : null,
      riskLimited ? "ENGINE7A_THREE_CONTRACT_PLAN_RISK_LIMITED" : null,
      testingDataCollectionMode
        ? "ENGINE7A_PAPER_DATA_COLLECTION_MODE_ACTIVE"
        : "ENGINE7A_PAPER_DATA_COLLECTION_MODE_OFF",
      testingThreeContractPlanQualified
        ? "ENGINE7A_TESTING_THREE_CONTRACT_PLAN_QUALIFIED"
        : null,
      testingRiskOverrideApplied
        ? "ENGINE7A_TESTING_RISK_OVERRIDE_APPLIED"
        : null,
      ...riskValidation.reasonCodes,
      ...blockers,
      "ENGINE7A_PRELIMINARY_SIZING_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_MANAGEMENT_CREATED",
      "NO_ORDER_CREATED",
      "NO_EXECUTION",
    ]),
  };
}

function validateRiskConfig(riskConfig) {
  if (!riskConfig || typeof riskConfig !== "object") {
    return {
      valid: false,
      status: "RISK_CONFIG_MISSING",
      reasonCodes: ["ENGINE7A_RISK_CONFIG_MISSING"],
      config: null,
    };
  }

  const riskBudgetDollars =
    toNumber(riskConfig.riskBudgetDollars);

  const dollarsPerPoint =
    toNumber(riskConfig.dollarsPerPoint) ??
    ES_DOLLARS_PER_POINT;

  const minimumContracts =
    toNumber(riskConfig.minimumContracts);

  const maximumContracts =
    toNumber(riskConfig.maximumContracts);

  const estimatedSlippagePointsPerSide =
    toNumber(
      riskConfig.estimatedSlippagePointsPerSide
    );

  const commissionDollarsPerContractRoundTrip =
    toNumber(
      riskConfig.commissionDollarsPerContractRoundTrip
    );

  const roundingRule =
    safeUpper(riskConfig.roundingRule || "FLOOR");

  const invalidReasons = [];

  if (
    riskBudgetDollars == null ||
    riskBudgetDollars <= 0
  ) {
    invalidReasons.push("INVALID_RISK_BUDGET_DOLLARS");
  }

  if (
    dollarsPerPoint == null ||
    dollarsPerPoint <= 0
  ) {
    invalidReasons.push("INVALID_DOLLARS_PER_POINT");
  }

  if (
    minimumContracts == null ||
    minimumContracts < 1 ||
    !Number.isInteger(minimumContracts)
  ) {
    invalidReasons.push("INVALID_MINIMUM_CONTRACTS");
  }

  if (
    maximumContracts == null ||
    maximumContracts < 1 ||
    !Number.isInteger(maximumContracts)
  ) {
    invalidReasons.push("INVALID_MAXIMUM_CONTRACTS");
  }

  if (
    minimumContracts != null &&
    maximumContracts != null &&
    minimumContracts > maximumContracts
  ) {
    invalidReasons.push(
      "MINIMUM_CONTRACTS_EXCEEDS_MAXIMUM"
    );
  }

  if (
    estimatedSlippagePointsPerSide == null ||
    estimatedSlippagePointsPerSide < 0
  ) {
    invalidReasons.push(
      "INVALID_ESTIMATED_SLIPPAGE_POINTS"
    );
  }

  if (
    commissionDollarsPerContractRoundTrip == null ||
    commissionDollarsPerContractRoundTrip < 0
  ) {
    invalidReasons.push(
      "INVALID_COMMISSION_DOLLARS"
    );
  }

  if (roundingRule !== "FLOOR") {
    invalidReasons.push(
      "UNSUPPORTED_ROUNDING_RULE"
    );
  }

  if (invalidReasons.length > 0) {
    return {
      valid: false,
      status: "RISK_CONFIG_INVALID",
      reasonCodes: unique([
        "ENGINE7A_RISK_CONFIG_INVALID",
        ...invalidReasons,
      ]),
      config: {
        riskBudgetDollars,
        dollarsPerPoint,
        minimumContracts,
        maximumContracts,
        estimatedSlippagePointsPerSide,
        commissionDollarsPerContractRoundTrip,
        roundingRule,
      },
    };
  }

  return {
    valid: true,
    status: "RISK_CONFIG_VALID",
    reasonCodes: [
      "ENGINE7A_RISK_CONFIG_VALID",
    ],
    config: {
      instrument:
        safeUpper(riskConfig.instrument || ES_SYMBOL),
      riskBudgetDollars,
      dollarsPerPoint,
      minimumContracts,
      maximumContracts,
      estimatedSlippagePointsPerSide,
      commissionDollarsPerContractRoundTrip,
      roundingRule,
      paperOnly: riskConfig.paperOnly !== false,
    },
  };
}

function calculateTargetMetrics({
  direction,
  entryPrice,
  targets,
  stopDistancePoints,
}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    return {
      targetGeometryAvailable: false,
      targetReferencePrice: null,
      estimatedRewardPoints: null,
      estimatedRewardRisk: null,
    };
  }

  const normalizedDirection = safeUpper(direction);

  const validTargets = targets
    .map((target) => ({
      ...target,
      price: toNumber(target?.price),
    }))
    .filter((target) => {
      if (target.price == null) return false;

      if (normalizedDirection === "LONG") {
        return target.price > entryPrice;
      }

      if (normalizedDirection === "SHORT") {
        return target.price < entryPrice;
      }

      return false;
    });

  if (validTargets.length === 0) {
    return {
      targetGeometryAvailable: false,
      targetReferencePrice: null,
      estimatedRewardPoints: null,
      estimatedRewardRisk: null,
    };
  }

  const target =
    normalizedDirection === "LONG"
      ? validTargets.sort(
          (a, b) => a.price - b.price
        )[0]
      : validTargets.sort(
          (a, b) => b.price - a.price
        )[0];

  const estimatedRewardPoints =
    normalizedDirection === "LONG"
      ? round2(target.price - entryPrice)
      : round2(entryPrice - target.price);

  const estimatedRewardRisk =
    estimatedRewardPoints != null &&
    stopDistancePoints > 0
      ? round2(
          estimatedRewardPoints /
            stopDistancePoints
        )
      : null;

  return {
    targetGeometryAvailable: true,
    targetReferencePrice: target.price,
    estimatedRewardPoints,
    estimatedRewardRisk,
  };
}

function makeBaseOutput({
  geometry,
  engine6,
  engine27,
  snapshotTime,
}) {
  return {
    active: false,

    engine: ENGINE,
    contractVersion: CONTRACT_VERSION,
    mode: "PROPOSED_GEOMETRY_PREVIEW",

    candidateId: geometry?.candidateId ?? null,
    zoneId: geometry?.zoneId ?? null,
    strategyId: geometry?.strategyId ?? null,
    symbol: geometry?.symbol ?? null,
    direction: geometry?.direction ?? null,
    setupType: geometry?.setupType ?? null,

    tradeId: null,
    idempotencyKey: null,

    proposedEntryPrice:
      toNumber(geometry?.proposedEntryPrice),

    proposedStopPrice:
      toNumber(geometry?.proposedStopPrice),

    proposedStopDistancePoints:
      toNumber(
        geometry?.proposedStopDistancePoints
      ),

    providedStopDistancePoints:
      toNumber(
        geometry?.proposedStopDistancePoints
      ),

    calculatedStopDistancePoints: null,
    stopDistanceDifferencePoints: null,

    proposedTargets: normalizeTargets(
      geometry?.proposedTargets
    ),

    targetGeometryAvailable: false,
    targetReferencePrice: null,
    estimatedRewardPoints: null,
    estimatedRewardRisk: null,

    riskBudgetDollars: null,
    dollarsPerPoint: ES_DOLLARS_PER_POINT,
    minimumContracts: null,
    maximumContracts: null,

    rawRiskPerContract: null,
    estimatedSlippageRiskPerContract: null,
    commissionDollarsPerContractRoundTrip: null,
    estimatedRiskPerContract: null,

    estimatedContracts: 0,
    estimatedRiskDollars: 0,

    engine6Permission:
      engine6?.decision ?? null,

    engine6Allowed:
      engine6?.allowed === true,

    engine6SizeMultiplier:
      engine6?.sizeMultiplier ?? null,

    permissionReady:
      engine6?.allowed === true,

    engine27DecisionState:
      engine27?.decisionState ?? null,

    engine27Ready:
      engine27?.ready === true,

    traderReady:
      engine27?.ready === true,

    sizingPreviewAvailable: false,
    allowedPreview: false,

    requiresEngine6Permission: true,
    requiresEngine27Ready: true,
    requiresEngine9OfficialPlan: true,

    executableSizing: false,
    nonExecutable: true,

    noPermissionCreated: true,
    noOfficialPlanCreated: true,
    noOrderCreated: true,
    noBrokerOrder: true,
    noExecution: true,

    status: "PROPOSED_GEOMETRY_UNAVAILABLE",
    warnings: [],
    reasonCodes: [],

    snapshotTime:
      geometry?.snapshotTime ??
      snapshotTime ??
      new Date().toISOString(),
  };
}

/**
 * Build Engine 7A informational sizing from Engine 26B proposed geometry.
 *
 * Engine 6 permission and Engine 27 readiness affect status only.
 * They do not force the informational estimated contract count to zero.
 *
 * @param {object} input
 * @param {object} input.engine26ProposedGeometry
 * @param {object|null} input.engine6PaperPermission
 * @param {object|null} input.engine27MinuteReadiness
 * @param {object|null} input.riskConfig
 * @param {string|null} input.snapshotTime
 */
export function buildEngine7ProposedSizingPreview({
  engine26ProposedGeometry,
  engine6PaperPermission = null,
  engine27MinuteReadiness = null,
  riskConfig = null,
  snapshotTime = null,
} = {}) {
  const geometry =
    engine26ProposedGeometry &&
    typeof engine26ProposedGeometry === "object"
      ? engine26ProposedGeometry
      : null;

  const engine6 = normalizeEngine6Permission(
    engine6PaperPermission
  );

  const engine27 = normalizeEngine27Readiness(
    engine27MinuteReadiness
  );

  const output = makeBaseOutput({
    geometry,
    engine6,
    engine27,
    snapshotTime,
  });

  if (!geometry) {
    return {
      ...output,
      status: "PROPOSED_GEOMETRY_UNAVAILABLE",
      reasonCodes: [
        "ENGINE7A_PROPOSED_GEOMETRY_MISSING",
      ],
    };
  }

  if (
    safeUpper(geometry?.setupClass) ===
    STRATEGY1_SETUP_CLASS
  ) {
    return buildStrategy1Phase7Preview({
      geometry,
      engine6,
      engine27,
      riskConfig,
      snapshotTime,
    });
  }

  const candidateStatus =
    safeUpper(geometry.candidateStatus);

  const lifecycleStatus =
    safeUpper(geometry.lifecycleStatus);

  const candidateInvalidated =
    candidateStatus.includes("INVALIDATED") ||
    lifecycleStatus.includes("INVALIDATED");

  if (candidateInvalidated) {
    return {
      ...output,
      status: "CANDIDATE_INVALIDATED",
      reasonCodes: [
        "ENGINE7A_CANDIDATE_INVALIDATED",
      ],
    };
  }

  const identityComplete =
    Boolean(geometry.candidateId) &&
    Boolean(geometry.zoneId) &&
    Boolean(geometry.strategyId) &&
    Boolean(geometry.symbol) &&
    Boolean(geometry.direction) &&
    Boolean(geometry.setupType) &&
    Boolean(geometry.snapshotTime);

  if (
    identityComplete !== true ||
    geometry.candidateIdentityPreserved !== true
  ) {
    return {
      ...output,
      status:
        "PROPOSED_GEOMETRY_IDENTITY_MISMATCH",

      estimatedContracts: 0,
      estimatedRiskDollars: 0,
      sizingPreviewAvailable: false,

      reasonCodes: [
        "ENGINE7A_IDENTITY_MATCH_REQUIRED",
        !geometry.candidateId
          ? "CANDIDATE_ID_MISSING"
          : null,
        !geometry.zoneId
          ? "ZONE_ID_MISSING"
          : null,
        !geometry.strategyId
          ? "STRATEGY_ID_MISSING"
          : null,
        !geometry.symbol
          ? "SYMBOL_MISSING"
          : null,
        !geometry.direction
          ? "DIRECTION_MISSING"
          : null,
        !geometry.setupType
          ? "SETUP_TYPE_MISSING"
          : null,
        !geometry.snapshotTime
          ? "SNAPSHOT_TIME_MISSING"
          : null,
        geometry.candidateIdentityPreserved !== true
          ? "CANDIDATE_IDENTITY_NOT_PRESERVED"
          : null,
      ].filter(Boolean),
    };
  }

  const symbol = safeUpper(geometry.symbol);
  const direction = safeUpper(geometry.direction);

  const entryPrice =
    toNumber(geometry.proposedEntryPrice);

  const stopPrice =
    toNumber(geometry.proposedStopPrice);

  const providedStopDistance =
    toNumber(
      geometry.proposedStopDistancePoints
    );

  const directionValid =
    direction === "LONG" ||
    direction === "SHORT";

  const directionallyValid =
    direction === "LONG"
      ? stopPrice != null &&
        entryPrice != null &&
        stopPrice < entryPrice
      : direction === "SHORT"
      ? stopPrice != null &&
        entryPrice != null &&
        stopPrice > entryPrice
      : false;

  if (
    symbol !== ES_SYMBOL ||
    !directionValid ||
    !isPositiveNumber(entryPrice) ||
    !isPositiveNumber(stopPrice) ||
    !isPositiveNumber(providedStopDistance) ||
    !directionallyValid
  ) {
    return {
      ...output,
      status: "PROPOSED_GEOMETRY_INVALID",

      reasonCodes: unique([
        "ENGINE7A_PROPOSED_GEOMETRY_INVALID",
        symbol !== ES_SYMBOL
          ? "ENGINE7A_ES_ONLY"
          : null,
        !directionValid
          ? "INVALID_DIRECTION"
          : null,
        !isPositiveNumber(entryPrice)
          ? "INVALID_PROPOSED_ENTRY_PRICE"
          : null,
        !isPositiveNumber(stopPrice)
          ? "INVALID_PROPOSED_STOP_PRICE"
          : null,
        !isPositiveNumber(providedStopDistance)
          ? "INVALID_PROPOSED_STOP_DISTANCE"
          : null,
        !directionallyValid
          ? "STOP_NOT_DIRECTIONALLY_VALID"
          : null,
      ]),
    };
  }

  const calculatedStopDistance =
    round2(Math.abs(entryPrice - stopPrice));

  const stopDistanceDifference =
    round2(
      Math.abs(
        calculatedStopDistance -
          providedStopDistance
      )
    );

  const geometryWithDistance = {
    ...output,
    calculatedStopDistancePoints:
      calculatedStopDistance,

    stopDistanceDifferencePoints:
      stopDistanceDifference,
  };

  if (
    stopDistanceDifference == null ||
    stopDistanceDifference > ES_TICK_SIZE
  ) {
    return {
      ...geometryWithDistance,
      status: "PROPOSED_STOP_DISTANCE_MISMATCH",

      estimatedContracts: 0,
      estimatedRiskDollars: 0,
      sizingPreviewAvailable: false,

      reasonCodes: [
        "ENGINE7A_PROPOSED_STOP_DISTANCE_MISMATCH",
        "PROVIDED_DISTANCE_DOES_NOT_MATCH_ENTRY_STOP",
      ],
    };
  }

  const riskValidation =
    validateRiskConfig(riskConfig);

  if (!riskValidation.valid) {
    return {
      ...geometryWithDistance,
      status: riskValidation.status,
      reasonCodes: riskValidation.reasonCodes,
    };
  }

  const config = riskValidation.config;

  const rawRiskPerContract =
    round2(
      calculatedStopDistance *
        config.dollarsPerPoint
    );

  const estimatedSlippageRiskPerContract =
    round2(
      config.estimatedSlippagePointsPerSide *
        2 *
        config.dollarsPerPoint
    );

  const estimatedRiskPerContract =
    round2(
      rawRiskPerContract +
        estimatedSlippageRiskPerContract +
        config.commissionDollarsPerContractRoundTrip
    );

  const uncappedContracts =
    estimatedRiskPerContract > 0
      ? Math.floor(
          config.riskBudgetDollars /
            estimatedRiskPerContract
        )
      : 0;

  const estimatedContracts = Math.min(
    uncappedContracts,
    config.maximumContracts
  );

  const estimatedRiskDollars =
    round2(
      estimatedContracts *
        estimatedRiskPerContract
    );

  const targetMetrics = calculateTargetMetrics({
    direction,
    entryPrice,
    targets: output.proposedTargets,
    stopDistancePoints:
      calculatedStopDistance,
  });

  const warnings = [];

  if (!targetMetrics.targetGeometryAvailable) {
    warnings.push("PROPOSED_TARGETS_UNAVAILABLE");
  }

  if (estimatedContracts < config.minimumContracts) {
    return {
      ...geometryWithDistance,

      active: true,

      riskBudgetDollars:
        config.riskBudgetDollars,

      dollarsPerPoint:
        config.dollarsPerPoint,

      minimumContracts:
        config.minimumContracts,

      maximumContracts:
        config.maximumContracts,

      rawRiskPerContract,
      estimatedSlippageRiskPerContract,

      commissionDollarsPerContractRoundTrip:
        config.commissionDollarsPerContractRoundTrip,

      estimatedRiskPerContract,

      estimatedContracts: 0,
      estimatedRiskDollars: 0,

      ...targetMetrics,

      sizingPreviewAvailable: true,
      allowedPreview: false,

      status: "RISK_BUDGET_TOO_SMALL",

      warnings,

      reasonCodes: unique([
        ...riskValidation.reasonCodes,
        "ENGINE7A_SIZING_CALCULATED",
        "RISK_BUDGET_BELOW_ONE_CONTRACT",
        "ENGINE9_OFFICIAL_PLAN_REQUIRED",
        "NO_EXECUTION",
      ]),
    };
  }

  const setupReady =
    engine6.allowed === true &&
    engine27.ready === true;

  const status = setupReady
    ? "PREVIEW_ONLY_AWAITING_ENGINE9_OFFICIAL_PLAN"
    : "PREVIEW_ONLY_SETUP_NOT_READY";

  return {
    ...geometryWithDistance,

    active: true,

    riskBudgetDollars:
      config.riskBudgetDollars,

    dollarsPerPoint:
      config.dollarsPerPoint,

    minimumContracts:
      config.minimumContracts,

    maximumContracts:
      config.maximumContracts,

    rawRiskPerContract,
    estimatedSlippageRiskPerContract,

    commissionDollarsPerContractRoundTrip:
      config.commissionDollarsPerContractRoundTrip,

    estimatedRiskPerContract,
    estimatedContracts,
    estimatedRiskDollars,

    ...targetMetrics,

    sizingPreviewAvailable: true,
    allowedPreview: true,

    status,

    warnings,

    reasonCodes: unique([
      ...riskValidation.reasonCodes,
      ...engine6.reasonCodes,
      ...engine27.reasonCodes,

      "ENGINE7A_PROPOSED_GEOMETRY_CONSUMED",
      "ENGINE7A_STOP_DISTANCE_VALIDATED",
      "ENGINE7A_INFORMATIONAL_SIZE_CALCULATED",

      engine6.allowed
        ? "ENGINE6_PERMISSION_READY"
        : "ENGINE6_PERMISSION_REQUIRED",

      engine27.ready
        ? "ENGINE27_READY"
        : "ENGINE27_READY_REQUIRED",

      "ENGINE9_OFFICIAL_PLAN_REQUIRED",
      "ENGINE7A_PREVIEW_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_ORDER_CREATED",
      "NO_EXECUTION",
    ]),
  };
}

export default buildEngine7ProposedSizingPreview;
