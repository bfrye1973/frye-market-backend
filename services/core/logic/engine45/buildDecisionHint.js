// services/core/logic/engine45/buildDecisionHint.js

function upper(x) {
  return String(x || "").toUpperCase();
}

export function buildDecisionHint({
  alignment,
  momentumState,
  compressionSignal,
  smi10m,
  smi1h,
}) {
  const align = upper(alignment);
  const state = upper(momentumState);
  const releaseState = upper(compressionSignal?.state);
  const early = compressionSignal?.early === true;

  const dir10 = upper(smi10m?.direction);
  const dir1h = upper(smi1h?.direction);

  let biasAssist = "NEUTRAL";
  let releaseAssist = "NONE";
  let summary = "Mixed / neutral momentum context.";

  if (align === "BULLISH") {
    biasAssist = "BULLISH_ASSIST";
    summary = "Bullish alignment across 10m and 1h momentum.";
  } else if (align === "BEARISH") {
    biasAssist = "BEARISH_ASSIST";
    summary = "Bearish alignment across 10m and 1h momentum.";
  } else if (dir10 === "UP" && dir1h === "DOWN") {
    biasAssist = "MIXED_BOUNCE";
    summary = "Short-term bounce inside higher timeframe bearish momentum.";
  } else if (dir10 === "DOWN" && dir1h === "UP") {
    biasAssist = "MIXED_PULLBACK";
    summary = "Short-term pullback inside higher timeframe bullish momentum.";
  }

  if (releaseState === "RELEASING_UP" && early) {
    releaseAssist = "EARLY_UP";
    summary = "Early bullish compression release detected.";
  } else if (releaseState === "RELEASING_DOWN" && early) {
    releaseAssist = "EARLY_DOWN";
    summary = "Early bearish compression release detected.";
  } else if (releaseState === "RELEASING_UP") {
    releaseAssist = "UP_ACTIVE";
    summary = "Bullish release is active but no longer early.";
  } else if (releaseState === "RELEASING_DOWN") {
    releaseAssist = "DOWN_ACTIVE";
    summary = "Bearish release is active but no longer early.";
  } else if (releaseState === "COILING" || state === "COILING") {
    releaseAssist = "COILING";
    summary = "Momentum is coiling and may be preparing to expand.";
  }

  return {
    biasAssist,
    releaseAssist,
    summary,
  };
}

export default buildDecisionHint;
