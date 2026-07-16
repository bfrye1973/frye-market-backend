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

export function buildEngine9OfficialManagementPlan({
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

export default buildEngine9OfficialManagementPlan;
