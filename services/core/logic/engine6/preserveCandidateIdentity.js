// services/core/logic/engine6/preserveCandidateIdentity.js
//
// Adds the shared candidate identity to an already-computed Engine 6
// permission object.
//
// This helper does NOT:
// - calculate permission
// - change permission decisions
// - change allowed
// - change blockers
// - change sizing
// - create execution
//
// It only verifies and preserves identity from Engine 26A, Engine 3,
// and Engine 4 after Engine 6 has completed its normal calculation.

const ENGINE = "engine6.candidateIdentity.v1";

function normalizeText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function identityFromEngine26(candidate) {
  return {
    candidateId:
      normalizeText(candidate?.candidateId),

    zoneId:
      normalizeText(candidate?.zoneId),

    strategyId:
      normalizeText(candidate?.strategyId),

    symbol:
      normalizeText(candidate?.symbol),

    direction:
      normalizeText(
        candidate?.directionBias
      ),

    setupType:
      normalizeText(candidate?.setupType),

    snapshotTime:
      normalizeText(candidate?.snapshotTime),
  };
}

function identityFromEngine3(reaction) {
  return {
    candidateId:
      normalizeText(reaction?.candidateId),

    zoneId:
      normalizeText(reaction?.zoneId),

    strategyId:
      normalizeText(reaction?.strategyId),

    symbol:
      normalizeText(reaction?.symbol),

    direction:
      normalizeText(reaction?.direction),

    setupType:
      normalizeText(reaction?.setupType),

    snapshotTime:
      normalizeText(reaction?.snapshotTime),
  };
}

function identityFromEngine4(participation) {
  return {
    candidateId:
      normalizeText(participation?.candidateId),

    zoneId:
      normalizeText(participation?.zoneId),

    strategyId:
      normalizeText(participation?.strategyId),

    symbol:
      normalizeText(participation?.symbol),

    direction:
      normalizeText(participation?.direction),

    setupType:
      normalizeText(participation?.setupType),

    snapshotTime:
      normalizeText(participation?.snapshotTime),
  };
}

function sameValueOrMissing(...values) {
  const populated = values.filter(Boolean);

  if (populated.length <= 1) {
    return true;
  }

  return populated.every(
    (value) => value === populated[0]
  );
}

function unique(values = []) {
  return [
    ...new Set(
      values.filter(Boolean)
    ),
  ];
}

export function preserveEngine6CandidateIdentity({
  permission,
  engine26LocationCandidate = null,
  engine3AuthorizedReaction = null,
  engine4AuthorizedParticipation = null,
} = {}) {
  if (
    !permission ||
    typeof permission !== "object"
  ) {
    return permission;
  }

  const engine26Identity =
    identityFromEngine26(
      engine26LocationCandidate
    );

  const engine3Identity =
    identityFromEngine3(
      engine3AuthorizedReaction
    );

  const engine4Identity =
    identityFromEngine4(
      engine4AuthorizedParticipation
    );

  const candidateIdConsistent =
    sameValueOrMissing(
      engine26Identity.candidateId,
      engine3Identity.candidateId,
      engine4Identity.candidateId
    );

  const zoneIdConsistent =
    sameValueOrMissing(
      engine26Identity.zoneId,
      engine3Identity.zoneId,
      engine4Identity.zoneId
    );

  const strategyIdConsistent =
    sameValueOrMissing(
      engine26Identity.strategyId,
      engine3Identity.strategyId,
      engine4Identity.strategyId
    );

  const symbolConsistent =
    sameValueOrMissing(
      engine26Identity.symbol,
      engine3Identity.symbol,
      engine4Identity.symbol
    );

  const identityConsistent =
    candidateIdConsistent &&
    zoneIdConsistent &&
    strategyIdConsistent &&
    symbolConsistent;

  const identity = {
    candidateId:
      engine26Identity.candidateId ??
      engine3Identity.candidateId ??
      engine4Identity.candidateId,

    zoneId:
      engine26Identity.zoneId ??
      engine3Identity.zoneId ??
      engine4Identity.zoneId,

    strategyId:
      engine26Identity.strategyId ??
      engine3Identity.strategyId ??
      engine4Identity.strategyId,

    symbol:
      engine26Identity.symbol ??
      engine3Identity.symbol ??
      engine4Identity.symbol,

    direction:
      engine26Identity.direction ??
      engine3Identity.direction ??
      engine4Identity.direction,

    setupType:
      engine26Identity.setupType ??
      engine3Identity.setupType ??
      engine4Identity.setupType,

    snapshotTime:
      engine26Identity.snapshotTime ??
      engine3Identity.snapshotTime ??
      engine4Identity.snapshotTime,
  };

  const existingPaper =
    permission.paper &&
    typeof permission.paper === "object"
      ? permission.paper
      : null;

  const identityContext = {
    engine: ENGINE,

    preserved: Boolean(
      identity.candidateId &&
      identity.zoneId
    ),

    consistent:
      identityConsistent,

    candidateIdConsistent,
    zoneIdConsistent,
    strategyIdConsistent,
    symbolConsistent,

    sources: {
      engine26A: engine26Identity,
      engine3: engine3Identity,
      engine4: engine4Identity,
    },

    reasonCodes: unique([
      identity.candidateId
        ? "CANDIDATE_ID_PRESERVED"
        : "CANDIDATE_ID_MISSING",

      identity.zoneId
        ? "ZONE_ID_PRESERVED"
        : "ZONE_ID_MISSING",

      identityConsistent
        ? "PIPELINE_IDENTITY_CONSISTENT"
        : "PIPELINE_IDENTITY_MISMATCH",

      "ENGINE6_PERMISSION_DECISION_UNCHANGED",
      "NO_EXECUTION_CREATED",
    ]),
  };

  return {
    ...permission,

    candidateId:
      identity.candidateId,

    zoneId:
      identity.zoneId,

    strategyId:
      permission.strategyId ??
      identity.strategyId,

    symbol:
      permission.symbol ??
      identity.symbol,

    setupType:
      permission.setupType ??
      identity.setupType,

    snapshotTime:
      identity.snapshotTime,

    candidateIdentity:
      identityContext,

    ...(existingPaper
      ? {
          paper: {
            ...existingPaper,

            candidateId:
              identity.candidateId,

            zoneId:
              identity.zoneId,

            strategyId:
              existingPaper.strategyId ??
              identity.strategyId,

            symbol:
              existingPaper.symbol ??
              identity.symbol,

            setupType:
              existingPaper.setupType ??
              identity.setupType,

            snapshotTime:
              identity.snapshotTime,

            candidateIdentity:
              identityContext,
          },
        }
      : {}),
  };
}

export default preserveEngine6CandidateIdentity;
