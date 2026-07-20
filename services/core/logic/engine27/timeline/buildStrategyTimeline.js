const STAGE_ORDER = Object.freeze([
  "structure",
  "location",
  "reaction",
  "participation",
  "permission",
  "geometry",
  "sizing",
  "management",
  "execution",
  "journal",
]);

const STATUS = Object.freeze({
  COMPLETE: "COMPLETE",
  ACTIVE: "ACTIVE",
  WATCHING: "WATCHING",
  WAITING: "WAITING",
  BLOCKED: "BLOCKED",
  READY: "READY",
  NOT_REQUIRED: "NOT_REQUIRED",
  NOT_ENABLED: "NOT_ENABLED",
  INVALIDATED: "INVALIDATED",
});

const APPROVED_PERMISSION_DECISIONS = new Set([
  "FAST_INTRADAY_PAPER_ALLOW",
  "PAPER_ALLOW",
]);

const IDENTITY_FIELDS = [
  "candidateId",
  "zoneId",
  "strategyId",
  "symbol",
  "direction",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function textOrNull(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeDirection(value) {
  const direction = upper(value);

  if (["LONG", "UP", "BULLISH", "BULL", "BUY"].includes(direction)) {
    return "LONG";
  }

  if (["SHORT", "DOWN", "BEARISH", "BEAR", "SELL"].includes(direction)) {
    return "SHORT";
  }

  return null;
}

function normalizeState(value) {
  const state = upper(value);
  return [
    "IDLE",
    "SETTING_UP",
    "APPROACHING",
    "ALMOST_READY",
    "READY",
    "INVALIDATED",
  ].includes(state)
    ? state
    : "IDLE";
}

function cloneReadiness(value) {
  if (!isObject(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  );
}

function emptyStage(id, label, sourceEngine, reasonCode) {
  return {
    id,
    label,
    status: STATUS.WAITING,
    headline: `${label} data unavailable`,
    detail: `${sourceEngine} has not published a usable Minute output.`,
    sourceEngine,
    reasonCodes: [reasonCode],
    updatedAt: null,
    candidateId: null,
    zoneId: null,
  };
}

function sourceTimestamp(source) {
  return (
    textOrNull(source?.updatedAt) ??
    textOrNull(source?.snapshotTime) ??
    textOrNull(source?.generatedAt) ??
    textOrNull(source?.createdAt) ??
    textOrNull(source?.asOf) ??
    null
  );
}

function readIdentity(source) {
  if (!isObject(source)) return {};

  return {
    candidateId: textOrNull(source.candidateId),
    zoneId: textOrNull(source.zoneId),
    strategyId: textOrNull(source.strategyId),
    symbol: textOrNull(source.symbol),
    direction: normalizeDirection(
      source.direction ??
        source.directionBias ??
        source.tradeDirectionBias ??
        source.expectedReactionDirection
    ),
    setupType: textOrNull(source.setupType),
    snapshotTime: sourceTimestamp(source),
  };
}

function buildIdentity({
  strategy,
  engine26A,
  engine27E,
  engine26B,
  engine7A,
  engine9,
  engine7B,
  engine8,
  engine10,
  laneId,
  strategyId,
  symbol,
  snapshotTime,
}) {
  const sources = [
    { name: "STRATEGY", value: strategy },
    { name: "ENGINE26A", value: engine26A },
    { name: "ENGINE27E", value: engine27E },
    { name: "ENGINE26B", value: engine26B },
    { name: "ENGINE7A", value: engine7A },
    { name: "ENGINE9", value: engine9 },
    { name: "ENGINE7B", value: engine7B },
    { name: "ENGINE8", value: engine8 },
    { name: "ENGINE10", value: engine10 },
  ];

  const fallback = {
    laneId: textOrNull(laneId) ?? "minute",
    strategyId: textOrNull(strategyId) ?? "intraday_scalp@10m",
    candidateId: null,
    zoneId: null,
    symbol: textOrNull(symbol),
    direction: null,
    setupType: null,
    snapshotTime: textOrNull(snapshotTime),
  };

  const chosen = { ...fallback };
  const chosenSource = {};
  const mismatches = [];

  for (const { name, value } of sources) {
    const identity = readIdentity(value);

    for (const field of [
      "candidateId",
      "zoneId",
      "strategyId",
      "symbol",
      "direction",
      "setupType",
      "snapshotTime",
    ]) {
      const nextValue = identity[field];
      if (nextValue === null || nextValue === undefined) continue;

      if (chosen[field] === null || chosen[field] === undefined) {
        chosen[field] = nextValue;
        chosenSource[field] = name;
        continue;
      }

      if (
        IDENTITY_FIELDS.includes(field) &&
        chosen[field] !== nextValue
      ) {
        mismatches.push({
          field,
          code: `${field.replace(/([A-Z])/g, "_$1").toUpperCase()}_MISMATCH`,
          canonicalValue: chosen[field],
          conflictingValue: nextValue,
          canonicalSource: chosenSource[field] ?? "INPUT",
          conflictingSource: name,
        });
      }
    }
  }

  return {
    ...chosen,
    mismatches,
    mismatchCodes: unique(mismatches.map((item) => item.code)),
  };
}

function stageIdentityMismatch(identity, source) {
  const sourceIdentity = readIdentity(source);
  const codes = [];

  for (const field of IDENTITY_FIELDS) {
    const canonical = identity[field];
    const candidate = sourceIdentity[field];

    if (canonical && candidate && canonical !== candidate) {
      codes.push(`${field.replace(/([A-Z])/g, "_$1").toUpperCase()}_MISMATCH`);
    }
  }

  return unique(codes);
}

function stageBase({ id, label, status, headline, detail, sourceEngine, reasonCodes, source, identity }) {
  return {
    id,
    label,
    status,
    headline,
    detail,
    sourceEngine,
    reasonCodes: unique(reasonCodes),
    updatedAt: sourceTimestamp(source),
    candidateId: identity?.candidateId ?? null,
    zoneId: identity?.zoneId ?? null,
  };
}

function buildStructureStage({ engine22, engine27A, identity }) {
  if (!isObject(engine22) && !isObject(engine27A)) {
    return emptyStage("structure", "Structure", "ENGINE22", "ENGINE22_OUTPUT_UNAVAILABLE");
  }

  const invalidated =
    engine22?.invalidated === true ||
    engine22?.invalidationBreached === true ||
    engine27A?.invalidated === true ||
    engine27A?.invalidationBreached === true ||
    upper(engine22?.stage) === "INVALIDATED" ||
    upper(engine27A?.stage) === "INVALIDATED";

  if (invalidated) {
    return stageBase({
      id: "structure",
      label: "Structure",
      status: STATUS.INVALIDATED,
      headline: "Minute structure invalidated",
      detail: "Engine 22 or Engine 27A reports that the Minute structure is no longer valid.",
      sourceEngine: "ENGINE22",
      reasonCodes: ["MINUTE_STRUCTURE_INVALIDATED"],
      source: engine22 ?? engine27A,
      identity,
    });
  }

  const currentWave = textOrNull(engine27A?.currentWave ?? engine22?.currentWave ?? engine22?.activeWave);
  const active = engine27A?.active === true || engine22?.active === true || ["ACTIVE", "BREAKOUT_CANDIDATE", "ACTIVE_CANDIDATE"].includes(upper(engine27A?.stage ?? engine22?.stage));

  return stageBase({
    id: "structure",
    label: "Structure",
    status: active ? STATUS.ACTIVE : STATUS.WAITING,
    headline: active
      ? `Minute ${currentWave ?? "structure"} remains active`
      : "Waiting for a valid Minute structure",
    detail: active
      ? engine27A?.currentRead ?? engine27A?.headline ?? engine22?.headline ?? "The parent Minute structure remains valid and is still developing."
      : "Engine 22 has not published an active Minute structure.",
    sourceEngine: "ENGINE22",
    reasonCodes: active
      ? ["MINUTE_STRUCTURE_ACTIVE", "STRUCTURE_NOT_INVALIDATED"]
      : ["MINUTE_STRUCTURE_NOT_ACTIVE"],
    source: engine27A ?? engine22,
    identity,
  });
}

function extractZone(engine26A) {
  const location = isObject(engine26A?.location) ? engine26A.location : {};
  const zone = isObject(location?.zone) ? location.zone : {};

  const lo = numberOrNull(
    engine26A?.zoneLow ?? engine26A?.zoneLo ?? location?.lo ?? location?.zoneLow ?? zone?.lo
  );
  const hi = numberOrNull(
    engine26A?.zoneHigh ?? engine26A?.zoneHi ?? location?.hi ?? location?.zoneHigh ?? zone?.hi
  );
  const mid =
    numberOrNull(engine26A?.zoneMid ?? location?.mid ?? location?.zoneMid ?? zone?.mid) ??
    (lo !== null && hi !== null ? Number(((lo + hi) / 2).toFixed(2)) : null);

  return { lo, hi, mid };
}

function normalizePriceLocation({ currentPrice, lo, hi, explicit }) {
  const normalized = upper(explicit);
  if (["ABOVE_ZONE", "INSIDE_ZONE", "BELOW_ZONE", "UNKNOWN"].includes(normalized)) {
    return normalized;
  }

  if (currentPrice === null || lo === null || hi === null) return "UNKNOWN";

  const lower = Math.min(lo, hi);
  const upperBound = Math.max(lo, hi);

  if (currentPrice < lower) return "BELOW_ZONE";
  if (currentPrice > upperBound) return "ABOVE_ZONE";
  return "INSIDE_ZONE";
}

function buildLocation({ engine26A, identity, currentPrice }) {
  const zone = extractZone(engine26A);
  const price = numberOrNull(currentPrice ?? engine26A?.currentPrice);
  const priceLocation = normalizePriceLocation({
    currentPrice: price,
    lo: zone.lo,
    hi: zone.hi,
    explicit: engine26A?.priceLocation ?? engine26A?.location?.priceLocation,
  });

  return {
    active: engine26A?.active === true,
    zoneId: identity.zoneId,
    source: "ENGINE26A",
    lo: zone.lo,
    hi: zone.hi,
    mid: zone.mid,
    currentPrice: price,
    priceLocation,
    distancePoints: numberOrNull(
      engine26A?.distancePoints ?? engine26A?.location?.distancePoints
    ),
    invalidationLevel: numberOrNull(
      engine26A?.invalidationLevel ??
        engine26A?.locationInvalidationBoundary ??
        engine26A?.location?.invalidationLevel
    ),
    freshnessTime:
      textOrNull(engine26A?.freshnessTime) ?? sourceTimestamp(engine26A),
  };
}

function buildLocationStage({ engine26A, identity, location }) {
  if (!isObject(engine26A)) {
    return emptyStage("location", "Location", "ENGINE26A", "ENGINE26A_OUTPUT_UNAVAILABLE");
  }

  const mismatches = stageIdentityMismatch(identity, engine26A);
  if (mismatches.length) {
    return stageBase({
      id: "location",
      label: "Location",
      status: STATUS.BLOCKED,
      headline: "Location identity mismatch",
      detail: "Engine 26A location identity conflicts with the canonical Minute identity.",
      sourceEngine: "ENGINE26A",
      reasonCodes: mismatches,
      source: engine26A,
      identity,
    });
  }

  const invalidated =
    engine26A?.invalidated === true ||
    upper(engine26A?.status).includes("INVALIDATED");

  if (invalidated) {
    return stageBase({
      id: "location",
      label: "Location",
      status: STATUS.INVALIDATED,
      headline: "Authorized location invalidated",
      detail: "Engine 26A reports that the selected Minute location is no longer valid.",
      sourceEngine: "ENGINE26A",
      reasonCodes: ["ENGINE26_LOCATION_INVALIDATED"],
      source: engine26A,
      identity,
    });
  }

  const active = engine26A.active === true;
  const status = active
    ? location.priceLocation === "INSIDE_ZONE"
      ? STATUS.ACTIVE
      : STATUS.WATCHING
    : STATUS.WAITING;

  return stageBase({
    id: "location",
    label: "Location",
    status,
    headline:
      location.priceLocation === "INSIDE_ZONE"
        ? "Price is inside the authorized zone"
        : active
        ? "Authorized Minute location is active"
        : "Waiting for an authorized Minute location",
    detail:
      location.priceLocation === "UNKNOWN"
        ? "Engine 26A detected a location, but normalized zone boundaries or price location are unavailable."
        : `Current price location: ${location.priceLocation}.`,
    sourceEngine: "ENGINE26A",
    reasonCodes: active
      ? ["ENGINE26_LOCATION_ACTIVE", `PRICE_${location.priceLocation}`]
      : ["WAITING_FOR_ENGINE26_LOCATION"],
    source: engine26A,
    identity,
  });
}

function buildReactionStage({ engine3, engine26A, engine27E, identity }) {
  if (!isObject(engine3)) {
    return emptyStage("reaction", "Reaction", "ENGINE3", "ENGINE3_OUTPUT_UNAVAILABLE");
  }

  const mismatches = stageIdentityMismatch(identity, engine3);
  if (mismatches.length) {
    return stageBase({
      id: "reaction",
      label: "Reaction",
      status: STATUS.BLOCKED,
      headline: "Reaction identity mismatch",
      detail: "Engine 3 reaction identity conflicts with the canonical Minute identity.",
      sourceEngine: "ENGINE3",
      reasonCodes: mismatches,
      source: engine3,
      identity,
    });
  }

  if (engine26A?.active !== true) {
    return stageBase({
      id: "reaction",
      label: "Reaction",
      status: STATUS.WAITING,
      headline: "Waiting for Engine 26A location",
      detail: "Engine 3 cannot validate the Minute reaction until an authorized location exists.",
      sourceEngine: "ENGINE3",
      reasonCodes: ["WAITING_FOR_ENGINE26_LOCATION"],
      source: engine3,
      identity,
    });
  }

  const hardBlocked =
    engine3?.hardBlocked === true ||
    ["REACTION_FAILED", "REACTION_INVALIDATED", "BLOCKED", "REJECTED"].includes(
      upper(engine3?.authorizedReactionState ?? engine3?.status)
    );

  if (hardBlocked) {
    return stageBase({
      id: "reaction",
      label: "Reaction",
      status: upper(engine3?.authorizedReactionState) === "REACTION_INVALIDATED"
        ? STATUS.INVALIDATED
        : STATUS.BLOCKED,
      headline: "Directional reaction failed",
      detail: "Engine 3 explicitly rejected or invalidated the authorized Minute reaction.",
      sourceEngine: "ENGINE3",
      reasonCodes: ["ENGINE3_REACTION_BLOCKED"],
      source: engine3,
      identity,
    });
  }

  const ready = engine27E?.readiness?.reactionReady === true;
  const active = engine3?.active === true;

  return stageBase({
    id: "reaction",
    label: "Reaction",
    status: ready ? STATUS.READY : active ? STATUS.WATCHING : STATUS.WAITING,
    headline: ready
      ? "Directional reaction confirmed"
      : active
      ? "Watching the authorized location for reaction"
      : "Waiting for Engine 3 reaction",
    detail: ready
      ? "Engine 27E confirms that the authorized Engine 3 reaction is usable."
      : `Engine 3 state: ${textOrNull(engine3?.authorizedReactionState ?? engine3?.state) ?? "PENDING"}.`,
    sourceEngine: "ENGINE3",
    reasonCodes: ready
      ? ["ENGINE3_DIRECTIONAL_REACTION_READY"]
      : ["ENGINE3_REACTION_PENDING"],
    source: engine3,
    identity,
  });
}

function buildParticipationStage({ engine4, engine3, engine27E, identity }) {
  if (!isObject(engine4)) {
    return emptyStage("participation", "Participation", "ENGINE4", "ENGINE4_OUTPUT_UNAVAILABLE");
  }

  const mismatches = stageIdentityMismatch(identity, engine4);
  if (mismatches.length) {
    return stageBase({
      id: "participation",
      label: "Participation",
      status: STATUS.BLOCKED,
      headline: "Participation identity mismatch",
      detail: "Engine 4 participation identity conflicts with the canonical Minute identity.",
      sourceEngine: "ENGINE4",
      reasonCodes: mismatches,
      source: engine4,
      identity,
    });
  }

  if (engine4?.hardBlocked === true) {
    return stageBase({
      id: "participation",
      label: "Participation",
      status: STATUS.BLOCKED,
      headline: "Participation hard-blocked",
      detail: "Engine 4 reports a hard participation block for the authorized reaction.",
      sourceEngine: "ENGINE4",
      reasonCodes: ["ENGINE4_HARD_BLOCK"],
      source: engine4,
      identity,
    });
  }

  const ready = engine27E?.readiness?.participationReady === true;
  const reactionReady = engine27E?.readiness?.reactionReady === true;
  const active = engine4?.active === true;

  let status = STATUS.WAITING;
  if (ready) status = STATUS.READY;
  else if (active && (reactionReady || engine3?.active === true)) status = STATUS.WATCHING;

  return stageBase({
    id: "participation",
    label: "Participation",
    status,
    headline: ready
      ? "Participation confirmed"
      : status === STATUS.WATCHING
      ? "Watching for supporting participation"
      : "Waiting for Engine 3 reaction",
    detail: ready
      ? "Engine 27E confirms that Engine 4 participation satisfies the Minute contract."
      : `Engine 4 state: ${textOrNull(engine4?.status ?? engine4?.participationState ?? engine4?.state) ?? "PENDING"}.`,
    sourceEngine: "ENGINE4",
    reasonCodes: ready
      ? ["ENGINE4_PARTICIPATION_READY"]
      : reactionReady
      ? ["ENGINE4_PARTICIPATION_PENDING"]
      : ["WAITING_FOR_ENGINE3_REACTION"],
    source: engine4,
    identity,
  });
}

function permissionDenied(engine6) {
  const decision = upper(engine6?.decision ?? engine6?.status ?? engine6?.permission);
  return (
    engine6?.hardBlocked === true ||
    engine6?.denied === true ||
    ["DENY", "DENIED", "BLOCK", "BLOCKED", "NOT_ALLOWED", "SAFETY_BLOCK", "PAPER_STAND_DOWN"].includes(decision)
  );
}

function buildPermissionStage({ engine6, engine27E, identity }) {
  if (!isObject(engine6)) {
    return emptyStage("permission", "Permission", "ENGINE6", "ENGINE6_OUTPUT_UNAVAILABLE");
  }

  const mismatches = stageIdentityMismatch(identity, engine6);
  if (mismatches.length) {
    return stageBase({
      id: "permission",
      label: "Permission",
      status: STATUS.BLOCKED,
      headline: "Permission identity mismatch",
      detail: "Engine 6 permission identity conflicts with the canonical Minute identity.",
      sourceEngine: "ENGINE6",
      reasonCodes: mismatches,
      source: engine6,
      identity,
    });
  }

  if (permissionDenied(engine6)) {
    return stageBase({
      id: "permission",
      label: "Permission",
      status: STATUS.BLOCKED,
      headline: "Engine 6 denied progression",
      detail: "Engine 6 issued an explicit denial or safety block.",
      sourceEngine: "ENGINE6",
      reasonCodes: ["ENGINE6_PERMISSION_DENIED"],
      source: engine6,
      identity,
    });
  }

  const decision = upper(engine6?.decision);
  const ready =
    engine27E?.readiness?.permissionReady === true ||
    (engine6?.allowed === true && APPROVED_PERMISSION_DECISIONS.has(decision));

  return stageBase({
    id: "permission",
    label: "Permission",
    status: ready ? STATUS.READY : STATUS.WAITING,
    headline: ready ? "Paper-lane permission ready" : "Waiting for Engine 6 permission",
    detail: `Engine 6 decision: ${decision || "PENDING"}.`,
    sourceEngine: "ENGINE6",
    reasonCodes: ready
      ? ["ENGINE6_PERMISSION_READY"]
      : ["ENGINE6_PERMISSION_PENDING"],
    source: engine6,
    identity,
  });
}

function hasTargets(value) {
  return Array.isArray(value) && value.length > 0;
}

function buildGeometryStage({ engine26B, engine27E, identity }) {
  if (!isObject(engine26B)) {
    return emptyStage("geometry", "Geometry", "ENGINE26B", "ENGINE26B_OUTPUT_UNAVAILABLE");
  }

  const mismatches = stageIdentityMismatch(identity, engine26B);
  if (mismatches.length) {
    return stageBase({
      id: "geometry",
      label: "Geometry",
      status: STATUS.BLOCKED,
      headline: "Geometry identity mismatch",
      detail: "Engine 26B geometry identity conflicts with the canonical Minute identity.",
      sourceEngine: "ENGINE26B",
      reasonCodes: mismatches,
      source: engine26B,
      identity,
    });
  }

  const lifecycle = upper(engine26B?.status ?? engine26B?.lifecycleStatus);
  const explicitFailure =
    engine26B?.valid === false ||
    engine26B?.hardBlocked === true ||
    lifecycle.includes("INVALID") ||
    lifecycle.includes("FAILED") ||
    lifecycle.includes("BLOCKED");

  if (explicitFailure) {
    return stageBase({
      id: "geometry",
      label: "Geometry",
      status: STATUS.BLOCKED,
      headline: "Planner geometry unavailable",
      detail: "Engine 26B evaluated the candidate but could not produce valid geometry.",
      sourceEngine: "ENGINE26B",
      reasonCodes: ["ENGINE26B_GEOMETRY_INVALID"],
      source: engine26B,
      identity,
    });
  }

  const completeGeometry =
    numberOrNull(engine26B?.proposedEntryPrice) !== null &&
    numberOrNull(engine26B?.proposedStopPrice) !== null &&
    hasTargets(engine26B?.proposedTargets);

  const ready =
    engine27E?.readiness?.plannerReady === true &&
    engine26B?.active === true &&
    completeGeometry;

  return stageBase({
    id: "geometry",
    label: "Geometry",
    status: ready ? STATUS.READY : STATUS.WAITING,
    headline: ready ? "Proposed trade geometry ready" : "Waiting for complete planner geometry",
    detail: ready
      ? "Engine 26B published a complete proposed entry, stop, and target contract."
      : `Engine 26B lifecycle: ${lifecycle || "PENDING"}.`,
    sourceEngine: "ENGINE26B",
    reasonCodes: ready
      ? ["ENGINE26B_GEOMETRY_READY"]
      : ["ENGINE26B_PLANNER_PENDING"],
    source: engine26B,
    identity,
  });
}

function sizingFailure(source) {
  const status = upper(source?.status);
  return (
    source?.riskLimitExceeded === true ||
    source?.hardBlocked === true ||
    status.includes("RISK_LIMIT") ||
    status.includes("INVALID") ||
    status.includes("FAILED")
  );
}

function buildSizingStage({ engine7A, engine7B, identity }) {
  if (!isObject(engine7A) && !isObject(engine7B)) {
    return emptyStage("sizing", "Sizing", "ENGINE7A", "ENGINE7_SIZING_OUTPUT_UNAVAILABLE");
  }

  const mismatches = unique([
    ...stageIdentityMismatch(identity, engine7A),
    ...stageIdentityMismatch(identity, engine7B),
  ]);

  if (mismatches.length) {
    return stageBase({
      id: "sizing",
      label: "Sizing",
      status: STATUS.BLOCKED,
      headline: "Sizing identity mismatch",
      detail: "Engine 7 sizing identity conflicts with the canonical Minute identity.",
      sourceEngine: "ENGINE7B",
      reasonCodes: mismatches,
      source: engine7B ?? engine7A,
      identity,
    });
  }

  if (sizingFailure(engine7A) || sizingFailure(engine7B)) {
    return stageBase({
      id: "sizing",
      label: "Sizing",
      status: STATUS.BLOCKED,
      headline: "Sizing failed risk validation",
      detail: "Engine 7 explicitly rejected the candidate under the risk contract.",
      sourceEngine: "ENGINE7B",
      reasonCodes: ["ENGINE7_RISK_LIMIT_EXCEEDED"],
      source: engine7B ?? engine7A,
      identity,
    });
  }

  const finalReady =
    upper(engine7B?.status) === "FINAL_SIZE_READY" &&
    engine7B?.allowed === true &&
    engine7B?.executableSizing === true &&
    Number.isInteger(Number(engine7B?.finalContracts)) &&
    Number(engine7B?.finalContracts) > 0;

  if (finalReady) {
    return stageBase({
      id: "sizing",
      label: "Sizing",
      status: STATUS.READY,
      headline: "Final position size ready",
      detail: "Engine 7B published final executable contract sizing.",
      sourceEngine: "ENGINE7B",
      reasonCodes: ["FINAL_SIZE_READY"],
      source: engine7B,
      identity,
    });
  }

  if (engine7A?.active === true) {
    return stageBase({
      id: "sizing",
      label: "Sizing",
      status: STATUS.ACTIVE,
      headline: "Preliminary size preview available",
      detail: "Engine 7A produced a preview; Engine 7B final sizing is not ready.",
      sourceEngine: "ENGINE7A",
      reasonCodes: ["ENGINE7A_PREVIEW_AVAILABLE", "ENGINE7B_FINAL_SIZE_PENDING"],
      source: engine7A,
      identity,
    });
  }

  return stageBase({
    id: "sizing",
    label: "Sizing",
    status: STATUS.WAITING,
    headline: "Waiting for sizing",
    detail: "Neither preliminary nor final Minute sizing is available.",
    sourceEngine: "ENGINE7A",
    reasonCodes: ["ENGINE7_SIZING_PENDING"],
    source: engine7B ?? engine7A,
    identity,
  });
}

function buildManagementStage({ engine9, identity }) {
  if (!isObject(engine9)) {
    return emptyStage("management", "Management Plan", "ENGINE9", "ENGINE9_OUTPUT_UNAVAILABLE");
  }

  const mismatches = stageIdentityMismatch(identity, engine9);
  if (mismatches.length) {
    return stageBase({
      id: "management",
      label: "Management Plan",
      status: STATUS.BLOCKED,
      headline: "Management-plan identity mismatch",
      detail: "Engine 9 management identity conflicts with the canonical Minute identity.",
      sourceEngine: "ENGINE9",
      reasonCodes: mismatches,
      source: engine9,
      identity,
    });
  }

  const planStatus = upper(engine9?.planStatus ?? engine9?.status);
  const explicitFailure =
    engine9?.valid === false ||
    planStatus.includes("INVALID") ||
    planStatus.includes("FAILED") ||
    planStatus.includes("BLOCKED");

  if (explicitFailure) {
    return stageBase({
      id: "management",
      label: "Management Plan",
      status: STATUS.BLOCKED,
      headline: "Official management plan invalid",
      detail: "Engine 9 evaluated the candidate but rejected the official plan.",
      sourceEngine: "ENGINE9",
      reasonCodes: ["ENGINE9_PLAN_INVALID"],
      source: engine9,
      identity,
    });
  }

  const ready =
    engine9?.official === true &&
    engine9?.managementReady === true &&
    !planStatus.includes("WAITING");

  return stageBase({
    id: "management",
    label: "Management Plan",
    status: ready ? STATUS.READY : STATUS.WAITING,
    headline: ready ? "Official management plan ready" : "Official trade plan not ready",
    detail: ready
      ? "Engine 9 published the official entry, stop, targets, and management contract."
      : `Engine 9 plan status: ${planStatus || "PENDING"}.`,
    sourceEngine: "ENGINE9",
    reasonCodes: ready ? ["ENGINE9_PLAN_READY"] : ["ENGINE9_PLAN_PENDING"],
    source: engine9,
    identity,
  });
}

function executionStatus(engine8) {
  const status = upper(engine8?.status);

  if (
    engine8?.rejected === true ||
    engine8?.safetyBlocked === true ||
    status.includes("REJECTED") ||
    status.includes("SAFETY_BLOCKED")
  ) {
    return STATUS.BLOCKED;
  }

  if (
    engine8?.filled === true ||
    ["FILLED", "OPENING_FILL_COMPLETE", "COMPLETE"].includes(status)
  ) {
    return STATUS.COMPLETE;
  }

  if (
    engine8?.submitted === true ||
    engine8?.working === true ||
    engine8?.partiallyFilled === true ||
    ["SUBMITTED", "WORKING", "PARTIALLY_FILLED"].includes(status)
  ) {
    return STATUS.ACTIVE;
  }

  if (engine8?.executable === true || ["READY", "READY_FOR_EXECUTION"].includes(status)) {
    return STATUS.READY;
  }

  return STATUS.WAITING;
}

function buildExecutionStage({ engine8, identity }) {
  if (!isObject(engine8)) {
    return emptyStage("execution", "Execution", "ENGINE8", "ENGINE8_OUTPUT_UNAVAILABLE");
  }

  const mismatches = stageIdentityMismatch(identity, engine8);
  if (mismatches.length) {
    return stageBase({
      id: "execution",
      label: "Execution",
      status: STATUS.BLOCKED,
      headline: "Execution identity mismatch",
      detail: "Engine 8 execution identity conflicts with the canonical Minute identity.",
      sourceEngine: "ENGINE8",
      reasonCodes: mismatches,
      source: engine8,
      identity,
    });
  }

  const status = executionStatus(engine8);
  const headline = {
    [STATUS.BLOCKED]: "Execution rejected or safety-blocked",
    [STATUS.COMPLETE]: "Opening execution complete",
    [STATUS.ACTIVE]: "Order is active",
    [STATUS.READY]: "Execution is ready",
    [STATUS.WAITING]: "Waiting for executable official plan",
  }[status];

  return stageBase({
    id: "execution",
    label: "Execution",
    status,
    headline,
    detail: `Engine 8 status: ${upper(engine8?.status) || "WAITING"}.`,
    sourceEngine: "ENGINE8",
    reasonCodes: [
      status === STATUS.BLOCKED
        ? "ENGINE8_EXECUTION_REJECTED"
        : status === STATUS.COMPLETE
        ? "ENGINE8_OPENING_EXECUTION_COMPLETE"
        : status === STATUS.ACTIVE
        ? "ENGINE8_ORDER_ACTIVE"
        : status === STATUS.READY
        ? "ENGINE8_EXECUTION_READY"
        : "EXECUTION_NOT_YET_AUTHORIZED",
    ],
    source: engine8,
    identity,
  });
}

function buildJournalStage({ engine10, identity }) {
  if (!isObject(engine10)) {
    return stageBase({
      id: "journal",
      label: "Journal",
      status: STATUS.WAITING,
      headline: "No trade event to record",
      detail: "Engine 10 has not published a Minute lifecycle object.",
      sourceEngine: "ENGINE10",
      reasonCodes: ["ENGINE10_OUTPUT_UNAVAILABLE", "NO_EXECUTION_EVENT"],
      source: null,
      identity,
    });
  }

  const mismatches = stageIdentityMismatch(identity, engine10);
  if (mismatches.length) {
    return stageBase({
      id: "journal",
      label: "Journal",
      status: STATUS.BLOCKED,
      headline: "Journal identity mismatch",
      detail: "Engine 10 lifecycle identity conflicts with the canonical Minute identity.",
      sourceEngine: "ENGINE10",
      reasonCodes: mismatches,
      source: engine10,
      identity,
    });
  }

  const statusText = upper(engine10?.status ?? engine10?.lifecycleStatus);
  let status = STATUS.WAITING;

  if (
    engine10?.writeFailed === true ||
    statusText.includes("FAILED") ||
    statusText.includes("ERROR") ||
    statusText.includes("INCONSISTENT")
  ) {
    status = STATUS.BLOCKED;
  } else if (
    engine10?.lifecycleComplete === true ||
    engine10?.finalExitRecorded === true ||
    ["COMPLETE", "CLOSED", "FINAL_EXIT_RECORDED"].includes(statusText)
  ) {
    status = STATUS.COMPLETE;
  } else if (
    engine10?.openingEventAccepted === true ||
    engine10?.activeLifecycle === true ||
    ["OPEN", "ACTIVE", "OPENING_EVENT_RECORDED"].includes(statusText)
  ) {
    status = STATUS.ACTIVE;
  }

  return stageBase({
    id: "journal",
    label: "Journal",
    status,
    headline:
      status === STATUS.COMPLETE
        ? "Trade lifecycle fully recorded"
        : status === STATUS.ACTIVE
        ? "Open trade lifecycle is being recorded"
        : status === STATUS.BLOCKED
        ? "Journal write failed"
        : "No trade event to record",
    detail: `Engine 10 lifecycle status: ${statusText || "WAITING"}.`,
    sourceEngine: "ENGINE10",
    reasonCodes: [
      status === STATUS.COMPLETE
        ? "ENGINE10_LIFECYCLE_COMPLETE"
        : status === STATUS.ACTIVE
        ? "ENGINE10_LIFECYCLE_ACTIVE"
        : status === STATUS.BLOCKED
        ? "ENGINE10_JOURNAL_WRITE_FAILED"
        : "NO_EXECUTION_EVENT",
    ],
    source: engine10,
    identity,
  });
}

function buildLevels({ engine26A, engine26B, engine9, engine27A, engine27B, currentPrice }) {
  const zone = extractZone(engine26A);

  return {
    currentPrice: numberOrNull(currentPrice),
    zoneLow: zone.lo,
    zoneHigh: zone.hi,
    zoneMid: zone.mid,
    invalidation: numberOrNull(
      engine26A?.invalidationLevel ??
        engine26A?.locationInvalidationBoundary ??
        engine27A?.invalidationLevel
    ),
    proposedEntry: numberOrNull(engine26B?.proposedEntryPrice),
    proposedStop: numberOrNull(engine26B?.proposedStopPrice),
    proposedTargets: safeArray(engine26B?.proposedTargets),
    officialEntry: numberOrNull(engine9?.officialEntryPrice),
    officialStop: numberOrNull(engine9?.officialStopPrice),
    officialTargets: safeArray(engine9?.officialTargets),
    nextFib: textOrNull(engine27B?.nextFib),
    nextFibPrice: numberOrNull(engine27B?.nextPrice),
  };
}

function missingSourceWarnings(sources) {
  const mapping = [
    ["engine22", "ENGINE22_OUTPUT_UNAVAILABLE"],
    ["engine26A", "ENGINE26A_OUTPUT_UNAVAILABLE"],
    ["engine3", "ENGINE3_OUTPUT_UNAVAILABLE"],
    ["engine4", "ENGINE4_OUTPUT_UNAVAILABLE"],
    ["engine6", "ENGINE6_OUTPUT_UNAVAILABLE"],
    ["engine26B", "ENGINE26B_OUTPUT_UNAVAILABLE"],
    ["engine27E", "ENGINE27E_DECISION_UNAVAILABLE"],
    ["engine7A", "ENGINE7A_OUTPUT_UNAVAILABLE"],
    ["engine9", "ENGINE9_OUTPUT_UNAVAILABLE"],
    ["engine7B", "ENGINE7B_OUTPUT_UNAVAILABLE"],
    ["engine8", "ENGINE8_OUTPUT_UNAVAILABLE"],
    ["engine10", "ENGINE10_OUTPUT_UNAVAILABLE"],
  ];

  return mapping
    .filter(([key]) => !isObject(sources[key]))
    .map(([, code]) => code);
}

export function buildStrategyTimeline({
  laneId = "minute",
  strategyId = "intraday_scalp@10m",
  strategy = null,
  symbol = null,
  snapshotTime = null,
  currentPrice = null,
  engine22 = null,
  engine26A = null,
  engine3 = null,
  engine4 = null,
  engine6 = null,
  engine26B = null,
  engine27A = null,
  engine27B = null,
  engine27E = null,
  engine7A = null,
  engine9 = null,
  engine7B = null,
  engine8 = null,
  engine10 = null,
} = {}) {
  const identity = buildIdentity({
    strategy,
    engine26A,
    engine27E,
    engine26B,
    engine7A,
    engine9,
    engine7B,
    engine8,
    engine10,
    laneId,
    strategyId,
    symbol,
    snapshotTime,
  });

  const normalizedCurrentPrice =
    numberOrNull(currentPrice) ??
    numberOrNull(strategy?.currentPrice) ??
    numberOrNull(engine26A?.currentPrice) ??
    numberOrNull(engine27E?.currentPrice) ??
    numberOrNull(engine27B?.currentPrice) ??
    null;

  const normalizedSnapshotTime =
    textOrNull(strategy?.snapshotTime) ??
    textOrNull(snapshotTime) ??
    textOrNull(engine27E?.snapshotTime) ??
    identity.snapshotTime ??
    null;

  const location = buildLocation({
    engine26A,
    identity,
    currentPrice: normalizedCurrentPrice,
  });

  const stages = [
    buildStructureStage({ engine22, engine27A, identity }),
    buildLocationStage({ engine26A, identity, location }),
    buildReactionStage({ engine3, engine26A, engine27E, identity }),
    buildParticipationStage({ engine4, engine3, engine27E, identity }),
    buildPermissionStage({ engine6, engine27E, identity }),
    buildGeometryStage({ engine26B, engine27E, identity }),
    buildSizingStage({ engine7A, engine7B, identity }),
    buildManagementStage({ engine9, identity }),
    buildExecutionStage({ engine8, identity }),
    buildJournalStage({ engine10, identity }),
  ];

  const stageBlockers = stages
    .filter((stage) => stage.status === STATUS.BLOCKED || stage.status === STATUS.INVALIDATED)
    .flatMap((stage) => stage.reasonCodes);

  const unavailableWarnings = missingSourceWarnings({
    engine22,
    engine26A,
    engine3,
    engine4,
    engine6,
    engine26B,
    engine27E,
    engine7A,
    engine9,
    engine7B,
    engine8,
    engine10,
  });

  const executable = engine8?.executable === true;
  const noExecution =
    typeof engine8?.noExecution === "boolean"
      ? engine8.noExecution
      : executable !== true;

  return {
    laneId: identity.laneId,
    strategyId: identity.strategyId,
    displayName: "Minute",
    triggerTimeframe: "10m",
    contextTimeframe: "1h",
    snapshotTime: normalizedSnapshotTime,

    candidateId: identity.candidateId,
    zoneId: identity.zoneId,
    symbol: identity.symbol,
    direction:
      identity.direction ??
      normalizeDirection(engine27E?.direction) ??
      normalizeDirection(engine27A?.preferredTradeDirection) ??
      null,
    setupType: identity.setupType,

    state: normalizeState(engine27E?.decisionState ?? engine27E?.state),
    readiness: cloneReadiness(engine27E?.readiness),
    currentWave: textOrNull(engine27E?.currentWave ?? engine27A?.currentWave),
    internalWave: textOrNull(engine27E?.internalWave ?? engine27A?.internalWave),
    currentPrice: normalizedCurrentPrice,

    location,
    stages,

    waitingFor: unique(safeArray(engine27E?.waitingFor)),
    blockers: unique([
      ...safeArray(engine27E?.blockers),
      ...identity.mismatchCodes,
      ...stageBlockers,
    ]),
    warnings: unique([
      ...safeArray(engine27E?.warnings),
      ...identity.mismatchCodes,
      ...unavailableWarnings,
      engine6?.paperOnly === true || engine6?.mode === "PAPER_ONLY" ? "PAPER_ONLY" : null,
      engine6?.realExecutionAllowed === false ? "REAL_EXECUTION_DISABLED" : null,
    ]),
    nextAction: textOrNull(engine27E?.recommendedAction),
    levels: buildLevels({
      engine26A,
      engine26B,
      engine9,
      engine27A,
      engine27B,
      currentPrice: normalizedCurrentPrice,
    }),

    executable,
    noExecution,
  };
}

export { STAGE_ORDER, STATUS };
export default buildStrategyTimeline;
