// services/core/logic/engine28a/buildPipelineDoctor.js
//
// Engine 28A — Strategy 1 Pipeline Doctor v1
//
// Read-only diagnostic contract:
// - consumes one frozen Strategy 1 snapshot object
// - never mutates another engine
// - identifies the first non-passing stage
// - distinguishes WAITING from BLOCKED/ERROR
// - preserves exact proof fields used for each conclusion
//
// Current canonical chain:
// 26A -> 3 -> 4 -> 6 -> 26B -> 7 -> 9 -> 8 -> 10
//
// Engine 22 / 27 / 25 remain context-only in v1.
// Engine 7B is retired and must not be treated as an independent owner.

const ENGINE = "engine28a.pipelineDoctor.v1";
const CONTRACT_VERSION = "engine28a.pipelineDoctor.v1";

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function num(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function bool(value) {
  return value === true;
}

function proof(value) {
  if (value === undefined) return null;
  return value;
}

function reasonText(values = []) {
  return values
    .filter(Boolean)
    .map((value) => String(value))
    .join("|")
    .toUpperCase();
}

function classifyWaitingOrBlocked({ status, blockers = [], reasonCodes = [] }) {
  const haystack = reasonText([
    status,
    ...arr(blockers),
    ...arr(reasonCodes),
  ]);

  if (
    haystack.includes("WAIT") ||
    haystack.includes("WATCH") ||
    haystack.includes("REACTION") ||
    haystack.includes("PARTICIPATION") ||
    haystack.includes("VOLUME") ||
    haystack.includes("MARKET")
  ) {
    return {
      pipelineStatus: "WAITING",
      failureType: "WAITING_FOR_MARKET",
    };
  }

  if (
    haystack.includes("MISMATCH") ||
    haystack.includes("IDENTITY") ||
    haystack.includes("INVALID")
  ) {
    return {
      pipelineStatus: "BLOCKED",
      failureType: "CONTRACT_MISMATCH",
    };
  }

  return {
    pipelineStatus: "BLOCKED",
    failureType: "ENGINE_LOGIC",
  };
}

function stage(name, state, details = {}) {
  return {
    engine: name,
    state,
    ...details,
  };
}

function fail({
  firstFailingEngine,
  pipelineStatus,
  failureType,
  rootCause,
  proof: exactProof,
  stages,
  doNotChange = [],
  waitFor = [],
  warnings = [],
  safety,
  snapshotTime,
}) {
  return {
    active: true,
    engine: ENGINE,
    contractVersion: CONTRACT_VERSION,
    mode: "READ_ONLY_PIPELINE_DIAGNOSTIC",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    pipelineStatus,
    firstFailingEngine,
    failureType,
    rootCause,
    proof: exactProof,
    stages,
    engineInstructions: {
      firstFailingEngine,
      downstreamMustWait: waitFor,
      doNotChange,
    },
    warnings,
    safety,
    snapshotTime,
    generatedAt: new Date().toISOString(),
  };
}

function safetyState(strategy) {
  const e6 = strategy?.permission?.paper || {};
  const e8 = strategy?.engine8PaperOrder || {};

  const realExecutionAllowed =
    e6?.realExecutionAllowed === true ||
    e8?.realExecutionAllowed === true;

  const brokerExecutionAllowed =
    e6?.brokerExecutionAllowed === true ||
    e8?.brokerExecutionAllowed === true;

  const schwabExecutionAllowed =
    e6?.schwabExecutionAllowed === true ||
    e8?.schwabExecutionAllowed === true;

  return {
    realExecutionAllowed,
    brokerExecutionAllowed,
    schwabExecutionAllowed,
    safe:
      !realExecutionAllowed &&
      !brokerExecutionAllowed &&
      !schwabExecutionAllowed,
  };
}

export function buildEngine28APipelineDoctor(strategy = {}) {
  const e26a = strategy?.engine26LocationCandidate || null;
  const e3 =
    strategy?.confluence?.context?.reaction?.paperScalpReaction || null;
  const e4 =
    strategy?.confluence?.context?.volume
      ?.engine4AuthorizedReactionParticipation || null;
  const e6 = strategy?.permission?.paper || null;
  const e26b = strategy?.engine26ProposedGeometry || null;
  const e7 = strategy?.engine7PositionSizing || null;
  const e9 = strategy?.engine9OfficialManagementPlan || null;
  const e8 = strategy?.engine8PaperOrder || null;
  const e10 =
    strategy?.engine10Journal ||
    strategy?.engine10JournalAttachment ||
    strategy?.engine10Lifecycle ||
    null;

  const snapshotTime =
    e26a?.snapshotTime ||
    e3?.snapshotTime ||
    e6?.snapshotTime ||
    strategy?.snapshotTime ||
    null;

  const safety = safetyState(strategy);
  const stages = [];
  const warnings = [];

  if (!safety.safe) {
    const owner =
      e8?.realExecutionAllowed === true ||
      e8?.brokerExecutionAllowed === true ||
      e8?.schwabExecutionAllowed === true
        ? "engine8"
        : "engine6";

    return fail({
      firstFailingEngine: owner,
      pipelineStatus: "ERROR",
      failureType: "SAFETY_REJECTION",
      rootCause: "REAL_OR_BROKER_EXECUTION_FLAG_PRESENT",
      proof: safety,
      stages,
      doNotChange: [
        "engine26A",
        "engine3",
        "engine4",
        "engine26B",
        "engine7",
        "engine9",
        "engine10",
      ],
      waitFor: [],
      warnings,
      safety,
      snapshotTime,
    });
  }

  if (!e26a || typeof e26a !== "object") {
    return fail({
      firstFailingEngine: "engine26A",
      pipelineStatus: "ERROR",
      failureType: "MISSING_DATA",
      rootCause: "REQUIRED_FIELD_MISSING",
      proof: {
        engine26LocationCandidatePresent: false,
      },
      stages,
      doNotChange: [
        "engine3",
        "engine4",
        "engine6",
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine3",
        "engine4",
        "engine6",
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  stages.push(
    stage("engine26A", "PASS_CONTEXT", {
      status: proof(e26a?.status),
      direction: proof(e26a?.direction),
      candidateId: proof(e26a?.candidateId),
      zoneId: proof(e26a?.zoneId),
      currentPrice: proof(e26a?.currentPrice),
    })
  );

  if (!e3 || typeof e3 !== "object") {
    return fail({
      firstFailingEngine: "engine3",
      pipelineStatus: "ERROR",
      failureType: "MISSING_DATA",
      rootCause: "REQUIRED_FIELD_MISSING",
      proof: {
        paperScalpReactionPresent: false,
      },
      stages,
      doNotChange: [
        "engine4",
        "engine6",
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine4",
        "engine6",
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  const e3Direction = upper(e3?.direction);
  const e3Pass =
    e3?.allowed === true &&
    e3?.engine3Strategy1QualifiedForEngine6 === true &&
    ["LONG", "SHORT"].includes(e3Direction);

  stages.push(
    stage("engine3", e3Pass ? "PASS" : "WAITING", {
      state: proof(e3?.state),
      direction: proof(e3?.direction),
      quality: proof(e3?.quality),
      allowed: proof(e3?.allowed),
      qualified: proof(
        e3?.engine3Strategy1QualifiedForEngine6
      ),
      blockers: arr(e3?.blockers),
      reasonCodes: arr(e3?.reasonCodes),
    })
  );

  if (!e3Pass) {
    return fail({
      firstFailingEngine: "engine3",
      pipelineStatus: "WAITING",
      failureType: "WAITING_FOR_MARKET",
      rootCause: "ENGINE3_STRATEGY1_NOT_QUALIFIED",
      proof: stages.at(-1),
      stages,
      doNotChange: [
        "engine4",
        "engine6",
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine4",
        "engine6",
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  if (!e4 || typeof e4 !== "object") {
    return fail({
      firstFailingEngine: "engine4",
      pipelineStatus: "ERROR",
      failureType: "MISSING_DATA",
      rootCause: "REQUIRED_FIELD_MISSING",
      proof: {
        engine4AuthorizedReactionParticipationPresent: false,
      },
      stages,
      doNotChange: [
        "engine6",
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine6",
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  const e4Direction = upper(e4?.direction);
  const e4State = upper(
    e4?.participationState ||
    e4?.status
  );

  const e4Pass =
    e4?.participationConfirmed === true &&
    e4?.allowed === true &&
    e4?.hardBlocked !== true &&
    e4Direction === e3Direction;

  const e4IdentityFailure =
    e4State === "IDENTITY_MISMATCH" ||
    reasonText([
      ...arr(e4?.blockers),
      ...arr(e4?.reasonCodes),
    ]).includes("IDENTITY_MISMATCH");

  const e4Invalidated =
    e4State === "CANDIDATE_INVALIDATED" ||
    reasonText([
      ...arr(e4?.blockers),
      ...arr(e4?.reasonCodes),
    ]).includes("CANDIDATE_INVALIDATED");

  const e4HardBlock =
    e4?.hardBlocked === true ||
    e4State === "ADVERSE_PARTICIPATION_BLOCKED";

  const e4StageState =
    e4Pass
      ? "PASS"
      : e4HardBlock || e4IdentityFailure || e4Invalidated
      ? "BLOCKED"
      : "WAITING";

  stages.push(
    stage("engine4", e4StageState, {
      participationState: proof(e4?.participationState),
      status: proof(e4?.status),
      direction: proof(e4?.direction),
      participationQuality: proof(e4?.participationQuality),
      confirmed: proof(e4?.participationConfirmed),
      allowed: proof(e4?.allowed),
      hardBlocked: proof(e4?.hardBlocked),
      blockers: arr(e4?.blockers),
      reasonCodes: arr(e4?.reasonCodes),
    })
  );

  if (!e4Pass) {
    const e4Failure =
      e4IdentityFailure
        ? {
            pipelineStatus: "BLOCKED",
            failureType: "CONTRACT_MISMATCH",
            rootCause: "ENGINE4_IDENTITY_MISMATCH",
          }
        : e4Invalidated
        ? {
            pipelineStatus: "BLOCKED",
            failureType: "ENGINE_LOGIC",
            rootCause: "ENGINE4_CANDIDATE_INVALIDATED",
          }
        : e4HardBlock
        ? {
            pipelineStatus: "BLOCKED",
            failureType: "SAFETY_REJECTION",
            rootCause: "ENGINE4_ADVERSE_PARTICIPATION_BLOCKED",
          }
        : {
            pipelineStatus: "WAITING",
            failureType: "WAITING_FOR_MARKET",
            rootCause: "ENGINE4_PARTICIPATION_NOT_CONFIRMED",
          };

    return fail({
      firstFailingEngine: "engine4",
      pipelineStatus: e4Failure.pipelineStatus,
      failureType: e4Failure.failureType,
      rootCause: e4Failure.rootCause,
      proof: stages.at(-1),
      stages,
      doNotChange: [
        "engine6",
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine6",
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  if (!e6 || typeof e6 !== "object") {
    return fail({
      firstFailingEngine: "engine6",
      pipelineStatus: "ERROR",
      failureType: "MISSING_DATA",
      rootCause: "REQUIRED_FIELD_MISSING",
      proof: {
        permissionPaperPresent: false,
      },
      stages,
      doNotChange: [
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  const e6Direction = upper(e6?.direction);
  const e6Pass =
    e6?.allowed === true &&
    e6?.paperAllowed === true &&
    e6?.locked === true &&
    ["LONG", "SHORT"].includes(e6Direction) &&
    e6Direction === e3Direction &&
    e6Direction === e4Direction;

  stages.push(
    stage("engine6", e6Pass ? "PASS" : "BLOCKED", {
      decision: proof(e6?.decision),
      direction: proof(e6?.direction),
      allowed: proof(e6?.allowed),
      paperAllowed: proof(e6?.paperAllowed),
      locked: proof(e6?.locked),
      candidateId: proof(e6?.candidateId),
      zoneId: proof(e6?.zoneId),
      blockers: arr(e6?.blockers),
      reasonCodes: arr(e6?.reasonCodes),
    })
  );

  if (!e6Pass) {
    const classification = classifyWaitingOrBlocked({
      status: e6?.decision,
      blockers: e6?.blockers,
      reasonCodes: e6?.reasonCodes,
    });

    return fail({
      firstFailingEngine: "engine6",
      pipelineStatus: classification.pipelineStatus,
      failureType: classification.failureType,
      rootCause: "ENGINE6_LOCKED_PAPER_PERMISSION_NOT_READY",
      proof: stages.at(-1),
      stages,
      doNotChange: [
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine26B",
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  if (!e26b || typeof e26b !== "object") {
    return fail({
      firstFailingEngine: "engine26B",
      pipelineStatus: "ERROR",
      failureType: "MISSING_DATA",
      rootCause: "REQUIRED_FIELD_MISSING",
      proof: {
        engine26ProposedGeometryPresent: false,
      },
      stages,
      doNotChange: [
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  const e26bDirection = upper(e26b?.direction);
  const entry = num(e26b?.proposedEntryPrice);
  const stop = num(e26b?.proposedStopPrice);
  const targets =
    arr(e26b?.proposedTargets).length > 0
      ? arr(e26b?.proposedTargets)
      : [
          e26b?.target1Price,
          e26b?.target2Price,
          e26b?.target3Price,
        ]
          .map((price) => ({ price: num(price) }))
          .filter((target) => target.price !== null);

  const targetPrices = targets
    .map((target) => num(target?.price ?? target))
    .filter((price) => price !== null);

  const stopValid =
    entry !== null &&
    stop !== null &&
    (
      e26bDirection === "LONG"
        ? stop < entry
        : e26bDirection === "SHORT"
        ? stop > entry
        : false
    );

  const targetValid =
    entry !== null &&
    targetPrices.length > 0 &&
    targetPrices.some((price) =>
      e26bDirection === "LONG"
        ? price > entry
        : e26bDirection === "SHORT"
        ? price < entry
        : false
    );

  const e26bPass =
    e26b?.geometryReady === true &&
    e26bDirection === e6Direction &&
    entry !== null &&
    stopValid &&
    targetValid &&
    (
      !e6?.candidateId ||
      !e26b?.candidateId ||
      e6.candidateId === e26b.candidateId
    ) &&
    (
      !e6?.zoneId ||
      !e26b?.zoneId ||
      e6.zoneId === e26b.zoneId
    );

  stages.push(
    stage("engine26B", e26bPass ? "PASS" : "BLOCKED", {
      status: proof(e26b?.status),
      direction: proof(e26b?.direction),
      geometryReady: proof(e26b?.geometryReady),
      candidateId: proof(e26b?.candidateId),
      zoneId: proof(e26b?.zoneId),
      entry,
      stop,
      targets: targetPrices,
    })
  );

  if (!e26bPass) {
    return fail({
      firstFailingEngine: "engine26B",
      pipelineStatus: "BLOCKED",
      failureType:
        e26bDirection !== e6Direction
          ? "CONTRACT_MISMATCH"
          : "ENGINE_LOGIC",
      rootCause:
        e26bDirection !== e6Direction
          ? "ENGINE26B_DIRECTION_MISMATCH"
          : "ENGINE26B_GEOMETRY_NOT_READY",
      proof: stages.at(-1),
      stages,
      doNotChange: [
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine7",
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  if (!e7 || typeof e7 !== "object") {
    return fail({
      firstFailingEngine: "engine7",
      pipelineStatus: "ERROR",
      failureType: "MISSING_DATA",
      rootCause: "REQUIRED_FIELD_MISSING",
      proof: {
        engine7PositionSizingPresent: false,
      },
      stages,
      doNotChange: [
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  const finalContracts =
    num(e7?.finalContracts) ??
    num(e7?.paperTestingContracts) ??
    0;

  const e7Pass =
    e7?.allowed === true &&
    e7?.executableSizing === true &&
    Number.isInteger(finalContracts) &&
    finalContracts > 0 &&
    upper(e7?.direction) === e6Direction;

  stages.push(
    stage("engine7", e7Pass ? "PASS" : "BLOCKED", {
      status: proof(e7?.status),
      direction: proof(e7?.direction),
      allowed: proof(e7?.allowed),
      executableSizing: proof(e7?.executableSizing),
      paperOrderSizingReady: proof(e7?.paperOrderSizingReady),
      finalContracts,
      blockers: arr(e7?.blockers),
      reasonCodes: arr(e7?.reasonCodes),
    })
  );

  if (!e7Pass) {
    const classification = classifyWaitingOrBlocked({
      status: e7?.status,
      blockers: e7?.blockers,
      reasonCodes: e7?.reasonCodes,
    });

    return fail({
      firstFailingEngine: "engine7",
      pipelineStatus: classification.pipelineStatus,
      failureType: classification.failureType,
      rootCause: "ENGINE7_FINAL_SIZING_NOT_READY",
      proof: stages.at(-1),
      stages,
      doNotChange: [
        "engine9",
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine9",
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  if (!e9 || typeof e9 !== "object") {
    return fail({
      firstFailingEngine: "engine9",
      pipelineStatus: "ERROR",
      failureType: "MISSING_DATA",
      rootCause: "REQUIRED_FIELD_MISSING",
      proof: {
        engine9OfficialManagementPlanPresent: false,
      },
      stages,
      doNotChange: [
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  const e9Pass =
    e9?.managementReady === true &&
    e9?.official === true &&
    Boolean(e9?.planId) &&
    upper(e9?.direction) === e6Direction;

  stages.push(
    stage("engine9", e9Pass ? "PASS" : "BLOCKED", {
      status: proof(e9?.planStatus),
      direction: proof(e9?.direction),
      managementReady: proof(e9?.managementReady),
      official: proof(e9?.official),
      planId: proof(e9?.planId),
      waitingFor: arr(e9?.waitingFor),
      blockers: arr(e9?.blockers),
      warnings: arr(e9?.warnings),
    })
  );

  if (!e9Pass) {
    const classification = classifyWaitingOrBlocked({
      status: e9?.planStatus,
      blockers: [
        ...arr(e9?.blockers),
        ...arr(e9?.waitingFor),
      ],
      reasonCodes: e9?.reasonCodes,
    });

    return fail({
      firstFailingEngine: "engine9",
      pipelineStatus: classification.pipelineStatus,
      failureType: classification.failureType,
      rootCause: "ENGINE9_OFFICIAL_PLAN_NOT_READY",
      proof: stages.at(-1),
      stages,
      doNotChange: [
        "engine8",
        "engine10",
      ],
      waitFor: [
        "engine8",
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  if (!e8 || typeof e8 !== "object") {
    return fail({
      firstFailingEngine: "engine8",
      pipelineStatus: "ERROR",
      failureType: "MISSING_DATA",
      rootCause: "REQUIRED_FIELD_MISSING",
      proof: {
        engine8PaperOrderPresent: false,
      },
      stages,
      doNotChange: [
        "engine10",
      ],
      waitFor: [
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  const e8Ready =
    upper(e8?.status) === "READY_TO_CREATE_PAPER_ORDER" &&
    e8?.executable === true;

  const e8AlreadyOrdered =
    e8?.orderCreated === true ||
    Boolean(e8?.orderId) ||
    Boolean(e8?.tradeId);

  stages.push(
    stage(
      "engine8",
      e8Ready || e8AlreadyOrdered ? "PASS" : "BLOCKED",
      {
        status: proof(e8?.status),
        direction: proof(e8?.direction),
        executable: proof(e8?.executable),
        orderCreated: proof(e8?.orderCreated),
        orderId: proof(e8?.orderId),
        tradeId: proof(e8?.tradeId),
        finalContracts: proof(e8?.finalContracts),
        blockers: arr(e8?.blockers),
        reasonCodes: arr(e8?.reasonCodes),
      }
    )
  );

  if (!e8Ready && !e8AlreadyOrdered) {
    const classification = classifyWaitingOrBlocked({
      status: e8?.status,
      blockers: e8?.blockers,
      reasonCodes: e8?.reasonCodes,
    });

    return fail({
      firstFailingEngine: "engine8",
      pipelineStatus: classification.pipelineStatus,
      failureType:
        classification.failureType === "WAITING_FOR_MARKET"
          ? "SAFETY_REJECTION"
          : classification.failureType,
      rootCause: "ENGINE8_NOT_EXECUTABLE",
      proof: stages.at(-1),
      stages,
      doNotChange: [
        "engine10",
      ],
      waitFor: [
        "engine10",
      ],
      warnings,
      safety,
      snapshotTime,
    });
  }

  const e10JournalStatus =
    upper(
      e10?.status ||
      e10?.journal?.status ||
      e10?.lifecycle?.status
    );

  if (e10 && typeof e10 === "object") {
    stages.push(
      stage("engine10", "OBSERVED", {
        status: proof(
          e10?.status ||
          e10?.journal?.status ||
          e10?.lifecycle?.status
        ),
        tradeId: proof(
          e10?.tradeId ||
          e10?.journal?.tradeId ||
          e10?.lifecycle?.tradeId
        ),
        remainingQty: proof(
          e10?.remainingQty ??
          e10?.journal?.remainingQty ??
          e10?.lifecycle?.remainingQty
        ),
      })
    );
  } else {
    warnings.push("ENGINE10_CURRENT_SNAPSHOT_RECORD_NOT_ATTACHED");
  }

  const pipelineStatus =
    e8AlreadyOrdered
      ? e10JournalStatus === "CLOSED"
        ? "COMPLETE"
        : "PASS"
      : "ORDER_READY";

  return {
    active: true,
    engine: ENGINE,
    contractVersion: CONTRACT_VERSION,
    mode: "READ_ONLY_PIPELINE_DIAGNOSTIC",
    strategyId: "intraday_scalp@10m",
    symbol: "ES",
    pipelineStatus,
    firstFailingEngine: null,
    failureType: null,
    rootCause: null,
    proof: {
      engine6Decision: proof(e6?.decision),
      engine6Direction: proof(e6?.direction),
      engine26BStatus: proof(e26b?.status),
      engine7Status: proof(e7?.status),
      engine9Status: proof(e9?.planStatus),
      engine8Status: proof(e8?.status),
      engine8Executable: proof(e8?.executable),
      engine10Status:
        e10JournalStatus || null,
    },
    stages,
    engineInstructions: {
      firstFailingEngine: null,
      downstreamMustWait: [],
      doNotChange: [],
    },
    warnings,
    safety,
    snapshotTime,
    generatedAt: new Date().toISOString(),
  };
}

export default buildEngine28APipelineDoctor;
