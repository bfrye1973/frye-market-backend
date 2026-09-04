// services/core/logic/engine3/v5/zone/evaluateReaction.js
//
// Engine 3 v5 — Negotiated-zone reaction evaluator.
//
// Contract:
// - Consumes normalized bars, exact Engine 26 zone, contact evidence,
//   wick evidence, and sequence evidence.
// - Classifies what price did AFTER/AROUND contact.
// - Produces reaction evidence only.
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not resolve buyer/seller control.
// - Does not create permission.
// - Does not create execution.
//
// Canonical direction authority remains exclusively in
// state/directionStateMachine.js.

const ENGINE = "engine3.v5.zone.evaluateReaction.v1";
const SOURCE = "engine3.v5.zone.evaluateReaction";

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

function classifyReaction({
  bars,
  zone,
  contact,
  wickBehavior,
  sequenceMomentum,
} = {}) {
  const latest =
    bars.at(-1) ||
    null;

  const prior =
    bars.at(-2) ||
    null;

  if (
    !isValidBar(latest) ||
    !isValidZone(zone)
  ) {
    return {
      reactionState: "NO_VALID_REACTION",
      reactionBias: "NONE",
      facts: {},
    };
  }

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

  const latestSweptLow =
    latest.low < zone.low;

  const latestSweptHigh =
    latest.high > zone.high;

  const latestClosedInside =
    latestRelation === "INSIDE_ZONE";

  const latestClosedAbove =
    latestRelation === "ABOVE_ZONE";

  const latestClosedBelow =
    latestRelation === "BELOW_ZONE";

  const priorClosedInside =
    priorRelation === "INSIDE_ZONE";

  const priorClosedAbove =
    priorRelation === "ABOVE_ZONE";

  const priorClosedBelow =
    priorRelation === "BELOW_ZONE";

  const reclaimedAboveZone =
    (
      priorClosedBelow ||
      priorClosedInside
    ) &&
    latestClosedAbove;

  const lostBelowZone =
    (
      priorClosedInside ||
      priorClosedAbove
    ) &&
    latestClosedBelow;

  const failedBreakoutAbove =
    prior != null &&
    prior.high > zone.high &&
    prior.close > zone.high &&
    latest.close <= zone.high;

  const failedBreakdownBelow =
    prior != null &&
    prior.low < zone.low &&
    prior.close < zone.low &&
    latest.close >= zone.low;

  const failedReclaimFromBelow =
    prior != null &&
    (
      priorClosedBelow ||
      priorClosedInside
    ) &&
    latest.high >= zone.low &&
    latest.close < zone.low;

  const failedAcceptanceAbove =
    prior != null &&
    priorClosedAbove &&
    latest.close <= zone.high;

  const failedAcceptanceBelow =
    prior != null &&
    priorClosedBelow &&
    latest.close >= zone.low;

  const upperWickState =
    String(
      wickBehavior
        ?.latestWick
        ?.rejectionState ||
      ""
    ).toUpperCase();

  const lowerWickState =
    String(
      wickBehavior
        ?.latestWick
        ?.rejectionState ||
      ""
    ).toUpperCase();

  const contactState =
    String(
      contact
        ?.contactState ||
      ""
    ).toUpperCase();

  const sequencePhase =
    String(
      sequenceMomentum
        ?.phase ||
      ""
    ).toUpperCase();

  const sequenceBias =
    String(
      sequenceMomentum
        ?.evidenceBias ||
      ""
    ).toUpperCase();

  const recentCloseRelations =
    bars
      .slice(-3)
      .map(
        (bar) =>
          relationOfClose(
            bar,
            zone
          )
      );

  const closesAboveZoneCount =
    recentCloseRelations.filter(
      (relation) =>
        relation === "ABOVE_ZONE"
    ).length;

  const closesBelowZoneCount =
    recentCloseRelations.filter(
      (relation) =>
        relation === "BELOW_ZONE"
    ).length;

  const closesInsideZoneCount =
    recentCloseRelations.filter(
      (relation) =>
        relation === "INSIDE_ZONE"
    ).length;

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

  const consecutiveInside =
    countConsecutiveFromEnd(
      bars,
      (bar) =>
        relationOfClose(
          bar,
          zone
        ) === "INSIDE_ZONE"
    );

  const acceptingAbove =
    consecutiveAbove >= 2;

  const acceptingBelow =
    consecutiveBelow >= 2;

  const choppingInside =
    consecutiveInside >= 2 &&
    (
      sequencePhase === "COMPRESSION" ||
      sequencePhase === "MIXED" ||
      sequencePhase === "NO_CLEAR_SEQUENCE"
    );

  const rejectionHigh =
    latestSweptHigh &&
    (
      latestClosedInside ||
      latestClosedBelow ||
      upperWickState === "UPPER_WICK_REJECTION" ||
      contactState.includes("SWEPT_HIGH") ||
      contactState.includes("UPPER_REJECTION")
    );

  const rejectionLow =
    latestSweptLow &&
    (
      latestClosedInside ||
      latestClosedAbove ||
      lowerWickState === "LOWER_WICK_REJECTION" ||
      contactState.includes("SWEPT_LOW") ||
      contactState.includes("LOWER_REJECTION")
    );

  const bullishSequenceSupport =
    sequenceBias === "UP" ||
    sequencePhase.includes("UP");

  const bearishSequenceSupport =
    sequenceBias === "DOWN" ||
    sequencePhase.includes("DOWN");

  if (failedBreakoutAbove) {
    return {
      reactionState: "FAILED_BREAKOUT",
      reactionBias: "DOWN",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  if (failedBreakdownBelow) {
    return {
      reactionState: "FAILED_BREAKDOWN",
      reactionBias: "UP",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  if (failedReclaimFromBelow) {
    return {
      reactionState: "FAILED_RECLAIM",
      reactionBias: "DOWN",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  if (reclaimedAboveZone) {
    return {
      reactionState: "RECLAIM",
      reactionBias: "UP",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  if (rejectionHigh) {
    return {
      reactionState: "REJECTION_HIGH",
      reactionBias: "DOWN",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  if (rejectionLow) {
    return {
      reactionState: "REJECTION_LOW",
      reactionBias: "UP",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  if (acceptingAbove) {
    return {
      reactionState: "ACCEPTANCE_ABOVE",
      reactionBias: "UP",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  if (acceptingBelow) {
    return {
      reactionState: "ACCEPTANCE_BELOW",
      reactionBias: "DOWN",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  if (lostBelowZone) {
    return {
      reactionState: "LOST_ZONE",
      reactionBias: "DOWN",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  if (choppingInside) {
    return {
      reactionState: "CHOP",
      reactionBias: "MIXED",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  if (
    latestClosedInside &&
    (
      bullishSequenceSupport ||
      bearishSequenceSupport
    )
  ) {
    return {
      reactionState: "ABSORPTION",
      reactionBias: "MIXED",
      facts: {
        failedBreakoutAbove,
        failedBreakdownBelow,
        failedReclaimFromBelow,
        failedAcceptanceAbove,
        failedAcceptanceBelow,
        rejectionHigh,
        rejectionLow,
        reclaimedAboveZone,
        lostBelowZone,
        acceptingAbove,
        acceptingBelow,
        choppingInside,
      },
    };
  }

  return {
    reactionState: "NO_CLEAR_REACTION",
    reactionBias: "NONE",
    facts: {
      failedBreakoutAbove,
      failedBreakdownBelow,
      failedReclaimFromBelow,
      failedAcceptanceAbove,
      failedAcceptanceBelow,
      rejectionHigh,
      rejectionLow,
      reclaimedAboveZone,
      lostBelowZone,
      acceptingAbove,
      acceptingBelow,
      choppingInside,
    },
  };
}

export function evaluateReaction({
  normalizedBars = [],
  zone = null,
  contact = null,
  wickBehavior = null,
  sequenceMomentum = null,
  lookback = 5,
} = {}) {
  const sourceBars =
    Array.isArray(normalizedBars)
      ? normalizedBars.filter(isValidBar)
      : [];

  const safeLookback =
    Number.isFinite(Number(lookback)) &&
    Number(lookback) >= 2
      ? Math.floor(Number(lookback))
      : 5;

  const bars =
    sourceBars.slice(-safeLookback);

  if (!isValidZone(zone)) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      reactionState: "ZONE_INVALID",
      reactionBias: "NONE",
      reasonCodes: [
        "ENGINE3_V5_REACTION_ZONE_INVALID",
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
      reactionState: "INSUFFICIENT_REACTION_BARS",
      reactionBias: "NONE",
      reasonCodes: [
        "ENGINE3_V5_REACTION_INSUFFICIENT_BARS",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  const classification =
    classifyReaction({
      bars,
      zone,
      contact,
      wickBehavior,
      sequenceMomentum,
    });

  const latest =
    bars.at(-1);

  const prior =
    bars.at(-2);

  return {
    ok: true,
    engine: ENGINE,
    source: SOURCE,

    lookbackRequested:
      safeLookback,

    barsUsed:
      bars.length,

    reactionState:
      classification.reactionState,

    reactionBias:
      classification.reactionBias,

    facts:
      classification.facts,

    latestBarTime:
      latest?.time ??
      null,

    priorBarTime:
      prior?.time ??
      null,

    latestClose:
      latest?.close ??
      null,

    priorClose:
      prior?.close ??
      null,

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

    supportingEvidence: {
      contactState:
        contact?.contactState ??
        null,

      contactCharacter:
        contact?.contactCharacter ??
        null,

      sequencePhase:
        sequenceMomentum?.phase ??
        null,

      sequenceEvidenceBias:
        sequenceMomentum?.evidenceBias ??
        null,

      latestWickState:
        wickBehavior
          ?.latestWick
          ?.rejectionState ??
        null,

      latestSweepState:
        wickBehavior
          ?.latestSweep
          ?.sweepState ??
        null,
    },

    bars,

    reasonCodes: [
      "ENGINE3_V5_REACTION_EVALUATED",
      `ENGINE3_V5_REACTION_STATE_${classification.reactionState}`,
      `ENGINE3_V5_REACTION_BIAS_${classification.reactionBias}`,
      "ENGINE3_V5_REACTION_EVIDENCE_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default evaluateReaction;
