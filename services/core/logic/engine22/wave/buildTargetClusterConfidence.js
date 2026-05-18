// services/core/logic/engine22/wave/buildTargetClusterConfidence.js
// Engine 22G — Target Cluster Confidence
//
// Purpose:
// Score higher-degree fib target clusters.
// This is NOT statistical probability.
// It is a confluence/confidence score based on fib target clustering.

function toNum(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function getLevel(waveFibState, degree, key) {
  return toNum(waveFibState?.degrees?.[degree]?.fibProjection?.levels?.[key]);
}

function getPhase(waveFibState, degree) {
  return String(waveFibState?.degrees?.[degree]?.phase || "UNKNOWN").toUpperCase();
}

function scoreCluster({ levels, widthPct, higherW5Active, activeW4Pullback }) {
  let score = 0;

  if (levels.length >= 2) score += 40;
  if (levels.length >= 3) score += 10;

  if (Number.isFinite(widthPct)) {
    if (widthPct <= 1.0) score += 30;
    else if (widthPct <= 1.75) score += 22;
    else if (widthPct <= 2.5) score += 15;
    else if (widthPct <= 4.0) score += 8;
  }

  if (higherW5Active) score += 10;
  if (activeW4Pullback) score += 5;

  return Math.min(100, score);
}

function labelFromScore(score) {
  if (score >= 80) return "HIGH_TARGET_CLUSTER_CONFIDENCE";
  if (score >= 65) return "GOOD_TARGET_CLUSTER_CONFIDENCE";
  if (score >= 50) return "MODERATE_TARGET_CLUSTER_CONFIDENCE";
  return "LOW_TARGET_CLUSTER_CONFIDENCE";
}

export function buildTargetClusterConfidence({
  symbol = "SPY",
  waveFibState = null,
  fibKey = "e1618",
} = {}) {
  if (!waveFibState || typeof waveFibState !== "object") {
    return {
      ok: false,
      active: false,
      symbol,
      fibKey,
      reasonCodes: ["MISSING_WAVE_FIB_STATE"],
    };
  }

  const candidates = [
    {
      degree: "primary",
      label: "Primary 1.618",
      price: getLevel(waveFibState, "primary", fibKey),
      phase: getPhase(waveFibState, "primary"),
    },
    {
      degree: "intermediate",
      label: "Intermediate 1.618",
      price: getLevel(waveFibState, "intermediate", fibKey),
      phase: getPhase(waveFibState, "intermediate"),
    },
    {
      degree: "minor",
      label: "Minor 1.618",
      price: getLevel(waveFibState, "minor", fibKey),
      phase: getPhase(waveFibState, "minor"),
    },
  ].filter((x) => Number.isFinite(x.price));

  if (candidates.length < 2) {
    return {
      ok: true,
      active: false,
      symbol,
      fibKey,
      label: "TARGET_CLUSTER_UNAVAILABLE",
      score: 0,
      reasonCodes: ["LESS_THAN_TWO_VALID_TARGET_LEVELS"],
      candidates,
    };
  }

  const prices = candidates.map((x) => x.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const mid = (lo + hi) / 2;
  const widthPts = hi - lo;
  const widthPct = mid > 0 ? (widthPts / mid) * 100 : null;

  const primaryPhase = getPhase(waveFibState, "primary");
  const intermediatePhase = getPhase(waveFibState, "intermediate");
  const minorPhase = getPhase(waveFibState, "minor");
  const activeDegree = String(waveFibState?.activeTradingDegree || "").toLowerCase();

  const higherW5Active =
    primaryPhase === "IN_W5" &&
    intermediatePhase === "IN_W5";

  const activeW4Pullback =
    minorPhase === "IN_W4" ||
    waveFibState?.degrees?.[activeDegree]?.phase === "IN_W4";

  const score = scoreCluster({
    levels: candidates,
    widthPct,
    higherW5Active,
    activeW4Pullback,
  });

  const label = labelFromScore(score);

  const activationState = activeW4Pullback
    ? "CONDITIONAL_ON_W4_HOLD_AND_RECLAIM"
    : "ACTIVE_TARGET_CLUSTER";

  return {
    ok: true,
    active: true,
    symbol,
    fibKey,

    label,
    score,
    activationState,

    cluster: {
      lo: round2(lo),
      hi: round2(hi),
      mid: round2(mid),
      widthPts: round2(widthPts),
      widthPct: round2(widthPct),
    },

    levels: candidates.map((x) => ({
      degree: x.degree,
      label: x.label,
      price: round2(x.price),
      phase: x.phase,
    })),

    message:
      `Higher-degree ${fibKey.replace("e", "")} targets cluster near ${round2(lo)}–${round2(hi)}. ` +
      `Cluster width is ${round2(widthPts)} pts / ${round2(widthPct)}%. ` +
      `Score ${score}/100 = ${label.replaceAll("_", " ").toLowerCase()}. ` +
      `This is conditional on W4 holding and reclaim confirmation.`,

   dashboardRead:
      `Wave target cluster: ${round2(lo)}–${round2(hi)} | Score ${score}/100 | Conditional on W4 hold/reclaim.`,

    needs: [
      "W4_HOLD_OR_W4_MARK",
      "10M_RECLAIM_CONFIRMATION",
      "1H_STABILIZATION",
      "ENGINE3_REACTION_CONFIRMATION",
      "ENGINE4_PARTICIPATION_CONFIRMATION",
    ],

    reasonCodes: [
      "TARGET_CLUSTER_CONFIDENCE_BUILT",
      `${candidates.length}_VALID_TARGET_LEVELS`,
      higherW5Active
        ? "PRIMARY_INTERMEDIATE_W5_ACTIVE"
        : "HIGHER_W5_NOT_FULLY_ALIGNED",
      activeW4Pullback
        ? "ACTIVE_W4_PULLBACK_CONDITIONAL"
        : "NO_ACTIVE_W4_PULLBACK",
      label,
    ],
  };
}

export default buildTargetClusterConfidence;
