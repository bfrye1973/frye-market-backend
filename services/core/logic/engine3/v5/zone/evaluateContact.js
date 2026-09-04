// services/core/logic/engine3/v5/zone/evaluateContact.js
//
// Engine 3 v5 — Exact negotiated-zone contact evaluator.
//
// Contract:
// - Consumes normalized bars, zone relation evidence, wick evidence,
//   and ONE exact Engine 26 negotiated zone.
// - Describes what happened when price contacted that zone.
// - Does not publish canonical LONG / SHORT / NEUTRAL.
// - Does not resolve buyer/seller control.
// - Does not create quality.
// - Does not create confirmation.
// - Does not create permission.
// - Does not create execution.
//
// Frozen ownership:
// Engine 26 owns WHERE.
// Engine 3 v5 evaluates WHAT HAPPENED AT CONTACT.
//
// IMPORTANT:
// Contact states are evidence classifications only.
// Canonical direction authority remains exclusively in
// state/directionStateMachine.js.

const ENGINE = "engine3.v5.zone.evaluateContact.v1";
const SOURCE = "engine3.v5.zone.evaluateContact";

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

function relationOfPrice(price, zone) {
  const p = Number(price);

  if (!Number.isFinite(p) || !isValidZone(zone)) {
    return "UNKNOWN";
  }

  if (p > Number(zone.high)) {
    return "ABOVE_ZONE";
  }

  if (p < Number(zone.low)) {
    return "BELOW_ZONE";
  }

  return "INSIDE_ZONE";
}

function barTouchesZone(bar, zone) {
  if (!isValidBar(bar) || !isValidZone(zone)) {
    return false;
  }

  return (
    Number(bar.high) >= Number(zone.low) &&
    Number(bar.low) <= Number(zone.high)
  );
}

function findMostRecentContactIndex(
  bars = [],
  zone = null
) {
  for (
    let i = bars.length - 1;
    i >= 0;
    i -= 1
  ) {
    if (barTouchesZone(bars[i], zone)) {
      return i;
    }
  }

  return -1;
}

function classifyContact({
  contactBar,
  priorBar,
  zone,
  zoneRelation,
  wickBehavior,
} = {}) {
  if (
    !isValidBar(contactBar) ||
    !isValidZone(zone)
  ) {
    return {
      contactState: "NO_VALID_CONTACT",
      contactCharacter: "UNKNOWN",
    };
  }

  const low = Number(zone.low);
  const high = Number(zone.high);
  const midline = Number(zone.midline);

  const openRelation =
    relationOfPrice(
      contactBar.open,
      zone
    );

  const closeRelation =
    relationOfPrice(
      contactBar.close,
      zone
    );

  const sweptLow =
    Number(contactBar.low) < low;

  const sweptHigh =
    Number(contactBar.high) > high;

  const touchedLow =
    Number(contactBar.low) <= low &&
    Number(contactBar.high) >= low;

  const touchedHigh =
    Number(contactBar.low) <= high &&
    Number(contactBar.high) >= high;

  const touchedMidline =
    Number(contactBar.low) <= midline &&
    Number(contactBar.high) >= midline;

  const closedAbove =
    closeRelation === "ABOVE_ZONE";

  const closedBelow =
    closeRelation === "BELOW_ZONE";

  const closedInside =
    closeRelation === "INSIDE_ZONE";

  const enteredFromAbove =
    openRelation === "ABOVE_ZONE" &&
    closedInside;

  const enteredFromBelow =
    openRelation === "BELOW_ZONE" &&
    closedInside;

  const crossedEntireZoneDown =
    openRelation === "ABOVE_ZONE" &&
    closedBelow;

  const crossedEntireZoneUp =
    openRelation === "BELOW_ZONE" &&
    closedAbove;

  const latestWickState = String(
    wickBehavior
      ?.latestWick
      ?.rejectionState ||
    ""
  ).toUpperCase();

  const relationState = String(
    zoneRelation
      ?.latestRelation
      ?.primaryRelation ||
    ""
  ).toUpperCase();

  if (
    sweptLow &&
    (
      closedInside ||
      closedAbove
    )
  ) {
    return {
      contactState:
        closedAbove
          ? "SWEPT_LOW_AND_RECLAIMED_ABOVE_ZONE"
          : "SWEPT_LOW_AND_RECLAIMED_INSIDE_ZONE",

      contactCharacter:
        "LOW_SIDE_REJECTION",
    };
  }

  if (
    sweptHigh &&
    (
      closedInside ||
      closedBelow
    )
  ) {
    return {
      contactState:
        closedBelow
          ? "SWEPT_HIGH_AND_REJECTED_BELOW_ZONE"
          : "SWEPT_HIGH_AND_REJECTED_INSIDE_ZONE",

      contactCharacter:
        "HIGH_SIDE_REJECTION",
    };
  }

  if (crossedEntireZoneDown) {
    return {
      contactState:
        "CROSSED_ENTIRE_ZONE_DOWN",

      contactCharacter:
        "BEARISH_TRAVERSE",
    };
  }

  if (crossedEntireZoneUp) {
    return {
      contactState:
        "CROSSED_ENTIRE_ZONE_UP",

      contactCharacter:
        "BULLISH_TRAVERSE",
    };
  }

  if (enteredFromAbove) {
    return {
      contactState:
        "ENTERED_ZONE_FROM_ABOVE",

      contactCharacter:
        "DOWNWARD_ENTRY",
    };
  }

  if (enteredFromBelow) {
    return {
      contactState:
        "ENTERED_ZONE_FROM_BELOW",

      contactCharacter:
        "UPWARD_ENTRY",
    };
  }

  if (
    touchedHigh &&
    closedAbove
  ) {
    return {
      contactState:
        "TESTED_HIGH_AND_HELD_ABOVE",

      contactCharacter:
        "HIGH_SIDE_HOLD",
    };
  }

  if (
    touchedLow &&
    closedBelow
  ) {
    return {
      contactState:
        "TESTED_LOW_AND_HELD_BELOW",

      contactCharacter:
        "LOW_SIDE_HOLD",
    };
  }

  if (
    touchedMidline &&
    closedInside
  ) {
    return {
      contactState:
        "MIDLINE_CONTACT_INSIDE_ZONE",

      contactCharacter:
        "MIDLINE_INTERACTION",
    };
  }

  if (
    latestWickState ===
      "UPPER_WICK_REJECTION" ||
    relationState.includes(
      "SWEPT_HIGH"
    )
  ) {
    return {
      contactState:
        "UPPER_REJECTION_AT_CONTACT",

      contactCharacter:
        "HIGH_SIDE_REJECTION",
    };
  }

  if (
    latestWickState ===
      "LOWER_WICK_REJECTION" ||
    relationState.includes(
      "SWEPT_LOW"
    )
  ) {
    return {
      contactState:
        "LOWER_REJECTION_AT_CONTACT",

      contactCharacter:
        "LOW_SIDE_REJECTION",
    };
  }

  return {
    contactState:
      "ZONE_CONTACT_NO_CLEAR_REACTION",

    contactCharacter:
      "MIXED_CONTACT",
  };
}

export function evaluateContact({
  normalizedBars = [],
  zone = null,
  zoneRelation = null,
  wickBehavior = null,
  lookback = 8,
} = {}) {
  const sourceBars =
    Array.isArray(normalizedBars)
      ? normalizedBars.filter(isValidBar)
      : [];

  const safeLookback =
    Number.isFinite(Number(lookback)) &&
    Number(lookback) >= 2
      ? Math.floor(Number(lookback))
      : 8;

  const bars =
    sourceBars.slice(
      -safeLookback
    );

  if (!isValidZone(zone)) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      contactState: "ZONE_INVALID",
      contactCharacter: "UNKNOWN",
      reasonCodes: [
        "ENGINE3_V5_CONTACT_ZONE_INVALID",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  if (!bars.length) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      contactState: "NO_BARS",
      contactCharacter: "UNKNOWN",
      reasonCodes: [
        "ENGINE3_V5_CONTACT_NO_BARS",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  const contactIndex =
    findMostRecentContactIndex(
      bars,
      zone
    );

  if (contactIndex < 0) {
    return {
      ok: true,
      engine: ENGINE,
      source: SOURCE,

      contactObserved:
        false,

      contactState:
        "NO_RECENT_ZONE_CONTACT",

      contactCharacter:
        "NONE",

      barsUsed:
        bars.length,

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

      reasonCodes: [
        "ENGINE3_V5_NO_RECENT_ZONE_CONTACT",
        "ENGINE3_V5_CONTACT_EVIDENCE_ONLY",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
        "ENGINE3_V5_NO_PERMISSION_CREATED",
        "ENGINE3_V5_NO_EXECUTION",
      ],
    };
  }

  const contactBar =
    bars[contactIndex];

  const priorBar =
    contactIndex > 0
      ? bars[contactIndex - 1]
      : null;

  const afterContactBars =
    bars.slice(
      contactIndex + 1
    );

  const classification =
    classifyContact({
      contactBar,
      priorBar,
      zone,
      zoneRelation,
      wickBehavior,
    });

  const low =
    Number(zone.low);

  const high =
    Number(zone.high);

  const midline =
    Number(zone.midline);

  const penetrationBelow =
    Number(contactBar.low) < low
      ? round6(
          low -
          Number(contactBar.low)
        )
      : 0;

  const penetrationAbove =
    Number(contactBar.high) > high
      ? round6(
          Number(contactBar.high) -
          high
        )
      : 0;

  const touchedLow =
    Number(contactBar.low) <= low &&
    Number(contactBar.high) >= low;

  const touchedHigh =
    Number(contactBar.low) <= high &&
    Number(contactBar.high) >= high;

  const touchedMidline =
    Number(contactBar.low) <= midline &&
    Number(contactBar.high) >= midline;

  return {
    ok: true,
    engine: ENGINE,
    source: SOURCE,

    contactObserved:
      true,

    barsUsed:
      bars.length,

    contactIndex,

    contactBarTime:
      contactBar?.time ??
      null,

    contactState:
      classification.contactState,

    contactCharacter:
      classification.contactCharacter,

    contactFacts: {
      openRelation:
        relationOfPrice(
          contactBar.open,
          zone
        ),

      closeRelation:
        relationOfPrice(
          contactBar.close,
          zone
        ),

      touchedLow,
      touchedHigh,
      touchedMidline,

      sweptBelowZone:
        penetrationBelow > 0,

      sweptAboveZone:
        penetrationAbove > 0,

      penetrationBelowPoints:
        penetrationBelow,

      penetrationAbovePoints:
        penetrationAbove,

      contactBodyBullish:
        contactBar.bullishBody === true,

      contactBodyBearish:
        contactBar.bearishBody === true,

      contactCloseLocationPct:
        contactBar.closeLocationPct ??
        null,
    },

    contactBar,

    priorBar,

    afterContactBars,

    afterContactBarCount:
      afterContactBars.length,

    zone: {
      zoneId:
        zone?.zoneId ??
        zone?.id ??
        null,

      low:
        round6(low),

      high:
        round6(high),

      midline:
        round6(midline),
    },

    supportingEvidence: {
      latestZoneRelation:
        zoneRelation
          ?.latestRelation ||
        null,

      latestWick:
        wickBehavior
          ?.latestWick ||
        null,

      latestSweep:
        wickBehavior
          ?.latestSweep ||
        null,
    },

    reasonCodes: [
      "ENGINE3_V5_CONTACT_EVALUATED",
      `ENGINE3_V5_CONTACT_STATE_${classification.contactState}`,
      `ENGINE3_V5_CONTACT_CHARACTER_${classification.contactCharacter}`,
      "ENGINE3_V5_EXACT_NEGOTIATED_ZONE_ONLY",
      "ENGINE3_V5_CONTACT_EVIDENCE_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default evaluateContact;
