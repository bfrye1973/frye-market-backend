// services/core/logic/engine23/interpretation/interpretWaveEnvironment.js

const ENGINE_NAME = "engine23.waveBehaviorInterpreter.v1";
const READ_ONLY_MODE = "READ_ONLY";

const W5_STATES = {
  EXTENSION_HEALTHY: "W5_EXTENSION_HEALTHY",
  RECLAIM_WATCH: "W5_RECLAIM_WATCH",
  CONTROLLED_PULLBACK: "W5_CONTROLLED_PULLBACK",
  EXHAUSTION_RISK: "W5_EXHAUSTION_RISK",
  FAILED_RECLAIM: "W5_FAILED_RECLAIM",
  UNKNOWN: "W5_UNKNOWN",
};

const W2_STATES = {
  PULLBACK_ABOVE_ZONE: "W2_PULLBACK_ABOVE_ZONE",
  PULLBACK_IN_ZONE: "W2_PULLBACK_IN_ZONE",
  DEEP_PULLBACK_RISK: "W2_DEEP_PULLBACK_RISK",
  INVALIDATED: "W2_INVALIDATED",
  UNKNOWN: "W2_UNKNOWN",
};

const HEALTH = {
  HEALTHY: "HEALTHY",
  CAUTION: "CAUTION",
  RISK: "RISK",
  UNKNOWN: "UNKNOWN",
};

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundToTick(value, tickSize = 0.25) {
  const n = asNumber(value);
  if (n === null) return null;
  return Math.round(n / tickSize) * tickSize;
}

function getDegree(degrees, degreeName) {
  if (!degrees || typeof degrees !== "object") return null;
  return degrees[degreeName] || null;
}

function getFibLevels(degree) {
  return degree?.fibProjection?.levels || {};
}

function getFibLevel(degree, key) {
  const levels = getFibLevels(degree);
  return asNumber(levels[key]);
}

function getWavePoint(degree, key) {
  if (!degree || typeof degree !== "object") return null;

  const direct = asNumber(degree[key]);
  if (direct !== null) return direct;

  const anchors = degree.anchors || degree.waveAnchors || degree.points || {};
  return asNumber(anchors[key]);
}

function detectActiveDegree(engine22WaveStrategy, degrees) {
  const fromEngine22 = engine22WaveStrategy?.activeTradingDegree;
  if (fromEngine22 && degrees?.[fromEngine22]) return fromEngine22;

  if (degrees?.minute?.fibProjection) return "minute";
  if (degrees?.minor?.fibProjection) return "minor";
  if (degrees?.micro?.fibProjection) return "micro";

  return null;
}

function detectHigherDegree(activeDegree, degrees) {
  if (activeDegree === "micro" && degrees?.minute?.fibProjection) return "minute";
  if (activeDegree === "minute" && degrees?.minor?.fibProjection) return "minor";
  if (activeDegree === "minor" && degrees?.intermediate?.fibProjection) return "intermediate";
  return null;
}

function buildTargetsForDegree(degreeName, degree) {
  if (!degreeName || !degree) return null;

  const levels = getFibLevels(degree);

  return {
    degree: degreeName,
    w3High: getWavePoint(degree, "w3") ?? getWavePoint(degree, "W3") ?? getFibLevel(degree, "e100"),
    w4Low: getWavePoint(degree, "w4") ?? getWavePoint(degree, "W4"),
    e100: asNumber(levels.e100),
    e1168: asNumber(levels.e1168),
    e1272: asNumber(levels.e1272),
    e1618: asNumber(levels.e1618),
    e200: asNumber(levels.e200),
    e2618: asNumber(levels.e2618),
  };
}

function hasActiveW5Context(engine22WaveStrategy) {
  const activeSetup = String(engine22WaveStrategy?.activeSetup || "").toUpperCase();
  const bias = String(engine22WaveStrategy?.bias || "").toUpperCase();
  const action = String(engine22WaveStrategy?.action || "").toUpperCase();

  return (
    activeSetup.includes("W5") ||
    activeSetup.includes("WAVE_5") ||
    activeSetup.includes("EXTENSION") ||
    bias.includes("CONTINUATION") ||
    action.includes("WATCH")
  );
}

function detectDirectionBias(engine22WaveStrategy) {
  const bias = String(engine22WaveStrategy?.bias || "").toUpperCase();
  const decisionDirection = String(engine22WaveStrategy?.tradeDecision?.direction || "").toUpperCase();

  if (decisionDirection === "LONG" || bias.includes("BULL")) return "LONG";
  if (decisionDirection === "SHORT" || bias.includes("BEAR")) return "SHORT";

  return "NEUTRAL";
}

function detectMissingMicroNeed(degrees) {
  const micro = getDegree(degrees, "micro");
  if (!micro || !micro.fibProjection) return true;
  return false;
}

function classifyW5Environment({
  price,
  activeTargets,
  engine22WaveStrategy,
  missingMicro,
}) {
  const currentPrice = asNumber(price);
  const activeSetup = String(engine22WaveStrategy?.activeSetup || "").toUpperCase();
  const action = String(engine22WaveStrategy?.action || "").toUpperCase();

  const w3High = asNumber(activeTargets?.w3High ?? activeTargets?.e100);
  const w4Low = asNumber(activeTargets?.w4Low);
  const e1168 = asNumber(activeTargets?.e1168);
  const e1272 = asNumber(activeTargets?.e1272);
  const e1618 = asNumber(activeTargets?.e1618);

  const reasonCodes = [];

  if (!currentPrice || !activeTargets) {
    return {
      state: W5_STATES.UNKNOWN,
      health: HEALTH.UNKNOWN,
      chaseAllowed: false,
      preferredEntry: "WAIT_FOR_CLEANER_WAVE_CONTEXT",
      reasonCodes: ["MISSING_PRICE_OR_TARGETS"],
    };
  }

  if (w4Low !== null && currentPrice < w4Low) {
    reasonCodes.push("PRICE_BELOW_W4_INVALIDATION_AREA");

    return {
      state: W5_STATES.FAILED_RECLAIM,
      health: HEALTH.RISK,
      chaseAllowed: false,
      preferredEntry: "WAIT_FOR_RECLAIM",
      reasonCodes,
    };
  }

  if (w3High !== null && currentPrice < w3High && action.includes("WATCH")) {
    reasonCodes.push("PRICE_BELOW_W3_RECLAIM_LEVEL");

    return {
      state: W5_STATES.RECLAIM_WATCH,
      health: HEALTH.CAUTION,
      chaseAllowed: false,
      preferredEntry: "RECLAIM_W3_HIGH_FIRST",
      reasonCodes,
    };
  }

  if (e1272 !== null && currentPrice >= e1272 && e1618 !== null && currentPrice < e1618) {
    reasonCodes.push("PRICE_TESTING_1272_EXTENSION");
    reasonCodes.push("NO_CHASE_EXTENSION");

    return {
      state: W5_STATES.EXHAUSTION_RISK,
      health: HEALTH.CAUTION,
      chaseAllowed: false,
      preferredEntry: "WAIT_FOR_PULLBACK_OR_ACCEPTANCE",
      reasonCodes,
    };
  }

  if (e1168 !== null && currentPrice >= e1168 && e1272 !== null && currentPrice < e1272) {
    reasonCodes.push("PRICE_BETWEEN_1168_AND_1272_EXTENSION");
    reasonCodes.push("WATCH_ACCEPTANCE_OR_REJECTION");

    return {
      state: missingMicro ? W5_STATES.RECLAIM_WATCH : W5_STATES.EXTENSION_HEALTHY,
      health: missingMicro ? HEALTH.CAUTION : HEALTH.HEALTHY,
      chaseAllowed: false,
      preferredEntry: "CONTROLLED_PULLBACK_OR_RECLAIM",
      reasonCodes,
    };
  }

  if (w3High !== null && currentPrice >= w3High && e1168 !== null && currentPrice < e1168) {
    reasonCodes.push("PRICE_RECLAIMED_W3_HIGH");
    reasonCodes.push("EARLY_W5_EXTENSION_ZONE");

    return {
      state: missingMicro ? W5_STATES.RECLAIM_WATCH : W5_STATES.CONTROLLED_PULLBACK,
      health: missingMicro ? HEALTH.CAUTION : HEALTH.HEALTHY,
      chaseAllowed: false,
      preferredEntry: "CONTROLLED_PULLBACK_OR_RECLAIM",
      reasonCodes,
    };
  }

  if (activeSetup.includes("W5") || activeSetup.includes("EXTENSION")) {
    reasonCodes.push("W5_EXTENSION_CONTEXT_ACTIVE");

    return {
      state: missingMicro ? W5_STATES.RECLAIM_WATCH : W5_STATES.EXTENSION_HEALTHY,
      health: missingMicro ? HEALTH.CAUTION : HEALTH.HEALTHY,
      chaseAllowed: false,
      preferredEntry: "CONTROLLED_PULLBACK_OR_RECLAIM",
      reasonCodes,
    };
  }

  return {
    state: W5_STATES.UNKNOWN,
    health: HEALTH.UNKNOWN,
    chaseAllowed: false,
    preferredEntry: "WAIT_FOR_CLEAR_W5_CONTEXT",
    reasonCodes: ["NO_CLEAR_W5_CONTEXT"],
  };
}

function hasActiveW2ToW3Context(engine22WaveStrategy) {
  const activeSetup = String(engine22WaveStrategy?.activeSetup || "").toUpperCase();
  return activeSetup.includes("W2_TO_W3") || activeSetup.includes("MINUTE_W2");
}

function buildPullbackTargetsFromFib(fib) {
  const f = fib?.fib || fib?.levels || fib || {};

  return {
    degree: fib?.meta?.degree || "minute",
    pullbackFor: "W2",
    r382: asNumber(f.r382),
    r500: asNumber(f.r500),
    r618: asNumber(f.r618),
    invalidation: asNumber(f.invalidation),
    reference786: asNumber(f.reference_786 ?? f.r786),
  };
}

function classifyW2PullbackEnvironment({ price, fib }) {
  const currentPrice = asNumber(price);
  const targets = buildPullbackTargetsFromFib(fib);

  const r382 = asNumber(targets.r382);
  const r618 = asNumber(targets.r618);
  const invalidation = asNumber(targets.invalidation);
  const reference786 = asNumber(targets.reference786);

  const reasonCodes = ["MINUTE_W2_TO_W3_ACTIVE"];

  if (!currentPrice || !r382 || !r618) {
    return {
      environment: "W2_PULLBACK",
      state: W2_STATES.UNKNOWN,
      health: HEALTH.UNKNOWN,
      preferredEntry: "WAIT_FOR_W2_FIB_DATA",
      pullbackTargets: targets,
      reasonCodes: [...reasonCodes, "MISSING_W2_FIB_LEVELS"],
    };
  }

  if (invalidation !== null && currentPrice <= invalidation) {
    return {
      environment: "W2_PULLBACK",
      state: W2_STATES.INVALIDATED,
      health: HEALTH.RISK,
      preferredEntry: "WAIT_FOR_NEW_WAVE_STRUCTURE",
      pullbackTargets: targets,
      reasonCodes: [...reasonCodes, "PRICE_BELOW_W2_INVALIDATION"],
    };
  }

  if (reference786 !== null && currentPrice <= reference786) {
    return {
      environment: "W2_PULLBACK",
      state: W2_STATES.DEEP_PULLBACK_RISK,
      health: HEALTH.RISK,
      preferredEntry: "WAIT_FOR_STRONG_RECLAIM",
      pullbackTargets: targets,
      reasonCodes: [...reasonCodes, "PRICE_NEAR_DEEP_786_RETRACE"],
    };
  }

  const lo = Math.min(r382, r618);
  const hi = Math.max(r382, r618);

  if (currentPrice >= lo && currentPrice <= hi) {
    return {
      environment: "W2_PULLBACK",
      state: W2_STATES.PULLBACK_IN_ZONE,
      health: HEALTH.CAUTION,
      preferredEntry: "WATCH_W2_SUPPORT_REACTION",
      pullbackTargets: targets,
      reasonCodes: [...reasonCodes, "PRICE_INSIDE_W2_RETRACE_ZONE"],
    };
  }

  if (currentPrice > hi) {
    return {
      environment: "W2_PULLBACK",
      state: W2_STATES.PULLBACK_ABOVE_ZONE,
      health: HEALTH.CAUTION,
      preferredEntry: "WAIT_FOR_PULLBACK_OR_RECLAIM",
      pullbackTargets: targets,
      reasonCodes: [...reasonCodes, "PRICE_ABOVE_IDEAL_W2_RETRACE_ZONE"],
    };
  }

  return {
    environment: "W2_PULLBACK",
    state: W2_STATES.DEEP_PULLBACK_RISK,
    health: HEALTH.RISK,
    preferredEntry: "WAIT_FOR_W2_STABILIZATION",
    pullbackTargets: targets,
    reasonCodes: [...reasonCodes, "PRICE_BELOW_IDEAL_W2_ZONE"],
  };
}

function buildW2Summary({ symbol, classification }) {
  const name = symbol || "ES";
  const t = classification?.pullbackTargets || {};

  if (classification.state === W2_STATES.PULLBACK_ABOVE_ZONE) {
    return `${name} completed a smaller micro 1–5 into the Minute W1 high. Minute W2 pullback is active, but price is still above the ideal W2 retracement zone. Watch ${t.r382} / ${t.r500} / ${t.r618}; do not chase long until W2 stabilizes and Engine 15 confirms.`;
  }

  if (classification.state === W2_STATES.PULLBACK_IN_ZONE) {
    return `${name} is inside the Minute W2 retracement zone. Watch reaction quality near ${t.r382} / ${t.r500} / ${t.r618}. A W3 attempt needs support, participation, and Engine 15 confirmation.`;
  }

  if (classification.state === W2_STATES.DEEP_PULLBACK_RISK) {
    return `${name} is in a deeper Minute W2 pullback. Watch ${t.reference786} and invalidation near ${t.invalidation}. No chase long until structure reclaims.`;
  }

  if (classification.state === W2_STATES.INVALIDATED) {
    return `${name} broke the Minute W2 invalidation area near ${t.invalidation}. Current W2-to-W3 setup is damaged until a new wave structure forms.`;
  }

  return `${name} is in Minute W2-to-W3 context, but Engine 23 needs clearer W2 fib data before giving a clean behavior read.`;
}

function buildNeeds({ missingMicro }) {
  const needs = [];

  if (missingMicro) {
    needs.push("MICRO_STRUCTURE_CONFIRMATION");
  }

  needs.push("ENGINE3_REACTION_CONFIRMATION");
  needs.push("ENGINE4_PARTICIPATION_CONFIRMATION");
  needs.push("ENGINE15_READY_OR_PAPER_READY");

  return needs;
}

function buildHigherDegreeContext(higherDegreeName) {
  if (!higherDegreeName) return null;
  return `${higherDegreeName} W5 active`;
}

function buildSummary({
  symbol,
  activeDegree,
  higherDegree,
  state,
  health,
  activeTargets,
  higherTargets,
  missingMicro,
}) {
  const name = symbol || "ES";

  if (!activeDegree || !activeTargets) {
    return `${name} does not have enough confirmed Engine 22 wave/fib data for Engine 23 to read the W5 environment.`;
  }

  const activeText = `${activeDegree} targets are the immediate execution map`;
  const higherText = higherDegree
    ? `${higherDegree} targets are higher-degree context`
    : "no higher-degree target context is confirmed yet";

  if (state === W5_STATES.FAILED_RECLAIM) {
    return `${name} is losing the active W5 reclaim/invalidation area. Treat this as failed reclaim risk until Engine 22 and Engine 15 confirm otherwise.`;
  }

  if (state === W5_STATES.EXHAUSTION_RISK) {
    return `${name} is extended into active W5 target territory. ${activeText}. Watch acceptance or rejection; do not chase without confirmation.`;
  }

  if (state === W5_STATES.CONTROLLED_PULLBACK) {
    return `${name} is holding a controlled W5 structure. ${activeText}. ${higherText}. Watch for continuation confirmation.`;
  }

  if (state === W5_STATES.RECLAIM_WATCH) {
    const microText = missingMicro
      ? " Micro structure is not confirmed yet, so this remains a watch state."
      : "";

    return `${name} is in ${activeDegree} W5 context${higherDegree ? ` inside larger ${higherDegree} W5 context` : ""}. ${activeText}. ${higherText}.${microText} Watch continuation, but do not chase without confirmation.`;
  }

  if (health === HEALTH.HEALTHY) {
    return `${name} has a healthy W5 extension read. ${activeText}. ${higherText}. Continue to require Engine 3, Engine 4, and Engine 15 confirmation.`;
  }

  return `${name} has unclear W5 behavior. Engine 23 is read-only and will wait for cleaner Engine 22 structure confirmation.`;
}

export function interpretWaveEnvironment(input = {}) {
  const {
    symbol = "ES",
    price,
    engine22WaveStrategy,
    fib,
  } = input;

  if (!engine22WaveStrategy || typeof engine22WaveStrategy !== "object") {
    return {
      ok: false,
      engine: ENGINE_NAME,
      mode: READ_ONLY_MODE,
      symbol,
      environment: "UNKNOWN",
      state: W5_STATES.UNKNOWN,
      health: HEALTH.UNKNOWN,
      directionBias: "NEUTRAL",
      activeDegree: null,
      higherDegreeContext: null,
      chaseAllowed: false,
      preferredEntry: "WAIT_FOR_ENGINE22_WAVE_STRATEGY",
      activeTargets: null,
      higherTargets: null,
      needs: ["ENGINE22_WAVE_STRATEGY"],
      reasonCodes: ["MISSING_ENGINE22_WAVE_STRATEGY"],
      summary: "Engine 23 needs Engine 22 wave strategy data before it can interpret wave behavior.",
    };
  }

  const currentPrice = asNumber(price ?? engine22WaveStrategy.currentPrice);
  const degrees = engine22WaveStrategy?.waveFibState?.degrees || {};

  const activeDegree = detectActiveDegree(engine22WaveStrategy, degrees);
  const higherDegree = detectHigherDegree(activeDegree, degrees);

  const activeDegreeData = getDegree(degrees, activeDegree);
  const higherDegreeData = getDegree(degrees, higherDegree);

  const activeTargets = buildTargetsForDegree(activeDegree, activeDegreeData);
  const higherTargets = buildTargetsForDegree(higherDegree, higherDegreeData);

  const missingMicro = detectMissingMicroNeed(degrees);
  const directionBias = detectDirectionBias(engine22WaveStrategy);

  const w2ToW3ContextActive = hasActiveW2ToW3Context(engine22WaveStrategy);

  if (w2ToW3ContextActive) {
    const classification = classifyW2PullbackEnvironment({
      price: currentPrice,
      fib,
    });

  const roundedPullbackTargets = classification.pullbackTargets
    ? Object.fromEntries(
        Object.entries(classification.pullbackTargets).map(([key, value]) => [
          key,
          typeof value === "number" ? roundToTick(value) : value,
        ])
      )
    : null;

  return {
    ok: true,
    engine: ENGINE_NAME,
    mode: READ_ONLY_MODE,
    symbol,
    environment: classification.environment,
    state: classification.state,
    health: classification.health,
    directionBias: "LONG",
    activeDegree,
    higherDegreeContext: buildHigherDegreeContext(higherDegree),
    chaseAllowed: false,
    preferredEntry: classification.preferredEntry,
    activeTargets: roundedPullbackTargets,
    higherTargets: buildTargetsForDegree(higherDegree, higherDegreeData),
    needs: buildNeeds({ missingMicro: false }),
    reasonCodes: [...new Set([
      "MICRO_COMPLETE_W5",
      "MINUTE_W1_COMPLETE",
      ...classification.reasonCodes,
      "READ_ONLY_INTERPRETATION",
      "NO_CHASE_EXTENSION",
    ])],
    summary: buildW2Summary({
      symbol,
      classification: {
        ...classification,
        pullbackTargets: roundedPullbackTargets,
      },
    }),
  };
}

const w5ContextActive = hasActiveW5Context(engine22WaveStrategy);

  const classification = w5ContextActive
    ? classifyW5Environment({
        price: currentPrice,
        activeTargets,
        engine22WaveStrategy,
        missingMicro,
      })
    : {
        state: W5_STATES.UNKNOWN,
        health: HEALTH.UNKNOWN,
        chaseAllowed: false,
        preferredEntry: "WAIT_FOR_W5_CONTEXT",
        reasonCodes: ["ENGINE22_W5_CONTEXT_NOT_ACTIVE"],
      };

  const needs = buildNeeds({ missingMicro });

  const reasonCodes = [
    ...(higherDegree ? ["HIGHER_DEGREE_W5_ACTIVE"] : []),
    ...(activeDegree ? [`${String(activeDegree).toUpperCase()}_W5_EXTENSION_ACTIVE`] : []),
    ...classification.reasonCodes,
    "READ_ONLY_INTERPRETATION",
  ];

  if (classification.chaseAllowed === false && !reasonCodes.includes("NO_CHASE_EXTENSION")) {
    reasonCodes.push("NO_CHASE_EXTENSION");
  }

  const roundedActiveTargets = activeTargets
    ? Object.fromEntries(
        Object.entries(activeTargets).map(([key, value]) => [
          key,
          typeof value === "number" ? roundToTick(value) : value,
        ])
      )
    : null;

  const roundedHigherTargets = higherTargets
    ? Object.fromEntries(
        Object.entries(higherTargets).map(([key, value]) => [
          key,
          typeof value === "number" ? roundToTick(value) : value,
        ])
      )
    : null;

  const summary = buildSummary({
    symbol,
    activeDegree,
    higherDegree,
    state: classification.state,
    health: classification.health,
    activeTargets: roundedActiveTargets,
    higherTargets: roundedHigherTargets,
    missingMicro,
  });

  return {
    ok: true,
    engine: ENGINE_NAME,
    mode: READ_ONLY_MODE,
    symbol,
    environment: w5ContextActive ? "W5_EXTENSION" : "UNKNOWN",
    state: classification.state,
    health: classification.health,
    directionBias,
    activeDegree,
    higherDegreeContext: buildHigherDegreeContext(higherDegree),
    chaseAllowed: false,
    preferredEntry: classification.preferredEntry,
    activeTargets: roundedActiveTargets,
    higherTargets: roundedHigherTargets,
    needs,
    reasonCodes: [...new Set(reasonCodes)],
    summary,
  };
}

export default interpretWaveEnvironment;
