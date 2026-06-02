// services/core/logic/engine23/interpretation/interpretWaveEnvironment.js

const ENGINE_NAME = "engine23.waveBehaviorInterpreter.v1";
const READ_ONLY_MODE = "READ_ONLY";

const W5_STATES = {
  EXTENSION_HEALTHY: "W5_EXTENSION_HEALTHY",
  RECLAIM_WATCH: "W5_RECLAIM_WATCH",
  CONTROLLED_PULLBACK: "W5_CONTROLLED_PULLBACK",
  EXHAUSTION_RISK: "W5_EXHAUSTION_RISK",
  EXTENSION_DOUBLE_TOP_  
  
  REJECTION: "W5_EXTENSION_DOUBLE_TOP_REJECTION",
  FAILED_RECLAIM: "W5_FAILED_RECLAIM",
  UNKNOWN: "W5_UNKNOWN",
};

const W2_STATES = {
  INVALIDATED: "W2_INVALIDATED",
  DEEP_DANGER: "W2_DEEP_DANGER",
  SUPPORT_TEST: "W2_SUPPORT_TEST",
  PULLBACK_ABOVE_ZONE: "W2_PULLBACK_ABOVE_ZONE",
  PULLBACK_IN_ZONE: "W2_PULLBACK_IN_ZONE",
  DEEP_PULLBACK_RISK: "W2_DEEP_PULLBACK_RISK",
  RECLAIM_ATTEMPT: "W2_RECLAIM_ATTEMPT",
  IN_WEAKNESS_ZONE: "W2_TO_W3_IN_WEAKNESS_ZONE",
  REJECTION_RISK: "W2_TO_W3_REJECTION_RISK",
  ACCEPTANCE_WATCH: "W2_TO_W3_ACCEPTANCE_WATCH",
  EXTENSION_RISK: "W2_TO_W3_EXTENSION_RISK",
  UNKNOWN: "W2_UNKNOWN",
};

const W3_STATES = {
  EARLY_IMPULSE: "W3_EARLY_IMPULSE",
  IN_HIGHER_WEAKNESS_ZONE: "W3_IN_HIGHER_WEAKNESS_ZONE",
  REACTION_ZONE: "W3_REACTION_ZONE",
  ACCEPTANCE_WATCH: "W3_ACCEPTANCE_WATCH",
  EXTENSION_RISK: "W3_EXTENSION_RISK",
  EXHAUSTION_RISK: "W3_EXHAUSTION_RISK",
  UNKNOWN: "W3_UNKNOWN",
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

function getAnchorPoint(degree, key) {
  if (!degree || typeof degree !== "object") return null;
  const anchors = degree.anchors || degree.waveAnchors || degree.points || {};
  return asNumber(anchors[key] ?? anchors[String(key).toUpperCase()] ?? degree[key]);
}

function getDegreePhase({ degreeName, degrees, engine2State }) {
  return String(
    degrees?.[degreeName]?.phase ||
      engine2State?.[degreeName]?.phase ||
      engine2State?.[`${degreeName}Phase`] ||
      "UNKNOWN"
  ).toUpperCase();
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

function dedupe(xs = []) {
  return [...new Set(xs.filter(Boolean))];
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

function hasActiveW3ImpulseContext({ engine22WaveStrategy, degrees, engine2State }) {
  const activeSetup = String(engine22WaveStrategy?.activeSetup || "").toUpperCase();
  const activeDegree = String(engine22WaveStrategy?.activeTradingDegree || "").toLowerCase();
  const degreeName = activeDegree || "minute";
  const activePhase = getDegreePhase({ degreeName, degrees, engine2State });
  const minutePhase = getDegreePhase({ degreeName: "minute", degrees, engine2State });

  return (
    activeSetup.includes("IMPULSE") &&
    (activePhase === "IN_W3" || minutePhase === "IN_W3")
  );
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

function zoneObject(label, level, meaning = null, extra = {}) {
  if (level == null) return null;

  return {
    label,
    level,
    meaning,
    source: "ENGINE22_HIGHER_DEGREE_TARGETS",
    ...extra,
  };
}

function distanceToLevel(price, level) {
  const p = asNumber(price);
  const n = asNumber(level);

  if (p === null || n === null) return null;

  return Number((n - p).toFixed(2));
}

function getBarNumber(bar, keys = []) {
  if (!bar || typeof bar !== "object") return null;

  for (const key of keys) {
    const n = asNumber(bar?.[key]);
    if (n !== null) return n;
  }

  return null;
}

function getRecentBars10m({ barsByTf = {}, recentBars10m = null } = {}) {
  const direct = Array.isArray(recentBars10m) ? recentBars10m : null;
  if (direct && direct.length) return direct;

  const fromMap =
    barsByTf?.["10m"] ||
    barsByTf?.tenMinute ||
    barsByTf?.trigger10m ||
    null;

  return Array.isArray(fromMap) ? fromMap : [];
}

function detectExtensionDoubleTap({
  barsByTf = {},
  recentBars10m = null,
  activeTargets = null,
  currentPrice = null,
  tolerancePts = 2,
  lookbackBars = 60,
} = {}) {
  const bars = getRecentBars10m({ barsByTf, recentBars10m })
    .slice(-lookbackBars)
    .filter(Boolean);

  const lastBar = bars.length ? bars[bars.length - 1] : null;
  const lastClose =
    getBarNumber(lastBar, ["close", "c"]) ??
    asNumber(currentPrice);

  const levels = [
    {
      key: "e200",
      label: "2.000",
      level: asNumber(activeTargets?.e200),
    },
    {
      key: "e1618",
      label: "1.618",
      level: asNumber(activeTargets?.e1618),
    },
  ].filter((x) => x.level !== null);

  if (!bars.length || !levels.length) {
    return {
      active: false,
      pattern: "NONE",
      reason: !bars.length ? "NO_10M_BARS" : "NO_EXTENSION_LEVELS",
      barsChecked: bars.length,
      checkedLevels: levels,
    };
  }

  for (const levelInfo of levels) {
    const level = levelInfo.level;
    const clusters = [];
    let currentCluster = null;

    bars.forEach((bar, index) => {
      const high = getBarNumber(bar, ["high", "h"]);
      const close = getBarNumber(bar, ["close", "c"]);
      const time = bar?.time ?? bar?.t ?? bar?.tSec ?? null;

      if (high === null) return;

      const touched = high >= level - tolerancePts;

      if (!touched) return;

      const shouldStartNewCluster =
        !currentCluster ||
        index - currentCluster.lastIndex > 2;

      if (shouldStartNewCluster) {
        currentCluster = {
          firstIndex: index,
          lastIndex: index,
          firstTime: time,
          lastTime: time,
          maxHigh: high,
          lastClose: close,
          bars: 1,
        };
        clusters.push(currentCluster);
      } else {
        currentCluster.lastIndex = index;
        currentCluster.lastTime = time;
        currentCluster.maxHigh = Math.max(currentCluster.maxHigh, high);
        currentCluster.lastClose = close;
        currentCluster.bars += 1;
      }
    });

    const touchCount = clusters.length;
    const rejected =
      touchCount >= 2 &&
      lastClose !== null &&
      lastClose < level - tolerancePts;

    if (touchCount >= 2 && rejected) {
      const lastCluster = clusters[clusters.length - 1];

      return {
        active: true,
        pattern: "DOUBLE_TOP_EXTENSION_REJECTION",
        levelKey: levelInfo.key,
        levelLabel: levelInfo.label,
        level: roundToTick(level),
        tolerancePts,
        touchCount,
        rejected: true,
        failedAcceptance: true,
        lastClose: roundToTick(lastClose),
        lastTouchHigh: roundToTick(lastCluster?.maxHigh),
        firstTouchTime: clusters[0]?.firstTime ?? null,
        lastTouchTime: lastCluster?.lastTime ?? null,
        barsChecked: bars.length,
        reasonCodes: [
          `${String(levelInfo.key).toUpperCase()}_EXTENSION_TOUCHED_MULTIPLE_TIMES`,
          "DOUBLE_TOP_EXTENSION_REJECTION",
          "FAILED_ACCEPTANCE_ABOVE_EXTENSION",
          "NO_CHASE_EXTENSION",
        ],
        read: `Price tagged the ${levelInfo.label} extension near ${roundToTick(
          level
        )} ${touchCount === 2 ? "twice" : `${touchCount} times`} and failed to accept above it.`,
      };
    }
  }

  return {
    active: false,
    pattern: "NONE",
    reason: "NO_DOUBLE_TAP_EXTENSION_REJECTION",
    barsChecked: bars.length,
    checkedLevels: levels.map((x) => ({
      levelKey: x.key,
      levelLabel: x.label,
      level: roundToTick(x.level),
    })),
  };
}

function buildHigherTargetZones(higherTargets) {
  const firstWeakness = asNumber(higherTargets?.e100);
  const nextWeaknessLo = asNumber(higherTargets?.e1168);
  const nextWeaknessHi = asNumber(higherTargets?.e1272);
  const majorExhaustion = asNumber(higherTargets?.e1618);
  const stretchedExtension = asNumber(higherTargets?.e200);
  const extremeExtension = asNumber(higherTargets?.e2618);

  const firstWeaknessZone = zoneObject(
    "First Higher-Degree Weakness Zone",
    firstWeakness,
    "First area where continuation can stall or reject."
  );

  const nextReactionZone =
    nextWeaknessLo != null || nextWeaknessHi != null
      ? {
          label: "Next Higher-Degree Reaction Zone",
          level:
            nextWeaknessLo != null && nextWeaknessHi != null
              ? `${nextWeaknessLo}–${nextWeaknessHi}`
              : nextWeaknessLo ?? nextWeaknessHi,
          lo: nextWeaknessLo,
          hi: nextWeaknessHi,
          meaning: "Reaction zone where acceptance or rejection matters.",
          source: "ENGINE22_HIGHER_DEGREE_TARGETS",
        }
      : null;

  const majorExhaustionZone = zoneObject(
    "Later Extension / Chase-Risk Zone",
    majorExhaustion,
    "Major exhaustion zone; chase risk increases."
  );

  const stretchedExtensionZone = zoneObject(
    "Very Stretched Extension Zone",
    stretchedExtension,
    "Very stretched extension; protect gains and avoid chasing."
  );

  const extremeExtensionZone = zoneObject(
    "Extreme Extension Zone",
    extremeExtension,
    "Extreme extension; high exhaustion risk."
  );

  return {
    firstWeakness,
    nextWeaknessLo,
    nextWeaknessHi,
    majorExhaustion,
    stretchedExtension,
    extremeExtension,
    firstWeaknessZone,
    nextReactionZone,
    majorExhaustionZone,
    stretchedExtensionZone,
    extremeExtensionZone,
  };
}

function classifyAgainstHigherTargets({
  price,
  higherTargets,
  statePrefix,
  earlyState,
  firstWeaknessState,
  reactionState,
  acceptanceState,
  extensionState,
  exhaustionState,
}) {
  const currentPrice = asNumber(price);
  const zones = buildHigherTargetZones(higherTargets);

  const makeLocation = ({ state, label, currentZone = null, nextZone = null }) => ({
    setupFamily: statePrefix,
    priceLocationState: state,
    priceLocationLabel: label,
    currentPrice,
    currentZone,
    nearestLevel: currentZone?.level ?? null,
    nextZone,
    distanceToNextZone:
      nextZone?.lo != null
        ? distanceToLevel(currentPrice, nextZone.lo)
        : distanceToLevel(currentPrice, nextZone?.level),
    source: "ENGINE22_HIGHER_DEGREE_TARGETS",
  });

  if (currentPrice === null) {
    return {
      state: `${statePrefix}_UNKNOWN`,
      health: HEALTH.UNKNOWN,
      preferredEntry: "WAIT_FOR_PRICE_DATA",
      priceLocation: makeLocation({
        state: `${statePrefix}_UNKNOWN`,
        label: "Missing current price.",
      }),
      reasonCodes: ["MISSING_CURRENT_PRICE"],
    };
  }

  if (
    zones.majorExhaustion !== null &&
    currentPrice >= zones.majorExhaustion
  ) {
    return {
      state: exhaustionState || extensionState,
      health: HEALTH.RISK,
      preferredEntry: "WAIT_FOR_PULLBACK_OR_PROTECT_GAINS",
      priceLocation: makeLocation({
        state: exhaustionState || extensionState,
        label: "Price is extended into later chase-risk territory.",
        currentZone: zones.majorExhaustionZone,
        nextZone: zones.stretchedExtensionZone,
      }),
      reasonCodes: [
        "PRICE_IN_LATER_EXTENSION_ZONE",
        "NO_CHASE_EXTENSION",
        "READ_ONLY_INTERPRETATION",
      ],
    };
  }

  if (
    zones.nextWeaknessLo !== null &&
    zones.nextWeaknessHi !== null &&
    currentPrice >= zones.nextWeaknessLo &&
    currentPrice <= zones.nextWeaknessHi
  ) {
    return {
      state: reactionState,
      health: HEALTH.CAUTION,
      preferredEntry: "WAIT_FOR_ACCEPTANCE_OR_REJECTION",
      priceLocation: makeLocation({
        state: reactionState,
        label: "Price is inside the next higher-degree reaction zone.",
        currentZone: zones.nextReactionZone,
        nextZone: zones.majorExhaustionZone,
      }),
      reasonCodes: [
        "PRICE_INSIDE_NEXT_REACTION_ZONE",
        "NO_CHASE_EXTENSION",
        "READ_ONLY_INTERPRETATION",
      ],
    };
  }

  if (
    zones.nextWeaknessHi !== null &&
    currentPrice > zones.nextWeaknessHi
  ) {
    return {
      state: acceptanceState,
      health: HEALTH.CAUTION,
      preferredEntry: "WAIT_FOR_PULLBACK_OR_ENGINE15_CONFIRMATION",
      priceLocation: makeLocation({
        state: acceptanceState,
        label: "Price accepted above the next reaction zone; watch continuation or pullback.",
        currentZone: {
          label: "Above Next Reaction Zone",
          level: `Above ${zones.nextWeaknessHi}`,
          source: "ENGINE22_HIGHER_DEGREE_TARGETS",
        },
        nextZone: zones.majorExhaustionZone,
      }),
      reasonCodes: [
        "PRICE_ABOVE_NEXT_REACTION_ZONE",
        "NO_CHASE_EXTENSION",
        "READ_ONLY_INTERPRETATION",
      ],
    };
  }

  if (
    zones.firstWeakness !== null &&
    currentPrice >= zones.firstWeakness &&
    (zones.nextWeaknessLo === null || currentPrice < zones.nextWeaknessLo)
  ) {
    return {
      state: firstWeaknessState,
      health: HEALTH.CAUTION,
      preferredEntry: "WAIT_FOR_ACCEPTANCE_OR_PULLBACK",
      priceLocation: makeLocation({
        state: firstWeaknessState,
        label: "Price is above first weakness and entering chase-risk territory.",
        currentZone: zones.firstWeaknessZone,
        nextZone: zones.nextReactionZone,
      }),
      reasonCodes: [
        "PRICE_ABOVE_FIRST_WEAKNESS_ZONE",
        "NO_CHASE_EXTENSION",
        "READ_ONLY_INTERPRETATION",
      ],
    };
  }

  return {
    state: earlyState,
    health: HEALTH.CAUTION,
    preferredEntry: "WAIT_FOR_RECLAIM_CONFIRMATION",
    priceLocation: makeLocation({
      state: earlyState,
      label: "Price is below first higher-degree weakness zone.",
      currentZone: null,
      nextZone: zones.firstWeaknessZone,
    }),
    reasonCodes: [
      "PRICE_BELOW_FIRST_WEAKNESS_ZONE",
      "READ_ONLY_INTERPRETATION",
    ],
  };
}

function makeW2LocationResult({
  state,
  health,
  preferredEntry,
  pullbackTargets,
  priceLocation,
  reasonCodes,
}) {
  return {
    environment: "W2_PULLBACK",
    state,
    health,
    preferredEntry,
    pullbackTargets,
    priceLocation,
    reasonCodes,
  };
}

function classifyW2PullbackEnvironment({ price, fib, higherTargets }) {
  const currentPrice = asNumber(price);
  const targets = buildPullbackTargetsFromFib(fib);

  const r382 = asNumber(targets.r382);
  const r500 = asNumber(targets.r500);
  const r618 = asNumber(targets.r618);
  const invalidation = asNumber(targets.invalidation);
  const reference786 = asNumber(targets.reference786);
  const zones = buildHigherTargetZones(higherTargets);
  const baseReasonCodes = ["MINUTE_W2_TO_W3_ACTIVE"];

  const supportZone = {
    label: "W2 Support Zone",
    level: `${r382 ?? "?"} / ${r500 ?? "?"} / ${r618 ?? "?"}`,
    r382,
    r500,
    r618,
    source: "ENGINE2_W2_PULLBACK_FIBS",
  };

  const makeLocation = ({ state, label, currentZone = null, nextZone = null }) => ({
    setupFamily: "W2_TO_W3",
    priceLocationState: state,
    priceLocationLabel: label,
    currentPrice,
    currentZone,
    nearestLevel: currentZone?.level ?? null,
    nextZone,
    distanceToNextZone:
      nextZone?.lo != null
        ? distanceToLevel(currentPrice, nextZone.lo)
        : distanceToLevel(currentPrice, nextZone?.level),
    source: currentZone?.source || "ENGINE22_HIGHER_DEGREE_TARGETS",
  });

  if (currentPrice === null || r382 === null || r618 === null) {
    return makeW2LocationResult({
      state: W2_STATES.UNKNOWN,
      health: HEALTH.UNKNOWN,
      preferredEntry: "WAIT_FOR_W2_FIB_DATA",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.UNKNOWN,
        label: "Missing W2 price or fib levels.",
      }),
      reasonCodes: [...baseReasonCodes, "MISSING_W2_FIB_LEVELS"],
    });
  }

  if (invalidation !== null && currentPrice <= invalidation) {
    return makeW2LocationResult({
      state: W2_STATES.INVALIDATED,
      health: HEALTH.RISK,
      preferredEntry: "WAIT_FOR_NEW_WAVE_STRUCTURE",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.INVALIDATED,
        label: "Price lost W2 invalidation.",
        currentZone: zoneObject("W2 Invalidation", invalidation, null, {
          source: "ENGINE2_W2_PULLBACK_FIBS",
        }),
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_BELOW_W2_INVALIDATION",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  if (reference786 !== null && currentPrice <= reference786) {
    return makeW2LocationResult({
      state: W2_STATES.DEEP_DANGER,
      health: HEALTH.RISK,
      preferredEntry: "WAIT_FOR_STRONG_RECLAIM",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.DEEP_DANGER,
        label: "Price is in deep W2 danger near the 0.786 reference.",
        currentZone: zoneObject("W2 Deep Danger / 0.786 Reference", reference786, null, {
          source: "ENGINE2_W2_PULLBACK_FIBS",
        }),
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_NEAR_DEEP_786_RETRACE",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  if (currentPrice <= r382) {
    return makeW2LocationResult({
      state: W2_STATES.SUPPORT_TEST,
      health: HEALTH.CAUTION,
      preferredEntry: "WATCH_W2_SUPPORT_REACTION",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.SUPPORT_TEST,
        label: "Price is testing the W2 support/retrace zone.",
        currentZone: supportZone,
        nextZone: zones.firstWeaknessZone,
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_INSIDE_OR_BELOW_W2_SUPPORT_ZONE",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  if (zones.firstWeakness !== null && currentPrice < zones.firstWeakness) {
    return makeW2LocationResult({
      state: W2_STATES.RECLAIM_ATTEMPT,
      health: HEALTH.CAUTION,
      preferredEntry: "WAIT_FOR_RECLAIM_CONFIRMATION",
      pullbackTargets: targets,
      priceLocation: makeLocation({
        state: W2_STATES.RECLAIM_ATTEMPT,
        label: "Price reclaimed above W2 support but has not reached first weakness.",
        currentZone: {
          label: "Above W2 Support / Reclaim Attempt",
          level: `Above ${r382}`,
          source: "ENGINE2_W2_PULLBACK_FIBS",
        },
        nextZone: zones.firstWeaknessZone,
      }),
      reasonCodes: [
        ...baseReasonCodes,
        "PRICE_ABOVE_W2_SUPPORT_ZONE",
        "PRICE_BELOW_FIRST_WEAKNESS_ZONE",
        "READ_ONLY_INTERPRETATION",
      ],
    });
  }

  const higherClassification = classifyAgainstHigherTargets({
    price: currentPrice,
    higherTargets,
    statePrefix: "W2_TO_W3",
    earlyState: W2_STATES.RECLAIM_ATTEMPT,
    firstWeaknessState: W2_STATES.IN_WEAKNESS_ZONE,
    reactionState: W2_STATES.REJECTION_RISK,
    acceptanceState: W2_STATES.ACCEPTANCE_WATCH,
    extensionState: W2_STATES.EXTENSION_RISK,
    exhaustionState: W2_STATES.EXTENSION_RISK,
  });

  return makeW2LocationResult({
    state: higherClassification.state,
    health: higherClassification.health,
    preferredEntry: higherClassification.preferredEntry,
    pullbackTargets: targets,
    priceLocation: {
      ...higherClassification.priceLocation,
      setupFamily: "W2_TO_W3",
    },
    reasonCodes: dedupe([
      ...baseReasonCodes,
      "PRICE_ABOVE_W2_SUPPORT_ZONE",
      ...higherClassification.reasonCodes,
    ]),
  });
}

function classifyW3ImpulseEnvironment({
  price,
  activeDegree,
  activeDegreeData,
  higherTargets,
}) {
  const currentPrice = asNumber(price);
  const w1 = getAnchorPoint(activeDegreeData, "w1");
  const w2 = getAnchorPoint(activeDegreeData, "w2");

  const higherClassification = classifyAgainstHigherTargets({
    price: currentPrice,
    higherTargets,
    statePrefix: "W3",
    earlyState: W3_STATES.EARLY_IMPULSE,
    firstWeaknessState: W3_STATES.IN_HIGHER_WEAKNESS_ZONE,
    reactionState: W3_STATES.REACTION_ZONE,
    acceptanceState: W3_STATES.ACCEPTANCE_WATCH,
    extensionState: W3_STATES.EXTENSION_RISK,
    exhaustionState: W3_STATES.EXHAUSTION_RISK,
  });

  return {
    environment: "W3_IMPULSE",
    state: higherClassification.state,
    health: higherClassification.health,
    preferredEntry:
      higherClassification.state === W3_STATES.EARLY_IMPULSE
        ? "WAIT_FOR_CONTROLLED_PULLBACK_OR_CONFIRMATION"
        : higherClassification.preferredEntry,
    activeTargets: {
      degree: activeDegree,
      impulseFor: "W3",
      w1,
      w2,
      currentPrice,
      source: "ENGINE2_ACTIVE_DEGREE_ANCHORS",
    },
    priceLocation: {
      ...higherClassification.priceLocation,
      setupFamily: "W3_IMPULSE",
      activeDegree,
      w1,
      w2,
    },
    reasonCodes: dedupe([
      `${String(activeDegree || "minute").toUpperCase()}_W3_ACTIVE`,
      "MINUTE_W2_CONFIRMED",
      "IMPULSE_EXPANSION_ACTIVE",
      ...higherClassification.reasonCodes,
    ]),
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

  if (text.includes("IMPULSE")) {
    const degreeMatch = text.match(/(PRIMARY|INTERMEDIATE|MINOR|MINUTE|MICRO)/);
    return {
      raw: text || null,
      degree: degreeMatch ? degreeMatch[1].toLowerCase() : null,
      fromWave: null,
      toWave: null,
      type: "IMPULSE",
    };
  }

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

  const isImpulse = raw.includes("IMPULSE");

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

  if (isImpulse) {
    return {
      raw: raw || null,
      family: "IMPULSE",
      degree,
      fromWave: null,
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
          : activeSetup.type === "IMPULSE"
          ? `${titleCase(activeSetup.degree || activeDegree)} impulse is active.`
          : "Active wave setup is still forming.",
    },
    higherContext,
    pullbackTargets,
    weaknessZones,
  };
}

function buildW2Summary({ symbol, multiDegreeContext, priceLocation }) {
  const name = symbol || "ES";
  const t = multiDegreeContext?.pullbackTargets || {};
  const weakness = multiDegreeContext?.weaknessZones || [];
  const state = String(priceLocation?.priceLocationState || "").toUpperCase();
  const currentZone = priceLocation?.currentZone || null;
  const nextZone = priceLocation?.nextZone || null;

  const supportText =
    t.r382 != null && t.r500 != null && t.r618 != null
      ? `${t.r382} / ${t.r500} / ${t.r618}`
      : "the active pullback fib zone";

  const weakText =
    weakness.length > 0
      ? weakness.map((z) => z.level).join(" / ")
      : "higher-degree extension zones";

  if (state === W2_STATES.IN_WEAKNESS_ZONE) {
    return `${name} remains in a Minute W2-to-W3 context, but price has already reclaimed above the W2 pullback zone and is now testing higher-degree W5 weakness/chase-risk territory. First weakness near ${currentZone?.level ?? "unknown"} has been reached. Next reaction zone is ${nextZone?.level ?? "unknown"}. Do not chase; watch acceptance/rejection and wait for Engine 15 confirmation.`;
  }

  if (state === W2_STATES.REJECTION_RISK) {
    return `${name} remains in a Minute W2-to-W3 context, but price is now inside the next higher-degree reaction zone near ${currentZone?.level ?? "unknown"}. This is rejection-risk territory, not a fresh chase entry. Watch acceptance/rejection and wait for Engine 15 confirmation.`;
  }

  if (state === W2_STATES.ACCEPTANCE_WATCH) {
    return `${name} remains in a Minute W2-to-W3 context and price has accepted above the early reaction zone. This can support a W3 continuation attempt, but it is still read-only. Watch for controlled pullback, acceptance, and Engine 15 confirmation.`;
  }

  if (state === W2_STATES.EXTENSION_RISK) {
    return `${name} remains in a Minute W2-to-W3 context, but price is now extended into later chase-risk territory near ${currentZone?.level ?? "unknown"}. Do not chase. Protect gains and wait for pullback or fresh confirmation.`;
  }

  if (state === W2_STATES.RECLAIM_ATTEMPT) {
    return `${name} remains in a Minute W2-to-W3 context. Price has reclaimed above W2 support at ${supportText} but has not reached first weakness yet. Watch acceptance, pullback, and Engine 15 confirmation.`;
  }

  return `${name} remains in a Minute W2-to-W3 context. Watch pullback support at ${supportText}. Weakness/chase-risk zones begin near ${weakText}. Do not chase; wait for support, reclaim, and Engine 15 confirmation.`;
}

function buildW3Summary({ symbol, activeDegree, w3Classification, higherTargets }) {
  const name = symbol || "ES";
  const degreeText = titleCase(activeDegree || "minute");
  const loc = w3Classification?.priceLocation || {};
  const currentZone = loc.currentZone || null;
  const nextZone = loc.nextZone || null;
  const w2 = loc.w2 ?? null;

  const first = higherTargets?.e100 ?? currentZone?.level ?? "unknown";
  const next =
    higherTargets?.e1168 != null && higherTargets?.e1272 != null
      ? `${higherTargets.e1168}–${higherTargets.e1272}`
      : nextZone?.level ?? "unknown";

  if (w3Classification.state === W3_STATES.IN_HIGHER_WEAKNESS_ZONE) {
    return `${name} ${degreeText} W2 is confirmed${w2 != null ? ` at ${w2}` : ""} and ${degreeText} W3 is active. Price has cleared the first higher-degree weakness zone near ${first} and is approaching the next reaction zone at ${next}. Do not chase; watch acceptance, rejection, or controlled pullback. Engine 15 remains the final readiness check.`;
  }

  if (w3Classification.state === W3_STATES.REACTION_ZONE) {
    return `${name} ${degreeText} W3 is active and price is inside the next higher-degree reaction zone near ${currentZone?.level ?? next}. This is rejection-risk territory, not a fresh chase entry. Watch acceptance/rejection and wait for Engine 15 confirmation.`;
  }

  if (w3Classification.state === W3_STATES.ACCEPTANCE_WATCH) {
    return `${name} ${degreeText} W3 is active and price has accepted above the early reaction zone. Continuation can still develop, but chase risk remains elevated. Watch for controlled pullbacks and Engine 15 confirmation.`;
  }

  if (
    w3Classification.state === W3_STATES.EXTENSION_RISK ||
    w3Classification.state === W3_STATES.EXHAUSTION_RISK
  ) {
    return `${name} ${degreeText} W3 is active, but price is extended into later chase-risk territory near ${currentZone?.level ?? "unknown"}. Do not chase. Protect gains and wait for a controlled pullback or fresh confirmation.`;
  }

  return `${name} ${degreeText} W3 is active after W2 confirmation${w2 != null ? ` at ${w2}` : ""}. Price has not yet reached the first higher-degree weakness zone near ${first}. Watch continuation quality, controlled pullbacks, and Engine 15 confirmation.`;
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
  extensionTouchContext = null,
}) {
  const name = symbol || "ES";

  if (extensionTouchContext?.active === true) {
    return `${name} tagged the ${extensionTouchContext.levelLabel} extension near ${extensionTouchContext.level} ${
      extensionTouchContext.touchCount === 2
        ? "twice"
        : `${extensionTouchContext.touchCount} times`
    } and failed to accept above it. This is a double-top extension rejection, not a healthy continuation read. Long continuation is damaged unless price reclaims ${extensionTouchContext.level} with strength. Watch downside confirmation only if Engine 15 and Engine 6 allow.`;
  }

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
    barsByTf = {},
    recentBars10m = null,
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

  const roundedActiveTargets = roundNumberFields(activeTargets);
  const roundedHigherTargets = roundNumberFields(higherTargets);

  const extensionTouchContext = detectExtensionDoubleTap({
    barsByTf,
    recentBars10m,
    activeTargets: roundedActiveTargets,
    currentPrice,
  });

  const missingMicro = detectMissingMicroNeed(degrees); 
  const directionBias = detectDirectionBias(engine22WaveStrategy);
  const setupFamily = detectSetupFamily(engine22WaveStrategy);

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

  if (
    setupFamily.family === "W2_TO_W3" ||
    hasActiveW2ToW3Context(engine22WaveStrategy)
  ) {
    const w2Classification = classifyW2PullbackEnvironment({
      price: currentPrice,
      fib,
      higherTargets,
    });

    const roundedPullbackTargets = roundNumberFields(w2Classification.pullbackTargets);

    const w2Context = buildMultiDegreeContext({
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
      priceLocation: w2Classification.priceLocation,
      recentCompletion: w2Context.recentCompletion,
      activeStructure: w2Context.activeStructure,
      higherContext: w2Context.higherContext,
      weaknessZones: w2Context.weaknessZones,
      waveStack: w2Context.waveStack,
      needs: buildNeeds({ missingMicro: false }),
      reasonCodes: dedupe([
        "MICRO_COMPLETE_W5",
        "MINUTE_W1_COMPLETE",
        ...w2Classification.reasonCodes,
        "READ_ONLY_INTERPRETATION",
        "NO_CHASE_EXTENSION",
      ]),
      summary: buildW2Summary({
        symbol,
        multiDegreeContext: w2Context,
        priceLocation: w2Classification.priceLocation,
      }),
    };
  }

  if (
    setupFamily.family === "IMPULSE" &&
    hasActiveW3ImpulseContext({ engine22WaveStrategy, degrees, engine2State })
  ) {
    const w3Classification = classifyW3ImpulseEnvironment({
      price: currentPrice,
      activeDegree,
      activeDegreeData,
      higherTargets,
    });

    return {
      ok: true,
      engine: ENGINE_NAME,
      mode: READ_ONLY_MODE,
      symbol,
      environment: w3Classification.environment,
      state: w3Classification.state,
      health: w3Classification.health,
      directionBias: "LONG",
      activeDegree,
      higherDegreeContext: buildHigherDegreeContext(higherDegree),
      chaseAllowed: false,
      preferredEntry: w3Classification.preferredEntry,
      activeTargets: w3Classification.activeTargets,
      higherTargets: roundedHigherTargets,
      priceLocation: w3Classification.priceLocation,
      recentCompletion: multiDegreeContext.recentCompletion,
      activeStructure: multiDegreeContext.activeStructure,
      higherContext: multiDegreeContext.higherContext,
      weaknessZones: multiDegreeContext.weaknessZones,
      waveStack: multiDegreeContext.waveStack,
      needs: buildNeeds({ missingMicro: false }),
      reasonCodes: dedupe([
        ...w3Classification.reasonCodes,
        "READ_ONLY_INTERPRETATION",
        "NO_CHASE_EXTENSION",
      ]),
      summary: buildW3Summary({
        symbol,
        activeDegree,
        w3Classification,
        higherTargets: roundedHigherTargets,
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

    const roundedW4Targets = roundNumberFields(rawW4Targets);

    const w4Context = buildMultiDegreeContext({
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
      activeTargets: roundedW4Targets,
      higherTargets: roundedHigherTargets,
      recentCompletion: w4Context.recentCompletion,
      activeStructure: w4Context.activeStructure,
      higherContext: w4Context.higherContext,
      weaknessZones: w4Context.weaknessZones,
      waveStack: w4Context.waveStack,
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
        "W4_LEVELS_NOT_EXPOSED_BY_ENGINE22",
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

  const finalW5State =
    extensionTouchContext?.active === true
      ? W5_STATES.EXTENSION_DOUBLE_TOP_REJECTION
      : w5Classification.state;

  const finalW5Health =
    extensionTouchContext?.active === true
      ? HEALTH.RISK
      : w5Classification.health;

  const finalPreferredEntry =
    extensionTouchContext?.active === true
      ? "WAIT_FOR_DOWNSIDE_CONFIRMATION_OR_EXTENSION_RECLAIM"
      : w5Classification.preferredEntry;

  const finalDirectionBias =
    extensionTouchContext?.active === true
      ? "LONG_DAMAGED_SHORT_WATCH"
      : directionBias;

  const summary = buildW5Summary({
    symbol,
    activeDegree,
    higherDegree,
    state: finalW5State,
    health: finalW5Health,
    activeTargets: roundedActiveTargets,
    missingMicro,
    extensionTouchContext,
  });

  return {
    ok: true,
    engine: ENGINE_NAME,
    mode: READ_ONLY_MODE,
    symbol,
    environment: w5ContextActive ? "W5_EXTENSION" : "UNKNOWN",
    state: finalW5State,
    health: finalW5Health,
    directionBias: finalDirectionBias,
    activeDegree,
    higherDegreeContext: buildHigherDegreeContext(higherDegree),
    chaseAllowed: false,
    preferredEntry: finalPreferredEntry,
    activeTargets: roundedActiveTargets,
    higherTargets: roundedHigherTargets,
    extensionTouchContext,
    needs: buildNeeds({ missingMicro }),
    reasonCodes: dedupe([
      ...reasonCodes,
      ...(Array.isArray(extensionTouchContext?.reasonCodes)
        ? extensionTouchContext.reasonCodes
        : []),
    ]),
    summary,
  };
}

export default interpretWaveEnvironment;
