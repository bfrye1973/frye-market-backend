// services/core/logic/engine26/strategy1/buildStrategy1GeometryPreviews.js

const ENGINE = "engine26B.strategy1GeometryPreviews.v1";
const MODE = "PREVIEW_ONLY";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function buildUnavailablePreview({
  symbol,
  strategyId,
  snapshotTime,
  reasonCode,
}) {
  return {
    active: false,
    engine: ENGINE,
    mode: MODE,
    status: "WAITING_FOR_VALID_NEGOTIATED_LOCATION",
    symbol: safeUpper(symbol || "ES"),
    strategyId: strategyId || "intraday_scalp@10m",
    laneId: "minute",
    snapshotTime: snapshotTime || null,
    location: null,
    optionA: null,
    optionB: null,
    selectedOption: null,
    previewOnly: true,
    noPermissionCreated: true,
    noExecution: true,
    reasonCodes: [
      reasonCode || "ENGINE26_VALID_NEGOTIATED_LOCATION_REQUIRED",
      "PREVIEW_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

function makeFibLevel({ key, price, activeWave }) {
  const normalizedKey = safeUpper(key);
  const normalizedWave = safeUpper(activeWave);

  return {
    key,
    price,
    label:
      normalizedWave === "W4"
        ? `W4 ${String(key || "").toLowerCase()}`
        : `${normalizedWave || "ACTIVE WAVE"} ${String(key || "").toLowerCase()}`,
    source: "ENGINE22_ACTIVE_FIB_MODEL",
  };
}

function buildStructuralContext({
  activeFibModel,
  shortTrigger,
  longTrigger,
}) {
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
        index === 0 || item.price !== arr[index - 1].price
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
}) {
  const triggerLevel = toNum(shortBoundaries?.triggerLevel);
  const acceptanceBoundary = toNum(
    shortBoundaries?.acceptanceBoundary
  );
  const reclaimBoundary = toNum(shortBoundaries?.reclaimBoundary);
  const invalidationLevel = toNum(
    shortBoundaries?.locationInvalidationBoundary
  );

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
    ...structuralTargets.map((target, index) =>
      watchedLevel({
        price: target.price,
        label: `${target.label}${index === 0 ? " — first structural destination" : ""}`,
        role: index === 0 ? "FIRST_STRUCTURAL_DESTINATION" : "STRUCTURAL_DESTINATION",
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
    triggerInstruction: "Lose / fail reclaim below lower boundary",

    acceptanceBoundary,
    acceptanceInstruction: "Bearish acceptance below zone",

    reclaimBoundary,
    reclaimInstruction:
      "Acceptance back above upper boundary defeats SHORT thesis",

    invalidationLevel,
    invalidationInstruction: "SHORT location invalid beyond here",

    levelsWatched,
    structuralTargets,
    firstStructuralDestination: structuralTargets[0] || null,

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
    engine4Requirement: "SHORT_PARTICIPATION_REQUIRED",
    engine6Requirement: "FINAL_PERMISSION_REQUIRED",

    currentDecision:
      triggerLevel != null
        ? `WAITING FOR ${triggerLevel.toFixed(2)} LOSS / FAILED RECLAIM`
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
  const triggerLevel = toNum(longBoundaries?.triggerLevel);
  const acceptanceBoundary = toNum(
    longBoundaries?.acceptanceBoundary
  );
  const reclaimBoundary = toNum(longBoundaries?.reclaimBoundary);
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
    triggerInstruction: "Break / accept above upper boundary",

    acceptanceBoundary,
    acceptanceInstruction: "Bullish acceptance above zone",

    reclaimBoundary,
    reclaimInstruction: "Loss of lower boundary defeats LONG thesis",

    invalidationLevel,
    invalidationInstruction: "LONG location invalid beyond here",

    levelsWatched,
    structuralTargets,
    firstStructuralDestination: structuralTargets[0] || null,

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
    engine4Requirement: "LONG_PARTICIPATION_REQUIRED",
    engine6Requirement: "FINAL_PERMISSION_REQUIRED",

    currentDecision:
      triggerLevel != null
        ? `WAITING FOR ${triggerLevel.toFixed(2)} ACCEPTANCE`
        : "WAITING FOR LONG TRIGGER",

    noPermissionCreated: true,
    noExecution: true,
  };
}

export function buildStrategy1GeometryPreviews({
  symbol = "ES",
  strategyId = "intraday_scalp@10m",
  engine26LocationCandidate = null,
  engine22WaveStrategy = null,
  snapshotTime = null,
} = {}) {
  const candidate =
    engine26LocationCandidate &&
    typeof engine26LocationCandidate === "object"
      ? engine26LocationCandidate
      : null;

  const location = candidate?.location || null;
  const locationType = safeUpper(location?.type);
  const eligible = candidate?.strategyEligibility?.eligible === true;
  const candidateActive = candidate?.active === true;

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
      snapshotTime: candidate?.snapshotTime || snapshotTime,
      reasonCode:
        locationType && locationType !== "NEGOTIATED"
          ? "NEGOTIATED_LOCATION_REQUIRED"
          : "ENGINE26_VALID_NEGOTIATED_LOCATION_REQUIRED",
    });
  }

  const directionalBoundaries =
    candidate.directionalBoundaries &&
    typeof candidate.directionalBoundaries === "object"
      ? candidate.directionalBoundaries
      : null;

  const longBoundaries = directionalBoundaries?.LONG || null;
  const shortBoundaries = directionalBoundaries?.SHORT || null;

  if (!longBoundaries || !shortBoundaries) {
    return buildUnavailablePreview({
      symbol,
      strategyId,
      snapshotTime: candidate?.snapshotTime || snapshotTime,
      reasonCode: "ENGINE26_DIRECTIONAL_BOUNDARIES_UNAVAILABLE",
    });
  }

  const zoneLo = toNum(location.lo);
  const zoneHi = toNum(location.hi);
  const zoneMid = toNum(location.mid);
  const currentPrice = toNum(candidate.currentPrice);

  const activeFibModel =
    engine22WaveStrategy
      ?.degreeStates
      ?.minute
      ?.activeFibModel || null;

  const structural = buildStructuralContext({
    activeFibModel,
    shortTrigger: toNum(shortBoundaries.triggerLevel),
    longTrigger: toNum(longBoundaries.triggerLevel),
  });

  const optionA = buildShortOption({
    shortBoundaries,
    zoneMid,
    structuralTargets: structural.shortTargets,
  });

  const optionB = buildLongOption({
    longBoundaries,
    zoneMid,
    structuralTargets: structural.longTargets,
  });

  const resolvedDirection = safeUpper(
    candidate.tradeDirectionBias ||
      candidate.direction ||
      candidate.directionBias
  );

  return {
    active: true,
    engine: ENGINE,
    mode: MODE,
    status: "DUAL_DIRECTION_PREVIEW",
    symbol: safeUpper(candidate.symbol || symbol || "ES"),
    strategyId: candidate.strategyId || strategyId,
    laneId: candidate.laneId || "minute",
    snapshotTime: candidate.snapshotTime || snapshotTime || null,

    location: {
      source: location.source || null,
      type: location.type || null,
      timeframe: location.timeframe || null,
      zoneLow: zoneLo,
      zoneMidline: zoneMid,
      zoneHigh: zoneHi,
      currentPrice,
      relation: location.relation || null,
    },

    lifecycle: {
      state: "NEW_SETUP_WATCH",
      direction:
        ["LONG", "SHORT"].includes(resolvedDirection)
          ? resolvedDirection
          : "NEUTRAL",
      priorRotationCompletionState:
        candidate.priorRotationCompletionState || null,
      priorRotationFullyComplete:
        candidate.priorRotationFullyComplete === true,
    },

    structuralContext: structural.model,
    optionA,
    optionB,

    selectedOption:
      resolvedDirection === "SHORT"
        ? "A"
        : resolvedDirection === "LONG"
        ? "B"
        : null,

    decisionSummary: {
      short: optionA.currentDecision,
      long: optionB.currentDecision,
      engine3: "SELECTS_THE_REACTION",
      engine4: "CONFIRMS_PARTICIPATION",
      engine6: "FINAL_PERMISSION",
    },

    previewOnly: true,
    noPermissionCreated: true,
    noExecution: true,
    reasonCodes: [
      "ENGINE26_DUAL_DIRECTION_GEOMETRY_PREVIEW_ACTIVE",
      "ENGINE26_CANONICAL_DIRECTIONAL_BOUNDARIES_CONSUMED",
      structural.model
        ? "ENGINE22_ACTIVE_FIB_MODEL_CONSUMED"
        : "ENGINE22_ACTIVE_FIB_MODEL_UNAVAILABLE",
      "PREVIEW_ONLY",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

export default buildStrategy1GeometryPreviews;
