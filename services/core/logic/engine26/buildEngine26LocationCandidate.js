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

function selectShortTargetZone({ negotiatedZones, entryZone }) {
  if (!entryZone) return null;

  return [...negotiatedZones]
    .filter((zone) => zone !== entryZone)
    .filter((zone) => zone.hi < entryZone.lo)
    .sort((a, b) => {
      if (a.hi !== b.hi) return b.hi - a.hi;
      if (a.lo !== b.lo) return b.lo - a.lo;
      const sourceCompare = String(a.source || "")
        .localeCompare(String(b.source || ""));
      if (sourceCompare !== 0) return sourceCompare;
      return String(a.upstreamId || "")
        .localeCompare(String(b.upstreamId || ""));
    })[0] || null;
}

function latestCompletedClose(bars10m = []) {
  const bars = Array.isArray(bars10m) ? bars10m : [];

  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const bar = bars[index];
    const completed =
      bar?.completed === true ||
      (bar?.completed !== false && index < bars.length - 1);

    if (!completed) continue;

    const close = toFiniteNumber(bar?.close ?? bar?.c);
    if (close !== null) return close;
  }

  return null;
}


function parseObservationTimeMs(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12
      ? value
      : value * 1000;
  }

  const numeric = Number(value);

  if (Number.isFinite(numeric)) {
    return numeric > 1e12
      ? numeric
      : numeric * 1000;
  }

  const parsed = Date.parse(String(value));

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function resolveNegotiatedZoneContactEvidence({
  zone,
  currentPrice,
  bars10m,
  sinceTime = null,
}) {
  const zoneLow = toFiniteNumber(zone?.lo);
  const zoneHigh = toFiniteNumber(zone?.hi);
  const price = toFiniteNumber(currentPrice);

  if (
    zoneLow === null ||
    zoneHigh === null
  ) {
    return {
      observed: false,
      source: null,
      touchedAt: null,
      bar: null,
    };
  }

  const lowBoundary = Math.min(zoneLow, zoneHigh);
  const highBoundary = Math.max(zoneLow, zoneHigh);

  if (
    price !== null &&
    price >= lowBoundary &&
    price <= highBoundary
  ) {
    return {
      observed: true,
      source: "CURRENT_PRICE_INSIDE_NEGOTIATED_ZONE",
      touchedAt: null,
      bar: null,
    };
  }

  const sinceMs =
    parseObservationTimeMs(sinceTime);

  const bars = Array.isArray(bars10m)
    ? bars10m
    : [];

  let latestTouch = null;

  for (const bar of bars) {
    const barHigh = toFiniteNumber(
      bar?.high ?? bar?.h
    );

    const barLow = toFiniteNumber(
      bar?.low ?? bar?.l
    );

    if (
      barHigh === null ||
      barLow === null
    ) {
      continue;
    }

    const barTime =
      bar?.time ??
      bar?.t ??
      bar?.tSec ??
      null;

    const barTimeMs =
      parseObservationTimeMs(barTime);

    if (
      sinceMs !== null &&
      barTimeMs !== null &&
      barTimeMs < sinceMs
    ) {
      continue;
    }

    const touched =
      barHigh >= lowBoundary &&
      barLow <= highBoundary;

    if (!touched) {
      continue;
    }

    if (
      latestTouch === null ||
      (
        barTimeMs !== null &&
        (
          latestTouch.timeMs === null ||
          barTimeMs > latestTouch.timeMs
        )
      )
    ) {
      latestTouch = {
        timeMs: barTimeMs,
        touchedAt:
          barTime ?? null,
        bar: {
          time: barTime ?? null,
          high: barHigh,
          low: barLow,
          completed:
            bar?.completed === true,
        },
      };
    }
  }

  if (latestTouch) {
    return {
      observed: true,
      source: "TEN_MINUTE_BAR_TOUCHED_NEGOTIATED_ZONE",
      touchedAt:
        latestTouch.touchedAt,
      bar:
        latestTouch.bar,
    };
  }

  return {
    observed: false,
    source: null,
    touchedAt: null,
    bar: null,
  };
}

function normalizeEma10Posture(value, currentPrice = null) {
  if (value == null) {
    return {
      posture: "UNKNOWN",
      ema10: null,
      price: toFiniteNumber(currentPrice),
      priceAboveEma10: false,
      priceBelowEma10: false,
      source: "UNAVAILABLE",
    };
  }

  if (typeof value === "string") {
    const posture = String(value).trim().toUpperCase();
    return {
      posture:
        posture.includes("BULL") || posture.includes("ABOVE")
          ? "BULLISH"
          : posture.includes("BEAR") || posture.includes("BELOW")
          ? "BEARISH"
          : "NEUTRAL",
      ema10: null,
      price: toFiniteNumber(currentPrice),
      priceAboveEma10:
        posture.includes("BULL") || posture.includes("ABOVE"),
      priceBelowEma10:
        posture.includes("BEAR") || posture.includes("BELOW"),
      source: "EXPLICIT_STRING",
    };
  }

  const ema10 = toFiniteNumber(
    value?.ema10 ??
      value?.value ??
      value?.level
  );

  const price = toFiniteNumber(
    value?.currentPrice ??
      value?.price ??
      currentPrice
  );

  const explicitPosture = String(
    value?.posture ??
      value?.direction ??
      value?.state ??
      ""
  )
    .trim()
    .toUpperCase();

  const explicitAbove =
    value?.priceAboveEma10 === true ||
    value?.above === true;

  const explicitBelow =
    value?.priceBelowEma10 === true ||
    value?.below === true;

  const priceAboveEma10 =
    explicitAbove ||
    (
      price !== null &&
      ema10 !== null &&
      price > ema10
    );

  const priceBelowEma10 =
    explicitBelow ||
    (
      price !== null &&
      ema10 !== null &&
      price < ema10
    );

  const posture =
    explicitPosture.includes("BULL") ||
    explicitPosture.includes("ABOVE") ||
    priceAboveEma10
      ? "BULLISH"
      : explicitPosture.includes("BEAR") ||
        explicitPosture.includes("BELOW") ||
        priceBelowEma10
      ? "BEARISH"
      : "NEUTRAL";

  return {
    posture,
    ema10,
    price,
    priceAboveEma10,
    priceBelowEma10,
    source:
      value?.source ||
      "ENGINE26A_INPUT",
  };
}

function calculateEma10FromBars(bars10m = []) {
  const bars = Array.isArray(bars10m) ? bars10m : [];

  const completedCloses = bars
    .map((bar, index) => {
      const completed =
        bar?.completed === true ||
        (
          bar?.completed !== false &&
          index < bars.length - 1
        );

      if (!completed) return null;

      return toFiniteNumber(
        bar?.close ?? bar?.c
      );
    })
    .filter((value) => value !== null);

  if (completedCloses.length < 10) {
    return null;
  }

  const multiplier = 2 / 11;
  let ema = completedCloses
    .slice(0, 10)
    .reduce((sum, value) => sum + value, 0) / 10;

  for (
    let index = 10;
    index < completedCloses.length;
    index += 1
  ) {
    ema =
      (
        completedCloses[index] - ema
      ) *
        multiplier +
      ema;
  }

  return roundToTick(ema);
}

function resolveEma10Posture({
  ema10Posture,
  currentPrice,
  bars10m,
}) {
  if (ema10Posture != null) {
    return normalizeEma10Posture(
      ema10Posture,
      currentPrice
    );
  }

  const ema10 = calculateEma10FromBars(bars10m);
  const price =
    latestCompletedClose(bars10m) ??
    toFiniteNumber(currentPrice);

  if (ema10 === null || price === null) {
    return normalizeEma10Posture(
      null,
      currentPrice
    );
  }

  return normalizeEma10Posture(
    {
      ema10,
      currentPrice: price,
      source: "ENGINE26A_CALCULATED_FROM_COMPLETED_10M_BARS",
    },
    price
  );
}

function completedBarsWithEma10(bars10m = []) {
  const sourceBars = Array.isArray(bars10m)
    ? bars10m
    : [];

  const completedBars = sourceBars
    .map((bar, index) => {
      const completed =
        bar?.completed === true ||
        (
          bar?.completed !== false &&
          index < sourceBars.length - 1
        );

      if (!completed) return null;

      const open = toFiniteNumber(
        bar?.open ?? bar?.o
      );
      const high = toFiniteNumber(
        bar?.high ?? bar?.h
      );
      const low = toFiniteNumber(
        bar?.low ?? bar?.l
      );
      const close = toFiniteNumber(
        bar?.close ?? bar?.c
      );

      if (
        open === null ||
        high === null ||
        low === null ||
        close === null
      ) {
        return null;
      }

      return {
        time:
          bar?.time ??
          bar?.t ??
          bar?.tSec ??
          null,
        open,
        high,
        low,
        close,
        bodySize: Math.abs(close - open),
        ema10: null,
      };
    })
    .filter(Boolean);

  if (completedBars.length < 10) {
    return completedBars;
  }

  const multiplier = 2 / 11;
  let ema = completedBars
    .slice(0, 10)
    .reduce(
      (sum, bar) => sum + bar.close,
      0
    ) / 10;

  completedBars[9].ema10 = ema;

  for (
    let index = 10;
    index < completedBars.length;
    index += 1
  ) {
    ema =
      (
        completedBars[index].close - ema
      ) * multiplier + ema;

    completedBars[index].ema10 = ema;
  }

  return completedBars;
}

function median(values = []) {
  const numbers = values
    .map(toFiniteNumber)
    .filter((value) => value !== null)
    .sort((a, b) => a - b);

  if (!numbers.length) return null;

  const middle = Math.floor(numbers.length / 2);

  return numbers.length % 2 === 0
    ? (numbers[middle - 1] + numbers[middle]) / 2
    : numbers[middle];
}

function resolveLongReversalWatchFacts({
  bars10m,
  selectedZone,
}) {
  const completedBars =
    completedBarsWithEma10(bars10m);

  const latest =
    completedBars[completedBars.length - 1] ||
    null;

  const previous =
    completedBars[completedBars.length - 2] ||
    null;

  const priorCompletedBars =
    completedBars.slice(
      Math.max(0, completedBars.length - 11),
      Math.max(0, completedBars.length - 1)
    );

  const priorBodySample =
    priorCompletedBars.slice(-10);

  const medianPriorBody = median(
    priorBodySample.map((bar) => bar.bodySize)
  );

  const hasTwoCompletedCandles =
    latest !== null &&
    previous !== null;

  const completedBullishSequence =
    hasTwoCompletedCandles &&
    latest.close > latest.open &&
    previous.close > previous.open;

  const bothClosesAboveApplicableEma10 =
    hasTwoCompletedCandles &&
    latest.ema10 !== null &&
    previous.ema10 !== null &&
    latest.close > latest.ema10 &&
    previous.close > previous.ema10;

  const minimumPriorBarsAvailable =
    priorBodySample.length >= 5;

  const latestBodyDisplacementStrong =
    hasTwoCompletedCandles &&
    minimumPriorBarsAvailable &&
    medianPriorBody !== null &&
    latest.bodySize >=
      1.25 * medianPriorBody;

  const latestCloseAbovePreviousHigh =
    hasTwoCompletedCandles &&
    latest.close > previous.high;

  const zoneHigh =
    toFiniteNumber(selectedZone?.hi);

  const fullNegotiatedZoneReclaimIncomplete =
    hasTwoCompletedCandles &&
    zoneHigh !== null &&
    latest.close <= zoneHigh;

  const qualified =
    completedBullishSequence &&
    bothClosesAboveApplicableEma10 &&
    minimumPriorBarsAvailable &&
    latestBodyDisplacementStrong &&
    latestCloseAbovePreviousHigh &&
    fullNegotiatedZoneReclaimIncomplete;

  return {
    qualified,
    observationOnly: true,
    completedBullishSequence,
    requiredConsecutiveBullishCandles: 2,
    bothClosesAboveApplicableEma10,
    minimumPriorBarsAvailable,
    priorCompletedBarsUsed:
      priorBodySample.length,
    medianPriorBody,
    latestBullishBody:
      latest?.bodySize ?? null,
    requiredBodyMultiple: 1.25,
    latestBodyDisplacementStrong,
    latestCloseAbovePreviousHigh,
    fullNegotiatedZoneReclaimIncomplete,
    latestCompletedCandle: latest,
    previousCompletedCandle: previous,
    noDirectionalResolution: true,
    noGeometryAuthorization: true,
    noPermissionCreated: true,
    noExecution: true,
  };
}

function resolveDirectionalEvidence({
  selectedZone,
  currentPrice,
  bars10m,
  ema10Posture,
  longFacts,
  shortFacts,
  promotedObservation,
}) {
  const latestClose =
    latestCompletedClose(bars10m) ??
    toFiniteNumber(currentPrice);

  const acceptanceAboveZone =
    latestClose !== null &&
    latestClose > selectedZone.hi;

  const acceptanceBelowZone =
    latestClose !== null &&
    latestClose < selectedZone.lo;

  const longReversalEvidence =
    longFacts?.lifecycleFacts
      ?.reactionEvaluationFactsReady === true;

  const shortReversalEvidence =
    shortFacts?.lifecycleFacts
      ?.reactionEvaluationFactsReady === true;

  const longReversalWatchFacts =
    resolveLongReversalWatchFacts({
      bars10m,
      selectedZone,
    });

  const bullishEma =
    ema10Posture?.posture === "BULLISH" ||
    ema10Posture?.priceAboveEma10 === true;

  const bearishEma =
    ema10Posture?.posture === "BEARISH" ||
    ema10Posture?.priceBelowEma10 === true;

  const bullishZoneEvidence =
    acceptanceAboveZone ||
    longReversalEvidence;

  const bearishZoneEvidence =
    acceptanceBelowZone ||
    shortReversalEvidence;

  const bullishAligned =
    bullishZoneEvidence && bullishEma;

  const bearishAligned =
    bearishZoneEvidence && bearishEma;

  const directionalConflict =
    (
      bullishZoneEvidence &&
      bearishEma
    ) ||
    (
      bearishZoneEvidence &&
      bullishEma
    ) ||
    (
      bullishAligned &&
      bearishAligned
    );

  let direction = "NEUTRAL";
  let directionState =
    promotedObservation
      ? "OBSERVING_PROMOTED_ZONE"
      : "OBSERVING_ZONE_REACTION";

if (
  longReversalWatchFacts.qualified === true
) {
  /*
   * Early bullish reversal evidence is present,
   * but full negotiated-zone reclaim is incomplete.
   *
   * Observation only:
   * - direction remains NEUTRAL
   * - no geometry
   * - no permission
   * - no automatic LONG
   */
  direction = "NEUTRAL";
  directionState =
    "LONG_REVERSAL_WATCH";
} else if (directionalConflict) {
  direction = "NEUTRAL";
  directionState =
    "NEUTRAL_NO_DIRECTIONAL_EDGE";
} else if (bullishAligned) {
  direction = "LONG";
  directionState =
    longReversalEvidence
      ? "LONG_REVERSAL_DEVELOPING"
      : "LONG_CONTINUATION_DEVELOPING";
} else if (bearishAligned) {
  direction = "SHORT";
  directionState =
    shortReversalEvidence
      ? "SHORT_REVERSAL_DEVELOPING"
      : "SHORT_CONTINUATION_DEVELOPING";
}
  return {
    direction,
    preferredDirection: direction,
    directionState,

    promotedObservation:
      promotedObservation === true,

    latestCompletedClose: latestClose,

    zoneAcceptance: {
      acceptanceAboveZone,
      acceptanceBelowZone,
    },

    zoneRejection: {
      longSweepReclaimHold:
        longReversalEvidence,
      shortRejectionFailedAcceptance:
        shortReversalEvidence,
    },

    ema10Posture,

    longReversalWatchFacts,

    bullishAcceptanceObserved:
      acceptanceAboveZone,

    bearishRejectionObserved:
      shortReversalEvidence,

    completedFailedAcceptanceObserved:
      shortFacts?.failedAcceptanceFacts
        ?.completedFailedAcceptanceObserved === true,

    bearishDisplacement:
      acceptanceBelowZone,

    reactionEvaluationFactsReady:
      bullishZoneEvidence ||
      bearishZoneEvidence,

    displacementFacts: {
      bullishDisplacement:
        acceptanceAboveZone,
      bearishDisplacement:
        acceptanceBelowZone,
      source:
        "COMPLETED_PRICE_RELATION_TO_NEGOTIATED_ZONE",
    },

    directionalConflict,

    evidenceSufficient:
      direction === "LONG" ||
      direction === "SHORT",

    reasonCodes: [
      promotedObservation
        ? "ENGINE26_STRATEGY1_PROMOTED_ZONE_OBSERVATION"
        : "ENGINE26_STRATEGY1_INITIAL_ZONE_OBSERVATION",

      acceptanceAboveZone
        ? "ENGINE26_ZONE_ACCEPTANCE_ABOVE"
        : null,

      acceptanceBelowZone
        ? "ENGINE26_ZONE_ACCEPTANCE_BELOW"
        : null,

      longReversalEvidence
        ? "ENGINE26_LONG_SWEEP_RECLAIM_HOLD_FACTS"
        : null,

      shortReversalEvidence
        ? "ENGINE26_SHORT_REJECTION_FAILED_ACCEPTANCE_FACTS"
        : null,

      bullishEma
        ? "ENGINE26_EMA10_BULLISH_POSTURE"
        : null,

      bearishEma
        ? "ENGINE26_EMA10_BEARISH_POSTURE"
        : null,

      longReversalWatchFacts.qualified === true
        ? "ENGINE26_LONG_REVERSAL_WATCH"
        : null,

      longReversalWatchFacts.qualified === true
        ? "ENGINE26_LONG_REVERSAL_WATCH_OBSERVATION_ONLY"
        : null,

      directionalConflict
        ? "ENGINE26_DIRECTIONAL_CONFLICT"
        : null,

      direction === "NEUTRAL"
        ? "ENGINE26_DIRECTION_REMAINS_NEUTRAL"
        : `ENGINE26_PROVISIONAL_DIRECTION_${direction}`,
    ].filter(Boolean),
  };
}

function resolveCandidateLifecycleStartTime({
  snapshotTime,
  previousLocationCandidate,
  priorMemoryRecord,
  selectedZoneId,
  direction,
}) {
  const previousSameZone =
    previousLocationCandidate?.zoneId ===
    selectedZoneId;

  const previousSameDirection =
    normalizeDirection(
      previousLocationCandidate?.directionBias ??
      previousLocationCandidate?.direction
    ) === normalizeDirection(direction);

  if (
    previousSameZone &&
    previousSameDirection
  ) {
    return (
      previousLocationCandidate
        ?.directionResolvedAt ||
      previousLocationCandidate
        ?.candidateLifecycleStartTime ||
      priorMemoryRecord
        ?.directionResolvedAt ||
      priorMemoryRecord
        ?.candidateLifecycleStartTime ||
      previousLocationCandidate
        ?.snapshotTime ||
      snapshotTime
    );
  }

  return snapshotTime;
}

function findZoneByCanonicalId({
  zones,
  symbol,
  zoneId,
}) {
  if (!zoneId) return null;

  return zones.find(
    (zone) =>
      buildCanonicalZoneId(symbol, zone) === zoneId
  ) || null;
}

function getPriorMemoryRecord({
  memoryStore,
  symbol,
  strategyId,
  previousLocationCandidate,
}) {
  const priorZoneId =
    previousLocationCandidate?.zoneId || null;

  if (!priorZoneId) return null;

  const priorMemoryKey = buildStrategy1MemoryKey({
    laneId: "minute",
    symbol,
    strategyId,
    zoneId: priorZoneId,
  });

  return memoryStore?.records?.[priorMemoryKey] || null;
}

function findRecoverableDirectionalMemoryChild({
  memoryStore,
  zones,
  symbol,
  strategyId,
  currentPrice,
  ema10Posture,
  bars10m,
  snapshotTime,
  tickSize,
}) {
  const records = Object.values(
    memoryStore?.records || {}
  );

  const candidates = records
    .map((record) => {
      const direction = normalizeDirection(
        record?.direction
      );

      const zone = findZoneByCanonicalId({
        zones,
        symbol,
        zoneId: record?.zoneId,
      });

      const identityValid =
        record?.laneId === "minute" &&
        record?.strategyId === strategyId &&
        String(record?.symbol || "").toUpperCase() ===
          symbol &&
        record?.setupClass === STRATEGY1_SETUP_CLASS &&
        record?.identitySetupKey === STRATEGY1_SETUP_CLASS &&
        record?.candidateIdentityVersion ===
          "engine26.strategy1.v2" &&
        ["LONG", "SHORT"].includes(direction) &&
        Boolean(record?.currentCandidateId) &&
        Boolean(zone);

      const lifecyclePreservable =
        [
          "ACTIVE",
          "TARGET_APPROACH_COMPLETION_WATCH",
        ].includes(
          String(record?.lifecycleStatus || "")
            .toUpperCase()
        ) &&
        record?.invalidationFacts
          ?.completedCloseInvalidationConfirmed !== true &&
        !record?.invalidatedAt &&
        !record?.retiredAt &&
        !record?.releaseReason &&
        !record?.targetTouchedAt;

      /*
       * A general favorable 10-point objective is bookkeeping only.
       * It is not a Strategy 1 lifecycle release and must not prevent
       * restoration of the active directional owner.
       */

      if (!identityValid || !lifecyclePreservable) {
        return null;
      }

      const entryZone = {
        id: record.zoneId,
        zoneId: record.zoneId,
        upstreamId: zone.upstreamId,
        source: zone.source,
        sourcePath: zone.sourcePath,
        type: zone.type,
        timeframe: zone.timeframe,
        low: zone.lo,
        high: zone.hi,
        midline: zone.mid,
      };

      const boundaries = buildBoundaries({
        directionBias: direction,
        zone,
        tickSize,
      });

      const currentFacts = buildStrategy1Facts({
        bars10m,
        entryZone,
        locationInvalidationBoundary:
          boundaries.locationInvalidationBoundary,
        direction,
        lifecycleStartTime:
          record?.candidateLifecycleStartTime ||
          record?.directionResolvedAt ||
          snapshotTime,
      });

      if (
        currentFacts?.invalidationFacts
          ?.completedCloseInvalidationConfirmed === true
      ) {
        return null;
      }

      /*
       * Restore the active directional owner before fresh ranking.
       *
       * Current distance, another zone's score, EMA posture, a general
       * 10-point favorable move, or first target-zone entry are not release
       * conditions. After restoration, evaluatePreviousChildRelease()
       * applies the approved completed-close, retirement, partial-profit,
       * and negotiated-midline completion lifecycle rules.
       */

      return {
        record,
        zone,
        candidate: {
          active: true,
          status: "ACTIVE_DIRECTIONAL_CHILD",
          laneId: "minute",
          symbol,
          strategyId,
          candidateId: record.currentCandidateId,
          zoneId: record.zoneId,
          directionBias: direction,
          direction,
          tradeDirectionBias: direction,
          preferredDirection: direction,
          directionState:
            `${direction}_DIRECTIONAL_CHILD_ACTIVE`,
          setupType: STRATEGY1_SETUP_CLASS,
          setupClass: record.setupClass,
          setupGrade: record.setupGrade,
          identitySetupKey: record.identitySetupKey,
          candidateIdentityVersion:
            record.candidateIdentityVersion,
          candidateLifecycleStartTime:
            record.candidateLifecycleStartTime ||
            record.directionResolvedAt ||
            snapshotTime,
          directionResolvedAt:
            record.directionResolvedAt ||
            record.candidateLifecycleStartTime ||
            snapshotTime,
          entryZone,
          targetZone: record.targetZone || null,
          invalidationFacts:
            currentFacts?.invalidationFacts ||
            record.invalidationFacts ||
            null,
          snapshotTime:
            record.lastSeenAt || snapshotTime,
          noPermissionCreated: true,
          noExecution: true,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      String(b.record?.lastSeenAt || "")
        .localeCompare(
          String(a.record?.lastSeenAt || "")
        )
    );

  return candidates[0] || null;
}

const PROMOTED_CONTACT_COMPLETION_REASON =
  "NEGOTIATED_LINE_TARGET_COMPLETION";

const PROMOTED_CONTACT_SUPERSESSION_REASON =
  "APPROVED_NEGOTIATED_ZONE_CONTACT_SUPERSESSION";

function isPromotedObservationReason(value) {
  return [
    PROMOTED_CONTACT_COMPLETION_REASON,
    PROMOTED_CONTACT_SUPERSESSION_REASON,
  ].includes(String(value || "").toUpperCase());
}

function isRecoverablePromotedContactRecord({
  record,
  zone,
  symbol,
  strategyId,
}) {
  const identityValid =
    record?.laneId === "minute" &&
    record?.strategyId === strategyId &&
    String(record?.symbol || "").toUpperCase() === symbol &&
    record?.zoneId != null &&
    record?.setupClass === STRATEGY1_SETUP_CLASS &&
    record?.identitySetupKey === STRATEGY1_SETUP_CLASS &&
    record?.candidateIdentityVersion ===
      "engine26.strategy1.v2" &&
    Boolean(record?.currentCandidateId) &&
    Boolean(zone);

  const promotedLifecycleValid =
    record?.contactState ===
      "NEGOTIATED_LINE_CONTACT" &&
    record?.chainArmed === true &&
    isPromotedObservationReason(
      record?.promotionReason
    ) &&
    record?.priorRotationFullyComplete === true &&
    record?.promotedFromTargetCompletion === true &&
    normalizeDirection(
      record?.directionBias ??
      record?.direction
    ) === "NEUTRAL";

  const lifecycleRecoverable =
    String(record?.lifecycleStatus || "")
      .toUpperCase() !== "RETIRED" &&
    String(record?.lifecycleStatus || "")
      .toUpperCase() !== "INVALIDATED" &&
    record?.invalidationFacts
      ?.completedCloseInvalidationConfirmed !== true &&
    !record?.invalidatedAt &&
    !record?.retiredAt &&
    !record?.releaseReason;

  return (
    identityValid &&
    promotedLifecycleValid &&
    lifecycleRecoverable
  );
}

function findRecoverablePromotedContactMemoryChild({
  memoryStore,
  zones,
  symbol,
  strategyId,
  snapshotTime,
}) {
  const candidates = Object.values(
    memoryStore?.records || {}
  )
    .map((record) => {
      const zone = findZoneByCanonicalId({
        zones,
        symbol,
        zoneId: record?.zoneId,
      });

      if (
        !isRecoverablePromotedContactRecord({
          record,
          zone,
          symbol,
          strategyId,
        })
      ) {
        return null;
      }

      const entryZone = {
        id: record.zoneId,
        zoneId: record.zoneId,
        upstreamId: zone.upstreamId,
        source: zone.source,
        sourcePath: zone.sourcePath,
        type: zone.type,
        timeframe: zone.timeframe,
        low: zone.lo,
        high: zone.hi,
        midline: zone.mid,
      };

      return {
        record,
        zone,
        candidate: {
          active: true,
          status: "OBSERVING_PROMOTED_ZONE",
          laneId: "minute",
          symbol,
          strategyId,
          candidateId: record.currentCandidateId,
          zoneId: record.zoneId,
          directionBias: "NEUTRAL",
          direction: "NEUTRAL",
          tradeDirectionBias: "NEUTRAL",
          preferredDirection: "NEUTRAL",
          directionalResolved: false,
          directionState:
            record?.priorRotationDirection === "LONG"
              ? "SHORT_REVERSAL_WATCH"
              : record?.priorRotationDirection === "SHORT"
              ? "LONG_REVERSAL_WATCH"
              : "NEUTRAL",
          expectedDirection: null,
          expectedReactionDirection:
            record?.priorRotationDirection === "LONG"
              ? "SHORT"
              : record?.priorRotationDirection === "SHORT"
              ? "LONG"
              : null,
          expectedReversalDirection:
            record?.priorRotationDirection === "LONG"
              ? "SHORT"
              : record?.priorRotationDirection === "SHORT"
              ? "LONG"
              : null,
          expectedParticipationDirection:
            record?.priorRotationDirection === "LONG"
              ? "SHORT"
              : record?.priorRotationDirection === "SHORT"
              ? "LONG"
              : null,
          expectedReactions:
            record?.priorRotationDirection === "LONG"
              ? expectedReactionsForDirection("SHORT")
              : record?.priorRotationDirection === "SHORT"
              ? expectedReactionsForDirection("LONG")
              : [],
          reactionExpected:
            ["LONG", "SHORT"].includes(
              normalizeDirection(
                record?.priorRotationDirection
              )
            ),
          contactState: "NEGOTIATED_LINE_CONTACT",
          chainArmed: true,
          automaticDirectionFlip: false,
          shortConfirmed: false,
          setupType: STRATEGY1_SETUP_CLASS,
          setupClass: record.setupClass,
          setupGrade: record.setupGrade,
          identitySetupKey: record.identitySetupKey,
          candidateIdentityVersion:
            record.candidateIdentityVersion,
          candidateLifecycleStartTime:
            record.candidateLifecycleStartTime ||
            record.promotionTime ||
            snapshotTime,
          directionResolvedAt: null,
          entryZone,
          targetZone: record.targetZone || null,
          invalidationFacts:
            record.invalidationFacts || null,
          priorCandidateId:
            record.priorCandidateId || null,
          priorZoneId:
            record.priorZoneId || null,
          priorRotationDirection:
            record.priorRotationDirection || "LONG",
          priorRotationCompletionState:
            record.priorRotationCompletionState ||
            "FULL_TARGET_COMPLETION",
          priorRotationFullyComplete: true,
          remainingRunnerExpected: false,
          completionBoundary:
            record.completionBoundary ?? null,
          completedTargetZoneId:
            record.completedTargetZoneId || null,
          completedTargetZone:
            record.completedTargetZone || null,
          promotionReason:
            record?.promotionReason ||
            PROMOTED_CONTACT_COMPLETION_REASON,
          promotedFromTargetCompletion: true,
          targetZoneEntryTouched:
            record.targetZoneEntryTouched === true,
          targetMidlineReached:
            record.targetMidlineReached === true,
          targetZoneEntryTouchedAt:
            record.targetZoneEntryTouchedAt || null,
          targetMidlineReachedAt:
            record.targetMidlineReachedAt || null,
          promotionTime:
            record.promotionTime || null,
          profitObjectiveReachedAt:
            record.profitObjectiveReachedAt || null,
          snapshotTime:
            record.lastSeenAt || snapshotTime,
          noPermissionCreated: true,
          noExecution: true,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      String(b.record?.lastSeenAt || "")
        .localeCompare(
          String(a.record?.lastSeenAt || "")
        )
    );

  return candidates[0] || null;
}

function evaluatePreviousChildRelease({
  previousLocationCandidate,
  priorMemoryRecord,
  currentPrice,
}) {
  const emptyState = {
    released: false,
    releaseReason: null,
    targetApproachCompletionWatch: false,
    targetZoneEntryTouched: false,
    targetMidlineReached: false,
    objectiveCompleted: false,
    targetReached: false,
    priorRotationCompletionState: null,
    priorRotationFullyComplete: false,
    remainingRunnerExpected: null,
    completionBoundary: null,
    completedTargetZoneId: null,
    completedTargetZone: null,
  };

  if (!previousLocationCandidate) {
    return emptyState;
  }

  const direction = normalizeDirection(
    previousLocationCandidate?.directionBias ??
      previousLocationCandidate?.direction
  );

  const price = toFiniteNumber(currentPrice);
  const entry = toFiniteNumber(
    previousLocationCandidate?.entryZone?.midline
  );

  const targetZone =
    previousLocationCandidate?.targetZone || null;

  const targetLow = toFiniteNumber(
    targetZone?.low
  );

  const targetHigh = toFiniteNumber(
    targetZone?.high
  );

  const targetMidline = toFiniteNumber(
    targetZone?.midline
  );

  const completedTargetZoneId =
    targetZone?.zoneId ??
    targetZone?.id ??
    null;

  const invalidated =
    previousLocationCandidate?.invalidationFacts
      ?.completedCloseInvalidationConfirmed === true ||
    priorMemoryRecord?.invalidationFacts
      ?.completedCloseInvalidationConfirmed === true ||
    priorMemoryRecord?.lifecycleStatus === "INVALIDATED";

  if (invalidated) {
    return {
      ...emptyState,
      released: true,
      releaseReason: "COMPLETED_CLOSE_INVALIDATION",
    };
  }

  const explicitlyRetired =
    priorMemoryRecord?.lifecycleStatus === "RETIRED";

  if (explicitlyRetired) {
    return {
      ...emptyState,
      released: true,
      releaseReason:
        priorMemoryRecord?.releaseReason ||
        "EXPLICIT_RETIREMENT",
    };
  }

  const favorableExcursion =
    price !== null && entry !== null
      ? direction === "SHORT"
        ? round2(entry - price)
        : round2(price - entry)
      : null;

  const objectiveCompleted =
    favorableExcursion !== null &&
    favorableExcursion >= 10;

  /*
   * Simplified Strategy 1 testing exit lifecycle:
   *
   * Block 1 completes on first entry into the approved target zone.
   * Blocks 2 and 3 complete on intrabar touch of targetZone.midline.
   * No EMA20 runner remains during this testing phase.
   */
  const targetZoneEntryTouched =
    price !== null &&
    (
      (
        direction === "LONG" &&
        targetLow !== null &&
        price >= targetLow
      ) ||
      (
        direction === "SHORT" &&
        targetHigh !== null &&
        price <= targetHigh
      )
    );

  const targetMidlineReached =
    price !== null &&
    targetMidline !== null &&
    (
      (
        direction === "LONG" &&
        price >= targetMidline
      ) ||
      (
        direction === "SHORT" &&
        price <= targetMidline
      )
    );

  if (targetMidlineReached) {
    return {
      released: true,
      // Keep the approved retirement reason for memory compatibility.
      releaseReason: "TARGET_ZONE_REACHED",
      targetApproachCompletionWatch: false,
      targetZoneEntryTouched: true,
      targetMidlineReached: true,
      objectiveCompleted: true,
      targetReached: true,
      favorableExcursion,
      priorRotationCompletionState:
        "FULL_TARGET_COMPLETION",
      priorRotationFullyComplete: true,
      remainingRunnerExpected: false,
      completionBoundary: targetMidline,
      completedTargetZoneId,
      completedTargetZone: targetZone,
    };
  }

  if (targetZoneEntryTouched) {
    return {
      released: false,
      releaseReason: null,
      targetApproachCompletionWatch: true,
      targetZoneEntryTouched: true,
      targetMidlineReached: false,
      objectiveCompleted,
      targetReached: false,
      favorableExcursion,
      priorRotationCompletionState:
        "PARTIAL_PROFIT_TAKING",
      priorRotationFullyComplete: false,
      remainingRunnerExpected: true,
      completionBoundary: targetMidline,
      completedTargetZoneId: null,
      completedTargetZone: null,
    };
  }

  return {
    ...emptyState,
    objectiveCompleted,
    favorableExcursion,
    completionBoundary: targetMidline,
  };
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
    direction: "NEUTRAL",
    tradeDirectionBias: "NEUTRAL",
    preferredDirection: "NEUTRAL",
    directionState:
      "OBSERVING_ZONE_REACTION",
    directionResolvedAt: null,
    candidateLifecycleStartTime:
      snapshotTime,
    directionalEvidence: null,
    ema10Posture: null,
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
    /*
     * Engine 3 / Engine 4 observation stays online even when
     * Engine 26 has no valid candidate context yet.
     *
     * "active" means the observer pipeline is running.
     * "authorizeEngine3Evaluation" separately tells downstream
     * consumers whether the current Engine 26 candidate context
     * is valid for Strategy 1 evaluation.
     */
    active: true,
    armed: true,
    observerActive: true,
    evaluationContextValid: false,

    engine:
      "engine26.reactionHandoff.v1",

    status:
      "OBSERVING_WITHOUT_LOCATION_CONTEXT",

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

    rejectionFacts:
      candidate?.rejectionFacts ?? null,

    upperWickFacts:
      candidate?.upperWickFacts ?? null,

    failedAcceptanceFacts:
      candidate?.failedAcceptanceFacts ?? null,

    failedReclaimFacts:
      candidate?.failedReclaimFacts ?? null,

    postRejectionFacts:
      candidate?.postRejectionFacts ?? null,

    lifecycleFacts:
      candidate?.lifecycleFacts ?? null,

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
      "ENGINE26_REACTION_OBSERVER_ALWAYS_ACTIVE",
      "ENGINE26_REACTION_CONTEXT_NOT_AUTHORIZED",
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
  selectionPurpose = "STRATEGY1_CHILD",
  currentPrice,
  snapshotTime = new Date().toISOString(),
  engine22WaveStrategy = null,
  engine25Context = null,
  engine1Context = null,
  previousLocationCandidate = null,
  bars10m = [],
  ema10Posture = null,
  manualZonesFilePath = undefined,
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
    manualZonesFilePath
      ? readEngine26ManualImbalanceZones({
          filePath: manualZonesFilePath,
        })
      : readEngine26ManualImbalanceZones();

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

/*
 * General parent location and Strategy 1 child location are
 * independent Engine 26A contracts.
 *
 * GENERAL_PARENT:
 * May select any valid contextual zone.
 *
 * STRATEGY1_CHILD:
 * May select only an approved negotiated zone.
 * The broad parent location must not suppress the child.
 */
const generalSelectedZone =
  authorizationEligibleZones[0] ||
  allZones[0] ||
  null;

const approvedNegotiatedZones =
  allZones.filter(isApprovedNegotiatedZone);

const strategy1EligibleZones =
  approvedNegotiatedZones.filter(
    (zone) =>
      zone.distancePoints !== null &&
      zone.distancePoints <=
        safeMonitoringRange
  );

const resolvedEma10Posture =
  resolveEma10Posture({
    ema10Posture,
    currentPrice: normalizedPrice,
    bars10m,
  });

/*
 * Strategy 1 V2 preserves the active child before ranking.
 * Ranking and distance select only when no preservable child remains.
 */
const strategy1MemoryRead =
  selectionPurpose === "STRATEGY1_CHILD"
    ? readNegotiatedZoneMemory({
        filePath: memoryFilePath,
      })
    : {
        ok: true,
        store: {
          schema: "engine26.negotiatedZoneMemory.v1",
          records: {},
        },
        warnings: [],
        malformed: false,
      };

const immediatePriorMemoryRecord =
  getPriorMemoryRecord({
    memoryStore: strategy1MemoryRead.store,
    symbol: normalizedSymbol,
    strategyId: normalizedStrategyId,
    previousLocationCandidate,
  });

const immediatePreviousZone =
  findZoneByCanonicalId({
    zones: approvedNegotiatedZones,
    symbol: normalizedSymbol,
    zoneId: previousLocationCandidate?.zoneId,
  });

const immediatePreviousReleaseState =
  evaluatePreviousChildRelease({
    previousLocationCandidate,
    priorMemoryRecord:
      immediatePriorMemoryRecord,
    currentPrice: normalizedPrice,
  });

const immediatePreviousSetupIdentityValid =
  previousLocationCandidate?.laneId === "minute" &&
  previousLocationCandidate?.strategyId ===
    normalizedStrategyId &&
  String(previousLocationCandidate?.symbol || "")
    .toUpperCase() === normalizedSymbol &&
  previousLocationCandidate?.setupClass ===
    STRATEGY1_SETUP_CLASS &&
  previousLocationCandidate?.identitySetupKey ===
    STRATEGY1_SETUP_CLASS &&
  previousLocationCandidate?.candidateIdentityVersion ===
    "engine26.strategy1.v2";

const immediatePreviousPromotedContactPreservable =
  selectionPurpose === "STRATEGY1_CHILD" &&
  Boolean(immediatePreviousZone) &&
  immediatePreviousSetupIdentityValid &&
  previousLocationCandidate?.active === true &&
  previousLocationCandidate?.contactState ===
    "NEGOTIATED_LINE_CONTACT" &&
  previousLocationCandidate?.chainArmed === true &&
  isPromotedObservationReason(
    previousLocationCandidate?.promotionReason
  ) &&
  previousLocationCandidate?.priorRotationFullyComplete === true &&
  previousLocationCandidate?.promotedFromTargetCompletion === true &&
  normalizeDirection(
    previousLocationCandidate?.directionBias ??
    previousLocationCandidate?.direction
  ) === "NEUTRAL" &&
  previousLocationCandidate?.invalidationFacts
    ?.completedCloseInvalidationConfirmed !== true;

const immediatePreviousChildPreservable =
  selectionPurpose === "STRATEGY1_CHILD" &&
  Boolean(immediatePreviousZone) &&
  immediatePreviousSetupIdentityValid &&
  previousLocationCandidate?.active === true &&
  ["LONG", "SHORT"].includes(
    normalizeDirection(
      previousLocationCandidate?.directionBias ??
      previousLocationCandidate?.direction
    )
  ) &&
  immediatePreviousReleaseState.released !== true;

const recoveredPromotedContactChild =
  selectionPurpose === "STRATEGY1_CHILD" &&
  immediatePreviousPromotedContactPreservable !== true &&
  immediatePreviousChildPreservable !== true
    ? findRecoverablePromotedContactMemoryChild({
        memoryStore: strategy1MemoryRead.store,
        zones: approvedNegotiatedZones,
        symbol: normalizedSymbol,
        strategyId: normalizedStrategyId,
        snapshotTime,
      })
    : null;

const recoveredMemoryChild =
  selectionPurpose === "STRATEGY1_CHILD" &&
  immediatePreviousPromotedContactPreservable !== true &&
  immediatePreviousChildPreservable !== true &&
  recoveredPromotedContactChild == null
    ? findRecoverableDirectionalMemoryChild({
        memoryStore: strategy1MemoryRead.store,
        zones: approvedNegotiatedZones,
        symbol: normalizedSymbol,
        strategyId: normalizedStrategyId,
        currentPrice: normalizedPrice,
        ema10Posture: resolvedEma10Posture,
        bars10m,
        snapshotTime,
        tickSize,
      })
    : null;

const continuityLocationCandidate =
  immediatePreviousPromotedContactPreservable
    ? previousLocationCandidate
    : immediatePreviousChildPreservable
    ? previousLocationCandidate
    : recoveredPromotedContactChild?.candidate ||
      recoveredMemoryChild?.candidate ||
      null;

const previousZone =
  (
    immediatePreviousPromotedContactPreservable ||
    immediatePreviousChildPreservable
  )
    ? immediatePreviousZone
    : recoveredPromotedContactChild?.zone ||
      recoveredMemoryChild?.zone ||
      null;

const priorMemoryRecord =
  (
    immediatePreviousPromotedContactPreservable ||
    immediatePreviousChildPreservable
  )
    ? immediatePriorMemoryRecord
    : recoveredPromotedContactChild?.record ||
      recoveredMemoryChild?.record ||
      null;

const previousReleaseState =
  continuityLocationCandidate
    ? evaluatePreviousChildRelease({
        previousLocationCandidate:
          continuityLocationCandidate,
        priorMemoryRecord,
        currentPrice: normalizedPrice,
      })
    : {
        released: false,
        releaseReason: null,
        targetApproachCompletionWatch: false,
        objectiveCompleted: false,
        targetReached: false,
      };

const restoredPromotedContact =
  Boolean(continuityLocationCandidate) &&
  Boolean(previousZone) &&
  continuityLocationCandidate?.contactState ===
    "NEGOTIATED_LINE_CONTACT" &&
  continuityLocationCandidate?.chainArmed === true &&
  isPromotedObservationReason(
    continuityLocationCandidate?.promotionReason
  ) &&
  continuityLocationCandidate?.priorRotationFullyComplete === true &&
  continuityLocationCandidate?.promotedFromTargetCompletion === true &&
  continuityLocationCandidate?.invalidationFacts
    ?.completedCloseInvalidationConfirmed !== true;

const rankedStrategy1Zone =
  strategy1EligibleZones[0] ||
  null;

/*
 * Once price touches a different approved negotiated zone, that
 * contacted zone becomes the new canonical promoted observation.
 *
 * Contact is proven by either:
 *   1. current price inside the zone; or
 *   2. any 10-minute bar at or after the current promoted
 *      observation began whose high/low range touched the zone.
 *
 * The current tick does not need to remain inside afterward.
 * Distance alone cannot supersede a zone, and active LONG/SHORT
 * directional children remain protected by their lifecycle rules.
 */
const promotedObservationContactCandidates =
  restoredPromotedContact === true
    ? strategy1EligibleZones
        .map((zone) => {
          const zoneId =
            buildCanonicalZoneId(
              normalizedSymbol,
              zone
            );

          const contactEvidence =
            resolveNegotiatedZoneContactEvidence({
              zone,
              currentPrice:
                normalizedPrice,
              bars10m,
              sinceTime:
                continuityLocationCandidate
                  ?.promotionTime ??
                continuityLocationCandidate
                  ?.candidateLifecycleStartTime ??
                priorMemoryRecord
                  ?.promotionTime ??
                priorMemoryRecord
                  ?.candidateLifecycleStartTime ??
                null,
            });

          return {
            zone,
            zoneId,
            contactEvidence,
          };
        })
        .filter(
          (candidate) =>
            candidate.zoneId !==
              continuityLocationCandidate
                ?.zoneId &&
            candidate.contactEvidence
              .observed === true
        )
        .sort((a, b) => {
          const aTime =
            parseObservationTimeMs(
              a.contactEvidence
                .touchedAt
            );

          const bTime =
            parseObservationTimeMs(
              b.contactEvidence
                .touchedAt
            );

          if (
            aTime !== null ||
            bTime !== null
          ) {
            return (
              Number(bTime ?? -1) -
              Number(aTime ?? -1)
            );
          }

          return (
            Number(
              b.zone?.selectionScore ?? 0
            ) -
            Number(
              a.zone?.selectionScore ?? 0
            )
          );
        })
    : [];

const promotedObservationSupersessionCandidate =
  promotedObservationContactCandidates[0] ||
  null;

const promotedObservationSupersession =
  selectionPurpose === "STRATEGY1_CHILD" &&
  restoredPromotedContact === true &&
  Boolean(
    promotedObservationSupersessionCandidate
  );

const supersedingNegotiatedZone =
  promotedObservationSupersessionCandidate
    ?.zone || null;

const supersedingNegotiatedZoneContactEvidence =
  promotedObservationSupersessionCandidate
    ?.contactEvidence || null;

const activeRestoredPromotedContact =
  restoredPromotedContact === true &&
  promotedObservationSupersession !== true;

const previousChildPreservable =
  Boolean(continuityLocationCandidate) &&
  Boolean(previousZone) &&
  (
    activeRestoredPromotedContact ||
    (
      restoredPromotedContact !== true &&
      previousReleaseState.released !== true
    )
  );

const strategy1SelectedZone =
  promotedObservationSupersession
    ? supersedingNegotiatedZone
    : previousChildPreservable
    ? previousZone
    : rankedStrategy1Zone;

const selectedZone =
  selectionPurpose === "GENERAL_PARENT"
    ? generalSelectedZone
    : strategy1SelectedZone;
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

/*
 * Strategy 1 is the bullish negotiated-zone sweep/reclaim setup.
 *
 * Engine 22's degree direction describes the active internal wave leg.
 * It must not become the tactical trade direction for Strategy 1.
 *
 * Example:
 * Minute C leg direction may be DOWN while the completion reaction
 * at negotiated support is a tactical LONG reclaim watch.
 */
const strategy1Eligible =
  isApprovedNegotiatedZone(selectedZone);

const structuralDirectionBias =
  inferDirectionBias({
    selectedZone,
    engine22WaveStrategy,
  });

const selectedZoneId =
  buildCanonicalZoneId(
    normalizedSymbol,
    selectedZone
  );

const promotionSourceCandidate =
  immediatePreviousReleaseState.released === true
    ? previousLocationCandidate
    : continuityLocationCandidate;

const promotionReleaseState =
  immediatePreviousReleaseState.released === true
    ? immediatePreviousReleaseState
    : previousReleaseState;

const previousTargetZoneId =
  promotionSourceCandidate?.targetZone?.zoneId ??
  promotionSourceCandidate?.targetZone?.id ??
  null;

const promotedObservation =
  selectionPurpose === "STRATEGY1_CHILD" &&
  promotionReleaseState.released === true &&
  Boolean(previousTargetZoneId) &&
  previousTargetZoneId === selectedZoneId;

const promotionSourceDirection =
  normalizeDirection(
    promotionSourceCandidate?.directionBias ??
    promotionSourceCandidate?.direction
  );

const freshTargetMidlineContact =
  promotedObservation === true &&
  promotionReleaseState.releaseReason ===
    "TARGET_ZONE_REACHED" &&
  promotionReleaseState.targetMidlineReached === true;

const promotedContactLifecycle =
  freshTargetMidlineContact ||
  activeRestoredPromotedContact ||
  promotedObservationSupersession;

const promotedObservationReason =
  promotedObservationSupersession
    ? PROMOTED_CONTACT_SUPERSESSION_REASON
    : PROMOTED_CONTACT_COMPLETION_REASON;

const priorLongCompletedAtContact =
  promotedContactLifecycle === true &&
  (
    promotionSourceDirection === "LONG" ||
    continuityLocationCandidate?.priorRotationDirection === "LONG"
  );

const contactState =
  promotedContactLifecycle
    ? "NEGOTIATED_LINE_CONTACT"
    : null;

const chainArmed =
  promotedContactLifecycle === true;

const expectedReversalDirection =
  promotedContactLifecycle &&
  (
    promotionSourceDirection === "LONG" ||
    continuityLocationCandidate
      ?.priorRotationDirection === "LONG"
  )
    ? "SHORT"
    : promotedContactLifecycle &&
      (
        promotionSourceDirection === "SHORT" ||
        continuityLocationCandidate
          ?.priorRotationDirection === "SHORT"
      )
    ? "LONG"
    : null;

const priorRotationDirection =
  promotedContactLifecycle
    ? (
        continuityLocationCandidate
          ?.priorRotationDirection ||
        promotionSourceDirection
      )
    : null;

const priorRotationCompletionState =
  promotedContactLifecycle
    ? "FULL_TARGET_COMPLETION"
    : previousReleaseState
        ?.priorRotationCompletionState ??
      null;

const currentObservationDirection =
  promotedContactLifecycle
    ? "NEUTRAL"
    : null;

const priorRotationFullyComplete =
  promotedContactLifecycle
    ? true
    : previousReleaseState
        ?.priorRotationFullyComplete === true;

const remainingRunnerExpected =
  promotedContactLifecycle
    ? false
    : previousReleaseState
        ?.remainingRunnerExpected ??
      null;

const completionBoundary =
  promotedContactLifecycle
    ? (
        continuityLocationCandidate
          ?.completionBoundary ??
        promotionReleaseState
          ?.completionBoundary ??
        toFiniteNumber(
          promotionSourceCandidate
            ?.targetZone?.midline
        )
      )
    : previousReleaseState
        ?.completionBoundary ??
      null;

const completedTargetZoneId =
  promotedContactLifecycle
    ? (
        continuityLocationCandidate
          ?.completedTargetZoneId ??
        promotionReleaseState
          ?.completedTargetZoneId ??
        previousTargetZoneId
      )
    : null;

const completedTargetZone =
  promotedContactLifecycle
    ? (
        continuityLocationCandidate
          ?.completedTargetZone ??
        promotionReleaseState
          ?.completedTargetZone ??
        promotionSourceCandidate?.targetZone ??
        null
      )
    : null;

const provisionalEntryZone =
  strategy1Eligible
    ? {
        id: selectedZoneId,
        zoneId: selectedZoneId,
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

const longBoundaries =
  buildBoundaries({
    directionBias: "LONG",
    zone: selectedZone,
    tickSize,
  });

const shortBoundaries =
  buildBoundaries({
    directionBias: "SHORT",
    zone: selectedZone,
    tickSize,
  });

const priorDirectionalChildDirection =
  previousChildPreservable
    ? normalizeDirection(
        continuityLocationCandidate?.directionBias ??
        continuityLocationCandidate?.direction
      )
    : "NEUTRAL";

/*
 * Fact extraction keeps the full historical bar set, but completed-close
 * invalidation must use the current directional child's lifecycle window.
 *
 * A preserved same-zone/same-direction child keeps its prior lifecycle
 * start. A new zone, neutral observation, or newly resolved direction starts
 * at the current snapshot time.
 */
const factsLifecycleStartTime =
  previousChildPreservable &&
  ["LONG", "SHORT"].includes(
    priorDirectionalChildDirection
  )
    ? resolveCandidateLifecycleStartTime({
        snapshotTime,
        continuityLocationCandidate,
        priorMemoryRecord,
        selectedZoneId,
        direction:
          priorDirectionalChildDirection,
      })
    : snapshotTime;

const longFacts =
  strategy1Eligible
    ? buildStrategy1Facts({
        bars10m,
        entryZone: provisionalEntryZone,
        locationInvalidationBoundary:
          longBoundaries.locationInvalidationBoundary,
        direction: "LONG",
        lifecycleStartTime:
          factsLifecycleStartTime,
      })
    : null;

const shortFacts =
  strategy1Eligible
    ? buildStrategy1Facts({
        bars10m,
        entryZone: provisionalEntryZone,
        locationInvalidationBoundary:
          shortBoundaries.locationInvalidationBoundary,
        direction: "SHORT",
        lifecycleStartTime:
          factsLifecycleStartTime,
      })
    : null;

const resolvedDirectionalEvidence =
  strategy1Eligible
    ? resolveDirectionalEvidence({
        selectedZone,
        currentPrice: normalizedPrice,
        bars10m,
        ema10Posture:
          resolvedEma10Posture,
        longFacts,
        shortFacts,
        promotedObservation,
      })
    : {
        direction:
          structuralDirectionBias,
        preferredDirection:
          structuralDirectionBias,
        directionState:
          "STRUCTURAL_CONTEXT_ONLY",
        promotedObservation: false,
        evidenceSufficient:
          structuralDirectionBias !== "NEUTRAL",
        reasonCodes: [],
      };

const preservedDirection =
  previousChildPreservable
    ? normalizeDirection(
        continuityLocationCandidate?.directionBias ??
        continuityLocationCandidate?.direction
      )
    : "NEUTRAL";

const observationOnlyLongWatch =
  resolvedDirectionalEvidence?.directionState ===
  "LONG_REVERSAL_WATCH";

const directionBias =
  promotedContactLifecycle
    ? "NEUTRAL"
    : observationOnlyLongWatch
    ? "NEUTRAL"
    : strategy1Eligible
    ? preservedDirection !== "NEUTRAL"
      ? preservedDirection
      : resolvedDirectionalEvidence.direction
    : structuralDirectionBias;

const directionState =
  promotedContactLifecycle
    ? expectedReversalDirection === "SHORT"
      ? "SHORT_REVERSAL_WATCH"
      : expectedReversalDirection === "LONG"
      ? "LONG_REVERSAL_WATCH"
      : "NEUTRAL"
    : observationOnlyLongWatch
    ? "LONG_REVERSAL_WATCH"
    : strategy1Eligible &&
      preservedDirection !== "NEUTRAL"
    ? continuityLocationCandidate?.directionState ||
      `${preservedDirection}_DIRECTIONAL_CHILD_ACTIVE`
    : resolvedDirectionalEvidence.directionState;

const directionResolvedAt =
  ["LONG", "SHORT"].includes(directionBias)
    ? resolveCandidateLifecycleStartTime({
        snapshotTime,
        continuityLocationCandidate,
        priorMemoryRecord,
        selectedZoneId,
        direction: directionBias,
      })
    : null;

const candidateLifecycleStartTime =
  directionResolvedAt ||
  (
    promotedContactLifecycle
      ? snapshotTime
      : continuityLocationCandidate
          ?.candidateLifecycleStartTime ||
        snapshotTime
  );

const setupType =
  strategy1Eligible
    ? STRATEGY1_SETUP_CLASS
    : inferSetupType(
        engine22WaveStrategy
      );

/*
 * Engine 26 owns the canonical zone identity.
 */
const zoneId = selectedZoneId;

const strategyIdentity =
  strategy1Eligible
    ? resolveEngine26Strategy1Identity({
        symbol: normalizedSymbol,
        strategyId: normalizedStrategyId,
        zoneId,
        directionBias,
        previousLocationCandidate:
          previousChildPreservable &&
          promotedObservationSupersession !== true
            ? continuityLocationCandidate
            : null,
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
  activeRestoredPromotedContact ||
  promotedObservationSupersession
    ? true
    : strategy1Eligible && previousChildPreservable
    ? true
    : selectedZone.distancePoints <=
      safeMonitoringRange;

const status =
  !active
    ? "LOCATION_DETECTED"
    : directionBias === "NEUTRAL"
    ? (
        promotedObservation ||
        activeRestoredPromotedContact ||
        promotedObservationSupersession
      )
      ? "OBSERVING_PROMOTED_ZONE"
      : "OBSERVING_ZONE_REACTION"
    : selectedZone.distancePoints === 0
    ? "INSIDE_LOCATION"
    : selectedZone.distancePoints <=
      safeActivationRange
    ? "APPROACHING_LOCATION"
    : "LOCATION_DETECTED";

const boundaries =
  directionBias === "LONG"
    ? longBoundaries
    : directionBias === "SHORT"
    ? shortBoundaries
    : {
        triggerLevel: null,
        acceptanceBoundary: null,
        reclaimBoundary: null,
        rejectionBoundary: null,
        locationInvalidationBoundary: null,
      };

const targetSelectedZone =
  strategy1Eligible && directionBias === "LONG"
    ? selectLongTargetZone({
        negotiatedZones: approvedNegotiatedZones,
        entryZone: selectedZone,
      })
    : strategy1Eligible && directionBias === "SHORT"
    ? selectShortTargetZone({
        negotiatedZones: approvedNegotiatedZones,
        entryZone: selectedZone,
      })
    : null;

const entryZone =
  provisionalEntryZone;

const targetZone = targetSelectedZone
  ? {
      id: buildCanonicalZoneId(
        normalizedSymbol,
        targetSelectedZone
      ),
      zoneId: buildCanonicalZoneId(
        normalizedSymbol,
        targetSelectedZone
      ),
      upstreamId:
        targetSelectedZone.upstreamId,
      source: targetSelectedZone.source,
      sourcePath:
        targetSelectedZone.sourcePath,
      type: targetSelectedZone.type,
      timeframe:
        targetSelectedZone.timeframe,
      low: targetSelectedZone.lo,
      high: targetSelectedZone.hi,
      midline: targetSelectedZone.mid,
    }
  : null;

const strategyFacts =
  directionBias === "LONG"
    ? longFacts
    : directionBias === "SHORT"
    ? shortFacts
    : {
        direction: "NEUTRAL",
        sweepFacts:
          longFacts?.sweepFacts || null,
        lowerWickFacts:
          longFacts?.lowerWickFacts || null,
        reclaimFacts:
          longFacts?.reclaimFacts || null,
        postReclaimFacts:
          longFacts?.postReclaimFacts || null,
        rejectionFacts:
          shortFacts?.rejectionFacts || null,
        upperWickFacts:
          shortFacts?.upperWickFacts || null,
        failedAcceptanceFacts:
          shortFacts?.failedAcceptanceFacts || null,
        failedReclaimFacts:
          shortFacts?.failedReclaimFacts || null,
        postRejectionFacts:
          shortFacts?.postRejectionFacts || null,
        lifecycleFacts: {
          setupDeveloping:
            longFacts?.lifecycleFacts
              ?.setupDeveloping === true ||
            shortFacts?.lifecycleFacts
              ?.setupDeveloping === true,
          reactionEvaluationFactsReady:
            false,
        },
        invalidationFacts: {
          boundary: null,
          direction: "NEUTRAL",
          intrabarInvalidationBreachObserved:
            false,
          completedCloseInvalidationConfirmed:
            false,
          invalidationTime: null,
          invalidationClose: null,
        },
        warnings: [
          ...(longFacts?.warnings || []),
          ...(shortFacts?.warnings || []),
        ],
      };

  const invalidated =
    strategyFacts?.invalidationFacts
      ?.completedCloseInvalidationConfirmed === true;

  const candidateActive = active && !invalidated;
  const candidateStatus = invalidated ? "INVALIDATED" : status;

  let zoneMemorySummary = null;
  let memoryWarnings = [];

  if (strategy1Eligible) {
    const memoryRead = strategy1MemoryRead;

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
      directionBias,
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
      identityAdoptedFromPreviousV2:
        strategyIdentity?.identityAdoptedFromPreviousV2 === true,
      legacyCandidateId:
        strategyIdentity?.legacyCandidateId || null,
      entryZone,
      targetZone,
      candidateLifecycleStartTime,
      directionResolvedAt,
      direction: directionBias,
      directionState,
      directionalResolved:
        ["LONG", "SHORT"].includes(directionBias),
      contactState,
      chainArmed,
      expectedReversalDirection,
      expectedParticipationDirection:
        promotedContactLifecycle
          ? expectedReversalDirection
          : null,
      priorCandidateId:
        promotedContactLifecycle
          ? (
              promotedObservationSupersession
                ? continuityLocationCandidate?.candidateId
                : continuityLocationCandidate?.priorCandidateId ??
                  promotionSourceCandidate?.candidateId
            ) ?? null
          : null,
      priorZoneId:
        promotedContactLifecycle
          ? (
              promotedObservationSupersession
                ? continuityLocationCandidate?.zoneId
                : continuityLocationCandidate?.priorZoneId ??
                  promotionSourceCandidate?.zoneId
            ) ?? null
          : null,
      priorRotationDirection,
      priorRotationCompletionState,
      priorRotationFullyComplete,
      remainingRunnerExpected,
      completionBoundary,
      completedTargetZoneId,
      completedTargetZone,
      promotionReason:
        promotedContactLifecycle
          ? promotedObservationReason
          : null,
      promotedFromTargetCompletion:
        promotedContactLifecycle,
      targetZoneEntryTouched:
        previousReleaseState?.targetZoneEntryTouched === true ||
        promotedContactLifecycle,
      targetMidlineReached:
        previousReleaseState?.targetMidlineReached === true ||
        promotedContactLifecycle,
      targetZoneEntryTouchedAt:
        freshTargetMidlineContact
          ? snapshotTime
          : continuityLocationCandidate?.targetZoneEntryTouchedAt ?? null,
      targetMidlineReachedAt:
        freshTargetMidlineContact
          ? snapshotTime
          : continuityLocationCandidate?.targetMidlineReachedAt ?? null,
      promotionTime:
        freshTargetMidlineContact
          ? snapshotTime
          : continuityLocationCandidate?.promotionTime ?? null,
      profitObjectiveReachedAt:
        freshTargetMidlineContact
          ? snapshotTime
          : continuityLocationCandidate?.profitObjectiveReachedAt ?? null,
    };

    const currentLifecycleUpdate = {
      lifecycleStatus:
        invalidated
          ? "INVALIDATED"
          : previousReleaseState
              .targetApproachCompletionWatch
          ? "TARGET_APPROACH_COMPLETION_WATCH"
          : "ACTIVE",

      releaseReason:
        invalidated
          ? "COMPLETED_CLOSE_INVALIDATION"
          : null,

      maximumFavorableExcursionPoints:
        previousReleaseState.favorableExcursion ?? null,

      targetApproachAt:
        previousReleaseState
          .targetApproachCompletionWatch
          ? snapshotTime
          : null,

      objectiveCompletedAt:
        previousReleaseState.objectiveCompleted
          ? snapshotTime
          : null,

      contactState,
      chainArmed,
      directionBias,
      directionState,
      directionalResolved:
        ["LONG", "SHORT"].includes(directionBias),
      expectedReversalDirection,
      expectedParticipationDirection:
        promotedContactLifecycle
          ? expectedReversalDirection
          : null,
      targetZoneEntryTouched:
        previousReleaseState?.targetZoneEntryTouched === true ||
        promotedContactLifecycle,
      targetMidlineReached:
        previousReleaseState?.targetMidlineReached === true ||
        promotedContactLifecycle,
      priorRotationCompletionState,
      priorRotationFullyComplete,
      remainingRunnerExpected,
      completionBoundary,
      completedTargetZoneId,
      completedTargetZone,
      priorCandidateId:
        promotedContactLifecycle
          ? (
              promotedObservationSupersession
                ? continuityLocationCandidate?.candidateId
                : continuityLocationCandidate?.priorCandidateId ??
                  promotionSourceCandidate?.candidateId
            ) ?? null
          : null,
      priorZoneId:
        promotedContactLifecycle
          ? (
              promotedObservationSupersession
                ? continuityLocationCandidate?.zoneId
                : continuityLocationCandidate?.priorZoneId ??
                  promotionSourceCandidate?.zoneId
            ) ?? null
          : null,
      priorRotationDirection,
      promotionReason:
        promotedContactLifecycle
          ? promotedObservationReason
          : null,
      promotedFromTargetCompletion:
        promotedContactLifecycle,
      targetZoneEntryTouchedAt:
        freshTargetMidlineContact
          ? snapshotTime
          : continuityLocationCandidate?.targetZoneEntryTouchedAt ?? null,
      targetMidlineReachedAt:
        freshTargetMidlineContact
          ? snapshotTime
          : continuityLocationCandidate?.targetMidlineReachedAt ?? null,
      promotionTime:
        freshTargetMidlineContact
          ? snapshotTime
          : continuityLocationCandidate?.promotionTime ?? null,
      profitObjectiveReachedAt:
        freshTargetMidlineContact
          ? snapshotTime
          : continuityLocationCandidate?.profitObjectiveReachedAt ?? null,
    };

    const memoryStoreForUpdate =
      promotedContactLifecycle &&
      memoryRead.store?.records?.[memoryKey]
        ? {
            ...memoryRead.store,
            records: {
              ...memoryRead.store.records,
              [memoryKey]: {
                ...memoryRead.store.records[memoryKey],
                direction: "NEUTRAL",
                directionBias: "NEUTRAL",
                directionalResolved: false,
                directionState,
                expectedDirection: null,
                expectedReactionDirection:
                  expectedReversalDirection,
                expectedReversalDirection,
                expectedParticipationDirection:
                  expectedReversalDirection,
                expectedReactions:
                  expectedReversalDirection
                    ? expectedReactionsForDirection(
                        expectedReversalDirection
                      )
                    : [],
                reactionExpected:
                  Boolean(
                    expectedReversalDirection
                  ),
              },
            },
          }
        : memoryRead.store;

    let memoryUpdate = updateNegotiatedZoneMemory({
      store: memoryStoreForUpdate,
      memoryKey,
      candidate: memoryCandidate,
      facts: strategyFacts,
      snapshotTime,
      lifecycleUpdate: currentLifecycleUpdate,
    });

    const priorZoneId =
      promotionSourceCandidate?.zoneId ??
      continuityLocationCandidate?.zoneId ??
      null;

    if (
      priorZoneId &&
      priorZoneId !== zoneId &&
      promotionReleaseState.released === true &&
      promotionReleaseState.releaseReason
    ) {
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
          retirementReason:
            promotionReleaseState.releaseReason,
        }),
      };
    }

    if (
      promotedObservationSupersession === true &&
      continuityLocationCandidate?.zoneId &&
      continuityLocationCandidate.zoneId !== zoneId
    ) {
      const supersededMemoryKey =
        buildStrategy1MemoryKey({
          laneId: "minute",
          symbol: normalizedSymbol,
          strategyId: normalizedStrategyId,
          zoneId:
            continuityLocationCandidate.zoneId,
        });

      memoryUpdate = {
        ...memoryUpdate,
        store: retirePriorMemoryRecord({
          store: memoryUpdate.store,
          priorMemoryKey:
            supersededMemoryKey,
          retiredAt: snapshotTime,
          retirementReason:
            "EXPLICIT_LIFECYCLE_PROMOTION",
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
      releaseReason: record.releaseReason ?? null,
      direction: record.direction ?? directionBias,
      setupClass: record.setupClass ?? null,
      targetTouchedAt: record.targetTouchedAt ?? null,
      targetApproachAt: record.targetApproachAt ?? null,
      objectiveCompletedAt: record.objectiveCompletedAt ?? null,
      maximumFavorableExcursionPoints:
        record.maximumFavorableExcursionPoints ?? null,
      candidateLifecycleStartTime:
        record.candidateLifecycleStartTime ?? null,
      directionResolvedAt:
        record.directionResolvedAt ?? null,
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
    preferredDirection:
      directionBias,
    directionState,
    directionResolvedAt,
    candidateLifecycleStartTime,

    contactState,
    freshTargetMidlineContact,
    restoredPromotedContact:
      activeRestoredPromotedContact,
    chainArmed,
    expectedReversalDirection,
    expectedDirection: null,
    expectedReactionDirection:
      promotedContactLifecycle
        ? expectedReversalDirection
        : null,
    expectedParticipationDirection:
      promotedContactLifecycle
        ? expectedReversalDirection
        : null,
    expectedReactions:
      promotedContactLifecycle &&
      expectedReversalDirection
        ? expectedReactionsForDirection(
            expectedReversalDirection
          )
        : [],
    reactionExpected:
      promotedContactLifecycle &&
      Boolean(expectedReversalDirection),
    priorRotationDirection,
    priorRotationCompletionState,
    currentObservationDirection,
    targetApproachCompletionWatch:
      previousReleaseState
        ?.targetApproachCompletionWatch === true,
    targetZoneEntryTouched:
      previousReleaseState
        ?.targetZoneEntryTouched === true ||
      promotedContactLifecycle,
    targetMidlineReached:
      previousReleaseState
        ?.targetMidlineReached === true ||
      promotedContactLifecycle,
    priorRotationFullyComplete,
    remainingRunnerExpected,
    completionBoundary,
    completedTargetZoneId,
    completedTargetZone,
    ema20RunnerEnabled: false,
    shortConfirmed: false,
    directionalResolved:
      ["LONG", "SHORT"].includes(directionBias),
    automaticDirectionFlip: false,

    parentCandidateId:
      promotedContactLifecycle
        ? promotionSourceCandidate?.candidateId ?? null
        : null,
    parentZoneId:
      promotedContactLifecycle
        ? promotionSourceCandidate?.zoneId ?? null
        : null,
    priorCandidateId:
      promotedContactLifecycle
        ? promotionSourceCandidate?.candidateId ?? null
        : null,
    priorZoneId:
      promotedContactLifecycle
        ? promotionSourceCandidate?.zoneId ?? null
        : null,
    promotionReason:
      promotedContactLifecycle
        ? promotedObservationReason
        : null,
    promotedFromTargetContact:
      false,
    promotedFromTargetCompletion:
      promotedContactLifecycle,
    targetZoneEntryTouchedAt:
      promotedContactLifecycle ||
      previousReleaseState?.targetZoneEntryTouched === true
        ? (
            continuityLocationCandidate
              ?.targetZoneEntryTouchedAt ||
            snapshotTime
          )
        : null,
    targetMidlineReachedAt:
      promotedContactLifecycle
        ? (
            continuityLocationCandidate
              ?.targetMidlineReachedAt ||
            snapshotTime
          )
        : null,
    promotionTime:
      promotedContactLifecycle
        ? (
            continuityLocationCandidate
              ?.promotionTime ||
            snapshotTime
          )
        : null,
    profitObjectiveReachedAt:
      promotedContactLifecycle
        ? (
            continuityLocationCandidate
              ?.profitObjectiveReachedAt ||
            snapshotTime
          )
        : null,
    priorRotationFullyComplete,
    remainingRunnerExpected,
    completionBoundary,
    completedTargetZoneId,
    completedTargetZone,
    ema20RunnerEnabled: false,

    directionalEvidence:
      promotedContactLifecycle
        ? {
            ...resolvedDirectionalEvidence,
            direction: "NEUTRAL",
            preferredDirection: "NEUTRAL",
            directionState,
            evidenceSufficient: false,
            contactState: "NEGOTIATED_LINE_CONTACT",
            chainArmed: true,
            expectedDirection: null,
            expectedReactionDirection:
              expectedReversalDirection,
            expectedReversalDirection,
            expectedParticipationDirection:
              expectedReversalDirection,
            expectedReactions:
              expectedReversalDirection
                ? expectedReactionsForDirection(
                    expectedReversalDirection
                  )
                : [],
            reactionExpected:
              Boolean(expectedReversalDirection),
            reasonCodes: [
              ...(resolvedDirectionalEvidence?.reasonCodes || []),
              "ENGINE26_NEGOTIATED_LINE_CONTACT",
              "ENGINE26_FULL_TARGET_COMPLETION",
              "ENGINE26_CHAIN_ARMED",
              "ENGINE26_PROMOTED_ZONE_NEUTRAL_RESET",
              "ENGINE26_NO_AUTOMATIC_DIRECTION_FLIP",
            ],
          }
        : resolvedDirectionalEvidence,
    ema10Posture:
      resolvedEma10Posture,

    // Additive aliases for downstream consumers.
    // Engine 26A remains the tactical candidate-direction owner.
    direction: directionBias,
    tradeDirectionBias: directionBias,

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
      ? [
          directionBias === "SHORT"
            ? "NEXT_NEGOTIATED_ZONE_BELOW_ENTRY_SELECTED"
            : "NEXT_NEGOTIATED_ZONE_ABOVE_ENTRY_SELECTED",
        ]
      : [
          directionBias === "SHORT"
            ? "NEXT_NEGOTIATED_ZONE_BELOW_ENTRY_UNAVAILABLE"
            : "NEXT_NEGOTIATED_ZONE_ABOVE_ENTRY_UNAVAILABLE",
        ],

    sweepFacts: strategyFacts?.sweepFacts || null,
    lowerWickFacts: strategyFacts?.lowerWickFacts || null,
    reclaimFacts: strategyFacts?.reclaimFacts || null,
    postReclaimFacts: strategyFacts?.postReclaimFacts || null,
    rejectionFacts: strategyFacts?.rejectionFacts || null,
    upperWickFacts: strategyFacts?.upperWickFacts || null,
    failedAcceptanceFacts:
      strategyFacts?.failedAcceptanceFacts || null,
    failedReclaimFacts:
      strategyFacts?.failedReclaimFacts || null,
    postRejectionFacts:
      strategyFacts?.postRejectionFacts || null,
    lifecycleFacts: strategyFacts?.lifecycleFacts || null,
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

    directionalBoundaries: {
      LONG: longBoundaries,
      SHORT: shortBoundaries,
    },

    promotedObservationLocation:
      (
        promotedObservation ||
        promotedObservationSupersession
      )
        ? {
            active: true,
            status:
              "OBSERVING_PROMOTED_ZONE",
            direction: "NEUTRAL",
            priorCandidateId:
              promotionSourceCandidate
                ?.candidateId ?? null,
            priorZoneId:
              promotionSourceCandidate
                ?.zoneId ?? null,
            parentCandidateId:
              promotionSourceCandidate
                ?.candidateId ?? null,
            parentZoneId:
              promotionSourceCandidate
                ?.zoneId ?? null,
            priorRotationDirection,
            priorRotationCompletionState,
            promotionReason:
              promotionReleaseState
                .releaseReason ?? null,
            promotedFromTargetContact: false,
            promotedFromTargetCompletion:
              promotedContactLifecycle,
            priorRotationFullyComplete,
            remainingRunnerExpected,
            completionBoundary,
            completedTargetZoneId,
            completedTargetZone,
            contactState,
            chainArmed,
            expectedDirection: null,
            expectedReactionDirection:
              expectedReversalDirection,
            expectedReversalDirection,
            expectedParticipationDirection:
              expectedReversalDirection,
            expectedReactions:
              expectedReversalDirection
                ? expectedReactionsForDirection(
                    expectedReversalDirection
                  )
                : [],
            reactionExpected:
              Boolean(expectedReversalDirection),
            releaseReason:
              promotionReleaseState
                .releaseReason ?? null,
          }
        : null,

    expectedReactions:
      promotedContactLifecycle
        ? expectedReversalDirection
          ? expectedReactionsForDirection(
              expectedReversalDirection
            )
          : []
        : directionBias === "NEUTRAL"
        ? []
        : expectedReactionsForDirection(
            directionBias
          ),

    activationRangePoints:
      safeActivationRange,

    monitoringRangePoints:
      safeMonitoringRange,

    childPreservation: {
      preservedBeforeRanking:
        previousChildPreservable,
      promotedObservationSuperseded:
        promotedObservationSupersession,
      supersessionContactSource:
        promotedObservationSupersession
          ? supersedingNegotiatedZoneContactEvidence
              ?.source ?? null
          : null,
      supersessionContactAt:
        promotedObservationSupersession
          ? supersedingNegotiatedZoneContactEvidence
              ?.touchedAt ?? null
          : null,
      supersessionContactBar:
        promotedObservationSupersession
          ? supersedingNegotiatedZoneContactEvidence
              ?.bar ?? null
          : null,
      supersededCandidateId:
        promotedObservationSupersession
          ? continuityLocationCandidate
              ?.candidateId ?? null
          : null,
      supersededZoneId:
        promotedObservationSupersession
          ? continuityLocationCandidate
              ?.zoneId ?? null
          : null,
      newActiveCandidateId:
        promotedObservationSupersession
          ? candidateId
          : null,
      newActiveZoneId:
        promotedObservationSupersession
          ? zoneId
          : null,
      recoveredFromMemory:
        recoveredMemoryChild != null,
      priorZoneId:
        continuityLocationCandidate?.zoneId || null,
      releaseReason:
        previousReleaseState.releaseReason || null,
      targetApproachCompletionWatch:
        previousReleaseState
          .targetApproachCompletionWatch === true,
      objectiveCompleted:
        previousReleaseState.objectiveCompleted === true,
      targetReached:
        previousReleaseState.targetReached === true,
      targetZoneEntryTouched:
        previousReleaseState
          .targetZoneEntryTouched === true,
      targetMidlineReached:
        previousReleaseState
          .targetMidlineReached === true,
      priorRotationCompletionState:
        previousReleaseState
          .priorRotationCompletionState ?? null,
      priorRotationFullyComplete:
        previousReleaseState
          .priorRotationFullyComplete === true,
      remainingRunnerExpected:
        previousReleaseState
          .remainingRunnerExpected ?? null,
      completionBoundary:
        previousReleaseState
          .completionBoundary ?? null,
      nextRankedAlternativeZoneId:
        rankedStrategy1Zone &&
        rankedStrategy1Zone !== selectedZone
          ? buildCanonicalZoneId(
              normalizedSymbol,
              rankedStrategy1Zone
            )
          : null,
    },

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

      ...(resolvedDirectionalEvidence?.reasonCodes || []),

      candidateActive
        ? "ENGINE26A_CANDIDATE_WITHIN_MONITORING_RANGE"
        : invalidated
        ? "ENGINE26A_CANDIDATE_INVALIDATED_BY_COMPLETED_CLOSE"
        : "ENGINE26A_CANDIDATE_OUTSIDE_MONITORING_RANGE",

      ...(strategyIdentity?.reasonCodes || []),
      strategy1Eligible
        ? "ENGINE26_STRATEGY1_CLASSIFICATION_ATTACHED"
        : "ENGINE26_STRATEGY1_NOT_ELIGIBLE",

      strategy1Eligible
        ? `ENGINE26_STRATEGY1_TACTICAL_DIRECTION_${directionBias}`
        : null,

      strategy1Eligible
        ? "ENGINE22_INTERNAL_LEG_DIRECTION_NOT_USED_AS_TRADE_DIRECTION"
        : null,

      recoveredPromotedContactChild
        ? "ENGINE26_STRATEGY1_PROMOTED_CONTACT_RECOVERED_FROM_MEMORY"
        : null,

      recoveredMemoryChild
        ? "ENGINE26_STRATEGY1_DIRECTIONAL_CHILD_RECOVERED_FROM_MEMORY"
        : null,

      previousChildPreservable
        ? "ENGINE26_STRATEGY1_ACTIVE_CHILD_PRESERVED_BEFORE_RANKING"
        : null,

      previousChildPreservable
        ? "ENGINE26_STRATEGY1_ESTABLISHED_CHILD_BYPASSED_DISCOVERY_RANGE"
        : null,

      previousReleaseState.targetApproachCompletionWatch
        ? "ENGINE26_STRATEGY1_TARGET_APPROACH_COMPLETION_WATCH"
        : null,

      promotedContactLifecycle
        ? "ENGINE26_NEGOTIATED_LINE_CONTACT"
        : null,
      freshTargetMidlineContact
        ? "ENGINE26_FULL_TARGET_COMPLETION"
        : null,
      activeRestoredPromotedContact
        ? "ENGINE26_PROMOTED_CONTACT_RESTORED_FROM_MEMORY"
        : null,

      promotedObservationSupersession
        ? "ENGINE26_STRATEGY1_PROMOTED_OBSERVATION_SUPERSEDED"
        : null,

      promotedObservationSupersession
        ? "ENGINE26_STRATEGY1_NEW_APPROVED_NEGOTIATED_ZONE_CONTACT"
        : null,

      promotedObservationSupersession &&
      supersedingNegotiatedZoneContactEvidence
        ?.source ===
          "CURRENT_PRICE_INSIDE_NEGOTIATED_ZONE"
        ? "ENGINE26_STRATEGY1_SUPERSESSION_FROM_LIVE_ZONE_CONTACT"
        : null,

      promotedObservationSupersession &&
      supersedingNegotiatedZoneContactEvidence
        ?.source ===
          "TEN_MINUTE_BAR_TOUCHED_NEGOTIATED_ZONE"
        ? "ENGINE26_STRATEGY1_SUPERSESSION_FROM_10M_ZONE_CONTACT"
        : null,

      promotedObservationSupersession
        ? "ENGINE26_STRATEGY1_NEW_PROMOTED_IDENTITY_CREATED"
        : null,
      promotedContactLifecycle
        ? "ENGINE26_CHAIN_ARMED"
        : null,
      promotedContactLifecycle
        ? "ENGINE26_PROMOTED_ZONE_NEUTRAL_RESET"
        : null,
      promotedContactLifecycle
        ? "ENGINE26_NO_AUTOMATIC_DIRECTION_FLIP"
        : null,
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
    rejectionFacts: null,
    upperWickFacts: null,
    failedAcceptanceFacts: null,
    failedReclaimFacts: null,
    postRejectionFacts: null,
    lifecycleFacts: null,
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
  engine26GeneralLocation: null,
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

  const direction = normalizeDirection(
    candidate?.directionBias ??
    candidate?.direction
  );

  const contactArmed =
    candidate?.contactState ===
      "NEGOTIATED_LINE_CONTACT" &&
    candidate?.chainArmed === true;

  const longFactsReady =
    direction === "LONG" &&
    candidate?.sweepFacts?.intrabarSweepObserved === true &&
    candidate?.reclaimFacts?.completedReclaimObserved === true &&
    candidate?.postReclaimFacts?.completedHoldObserved === true;

  const shortFactsReady =
    direction === "SHORT" &&
    (
      candidate?.rejectionFacts
        ?.completedRejectionObserved === true ||
      candidate?.failedAcceptanceFacts
        ?.completedFailedAcceptanceObserved === true ||
      candidate?.failedReclaimFacts
        ?.failedReclaimObserved === true
    ) &&
    candidate?.postRejectionFacts?.completedHoldObserved === true;

  const directionalFactsReady =
    longFactsReady || shortFactsReady;

  /*
   * Engine 26 no longer turns Engine 3 / Engine 4 observation on and off.
   *
   * The observer pipeline stays active continuously. Candidate evaluation
   * authorization is a separate context-valid contract.
   *
   * A valid active Strategy 1 candidate remains authorized even after price
   * leaves activation range. This is required so:
   *
   * SHORT -> BELOW_ZONE can still publish LOST_LEVEL / FAILED_RECLAIM.
   * LONG  -> ABOVE_ZONE can still publish BREAKOUT_HOLDING / RECLAIMED_LEVEL.
   *
   * Activation range and directionalFactsReady remain diagnostics only.
   */
  const lifecycleStatus =
    String(
      candidate?.zoneMemorySummary
        ?.lifecycleStatus ||
      candidate?.status ||
      ""
    )
      .trim()
      .toUpperCase();

  const terminalLifecycle =
    candidate?.invalidationFacts
      ?.completedCloseInvalidationConfirmed === true ||
    candidate?.invalidatedAt != null ||
    lifecycleStatus === "INVALIDATED" ||
    lifecycleStatus === "RETIRED" ||
    lifecycleStatus === "EXPIRED" ||
    lifecycleStatus === "CANCELLED" ||
    lifecycleStatus === "COMPLETED";

  const candidateIdentityValid =
    candidate?.candidateId != null &&
    candidate?.zoneId != null &&
    candidate?.laneId === "minute" &&
    candidate?.strategyId != null;

  const strategyContextValid =
    candidate?.strategyEligibility
      ?.eligible === true;

  const evaluationContextValid =
    candidateIdentityValid &&
    strategyContextValid &&
    candidateActive &&
    terminalLifecycle !== true;

  const evaluationAuthorized =
    evaluationContextValid;

  const status =
    terminalLifecycle
      ? "OBSERVING_TERMINAL_CANDIDATE"
      : evaluationAuthorized &&
        contactArmed
      ? "NEUTRAL_CONTACT_WATCH"
      : evaluationAuthorized &&
        ["LONG", "SHORT"].includes(direction)
      ? "ACTIVE_DIRECTIONAL_EVALUATION"
      : evaluationAuthorized
      ? "OBSERVING_ACTIVE_CANDIDATE"
      : candidateIdentityValid
      ? "OBSERVING_INACTIVE_CANDIDATE_CONTEXT"
      : "OBSERVING_WITHOUT_LOCATION_CONTEXT";

  return {
    /*
     * Observer availability is continuous.
     * Permission/qualification is still controlled downstream.
     */
    active: true,
    armed: true,
    observerActive: true,
    evaluationContextValid,
    chainArmed:
      candidate?.chainArmed === true,

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

    direction:
      candidate.directionBias,

    preferredDirection:
      candidate.preferredDirection ??
      candidate.directionBias,

    contactState:
      candidate.contactState ?? null,
    expectedReversalDirection:
      candidate.expectedReversalDirection ?? null,
    priorCandidateId:
      candidate.priorCandidateId ?? null,
    priorZoneId:
      candidate.priorZoneId ?? null,
    priorRotationDirection:
      candidate.priorRotationDirection ?? null,
    priorRotationCompletionState:
      candidate.priorRotationCompletionState ?? null,
    priorRotationFullyComplete:
      candidate.priorRotationFullyComplete === true,
    remainingRunnerExpected:
      candidate.remainingRunnerExpected ?? null,
    completionBoundary:
      candidate.completionBoundary ?? null,
    completedTargetZoneId:
      candidate.completedTargetZoneId ?? null,
    completedTargetZone:
      candidate.completedTargetZone ?? null,
    promotionReason:
      candidate.promotionReason ?? null,
    promotedFromTargetCompletion:
      candidate.promotedFromTargetCompletion === true,
    directionalResolved:
      candidate.directionalResolved === true,
    reactionConfirmed: false,
    automaticDirectionFlip: false,

    directionState:
      candidate.directionState ??
      "OBSERVING_ZONE_REACTION",

    directionResolvedAt:
      candidate.directionResolvedAt ?? null,

    candidateLifecycleStartTime:
      candidate.candidateLifecycleStartTime ?? null,

    directionalEvidence:
      candidate.directionalEvidence ?? null,

    ema10Posture:
      candidate.ema10Posture ?? null,

    expectedDirection:
      contactArmed ? null : candidate.directionBias,

    expectedReactionDirection:
      contactArmed
        ? candidate?.expectedReversalDirection ??
          null
        : candidate.directionBias,

    expectedParticipationDirection:
      contactArmed
        ? candidate?.expectedReversalDirection ??
          null
        : candidate?.expectedParticipationDirection ??
          candidate.directionBias,

    reactionExpected:
      contactArmed
        ? Boolean(
            candidate?.expectedReversalDirection
          )
        : directionalFactsReady,

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
    rejectionFacts: candidate.rejectionFacts ?? null,
    upperWickFacts: candidate.upperWickFacts ?? null,
    failedAcceptanceFacts:
      candidate.failedAcceptanceFacts ?? null,
    failedReclaimFacts:
      candidate.failedReclaimFacts ?? null,
    postRejectionFacts:
      candidate.postRejectionFacts ?? null,
    lifecycleFacts: candidate.lifecycleFacts ?? null,
    invalidationFacts: candidate.invalidationFacts ?? null,
    zoneMemorySummary: candidate.zoneMemorySummary ?? null,

    expectedReactions:
      candidate.expectedReactions || [],

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

    withinActivationRange,
    directionalFactsReady,
    candidateActive,
    candidateIdentityValid,
    strategyContextValid,
    terminalLifecycle,

    authorizeEngine3Evaluation:
      evaluationAuthorized,

    sourceRefs:
      candidate.sourceRefs || [],

    reasonCodes: [
      "ENGINE26_REACTION_OBSERVER_ALWAYS_ACTIVE",

      evaluationAuthorized
        ? "ENGINE26_REACTION_CONTEXT_AUTHORIZED"
        : "ENGINE26_REACTION_CONTEXT_NOT_AUTHORIZED",

      evaluationAuthorized &&
      !withinActivationRange
        ? "ENGINE26_DIRECTIONAL_EVALUATION_PRESERVED_OUTSIDE_ACTIVATION_RANGE"
        : null,

      contactArmed
        ? "ENGINE26_PROMOTED_CONTACT_NEUTRAL_HANDOFF"
        : null,

      terminalLifecycle
        ? "ENGINE26_TERMINAL_LIFECYCLE_CONTEXT_NOT_AUTHORIZED"
        : null,

      !candidateActive
        ? "ENGINE26_CANDIDATE_NOT_ACTIVE_CONTEXT_NOT_AUTHORIZED"
        : null,

      !strategyContextValid
        ? "ENGINE26_STRATEGY1_CONTEXT_NOT_ELIGIBLE"
        : null,

      "ENGINE26A_EXPECTATION_ONLY",

      "ENGINE3_MUST_PUBLISH_OBSERVED_REACTION",
    ].filter(Boolean),

    noPermissionCreated: true,
    noExecution: true,
  };
}

export function buildEngine26A(
  input = {}
) {
  const generalParentCandidate =
    buildEngine26LocationCandidate({
      ...input,
      selectionPurpose:
        "GENERAL_PARENT",

      // General context must not update Strategy 1 child memory.
      persistMemory: false,
    });

  const engine26GeneralLocation =
    generalParentCandidate?.location
      ? {
          active:
            generalParentCandidate.active === true,

          engine:
            "engine26.generalLocation.v1",

          symbol:
            generalParentCandidate.symbol ?? null,

          strategyId:
            generalParentCandidate.strategyId ?? null,

          timeframe:
            generalParentCandidate.timeframe ?? null,

          status:
            generalParentCandidate.status ?? null,

          currentPrice:
            generalParentCandidate.currentPrice ?? null,

          directionBias:
            generalParentCandidate.directionBias ?? null,

          location: {
            ...generalParentCandidate.location,
          },

          reasonCodes: [
            "ENGINE26A_GENERAL_PARENT_LOCATION",
            ...(Array.isArray(
              generalParentCandidate.reasonCodes
            )
              ? generalParentCandidate.reasonCodes
              : []),
          ],

          noPermissionCreated: true,
          noExecution: true,
        }
      : null;

  const engine26LocationCandidate =
    buildEngine26LocationCandidate({
      ...input,
      selectionPurpose:
        "STRATEGY1_CHILD",
    });

  const engine26ReactionHandoff =
    buildEngine26ReactionHandoff({
      locationCandidate:
        engine26LocationCandidate,

      snapshotTime:
        input.snapshotTime,
    });

  const geometryContactArmed =
    engine26LocationCandidate?.active === true &&
    engine26LocationCandidate?.contactState ===
      "NEGOTIATED_LINE_CONTACT" &&
    engine26LocationCandidate?.chainArmed === true;

  const engine26GeometryHandoff = {
    active:
      geometryContactArmed ||
      (
        engine26LocationCandidate?.active === true &&
        engine26LocationCandidate?.strategyEligibility?.eligible === true &&
        ["LONG", "SHORT"].includes(
          engine26LocationCandidate?.directionBias
        )
      ),
    armed:
      geometryContactArmed ||
      ["LONG", "SHORT"].includes(
        engine26LocationCandidate?.directionBias
      ),
    engine: "engine26.geometryHandoff.v1",
    laneId: "minute",
    symbol: engine26LocationCandidate?.symbol ?? null,
    strategyId: engine26LocationCandidate?.strategyId ?? null,
    candidateId: engine26LocationCandidate?.candidateId ?? null,
    zoneId: engine26LocationCandidate?.zoneId ?? null,
    direction:
      engine26LocationCandidate?.directionBias ?? null,
    directionState:
      engine26LocationCandidate?.directionState ?? null,
    contactState:
      engine26LocationCandidate?.contactState ?? null,
    chainArmed:
      engine26LocationCandidate?.chainArmed === true,
    expectedDirection: null,
    expectedReactionDirection:
      engine26LocationCandidate
        ?.expectedReactionDirection ?? null,
    expectedReversalDirection:
      engine26LocationCandidate
        ?.expectedReversalDirection ?? null,
    expectedParticipationDirection:
      engine26LocationCandidate
        ?.expectedParticipationDirection ?? null,
    expectedReactions:
      engine26LocationCandidate
        ?.expectedReactions || [],
    reactionExpected:
      engine26LocationCandidate
        ?.reactionExpected === true,
    priorCandidateId:
      engine26LocationCandidate?.priorCandidateId ?? null,
    priorZoneId:
      engine26LocationCandidate?.priorZoneId ?? null,
    priorRotationDirection:
      engine26LocationCandidate
        ?.priorRotationDirection ?? null,
    priorRotationCompletionState:
      engine26LocationCandidate
        ?.priorRotationCompletionState ?? null,
    priorRotationFullyComplete:
      engine26LocationCandidate
        ?.priorRotationFullyComplete === true,
    remainingRunnerExpected:
      engine26LocationCandidate
        ?.remainingRunnerExpected ?? null,
    completionBoundary:
      engine26LocationCandidate
        ?.completionBoundary ?? null,
    completedTargetZoneId:
      engine26LocationCandidate
        ?.completedTargetZoneId ?? null,
    completedTargetZone:
      engine26LocationCandidate
        ?.completedTargetZone ?? null,
    promotionReason:
      engine26LocationCandidate
        ?.promotionReason ?? null,
    promotedFromTargetCompletion:
      engine26LocationCandidate
        ?.promotedFromTargetCompletion === true,
    directionalResolved:
      engine26LocationCandidate?.directionalResolved === true,
    geometryReady: false,
    geometryFeasible: false,
    status:
      engine26LocationCandidate?.contactState ===
        "NEGOTIATED_LINE_CONTACT"
        ? "WAITING_FOR_DIRECTIONAL_RESOLUTION"
        : null,
    directionResolvedAt:
      engine26LocationCandidate?.directionResolvedAt ?? null,
    candidateLifecycleStartTime:
      engine26LocationCandidate
        ?.candidateLifecycleStartTime ?? null,
    directionalEvidence:
      engine26LocationCandidate?.directionalEvidence ?? null,
    ema10Posture:
      engine26LocationCandidate?.ema10Posture ?? null,
    setupClass: engine26LocationCandidate?.setupClass ?? null,
    setupGrade: engine26LocationCandidate?.setupGrade ?? null,
    identitySetupKey:
      engine26LocationCandidate?.identitySetupKey ?? null,
    candidateIdentityVersion:
      engine26LocationCandidate?.candidateIdentityVersion ?? null,
    entryZone: engine26LocationCandidate?.entryZone ?? null,
    targetZone: engine26LocationCandidate?.targetZone ?? null,
    sweepFacts: engine26LocationCandidate?.sweepFacts ?? null,
    reclaimFacts: engine26LocationCandidate?.reclaimFacts ?? null,
    rejectionFacts: engine26LocationCandidate?.rejectionFacts ?? null,
    failedAcceptanceFacts:
      engine26LocationCandidate?.failedAcceptanceFacts ?? null,
    failedReclaimFacts:
      engine26LocationCandidate?.failedReclaimFacts ?? null,
    lifecycleFacts: engine26LocationCandidate?.lifecycleFacts ?? null,
    locationInvalidationBoundary:
      engine26LocationCandidate?.locationInvalidationBoundary ?? null,
    snapshotTime: engine26LocationCandidate?.snapshotTime ?? null,
    noPermissionCreated: true,
    noExecution: true,
    reasonCodes:
      engine26LocationCandidate?.contactState ===
        "NEGOTIATED_LINE_CONTACT"
        ? [
            "ENGINE26_STRATEGY1_GEOMETRY_HANDOFF_AVAILABLE",
            "ENGINE26_NEGOTIATED_LINE_CONTACT",
            "ENGINE26_CHAIN_ARMED",
            "WAITING_FOR_DIRECTIONAL_RESOLUTION",
            "NO_AUTOMATIC_SHORT",
          ]
        : engine26LocationCandidate?.strategyEligibility?.eligible === true
        ? ["ENGINE26_STRATEGY1_GEOMETRY_HANDOFF_AVAILABLE"]
        : ["ENGINE26_STRATEGY1_GEOMETRY_HANDOFF_UNAVAILABLE"],
  };

  return {
    engine26GeneralLocation,
    engine26LocationCandidate,
    engine26ReactionHandoff,
    engine26GeometryHandoff,
  };
}

export default buildEngine26A;
