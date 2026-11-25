function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeDirection(value) {
  const direction = upper(value);

  if (["UP", "LONG", "BULLISH"].includes(direction)) {
    return "LONG";
  }

  if (["DOWN", "SHORT", "BEARISH"].includes(direction)) {
    return "SHORT";
  }

  return "NEUTRAL";
}

function lastClose(bars = []) {
  const list = Array.isArray(bars) ? bars : [];
  const last = list[list.length - 1] || null;

  return toNum(last?.close ?? last?.c);
}

function pickCurrentPrice({
  sourceStrategy,
  degreeState,
  triggerBars,
}) {
  /*
   * Strategy 1 canonical price ownership:
   * Engine 26A location candidate first.
   *
   * Legacy Engine 26 planner/watch prices remain compatibility-only
   * fallbacks and must not outrank the canonical child candidate.
   */
  const candidates = [
    sourceStrategy?.engine26LocationCandidate?.currentPrice,
    sourceStrategy?.confluence?.price,
    sourceStrategy?.confluence?.currentPrice,
    degreeState?.activeFibModel?.currentPrice,
    degreeState?.currentPrice,
    lastClose(triggerBars),

    // Compatibility-only fallbacks.
    sourceStrategy?.engine26PaperTradePlan?.currentPrice,
    sourceStrategy?.engine26ImbalanceWatch?.currentPrice,
  ];

  for (const candidate of candidates) {
    const value = toNum(candidate);

    if (value != null && value > 0) {
      return value;
    }
  }

  return null;
}

function pickFastReaction(
  sourceStrategy,
  lane
) {
  const reaction =
    sourceStrategy?.confluence?.context?.reaction || {};

  /*
   * Minute Strategy 1 canonical reaction:
   * confluence.context.reaction.paperScalpReaction
   *
   * Do not silently replace it with the fast reaction,
   * currentLevelAction, or the broad reaction container.
   */
  if (lane?.laneId === "minute") {
    return (
      reaction.paperScalpReaction ||
      null
    );
  }

  /*
   * Other lanes retain their existing compatibility selection.
   */
  return (
    (
      reaction.engine3FastImbalanceReaction?.active === true
        ? reaction.engine3FastImbalanceReaction
        : null
    ) ||
    (
      reaction.paperScalpReaction?.active === true
        ? reaction.paperScalpReaction
        : null
    ) ||
    (
      reaction.currentLevelAction?.active === true
        ? reaction.currentLevelAction
        : null
    ) ||
    reaction
  );
}

function buildReactionContext({
  sourceStrategy,
  direction,
  lane,
}) {
  const reaction =
    pickFastReaction(
      sourceStrategy,
      lane
    ) || {};

  const state =
    reaction.state ||
    reaction.structureState ||
    reaction.reactionState ||
    "UNKNOWN";

  const reactionDirection = normalizeDirection(
    reaction.direction ||
    reaction.reactionDirection
  );

  const active =
    reaction.active === true ||
    reaction.armed === true ||
    reaction.confirmed === true ||
    upper(state) !== "UNKNOWN";

  const directionMatches =
    direction === "NEUTRAL" ||
    reactionDirection === "NEUTRAL" ||
    reactionDirection === direction;

  const confirmed =
    directionMatches &&
    (
      reaction.confirmed === true ||
      reaction.allowed === true ||
      ["GOOD", "STRONG", "CONFIRMED"].includes(
        upper(reaction.quality)
      ) ||
      upper(state).includes("RECLAIM") ||
      upper(state).includes("HELD") ||
      upper(state).includes("REJECT") ||
      upper(state).includes("LOST") ||
      upper(state).includes("BREAKOUT_FAILING")
    );

  return {
    active,
    state,
    quality: reaction.quality || null,
    direction: reactionDirection,
    directionMatches,
    confirmed,
    source:
      reaction.engine ||
      reaction.source ||
      "confluence.context.reaction",
  };
}

function buildParticipationContext(
  sourceStrategy,
  lane
) {
  const volume =
    sourceStrategy?.confluence?.context?.volume || {};

  /*
   * Minute Strategy 1 canonical participation:
   * confluence.context.volume.engine4AuthorizedReactionParticipation
   *
   * No fast/current/lifecycle participation object may silently
   * replace this contract for the Minute Strategy 1 decision.
   */
  const participation =
    lane?.laneId === "minute"
      ? (
          volume.engine4AuthorizedReactionParticipation ||
          null
        )
      : (
          (
            volume.engine4FastImbalanceParticipation?.active === true
              ? volume.engine4FastImbalanceParticipation
              : null
          ) ||
          (
            volume.engine4CurrentScalpParticipation?.active === true
              ? volume.engine4CurrentScalpParticipation
              : null
          ) ||
          volume.engine22LifecycleParticipation
            ?.paperScalpParticipation ||
          volume
        );

  if (!participation) {
    return {
      active: false,
      state: "UNKNOWN",
      quality: null,
      allowed: false,
      hardBlocked: false,
      risk: null,
      source:
        lane?.laneId === "minute"
          ? "confluence.context.volume.engine4AuthorizedReactionParticipation"
          : "confluence.context.volume",
    };
  }

  return {
    active:
      participation?.active === true ||
      participation?.volumeConfirmed === true ||
      participation?.allowed === true,

    state:
      participation?.participationState ||
      participation?.status ||
      participation?.state ||
      "UNKNOWN",

    quality:
      participation?.participationQuality ||
      participation?.quality ||
      null,

    allowed:
      participation?.participationConfirmed === true ||
      participation?.allowed === true ||
      participation?.confirmed === true ||
      participation?.volumeConfirmed === true,

    hardBlocked:
      participation?.hardBlocked === true,

    risk:
      participation?.risk || null,

    source:
      participation?.engine ||
      (
        lane?.laneId === "minute"
          ? "confluence.context.volume.engine4AuthorizedReactionParticipation"
          : "confluence.context.volume"
      ),
  };
}

function pickDegreeLevel(degreeState, direction) {
  const targetModel = degreeState?.targetModel || {};
  const correction = degreeState?.correctionModel || {};
  const marks = degreeState?.marks || {};

  const levelCandidates =
    direction === "SHORT"
      ? [
          correction?.bBounceZone?.hi,
          correction?.levels?.r618,
          marks?.B?.price,
          marks?.W3?.price,
        ]
      : [
          targetModel?.localSupportWatch,
          correction?.bBounceZone?.lo,
          correction?.levels?.r500,
          marks?.W2?.price,
          marks?.W4?.price,
        ];

  for (const candidate of levelCandidates) {
    const value = toNum(candidate);

    if (value != null && value > 0) {
      return {
        source: "ENGINE22_DEGREE_STATE",
        type: "PRICE",
        price: value,
        lo: value,
        hi: value,
      };
    }
  }

  return null;
}

function pickActiveLevel({
  lane,
  sourceStrategy,
  degreeState,
}) {
  if (
    ["subminute", "minute"].includes(
      lane.laneId
    )
  ) {
    const candidate =
      sourceStrategy
        ?.engine26LocationCandidate ||
      null;

    if (candidate) {
      const candidateZone =
        candidate?.location?.zone ||
        candidate?.zone ||
        null;

      const lo =
        toNum(
          candidateZone?.lo ??
          candidateZone?.low ??
          candidate?.acceptanceBoundary ??
          candidate?.triggerLevel
        );

      const hi =
        toNum(
          candidateZone?.hi ??
          candidateZone?.high ??
          candidate?.reclaimBoundary ??
          candidate?.triggerLevel
        );

      if (lo != null && hi != null) {
        return {
          source:
            "ENGINE26_LOCATION_CANDIDATE",

          type:
            candidateZone?.zoneType ||
            candidate?.setupClass ||
            candidate?.setupType ||
            "STRATEGY1_LOCATION",

          id:
            candidate?.zoneId ||
            candidateZone?.id ||
            null,

          candidateId:
            candidate?.candidateId ||
            null,

          zoneId:
            candidate?.zoneId ||
            null,

          lo:
            Math.min(lo, hi),

          hi:
            Math.max(lo, hi),

          relation:
            candidate?.directionState ||
            candidate?.status ||
            candidate?.location
              ?.priceLocation ||
            null,
        };
      }

      const trigger =
        toNum(
          candidate?.triggerLevel
        );

      if (trigger != null) {
        return {
          source:
            "ENGINE26_LOCATION_CANDIDATE",

          type:
            candidate?.setupClass ||
            candidate?.setupType ||
            "STRATEGY1_LOCATION",

          id:
            candidate?.zoneId ||
            null,

          candidateId:
            candidate?.candidateId ||
            null,

          zoneId:
            candidate?.zoneId ||
            null,

          lo: trigger,
          hi: trigger,

          relation:
            candidate?.directionState ||
            candidate?.status ||
            null,
        };
      }

      /*
       * A canonical Strategy 1 candidate exists but does not currently
       * expose a usable numeric level. Do not silently fall back to the
       * old structural/watch objects.
       */
      if (lane.laneId === "minute") {
        return null;
      }
    }

    /*
     * Subminute compatibility only.
     * Minute Strategy 1 intentionally does not use these fallbacks.
     */
    if (lane.laneId === "subminute") {
      const location =
        sourceStrategy
          ?.engine26LocationContext ||
        null;

      const zone =
        location?.zone ||
        null;

      const lo =
        toNum(zone?.lo);

      const hi =
        toNum(zone?.hi);

      if (lo != null && hi != null) {
        return {
          source:
            "ENGINE26_SUBMINUTE_LOCATION_CONTEXT",
          type:
            zone?.zoneType ||
            "ZONE",
          id:
            zone?.id ||
            null,
          lo:
            Math.min(lo, hi),
          hi:
            Math.max(lo, hi),
          relation:
            location?.priceLocation ||
            location?.locationRead ||
            null,
        };
      }
    }
  }

  return pickDegreeLevel(
    degreeState,
    normalizeDirection(
      degreeState?.direction
    )
  );
}

function classifyProximity({
  currentPrice,
  activeLevel,
  triggerTimeframe,
}) {
  if (currentPrice == null || !activeLevel) {
    return {
      state: "UNKNOWN",
      distancePoints: null,
    };
  }

  const lo = toNum(
    activeLevel.lo ?? activeLevel.price
  );

  const hi = toNum(
    activeLevel.hi ?? activeLevel.price
  );

  if (lo == null || hi == null) {
    return {
      state: "UNKNOWN",
      distancePoints: null,
    };
  }

  const low = Math.min(lo, hi);
  const high = Math.max(lo, hi);

  if (
    currentPrice >= low &&
    currentPrice <= high
  ) {
    return {
      state: "AT_LEVEL",
      distancePoints: 0,
    };
  }

  const distancePoints =
    currentPrice < low
      ? low - currentPrice
      : currentPrice - high;

  const approachingThreshold =
    triggerTimeframe === "10m"
      ? 8
      : triggerTimeframe === "1h"
      ? 18
      : triggerTimeframe === "4h"
      ? 35
      : 60;

  return {
    state:
      distancePoints <= approachingThreshold
        ? "APPROACHING"
        : "FAR",

    distancePoints:
      Number(distancePoints.toFixed(2)),
  };
}

function buildPermissionContext({
  lane,
  sourceStrategy,
}) {
  const permission =
    sourceStrategy?.permission || null;

  const paper =
    permission?.paper || null;

  return {
    engine15Required:
      lane.engine15Required === true,

    engine15Bypassed:
      paper?.engine15Bypassed === true,

    engine6Decision:
      paper?.decision ||
      permission?.permission ||
      null,

    engine6Allowed:
      paper?.allowed === true ||
      permission?.executable === true,

    paperOnly:
      paper?.mode === "PAPER_ONLY" ||
      paper?.intradayPaperLane === true,

    realExecutionAllowed:
      paper?.realExecutionAllowed === true,

    brokerExecutionAllowed:
      paper?.brokerExecutionAllowed === true,

    schwabExecutionAllowed:
      paper?.schwabExecutionAllowed === true,
  };
}

function buildPlannerContext({
  lane,
  sourceStrategy,
}) {
  if (
    !["subminute", "minute"].includes(
      lane.laneId
    )
  ) {
    return {
      available: false,
      status: "NOT_AVAILABLE_FOR_LANE",
      ready: false,
    };
  }

  /*
   * Canonical single-direction proposed geometry.
   * This is geometry availability only; it is not permission.
   */
  const geometry =
    sourceStrategy
      ?.engine26ProposedGeometry ||
    null;

  if (!geometry) {
    return {
      available: false,
      status: "NOT_AVAILABLE",
      ready: false,
      geometrySource:
        "engine26ProposedGeometry",
    };
  }

  const status =
    geometry.lifecycleStatus ||
    geometry.status ||
    null;

  const ready =
    geometry.active === true &&
    upper(status) ===
      "PROPOSED_GEOMETRY_AVAILABLE";

  return {
    available: true,

    status,

    ready,

    geometrySource:
      "engine26ProposedGeometry",

    entryPrice:
      geometry.proposedEntryPrice ??
      null,

    stopPrice:
      geometry.proposedStopPrice ??
      null,

    targetPrice:
      Array.isArray(
        geometry.proposedTargets
      )
        ? (
            geometry
              .proposedTargets[0]
              ?.price ??
            null
          )
        : null,

    blockers:
      Array.isArray(
        geometry.blockers
      )
        ? geometry.blockers
        : [],

    warnings:
      Array.isArray(
        geometry.warnings
      )
        ? geometry.warnings
        : [],
  };
}

export function buildEngine27StrategyDecision({
  lane,
  degreeState,
  sourceStrategy,
  triggerBars = [],
  higherTimeframeContext = null,
} = {}) {
  const currentPrice = pickCurrentPrice({
    sourceStrategy,
    degreeState,
    triggerBars,
  });

  const engine26Candidate =
    sourceStrategy
      ?.engine26LocationCandidate ||
    null;

  /*
   * Fast Strategy 1 lanes use the canonical Engine 26A child
   * directional context when a candidate exists.
   *
   * A NEUTRAL candidate remains NEUTRAL; structural direction does
   * not silently replace it.
   */
  const direction =
    ["subminute", "minute"].includes(
      lane?.laneId
    ) &&
    engine26Candidate
      ? normalizeDirection(
          engine26Candidate
            ?.direction ??
          engine26Candidate
            ?.directionBias
        )
      : normalizeDirection(
          degreeState?.direction
        );

  const activeLevel = pickActiveLevel({
    lane,
    sourceStrategy,
    degreeState,
  });

  const proximity = classifyProximity({
    currentPrice,
    activeLevel,
    triggerTimeframe:
      lane?.triggerTimeframe,
  });

  const reaction = buildReactionContext({
    sourceStrategy,
    direction,
    lane,
  });

  const participation =
    buildParticipationContext(
      sourceStrategy,
      lane
    );

  const permissionContext =
    buildPermissionContext({
      lane,
      sourceStrategy,
    });

  const plannerContext =
    buildPlannerContext({
      lane,
      sourceStrategy,
    });

  const degreeActive =
    degreeState?.active === true;

  const invalidated =
    upper(degreeState?.stage).includes("INVALID") ||
    degreeState?.invalidated === true;

  const htfConflict =
    direction === "LONG"
      ? higherTimeframeContext
          ?.conflictsWithLong === true
      : direction === "SHORT"
      ? higherTimeframeContext
          ?.conflictsWithShort === true
      : false;

  const setupReady =
    degreeActive &&
    invalidated !== true &&
    direction !== "NEUTRAL" &&
    ["AT_LEVEL", "APPROACHING"].includes(
      proximity.state
    ) &&
    reaction.confirmed === true &&
    participation.hardBlocked !== true &&
    htfConflict !== true;

  let decision = "WAIT";

  if (!degreeActive) {
    decision = "IGNORE";
  } else if (invalidated) {
    decision = "INVALIDATED";
  } else if (setupReady) {
    decision = "LOOK_NOW";
  } else if (
    ["AT_LEVEL", "APPROACHING"].includes(
      proximity.state
    )
  ) {
    decision = "WATCH";
  } else if (proximity.state === "FAR") {
    decision = "WAIT";
  }

  const waitingFor = [];

  if (!activeLevel) {
    waitingFor.push(
      "STRATEGY_SPECIFIC_ACTIVE_LEVEL"
    );
  }

  if (direction === "NEUTRAL") {
    waitingFor.push(
      "DIRECTIONAL_STRUCTURE"
    );
  }

  if (!reaction.confirmed) {
    waitingFor.push(
      "ENGINE3_DIRECTIONAL_REACTION"
    );
  }

  if (!participation.allowed) {
    waitingFor.push(
      "ENGINE4_PARTICIPATION"
    );
  }

  if (participation.hardBlocked) {
    waitingFor.push(
      "ENGINE4_HARD_BLOCK_TO_CLEAR"
    );
  }

  if (htfConflict) {
    waitingFor.push(
      "HIGHER_TIMEFRAME_CONFLICT_TO_CLEAR"
    );
  }

  if (proximity.state === "FAR") {
    waitingFor.push(
      "PRICE_TO_APPROACH_ACTIVE_LEVEL"
    );
  }

  const pipelineReady =
    permissionContext.engine6Allowed === true &&
    plannerContext.ready === true;

  return {
    active: degreeActive,
    engine: "engine27.strategyDecision.v1",
    mode: "READ_ONLY",

    laneId:
      lane?.laneId || null,

    strategyId:
      lane?.strategyId || null,

    displayName:
      lane?.displayName || null,

    degree:
      lane?.degree || null,

    triggerTimeframe:
      lane?.triggerTimeframe || null,

    contextTimeframes:
      lane?.contextTimeframes || [],

    decision,
    proximity: proximity.state,
    direction,
    currentPrice,
    setupReady,
    pipelineReady,

    waitingFor,
    activeLevel,
    distancePoints:
      proximity.distancePoints,

    reaction,
    participation,
    higherTimeframeContext,
    permissionContext,
    plannerContext,

    geometryToolRecommended:
      lane?.geometrySupported === true &&
      decision === "LOOK_NOW",

    noPermissionCreated: true,
    noSizingCreated: true,
    noTicketCreated: true,
    noExecution: true,
    noJournalWrite: true,

    blockers: [
      ...(invalidated
        ? ["STRATEGY_INVALIDATED"]
        : []),

      ...(participation.hardBlocked
        ? ["ENGINE4_HARD_BLOCK"]
        : []),

      ...(htfConflict
        ? ["HIGHER_TIMEFRAME_CONFLICT"]
        : []),
    ],

    reasonCodes: [
      "ENGINE27_INDEPENDENT_STRATEGY_DECISION",
      `ENGINE27_${upper(lane?.degree)}_LANE`,
      `ENGINE27_DECISION_${decision}`,
      `ENGINE27_PROXIMITY_${proximity.state}`,

      lane?.engine15Required
        ? "ENGINE15_REQUIRED_FOR_LANE"
        : "ENGINE15_NOT_REQUIRED_FOR_LANE",

      "READ_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildEngine27StrategyDecision;
