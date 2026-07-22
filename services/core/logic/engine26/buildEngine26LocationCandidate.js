// services/core/logic/engine26/buildEngine26LocationCandidate.js
// Engine 26A — reaction-independent location discovery and reaction handoff.
//
// Ownership:
//   Engine 26A answers: "Where is the meaningful trade location?"
//
// Allowed inputs:
//   - Engine 22 structure
//   - Current price
//   - Engine 1 / SMZ / manual-zone context already loaded by the snapshot builder
//   - Engine 25 supporting context
//
// Forbidden inputs:
//   - Engine 3 reaction results
//   - Engine 4 participation results
//   - Engine 6 permission
//   - Engine 15 readiness
//
// This module creates no permission, sizing, official stop/targets, execution,
// journal result, or broker instruction.

import { createHash } from "node:crypto";
import {
  readEngine26ManualImbalanceZones,
} from "./readManualImbalanceZones.js";
import {
  resolveEngine26Strategy1Identity,
  STRATEGY1_SETUP_CLASS,
} from "./strategy1/resolveStrategy1Identity.js";
import { buildStrategy1Facts } from "./strategy1/buildStrategy1Facts.js";
import {
  readNegotiatedZoneMemory,
  writeNegotiatedZoneMemory,
  DEFAULT_MEMORY_PATH,
} from "./strategy1/negotiatedZoneMemoryStore.js";
import {
  buildStrategy1MemoryKey,
  updateNegotiatedZoneMemory,
  retirePriorMemoryRecord,
} from "./strategy1/updateNegotiatedZoneMemory.js";

const DEFAULT_TICK_SIZE = 0.25;
const DEFAULT_MONITORING_RANGE_POINTS = 25;
const DEFAULT_ACTIVATION_RANGE_POINTS = 4;

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function positiveNumber(value) {
  const number = toFiniteNumber(value);

  return number !== null && number > 0 ? number : null;
}

function roundToTick(value, tickSize = DEFAULT_TICK_SIZE) {
  const number = toFiniteNumber(value);

  if (number === null) return null;

  return Number(
    (Math.round(number / tickSize) * tickSize).toFixed(2)
  );
}

function round2(value) {
  const number = toFiniteNumber(value);

  return number === null
    ? null
    : Number(number.toFixed(2));
}

function stableHash(prefix, parts) {
  const body = parts
    .map((part) => String(part ?? "NULL").trim().toUpperCase())
    .join("|");

  const hash = createHash("sha256")
    .update(body)
    .digest("hex")
    .slice(0, 20);

  return `${prefix}-${hash}`;
}

function normalizeDirection(value) {
  const text = String(value || "")
    .trim()
    .toUpperCase();

  if (["LONG", "UP", "BULL", "BULLISH"].includes(text)) {
    return "LONG";
  }

  if (["SHORT", "DOWN", "BEAR", "BEARISH"].includes(text)) {
    return "SHORT";
  }

  if (text.includes("LONG")) return "LONG";
  if (text.includes("SHORT")) return "SHORT";

  return "NEUTRAL";
}

function distanceToZone(currentPrice, lo, hi) {
  const price = toFiniteNumber(currentPrice);
  const lower = toFiniteNumber(lo);
  const upper = toFiniteNumber(hi);

  if (
    price === null ||
    lower === null ||
    upper === null
  ) {
    return null;
  }

  const min = Math.min(lower, upper);
  const max = Math.max(lower, upper);

  if (price >= min && price <= max) {
    return 0;
  }

  if (price < min) {
    return round2(min - price);
  }

  return round2(price - max);
}

function relationToZone(
  currentPrice,
  lo,
  hi,
  activationRangePoints
) {
  const price = toFiniteNumber(currentPrice);
  const lower = toFiniteNumber(lo);
  const upper = toFiniteNumber(hi);

  if (
    price === null ||
    lower === null ||
    upper === null
  ) {
    return "UNKNOWN";
  }

  const min = Math.min(lower, upper);
  const max = Math.max(lower, upper);

  if (price >= min && price <= max) {
    return "INSIDE_ZONE";
  }

  if (price > max) {
    return price - max <= activationRangePoints
      ? "NEAR_ABOVE_ZONE"
      : "ABOVE_ZONE";
  }

  return min - price <= activationRangePoints
    ? "NEAR_BELOW_ZONE"
    : "BELOW_ZONE";
}

function normalizeZone({
  zone,
  source,
  sourcePath,
  defaultType = "ZONE",
  defaultTimeframe = null,
  priority = 50,
  tickSize = DEFAULT_TICK_SIZE,
}) {
  if (!zone || typeof zone !== "object") {
    return null;
  }

  const directPrice = positiveNumber(
    zone.price ??
      zone.level ??
      zone.mid ??
      zone.value
  );

  const rawLo = positiveNumber(
    zone.lo ??
      zone.low ??
      zone.lower ??
      zone.from ??
      directPrice
  );

  const rawHi = positiveNumber(
    zone.hi ??
      zone.high ??
      zone.upper ??
      zone.to ??
      directPrice
  );

  if (rawLo === null || rawHi === null) {
    return null;
  }

  const lo = roundToTick(
    Math.min(rawLo, rawHi),
    tickSize
  );

  const hi = roundToTick(
    Math.max(rawLo, rawHi),
    tickSize
  );

  const mid = roundToTick(
    (lo + hi) / 2,
    tickSize
  );

  return {
    upstreamId:
      zone.id ??
      zone.zoneId ??
      null,

    source,
    sourcePath,

    type: String(
      zone.zoneType ??
        zone.type ??
        zone.label ??
        defaultType
    ).toUpperCase(),

    timeframe:
      zone.timeframe ??
      zone.tf ??
      defaultTimeframe,

    side:
      zone.side ??
      zone.direction ??
      zone.bias ??
      null,

    lo,
    hi,
    mid,

    priority,

    strength: toFiniteNumber(
      zone.strength ??
        zone.score ??
        zone.confidence
    ),

    freshness:
      zone.freshness ??
      zone.status ??
      null,

    raw: zone,
  };
}

function pointZone({
  value,
  source,
  sourcePath,
  type,
  timeframe,
  priority,
  tickSize,
}) {
  const price = positiveNumber(value);

  if (price === null) {
    return null;
  }

  return normalizeZone({
    zone: {
      price,
      type,
      timeframe,
    },

    source,
    sourcePath,
    defaultType: type,
    defaultTimeframe: timeframe,
    priority,
    tickSize,
  });
}

function collectEngine26ManualImbalanceZones(
  manualImbalanceInventory,
  tickSize
) {
  const zones = Array.isArray(
    manualImbalanceInventory?.zones
  )
    ? manualImbalanceInventory.zones
    : [];

  const candidates = [];

  zones.forEach((zone, index) => {
    if (!zone || typeof zone !== "object") {
      return;
    }

    if (zone.invalidated === true) {
      return;
    }

    if (zone.expired === true) {
      return;
    }

    if (
      zone.active === false &&
      zone.invalidated !== false
    ) {
      return;
    }

    const normalized = normalizeZone({
      zone,

      source:
        "ENGINE26_MANUAL_IMBALANCE",

      sourcePath:
        `manualImbalanceInventory.zones[${index}]`,

      defaultType:
        "MANUAL_IMBALANCE",

      defaultTimeframe:
        "10m",

      priority:
        120,

      tickSize,
    });

    if (normalized) {
      candidates.push(normalized);
    }
  });

  return candidates;
}

function collectEngine26ManualNegotiatedZones(
  manualImbalanceInventory,
  tickSize
) {
  const zones = Array.isArray(manualImbalanceInventory?.negotiatedZones)
    ? manualImbalanceInventory.negotiatedZones
    : [];

  return zones
    .map((zone, index) =>
      normalizeZone({
        zone,
        source: "ENGINE26_MANUAL_NEGOTIATED",
        sourcePath:
          zone?.sourcePath ||
          `manualImbalanceInventory.negotiatedZones[${index}]`,
        defaultType: "NEGOTIATED",
        defaultTimeframe: "10m",
        priority: 126,
        tickSize,
      })
    )
    .filter(Boolean);
}

function isApprovedNegotiatedZone(zone) {
  return (
    (zone?.source === "ENGINE1" && zone?.type === "NEGOTIATED") ||
    (zone?.source === "ENGINE26_MANUAL_NEGOTIATED" && zone?.type === "NEGOTIATED")
  );
}

function buildCanonicalZoneId(symbol, zone) {
  return stableHash("E26Z", [
    symbol,
    zone?.source,
    zone?.type,
    zone?.timeframe,
    zone?.lo,
    zone?.hi,
  ]);
}

function selectLongTargetZone({ negotiatedZones, entryZone }) {
  if (!entryZone) return null;

  return [...negotiatedZones]
    .filter((zone) => zone !== entryZone)
    .filter((zone) => zone.lo > entryZone.hi)
    .sort((a, b) => {
      if (a.lo !== b.lo) return a.lo - b.lo;
      if (a.hi !== b.hi) return a.hi - b.hi;
      const sourceCompare = String(a.source || "").localeCompare(String(b.source || ""));
      if (sourceCompare !== 0) return sourceCompare;
      return String(a.upstreamId || "").localeCompare(String(b.upstreamId || ""));
    })[0] || null;
}

function collectEngine1Zones(
  engine1Context,
  tickSize
) {
  const candidates = [];

  const add = (zone, options) => {
    const normalized = normalizeZone({
      zone,
      tickSize,
      ...options,
    });

    if (normalized) {
      candidates.push(normalized);
    }
  };

  add(engine1Context?.active?.negotiated, {
    source: "ENGINE1",
    sourcePath: "engine1Context.active.negotiated",
    defaultType: "NEGOTIATED",
    priority: 110,
  });

  add(engine1Context?.active?.institutional, {
    source: "ENGINE1",
    sourcePath: "engine1Context.active.institutional",
    defaultType: "INSTITUTIONAL",
    priority: 108,
  });

  add(engine1Context?.active?.shelf, {
    source: "ENGINE1",
    sourcePath: "engine1Context.active.shelf",
    defaultType: "SHELF",
    priority: 106,
  });

  add(engine1Context?.nearest?.negotiated, {
    source: "ENGINE1",
    sourcePath: "engine1Context.nearest.negotiated",
    defaultType: "NEGOTIATED",
    priority: 100,
  });

  add(engine1Context?.nearest?.institutional, {
    source: "ENGINE1",
    sourcePath: "engine1Context.nearest.institutional",
    defaultType: "INSTITUTIONAL",
    priority: 98,
  });

  add(engine1Context?.nearest?.shelf, {
    source: "ENGINE1",
    sourcePath: "engine1Context.nearest.shelf",
    defaultType: "SHELF",
    priority: 96,
  });

  for (const [
    key,
    defaultType,
    priority,
  ] of [
    ["negotiated", "NEGOTIATED", 88],
    ["institutional", "INSTITUTIONAL", 86],
    ["shelves", "SHELF", 84],
  ]) {
    const rows = Array.isArray(
      engine1Context?.render?.[key]
    )
      ? engine1Context.render[key]
      : [];

    rows.forEach((zone, index) => {
      add(zone, {
        source: "ENGINE1",

        sourcePath:
          `engine1Context.render.${key}[${index}]`,

        defaultType,
        priority,
      });
    });
  }

  return candidates;
}

function collectEngine25Zones(
  engine25Context,
  tickSize
) {
  if (
    !engine25Context ||
    typeof engine25Context !== "object"
  ) {
    return [];
  }

  const candidates = [];

  const add = (zone, options) => {
    const normalized = normalizeZone({
      zone,
      tickSize,
      ...options,
    });

    if (normalized) {
      candidates.push(normalized);
    }
  };

  const addPoint = (value, options) => {
    const normalized = pointZone({
      value,
      tickSize,
      ...options,
    });

    if (normalized) {
      candidates.push(normalized);
    }
  };

  add(
    engine25Context?.esPermission?.nearestZone,
    {
      source: "ENGINE25",

      sourcePath:
        "engine25Context.esPermission.nearestZone",

      defaultType: "ENGINE25_NEAREST_ZONE",
      priority: 78,
    }
  );

  add(
    engine25Context?.zoneAwareRead?.nearestZone,
    {
      source: "ENGINE25",

      sourcePath:
        "engine25Context.zoneAwareRead.nearestZone",

      defaultType: "ENGINE25_ZONE_AWARE",
      priority: 76,
    }
  );

  for (const [
    field,
    type,
    priority,
  ] of [
    [
      "reclaimNegotiated",
      "RECLAIM_NEGOTIATED",
      74,
    ],
    [
      "reclaimInstitutional",
      "RECLAIM_INSTITUTIONAL",
      72,
    ],
    [
      "failureInstitutional",
      "FAILURE_INSTITUTIONAL",
      72,
    ],
    [
      "lowerShelf",
      "LOWER_SHELF",
      70,
    ],
  ]) {
    addPoint(
      engine25Context?.esPermission?.[field],
      {
        source: "ENGINE25",

        sourcePath:
          `engine25Context.esPermission.${field}`,

        type,
        timeframe: "CONTEXT",
        priority,
      }
    );
  }

  return candidates;
}

function collectEngine22Zones(
  engine22WaveStrategy,
  tickSize
) {
  const degreeStates =
    engine22WaveStrategy?.degreeStates || {};

  const candidates = [];

  const addPoint = ({
    value,
    degree,
    sourcePath,
    type,
    priority,
  }) => {
    const normalized = pointZone({
      value,
      source: "ENGINE22",
      sourcePath,
      type,

      timeframe:
        degreeStates?.[degree]?.tf ??
        degree,

      priority,
      tickSize,
    });

    if (normalized) {
      candidates.push(normalized);
    }
  };

  for (const [
    degree,
    priority,
  ] of [
    ["subminute", 68],
    ["minute", 66],
    ["minor", 64],
  ]) {
    const state =
      degreeStates?.[degree] || {};

    addPoint({
      value:
        state?.nestedCorrectionContext
          ?.supportLevel,

      degree,

      sourcePath:
        `engine22WaveStrategy.degreeStates.${degree}` +
        `.nestedCorrectionContext.supportLevel`,

      type:
        `${degree.toUpperCase()}_SUPPORT`,

      priority,
    });

    addPoint({
      value:
        state?.targetModel?.localSupportWatch,

      degree,

      sourcePath:
        `engine22WaveStrategy.degreeStates.${degree}` +
        `.targetModel.localSupportWatch`,

      type:
        `${degree.toUpperCase()}_LOCAL_SUPPORT`,

      priority,
    });

    const levels =
      state?.targetModel?.levels;

    if (
      levels &&
      typeof levels === "object"
    ) {
      for (const [
        name,
        value,
      ] of Object.entries(levels)) {
        addPoint({
          value,
          degree,

          sourcePath:
            `engine22WaveStrategy.degreeStates.${degree}` +
            `.targetModel.levels.${name}`,

          type:
            `${degree.toUpperCase()}_` +
            `${String(name).toUpperCase()}`,

          priority: priority - 4,
        });
      }
    }

    const projection =
      state?.correctionModel?.cProjectionZone;

    if (
      projection &&
      typeof projection === "object"
    ) {
      for (const [
        name,
        value,
      ] of Object.entries(projection)) {
        addPoint({
          value,
          degree,

          sourcePath:
            `engine22WaveStrategy.degreeStates.${degree}` +
            `.correctionModel.cProjectionZone.${name}`,

          type:
            `${degree.toUpperCase()}_C_` +
            `${String(name).toUpperCase()}`,

          priority: priority - 2,
        });
      }
    }
  }

  return candidates;
}

function dedupeZones(zones) {
  const seen = new Map();

  for (const zone of zones) {
    if (!zone) continue;

    const key = [
      zone.source,
      zone.type,
      zone.lo,
      zone.hi,
      zone.timeframe,
    ]
      .map((value) =>
        String(value ?? "NULL")
          .toUpperCase()
      )
      .join("|");

    const previous = seen.get(key);

    if (
      !previous ||
      Number(zone.priority) >
        Number(previous.priority)
    ) {
      seen.set(key, zone);
    }
  }

  return [...seen.values()];
}

function inferDirectionBias({
  selectedZone,
  engine22WaveStrategy,
}) {
  const sideDirection =
    normalizeDirection(selectedZone?.side);

  if (sideDirection !== "NEUTRAL") {
    return sideDirection;
  }

  const candidates = [
    engine22WaveStrategy?.waveOpportunity
      ?.direction,

    engine22WaveStrategy?.currentLifecycleState
      ?.direction,

    engine22WaveStrategy?.degreeStates
      ?.subminute?.preferredTradeDirection,

    engine22WaveStrategy?.degreeStates
      ?.subminute?.internalStructure
      ?.preferredTradeDirection,

    engine22WaveStrategy?.degreeStates
      ?.subminute?.direction,

    engine22WaveStrategy?.degreeStates
      ?.minute?.direction,

    engine22WaveStrategy?.degreeStates
      ?.minor?.direction,
  ];

  for (const candidate of candidates) {
    const direction =
      normalizeDirection(candidate);

    if (direction !== "NEUTRAL") {
      return direction;
    }
  }

  return "NEUTRAL";
}

function inferSetupType(
  engine22WaveStrategy
) {
  return (
    engine22WaveStrategy
      ?.waveOpportunity
      ?.setupType ||

    engine22WaveStrategy
      ?.currentLifecycleState
      ?.key ||

    engine22WaveStrategy
      ?.degreeStates
      ?.subminute
      ?.stage ||

    engine22WaveStrategy
      ?.degreeStates
      ?.minute
      ?.stage ||

    "ENGINE26A_LOCATION_WATCH"
  );
}

function expectedReactionsForDirection(
  direction
) {
  if (direction === "LONG") {
    return [
      "HELD_LEVEL",
      "RECLAIMED_LEVEL",
      "WICK_BELOW_AND_RECLAIM",
      "DIP_BOUGHT_FAST",
      "SELLERS_TRAPPED",
      "BREAKOUT_HOLDING",
    ];
  }

  if (direction === "SHORT") {
    return [
      "LOST_LEVEL",
      "FAILED_RECLAIM",
      "REJECTING_VALUE",
      "FAILED_ACCEPTANCE_SHORT",
      "LOST_SHORT_TRIGGER_LEVEL",
      "BREAKOUT_FAILING",
    ];
  }

  return [
    "HELD_LEVEL",
    "LOST_LEVEL",
    "RECLAIMED_LEVEL",
    "FAILED_RECLAIM",
  ];
}

function buildBoundaries({
  directionBias,
  zone,
  tickSize,
}) {
  if (!zone) {
    return {
      triggerLevel: null,
      acceptanceBoundary: null,
      reclaimBoundary: null,
      locationInvalidationBoundary: null,
    };
  }

  if (directionBias === "SHORT") {
    return {
      triggerLevel: zone.lo,
      acceptanceBoundary: zone.lo,
      reclaimBoundary: zone.hi,

      locationInvalidationBoundary:
        roundToTick(
          zone.hi + tickSize,
          tickSize
        ),
    };
  }

  if (directionBias === "LONG") {
    return {
      triggerLevel: zone.hi,
      acceptanceBoundary: zone.hi,
      reclaimBoundary: zone.lo,

      locationInvalidationBoundary:
        roundToTick(
          zone.lo - tickSize,
          tickSize
        ),
    };
  }

  return {
    triggerLevel: zone.mid,
    acceptanceBoundary: zone.mid,
    reclaimBoundary: zone.mid,
    locationInvalidationBoundary: null,
  };
}

function makeWaitingCandidate({
  symbol,
  strategyId,
  timeframe,
  currentPrice,
  snapshotTime,
  reasonCode,
}) {
  return {
    active: false,
    engine: "engine26.locationCandidate.v1",
    status: "WAITING_FOR_LOCATION",

    candidateId: null,
    zoneId: null,

    symbol,
    strategyId,
    timeframe,

    currentPrice,
    snapshotTime,

    directionBias: "NEUTRAL",
    setupType: null,

    location: null,

    triggerLevel: null,
    acceptanceBoundary: null,
    reclaimBoundary: null,
    locationInvalidationBoundary: null,

    expectedReactions: [],

    activationRangePoints: null,
    monitoringRangePoints: null,

    reasonCodes: [
      reasonCode ||
        "NO_ENGINE26A_LOCATION_CANDIDATE",
    ],

    warnings: [],

    noPermissionCreated: true,
    noExecution: true,
  };
}

function buildWaitingHandoff(
  candidate,
  reasonCode
) {
  return {
    active: false,

    engine:
      "engine26.reactionHandoff.v1",

    status:
      "WAITING_FOR_LOCATION",

    candidateId:
      candidate?.candidateId ?? null,

    zoneId:
      candidate?.zoneId ?? null,

    laneId:
      candidate?.laneId ??
      "minute",

    symbol:
      candidate?.symbol ?? null,

    strategyId:
      candidate?.strategyId ?? null,

    timeframe:
      candidate?.timeframe ?? null,

    snapshotTime:
      candidate?.snapshotTime ?? null,

    tradeDirectionBias:
      candidate?.directionBias ??
      "NEUTRAL",

    expectedReactionDirection:
      candidate?.directionBias ??
      "NEUTRAL",

    setupType:
      candidate?.setupType ?? null,

    setupClass:
      candidate?.setupClass ?? null,

    setupGrade:
      candidate?.setupGrade ?? null,

    identitySetupKey:
      candidate?.identitySetupKey ?? null,

    candidateIdentityVersion:
      candidate?.candidateIdentityVersion ??
      null,

    entryZone:
      candidate?.entryZone ?? null,

    targetZone:
      candidate?.targetZone ?? null,

    sweepFacts:
      candidate?.sweepFacts ?? null,

    lowerWickFacts:
      candidate?.lowerWickFacts ?? null,

    reclaimFacts:
      candidate?.reclaimFacts ?? null,

    postReclaimFacts:
      candidate?.postReclaimFacts ?? null,

    invalidationFacts:
      candidate?.invalidationFacts ?? null,

    zoneMemorySummary:
      candidate?.zoneMemorySummary ?? null,

    expectedReactions:
      candidate?.expectedReactions ?? [],

    zone:
      candidate?.location ?? null,

    triggerLevel:
      candidate?.triggerLevel ?? null,

    acceptanceBoundary:
      candidate?.acceptanceBoundary ??
      null,

    reclaimBoundary:
      candidate?.reclaimBoundary ??
      null,

    locationInvalidationBoundary:
      candidate
        ?.locationInvalidationBoundary ??
      null,

    activationRangePoints:
      candidate?.activationRangePoints ??
      null,

    authorizeEngine3Evaluation: false,

    reasonCodes: [
      reasonCode ||
        "NO_ENGINE26_LOCATION_CANDIDATE",
    ],

    sourceRefs:
      candidate?.sourceRefs ?? [],

    noPermissionCreated: true,
    noExecution: true,
  };
}

export function buildEngine26LocationCandidate({
  symbol,
  strategyId,
  timeframe,
  currentPrice,
  snapshotTime = new Date().toISOString(),
  engine22WaveStrategy = null,
  engine25Context = null,
  engine1Context = null,
  previousLocationCandidate = null,
  bars10m = [],
  memoryFilePath = DEFAULT_MEMORY_PATH,
  persistMemory = true,
  tickSize = DEFAULT_TICK_SIZE,

  activationRangePoints = Number(
    process.env
      .ENGINE26A_ACTIVATION_RANGE_POINTS ??
      DEFAULT_ACTIVATION_RANGE_POINTS
  ),

  monitoringRangePoints = Number(
    process.env
      .ENGINE26A_MONITORING_RANGE_POINTS ??
      DEFAULT_MONITORING_RANGE_POINTS
  ),
} = {}) {
  const normalizedSymbol =
    String(symbol || "").toUpperCase();

  const normalizedStrategyId =
    String(strategyId || "");

  const normalizedTimeframe =
    String(timeframe || "");

  const normalizedPrice =
    positiveNumber(currentPrice);

  const safeActivationRange =
    Number.isFinite(activationRangePoints)
      ? Math.max(
          0,
          activationRangePoints
        )
      : DEFAULT_ACTIVATION_RANGE_POINTS;

  const safeMonitoringRange =
    Number.isFinite(monitoringRangePoints)
      ? Math.max(
          safeActivationRange,
          monitoringRangePoints
        )
      : DEFAULT_MONITORING_RANGE_POINTS;

  if (
    !normalizedSymbol ||
    !normalizedStrategyId ||
    normalizedPrice === null
  ) {
    return makeWaitingCandidate({
      symbol:
        normalizedSymbol || null,

      strategyId:
        normalizedStrategyId || null,

      timeframe:
        normalizedTimeframe || null,

      currentPrice:
        normalizedPrice,

      snapshotTime,

      reasonCode:
        "ENGINE26A_REQUIRED_INPUT_MISSING",
    });
  }

  const manualImbalanceInventory =
    readEngine26ManualImbalanceZones();

  const allZones = dedupeZones([
    ...collectEngine26ManualNegotiatedZones(
      manualImbalanceInventory,
      tickSize
    ),

    ...collectEngine26ManualImbalanceZones(
      manualImbalanceInventory,
      tickSize
    ),

    ...collectEngine1Zones(
      engine1Context,
      tickSize
    ),

    ...collectEngine25Zones(
      engine25Context,
      tickSize
    ),

    ...collectEngine22Zones(
      engine22WaveStrategy,
      tickSize
    ),
  ])
    .map((zone) => {
      const distancePoints =
        distanceToZone(
          normalizedPrice,
          zone.lo,
          zone.hi
        );

      const relation =
        relationToZone(
          normalizedPrice,
          zone.lo,
          zone.hi,
          safeActivationRange
        );

      const selectionScore =
        Number(zone.priority || 0) -
        Math.min(
          Number(distancePoints ?? 999),
          100
        ) * 2 +
        Math.min(
          Number(zone.strength ?? 0),
          10
        );

      return {
        ...zone,
        distancePoints,
        relation,

        selectionScore:
          round2(selectionScore),
      };
    })
    .filter(
      (zone) =>
        zone.distancePoints !== null
    )
    .sort((a, b) => {
      if (
        b.selectionScore !==
        a.selectionScore
      ) {
        return (
          b.selectionScore -
          a.selectionScore
        );
      }

      return (
        a.distancePoints -
        b.distancePoints
      );
    });

  /*
   * Authorization eligibility must be applied before ranking.
   *
   * An out-of-range structural objective may remain informational,
   * but it cannot defeat a valid location inside the monitoring range.
   */
  const authorizationEligibleZones =
    allZones.filter(
      (zone) =>
        zone.distancePoints !== null &&
        zone.distancePoints <=
          safeMonitoringRange
    );

  const selectedZone =
    authorizationEligibleZones[0] ||
    allZones[0] ||
    null;

  if (!selectedZone) {
    return makeWaitingCandidate({
      symbol:
        normalizedSymbol,

      strategyId:
        normalizedStrategyId,

      timeframe:
        normalizedTimeframe,

      currentPrice:
        normalizedPrice,

      snapshotTime,

      reasonCode:
        "NO_VALID_ENGINE26A_ZONE_SOURCE",
    });
  }

  const directionBias =
    inferDirectionBias({
      selectedZone,
      engine22WaveStrategy,
    });

  const setupType =
    inferSetupType(
      engine22WaveStrategy
    );

  /*
   * Engine 26 owns the canonical zone identity.
   *
   * Raw source IDs such as ES_MANUAL_IMBALANCE_7 remain available at:
   * location.upstreamId
   */
  const zoneId =
    buildCanonicalZoneId(
      normalizedSymbol,
      selectedZone
    );

  const strategy1Eligible =
    isApprovedNegotiatedZone(selectedZone);

  const strategyIdentity =
    strategy1Eligible
      ? resolveEngine26Strategy1Identity({
          symbol: normalizedSymbol,
          strategyId: normalizedStrategyId,
          zoneId,
          directionBias,
          previousLocationCandidate,
        })
      : null;

  const candidateId =
    strategyIdentity?.candidateId ||
    stableHash("E26C", [
      normalizedSymbol,
      normalizedStrategyId,
      zoneId,
      directionBias,
      setupType,
    ]);

  const active =
    selectedZone.distancePoints <=
    safeMonitoringRange;

  const status =
    !active
      ? "LOCATION_DETECTED"
      : selectedZone.distancePoints === 0
      ? "INSIDE_LOCATION"
      : selectedZone.distancePoints <=
        safeActivationRange
      ? "APPROACHING_LOCATION"
      : "LOCATION_DETECTED";

  const boundaries =
    buildBoundaries({
      directionBias,
      zone: selectedZone,
      tickSize,
    });

  const approvedNegotiatedZones =
    allZones.filter(isApprovedNegotiatedZone);

  const targetSelectedZone =
    strategy1Eligible && directionBias === "LONG"
      ? selectLongTargetZone({
          negotiatedZones: approvedNegotiatedZones,
          entryZone: selectedZone,
        })
      : null;

  const entryZone = strategy1Eligible
    ? {
        id: zoneId,
        zoneId,
        upstreamId: selectedZone.upstreamId,
        source: selectedZone.source,
        sourcePath: selectedZone.sourcePath,
        type: selectedZone.type,
        timeframe: selectedZone.timeframe,
        low: selectedZone.lo,
        high: selectedZone.hi,
        midline: selectedZone.mid,
      }
    : null;

  const targetZone = targetSelectedZone
    ? {
        id: buildCanonicalZoneId(normalizedSymbol, targetSelectedZone),
        zoneId: buildCanonicalZoneId(normalizedSymbol, targetSelectedZone),
        upstreamId: targetSelectedZone.upstreamId,
        source: targetSelectedZone.source,
        sourcePath: targetSelectedZone.sourcePath,
        type: targetSelectedZone.type,
        timeframe: targetSelectedZone.timeframe,
        low: targetSelectedZone.lo,
        high: targetSelectedZone.hi,
        midline: targetSelectedZone.mid,
      }
    : null;

  const strategyFacts = strategy1Eligible
    ? buildStrategy1Facts({
        bars10m,
        entryZone,
        locationInvalidationBoundary:
          boundaries.locationInvalidationBoundary,
      })
    : null;

  const invalidated =
    strategyFacts?.invalidationFacts
      ?.completedCloseInvalidationConfirmed === true;

  const candidateActive = active && !invalidated;
  const candidateStatus = invalidated ? "INVALIDATED" : status;

  let zoneMemorySummary = null;
  let memoryWarnings = [];

  if (strategy1Eligible) {
    const memoryRead = readNegotiatedZoneMemory({
      filePath: memoryFilePath,
    });

    const memoryKey = buildStrategy1MemoryKey({
      laneId: "minute",
      symbol: normalizedSymbol,
      strategyId: normalizedStrategyId,
      zoneId,
    });

    const memoryCandidate = {
      laneId: "minute",
      symbol: normalizedSymbol,
      strategyId: normalizedStrategyId,
      zoneId,
      candidateId,
      candidateIdentityVersion:
        strategyIdentity?.candidateIdentityVersion || null,
      identityAdoptedFromLegacy:
        strategyIdentity?.identityAdoptedFromLegacy === true,
      legacyCandidateId:
        strategyIdentity?.legacyCandidateId || null,
    };

    let memoryUpdate = updateNegotiatedZoneMemory({
      store: memoryRead.store,
      memoryKey,
      candidate: memoryCandidate,
      facts: strategyFacts,
      snapshotTime,
    });

    const priorZoneId = previousLocationCandidate?.zoneId || null;
    if (priorZoneId && priorZoneId !== zoneId) {
      const priorMemoryKey = buildStrategy1MemoryKey({
        laneId: "minute",
        symbol: normalizedSymbol,
        strategyId: normalizedStrategyId,
        zoneId: priorZoneId,
      });
      memoryUpdate = {
        ...memoryUpdate,
        store: retirePriorMemoryRecord({
          store: memoryUpdate.store,
          priorMemoryKey,
          retiredAt: snapshotTime,
        }),
      };
    }

    if (persistMemory) {
      const memoryWrite = writeNegotiatedZoneMemory({
        filePath: memoryFilePath,
        store: memoryUpdate.store,
        malformedSource: memoryRead.malformed === true,
      });
      memoryWarnings = [
        ...(memoryRead.warnings || []),
        ...(memoryWrite.warnings || []),
      ];
    } else {
      memoryWarnings = memoryRead.warnings || [];
    }

    const record = memoryUpdate.record;
    zoneMemorySummary = {
      memoryKey,
      lifecycleStatus: record.lifecycleStatus,
      candidateFirstSeenAt: record.candidateFirstSeenAt,
      firstInteractionAt: record.firstInteractionAt,
      lastInteractionAt: record.lastInteractionAt,
      lastSeenAt: record.lastSeenAt,
      interactionCount: record.interactionCount,
      originalCandidateId: record.originalCandidateId,
      currentCandidateId: record.currentCandidateId,
      candidateIdentityVersion: record.candidateIdentityVersion,
      identityAdoptedFromLegacy: record.identityAdoptedFromLegacy,
      invalidatedAt: record.invalidatedAt,
      retiredAt: record.retiredAt,
    };
  }

  return {
    active: candidateActive,

    engine:
      "engine26.locationCandidate.v2",

    status: candidateStatus,

    candidateId,
    zoneId,

    symbol:
      normalizedSymbol,

    strategyId:
      normalizedStrategyId,

    timeframe:
      normalizedTimeframe,

    currentPrice:
      roundToTick(
        normalizedPrice,
        tickSize
      ),

    snapshotTime,

    directionBias,
    setupType,

    laneId: "minute",

    setupClass:
      strategyIdentity?.setupClass || null,
    setupGrade:
      strategyIdentity?.setupGrade || null,
    identitySetupKey:
      strategyIdentity?.identitySetupKey || null,
    candidateIdentityVersion:
      strategyIdentity?.candidateIdentityVersion || null,
    identityAdoptedFromLegacy:
      strategyIdentity?.identityAdoptedFromLegacy === true,
    legacyCandidateId:
      strategyIdentity?.legacyCandidateId || null,

    strategyEligibility: {
      setupClass: STRATEGY1_SETUP_CLASS,
      eligible: strategy1Eligible,
      reasonCodes: strategy1Eligible
        ? ["SELECTED_LOCATION_APPROVED_NEGOTIATED_ZONE"]
        : ["SELECTED_LOCATION_NOT_APPROVED_NEGOTIATED_ZONE"],
    },

    entryZone,
    entryZoneLow: entryZone?.low ?? null,
    entryZoneHigh: entryZone?.high ?? null,
    entryZoneMidline: entryZone?.midline ?? null,

    targetZone,
    targetZoneStatus: targetZone
      ? "TARGET_ZONE_AVAILABLE"
      : "TARGET_ZONE_UNAVAILABLE",
    targetZoneReasonCodes: targetZone
      ? ["NEXT_NEGOTIATED_ZONE_ABOVE_ENTRY_SELECTED"]
      : ["NEXT_NEGOTIATED_ZONE_ABOVE_ENTRY_UNAVAILABLE"],

    sweepFacts: strategyFacts?.sweepFacts || null,
    lowerWickFacts: strategyFacts?.lowerWickFacts || null,
    reclaimFacts: strategyFacts?.reclaimFacts || null,
    postReclaimFacts: strategyFacts?.postReclaimFacts || null,
    invalidationFacts: strategyFacts?.invalidationFacts || null,
    zoneMemorySummary,
    invalidatedAt:
      invalidated
        ? strategyFacts?.invalidationFacts?.invalidationTime || snapshotTime
        : null,

    location: {
      source:
        selectedZone.source,

      sourcePath:
        selectedZone.sourcePath,

      upstreamId:
        selectedZone.upstreamId,

      type:
        selectedZone.type,

      timeframe:
        selectedZone.timeframe,

      lo:
        selectedZone.lo,

      hi:
        selectedZone.hi,

      mid:
        selectedZone.mid,

      relation:
        selectedZone.relation,

      distancePoints:
        selectedZone.distancePoints,

      selectionScore:
        selectedZone.selectionScore,

      priority:
        selectedZone.priority,

      strength:
        selectedZone.strength,

      freshness:
        selectedZone.freshness,
    },

    ...boundaries,

    expectedReactions:
      expectedReactionsForDirection(
        directionBias
      ),

    activationRangePoints:
      safeActivationRange,

    monitoringRangePoints:
      safeMonitoringRange,

    structuralContext: {
      currentLifecycleKey:
        engine22WaveStrategy
          ?.currentLifecycleState
          ?.key ?? null,

      waveOpportunitySetupType:
        engine22WaveStrategy
          ?.waveOpportunity
          ?.setupType ?? null,

      minorStage:
        engine22WaveStrategy
          ?.degreeStates
          ?.minor
          ?.stage ?? null,

      minuteStage:
        engine22WaveStrategy
          ?.degreeStates
          ?.minute
          ?.stage ?? null,

      subminuteStage:
        engine22WaveStrategy
          ?.degreeStates
          ?.subminute
          ?.stage ?? null,
    },

    sourceRefs: [
      selectedZone.sourcePath,
      "engine22WaveStrategy.degreeStates",

      engine25Context
        ? "engine25Context"
        : null,
    ].filter(Boolean),

    candidateAlternatives:
      allZones
        .filter(
          (zone) =>
            zone !== selectedZone
        )
        .slice(0, 4)
        .map((zone) => ({
          source:
            zone.source,

          sourcePath:
            zone.sourcePath,

          type:
            zone.type,

          timeframe:
            zone.timeframe,

          lo:
            zone.lo,

          hi:
            zone.hi,

          mid:
            zone.mid,

          relation:
            zone.relation,

          distancePoints:
            zone.distancePoints,

          selectionScore:
            zone.selectionScore,
        })),

    reasonCodes: [
      "ENGINE26A_LOCATION_DISCOVERY_COMPLETE",
      "REACTION_INDEPENDENT_LOCATION_SELECTION",

      manualImbalanceInventory?.ok === true
        ? "ENGINE26A_MANUAL_IMBALANCE_INVENTORY_AVAILABLE"
        : "ENGINE26A_MANUAL_IMBALANCE_INVENTORY_UNAVAILABLE",

      authorizationEligibleZones.length > 0
        ? "ENGINE26A_IN_RANGE_ELIGIBILITY_APPLIED_BEFORE_RANKING"
        : "ENGINE26A_NO_IN_RANGE_LOCATION_DISTANT_FALLBACK",

      `ENGINE26A_SOURCE_${selectedZone.source}`,

      `ENGINE26A_STATUS_${status}`,

      directionBias === "NEUTRAL"
        ? "ENGINE26A_DIRECTION_BIAS_NEUTRAL"
        : `ENGINE26A_DIRECTION_${directionBias}`,

      candidateActive
        ? "ENGINE26A_CANDIDATE_WITHIN_MONITORING_RANGE"
        : invalidated
        ? "ENGINE26A_CANDIDATE_INVALIDATED_BY_COMPLETED_CLOSE"
        : "ENGINE26A_CANDIDATE_OUTSIDE_MONITORING_RANGE",

      ...(strategyIdentity?.reasonCodes || []),
      strategy1Eligible
        ? "ENGINE26_STRATEGY1_CLASSIFICATION_ATTACHED"
        : "ENGINE26_STRATEGY1_NOT_ELIGIBLE",
    ],

    warnings: [
      ...(directionBias === "NEUTRAL"
        ? ["ENGINE26A_DIRECTION_BIAS_NOT_RESOLVED"]
        : []),
      ...(strategyFacts?.warnings || []),
      ...memoryWarnings,
    ],

    noPermissionCreated: true,
    noExecution: true,
  };
}

export function buildEngine26AWaitingContract({
  symbol = null,
  strategyId = null,
  timeframe = null,
  currentPrice = null,
  snapshotTime = new Date().toISOString(),
  reasonCode = "ENGINE26A_WAITING",
  warnings = [],
} = {}) {
  const engine26LocationCandidate = makeWaitingCandidate({
    symbol,
    strategyId,
    timeframe,
    currentPrice,
    snapshotTime,
    reasonCode,
  });

  Object.assign(engine26LocationCandidate, {
    laneId: "minute",
    setupClass: null,
    setupGrade: null,
    identitySetupKey: null,
    candidateIdentityVersion: null,
    identityAdoptedFromLegacy: false,
    legacyCandidateId: null,
    strategyEligibility: {
      setupClass: STRATEGY1_SETUP_CLASS,
      eligible: false,
      reasonCodes: [reasonCode],
    },
    entryZone: null,
    entryZoneLow: null,
    entryZoneHigh: null,
    entryZoneMidline: null,
    targetZone: null,
    targetZoneStatus: "TARGET_ZONE_UNAVAILABLE",
    targetZoneReasonCodes: [reasonCode],
    sweepFacts: null,
    lowerWickFacts: null,
    reclaimFacts: null,
    postReclaimFacts: null,
    invalidationFacts: null,
    zoneMemorySummary: null,
    invalidatedAt: null,
    warnings: [...warnings],
  });

  const engine26ReactionHandoff = buildWaitingHandoff(
    engine26LocationCandidate,
    reasonCode
  );

  const engine26GeometryHandoff = {
    active: false,
    engine: "engine26.geometryHandoff.v1",
    laneId: "minute",
    strategyId,
    candidateId: null,
    zoneId: null,
    setupClass: null,
    setupGrade: null,
    identitySetupKey: null,
    candidateIdentityVersion: null,
    entryZone: null,
    targetZone: null,
    locationInvalidationBoundary: null,
    snapshotTime,
    noPermissionCreated: true,
    noExecution: true,
    reasonCodes: [reasonCode],
  };

  return {
    engine26LocationCandidate,
    engine26ReactionHandoff,
    engine26GeometryHandoff,
  };
}

export function buildEngine26ReactionHandoff({
  locationCandidate,
  snapshotTime = new Date().toISOString(),
} = {}) {
  const candidate =
    locationCandidate;

  if (
    !candidate ||
    candidate.candidateId == null ||
    candidate.zoneId == null
  ) {
    return buildWaitingHandoff(
      candidate,
      "NO_ENGINE26_LOCATION_CANDIDATE"
    );
  }

  const distancePoints =
    toFiniteNumber(
      candidate
        ?.location
        ?.distancePoints
    );

  const activationRangePoints =
    toFiniteNumber(
      candidate
        ?.activationRangePoints
    );

  const candidateActive =
    candidate.active === true;

  const withinActivationRange =
    candidateActive &&
    distancePoints !== null &&
    activationRangePoints !== null &&
    distancePoints <=
      activationRangePoints;

  const status =
    !candidateActive
      ? "WAITING_FOR_ACTIVATION_RANGE"
      : withinActivationRange
      ? "ACTIVE"
      : "WAITING_FOR_ACTIVATION_RANGE";

  return {
    active:
      withinActivationRange,

    engine:
      "engine26.reactionHandoff.v1",

    status,

    candidateId:
      candidate.candidateId,

    zoneId:
      candidate.zoneId,

    laneId:
      candidate.laneId ??
      "minute",

    symbol:
      candidate.symbol,

    strategyId:
      candidate.strategyId,

    timeframe:
      candidate.timeframe,

    snapshotTime:
      candidate.snapshotTime ||
      snapshotTime,

    tradeDirectionBias:
      candidate.directionBias,

    expectedReactionDirection:
      candidate.directionBias,

    setupType:
      candidate.setupType,

    setupClass: candidate.setupClass ?? null,
    setupGrade: candidate.setupGrade ?? null,
    identitySetupKey: candidate.identitySetupKey ?? null,
    candidateIdentityVersion:
      candidate.candidateIdentityVersion ?? null,
    entryZone: candidate.entryZone ?? null,
    targetZone: candidate.targetZone ?? null,
    sweepFacts: candidate.sweepFacts ?? null,
    lowerWickFacts: candidate.lowerWickFacts ?? null,
    reclaimFacts: candidate.reclaimFacts ?? null,
    postReclaimFacts: candidate.postReclaimFacts ?? null,
    invalidationFacts: candidate.invalidationFacts ?? null,
    zoneMemorySummary: candidate.zoneMemorySummary ?? null,

    expectedReactions:
      candidate.expectedReactions,

    zone:
      candidate.location
        ? {
            source:
              candidate.location.source,

            sourcePath:
              candidate.location.sourcePath,

            type:
              candidate.location.type,

            timeframe:
              candidate.location.timeframe,

            lo:
              candidate.location.lo,

            hi:
              candidate.location.hi,

            mid:
              candidate.location.mid,

            relation:
              candidate.location.relation,

            distancePoints:
              candidate.location.distancePoints,
          }
        : null,

    triggerLevel:
      candidate.triggerLevel,

    acceptanceBoundary:
      candidate.acceptanceBoundary,

    reclaimBoundary:
      candidate.reclaimBoundary,

    locationInvalidationBoundary:
      candidate
        .locationInvalidationBoundary,

    activationRangePoints:
      candidate.activationRangePoints,

    authorizeEngine3Evaluation:
      withinActivationRange,

    sourceRefs:
      candidate.sourceRefs || [],

    reasonCodes: [
      withinActivationRange
        ? "ENGINE26_REACTION_HANDOFF_ACTIVE"
        : "WAITING_FOR_ACTIVATION_RANGE",

      "ENGINE26A_EXPECTATION_ONLY",

      "ENGINE3_MUST_PUBLISH_OBSERVED_REACTION",
    ],

    noPermissionCreated: true,
    noExecution: true,
  };
}

export function buildEngine26A(
  input = {}
) {
  const engine26LocationCandidate =
    buildEngine26LocationCandidate(
      input
    );

  const engine26ReactionHandoff =
    buildEngine26ReactionHandoff({
      locationCandidate:
        engine26LocationCandidate,

      snapshotTime:
        input.snapshotTime,
    });

  const engine26GeometryHandoff = {
    active:
      engine26LocationCandidate?.active === true &&
      engine26LocationCandidate?.strategyEligibility?.eligible === true,
    engine: "engine26.geometryHandoff.v1",
    laneId: "minute",
    strategyId: engine26LocationCandidate?.strategyId ?? null,
    candidateId: engine26LocationCandidate?.candidateId ?? null,
    zoneId: engine26LocationCandidate?.zoneId ?? null,
    setupClass: engine26LocationCandidate?.setupClass ?? null,
    setupGrade: engine26LocationCandidate?.setupGrade ?? null,
    identitySetupKey:
      engine26LocationCandidate?.identitySetupKey ?? null,
    candidateIdentityVersion:
      engine26LocationCandidate?.candidateIdentityVersion ?? null,
    entryZone: engine26LocationCandidate?.entryZone ?? null,
    targetZone: engine26LocationCandidate?.targetZone ?? null,
    locationInvalidationBoundary:
      engine26LocationCandidate?.locationInvalidationBoundary ?? null,
    snapshotTime: engine26LocationCandidate?.snapshotTime ?? null,
    noPermissionCreated: true,
    noExecution: true,
    reasonCodes:
      engine26LocationCandidate?.strategyEligibility?.eligible === true
        ? ["ENGINE26_STRATEGY1_GEOMETRY_HANDOFF_AVAILABLE"]
        : ["ENGINE26_STRATEGY1_GEOMETRY_HANDOFF_UNAVAILABLE"],
  };

  return {
    engine26LocationCandidate,
    engine26ReactionHandoff,
    engine26GeometryHandoff,
  };
}

export default buildEngine26A;
