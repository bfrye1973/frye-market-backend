// services/core/logic/engine3/engine26Strategy1Reaction.js
//
// Engine 3 Strategy 1 reaction interpreter.
// Strategy: NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION
//
// Contract:
// - Consumes Engine 26A engine26ReactionHandoff.
// - Preserves Engine 26A identity exactly.
// - Interprets reaction facts only.
// - Does not create permission, sizing, management, execution, order, fill, or journal authority.

const ENGINE = "engine3.strategy1Reaction.v1";
const SOURCE = "engine26ReactionHandoff";
const SETUP_CLASS = "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";
const REACTION_CONTRACT_VERSION = "engine3.strategy1.v1";

const DEFAULT_EXPECTED_REACTIONS = [
  "HELD_LEVEL",
  "RECLAIMED_LEVEL",
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "SELLERS_TRAPPED",
  "BREAKOUT_HOLDING",
];

function safeUpper(value, fallback = "NONE") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function uniqueReasonCodes(reasonCodes = []) {
  return [...new Set(reasonCodes.filter(Boolean))];
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeZone(zone) {
  if (!zone || typeof zone !== "object") return null;

  const lo = toNum(
    zone.lo ??
      zone.low ??
      zone.from ??
      zone.lower ??
      zone.bottom
  );

  const hi = toNum(
    zone.hi ??
      zone.high ??
      zone.to ??
      zone.upper ??
      zone.top
  );

  if (lo == null || hi == null) return null;

  const low = Math.min(lo, hi);
  const high = Math.max(lo, hi);

  return {
    ...zone,
    lo: low,
    hi: high,
    mid:
      toNum(zone.mid ?? zone.midline) ??
      round2((low + high) / 2),
  };
}

function copyIdentity(handoff = {}) {
  return {
    laneId: handoff.laneId || null,
    strategyId: handoff.strategyId || null,
    candidateId: handoff.candidateId || null,
    zoneId: handoff.zoneId || null,
    symbol: handoff.symbol || null,
    setupClass: handoff.setupClass || SETUP_CLASS,
    setupGrade: handoff.setupGrade || null,
    identitySetupKey: handoff.identitySetupKey || null,
    candidateIdentityVersion:
      handoff.candidateIdentityVersion || null,
  };
}

function hasValidIdentity(identity) {
  return Boolean(
    identity.laneId &&
      identity.strategyId &&
      identity.candidateId &&
      identity.zoneId &&
      identity.symbol &&
      identity.setupClass &&
      identity.identitySetupKey &&
      identity.candidateIdentityVersion
  );
}

function getExpectedReactions(handoff = {}) {
  const expected =
    asArray(handoff.expectedReactions).length > 0
      ? asArray(handoff.expectedReactions)
      : asArray(handoff.authorizedExpectedReactions).length > 0
      ? asArray(handoff.authorizedExpectedReactions)
      : DEFAULT_EXPECTED_REACTIONS;

  return expected.map((item) => safeUpper(item)).filter(Boolean);
}

function getCurrentPrice(handoff = {}) {
  return (
    toNum(handoff.currentPrice) ??
    toNum(handoff?.reactionFacts?.currentPrice) ??
    toNum(handoff?.snapshot?.currentPrice) ??
    null
  );
}

function getCompletedCloseFacts(handoff = {}) {
  const reclaimFacts = handoff.reclaimFacts || {};
  const postReclaimFacts = handoff.postReclaimFacts || {};
  const lowerWickFacts = handoff.lowerWickFacts || {};

  const completedClose =
    toNum(reclaimFacts.completedClose) ??
    toNum(reclaimFacts.latestCompletedClose) ??
    toNum(postReclaimFacts.latestCompletedClose) ??
    toNum(lowerWickFacts.completedClose) ??
    null;

  const completedCloseCountAboveZoneLow = Number(
    postReclaimFacts.completedCloseCountAboveZoneLow ??
      reclaimFacts.completedCloseCountAboveZoneLow ??
      0
  );

  const consecutiveCompletedClosesAboveZoneLow = Number(
    postReclaimFacts.consecutiveCompletedClosesAboveZoneLow ??
      reclaimFacts.consecutiveCompletedClosesAboveZoneLow ??
      completedCloseCountAboveZoneLow
  );

  const lowestPriceSinceLatestReclaim =
    toNum(postReclaimFacts.lowestPriceSinceLatestReclaim) ??
    toNum(reclaimFacts.lowestPriceSinceLatestReclaim) ??
    null;

  return {
    completedClose,
    completedCloseCountAboveZoneLow,
    consecutiveCompletedClosesAboveZoneLow,
    lowestPriceSinceLatestReclaim,
  };
}

function buildInactive({
  handoff = null,
  reactionState,
  reasonCodes = [],
  reactionConfirmed = false,
  evaluationAuthorized = false,
  identityOverride = null,
}) {
  const identity = identityOverride || copyIdentity(handoff || {});

  return {
    active: false,
    engine: ENGINE,
    source: SOURCE,
    reactionContractVersion: REACTION_CONTRACT_VERSION,

    ...identity,

    evaluationAuthorized: evaluationAuthorized === true,
    reactionConfirmed: reactionConfirmed === true,

    authorized: evaluationAuthorized === true,
    authorizeEngine3Evaluation: evaluationAuthorized === true,

    allowed: false,
    confirmed: false,

    state: reactionState,
    status: reactionState,
    reactionState,
    authorizedReactionState: reactionState,

    quality: "WEAK",
    direction: "NEUTRAL",
    tradeDirectionBias: safeUpper(
      handoff?.tradeDirectionBias,
      "NONE"
    ),

    expectedReactions: getExpectedReactions(handoff || {}),

    entryZone: normalizeZone(handoff?.entryZone),
    targetZone: normalizeZone(handoff?.targetZone),

    locationInvalidationBoundary:
      toNum(handoff?.locationInvalidationBoundary) ??
      toNum(handoff?.invalidationLevel) ??
      null,

    currentPrice: getCurrentPrice(handoff || {}),

    sweepObserved: false,
    wickObserved: false,
    reclaimObserved: false,
    holdConfirmed: false,
    invalidated: reactionState === "REACTION_INVALIDATED",

    blockers: [],

    reasonCodes: uniqueReasonCodes([
      reactionState,
      ...reasonCodes,
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ]),

    requiresEngine6PaperApproval: true,
    realExecutionAuthority: false,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,
  };
}

function validateIdentity({ handoff, expectedIdentity = null }) {
  const identity = copyIdentity(handoff || {});

  if (!hasValidIdentity(identity)) {
    return {
      ok: false,
      identity,
      reason: "ENGINE26_REACTION_HANDOFF_IDENTITY_MISSING",
    };
  }

  if (expectedIdentity && typeof expectedIdentity === "object") {
    const expectedCandidateId = expectedIdentity.candidateId || null;
    const expectedZoneId = expectedIdentity.zoneId || null;

    if (
      (expectedCandidateId &&
        identity.candidateId !== expectedCandidateId) ||
      (expectedZoneId && identity.zoneId !== expectedZoneId)
    ) {
      return {
        ok: false,
        identity,
        reason: "ENGINE26_REACTION_HANDOFF_IDENTITY_MISMATCH",
      };
    }
  }

  return { ok: true, identity, reason: null };
}

function inferFactBooleans({ handoff, entryZone }) {
  const sweepFacts = handoff.sweepFacts || {};
  const lowerWickFacts = handoff.lowerWickFacts || {};
  const reclaimFacts = handoff.reclaimFacts || {};
  const postReclaimFacts = handoff.postReclaimFacts || {};
  const invalidationFacts = handoff.invalidationFacts || {};
  const closeFacts = getCompletedCloseFacts(handoff);

  const intrabarSweepObserved =
    sweepFacts.intrabarSweepObserved === true ||
    sweepFacts.sweepObserved === true ||
    lowerWickFacts.lowerWickBelowZoneObserved === true;

  const meaningfulLowerWick =
    lowerWickFacts.lowerWickBelowZoneObserved === true &&
    Number(lowerWickFacts.lowerWickToBodyRatio ?? 0) >= 2;

  const closedInsideZone =
    lowerWickFacts.closedInsideZone === true ||
    reclaimFacts.closedInsideZone === true ||
    (entryZone &&
      closeFacts.completedClose != null &&
      closeFacts.completedClose >= entryZone.lo &&
      closeFacts.completedClose <= entryZone.hi);

  const closedAboveZoneLow =
    lowerWickFacts.closedAboveZone === true ||
    lowerWickFacts.closedAboveZoneLow === true ||
    reclaimFacts.closedAboveZoneLow === true ||
    reclaimFacts.completedCloseAboveZoneLow === true ||
    (entryZone &&
      closeFacts.completedClose != null &&
      closeFacts.completedClose >= entryZone.lo);

  const closedAboveMidline =
    reclaimFacts.closedAboveMidline === true ||
    reclaimFacts.completedCloseAboveMidline === true ||
    (entryZone &&
      closeFacts.completedClose != null &&
      entryZone.mid != null &&
      closeFacts.completedClose >= entryZone.mid);

  const closedAboveZoneHigh =
    reclaimFacts.closedAboveZoneHigh === true ||
    reclaimFacts.completedCloseAboveZoneHigh === true ||
    (entryZone &&
      closeFacts.completedClose != null &&
      closeFacts.completedClose >= entryZone.hi);

  const reclaimObserved =
    reclaimFacts.reclaimObserved === true ||
    reclaimFacts.completedReclaimObserved === true ||
    (intrabarSweepObserved && closedAboveZoneLow);

  const oneHoldClose =
    postReclaimFacts.holdObserved === true ||
    postReclaimFacts.reclaimHoldObserved === true ||
    closeFacts.completedCloseCountAboveZoneLow >= 1 ||
    closeFacts.consecutiveCompletedClosesAboveZoneLow >= 1;

  const twoHoldCloses =
    closeFacts.consecutiveCompletedClosesAboveZoneLow >= 2 ||
    postReclaimFacts.twoConsecutiveClosesAboveZoneLow === true;

  const completedCloseInvalidationConfirmed =
    invalidationFacts.completedCloseInvalidationConfirmed === true;

  const intrabarInvalidationBreach =
    invalidationFacts.intrabarInvalidationBreach === true ||
    invalidationFacts.intrabarInvalidationObserved === true;

  const lowestRemainedAboveBoundary =
    handoff.locationInvalidationBoundary == null ||
    closeFacts.lowestPriceSinceLatestReclaim == null
      ? true
      : closeFacts.lowestPriceSinceLatestReclaim >=
        Number(handoff.locationInvalidationBoundary);

  return {
    intrabarSweepObserved,
    meaningfulLowerWick,
    closedInsideZone,
    closedAboveZoneLow,
    closedAboveMidline,
    closedAboveZoneHigh,
    reclaimObserved,
    oneHoldClose,
    twoHoldCloses,
    completedCloseInvalidationConfirmed,
    intrabarInvalidationBreach,
    lowestRemainedAboveBoundary,
  };
}

function deriveObservedReaction({ facts }) {
  if (facts.closedAboveZoneHigh) return "BREAKOUT_HOLDING";
  if (facts.closedAboveMidline && facts.reclaimObserved) {
    return "RECLAIMED_LEVEL";
  }
  if (facts.meaningfulLowerWick && facts.reclaimObserved) {
    return "WICK_BELOW_AND_RECLAIM";
  }
  if (facts.reclaimObserved) return "RECLAIMED_LEVEL";
  if (facts.meaningfulLowerWick) return "WICK_RECLAIM_OBSERVED";
  if (facts.intrabarSweepObserved) return "SWEEP_OBSERVED";

  return "WAITING_FOR_ZONE_INTERACTION";
}

function isExpected({ observedReaction, expectedReactions }) {
  if (!observedReaction) return false;
  if (expectedReactions.includes(observedReaction)) return true;

  if (
    observedReaction === "WICK_RECLAIM_OBSERVED" &&
    expectedReactions.includes("WICK_BELOW_AND_RECLAIM")
  ) {
    return true;
  }

  if (
    observedReaction === "RECLAIMED_LEVEL" &&
    expectedReactions.includes("HELD_LEVEL")
  ) {
    return true;
  }

  return false;
}

function qualityFor({
  reactionState,
  facts,
  expectedMatch,
  intrabarDowngrade,
}) {
  if (
    reactionState === "WAITING_FOR_ZONE_INTERACTION" ||
    reactionState === "SWEEP_OBSERVED"
  ) {
    return "WEAK";
  }

  if (reactionState === "REACTION_INVALIDATED") return "WEAK";
  if (intrabarDowngrade) return "WEAK";
  if (!expectedMatch) return "WEAK";

  if (
    facts.closedAboveZoneHigh ||
    (facts.reclaimObserved &&
      facts.oneHoldClose &&
      facts.closedAboveMidline &&
      facts.lowestRemainedAboveBoundary)
  ) {
    return "STRONG";
  }

  if (
    facts.reclaimObserved ||
    facts.meaningfulLowerWick ||
    facts.closedAboveZoneLow
  ) {
    return "GOOD";
  }

  return "WEAK";
}

export function buildEngine26Strategy1Reaction({
  engine26ReactionHandoff = null,
  expectedIdentity = null,
} = {}) {
  const handoff = engine26ReactionHandoff || null;

  if (!handoff || typeof handoff !== "object" || handoff.active !== true) {
    return buildInactive({
      handoff,
      reactionState: "WAITING_FOR_ENGINE26_LOCATION",
      reasonCodes: ["ENGINE26_REACTION_HANDOFF_MISSING_OR_INACTIVE"],
      evaluationAuthorized: false,
    });
  }

  const identityCheck = validateIdentity({
    handoff,
    expectedIdentity,
  });

  if (!identityCheck.ok) {
    return buildInactive({
      handoff,
      reactionState: "WAITING_FOR_VALID_ENGINE26_IDENTITY",
      reasonCodes: [identityCheck.reason],
      evaluationAuthorized: false,
      identityOverride: identityCheck.identity,
    });
  }

  const identity = identityCheck.identity;

  const evaluationAuthorized =
    handoff.evaluationAuthorized === true ||
    handoff.authorizeEngine3Evaluation === true ||
    handoff.authorized === true;

  if (!evaluationAuthorized) {
    return buildInactive({
      handoff,
      reactionState: "WAITING_FOR_ENGINE26_LOCATION",
      reasonCodes: ["ENGINE26_DID_NOT_AUTHORIZE_ENGINE3_EVALUATION"],
      evaluationAuthorized: false,
      identityOverride: identity,
    });
  }

  const entryZone = normalizeZone(handoff.entryZone);
  const targetZone = normalizeZone(handoff.targetZone);
  const expectedReactions = getExpectedReactions(handoff);
  const facts = inferFactBooleans({ handoff, entryZone });

  if (facts.completedCloseInvalidationConfirmed) {
    return {
      ...buildInactive({
        handoff,
        reactionState: "REACTION_INVALIDATED",
        reasonCodes: [
          "COMPLETED_CLOSE_INVALIDATION_CONFIRMED",
          "REACTION_INVALIDATED",
        ],
        evaluationAuthorized: true,
        identityOverride: identity,
      }),
      entryZone,
      targetZone,
      invalidated: true,
    };
  }

  const observedReaction = deriveObservedReaction({ facts });
  const expectedMatch = isExpected({
    observedReaction,
    expectedReactions,
  });

  let reactionState = observedReaction;
  let authorizedReactionState = "WATCHING_AUTHORIZED_LOCATION";
  let reactionConfirmed = false;

  if (observedReaction === "WAITING_FOR_ZONE_INTERACTION") {
    authorizedReactionState = "WATCHING_AUTHORIZED_LOCATION";
  } else if (observedReaction === "SWEEP_OBSERVED") {
    reactionState = "SWEEP_OBSERVED";
    authorizedReactionState = "SWEEP_OBSERVED";
  } else if (!expectedMatch) {
    reactionState = "REACTION_FAILED";
    authorizedReactionState = "REACTION_FAILED";
  } else if (
    facts.reclaimObserved &&
    !facts.oneHoldClose &&
    !facts.closedAboveMidline
  ) {
    reactionState = "RECLAIM_OBSERVED";
    authorizedReactionState = "RECLAIM_HOLD_DEVELOPING";
  } else if (
    facts.reclaimObserved &&
    facts.oneHoldClose &&
    !facts.closedAboveMidline
  ) {
    reactionState = "RECLAIM_HOLD_DEVELOPING";
    authorizedReactionState = "RECLAIM_HOLD_DEVELOPING";
  } else if (
    expectedMatch &&
    facts.reclaimObserved &&
    (facts.twoHoldCloses ||
      facts.closedAboveMidline ||
      facts.closedAboveZoneHigh) &&
    facts.lowestRemainedAboveBoundary
  ) {
    reactionState = "REACTION_CONFIRMED";
    authorizedReactionState = "REACTION_CONFIRMED";
    reactionConfirmed = true;
  } else if (observedReaction === "WICK_RECLAIM_OBSERVED") {
    reactionState = "WICK_RECLAIM_OBSERVED";
    authorizedReactionState = "WICK_RECLAIM_OBSERVED";
  }

  const intrabarDowngrade =
    facts.intrabarInvalidationBreach === true;

  const quality = qualityFor({
    reactionState,
    facts,
    expectedMatch,
    intrabarDowngrade,
  });

  const direction =
    safeUpper(handoff.tradeDirectionBias, "LONG") === "SHORT"
      ? "SHORT"
      : "LONG";

  const blockers = [
    !expectedMatch &&
    observedReaction !== "WAITING_FOR_ZONE_INTERACTION" &&
    observedReaction !== "SWEEP_OBSERVED"
      ? "REACTION_NOT_IN_AUTHORIZED_EXPECTED_SET"
      : null,

    intrabarDowngrade
      ? "INTRABAR_INVALIDATION_BREACH_QUALITY_DOWNGRADE"
      : null,
  ].filter(Boolean);

  const active = reactionState !== "REACTION_INVALIDATED";

  return {
    active,
    engine: ENGINE,
    source: SOURCE,
    reactionContractVersion: REACTION_CONTRACT_VERSION,

    ...identity,

    evaluationAuthorized: true,
    reactionConfirmed,

    authorized: true,
    authorizeEngine3Evaluation: true,

    allowed: reactionConfirmed,
    confirmed: reactionConfirmed,

    state: reactionState,
    status: reactionState,
    reactionState,
    authorizedReactionState,

    quality,
    direction,

    tradeDirectionBias: safeUpper(
      handoff.tradeDirectionBias,
      direction
    ),

    setupType: handoff.setupType || SETUP_CLASS,
    setupClass: identity.setupClass || SETUP_CLASS,
    setupGrade: identity.setupGrade,

    expectedReactions,
    observedReaction,

    entryZone,
    targetZone,

    locationInvalidationBoundary:
      toNum(handoff.locationInvalidationBoundary) ??
      toNum(handoff.invalidationLevel) ??
      null,

    currentPrice: getCurrentPrice(handoff),

    sweepObserved: facts.intrabarSweepObserved,
    wickObserved: facts.meaningfulLowerWick,
    reclaimObserved: facts.reclaimObserved,
    holdConfirmed: reactionConfirmed,
    invalidated: false,

    sweepFacts: handoff.sweepFacts || null,
    lowerWickFacts: handoff.lowerWickFacts || null,
    reclaimFacts: handoff.reclaimFacts || null,
    postReclaimFacts: handoff.postReclaimFacts || null,
    invalidationFacts: handoff.invalidationFacts || null,
    zoneMemorySummary: handoff.zoneMemorySummary || null,

    lastCandle: handoff.lastCandle || null,
    priorCandle: handoff.priorCandle || null,

    blockers,

    reasonCodes: uniqueReasonCodes([
      "ENGINE26_REACTION_HANDOFF_CONSUMED",
      "CANDIDATE_IDENTITY_PRESERVED",
      "ZONE_IDENTITY_PRESERVED",
      "ENGINE3_STRATEGY1_REACTION_INTERPRETED",
      reactionState,
      authorizedReactionState,
      observedReaction ? `OBSERVED_${observedReaction}` : null,
      expectedMatch ? "OBSERVED_REACTION_IN_EXPECTED_SET" : null,
      facts.intrabarSweepObserved ? "SWEEP_OBSERVED" : null,
      facts.meaningfulLowerWick
        ? "MEANINGFUL_LOWER_WICK_OBSERVED"
        : null,
      facts.reclaimObserved ? "RECLAIM_OBSERVED" : null,
      facts.oneHoldClose ? "RECLAIM_HOLD_DEVELOPING" : null,
      facts.closedAboveMidline ? "MIDLINE_RECOVERY_OBSERVED" : null,
      intrabarDowngrade
        ? "INTRABAR_INVALIDATION_BREACH_QUALITY_DOWNGRADE"
        : null,
      reactionConfirmed
        ? "REACTION_CONFIRMED"
        : "REACTION_NOT_CONFIRMED",
      ...blockers,
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
      "ENGINE6_FINAL_PAPER_APPROVAL_REQUIRED",
    ]),

    requiresEngine6PaperApproval: true,
    realExecutionAuthority: false,
    noRealPermissionCreated: true,
    noPermissionCreated: true,
    noExecution: true,
  };
}

export default buildEngine26Strategy1Reaction;
