// services/core/logic/engine14/detectMomentumConflicts.js

export function detectMomentumConflicts({
  direction,
  smi10m,
  smi1h,
  compression,
}) {
  const reasonCodes = [];
  let penalty = 0;

  const dir10 = String(smi10m?.direction || "NONE");
  const dir1h = String(smi1h?.direction || "NONE");
  const cross10 = String(smi10m?.cross || "NONE");
  const cross1h = String(smi1h?.cross || "NONE");

  if (direction === "SHORT") {
    if (dir10 === "UP") {
      reasonCodes.push("SMI_CONFLICT_10M_UP");
      penalty += 6;
    }
    if (dir1h === "UP") {
      reasonCodes.push("HTF_MOMENTUM_AGAINST_SETUP");
      penalty += 5;
    }
    if (compression?.state === "RELEASE_UP") {
      reasonCodes.push("COMPRESSION_RELEASE_AGAINST_SETUP");
      penalty += 4;
    }
    if (cross10 === "BULLISH") {
      reasonCodes.push("SMI_BULLISH_CROSS_10M");
      penalty += 4;
    }
    if (cross1h === "BULLISH") {
      reasonCodes.push("SMI_BULLISH_CROSS_1H");
      penalty += 3;
    }
  }

  if (direction === "LONG") {
    if (dir10 === "DOWN") {
      reasonCodes.push("SMI_CONFLICT_10M_DOWN");
      penalty += 6;
    }
    if (dir1h === "DOWN") {
      reasonCodes.push("HTF_MOMENTUM_AGAINST_SETUP");
      penalty += 5;
    }
    if (compression?.state === "RELEASE_DOWN") {
      reasonCodes.push("COMPRESSION_RELEASE_AGAINST_SETUP");
      penalty += 4;
    }
    if (cross10 === "BEARISH") {
      reasonCodes.push("SMI_BEARISH_CROSS_10M");
      penalty += 4;
    }
    if (cross1h === "BEARISH") {
      reasonCodes.push("SMI_BEARISH_CROSS_1H");
      penalty += 3;
    }
  }

  return {
    present: penalty > 0,
    penalty,
    reasonCodes,
    level: penalty >= 12 ? "HIGH" : penalty >= 6 ? "MODERATE" : penalty > 0 ? "LOW" : "NONE",
  };
}

export function scoreMomentumSupport({ direction, smi10m, smi1h, compression }) {
  let score = 0;
  const reasonCodes = [];

  if (direction === "SHORT") {
    if (smi10m?.direction === "DOWN") {
      score += 8;
      reasonCodes.push("SMI_10M_SUPPORTIVE");
    }
    if (smi1h?.direction === "DOWN") {
      score += 5;
      reasonCodes.push("SMI_1H_SUPPORTIVE");
    }
    if (compression?.state === "RELEASE_DOWN") {
      score += 4;
      reasonCodes.push("COMPRESSION_RELEASE_MATCH");
    }
  }

  if (direction === "LONG") {
    if (smi10m?.direction === "UP") {
      score += 8;
      reasonCodes.push("SMI_10M_SUPPORTIVE");
    }
    if (smi1h?.direction === "UP") {
      score += 5;
      reasonCodes.push("SMI_1H_SUPPORTIVE");
    }
    if (compression?.state === "RELEASE_UP") {
      score += 4;
      reasonCodes.push("COMPRESSION_RELEASE_MATCH");
    }
  }

  return { score, reasonCodes };
}
