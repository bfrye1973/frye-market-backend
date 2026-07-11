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
  const candidates = [
    sourceStrategy?.engine26PaperTradePlan?.currentPrice,
    sourceStrategy?.engine26ImbalanceWatch?.currentPrice,
    sourceStrategy?.confluence?.price,
    sourceStrategy?.confluence?.currentPrice,
    degreeState?.currentPrice,
    lastClose(triggerBars),
  ];

  for (const candidate of candidates) {
    const value = toNum(candidate);

    if (value != null && value > 0) {
      return value;
    }
  }

  return null;
}

function pickFastReaction(sourceStrategy) {
  const reaction =
    sourceStrategy?.confluence?.context?.reaction || {};

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
}) {
  const reaction = pickFastReaction(sourceStrategy) || {};

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

function buildParticipationContext(sourceStrategy) {
  const volume =
    sourceStrategy?.confluence?.context?.volume || {};

  const participation =
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
    volume;

  return {
    active:
      participation?.active === true ||
      participation?.volumeConfirmed === true ||
      participation?.allowed === true,

    state:
      participation?.participationState ||
      participation?.state ||
      "UNKNOWN",

    quality:
      participation?.participationQuality ||
      participation?.quality ||
      null,

    allowed:
      participation?.allowed === true ||
      participation?.confirmed === true ||
      participation?.volumeConfirmed === true,

    hardBlocked:
      participation?.hardBlocked === true,

    risk:
      participation?.risk || null,

    source:
      participation?.engine ||
      "confluence.context.volume",
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
    ["subminute", "minute"].includes(lane.laneId)
  ) {
    const location =
      sourceStrategy
        ?.engine26StructuralContext
        ?.locationContext;

    const zone = location?.zone;

    const imbalance =
      sourceStrategy
        ?.engine26ImbalanceWatch
        ?.activeImbalance;

    const lo = toNum(
      zone?.lo ?? imbalance?.lo
    );

    const hi = toNum(
      zone?.hi ?? imbalance?.hi
    );

    if (lo != null && hi != null) {
      return {
        source: "ENGINE26",
        type:
          zone?.zoneType ||
          imbalance?.zoneType ||
          "ZONE",
        id:
          zone?.id ||
          imbalance?.id ||
          null,
        lo: Math.min(lo, hi),
        hi: Math.max(lo, hi),
        relation:
          location?.priceLocation ||
          location?.locationRead ||
          null,
      };
    }
  }

  return pickDegreeLevel(
    degreeState,
    normalizeDirection(degreeState?.direction)
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
  const plan =
    sourceStrategy?.engine26PaperTradePlan || null;

  if (
    !["subminute", "minute"].includes(lane.laneId) ||
    !plan
  ) {
    return {
      available: false,
      status: "NOT_AVAILABLE_FOR_LANE",
      ready: false,
    };
  }

  return {
    available: true,

    status:
      plan.status || null,

    ready:
      plan.active === true &&
      plan.allowed === true &&
      Array.isArray(plan.blockers) &&
      plan.blockers.length === 0,

    geometrySource:
      plan.geometrySource || null,

    entryPrice:
      plan.entryPrice ?? null,

    stopPrice:
      plan.stopPrice ?? null,

    targetPrice:
      plan.targetPrice ?? null,

    blockers:
      Array.isArray(plan.blockers)
        ? plan.blockers
        : [],

    warnings:
      Array.isArray(plan.warnings)
        ? plan.warnings
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

  const direction = normalizeDirection(
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
  });

  const participation =
    buildParticipationContext(sourceStrategy);

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
