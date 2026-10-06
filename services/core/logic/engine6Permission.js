// services/core/logic/engine6Permission.js
// ENGINE 6 — FINAL (LOCKED) — Code implementation
//
// Inputs:
//   market: { score10m, score1h, score4h, scoreEOD }
//   setup:  { setupScore, label, invalid }
//   strategyId: "intraday_scalp@10m" | "minor_swing@1h" | "intermediate_long@4h"
//
// Output:
//   {
//     permission: "ALLOW" | "REDUCE" | "STAND_DOWN",
//     direction: "LONG_ONLY" | "SHORT_ONLY" | "BOTH" | "NONE",
//     sizeMultiplier: 1.0 | 0.5 | 0.25 | 0.0,
//     driver: "EOD" | "4H" | "1H" | "10M",
//     reasonCodes: string[]
//   }

const STRATEGIES = new Set([
  "intraday_scalp@10m",
  "minor_swing@1h",
  "intermediate_long@4h",
]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function clamp0_100(v) {
  const n = num(v);
  if (!Number.isFinite(n)) return NaN;
  return Math.max(0, Math.min(100, n));
}

function isBullScore(score) {
  // your meter is 0–100; use >=60 bullish bias convention
  return Number.isFinite(score) && score >= 60;
}
function isBearScore(score) {
  return Number.isFinite(score) && score <= 40;
}

/** Step 1 — EOD direction gate (global rule) */
function directionFromEOD(scoreEOD) {
  if (isBullScore(scoreEOD)) return "LONG_ONLY";
  if (isBearScore(scoreEOD)) return "SHORT_ONLY";
  return "BOTH";
}

/** Strategy-specific direction drivers (your agreed mapping) */
function directionForStrategy(strategyId, market) {
  const s10 = market.score10m;
  const s1h = market.score1h;
  const s4h = market.score4h;
  const sE  = market.scoreEOD;

  // helper: “bullish” / “bearish” from score thresholds
  const bull10 = isBullScore(s10);
  const bear10 = isBearScore(s10);
  const bull1  = isBullScore(s1h);
  const bear1  = isBearScore(s1h);
  const bull4  = isBullScore(s4h);
  const bear4  = isBearScore(s4h);
  const bullE  = isBullScore(sE);
  const bearE  = isBearScore(sE);

  if (strategyId === "intraday_scalp@10m") {
    // Direction = 1H + 10M must agree; else NONE
    if (bull1 && bull10) return "LONG_ONLY";
    if (bear1 && bear10) return "SHORT_ONLY";
    return "NONE";
  }

  if (strategyId === "minor_swing@1h") {
    // Direction = 1H primary + 4H confirm; else NONE
    if (bull1 && bull4) return "LONG_ONLY";
    if (bear1 && bear4) return "SHORT_ONLY";
    return "NONE";
  }

  if (strategyId === "intermediate_long@4h") {
    // Direction = 4H primary + EOD confirm; longs only; else NONE
    if (bull4 && bullE) return "LONG_ONLY";
    return "NONE";
  }

  return "NONE";
}

/** Strategy-specific entry timing gate (your agreed mapping) */
function timingAligned(strategyId, direction, market) {
  const s10 = market.score10m;
  const s1h = market.score1h;

  // Timing rules (LOCKED):
  // - Intraday/Scalp: 10m is entry timing
  // - Minor Swing:    10m is entry timing
  // - Intermediate:   1h is entry timing
  //
  // Timing thresholds (from your spec):
  // - If direction includes LONG and score10m >= 55 => allow long entries now
  // - If direction includes SHORT and score10m <= 45 => allow short entries now
  //
  // For 1h entry timing (intermediate), mirror the same idea:
  // - LONG timing ok when score1h >= 55
  // - SHORT timing ok when score1h <= 45 (not used in intermediate long since no shorts)

  const needsLong = direction === "LONG_ONLY" || direction === "BOTH";
  const needsShort = direction === "SHORT_ONLY" || direction === "BOTH";

  if (strategyId === "intermediate_long@4h") {
    // entry timing is 1h only
    if (needsLong) return Number.isFinite(s1h) && s1h >= 55;
    if (needsShort) return Number.isFinite(s1h) && s1h <= 45;
    return false;
  }

  // entry timing is 10m
  let okLong = true;
  let okShort = true;

  if (needsLong) okLong = Number.isFinite(s10) && s10 >= 55;
  if (needsShort) okShort = Number.isFinite(s10) && s10 <= 45;

  // If BOTH, require at least one side’s timing to be valid.
  // (Execution will still respect direction; BOTH means market regime allows both.)
  if (direction === "BOTH") return okLong || okShort;

  // If single direction, require that direction timing
  if (direction === "LONG_ONLY") return okLong;
  if (direction === "SHORT_ONLY") return okShort;

  return false;
}

/** Step 2 — Aggression gate (4H primary driver; locked thresholds) */
function aggressionFrom4H(score4h) {
  if (!Number.isFinite(score4h)) {
    return { permission: "STAND_DOWN", sizeMultiplier: 0.0, driver: "4H", reason: "MISSING_SCORE4H" };
  }
  if (score4h >= 60) return { permission: "ALLOW", sizeMultiplier: 1.0, driver: "4H", reason: "4H_ALLOW_GE_60" };
  if (score4h >= 55) return { permission: "REDUCE", sizeMultiplier: 0.5, driver: "4H", reason: "4H_REDUCE_55_59" };
  return { permission: "STAND_DOWN", sizeMultiplier: 0.0, driver: "4H", reason: "4H_STANDDOWN_LT_55" };
}

/**
 * computeEngine6Permission (FINAL)
 */
export function computeEngine6Permission({ strategyId, market, setup }) {
  const reasons = [];

  if (!STRATEGIES.has(strategyId)) {
    return {
      permission: "STAND_DOWN",
      direction: "NONE",
      sizeMultiplier: 0.0,
      driver: "4H",
      reasonCodes: ["UNKNOWN_STRATEGY"],
    };
  }

  // Normalize inputs
  const m = {
    score10m: clamp0_100(market?.score10m),
    score1h: clamp0_100(market?.score1h),
    score4h: clamp0_100(market?.score4h),
    scoreEOD: clamp0_100(market?.scoreEOD),
    scoreMaster: clamp0_100(market?.scoreMaster), // optional (display only)
  };

  const s = {
    setupScore: clamp0_100(setup?.setupScore),
    label: String(setup?.label || ""),
    invalid: setup?.invalid === true,
  };

  // Step 0 — Setup hard gates (LOCKED)
  if (s.invalid) {
    return {
      permission: "STAND_DOWN",
      direction: "NONE",
      sizeMultiplier: 0.0,
      driver: "4H",
      reasonCodes: ["SETUP_INVALID"],
    };
  }
  if (!Number.isFinite(s.setupScore) || s.setupScore < 70) {
    return {
      permission: "STAND_DOWN",
      direction: "NONE",
      sizeMultiplier: 0.0,
      driver: "4H",
      reasonCodes: ["SETUP_SCORE_LT_70"],
    };
  }

  // Step 1 — EOD direction gate (global regime context)
  const eodDir = directionFromEOD(m.scoreEOD);
  // Step 1b — Strategy direction drivers (your strategy mapping)
  let dir = directionForStrategy(strategyId, m);

  // Apply EOD regime constraint:
  // - If strategy wants LONG_ONLY but EOD allows only SHORT_ONLY => NONE
  // - If strategy wants SHORT_ONLY but EOD allows only LONG_ONLY => NONE
  // - If EOD BOTH => keep strategy direction
  if (eodDir === "LONG_ONLY" && dir === "SHORT_ONLY") dir = "NONE";
  if (eodDir === "SHORT_ONLY" && dir === "LONG_ONLY") dir = "NONE";

  // Intermediate long is already LONG_ONLY or NONE; ok.

  if (dir === "NONE") {
    return {
      permission: "STAND_DOWN",
      direction: "NONE",
      sizeMultiplier: 0.0,
      driver: "EOD",
      reasonCodes: ["DIRECTION_NONE"],
    };
  }

  // Step 2 — Aggression (4H primary driver; locked thresholds)
  const agg = aggressionFrom4H(m.score4h);
  reasons.push(agg.reason);

  // Hard stand-down rule (LOCKED): score4h < 50 => STAND_DOWN
  if (Number.isFinite(m.score4h) && m.score4h < 50) {
    return {
      permission: "STAND_DOWN",
      direction: dir,
      sizeMultiplier: 0.0,
      driver: "4H",
      reasonCodes: ["4H_HARD_STANDDOWN_LT_50"],
    };
  }

  // If 4H says STAND_DOWN, stop
  if (agg.permission === "STAND_DOWN") {
    return {
      permission: "STAND_DOWN",
      direction: dir,
      sizeMultiplier: 0.0,
      driver: "4H",
      reasonCodes: [...reasons],
    };
  }

  // Step 3 — Timing override (entries only; locked behavior)
  const timingOk = timingAligned(strategyId, dir, m);
  if (!timingOk) {
    return {
      permission: "STAND_DOWN",
      direction: dir,
      sizeMultiplier: 0.0,
      driver: strategyId === "intermediate_long@4h" ? "1H" : "10M",
      reasonCodes: ["TIMING_NOT_ALIGNED"],
    };
  }

  // Step 4 — Return final permission
  return {
    permission: agg.permission,
    direction: dir,
    sizeMultiplier: agg.sizeMultiplier,
    driver: agg.driver,
    reasonCodes: reasons,
  };
}
