// services/core/logic/engine22/wave/lifecycle/enrich/enrichCurrentLifecycleWithLivePriceAction.js
//
// Engine 22 live price-action enrichment.
//
// Contract:
// - Consumes Engine 3 / priceAction currentLevelAction as explicit input.
// - Adds livePriceAction to currentLifecycleState.
// - May update alert/watch/timeline wording only.
// - Must NOT create readiness.
// - Must NOT create permission.
// - Must NOT create execution.
// - Must NOT set setupEligible.
// - Must NOT set freshEntryNow.
// - Must NOT edit lifecycle core / structural lifecycle meaning.

const SOURCE = "confluence.context.reaction.currentLevelAction";
const ENGINE = "engine22.livePriceActionEnrichment.v1";

const BULLISH_UPGRADE_STATES = new Set([
  "WICK_BELOW_AND_RECLAIM",
  "DIP_BOUGHT_FAST",
  "SELLERS_TRAPPED",
  "ACCEPTING_VALUE",
  "RECLAIMED_LEVEL",
  "BREAKOUT_HOLDING",
]);

const CAUTION_STATES = new Set([
  "FAILED_RECLAIM",
  "REJECTING_VALUE",
  "LOST_LEVEL",
  "BREAKOUT_FAILING",
]);

const NEUTRAL_STATES = new Set([
  "CHOP_INSIDE_VALUE",
  "NO_SIGNAL",
  "NO_REFERENCE_LEVEL",
  "INSUFFICIENT_CANDLES",
  "MISSING",
]);

const GOOD_QUALITY = new Set(["GOOD", "STRONG"]);
const FAIR_QUALITY = new Set(["FAIR", "MIXED"]);

function safeUpper(value, fallback = "UNKNOWN") {
  const text = String(value || "").trim();
  return text ? text.toUpperCase() : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function buildMissingLivePriceAction() {
  return {
    active: false,
    engine: ENGINE,
    source: SOURCE,

    state: "MISSING",
    quality: "WEAK",
    direction: "NEUTRAL",
    confirmed: false,

    referenceLabel: null,
    referenceLevel: null,
    referenceType: null,
    distancePts: null,

    alertEffect: "NONE",
    lifecycleEffect: "NO_LIFECYCLE_CHANGE",
    executionEffect: "NO_EXECUTION",

    label: "Live current-level action unavailable.",
    summary:
      "Engine 3 currentLevelAction is missing. Engine 22 lifecycle remains unchanged.",

    noPermissionCreated: true,
    noExecution: true,

    reasonCodes: [
      "CURRENT_LEVEL_ACTION_MISSING",
      "NO_LIFECYCLE_CHANGE",
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ],
  };
}

function isLongCompatible(currentLevelAction) {
  return safeUpper(currentLevelAction?.direction, "NEUTRAL") === "LONG";
}

function classifyLivePriceActionEffect({
  currentLifecycleState,
  currentLevelAction,
}) {
  const state = safeUpper(currentLevelAction?.state, "NO_SIGNAL");
  const quality = safeUpper(currentLevelAction?.quality, "WEAK");
  const direction = safeUpper(currentLevelAction?.direction, "NEUTRAL");
  const confirmed = currentLevelAction?.confirmed === true;

  const lifecycleKey = safeUpper(currentLifecycleState?.key, "UNKNOWN");
  const currentAction = safeUpper(currentLifecycleState?.action, "UNKNOWN");

  const bullishState = BULLISH_UPGRADE_STATES.has(state);
  const cautionState = CAUTION_STATES.has(state);
  const neutralState = NEUTRAL_STATES.has(state);

  const longCompatible = direction === "LONG";
  const goodQuality = GOOD_QUALITY.has(quality);
  const fairQuality = FAIR_QUALITY.has(quality);

  const isW2OrCLowWatch =
    lifecycleKey.includes("W2") ||
    lifecycleKey.includes("C_LOW") ||
    lifecycleKey.includes("C-LOW") ||
    lifecycleKey.includes("W3") ||
    currentAction.includes("W3") ||
    currentAction.includes("RECLAIM") ||
    currentAction.includes("CONFIRMATION");

  if (bullishState && longCompatible && goodQuality) {
    return {
      alertEffect: "HIGH_ALERT_WATCH",
      watchIntensity: confirmed ? "HIGH" : "ELEVATED",
      lifecycleEffect: isW2OrCLowWatch
        ? "POSSIBLE_W3_IGNITION_WATCH"
        : "BULLISH_CURRENT_LEVEL_ACTION",
      currentActionRead:
        state === "DIP_BOUGHT_FAST"
          ? "C_LOW_REACTION_BEING_BOUGHT"
          : state === "WICK_BELOW_AND_RECLAIM"
          ? "SWEEP_AND_RECLAIM_WATCH"
          : state === "SELLERS_TRAPPED"
          ? "SELLERS_TRAPPED_WATCH"
          : state === "ACCEPTING_VALUE"
          ? "NEGOTIATED_RECLAIM_WATCH"
          : state === "BREAKOUT_HOLDING"
          ? "BREAKOUT_HOLDING_WATCH"
          : "RECLAIM_WATCH",
      timelineLabel:
        state === "DIP_BOUGHT_FAST"
          ? "Dip bought fast — high-alert watch only"
          : state === "WICK_BELOW_AND_RECLAIM"
          ? "Sweep and reclaim — high-alert watch only"
          : state === "SELLERS_TRAPPED"
          ? "Sellers trapped — high-alert watch only"
          : state === "ACCEPTING_VALUE"
          ? "Accepting value — reclaim watch"
          : state === "BREAKOUT_HOLDING"
          ? "Breakout holding — confirmation still required"
          : "Level reclaimed — confirmation still required",
      reasonCodes: [
        "CURRENT_LEVEL_ACTION_ATTACHED",
        "CURRENT_LEVEL_ACTION_HIGH_ALERT_WATCH",
        confirmed
          ? "CURRENT_LEVEL_ACTION_CONFIRMED_TRUE"
          : "CURRENT_LEVEL_ACTION_CONFIRMED_FALSE",
        `CURRENT_LEVEL_ACTION_${state}`,
        `CURRENT_LEVEL_ACTION_QUALITY_${quality}`,
        "CURRENT_LEVEL_ACTION_NO_EXECUTION",
      ],
    };
  }

  if (bullishState && longCompatible && fairQuality) {
    return {
      alertEffect: "EARLY_ALERT_WATCH",
      watchIntensity: "ELEVATED",
      lifecycleEffect: "EARLY_BULLISH_CURRENT_LEVEL_ACTION",
      currentActionRead: "EARLY_RECLAIM_WATCH",
      timelineLabel: "Early reclaim behavior — still needs confirmation",
      reasonCodes: [
        "CURRENT_LEVEL_ACTION_ATTACHED",
        "CURRENT_LEVEL_ACTION_EARLY_ALERT_WATCH",
        `CURRENT_LEVEL_ACTION_${state}`,
        `CURRENT_LEVEL_ACTION_QUALITY_${quality}`,
        "CURRENT_LEVEL_ACTION_NO_EXECUTION",
      ],
    };
  }

  if (bullishState && !longCompatible) {
    return {
      alertEffect: "NONE",
      watchIntensity: "NORMAL",
      lifecycleEffect: "DIRECTION_NOT_COMPATIBLE",
      currentActionRead: "NO_UPGRADE_DIRECTION_MISMATCH",
      timelineLabel:
        "Current level action is not direction-compatible with the lifecycle watch.",
      reasonCodes: [
        "CURRENT_LEVEL_ACTION_ATTACHED",
        "CURRENT_LEVEL_ACTION_DIRECTION_MISMATCH",
        `CURRENT_LEVEL_ACTION_${state}`,
        `CURRENT_LEVEL_ACTION_DIRECTION_${direction}`,
        "NO_LIFECYCLE_UPGRADE",
        "CURRENT_LEVEL_ACTION_NO_EXECUTION",
      ],
    };
  }

  if (cautionState) {
    return {
      alertEffect: "WATCH_ONLY",
      watchIntensity: "LOWERED",
      lifecycleEffect: "WAIT_FOR_RESET",
      currentActionRead:
        state === "FAILED_RECLAIM"
          ? "RECLAIM_FAILED"
          : state === "REJECTING_VALUE"
          ? "REJECTING_VALUE_WAIT_FOR_RESET"
          : state === "LOST_LEVEL"
          ? "LEVEL_LOST_WAIT_FOR_RESET"
          : "BREAKOUT_FAILING_DO_NOT_CHASE",
      timelineLabel:
        state === "FAILED_RECLAIM"
          ? "Reclaim failed — wait for reset"
          : state === "REJECTING_VALUE"
          ? "Rejecting value — do not chase"
          : state === "LOST_LEVEL"
          ? "Level lost — wait for reset"
          : "Breakout failing — do not chase",
      reasonCodes: [
        "CURRENT_LEVEL_ACTION_ATTACHED",
        "CURRENT_LEVEL_ACTION_CAUTION",
        `CURRENT_LEVEL_ACTION_${state}`,
        "WAIT_FOR_RESET",
        "DO_NOT_CHASE",
        "CURRENT_LEVEL_ACTION_NO_EXECUTION",
      ],
    };
  }

  if (neutralState) {
    return {
      alertEffect: "NONE",
      watchIntensity: "NORMAL",
      lifecycleEffect: "NO_LIFECYCLE_CHANGE",
      currentActionRead: "NO_LIVE_PRICE_ACTION_UPGRADE",
      timelineLabel: "No live current-level upgrade.",
      reasonCodes: [
        "CURRENT_LEVEL_ACTION_ATTACHED",
        `CURRENT_LEVEL_ACTION_${state}`,
        "NO_LIFECYCLE_CHANGE",
        "CURRENT_LEVEL_ACTION_NO_EXECUTION",
      ],
    };
  }

  return {
    alertEffect: "NONE",
    watchIntensity: "NORMAL",
    lifecycleEffect: "NO_LIFECYCLE_CHANGE",
    currentActionRead: "UNMAPPED_CURRENT_LEVEL_ACTION",
    timelineLabel: "Current level action attached with no lifecycle change.",
    reasonCodes: [
      "CURRENT_LEVEL_ACTION_ATTACHED",
      `CURRENT_LEVEL_ACTION_${state}`,
      "CURRENT_LEVEL_ACTION_UNMAPPED",
      "NO_LIFECYCLE_CHANGE",
      "CURRENT_LEVEL_ACTION_NO_EXECUTION",
    ],
  };
}

function buildLivePriceActionPayload({
  currentLevelAction,
  effect,
}) {
  const state = safeUpper(currentLevelAction?.state, "NO_SIGNAL");
  const quality = safeUpper(currentLevelAction?.quality, "WEAK");
  const direction = safeUpper(currentLevelAction?.direction, "NEUTRAL");

  return {
    active: currentLevelAction?.active === true,
    engine: ENGINE,
    source: SOURCE,

    rawEngine: currentLevelAction?.engine || null,
    rawSource: currentLevelAction?.source || null,

    state,
    quality,
    direction,
    confirmed: currentLevelAction?.confirmed === true,

    referenceLabel: currentLevelAction?.referenceLabel ?? null,
    referenceLevel: currentLevelAction?.referenceLevel ?? null,
    referenceType: currentLevelAction?.referenceType ?? null,
    distancePts: currentLevelAction?.distancePts ?? null,

    alertEffect: effect.alertEffect,
    lifecycleEffect: effect.lifecycleEffect,
    executionEffect: "NO_EXECUTION",

    currentActionRead: effect.currentActionRead,
    label: effect.timelineLabel,

    levelAction: isObject(currentLevelAction?.levelAction)
      ? currentLevelAction.levelAction
      : {},

    noPermissionCreated: true,
    noExecution: true,

    reasonCodes: uniqueList([
      ...effect.reasonCodes,
      ...asArray(currentLevelAction?.reasonCodes).map(
        (code) => `RAW_${code}`
      ),
      "NO_PERMISSION_CREATED",
      "NO_EXECUTION",
    ]),
  };
}

function buildTimelineCurrentActionRead({
  currentLevelAction,
  effect,
}) {
  return {
    active: currentLevelAction?.active === true,
    state: safeUpper(currentLevelAction?.state, "NO_SIGNAL"),
    quality: safeUpper(currentLevelAction?.quality, "WEAK"),
    direction: safeUpper(currentLevelAction?.direction, "NEUTRAL"),
    confirmed: currentLevelAction?.confirmed === true,

    label: effect.timelineLabel,
    alertLevel: effect.alertEffect,
    watchIntensity: effect.watchIntensity,

    referenceLabel: currentLevelAction?.referenceLabel ?? null,
    referenceLevel: currentLevelAction?.referenceLevel ?? null,
    referenceType: currentLevelAction?.referenceType ?? null,
    distancePts: currentLevelAction?.distancePts ?? null,

    noExecution: true,
    noPermissionCreated: true,
  };
}

export function enrichCurrentLifecycleWithLivePriceAction({
  currentLifecycleState,
  currentLevelAction,
} = {}) {
  if (!currentLifecycleState || typeof currentLifecycleState !== "object") {
    return currentLifecycleState;
  }

  const baseReasonCodes = asArray(currentLifecycleState.reasonCodes);
  const baseNeeds = asArray(currentLifecycleState.needs);

  if (!currentLevelAction || typeof currentLevelAction !== "object") {
    const missing = buildMissingLivePriceAction();

    return {
      ...currentLifecycleState,

      livePriceAction: missing,

      reasonCodes: uniqueList([
        ...baseReasonCodes,
        "CURRENT_LEVEL_ACTION_MISSING",
        "NO_LIFECYCLE_CHANGE",
        "CURRENT_LEVEL_ACTION_NO_EXECUTION",
      ]),

      // Hard safety: explicitly preserve existing permission/execution fields.
      readiness: currentLifecycleState.readiness,
      active: currentLifecycleState.active,
      noExecution: currentLifecycleState.noExecution,
      tradeableOpportunityBlocked:
        currentLifecycleState.tradeableOpportunityBlocked,
      paperTradeAllowedOnlyAfterConfirmation:
        currentLifecycleState.paperTradeAllowedOnlyAfterConfirmation,
      setupEligible: currentLifecycleState.setupEligible,
      freshEntryNow: currentLifecycleState.freshEntryNow,
    };
  }

  const effect = classifyLivePriceActionEffect({
    currentLifecycleState,
    currentLevelAction,
  });

  const livePriceAction = buildLivePriceActionPayload({
    currentLevelAction,
    effect,
  });

  const timelineRead =
    currentLifecycleState.timelineRead &&
    typeof currentLifecycleState.timelineRead === "object"
      ? currentLifecycleState.timelineRead
      : {};

  const nextNeeds = uniqueList([
    ...baseNeeds,
    effect.alertEffect === "HIGH_ALERT_WATCH"
      ? "WAIT_FOR_ENGINE15_ENGINE6_CONFIRMATION"
      : null,
    effect.lifecycleEffect === "WAIT_FOR_RESET"
      ? "WAIT_FOR_RESET"
      : null,
    effect.currentActionRead?.includes("DO_NOT_CHASE")
      ? "DO_NOT_CHASE"
      : null,
  ]);

  return {
    ...currentLifecycleState,

    livePriceAction,

    alertLevel: effect.alertEffect,
    watchIntensity: effect.watchIntensity,
    currentActionRead: effect.currentActionRead,

    timelineRead: {
      ...timelineRead,
      currentActionRead: buildTimelineCurrentActionRead({
        currentLevelAction,
        effect,
      }),
    },

    needs: nextNeeds,

    reasonCodes: uniqueList([
      ...baseReasonCodes,
      ...effect.reasonCodes,
      "CURRENT_LEVEL_ACTION_NO_PERMISSION_CREATED",
      "CURRENT_LEVEL_ACTION_NO_EXECUTION",
    ]),

    // Hard safety: preserve existing permission/execution fields.
    readiness: currentLifecycleState.readiness,
    active: currentLifecycleState.active,
    noExecution: currentLifecycleState.noExecution,
    tradeableOpportunityBlocked:
      currentLifecycleState.tradeableOpportunityBlocked,
    paperTradeAllowedOnlyAfterConfirmation:
      currentLifecycleState.paperTradeAllowedOnlyAfterConfirmation,
    setupEligible: currentLifecycleState.setupEligible,
    freshEntryNow: currentLifecycleState.freshEntryNow,
  };
}

export default enrichCurrentLifecycleWithLivePriceAction;
