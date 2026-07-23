const REQUIRED_SYMBOL = "ES";
const REQUIRED_LANE_ID = "minute";
const REQUIRED_STRATEGY_ID = "intraday_scalp@10m";
const REQUIRED_SETUP_CLASS = "NEGOTIATED_ZONE_SWEEP_RECLAIM_ROTATION";
const COMPATIBLE_IDENTITY_PREFIX = "engine26.strategy1.";

function text(value) {
  const v = String(value ?? "").trim();
  return v || null;
}

function upper(value) {
  const v = text(value);
  return v ? v.toUpperCase() : null;
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstText(...values) {
  for (const value of values) {
    const v = text(value);
    if (v) return v;
  }
  return null;
}

function firstUpper(...values) {
  const v = firstText(...values);
  return v ? v.toUpperCase() : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = num(value);
    if (n !== null) return n;
  }
  return null;
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function allPresentAndSame(...values) {
  const populated = values.filter(Boolean);
  if (populated.length !== values.length) return false;
  return populated.every((value) => value === populated[0]);
}

function metadataMatchOrMissing({
  ownerValue,
  engine3Value,
  engine4Value,
  fieldName,
}) {
  const blockers = [];
  const reasonCodes = [];

  if (!ownerValue) {
    blockers.push(`ENGINE26A_${fieldName}_MISSING`);
    return {
      valid: false,
      blockers,
      reasonCodes,
    };
  }

  if (!engine3Value) {
    reasonCodes.push(`ENGINE3_${fieldName}_NOT_REPEATED`);
  } else if (engine3Value !== ownerValue) {
    blockers.push(`ENGINE3_${fieldName}_CONFLICT`);
  }

  if (!engine4Value) {
    reasonCodes.push(`ENGINE4_${fieldName}_NOT_REPEATED`);
  } else if (engine4Value !== ownerValue) {
    blockers.push(`ENGINE4_${fieldName}_CONFLICT`);
  }

  reasonCodes.push("ENGINE26A_CANONICAL_SETUP_IDENTITY_USED");

  return {
    valid: blockers.length === 0,
    blockers,
    reasonCodes,
  };
}

function versionMatchOrMissing({
  ownerValue,
  engine3Value,
  engine4Value,
}) {
  const blockers = [];
  const reasonCodes = [];

  if (!compatibleVersion(ownerValue)) {
    blockers.push("ENGINE26A_CANDIDATE_IDENTITY_VERSION_INCOMPATIBLE");
    return {
      valid: false,
      blockers,
      reasonCodes,
    };
  }

  if (!engine3Value) {
    reasonCodes.push("ENGINE3_CANDIDATE_IDENTITY_VERSION_NOT_REPEATED");
  } else if (!compatibleVersion(engine3Value) || engine3Value !== ownerValue) {
    blockers.push("ENGINE3_CANDIDATE_IDENTITY_VERSION_CONFLICT");
  }

  if (!engine4Value) {
    reasonCodes.push("ENGINE4_CANDIDATE_IDENTITY_VERSION_NOT_REPEATED");
  } else if (!compatibleVersion(engine4Value) || engine4Value !== ownerValue) {
    blockers.push("ENGINE4_CANDIDATE_IDENTITY_VERSION_CONFLICT");
  }

  reasonCodes.push("ENGINE26A_CANONICAL_SETUP_IDENTITY_USED");

  return {
    valid: blockers.length === 0,
    blockers,
    reasonCodes,
  };
}

function compatibleVersion(value) {
  const v = text(value);
  return Boolean(v && v.startsWith(COMPATIBLE_IDENTITY_PREFIX));
}

function allCompatibleVersions(...values) {
  return values.every((value) => compatibleVersion(value));
}

function entryZoneMidline(candidate) {
  return firstNumber(
    candidate?.entryZone?.midline,
    candidate?.entryZone?.mid,
    candidate?.entryZone?.zoneMid,
    candidate?.entryZoneMidline,
    candidate?.entryZoneMid,
    candidate?.zone?.midline,
    candidate?.zone?.mid
  );
}

function candidateInvalidated(candidate) {
  return (
    candidate?.candidateInvalidated === true ||
    candidate?.invalidated === true ||
    candidate?.isInvalidated === true ||
    candidate?.invalidationFacts?.invalidated === true ||
    candidate?.invalidation?.invalidated === true ||
    candidate?.completedCloseInvalidated === true ||
    String(candidate?.candidateState || "")
      .toUpperCase()
      .includes("INVALIDATED")
  );
}

function locationInvalidated(candidate) {
  return (
    candidate?.locationInvalidated === true ||
    candidate?.locationInvalidation?.invalidated === true ||
    candidate?.location?.invalidated === true ||
    candidate?.invalidationFacts?.locationInvalidated === true
  );
}

function readEngine26(candidate) {
  return {
    present: candidate != null && typeof candidate === "object",
    laneId: firstText(candidate?.laneId, candidate?.lane),
    strategyId: text(candidate?.strategyId),
    symbol: upper(candidate?.symbol),
    candidateId: text(candidate?.candidateId),
    zoneId: text(candidate?.zoneId),
    setupClass: upper(candidate?.setupClass),
    setupGrade: text(candidate?.setupGrade),
    identitySetupKey: text(candidate?.identitySetupKey),
    candidateIdentityVersion: text(candidate?.candidateIdentityVersion),
    direction: firstUpper(candidate?.direction, candidate?.directionBias),
    currentPrice: firstNumber(candidate?.currentPrice, candidate?.price),
    entryZoneMidline: entryZoneMidline(candidate),
    candidateInvalidated: candidateInvalidated(candidate),
    locationInvalidated: locationInvalidated(candidate),
  };
}

function readEngine3(reaction) {
  return {
    present: reaction != null && typeof reaction === "object",
    laneId: firstText(reaction?.laneId, reaction?.lane),
    strategyId: text(reaction?.strategyId),
    symbol: upper(reaction?.symbol),
    candidateId: text(reaction?.candidateId),
    zoneId: text(reaction?.zoneId),
    setupClass: upper(reaction?.setupClass),
    setupGrade: text(reaction?.setupGrade),
    identitySetupKey: text(reaction?.identitySetupKey),
    candidateIdentityVersion: text(reaction?.candidateIdentityVersion),

    evaluationAuthorized: reaction?.evaluationAuthorized === true,
    reactionConfirmed: reaction?.reactionConfirmed === true,

    confirmed: reaction?.confirmed === true,
    allowed: reaction?.allowed === true,
    authorized: reaction?.authorized === true,

    reactionState: firstUpper(
      reaction?.reactionState,
      reaction?.state,
      reaction?.fastReactionState
    ),

    authorizedReactionState: upper(reaction?.authorizedReactionState),
    direction: firstUpper(reaction?.direction, reaction?.tradeDirectionBias),
    quality: firstUpper(reaction?.quality, reaction?.reactionQuality),
  };
}

function readEngine4(participation) {
  const state = firstUpper(
    participation?.participationState,
    participation?.state,
    participation?.status
  );

  return {
    present: participation != null && typeof participation === "object",
    laneId: firstText(participation?.laneId, participation?.lane),
    strategyId: text(participation?.strategyId),
    symbol: upper(participation?.symbol),
    candidateId: text(participation?.candidateId),
    zoneId: text(participation?.zoneId),
    setupClass: upper(participation?.setupClass),
    setupGrade: text(participation?.setupGrade),
    identitySetupKey: text(participation?.identitySetupKey),
    candidateIdentityVersion: text(participation?.candidateIdentityVersion),

    participationConfirmed: participation?.participationConfirmed === true,
    confirmed: participation?.confirmed === true,
    allowed: participation?.allowed === true,
    hardBlocked: participation?.hardBlocked === true,

    participationDeveloping:
      participation?.participationDeveloping === true ||
      String(state || "").includes("DEVELOPING"),

    completedAdverseParticipation:
      participation?.completedAdverseParticipation === true ||
      participation?.adverseParticipationCompleted === true ||
      String(state || "").includes("ADVERSE"),

    participationState: state,
    participationQuality: firstUpper(
      participation?.participationQuality,
      participation?.quality
    ),

    direction: firstUpper(
      participation?.intendedDirection,
      participation?.direction
    ),
  };
}

function midlineTrigger({ direction, currentPrice, midline }) {
  const dir = upper(direction);
  const price = num(currentPrice);
  const line = num(midline);

  if (price === null || line === null) {
    return {
      satisfied: false,
      direction: dir,
      currentPrice: price,
      entryZoneMidline: line,
      reason: "MIDLINE_TRIGGER_MISSING_PRICE_OR_MIDLINE",
    };
  }

  if (dir === "LONG") {
    return {
      satisfied: price >= line,
      direction: dir,
      currentPrice: price,
      entryZoneMidline: line,
      reason:
        price >= line
          ? "LONG_ENTRY_ZONE_MIDLINE_REACHED"
          : "LONG_ENTRY_ZONE_MIDLINE_NOT_REACHED",
    };
  }

  return {
    satisfied: false,
    direction: dir,
    currentPrice: price,
    entryZoneMidline: line,
    reason: "MIDLINE_TRIGGER_DIRECTION_NOT_LONG",
  };
}

export function evaluateEngine6Strategy1Phase4Contract({
  symbol,
  strategyId,
  engine26LocationCandidate = null,
  engine3Reaction = null,
  engine4Participation = null,
  engine26ImbalanceWatch = null,
  confluence = null,
  direction = null,
} = {}) {
  const applies =
    upper(symbol) === REQUIRED_SYMBOL &&
    text(strategyId) === REQUIRED_STRATEGY_ID;

  const e26 = readEngine26(engine26LocationCandidate);
  const e3 = readEngine3(engine3Reaction);
  const e4 = readEngine4(engine4Participation);

  const finalDirection = firstUpper(
    direction,
    e3.direction,
    e4.direction,
    e26.direction
  );

  const currentPrice = firstNumber(
    e26.currentPrice,
    engine3Reaction?.currentPrice,
    engine4Participation?.currentPrice,
    engine26ImbalanceWatch?.currentPrice,
    confluence?.price,
    confluence?.currentPrice
  );

  const midline = midlineTrigger({
    direction: finalDirection,
    currentPrice,
    midline: e26.entryZoneMidline,
  });

  const blockers = [];
  const warnings = [];
  const reasonCodes = [
    "ENGINE6_PHASE4_STRATEGY1_CONTRACT_EVALUATED",
    applies
      ? "ENGINE6_PHASE4_APPLIES_TO_ES_MINUTE_SCALP"
      : "ENGINE6_PHASE4_NOT_APPLICABLE",
  ];

  if (!applies) {
    return {
      engine: "engine6.strategy1.phase4.contract.v1",
      applies: false,
      allowed: false,
      decision: null,
      permissionState: "PHASE4_NOT_APPLICABLE",
      blockers,
      warnings,
      reasonCodes,
      midlineTrigger: midline,
    };
  }

  if (!e26.present) blockers.push("ENGINE26A_CANDIDATE_MISSING");
  if (!e3.present) blockers.push("ENGINE3_CONTRACT_MISSING");
  if (!e4.present) blockers.push("ENGINE4_AUTHORIZED_PARTICIPATION_MISSING");

  const laneOk =
    (!e26.laneId || e26.laneId === REQUIRED_LANE_ID) &&
    (!e3.laneId || e3.laneId === REQUIRED_LANE_ID) &&
    (!e4.laneId || e4.laneId === REQUIRED_LANE_ID);

  if (!laneOk) blockers.push("LANE_ID_MISMATCH_OR_NON_MINUTE_IDENTITY");

  const strategyOk =
    allPresentAndSame(e26.strategyId, e3.strategyId, e4.strategyId) &&
    e26.strategyId === REQUIRED_STRATEGY_ID;

  if (!strategyOk) blockers.push("STRATEGY_ID_MISMATCH");

  const symbolOk =
    allPresentAndSame(e26.symbol, e3.symbol, e4.symbol) &&
    e26.symbol === REQUIRED_SYMBOL;

  if (!symbolOk) blockers.push("SYMBOL_MISMATCH");

  const candidateIdMatches =
    allPresentAndSame(e26.candidateId, e3.candidateId, e4.candidateId);

  if (!candidateIdMatches) blockers.push("CANDIDATE_ID_MISMATCH");

  const zoneIdMatches =
    allPresentAndSame(e26.zoneId, e3.zoneId, e4.zoneId);

  if (!zoneIdMatches) blockers.push("ZONE_ID_MISMATCH");

const setupClassCheck =
  metadataMatchOrMissing({
    ownerValue: e26.setupClass,
    engine3Value: e3.setupClass,
    engine4Value: e4.setupClass,
    fieldName: "SETUP_CLASS",
  });

const setupClassMatches =
  e26.setupClass === REQUIRED_SETUP_CLASS &&
  setupClassCheck.valid === true;

if (!setupClassMatches) {
  blockers.push(
    ...setupClassCheck.blockers,
    "SETUP_CLASS_MISMATCH"
  );
}

reasonCodes.push(
  ...setupClassCheck.reasonCodes
);

const identitySetupKeyCheck =
  metadataMatchOrMissing({
    ownerValue: e26.identitySetupKey,
    engine3Value: e3.identitySetupKey,
    engine4Value: e4.identitySetupKey,
    fieldName: "IDENTITY_SETUP_KEY",
  });

const identitySetupKeyMatches =
  e26.identitySetupKey === REQUIRED_SETUP_CLASS &&
  identitySetupKeyCheck.valid === true;

if (!identitySetupKeyMatches) {
  blockers.push(
    ...identitySetupKeyCheck.blockers,
    "IDENTITY_SETUP_KEY_MISMATCH"
  );
}

reasonCodes.push(
  ...identitySetupKeyCheck.reasonCodes
);

const candidateIdentityVersionCheck =
  versionMatchOrMissing({
    ownerValue: e26.candidateIdentityVersion,
    engine3Value: e3.candidateIdentityVersion,
    engine4Value: e4.candidateIdentityVersion,
  });

const candidateIdentityVersionCompatible =
  candidateIdentityVersionCheck.valid === true;

if (!candidateIdentityVersionCompatible) {
  blockers.push(
    ...candidateIdentityVersionCheck.blockers,
    "CANDIDATE_IDENTITY_VERSION_INCOMPATIBLE"
  );
}

reasonCodes.push(
  ...candidateIdentityVersionCheck.reasonCodes
);

  if (e26.candidateInvalidated) blockers.push("CANDIDATE_INVALIDATED");
  if (e26.locationInvalidated) blockers.push("LOCATION_INVALIDATED");

  if (e3.evaluationAuthorized !== true) {
    blockers.push("ENGINE3_EVALUATION_NOT_AUTHORIZED");
  }

  if (e3.reactionConfirmed !== true) {
    if (
      e3.reactionState &&
      (
        e3.reactionState.includes("DEVELOP") ||
        e3.reactionState.includes("PENDING") ||
        e3.reactionState.includes("WAIT")
      )
    ) {
      warnings.push("ENGINE3_REACTION_DEVELOPING");
      blockers.push("ENGINE3_REACTION_WAITING");
    } else {
      blockers.push("ENGINE3_REACTION_NOT_CONFIRMED");
    }
  }

  if (
    e3.authorizedReactionState === "REACTION_FAILED" ||
    e3.authorizedReactionState === "REACTION_INVALIDATED"
  ) {
    blockers.push(`ENGINE3_${e3.authorizedReactionState}`);
  }

  if (finalDirection !== "LONG") {
    blockers.push("REACTION_DIRECTION_NOT_LONG");
  }

  if (e4.participationConfirmed !== true) {
    if (
      e4.participationDeveloping === true ||
      (
        e4.participationState &&
        (
          e4.participationState.includes("DEVELOP") ||
          e4.participationState.includes("PENDING") ||
          e4.participationState.includes("WAIT")
        )
      )
    ) {
      warnings.push("ENGINE4_PARTICIPATION_DEVELOPING");
      blockers.push("ENGINE4_PARTICIPATION_WAITING");
    } else {
      blockers.push("ENGINE4_PARTICIPATION_NOT_CONFIRMED");
    }
  }

  if (e4.hardBlocked === true) blockers.push("ENGINE4_HARD_BLOCKED");

  if (e4.completedAdverseParticipation === true) {
    blockers.push("ENGINE4_COMPLETED_ADVERSE_PARTICIPATION");
  }

  if (midline.satisfied !== true) {
    blockers.push("ENTRY_ZONE_MIDLINE_TRIGGER_NOT_SATISFIED");
  }

  const finalBlockers = unique(blockers);
  const allowed = finalBlockers.length === 0;

  if (allowed) {
    reasonCodes.push("ENGINE6_PHASE4_ALL_GATES_PASSED");
    reasonCodes.push("FAST_INTRADAY_PAPER_ALLOW");
    reasonCodes.push("PLANNING_PERMISSION_ONLY");
    reasonCodes.push("PAPER_ONLY_SAFETY_ACTIVE");
    reasonCodes.push("NO_EXECUTION_AUTHORITY");
  } else {
    reasonCodes.push("ENGINE6_PHASE4_PERMISSION_NOT_ALLOWED");
  }

  return {
    engine: "engine6.strategy1.phase4.contract.v1",
    applies: true,
    decision: allowed ? "FAST_INTRADAY_PAPER_ALLOW" : "PAPER_STAND_DOWN",
    permissionState:
      allowed
        ? "FAST_INTRADAY_PAPER_ALLOW"
        : warnings.length
        ? "WATCH_ONLY_CONFIRMATION_REQUIRED"
        : "PHASE4_STAND_DOWN",

    allowed,
    paperAllowed: allowed,
    planningAllowed: allowed,

    realExecutionAllowed: false,
    executable: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,
    noExecution: true,

    canonicalInputs: {
      engine3: "confluence.context.reaction.paperScalpReaction",
      engine4: "confluence.context.volume.engine4AuthorizedReactionParticipation",
      engine26A: "engine26LocationCandidate",
    },

    identity: {
      laneId: REQUIRED_LANE_ID,
      strategyId: REQUIRED_STRATEGY_ID,
      symbol: REQUIRED_SYMBOL,
      candidateId: e26.candidateId,
      zoneId: e26.zoneId,
      setupClass: e26.setupClass,
      setupGrade: e26.setupGrade,
      identitySetupKey: e26.identitySetupKey,
      candidateIdentityVersion: e26.candidateIdentityVersion,
      candidateIdMatches,
      zoneIdMatches,
      setupClassMatches,
      identitySetupKeyMatches,
      candidateIdentityVersionCompatible,
    },

    reaction: {
      evaluationAuthorized: e3.evaluationAuthorized,
      reactionConfirmed: e3.reactionConfirmed,
      reactionState: e3.reactionState,
      authorizedReactionState: e3.authorizedReactionState,
      direction: e3.direction,
      quality: e3.quality,
      confirmed: e3.confirmed,
      allowed: e3.allowed,
      authorized: e3.authorized,
    },

    participation: {
      participationConfirmed: e4.participationConfirmed,
      participationDeveloping: e4.participationDeveloping,
      participationState: e4.participationState,
      participationQuality: e4.participationQuality,
      hardBlocked: e4.hardBlocked,
      allowed: e4.allowed,
      confirmed: e4.confirmed,
      completedAdverseParticipation: e4.completedAdverseParticipation,
    },

    invalidation: {
      candidateInvalidated: e26.candidateInvalidated,
      locationInvalidated: e26.locationInvalidated,
    },

    midlineTrigger: midline,

    blockers: finalBlockers,
    warnings: unique(warnings),
    reasonCodes: unique(reasonCodes),
  };
}

export default evaluateEngine6Strategy1Phase4Contract;
