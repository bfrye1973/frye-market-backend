// services/core/logic/engine26/manualPaperSignalInjector.js

import { buildTradeGeometry } from "./tradeGeometryReader.js";

const PERMISSION_MODES = Object.freeze({
  OBSERVE_ENGINE6_ONLY: "OBSERVE_ENGINE6_ONLY",
  REQUIRE_ENGINE6_APPROVAL: "REQUIRE_ENGINE6_APPROVAL",
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function normalizeDirection(direction) {
  if (!direction) return null;
  return String(direction).trim().toUpperCase();
}

function extractEngine6Evidence(engine6 = null) {
  if (!engine6 || typeof engine6 !== "object") return null;

  const decision =
    engine6.paperDecision ||
    engine6.decision ||
    engine6.status ||
    engine6.paperState ||
    null;

  const allowed =
    engine6.paperAllowed === true ||
    engine6.allowed === true ||
    decision === "PAPER_ALLOW";

  const direction =
    engine6.direction ||
    engine6.paperDirection ||
    engine6.biasDirection ||
    null;

  const reasonCodes = [
    ...asArray(engine6.reasonCodes),
    ...asArray(engine6.blockers),
    ...asArray(engine6.paperBlockers),
  ];

  return {
    decision,
    allowed,
    direction,
    reasonCodes,
  };
}

function isEngine6PaperAllowed(engine6 = null) {
  if (!engine6 || typeof engine6 !== "object") return false;

  return (
    engine6.paperAllowed === true ||
    engine6.allowed === true ||
    engine6.paperDecision === "PAPER_ALLOW" ||
    engine6.decision === "PAPER_ALLOW" ||
    engine6.status === "PAPER_ALLOW"
  );
}

function shouldCreatePaperTrialFromPermissionMode({
  permissionMode = PERMISSION_MODES.OBSERVE_ENGINE6_ONLY,
  engine6 = null,
} = {}) {
  const engine6Allowed = isEngine6PaperAllowed(engine6);
  const engine6WouldBlock = !engine6Allowed;

  if (permissionMode === PERMISSION_MODES.OBSERVE_ENGINE6_ONLY) {
    return {
      createPaperTrial: true,
      status: "MANUAL_PAPER_SIGNAL_ACCEPTED_OBSERVE_ENGINE6_ONLY",
      engine6Allowed,
      engine6WouldBlock,
      invalidReason: null,
      reasonCodes: engine6WouldBlock
        ? ["ENGINE6_OBSERVED_ONLY_BYPASSED_FOR_RESEARCH"]
        : ["ENGINE6_OBSERVED_ALLOWED"],
    };
  }

  if (permissionMode === PERMISSION_MODES.REQUIRE_ENGINE6_APPROVAL) {
    if (engine6Allowed) {
      return {
        createPaperTrial: true,
        status: "MANUAL_PAPER_SIGNAL_ACCEPTED_ENGINE6_APPROVED",
        engine6Allowed: true,
        engine6WouldBlock: false,
        invalidReason: null,
        reasonCodes: ["ENGINE6_APPROVED_PAPER_SIGNAL"],
      };
    }

    return {
      createPaperTrial: false,
      status: "MANUAL_PAPER_SIGNAL_REJECTED_BY_ENGINE6",
      engine6Allowed: false,
      engine6WouldBlock: true,
      invalidReason: "ENGINE6_DID_NOT_APPROVE",
      reasonCodes: ["ENGINE6_REQUIRED_APPROVAL_MISSING"],
    };
  }

  return {
    createPaperTrial: false,
    status: "MANUAL_PAPER_SIGNAL_INVALID_PERMISSION_MODE",
    engine6Allowed,
    engine6WouldBlock,
    invalidReason: "INVALID_PERMISSION_MODE",
    reasonCodes: ["INVALID_PERMISSION_MODE"],
  };
}

function buildManualPaperSignal(input = {}) {
  const nowUtc = new Date().toISOString();

  const {
    symbol = "ES",
    strategyId = "intraday_scalp@10m",
    direction,
    entryPrice,
    stopPrice,
    targets,
    permissionMode = PERMISSION_MODES.OBSERVE_ENGINE6_ONLY,
    engine6 = null,
    requestedBy = "BRIAN_MANUAL_TEST",
    source = "BRIAN_MANUAL_TEST",
    note = null,
  } = input;

  const normalizedDirection = normalizeDirection(direction);

  const geometry = buildTradeGeometry({
    symbol,
    strategyId,
    direction: normalizedDirection,
    entryPrice,
    stopPrice,
    targets,
  });

  const permissionDecision = shouldCreatePaperTrialFromPermissionMode({
    permissionMode,
    engine6,
  });

  const engine6Evidence = extractEngine6Evidence(engine6);

  const active = geometry.valid === true && permissionDecision.createPaperTrial === true;

  return {
    active,
    signalType: "ENGINE26_MANUAL_PAPER_SIGNAL",
    source,
    requestedBy,

    symbol,
    strategyId,
    direction: normalizedDirection,
    requestedEntryPrice: entryPrice,
    requestedStopPrice: stopPrice,
    requestedTargets: Array.isArray(targets) ? targets : [],

    permissionMode,

    paperOnly: true,
    researchOnly: true,
    manualTest: true,
    noExecution: true,
    noBrokerOrder: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,

    engine6ObservedOnly:
      permissionMode === PERMISSION_MODES.OBSERVE_ENGINE6_ONLY,

    engine6BypassedForResearchOnly:
      permissionMode === PERMISSION_MODES.OBSERVE_ENGINE6_ONLY &&
      permissionDecision.engine6WouldBlock === true,

    geometry,
    engine6Evidence,
    permissionDecision,

    status: geometry.valid
      ? permissionDecision.status
      : "INVALID_GEOMETRY",

    invalidReason: geometry.valid
      ? permissionDecision.invalidReason
      : geometry.invalidReason,

    reasonCodes: [
      ...(geometry.reasonCodes || []),
      ...(permissionDecision.reasonCodes || []),
    ],

    note,

    createdAtUtc: nowUtc,
    updatedAtUtc: nowUtc,
  };
}

export {
  PERMISSION_MODES,
  buildManualPaperSignal,
  shouldCreatePaperTrialFromPermissionMode,
};
