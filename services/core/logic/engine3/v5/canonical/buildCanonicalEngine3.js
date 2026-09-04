// services/core/logic/engine3/v5/canonical/buildCanonicalEngine3.js
//
// Engine 3 v5 — Canonical published Engine 3 contract.
//
// Contract:
// - Assembly-only.
// - Consumes the already-resolved output of directionStateMachine.js
//   plus supporting v5 evidence objects.
// - Does not independently calculate LONG / SHORT / NEUTRAL.
// - Does not override state-machine direction.
// - Does not create permission.
// - Does not create execution.
// - Does not create sizing, tickets, or orders.
//
// Frozen rule:
// ONLY state/directionStateMachine.js may decide canonical direction.
//
// This builder publishes one clean downstream object for:
// - diagnostics
// - future Engine 4 migration
// - future Engine 6 migration
// - frontend display
//
// During shadow mode, downstream engines MUST NOT consume this as authority.

const ENGINE = "engine3.v5.canonical.buildCanonicalEngine3.v1";
const SOURCE = "engine3.v5.canonical.buildCanonicalEngine3";

function normalizeDirection(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  if (text === "LONG") return "LONG";
  if (text === "SHORT") return "SHORT";

  return "NEUTRAL";
}

function normalizeQuality(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  if (
    ["STRONG", "GOOD", "MIXED", "WEAK"].includes(text)
  ) {
    return text;
  }

  return "WEAK";
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function buildCanonicalEngine3({
  normalizedZoneInput = null,

  oneMinuteEvidence = null,

  fiveMinuteReaction = null,

  tenMinuteContext = null,

  departureState = null,

  ema10TravelState = null,

  stateMachine = null,

  shadowMode = true,
} = {}) {
  const direction =
    normalizeDirection(
      stateMachine?.direction
    );

  const quality =
    normalizeQuality(
      stateMachine?.quality ??
      fiveMinuteReaction
        ?.stateMachineHandoff
        ?.quality
    );

  const controlState =
    fiveMinuteReaction
      ?.stateMachineHandoff
      ?.controlState ||
    "NO_CONTROL";

  const controlConfidence =
    fiveMinuteReaction
      ?.stateMachineHandoff
      ?.controlConfidence ||
    "WEAK";

  const reactionState =
    fiveMinuteReaction
      ?.stateMachineHandoff
      ?.reactionState ||
    null;

  const followThroughState =
    fiveMinuteReaction
      ?.stateMachineHandoff
      ?.followThroughState ||
    null;

  const canonicalReady =
    normalizedZoneInput?.eligible === true &&
    stateMachine?.ok === true;

  const reactionConfirmed =
    canonicalReady === true &&
    (
      direction === "LONG" ||
      direction === "SHORT"
    ) &&
    (
      controlState === "BUYERS_CONTROL" ||
      controlState === "SELLERS_CONTROL" ||
      stateMachine?.mode === "TRAVEL" ||
      stateMachine?.mode === "TRAVEL_PENDING_EMA10"
    );

  return {
    ok:
      canonicalReady,

    engine:
      ENGINE,

    source:
      SOURCE,

    version:
      "engine3.v5",

    mode:
      shadowMode === true
        ? "SHADOW_READ_ONLY"
        : "CANONICAL_ACTIVE",

    shadowMode:
      shadowMode === true,

    authoritativeDownstream:
      shadowMode !== true,

    symbol:
      normalizedZoneInput
        ?.identity
        ?.symbol ||
      null,

    strategyId:
      normalizedZoneInput
        ?.identity
        ?.strategyId ||
      null,

    laneId:
      normalizedZoneInput
        ?.identity
        ?.laneId ||
      null,

    candidateId:
      normalizedZoneInput
        ?.identity
        ?.candidateId ||
      null,

    zoneId:
      normalizedZoneInput
        ?.identity
        ?.zoneId ||
      null,

    candidateIdentityVersion:
      normalizedZoneInput
        ?.identity
        ?.candidateIdentityVersion ||
      null,

    setupClass:
      normalizedZoneInput
        ?.identity
        ?.setupClass ||
      null,

    snapshotTime:
      normalizedZoneInput
        ?.identity
        ?.snapshotTime ||
      null,

    zone:
      normalizedZoneInput?.zone ||
      null,

    canonical: {
      direction,

      quality,

      reactionConfirmed,

      mode:
        stateMachine?.mode ||
        "ZONE_REACTION",

      stateTransition:
        stateMachine
          ?.stateTransition ||
        null,

      canonicalSource:
        stateMachine
          ?.canonicalSource ||
        null,

      establishedNow:
        stateMachine
          ?.establishedNow === true,

      reversedNow:
        stateMachine
          ?.reversedNow === true,

      resetNow:
        stateMachine
          ?.resetNow === true,

      heldNow:
        stateMachine
          ?.heldNow === true,
    },

    control: {
      state:
        controlState,

      confidence:
        controlConfidence,

      quality,

      reactionState,

      reactionBias:
        fiveMinuteReaction
          ?.stateMachineHandoff
          ?.reactionBias ||
        null,

      followThroughState,

      followThroughBias:
        fiveMinuteReaction
          ?.stateMachineHandoff
          ?.followThroughBias ||
        null,

      sequencePhase:
        fiveMinuteReaction
          ?.stateMachineHandoff
          ?.sequencePhase ||
        null,
    },

    timeframeAuthority: {
      oneMinute: {
        role:
          oneMinuteEvidence?.role ||
          "IMMEDIATE_DIAGNOSTIC_ONLY",

        canonicalAuthority:
          false,

        canCreateCanonicalDirection:
          false,

        canFlipCanonicalDirection:
          false,
      },

      fiveMinute: {
        role:
          fiveMinuteReaction?.role ||
          "PRIMARY_MATURE_ZONE_REACTION_AUTHORITY",

        formingCanonicalAuthority:
          false,

        completedCanonicalEvidenceAuthority:
          fiveMinuteReaction
            ?.completed5mAuthorizedForStateMachine === true,

        canonicalDirectionPublisher:
          false,
      },

      tenMinute: {
        role:
          tenMinuteContext?.role ||
          "BROADER_PRICE_ACTION_CONTEXT",

        canCreateInitialCanonicalDirection:
          false,

        canFlipCanonicalDirectionInZoneMode:
          false,

        postZoneTravelLifecycleOwnedElsewhere:
          true,
      },

      stateMachine: {
        soleCanonicalDirectionPublisher:
          stateMachine
            ?.soleCanonicalDirectionPublisher === true,
      },
    },

    travel: {
      departureConfirmed:
        departureState
          ?.departureConfirmed === true,

      departureDirection:
        departureState
          ?.departureDirection ||
        "NEUTRAL",

      departureStatus:
        departureState
          ?.status ||
        null,

      ema10TravelActive:
        ema10TravelState
          ?.travelActive === true,

      ema10Hold:
        ema10TravelState
          ?.holdEstablishedDirection === true,

      ema10Reset:
        ema10TravelState
          ?.resetEstablishedDirection === true,

      ema10Status:
        ema10TravelState
          ?.status ||
        null,

      latestCompleted10mClose:
        ema10TravelState
          ?.latestCompletedClose ??
        tenMinuteContext
          ?.travelEvidence
          ?.latestCompletedClose ??
        null,

      ema10:
        ema10TravelState
          ?.ema10 ??
        null,
    },

    diagnostics: {
      oneMinuteDisplay:
        oneMinuteEvidence
          ?.display ||
        null,

      fiveMinuteDisplay:
        fiveMinuteReaction
          ?.display ||
        null,

      tenMinuteDisplay:
        tenMinuteContext
          ?.display ||
        null,

      upstreamExpectation:
        normalizedZoneInput
          ?.upstreamExpectation ||
        null,
    },

    safety: {
      noPermissionCreated:
        true,

      noExecution:
        true,

      noSizing:
        true,

      noTicket:
        true,

      noOrder:
        true,

      engine4Authority:
        false,

      engine6Authority:
        false,
    },

    reasonCodes: unique([
      "ENGINE3_V5_CANONICAL_CONTRACT_BUILT",

      shadowMode === true
        ? "ENGINE3_V5_SHADOW_READ_ONLY"
        : "ENGINE3_V5_CANONICAL_ACTIVE",

      `ENGINE3_V5_CANONICAL_DIRECTION_${direction}`,

      `ENGINE3_V5_CANONICAL_QUALITY_${quality}`,

      `ENGINE3_V5_CONTROL_STATE_${controlState}`,

      reactionConfirmed
        ? "ENGINE3_V5_REACTION_CONFIRMED"
        : "ENGINE3_V5_REACTION_NOT_CONFIRMED",

      stateMachine
        ?.soleCanonicalDirectionPublisher === true
        ? "ENGINE3_V5_STATE_MACHINE_SOLE_DIRECTION_AUTHORITY"
        : "ENGINE3_V5_DIRECTION_AUTHORITY_CONTRACT_MISSING",

      shadowMode === true
        ? "ENGINE3_V5_NOT_AUTHORIZED_FOR_ENGINE4"
        : null,

      shadowMode === true
        ? "ENGINE3_V5_NOT_AUTHORIZED_FOR_ENGINE6"
        : null,

      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ]),
  };
}

export default buildCanonicalEngine3;
