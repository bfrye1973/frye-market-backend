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
