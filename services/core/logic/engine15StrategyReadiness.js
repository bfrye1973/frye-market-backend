// services/core/logic/engine15StrategyReadiness.js
//
// Engine 15 — Strategy Readiness Translator
//
// Purpose:
// - Preserve current frontend-compatible readiness display
// - Read Engine 16 strategy detection
// - Lightly inspect Engine 3 / Engine 4 / Engine 5
// - NOW also respect Engine 15B lifecycle when present
//
// Important:
// - This is still the lightweight display translator
// - It is NOT the final decision referee
// - Engine 15B remains the real lifecycle / decision authority
//
// New rule in this version:
// - lifecycle COMPLETED / EXPIRED / MISSED / INVALIDATED -> no active setup
// - lifecycle MATURE -> stand down / no chase
// - lifecycle PARTIALLY_COMPLETED -> reduce / no chase
// - BUILDING / LIVE -> normal old behavior

function safeUpper(x, fallback = "") {
  const s = String(x ?? fallback).trim().toUpperCase();
  return s || fallback;
}

function toNum(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeEngine16(engine16 = null) {
  return {
    ok: engine16?.ok !== false,
    strategyType: safeUpper(engine16?.strategyType, "NONE"),
    readinessLabel: safeUpper(engine16?.readinessLabel, "NO_SETUP"),
    direction: safeUpper(engine16?.direction, "NONE"),
    exhaustionDetected: engine16?.exhaustionDetected === true,
    exhaustionActive: engine16?.exhaustionActive === true,
    exhaustionShort: engine16?.exhaustionShort === true,
    exhaustionLong: engine16?.exhaustionLong === true,
    invalidated: engine16?.invalidated === true,
  };
}

function normalizeEngine3(engine3 = null) {
  return {
    stage: safeUpper(engine3?.stage, "IDLE"),
    armed: engine3?.armed === true,
    reactionScore: toNum(engine3?.reactionScore, 0),
    confirmed: engine3?.confirmed === true,
  };
}

function normalizeEngine4(engine4 = null) {
  return {
    volumeScore: toNum(engine4?.volumeScore, 0),
    volumeConfirmed: engine4?.volumeConfirmed === true,
    pressureBias: safeUpper(engine4?.pressureBias, "NONE"),
    volumeRegime: safeUpper(engine4?.volumeRegime, "NONE"),
    flags: engine4?.flags || {},
  };
}

function normalizeEngine5(engine5 = null) {
  const total =
    toNum(engine5?.scores?.total, NaN) ||
    toNum(engine5?.total, 0);

  return {
    invalid: engine5?.invalid === true,
    total,
    label: engine5?.scores?.label || engine5?.label || "IGNORE",
  };
}

function normalizeDecision(decision = null) {
  const lifecycle = decision?.lifecycle || {};
  return {
    ok: decision?.ok === true,
    strategyType: safeUpper(decision?.strategyType, "NONE"),
    direction: safeUpper(decision?.direction, "NONE"),
    readinessLabel: safeUpper(decision?.readinessLabel, "WAIT"),
    action: safeUpper(decision?.action, "NO_ACTION"),
    executionBias: safeUpper(decision?.executionBias, "NONE"),
    lifecycleStage: safeUpper(lifecycle?.lifecycleStage, "BUILDING"),
    setupCompleted: lifecycle?.setupCompleted === true,
    firstTargetHit: lifecycle?.firstTargetHit === true,
    secondTargetHit: lifecycle?.secondTargetHit === true,
    runnerActive: lifecycle?.runnerActive === true,
    entryWindowOpen: lifecycle?.entryWindowOpen === true,
    isFreshSetup: lifecycle?.isFreshSetup === true,
    nextFocus: safeUpper(lifecycle?.nextFocus, "NONE"),
    targetProgress01: toNum(lifecycle?.targetProgress01, 0),
  };
}

function buildBaseOutput({
  symbol = "SPY",
  strategyId = null,
  readiness = "NO_SETUP",
  strategyType = "NONE",
  direction = "NONE",
  active = false,
  reasonCodes = [],
  source = {},
  engine3 = null,
  engine4 = null,
  engine5 = null,
}) {
  return {
    ok: true,
    engine: "engine15.readiness.v2",
    symbol,
    strategyId,
    readiness,
    strategyType,
    direction,
    active,
    reasonCodes: Array.from(new Set(reasonCodes.filter(Boolean))),
    source,
    debug: {
      engine3: {
        stage: engine3?.stage || "IDLE",
        armed: engine3?.armed === true,
        reactionScore: toNum(engine3?.reactionScore, 0),
      },
      engine4: {
        volumeScore: toNum(engine4?.volumeScore, 0),
        volumeConfirmed: engine4?.volumeConfirmed === true,
        pressureBias: engine4?.pressureBias ?? null,
        volumeRegime: engine4?.volumeRegime ?? null,
      },
      engine5: {
        total: toNum(engine5?.total, 0),
        label: engine5?.label || "IGNORE",
        invalid: engine5?.invalid === true,
      },
    },
  };
}

function lifecycleOverride({
  symbol,
  strategyId,
  decision,
  engine3,
  engine4,
  engine5,
}) {
  const stage = decision.lifecycleStage;
  const strategyType = decision.strategyType || "NONE";
  const direction = decision.direction || "NONE";

  if (
    stage === "COMPLETED" ||
    stage === "EXPIRED" ||
    stage === "MISSED" ||
    stage === "INVALIDATED" ||
    decision.setupCompleted === true
  ) {
    return buildBaseOutput({
      symbol,
      strategyId,
      readiness: "NO_SETUP",
      strategyType: "NONE",
      direction: "NONE",
      active: false,
      reasonCodes: [
        "ENGINE15_LIFECYCLE_OVERRIDE",
        `LIFECYCLE_${stage || "COMPLETED"}`,
        "LOOK_FOR_NEXT_SETUP",
      ],
      source: {
        owner: "ENGINE15_DECISION",
        lifecycleStage: stage,
        nextFocus: decision.nextFocus || "LOOK_FOR_NEW_SETUP",
      },
      engine3,
      engine4,
      engine5,
    });
  }

  if (stage === "MATURE") {
    return buildBaseOutput({
      symbol,
      strategyId,
      readiness: `${strategyType}_MATURE`,
      strategyType,
      direction,
      active: false,
      reasonCodes: [
        "ENGINE15_LIFECYCLE_OVERRIDE",
        "LIFECYCLE_MATURE",
        "NO_CHASE_EDGE_MOSTLY_CAPTURED",
      ],
      source: {
        owner: "ENGINE15_DECISION",
        lifecycleStage: stage,
        nextFocus: decision.nextFocus || "MANAGE_RUNNER",
      },
      engine3,
      engine4,
      engine5,
    });
  }

  if (stage === "PARTIALLY_COMPLETED") {
    return buildBaseOutput({
      symbol,
      strategyId,
      readiness: `${strategyType}_REDUCE`,
      strategyType,
      direction,
      active: true,
      reasonCodes: [
        "ENGINE15_LIFECYCLE_OVERRIDE",
        "LIFECYCLE_PARTIALLY_COMPLETED",
        "NO_CHASE_PARTIALS_TAKEN",
      ],
      source: {
        owner: "ENGINE15_DECISION",
        lifecycleStage: stage,
        nextFocus: decision.nextFocus || "MANAGE_OPEN_POSITION",
      },
      engine3,
      engine4,
      engine5,
    });
  }

  return null;
}

export function computeEngine15Readiness({
  symbol = "SPY",
  strategyId = null,
  engine16 = null,
  engine3 = null,
  engine4 = null,
  engine5 = null,
  engine15Decision = null,
} = {}) {
  try {
    const e16 = normalizeEngine16(engine16);
    const e3 = normalizeEngine3(engine3);
    const e4 = normalizeEngine4(engine4);
    const e5 = normalizeEngine5(engine5);
    const d15 = normalizeDecision(engine15Decision);

    // 1) New lifecycle override first
    if (d15.ok === true) {
      const overridden = lifecycleOverride({
        symbol,
        strategyId,
        decision: d15,
        engine3: e3,
        engine4: e4,
        engine5: e5,
      });

      if (overridden) return overridden;
    }

    // 2) Old behavior continues below
    if (!e16.ok || e16.strategyType === "NONE" || e16.readinessLabel === "NO_SETUP") {
      return buildBaseOutput({
        symbol,
        strategyId,
        readiness: "NO_SETUP",
        strategyType: "NONE",
        direction: "NONE",
        active: false,
        reasonCodes: ["ENGINE16_NO_SETUP"],
        source: {
          owner: "ENGINE16",
          readinessLabel: e16.readinessLabel,
          strategyType: e16.strategyType,
        },
        engine3: e3,
        engine4: e4,
        engine5: e5,
      });
    }

    if (e16.invalidated) {
      return buildBaseOutput({
        symbol,
        strategyId,
        readiness: "NO_SETUP",
        strategyType: "NONE",
        direction: "NONE",
        active: false,
        reasonCodes: ["ENGINE16_INVALIDATED"],
        source: {
          owner: "ENGINE16",
          readinessLabel: e16.readinessLabel,
          strategyType: e16.strategyType,
          invalidated: true,
        },
        engine3: e3,
        engine4: e4,
        engine5: e5,
      });
    }

    const strategyType = e16.strategyType;
    let direction = e16.direction;

    if (direction === "NONE") {
      if (e16.exhaustionShort) direction = "SHORT";
      else if (e16.exhaustionLong) direction = "LONG";
    }

    const reasonCodes = [];
    let readiness = e16.readinessLabel;
    let active = true;

    if (strategyType === "EXHAUSTION") {
      if (e16.readinessLabel === "EXHAUSTION_READY") {
        reasonCodes.push("ENGINE16_EXHAUSTION_READY");
      }
      if (direction === "SHORT") reasonCodes.push("DIRECTION_SHORT");
      if (direction === "LONG") reasonCodes.push("DIRECTION_LONG");
      reasonCodes.push("ENGINE16_STRATEGY_EXHAUSTION");
      if (e16.exhaustionDetected) reasonCodes.push("ENGINE16_EXHAUSTION_DETECTED");
      if (e16.exhaustionActive) reasonCodes.push("ENGINE16_EXHAUSTION_ACTIVE");
    } else {
      reasonCodes.push(`ENGINE16_${strategyType}`);
    }

    // tiny readiness nudges only
    if (e3.stage === "CONFIRMED" || e3.confirmed) {
      reasonCodes.push("ENGINE3_CONFIRMED");
    } else if (e3.armed) {
      reasonCodes.push("ENGINE3_ARMED");
    }

    if (e4.volumeConfirmed || e4.volumeScore >= 7) {
      reasonCodes.push("ENGINE4_VOLUME_SUPPORT");
    }

    if (e5.invalid) {
      reasonCodes.push("ENGINE5_INVALID");
    } else if (e5.total >= 80) {
      reasonCodes.push("ENGINE5_STRONG_SCORE");
    } else if (e5.total >= 70) {
      reasonCodes.push("ENGINE5_TRADABLE_SCORE");
    } else if (e5.total >= 60) {
      reasonCodes.push("ENGINE5_WATCH_SCORE");
    } else {
      reasonCodes.push("ENGINE5_WEAK_SCORE");
    }

    return buildBaseOutput({
      symbol,
      strategyId,
      readiness,
      strategyType,
      direction,
      active,
      reasonCodes,
      source: {
        owner: "ENGINE16",
        readinessLabel: e16.readinessLabel,
        strategyType: e16.strategyType,
        exhaustionDetected: e16.exhaustionDetected,
        exhaustionActive: e16.exhaustionActive,
        exhaustionShort: e16.exhaustionShort,
        exhaustionLong: e16.exhaustionLong,
      },
      engine3: e3,
      engine4: e4,
      engine5: e5,
    });
  } catch (err) {
    return {
      ok: false,
      engine: "engine15.readiness.v2",
      symbol,
      strategyId,
      readiness: "NO_SETUP",
      strategyType: "NONE",
      direction: "NONE",
      active: false,
      reasonCodes: ["ENGINE15_READINESS_ERROR", String(err?.message || err)],
      source: { owner: "ERROR" },
      debug: {},
    };
  }
}

export default computeEngine15Readiness;
