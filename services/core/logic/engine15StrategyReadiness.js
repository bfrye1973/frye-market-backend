// services/core/logic/engine15StrategyReadiness.js
//
// Engine 15 — Strategy Readiness Translator
// v5
//
// Purpose:
// - This is a display / translator layer.
// - It does NOT create trades.
// - It does NOT override Engine 15 final decision.
// - It translates the canonical engine15Decision into a simpler readiness object
//   for dashboard cards / legacy consumers.
//
// New authority model:
// - engine15Decision = canonical setup truth
// - engine16 = structure fallback only
//
// Locked hierarchy:
// - Engine 5 explains ingredients.
// - Engine 15 decides setup readiness.
// - Engine 6 permits.
// - Engine 7 sizes.
// - Engine 8 executes.
//
// Important behavior:
// - For ES and SPY scalp, prefer engine15Decision when available.
// - Preserve lifecycle-aware translation.
// - Preserve Intermediate Swing patience: WAIT -> PREP -> READY -> TRIGGERED.
// - Avoid fake WATCH when Engine 16 is skipped/unavailable.
// - strategyType === "NONE" does NOT always mean unavailable;
//   it can mean Engine 16 is active but currently has no setup.

const ENGINE = "engine15.readiness.v5";

function safeUpper(x, fallback = "") {
  const s = String(x ?? fallback).trim().toUpperCase();
  return s || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(asArray(values).filter(Boolean))];
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

function normalizeDecision(decision = null) {
  const lifecycle = decision?.lifecycle || {};

  return {
    present: !!decision && typeof decision === "object",
    ok: decision?.ok === true,
    engine: decision?.engine || null,

    strategyType: safeUpper(decision?.strategyType, "NONE"),
    direction: safeUpper(decision?.direction, "NONE"),
    readinessLabel: safeUpper(decision?.readinessLabel, "WAIT"),
    action: safeUpper(decision?.action, "NO_ACTION"),
    executionBias: safeUpper(decision?.executionBias, "NONE"),

    freshEntryNow: decision?.freshEntryNow === true,
    qualityScore:
      Number.isFinite(Number(decision?.qualityScore))
        ? Number(decision.qualityScore)
        : null,
    qualityGrade: decision?.qualityGrade || decision?.grade || null,
    qualityBand: decision?.qualityBand || null,

    blockers: asArray(decision?.blockers),
    conflicts: asArray(decision?.conflicts),
    needs: asArray(decision?.needs),
    reasonCodes: asArray(decision?.reasonCodes),
    summary: decision?.summary || null,

    lifecycleStage: safeUpper(lifecycle?.lifecycleStage, "BUILDING"),
    setupCompleted: lifecycle?.setupCompleted === true,
    entryWindowOpen: lifecycle?.entryWindowOpen === true,
    lifecycleFreshEntryNow: lifecycle?.freshEntryNow === true,
    nextFocus: safeUpper(lifecycle?.nextFocus, "NONE"),

    raw: decision,
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
  summary = null,
  needs = [],
  qualityScore = null,
  qualityGrade = null,
  qualityBand = null,
  action = null,
  executionBias = null,
  blockers = [],
  conflicts = [],
}) {
  return {
    ok: true,
    engine: ENGINE,
    symbol,
    strategyId,

    readiness,
    strategyType,
    direction,

    active,
    freshEntryNow,

    action,
    executionBias,

    qualityScore,
    qualityGrade,
    qualityBand,

    blockers: unique(blockers),
    conflicts: unique(conflicts),
    needs: unique(needs),
    reasonCodes: unique(reasonCodes),

    summary,
    source,
  };
}

/* -----------------------------
   Lifecycle translation
------------------------------*/

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
      action: d15.action,
      executionBias: d15.executionBias,
      qualityScore: d15.qualityScore,
      qualityGrade: d15.qualityGrade,
      qualityBand: d15.qualityBand,
      blockers: d15.blockers,
      conflicts: d15.conflicts,
      needs: d15.needs,
      summary: d15.summary,
      reasonCodes: [
        "LIFECYCLE_COMPLETED",
        "LOOK_FOR_NEXT_SETUP",
        ...d15.reasonCodes,
      ],
      source: {
        owner: "ENGINE15_DECISION",
        engine: d15.engine,
        lifecycleStage: stage,
        nextFocus: d15.nextFocus,
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
      action: d15.action,
      executionBias: d15.executionBias,
      qualityScore: d15.qualityScore,
      qualityGrade: d15.qualityGrade,
      qualityBand: d15.qualityBand,
      blockers: d15.blockers,
      conflicts: d15.conflicts,
      needs: d15.needs,
      summary: d15.summary,
      reasonCodes: [
        "LIFECYCLE_MATURE",
        "NO_FRESH_ENTRY",
        ...d15.reasonCodes,
      ],
      source: {
        owner: "ENGINE15_DECISION",
        engine: d15.engine,
        lifecycleStage: stage,
        nextFocus: d15.nextFocus,
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
      action: d15.action,
      executionBias: d15.executionBias,
      qualityScore: d15.qualityScore,
      qualityGrade: d15.qualityGrade,
      qualityBand: d15.qualityBand,
      blockers: d15.blockers,
      conflicts: d15.conflicts,
      needs: d15.needs,
      summary: d15.summary,
      reasonCodes: [
        "LIFECYCLE_PARTIAL",
        "NO_CHASE",
        ...d15.reasonCodes,
      ],
      source: {
        owner: "ENGINE15_DECISION",
        engine: d15.engine,
        lifecycleStage: stage,
        nextFocus: d15.nextFocus,
      },
    });
  }

  return null;
}

/* -----------------------------
   Engine 15 decision translation
------------------------------*/

function decisionHasMeaningfulSetup(d15) {
  if (!d15 || d15.ok !== true) return false;

  if (d15.strategyType !== "NONE") return true;
  if (d15.direction !== "NONE") return true;

  if (
    [
      "WATCH",
      "NEAR",
      "PREP",
      "ARMING",
      "READY",
      "CONFIRMED",
      "TRIGGERED",
      "BLOCKED",
      "STAND_DOWN",
    ].includes(d15.readinessLabel)
  ) {
    return true;
  }

  if (["WATCH", "ENTER_OK", "REDUCE_OK", "BLOCKED"].includes(d15.action)) {
    return true;
  }

  return false;
}

function mapDecisionReadiness(d15, strategyId) {
  const label = d15.readinessLabel;
  const action = d15.action;

  if (["BLOCKED", "STAND_DOWN"].includes(label) || action === "BLOCKED") {
    return {
      readiness: label === "STAND_DOWN" ? "STAND_DOWN" : "BLOCKED",
      active: false,
      freshEntryNow: false,
      reasonCode: "ENGINE15_BLOCKED",
    };
  }

  if (["READY", "CONFIRMED", "TRIGGERED"].includes(label)) {
    return {
      readiness: label,
      active: true,
      freshEntryNow: true,
      reasonCode: "ENGINE15_EXECUTION_READY",
    };
  }

  if (["ENTER_OK", "REDUCE_OK"].includes(action)) {
    return {
      readiness: "READY",
      active: true,
      freshEntryNow: true,
      reasonCode: "ENGINE15_ACTION_READY",
    };
  }

  if (label === "ARMING") {
    return {
      readiness: "ARMING",
      active: true,
      freshEntryNow: false,
      reasonCode: "ENGINE15_ARMING",
    };
  }

  if (["WATCH", "NEAR", "PREP"].includes(label)) {
    return {
      readiness: label,
      active: true,
      freshEntryNow: false,
      reasonCode: "ENGINE15_WATCH_STATE",
    };
  }

  if (action === "WATCH") {
    return {
      readiness: "WATCH",
      active: true,
      freshEntryNow: false,
      reasonCode: "ENGINE15_ACTION_WATCH",
    };
  }

  if (isIntermediateSwingStrategy(strategyId)) {
    return {
      readiness: "WAIT",
      active: false,
      freshEntryNow: false,
      reasonCode: "ENGINE15_WAIT",
    };
  }

  return {
    readiness: "NO_SETUP",
    active: false,
    freshEntryNow: false,
    reasonCode: "ENGINE15_NO_SETUP",
  };
}

function translateFromEngine15Decision({
  symbol,
  strategyId,
  d15,
}) {
  const lifecycle = lifecycleTranslate({
    symbol,
    strategyId,
    d15,
  });

  if (lifecycle) return lifecycle;

  const mapped = mapDecisionReadiness(d15, strategyId);

  return buildOutput({
    symbol,
    strategyId,

    readiness: mapped.readiness,
    strategyType: d15.strategyType,
    direction: d15.direction,

    active: mapped.active,
    freshEntryNow:
      mapped.freshEntryNow ||
      d15.freshEntryNow === true ||
      d15.lifecycleFreshEntryNow === true,

    action: d15.action,
    executionBias: d15.executionBias,

    qualityScore: d15.qualityScore,
    qualityGrade: d15.qualityGrade,
    qualityBand: d15.qualityBand,

    blockers: d15.blockers,
    conflicts: d15.conflicts,
    needs: d15.needs,
    summary: d15.summary,

    reasonCodes: [
      mapped.reasonCode,
      ...d15.reasonCodes,
    ],

    source: {
      owner: "ENGINE15_DECISION",
      engine: d15.engine,
      readinessLabel: d15.readinessLabel,
      action: d15.action,
      lifecycleStage: d15.lifecycleStage,
      nextFocus: d15.nextFocus,
    },
  });
}

/* -----------------------------
   Engine 16 fallback helpers
------------------------------*/

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

  if (["CONFIRMED", "TRIGGERED"].includes(readinessRaw)) {
    readiness = "TRIGGERED";
    active = true;
    freshEntryNow = true;
  } else if (readinessRaw === "READY") {
    readiness = "READY";
    active = true;
    freshEntryNow = true;
  } else if (["ARMING", "NEAR", "WATCH", "PREP"].includes(readinessRaw)) {
    readiness = "PREP";
    active = true;
    freshEntryNow = false;
  } else if (prep.finalCorrection) {
    readiness = "PREP";
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

  const rawReadiness =
    safeUpper(engine16?.readinessLabel, "") ||
    safeUpper(engine16?.readiness, "NO_SETUP");

  const rawStrategyType = safeUpper(engine16?.strategyType, "NONE");
  const rawDirection = safeUpper(engine16?.direction, "NONE");

  if (
    rawReadiness === "WATCH" ||
    rawReadiness === "WATCH_FOR_SHORT" ||
    rawReadiness === "WATCH_FOR_LONG"
  ) {
    return buildOutput({
      symbol,
      strategyId,
      readiness: rawReadiness,
      strategyType: rawStrategyType,
      direction: rawDirection,
      active: true,
      freshEntryNow: false,
      reasonCodes: ["ENGINE16_ACTIVE", "SCALP_PREP_WATCH"],
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

  const freshEntryNow =
    ["READY", "CONFIRMED", "TRIGGERED"].includes(rawReadiness);

  return buildOutput({
    symbol,
    strategyId,
    readiness: rawReadiness || "WATCH",
    strategyType: rawStrategyType,
    direction: rawDirection,
    active: true,
    freshEntryNow,
    reasonCodes: ["ENGINE16_ACTIVE"],
    source: {
      owner: "ENGINE16_ACTIVE",
      rawReadiness,
    },
  });
}

/* -----------------------------
   Main entry
------------------------------*/

export function computeEngine15Readiness({
  symbol = "SPY",
  strategyId = null,
  engine16 = null,
  engine15Decision = null,
} = {}) {
  try {
    const d15 = normalizeDecision(engine15Decision);

    // New canonical path:
    // If engine15Decision has a meaningful setup/readiness state,
    // use it first. This is especially important for ES Engine 15ES.
    if (decisionHasMeaningfulSetup(d15)) {
      return translateFromEngine15Decision({
        symbol,
        strategyId,
        d15,
      });
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

    if (
      engine16Unavailable ||
      !engine16 ||
      safeUpper(engine16?.strategyType, "NONE") === "NONE"
    ) {
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
      freshEntryNow:
        ["READY", "CONFIRMED", "TRIGGERED"].includes(
          safeUpper(engine16.readinessLabel, "")
        ),
      reasonCodes: ["ENGINE16_ACTIVE"],
    });
  } catch (err) {
    return {
      ok: false,
      engine: ENGINE,
      symbol,
      strategyId,
      readiness: "NO_SETUP",
      strategyType: "NONE",
      direction: "NONE",
      active: false,
      freshEntryNow: false,
      action: "NO_ACTION",
      executionBias: "NONE",
      qualityScore: null,
      qualityGrade: null,
      qualityBand: null,
      blockers: [],
      conflicts: [],
      needs: [],
      reasonCodes: ["ENGINE15_ERROR"],
      summary: null,
      error: String(err?.message || err),
      source: {
        owner: "ENGINE15_ERROR",
      },
    };
  }
}

export default computeEngine15Readiness;
