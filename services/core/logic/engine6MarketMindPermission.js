// services/core/logic/engine6MarketMindPermission.js
// ENGINE 6 — MarketMind Permission (FINAL, LOCKED)
//
// Purpose:
//   Fuse FRONTEND Market Meter (subconscious) + Engine 5 setup (conscious score)
//   into ONE decision per strategy:
//
//   - permission:   ALLOW | REDUCE | STAND_DOWN
//   - direction:    LONG_ONLY | SHORT_ONLY | BOTH | NONE
//   - sizeMultiplier: 1.0 | 0.5 | 0.25 | 0.0   (0.25 reserved; not used in v1)
//   - driver:       EOD | 4H | 1H | 10M
//   - reasonCodes:  array of explainable reasons
//
// LOCKED STRATEGY MAPPING:
//   intraday_scalp@10m:
//     - direction: 1h + 10m agreement
//     - entry timing: 10m
//     - 4h is confidence booster only (>=57 longs, <=44 shorts) (no blocks)
//
//   minor_swing@1h:
//     - direction: 1h + 4h agreement
//     - entry timing: 10m
//
//   intermediate_long@4h:
//     - direction: 4h + EOD agreement (LONGS only)
//     - entry timing: 1h
//
// LOCKED AGGRESSION (4H primary):
//   score4h >= 60  => ALLOW (1.0)
//   score4h 55–59  => REDUCE (0.5)
//   score4h < 55   => STAND_DOWN (0.0)
//
// HARD STAND-DOWN (absolute):
//   setup.invalid === true
//   OR setupScore < 70
//   OR direction === NONE
//   OR score4h < 50
//
// TIMING OVERRIDE:
//   If entry timeframe not aligned => permission STAND_DOWN, size 0.0 (entries blocked)
//   (direction stays for context)
//
// Notes:
// - Engine 6 does NOT compute market scores.
// - Engine 6 does NOT score setups.
// - Engine 6 is a permission/direction/size gate only.

const VALID_STRATEGIES = new Set([
  "intraday_scalp@10m",
  "minor_swing@1h",
  "intermediate_long@4h",
]);

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

function clamp0_100(v) {
  const x = n(v);
  if (!Number.isFinite(x)) return NaN;
  return Math.max(0, Math.min(100, x));
}

function pushReason(arr, code) {
  if (!code) return;
  arr.push(String(code));
}

function isBull(score) {
  return Number.isFinite(score) && score >= 60;
}

function isBear(score) {
  return Number.isFinite(score) && score <= 40;
}

/**
 * Strategy direction (UNIFIED output)
 * Returns: LONG_ONLY | SHORT_ONLY | BOTH | NONE
 */
function computeDirection(strategyId, scores) {
  const s10 = scores.score10m;
  const s1 = scores.score1h;
  const s4 = scores.score4h;
  const sE = scores.scoreEOD;

  const bull10 = isBull(s10), bear10 = isBear(s10);
  const bull1 = isBull(s1), bear1 = isBear(s1);
  const bull4 = isBull(s4), bear4 = isBear(s4);
  const bullE = isBull(sE), bearE = isBear(sE);

  if (strategyId === "intraday_scalp@10m") {
    // Direction = 1h + 10m agreement; else NONE
    if (bull1 && bull10) return "LONG_ONLY";
    if (bear1 && bear10) return "SHORT_ONLY";
    return "NONE";
  }

  if (strategyId === "minor_swing@1h") {
    // Direction = 1h + 4h agreement; else NONE
    if (bull1 && bull4) return "LONG_ONLY";
    if (bear1 && bear4) return "SHORT_ONLY";
    return "NONE";
  }

  if (strategyId === "intermediate_long@4h") {
    // Direction = 4h + EOD agreement; LONGS only; else NONE
    if (bull4 && bullE) return "LONG_ONLY";
    return "NONE";
  }

  return "NONE";
}

/**
 * Entry timing alignment (entries only)
 * Returns boolean timingOk
 */
function timingOk(strategyId, direction, scores) {
  const s10 = scores.score10m;
  const s1 = scores.score1h;

  const wantsLong = direction === "LONG_ONLY" || direction === "BOTH";
  const wantsShort = direction === "SHORT_ONLY" || direction === "BOTH";

  // LOCKED timing thresholds:
  // - LONG timing:  score >= 55
  // - SHORT timing: score <= 45

  if (strategyId === "intermediate_long@4h") {
    // Entry timing is 1h (longs only in this strategy)
    if (wantsLong) return Number.isFinite(s1) && s1 >= 55;
    if (wantsShort) return Number.isFinite(s1) && s1 <= 45;
    return false;
  }

  // Scalp + Minor Swing entry timing uses 10m
  if (direction === "LONG_ONLY") return Number.isFinite(s10) && s10 >= 55;
  if (direction === "SHORT_ONLY") return Number.isFinite(s10) && s10 <= 45;

  // BOTH: allow if at least one side has timing signal.
  // (Execution will still only take entries consistent with direction permission.)
  if (direction === "BOTH") {
    const okLong = Number.isFinite(s10) && s10 >= 55;
    const okShort = Number.isFinite(s10) && s10 <= 45;
    return okLong || okShort;
  }

  return false;
}

/**
 * Aggression from 4H (LOCKED thresholds)
 */
function aggressionFrom4h(score4h) {
  if (!Number.isFinite(score4h)) {
    return { permission: "STAND_DOWN", sizeMultiplier: 0.0, reason: "MISSING_SCORE_4H" };
  }
  if (score4h >= 60) return { permission: "ALLOW", sizeMultiplier: 1.0, reason: "4H_ALLOW_GE_60" };
  if (score4h >= 55) return { permission: "REDUCE", sizeMultiplier: 0.5, reason: "4H_REDUCE_55_59" };
  return { permission: "STAND_DOWN", sizeMultiplier: 0.0, reason: "4H_STANDDOWN_LT_55" };
}

/**
 * 4H confidence boost (intraday/scalp only; informational)
 * - >=57 boosts longs
 * - <=44 boosts shorts
 */
function scalp4hBoost(score4h, direction, reasons) {
  if (!Number.isFinite(score4h)) return;
  if (direction === "LONG_ONLY" && score4h >= 57) pushReason(reasons, "4H_BOOST_LONG_GE_57");
  if (direction === "SHORT_ONLY" && score4h <= 44) pushReason(reasons, "4H_BOOST_SHORT_LE_44");
}

/**
 * Main compute
 *
 * @param {Object} args
 * @param {string} args.strategyId
 * @param {Object} args.market - { score10m, score1h, score4h, scoreEOD, scoreMaster? }
 * @param {Object} args.setup  - { setupScore, label, invalid }
 * @returns {Object} Engine 6 decision
 */
export function computeEngine6MarketMindPermission({ strategyId, market, setup }) {
  const reasons = [];

  if (!VALID_STRATEGIES.has(strategyId)) {
    return {
      permission: "STAND_DOWN",
      direction: "NONE",
      sizeMultiplier: 0.0,
      driver: "4H",
      reasonCodes: ["UNKNOWN_STRATEGY"],
    };
  }

  const scores = {
    score10m: clamp0_100(market?.score10m),
    score1h: clamp0_100(market?.score1h),
    score4h: clamp0_100(market?.score4h),
    scoreEOD: clamp0_100(market?.scoreEOD),
    scoreMaster: clamp0_100(market?.scoreMaster), // display-only (optional)
  };

  const setupScore = clamp0_100(setup?.setupScore);
  const setupInvalid = setup?.invalid === true;

  // -------------------------
  // HARD STAND-DOWN RULES
  // -------------------------
  if (setupInvalid) {
    return {
      permission: "STAND_DOWN",
      direction: "NONE",
      sizeMultiplier: 0.0,
      driver: "4H",
      reasonCodes: ["SETUP_INVALID"],
    };
  }

  if (!Number.isFinite(setupScore) || setupScore < 70) {
    return {
      permission: "STAND_DOWN",
      direction: "NONE",
      sizeMultiplier: 0.0,
      driver: "4H",
      reasonCodes: ["SETUP_SCORE_LT_70"],
    };
  }

  // Direction by strategy
  const direction = computeDirection(strategyId, scores);
  if (direction === "NONE") {
    return {
      permission: "STAND_DOWN",
      direction: "NONE",
      sizeMultiplier: 0.0,
      driver: strategyId === "intermediate_long@4h" ? "EOD" : "1H",
      reasonCodes: ["DIRECTION_NONE"],
    };
  }

  // Hard stand-down: score4h < 50
  if (Number.isFinite(scores.score4h) && scores.score4h < 50) {
    return {
      permission: "STAND_DOWN",
      direction,
      sizeMultiplier: 0.0,
      driver: "4H",
      reasonCodes: ["4H_HARD_STANDDOWN_LT_50"],
    };
  }

  // Aggression from 4H (PRIMARY)
  const agg = aggressionFrom4h(scores.score4h);
  pushReason(reasons, agg.reason);

  // Scalp 4H boost (informational only)
  if (strategyId === "intraday_scalp@10m") {
    scalp4hBoost(scores.score4h, direction, reasons);
  }

  if (agg.permission === "STAND_DOWN") {
    return {
      permission: "STAND_DOWN",
      direction,
      sizeMultiplier: 0.0,
      driver: "4H",
      reasonCodes: reasons,
    };
  }

  // Timing override (entries blocked if timing not aligned)
  const okTiming = timingOk(strategyId, direction, scores);
  if (!okTiming) {
    return {
      permission: "STAND_DOWN",
      direction,
      sizeMultiplier: 0.0,
      driver: strategyId === "intermediate_long@4h" ? "1H" : "10M",
      reasonCodes: ["TIMING_NOT_ALIGNED"],
    };
  }

  // Final
  return {
    permission: agg.permission,
    direction,
    sizeMultiplier: agg.sizeMultiplier,
    driver: "4H",
    reasonCodes: reasons,
  };
}
