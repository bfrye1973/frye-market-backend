// services/core/logic/trading/engine8CanonicalPaperAdapter.js
// Engine 8 — canonical paper-order eligibility adapter.
//
// READ-ONLY.
//
// This adapter:
// - reads Engine 6 paper permission
// - reads Engine 9 official management plan
// - reads Engine 7B final position sizing
// - validates readiness, identity, geometry, safety, and duplicates
// - publishes WAITING / BLOCKED / READY state
//
// This adapter never:
// - creates executionId
// - creates idempotencyKey
// - creates orderId
// - creates tradeId
// - creates an order
// - creates a fill
// - writes execution ledgers
// - writes the journal
// - calls Schwab

const ENGINE = "engine8.canonicalPaperOrderAdapter.v1";
const CONTRACT_VERSION = "engine8.paperOrderEligibility.v1";

const ENGINE6_ALLOW_DECISIONS = new Set([
  "FAST_INTRADAY_PAPER_ALLOW",
  "PAPER_ALLOW",
]);

const ENGINE6_WAIT_DECISIONS = new Set([
  "PAPER_SHORT_RESEARCH_WATCH",
  "STRUCTURAL_FAST_WATCH",
  "PAPER_WATCH_FAST",
]);

const ENGINE9_BLOCKED_STATUSES = new Set([
  "IDENTITY_MISMATCH",
  "DIRECTION_CONFLICT",
  "INVALID_ENTRY_GEOMETRY",
  "INVALID_STOP_GEOMETRY",
  "MANAGEMENT_BLOCKED",
]);

const FULL_IDENTITY_FIELDS = [
  "planId",
  "candidateId",
  "zoneId",
  "strategyId",
  "symbol",
  "direction",
  "setupType",
  "snapshotTime",
];

const ENGINE6_SHARED_IDENTITY_FIELDS = [
  "candidateId",
  "zoneId",
  "strategyId",
  "symbol",
  "direction",
  "setupType",
];

const GEOMETRY_FIELDS = [
  "officialEntryPrice",
  "officialStopPrice",
  "officialStopDistancePoints",
];

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeUpper(value) {
  return normalizeText(value).toUpperCase();
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number != null && number > 0 ? number : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sameScalar(left, right) {
  if (typeof left === "number" || typeof right === "number") {
    const a = finiteNumber(left);
    const b = finiteNumber(right);

    return a != null && b != null && a === b;
  }

  return normalizeText(left) === normalizeText(right);
}

function compareFields({
  left,
  right,
  fields,
  leftName,
  rightName,
  skipWhenEitherMissing = false,
}) {
  const mismatches = [];

  for (const field of fields) {
    const leftValue = left?.[field];
    const rightValue = right?.[field];

    const leftMissing =
      leftValue === null ||
      leftValue === undefined ||
      normalizeText(leftValue) === "";

    const rightMissing =
      rightValue === null ||
      rightValue === undefined ||
      normalizeText(rightValue) === "";

    if (skipWhenEitherMissing && (leftMissing || rightMissing)) {
      continue;
    }

    if (leftMissing || rightMissing || !sameScalar(leftValue, rightValue)) {
      mismatches.push({
        field,
        leftSource: leftName,
        rightSource: rightName,
        leftValue: leftValue ?? null,
        rightValue: rightValue ?? null,
      });
    }
  }

  return mismatches;
}

function copyIdentity(engine9) {
  return {
    planId: engine9?.planId ?? null,
    candidateId: engine9?.candidateId ?? null,
    zoneId: engine9?.zoneId ?? null,
    strategyId: engine9?.strategyId ?? null,
    symbol: engine9?.symbol ?? null,
    direction: engine9?.direction ?? null,
    setupType: engine9?.setupType ?? null,
    snapshotTime: engine9?.snapshotTime ?? null,
  };
}

function copyTargets(engine9) {
  return Array.isArray(engine9?.officialTargets)
    ? engine9.officialTargets.map((target) => ({
        targetId: target?.targetId ?? null,
        sequence: target?.sequence ?? null,
        sourceTargetId: target?.sourceTargetId ?? null,
        price: finiteNumber(target?.price),
        distancePoints: finiteNumber(target?.distancePoints),
        rMultiple: finiteNumber(target?.rMultiple),
        allocationPct: finiteNumber(target?.allocationPct),
        role: target?.role ?? null,
        status: target?.status ?? null,
      }))
    : [];
}

function buildBaseOutput({
  engine6,
  engine9,
  engine7,
  paperExecutionEnabled,
  duplicateState,
}) {
  const identity = copyIdentity(engine9);

  return {
    active: true,
    engine: ENGINE,
    contractVersion: CONTRACT_VERSION,
    mode: "PAPER_ONLY_READ_ONLY_ADAPTER",

    status: "BLOCKED",
    executable: false,
    orderCreated: false,
    duplicateBlocked: false,

    ...identity,

    executionId: null,
    idempotencyKey: null,
    orderId: null,
    tradeId: null,

    officialEntryPrice:
      finiteNumber(engine9?.officialEntryPrice),

    officialStopPrice:
      finiteNumber(engine9?.officialStopPrice),

    officialStopDistancePoints:
      finiteNumber(engine9?.officialStopDistancePoints),

    officialTargets:
      copyTargets(engine9),

    threeBlockManagement:
      engine9?.threeBlockManagement ?? null,

    runnerPlan:
      engine9?.runnerPlan ?? null,

    finalContracts:
      Number.isInteger(Number(engine7?.finalContracts))
        ? Number(engine7.finalContracts)
        : 0,

    paperOnly: true,
    paperExecutionEnabled:
      paperExecutionEnabled === true,

    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,

    engine6: {
      decision: engine6?.decision ?? null,
      allowed: engine6?.allowed === true,
    },

    engine9: {
      planStatus: engine9?.planStatus ?? null,
      managementReady:
        engine9?.managementReady === true,
      official:
        engine9?.official === true,
    },

    engine7B: {
      status: engine7?.status ?? null,
      allowed: engine7?.allowed === true,
      executableSizing:
        engine7?.executableSizing === true,
      finalContracts:
        Number.isInteger(Number(engine7?.finalContracts))
          ? Number(engine7.finalContracts)
          : 0,
    },

    duplicateState: {
      candidateAlreadyOrdered:
        duplicateState?.candidateAlreadyOrdered === true,

      idempotencyKeyAlreadyUsed:
        duplicateState?.idempotencyKeyAlreadyUsed === true,

      openTradeForStrategy:
        duplicateState?.openTradeForStrategy === true,

      activeTradeIdExists:
        duplicateState?.activeTradeIdExists === true,

      orderExistsForPlanId:
        duplicateState?.orderExistsForPlanId === true,

      acceptanceTradeCompleted:
        duplicateState?.acceptanceTradeCompleted === true,

      newPaperOrdersAllowed:
        duplicateState?.newPaperOrdersAllowed !== false,
    },

    identityMatched: false,
    geometryMatched: false,

    identityMismatches: [],
    geometryMismatches: [],

    blockers: [],
    warnings: [],
    reasonCodes: [],

    noOrderCreated: true,
    noExecutionIdCreated: true,
    noIdempotencyKeyCreated: true,
    noOrderIdCreated: true,
    noTradeIdCreated: true,
    noFillCreated: true,
    noJournalWrite: true,
    noBrokerOrder: true,
    noSchwabCall: true,

    evaluatedAt: nowIso(),
  };
}

function finish(output, {
  status,
  blocker = null,
  blockers = [],
  warnings = [],
  reasonCodes = [],
  executable = false,
  duplicateBlocked = false,
}) {
  return {
    ...output,

    status,
    executable,
    orderCreated: false,
    duplicateBlocked,

    blockers: unique([
      ...output.blockers,
      blocker,
      ...blockers,
    ]),

    warnings: unique([
      ...output.warnings,
      ...warnings,
    ]),

    reasonCodes: unique([
      ...output.reasonCodes,
      ...reasonCodes,
      status,
    ]),
  };
}

function hasLiveSafetyViolation(engine6) {
  return (
    engine6?.realExecutionAllowed === true ||
    engine6?.brokerExecutionAllowed === true ||
    engine6?.schwabExecutionAllowed === true
  );
}

function validateEngine9Geometry(engine9) {
  const entry = positiveNumber(
    engine9?.officialEntryPrice
  );

  const stop = positiveNumber(
    engine9?.officialStopPrice
  );

  const distance = positiveNumber(
    engine9?.officialStopDistancePoints
  );

  const direction = normalizeUpper(
    engine9?.direction
  );

  const errors = [];

  if (entry == null) {
    errors.push("ENGINE9_OFFICIAL_ENTRY_INVALID");
  }

  if (stop == null) {
    errors.push("ENGINE9_OFFICIAL_STOP_INVALID");
  }

  if (distance == null) {
    errors.push(
      "ENGINE9_OFFICIAL_STOP_DISTANCE_INVALID"
    );
  }

  if (
    entry != null &&
    stop != null &&
    direction === "LONG" &&
    stop >= entry
  ) {
    errors.push(
      "ENGINE9_LONG_STOP_NOT_BELOW_ENTRY"
    );
  }

  if (
    entry != null &&
    stop != null &&
    direction === "SHORT" &&
    stop <= entry
  ) {
    errors.push(
      "ENGINE9_SHORT_STOP_NOT_ABOVE_ENTRY"
    );
  }

  const targets = Array.isArray(
    engine9?.officialTargets
  )
    ? engine9.officialTargets
    : [];

  if (targets.length < 1) {
    errors.push(
      "ENGINE9_OFFICIAL_TARGETS_MISSING"
    );
  }

  for (const target of targets) {
    const price = positiveNumber(target?.price);

    if (price == null) {
      errors.push(
        `ENGINE9_TARGET_PRICE_INVALID_${
          target?.targetId || "UNKNOWN"
        }`
      );
      continue;
    }

    if (
      entry != null &&
      direction === "LONG" &&
      price <= entry
    ) {
      errors.push(
        `ENGINE9_LONG_TARGET_NOT_ABOVE_ENTRY_${
          target?.targetId || "UNKNOWN"
        }`
      );
    }

    if (
      entry != null &&
      direction === "SHORT" &&
      price >= entry
    ) {
      errors.push(
        `ENGINE9_SHORT_TARGET_NOT_BELOW_ENTRY_${
          target?.targetId || "UNKNOWN"
        }`
      );
    }
  }

  return unique(errors);
}

function duplicateBlockers(duplicateState) {
  const blockers = [];

  if (
    duplicateState?.candidateAlreadyOrdered === true
  ) {
    blockers.push("CANDIDATE_ALREADY_ORDERED");
  }

  if (
    duplicateState?.idempotencyKeyAlreadyUsed === true
  ) {
    blockers.push("IDEMPOTENCY_KEY_ALREADY_USED");
  }

  if (
    duplicateState?.openTradeForStrategy === true
  ) {
    blockers.push(
      "OPEN_TRADE_ALREADY_EXISTS_FOR_STRATEGY"
    );
  }

  if (
    duplicateState?.activeTradeIdExists === true
  ) {
    blockers.push("ACTIVE_TRADE_ID_ALREADY_EXISTS");
  }

  if (
    duplicateState?.orderExistsForPlanId === true
  ) {
    blockers.push("ORDER_ALREADY_EXISTS_FOR_PLAN_ID");
  }

  if (
    duplicateState?.acceptanceTradeCompleted === true
  ) {
    blockers.push("ACCEPTANCE_TRADE_ALREADY_COMPLETED");
  }

  if (
    duplicateState?.newPaperOrdersAllowed === false
  ) {
    blockers.push("NEW_PAPER_ORDERS_DISABLED");
  }

  return blockers;
}

/**
 * Build the canonical read-only Engine 8 paper-order eligibility state.
 */
export function buildEngine8CanonicalPaperAdapter({
  engine6PaperPermission = null,
  engine9OfficialManagementPlan = null,
  engine7PositionSizing = null,

  duplicateState = {},

  paperExecutionEnabled =
    process.env.ENGINE8_PAPER_ONLY === "1",

  liveTradingEnabled =
    process.env.ENGINE8_LIVE_TRADING_ENABLED === "1",

  allowLiveFutures =
    process.env.ENGINE8_ALLOW_LIVE_FUTURES === "1",
} = {}) {
  const engine6 = engine6PaperPermission;
  const engine9 = engine9OfficialManagementPlan;
  const engine7 = engine7PositionSizing;

  let output = buildBaseOutput({
    engine6,
    engine9,
    engine7,
    paperExecutionEnabled,
    duplicateState,
  });

  /*
   * Safety gate.
   *
   * This canonical paper lane must never become ready while any
   * live-execution flag is enabled.
   */
  if (
    liveTradingEnabled === true ||
    allowLiveFutures === true ||
    hasLiveSafetyViolation(engine6)
  ) {
    return finish(output, {
      status: "PAPER_ORDER_REJECTED",
      blocker: "LIVE_EXECUTION_SAFETY_VIOLATION",
      reasonCodes: [
        liveTradingEnabled
          ? "ENGINE8_LIVE_TRADING_ENABLED"
          : null,

        allowLiveFutures
          ? "ENGINE8_LIVE_FUTURES_ENABLED"
          : null,

        engine6?.realExecutionAllowed === true
          ? "ENGINE6_REAL_EXECUTION_ALLOWED"
          : null,

        engine6?.brokerExecutionAllowed === true
          ? "ENGINE6_BROKER_EXECUTION_ALLOWED"
          : null,

        engine6?.schwabExecutionAllowed === true
          ? "ENGINE6_SCHWAB_EXECUTION_ALLOWED"
          : null,

        "NO_ORDER_CREATED",
      ],
    });
  }

  /*
   * Engine 6 permission gate.
   */
  const engine6Decision = normalizeUpper(
    engine6?.decision
  );

  const engine6Direction = normalizeUpper(
    engine6?.direction
  );

  if (engine6Decision === "PAPER_STAND_DOWN") {
    return finish(output, {
      status: "PAPER_ORDER_REJECTED",
      blocker: "ENGINE6_PAPER_STAND_DOWN",
      reasonCodes: [
        "ENGINE6_REJECTED_PAPER_ENTRY",
        "NO_ORDER_CREATED",
      ],
    });
  }

  if (
    !engine6Direction ||
    ["NONE", "NEUTRAL", "UNKNOWN"].includes(
      engine6Direction
    )
  ) {
    return finish(output, {
      status: "PAPER_ORDER_REJECTED",
      blocker: "ENGINE6_DIRECTION_INVALID",
      reasonCodes: [
        "ENGINE6_DIRECTION_REQUIRED",
        "NO_ORDER_CREATED",
      ],
    });
  }

  if (
    ENGINE6_WAIT_DECISIONS.has(engine6Decision) ||
    engine6?.allowed !== true
  ) {
    return finish(output, {
      status: "WAITING_FOR_ENGINE6_PERMISSION",
      blocker: "ENGINE6_PAPER_NOT_ALLOWED",
      reasonCodes: [
        engine6Decision
          ? `ENGINE6_${engine6Decision}`
          : "ENGINE6_DECISION_MISSING",

        "NO_ORDER_CREATED",
      ],
    });
  }

  if (
    !ENGINE6_ALLOW_DECISIONS.has(engine6Decision)
  ) {
    return finish(output, {
      status: "PAPER_ORDER_REJECTED",
      blocker:
        "ENGINE6_DECISION_NOT_EXECUTABLE",
      reasonCodes: [
        engine6Decision
          ? `ENGINE6_${engine6Decision}`
          : "ENGINE6_DECISION_MISSING",

        "NO_ORDER_CREATED",
      ],
    });
  }

  /*
   * Engine 9 official-plan gate.
   */
  const engine9Status = normalizeUpper(
    engine9?.planStatus
  );

  if (
    ENGINE9_BLOCKED_STATUSES.has(engine9Status)
  ) {
    const status =
      engine9Status === "IDENTITY_MISMATCH" ||
      engine9Status === "DIRECTION_CONFLICT"
        ? "IDENTITY_MISMATCH"
        : "PAPER_ORDER_REJECTED";

    return finish(output, {
      status,
      blocker: `ENGINE9_${engine9Status}`,
      reasonCodes: [
        "ENGINE9_PLAN_BLOCKED",
        "NO_ORDER_CREATED",
      ],
    });
  }

  if (
    engine9Status !== "OFFICIAL_PLAN_READY" ||
    engine9?.managementReady !== true ||
    engine9?.official !== true
  ) {
    return finish(output, {
      status:
        "WAITING_FOR_ENGINE9_OFFICIAL_PLAN",

      blocker:
        "ENGINE9_OFFICIAL_PLAN_NOT_READY",

      reasonCodes: [
        engine9Status
          ? `ENGINE9_PLAN_STATUS_${engine9Status}`
          : "ENGINE9_PLAN_STATUS_MISSING",

        engine9?.managementReady !== true
          ? "ENGINE9_MANAGEMENT_NOT_READY"
          : null,

        engine9?.official !== true
          ? "ENGINE9_OFFICIAL_FALSE"
          : null,

        "NO_ORDER_CREATED",
      ],
    });
  }

  /*
   * Engine 7B final-size gate.
   */
  const finalContracts = Number(
    engine7?.finalContracts
  );

  const engine7Ready =
    normalizeUpper(engine7?.status) ===
      "FINAL_SIZE_READY" &&
    engine7?.allowed === true &&
    engine7?.executableSizing === true &&
    Number.isInteger(finalContracts) &&
    finalContracts > 0;

  if (!engine7Ready) {
    return finish(output, {
      status: "WAITING_FOR_ENGINE7_FINAL_SIZE",
      blocker: "ENGINE7B_FINAL_SIZE_NOT_READY",
      reasonCodes: [
        engine7?.status
          ? `ENGINE7B_STATUS_${normalizeUpper(
              engine7.status
            )}`
          : "ENGINE7B_STATUS_MISSING",

        engine7?.allowed !== true
          ? "ENGINE7B_ALLOWED_FALSE"
          : null,

        engine7?.executableSizing !== true
          ? "ENGINE7B_EXECUTABLE_SIZING_FALSE"
          : null,

        !Number.isInteger(finalContracts)
          ? "ENGINE7B_FINAL_CONTRACTS_NOT_INTEGER"
          : null,

        finalContracts <= 0
          ? "ENGINE7B_FINAL_CONTRACTS_ZERO"
          : null,

        "NO_ORDER_CREATED",
      ],
    });
  }

  /*
   * Engine 9 ↔ Engine 7B full identity.
   */
  const fullIdentityMismatches = compareFields({
    left: engine9,
    right: engine7,
    fields: FULL_IDENTITY_FIELDS,
    leftName: "ENGINE9",
    rightName: "ENGINE7B",
  });

  /*
   * Engine 6 only needs to match fields it actually publishes.
   * Missing Engine 6 fields are skipped rather than repaired.
   */
  const engine6IdentityMismatches = [
    ...compareFields({
      left: engine6,
      right: engine9,
      fields: ENGINE6_SHARED_IDENTITY_FIELDS,
      leftName: "ENGINE6",
      rightName: "ENGINE9",
      skipWhenEitherMissing: true,
    }),

    ...compareFields({
      left: engine6,
      right: engine7,
      fields: ENGINE6_SHARED_IDENTITY_FIELDS,
      leftName: "ENGINE6",
      rightName: "ENGINE7B",
      skipWhenEitherMissing: true,
    }),
  ];

  const identityMismatches = [
    ...fullIdentityMismatches,
    ...engine6IdentityMismatches,
  ];

  output = {
    ...output,
    identityMatched:
      identityMismatches.length === 0,
    identityMismatches,
  };

  if (identityMismatches.length > 0) {
    return finish(output, {
      status: "IDENTITY_MISMATCH",
      blocker: "UPSTREAM_IDENTITY_MISMATCH",
      reasonCodes: [
        ...identityMismatches.map(
          (mismatch) =>
            `IDENTITY_MISMATCH_${mismatch.field.toUpperCase()}`
        ),

        "ENGINE8_DID_NOT_REPAIR_IDENTITY",
        "NO_ORDER_CREATED",
      ],
    });
  }

  /*
   * Engine 9 ↔ Engine 7B official geometry.
   */
  const geometryMismatches = compareFields({
    left: engine9,
    right: engine7,
    fields: GEOMETRY_FIELDS,
    leftName: "ENGINE9",
    rightName: "ENGINE7B",
  });

  const geometryErrors =
    validateEngine9Geometry(engine9);

  output = {
    ...output,
    geometryMatched:
      geometryMismatches.length === 0 &&
      geometryErrors.length === 0,

    geometryMismatches,
  };

  if (
    geometryMismatches.length > 0 ||
    geometryErrors.length > 0
  ) {
    return finish(output, {
      status: "GEOMETRY_SIZE_MISMATCH",
      blockers: [
        ...geometryErrors,
        ...geometryMismatches.map(
          (mismatch) =>
            `GEOMETRY_MISMATCH_${mismatch.field.toUpperCase()}`
        ),
      ],
      reasonCodes: [
        "ENGINE9_ENGINE7B_GEOMETRY_NOT_EQUAL",
        "NO_ORDER_CREATED",
      ],
    });
  }

  /*
   * Duplicate and acceptance-lock gate.
   */
  const currentDuplicateBlockers =
    duplicateBlockers(duplicateState);

  if (currentDuplicateBlockers.length > 0) {
    return finish(output, {
      status: "DUPLICATE_ORDER_BLOCKED",
      blockers: currentDuplicateBlockers,
      duplicateBlocked: true,
      reasonCodes: [
        "ENGINE8_DUPLICATE_OR_ACCEPTANCE_LOCK",
        "NO_ORDER_CREATED",
      ],
    });
  }

  /*
   * Paper execution feature gate.
   */
  if (paperExecutionEnabled !== true) {
    return finish(output, {
      status: "PAPER_EXECUTION_DISABLED",
      blocker: "ENGINE8_PAPER_EXECUTION_DISABLED",
      reasonCodes: [
        "ENGINE8_PAPER_ONLY_ENV_NOT_ENABLED",
        "NO_ORDER_CREATED",
      ],
    });
  }

  /*
   * All read-only eligibility gates passed.
   *
   * No order is created here.
   */
  return finish(
    {
      ...output,
      identityMatched: true,
      geometryMatched: true,
    },
    {
      status: "READY_TO_CREATE_PAPER_ORDER",
      executable: true,
      reasonCodes: [
        "ENGINE6_PAPER_PERMISSION_READY",
        "ENGINE9_OFFICIAL_PLAN_READY",
        "ENGINE7B_FINAL_SIZE_READY",
        "UPSTREAM_IDENTITY_MATCHED",
        "OFFICIAL_GEOMETRY_MATCHED",
        "DUPLICATE_CHECK_CLEAR",
        "PAPER_ONLY_SAFETY_CONFIRMED",
        "CONTROLLED_ENGINE8_EXECUTOR_REQUIRED",
        "NO_ORDER_CREATED_BY_SNAPSHOT",
      ],
    }
  );
}

export default buildEngine8CanonicalPaperAdapter;
