// services/core/logic/engine4/authorizedReactionParticipation.js
//
// Engine 4 authorized-reaction participation adapter.
//
// Purpose:
// - Preserve the existing Engine 4 participation algorithms unchanged.
// - Consume only the authorized Engine 3 reaction.
// - Confirm that participation belongs to the same candidateId and zoneId.
// - Publish WAITING_FOR_ENGINE3_REACTION when no authorized reaction exists.
// - Never create permission or execution.
//
// This file does not recalculate volume thresholds.
// It classifies the existing Engine 4 participation output against the
// authorized Engine 3 identity contract.

const ENGINE =
  "engine4.authorizedReactionParticipation.v1";

function safeUpper(value, fallback = "UNKNOWN") {
  const text = String(value || "").trim();

  return text
    ? text.toUpperCase()
    : fallback;
}

function uniqueValues(values = []) {
  return [
    ...new Set(
      values.filter(Boolean)
    ),
  ];
}

function buildWaitingResult({
  paperScalpReaction = null,
  reasonCode =
    "WAITING_FOR_ENGINE3_REACTION",
} = {}) {
  return {
    active: true,
    engine: ENGINE,

    source:
      "confluence.context.reaction.paperScalpReaction",

    status:
      "WAITING_FOR_ENGINE3_REACTION",

    allowed: false,
    confirmed: false,
    hardBlocked: false,

    candidateId:
      paperScalpReaction?.candidateId ??
      null,

    zoneId:
      paperScalpReaction?.zoneId ??
      null,

    strategyId:
      paperScalpReaction?.strategyId ??
      null,

    symbol:
      paperScalpReaction?.symbol ??
      null,

    direction:
      paperScalpReaction?.direction ??
      null,

    setupType:
      paperScalpReaction?.setupType ??
      null,

    snapshotTime:
      paperScalpReaction?.snapshotTime ??
      null,

    sourceReaction: paperScalpReaction
      ? {
          state:
            paperScalpReaction.state ??
            null,

          authorizedReactionState:
            paperScalpReaction
              .authorizedReactionState ??
            null,

          quality:
            paperScalpReaction.quality ??
            null,

          direction:
            paperScalpReaction.direction ??
            null,

          authorized:
            paperScalpReaction.authorized ===
            true,

          confirmed:
            paperScalpReaction
              .engine26LocationContext
              ?.confirmed === true,
        }
      : null,

    sourceParticipation: null,

    participationState: "WAITING",
    participationQuality: "NONE",

    noPermissionCreated: true,
    noExecution: true,
    requiresEngine6Permission: true,

    blockers: [
      reasonCode,
    ],

    warnings: [],

    reasonCodes: [
      reasonCode,
      "ENGINE4_WAITING_FOR_AUTHORIZED_ENGINE3_REACTION",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

function selectExistingParticipation(
  volumeContext
) {
  if (
    volumeContext
      ?.engine4FastImbalanceParticipation
      ?.active === true
  ) {
    return {
      source:
        "confluence.context.volume.engine4FastImbalanceParticipation",

      value:
        volumeContext
          .engine4FastImbalanceParticipation,
    };
  }

  if (
    volumeContext
      ?.engine4CurrentScalpParticipation
      ?.active === true
  ) {
    return {
      source:
        "confluence.context.volume.engine4CurrentScalpParticipation",

      value:
        volumeContext
          .engine4CurrentScalpParticipation,
    };
  }

  if (
    volumeContext
      ?.engine22LifecycleParticipation
      ?.active === true
  ) {
    return {
      source:
        "confluence.context.volume.engine22LifecycleParticipation",

      value:
        volumeContext
          .engine22LifecycleParticipation,
    };
  }

  return {
    source: null,
    value: null,
  };
}

function normalizeParticipationState(
  participation
) {
  return safeUpper(
    participation?.participationState ||
      participation?.state,
    "UNKNOWN"
  );
}

function normalizeParticipationQuality(
  participation
) {
  return safeUpper(
    participation?.participationQuality ||
      participation?.quality,
    "UNKNOWN"
  );
}

function determineAuthorizedStatus({
  participation,
  sourceReaction,
}) {
  if (
    sourceReaction
      ?.authorizedReactionState ===
    "REACTION_INVALIDATED"
  ) {
    return "PARTICIPATION_INVALIDATED";
  }

  if (
    participation?.hardBlocked === true
  ) {
    return "PARTICIPATION_FAILED";
  }

  if (
    participation?.allowed === true ||
    participation?.confirmed === true
  ) {
    return "PARTICIPATION_CONFIRMED";
  }

  const state =
    normalizeParticipationState(
      participation
    );

  if (
    state.includes("RISK") ||
    state.includes("FAILED") ||
    state.includes("BLOCKED")
  ) {
    return "PARTICIPATION_FAILED";
  }

  return "PARTICIPATION_DEVELOPING";
}

export function buildEngine4AuthorizedReactionParticipation({
  paperScalpReaction = null,
  volumeContext = null,
} = {}) {
  const reaction =
    paperScalpReaction &&
    typeof paperScalpReaction === "object"
      ? paperScalpReaction
      : null;

  if (!reaction) {
    return buildWaitingResult({
      reasonCode:
        "ENGINE3_PAPER_SCALP_REACTION_MISSING",
    });
  }

  const candidateId =
    reaction.candidateId ?? null;

  const zoneId =
    reaction.zoneId ?? null;

  const authorized =
    reaction.authorized === true &&
    reaction.authorizeEngine3Evaluation ===
      true &&
    Boolean(candidateId) &&
    Boolean(zoneId);

  if (!authorized) {
    return buildWaitingResult({
      paperScalpReaction: reaction,
      reasonCode:
        "WAITING_FOR_ENGINE3_REACTION",
    });
  }

  const authorizedReactionState =
    safeUpper(
      reaction.authorizedReactionState,
      "UNKNOWN"
    );

  const reactionConfirmed =
    authorizedReactionState ===
      "REACTION_CONFIRMED" ||
    reaction.engine26LocationContext
      ?.confirmed === true;

  if (!reactionConfirmed) {
    return buildWaitingResult({
      paperScalpReaction: reaction,
      reasonCode:
        "ENGINE3_AUTHORIZED_REACTION_NOT_CONFIRMED",
    });
  }

  const selected =
    selectExistingParticipation(
      volumeContext
    );

  const participation =
    selected.value;

  if (!participation) {
    return {
      ...buildWaitingResult({
        paperScalpReaction: reaction,
        reasonCode:
          "ENGINE4_PARTICIPATION_SOURCE_MISSING",
      }),

      status:
        "PARTICIPATION_DEVELOPING",

      participationState:
        "WAITING_FOR_PARTICIPATION",

      blockers: [
        "ENGINE4_PARTICIPATION_SOURCE_MISSING",
      ],
    };
  }

  const participationDirection =
    safeUpper(
      participation.intendedDirection ||
        participation.direction,
      "NEUTRAL"
    );

  const reactionDirection =
    safeUpper(
      reaction.direction,
      "NEUTRAL"
    );

  const directionMatches =
    reactionDirection === "NEUTRAL" ||
    participationDirection === "NEUTRAL" ||
    participationDirection ===
      reactionDirection;

  const status =
    directionMatches
      ? determineAuthorizedStatus({
          participation,
          sourceReaction: reaction,
        })
      : "PARTICIPATION_INVALIDATED";

  const confirmed =
    status ===
    "PARTICIPATION_CONFIRMED";

  const hardBlocked =
    participation.hardBlocked === true;

  const allowed =
    confirmed &&
    hardBlocked !== true &&
    directionMatches;

  const blockers = uniqueValues([
    ...(Array.isArray(
      participation.blockers
    )
      ? participation.blockers
      : []),

    directionMatches
      ? null
      : "ENGINE4_DIRECTION_DOES_NOT_MATCH_AUTHORIZED_REACTION",

    hardBlocked
      ? "ENGINE4_PARTICIPATION_HARD_BLOCKED"
      : null,

    status === "PARTICIPATION_DEVELOPING"
      ? "ENGINE4_PARTICIPATION_NOT_YET_CONFIRMED"
      : null,

    status === "PARTICIPATION_FAILED"
      ? "ENGINE4_PARTICIPATION_FAILED"
      : null,

    status ===
    "PARTICIPATION_INVALIDATED"
      ? "ENGINE4_PARTICIPATION_INVALIDATED"
      : null,
  ]);

  return {
    active: true,
    engine: ENGINE,

    source:
      "confluence.context.reaction.paperScalpReaction",

    participationSource:
      selected.source,

    status,

    allowed,
    confirmed,
    hardBlocked,

    candidateId,
    zoneId,

    strategyId:
      reaction.strategyId ?? null,

    symbol:
      reaction.symbol ?? null,

    direction:
      reaction.direction ?? null,

    setupType:
      reaction.setupType ?? null,

    snapshotTime:
      reaction.snapshotTime ?? null,

    sourceReaction: {
      candidateId,
      zoneId,

      state:
        reaction.state ?? null,

      authorizedReactionState,

      quality:
        reaction.quality ?? null,

      direction:
        reaction.direction ?? null,

      authorized:
        reaction.authorized === true,

      confirmed:
        reactionConfirmed,
    },

    sourceParticipation: {
      engine:
        participation.engine ?? null,

      source:
        participation.source ??
        selected.source,

      state:
        participation.participationState ||
        participation.state ||
        null,

      quality:
        participation
          .participationQuality ||
        participation.quality ||
        null,

      intendedDirection:
        participation.intendedDirection ||
        participation.direction ||
        null,

      allowed:
        participation.allowed === true,

      confirmed:
        participation.confirmed === true,

      hardBlocked,

      grade:
        participation.grade ?? null,

      risk:
        participation.risk ?? null,
    },

    participationState:
      normalizeParticipationState(
        participation
      ),

    participationQuality:
      normalizeParticipationQuality(
        participation
      ),

    directionMatches,

    volumeScore:
      Number.isFinite(
        Number(participation.volumeScore)
      )
        ? Number(
            participation.volumeScore
          )
        : null,

    relativeVolume:
      Number.isFinite(
        Number(
          participation.relativeVolume
        )
      )
        ? Number(
            participation.relativeVolume
          )
        : null,

    volumeTrend:
      participation.volumeTrend ?? null,

    cleanParticipation:
      participation.cleanParticipation ===
      true,

    noPermissionCreated: true,
    noExecution: true,
    requiresEngine6Permission: true,

    blockers,

    warnings: [],

    reasonCodes: uniqueValues([
      "ENGINE4_AUTHORIZED_REACTION_PARTICIPATION",
      "ENGINE3_AUTHORIZED_REACTION_CONSUMED",
      "CANDIDATE_ID_PRESERVED",
      "ZONE_ID_PRESERVED",
      directionMatches
        ? "PARTICIPATION_DIRECTION_MATCHES_AUTHORIZED_REACTION"
        : "PARTICIPATION_DIRECTION_CONFLICT",
      confirmed
        ? "PARTICIPATION_CONFIRMED_FOR_AUTHORIZED_REACTION"
        : null,
      ...(
        Array.isArray(
          participation.reasonCodes
        )
          ? participation.reasonCodes
          : []
      ),
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
      "ENGINE6_FINAL_PERMISSION_REQUIRED",
    ]),
  };
}

export function attachEngine4AuthorizedReactionParticipation({
  patchedConfluence,
} = {}) {
  if (
    !patchedConfluence ||
    typeof patchedConfluence !== "object"
  ) {
    return patchedConfluence;
  }

  patchedConfluence.context =
    patchedConfluence.context || {};

  patchedConfluence.context.reaction =
    patchedConfluence.context.reaction ||
    {};

  patchedConfluence.context.volume =
    patchedConfluence.context.volume ||
    {};

  const result =
    buildEngine4AuthorizedReactionParticipation({
      paperScalpReaction:
        patchedConfluence
          .context
          .reaction
          .paperScalpReaction ||
        null,

      volumeContext:
        patchedConfluence
          .context
          .volume ||
        null,
    });

  patchedConfluence.context.volume = {
    ...patchedConfluence.context.volume,

    engine4AuthorizedReactionParticipation:
      result,
  };

  return patchedConfluence;
}

export default
  buildEngine4AuthorizedReactionParticipation;
