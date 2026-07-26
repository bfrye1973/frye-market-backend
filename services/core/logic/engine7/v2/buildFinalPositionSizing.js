// services/core/logic/engine7/v2/buildFinalPositionSizing.js
//
// Engine 7B — Final Position Sizing
//
// Purpose:
// - Consume Engine 9 official management geometry.
// - Calculate the final ES paper contract quantity.
// - Require Engine 6 permission, Engine 27E readiness, valid identity,
//   valid official geometry, valid risk configuration, and no duplicate block.
// - Remain non-executing.
// - Never create tradeId, idempotencyKey, orderId, orders, or fills.
//
// Canonical input:
// strategies["intraday_scalp@10m"].engine9OfficialManagementPlan
//
// Canonical output:
// strategies["intraday_scalp@10m"].engine7PositionSizing
//
// Lifecycle ownership:
// - Engine 7B preserves planId.
// - Engine 8 creates tradeId, idempotencyKey, and orderId.

const ENGINE = "engine7B.finalPositionSizing.v2";
const CONTRACT_VERSION = "engine7.finalPositionSizing.v1";

const ES_SYMBOL = "ES";
const ES_TICK_SIZE = 0.25;
const ES_DOLLARS_PER_POINT = 50;

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

function safeString(value) {
  return String(value || "").trim();
}

function safeUpper(value) {
  return safeString(value).toUpperCase();
}

function round2(value) {
  const number = toNumber(value);

  return number == null
    ? null
    : Number(number.toFixed(2));
}

function unique(values = []) {
  return [
    ...new Set(values.filter(Boolean)),
  ];
}

function isPositiveNumber(value) {
  const number = toNumber(value);

  return (
    number != null &&
    number > 0
  );
}

function normalizeEngine6Permission(
  engine6PaperPermission
) {
  const source =
    engine6PaperPermission?.paper &&
    typeof engine6PaperPermission.paper === "object"
      ? engine6PaperPermission.paper
      : engine6PaperPermission &&
        typeof engine6PaperPermission === "object"
      ? engine6PaperPermission
      : {};

  const decision = safeUpper(
    source?.decision ??
      source?.permission
  );

  const allowed =
    source?.allowed === true &&
    [
      "PAPER_ALLOW",
      "FAST_INTRADAY_PAPER_ALLOW",
      "ALLOW",
    ].includes(decision);

  const sizeMultiplier =
    toNumber(source?.sizeMultiplier);

  return {
    decision: decision || null,
    allowed,

    sizeMultiplier:
      sizeMultiplier != null
        ? sizeMultiplier
        : allowed
        ? 1
        : 0,

    candidateId:
      source?.candidateId ?? null,

    zoneId:
      source?.zoneId ?? null,

    strategyId:
      source?.strategyId ?? null,

    symbol:
      source?.symbol ?? null,

    direction:
      source?.direction ?? null,

    setupType:
      source?.setupType ?? null,

    snapshotTime:
      source?.snapshotTime ?? null,

    blockers:
      Array.isArray(source?.blockers)
        ? source.blockers
        : [],

    warnings:
      Array.isArray(source?.warnings)
        ? source.warnings
        : [],

    reasonCodes:
      Array.isArray(source?.reasonCodes)
        ? source.reasonCodes
        : [],
  };
}

function normalizeEngine27Readiness(
  engine27MinuteReadiness
) {
  const source =
    engine27MinuteReadiness &&
    typeof engine27MinuteReadiness === "object"
      ? engine27MinuteReadiness
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
    decisionState === "READY";

  return {
    decisionState:
      decisionState || null,

    ready,

    candidateId:
      source?.candidateId ?? null,

    zoneId:
      source?.zoneId ?? null,

    strategyId:
      source?.strategyId ?? null,

    symbol:
      source?.symbol ?? null,

    direction:
      source?.direction ?? null,

    setupType:
      source?.setupType ?? null,

    snapshotTime:
      source?.snapshotTime ?? null,

    blockers:
      Array.isArray(source?.blockers)
        ? source.blockers
        : [],

    warnings:
      Array.isArray(source?.warnings)
        ? source.warnings
        : [],

    reasonCodes:
      Array.isArray(source?.reasonCodes)
        ? source.reasonCodes
        : [],
  };
}

function normalizeTradeState(tradeState) {
  const source =
    tradeState &&
    typeof tradeState === "object"
      ? tradeState
      : {};

  const candidateAlreadySized =
    source?.candidateAlreadySized === true;

  const candidateAlreadyOrdered =
    source?.candidateAlreadyOrdered === true;

  const openTradeForStrategy =
    source?.openTradeForStrategy === true;

  const idempotencyKeyAlreadyUsed =
    source?.idempotencyKeyAlreadyUsed === true;

  const duplicateBlocked =
    source?.duplicateBlocked === true ||
    candidateAlreadySized ||
    candidateAlreadyOrdered ||
    openTradeForStrategy ||
    idempotencyKeyAlreadyUsed;

  return {
    duplicateBlocked,

    candidateAlreadySized,
    candidateAlreadyOrdered,
    openTradeForStrategy,
    idempotencyKeyAlreadyUsed,

    openTradeId:
      source?.openTradeId ?? null,

    blockers:
      Array.isArray(source?.blockers)
        ? source.blockers
        : [],

    reasonCodes:
      Array.isArray(source?.reasonCodes)
        ? source.reasonCodes
        : [],
  };
}

function validateRiskConfig(riskConfig) {
  if (
    !riskConfig ||
    typeof riskConfig !== "object"
  ) {
    return {
      valid: false,
      status: "RISK_CONFIG_MISSING",
      config: null,
      reasonCodes: [
        "ENGINE7B_RISK_CONFIG_MISSING",
      ],
    };
  }

  const instrument =
    safeUpper(
      riskConfig.instrument || ES_SYMBOL
    );

  const riskBudgetDollars =
    toNumber(
      riskConfig.riskBudgetDollars
    );

  const dollarsPerPoint =
    toNumber(
      riskConfig.dollarsPerPoint
    ) ?? ES_DOLLARS_PER_POINT;

  const minimumContracts =
    toNumber(
      riskConfig.minimumContracts
    );

  const maximumContracts =
    toNumber(
      riskConfig.maximumContracts
    );

  const roundingRule =
    safeUpper(
      riskConfig.roundingRule || "FLOOR"
    );

  const estimatedSlippagePointsPerSide =
    toNumber(
      riskConfig
        .estimatedSlippagePointsPerSide
    );

  const commissionDollarsPerContractRoundTrip =
    toNumber(
      riskConfig
        .commissionDollarsPerContractRoundTrip
    );

  const invalidReasons = [];

  if (instrument !== ES_SYMBOL) {
    invalidReasons.push(
      "ENGINE7B_ES_ONLY"
    );
  }

  if (
    riskBudgetDollars == null ||
    riskBudgetDollars <= 0
  ) {
    invalidReasons.push(
      "INVALID_RISK_BUDGET_DOLLARS"
    );
  }

  if (
    dollarsPerPoint == null ||
    dollarsPerPoint <= 0
  ) {
    invalidReasons.push(
      "INVALID_DOLLARS_PER_POINT"
    );
  }

  if (
    minimumContracts == null ||
    !Number.isInteger(minimumContracts) ||
    minimumContracts < 1
  ) {
    invalidReasons.push(
      "INVALID_MINIMUM_CONTRACTS"
    );
  }

  if (
    maximumContracts == null ||
    !Number.isInteger(maximumContracts) ||
    maximumContracts < 1
  ) {
    invalidReasons.push(
      "INVALID_MAXIMUM_CONTRACTS"
    );
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
    commissionDollarsPerContractRoundTrip ==
      null ||
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

  if (
    riskConfig.paperOnly === false
  ) {
    invalidReasons.push(
      "RISK_CONFIG_NOT_PAPER_ONLY"
    );
  }

  if (invalidReasons.length > 0) {
    return {
      valid: false,
      status: "RISK_CONFIG_INVALID",

      config: {
        instrument,
        riskBudgetDollars,
        dollarsPerPoint,
        minimumContracts,
        maximumContracts,
        roundingRule,
        estimatedSlippagePointsPerSide,
        commissionDollarsPerContractRoundTrip,
        paperOnly:
          riskConfig.paperOnly !== false,
      },

      reasonCodes: unique([
        "ENGINE7B_RISK_CONFIG_INVALID",
        ...invalidReasons,
      ]),
    };
  }

  return {
    valid: true,
    status: "RISK_CONFIG_VALID",

    config: {
      instrument,
      riskBudgetDollars,
      dollarsPerPoint,
      minimumContracts,
      maximumContracts,
      roundingRule,
      estimatedSlippagePointsPerSide,
      commissionDollarsPerContractRoundTrip,
      paperOnly: true,
    },

    reasonCodes: [
      "ENGINE7B_RISK_CONFIG_VALID",
    ],
  };
}

function compareIdentityField({
  field,
  officialValue,
  comparisonValue,
}) {
  if (
    comparisonValue === null ||
    comparisonValue === undefined ||
    comparisonValue === ""
  ) {
    return {
      field,
      checked: false,
      match: true,
      officialValue:
        officialValue ?? null,
      comparisonValue: null,
    };
  }

  const official =
    safeUpper(officialValue);

  const comparison =
    safeUpper(comparisonValue);

  return {
    field,
    checked: true,
    match:
      Boolean(official) &&
      official === comparison,

    officialValue:
      officialValue ?? null,

    comparisonValue:
      comparisonValue ?? null,
  };
}

function validateIdentity({
  officialPlan,
  engine6,
  engine27,
}) {
  const requiredOfficialFields = [
    "planId",
    "candidateId",
    "zoneId",
    "strategyId",
    "symbol",
    "direction",
    "setupType",
    "snapshotTime",
  ];

  const missingOfficialFields =
    requiredOfficialFields.filter(
      (field) =>
        !safeString(officialPlan?.[field])
    );

  const comparisons = [
    compareIdentityField({
      field: "candidateId",
      officialValue:
        officialPlan?.candidateId,
      comparisonValue:
        engine6?.candidateId,
    }),

    compareIdentityField({
      field: "zoneId",
      officialValue:
        officialPlan?.zoneId,
      comparisonValue:
        engine6?.zoneId,
    }),

    compareIdentityField({
      field: "strategyId",
      officialValue:
        officialPlan?.strategyId,
      comparisonValue:
        engine6?.strategyId,
    }),

    compareIdentityField({
      field: "symbol",
      officialValue:
        officialPlan?.symbol,
      comparisonValue:
        engine6?.symbol,
    }),

    compareIdentityField({
      field: "direction",
      officialValue:
        officialPlan?.direction,
      comparisonValue:
        engine6?.direction,
    }),

    compareIdentityField({
      field: "setupType",
      officialValue:
        officialPlan?.setupType,
      comparisonValue:
        engine6?.setupType,
    }),

    compareIdentityField({
      field: "candidateId",
      officialValue:
        officialPlan?.candidateId,
      comparisonValue:
        engine27?.candidateId,
    }),

    compareIdentityField({
      field: "zoneId",
      officialValue:
        officialPlan?.zoneId,
      comparisonValue:
        engine27?.zoneId,
    }),

    compareIdentityField({
      field: "strategyId",
      officialValue:
        officialPlan?.strategyId,
      comparisonValue:
        engine27?.strategyId,
    }),

    compareIdentityField({
      field: "symbol",
      officialValue:
        officialPlan?.symbol,
      comparisonValue:
        engine27?.symbol,
    }),

    compareIdentityField({
      field: "direction",
      officialValue:
        officialPlan?.direction,
      comparisonValue:
        engine27?.direction,
    }),

    compareIdentityField({
      field: "setupType",
      officialValue:
        officialPlan?.setupType,
      comparisonValue:
        engine27?.setupType,
    }),
  ];

  const mismatches =
    comparisons.filter(
      (item) =>
        item.checked === true &&
        item.match !== true
    );

  const valid =
    missingOfficialFields.length === 0 &&
    mismatches.length === 0;

  return {
    valid,
    missingOfficialFields,
    comparisons,
    mismatches,

    reasonCodes: valid
      ? [
          "ENGINE7B_IDENTITY_VALIDATED",
        ]
      : unique([
          "ENGINE7B_IDENTITY_MISMATCH",

          ...missingOfficialFields.map(
            (field) =>
              `ENGINE9_${safeUpper(
                field
              )}_MISSING`
          ),

          ...mismatches.map(
            (item) =>
              `IDENTITY_MISMATCH_${safeUpper(
                item.field
              )}`
          ),
        ]),
  };
}

function normalizeOfficialTargets(
  officialTargets
) {
  if (!Array.isArray(officialTargets)) {
    return [];
  }

  return officialTargets
    .map((target) => {
      const price =
        toNumber(target?.price);

      if (price == null) return null;

      return {
        ...target,
        price,
      };
    })
    .filter(Boolean);
}

function makeBaseOutput({
  officialPlan,
  engine6,
  engine27,
  tradeState,
  snapshotTime,
}) {
  return {
    active: false,

    engine: ENGINE,
    contractVersion:
      CONTRACT_VERSION,

    mode:
      "FINAL_POSITION_SIZING",

    planId:
      officialPlan?.planId ?? null,

    candidateId:
      officialPlan?.candidateId ?? null,

    zoneId:
      officialPlan?.zoneId ?? null,

    strategyId:
      officialPlan?.strategyId ?? null,

    symbol:
      officialPlan?.symbol ?? null,

    direction:
      officialPlan?.direction ?? null,

    setupType:
      officialPlan?.setupType ?? null,

    snapshotTime:
      officialPlan?.snapshotTime ??
      snapshotTime ??
      new Date().toISOString(),

    tradeId: null,
    idempotencyKey: null,
    orderId: null,

    officialEntryPrice:
      toNumber(
        officialPlan?.officialEntryPrice
      ),

    officialStopPrice:
      toNumber(
        officialPlan?.officialStopPrice
      ),

    officialStopDistancePoints:
      toNumber(
        officialPlan
          ?.officialStopDistancePoints
      ),

    providedStopDistancePoints:
      toNumber(
        officialPlan
          ?.officialStopDistancePoints
      ),

    calculatedStopDistancePoints:
      null,

    stopDistanceDifferencePoints:
      null,

    officialTargets:
      normalizeOfficialTargets(
        officialPlan?.officialTargets
      ),

    targetCount:
      Array.isArray(
        officialPlan?.officialTargets
      )
        ? officialPlan.officialTargets.length
        : 0,

    engine9PlanStatus:
      officialPlan?.planStatus ?? null,

    engine9ManagementReady:
      officialPlan?.managementReady === true,

    engine9Official:
      officialPlan?.official === true,

    engine6Decision:
      engine6?.decision ?? null,

    engine6Allowed:
      engine6?.allowed === true,

    engine6SizeMultiplier:
      engine6?.sizeMultiplier ?? null,

    engine27DecisionState:
      engine27?.decisionState ?? null,

    engine27Ready:
      engine27?.ready === true,

    duplicateBlocked:
      tradeState?.duplicateBlocked === true,

    riskBudgetDollars: null,
    permissionAdjustedRiskBudget:
      null,

    dollarsPerPoint:
      ES_DOLLARS_PER_POINT,

    minimumContracts: null,
    maximumContracts: null,

    rawRiskPerContract: null,

    estimatedSlippageRiskPerContract:
      null,

    commissionDollarsPerContractRoundTrip:
      null,

    effectiveRiskPerContract:
      null,

    calculatedContracts: 0,
    finalContracts: 0,

    estimatedTotalRiskDollars: 0,

    allowed: false,
    executableSizing: false,

    requiresEngine6Permission: true,
    requiresEngine27Ready: true,
    requiresEngine9OfficialPlan: true,
    requiresEngine9ManagementReady: true,
    requiresDuplicateClearance: true,

    noPermissionCreated: true,
    noManagementPlanCreated: true,
    noTradeIdCreated: true,
    noIdempotencyKeyCreated: true,
    noOrderIdCreated: true,
    noOrderIdentityCreated: true,
    noOrderCreated: true,
    noBrokerOrder: true,
    noExecution: true,
    noFillCreated: true,
    noJournalWrite: true,

    status:
      "FINAL_SIZING_UNAVAILABLE",

    blockers: [],
    warnings: [],
    reasonCodes: [],
  };
}

function blockedResult({
  output,
  status,
  blockers = [],
  warnings = [],
  reasonCodes = [],
  extra = {},
}) {
  return {
    ...output,
    ...extra,

    active: true,

    calculatedContracts: 0,
    finalContracts: 0,
    estimatedTotalRiskDollars: 0,

    allowed: false,
    executableSizing: false,

    status,

    blockers: unique(blockers),
    warnings: unique(warnings),

    reasonCodes: unique([
      ...reasonCodes,
      "ENGINE7B_FINAL_CONTRACTS_ZERO",
      "NO_ORDER_CREATED",
      "NO_EXECUTION",
    ]),
  };
}

/**
 * Build Engine 7B final ES paper position sizing.
 *
 * @param {object} input
 * @param {object|null} input.engine6PaperPermission
 * @param {object|null} input.engine27MinuteReadiness
 * @param {object|null} input.engine9OfficialManagementPlan
 * @param {object|null} input.riskConfig
 * @param {object|null} input.tradeState
 * @param {string|null} input.snapshotTime
 */
function buildLegacyEngine7FinalPositionSizing({
  engine6PaperPermission = null,
  engine27MinuteReadiness = null,
  engine9OfficialManagementPlan = null,
  riskConfig = null,
  tradeState = null,
  snapshotTime = null,
} = {}) {
  const officialPlan =
    engine9OfficialManagementPlan &&
    typeof engine9OfficialManagementPlan ===
      "object"
      ? engine9OfficialManagementPlan
      : null;

  const engine6 =
    normalizeEngine6Permission(
      engine6PaperPermission
    );

  const engine27 =
    normalizeEngine27Readiness(
      engine27MinuteReadiness
    );

  const normalizedTradeState =
    normalizeTradeState(tradeState);

  const output = makeBaseOutput({
    officialPlan,
    engine6,
    engine27,
    tradeState: normalizedTradeState,
    snapshotTime,
  });

  if (!officialPlan) {
    return blockedResult({
      output,

      status:
        "WAITING_FOR_ENGINE9_OFFICIAL_PLAN",

      blockers: [
        "ENGINE9_OFFICIAL_PLAN_MISSING",
      ],

      reasonCodes: [
        "ENGINE7B_ENGINE9_PLAN_REQUIRED",
      ],
    });
  }

  const planStatus =
    safeUpper(
      officialPlan.planStatus
    );

  if (planStatus !== "OFFICIAL") {
    return blockedResult({
      output,

      status:
        planStatus === "IDENTITY_MISMATCH"
          ? "ENGINE9_PLAN_IDENTITY_MISMATCH"
          : "WAITING_FOR_ENGINE9_OFFICIAL_PLAN",

      blockers: unique([
        "ENGINE9_PLAN_NOT_OFFICIAL",

        planStatus === "IDENTITY_MISMATCH"
          ? "ENGINE9_IDENTITY_MISMATCH"
          : null,

        ...(Array.isArray(
          officialPlan.blockers
        )
          ? officialPlan.blockers
          : []),
      ]),

      warnings:
        Array.isArray(
          officialPlan.warnings
        )
          ? officialPlan.warnings
          : [],

      reasonCodes: unique([
        "ENGINE7B_ENGINE9_PLAN_NOT_OFFICIAL",

        planStatus
          ? `ENGINE9_PLAN_STATUS_${planStatus}`
          : "ENGINE9_PLAN_STATUS_MISSING",

        ...(Array.isArray(
          officialPlan.reasonCodes
        )
          ? officialPlan.reasonCodes
          : []),
      ]),
    });
  }

  if (
    officialPlan.managementReady !== true
  ) {
    return blockedResult({
      output,

      status:
        "WAITING_FOR_ENGINE9_MANAGEMENT_READY",

      blockers: [
        "ENGINE9_MANAGEMENT_NOT_READY",
      ],

      warnings:
        Array.isArray(
          officialPlan.warnings
        )
          ? officialPlan.warnings
          : [],

      reasonCodes: unique([
        "ENGINE7B_ENGINE9_MANAGEMENT_REQUIRED",

        ...(Array.isArray(
          officialPlan.reasonCodes
        )
          ? officialPlan.reasonCodes
          : []),
      ]),
    });
  }

  const identityValidation =
    validateIdentity({
      officialPlan,
      engine6,
      engine27,
    });

  if (!identityValidation.valid) {
    return blockedResult({
      output,

      status:
        "FINAL_SIZING_IDENTITY_MISMATCH",

      blockers: [
        "PIPELINE_IDENTITY_MISMATCH",
      ],

      reasonCodes:
        identityValidation.reasonCodes,

      extra: {
        identityValidation,
      },
    });
  }

  const symbol =
    safeUpper(officialPlan.symbol);

  const direction =
    safeUpper(officialPlan.direction);

  const entryPrice =
    toNumber(
      officialPlan.officialEntryPrice
    );

  const stopPrice =
    toNumber(
      officialPlan.officialStopPrice
    );

  const providedStopDistance =
    toNumber(
      officialPlan
        .officialStopDistancePoints
    );

  const directionValid =
    direction === "LONG" ||
    direction === "SHORT";

  const stopDirectionValid =
    direction === "LONG"
      ? entryPrice != null &&
        stopPrice != null &&
        stopPrice < entryPrice
      : direction === "SHORT"
      ? entryPrice != null &&
        stopPrice != null &&
        stopPrice > entryPrice
      : false;

  if (
    symbol !== ES_SYMBOL ||
    !directionValid ||
    !isPositiveNumber(entryPrice) ||
    !isPositiveNumber(stopPrice) ||
    !isPositiveNumber(
      providedStopDistance
    ) ||
    !stopDirectionValid
  ) {
    return blockedResult({
      output,

      status:
        "OFFICIAL_GEOMETRY_INVALID",

      blockers: unique([
        "ENGINE9_OFFICIAL_GEOMETRY_INVALID",

        symbol !== ES_SYMBOL
          ? "ENGINE7B_ES_ONLY"
          : null,

        !directionValid
          ? "OFFICIAL_DIRECTION_INVALID"
          : null,

        !isPositiveNumber(entryPrice)
          ? "OFFICIAL_ENTRY_PRICE_INVALID"
          : null,

        !isPositiveNumber(stopPrice)
          ? "OFFICIAL_STOP_PRICE_INVALID"
          : null,

        !isPositiveNumber(
          providedStopDistance
        )
          ? "OFFICIAL_STOP_DISTANCE_INVALID"
          : null,

        !stopDirectionValid
          ? "OFFICIAL_STOP_DIRECTION_INVALID"
          : null,
      ]),

      reasonCodes: [
        "ENGINE7B_OFFICIAL_GEOMETRY_REJECTED",
      ],

      extra: {
        identityValidation,
      },
    });
  }

  const calculatedStopDistance =
    round2(
      Math.abs(
        entryPrice - stopPrice
      )
    );

  const stopDistanceDifference =
    round2(
      Math.abs(
        calculatedStopDistance -
          providedStopDistance
      )
    );

  const geometryOutput = {
    ...output,

    calculatedStopDistancePoints:
      calculatedStopDistance,

    stopDistanceDifferencePoints:
      stopDistanceDifference,

    identityValidation,
  };

  if (
    stopDistanceDifference == null ||
    stopDistanceDifference >
      ES_TICK_SIZE
  ) {
    return blockedResult({
      output: geometryOutput,

      status:
        "OFFICIAL_STOP_DISTANCE_MISMATCH",

      blockers: [
        "ENGINE9_OFFICIAL_STOP_DISTANCE_MISMATCH",
      ],

      reasonCodes: [
        "ENGINE7B_OFFICIAL_STOP_DISTANCE_REJECTED",
        "PROVIDED_DISTANCE_DOES_NOT_MATCH_ENTRY_STOP",
      ],
    });
  }

  const riskValidation =
    validateRiskConfig(riskConfig);

  if (!riskValidation.valid) {
    return blockedResult({
      output: geometryOutput,

      status:
        riskValidation.status,

      blockers:
        riskValidation.reasonCodes,

      reasonCodes:
        riskValidation.reasonCodes,
    });
  }

  if (
    normalizedTradeState.duplicateBlocked
  ) {
    return blockedResult({
      output: geometryOutput,

      status:
        "DUPLICATE_OR_OPEN_TRADE_BLOCKED",

      blockers: unique([
        "ENGINE7B_DUPLICATE_OR_OPEN_TRADE_BLOCK",

        normalizedTradeState
          .candidateAlreadySized
          ? "CANDIDATE_ALREADY_SIZED"
          : null,

        normalizedTradeState
          .candidateAlreadyOrdered
          ? "CANDIDATE_ALREADY_ORDERED"
          : null,

        normalizedTradeState
          .openTradeForStrategy
          ? "OPEN_TRADE_FOR_STRATEGY"
          : null,

        normalizedTradeState
          .idempotencyKeyAlreadyUsed
          ? "IDEMPOTENCY_KEY_ALREADY_USED"
          : null,

        ...normalizedTradeState.blockers,
      ]),

      reasonCodes: unique([
        ...normalizedTradeState
          .reasonCodes,

        "ENGINE7B_DUPLICATE_CLEARANCE_REQUIRED",
      ]),
    });
  }

  if (engine6.allowed !== true) {
    return blockedResult({
      output: geometryOutput,

      status:
        "WAITING_FOR_ENGINE6_PERMISSION",

      blockers: unique([
        "ENGINE6_PAPER_PERMISSION_REQUIRED",
        ...engine6.blockers,
      ]),

      warnings:
        engine6.warnings,

      reasonCodes: unique([
        ...engine6.reasonCodes,
        "ENGINE7B_ENGINE6_ALLOW_REQUIRED",
      ]),
    });
  }

  if (engine27.ready !== true) {
    return blockedResult({
      output: geometryOutput,

      status:
        "WAITING_FOR_ENGINE27_READY",

      blockers: unique([
        "ENGINE27_MINUTE_READY_REQUIRED",
        ...engine27.blockers,
      ]),

      warnings:
        engine27.warnings,

      reasonCodes: unique([
        ...engine27.reasonCodes,
        "ENGINE7B_ENGINE27_READY_REQUIRED",
      ]),
    });
  }

  const config =
    riskValidation.config;

  const sizeMultiplier =
    toNumber(
      engine6.sizeMultiplier
    );

  const safeSizeMultiplier =
    sizeMultiplier != null
      ? Math.max(
          0,
          Math.min(
            1,
            sizeMultiplier
          )
        )
      : 1;

  const permissionAdjustedRiskBudget =
    round2(
      config.riskBudgetDollars *
        safeSizeMultiplier
    );

  const rawRiskPerContract =
    round2(
      calculatedStopDistance *
        config.dollarsPerPoint
    );

  const estimatedSlippageRiskPerContract =
    round2(
      config
        .estimatedSlippagePointsPerSide *
        2 *
        config.dollarsPerPoint
    );

  const effectiveRiskPerContract =
    round2(
      rawRiskPerContract +
        estimatedSlippageRiskPerContract +
        config
          .commissionDollarsPerContractRoundTrip
    );

  const calculatedContracts =
    effectiveRiskPerContract > 0
      ? Math.floor(
          permissionAdjustedRiskBudget /
            effectiveRiskPerContract
        )
      : 0;

  const finalContracts = Math.min(
    calculatedContracts,
    config.maximumContracts
  );

  const estimatedTotalRiskDollars =
    round2(
      finalContracts *
        effectiveRiskPerContract
    );

  const sizingOutput = {
    ...geometryOutput,

    active: true,

    riskBudgetDollars:
      config.riskBudgetDollars,

    permissionAdjustedRiskBudget,

    dollarsPerPoint:
      config.dollarsPerPoint,

    minimumContracts:
      config.minimumContracts,

    maximumContracts:
      config.maximumContracts,

    rawRiskPerContract,

    estimatedSlippageRiskPerContract,

    commissionDollarsPerContractRoundTrip:
      config
        .commissionDollarsPerContractRoundTrip,

    effectiveRiskPerContract,

    calculatedContracts,
    finalContracts,

    estimatedTotalRiskDollars,
  };

  if (
    finalContracts <
    config.minimumContracts
  ) {
    return blockedResult({
      output: sizingOutput,

      status:
        "RISK_BUDGET_TOO_SMALL",

      blockers: [
        "RISK_BUDGET_BELOW_ONE_CONTRACT",
      ],

      reasonCodes: unique([
        ...riskValidation.reasonCodes,

        "ENGINE7B_OFFICIAL_GEOMETRY_CONSUMED",
        "ENGINE7B_OFFICIAL_STOP_DISTANCE_VALIDATED",
        "ENGINE7B_FINAL_SIZE_CALCULATED",
        "RISK_BUDGET_TOO_SMALL",
      ]),
    });
  }

  return {
    ...sizingOutput,

    allowed: true,
    executableSizing: true,

    status:
      "FINAL_SIZE_READY",

    blockers: [],

    warnings: unique([
      ...engine6.warnings,
      ...engine27.warnings,
      ...(Array.isArray(
        officialPlan.warnings
      )
        ? officialPlan.warnings
        : []),
    ]),

    reasonCodes: unique([
      ...riskValidation.reasonCodes,
      ...engine6.reasonCodes,
      ...engine27.reasonCodes,

      "ENGINE9_OFFICIAL_PLAN_CONSUMED",
      "ENGINE9_MANAGEMENT_READY",
      "ENGINE7B_IDENTITY_VALIDATED",
      "ENGINE7B_OFFICIAL_GEOMETRY_CONSUMED",
      "ENGINE7B_OFFICIAL_STOP_DIRECTION_VALIDATED",
      "ENGINE7B_OFFICIAL_STOP_DISTANCE_VALIDATED",
      "ENGINE6_PAPER_PERMISSION_CONFIRMED",
      "ENGINE27_MINUTE_READY_CONFIRMED",
      "ENGINE7B_DUPLICATE_CLEARANCE_CONFIRMED",
      "ENGINE7B_FINAL_SIZE_CALCULATED",
      "ENGINE7B_FINAL_SIZE_READY",
      "ENGINE8_ORDER_REQUIRED",
      "NO_ORDER_IDENTITY_CREATED",
      "NO_ORDER_CREATED",
      "NO_EXECUTION",
    ]),
  };
}



const STRATEGY1 = Object.freeze({
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  symbol: "ES",
  setupClass: "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION",
  setupGrade: "A+++",
});

const STRATEGY1_IDENTITY_FIELDS = Object.freeze([
  "laneId",
  "strategyId",
  "candidateId",
  "zoneId",
  "symbol",
  "setupClass",
  "setupGrade",
  "identitySetupKey",
  "candidateIdentityVersion",
  "direction",
]);

const ZERO_ALLOCATION = Object.freeze({
  block1Contracts: 0,
  block2Contracts: 0,
  block3Contracts: 0,
  totalContracts: 0,
});

function claimsStrategy1(source) {
  return Boolean(
    source &&
      typeof source === "object" &&
      (safeString(source.strategyId) === STRATEGY1.strategyId ||
        safeString(source.setupClass) === STRATEGY1.setupClass)
  );
}

function identityValue(source, field) {
  if (!source || typeof source !== "object") return null;
  const value = source[field];
  return value === null || value === undefined || safeString(value) === ""
    ? null
    : value;
}

function exactIdentityEqual(left, right) {
  return safeString(left) !== "" && safeString(left) === safeString(right);
}

function copyStrictIdentity(source) {
  return Object.fromEntries(
    STRATEGY1_IDENTITY_FIELDS.map((field) => [field, identityValue(source, field)])
  );
}

function validateStrictIdentity({ engine7A, engine9, engine6, engine27 }) {
  const missing = [];
  const conflicts = [];
  const expected = {
    laneId: STRATEGY1.laneId,
    strategyId: STRATEGY1.strategyId,
    symbol: STRATEGY1.symbol,
    setupClass: STRATEGY1.setupClass,
    setupGrade: STRATEGY1.setupGrade,
  };

  for (const [carrierName, carrier] of [["ENGINE7A", engine7A], ["ENGINE9", engine9]]) {
    for (const field of STRATEGY1_IDENTITY_FIELDS) {
      const value = identityValue(carrier, field);
      if (value == null) {
        missing.push(`${carrierName}_${safeUpper(field)}_MISSING`);
      }
    }
    for (const [field, expectedValue] of Object.entries(expected)) {
      const value = identityValue(carrier, field);
      if (value != null && safeString(value) !== expectedValue) {
        conflicts.push(`${carrierName}_${safeUpper(field)}_INVALID`);
      }
    }
  }

  for (const field of STRATEGY1_IDENTITY_FIELDS) {
    const a = identityValue(engine7A, field);
    const b = identityValue(engine9, field);
    if (a != null && b != null && !exactIdentityEqual(a, b)) {
      conflicts.push(`ENGINE7A_ENGINE9_${safeUpper(field)}_MISMATCH`);
    }
  }

  for (const [carrierName, carrier] of [["ENGINE6", engine6], ["ENGINE27E", engine27]]) {
    if (!carrier || typeof carrier !== "object") continue;
    for (const field of STRATEGY1_IDENTITY_FIELDS) {
      const optionalValue = identityValue(carrier, field);
      if (optionalValue == null) continue;
      const canonicalValue = identityValue(engine9, field) ?? identityValue(engine7A, field);
      if (canonicalValue != null && !exactIdentityEqual(optionalValue, canonicalValue)) {
        conflicts.push(`${carrierName}_${safeUpper(field)}_MISMATCH`);
      }
    }
  }

  return {
    valid: missing.length === 0 && conflicts.length === 0,
    missing: unique(missing),
    conflicts: unique(conflicts),
    engine7AIdentity: copyStrictIdentity(engine7A),
    engine9Identity: copyStrictIdentity(engine9),
  };
}

function readEngine7AAllocation(engine7A) {
  const allocation =
    engine7A?.threeContractAllocation ||
    engine7A?.preliminaryAllocation ||
    engine7A?.contractAllocation ||
    null;

  return {
    block1Contracts: toNumber(
      allocation?.block1Contracts ?? allocation?.BLOCK_1 ?? allocation?.block1
    ),
    block2Contracts: toNumber(
      allocation?.block2Contracts ?? allocation?.BLOCK_2 ?? allocation?.block2
    ),
    block3Contracts: toNumber(
      allocation?.block3Contracts ?? allocation?.BLOCK_3 ?? allocation?.block3
    ),
    totalContracts: toNumber(allocation?.totalContracts),
  };
}

function isExactTestingAllocation(allocation) {
  return (
    allocation.block1Contracts === 1 &&
    allocation.block2Contracts === 1 &&
    allocation.block3Contracts === 1 &&
    allocation.totalContracts === 3
  );
}

function targetById(officialTargets, targetId) {
  if (!Array.isArray(officialTargets)) return null;
  return officialTargets.find((target) => safeUpper(target?.targetId) === targetId) || null;
}

function blockCollection(engine9) {
  if (Array.isArray(engine9?.openingManagementPlan?.blocks)) {
    return engine9.openingManagementPlan.blocks;
  }
  if (Array.isArray(engine9?.threeBlockManagement?.blocks)) {
    return engine9.threeBlockManagement.blocks;
  }
  return [];
}

function analyzeManagement(engine9) {
  const targets = Array.isArray(engine9?.officialTargets) ? engine9.officialTargets : [];
  const t1 = targetById(targets, "T1");
  const t2 = targetById(targets, "T2");
  const t3 = targetById(targets, "T3");
  const blocks = blockCollection(engine9);
  const byId = new Map();
  const duplicates = [];

  for (const block of blocks) {
    const id = safeUpper(block?.blockId);
    if (!id) continue;
    if (byId.has(id)) duplicates.push(id);
    else byId.set(id, block);
  }

  const expectedIds = new Set(["BLOCK_1", "BLOCK_2", "BLOCK_3"]);
  const extras = blocks.filter((block) => !expectedIds.has(safeUpper(block?.blockId)));

  const validateBlock = ({ id, target, targetId, purpose, runner = false }) => {
    const block = byId.get(id) || null;
    const blockPrice = toNumber(block?.targetPrice);
    const officialPrice = toNumber(target?.price ?? target?.targetPrice);
    const runnerPrice = toNumber(engine9?.runnerTargetPrice ?? engine9?.runnerPlan?.runnerTargetPrice);
    const valid = Boolean(
      block &&
        toNumber(block.contracts) === 1 &&
        safeUpper(block.targetId) === targetId &&
        safeUpper(block.purpose) === purpose &&
        officialPrice != null &&
        blockPrice === officialPrice &&
        (!runner ||
          (runnerPrice != null &&
            blockPrice === runnerPrice &&
            safeUpper(engine9?.runnerTargetStatus ?? engine9?.runnerPlan?.runnerTargetStatus) ===
              "RUNNER_TARGET_SELECTED" &&
            engine9?.runnerPlan?.enabled === true &&
            safeUpper(engine9?.runnerPlan?.blockId) === "BLOCK_3" &&
            toNumber(engine9?.runnerPlan?.contracts) === 1 &&
            toNumber(engine9?.runnerPlan?.runnerTargetPrice) === runnerPrice &&
            safeUpper(engine9?.runnerPlan?.status) === "RUNNER_TARGET_SELECTED" &&
            toNumber(t2?.price ?? t2?.targetPrice) != null &&
            runnerPrice > toNumber(t2?.price ?? t2?.targetPrice)))
    );
    return { valid, block, target, blockPrice, officialPrice };
  };

  const block1 = validateBlock({
    id: "BLOCK_1",
    target: t1,
    targetId: "T1",
    purpose: "TARGET_1_ZONE_TOUCH",
  });
  const block2 = validateBlock({
    id: "BLOCK_2",
    target: t2,
    targetId: "T2",
    purpose: "TARGET_2_ZONE_MIDLINE",
  });
  const block3 = validateBlock({
    id: "BLOCK_3",
    target: t3,
    targetId: "T3",
    purpose: "ENGINE9_RUNNER",
    runner: true,
  });

  let usableManagementBlocks = 0;
  if (block1.valid) usableManagementBlocks = 1;
  if (usableManagementBlocks === 1 && block2.valid) usableManagementBlocks = 2;
  if (usableManagementBlocks === 2 && block3.valid) usableManagementBlocks = 3;

  return {
    t1,
    t2,
    t3,
    blocks,
    block1,
    block2,
    block3,
    duplicateBlockIds: unique(duplicates),
    extraBlockCount: extras.length,
    exactThreeBlockManagementValid:
      blocks.length === 3 &&
      duplicates.length === 0 &&
      extras.length === 0 &&
      block1.valid &&
      block2.valid &&
      block3.valid,
    usableManagementBlocks,
  };
}

function strictBaseFromLegacy({ legacy, engine7A, engine9, identityValidation, management }) {
  const engine7AAllocation = readEngine7AAllocation(engine7A);
  return {
    ...legacy,
    ...copyStrictIdentity(engine9),
    setupType: engine9?.setupType ?? legacy?.setupType ?? null,
    officialEntryPrice: toNumber(engine9?.officialEntryPrice),
    officialStopPrice: toNumber(engine9?.officialStopPrice),
    officialStopDistancePoints: toNumber(engine9?.officialStopDistancePoints),
    providedStopDistancePoints: toNumber(engine9?.officialStopDistancePoints),
    officialTargets: normalizeOfficialTargets(engine9?.officialTargets),
    targetCount: Array.isArray(engine9?.officialTargets) ? engine9.officialTargets.length : 0,
    engine9PlanStatus: engine9?.planStatus ?? null,
    engine9ManagementReady: engine9?.managementReady === true,
    engine9Official: engine9?.official === true,
    identityValidation,
    managementValidation: management,

    productionRiskBudgetDollars: toNumber(engine7A?.productionRiskBudgetDollars),
    productionRiskSupportedContracts: toNumber(engine7A?.productionRiskSupportedContracts),
    productionEstimatedRiskDollars: toNumber(engine7A?.productionEstimatedRiskDollars),
    productionThreeContractPlanQualified:
      engine7A?.productionThreeContractPlanQualified === true,
    productionRiskLimited: engine7A?.productionRiskLimited === true,
    finalProductionContracts: 0,

    engine7ATestingDataCollectionMode: engine7A?.testingDataCollectionMode === true,
    engine7ATestingRiskOverrideApplied: engine7A?.testingRiskOverrideApplied === true,
    engine7APaperTestingContracts: toNumber(engine7A?.paperTestingContracts) ?? 0,
    engine7ATestingThreeContractPlanQualified:
      engine7A?.testingThreeContractPlanQualified === true,
    engine7AThreeContractAllocation: { ...engine7AAllocation },

    engine9TestingAllocationAccepted: engine9?.testingAllocationAccepted === true,
    engine9AllocationQualificationSource:
      engine9?.allocationQualificationSource ?? null,

    finalTestingThreeContractPlanQualified: false,
    finalThreeContractAllocation: { ...ZERO_ALLOCATION },
    finalPaperTestingContracts: 0,

    finalSizingMode: "UNAVAILABLE",
    finalSizingReady: false,
    paperOrderSizingReady: false,

    finalContracts: 0,
    allowed: false,
    executableSizing: false,
  };
}

function strictBlocked(base, { status, blocker, blockers = [], reasonCode, reasonCodes = [], warnings = [] }) {
  return {
    ...base,
    active: true,
    finalProductionContracts: 0,
    finalTestingThreeContractPlanQualified: false,
    finalThreeContractAllocation: { ...ZERO_ALLOCATION },
    finalPaperTestingContracts: 0,
    finalContracts: 0,
    finalSizingMode: "UNAVAILABLE",
    finalSizingReady: false,
    paperOrderSizingReady: false,
    allowed: false,
    executableSizing: false,
    status,
    blockers: unique([blocker, ...blockers]),
    warnings: unique(warnings),
    reasonCodes: unique([
      ...(base.reasonCodes || []),
      reasonCode,
      ...reasonCodes,
      "ENGINE7B_FINAL_CONTRACTS_ZERO",
      "NO_ORDER_CREATED",
      "NO_EXECUTION",
    ]),
  };
}

function buildStrictStrategy1FinalSizing({
  engine7SizingPreview,
  engine6PaperPermission,
  engine27MinuteReadiness,
  engine9OfficialManagementPlan,
  riskConfig,
  tradeState,
  snapshotTime,
}) {
  const engine7A = engine7SizingPreview && typeof engine7SizingPreview === "object"
    ? engine7SizingPreview
    : {};
  const engine9 = engine9OfficialManagementPlan && typeof engine9OfficialManagementPlan === "object"
    ? engine9OfficialManagementPlan
    : {};
  const engine6 = engine6PaperPermission && typeof engine6PaperPermission === "object"
    ? engine6PaperPermission
    : {};
  const engine27 = engine27MinuteReadiness && typeof engine27MinuteReadiness === "object"
    ? engine27MinuteReadiness
    : {};

  const identityValidation = validateStrictIdentity({ engine7A, engine9, engine6, engine27 });
  const management = analyzeManagement(engine9);

  // Preserve the exact legacy risk calculation, but synthesize only the aggregate
  // readiness marker that legacy code requires. Strict readiness is checked below.
  const legacy = buildLegacyEngine7FinalPositionSizing({
    engine6PaperPermission,
    engine27MinuteReadiness: {
      ...engine27,
      ready: true,
      decisionState: "READY",
    },
    engine9OfficialManagementPlan,
    riskConfig,
    tradeState,
    snapshotTime,
  });

  const base = strictBaseFromLegacy({
    legacy,
    engine7A,
    engine9,
    identityValidation,
    management,
  });

  if (!identityValidation.valid) {
    return strictBlocked(base, {
      status: identityValidation.missing.length
        ? "STRATEGY1_IDENTITY_MISSING"
        : "STRATEGY1_IDENTITY_CONFLICT",
      blocker: identityValidation.missing.length
        ? "MANDATORY_CANONICAL_IDENTITY_REQUIRED"
        : "CANONICAL_IDENTITY_CONFLICT",
      blockers: [...identityValidation.missing, ...identityValidation.conflicts],
      reasonCode: identityValidation.missing.length
        ? "ENGINE7B_STRATEGY1_IDENTITY_INCOMPLETE"
        : "ENGINE7B_STRATEGY1_IDENTITY_MISMATCH",
    });
  }

  if (!engine9OfficialManagementPlan || typeof engine9OfficialManagementPlan !== "object") {
    return strictBlocked(base, {
      status: "WAITING_FOR_ENGINE9_OFFICIAL_PLAN",
      blocker: "ENGINE9_OFFICIAL_PLAN_MISSING",
      reasonCode: "ENGINE7B_ENGINE9_PLAN_REQUIRED",
    });
  }

  if (safeUpper(engine9.planStatus) !== "OFFICIAL") {
    return strictBlocked(base, {
      status: "WAITING_FOR_ENGINE9_OFFICIAL_PLAN",
      blocker: "ENGINE9_PLAN_NOT_OFFICIAL",
      reasonCode: "ENGINE7B_ENGINE9_PLAN_NOT_OFFICIAL",
    });
  }

  if (engine9.managementReady !== true) {
    return strictBlocked(base, {
      status: "WAITING_FOR_ENGINE9_MANAGEMENT_READY",
      blocker: "ENGINE9_MANAGEMENT_NOT_READY",
      reasonCode: "ENGINE7B_ENGINE9_MANAGEMENT_REQUIRED",
    });
  }

  const decision = safeUpper(engine6.decision);
  if (decision !== "FAST_INTRADAY_PAPER_ALLOW") {
    return strictBlocked(base, {
      status: "WAITING_FOR_ENGINE6_PERMISSION",
      blocker: "ENGINE6_FAST_INTRADAY_DECISION_REQUIRED",
      reasonCode: "ENGINE7B_ENGINE6_DECISION_MISMATCH",
    });
  }
  if (engine6.allowed !== true) {
    return strictBlocked(base, {
      status: "WAITING_FOR_ENGINE6_PERMISSION",
      blocker: "ENGINE6_ALLOWED_TRUE_REQUIRED",
      reasonCode: "ENGINE7B_ENGINE6_ALLOW_REQUIRED",
    });
  }
  if (engine6.planningAllowed !== true) {
    return strictBlocked(base, {
      status: "WAITING_FOR_ENGINE6_PERMISSION",
      blocker: "ENGINE6_PLANNING_ALLOWED_REQUIRED",
      reasonCode: "ENGINE7B_ENGINE6_PLANNING_REQUIRED",
    });
  }

  const readiness = engine27.readiness || {};
  if (readiness.invalidated === true) {
    return strictBlocked(base, {
      status: "STRATEGY1_CANDIDATE_INVALIDATED",
      blocker: "ENGINE27E_INVALIDATED_TRUE",
      reasonCode: "ENGINE7B_ENGINE27E_INVALIDATED",
    });
  }
  for (const [field, status, blocker, reasonCode] of [
    ["reactionReady", "WAITING_FOR_ENGINE27_REACTION_READY", "ENGINE27E_REACTION_READY_REQUIRED", "ENGINE7B_REACTION_NOT_READY"],
    ["participationReady", "WAITING_FOR_ENGINE27_PARTICIPATION_READY", "ENGINE27E_PARTICIPATION_READY_REQUIRED", "ENGINE7B_PARTICIPATION_NOT_READY"],
    ["permissionReady", "WAITING_FOR_ENGINE27_PERMISSION_READY", "ENGINE27E_PERMISSION_READY_REQUIRED", "ENGINE7B_PERMISSION_NOT_READY"],
    ["plannerReady", "WAITING_FOR_ENGINE27_PLANNER_READY", "ENGINE27E_PLANNER_READY_REQUIRED", "ENGINE7B_PLANNER_NOT_READY"],
  ]) {
    if (readiness[field] !== true) {
      return strictBlocked(base, { status, blocker, reasonCode });
    }
  }

  const entry = toNumber(engine9.officialEntryPrice);
  const stop = toNumber(engine9.officialStopPrice);
  const stopDistance = toNumber(engine9.officialStopDistancePoints);
  const direction = safeUpper(engine9.direction);
  const geometryValid =
    entry != null && entry > 0 &&
    stop != null && stop > 0 &&
    stopDistance != null && stopDistance > 0 &&
    ((direction === "LONG" && stop < entry) || (direction === "SHORT" && stop > entry));
  if (!geometryValid || !management.t1 || toNumber(management.t1?.price ?? management.t1?.targetPrice) == null) {
    return strictBlocked(base, {
      status: "OFFICIAL_GEOMETRY_INVALID",
      blocker: "ENGINE9_OFFICIAL_GEOMETRY_INVALID",
      reasonCode: "ENGINE7B_OFFICIAL_GEOMETRY_REJECTED",
    });
  }

  const normalizedTradeState = normalizeTradeState(tradeState);
  if (normalizedTradeState.duplicateBlocked) {
    return strictBlocked(base, {
      status: "DUPLICATE_OR_OPEN_TRADE_BLOCKED",
      blocker: "ENGINE7B_DUPLICATE_OR_OPEN_TRADE_BLOCK",
      blockers: normalizedTradeState.blockers,
      reasonCode: "ENGINE7B_DUPLICATE_CLEARANCE_REQUIRED",
    });
  }

  const productionSupported = toNumber(engine7A.productionRiskSupportedContracts);
  const legacyCalculated = toNumber(legacy.calculatedContracts);
  const productionQuantityAvailable = Number.isInteger(productionSupported) && productionSupported >= 0;
  const productionCrossCheckPassed =
    productionQuantityAvailable &&
    Number.isInteger(legacyCalculated) &&
    productionSupported === legacyCalculated;
  const finalProductionContracts = productionCrossCheckPassed
    ? Math.max(0, Math.min(productionSupported, management.usableManagementBlocks))
    : 0;

  const allocation = readEngine7AAllocation(engine7A);
  const engine7ATestingEvidenceValid =
    engine7A.testingDataCollectionMode === true &&
    engine7A.testingRiskOverrideApplied === true &&
    toNumber(engine7A.paperTestingContracts) === 3 &&
    engine7A.testingThreeContractPlanQualified === true &&
    isExactTestingAllocation(allocation);
  const engine9TestingAccepted =
    engine9.testingAllocationAccepted === true &&
    engine9.allocationQualificationSource === "ENGINE7A_TESTING_DATA_COLLECTION";
  const finalTestingQualified =
    engine7ATestingEvidenceValid &&
    engine9TestingAccepted &&
    management.exactThreeBlockManagementValid;

  const warnings = [];
  const reasonCodes = [];
  if (!productionCrossCheckPassed) {
    warnings.push("PRODUCTION_FALLBACK_BLOCKED_BY_QUANTITY_CONFLICT");
    reasonCodes.push("ENGINE7B_LEGACY_PRODUCTION_CROSS_CHECK_FAILED");
  }
  if (!engine7ATestingEvidenceValid) {
    warnings.push("TESTING_PATH_NOT_QUALIFIED");
    reasonCodes.push("ENGINE7B_TESTING_EVIDENCE_INCOMPLETE");
  }
  if (engine7ATestingEvidenceValid && engine9.testingAllocationAccepted !== true) {
    warnings.push("TESTING_ACCEPTANCE_REQUIRED");
    reasonCodes.push("ENGINE7B_ENGINE9_TESTING_NOT_ACCEPTED");
  }
  if (
    engine7ATestingEvidenceValid &&
    engine9.testingAllocationAccepted === true &&
    engine9.allocationQualificationSource !== "ENGINE7A_TESTING_DATA_COLLECTION"
  ) {
    warnings.push("ENGINE9_TESTING_SOURCE_REJECTED");
    reasonCodes.push("ENGINE7B_ALLOCATION_QUALIFICATION_SOURCE_MISMATCH");
  }
  if (engine7ATestingEvidenceValid && engine9TestingAccepted && !management.exactThreeBlockManagementValid) {
    warnings.push("MANAGEMENT_CAPACITY_REDUCED");
    reasonCodes.push("ENGINE7B_MANAGEMENT_BLOCK_MISMATCH");
  }

  if (finalTestingQualified) {
    return {
      ...base,
      finalProductionContracts,
      finalTestingThreeContractPlanQualified: true,
      finalThreeContractAllocation: { ...allocation },
      finalPaperTestingContracts: 3,
      finalContracts: 3,
      finalSizingMode: "PAPER_TESTING_DATA_COLLECTION",
      finalSizingReady: true,
      paperOrderSizingReady: true,
      allowed: true,
      executableSizing: true,
      status: "FINAL_SIZE_READY",
      blockers: [],
      warnings: unique(warnings),
      reasonCodes: unique([
        ...(base.reasonCodes || []),
        ...reasonCodes,
        "ENGINE7B_FINAL_TESTING_SIZE_READY",
        "ENGINE8_ORDER_REQUIRED",
        "NO_ORDER_CREATED",
        "NO_EXECUTION",
      ]),
    };
  }

  if (finalProductionContracts > 0) {
    return {
      ...base,
      finalProductionContracts,
      finalTestingThreeContractPlanQualified: false,
      finalThreeContractAllocation: { ...ZERO_ALLOCATION },
      finalPaperTestingContracts: 0,
      finalContracts: finalProductionContracts,
      finalSizingMode: "PRODUCTION_RISK",
      finalSizingReady: true,
      paperOrderSizingReady: true,
      allowed: true,
      executableSizing: true,
      status: "FINAL_SIZE_READY",
      blockers: [],
      warnings: unique(warnings),
      reasonCodes: unique([
        ...(base.reasonCodes || []),
        ...reasonCodes,
        "ENGINE7B_FINAL_PRODUCTION_SIZE_READY",
        management.usableManagementBlocks < productionSupported
          ? "ENGINE7B_PRODUCTION_CAPPED_BY_MANAGEMENT_CAPACITY"
          : null,
        "ENGINE8_ORDER_REQUIRED",
        "NO_ORDER_CREATED",
        "NO_EXECUTION",
      ]),
    };
  }

  return strictBlocked(base, {
    status: productionQuantityAvailable
      ? "PRODUCTION_QUANTITY_UNAVAILABLE"
      : "PRODUCTION_QUANTITY_UNAVAILABLE",
    blocker: productionCrossCheckPassed
      ? "ENGINE7A_PRODUCTION_QUANTITY_REQUIRED"
      : "PRODUCTION_SUPPORTED_CONTRACTS_MISMATCH",
    reasonCode: productionCrossCheckPassed
      ? "ENGINE7B_PRODUCTION_SIZING_UNAVAILABLE"
      : "ENGINE7B_LEGACY_PRODUCTION_CROSS_CHECK_FAILED",
    warnings,
    reasonCodes,
  });
}

export function buildEngine7FinalPositionSizing({
  engine7SizingPreview = null,
  engine6PaperPermission = null,
  engine27MinuteReadiness = null,
  engine9OfficialManagementPlan = null,
  riskConfig = null,
  tradeState = null,
  snapshotTime = null,
} = {}) {
  const strictClaim =
    claimsStrategy1(engine7SizingPreview) ||
    claimsStrategy1(engine9OfficialManagementPlan);

  if (!strictClaim) {
    return buildLegacyEngine7FinalPositionSizing({
      engine6PaperPermission,
      engine27MinuteReadiness,
      engine9OfficialManagementPlan,
      riskConfig,
      tradeState,
      snapshotTime,
    });
  }

  return buildStrictStrategy1FinalSizing({
    engine7SizingPreview,
    engine6PaperPermission,
    engine27MinuteReadiness,
    engine9OfficialManagementPlan,
    riskConfig,
    tradeState,
    snapshotTime,
  });
}

export default buildEngine7FinalPositionSizing;
