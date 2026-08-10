import { createHash } from "node:crypto";
import { normalizeStrategy1Bars } from "./buildStrategy1Facts.js";

const DEFAULT_TICK_SIZE = 0.25;
const CONSOLIDATION_TOLERANCE_POINTS = 2;
const MIN_CONSOLIDATION_COMPLETED_CANDLES = 3;
const MIN_CONSOLIDATION_QUALIFYING_CLOSES = 2;
const ACCEPTANCE_OFFSET_POINTS = 2;
const ROTATION_AWAY_POINTS = 8;
const RETEST_PROXIMITY_POINTS = 3;
const RETEST_FAILURE_POINTS = 2;

const STATE_RANK = Object.freeze({
  NONE: 0,
  CONSOLIDATION_AT_RESISTANCE: 1,
  FAILED_ACCEPTANCE_AT_RESISTANCE: 2,
  ROTATION_AWAY_FROM_RESISTANCE: 3,
  PULLBACK_RETEST_OF_RESISTANCE: 4,
  PULLBACK_FAILED_AT_RESISTANCE: 5,
  RESISTANCE_ACCEPTED_ABOVE: 6,
});

function toFinite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundToTick(value, tickSize = DEFAULT_TICK_SIZE) {
  const n = toFinite(value);
  if (n === null) return null;
  return Number((Math.round(n / tickSize) * tickSize).toFixed(2));
}

function normalizeTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n) && /^\d+(?:\.\d+)?$/.test(String(value))) {
    const ms = n > 1e12 ? n : n * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function timeMs(value) {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function afterTime(bar, value, inclusive = false) {
  const barMs = timeMs(bar?.time);
  const valueMs = timeMs(value);
  if (barMs === null || valueMs === null) return true;
  return inclusive ? barMs >= valueMs : barMs > valueMs;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stableEventId({ candidateId, zoneId, candidateIdentityVersion, referenceLevel, lifecycleStart }) {
  const body = [candidateId, zoneId, candidateIdentityVersion, referenceLevel, lifecycleStart]
    .map((value) => String(value ?? "NULL").trim().toUpperCase())
    .join("|");
  return `E26LE-${createHash("sha256").update(body).digest("hex").slice(0, 20)}`;
}

function normalizeZone(entryZone, tickSize) {
  const low = roundToTick(entryZone?.low ?? entryZone?.lo, tickSize);
  const high = roundToTick(entryZone?.high ?? entryZone?.hi, tickSize);
  const midline = roundToTick(entryZone?.midline ?? entryZone?.mid, tickSize);
  if ([low, high, midline].some((value) => value === null)) return null;
  return {
    lo: Math.min(low, high),
    midline,
    hi: Math.max(low, high),
  };
}

function sameZoneGeometry(a, b) {
  if (!a || !b) return false;
  return (
    toFinite(a?.lo) === toFinite(b?.lo) &&
    toFinite(a?.midline) === toFinite(b?.midline) &&
    toFinite(a?.hi) === toFinite(b?.hi)
  );
}

function priorIdentityMatches({ priorLocationEvent, identity, zone }) {
  if (!priorLocationEvent || !identity || !zone) return false;
  return (
    priorLocationEvent?.candidateId === identity?.candidateId &&
    priorLocationEvent?.zoneId === identity?.zoneId &&
    priorLocationEvent?.laneId === identity?.laneId &&
    priorLocationEvent?.strategyId === identity?.strategyId &&
    String(priorLocationEvent?.symbol || "").toUpperCase() ===
      String(identity?.symbol || "").toUpperCase() &&
    priorLocationEvent?.candidateIdentityVersion ===
      identity?.candidateIdentityVersion &&
    sameZoneGeometry(priorLocationEvent?.zone, zone)
  );
}

function canonicalSourceRank(candidate) {
  const source = String(candidate?.source || "").toUpperCase();
  const type = String(candidate?.type || "").toUpperCase();

  if (source === "ENGINE1") return 1;

  if (
    source.startsWith("ENGINE26") &&
    !source.includes("MANUAL_IMBALANCE")
  ) {
    return 1;
  }

  if (["INSTITUTIONAL", "NEGOTIATED", "SHELF"].some((token) => type.includes(token))) {
    return 2;
  }

  if (source === "ENGINE26_MANUAL_IMBALANCE") return 3;

  return 99;
}

function candidateLevels(candidate, tickSize) {
  const explicit = [
    candidate?.referenceLevel,
    candidate?.level,
    candidate?.price,
    candidate?.value,
  ]
    .map((value) => roundToTick(value, tickSize))
    .filter((value) => value !== null);

  if (explicit.length) return [...new Set(explicit)];

  return [...new Set([
    roundToTick(candidate?.lo ?? candidate?.low, tickSize),
    roundToTick(candidate?.mid ?? candidate?.midline, tickSize),
    roundToTick(candidate?.hi ?? candidate?.high, tickSize),
  ].filter((value) => value !== null))];
}

function barInteractsBand(bar, referenceLevel, tolerancePoints) {
  return (
    toFinite(bar?.high) !== null &&
    toFinite(bar?.low) !== null &&
    bar.high >= referenceLevel - tolerancePoints &&
    bar.low <= referenceLevel + tolerancePoints
  );
}

function closeInsideBand(bar, referenceLevel, tolerancePoints) {
  const close = toFinite(bar?.close);
  return (
    close !== null &&
    close >= referenceLevel - tolerancePoints &&
    close <= referenceLevel + tolerancePoints
  );
}

function scoreReferenceLevel({ level, bars, sourceRank, zoneHigh }) {
  const completed = bars.filter((bar) => bar.completed === true);
  const interactions = completed.filter((bar) =>
    barInteractsBand(bar, level, CONSOLIDATION_TOLERANCE_POINTS)
  );
  const qualifyingCloses = interactions.filter((bar) =>
    closeInsideBand(bar, level, CONSOLIDATION_TOLERANCE_POINTS)
  );

  return {
    level,
    sourceRank,
    interactionCount: interactions.length,
    qualifyingCloseCount: qualifyingCloses.length,
    distanceAboveZone: Math.max(0, level - zoneHigh),
  };
}

function resolveCanonicalReference({ referenceCandidates, bars, zone, tickSize }) {
  const rows = Array.isArray(referenceCandidates) ? referenceCandidates : [];
  const scored = [];

  rows.forEach((candidate, candidateIndex) => {
    const sourceRank = canonicalSourceRank(candidate);
    if (sourceRank >= 99) return;

    for (const level of candidateLevels(candidate, tickSize)) {
      if (!(level > zone.hi)) continue;

      const evidence = scoreReferenceLevel({
        level,
        bars,
        sourceRank,
        zoneHigh: zone.hi,
      });

      if (evidence.interactionCount < 1) continue;

      scored.push({
        ...evidence,
        source: candidate?.source || "CANONICAL_LOCATION_REFERENCE",
        sourcePath: candidate?.sourcePath || null,
        type: candidate?.type || null,
        candidateIndex,
      });
    }
  });

  scored.sort((a, b) => {
    if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
    if (b.interactionCount !== a.interactionCount) {
      return b.interactionCount - a.interactionCount;
    }
    if (b.qualifyingCloseCount !== a.qualifyingCloseCount) {
      return b.qualifyingCloseCount - a.qualifyingCloseCount;
    }
    if (a.distanceAboveZone !== b.distanceAboveZone) {
      return a.distanceAboveZone - b.distanceAboveZone;
    }
    return a.candidateIndex - b.candidateIndex;
  });

  const best = scored[0];
  if (!best) return null;

  return {
    level: best.level,
    source: best.source,
    sourcePath: best.sourcePath,
    sourceType: best.type,
    side: "ABOVE_ZONE",
    derivation: "CANONICAL_LOCATION_REFERENCE",
    tolerancePoints: CONSOLIDATION_TOLERANCE_POINTS,
  };
}

function resolveDerivedReference({ bars, zone, tickSize }) {
  const completed = bars.filter((bar) => bar.completed === true);
  const levels = [...new Set(
    completed
      .flatMap((bar) => [bar.high, bar.close])
      .map((value) => roundToTick(value, tickSize))
      .filter((level) => level !== null && level > zone.hi)
  )];

  const scored = levels
    .map((level) => scoreReferenceLevel({
      level,
      bars,
      sourceRank: 4,
      zoneHigh: zone.hi,
    }))
    .filter((row) =>
      row.interactionCount >= MIN_CONSOLIDATION_COMPLETED_CANDLES &&
      row.qualifyingCloseCount >= MIN_CONSOLIDATION_QUALIFYING_CLOSES
    )
    .sort((a, b) => {
      if (b.interactionCount !== a.interactionCount) {
        return b.interactionCount - a.interactionCount;
      }
      if (b.qualifyingCloseCount !== a.qualifyingCloseCount) {
        return b.qualifyingCloseCount - a.qualifyingCloseCount;
      }
      if (a.distanceAboveZone !== b.distanceAboveZone) {
        return a.distanceAboveZone - b.distanceAboveZone;
      }
      return a.level - b.level;
    });

  const best = scored[0];
  if (!best) return null;

  return {
    level: best.level,
    source: "ENGINE26_DERIVED_COMPLETED_10M_CLUSTER",
    sourcePath: null,
    sourceType: "REPEATED_COMPLETED_CANDLE_INTERACTION",
    side: "ABOVE_ZONE",
    derivation: "REPEATED_COMPLETED_10M_CLUSTER",
    tolerancePoints: CONSOLIDATION_TOLERANCE_POINTS,
  };
}

function findConsolidation({ completedBars, referenceLevel }) {
  let interactionCount = 0;
  let qualifyingCloseCount = 0;
  const qualifying = [];

  for (const bar of completedBars) {
    if (!barInteractsBand(bar, referenceLevel, CONSOLIDATION_TOLERANCE_POINTS)) {
      continue;
    }

    interactionCount += 1;
    qualifying.push(bar);

    if (closeInsideBand(bar, referenceLevel, CONSOLIDATION_TOLERANCE_POINTS)) {
      qualifyingCloseCount += 1;
    }

    if (
      interactionCount >= MIN_CONSOLIDATION_COMPLETED_CANDLES &&
      qualifyingCloseCount >= MIN_CONSOLIDATION_QUALIFYING_CLOSES
    ) {
      return {
        observed: true,
        startedAt: qualifying[0]?.time ?? null,
        endedAt: bar.time,
        completedCandleCount: interactionCount,
        qualifyingCloseCount,
        highestPrice: Math.max(...qualifying.map((row) => row.high)),
        lowestPrice: Math.min(...qualifying.map((row) => row.low)),
        closesAboveReference: qualifying.filter((row) => row.close > referenceLevel).length,
        sustainedAcceptanceAbove: false,
      };
    }
  }

  return {
    observed: false,
    startedAt: null,
    endedAt: null,
    completedCandleCount: interactionCount,
    qualifyingCloseCount,
    highestPrice: qualifying.length
      ? Math.max(...qualifying.map((row) => row.high))
      : null,
    lowestPrice: qualifying.length
      ? Math.min(...qualifying.map((row) => row.low))
      : null,
    closesAboveReference: qualifying.filter((row) => row.close > referenceLevel).length,
    sustainedAcceptanceAbove: false,
  };
}

function findAcceptedAbove({ completedBars, referenceLevel, after }) {
  const threshold = referenceLevel + ACCEPTANCE_OFFSET_POINTS;
  let previous = null;

  for (const bar of completedBars) {
    if (!afterTime(bar, after, true)) continue;
    if (bar.close > threshold) {
      if (previous) {
        return {
          observed: true,
          firstCloseAt: previous.time,
          confirmedAt: bar.time,
          firstClose: previous.close,
          secondClose: bar.close,
          threshold,
        };
      }
      previous = bar;
    } else {
      previous = null;
    }
  }

  return {
    observed: false,
    firstCloseAt: null,
    confirmedAt: null,
    firstClose: null,
    secondClose: null,
    threshold,
  };
}

function findInitialFailure({ completedBars, referenceLevel, after }) {
  const threshold = referenceLevel - RETEST_FAILURE_POINTS;
  for (const bar of completedBars) {
    if (!afterTime(bar, after, false)) continue;
    if (
      barInteractsBand(bar, referenceLevel, CONSOLIDATION_TOLERANCE_POINTS) &&
      bar.close <= threshold
    ) {
      return {
        observed: true,
        confirmedAt: bar.time,
        failureClose: bar.close,
      };
    }
  }
  return {
    observed: false,
    confirmedAt: null,
    failureClose: null,
  };
}

function findRotation({ completedBars, referenceLevel, zone, after }) {
  let rotationLow = null;
  let rotationLowAt = null;
  let qualifyingAt = null;
  let reachedZone = false;
  let reachedMidline = false;

  for (const bar of completedBars) {
    if (!afterTime(bar, after, false)) continue;

    if (rotationLow === null || bar.low < rotationLow) {
      rotationLow = bar.low;
      rotationLowAt = bar.time;
    }

    const distanceQualified = bar.low <= referenceLevel - ROTATION_AWAY_POINTS;
    const zoneQualified = bar.low <= zone.hi;
    const midlineQualified = bar.low <= zone.midline;

    reachedZone = reachedZone || zoneQualified;
    reachedMidline = reachedMidline || midlineQualified;

    if (!qualifyingAt && (distanceQualified || zoneQualified || midlineQualified)) {
      qualifyingAt = bar.time;
    }
  }

  return {
    observed: qualifyingAt !== null,
    confirmedAt: qualifyingAt,
    rotationLow,
    rotationLowAt,
    rotationDistancePoints:
      rotationLow === null ? null : Number((referenceLevel - rotationLow).toFixed(2)),
    reachedZone,
    reachedMidline,
  };
}

function rangeDistanceFromReference(bar, referenceLevel) {
  if (bar.low <= referenceLevel && bar.high >= referenceLevel) return 0;
  return Number(Math.min(
    Math.abs(referenceLevel - bar.low),
    Math.abs(referenceLevel - bar.high)
  ).toFixed(2));
}

function findRetest({ bars, referenceLevel, after }) {
  const candidates = bars.filter((bar) => {
    if (!afterTime(bar, after, false)) return false;
    return (
      bar.high >= referenceLevel - RETEST_PROXIMITY_POINTS &&
      bar.low <= referenceLevel + RETEST_PROXIMITY_POINTS
    );
  });

  if (!candidates.length) {
    return {
      observed: false,
      startedAt: null,
      testedAt: null,
      highestPrice: null,
      distanceFromReferencePoints: null,
      status: null,
      failureConfirmedAt: null,
      failureClose: null,
      strongFailureObserved: false,
      closedBelowZoneHigh: false,
      closedInsideZone: false,
      returnedToMidline: false,
    };
  }

  const first = candidates[0];
  const highestPrice = Math.max(...candidates.map((bar) => bar.high));
  const distanceFromReferencePoints = Math.min(
    ...candidates.map((bar) => rangeDistanceFromReference(bar, referenceLevel))
  );

  return {
    observed: true,
    startedAt: first.time,
    testedAt: first.time,
    highestPrice,
    distanceFromReferencePoints,
    status: "ACTIVE",
    failureConfirmedAt: null,
    failureClose: null,
    strongFailureObserved: false,
    closedBelowZoneHigh: false,
    closedInsideZone: false,
    returnedToMidline: false,
  };
}

function findRetestFailure({ completedBars, referenceLevel, zone, retest }) {
  if (!retest?.observed || !retest?.testedAt) return retest;
  const threshold = referenceLevel - RETEST_FAILURE_POINTS;

  for (const bar of completedBars) {
    if (!afterTime(bar, retest.testedAt, true)) continue;
    if (bar.close > threshold) continue;

    const closedBelowZoneHigh = bar.close < zone.hi;
    const closedInsideZone = bar.close >= zone.lo && bar.close <= zone.hi;
    const returnedToMidline = bar.close <= zone.midline;

    return {
      ...retest,
      status: "FAILED",
      failureConfirmedAt: bar.time,
      failureClose: bar.close,
      strongFailureObserved:
        closedBelowZoneHigh || closedInsideZone || returnedToMidline,
      closedBelowZoneHigh,
      closedInsideZone,
      returnedToMidline,
    };
  }

  return retest;
}

function strongerState(a, b) {
  return (STATE_RANK[b] ?? -1) > (STATE_RANK[a] ?? -1) ? b : a;
}

function mergePriorFacts(prior, current) {
  if (!prior) return current;
  return {
    ...current,
    consolidation:
      prior?.consolidation?.observed === true
        ? clone(prior.consolidation)
        : current.consolidation,
    initialFailure: {
      ...(clone(current.initialFailure) || {}),
      ...(prior?.initialFailure?.observed === true
        ? clone(prior.initialFailure)
        : {}),
      rotationAwayObserved:
        prior?.initialFailure?.rotationAwayObserved === true ||
        current?.initialFailure?.rotationAwayObserved === true,
      rotationConfirmedAt:
        prior?.initialFailure?.rotationConfirmedAt ||
        current?.initialFailure?.rotationConfirmedAt ||
        null,
      rotationLow:
        prior?.initialFailure?.rotationLow ??
        current?.initialFailure?.rotationLow ??
        null,
      rotationLowAt:
        prior?.initialFailure?.rotationLowAt ||
        current?.initialFailure?.rotationLowAt ||
        null,
      rotationDistancePoints:
        prior?.initialFailure?.rotationDistancePoints ??
        current?.initialFailure?.rotationDistancePoints ??
        null,
      reachedZone:
        prior?.initialFailure?.reachedZone === true ||
        current?.initialFailure?.reachedZone === true,
      reachedMidline:
        prior?.initialFailure?.reachedMidline === true ||
        current?.initialFailure?.reachedMidline === true,
    },
    pullbackRetest:
      prior?.pullbackRetest?.status === "FAILED"
        ? clone(prior.pullbackRetest)
        : prior?.pullbackRetest?.observed === true && !current?.pullbackRetest?.observed
        ? clone(prior.pullbackRetest)
        : current.pullbackRetest,
  };
}

export function buildStrategy1LocationEvent({
  identity = {},
  entryZone = null,
  bars10m = [],
  strategy1Facts = null,
  priorLocationEvent = null,
  referenceCandidates = [],
  lifecycleStartTime = null,
  snapshotTime = new Date().toISOString(),
  tickSize = DEFAULT_TICK_SIZE,
} = {}) {
  const zone = normalizeZone(entryZone, tickSize);
  if (!zone || !identity?.candidateId || !identity?.zoneId) return null;

  const priorMatches = priorIdentityMatches({
    priorLocationEvent,
    identity,
    zone,
  });

  const lifecycleStart =
    priorMatches
      ? priorLocationEvent?.lifecycleStart ||
        priorLocationEvent?.candidateLifecycleStartTime ||
        normalizeTime(lifecycleStartTime) ||
        normalizeTime(snapshotTime)
      : normalizeTime(lifecycleStartTime) || normalizeTime(snapshotTime);

  const normalized = Array.isArray(strategy1Facts?.barsNormalized)
    ? { bars: strategy1Facts.barsNormalized, warnings: [] }
    : normalizeStrategy1Bars(bars10m);

  const startMs = timeMs(lifecycleStart);
  const bars = normalized.bars.filter((bar) => {
    if (startMs === null) return true;
    const barMs = timeMs(bar.time);
    return barMs === null || barMs >= startMs;
  });

  const completedBars = bars.filter((bar) => bar.completed === true);

  let reference = priorMatches
    ? {
        level: toFinite(priorLocationEvent?.referenceLevel),
        source: priorLocationEvent?.referenceSource || null,
        sourcePath: priorLocationEvent?.referenceSourcePath || null,
        sourceType: priorLocationEvent?.referenceSourceType || null,
        side: priorLocationEvent?.referenceSide || "ABOVE_ZONE",
        derivation: priorLocationEvent?.referenceDerivation || "PERSISTED_EVENT_REFERENCE",
        tolerancePoints:
          toFinite(priorLocationEvent?.referenceTolerancePoints) ??
          CONSOLIDATION_TOLERANCE_POINTS,
      }
    : null;

  if (!reference || reference.level === null) {
    reference = resolveCanonicalReference({
      referenceCandidates,
      bars,
      zone,
      tickSize,
    });
  }

  if (!reference) {
    reference = resolveDerivedReference({
      bars,
      zone,
      tickSize,
    });
  }

  if (!reference || reference.level === null) return null;

  const referenceLevel = roundToTick(reference.level, tickSize);
  const eventId = priorMatches && priorLocationEvent?.eventId
    ? priorLocationEvent.eventId
    : stableEventId({
        candidateId: identity.candidateId,
        zoneId: identity.zoneId,
        candidateIdentityVersion:
          identity.candidateIdentityVersion,
        referenceLevel,
        lifecycleStart,
      });

  const prior = priorMatches ? clone(priorLocationEvent) : null;

  let consolidation =
    prior?.consolidation?.observed === true
      ? clone(prior.consolidation)
      : findConsolidation({ completedBars, referenceLevel });

  let currentState = consolidation.observed
    ? "CONSOLIDATION_AT_RESISTANCE"
    : "NONE";

  const acceptedAbove = consolidation.observed
    ? findAcceptedAbove({
        completedBars,
        referenceLevel,
        after: consolidation.startedAt,
      })
    : { observed: false, confirmedAt: null };

  if (acceptedAbove.observed) {
    consolidation = {
      ...consolidation,
      sustainedAcceptanceAbove: true,
    };
    currentState = "RESISTANCE_ACCEPTED_ABOVE";
  }

  let initialFailure = {
    observed: false,
    confirmedAt: null,
    failureClose: null,
    rotationAwayObserved: false,
    rotationConfirmedAt: null,
    rotationLow: null,
    rotationLowAt: null,
    rotationDistancePoints: null,
    reachedZone: false,
    reachedMidline: false,
  };

  if (!acceptedAbove.observed && consolidation.observed) {
    const priorFailure = prior?.initialFailure?.observed === true
      ? clone(prior.initialFailure)
      : findInitialFailure({
          completedBars,
          referenceLevel,
          after: consolidation.endedAt,
        });

    initialFailure = {
      ...initialFailure,
      ...priorFailure,
    };

    if (initialFailure.observed) {
      currentState = strongerState(currentState, "FAILED_ACCEPTANCE_AT_RESISTANCE");

      const rotation = prior?.initialFailure?.rotationAwayObserved === true
        ? {
            observed: true,
            confirmedAt: prior.initialFailure.rotationConfirmedAt,
            rotationLow: prior.initialFailure.rotationLow,
            rotationLowAt: prior.initialFailure.rotationLowAt,
            rotationDistancePoints: prior.initialFailure.rotationDistancePoints,
            reachedZone: prior.initialFailure.reachedZone === true,
            reachedMidline: prior.initialFailure.reachedMidline === true,
          }
        : findRotation({
            completedBars,
            referenceLevel,
            zone,
            after: initialFailure.confirmedAt,
          });

      initialFailure = {
        ...initialFailure,
        rotationAwayObserved: rotation.observed,
        rotationConfirmedAt: rotation.confirmedAt,
        rotationLow: rotation.rotationLow,
        rotationLowAt: rotation.rotationLowAt,
        rotationDistancePoints: rotation.rotationDistancePoints,
        reachedZone: rotation.reachedZone,
        reachedMidline: rotation.reachedMidline,
      };

      if (rotation.observed) {
        currentState = strongerState(currentState, "ROTATION_AWAY_FROM_RESISTANCE");
      }
    }
  }

  let pullbackRetest = {
    observed: false,
    startedAt: null,
    testedAt: null,
    highestPrice: null,
    distanceFromReferencePoints: null,
    status: null,
    failureConfirmedAt: null,
    failureClose: null,
    strongFailureObserved: false,
    closedBelowZoneHigh: false,
    closedInsideZone: false,
    returnedToMidline: false,
  };

  if (
    !acceptedAbove.observed &&
    initialFailure.rotationAwayObserved === true
  ) {
    pullbackRetest = prior?.pullbackRetest?.observed === true
      ? clone(prior.pullbackRetest)
      : findRetest({
          bars,
          referenceLevel,
          after: initialFailure.rotationConfirmedAt,
        });

    if (pullbackRetest.observed) {
      currentState = strongerState(currentState, "PULLBACK_RETEST_OF_RESISTANCE");
      pullbackRetest = findRetestFailure({
        completedBars,
        referenceLevel,
        zone,
        retest: pullbackRetest,
      });

      if (pullbackRetest.status === "FAILED") {
        currentState = strongerState(currentState, "PULLBACK_FAILED_AT_RESISTANCE");
      }
    }
  }

  let event = {
    active: currentState !== "NONE" && currentState !== "RESISTANCE_ACCEPTED_ABOVE",
    eventId,
    eventType: "RESISTANCE_RETEST_SEQUENCE",
    currentState,

    candidateId: identity.candidateId,
    zoneId: identity.zoneId,
    laneId: identity.laneId || "minute",
    strategyId: identity.strategyId || null,
    symbol: identity.symbol || null,
    candidateIdentityVersion: identity.candidateIdentityVersion || null,
    lifecycleStart,

    zone,

    referenceLevel,
    referenceSource: reference.source,
    referenceSourcePath: reference.sourcePath || null,
    referenceSourceType: reference.sourceType || null,
    referenceSide: reference.side || "ABOVE_ZONE",
    referenceDerivation: reference.derivation || null,
    referenceTolerancePoints:
      reference.tolerancePoints ?? CONSOLIDATION_TOLERANCE_POINTS,

    consolidation,
    initialFailure,
    pullbackRetest,

    historicalDirection: "DOWN",

    acceptanceAbove: acceptedAbove,

    thresholds: {
      tickSize,
      consolidationTolerancePoints: CONSOLIDATION_TOLERANCE_POINTS,
      minimumConsolidationCompletedCandles: MIN_CONSOLIDATION_COMPLETED_CANDLES,
      minimumConsolidationQualifyingCloses: MIN_CONSOLIDATION_QUALIFYING_CLOSES,
      acceptanceOffsetPoints: ACCEPTANCE_OFFSET_POINTS,
      rotationAwayPoints: ROTATION_AWAY_POINTS,
      retestProximityPoints: RETEST_PROXIMITY_POINTS,
      retestFailurePoints: RETEST_FAILURE_POINTS,
    },

    firstObservedAt:
      prior?.firstObservedAt || consolidation.startedAt || null,
    lastUpdatedAt: snapshotTime,
    completedAt:
      currentState === "RESISTANCE_ACCEPTED_ABOVE"
        ? acceptedAbove.confirmedAt || snapshotTime
        : null,
    invalidated: currentState === "RESISTANCE_ACCEPTED_ABOVE",
    invalidatedAt:
      currentState === "RESISTANCE_ACCEPTED_ABOVE"
        ? acceptedAbove.confirmedAt || snapshotTime
        : null,
    invalidationReason:
      currentState === "RESISTANCE_ACCEPTED_ABOVE"
        ? "CONFIRMED_ACCEPTANCE_ABOVE_REFERENCE"
        : null,

    noDirectionCreated: true,
    noParticipationCreated: true,
    noPermissionCreated: true,
    noExecution: true,
  };

  event = mergePriorFacts(prior, event);

  if (prior && currentState !== "RESISTANCE_ACCEPTED_ABOVE") {
    event.currentState = strongerState(prior.currentState || "NONE", event.currentState);
    event.active = event.currentState !== "NONE" && event.currentState !== "RESISTANCE_ACCEPTED_ABOVE";
    event.invalidated = prior.invalidated === true || event.invalidated === true;
    event.completedAt = prior.completedAt || event.completedAt;
    event.invalidatedAt = prior.invalidatedAt || event.invalidatedAt;
    event.invalidationReason = prior.invalidationReason || event.invalidationReason;
  }

  return event;
}

export const STRATEGY1_LOCATION_EVENT_THRESHOLDS = Object.freeze({
  tickSize: DEFAULT_TICK_SIZE,
  consolidationTolerancePoints: CONSOLIDATION_TOLERANCE_POINTS,
  minimumConsolidationCompletedCandles: MIN_CONSOLIDATION_COMPLETED_CANDLES,
  minimumConsolidationQualifyingCloses: MIN_CONSOLIDATION_QUALIFYING_CLOSES,
  acceptanceOffsetPoints: ACCEPTANCE_OFFSET_POINTS,
  rotationAwayPoints: ROTATION_AWAY_POINTS,
  retestProximityPoints: RETEST_PROXIMITY_POINTS,
  retestFailurePoints: RETEST_FAILURE_POINTS,
});

export default buildStrategy1LocationEvent;
