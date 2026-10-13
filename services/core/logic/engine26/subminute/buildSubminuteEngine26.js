// services/core/logic/engine26/subminute/buildSubminuteEngine26.js
//
// Independent Subminute Engine 26A/26B contract.
// Does not read or reuse Minute Engine 26 identity, control map, or geometry.
// Creates no permission, sizing, order, execution, or journal record.

import { createHash } from "node:crypto";
import { readEngine26ManualImbalanceZones } from "../readManualImbalanceZones.js";

const LANE_ID = "subminute";
const STRATEGY_ID = "subminute_scalp@10m";
const TRIGGER_TF = "10m";
const CONTEXT_TF = "1h";
const TICK = 0.25;
const MONITORING_RANGE = 18;
const ACTIVATION_RANGE = 3;

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function price(value) {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}

function roundTick(value, tick = TICK) {
  const n = num(value);
  return n === null ? null : Number((Math.round(n / tick) * tick).toFixed(2));
}

function round2(value) {
  const n = num(value);
  return n === null ? null : Number(n.toFixed(2));
}

function hash(prefix, parts) {
  const body = parts
    .map((part) => String(part ?? "NULL").trim().toUpperCase())
    .join("|");

  return `${prefix}-${createHash("sha256")
    .update(body)
    .digest("hex")
    .slice(0, 20)}`;
}

function direction(value) {
  const text = String(value || "").trim().toUpperCase();

  if (["LONG", "UP", "BULL", "BULLISH"].includes(text)) return "LONG";
  if (["SHORT", "DOWN", "BEAR", "BEARISH"].includes(text)) return "SHORT";
  if (text.includes("LONG")) return "LONG";
  if (text.includes("SHORT")) return "SHORT";

  return "NEUTRAL";
}

function distanceToZone(currentPrice, zone) {
  const p = num(currentPrice);
  const lo = num(zone?.lo);
  const hi = num(zone?.hi);

  if (p === null || lo === null || hi === null) return null;
  if (p >= lo && p <= hi) return 0;
  return round2(p < lo ? lo - p : p - hi);
}

function relationToZone(currentPrice, zone, activationRange) {
  const p = num(currentPrice);
  if (p === null) return "UNKNOWN";

  if (p >= zone.lo && p <= zone.hi) return "INSIDE_ZONE";

  if (p > zone.hi) {
    return p - zone.hi <= activationRange
      ? "NEAR_ABOVE_ZONE"
      : "ABOVE_ZONE";
  }

  return zone.lo - p <= activationRange
    ? "NEAR_BELOW_ZONE"
    : "BELOW_ZONE";
}

function normalizeZone({
  zone,
  source,
  sourcePath,
  type,
  priority,
  tickSize,
}) {
  if (!zone || typeof zone !== "object") return null;
  if (zone.invalidated === true || zone.expired === true) return null;
  if (zone.active === false && zone.invalidated !== false) return null;

  const direct = price(zone.price ?? zone.level ?? zone.mid ?? zone.value);
  const rawLo = price(zone.lo ?? zone.low ?? zone.from ?? direct);
  const rawHi = price(zone.hi ?? zone.high ?? zone.to ?? direct);

  if (rawLo === null || rawHi === null) return null;

  const lo = roundTick(Math.min(rawLo, rawHi), tickSize);
  const hi = roundTick(Math.max(rawLo, rawHi), tickSize);

  return {
    upstreamId: zone.id ?? zone.zoneId ?? null,
    source,
    sourcePath,
    type: String(zone.zoneType ?? zone.type ?? type).toUpperCase(),
    timeframe: zone.timeframe ?? zone.tf ?? TRIGGER_TF,
    side: zone.side ?? zone.direction ?? zone.bias ?? null,
    lo,
    hi,
    mid: roundTick((lo + hi) / 2, tickSize),
    priority,
    strength: num(zone.strength ?? zone.score ?? zone.confidence),
  };
}

function collectZones(engine1Context, tickSize) {
  const inventory = readEngine26ManualImbalanceZones();
  const output = [];

  const add = (zone, source, sourcePath, type, priority) => {
    const normalized = normalizeZone({
      zone,
      source,
      sourcePath,
      type,
      priority,
      tickSize,
    });

    if (normalized) output.push(normalized);
  };

  const manual = Array.isArray(inventory?.zones) ? inventory.zones : [];

  manual.forEach((zone, index) => {
    add(
      zone,
      "ENGINE26_SUBMINUTE_MANUAL_IMBALANCE",
      `manualImbalanceInventory.zones[${index}]`,
      "SUBMINUTE_MANUAL_IMBALANCE",
      115
    );
  });

  add(
    engine1Context?.active?.shelf,
    "ENGINE1_SUBMINUTE",
    "engine1Context.active.shelf",
    "SUBMINUTE_ACTIVE_SHELF",
    108
  );

  add(
    engine1Context?.nearest?.shelf,
    "ENGINE1_SUBMINUTE",
    "engine1Context.nearest.shelf",
    "SUBMINUTE_NEAREST_SHELF",
    102
  );

  const shelves = Array.isArray(engine1Context?.render?.shelves)
    ? engine1Context.render.shelves
    : [];

  shelves.forEach((zone, index) => {
    add(
      zone,
      "ENGINE1_SUBMINUTE",
      `engine1Context.render.shelves[${index}]`,
      "SUBMINUTE_RENDER_SHELF",
      92
    );
  });

  const seen = new Map();

  for (const zone of output) {
    const key = [
      zone.source,
      zone.upstreamId,
      zone.type,
      zone.timeframe,
      zone.lo,
      zone.hi,
    ]
      .map((value) => String(value ?? "NULL").toUpperCase())
      .join("|");

    if (!seen.has(key) || zone.priority > seen.get(key).priority) {
      seen.set(key, zone);
    }
  }

  return {
    inventory,
    zones: [...seen.values()],
  };
}

function getStructure(engine22WaveStrategy) {
  return {
    subminute: engine22WaveStrategy?.degreeStates?.subminute ?? null,
    minute: engine22WaveStrategy?.degreeStates?.minute ?? null,
  };
}

function inferDirection(engine22WaveStrategy) {
  const { subminute, minute } = getStructure(engine22WaveStrategy);

  const candidates = [
    subminute?.preferredTradeDirection,
    subminute?.internalStructure?.preferredTradeDirection,
    subminute?.direction,
    subminute?.nestedCorrectionContext?.direction,
    minute?.direction,
  ];

  for (const candidate of candidates) {
    const normalized = direction(candidate);
    if (normalized !== "NEUTRAL") return normalized;
  }

  return "NEUTRAL";
}

function inferSetupType(engine22WaveStrategy) {
  const { subminute } = getStructure(engine22WaveStrategy);

  return (
    subminute?.setupType ||
    subminute?.stage ||
    subminute?.activeWave ||
    subminute?.nestedCorrectionContext?.currentRead ||
    "SUBMINUTE_LOCATION_WATCH"
  );
}

function structurallyCompatible(zone, tradeDirection, engine22WaveStrategy) {
  const { subminute, minute } = getStructure(engine22WaveStrategy);

  if (!subminute) return false;

  const zoneDirection = direction(zone.side);

  if (
    zoneDirection !== "NEUTRAL" &&
    tradeDirection !== "NEUTRAL" &&
    zoneDirection !== tradeDirection
  ) {
    return false;
  }

  const subDirection = direction(subminute?.direction);
  const minuteDirection = direction(minute?.direction);

  if (
    subDirection !== "NEUTRAL" &&
    minuteDirection !== "NEUTRAL" &&
    subDirection !== minuteDirection
  ) {
    return false;
  }

  return true;
}

function incompleteIdentity(snapshotTime) {
  return {
    laneId: LANE_ID,
    strategyId: STRATEGY_ID,
    candidateId: null,
    zoneId: null,
    symbol: "ES",
    direction: "NEUTRAL",
    setupType: null,
    snapshotTime,
    complete: false,
  };
}

function waitingResult({
  currentPrice,
  snapshotTime,
  status,
  reasonCodes,
  warnings = [],
}) {
  const pipelineIdentity = incompleteIdentity(snapshotTime);

  const engine26LocationCandidate = {
    laneId: LANE_ID,
    strategyId: STRATEGY_ID,
    candidateId: null,
    zoneId: null,
    symbol: "ES",
    direction: "NEUTRAL",
    directionBias: "NEUTRAL",
    setupType: null,
    active: false,
    status,
    currentPrice,
    snapshotTime,
    pipelineIdentity,
    locationContext: null,
    controlMap: null,
    location: null,
    reasonCodes,
    warnings,
    noPermissionCreated: true,
    noExecution: true,
  };

  return {
    engine26LocationCandidate,
    engine26PipelineIdentity: pipelineIdentity,
    engine26LocationContext: null,
    engine26ControlMap: null,
    engine26ProposedGeometry: {
      laneId: LANE_ID,
      strategyId: STRATEGY_ID,
      candidateId: null,
      zoneId: null,
      symbol: "ES",
      direction: "NEUTRAL",
      setupType: null,
      active: false,
      lifecycleStatus: "WAITING_FOR_ENGINE26A",
      proposedEntryPrice: null,
      proposedStopPrice: null,
      proposedStopDistancePoints: null,
      proposedTargets: [],
      candidateIdentityPreserved: false,
      snapshotTime,
      proposalOnly: true,
      plannerOnly: true,
      official: false,
      officialPlanOwner: "ENGINE9",
      nonExecutable: true,
      noPermissionCreated: true,
      noOrderCreated: true,
      noExecution: true,
      reasonCodes: ["SUBMINUTE_ENGINE26A_IDENTITY_INCOMPLETE"],
      warnings,
    },
  };
}

function buildControlMap({
  candidateId,
  zoneId,
  currentPrice,
  snapshotTime,
  tradeDirection,
  selectedZone,
  eligibleZones,
  tickSize,
}) {
  const triggerLevel =
    tradeDirection === "LONG" ? selectedZone.hi : selectedZone.lo;

  const invalidationBoundary =
    tradeDirection === "LONG"
      ? roundTick(selectedZone.lo - tickSize, tickSize)
      : roundTick(selectedZone.hi + tickSize, tickSize);

  const targets = eligibleZones
    .filter((zone) => zone !== selectedZone)
    .filter((zone) =>
      tradeDirection === "LONG"
        ? zone.lo > selectedZone.hi
        : zone.hi < selectedZone.lo
    )
    .sort((a, b) => a.distancePoints - b.distancePoints)
    .slice(0, 3);

  return {
    active: true,
    laneId: LANE_ID,
    strategyId: STRATEGY_ID,
    candidateId,
    zoneId,
    symbol: "ES",
    direction: tradeDirection,
    snapshotTime,

    triggerLevel,
    acceptanceBoundary: triggerLevel,
    reclaimBoundary:
      tradeDirection === "LONG" ? selectedZone.lo : selectedZone.hi,
    invalidationBoundary,

    currentControlState:
      currentPrice >= selectedZone.lo && currentPrice <= selectedZone.hi
        ? "INSIDE_SUBMINUTE_ZONE"
        : currentPrice > selectedZone.hi
        ? "ABOVE_SUBMINUTE_ZONE"
        : "BELOW_SUBMINUTE_ZONE",

    requiredReaction:
      tradeDirection === "LONG"
        ? "RECLAIM_OR_HOLD_ABOVE_TRIGGER"
        : "LOSS_OR_FAILED_RECLAIM_BELOW_TRIGGER",

    invalidationCondition:
      tradeDirection === "LONG"
        ? "CLOSE_BELOW_INVALIDATION_BOUNDARY"
        : "CLOSE_ABOVE_INVALIDATION_BOUNDARY",

    targetSourceZones: targets.map((zone) => ({
      source: zone.source,
      sourcePath: zone.sourcePath,
      upstreamId: zone.upstreamId,
      type: zone.type,
      lo: zone.lo,
      hi: zone.hi,
      mid: zone.mid,
    })),

    noPermissionCreated: true,
    noExecution: true,
  };
}

function buildGeometry(identity, locationContext, controlMap, tickSize) {
  const entry = roundTick(controlMap.triggerLevel, tickSize);
  const stop = roundTick(controlMap.invalidationBoundary, tickSize);

  const risk =
    identity.direction === "LONG"
      ? round2(entry - stop)
      : round2(stop - entry);

  const targets = controlMap.targetSourceZones
    .map((zone, index) => {
      const targetPrice =
        identity.direction === "LONG" ? zone.lo : zone.hi;

      const valid =
        identity.direction === "LONG"
          ? targetPrice > entry
          : targetPrice < entry;

      return valid
        ? {
            targetId: `SUBMINUTE_T${index + 1}`,
            sequence: index + 1,
            price: roundTick(targetPrice, tickSize),
            label: `${zone.type} ${zone.source}`,
          }
        : null;
    })
    .filter(Boolean);

  const active =
    identity.complete === true &&
    entry > 0 &&
    stop > 0 &&
    risk > 0 &&
    (
      (identity.direction === "LONG" && stop < entry) ||
      (identity.direction === "SHORT" && stop > entry)
    );

  return {
    laneId: LANE_ID,
    strategyId: STRATEGY_ID,
    candidateId: identity.candidateId,
    zoneId: identity.zoneId,
    symbol: identity.symbol,
    direction: identity.direction,
    setupType: identity.setupType,
    active,
    lifecycleStatus: active
      ? "PROPOSED_GEOMETRY_AVAILABLE"
      : "PROPOSED_GEOMETRY_INVALID",
    proposedEntryPrice: entry,
    proposedStopPrice: stop,
    proposedStopDistancePoints: risk,
    proposedTargets: targets,
    candidateIdentityPreserved:
      active &&
      locationContext.candidateId === identity.candidateId &&
      locationContext.zoneId === identity.zoneId &&
      controlMap.candidateId === identity.candidateId &&
      controlMap.zoneId === identity.zoneId,
    snapshotTime: identity.snapshotTime,
    proposalOnly: true,
    plannerOnly: true,
    official: false,
    officialPlanOwner: "ENGINE9",
    nonExecutable: true,
    noPermissionCreated: true,
    noOrderCreated: true,
    noExecution: true,
    reasonCodes: active
      ? [
          "SUBMINUTE_ENGINE26B_GEOMETRY_AVAILABLE",
          "SUBMINUTE_ENGINE26A_IDENTITY_CONSUMED",
          "SUBMINUTE_CANDIDATE_IDENTITY_PRESERVED",
        ]
      : ["SUBMINUTE_ENGINE26B_GEOMETRY_INVALID"],
    warnings:
      targets.length === 0
        ? ["SUBMINUTE_PROPOSED_TARGETS_UNAVAILABLE"]
        : [],
  };
}

export function buildSubminuteEngine26({
  symbol = "ES",
  currentPrice,
  snapshotTime = new Date().toISOString(),
  engine22WaveStrategy = null,
  engine1Context = null,
  tickSize = TICK,
  monitoringRangePoints = Number(
    process.env.ENGINE26_SUBMINUTE_MONITORING_RANGE_POINTS ??
      MONITORING_RANGE
  ),
  activationRangePoints = Number(
    process.env.ENGINE26_SUBMINUTE_ACTIVATION_RANGE_POINTS ??
      ACTIVATION_RANGE
  ),
} = {}) {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const normalizedPrice = price(currentPrice);

  const monitoringRange = Number.isFinite(monitoringRangePoints)
    ? Math.max(0, monitoringRangePoints)
    : MONITORING_RANGE;

  const activationRange = Number.isFinite(activationRangePoints)
    ? Math.max(0, Math.min(activationRangePoints, monitoringRange))
    : ACTIVATION_RANGE;

  if (normalizedSymbol !== "ES" || normalizedPrice === null) {
    return waitingResult({
      currentPrice: normalizedPrice,
      snapshotTime,
      status: "WAITING_FOR_INPUTS",
      reasonCodes: ["SUBMINUTE_REQUIRED_INPUT_MISSING"],
    });
  }

  const { subminute, minute } = getStructure(engine22WaveStrategy);

  if (!subminute) {
    return waitingResult({
      currentPrice: roundTick(normalizedPrice, tickSize),
      snapshotTime,
      status: "WAITING_FOR_STRUCTURE",
      reasonCodes: ["SUBMINUTE_ENGINE22_STRUCTURE_MISSING"],
    });
  }

  const tradeDirection = inferDirection(engine22WaveStrategy);
  const setupType = inferSetupType(engine22WaveStrategy);

  if (tradeDirection === "NEUTRAL") {
    return waitingResult({
      currentPrice: roundTick(normalizedPrice, tickSize),
      snapshotTime,
      status: "WAITING_FOR_DIRECTION",
      reasonCodes: ["SUBMINUTE_DIRECTION_UNRESOLVED"],
    });
  }

  const { inventory, zones } = collectZones(engine1Context, tickSize);

  const ranked = zones
    .filter(
      (zone) =>
        String(zone.timeframe || "").toLowerCase() ===
        TRIGGER_TF.toLowerCase()
    )
    .filter((zone) =>
      structurallyCompatible(
        zone,
        tradeDirection,
        engine22WaveStrategy
      )
    )
    .map((zone) => {
      const distancePoints = distanceToZone(normalizedPrice, zone);

      if (distancePoints === null) return null;

      const structureBonus =
        (subminute?.activeWave ? 8 : 0) +
        (subminute?.stage ? 6 : 0) +
        (subminute?.nestedCorrectionContext?.currentRead ? 4 : 0);

      const sideBonus =
        direction(zone.side) === tradeDirection ? 8 : 0;

      return {
        ...zone,
        distancePoints,
        selectionScore: round2(
          zone.priority +
            structureBonus +
            sideBonus +
            Math.min(Number(zone.strength ?? 0), 10) -
            Math.min(distancePoints, 50) * 1.5
        ),
      };
    })
    .filter(Boolean);

  const eligible = ranked
    .filter((zone) => zone.distancePoints <= monitoringRange)
    .sort((a, b) => {
      if (b.selectionScore !== a.selectionScore) {
        return b.selectionScore - a.selectionScore;
      }

      return a.distancePoints - b.distancePoints;
    });

  const selected = eligible[0] || null;

  if (!selected) {
    return waitingResult({
      currentPrice: roundTick(normalizedPrice, tickSize),
      snapshotTime,
      status: ranked.length
        ? "LOCATION_DETECTED"
        : "WAITING_FOR_LOCATION",
      reasonCodes: ranked.length
        ? [
            "SUBMINUTE_NO_IN_RANGE_LOCATION",
            "SUBMINUTE_DISTANT_LOCATIONS_INFORMATIONAL_ONLY",
          ]
        : ["SUBMINUTE_NO_VALID_LOCATION_SOURCE"],
      warnings:
        inventory?.ok === false
          ? ["SUBMINUTE_MANUAL_INVENTORY_UNAVAILABLE"]
          : [],
    });
  }

  const zoneId = hash("E26Z-SUBMINUTE", [
    LANE_ID,
    STRATEGY_ID,
    normalizedSymbol,
    selected.source,
    selected.upstreamId,
    selected.type,
    selected.timeframe,
    selected.lo,
    selected.hi,
  ]);

  const candidateId = hash("E26C-SUBMINUTE", [
    LANE_ID,
    STRATEGY_ID,
    normalizedSymbol,
    zoneId,
    tradeDirection,
    setupType,
  ]);

  const relation = relationToZone(
    normalizedPrice,
    selected,
    activationRange
  );

  const status =
    selected.distancePoints === 0
      ? "INSIDE_LOCATION"
      : selected.distancePoints <= activationRange
      ? "APPROACHING_LOCATION"
      : "LOCATION_DETECTED";

  const identity = {
    laneId: LANE_ID,
    strategyId: STRATEGY_ID,
    candidateId,
    zoneId,
    symbol: normalizedSymbol,
    direction: tradeDirection,
    setupType,
    snapshotTime,
    complete: true,
  };

  const locationContext = {
    active: true,
    laneId: LANE_ID,
    strategyId: STRATEGY_ID,
    symbol: normalizedSymbol,
    triggerTimeframe: TRIGGER_TF,
    contextTimeframe: CONTEXT_TF,
    candidateId,
    zoneId,
    upstreamId: selected.upstreamId,
    currentPrice: roundTick(normalizedPrice, tickSize),
    snapshotTime,
    direction: tradeDirection,
    setupType,
    zone: {
      source: selected.source,
      sourcePath: selected.sourcePath,
      type: selected.type,
      side: selected.side,
      timeframe: selected.timeframe,
      lo: selected.lo,
      hi: selected.hi,
      mid: selected.mid,
    },
    relation,
    distancePoints: selected.distancePoints,
    monitoringRangePoints: monitoringRange,
    activationRangePoints: activationRange,
    parentContext: {
      subminuteDirection: subminute?.direction ?? null,
      subminuteStage: subminute?.stage ?? null,
      subminuteActiveWave: subminute?.activeWave ?? null,
      minuteDirection: minute?.direction ?? null,
      minuteStage: minute?.stage ?? null,
      minuteActiveWave: minute?.activeWave ?? null,
    },
    invalidated: false,
    expired: false,
    noPermissionCreated: true,
    noExecution: true,
  };

  const controlMap = buildControlMap({
    candidateId,
    zoneId,
    currentPrice: roundTick(normalizedPrice, tickSize),
    snapshotTime,
    tradeDirection,
    selectedZone: selected,
    eligibleZones: eligible,
    tickSize,
  });

  const engine26LocationCandidate = {
    laneId: LANE_ID,
    strategyId: STRATEGY_ID,
    candidateId,
    zoneId,
    symbol: normalizedSymbol,
    direction: tradeDirection,
    directionBias: tradeDirection,
    setupType,
    active: true,
    status,
    currentPrice: roundTick(normalizedPrice, tickSize),
    snapshotTime,
    pipelineIdentity: identity,
    locationContext,
    controlMap,
    location: {
      source: selected.source,
      sourcePath: selected.sourcePath,
      upstreamId: selected.upstreamId,
      type: selected.type,
      timeframe: selected.timeframe,
      side: selected.side,
      lo: selected.lo,
      hi: selected.hi,
      mid: selected.mid,
      relation,
      distancePoints: selected.distancePoints,
      selectionScore: selected.selectionScore,
      priority: selected.priority,
      strength: selected.strength,
    },
    candidateAlternatives: eligible
      .filter((zone) => zone !== selected)
      .slice(0, 4)
      .map((zone) => ({
        source: zone.source,
        sourcePath: zone.sourcePath,
        upstreamId: zone.upstreamId,
        type: zone.type,
        timeframe: zone.timeframe,
        lo: zone.lo,
        hi: zone.hi,
        mid: zone.mid,
        distancePoints: zone.distancePoints,
        selectionScore: zone.selectionScore,
      })),
    reasonCodes: [
      "SUBMINUTE_ENGINE26A_LOCATION_DISCOVERY_COMPLETE",
      "SUBMINUTE_REACTION_INDEPENDENT_LOCATION_SELECTION",
      "SUBMINUTE_LANE_IDENTITY_CREATED",
      "SUBMINUTE_ELIGIBILITY_APPLIED_BEFORE_RANKING",
      `SUBMINUTE_SOURCE_${selected.source}`,
      `SUBMINUTE_STATUS_${status}`,
      `SUBMINUTE_DIRECTION_${tradeDirection}`,
    ],
    warnings: [],
    noPermissionCreated: true,
    noExecution: true,
  };

  return {
    engine26LocationCandidate,
    engine26PipelineIdentity: identity,
    engine26LocationContext: locationContext,
    engine26ControlMap: controlMap,
    engine26ProposedGeometry: buildGeometry(
      identity,
      locationContext,
      controlMap,
      tickSize
    ),
  };
}
