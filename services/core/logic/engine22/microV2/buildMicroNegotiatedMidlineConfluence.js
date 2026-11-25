// Engine 22/26 Strategy 1 — Micro + negotiated-midline confluence.
//
// Read-only quality classifier.
// It recognizes when an active Micro wave (W1-W5) is interacting with the
// canonical Engine 26 negotiated-zone midpoint.
//
// IMPORTANT:
// - does not mutate Engine 26 setupGrade / identity
// - does not create permission
// - does not size or execute
// - does not change Engine 22 lifecycle
//
// User-facing intent:
// "A++ TRADING HAPPENING" when Micro structure is active near/touching the
// negotiated midpoint, because that is a high-value confluence location.

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function toMs(value) {
  if (value == null || value === "") return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric > 1e12 ? numeric : numeric * 1000;
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function barTimeMs(bar) {
  return toMs(
    bar?.time ??
    bar?.t ??
    bar?.tSec ??
    null
  );
}

function normalizedCompletedBars(bars = []) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar, index, source) => {
      const high = num(bar?.high ?? bar?.h);
      const low = num(bar?.low ?? bar?.l);

      if (high == null || low == null) return null;

      const completed =
        bar?.completed === true ||
        (
          bar?.completed !== false &&
          index < source.length - 1
        );

      if (!completed) return null;

      return {
        time:
          bar?.time ??
          bar?.t ??
          bar?.tSec ??
          null,
        timeMs:
          barTimeMs(bar),
        high,
        low,
        close:
          num(bar?.close ?? bar?.c),
      };
    })
    .filter(Boolean)
    .sort((a, b) =>
      (a.timeMs ?? 0) -
      (b.timeMs ?? 0)
    );
}

function activeMicroWave(micro) {
  const wave =
    upper(micro?.activeWave);

  return ["W1", "W2", "W3", "W4", "W5"].includes(wave)
    ? wave
    : null;
}

function waveDirectionToTradeDirection(value) {
  const direction =
    upper(value);

  if (direction === "UP") return "LONG";
  if (direction === "DOWN") return "SHORT";

  return null;
}

export function buildMicroNegotiatedMidlineConfluence({
  engine22WaveStrategy = null,
  engine26LocationCandidate = null,
  bars10m = [],
  currentPrice = null,
  tickSize = 0.25,
} = {}) {
  const micro =
    engine22WaveStrategy
      ?.microExecutionContext ||
    null;

  const candidate =
    engine26LocationCandidate &&
    typeof engine26LocationCandidate === "object"
      ? engine26LocationCandidate
      : null;

  const midline =
    num(
      candidate?.entryZone?.midline ??
      candidate?.entryZone?.mid ??
      candidate?.entryZoneMidline
    );

  const zoneLow =
    num(
      candidate?.entryZone?.low ??
      candidate?.entryZone?.lo
    );

  const zoneHigh =
    num(
      candidate?.entryZone?.high ??
      candidate?.entryZone?.hi
    );

  const price =
    num(
      currentPrice ??
      candidate?.currentPrice
    );

  const wave =
    activeMicroWave(micro);

  const microUsable =
    micro != null &&
    micro.available !== false &&
    wave != null &&
    ![
      "INVALIDATED",
      "RECOUNT_REQUIRED",
    ].includes(
      upper(micro?.microTimingState)
    ) &&
    ![
      "INVALIDATED",
      "RECOUNT_REQUIRED",
      "HISTORICAL",
    ].includes(
      upper(micro?.countStatus)
    );

  const negotiatedCandidate =
    candidate != null &&
    candidate?.strategyEligibility?.eligible === true &&
    upper(candidate?.location?.type) === "NEGOTIATED" &&
    midline != null;

  if (!microUsable || !negotiatedCandidate) {
    return {
      active: false,
      engine:
        "engine22.microNegotiatedMidlineConfluence.v1",
      mode: "READ_ONLY",
      quality: "NONE",
      displayLabel: null,
      sourceCountId:
        micro?.sourceCountId ?? null,
      activeWave:
        wave,
      negotiatedMidline:
        midline,
      noPermissionCreated: true,
      noExecution: true,
      reasonCodes: [
        !microUsable
          ? "MICRO_STRUCTURE_NOT_USABLE"
          : null,
        !negotiatedCandidate
          ? "NEGOTIATED_LOCATION_NOT_AVAILABLE"
          : null,
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ].filter(Boolean),
    };
  }

  const tick =
    Math.max(
      num(tickSize) ?? 0.25,
      0.01
    );

  /*
   * "Near" uses the already-canonical Engine 26 activation distance when
   * published. This avoids inventing a second proximity threshold.
   *
   * Exact contact remains stricter:
   * - current price within one tick of midpoint, OR
   * - a completed 10m candle range traded through the midpoint.
   */
  const activationRange =
    Math.max(
      num(
        candidate?.activationRangePoints
      ) ?? 0,
      tick
    );

  const distanceToMidline =
    price == null
      ? null
      : Math.abs(
          price - midline
        );

  const currentlyNearMidline =
    distanceToMidline != null &&
    distanceToMidline <= activationRange;

  const currentExactContact =
    distanceToMidline != null &&
    distanceToMidline <= tick;

  const lifecycleStartMs =
    toMs(
      candidate?.candidateLifecycleStartTime ??
      candidate?.snapshotTime
    );

  const completedBars =
    normalizedCompletedBars(
      bars10m
    );

  const eligibleBars =
    lifecycleStartMs == null
      ? completedBars
      : completedBars.filter(
          (bar) =>
            bar.timeMs == null ||
            bar.timeMs >= lifecycleStartMs
        );

  const midlineTouchBar =
    [...eligibleBars]
      .reverse()
      .find(
        (bar) =>
          bar.low <= midline &&
          bar.high >= midline
      ) ||
    null;

  const completedMidlineTouch =
    midlineTouchBar != null;

  const midlineContactObserved =
    currentExactContact ||
    completedMidlineTouch;

  const microDirection =
    waveDirectionToTradeDirection(
      micro?.waveDirection
    );

  const candidateDirection =
    upper(
      candidate?.currentObservationDirection ??
      candidate?.direction ??
      candidate?.directionBias
    );

  const directionAligned =
    microDirection == null ||
    !["LONG", "SHORT"].includes(candidateDirection)
      ? null
      : microDirection === candidateDirection;

  const transitionState =
    upper(
      micro?.microTimingState
    );

  const transitionActive =
    [
      "SETUP_DEVELOPING",
      "REVERSAL_WINDOW",
      "TRANSITION_CONFIRMING",
      "TIMING_READY",
    ].includes(
      transitionState
    );

  /*
   * A++ confluence is a LOCATION + MICRO STRUCTURE label, not trade permission.
   * It becomes active when:
   * - a valid active Micro wave exists,
   * - the canonical negotiated midpoint is near/touched,
   * - and Micro is in an actionable structural timing phase.
   */
  const a2Active =
    transitionActive &&
    (
      currentlyNearMidline ||
      midlineContactObserved
    );

  return {
    active: a2Active,

    engine:
      "engine22.microNegotiatedMidlineConfluence.v1",

    mode:
      "READ_ONLY",

    quality:
      a2Active
        ? "A++"
        : "WATCH",

    displayLabel:
      a2Active
        ? "A++ TRADING HAPPENING"
        : "MICRO / NEGOTIATED MIDLINE WATCH",

    setupFamily:
      "MICRO_NEGOTIATED_MIDLINE_CONFLUENCE",

    sourceCountId:
      micro?.sourceCountId ??
      null,

    canonicalStateVersion:
      micro?.canonicalStateVersion ??
      null,

    activeWave:
      wave,

    microWaveDirection:
      micro?.waveDirection ??
      null,

    microTradeDirection:
      microDirection,

    microTimingState:
      micro?.microTimingState ??
      null,

    negotiatedZone: {
      low: zoneLow,
      midline,
      high: zoneHigh,
      zoneId:
        candidate?.zoneId ?? null,
      candidateId:
        candidate?.candidateId ?? null,
    },

    currentPrice:
      price,

    distanceToMidline:
      distanceToMidline == null
        ? null
        : Number(
            distanceToMidline.toFixed(2)
          ),

    activationRangePoints:
      activationRange,

    currentlyNearMidline,

    currentExactContact,

    completedMidlineTouch,

    latestCompletedMidlineTouch:
      midlineTouchBar
        ? {
            time:
              midlineTouchBar.time,
            high:
              midlineTouchBar.high,
            low:
              midlineTouchBar.low,
            close:
              midlineTouchBar.close,
          }
        : null,

    midlineContactObserved,

    directionAlignment: {
      microDirection,
      candidateDirection:
        ["LONG", "SHORT"].includes(candidateDirection)
          ? candidateDirection
          : "NEUTRAL",
      aligned:
        directionAligned,
    },

    trainingTags:
      a2Active
        ? [
            "A2_MICRO_NEGOTIATED_MIDLINE",
            `MICRO_${wave}`,
            `MICRO_TIMING_${transitionState || "UNKNOWN"}`,
            currentExactContact
              ? "CURRENT_MIDLINE_CONTACT"
              : completedMidlineTouch
              ? "COMPLETED_10M_MIDLINE_TOUCH"
              : "NEAR_MIDLINE",
          ]
        : [],

    noIdentityMutation: true,
    noSetupGradeMutation: true,
    noPermissionCreated: true,
    noSizing: true,
    noManagement: true,
    noExecution: true,
    noJournalMutation: true,

    reasonCodes: [
      "MICRO_NEGOTIATED_MIDLINE_CONFLUENCE_EVALUATED",
      a2Active
        ? "A2_MICRO_NEGOTIATED_MIDLINE_ACTIVE"
        : "A2_MICRO_NEGOTIATED_MIDLINE_NOT_ACTIVE",
      currentlyNearMidline
        ? "PRICE_NEAR_NEGOTIATED_MIDLINE"
        : null,
      currentExactContact
        ? "CURRENT_PRICE_AT_NEGOTIATED_MIDLINE"
        : null,
      completedMidlineTouch
        ? "COMPLETED_10M_BAR_TOUCHED_NEGOTIATED_MIDLINE"
        : null,
      wave
        ? `MICRO_${wave}_ACTIVE`
        : null,
      transitionActive
        ? `MICRO_TIMING_${transitionState}`
        : "MICRO_TIMING_NOT_ACTIONABLE",
      "ENGINE26_CANONICAL_SETUP_GRADE_UNCHANGED",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ].filter(Boolean),
  };
}

export default buildMicroNegotiatedMidlineConfluence;
