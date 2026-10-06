// services/core/logic/engine22/wave/buildTargetClusterConfidence.js
// Engine 22G — Target Cluster Confidence
//
// Purpose:
// Score higher-degree fib target clusters.
// This is NOT statistical probability.
// It is a confluence/confidence score based on fib target clustering.
//
// Rule:
// Do not blindly use min-to-max of all targets.
// Find the best/tightest valid cluster of at least 2 fib levels.

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

function fibLabel(fibKey) {
  return String(fibKey || "e1618").replace("e", "");
}

function degreeLabel(degree) {
  const d = String(degree || "").toLowerCase();
  if (d === "primary") return "Primary";
  if (d === "intermediate") return "Intermediate";
  if (d === "minor") return "Minor";
  if (d === "minute") return "Minute";
  if (d === "micro") return "Micro";
  return String(degree || "Unknown");
}

function scoreCluster({ levelCount, widthPct, higherW5Active, activeW4Pullback }) {
  let score = 0;

  if (levelCount >= 2) score += 40;
  if (levelCount >= 3) score += 10;

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

function plainLabel(label) {
  return String(label || "").replaceAll("_", " ").toLowerCase();
}

function buildClusterStats(levels) {
  const prices = levels.map((x) => x.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const mid = (lo + hi) / 2;
  const widthPts = hi - lo;
  const widthPct = mid > 0 ? (widthPts / mid) * 100 : null;

  return { lo, hi, mid, widthPts, widthPct };
}

function findBestCluster({ candidates, higherW5Active, activeW4Pullback }) {
  const sorted = [...candidates].sort((a, b) => a.price - b.price);

  let best = null;

  for (let start = 0; start < sorted.length; start += 1) {
    for (let end = start + 1; end < sorted.length; end += 1) {
      const levels = sorted.slice(start, end + 1);
      if (levels.length < 2) continue;

      const stats = buildClusterStats(levels);
      const score = scoreCluster({
        levelCount: levels.length,
        widthPct: stats.widthPct,
        higherW5Active,
        activeW4Pullback,
      });

      const candidate = {
        levels,
        stats,
        score,
      };

      if (!best) {
        best = candidate;
        continue;
      }

      // Prefer higher score first.
      if (candidate.score > best.score) {
        best = candidate;
        continue;
      }

      // If tied, prefer tighter cluster.
      if (
        candidate.score === best.score &&
        Number.isFinite(candidate.stats.widthPct) &&
        Number.isFinite(best.stats.widthPct) &&
        candidate.stats.widthPct < best.stats.widthPct
      ) {
        best = candidate;
        continue;
      }

      // If tied again, prefer more levels.
      if (
        candidate.score === best.score &&
        candidate.stats.widthPct === best.stats.widthPct &&
        candidate.levels.length > best.levels.length
      ) {
        best = candidate;
      }
    }
  }

  return best;
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
      score: 0,
      label: "TARGET_CLUSTER_UNAVAILABLE",
      reasonCodes: ["MISSING_WAVE_FIB_STATE"],
    };
  }

  const allLevels = ["primary", "intermediate", "minor"]
    .map((degree) => {
      const price = getLevel(waveFibState, degree, fibKey);

      return {
        degree,
        label: `${degreeLabel(degree)} ${fibLabel(fibKey)}`,
        price,
        phase: getPhase(waveFibState, degree),
      };
    })
    .filter((x) => Number.isFinite(x.price));

  if (allLevels.length < 2) {
    return {
      ok: true,
      active: false,
      symbol,
      fibKey,
      score: 0,
      label: "TARGET_CLUSTER_UNAVAILABLE",
      activationState: "NOT_ENOUGH_VALID_LEVELS",
      cluster: null,
      levels: allLevels,
      allLevels,
      message: "Target cluster unavailable. Need at least two valid higher-degree fib targets.",
      dashboardRead: "Target cluster unavailable.",
      reasonCodes: ["LESS_THAN_TWO_VALID_TARGET_LEVELS"],
    };
  }

  const primaryPhase = getPhase(waveFibState, "primary");
  const intermediatePhase = getPhase(waveFibState, "intermediate");
  const minorPhase = getPhase(waveFibState, "minor");
  const activeDegree = String(waveFibState?.activeTradingDegree || "").toLowerCase();
  const activeDegreePhase = activeDegree ? getPhase(waveFibState, activeDegree) : "UNKNOWN";

  const higherW5Active =
    primaryPhase === "IN_W5" &&
    intermediatePhase === "IN_W5";

  const activeW4Pullback =
    minorPhase === "IN_W4" ||
    activeDegreePhase === "IN_W4";

  const best = findBestCluster({
    candidates: allLevels,
    higherW5Active,
    activeW4Pullback,
  });

  if (!best) {
    return {
      ok: true,
      active: false,
      symbol,
      fibKey,
      score: 0,
      label: "TARGET_CLUSTER_UNAVAILABLE",
      activationState: "NO_VALID_CLUSTER_FOUND",
      levels: [],
      allLevels,
      reasonCodes: ["NO_VALID_CLUSTER_FOUND"],
    };
  }

  const score = best.score;
  const label = labelFromScore(score);
  const activationState = activeW4Pullback
    ? "CONDITIONAL_ON_W4_HOLD_AND_RECLAIM"
    : "ACTIVE_TARGET_CLUSTER";

  const stats = best.stats;
  const clusterLevels = best.levels;

  const levelText = clusterLevels
    .map((x) => `${x.label}: ${round2(x.price)}`)
    .join(" | ");

  return {
    ok: true,
    active: true,
    symbol,
    fibKey,

    label,
    score,
    activationState,

    cluster: {
      lo: round2(stats.lo),
      hi: round2(stats.hi),
      mid: round2(stats.mid),
      widthPts: round2(stats.widthPts),
      widthPct: round2(stats.widthPct),
    },

    levels: clusterLevels.map((x) => ({
      degree: x.degree,
      label: x.label,
      price: round2(x.price),
      phase: x.phase,
    })),

    allLevels: allLevels.map((x) => ({
      degree: x.degree,
      label: x.label,
      price: round2(x.price),
      phase: x.phase,
    })),

    message:
      `Higher-degree ${fibLabel(fibKey)} targets cluster near ${round2(stats.lo)}–${round2(stats.hi)}. ` +
      `Cluster width is ${round2(stats.widthPts)} pts / ${round2(stats.widthPct)}%. ` +
      `Score ${score}/100 = ${plainLabel(label)}. ` +
      `This is conditional on W4 holding and reclaim confirmation.`,

    dashboardRead:
      `Wave target cluster: ${round2(stats.lo)}–${round2(stats.hi)} | Score ${score}/100 | Conditional on W4 hold/reclaim.`,

    detailRead: levelText,

    needs: activeW4Pullback
      ? [
          "W4_HOLD_OR_W4_MARK",
          "10M_RECLAIM_CONFIRMATION",
          "1H_STABILIZATION",
          "ENGINE3_REACTION_CONFIRMATION",
          "ENGINE4_PARTICIPATION_CONFIRMATION",
        ]
      : [
          "10M_RECLAIM_CONFIRMATION",
          "ENGINE3_REACTION_CONFIRMATION",
          "ENGINE4_PARTICIPATION_CONFIRMATION",
        ],

    reasonCodes: [
      "TARGET_CLUSTER_CONFIDENCE_BUILT",
      `${clusterLevels.length}_LEVEL_BEST_CLUSTER`,
      `${allLevels.length}_VALID_TARGET_LEVELS_TOTAL`,
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
