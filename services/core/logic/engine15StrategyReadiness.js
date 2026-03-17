// services/core/logic/engine15Readiness.js
//
// Engine 15 — Readiness / Display Translator
//
// Purpose:
// - Read Engine 16's final readiness label
// - Translate it into one clean readiness object for snapshot/UI
// - Do NOT infer readiness
// - Do NOT resolve priority
// - Do NOT stale-filter
//
// Engine 16 is the source of truth.
//
// Locked readiness labels:
//   EXHAUSTION_READY
//   REVERSAL_READY
//   BREAKDOWN_READY
//   BREAKOUT_READY
//   PULLBACK_READY
//   CONTINUATION_READY
//   NO_SETUP

const VALID_READINESS = new Set([
  "EXHAUSTION_READY",
  "REVERSAL_READY",
  "BREAKDOWN_READY",
  "BREAKOUT_READY",
  "PULLBACK_READY",
  "CONTINUATION_READY",
  "NO_SETUP",
]);

function safeUpper(x) {
  return String(x || "").trim().toUpperCase();
}

function pickDirection(engine16 = null) {
  if (!engine16 || typeof engine16 !== "object") return "NONE";

  // Locked: exhaustion direction is authoritative when present.
  if (engine16.exhaustionShort === true) return "SHORT";
  if (engine16.exhaustionLong === true) return "LONG";

  // Optional future-friendly directional hints from Engine 16.
  if (engine16.breakdownReady === true) return "SHORT";
  if (engine16.breakoutReady === true) return "LONG";
  if (engine16.wickRejectionShort === true) return "SHORT";
  if (engine16.wickRejectionLong === true) return "LONG";

  const explicit = safeUpper(engine16.direction);
  if (["LONG", "SHORT", "NONE"].includes(explicit)) return explicit;

  return "NONE";
}

function normalizeReadinessLabel(engine16 = null) {
  const raw = safeUpper(engine16?.readinessLabel || "NO_SETUP");
  return VALID_READINESS.has(raw) ? raw : "NO_SETUP";
}

function normalizeStrategyType(engine16 = null) {
  const raw = safeUpper(engine16?.strategyType || "");
  switch (raw) {
    case "EXHAUSTION":
    case "REVERSAL":
    case "BREAKDOWN":
    case "BREAKOUT":
    case "PULLBACK":
    case "CONTINUATION":
      return raw;
    default:
      return "NONE";
  }
}

function buildReasonCodes(engine16 = null, readiness = "NO_SETUP", direction = "NONE") {
  const codes = [];

  codes.push(`ENGINE16_${readiness}`);

  if (direction === "LONG") codes.push("DIRECTION_LONG");
  if (direction === "SHORT") codes.push("DIRECTION_SHORT");
  if (direction === "NONE") codes.push("DIRECTION_NONE");

  if (engine16?.strategyType) {
    codes.push(`ENGINE16_STRATEGY_${safeUpper(engine16.strategyType)}`);
  }

  if (engine16?.exhaustionDetected === true) codes.push("ENGINE16_EXHAUSTION_DETECTED");
  if (engine16?.exhaustionActive === true) codes.push("ENGINE16_EXHAUSTION_ACTIVE");

  return codes;
}

export function computeEngine15Readiness({
  symbol = "SPY",
  strategyId = null,
  engine16 = null,
  engine3 = null,
  engine4 = null,
  engine5 = null,
} = {}) {
  const readiness = normalizeReadinessLabel(engine16);
  const strategyType = normalizeStrategyType(engine16);
  const direction = pickDirection(engine16);

  const active =
    readiness !== "NO_SETUP" &&
    (
      strategyType !== "EXHAUSTION" ||
      engine16?.exhaustionActive === true
    );

  return {
    ok: true,
    engine: "engine15.readiness.v1",
    symbol,
    strategyId,
    readiness,
    strategyType,
    direction,
    active,
    reasonCodes: buildReasonCodes(engine16, readiness, direction),

    // Read-only pass-through / debug context for UI
    source: {
      owner: "ENGINE16",
      readinessLabel: engine16?.readinessLabel || "NO_SETUP",
      strategyType: engine16?.strategyType || "NONE",
      exhaustionDetected: engine16?.exhaustionDetected === true,
      exhaustionActive: engine16?.exhaustionActive === true,
      exhaustionShort: engine16?.exhaustionShort === true,
      exhaustionLong: engine16?.exhaustionLong === true,
    },

    // Optional debug visibility from other engines.
    // Engine 15 does NOT use these to decide readiness.
    debug: {
      engine3: engine3
        ? {
            stage: engine3.stage || null,
            armed: engine3.armed === true,
            reactionScore:
              typeof engine3.reactionScore === "number" ? engine3.reactionScore : null,
          }
        : null,
      engine4: engine4
        ? {
            volumeScore:
              typeof engine4.volumeScore === "number" ? engine4.volumeScore : null,
            volumeConfirmed: engine4.volumeConfirmed === true,
            pressureBias: engine4.pressureBias || null,
            volumeRegime: engine4.volumeRegime || null,
          }
        : null,
      engine5: engine5
        ? {
            total:
              typeof engine5?.scores?.total === "number" ? engine5.scores.total : null,
            label: engine5?.scores?.label || null,
          }
        : null,
    },
  };
}

export default computeEngine15Readiness;
