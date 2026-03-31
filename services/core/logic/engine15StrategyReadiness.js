// services/core/logic/engine15StrategyReadiness.js
//
// Engine 15 — Strategy Readiness Translator (FIXED)
// Engine 16C version
//
// KEY FIXES:
// - COMPLETED no longer collapses to NO_SETUP
// - Preserves strategyType + direction
// - Adds freshEntryNow
// - Clean lifecycle-aware translation

function safeUpper(x, fallback = "") {
  const s = String(x ?? fallback).trim().toUpperCase();
  return s || fallback;
}

function toNum(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
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
    engine: "engine15.readiness.v3",
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

  // 🔥 COMPLETED FIX
  if (
    stage === "COMPLETED" ||
    d15.setupCompleted === true
  ) {
    return buildOutput({
      symbol,
      strategyId,
      readiness: "LOOK_FOR_NEXT_SETUP", // ✅ FIXED
      strategyType: d15.strategyType,   // ✅ PRESERVED
      direction: d15.direction,
      active: false,
      freshEntryNow: false,
      reasonCodes: [
        "LIFECYCLE_COMPLETED",
        "LOOK_FOR_NEXT_SETUP",
      ],
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
      reasonCodes: [
        "LIFECYCLE_MATURE",
        "NO_FRESH_ENTRY",
      ],
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
      reasonCodes: [
        "LIFECYCLE_PARTIAL",
        "NO_CHASE",
      ],
      source: {
        owner: "ENGINE15_DECISION",
        lifecycleStage: stage,
      },
    });
  }

  return null;
}

export function computeEngine15Readiness({
  symbol = "SPY",
  strategyId = null,
  engine16 = null,
  engine15Decision = null,
} = {}) {
  try {
    const d15 = normalizeDecision(engine15Decision);

    // 🔥 FIRST: lifecycle-aware translation
    if (d15.ok === true) {
      const translated = lifecycleTranslate({
        symbol,
        strategyId,
        d15,
      });

      if (translated) return translated;
    }

    // fallback to engine16
    if (!engine16 || engine16.strategyType === "NONE") {
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
      readiness: "NO_SETUP",
      strategyType: "NONE",
      direction: "NONE",
      freshEntryNow: false,
      reasonCodes: ["ENGINE15_ERROR"],
    };
  }
}

export default computeEngine15Readiness;
