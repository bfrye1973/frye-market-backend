// services/core/logic/aiTradeCopilot/buildAiTradeCopilotRead.js

const ENGINE_NAME = "aiTradeCopilot.v1";
const READ_ONLY_MODE = "READ_ONLY";

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function text(value, fallback = "UNKNOWN") {
  if (value == null || value === "") return fallback;
  return String(value);
}

function pretty(value, fallback = "Unknown") {
  if (value == null || value === "") return fallback;

  return String(value)
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function trimEndingPeriod(value) {
  return String(value || "").trim().replace(/\.+$/, "");
}

function pickEsPrice({ strategy, engine23, engine22, marketMeter }) {
  return (
    asNumber(engine22?.currentPrice) ??
    asNumber(strategy?.context?.meta?.current_price) ??
    asNumber(strategy?.context?.meta?.currentPrice) ??
    asNumber(engine23?.currentPrice) ??
    asNumber(marketMeter?.layers?.emaPosture?.tenMinute?.close) ??
    asNumber(marketMeter?.layers?.tenMinuteEma10?.close) ??
    null
  );
}

function getEmaPosture(marketMeter) {
  const posture = marketMeter?.layers?.emaPosture || {};

  return {
    tenMinute:
      posture?.tenMinute ||
      marketMeter?.layers?.tenMinuteEma10 ||
      null,
    oneHour:
      posture?.oneHour ||
      marketMeter?.layers?.oneHourEma10 ||
      null,
    fourHour:
      posture?.fourHour ||
      marketMeter?.layers?.fourHourEma10 ||
      null,
    daily:
      posture?.daily ||
      marketMeter?.layers?.dailyEma10 ||
      null,
  };
}

function getActiveDegreeState(engine22) {
  const waveFibState = engine22?.waveFibState || null;
  const activeDegree =
    waveFibState?.activeTradingDegree ||
    engine22?.activeTradingDegree ||
    "minute";

  const degreeState =
    waveFibState?.degrees?.[activeDegree] ||
    waveFibState?.degrees?.minute ||
    null;

  return {
    waveFibState,
    activeDegree,
    degreeState,
    extensionProgress: degreeState?.extensionProgress || null,
    fibPressure: degreeState?.fibPressure || null,
    fibProjection: degreeState?.fibProjection || null,
  };
}

function hasPostExtensionPullback(extensionProgress) {
  return String(extensionProgress?.state || "").toUpperCase() === "POST_EXTENSION_PULLBACK";
}

function hasExtensionTagged(extensionProgress) {
  const state = String(extensionProgress?.state || "").toUpperCase();
  return state === "POST_EXTENSION_PULLBACK" || state === "EXTENSION_TAGGED_ACTIVE";
}

function buildExtensionProgressRead({ activeDegree, extensionProgress }) {
  if (!extensionProgress?.ok || !extensionProgress?.active) return null;

  const degreeName = String(activeDegree || extensionProgress.degree || "degree").toUpperCase();
  const activeWave = extensionProgress.activeWave || "extension";
  const hit = extensionProgress.highestExtensionHit || "extension";
  const hitPrice = extensionProgress.highestExtensionPrice;
  const retraceZone = extensionProgress.currentRetraceZone;

  if (hasPostExtensionPullback(extensionProgress)) {
    return `${degreeName} ${activeWave} already tagged the ${hit} extension near ${
      hitPrice ?? "unknown"
    } and is now pulling back${
      retraceZone?.label ? ` near the ${retraceZone.label} retrace zone` : ""
    }.`;
  }

  if (hasExtensionTagged(extensionProgress)) {
    return `${degreeName} ${activeWave} has tagged the ${hit} extension near ${
      hitPrice ?? "unknown"
    }. Monitor reaction versus continuation.`;
  }

  return extensionProgress.read || null;
}

function buildBias({
  engine15Decision,
  engine23,
  marketRegime,
  emaPosture,
  extensionProgress,
}) {
  const decisionAction = String(engine15Decision?.action || "").toUpperCase();
  const decisionDirection = String(engine15Decision?.direction || "").toUpperCase();
  const engine23Environment = String(engine23?.environment || "").toUpperCase();
  const marketDirection = String(marketRegime?.directionBias || "").toUpperCase();

  const tenMinState = String(emaPosture?.tenMinute?.state || "").toUpperCase();
  const oneHourState = String(emaPosture?.oneHour?.state || "").toUpperCase();
  const fourHourState = String(emaPosture?.fourHour?.state || "").toUpperCase();
  const dailyState = String(emaPosture?.daily?.state || "").toUpperCase();

  if (hasPostExtensionPullback(extensionProgress)) {
    return {
      bias: "PULLBACK_RETRACE_WATCH",
      action: "WAIT_FOR_W4_SUPPORT_RECLAIM",
      confidence: "MEDIUM",
      reason:
        "Engine 22 extension progress says the active impulse already tagged an extension and is now pulling back into retrace territory.",
    };
  }

  if (hasExtensionTagged(extensionProgress)) {
    return {
      bias: "EXTENSION_TAGGED_NO_CHASE",
      action: "WAIT_FOR_REACTION_OR_CONTROLLED_PULLBACK",
      confidence: "MEDIUM",
      reason:
        "Engine 22 extension progress says price has tagged an extension level; chase risk is elevated until a controlled pullback or reclaim forms.",
    };
  }

  if (
    decisionAction === "WATCH" &&
    decisionDirection === "LONG" &&
    engine23Environment.includes("W2")
  ) {
    return {
      bias: "LONG_WATCH",
      action: "WAIT",
      confidence: marketDirection === "SHORT" ? "MEDIUM_LOW" : "MEDIUM",
      reason: "Engine 23 has a constructive W2-to-W3 setup, but Engine 15 is still WATCH.",
    };
  }

  if (tenMinState.includes("BELOW") && oneHourState.includes("BELOW")) {
    return {
      bias: "PULLBACK_WEAK",
      action: "WAIT",
      confidence: "MEDIUM",
      reason: "10m and 1h EMA posture are weak; wait for reclaim before acting.",
    };
  }

  if (fourHourState.includes("ABOVE") && dailyState.includes("ABOVE")) {
    return {
      bias: "HIGHER_TIMEFRAME_SUPPORTIVE",
      action: "WAIT_FOR_LOWER_TIMEFRAME_CONFIRMATION",
      confidence: "MEDIUM",
      reason: "4h and daily posture are supportive, but lower timeframe confirmation is needed.",
    };
  }

  return {
    bias: "NO_CLEAR_BOT_ACTION",
    action: "WAIT",
    confidence: "LOW",
    reason: "No clean read-only bot action from current engine state.",
  };
}

function buildKeyLevels(engine23) {
  const targets = engine23?.activeTargets || {};
  const weaknessZones = asArray(engine23?.weaknessZones);

  return {
    support: [
      asNumber(targets.r382),
      asNumber(targets.r500),
      asNumber(targets.r618),
    ].filter((x) => x != null),
    invalidation: asNumber(targets.invalidation),
    reference786: asNumber(targets.reference786),
    weaknessZones: weaknessZones.map((z) => ({
      label: z?.label || null,
      level: z?.level ?? null,
      meaning: z?.meaning || null,
    })),
  };
}

function buildNeeds({ engine15Decision, engine23, extensionProgress }) {
  const needs = [];

  const engine23Needs = asArray(engine23?.needs);
  needs.push(...engine23Needs);

  const reasonCodes = asArray(engine15Decision?.reasonCodes);

  if (hasPostExtensionPullback(extensionProgress)) {
    needs.push("W4_SUPPORT_OR_RECLAIM_CONFIRMATION");
    needs.push("ENGINE3_REACTION_CONFIRMATION");
    needs.push("ENGINE4_PARTICIPATION_CONFIRMATION");
  }

  if (hasExtensionTagged(extensionProgress) && !hasPostExtensionPullback(extensionProgress)) {
    needs.push("REACTION_OR_CONTROLLED_PULLBACK");
  }

  if (reasonCodes.includes("TEN_MIN_BELOW_EMA10_EMA20_NO_TRIGGER")) {
    needs.push("10M_RECLAIM_EMA10_EMA20");
  }

  if (reasonCodes.includes("ONE_HOUR_BELOW_EMA10_PULLBACK_WEAK")) {
    needs.push("1H_RECLAIM_OR_STABILIZATION");
  }

  if (reasonCodes.includes("ENGINE4_PARTICIPATION_NOT_CONFIRMED")) {
    needs.push("ENGINE4_PARTICIPATION_CONFIRMATION");
  }

  if (!needs.includes("ENGINE15_READY_OR_PAPER_READY")) {
    needs.push("ENGINE15_READY_OR_PAPER_READY");
  }

  return [...new Set(needs)];
}

function buildWarnings({
  marketRegime,
  engine15Decision,
  engine23,
  emaPosture,
  extensionProgress,
}) {
  const warnings = [];

  const marketDirection = String(marketRegime?.directionBias || "").toUpperCase();
  const strictness = String(marketRegime?.strictness || "").toUpperCase();

  if (hasPostExtensionPullback(extensionProgress)) {
    warnings.push("Active impulse already tagged an extension and is now pulling back; do not chase.");
  }

  if (hasExtensionTagged(extensionProgress)) {
    warnings.push("Extension level has already been tagged; wait for reaction, support, or reclaim.");
  }

  if (marketDirection === "SHORT") {
    warnings.push("Market regime direction is short while Engine 23 is watching a long wave setup.");
  }

  if (strictness === "HIGH") {
    warnings.push("Market regime strictness is high; require better confirmation.");
  }

  const reasonCodes = asArray(engine15Decision?.reasonCodes);

  if (reasonCodes.includes("TEN_MIN_BELOW_EMA10_EMA20_NO_TRIGGER")) {
    warnings.push("10m trigger layer is not reclaimed yet.");
  }

  if (reasonCodes.includes("ONE_HOUR_BELOW_EMA10_PULLBACK_WEAK")) {
    warnings.push("1h pullback layer is still weak.");
  }

  if (engine23?.chaseAllowed === false) {
    warnings.push("Engine 23 says no chase.");
  }

  const tenMinState = String(emaPosture?.tenMinute?.state || "").toUpperCase();
  if (tenMinState.includes("BELOW")) {
    warnings.push("ES is below 10m EMA posture; wait for reclaim or support reaction.");
  }

  return [...new Set(warnings)];
}

function buildHeadline({ engine23, bias, extensionProgress }) {
  if (hasPostExtensionPullback(extensionProgress)) {
    return "W3 extension tagged — W4 pullback watch";
  }

  if (hasExtensionTagged(extensionProgress)) {
    return "Extension tagged — no chase";
  }

  if (engine23?.environment === "W2_PULLBACK") {
    return "Minute W2 pullback active — wait for support or reclaim";
  }

  if (engine23?.environment === "W4_PULLBACK") {
    return "W4 pullback active — late-cycle W5 watch";
  }

  if (engine23?.environment === "W5_EXTENSION") {
    return "W5 extension active — chase risk / protect gains";
  }

  return pretty(bias, "No clear AI bot setup");
}

function buildExtensionSummary({ symbol, price, extensionProgress, engine15Decision, emaPosture }) {
  const decisionText = `${text(engine15Decision?.action, "WAIT")} / ${text(
    engine15Decision?.direction,
    "NONE"
  )}`;

  const tenMinText = text(emaPosture?.tenMinute?.state, "UNKNOWN");
  const oneHourText = text(emaPosture?.oneHour?.state, "UNKNOWN");
  const fourHourText = text(emaPosture?.fourHour?.state, "UNKNOWN");
  const dailyText = text(emaPosture?.daily?.state, "UNKNOWN");

  const read = trimEndingPeriod(extensionProgress?.read);

  const retraceZone = extensionProgress?.currentRetraceZone;
  const retraceText = retraceZone?.label
    ? `${retraceZone.label} near ${retraceZone.price}`
    : "active retrace zone unavailable";

  return `${symbol} is in a read-only pullback watch at ${
    price ?? "unknown price"
  }. ${read}. Current likely retrace area is ${retraceText}. Engine 15 decision is ${decisionText}, so this is not an automatic trade. EMA posture: 10m ${tenMinText}, 1h ${oneHourText}, 4h ${fourHourText}, daily ${dailyText}. Do not chase the completed extension; wait for W4 support, reclaim, Engine 3 reaction, Engine 4 participation, and Engine 15 readiness.`;
}

function buildSummary({
  symbol,
  price,
  engine15Decision,
  engine23,
  marketRegime,
  emaPosture,
  biasResult,
  keyLevels,
  extensionProgress,
}) {
  if (hasPostExtensionPullback(extensionProgress)) {
    return buildExtensionSummary({
      symbol,
      price,
      extensionProgress,
      engine15Decision,
      emaPosture,
    });
  }

  const supportText =
    keyLevels.support.length > 0
      ? keyLevels.support.join(" / ")
      : "active support zone unavailable";

  const weaknessText =
    keyLevels.weaknessZones.length > 0
      ? keyLevels.weaknessZones.map((z) => z.level).filter(Boolean).join(" / ")
      : "higher weakness zones unavailable";

  const decisionText = `${text(engine15Decision?.action, "WAIT")} / ${text(
    engine15Decision?.direction,
    "NONE"
  )}`;

  const regimeText = `${text(marketRegime?.regime, "UNKNOWN")} / ${text(
    marketRegime?.directionBias,
    "UNKNOWN"
  )} / strictness ${text(marketRegime?.strictness, "UNKNOWN")}`;

  const tenMinText = text(emaPosture?.tenMinute?.state, "UNKNOWN");
  const oneHourText = text(emaPosture?.oneHour?.state, "UNKNOWN");
  const fourHourText = text(emaPosture?.fourHour?.state, "UNKNOWN");
  const dailyText = text(emaPosture?.daily?.state, "UNKNOWN");

  const engine23Summary =
    trimEndingPeriod(engine23?.summary) || "wave behavior read unavailable";

  return `${symbol} is in a read-only ${biasResult.bias} context at ${
    price ?? "unknown price"
  }. Engine 23 says: ${engine23Summary}. Engine 15 decision is ${decisionText}, so this is not an automatic trade. Market regime is ${regimeText}. EMA posture: 10m ${tenMinText}, 1h ${oneHourText}, 4h ${fourHourText}, daily ${dailyText}. Watch support at ${supportText}; weakness/chase-risk zones begin near ${weaknessText}. Wait for the needed confirmations before acting.`;
}

function buildAiReasoning({
  engine15Decision,
  engine23,
  marketRegime,
  emaPosture,
  keyLevels,
  biasResult,
  extensionProgress,
}) {
  if (hasPostExtensionPullback(extensionProgress)) {
    return {
      read: "POST_EXTENSION_PULLBACK_WATCH",
      bestScenario:
        "W4 pullback holds a clean retrace zone, lower timeframe reclaim confirms support, Engine 3 reaction improves, Engine 4 participation confirms, and Engine 15 moves from blocked/watch into readiness.",
      dangerScenario:
        "The pullback loses the key retrace zone without reclaim, turning the extension tag into a deeper correction or failed continuation.",
      confirmationNeeded: [
        "W4 support/retrace zone holds",
        "10m reclaim or stabilization",
        "Engine 3 reaction confirmation",
        "Engine 4 participation confirmation",
        "Engine 15 readiness",
      ],
      avoid: [
        "Do not chase after extension tag",
        "Do not force long while Engine 15 is blocked",
        "Do not override permission controls",
      ],
      invalidationRead:
        "Use the active W4 retrace zone and Engine 15/16 permission as the next decision boundary.",
      confidenceNote:
        "Confidence is MEDIUM because Engine 22 confirms a completed extension tag and pullback, but execution still requires support/reclaim and readiness confirmation.",
    };
  }

  const env = String(engine23?.environment || "").toUpperCase();
  const action = String(engine15Decision?.action || "").toUpperCase();
  const direction = String(engine15Decision?.direction || "").toUpperCase();
  const marketDir = String(marketRegime?.directionBias || "").toUpperCase();
  const regime = String(marketRegime?.regime || "").toUpperCase();
  const strictness = String(marketRegime?.strictness || "").toUpperCase();

  const tenMin = String(emaPosture?.tenMinute?.state || "").toUpperCase();
  const oneHour = String(emaPosture?.oneHour?.state || "").toUpperCase();

  const lowerTfWeak =
    tenMin.includes("BELOW") || oneHour.includes("BELOW");

  const supportText =
    keyLevels.support.length > 0
      ? keyLevels.support.join(" / ")
      : "active support zone unavailable";

  const weaknessText =
    keyLevels.weaknessZones.length > 0
      ? keyLevels.weaknessZones.map((z) => z.level).filter(Boolean).join(" / ")
      : "higher weakness zones unavailable";

  const invalidationRead =
    keyLevels.invalidation != null
      ? `W2 setup is damaged if price loses ${keyLevels.invalidation}.`
      : "Active invalidation level is unavailable.";

  if (
    env === "W2_PULLBACK" &&
    action === "WATCH" &&
    direction === "LONG" &&
    (marketDir === "SHORT" || lowerTfWeak)
  ) {
    return {
      read: "CONSTRUCTIVE_BUT_NOT_READY",
      bestScenario: `Minute W2 support holds near ${supportText}, then 10m and 1h reclaim confirm a possible W3 attempt.`,
      dangerScenario: `Price loses W2 support while market regime remains ${regime || "UNKNOWN"} / ${marketDir || "UNKNOWN"} / ${strictness || "UNKNOWN"} strictness.`,
      confirmationNeeded: [
        "10m reclaim EMA10/EMA20",
        "1h stabilization or reclaim",
        "Engine 4 participation confirmation",
        "Engine 15 confirms readiness",
      ],
      avoid: [
        `Do not chase into ${weaknessText}`,
        "Do not long while 10m and 1h are weak without reclaim",
        "Do not override Engine 15",
      ],
      invalidationRead,
      confidenceNote:
        "Confidence is MEDIUM_LOW because Engine 23 is constructive but market regime direction is SHORT and lower timeframes are weak.",
    };
  }

  return {
    read: "WAIT_FOR_CLEARER_ALIGNMENT",
    bestScenario: "Engines align and Engine 15 confirms readiness.",
    dangerScenario:
      "Mixed engine state persists or price violates active invalidation.",
    confirmationNeeded: buildNeeds({ engine15Decision, engine23, extensionProgress }),
    avoid: [
      "Do not override Engine 15",
      "Do not chase without confirmation",
    ],
    invalidationRead,
    confidenceNote: `AI reasoning is limited because the current setup is not fully aligned. Current bias is ${biasResult?.bias || "UNKNOWN"}.`,
  };
}

export function buildAiTradeCopilotRead(input = {}) {
  const {
    symbol = "ES",
    strategy = null,
    marketRegime = null,
    marketMeter = null,
  } = input;

  const engine15 = strategy?.engine15 || null;
  const engine15Decision = strategy?.engine15Decision || null;
  const engine22 = strategy?.engine22WaveStrategy || null;
  const engine23 = strategy?.engine23Interpretation || null;

  const {
    activeDegree,
    degreeState,
    extensionProgress,
    fibPressure,
  } = getActiveDegreeState(engine22);

  const emaPosture = getEmaPosture(marketMeter);
  const price = pickEsPrice({ strategy, engine23, engine22, marketMeter });

  if (!strategy || !engine23) {
    return {
      ok: false,
      engine: ENGINE_NAME,
      mode: READ_ONLY_MODE,
      symbol,
      headline: "AI Trade Copilot waiting for Engine 23",
      bias: "UNKNOWN",
      action: "WAIT",
      confidence: "LOW",
      shouldChase: false,
      summary: "AI Trade Copilot needs strategy and Engine 23 interpretation before it can produce a read-only setup read.",
      reasonCodes: ["MISSING_STRATEGY_OR_ENGINE23"],
    };
  }

  const biasResult = buildBias({
    engine15Decision,
    engine23,
    marketRegime,
    emaPosture,
    extensionProgress,
  });

  const keyLevels = buildKeyLevels(engine23);
  const needs = buildNeeds({ engine15Decision, engine23, extensionProgress });
  const warnings = buildWarnings({
    marketRegime,
    engine15Decision,
    engine23,
    emaPosture,
    extensionProgress,
  });

  const aiReasoning = buildAiReasoning({
    engine15Decision,
    engine23,
    marketRegime,
    emaPosture,
    keyLevels,
    biasResult,
    extensionProgress,
  });

  const extensionRead = buildExtensionProgressRead({
    activeDegree,
    extensionProgress,
  });

  const setupRead =
    extensionRead ||
    extensionProgress?.read ||
    engine23?.summary ||
    null;

  return {
    ok: true,
    engine: ENGINE_NAME,
    mode: READ_ONLY_MODE,
    symbol,
    headline: buildHeadline({
      engine23,
      bias: biasResult.bias,
      extensionProgress,
    }),
    bias: biasResult.bias,
    action: biasResult.action,
    confidence: biasResult.confidence,
    shouldChase: false,
    price,
    setupRead,

    engine15: {
      readiness: engine15?.readiness || null,
      action: engine15Decision?.action || null,
      direction: engine15Decision?.direction || null,
      readinessLabel: engine15Decision?.readinessLabel || null,
    },

    engine22: {
      activeDegree,
      phase: degreeState?.phase || null,
      state: degreeState?.state || null,
      fibPressure: fibPressure || null,
      extensionProgress: extensionProgress || null,
    },

    engine23: {
      environment: engine23?.environment || null,
      state: engine23?.state || null,
      health: engine23?.health || null,
      activeStructure: engine23?.activeStructure || null,
      recentCompletion: engine23?.recentCompletion || null,
      higherContext: engine23?.higherContext || null,
    },

    marketRegime: {
      regime: marketRegime?.regime || null,
      directionBias: marketRegime?.directionBias || null,
      strictness: marketRegime?.strictness || null,
    },

    emaPosture: {
      tenMinute: emaPosture?.tenMinute?.state || null,
      oneHour: emaPosture?.oneHour?.state || null,
      fourHour: emaPosture?.fourHour?.state || null,
      daily: emaPosture?.daily?.state || null,
    },

    keyLevels,
    needs,
    warnings,
    aiReasoning,

    reasonCodes: [
      "READ_ONLY_AI_COPILOT",
      extensionProgress?.state ? `ENGINE22_${extensionProgress.state}` : null,
      biasResult.reason,
      ...asArray(engine15Decision?.reasonCodes).slice(0, 8),
    ].filter(Boolean),

    summary: buildSummary({
      symbol,
      price,
      engine15Decision,
      engine23,
      marketRegime,
      emaPosture,
      biasResult,
      keyLevels,
      extensionProgress,
    }),
  };
}

export default buildAiTradeCopilotRead;
