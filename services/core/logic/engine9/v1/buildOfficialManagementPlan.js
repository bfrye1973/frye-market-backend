// services/core/logic/engine9/v1/buildOfficialManagementPlan.js
import crypto from "crypto";

const ENGINE = "engine9.officialManagementPlan.v1";
const CONTRACT_VERSION = "engine9.officialManagementPlan.v1";

const VALID_PERMISSION_DECISIONS = new Set([
  "PAPER_ALLOW",
  "FAST_INTRADAY_PAPER_ALLOW",
]);

const TARGET_ALLOCATIONS = [33, 33, 34];
const TARGET_ROLES = [
  "FIRST_SCALE",
  "SECOND_SCALE",
  "RUNNER_OBJECTIVE",
];

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
  return String(value ?? "").trim();
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
    ...new Set(
      values.filter(Boolean)
    ),
  ];
}

function sameValue(left, right) {
  const a = safeString(left);
  const b = safeString(right);

  if (!a || !b) return true;
  return a === b;
}

function exactIdentityMatch(left, right) {
  const a = safeString(left);
  const b = safeString(right);

  return Boolean(a && b && a === b);
}

function directionallyValidPrice({
  direction,
  entryPrice,
  price,
}) {
  if (
    entryPrice == null ||
    price == null
  ) {
    return false;
  }

  if (direction === "LONG") {
    return price > entryPrice;
  }

  if (direction === "SHORT") {
    return price < entryPrice;
  }

  return false;
}

function normalizeProposedTargets({
  rawTargets,
  direction,
  entryPrice,
}) {
  if (!Array.isArray(rawTargets)) {
    return [];
  }

  return rawTargets
    .map((target, index) => {
      const price =
        toNumber(target?.price) ??
        toNumber(target);

      if (
        !directionallyValidPrice({
          direction,
          entryPrice,
          price,
        })
      ) {
        return null;
      }

      return {
        sourceTargetId:
          safeString(target?.targetId) ||
          safeString(target?.label) ||
          `PROPOSED_${index + 1}`,

        price,

        sourceLabel:
          target?.label ?? null,

        sourcePurpose:
          target?.purpose ?? null,

        source:
          "ENGINE26_PROPOSED_TARGET",
      };
    })
    .filter(Boolean);
}

function normalizeFibTargets({
  minuteFib,
  minuteDecision,
  direction,
  entryPrice,
}) {
  if (
    minuteDecision?.pipelineIdentity?.complete !== true ||
    minuteDecision?.pipelineIdentity?.consistent !== true
  ) {
    return [];
  }

  if (
    minuteFib?.validation?.available !== true ||
    minuteFib?.validation?.matches !== true
  ) {
    return [];
  }

  const anchorDirection =
    safeUpper(
      minuteFib?.anchors?.direction
    );

  if (
    direction === "LONG" &&
    anchorDirection !== "BULLISH"
  ) {
    return [];
  }

  if (
    direction === "SHORT" &&
    anchorDirection !== "BEARISH"
  ) {
    return [];
  }

  if (
    safeUpper(minuteFib?.activeLadder) !==
    "EXTENSION"
  ) {
    return [];
  }

  const preferredLabels = [
    "e100",
    "e1168",
    "e1272",
  ];

  return preferredLabels
    .map((label) => {
      const level =
        minuteFib?.extensions?.[label] ||
        null;

      const price =
        toNumber(level?.price);

      if (
        !directionallyValidPrice({
          direction,
          entryPrice,
          price,
        })
      ) {
        return null;
      }

      return {
        sourceTargetId: label,
        price,
        sourceLabel: level?.label ?? label,
        sourcePurpose: level?.purpose ?? null,
        source:
          "ENGINE27B_MINUTE_EXTENSION",
      };
    })
    .filter(Boolean);
}

function buildOfficialTargets({
  sourceTargets,
  direction,
  entryPrice,
  stopDistancePoints,
}) {
  const ordered =
    [...sourceTargets]
      .sort((left, right) =>
        direction === "LONG"
          ? left.price - right.price
          : right.price - left.price
      )
      .slice(0, 3);

  return ordered.map(
    (target, index) => {
      const distancePoints =
        direction === "LONG"
          ? round2(
              target.price -
              entryPrice
            )
          : round2(
              entryPrice -
              target.price
            );

      const rMultiple =
        stopDistancePoints > 0
          ? round2(
              distancePoints /
              stopDistancePoints
            )
          : null;

      return {
        targetId: `T${index + 1}`,

        sequence: index + 1,

        sourceTargetId:
          target.sourceTargetId,

        price:
          round2(target.price),

        distancePoints,

        rMultiple,

        allocationPct:
          TARGET_ALLOCATIONS[index],

        role:
          TARGET_ROLES[index],

        source:
          target.source,

        sourcePurpose:
          target.sourcePurpose,

        sourceLabel:
          target.sourceLabel,

        status:
          "PLANNED",

        reasonCodes: [],
      };
    }
  );
}

function buildPlanId({
  candidateId,
  zoneId,
  strategyId,
  direction,
  entryPrice,
  stopPrice,
  targets,
}) {
  const source = JSON.stringify({
    candidateId,
    zoneId,
    strategyId,
    direction,
    entryPrice,
    stopPrice,

    targets:
      targets.map((target) => ({
        targetId: target.targetId,
        price: target.price,
        allocationPct:
          target.allocationPct,
      })),

    contractVersion:
      CONTRACT_VERSION,
  });

  const digest =
    crypto
      .createHash("sha256")
      .update(source)
      .digest("hex")
      .slice(0, 20);

  return `E9P-${digest}`;
}

function buildThreeBlockManagement(
  officialTargets
) {
  if (
    !Array.isArray(officialTargets) ||
    officialTargets.length !== 3
  ) {
    return {
      enabled: false,
      allocationMode:
        "PERCENT_ONLY",
      totalAllocationPct: 0,
      blocks: [],
      status:
        "WAITING_FOR_THREE_TARGETS",
    };
  }

  return {
    enabled: true,

    allocationMode:
      "PERCENT_ONLY",

    totalAllocationPct: 100,

    blocks: [
      {
        blockId: "BLOCK_1",
        allocationPct: 33,
        exitAtTargetId: "T1",
        afterExitAction:
          "MOVE_STOP_TO_BREAKEVEN",
        status: "PLANNED",
      },
      {
        blockId: "BLOCK_2",
        allocationPct: 33,
        exitAtTargetId: "T2",
        afterExitAction:
          "ARM_RUNNER_MANAGEMENT",
        status: "PLANNED",
      },
      {
        blockId: "BLOCK_3",
        allocationPct: 34,
        exitAtTargetId: "T3",
        afterExitAction:
          "CLOSE_REMAINDER",
        status: "PLANNED",
      },
    ],

    status:
      "THREE_BLOCK_PLAN_AVAILABLE",
  };
}

function buildRunnerPlan({
  entryPrice,
  officialTargets,
}) {
  const runnerTarget =
    officialTargets?.[2] ||
    null;

  if (!runnerTarget) {
    return {
      enabled: false,
      blockId: null,
      allocationPct: 0,
      activationCondition: null,
      initialProtection: null,
      trailing: {
        enabled: false,
        type: "NOT_CONFIGURED",
        value: null,
      },
      terminalConditions: [],
      status:
        "WAITING_FOR_RUNNER_TARGET",
    };
  }

  return {
    enabled: true,

    blockId: "BLOCK_3",

    allocationPct: 34,

    activationCondition: {
      type: "TARGET_FILLED",
      targetId: "T2",
    },

    initialProtection: {
      type:
        "BREAKEVEN_OR_BETTER",
      referencePrice:
        entryPrice,
    },

    trailing: {
      enabled: false,

      type:
        "NOT_CONFIGURED",

      value: null,

      note:
        "Trailing execution remains disabled until a canonical structure, ATR, or fixed-distance trailing contract is approved.",
    },

    terminalConditions: [
      "T3_FILLED",
      "TRAILING_STOP_FILLED",
      "MANUAL_CLOSE",
      "KILL_SWITCH_EXIT",
    ],

    status:
      "RUNNER_TARGET_PLANNED_TRAILING_NOT_CONFIGURED",
  };
}

function buildWaitingFor({
  permissionReady,
  reactionReady,
  participationReady,
  engine27Ready,
  plannerReady,
  sizingPreviewReady,
}) {
  return unique([
    !reactionReady
      ? "ENGINE3_REACTION_CONFIRMED"
      : null,

    !participationReady
      ? "ENGINE4_PARTICIPATION_CONFIRMED"
      : null,

    !permissionReady
      ? "ENGINE6_PAPER_PERMISSION"
      : null,

    !engine27Ready
      ? "ENGINE27_MINUTE_READY"
      : null,

    !plannerReady
      ? "ENGINE27_PLANNER_READY"
      : null,

    !sizingPreviewReady
      ? "ENGINE7A_SIZING_PREVIEW"
      : null,
  ]);
}

function buildLegacyEngine9OfficialManagementPlan({
  engine26ProposedGeometry = null,
  engine7SizingPreview = null,
  engine6PaperPermission = null,
  engine27MinuteDecision = null,
  engine27MinuteFib = null,
  snapshotTime = null,
} = {}) {
  const geometry =
    engine26ProposedGeometry &&
    typeof engine26ProposedGeometry ===
      "object"
      ? engine26ProposedGeometry
      : null;

  const candidateId =
    geometry?.candidateId ?? null;

  const zoneId =
    geometry?.zoneId ?? null;

  const strategyId =
    geometry?.strategyId ?? null;

  const symbol =
    geometry?.symbol ?? null;

  const direction =
    safeUpper(
      geometry?.direction
    );

  const setupType =
    geometry?.setupType ?? null;

  const identitySnapshotTime =
    geometry?.snapshotTime ??
    snapshotTime ??
    new Date().toISOString();

  const entryPrice =
    toNumber(
      geometry?.proposedEntryPrice
    );

  const stopPrice =
    toNumber(
      geometry?.proposedStopPrice
    );

  const providedStopDistance =
    toNumber(
      geometry
        ?.proposedStopDistancePoints
    );

  const calculatedStopDistance =
    entryPrice != null &&
    stopPrice != null
      ? round2(
          Math.abs(
            entryPrice -
            stopPrice
          )
        )
      : null;

  const identityComplete =
    Boolean(candidateId) &&
    Boolean(zoneId) &&
    Boolean(strategyId) &&
    Boolean(symbol) &&
    Boolean(direction) &&
    Boolean(setupType) &&
    Boolean(identitySnapshotTime) &&
    geometry
      ?.candidateIdentityPreserved ===
      true;

  const stopDirectionValid =
    direction === "LONG"
      ? (
          entryPrice != null &&
          stopPrice != null &&
          stopPrice < entryPrice
        )
      : direction === "SHORT"
      ? (
          entryPrice != null &&
          stopPrice != null &&
          stopPrice > entryPrice
        )
      : false;

  const stopDistanceValid =
    calculatedStopDistance != null &&
    providedStopDistance != null &&
    calculatedStopDistance > 0 &&
    Math.abs(
      calculatedStopDistance -
      providedStopDistance
    ) <= 0.25;

  const engine6Decision =
    safeUpper(
      engine6PaperPermission?.decision
    );

  const permissionReady =
    engine6PaperPermission?.allowed ===
      true &&
    VALID_PERMISSION_DECISIONS.has(
      engine6Decision
    );

  const engine27DecisionState =
    safeUpper(
      engine27MinuteDecision
        ?.decisionState
    );

  const reactionReady =
    engine27MinuteDecision
      ?.readiness
      ?.reactionReady === true;

  const participationReady =
    engine27MinuteDecision
      ?.readiness
      ?.participationReady === true;

  const engine27PermissionReady =
    engine27MinuteDecision
      ?.readiness
      ?.permissionReady === true;

  const plannerReady =
    engine27MinuteDecision
      ?.readiness
      ?.plannerReady === true;

  const engine27Ready =
    engine27DecisionState ===
      "READY" &&
    reactionReady &&
    participationReady &&
    engine27PermissionReady &&
    plannerReady &&
    engine27MinuteDecision
      ?.readiness
      ?.invalidated !== true;

  const engine27CoreIdentityMatched =
  exactIdentityMatch(
    candidateId,
    engine27MinuteDecision?.candidateId
  ) &&
  exactIdentityMatch(
    zoneId,
    engine27MinuteDecision?.zoneId
  ) &&
  exactIdentityMatch(
    strategyId,
    engine27MinuteDecision?.strategyId
  ) &&
  exactIdentityMatch(
    symbol,
    engine27MinuteDecision?.symbol
  ) &&
  exactIdentityMatch(
    setupType,
    engine27MinuteDecision?.setupType
  ) &&
  exactIdentityMatch(
    identitySnapshotTime,
    engine27MinuteDecision?.snapshotTime
  ) &&
  engine27MinuteDecision
    ?.pipelineIdentity
    ?.complete === true &&
  engine27MinuteDecision
    ?.pipelineIdentity
    ?.consistent === true;

const currentTraderDirection =
  safeUpper(
    engine27MinuteDecision?.direction
  );

const directionConflict =
  engine27CoreIdentityMatched === true &&
  ["LONG", "SHORT"].includes(direction) &&
  ["LONG", "SHORT"].includes(
    currentTraderDirection
  ) &&
  direction !== currentTraderDirection;

const engine27DirectionMatched =
  engine27CoreIdentityMatched === true &&
  directionConflict !== true &&
  direction === currentTraderDirection;

  const sizingIdentityMatches =
    sameValue(
      candidateId,
      engine7SizingPreview
        ?.candidateId
    ) &&
    sameValue(
      zoneId,
      engine7SizingPreview
        ?.zoneId
    ) &&
    sameValue(
      strategyId,
      engine7SizingPreview
        ?.strategyId
    ) &&
    sameValue(
      symbol,
      engine7SizingPreview
        ?.symbol
    ) &&
    sameValue(
      direction,
      engine7SizingPreview
        ?.direction
    );

  const sizingPreviewReady =
    engine7SizingPreview?.active ===
      true &&
    engine7SizingPreview
      ?.sizingPreviewAvailable ===
      true &&
    sizingIdentityMatches;

  const proposedTargets =
    normalizeProposedTargets({
      rawTargets:
        geometry?.proposedTargets,

      direction,
      entryPrice,
    });

  const fibTargets =
    normalizeFibTargets({
      minuteFib:
        engine27MinuteFib,

      minuteDecision:
        engine27MinuteDecision,

      direction,
      entryPrice,
    });

  const sourceTargets =
    proposedTargets.length >= 3
      ? proposedTargets
      : fibTargets;

  const officialTargets =
    buildOfficialTargets({
      sourceTargets,
      direction,
      entryPrice,
      stopDistancePoints:
        calculatedStopDistance,
    });

  const targetsReady =
    officialTargets.length === 3;

  const threeBlockManagement =
    buildThreeBlockManagement(
      officialTargets
    );

  const runnerPlan =
    buildRunnerPlan({
      entryPrice,
      officialTargets,
    });

  const planId =
    identityComplete &&
    stopDirectionValid &&
    stopDistanceValid &&
    targetsReady
      ? buildPlanId({
          candidateId,
          zoneId,
          strategyId,
          direction,
          entryPrice,
          stopPrice,
          targets:
            officialTargets,
        })
      : null;

  const invalidated =
    engine27MinuteDecision
      ?.readiness
      ?.invalidated === true;

  const managementReady =
    identityComplete &&
    stopDirectionValid &&
    stopDistanceValid &&
    targetsReady &&
    engine27CoreIdentityMatched &&
    engine27DirectionMatched &&
    directionConflict !== true &&
    sizingIdentityMatches &&
    sizingPreviewReady &&
    permissionReady &&
    engine27Ready &&
    invalidated !== true;

  let planStatus =
    "WAITING_FOR_PROPOSED_GEOMETRY";

  if (!geometry) {
    planStatus =
      "WAITING_FOR_PROPOSED_GEOMETRY";
  } else if (!identityComplete) {
    planStatus =
      "WAITING_FOR_CANDIDATE_IDENTITY";
  } else if (
  !engine27CoreIdentityMatched ||
  !sizingIdentityMatches
) {
  planStatus =
    "IDENTITY_MISMATCH";
} else if (
  directionConflict
) {
  planStatus =
    "DIRECTION_CONFLICT";
  } else if (
    entryPrice == null ||
    entryPrice <= 0
  ) {
    planStatus =
      "INVALID_ENTRY_GEOMETRY";
  } else if (
    !stopDirectionValid ||
    !stopDistanceValid
  ) {
    planStatus =
      "INVALID_STOP_GEOMETRY";
  } else if (!targetsReady) {
    planStatus =
      "WAITING_FOR_VALID_TARGETS";
  } else if (invalidated) {
    planStatus =
      "MANAGEMENT_BLOCKED";
  } else if (
    !permissionReady ||
    !engine27Ready ||
    !sizingPreviewReady
  ) {
    planStatus =
      "WAITING_FOR_UPSTREAM_CONFIRMATION";
  } else {
    planStatus =
      "OFFICIAL_PLAN_READY";
  }

  const waitingFor =
    buildWaitingFor({
      permissionReady,
      reactionReady,
      participationReady,
      engine27Ready,
      plannerReady,
      sizingPreviewReady,
    });

  const reasonCodes = unique([
    geometry
      ? "ENGINE26_PROPOSED_GEOMETRY_CONSUMED"
      : "ENGINE26_PROPOSED_GEOMETRY_REQUIRED",

    identityComplete
      ? "ENGINE26_CANDIDATE_IDENTITY_PRESERVED"
      : "CANDIDATE_IDENTITY_REQUIRED",

    stopDirectionValid
      ? "OFFICIAL_STOP_DIRECTION_VALIDATED"
      : "OFFICIAL_STOP_DIRECTION_INVALID",

    stopDistanceValid
      ? "OFFICIAL_STOP_DISTANCE_VALIDATED"
      : "OFFICIAL_STOP_DISTANCE_INVALID",

    proposedTargets.length >= 3
      ? "ENGINE26_PROPOSED_TARGETS_SELECTED"
      : fibTargets.length >= 3
      ? "ENGINE27B_MINUTE_TARGETS_SELECTED"
      : "VALID_TARGETS_REQUIRED",

    engine27CoreIdentityMatched
      ? "ENGINE27_CORE_IDENTITY_MATCHED"
      : "ENGINE27_CORE_IDENTITY_MISMATCH",

    directionConflict
      ? "PIPELINE_DIRECTION_CONFLICT"
      : null,

    engine27DirectionMatched
      ? "ENGINE27_DIRECTION_MATCHED"
       : null,

    sizingIdentityMatches
      ? "ENGINE7A_IDENTITY_MATCHED"
      : "ENGINE7A_IDENTITY_MISMATCH",

    permissionReady
      ? "ENGINE6_PERMISSION_READY"
      : "ENGINE6_PERMISSION_REQUIRED",

    reactionReady
      ? "ENGINE3_REACTION_READY"
      : "ENGINE3_REACTION_REQUIRED",

    participationReady
      ? "ENGINE4_PARTICIPATION_READY"
      : "ENGINE4_PARTICIPATION_REQUIRED",

    engine27Ready
      ? "ENGINE27_MINUTE_READY"
      : "ENGINE27_MINUTE_READY_REQUIRED",

    sizingPreviewReady
      ? "ENGINE7A_PREVIEW_AVAILABLE"
      : "ENGINE7A_PREVIEW_REQUIRED",

    managementReady
      ? "ENGINE9_OFFICIAL_PLAN_READY"
      : "ENGINE9_MANAGEMENT_NOT_READY",

    "NO_PERMISSION_CREATED",
    "NO_QUANTITY_CREATED",
    "NO_ORDER_CREATED",
    "NO_BROKER_ORDER",
    "NO_EXECUTION",
  ]);

  return {
    active:
      geometry != null,

    engine: ENGINE,
    contractVersion:
      CONTRACT_VERSION,

    mode:
      "PAPER_MANAGEMENT_PLAN",

    planId,

    candidateId,
    zoneId,
    strategyId,
    symbol,
    direction,
    setupType,

    snapshotTime:
      identitySnapshotTime,

    tradeId: null,
    idempotencyKey: null,
    orderId: null,

    planStatus,
    managementReady,

    official:
      managementReady,

    geometryValidated:
      identityComplete &&
      stopDirectionValid &&
      stopDistanceValid &&
      targetsReady,

    officialEntryPrice:
      entryPrice,

    officialStopPrice:
      stopPrice,

    officialStopDistancePoints:
      calculatedStopDistance,

    officialTargets,

    threeBlockManagement,

    runnerPlan,

    upstreamState: {
      engine6Decision,
      engine6Allowed:
        engine6PaperPermission
          ?.allowed === true,

      engine27DecisionState,

      reactionReady,
      participationReady,

      permissionReady:
        engine27PermissionReady,

      plannerReady,

      engine7SizingPreviewAvailable:
        sizingPreviewReady,

      coreIdentityMatched:
        engine27CoreIdentityMatched,

      directionConflict,

      candidateDirection:
        direction,

      currentTraderDirection,

      engine27DirectionMatched,
      engine7IdentityMatches:
        sizingIdentityMatches,

      invalidated,
    },

    sourceGeometry: {
      engine:
        geometry?.engine ?? null,

      contractVersion:
        geometry
          ?.contractVersion ??
        null,

      proposalOnly:
        geometry
          ?.proposalOnly === true,

      candidateId,
      zoneId,

      proposedEntryPrice:
        geometry
          ?.proposedEntryPrice ??
        null,

      proposedStopPrice:
        geometry
          ?.proposedStopPrice ??
        null,

      proposedStopDistancePoints:
        geometry
          ?.proposedStopDistancePoints ??
        null,

      proposedTargetCount:
        Array.isArray(
          geometry?.proposedTargets
        )
          ? geometry
              .proposedTargets
              .length
          : 0,
    },

    targetSource:
      proposedTargets.length >= 3
        ? "ENGINE26_PROPOSED_TARGETS"
        : fibTargets.length >= 3
        ? "ENGINE27B_MINUTE_EXTENSION"
        : "NONE",

    waitingFor,

    blockers:
      planStatus ===
      "IDENTITY_MISMATCH"
        ? [
           "PIPELINE_IDENTITY_MISMATCH",
          ]
        : planStatus ===
          "DIRECTION_CONFLICT"
        ? [
           "PIPELINE_DIRECTION_CONFLICT",
          ]
        : invalidated
        ? [
           "ENGINE27_SETUP_INVALIDATED",
          ]
        : [],

    warnings: unique([
      runnerPlan
        ?.trailing
        ?.enabled !== true
        ? "RUNNER_TRAILING_NOT_CONFIGURED"
        : null,

      proposedTargets.length < 3 &&
      fibTargets.length >= 3
        ? "ENGINE26_TARGETS_UNAVAILABLE_ENGINE27B_TARGETS_USED"
        : null,
    ]),

    noPermissionCreated: true,
    noSizingCreated: true,
    noQuantityCreated: true,
    noTradeCreated: true,
    noOrderCreated: true,
    noBrokerOrder: true,
    noExecution: true,
    noJournalWrite: true,

    reasonCodes,

    generatedAt:
      new Date().toISOString(),
  };
}


const STRATEGY1_IDENTITY = Object.freeze({
  laneId: "minute",
  strategyId: "intraday_scalp@10m",
  setupClass: "NEGOTIATED_ZONE_ROTATION",
  symbol: "ES",
});

const REQUIRED_IDENTITY_FIELDS = Object.freeze([
  "laneId",
  "strategyId",
  "candidateId",
  "zoneId",
  "symbol",
  "setupClass",
  "setupGrade",
  "identitySetupKey",
  "candidateIdentityVersion",
]);

function isStrategy1Phase8AInput(engine26LocationCandidate) {
  return (
    engine26LocationCandidate?.laneId === STRATEGY1_IDENTITY.laneId &&
    engine26LocationCandidate?.strategyId === STRATEGY1_IDENTITY.strategyId &&
    engine26LocationCandidate?.setupClass === STRATEGY1_IDENTITY.setupClass &&
    engine26LocationCandidate?.symbol === STRATEGY1_IDENTITY.symbol
  );
}

function copyIdentity(source) {
  return Object.fromEntries(
    REQUIRED_IDENTITY_FIELDS.map((field) => [field, source?.[field] ?? null])
  );
}

function identityComplete(identity) {
  return REQUIRED_IDENTITY_FIELDS.every((field) => {
    const value = identity?.[field];
    return value !== null && value !== undefined && String(value).trim() !== "";
  });
}

function identityMatches(reference, source) {
  return REQUIRED_IDENTITY_FIELDS.every(
    (field) => exactIdentityMatch(reference?.[field], source?.[field])
  );
}

function targetPrice(target) {
  return toNumber(target?.price ?? target?.targetPrice);
}

function findTargetBySequence(targets, sequence) {
  if (!Array.isArray(targets)) return null;
  return targets.find((target) => Number(target?.sequence) === sequence) || null;
}

function readThreeContractAllocation(engine7SizingPreview) {
  const allocation =
    engine7SizingPreview?.threeContractAllocation ||
    engine7SizingPreview?.preliminaryAllocation ||
    engine7SizingPreview?.contractAllocation ||
    null;

  const block1 = toNumber(
    allocation?.block1Contracts ?? allocation?.BLOCK_1 ?? allocation?.block1
  );
  const block2 = toNumber(
    allocation?.block2Contracts ?? allocation?.BLOCK_2 ?? allocation?.block2
  );
  const block3 = toNumber(
    allocation?.block3Contracts ?? allocation?.BLOCK_3 ?? allocation?.block3
  );

  return { block1, block2, block3 };
}

function directionallyValidStop({ direction, entryPrice, stopPrice }) {
  if (entryPrice == null || stopPrice == null) return false;
  if (direction === "LONG") return stopPrice < entryPrice;
  if (direction === "SHORT") return stopPrice > entryPrice;
  return false;
}

function directionallyValidTarget({ direction, entryPrice, price }) {
  if (entryPrice == null || price == null) return false;
  if (direction === "LONG") return price > entryPrice;
  if (direction === "SHORT") return price < entryPrice;
  return false;
}

function resolveSimplifiedTestingTargets(geometry) {
  const proposedTargets = Array.isArray(geometry?.proposedTargets)
    ? geometry.proposedTargets
    : [];

  const proposed1 = findTargetBySequence(proposedTargets, 1);
  const proposed2 = findTargetBySequence(proposedTargets, 2);

  const target1Price =
    toNumber(geometry?.target1Price) ??
    toNumber(geometry?.targetStopGeometry?.target1Price) ??
    targetPrice(proposed1);

  const target2Price =
    toNumber(geometry?.target2Price) ??
    toNumber(geometry?.targetStopGeometry?.target2Price) ??
    targetPrice(proposed2);

  // Frozen Strategy 1 testing lifecycle:
  // Block 3 exits at the same target-zone midline as Block 2.
  // No runner target is required or created by Engine 9.
  const target3Price =
    toNumber(geometry?.target3Price) ??
    toNumber(geometry?.testingExitLifecycle?.block3?.price) ??
    target2Price;

  return {
    target1Price,
    target2Price,
    target3Price,
  };
}

function buildSimplifiedTestingOfficialTargets({
  direction,
  entryPrice,
  stopDistancePoints,
  target1Price,
  target2Price,
  target3Price,
}) {
  const definitions = [
    {
      targetId: "T1",
      sequence: 1,
      price: target1Price,
      contracts: 1,
      allocationPct: 33,
      role: "FIRST_SCALE",
      purpose: "TARGET_1_ZONE_TOUCH",
      source: "ENGINE26B_TARGET_1",
      sourceTargetId: "TARGET_1_ZONE_TOUCH",
    },
    {
      targetId: "T2",
      sequence: 2,
      price: target2Price,
      contracts: 1,
      allocationPct: 33,
      role: "SECOND_SCALE",
      purpose: "TARGET_2_ZONE_MIDLINE",
      source: "ENGINE26B_TARGET_2",
      sourceTargetId: "TARGET_2_ZONE_MIDLINE",
    },
    {
      targetId: "T3",
      sequence: 3,
      price: target3Price,
      contracts: 1,
      allocationPct: 34,
      role: "FINAL_SCALE",
      purpose: "TARGET_3_ZONE_MIDLINE_TESTING",
      source: "ENGINE26B_SIMPLIFIED_TESTING_LIFECYCLE",
      sourceTargetId: "TARGET_3_ZONE_MIDLINE_TESTING",
    },
  ];

  return definitions.map((target) => {
    const distancePoints =
      target.price == null
        ? null
        : direction === "SHORT"
        ? round2(entryPrice - target.price)
        : round2(target.price - entryPrice);

    const rMultiple =
      distancePoints != null && stopDistancePoints > 0
        ? round2(distancePoints / stopDistancePoints)
        : null;

    return {
      targetId: target.targetId,
      sequence: target.sequence,
      sourceTargetId: target.sourceTargetId,
      price: target.price,
      targetPrice: target.price,
      contracts: target.contracts,
      distancePoints,
      rMultiple,
      allocationPct: target.allocationPct,
      role: target.role,
      purpose: target.purpose,
      source: target.source,
      sourcePurpose: target.purpose,
      sourceLabel: target.sourceTargetId,
      status: target.price == null ? "UNAVAILABLE" : "PLANNED",
      reasonCodes: [],
    };
  });
}

function buildStrategy1Phase8APlan({
  engine26LocationCandidate,
  engine26ProposedGeometry,
  engine7SizingPreview,
  engine6PaperPermission,
  engine27MinuteDecision,
  engine27MinuteFib,
  snapshotTime,
}) {
  const candidate = engine26LocationCandidate;
  const geometry = engine26ProposedGeometry;

  const referenceIdentity = copyIdentity(candidate);
  const geometryIdentity = copyIdentity(geometry);
  const sizingIdentity = copyIdentity(engine7SizingPreview);
  const traderIdentity = copyIdentity(engine27MinuteDecision);

  const blockers = [];
  const reasonCodes = [
    "ENGINE9_STRATEGY1_PHASE8A",
    "ENGINE9_NON_BLOCKING_MANAGEMENT_CONTRACT",
    "SIMPLIFIED_THREE_BLOCK_TESTING_LIFECYCLE",
    "OPENING_MANAGEMENT_PLAN_ONLY",
    "NO_DYNAMIC_MANAGEMENT",
    "NO_PERMISSION_CREATED",
    "NO_SIZING_CREATED",
    "NO_EXECUTION_AUTHORITY",
    "NO_ORDER_CREATED",
    "NO_FILL_CREATED",
    "NO_JOURNAL_WRITE",
  ];

  const requiredIdentityCorrect =
    referenceIdentity.laneId === STRATEGY1_IDENTITY.laneId &&
    referenceIdentity.strategyId === STRATEGY1_IDENTITY.strategyId &&
    referenceIdentity.setupClass === STRATEGY1_IDENTITY.setupClass &&
    referenceIdentity.symbol === STRATEGY1_IDENTITY.symbol;

  const completeIdentity = identityComplete(referenceIdentity);
  const geometryIdentityMatched =
    completeIdentity && identityMatches(referenceIdentity, geometryIdentity);

  // Engine 7A and Engine 27 are context only for Engine 9 plan creation.
  // Their identity/readiness may be published diagnostically but cannot veto
  // an already locked Engine 6 + Engine 26B package.
  const sizingIdentityMatched =
    completeIdentity && identityMatches(referenceIdentity, sizingIdentity);
  const traderIdentityMatched =
    completeIdentity && identityMatches(referenceIdentity, traderIdentity);

  const identityAgreement =
    requiredIdentityCorrect &&
    completeIdentity &&
    geometryIdentityMatched;

  if (!identityAgreement) {
    blockers.push("PIPELINE_IDENTITY_MISMATCH");
  }

  const direction = safeUpper(geometry?.direction);
  const entryPrice = toNumber(geometry?.proposedEntryPrice);
  const stopPrice = toNumber(geometry?.proposedStopPrice);
  const stopDistancePoints =
    entryPrice != null && stopPrice != null
      ? round2(Math.abs(entryPrice - stopPrice))
      : null;

  const directionValid = ["LONG", "SHORT"].includes(direction);
  const entryValid = entryPrice != null && entryPrice > 0;
  const stopValid =
    directionValid &&
    stopPrice != null &&
    stopPrice > 0 &&
    directionallyValidStop({ direction, entryPrice, stopPrice });

  if (!directionValid) blockers.push("INVALID_DIRECTION");
  if (!entryValid) blockers.push("INVALID_ENTRY_GEOMETRY");
  if (!stopValid) blockers.push("INVALID_STOP_GEOMETRY");

  const geometryReady = geometry?.geometryReady === true;
  if (!geometryReady) {
    blockers.push("ENGINE26B_GEOMETRY_INCOMPLETE");
  }

  const {
    target1Price,
    target2Price,
    target3Price,
  } = resolveSimplifiedTestingTargets(geometry);

  const target1Valid = directionallyValidTarget({
    direction,
    entryPrice,
    price: target1Price,
  });
  const target2Valid = directionallyValidTarget({
    direction,
    entryPrice,
    price: target2Price,
  });
  const target3Valid =
    target3Price != null &&
    target2Price != null &&
    target3Price === target2Price &&
    directionallyValidTarget({
      direction,
      entryPrice,
      price: target3Price,
    });

  if (!target1Valid) blockers.push("TARGET_1_INVALID");
  if (!target2Valid) blockers.push("TARGET_2_INVALID");
  if (!target3Valid) blockers.push("TARGET_3_INVALID");

  const engine6Decision = safeUpper(engine6PaperPermission?.decision);
  const engine6LockedGo =
    engine6PaperPermission?.allowed === true &&
    engine6PaperPermission?.locked === true &&
    VALID_PERMISSION_DECISIONS.has(engine6Decision);

  if (!engine6LockedGo) {
    blockers.push("ENGINE6_LOCKED_GO_REQUIRED");
  }

  const officialTargets = buildSimplifiedTestingOfficialTargets({
    direction,
    entryPrice,
    stopDistancePoints,
    target1Price,
    target2Price,
    target3Price,
  });

  const targetsValid =
    officialTargets.length === 3 &&
    officialTargets.every((target) => target.price != null);

  const openingManagementPlan = {
    planType: "OPENING_OFFICIAL_MANAGEMENT_PLAN",
    lifecycleMode: "SIMPLIFIED_THREE_BLOCK_TESTING",
    contracts: 3,
    officialEntryPrice: entryPrice,
    officialStopPrice: stopPrice,
    sharedProtectiveStopPrice: stopPrice,
    blocks: [
      {
        blockId: "BLOCK_1",
        contractId: "CONTRACT_1",
        contracts: 1,
        purpose: "TARGET_1_ZONE_TOUCH",
        targetId: "T1",
        targetPrice: target1Price,
      },
      {
        blockId: "BLOCK_2",
        contractId: "CONTRACT_2",
        contracts: 1,
        purpose: "TARGET_2_ZONE_MIDLINE",
        targetId: "T2",
        targetPrice: target2Price,
      },
      {
        blockId: "BLOCK_3",
        contractId: "CONTRACT_3",
        contracts: 1,
        purpose: "TARGET_3_ZONE_MIDLINE_TESTING",
        targetId: "T3",
        targetPrice: target3Price,
      },
    ],
    totalContracts: 3,
    runnerExpected: false,
    frozenAtOpening: false,
    dynamicManagementImplemented: false,
  };

  const threeBlockManagement = {
    enabled: targetsValid,
    allocationMode: "EXACT_CONTRACTS",
    totalContracts: 3,
    totalAllocationPct: 100,
    blocks: openingManagementPlan.blocks.map((block, index) => ({
      ...block,
      allocationPct: TARGET_ALLOCATIONS[index],
      exitAtTargetId: block.targetId,
      afterExitAction:
        index === 0
          ? "MOVE_STOP_TO_BREAKEVEN"
          : index === 1
          ? "HOLD_FINAL_CONTRACT_TO_MIDLINE"
          : "CLOSE_REMAINDER",
      status: block.targetPrice == null ? "UNAVAILABLE" : "PLANNED",
    })),
    status: targetsValid
      ? "THREE_BLOCK_PLAN_AVAILABLE"
      : "WAITING_FOR_VALID_TARGETS",
  };

  const runnerPlan = {
    enabled: false,
    blockId: null,
    contracts: 0,
    allocationPct: 0,
    purpose: "NO_RUNNER_SIMPLIFIED_TESTING_LIFECYCLE",
    runnerTargetPrice: null,
    runnerTargetStatus: "NO_RUNNER_REQUIRED",
    targetSource: "NONE",
    sourceTargetId: null,
    activationCondition: null,
    initialProtection: null,
    trailing: {
      enabled: false,
      type: "NOT_CONFIGURED",
      value: null,
    },
    dynamicManagementImplemented: false,
    status: "NO_RUNNER_REQUIRED",
  };

  // Preserve Engine 7A facts for downstream consumers, but never use them to
  // veto Engine 9's official management plan.
  const allocation = readThreeContractAllocation(engine7SizingPreview);
  const threeContractAllocation = {
    block1Contracts: allocation.block1,
    block2Contracts: allocation.block2,
    block3Contracts: allocation.block3,
  };
  const allocationValid =
    allocation.block1 === 1 &&
    allocation.block2 === 1 &&
    allocation.block3 === 1;

  const productionRiskBudgetDollars =
    toNumber(engine7SizingPreview?.productionRiskBudgetDollars);
  const productionRiskSupportedContracts =
    toNumber(engine7SizingPreview?.productionRiskSupportedContracts);
  const productionEstimatedRiskDollars =
    toNumber(engine7SizingPreview?.productionEstimatedRiskDollars);
  const productionThreeContractPlanQualified =
    engine7SizingPreview?.productionThreeContractPlanQualified === true
      ? true
      : engine7SizingPreview?.productionThreeContractPlanQualified === false
      ? false
      : null;
  const productionRiskLimited =
    engine7SizingPreview?.productionRiskLimited === true
      ? true
      : engine7SizingPreview?.productionRiskLimited === false
      ? false
      : null;

  const testingDataCollectionMode =
    engine7SizingPreview?.testingDataCollectionMode === true;
  const testingRiskOverrideApplied =
    engine7SizingPreview?.testingRiskOverrideApplied === true;
  const paperTestingContracts =
    toNumber(engine7SizingPreview?.paperTestingContracts);
  const testingThreeContractPlanQualified =
    engine7SizingPreview?.testingThreeContractPlanQualified === true;

  const testingAllocationAccepted =
    testingDataCollectionMode &&
    testingRiskOverrideApplied &&
    testingThreeContractPlanQualified &&
    paperTestingContracts === 3 &&
    allocationValid;

  const productionAllocationAccepted =
    testingAllocationAccepted !== true &&
    productionThreeContractPlanQualified === true &&
    allocationValid;

  const allocationQualificationSource =
    testingAllocationAccepted
      ? "ENGINE7A_TESTING_DATA_COLLECTION"
      : productionAllocationAccepted
      ? "ENGINE7A_PRODUCTION_RISK_APPROVAL"
      : null;

  const readiness = engine27MinuteDecision?.readiness || {};
  const invalidated = readiness.invalidated === true;

  // Engine 27 is context/warning only after Engine 6 has locked GO and
  // Engine 26B has valid geometry. It cannot block plan creation.
  const engine27Context = {
    decisionState: safeUpper(engine27MinuteDecision?.decisionState),
    direction: safeUpper(engine27MinuteDecision?.direction),
    reactionReady: readiness.reactionReady === true,
    participationReady: readiness.participationReady === true,
    permissionReady: readiness.permissionReady === true,
    plannerReady: readiness.plannerReady === true,
    invalidated,
  };

  const managementReady =
    identityAgreement &&
    engine6LockedGo &&
    geometryReady &&
    directionValid &&
    entryValid &&
    stopValid &&
    targetsValid;

  let planStatus = "OFFICIAL_PLAN_READY";
  if (!identityAgreement) planStatus = "IDENTITY_MISMATCH";
  else if (!engine6LockedGo) planStatus = "WAITING_FOR_ENGINE6_LOCKED_GO";
  else if (!geometryReady) planStatus = "WAITING_FOR_PROPOSED_GEOMETRY";
  else if (!directionValid) planStatus = "INVALID_DIRECTION";
  else if (!entryValid) planStatus = "INVALID_ENTRY_GEOMETRY";
  else if (!stopValid) planStatus = "INVALID_STOP_GEOMETRY";
  else if (!targetsValid) planStatus = "WAITING_FOR_VALID_TARGETS";

  const planId =
    managementReady
      ? buildPlanId({
          candidateId: referenceIdentity.candidateId,
          zoneId: referenceIdentity.zoneId,
          strategyId: referenceIdentity.strategyId,
          direction,
          entryPrice,
          stopPrice,
          targets: officialTargets,
        })
      : null;

  const waitingFor = unique([
    !engine6LockedGo ? "ENGINE6_LOCKED_GO" : null,
    !geometryReady ? "ENGINE26B_GEOMETRY_READY" : null,
    !identityAgreement ? "PIPELINE_IDENTITY" : null,
    !entryValid || !stopValid || !targetsValid
      ? "VALID_MANAGEMENT_GEOMETRY"
      : null,
  ]);

  const warnings = unique([
    sizingIdentityMatched !== true
      ? "ENGINE7A_IDENTITY_CONTEXT_MISMATCH"
      : null,
    traderIdentityMatched !== true
      ? "ENGINE27_IDENTITY_CONTEXT_MISMATCH"
      : null,
    engine27Context.plannerReady !== true
      ? "ENGINE27_PLANNER_NOT_READY_CONTEXT_ONLY"
      : null,
    engine27Context.decisionState !== "READY"
      ? "ENGINE27_MINUTE_NOT_READY_CONTEXT_ONLY"
      : null,
    invalidated
      ? "ENGINE27_INVALIDATED_CONTEXT_ONLY_AFTER_LOCKED_PACKAGE"
      : null,
  ]);

  return {
    active: candidate != null || geometry != null,
    engine: ENGINE,
    contractVersion: CONTRACT_VERSION,
    phase: "PHASE_8A",
    mode: "PAPER_MANAGEMENT_PLAN",
    planId,
    ...referenceIdentity,
    direction,
    snapshotTime:
      geometry?.snapshotTime ??
      candidate?.snapshotTime ??
      snapshotTime ??
      null,
    tradeId: null,
    idempotencyKey: null,
    orderId: null,
    planStatus,
    managementReady,
    official: managementReady,
    geometryValidated:
      geometryReady &&
      entryValid &&
      stopValid &&
      targetsValid,
    openingManagementPlan,
    officialEntryPrice: entryPrice,
    officialStopPrice: stopPrice,
    officialStopDistancePoints: stopDistancePoints,
    officialTargets,
    threeBlockManagement,
    runnerPlan,
    runnerTargetPrice: null,
    runnerTargetStatus: "NO_RUNNER_REQUIRED",
    targetSource: "ENGINE26B_SIMPLIFIED_TESTING_LIFECYCLE",
    identityValidation: {
      requiredIdentityCorrect,
      completeIdentity,
      geometryIdentityMatched,
      sizingIdentityMatched,
      traderIdentityMatched,
      completeIdentityAgreement: identityAgreement,
    },
    upstreamState: {
      engine6Decision,
      engine6LockedGo,
      engine6Allowed: engine6PaperPermission?.allowed === true,
      engine6Locked: engine6PaperPermission?.locked === true,
      geometryReady,
      candidateDirection: safeUpper(candidate?.direction),
      geometryDirection: direction,
      engine27: engine27Context,
      engine7Allocation: allocation,
      engine7AllocationValid: allocationValid,
      testingAllocationAccepted,
      productionAllocationAccepted,
      allocationQualificationSource,
      engine27HardGateApplied: false,
      engine7HardGateApplied: false,
      runnerHardGateApplied: false,
    },
    testingDataCollectionMode,
    testingRiskOverrideApplied,
    paperTestingContracts,
    testingThreeContractPlanQualified,
    testingAllocationAccepted,
    threeContractAllocation,
    allocationQualificationSource,
    productionRiskBudgetDollars,
    productionRiskSupportedContracts,
    productionEstimatedRiskDollars,
    productionThreeContractPlanQualified,
    productionRiskLimited,
    blockers: unique(blockers),
    waitingFor,
    warnings,
    reasonCodes: unique([
      ...reasonCodes,
      identityAgreement
        ? "PIPELINE_IDENTITY_MATCHED"
        : "PIPELINE_IDENTITY_MISMATCH",
      engine6LockedGo
        ? "ENGINE6_LOCKED_GO_CONSUMED"
        : "ENGINE6_LOCKED_GO_REQUIRED",
      geometryReady
        ? "ENGINE26B_GEOMETRY_READY_CONSUMED"
        : "ENGINE26B_GEOMETRY_READY_REQUIRED",
      target1Valid ? "TARGET_1_PRESERVED" : "TARGET_1_INVALID",
      target2Valid ? "TARGET_2_PRESERVED" : "TARGET_2_INVALID",
      target3Valid
        ? "TARGET_3_MIDLINE_TESTING_PRESERVED"
        : "TARGET_3_INVALID",
      "ENGINE27_READINESS_CONTEXT_ONLY",
      "ENGINE7_SIZING_CONTEXT_ONLY_FOR_ENGINE9",
      "NO_RUNNER_REQUIRED",
      testingAllocationAccepted
        ? "ENGINE7A_TESTING_ALLOCATION_ACCEPTED"
        : "ENGINE7A_TESTING_ALLOCATION_NOT_ACCEPTED",
      productionAllocationAccepted
        ? "ENGINE7A_PRODUCTION_ALLOCATION_ACCEPTED"
        : null,
      allocationQualificationSource,
      managementReady
        ? "ENGINE9_OFFICIAL_PLAN_READY"
        : "ENGINE9_MANAGEMENT_NOT_READY",
    ]),
    noPermissionCreated: true,
    noSizingCreated: true,
    noQuantityCreated: true,
    noTradeCreated: true,
    noOrderCreated: true,
    noBrokerOrder: true,
    noExecution: true,
    noJournalWrite: true,
    dynamicManagementImplemented: false,
    phase8BImplemented: false,
    generatedAt: new Date().toISOString(),
  };
}

export function buildEngine9OfficialManagementPlan(inputs = {}) {
  if (isStrategy1Phase8AInput(inputs.engine26LocationCandidate)) {
    return buildStrategy1Phase8APlan(inputs);
  }

  return buildLegacyEngine9OfficialManagementPlan(inputs);
}

export default buildEngine9OfficialManagementPlan;
