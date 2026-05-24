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

const W4_STATES = {
  RECLAIM_WATCH: "W4_RECLAIM_WATCH",
  SUPPORT_TEST: "W4_SUPPORT_TEST",
  DEEP_PULLBACK_RISK: "W4_DEEP_PULLBACK_RISK",
  INVALIDATED: "W4_INVALIDATED",
  UNKNOWN: "W4_UNKNOWN",
};

const HEALTH = {
  HEALTHY: "HEALTHY",
  CAUTION: "CAUTION",
  RISK: "RISK",
  UNKNOWN: "UNKNOWN",
};

const DEGREE_ORDER = ["primary", "intermediate", "minor", "minute", "micro"];

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundToTick(value, tickSize = 0.25) {
  const n = asNumber(value);
  if (n === null) return null;
  return Math.round(n / tickSize) * tickSize;
}

function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function cleanPhaseLabel(phase) {
  return String(phase || "UNKNOWN")
    .replace(/^IN_/, "")
    .replace(/^COMPLETE_/, "COMPLETE_");
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

  if (degrees?.minute) return "minute";
  if (degrees?.minor) return "minor";
  if (degrees?.micro) return "micro";

  return null;
}

function detectHigherDegree(activeDegree, degrees) {
  if (activeDegree === "micro" && degrees?.minute) return "minute";
  if (activeDegree === "minute" && degrees?.minor) return "minor";
  if (activeDegree === "minor" && degrees?.intermediate) return "intermediate";
  if (activeDegree === "intermediate" && degrees?.primary) return "primary";
  return null;
}

function buildTargetsForDegree(degreeName, degree) {
  if (!degreeName || !degree) return null;

  const levels = getFibLevels(degree);

  return {
    degree: degreeName,
    w3High:
      getWavePoint(degree, "w3") ??
      getWavePoint(degree, "W3") ??
      getFibLevel(degree, "e100"),
    w4Low: getWavePoint(degree, "w4") ?? getWavePoint(degree, "W4"),
    e100: asNumber(levels.e100),
    e1168: asNumber(levels.e1168),
    e1272: asNumber(levels.e1272),
    e1618: asNumber(levels.e1618),
    e200: asNumber(levels.e200),
    e2618: asNumber(levels.e2618),
  };
}

function roundNumberFields(obj) {
  if (!obj || typeof obj !== "object") return null;

  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [
      key,
      typeof value === "number" ? roundToTick(value) : value,
    ])
  );
}

function hasActiveW5Context(engine22WaveStrategy) {
  const activeSetup = String(engine22WaveStrategy?.activeSetup || "").toUpperCase();
  const bias = String(engine22WaveStrategy?.bias || "").toUpperCase();

  return (
    activeSetup.includes("W5") ||
    activeSetup.includes("WAVE_5") ||
    activeSetup.includes("EXTENSION") ||
    bias.includes("CONTINUATION")
  );
}

function hasActiveW2ToW3Context(engine22WaveStrategy) {
  const activeSetup = String(engine22WaveStrategy?.activeSetup || "").toUpperCase();
  return activeSetup.includes("W2_TO_W3") || activeSetup.includes("MINUTE_W2");
}

function detectDirectionBias(engine22WaveStrategy) {
  const bias = String(engine22WaveStrategy?.bias || "").toUpperCase();
  const decisionDirection = String(
    engine22WaveStrategy?.tradeDecision?.direction || ""
  ).toUpperCase();

  if (decisionDirection === "LONG" || bias.includes("BULL")) return "LONG";
  if (decisionDirection === "SHORT" || bias.includes("BEAR")) return "SHORT";

  return "NEUTRAL";
}

function detectMissingMicroNeed(degrees) {
  const micro = getDegree(degrees, "micro");
  if (!micro) return true;
  return false;
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

function phaseForDegree({ degree, degrees, engine2State }) {
  return (
    degrees?.[degree]?.phase ||
    engine2State?.[degree]?.phase ||
    engine2State?.[`${degree}Phase`] ||
    "UNKNOWN"
  );
}

function parseActiveSetup(activeSetup) {
  const text = String(activeSetup || "").toUpperCase();

  const m = text.match(/(PRIMARY|INTERMEDIATE|MINOR|MINUTE|MICRO)_W(\d)_TO_W(\d)/);

  if (!m) {
    return {
      raw: text || null,
      degree: null,
      fromWave: null,
      toWave: null,
      type: "UNKNOWN",
    };
  }

  return {
    raw: text,
    degree: m[1].toLowerCase(),
    fromWave: `W${m[2]}`,
    toWave: `W${m[3]}`,
    type: `W${m[2]}_TO_W${m[3]}`,
  };
}

function detectSetupFamily(engine22WaveStrategy) {
  const topLevelSetup = engine22WaveStrategy?.activeSetup;
  const fallbackSetup = engine22WaveStrategy?.waveFibState?.activeSetup;
  const raw = String(topLevelSetup || fallbackSetup || "").toUpperCase();

  const degreeMatch = raw.match(/(PRIMARY|INTERMEDIATE|MINOR|MINUTE|MICRO)/);
  const degree = degreeMatch ? degreeMatch[1].toLowerCase() : null;

  const isW2ToW3 =
    raw.includes("W2_TO_W3") ||
    (raw.includes("W2") && raw.includes("W3"));

  const isW4ToW5 =
    raw.includes("W4_TO_W5") ||
    (raw.includes("W4") && raw.includes("W5"));

  const isW5Extension =
    raw.includes("W5_EXTENSION") ||
    raw.includes("W5_CONTINUATION") ||
    raw.includes("EXTENSION");

  if (isW2ToW3) {
    return {
      raw: raw || null,
      family: "W2_TO_W3",
      degree,
      fromWave: "W2",
      toWave: "W3",
    };
  }

  if (isW4ToW5) {
    return {
      raw: raw || null,
      family: "W4_TO_W5",
      degree,
      fromWave: "W4",
      toWave: "W5",
    };
  }

  if (isW5Extension) {
    return {
      raw: raw || null,
      family: "W5_EXTENSION",
      degree,
      fromWave: "W5",
      toWave: null,
    };
  }

  return {
    raw: raw || null,
    family: "UNKNOWN",
    degree,
    fromWave: null,
    toWave: null,
  };
}

function buildWaveStack({ degrees, engine2State }) {
  const out = {};

  for (const degree of DEGREE_ORDER) {
    out[degree] = {
      degree,
      phase: phaseForDegree({ degree, degrees, engine2State }),
    };
  }

  return out;
}

function findRecentCompletion(waveStack) {
  const lowToHigh = ["micro", "minute", "minor", "intermediate", "primary"];

  for (const degree of lowToHigh) {
    const phase = String(waveStack?.[degree]?.phase || "").toUpperCase();

    if (phase === "COMPLETE_W5") {
      return {
        degree,
        wave: "W5",
        phase,
        meaning: `${titleCase(degree)} W5 completed; this may complete a larger impulse and start a pullback/digestion phase.`,
      };
    }
  }

  return null;
}

function findHigherContext({ activeDegree, waveStack }) {
  const idx = DEGREE_ORDER.indexOf(activeDegree);

  if (idx <= 0) return null;

  for (let i = idx - 1; i >= 0; i--) {
    const degree = DEGREE_ORDER[i];
    const phase = String(waveStack?.[degree]?.phase || "").toUpperCase();

    if (phase && phase !== "UNKNOWN") {
      return {
        degree,
        phase,
        label: `${titleCase(degree)} ${cleanPhaseLabel(phase)}`,
      };
    }
  }

  return null;
}

function buildWeaknessZones({ higherTargets }) {
  if (!higherTargets || typeof higherTargets !== "object") return [];

  const zones = [];

  if (higherTargets.e100 != null) {
    zones.push({
      label: "Prior Higher-Degree High / First Test",
      level: higherTargets.e100,
      meaning: "First area where continuation can stall or reject.",
    });
  }

  if (higherTargets.e1168 != null || higherTargets.e1272 != null) {
    zones.push({
      label: "Early Extension Weakness Zone",
      level:
        higherTargets.e1168 != null && higherTargets.e1272 != null
          ? `${higherTargets.e1168}–${higherTargets.e1272}`
          : higherTargets.e1168 ?? higherTargets.e1272,
      meaning: "Wave 5 can continue, but chase risk starts rising here.",
    });
  }

  if (higherTargets.e1618 != null) {
    zones.push({
      label: "Major Exhaustion Zone",
      level: higherTargets.e1618,
      meaning: "Stronger Wave 5 exhaustion/reversal risk.",
    });
  }

  if (higherTargets.e200 != null) {
    zones.push({
      label: "Very Stretched Extension",
      level: higherTargets.e200,
      meaning: "Very high chase risk; protect gains.",
    });
  }

  return zones;
}

function buildMultiDegreeContext({
  symbol,
  engine22WaveStrategy,
  degrees,
  engine2State,
  activeDegree,
  higherDegree,
  pullbackTargets,
  higherTargets,
}) {
  const activeSetup = parseActiveSetup(engine22WaveStrategy?.activeSetup);
  const waveStack = buildWaveStack({ degrees, engine2State });
  const recentCompletion = findRecentCompletion(waveStack);
  const higherContext = findHigherContext({
    activeDegree: activeSetup.degree || activeDegree,
    waveStack,
  });

  const weaknessZones = buildWeaknessZones({ higherTargets });

  return {
    symbol,
    waveStack,
    recentCompletion,
    activeStructure: {
      setup: activeSetup.raw,
      degree: activeSetup.degree || activeDegree,
      fromWave: activeSetup.fromWave,
      toWave: activeSetup.toWave,
      type: activeSetup.type,
      read:
        activeSetup.type === "W2_TO_W3"
          ? `${titleCase(activeSetup.degree || activeDegree)} W2 pullback is forming before a possible W3 launch.`
          : activeSetup.type === "W4_TO_W5"
          ? `${titleCase(activeSetup.degree || activeDegree)} W4 pullback is forming before a possible W5 launch.`
          : "Active wave setup is still forming.",
    },
    higherContext,
    pullbackTargets,
    weaknessZones,
  };
}

function buildMultiDegreeSummary({ symbol, multiDegreeContext }) {
  const name = symbol || "ES";
  const recent = multiDegreeContext?.recentCompletion;
  const active = multiDegreeContext?.activeStructure;
  const higher = multiDegreeContext?.higherContext;
  const t = multiDegreeContext?.pullbackTargets || {};
  const weakness = multiDegreeContext?.weaknessZones || [];

  const supportText =
    t.r382 != null && t.r500 != null && t.r618 != null
      ? `${t.r382} / ${t.r500} / ${t.r618}`
      : "the active pullback fib zone";

  const weakText =
    weakness.length > 0
      ? weakness.map((z) => z.level).join(" / ")
      : "higher-degree extension zones";

  return `${name} ${recent ? recent.meaning : "has a lower-degree impulse that may be completing."} ${active?.read || ""} ${higher ? `Higher context is ${higher.label}.` : ""} Watch pullback support at ${supportText}. Weakness/chase-risk zones begin near ${weakText}. Do not chase; wait for support, reclaim, and Engine 15 confirmation.`;
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

function buildW5Summary({
  symbol,
  activeDegree,
  higherDegree,
  state,
  health,
  activeTargets,
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
    engine2State = null,
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
  const setupFamily = detectSetupFamily(engine22WaveStrategy);

  if (
    setupFamily.family === "W2_TO_W3" ||
    hasActiveW2ToW3Context(engine22WaveStrategy)
  ) {
    const w2Classification = classifyW2PullbackEnvironment({
      price: currentPrice,
      fib,
    });

    const roundedPullbackTargets = roundNumberFields(w2Classification.pullbackTargets);
    const roundedHigherTargets = roundNumberFields(higherTargets);

    const multiDegreeContext = buildMultiDegreeContext({
      symbol,
      engine22WaveStrategy,
      degrees,
      engine2State,
      activeDegree,
      higherDegree,
      pullbackTargets: roundedPullbackTargets,
      higherTargets: roundedHigherTargets,
    });

    return {
      ok: true,
      engine: ENGINE_NAME,
      mode: READ_ONLY_MODE,
      symbol,
      environment: w2Classification.environment,
      state: w2Classification.state,
      health: w2Classification.health,
      directionBias: "LONG",
      activeDegree,
      higherDegreeContext: buildHigherDegreeContext(higherDegree),
      chaseAllowed: false,
      preferredEntry: w2Classification.preferredEntry,
      activeTargets: roundedPullbackTargets,
      higherTargets: roundedHigherTargets,
      recentCompletion: multiDegreeContext.recentCompletion,
      activeStructure: multiDegreeContext.activeStructure,
      higherContext: multiDegreeContext.higherContext,
      weaknessZones: multiDegreeContext.weaknessZones,
      waveStack: multiDegreeContext.waveStack,
      needs: buildNeeds({ missingMicro: false }),
      reasonCodes: [
        ...new Set([
          "MICRO_COMPLETE_W5",
          "MINUTE_W1_COMPLETE",
          ...w2Classification.reasonCodes,
          "READ_ONLY_INTERPRETATION",
          "NO_CHASE_EXTENSION",
        ]),
      ],
      summary: buildMultiDegreeSummary({
        symbol,
        multiDegreeContext,
      }),
    };
  }

  if (setupFamily.family === "W4_TO_W5") {
    const rawW4Targets = {
      degree: activeDegree,
      pullbackFor: "W4",
      support: null,
      reclaim: null,
      invalidation: null,
      source: "ENGINE22_LEVELS_UNAVAILABLE",
    };

    const roundedActiveTargets = roundNumberFields(rawW4Targets);
    const roundedHigherTargets = roundNumberFields(higherTargets);

    const multiDegreeContext = buildMultiDegreeContext({
      symbol,
      engine22WaveStrategy,
      degrees,
      engine2State,
      activeDegree,
      higherDegree,
      pullbackTargets: null,
      higherTargets: roundedHigherTargets,
    });

    return {
      ok: true,
      engine: ENGINE_NAME,
      mode: READ_ONLY_MODE,
      symbol,
      environment: "W4_PULLBACK",
      state: W4_STATES.RECLAIM_WATCH,
      health: HEALTH.CAUTION,
      directionBias: "LONG_AFTER_RECLAIM",
      activeDegree,
      higherDegreeContext: buildHigherDegreeContext(higherDegree),
      chaseAllowed: false,
      preferredEntry: "WAIT_FOR_W4_SUPPORT_OR_RECLAIM",
      activeTargets: roundedActiveTargets,
      higherTargets: roundedHigherTargets,
      recentCompletion: multiDegreeContext.recentCompletion,
      activeStructure: multiDegreeContext.activeStructure,
      higherContext: multiDegreeContext.higherContext,
      weaknessZones: multiDegreeContext.weaknessZones,
      waveStack: multiDegreeContext.waveStack,
      needs: [
        "W4_SUPPORT_HOLD",
        "RECLAIM_CONFIRMATION",
        "NO_CHASE_EXTENSION",
        "ENGINE15_READY_OR_PAPER_READY",
        "ENGINE3_REACTION_CONFIRMATION",
        "ENGINE4_PARTICIPATION_CONFIRMATION",
      ],
      reasonCodes: [
        "ENGINE22_ACTIVE_SETUP_W4_TO_W5",
        "LATE_CYCLE_W5_CONTEXT",
        "EXHAUSTION_AWARE",
        "NO_CHASE_LONG",
        "READ_ONLY_INTERPRETATION",
      ],
      summary: `${symbol} ${titleCase(activeDegree)} W4 pullback is forming before a possible W5 launch. Engine 23 is waiting for Engine 22 to expose W4 support, reclaim, and invalidation levels before labeling precise W4 trade zones. Higher-degree trend can still support continuation, but W5 is later-cycle and more exhaustion-sensitive. Do not chase into extension zones. Engine 15 remains the final readiness check.`,
    };
  }

  const w5ContextActive =
    setupFamily.family === "W5_EXTENSION" ||
    hasActiveW5Context(engine22WaveStrategy);

  const w5Classification = w5ContextActive
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

  const reasonCodes = [
    ...(higherDegree ? ["HIGHER_DEGREE_W5_ACTIVE"] : []),
    ...(activeDegree ? [`${String(activeDegree).toUpperCase()}_W5_EXTENSION_ACTIVE`] : []),
    ...w5Classification.reasonCodes,
    "READ_ONLY_INTERPRETATION",
  ];

  if (w5Classification.chaseAllowed === false && !reasonCodes.includes("NO_CHASE_EXTENSION")) {
    reasonCodes.push("NO_CHASE_EXTENSION");
  }

  const roundedActiveTargets = roundNumberFields(activeTargets);
  const roundedHigherTargets = roundNumberFields(higherTargets);

  const summary = buildW5Summary({
    symbol,
    activeDegree,
    higherDegree,
    state: w5Classification.state,
    health: w5Classification.health,
    activeTargets: roundedActiveTargets,
    missingMicro,
  });

  return {
    ok: true,
    engine: ENGINE_NAME,
    mode: READ_ONLY_MODE,
    symbol,
    environment: w5ContextActive ? "W5_EXTENSION" : "UNKNOWN",
    state: w5Classification.state,
    health: w5Classification.health,
    directionBias,
    activeDegree,
    higherDegreeContext: buildHigherDegreeContext(higherDegree),
    chaseAllowed: false,
    preferredEntry: w5Classification.preferredEntry,
    activeTargets: roundedActiveTargets,
    higherTargets: roundedHigherTargets,
    needs: buildNeeds({ missingMicro }),
    reasonCodes: [...new Set(reasonCodes)],
    summary,
  };
}

export default interpretWaveEnvironment;
