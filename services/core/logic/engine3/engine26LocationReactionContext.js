// services/core/logic/engine3/engine26LocationReactionContext.js
//
// Engine 3 helper for reading Engine 26 structural location context.
// Purpose:
// - Align Engine 3 price-action interpretation with Engine 26's active short-watch zone.
// - Does not create permission.
// - Does not create execution.

function safeUpper(value, fallback = "NONE") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function validPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const LONG_STATES = new Set([
  "HELD_LEVEL",
  "RECLAIMED_LEVEL",
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "SELLERS_TRAPPED",
  "ACCEPTING_VALUE",
  "BREAKOUT_HOLDING",
]);

const SHORT_STATES = new Set([
  "LOST_LEVEL",
  "FAILED_RECLAIM",
  "REJECTING_VALUE",
  "BREAKOUT_FAILING",
  "FAILED_ACCEPTANCE_SHORT",
  "LOST_SHORT_TRIGGER_LEVEL",
]);

export function buildEngine26LocationReactionContext({
  engine26StructuralContext = null,
  reactionInput = null,
} = {}) {
  const locationContext = engine26StructuralContext?.locationContext || null;

  if (!locationContext?.active) {
    return {
      active: false,
      source: "engine26StructuralContext.locationContext",
      reasonCodes: ["ENGINE26_LOCATION_CONTEXT_MISSING"],
    };
  }

  const state = safeUpper(reactionInput?.state, "NO_SIGNAL");
  const direction = safeUpper(reactionInput?.direction, "NEUTRAL");

  const currentPrice =
    validPrice(reactionInput?.currentPrice) ??
    validPrice(reactionInput?.lastCandle?.close) ??
    validPrice(locationContext?.currentPrice) ??
    null;

  const shortTriggerLevel = validPrice(locationContext?.shortTriggerLevel);
  const invalidationLevel = validPrice(locationContext?.invalidationLevel);

  const locationRead = safeUpper(locationContext.locationRead);
  const priceLocation = safeUpper(locationContext.priceLocation);
  const desiredTrigger = safeUpper(locationContext.desiredTrigger);

  const handoffRule = safeUpper(
    locationContext?.handoff?.engine3ShouldTreatInsideShortZoneAs,
    "NONE"
  );

  const insideShortZoneAcceptanceTest =
    locationRead === "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST" &&
    priceLocation === "INSIDE_ZONE";

  const longBounceInsideShortZone =
    insideShortZoneAcceptanceTest &&
    direction === "LONG" &&
    LONG_STATES.has(state) &&
    (
      handoffRule === "ACCEPTANCE_TEST_NOT_LONG_PERMISSION" ||
      handoffRule === "NONE"
    );

  const lostShortTrigger =
    shortTriggerLevel != null &&
    currentPrice != null &&
    currentPrice < shortTriggerLevel &&
    direction === "SHORT" &&
    SHORT_STATES.has(state);

  const reclaimedAboveInvalidation =
    invalidationLevel != null &&
    currentPrice != null &&
    currentPrice > invalidationLevel &&
    direction === "LONG";

  if (longBounceInsideShortZone) {
    return {
      active: true,
      source: "engine26StructuralContext.locationContext",
      state: "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST",
      quality: "MIXED",
      direction: "NEUTRAL",
      confirmed: false,
      forceAllowedFalse: true,
      blocker: "LONG_BOUNCE_NOT_CLEAN_PERMISSION",
      locationRead,
      priceLocation,
      desiredTrigger,
      shortTriggerLevel,
      invalidationLevel,
      interpretation:
        "Bounce is real, but it is inside Engine 26 short-watch zone. Treat as acceptance test, not clean long permission.",
      reasonCodes: [
        "ENGINE26_LOCATION_CONTEXT_CONSUMED",
        "INSIDE_SHORT_WATCH_ZONE_ACCEPTANCE_TEST",
        "LONG_BOUNCE_NOT_CLEAN_PERMISSION",
        "WAIT_FOR_FAILED_ACCEPTANCE_OR_RECLAIM",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  if (lostShortTrigger) {
    return {
      active: true,
      source: "engine26StructuralContext.locationContext",
      state:
        state === "LOST_LEVEL"
          ? "LOST_SHORT_TRIGGER_LEVEL"
          : "FAILED_ACCEPTANCE_SHORT",
      quality: safeUpper(reactionInput?.quality, "GOOD") === "STRONG"
        ? "STRONG"
        : "GOOD",
      direction: "SHORT",
      confirmed: reactionInput?.confirmed === true,
      forceAllowedFalse: false,
      blocker: null,
      locationRead,
      priceLocation,
      desiredTrigger,
      shortTriggerLevel,
      invalidationLevel,
      interpretation:
        "Price lost Engine 26 short trigger level. Failed acceptance / level-loss trigger is confirming.",
      reasonCodes: [
        "ENGINE26_LOCATION_CONTEXT_CONSUMED",
        "SHORT_TRIGGER_LEVEL_LOST",
        "FAILED_ACCEPTANCE_OR_LEVEL_LOSS",
        "ENGINE26_SHORT_WATCH_TRIGGER_CONFIRMING",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  if (reclaimedAboveInvalidation) {
    return {
      active: true,
      source: "engine26StructuralContext.locationContext",
      state: "SHORT_WATCH_RECLAIM_INVALIDATION_RISK",
      quality: "MIXED",
      direction: "NEUTRAL",
      confirmed: false,
      forceAllowedFalse: true,
      blocker: "SHORT_WATCH_RECLAIM_INVALIDATION_RISK",
      locationRead,
      priceLocation,
      desiredTrigger,
      shortTriggerLevel,
      invalidationLevel,
      interpretation:
        "Price reclaimed above Engine 26 invalidation level. Short-watch zone is weakening.",
      reasonCodes: [
        "ENGINE26_LOCATION_CONTEXT_CONSUMED",
        "RECLAIMED_ABOVE_SHORT_WATCH_INVALIDATION",
        "SHORT_WATCH_WEAKENING",
        "NO_PERMISSION_CREATED",
        "NO_EXECUTION",
      ],
    };
  }

  return {
    active: true,
    source: "engine26StructuralContext.locationContext",
    state: null,
    quality: null,
    direction: null,
    confirmed: null,
    forceAllowedFalse: false,
    blocker: null,
    locationRead,
    priceLocation,
    desiredTrigger,
    shortTriggerLevel,
    invalidationLevel,
    interpretation: null,
    reasonCodes: [
      "ENGINE26_LOCATION_CONTEXT_CONSUMED",
      locationRead,
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ].filter(Boolean),
  };
}

export default buildEngine26LocationReactionContext;
