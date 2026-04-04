// services/core/logic/engine15StrategyReadiness.js
//
// Engine 15 — Strategy Readiness Translator (REWRITTEN)
// v4
//
// Goals:
// - preserve lifecycle-aware translation
// - distinguish Engine 16 unavailable vs active-no-setup vs active-prep
// - keep Scalp behavior active/live
// - keep Intermediate Swing patient/truthful
// - remove fake WATCH behavior when Engine 16 is skipped/unavailable
//
// Locked behavior:
// Scalp:
//   active/live behavior remains
//
// Intermediate Swing:
//   WAIT -> PREP -> READY -> TRIGGERED
//
// Canonical unavailable rule:
//   !engine16 || engine16.skipped === true || engine16.ok !== true
//
// Important:
// - strategyType === "NONE" does NOT mean unavailable
// - it means Engine 16 is active but currently has no setup

function safeUpper(x, fallback = "") {
  const s = String(x ?? fallback).trim().toUpperCase();
  return s || fallback;
}

function normalizeDecision(decision = null) {
  const lifecycle = decision?.lifecycle || {};
  return {
    ok: decision?.ok === true,
    strategyType: safeUpper(decision?.strategyType, "NONE"),
    direction: safeUpper(decision?.direction, "NONE"),
    readinessLabel: safeUpper(decision?.readinessLabel, "WAIT"),
    action: safeUpper(decision?.action, "NO_ACTION"),

    lifecycleStage: safeUpper(lifecycle?.lifecycleStage, "BUILDING"),
    setupCompleted: lifecycle?.setupCompleted === true,
    entryWindowOpen: lifecycle?.entryWindowOpen === true,
    nextFocus: safeUpper(lifecycle?.nextFocus, "NONE"),
  };
}

function buildOutput({
  symbol,
  strategyId,
  readiness,
  strategyType,
  direction,
  active,
  freshEntryNow,
  reasonCodes = [],
  source = {},
}) {
  return {
    ok: true,
    engine: "engine15.readiness.v4",
    symbol,
    strategyId,
    readiness,
    strategyType,
    direction,
    active,
    freshEntryNow,
    reasonCodes: Array.from(new Set(reasonCodes)),
    source,
  };
}

function lifecycleTranslate({ symbol, strategyId, d15 }) {
  const stage = d15.lifecycleStage;

  if (stage === "COMPLETED" || d15.setupCompleted === true) {
    return buildOutput({
      symbol,
      strategyId,
      readiness: "LOOK_FOR_NEXT_SETUP",
      strategyType: d15.strategyType,
      direction: d15.direction,
      active: false,
      freshEntryNow: false,
      reasonCodes: ["LIFECYCLE_COMPLETED", "LOOK_FOR_NEXT_SETUP"],
      source: {
        owner: "ENGINE15_DECISION",
        lifecycleStage: stage,
      },
    });
  }

  if (stage === "MATURE") {
    return buildOutput({
      symbol,
      strategyId,
      readiness: "MATURE",
      strategyType: d15.strategyType,
      direction: d15.direction,
      active: false,
      freshEntryNow: false,
      reasonCodes: ["LIFECYCLE_MATURE", "NO_FRESH_ENTRY"],
      source: {
        owner: "ENGINE15_DECISION",
        lifecycleStage: stage,
      },
    });
  }

  if (stage === "PARTIALLY_COMPLETED") {
    return buildOutput({
      symbol,
      strategyId,
      readiness: "MATURE",
      strategyType: d15.strategyType,
      direction: d15.direction,
      active: true,
      freshEntryNow: false,
      reasonCodes: ["LIFECYCLE_PARTIAL", "NO_CHASE"],
      source: {
        owner: "ENGINE15_DECISION",
        lifecycleStage: stage,
      },
    });
  }

  return null;
}

function isScalpStrategy(strategyId) {
  return safeUpper(strategyId).includes("INTRADAY_SCALP");
}

function isIntermediateSwingStrategy(strategyId) {
  return safeUpper(strategyId).includes("MINOR_SWING");
}

function isEngine16Unavailable(engine16) {
  return !engine16 || engine16.skipped === true || engine16.ok !== true;
}

function extractWavePrepState(engine16 = null) {
  const topLevelWaveState = safeUpper(engine16?.waveState, "UNKNOWN");
  const ctx = engine16?.waveContext || {};
  const ctxWaveState = safeUpper(ctx?.waveState, "UNKNOWN");
  const intermediatePhase =
    safeUpper(engine16?.intermediatePhase, "") ||
    safeUpper(ctx?.intermediatePhase, "") ||
    safeUpper(engine16?.engine2Context?.intermediate?.phase, "");

  const wavePrep =
    engine16?.wavePrep === true ||
    ctx?.wavePrep === true;

  const effectiveWaveState =
    ctxWaveState !== "UNKNOWN" ? ctxWaveState : topLevelWaveState;

  const finalCorrection =
    effectiveWaveState === "FINAL_CORRECTION" ||
    intermediatePhase === "IN_C" ||
    wavePrep === true;

  return {
    effectiveWaveState,
    intermediatePhase,
    finalCorrection,
  };
}

function translateUnavailableIntermediateSwing({
  symbol,
  strategyId,
  engine16,
}) {
  const prep = extractWavePrepState(engine16);

  const readiness = prep.finalCorrection ? "PREP" : "WAIT";

  return buildOutput({
    symbol,
    strategyId,
    readiness,
    strategyType: "NONE",
    direction: "NONE",
    active: false,
    freshEntryNow: false,
    reasonCodes: prep.finalCorrection
      ? ["ENGINE16_UNAVAILABLE", "STRUCTURE_PREP_ONLY", "INTERMEDIATE_PREP"]
      : ["ENGINE16_UNAVAILABLE", "WAIT_FOR_W3_W5_STRUCTURE"],
    source: {
      owner: "ENGINE15_UNAVAILABLE_GUARD",
      engine16Skipped: engine16?.skipped === true,
      engine16Ok: engine16?.ok === true,
      waveState: prep.effectiveWaveState,
      intermediatePhase: prep.intermediatePhase,
    },
  });
}

function translateActiveIntermediateSwing({
  symbol,
  strategyId,
  engine16,
}) {
  const readinessRaw = safeUpper(engine16?.readinessLabel, "WAIT");
  const strategyType = safeUpper(engine16?.strategyType, "NONE");
  const direction = safeUpper(engine16?.direction, "NONE");
  const prep = extractWavePrepState(engine16);

  // Intermediate Swing should not use WATCH as its primary label.
  // Convert active/no-setup to WAIT, structural late-correction to PREP.
  if (strategyType === "NONE") {
    return buildOutput({
      symbol,
      strategyId,
      readiness: prep.finalCorrection ? "PREP" : "WAIT",
      strategyType: "NONE",
      direction: "NONE",
      active: false,
      freshEntryNow: false,
      reasonCodes: prep.finalCorrection
        ? ["ENGINE16_ACTIVE_PREP", "INTERMEDIATE_PREP"]
        : ["ENGINE16_ACTIVE_NO_SETUP", "WAIT_FOR_W3_W5_TRIGGER"],
      source: {
        owner: "ENGINE16_ACTIVE",
        rawReadiness: readinessRaw,
        waveState: prep.effectiveWaveState,
        intermediatePhase: prep.intermediatePhase,
      },
    });
  }

  let readiness = "WAIT";
  let active = false;
  let freshEntryNow = false;

  // Ladder: WAIT -> PREP -> READY -> TRIGGERED
  if (["CONFIRMED", "TRIGGERED"].includes(readinessRaw)) {
    readiness = "TRIGGERED";
    active = true;
    freshEntryNow = true;
  } else if (["READY"].includes(readinessRaw)) {
    readiness = "READY";
    active = true;
    freshEntryNow = true;
  } else if (["ARMING", "NEAR", "WATCH"].includes(readinessRaw)) {
    readiness = "PREP";
    active = true;
    freshEntryNow = false;
  } else if (prep.finalCorrection) {
    readiness = "PREP";
    active = false;
    freshEntryNow = false;
  } else {
    readiness = "WAIT";
    active = false;
    freshEntryNow = false;
  }

  return buildOutput({
    symbol,
    strategyId,
    readiness,
    strategyType,
    direction,
    active,
    freshEntryNow,
    reasonCodes: ["ENGINE16_ACTIVE", "INTERMEDIATE_SWING_TRANSLATED"],
    source: {
      owner: "ENGINE16_ACTIVE",
      rawReadiness: readinessRaw,
      waveState: prep.effectiveWaveState,
      intermediatePhase: prep.intermediatePhase,
    },
  });
}

function translateActiveScalp({
  symbol,
  strategyId,
  engine16,
}) {
  if (!engine16) {
    return buildOutput({
      symbol,
      strategyId,
      readiness: "NO_SETUP",
      strategyType: "NONE",
      direction: "NONE",
      active: false,
      freshEntryNow: false,
      reasonCodes: ["NO_STRUCTURE"],
      source: {
        owner: "ENGINE16_ACTIVE",
        rawReadiness: "NO_SETUP",
      },
    });
  }

  const rawReadiness = safeUpper(engine16?.readinessLabel, "NO_SETUP");
  const rawStrategyType = safeUpper(engine16?.strategyType, "NONE");
  const rawDirection = safeUpper(engine16?.direction, "NONE");

  if (rawReadiness === "WATCH") {
    return buildOutput({
      symbol,
      strategyId,
      readiness: "WATCH",
      strategyType: rawStrategyType,
      direction: rawDirection,
      active: true,
      freshEntryNow: false,
      reasonCodes: ["ENGINE16_ACTIVE", "SCALP_C_LEG_WATCH"],
      source: {
        owner: "ENGINE16_ACTIVE",
        rawReadiness,
      },
    });
  }

  if (rawStrategyType === "NONE") {
    return buildOutput({
      symbol,
      strategyId,
      readiness: "NO_SETUP",
      strategyType: "NONE",
      direction: "NONE",
      active: false,
      freshEntryNow: false,
      reasonCodes: ["NO_STRUCTURE"],
      source: {
        owner: "ENGINE16_ACTIVE",
        rawReadiness,
      },
    });
  }

  return buildOutput({
    symbol,
    strategyId,
    readiness: engine16.readinessLabel || "WATCH",
    strategyType: engine16.strategyType,
    direction: engine16.direction || "NONE",
    active: true,
    freshEntryNow: true,
    reasonCodes: ["ENGINE16_ACTIVE"],
    source: {
      owner: "ENGINE16_ACTIVE",
      rawReadiness,
    },
  });
}

export function computeEngine15Readiness({
  symbol = "SPY",
  strategyId = null,
  engine16 = null,
  engine15Decision = null,
} = {}) {
  try {
    const d15 = normalizeDecision(engine15Decision);

    // Lifecycle translation still wins first when decision is genuinely active.
    if (d15.ok === true) {
      const translated = lifecycleTranslate({
        symbol,
        strategyId,
        d15,
      });

      if (translated) return translated;
    }

    const scalp = isScalpStrategy(strategyId);
    const intermediateSwing = isIntermediateSwingStrategy(strategyId);
    const engine16Unavailable = isEngine16Unavailable(engine16);

    if (intermediateSwing) {
      if (engine16Unavailable) {
        return translateUnavailableIntermediateSwing({
          symbol,
          strategyId,
          engine16,
        });
      }

      return translateActiveIntermediateSwing({
        symbol,
        strategyId,
        engine16,
      });
    }

    if (scalp) {
      if (engine16Unavailable) {
        return buildOutput({
          symbol,
          strategyId,
          readiness: "NO_SETUP",
          strategyType: "NONE",
          direction: "NONE",
          active: false,
          freshEntryNow: false,
          reasonCodes: ["ENGINE16_UNAVAILABLE"],
          source: {
            owner: "ENGINE15_UNAVAILABLE_GUARD",
            engine16Skipped: engine16?.skipped === true,
            engine16Ok: engine16?.ok === true,
          },
        });
      }

      return translateActiveScalp({
        symbol,
        strategyId,
        engine16,
      });
    }

    // Default/fallback behavior for other strategies
    if (engine16Unavailable || !engine16 || safeUpper(engine16?.strategyType, "NONE") === "NONE") {
      return buildOutput({
        symbol,
        strategyId,
        readiness: "NO_SETUP",
        strategyType: "NONE",
        direction: "NONE",
        active: false,
        freshEntryNow: false,
        reasonCodes: ["NO_STRUCTURE"],
      });
    }

    return buildOutput({
      symbol,
      strategyId,
      readiness: engine16.readinessLabel || "WATCH",
      strategyType: engine16.strategyType,
      direction: engine16.direction || "NONE",
      active: true,
      freshEntryNow: true,
      reasonCodes: ["ENGINE16_ACTIVE"],
    });
  } catch (err) {
    return {
      ok: false,
      engine: "engine15.readiness.v4",
      symbol,
      strategyId,
      readiness: "NO_SETUP",
      strategyType: "NONE",
      direction: "NONE",
      active: false,
      freshEntryNow: false,
      reasonCodes: ["ENGINE15_ERROR"],
      error: String(err?.message || err),
    };
  }
}

export default computeEngine15Readiness;
