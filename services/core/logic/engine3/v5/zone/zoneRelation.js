// services/core/logic/engine3/v5/zone/zoneRelation.js
//
// Engine 3 v5 — Exact negotiated-zone relation facts.
//
// Contract:
// - Pure zone evidence utility.
// - Consumes normalized bars plus ONE normalized Engine 26 zone.
// - Describes where price/candles are relative to that exact zone.
// - Does not select another reference.
// - Does not infer canonical LONG / SHORT / NEUTRAL.
// - Does not resolve buyer/seller control.
// - Does not create quality.
// - Does not create confirmation.
// - Does not create permission.
// - Does not create execution.
//
// Frozen ownership:
// Engine 26 owns WHERE.
// This module only describes HOW price relates to that location.

const ENGINE = "engine3.v5.zone.zoneRelation.v1";
const SOURCE = "engine3.v5.zone.zoneRelation";

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

  const low = Number(zone.low);
  const high = Number(zone.high);

  if (p > high) {
    return "ABOVE_ZONE";
  }

  if (p < low) {
    return "BELOW_ZONE";
  }

  return "INSIDE_ZONE";
}

function distanceFromZone(price, zone) {
  const p = Number(price);

  if (!Number.isFinite(p) || !isValidZone(zone)) {
    return null;
  }

  const low = Number(zone.low);
  const high = Number(zone.high);

  if (p >= low && p <= high) {
    return 0;
  }

  if (p < low) {
    return round6(low - p);
  }

  return round6(p - high);
}

function signedDistanceFromMidline(price, zone) {
  const p = Number(price);

  if (!Number.isFinite(p) || !isValidZone(zone)) {
    return null;
  }

  return round6(
    p - Number(zone.midline)
  );
}

export function buildSingleZoneRelation(
  bar,
  zone
) {
  if (!isValidBar(bar)) {
    return {
      valid: false,
      engine: ENGINE,
      source: SOURCE,
      time: bar?.time ?? null,
      reasonCodes: [
        "ENGINE3_V5_ZONE_RELATION_BAR_INVALID",
      ],
    };
  }

  if (!isValidZone(zone)) {
    return {
      valid: false,
      engine: ENGINE,
      source: SOURCE,
      time: bar.time,
      reasonCodes: [
        "ENGINE3_V5_ZONE_RELATION_ZONE_INVALID",
      ],
    };
  }

  const low = Number(zone.low);
  const high = Number(zone.high);
  const midline = Number(zone.midline);

  const openRelation =
    relationOfPrice(
      bar.open,
      zone
    );

  const closeRelation =
    relationOfPrice(
      bar.close,
      zone
    );

  const highRelation =
    relationOfPrice(
      bar.high,
      zone
    );

  const lowRelation =
    relationOfPrice(
      bar.low,
      zone
    );

  const touchedZone =
    bar.high >= low &&
    bar.low <= high;

  const touchedLowBoundary =
    bar.low <= low &&
    bar.high >= low;

  const touchedHighBoundary =
    bar.low <= high &&
    bar.high >= high;

  const touchedMidline =
    bar.low <= midline &&
    bar.high >= midline;

  const sweptBelowZone =
    bar.low < low;

  const sweptAboveZone =
    bar.high > high;

  const closedBackInsideAfterLowSweep =
    sweptBelowZone &&
    bar.close >= low &&
    bar.close <= high;

  const closedBackAboveAfterLowSweep =
    sweptBelowZone &&
    bar.close > high;

  const closedBackInsideAfterHighSweep =
    sweptAboveZone &&
    bar.close >= low &&
    bar.close <= high;

  const closedBackBelowAfterHighSweep =
    sweptAboveZone &&
    bar.close < low;

  const openedInside =
    openRelation ===
    "INSIDE_ZONE";

  const closedInside =
    closeRelation ===
    "INSIDE_ZONE";

  const openedAbove =
    openRelation ===
    "ABOVE_ZONE";

  const closedAbove =
    closeRelation ===
    "ABOVE_ZONE";

  const openedBelow =
    openRelation ===
    "BELOW_ZONE";

  const closedBelow =
    closeRelation ===
    "BELOW_ZONE";

  const crossedFromBelowIntoZone =
    openedBelow &&
    closedInside;

  const crossedFromAboveIntoZone =
    openedAbove &&
    closedInside;

  const crossedFromInsideAbove =
    openedInside &&
    closedAbove;

  const crossedFromInsideBelow =
    openedInside &&
    closedBelow;

  const crossedEntireZoneUp =
    openedBelow &&
    closedAbove;

  const crossedEntireZoneDown =
    openedAbove &&
    closedBelow;

  const closeAboveMidline =
    bar.close > midline;

  const closeBelowMidline =
    bar.close < midline;

  const closeAtMidline =
    bar.close === midline;

  const midlineCrossedByBody =
    Math.min(
      bar.open,
      bar.close
    ) <= midline &&
    Math.max(
      bar.open,
      bar.close
    ) >= midline;

  let primaryRelation =
    closeRelation;

  if (
    sweptBelowZone &&
    closedBackAboveAfterLowSweep
  ) {
    primaryRelation =
      "SWEPT_LOW_AND_CLOSED_ABOVE_ZONE";
  } else if (
    sweptBelowZone &&
    closedBackInsideAfterLowSweep
  ) {
    primaryRelation =
      "SWEPT_LOW_AND_CLOSED_INSIDE";
  } else if (
    sweptAboveZone &&
    closedBackBelowAfterHighSweep
  ) {
    primaryRelation =
      "SWEPT_HIGH_AND_CLOSED_BELOW_ZONE";
  } else if (
    sweptAboveZone &&
    closedBackInsideAfterHighSweep
  ) {
    primaryRelation =
      "SWEPT_HIGH_AND_CLOSED_INSIDE";
  } else if (
    crossedEntireZoneUp
  ) {
    primaryRelation =
      "CROSSED_ENTIRE_ZONE_UP";
  } else if (
    crossedEntireZoneDown
  ) {
    primaryRelation =
      "CROSSED_ENTIRE_ZONE_DOWN";
  } else if (
    crossedFromInsideAbove
  ) {
    primaryRelation =
      "LEFT_ZONE_ABOVE";
  } else if (
    crossedFromInsideBelow
  ) {
    primaryRelation =
      "LEFT_ZONE_BELOW";
  } else if (
    crossedFromBelowIntoZone
  ) {
    primaryRelation =
      "ENTERED_ZONE_FROM_BELOW";
  } else if (
    crossedFromAboveIntoZone
  ) {
    primaryRelation =
      "ENTERED_ZONE_FROM_ABOVE";
  }

  return {
    valid: true,
    engine: ENGINE,
    source: SOURCE,

    time:
      bar.time,

    primaryRelation,

    zone: {
      zoneId:
        zone.zoneId ??
        zone.id ??
        null,

      low:
        round6(low),

      high:
        round6(high),

      midline:
        round6(midline),
    },

    priceRelation: {
      open:
        openRelation,

      high:
        highRelation,

      low:
        lowRelation,

      close:
        closeRelation,
    },

    contact: {
      touchedZone,
      touchedLowBoundary,
      touchedHighBoundary,
      touchedMidline,

      sweptBelowZone,
      sweptAboveZone,
    },

    transitions: {
      crossedFromBelowIntoZone,
      crossedFromAboveIntoZone,

      crossedFromInsideAbove,
      crossedFromInsideBelow,

      crossedEntireZoneUp,
      crossedEntireZoneDown,

      closedBackInsideAfterLowSweep,
      closedBackAboveAfterLowSweep,

      closedBackInsideAfterHighSweep,
      closedBackBelowAfterHighSweep,
    },

    midline: {
      touched:
        touchedMidline,

      crossedByBody:
        midlineCrossedByBody,

      closeAbove:
        closeAboveMidline,

      closeBelow:
        closeBelowMidline,

      closeAt:
        closeAtMidline,

      signedDistancePoints:
        signedDistanceFromMidline(
          bar.close,
          zone
        ),
    },

    distance: {
      closeDistanceToZone:
        distanceFromZone(
          bar.close,
          zone
        ),

      openDistanceToZone:
        distanceFromZone(
          bar.open,
          zone
        ),
    },

    reasonCodes: [
      "ENGINE3_V5_ZONE_RELATION_BUILT",
      `ENGINE3_V5_PRIMARY_RELATION_${primaryRelation}`,
      "ENGINE3_V5_EXACT_NEGOTIATED_ZONE_ONLY",
      "ENGINE3_V5_RELATION_EVIDENCE_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export function buildZoneRelationStack(
  normalizedBars = [],
  zone = null
) {
  const bars =
    Array.isArray(normalizedBars)
      ? normalizedBars.filter(
          isValidBar
        )
      : [];

  if (!isValidZone(zone)) {
    return {
      ok: false,
      engine: ENGINE,
      source: SOURCE,
      barsUsed: 0,
      zone: null,
      relations: [],
      reasonCodes: [
        "ENGINE3_V5_ZONE_RELATION_STACK_ZONE_INVALID",
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
      barsUsed: 0,
      zone,
      relations: [],
      reasonCodes: [
        "ENGINE3_V5_ZONE_RELATION_STACK_NO_BARS",
        "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
        "ENGINE3_V5_NO_CONTROL_CREATED",
      ],
    };
  }

  const relations =
    bars.map(
      (bar) =>
        buildSingleZoneRelation(
          bar,
          zone
        )
    );

  const countByRelation = {};

  for (const relation of relations) {
    const key =
      relation?.primaryRelation ||
      "UNKNOWN";

    countByRelation[key] =
      Number(
        countByRelation[key] ||
        0
      ) + 1;
  }

  return {
    ok: true,
    engine: ENGINE,
    source: SOURCE,

    barsUsed:
      bars.length,

    zone,

    latestRelation:
      relations.at(-1) ||
      null,

    priorRelation:
      relations.at(-2) ||
      null,

    relations,

    summary: {
      countByRelation,

      touchedZoneCount:
        relations.filter(
          (item) =>
            item?.contact?.touchedZone === true
        ).length,

      sweptBelowZoneCount:
        relations.filter(
          (item) =>
            item?.contact?.sweptBelowZone === true
        ).length,

      sweptAboveZoneCount:
        relations.filter(
          (item) =>
            item?.contact?.sweptAboveZone === true
        ).length,

      closedInsideCount:
        relations.filter(
          (item) =>
            item?.priceRelation?.close ===
            "INSIDE_ZONE"
        ).length,

      closedAboveCount:
        relations.filter(
          (item) =>
            item?.priceRelation?.close ===
            "ABOVE_ZONE"
        ).length,

      closedBelowCount:
        relations.filter(
          (item) =>
            item?.priceRelation?.close ===
            "BELOW_ZONE"
        ).length,
    },

    reasonCodes: [
      "ENGINE3_V5_ZONE_RELATION_STACK_BUILT",
      "ENGINE3_V5_EXACT_NEGOTIATED_ZONE_ONLY",
      "ENGINE3_V5_RELATION_EVIDENCE_ONLY",
      "ENGINE3_V5_NO_CANONICAL_DIRECTION_CREATED",
      "ENGINE3_V5_NO_CONTROL_CREATED",
      "ENGINE3_V5_NO_PERMISSION_CREATED",
      "ENGINE3_V5_NO_EXECUTION",
    ],
  };
}

export default buildZoneRelationStack;
