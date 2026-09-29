// services/core/logic/engine29/trapDetection/detectTrapAuctionEvent.js
// Engine 29 — macro liquidity auction-event detector.
//
// Purpose:
// - Observe whether ES is testing, sweeping, and failing acceptance at a
//   meaningful macro/institutional liquidity level.
// - 10m = immediate event observation.
// - 30m = completed-bar acceptance authority.
// - 1H = slower rejection context.
// - No trade permission or execution authority.

import {
  ENGINE29_AUCTION_RESULTS,
  ENGINE29_LIQUIDITY_EVENT_STATES,
  ENGINE29_TRAP_SIDES,
} from "./trapConstants.js";
import {
  ENGINE29_MOVE_CHARACTER_DEFAULTS,
} from "../tacticalCharacter/moveCharacterConstants.js";
import {
  medianBarRangePct,
} from "../tacticalCharacter/tacticalCharacterUtils.js";

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sortBars(bars = []) {
  return (Array.isArray(bars) ? bars : [])
    .filter((bar) =>
      Number.isFinite(finite(bar?.time)) &&
      Number.isFinite(finite(bar?.open)) &&
      Number.isFinite(finite(bar?.high)) &&
      Number.isFinite(finite(bar?.low)) &&
      Number.isFinite(finite(bar?.close))
    )
    .slice()
    .sort((a, b) => Number(a.time) - Number(b.time));
}

function completedBars(bars = [], durationMs, now = Date.now()) {
  return sortBars(bars).filter(
    (bar) => Number(bar.time) + durationMs <= Number(now)
  );
}

function rangeBoundary(level, side) {
  if (!level) return null;

  if (side === "HIGH") {
    return finite(level.hi ?? level.level);
  }

  if (side === "LOW") {
    return finite(level.lo ?? level.level);
  }

  return finite(level.level);
}

function levelSide(level, bar) {
  if (!level || !bar) return null;

  if (level.side === "HIGH" || level.side === "LOW") {
    return level.side;
  }

  const lo = finite(level.lo);
  const hi = finite(level.hi);
  const high = finite(bar.high);
  const low = finite(bar.low);

  if (![lo, hi, high, low].every(Number.isFinite)) return null;

  const above = high > hi;
  const below = low < lo;

  if (above && !below) return "HIGH";
  if (below && !above) return "LOW";

  return null;
}

function closeLocationPct(bar) {
  const high = finite(bar?.high);
  const low = finite(bar?.low);
  const close = finite(bar?.close);

  if (![high, low, close].every(Number.isFinite) || high <= low) {
    return null;
  }

  return ((close - low) / (high - low)) * 100;
}

function excursionPoints(bar, boundary, side) {
  if (!bar || !Number.isFinite(boundary)) return null;

  if (side === "HIGH") {
    const high = finite(bar.high);
    return Number.isFinite(high) ? Math.max(0, high - boundary) : null;
  }

  if (side === "LOW") {
    const low = finite(bar.low);
    return Number.isFinite(low) ? Math.max(0, boundary - low) : null;
  }

  return null;
}

function rejectionDistancePoints(bar, boundary, side) {
  const close = finite(bar?.close);

  if (!Number.isFinite(close) || !Number.isFinite(boundary)) {
    return null;
  }

  if (side === "HIGH") {
    return Math.max(0, boundary - close);
  }

  if (side === "LOW") {
    return Math.max(0, close - boundary);
  }

  return null;
}

function tested(bar, level, side) {
  if (!bar || !level) return false;

  const boundary = rangeBoundary(level, side);

  if (!Number.isFinite(boundary)) return false;

  const high = finite(bar.high);
  const low = finite(bar.low);

  if (![high, low].every(Number.isFinite)) return false;

  // A current liquidity test must actually interact with the boundary.
  // A bar already fully beyond the level is acceptance/travel, not a new test.
  if (side === "HIGH") {
    return high >= boundary && low <= boundary;
  }

  if (side === "LOW") {
    return low <= boundary && high >= boundary;
  }

  return false;
}

function excursionPct(boundary, extreme) {
  if (
    !Number.isFinite(boundary) ||
    !Number.isFinite(extreme) ||
    boundary === 0
  ) {
    return null;
  }

  return (
    Math.abs(extreme - boundary) /
    Math.abs(boundary)
  ) * 100;
}

function sweepThresholdPct(
  fastTacticalView,
  options = {}
) {
  const baselineRange =
    medianBarRangePct(fastTacticalView);

  return Math.max(
    options.minSweepExcursionPct ??
      ENGINE29_MOVE_CHARACTER_DEFAULTS
        .minSweepExcursionPct,
    Number.isFinite(baselineRange)
      ? baselineRange *
        (
          options.sweepRangeFraction ??
          ENGINE29_MOVE_CHARACTER_DEFAULTS
            .sweepRangeFraction
        )
      : 0
  );
}

function swept(
  bar,
  level,
  side,
  thresholdPct = 0
) {
  if (!bar || !level) return false;

  const boundary = rangeBoundary(level, side);

  if (!Number.isFinite(boundary)) return false;

  const extreme =
    side === "HIGH"
      ? finite(bar.high)
      : finite(bar.low);

  const excursion =
    excursionPct(boundary, extreme);

  if (
    !Number.isFinite(excursion) ||
    excursion < thresholdPct
  ) {
    return false;
  }

  const high = finite(bar.high);
  const low = finite(bar.low);

  if (![high, low].every(Number.isFinite)) return false;

  // A sweep must cross through the boundary during this bar.
  // Bars entirely above/below an old level are acceptance/travel, not sweeps.
  if (side === "HIGH") {
    return extreme > boundary && low <= boundary;
  }

  if (side === "LOW") {
    return extreme < boundary && high >= boundary;
  }

  return false;
}

function failedHold(bar, level, side) {
  if (!bar || !level) return false;

  const boundary = rangeBoundary(level, side);
  const close = finite(bar.close);

  if (![boundary, close].every(Number.isFinite)) return false;

  if (side === "HIGH") {
    return close <= boundary;
  }

  if (side === "LOW") {
    return close >= boundary;
  }

  return false;
}

function acceptedBeyond(bar, level, side) {
  if (!bar || !level) return false;

  const boundary = rangeBoundary(level, side);
  const close = finite(bar.close);

  if (![boundary, close].every(Number.isFinite)) return false;

  if (side === "HIGH") {
    return close > boundary;
  }

  if (side === "LOW") {
    return close < boundary;
  }

  return false;
}

function chooseCandidate(levels = [], bar) {
  const testedLevels = [];

  for (const level of Array.isArray(levels) ? levels : []) {
    if (level?.eventEligible === false) continue;

    const side = levelSide(level, bar);
    if (!side) continue;

    const boundary = rangeBoundary(level, side);
    if (!Number.isFinite(boundary)) continue;

    const isTested = tested(bar, level, side);
    if (!isTested) continue;

    const distance = side === "HIGH"
      ? Math.abs(finite(bar.high) - boundary)
      : Math.abs(boundary - finite(bar.low));

    testedLevels.push({
      level,
      side,
      boundary,
      distance,
    });
  }

  testedLevels.sort((a, b) => a.distance - b.distance);
  return testedLevels[0] || null;
}

function priorAcceptedThenLost(bars, level, side) {
  if (!Array.isArray(bars) || bars.length < 2) return false;

  const prior = bars.at(-2);
  const latest = bars.at(-1);

  return (
    acceptedBeyond(prior, level, side) &&
    failedHold(latest, level, side)
  );
}

function buildNoEvent(currentPrice = null) {
  return {
    version: "engine29.trapAuctionEvent.v2.threeLane",
    trapSide: ENGINE29_TRAP_SIDES.NONE,
    currentPrice,
    liquidityEvent: {
      state: ENGINE29_LIQUIDITY_EVENT_STATES.NO_LIQUIDITY_EVENT,
      side: null,
    },
    auctionResult: ENGINE29_AUCTION_RESULTS.NO_ACTIVE_AUCTION,
    liquidityLevel: null,
    immediate10m: null,
    acceptance30m: null,
    context1h: null,
    sweep: null,
    reclaimObserved: false,
    failedAcceptance: false,
    reasonCodes: [],
  };
}

export function detectEngine29TrapAuctionEvent({
  macroLiquidityMap = null,
  esAnchor = null,
  now = Date.now(),
} = {}) {
  const live10m = sortBars(esAnchor?.liveMonitor?.bars);
  const bars30m = completedBars(
    esAnchor?.structure?.fastTactical?.bars,
    30 * 60 * 1000,
    now
  );
  const bars1h = completedBars(
    esAnchor?.structure?.tactical?.bars,
    60 * 60 * 1000,
    now
  );

  const liveBar = live10m.at(-1) || null;
  const completed30m = bars30m.at(-1) || null;
  const completed1h = bars1h.at(-1) || null;

  const sweepThreshold =
    sweepThresholdPct(
      esAnchor?.structure?.fastTactical
    );

  const currentPrice =
    finite(liveBar?.close) ??
    finite(completed30m?.close) ??
    finite(completed1h?.close);

  if (!liveBar || !macroLiquidityMap?.levels?.length) {
    return buildNoEvent(currentPrice);
  }

  const candidate = chooseCandidate(
    macroLiquidityMap.levels,
    liveBar
  );

  if (!candidate) {
    return buildNoEvent(currentPrice);
  }

  const { level, side, boundary } = candidate;

  const liveTested = tested(liveBar, level, side);
  const liveSwept = swept(
    liveBar,
    level,
    side,
    sweepThreshold
  );
  const liveFailedHold = liveSwept && failedHold(liveBar, level, side);

  const thirtyMinuteSwept = completed30m
    ? swept(
        completed30m,
        level,
        side,
        sweepThreshold
      )
    : false;

  const thirtyMinuteFailedHold = completed30m
    ? thirtyMinuteSwept && failedHold(completed30m, level, side)
    : false;

  const priorAcceptanceFailure =
    priorAcceptedThenLost(bars30m, level, side);

  const failedAcceptance =
    thirtyMinuteFailedHold ||
    priorAcceptanceFailure;

  const reclaimObserved =
    liveFailedHold ||
    failedAcceptance;

  const trapSide =
    reclaimObserved
      ? side === "HIGH"
        ? ENGINE29_TRAP_SIDES.BULL
        : ENGINE29_TRAP_SIDES.BEAR
      : ENGINE29_TRAP_SIDES.NONE;

  let liquidityEventState =
    side === "HIGH"
      ? ENGINE29_LIQUIDITY_EVENT_STATES.TEST_HIGH
      : ENGINE29_LIQUIDITY_EVENT_STATES.TEST_LOW;

  if (liveSwept || thirtyMinuteSwept) {
    liquidityEventState =
      side === "HIGH"
        ? ENGINE29_LIQUIDITY_EVENT_STATES.SWEEP_HIGH
        : ENGINE29_LIQUIDITY_EVENT_STATES.SWEEP_LOW;
  }

  if (reclaimObserved) {
    liquidityEventState =
      side === "HIGH"
        ? ENGINE29_LIQUIDITY_EVENT_STATES.RECLAIMED_HIGH
        : ENGINE29_LIQUIDITY_EVENT_STATES.RECLAIMED_LOW;
  }

  let auctionResult =
    side === "HIGH"
      ? ENGINE29_AUCTION_RESULTS.TESTING_HIGH
      : ENGINE29_AUCTION_RESULTS.TESTING_LOW;

  if (liveSwept || thirtyMinuteSwept) {
    auctionResult =
      side === "HIGH"
        ? ENGINE29_AUCTION_RESULTS.SWEPT_HIGH
        : ENGINE29_AUCTION_RESULTS.SWEPT_LOW;
  }

  if (failedAcceptance) {
    auctionResult =
      side === "HIGH"
        ? ENGINE29_AUCTION_RESULTS.FAILED_ACCEPTANCE_HIGH
        : ENGINE29_AUCTION_RESULTS.FAILED_ACCEPTANCE_LOW;
  } else if (thirtyMinuteSwept && completed30m) {
    auctionResult =
      side === "HIGH"
        ? acceptedBeyond(completed30m, level, side)
          ? ENGINE29_AUCTION_RESULTS.ACCEPTING_ABOVE
          : auctionResult
        : acceptedBeyond(completed30m, level, side)
          ? ENGINE29_AUCTION_RESULTS.ACCEPTING_BELOW
          : auctionResult;
  }

  const sweepBar =
    thirtyMinuteSwept
      ? completed30m
      : liveSwept
        ? liveBar
        : null;

  const reasonCodes = [
    side === "HIGH"
      ? "MACRO_HIGH_LIQUIDITY_TEST"
      : "MACRO_LOW_LIQUIDITY_TEST",
  ];

  if (liveSwept || thirtyMinuteSwept) {
    reasonCodes.push(
      side === "HIGH"
        ? "MACRO_HIGH_LIQUIDITY_SWEPT"
        : "MACRO_LOW_LIQUIDITY_SWEPT"
    );
  }

  if (liveFailedHold) {
    reasonCodes.push("LIVE_10M_FAILED_HOLD");
  }

  if (thirtyMinuteFailedHold) {
    reasonCodes.push("COMPLETED_30M_FAILED_HOLD");
  }

  if (priorAcceptanceFailure) {
    reasonCodes.push("PRIOR_30M_ACCEPTANCE_LOST");
  }

  return {
    version: "engine29.trapAuctionEvent.v2.threeLane",
    trapSide,
    currentPrice,

    liquidityEvent: {
      state: liquidityEventState,
      side,
      tested: liveTested,
      swept:
        liveSwept || thirtyMinuteSwept,
      reclaimed: reclaimObserved,
      sweepThresholdPct: sweepThreshold,
      significance:
        level.significance ?? null,
      eventEligible:
        level.eventEligible !== false,
    },

    auctionResult,

    liquidityLevel: {
      id: level.id ?? null,
      type: level.type ?? null,
      timeframe: level.timeframe ?? null,
      source: level.source ?? null,
      side,
      boundary,
      lo: finite(level.lo),
      hi: finite(level.hi),
      level: finite(level.level),
      distancePointsAtObservation: candidate.distance,
      sweepThresholdPct: sweepThreshold,
      significance:
        level.significance ?? null,
      eventEligible:
        level.eventEligible !== false,
      macroExtreme:
        level.macroExtreme === true,
      confluenceCount:
        Number.isFinite(Number(level.confluenceCount))
          ? Number(level.confluenceCount)
          : null,
    },

    immediate10m: {
      time: liveBar.time ?? null,
      open: finite(liveBar.open),
      high: finite(liveBar.high),
      low: finite(liveBar.low),
      close: finite(liveBar.close),
      tested: liveTested,
      swept: liveSwept,
      failedHold: liveFailedHold,
      closeLocationPct: closeLocationPct(liveBar),
    },

    acceptance30m: completed30m
      ? {
          time: completed30m.time ?? null,
          open: finite(completed30m.open),
          high: finite(completed30m.high),
          low: finite(completed30m.low),
          close: finite(completed30m.close),
          swept: thirtyMinuteSwept,
          failedHold: thirtyMinuteFailedHold,
          priorAcceptanceFailure,
          closeLocationPct: closeLocationPct(completed30m),
        }
      : null,

    context1h: completed1h
      ? {
          time: completed1h.time ?? null,
          open: finite(completed1h.open),
          high: finite(completed1h.high),
          low: finite(completed1h.low),
          close: finite(completed1h.close),
          closeLocationPct: closeLocationPct(completed1h),
        }
      : null,

    sweep: sweepBar
      ? {
          time: sweepBar.time ?? null,
          extreme:
            side === "HIGH"
              ? finite(sweepBar.high)
              : finite(sweepBar.low),
          excursionPoints:
            excursionPoints(sweepBar, boundary, side),
          rejectionDistancePoints:
            rejectionDistancePoints(sweepBar, boundary, side),
          closeLocationPct:
            closeLocationPct(sweepBar),
        }
      : null,

    reclaimObserved,
    failedAcceptance,
    reasonCodes: [...new Set(reasonCodes)],
  };
}

export default detectEngine29TrapAuctionEvent;
