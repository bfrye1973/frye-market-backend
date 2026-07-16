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
export function buildEngine7FinalPositionSizing({
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

export default buildEngine7FinalPositionSizing;
