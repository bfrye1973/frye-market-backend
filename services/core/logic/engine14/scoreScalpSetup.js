// services/core/logic/engine14/scoreScalpSetup.js

import { QUALITY_BUCKETS } from "./constants.js";
import { scoreMomentumSupport } from "./detectMomentumConflicts.js";

function qualityLabel(score) {
  return QUALITY_BUCKETS.find((x) => score >= x.min)?.label || "D";
}

export function scoreScalpSetup({
  setup,
  zone,
  price,
  engine3,
  engine4,
  smi10m,
  smi1h,
  compression,
  conflicts,
}) {
  if (!setup) {
    return {
      confidence: 0,
      quality: "D",
      reasonCodes: [],
    };
  }

  let score = 0;
  const reasonCodes = [...(setup.reasonCodes || [])];

  // A) zone behavior / structure (35)
  if (setup.setupType === "DISPLACEMENT_RETEST") score += 28;
  if (setup.setupType === "FAILURE" || setup.setupType === "ACCEPTANCE") score += 24;
  if (setup.setupType === "UPPER_REJECTION" || setup.setupType === "LOWER_REJECTION") score += 22;

  if (zone?.zonePos01 != null) {
    if (setup.direction === "SHORT" && zone.zonePos01 >= 0.55) score += 5;
    if (setup.direction === "LONG" && zone.zonePos01 <= 0.45) score += 5;
  }

  // B) candle quality (25)
  const cq = setup.candleQuality || {};

  if ((cq.rangeExpansion || 0) >= 2.2) {
    score += 14;
    reasonCodes.push("RANGE_EXPANSION_EXCEPTIONAL");
  } else if ((cq.rangeExpansion || 0) >= 1.8) {
    score += 11;
    reasonCodes.push("RANGE_EXPANSION_STRONG");
  } else if ((cq.rangeExpansion || 0) >= 1.5) {
    score += 8;
    reasonCodes.push("RANGE_EXPANSION_MODERATE");
  } else if ((cq.rangeExpansion || 0) >= 1.3) {
    score += 4;
    reasonCodes.push("RANGE_EXPANSION_LIGHT");
  } else {
    reasonCodes.push("RANGE_EXPANSION_WEAK");
  }

  if ((cq.bodyPercent || 0) >= 0.75) {
    score += 11;
    reasonCodes.push("BODY_VELOCITY_EXCEPTIONAL");
  } else if ((cq.bodyPercent || 0) >= 0.65) {
    score += 8;
    reasonCodes.push("BODY_VELOCITY_STRONG");
  } else if ((cq.bodyPercent || 0) >= 0.55) {
    score += 5;
    reasonCodes.push("BODY_VELOCITY_MODERATE");
  } else if ((cq.bodyPercent || 0) >= 0.45) {
    score += 2;
    reasonCodes.push("BODY_VELOCITY_LIGHT");
  } else {
    reasonCodes.push("BODY_VELOCITY_WEAK");
  }

  if (setup.direction === "SHORT" && cq.closeNearLow) {
    reasonCodes.push("CLOSE_NEAR_LOW");
  }

  if (setup.direction === "LONG" && cq.closeNearHigh) {
    reasonCodes.push("CLOSE_NEAR_HIGH");
  }

  if (cq.displacementDetected) {
    reasonCodes.push("DISPLACEMENT_DETECTED");
  }

  if ((cq.volumeExpansion || 0) >= 2.0) {
    score += 6;
    reasonCodes.push("VOLUME_EXPANSION_STRONG");
  } else if ((cq.volumeExpansion || 0) >= 1.5) {
    score += 4;
    reasonCodes.push("VOLUME_EXPANSION_SUPPORTIVE");
  } else if ((cq.volumeExpansion || 0) >= 1.2) {
    score += 2;
    reasonCodes.push("VOLUME_EXPANSION_LIGHT");
  }

  // C) E3 + E4 (20)
  if (Number(engine3?.reactionScore || 0) >= 7) {
    score += 8;
    reasonCodes.push("REACTION_SCORE_STRONG");
  } else if (Number(engine3?.reactionScore || 0) >= 4) {
    score += 4;
    reasonCodes.push("REACTION_SCORE_SUPPORTIVE");
  }

  const pressureBias = String(engine4?.pressureBias || "");
  const flags = engine4?.flags || {};

  if (setup.direction === "SHORT") {
    if (pressureBias.includes("BEARISH")) {
      score += 5;
      reasonCodes.push("E4_BEARISH_PRESSURE");
    }
    if (flags.reversalExpansion || flags.initiativeMoveConfirmed || flags.distributionDetected) {
      score += 7;
      reasonCodes.push("E4_CONFIRMATION");
    }
  }

  if (setup.direction === "LONG") {
    if (pressureBias.includes("BULLISH") || pressureBias.includes("CONSTRUCTIVE")) {
      score += 5;
      reasonCodes.push("E4_BULLISH_PRESSURE");
    }
    if (flags.reversalExpansion || flags.initiativeMoveConfirmed || flags.absorptionDetected) {
      score += 7;
      reasonCodes.push("E4_CONFIRMATION");
    }
  }

  // C.5) continuation-quality boost
  if (
    setup.setupType === "FAILURE" &&
    setup.direction === "SHORT" &&
    (cq.volumeExpansion || 0) >= 1.5 &&
    smi10m?.direction === "DOWN" &&
    smi1h?.direction === "DOWN" &&
    (flags.initiativeMoveConfirmed || flags.reversalExpansion || flags.distributionDetected)
  ) {
    score += 12;
    reasonCodes.push("LOWER_ACCEPTANCE_CONTINUATION");
  }

  if (
    setup.setupType === "ACCEPTANCE" &&
    setup.direction === "LONG" &&
    (cq.volumeExpansion || 0) >= 1.5 &&
    smi10m?.direction === "UP" &&
    smi1h?.direction === "UP" &&
    (flags.initiativeMoveConfirmed || flags.reversalExpansion || flags.absorptionDetected)
  ) {
    score += 12;
    reasonCodes.push("HIGHER_ACCEPTANCE_CONTINUATION");
  }

  // D) momentum (20)
  const momentumSupport = scoreMomentumSupport({
    direction: setup.direction,
    smi10m,
    smi1h,
    compression,
  });

  score += momentumSupport.score;
  reasonCodes.push(...momentumSupport.reasonCodes);

  // penalties
  score -= Number(conflicts?.penalty || 0);
  reasonCodes.push(...(conflicts?.reasonCodes || []));

  if (engine4?.flags?.liquidityTrap) {
    score -= 4;
    reasonCodes.push("LIQUIDITY_TRAP_PENALTY");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    confidence: score,
    quality: qualityLabel(score),
    reasonCodes: [...new Set(reasonCodes)],
  };
}
