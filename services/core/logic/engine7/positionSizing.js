// services/core/logic/engine7/positionSizing.js
// Engine 7 — Position Sizing (LOCKED v1.0)
//
// Engine 7 does NOT decide trades.
// It only answers "how big, if allowed?" in R units.
//
// Inputs (ONLY):
// - Engine 6: permission + sizeMultiplier + reasonCodes
// - Engine 5: totalScore (0–100)
// - Market regime: RISK_ON | NEUTRAL | RISK_OFF
//
// Hard rules:
// - If Engine6.permission === STAND_DOWN => finalR = 0
// - If totalScore < 70 => finalR = 0
// - REDUCE is encoded by Engine6.sizeMultiplier (0.5)
// - No size > 1.00R
// - No martingale / no discretionary overrides

export function computeEngine7PositionSize({
  engine6,
  totalScore,
  regime
}) {
  const e6 = engine6 && typeof engine6 === "object" ? engine6 : {};
  const permission = String(e6.permission || "ALLOW").toUpperCase();
  const e6MultRaw = Number(e6.sizeMultiplier);

  // Engine 6 multiplier is binding upper-bound: 1.0 / 0.5 / 0.0
  const engine6Multiplier = [1, 0.5, 0].includes(e6MultRaw) ? e6MultRaw : (permission === "REDUCE" ? 0.5 : permission === "STAND_DOWN" ? 0 : 1);

  const reasonCodes = Array.isArray(e6.reasonCodes) ? [...e6.reasonCodes] : [];

  // Normalize regime + multiplier (can only reduce)
  const reg = String(regime || "RISK_ON").toUpperCase();
  let regimeMultiplier = 1.0;
  if (reg === "NEUTRAL") regimeMultiplier = 0.75;
  else if (reg === "RISK_OFF") regimeMultiplier = 0.5;
  else regimeMultiplier = 1.0;

  // Base size from score (in R)
  const s = Number(totalScore);
  let baseLabel = "D/F";
  let baseR = 0.0;

  if (Number.isFinite(s)) {
    if (s >= 95) {
      baseLabel = "A+";
      baseR = 1.0;
    } else if (s >= 90) {
      baseLabel = "A";
      baseR = 0.75;
    } else if (s >= 80) {
      baseLabel = "B";
      baseR = 0.5;
    } else if (s >= 70) {
      baseLabel = "C";
      baseR = 0.25;
    } else {
      baseLabel = "D/F";
      baseR = 0.0;
    }
  } else {
    // If score missing/invalid, treat as no trade
    baseLabel = "D/F";
    baseR = 0.0;
  }

  // Permission overrides (MOST IMPORTANT)
  if (permission === "STAND_DOWN") {
    reasonCodes.push("ENGINE6_STAND_DOWN");
    return finalize({
      baseLabel,
      baseR,
      finalR: 0.0,
      engine6Multiplier,
      regimeMultiplier,
      reasonCodes
    });
  }

  // Score too low => no trade
  if (baseR === 0.0) {
    reasonCodes.push("SCORE_TOO_LOW");
    return finalize({
      baseLabel,
      baseR,
      finalR: 0.0,
      engine6Multiplier,
      regimeMultiplier,
      reasonCodes
    });
  }

  // Add informational reason codes
  if (permission === "REDUCE" || engine6Multiplier === 0.5) reasonCodes.push("ENGINE6_REDUCE");
  if (reg === "NEUTRAL") reasonCodes.push("REGIME_NEUTRAL_CAP");
  if (reg === "RISK_OFF") reasonCodes.push("REGIME_RISK_OFF_CAP");

  // Final sizing (clamped)
  let finalR = baseR * engine6Multiplier * regimeMultiplier;

  // Clamp hard max 1R
  if (finalR > 1.0) {
    finalR = 1.0;
    reasonCodes.push("CLAMPED_TO_1R");
  }

  // Round to nearest 0.01R (deterministic)
  finalR = round2(finalR);

  // If rounding pushes to 0, treat as no trade
  if (finalR <= 0) {
    finalR = 0.0;
    reasonCodes.push("FINAL_ZERO");
  }

  return finalize({
    baseLabel,
    baseR,
    finalR,
    engine6Multiplier,
    regimeMultiplier,
    reasonCodes
  });
}

function finalize({ baseLabel, baseR, finalR, engine6Multiplier, regimeMultiplier, reasonCodes }) {
  const band = toBand(finalR);
  const allowed = finalR > 0 && engine6Multiplier > 0;

  return {
    baseLabel,
    baseR,
    finalR,
    band,
    allowed,
    caps: {
      engine6Multiplier,
      regimeMultiplier
    },
    reasonCodes: dedupe(reasonCodes)
  };
}

function toBand(r) {
  if (r <= 0) return "XS";
  if (r <= 0.25) return "XS";
  if (r <= 0.5) return "S";
  if (r <= 0.75) return "M";
  return "L"; // 0.76–1.00
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function dedupe(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr) {
    const k = String(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}
