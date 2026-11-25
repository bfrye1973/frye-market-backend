// services/core/logic/engine26/strategy1/buildStrategy1GeometryPreviews.js

const ENGINE = "engine26B.strategy1GeometryPreviews.v1";
const MODE = "PREVIEW_ONLY";
const STRATEGY_ID = "intraday_scalp@10m";
const LANE_ID = "minute";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function firstNum(...values) {
  for (const value of values) {
    const n = toNum(value);
    if (n != null) return n;
  }

  return null;
}

function buildUnavailablePreview({
  symbol,
  strategyId,
  snapshotTime,
  structuralContext = null,
  structuralOnlyPreview = null,
  reasonCode,
}) {
  return {
    active: structuralOnlyPreview?.active === true,
    engine: ENGINE,
    mode: MODE,
    status:
      structuralOnlyPreview?.active === true
        ? "STRUCTURAL_SHORT_PREVIEW_WAITING_FOR_NEGOTIATED_LOCATION"
        : "WAITING_FOR_VALID_NEGOTIATED_LOCATION",

    symbol: safeUpper(symbol || "ES"),
    strategyId: strategyId || STRATEGY_ID,
    laneId: LANE_ID,
    snapshotTime: snapshotTime || null,

    /*
     * IMPORTANT:
     * location remains null when there is no valid Engine 26A negotiated
     * Strategy 1 location. Engine 22 structural context must never fabricate
     * an Engine 26A location.
     */
    location: null,

    lifecycle: {
      state: "WAITING_FOR_NEGOTIATED_LOCATION",
      direction: "NEUTRAL",
      locationRequired: true,
    },

    structuralContext,
    structuralOnlyPreview,

    optionA: null,
    optionB: null,
    selectedOption: null,

    decisionSummary:
      structuralOnlyPreview?.active === true
        ? {
            short:
              structuralOnlyPreview.currentDecision ||
              "STRUCTURAL SHORT WATCH — WAITING FOR NEGOTIATED LOCATION",
            long: "WAITING FOR NEGOTIATED LOCATION",
            engine3: "WAITING_FOR_ENGINE26A_LOCATION",
            engine4: "WAITING_FOR_ENGINE3",
            engine6: "FINAL_PERMISSION",
          }
        : {
            short: "WAITING FOR NEGOTIATED LOCATION",
            long: "WAITING FOR NEGOTIATED LOCATION",
            engine3: "WAITING_FOR_ENGINE26A_LOCATION",
            engine4: "WAITING_FOR_ENGINE3",
            engine6: "FINAL_PERMISSION",
          },

    previewOnly: true,
    noPermissionCreated: true,
    noExecution: true,

    reasonCodes: [
      reasonCode || "ENGINE26_VALID_NEGOTIATED_LOCATION_REQUIRED",
      structuralOnlyPreview?.active === true
        ? "ENGINE22_C_DOWN_STRUCTURAL_PREVIEW_AVAILABLE"
        : null,
      "ENGINE26A_NEGOTIATED_LOCATION_OWNERSHIP_PRESERVED",
      "PREVIEW_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ].filter(Boolean),
  };
}

function makeFibLevel({
  key,
  price,
  activeWave,
  label = null,
  source = "ENGINE22_ACTIVE_FIB_MODEL",
}) {
  const normalizedWave = safeUpper(activeWave);

  return {
    key,
    price,
    label:
      label ||
      (
        normalizedWave === "W4"
          ? `W4 ${String(key || "").toLowerCase()}`
          : `${normalizedWave || "ACTIVE WAVE"} ${String(
              key || ""
            ).toLowerCase()}`
      ),
    source,
  };
}

function buildCDownStructuralContext({
  minuteState,
  targetModel,
  activeFibModel,
}) {
  const modelType = safeUpper(
    targetModel?.modelType ||
      targetModel?.modelKey ||
      activeFibModel?.modelType ||
      activeFibModel?.modelKey
  );

  const cDownActive =
    modelType === "C_DOWN_EXTENSION_LADDER" ||
    safeUpper(targetModel?.modelType) === "C_DOWN_EXTENSION_LADDER" ||
    safeUpper(targetModel?.modelKey) === "C_DOWN_EXTENSION_LADDER" ||
    safeUpper(activeFibModel?.modelType) === "C_DOWN_EXTENSION_LADDER" ||
    safeUpper(activeFibModel?.modelKey) === "C_DOWN_EXTENSION_LADDER";

  if (!cDownActive) {
    return {
      active: false,
      model: null,
      structuralOnlyPreview: null,
    };
  }

  /*
   * Consume published Engine 22 values only.
   *
   * The aliases below are transport compatibility only. They do not
   * calculate, derive, or recreate the ABC structure.
   */
  const sourceModel =
    safeUpper(activeFibModel?.modelType) === "C_DOWN_EXTENSION_LADDER" ||
    safeUpper(activeFibModel?.modelKey) === "C_DOWN_EXTENSION_LADDER"
      ? activeFibModel
      : targetModel;

  const levels =
    sourceModel?.levels && typeof sourceModel.levels === "object"
      ? sourceModel.levels
      : {};

  const anchorModel =
    sourceModel?.anchorModel && typeof sourceModel.anchorModel === "object"
      ? sourceModel.anchorModel
      : {};

const invalidationLevel = firstNum(
  sourceModel?.invalidationLevel,
  sourceModel?.reclaimInvalidation,
  sourceModel?.reclaimInvalidationLevel,
  sourceModel?.riskModel?.invalidationLevel,
  sourceModel?.riskModel?.bHigh,
  minuteState?.internalStructure?.invalidationLevel
);

const bHigh = firstNum(
  sourceModel?.bHigh,
  sourceModel?.waveBHigh,
  sourceModel?.anchorHigh,
  anchorModel?.anchorHigh,
  anchorModel?.bHigh,
  minuteState?.internalStructure?.bHigh,
  minuteState?.internalStructure?.waveBHigh,
  invalidationLevel
);

  const nextPrice = firstNum(
    sourceModel?.nextPrice,
    sourceModel?.nextTarget,
    sourceModel?.firstTarget,
    sourceModel?.firstDestination,
    sourceModel?.nextLevelBelow?.price,
    levels?.c100,
    levels?.C100,
    levels?.e100,
    levels?.E100
  );

  const secondDestination = firstNum(
    sourceModel?.secondDestination,
    sourceModel?.secondTarget,
    sourceModel?.nextSecondaryTarget,
    levels?.c1272,
    levels?.C1272,
    levels?.e1272,
    levels?.E1272
  );

  const primaryTarget = firstNum(
    sourceModel?.primaryTarget,
    sourceModel?.primaryDestination,
    sourceModel?.target,
    sourceModel?.primaryCTarget,
    sourceModel?.primaryCDownTarget,
    levels?.c1618,
    levels?.C1618,
    levels?.e1618,
    levels?.E1618
  );

  const currentPrice = firstNum(
    sourceModel?.currentPrice,
    targetModel?.currentPrice,
    activeFibModel?.currentPrice,
    minuteState?.currentPrice
  );

  const shortTargets = [
    nextPrice != null
      ? makeFibLevel({
          key: "firstDestination",
          price: nextPrice,
          activeWave: "W4",
          label: "First C-down destination",
          source: "ENGINE22_C_DOWN_EXTENSION_LADDER",
        })
      : null,

    secondDestination != null
      ? makeFibLevel({
          key: "secondDestination",
          price: secondDestination,
          activeWave: "W4",
          label: "Next C-down destination",
          source: "ENGINE22_C_DOWN_EXTENSION_LADDER",
        })
      : null,

    primaryTarget != null
      ? makeFibLevel({
          key: "primaryDestination",
          price: primaryTarget,
          activeWave: "W4",
          label: "Primary C-down destination",
          source: "ENGINE22_C_DOWN_EXTENSION_LADDER",
        })
      : null,
  ]
    .filter(Boolean)
    .filter(
      (item, index, arr) =>
        index === 0 || item.price !== arr[index - 1].price
    );

  const model = {
    active: true,
    modelKey:
      sourceModel?.modelKey ||
      sourceModel?.modelType ||
      "C_DOWN_EXTENSION_LADDER",
    modelType: "C_DOWN_EXTENSION_LADDER",
    activeWave:
      sourceModel?.activeWave ||
      minuteState?.activeWave ||
      "W4",
    direction: "DOWN",
    purpose:
      sourceModel?.purpose ||
      "ACTIVE_PARENT_WAVE_STRUCTURAL_MAP",
    bHigh,
    invalidationLevel,
    currentPrice,
    firstDestination: nextPrice,
    secondDestination,
    primaryDestination: primaryTarget,
    source: "ENGINE22_C_DOWN_EXTENSION_LADDER",
  };

  const structuralOnlyPreview = {
    active: true,
    type: "STRUCTURAL_SHORT_PREVIEW",
    direction: "SHORT",
    status: "PREVIEW_AVAILABLE_WAITING_FOR_NEGOTIATED_LOCATION",
    previewOnly: true,

    locationAttached: false,
    locationStatus: "WAITING_FOR_NEGOTIATED_LOCATION",

    controlLevel: bHigh,
    reclaimBoundary: bHigh,
    invalidationLevel,

    triggerInstruction:
      bHigh != null
        ? `Failed reclaim / hold below ${bHigh.toFixed(2)}`
        : "Failed reclaim / hold below Engine 22 B high",

    levelsWatched: [
      watchedLevel({
        price: bHigh,
        label: "B high / reclaim invalidation",
        role: "C_DOWN_RECLAIM_INVALIDATION",
        source: "ENGINE22_C_DOWN_EXTENSION_LADDER",
      }),
      ...shortTargets.map((target, index) =>
        watchedLevel({
          price: target.price,
          label: target.label,
          role:
            index === 0
              ? "FIRST_STRUCTURAL_DESTINATION"
              : target.key === "primaryDestination"
              ? "PRIMARY_STRUCTURAL_DESTINATION"
              : "STRUCTURAL_DESTINATION",
          source: target.source,
        })
      ),
    ].filter(Boolean),

    structuralTargets: shortTargets,

    firstStructuralDestination: shortTargets[0] || null,

    primaryStructuralDestination:
      shortTargets.find(
        (target) => target.key === "primaryDestination"
      ) || null,

    currentDecision:
      bHigh != null
        ? `STRUCTURAL SHORT WATCH BELOW ${bHigh.toFixed(
            2
          )} — WAITING FOR NEGOTIATED LOCATION`
        : "STRUCTURAL SHORT WATCH — WAITING FOR NEGOTIATED LOCATION",

    noPermissionCreated: true,
    noExecution: true,

    reasonCodes: [
      "ENGINE22_C_DOWN_EXTENSION_LADDER_CONSUMED",
      "ENGINE26A_NEGOTIATED_LOCATION_STILL_REQUIRED",
      "STRUCTURAL_CONTEXT_ONLY",
      "PREVIEW_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };

  return {
    active: true,
    model,
    structuralOnlyPreview,
  };
}

function buildStructuralContext({
  minuteState,
  activeFibModel,
  targetModel,
  shortTrigger,
  longTrigger,
}) {
  const cDown = buildCDownStructuralContext({
    minuteState,
    targetModel,
    activeFibModel,
  });

  if (cDown.active) {
    return {
      model: cDown.model,
      shortTargets:
        cDown.structuralOnlyPreview?.structuralTargets || [],
      longTargets: [],
      anchorHigh: cDown.model?.bHigh || null,
      structuralOnlyPreview: cDown.structuralOnlyPreview,
      modelFamily: "C_DOWN_EXTENSION_LADDER",
    };
  }

  const model =
    activeFibModel && typeof activeFibModel === "object"
      ? activeFibModel
      : null;

  if (!model?.active) {
    return {
      model: null,
      shortTargets: [],
      longTargets: [],
      anchorHigh: null,
      structuralOnlyPreview: null,
      modelFamily: null,
    };
  }

  const levels =
    model.levels && typeof model.levels === "object"
      ? Object.entries(model.levels)
          .map(([key, value]) => ({
            key,
            price: toNum(value),
          }))
          .filter((item) => item.price != null)
      : [];

  const shortTargets = levels
    .filter(
      (item) =>
        shortTrigger != null &&
        item.price < shortTrigger
    )
    .sort((a, b) => b.price - a.price)
    .map((item) =>
      makeFibLevel({
        ...item,
        activeWave: model.activeWave,
      })
    );

  const longFibTargets = levels
    .filter(
      (item) =>
        longTrigger != null &&
        item.price > longTrigger
    )
    .sort((a, b) => a.price - b.price)
    .map((item) =>
      makeFibLevel({
        ...item,
        activeWave: model.activeWave,
      })
    );

  const anchorHigh = toNum(model?.anchorModel?.anchorHigh);

  const anchorHighTarget =
    anchorHigh != null &&
    longTrigger != null &&
    anchorHigh > longTrigger
      ? {
          key: "anchorHigh",
          price: anchorHigh,
          label:
            safeUpper(model.activeWave) === "W4"
              ? "W3 high / W4 anchor high"
              : "Active fib anchor high",
          source: "ENGINE22_ACTIVE_FIB_MODEL",
        }
      : null;

  const longTargets = [
    ...longFibTargets,
    ...(anchorHighTarget ? [anchorHighTarget] : []),
  ]
    .sort((a, b) => a.price - b.price)
    .filter(
      (item, index, arr) =>
        index === 0 ||
        item.price !== arr[index - 1].price
    );

  return {
    model: {
      active: model.active === true,
      modelKey: model.modelKey || null,
      modelType: model.modelType || null,
      activeWave: model.activeWave || null,
      direction: model.direction || null,
      purpose: model.purpose || null,
      anchorModel: model.anchorModel || null,
      zoneState: model.zoneState || null,
    },
    shortTargets,
    longTargets,
    anchorHigh,
    structuralOnlyPreview: null,
    modelFamily: safeUpper(
      model.modelType || model.modelKey
    ),
  };
}

function watchedLevel({ price, label, role, source }) {
  const numericPrice = toNum(price);
  if (numericPrice == null) return null;

  return {
    price: numericPrice,
    label,
    role,
    source,
  };
}

function buildShortOption({
  shortBoundaries,
  zoneMid,
  structuralTargets,
  structuralContext,
}) {
  const triggerLevel = toNum(
    shortBoundaries?.triggerLevel
  );
  const acceptanceBoundary = toNum(
    shortBoundaries?.acceptanceBoundary
  );
  const reclaimBoundary = toNum(
    shortBoundaries?.reclaimBoundary
  );
  const locationInvalidationLevel = toNum(
    shortBoundaries?.locationInvalidationBoundary
  );

  const cDownMode =
    safeUpper(structuralContext?.modelType) ===
    "C_DOWN_EXTENSION_LADDER";

  /*
   * Engine 26A negotiated-zone boundaries remain canonical for the
   * Strategy 1 location.
   *
   * Engine 22 C-down B-high is structural context only and must not
   * silently replace Engine 26A's negotiated-zone invalidation.
   */
  const levelsWatched = [
    watchedLevel({
      price: reclaimBoundary,
      label: "Upper zone / SHORT reclaim",
      role: "RECLAIM_FAILURE_LEVEL",
      source: "ENGINE26_DIRECTIONAL_BOUNDARIES",
    }),
    watchedLevel({
      price: zoneMid,
      label: "Negotiated midline",
      role: "NEGOTIATED_MIDLINE",
      source: "ENGINE26_NEGOTIATED_LOCATION",
    }),
    watchedLevel({
      price: triggerLevel,
      label: "SHORT trigger / acceptance",
      role: "SHORT_TRIGGER_ACCEPTANCE",
      source: "ENGINE26_DIRECTIONAL_BOUNDARIES",
    }),

    cDownMode
      ? watchedLevel({
          price: structuralContext?.bHigh,
          label: "Engine 22 B high / structural reclaim invalidation",
          role: "STRUCTURAL_RECLAIM_INVALIDATION",
          source: "ENGINE22_C_DOWN_EXTENSION_LADDER",
        })
      : null,

    ...structuralTargets.map((target, index) =>
      watchedLevel({
        price: target.price,
        label: `${target.label}${
          index === 0
            ? " — first structural destination"
            : ""
        }`,
        role:
          index === 0
            ? "FIRST_STRUCTURAL_DESTINATION"
            : target.key === "primaryDestination"
            ? "PRIMARY_STRUCTURAL_DESTINATION"
            : "STRUCTURAL_DESTINATION",
        source: target.source,
      })
    ),
  ].filter(Boolean);

  return {
    optionId: "A",
    direction: "SHORT",
    title: "OPTION A — SHORT",
    status: "PREVIEW_ONLY",
    previewOnly: true,

    triggerLevel,
    triggerInstruction:
      cDownMode && structuralContext?.bHigh != null
        ? `Engine 26A trigger ${triggerLevel?.toFixed(
            2
          ) ?? "—"}; structural C-down watch remains below B high ${Number(
            structuralContext.bHigh
          ).toFixed(2)}`
        : "Lose / fail reclaim below lower boundary",

    acceptanceBoundary,
    acceptanceInstruction: "Bearish acceptance below zone",

    reclaimBoundary,
    reclaimInstruction:
      "Acceptance back above upper negotiated boundary defeats Engine 26A SHORT location thesis",

    /*
     * Strategy 1 location invalidation remains Engine 26A-owned.
     */
    invalidationLevel: locationInvalidationLevel,
    invalidationInstruction:
      "Engine 26A SHORT location invalid beyond negotiated-zone invalidation",

    structuralInvalidationLevel:
      cDownMode
        ? toNum(structuralContext?.invalidationLevel)
        : null,

    structuralInvalidationInstruction:
      cDownMode
        ? "Engine 22 C-down structure invalid / reclaimed above B high"
        : null,

    levelsWatched,
    structuralTargets,
    firstStructuralDestination:
      structuralTargets[0] || null,

    primaryStructuralDestination:
      structuralTargets.find(
        (target) => target.key === "primaryDestination"
      ) || null,

    nextNegotiatedDestination: {
      available: false,
      price: null,
      label: "NOT AVAILABLE YET",
    },

    engine3RequiredStates: [
      "LOST_LEVEL",
      "FAILED_RECLAIM",
      "REJECTING_VALUE",
      "BREAKOUT_FAILING",
    ],

    engine4Requirement:
      "SHORT_PARTICIPATION_REQUIRED",
    engine6Requirement:
      "FINAL_PERMISSION_REQUIRED",

    currentDecision:
      triggerLevel != null
        ? `WAITING FOR ${triggerLevel.toFixed(
            2
          )} LOSS / FAILED RECLAIM`
        : "WAITING FOR SHORT TRIGGER",

    noPermissionCreated: true,
    noExecution: true,
  };
}

function buildLongOption({
  longBoundaries,
  zoneMid,
  structuralTargets,
}) {
  const triggerLevel = toNum(
    longBoundaries?.triggerLevel
  );
  const acceptanceBoundary = toNum(
    longBoundaries?.acceptanceBoundary
  );
  const reclaimBoundary = toNum(
    longBoundaries?.reclaimBoundary
  );
  const invalidationLevel = toNum(
    longBoundaries?.locationInvalidationBoundary
  );

  const levelsWatched = [
    watchedLevel({
      price: reclaimBoundary,
      label: "Lower zone / LONG reclaim",
      role: "RECLAIM_FAILURE_LEVEL",
      source: "ENGINE26_DIRECTIONAL_BOUNDARIES",
    }),
    watchedLevel({
      price: zoneMid,
      label: "Negotiated midline",
      role: "NEGOTIATED_MIDLINE",
      source: "ENGINE26_NEGOTIATED_LOCATION",
    }),
    watchedLevel({
      price: triggerLevel,
      label: "LONG trigger / acceptance",
      role: "LONG_TRIGGER_ACCEPTANCE",
      source: "ENGINE26_DIRECTIONAL_BOUNDARIES",
    }),
    ...structuralTargets.map((target) =>
      watchedLevel({
        price: target.price,
        label: target.label,
        role: "STRUCTURAL_REFERENCE",
        source: target.source,
      })
    ),
  ].filter(Boolean);

  return {
    optionId: "B",
    direction: "LONG",
    title: "OPTION B — LONG",
    status: "PREVIEW_ONLY",
    previewOnly: true,

    triggerLevel,
    triggerInstruction:
      "Break / accept above upper boundary",

    acceptanceBoundary,
    acceptanceInstruction:
      "Bullish acceptance above zone",

    reclaimBoundary,
    reclaimInstruction:
      "Loss of lower boundary defeats LONG thesis",

    invalidationLevel,
    invalidationInstruction:
      "LONG location invalid beyond here",

    levelsWatched,
    structuralTargets,
    firstStructuralDestination:
      structuralTargets[0] || null,

    nextNegotiatedDestination: {
      available: false,
      price: null,
      label: "NOT AVAILABLE YET",
    },

    engine3RequiredStates: [
      "HELD_LEVEL",
      "RECLAIMED_LEVEL",
      "WICK_BELOW_AND_RECLAIM",
      "BREAKOUT_HOLDING",
    ],

    engine4Requirement:
      "LONG_PARTICIPATION_REQUIRED",
    engine6Requirement:
      "FINAL_PERMISSION_REQUIRED",

    currentDecision:
      triggerLevel != null
        ? `WAITING FOR ${triggerLevel.toFixed(
            2
          )} ACCEPTANCE`
        : "WAITING FOR LONG TRIGGER",

    noPermissionCreated: true,
    noExecution: true,
  };
}

export function buildStrategy1GeometryPreviews({
  symbol = "ES",
  strategyId = STRATEGY_ID,
  engine26LocationCandidate = null,
  engine22WaveStrategy = null,
  snapshotTime = null,
} = {}) {
  const candidate =
    engine26LocationCandidate &&
    typeof engine26LocationCandidate === "object"
      ? engine26LocationCandidate
      : null;

  const minuteState =
    engine22WaveStrategy?.degreeStates?.minute ||
    null;

  const activeFibModel =
    minuteState?.activeFibModel || null;

  const targetModel =
    minuteState?.targetModel || null;

  /*
   * Build Engine 22 structural context BEFORE enforcing the negotiated
   * Strategy 1 location requirement.
   *
   * This is the central Option A change:
   * Engine 26A remains negotiated-location-only, while Engine 26B may
   * still publish a read-only structural C-down preview when Engine 22
   * publishes C_DOWN_EXTENSION_LADDER.
   */
  const structuralWithoutLocation =
    buildStructuralContext({
      minuteState,
      activeFibModel,
      targetModel,
      shortTrigger: null,
      longTrigger: null,
    });

  const location = candidate?.location || null;
  const locationType = safeUpper(location?.type);
  const eligible =
    candidate?.strategyEligibility?.eligible === true;
  const candidateActive =
    candidate?.active === true;

  if (
    !candidate ||
    !location ||
    locationType !== "NEGOTIATED" ||
    !candidateActive ||
    !eligible
  ) {
    return buildUnavailablePreview({
      symbol,
      strategyId,
      snapshotTime:
        candidate?.snapshotTime ||
        snapshotTime,

      structuralContext:
        structuralWithoutLocation.model,

      structuralOnlyPreview:
        structuralWithoutLocation
          .structuralOnlyPreview,

      reasonCode:
        locationType &&
        locationType !== "NEGOTIATED"
          ? "NEGOTIATED_LOCATION_REQUIRED"
          : "ENGINE26_VALID_NEGOTIATED_LOCATION_REQUIRED",
    });
  }

  const directionalBoundaries =
    candidate.directionalBoundaries &&
    typeof candidate.directionalBoundaries === "object"
      ? candidate.directionalBoundaries
      : null;

  const longBoundaries =
    directionalBoundaries?.LONG || null;

  const shortBoundaries =
    directionalBoundaries?.SHORT || null;

  if (!longBoundaries || !shortBoundaries) {
    return buildUnavailablePreview({
      symbol,
      strategyId,
      snapshotTime:
        candidate?.snapshotTime ||
        snapshotTime,

      structuralContext:
        structuralWithoutLocation.model,

      structuralOnlyPreview:
        structuralWithoutLocation
          .structuralOnlyPreview,

      reasonCode:
        "ENGINE26_DIRECTIONAL_BOUNDARIES_UNAVAILABLE",
    });
  }

  const zoneLo = toNum(location.lo);
  const zoneHi = toNum(location.hi);
  const zoneMid = toNum(location.mid);

  const currentPrice =
    toNum(candidate.currentPrice);

  const structural =
    buildStructuralContext({
      minuteState,
      activeFibModel,
      targetModel,
      shortTrigger: toNum(
        shortBoundaries.triggerLevel
      ),
      longTrigger: toNum(
        longBoundaries.triggerLevel
      ),
    });

  const optionA =
    buildShortOption({
      shortBoundaries,
      zoneMid,
      structuralTargets:
        structural.shortTargets,
      structuralContext:
        structural.model,
    });

  const optionB =
    buildLongOption({
      longBoundaries,
      zoneMid,
      /*
       * A C-down extension ladder does not invent LONG targets.
       * Long structural destinations remain empty unless Engine 22
       * publishes a legitimate level above the LONG trigger.
       */
      structuralTargets:
        structural.modelFamily ===
        "C_DOWN_EXTENSION_LADDER"
          ? []
          : structural.longTargets,
    });

  const resolvedDirection =
    safeUpper(
      candidate.tradeDirectionBias ||
        candidate.direction ||
        candidate.directionBias
    );

  return {
    active: true,
    engine: ENGINE,
    mode: MODE,
    status: "DUAL_DIRECTION_PREVIEW",

    symbol:
      safeUpper(
        candidate.symbol ||
        symbol ||
        "ES"
      ),

    strategyId:
      candidate.strategyId ||
      strategyId,

    laneId:
      candidate.laneId ||
      LANE_ID,

    snapshotTime:
      candidate.snapshotTime ||
      snapshotTime ||
      null,

    location: {
      source:
        location.source || null,
      type:
        location.type || null,
      timeframe:
        location.timeframe || null,
      zoneLow:
        zoneLo,
      zoneMidline:
        zoneMid,
      zoneHigh:
        zoneHi,
      currentPrice,
      relation:
        location.relation || null,
    },

    lifecycle: {
      state: "NEW_SETUP_WATCH",

      direction:
        ["LONG", "SHORT"].includes(
          resolvedDirection
        )
          ? resolvedDirection
          : "NEUTRAL",

      priorRotationCompletionState:
        candidate
          .priorRotationCompletionState ||
        null,

      priorRotationFullyComplete:
        candidate
          .priorRotationFullyComplete === true,
    },

    structuralContext:
      structural.model,

    structuralOnlyPreview:
      structural.structuralOnlyPreview,

    optionA,
    optionB,

    selectedOption:
      resolvedDirection === "SHORT"
        ? "A"
        : resolvedDirection === "LONG"
        ? "B"
        : null,

    decisionSummary: {
      short:
        optionA.currentDecision,
      long:
        optionB.currentDecision,
      engine3:
        "SELECTS_THE_REACTION",
      engine4:
        "CONFIRMS_PARTICIPATION",
      engine6:
        "FINAL_PERMISSION",
    },

    previewOnly: true,
    noPermissionCreated: true,
    noExecution: true,

    reasonCodes: [
      "ENGINE26_DUAL_DIRECTION_GEOMETRY_PREVIEW_ACTIVE",
      "ENGINE26_CANONICAL_DIRECTIONAL_BOUNDARIES_CONSUMED",

      structural.modelFamily ===
      "C_DOWN_EXTENSION_LADDER"
        ? "ENGINE22_C_DOWN_EXTENSION_LADDER_CONSUMED"
        : structural.model
        ? "ENGINE22_ACTIVE_FIB_MODEL_CONSUMED"
        : "ENGINE22_STRUCTURAL_MODEL_UNAVAILABLE",

      "ENGINE26A_NEGOTIATED_LOCATION_OWNERSHIP_PRESERVED",
      "PREVIEW_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildStrategy1GeometryPreviews;
