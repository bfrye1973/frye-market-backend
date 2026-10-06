// services/core/logic/engine3/v5/zone/normalizeNegotiatedZone.js
//
// Engine 3 v5 — Canonical Engine 26 negotiated-zone normalization.
//
// Contract:
// - Pure zone-input utility.
// - Accepts Engine 26 Strategy 1 location/candidate/handoff objects.
// - Extracts ONE exact negotiated zone for Engine 3 v5.
// - Does not select among alternate zones.
// - Does not infer price direction.
// - Does not consume Engine 26 directional opinion as authority.
// - Does not create buyer/seller control.
// - Does not create canonical LONG / SHORT / NEUTRAL.
// - Does not create permission.
// - Does not create execution.
//
// Frozen ownership:
// Engine 26 owns WHERE.
// Engine 3 owns WHAT PRICE IS DOING THERE.

const ENGINE = "engine3.v5.zone.normalizeNegotiatedZone.v1";
const SOURCE = "engine3.v5.zone.normalizeNegotiatedZone";

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundPrice(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Number(n.toFixed(6))
    : null;
}

function normalizeZoneShape(zone = null) {
  if (!zone || typeof zone !== "object") {
    return null;
  }

  const rawLow =
    toFiniteNumber(
      zone?.low ??
      zone?.lo ??
      zone?.from
    );

  const rawHigh =
    toFiniteNumber(
      zone?.high ??
      zone?.hi ??
      zone?.to
    );

  if (
    rawLow == null ||
    rawHigh == null
  ) {
    return null;
  }

  const low =
    Math.min(
      rawLow,
      rawHigh
    );

  const high =
    Math.max(
      rawLow,
      rawHigh
    );

  const midline =
    toFiniteNumber(
      zone?.midline ??
      zone?.mid
    ) ??
    roundPrice(
      (low + high) / 2
    );

  return {
    id:
      zone?.id ??
      zone?.zoneId ??
      null,

    zoneId:
      zone?.zoneId ??
      zone?.id ??
      null,

    upstreamId:
      zone?.upstreamId ??
      null,

    source:
      zone?.source ??
      null,

    sourcePath:
      zone?.sourcePath ??
      null,

    type:
      zone?.type ??
      "NEGOTIATED",

    timeframe:
      zone?.timeframe ??
      null,

    low:
      roundPrice(low),

    high:
      roundPrice(high),

    midline:
      roundPrice(midline),

    widthPoints:
      roundPrice(
        high - low
      ),
  };
}

function resolvePrimaryZone({
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  const candidateZone =
    normalizeZoneShape(
      engine26LocationCandidate
        ?.entryZone
    );

  const handoffZone =
    normalizeZoneShape(
      engine26ReactionHandoff
        ?.entryZone
    );

  const candidateLocation =
    normalizeZoneShape(
      engine26LocationCandidate
        ?.location
    );

  const handoffLocation =
    normalizeZoneShape(
      engine26ReactionHandoff
        ?.zone
    );

  return (
    candidateZone ||
    handoffZone ||
    candidateLocation ||
    handoffLocation ||
    null
  );
}

function collectIdentity({
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  return {
    candidateId:
      engine26LocationCandidate
        ?.candidateId ??
      engine26ReactionHandoff
        ?.candidateId ??
      null,

    zoneId:
      engine26LocationCandidate
        ?.zoneId ??
      engine26ReactionHandoff
        ?.zoneId ??
      null,

    laneId:
      engine26LocationCandidate
        ?.laneId ??
      engine26ReactionHandoff
        ?.laneId ??
      null,

    symbol:
      engine26LocationCandidate
        ?.symbol ??
      engine26ReactionHandoff
        ?.symbol ??
      null,

    strategyId:
      engine26LocationCandidate
        ?.strategyId ??
      engine26ReactionHandoff
        ?.strategyId ??
      null,

    timeframe:
      engine26LocationCandidate
        ?.timeframe ??
      engine26ReactionHandoff
        ?.timeframe ??
      null,

    candidateIdentityVersion:
      engine26LocationCandidate
        ?.candidateIdentityVersion ??
      engine26ReactionHandoff
        ?.candidateIdentityVersion ??
      null,

    setupClass:
      engine26LocationCandidate
        ?.setupClass ??
      engine26ReactionHandoff
        ?.setupClass ??
      null,

    identitySetupKey:
      engine26LocationCandidate
        ?.identitySetupKey ??
      engine26ReactionHandoff
        ?.identitySetupKey ??
      null,

    snapshotTime:
      engine26LocationCandidate
        ?.snapshotTime ??
      engine26ReactionHandoff
        ?.snapshotTime ??
      null,
  };
}

function collectLifecycle({
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  return {
    candidateActive:
      engine26LocationCandidate
        ?.active === true ||
      engine26ReactionHandoff
        ?.candidateActive === true ||
      engine26ReactionHandoff
        ?.active === true,

    candidateIdentityValid:
      engine26ReactionHandoff
        ?.candidateIdentityValid === true ||
      engine26LocationCandidate
        ?.candidateId != null,

    strategyContextValid:
      engine26ReactionHandoff
        ?.strategyContextValid !== false,

    terminalLifecycle:
      engine26ReactionHandoff
        ?.terminalLifecycle === true,

    authorizeEngine3Evaluation:
      engine26ReactionHandoff
        ?.authorizeEngine3Evaluation === true,

    invalidatedAt:
      engine26LocationCandidate
        ?.invalidatedAt ??
      engine26ReactionHandoff
        ?.invalidatedAt ??
      null,

    currentPrice:
      toFiniteNumber(
        engine26LocationCandidate
          ?.currentPrice ??
        engine26ReactionHandoff
          ?.currentPrice
      ),
  };
}

function collectUpstreamExpectation({
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  return {
    /*
     * Diagnostic comparison only.
     *
     * These fields MUST NOT be used by Engine 3 v5
     * to resolve buyer/seller control or canonical direction.
     */
    direction:
      engine26LocationCandidate
        ?.direction ??
      engine26ReactionHandoff
        ?.direction ??
      null,

    directionBias:
      engine26LocationCandidate
        ?.directionBias ??
      null,

    preferredDirection:
      engine26LocationCandidate
        ?.preferredDirection ??
      engine26ReactionHandoff
        ?.preferredDirection ??
      null,

    tradeDirectionBias:
      engine26LocationCandidate
        ?.tradeDirectionBias ??
      engine26ReactionHandoff
        ?.tradeDirectionBias ??
      null,

    directionState:
      engine26LocationCandidate
        ?.directionState ??
      engine26ReactionHandoff
        ?.directionState ??
      null,

    expectedDirection:
      engine26ReactionHandoff
        ?.expectedDirection ??
      engine26LocationCandidate
        ?.expectedDirection ??
      null,

    expectedReactionDirection:
      engine26ReactionHandoff
        ?.expectedReactionDirection ??
      engine26LocationCandidate
        ?.expectedReactionDirection ??
      null,

    expectedParticipationDirection:
      engine26ReactionHandoff
        ?.expectedParticipationDirection ??
      engine26LocationCandidate
        ?.expectedParticipationDirection ??
      null,

    ema10Posture:
      engine26ReactionHandoff
        ?.ema10Posture ??
      engine26LocationCandidate
        ?.ema10Posture ??
      null,
  };
}

export function normalizeNegotiatedZone({
  engine26LocationCandidate = null,
  engine26ReactionHandoff = null,
} = {}) {
  const zone =
    resolvePrimaryZone({
      engine26LocationCandidate,
      engine26ReactionHandoff,
    });

  const identity =
    collectIdentity({
      engine26LocationCandidate,
      engine26ReactionHandoff,
    });

  const lifecycle =
    collectLifecycle({
      engine26LocationCandidate,
      engine26ReactionHandoff,
    });

  const upstreamExpectation =
    collectUpstreamExpectation({
      engine26LocationCandidate,
      engine26ReactionHandoff,
    });

  const zoneIdentityMatches =
    zone != null &&
    identity.zoneId != null
      ? String(
          zone.zoneId ||
          zone.id ||
          ""
        ) ===
        String(identity.zoneId)
      : zone != null;

  const eligible =
    zone != null &&
    lifecycle.candidateActive === true &&
    lifecycle.candidateIdentityValid === true &&
    lifecycle.strategyContextValid === true &&
    lifecycle.terminalLifecycle !== true &&
    lifecycle.authorizeEngine3Evaluation === true &&
    zoneIdentityMatches === true;

  return {
    ok:
      zone != null,

    engine:
      ENGINE,

    source:
      SOURCE,

    mode:
      "STRATEGY1_EXACT_NEGOTIATED_ZONE_ONLY",

    eligible,

    identity,

    lifecycle,

    zone,

    zoneIdentityMatches,

    upstreamExpectation,

    directionalAuthority: {
      engine26LocationAuthority:
        true,

      engine26DirectionalOpinionAuthority:
        false,

      engine3MustResolveObservedControl:
        true,
    },

    reasonCodes: [
      "ENGINE3_V5_ENGINE26_ZONE_INPUT_NORMALIZED",

      zone
        ? "ENGINE3_V5_EXACT_NEGOTIATED_ZONE_AVAILABLE"
        : "ENGINE3_V5_EXACT_NEGOTIATED_ZONE_MISSING",

      lifecycle.candidateActive
        ? "ENGINE3_V5_ENGINE26_CANDIDATE_ACTIVE"
        : "ENGINE3_V5_ENGINE26_CANDIDATE_INACTIVE",

      lifecycle.candidateIdentityValid
        ? "ENGINE3_V5_ENGINE26_IDENTITY_VALID"
        : "ENGINE3_V5_ENGINE26_IDENTITY_INVALID",

      lifecycle.strategyContextValid
        ? "ENGINE3_V5_STRATEGY_CONTEXT_VALID"
        : "ENGINE3_V5_STRATEGY_CONTEXT_INVALID",

      lifecycle.authorizeEngine3Evaluation
        ? "ENGINE3_V5_ENGINE26_EVALUATION_AUTHORIZED"
        : "ENGINE3_V5_ENGINE26_EVALUATION_NOT_AUTHORIZED",

      lifecycle.terminalLifecycle
        ? "ENGINE3_V5_TERMINAL_LIFECYCLE"
        : "ENGINE3_V5_NON_TERMINAL_LIFECYCLE",

      zoneIdentityMatches
        ? "ENGINE3_V5_ZONE_IDENTITY_MATCH"
        : "ENGINE3_V5_ZONE_IDENTITY_MISMATCH",

      eligible
        ? "ENGINE3_V5_ZONE_EVALUATION_ELIGIBLE"
        : "ENGINE3_V5_ZONE_EVALUATION_NOT_ELIGIBLE",

      "ENGINE3_V5_ENGINE26_DIRECTION_DIAGNOSTIC_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default normalizeNegotiatedZone;
