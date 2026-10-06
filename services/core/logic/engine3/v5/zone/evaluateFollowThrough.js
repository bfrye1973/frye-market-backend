// services/core/logic/engine3/v5/zone/evaluateFollowThrough.js
//
// Engine 3 v5 — Post-reaction follow-through evaluator.
//
// Contract:
// - Consumes normalized bars, ONE exact Engine 26 zone, contact evidence,
//   and reaction evidence.
// - Evaluates whether the apparent reaction continued, stalled, failed,
//   was erased, or produced an opposite response.
// - Produces follow-through evidence only.
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not resolve buyer/seller control.
// - Does not create permission.
// - Does not create execution.
//
// IMPORTANT:
// Follow-through is the confirmation layer for PRICE ACTION only.
// Volume confirmation remains Engine 4 ownership.
//
// Canonical direction authority remains exclusively in
// state/directionStateMachine.js.

const ENGINE = "engine3.v5.zone.evaluateFollowThrough.v1";
const SOURCE = "engine3.v5.zone.evaluateFollowThrough";

function round6(value) {
  const n = Number(value);
  return Number.isFinite(n)
    ? Number(n.toFixed(6))
    : null;
}

function isValidBar(bar) {
  return Boolean(
    bar &&
    typeof bar === "object" &&
    bar.valid === true &&
    Number.isFinite(Number(bar.open)) &&
    Number.isFinite(Number(bar.high)) &&
    Number.isFinite(Number(bar.low)) &&
    Number.isFinite(Number(bar.close))
  );
}

function isValidZone(zone) {
  return Boolean(
    zone &&
    typeof zone === "object" &&
    Number.isFinite(Number(zone.low)) &&
    Number.isFinite(Number(zone.high)) &&
    Number.isFinite(Number(zone.midline)) &&
    Number(zone.high) >= Number(zone.low)
  );
}

function relationOfClose(bar, zone) {
  if (!isValidBar(bar) || !isValidZone(zone)) {
    return "UNKNOWN";
  }

  if (bar.close > zone.high) {
    return "ABOVE_ZONE";
  }

  if (bar.close < zone.low) {
    return "BELOW_ZONE";
  }

  return "INSIDE_ZONE";
}

function countConsecutiveFromEnd(items, predicate) {
  let count = 0;

  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (predicate(items[i])) {
      count += 1;
    } else {
      break;
    }
  }

  return count;
}

function classifyFollowThrough({
  bars,
  zone,
  reaction,
} = {}) {
  const reactionState =
    String(
      reaction?.reactionState ||
      "NO_CLEAR_REACTION"
    ).toUpperCase();

  const reactionBias =
    String(
      reaction?.reactionBias ||
      "NONE"
    ).toUpperCase();

  const latest =
    bars.at(-1) ||
    null;

  const prior =
    bars.at(-2) ||
    null;

  const third =
    bars.at(-3) ||
    null;

  const latestRelation =
    relationOfClose(
      latest,
      zone
    );

  const priorRelation =
    relationOfClose(
      prior,
      zone
    );

  const latestHigherClose =
    prior != null &&
    latest.close > prior.close;

  const latestLowerClose =
    prior != null &&
    latest.close < prior.close;

  const latestHigherHigh =
    prior != null &&
    latest.high > prior.high;

  const latestLowerHigh =
    prior != null &&
    latest.high < prior.high;

  const latestHigherLow =
    prior != null &&
    latest.low > prior.low;

  const latestLowerLow =
    prior != null &&
    latest.low < prior.low;

  const secondHigherClose =
    third != null &&
    prior != null &&
    prior.close > third.close;

  const secondLowerClose =
    third != null &&
    prior != null &&
    prior.close < third.close;

  const bullishContinuationPair =
    latestHigherClose &&
    (
      latestHigherHigh ||
      latestHigherLow
    );

  const bearishContinuationPair =
    latestLowerClose &&
    (
      latestLowerLow ||
      latestLowerHigh
    );

  const twoStepUp =
    secondHigherClose &&
    latestHigherClose;

  const twoStepDown =
    secondLowerClose &&
    latestLowerClose;

  const consecutiveAbove =
    countConsecutiveFromEnd(
      bars,
      (bar) =>
        relationOfClose(
          bar,
          zone
        ) === "ABOVE_ZONE"
    );

  const consecutiveBelow =
    countConsecutiveFromEnd(
      bars,
      (bar) =>
        relationOfClose(
          bar,
          zone
        ) === "BELOW_ZONE"
    );

  const erasedUpReaction =
    reactionBias === "UP" &&
    (
      latestRelation === "BELOW_ZONE" ||
      (
        reactionState === "RECLAIM" &&
        latest.close < zone.high
      ) ||
      (
        reactionState === "REJECTION_LOW" &&
        latestLowerClose &&
        latestLowerLow
      )
    );

  const erasedDownReaction =
    reactionBias === "DOWN" &&
    (
      latestRelation === "ABOVE_ZONE" ||
      (
        reactionState === "FAILED_RECLAIM" &&
        latest.close >= zone.low
      ) ||
      (
        reactionState === "REJECTION_HIGH" &&
        latestHigherClose &&
        latestHigherHigh
      )
    );

  const oppositeResponseUp =
    reactionBias === "DOWN" &&
    bullishContinuationPair &&
    (
      latestRelation === "INSIDE_ZONE" ||
      latestRelation === "ABOVE_ZONE"
    );

  const oppositeResponseDown =
    reactionBias === "UP" &&
    bearishContinuationPair &&
    (
      latestRelation === "INSIDE_ZONE" ||
      latestRelation === "BELOW_ZONE"
    );

  if (
    reactionBias === "UP" &&
    erasedUpReaction
  ) {
    return {
      followThroughState:
        "SIGNAL_ERASED",

      followThroughBias:
        "DOWN",

      followThroughStrength:
        "STRONG_AGAINST_PRIOR_REACTION",
    };
  }

  if (
    reactionBias === "DOWN" &&
    erasedDownReaction
  ) {
    return {
      followThroughState:
        "SIGNAL_ERASED",

      followThroughBias:
        "UP",

      followThroughStrength:
        "STRONG_AGAINST_PRIOR_REACTION",
    };
  }

  if (oppositeResponseUp) {
    return {
      followThroughState:
        "OPPOSITE_RESPONSE_UP",

      followThroughBias:
        "UP",

      followThroughStrength:
        twoStepUp
          ? "STRONG"
          : "GOOD",
    };
  }

  if (oppositeResponseDown) {
    return {
      followThroughState:
        "OPPOSITE_RESPONSE_DOWN",

      followThroughBias:
        "DOWN",

      followThroughStrength:
        twoStepDown
          ? "STRONG"
          : "GOOD",
    };
  }

  if (
    reactionBias === "UP" &&
    (
      twoStepUp ||
      (
        bullishContinuationPair &&
        consecutiveAbove >= 2
      )
    )
  ) {
    return {
      followThroughState:
        "CONTINUING_UP",

      followThroughBias:
        "UP",

      followThroughStrength:
        twoStepUp &&
        consecutiveAbove >= 2
          ? "STRONG"
          : "GOOD",
    };
  }

  if (
    reactionBias === "DOWN" &&
    (
      twoStepDown ||
      (
        bearishContinuationPair &&
        consecutiveBelow >= 2
      )
    )
  ) {
    return {
      followThroughState:
        "CONTINUING_DOWN",

      followThroughBias:
        "DOWN",

      followThroughStrength:
        twoStepDown &&
        consecutiveBelow >= 2
          ? "STRONG"
          : "GOOD",
    };
  }

  if (
    reactionBias === "UP" &&
    bullishContinuationPair
  ) {
    return {
      followThroughState:
        "DEVELOPING_UP",

      followThroughBias:
        "UP",

      followThroughStrength:
        "EARLY",
    };
  }

  if (
    reactionBias === "DOWN" &&
    bearishContinuationPair
  ) {
    return {
      followThroughState:
        "DEVELOPING_DOWN",

      followThroughBias:
        "DOWN",

      followThroughStrength:
        "EARLY",
    };
  }

  if (
    reactionBias === "UP" &&
    (
      latestRelation === "INSIDE_ZONE" ||
      latestHigherClose === false
    )
  ) {
    return {
      followThroughState:
        "NO_FOLLOW_THROUGH",

      followThroughBias:
        "NONE",

      followThroughStrength:
        "WEAK",
    };
  }

  if (
    reactionBias === "DOWN" &&
    (
      latestRelation === "INSIDE_ZONE" ||
      latestLowerClose === false
    )
  ) {
    return {
      followThroughState:
        "NO_FOLLOW_THROUGH",

      followThroughBias:
        "NONE",

      followThroughStrength:
        "WEAK",
    };
  }

  return {
    followThroughState:
      "NO_CLEAR_FOLLOW_THROUGH",

    followThroughBias:
      "NONE",

    followThroughStrength:
      "UNKNOWN",
  };
}

export function evaluateFollowThrough({
  normalizedBars = [],
  zone = null,
  contact = null,
  reaction = null,
  lookback = 4,
} = {}) {
  const sourceBars =
    Array.isArray(normalizedBars)
      ? normalizedBars.filter(isValidBar)
      : [];

  const safeLookback =
    Number.isFinite(Number(lookback)) &&
    Number(lookback) >= 2
      ? Math.floor(Number(lookback))
      : 4;

  const bars =
    sourceBars.slice(-safeLookback);

  if (!isValidZone(zone)) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      followThroughState: "ZONE_INVALID",
      followThroughBias: "NONE",
      followThroughStrength: "UNKNOWN",
      reasonCodes: [
        "ENGINE3_V5_FOLLOW_THROUGH_ZONE_INVALID",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  if (!reaction || typeof reaction !== "object") {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      followThroughState: "REACTION_MISSING",
      followThroughBias: "NONE",
      followThroughStrength: "UNKNOWN",
      reasonCodes: [
        "ENGINE3_V5_FOLLOW_THROUGH_REACTION_MISSING",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  if (bars.length < 2) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      followThroughState: "INSUFFICIENT_FOLLOW_THROUGH_BARS",
      followThroughBias: "NONE",
      followThroughStrength: "UNKNOWN",
      reasonCodes: [
        "ENGINE3_V5_FOLLOW_THROUGH_INSUFFICIENT_BARS",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  const classification =
    classifyFollowThrough({
      bars,
      zone,
      reaction,
    });

  const latest =
    bars.at(-1);

  const prior =
    bars.at(-2);

  const latestRelation =
    relationOfClose(
      latest,
      zone
    );

  const priorRelation =
    relationOfClose(
      prior,
      zone
    );

  return {
    ok: true,
    engine: ENGINE,
    source: SOURCE,

    lookbackRequested:
      safeLookback,

    barsUsed:
      bars.length,

    followThroughState:
      classification.followThroughState,

    followThroughBias:
      classification.followThroughBias,

    followThroughStrength:
      classification.followThroughStrength,

    reactionContext: {
      reactionState:
        reaction?.reactionState ??
        null,

      reactionBias:
        reaction?.reactionBias ??
        null,
    },

    contactContext: {
      contactState:
        contact?.contactState ??
        null,

      contactCharacter:
        contact?.contactCharacter ??
        null,
    },

    latestBarTime:
      latest?.time ??
      null,

    priorBarTime:
      prior?.time ??
      null,

    latestRelation,
    priorRelation,

    latestClose:
      latest?.close ??
      null,

    priorClose:
      prior?.close ??
      null,

    continuationFacts: {
      higherClose:
        latest?.close >
        prior?.close,

      lowerClose:
        latest?.close <
        prior?.close,

      higherHigh:
        latest?.high >
        prior?.high,

      lowerHigh:
        latest?.high <
        prior?.high,

      higherLow:
        latest?.low >
        prior?.low,

      lowerLow:
        latest?.low <
        prior?.low,
    },

    zone: {
      zoneId:
        zone?.zoneId ??
        zone?.id ??
        null,

      low:
        round6(zone.low),

      high:
        round6(zone.high),

      midline:
        round6(zone.midline),
    },

    bars,

    reasonCodes: [
      "ENGINE3_V5_FOLLOW_THROUGH_EVALUATED",
      `ENGINE3_V5_FOLLOW_THROUGH_STATE_${classification.followThroughState}`,
      `ENGINE3_V5_FOLLOW_THROUGH_BIAS_${classification.followThroughBias}`,
      `ENGINE3_V5_FOLLOW_THROUGH_STRENGTH_${classification.followThroughStrength}`,
      "ENGINE3_V5_PRICE_ACTION_FOLLOW_THROUGH_ONLY",
      "ENGINE3_V5_VOLUME_CONFIRMATION_REMAINS_ENGINE4",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default evaluateFollowThrough;
