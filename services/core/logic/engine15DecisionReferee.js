// services/core/logic/engine15DecisionReferee.js
//
// Engine 15B — Decision Referee
//
// Mission:
// - Engine 16 = pattern candidate
// - Engine 5 = quality validator
// - Engine 4.5 = directional assist
// - Engine 6 = risk gate
// - Engine 15B = final referee
//
// Engine 15B decides:
// - what strategy wins
// - what direction is favored
// - how ready it is
// - whether action is allowed now
//
// It does NOT:
// - rescore quality from scratch
// - replace Engine 6 permission
// - replace Engine 8 execution
// - detect raw zones/fibs itself
//
// Safe first draft:
// - trusts one primary Engine 16 candidate
// - supports future multi-candidate expansion
// - never throws

const VALID_STRATEGY_TYPES = new Set([
  "EXHAUSTION",
  "REVERSAL",
  "BREAKDOWN",
  "BREAKOUT",
  "PULLBACK",
  "CONTINUATION",
  "NONE",
]);

const VALID_READINESS = new Set([
  "WAIT",
  "NEAR",
  "ARMING",
  "READY",
  "CONFIRMED",
  "STAND_DOWN",
]);

const VALID_ACTIONS = new Set([
  "NO_ACTION",
  "WATCH",
  "WAIT",
  "ENTER_OK",
  "REDUCE_OK",
  "BLOCKED",
]);

const VALID_BIAS = new Set([
  "LONG_PRIORITY",
  "SHORT_PRIORITY",
  "LONG_COUNTERTREND",
  "SHORT_COUNTERTREND",
  "BALANCED",
  "NONE",
]);

const BASE_PRIORITY = {
  EXHAUSTION: 100,
  REVERSAL: 90,
  BREAKDOWN: 80,
  BREAKOUT: 75,
  PULLBACK: 65,
  CONTINUATION: 55,
  NONE: 0,
};

function safeUpper(x, fallback = "") {
  const s = String(x ?? fallback).trim().toUpperCase();
  return s || fallback;
}

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function scoreToGrade(score) {
  const s = Number(score) || 0;
  if (s >= 90) return "A+";
  if (s >= 80) return "A";
  if (s >= 70) return "B";
  if (s >= 60) return "C";
  return "IGNORE";
}

function normalizeStrategyType(x) {
  const s = safeUpper(x, "NONE");
  return VALID_STRATEGY_TYPES.has(s) ? s : "NONE";
}

function normalizeDirection(x, engine16 = null) {
  const s = safeUpper(x, "");

  if (s === "LONG" || s === "SHORT") return s;

  if (engine16?.exhaustionShort === true) return "SHORT";
  if (engine16?.exhaustionLong === true) return "LONG";
  if (engine16?.breakdownReady === true) return "SHORT";
  if (engine16?.breakoutReady === true) return "LONG";
  if (engine16?.wickRejectionShort === true) return "SHORT";
  if (engine16?.wickRejectionLong === true) return "LONG";

  return "NONE";
}

function normalizePermission(permissionObj = null) {
  const permission = safeUpper(
    permissionObj?.permission ??
      permissionObj?.state ??
      permissionObj?.verdict,
    "UNKNOWN"
  );

  const sizeMultiplierRaw =
    permissionObj?.sizeMultiplier ??
    permissionObj?.multiplier ??
    permissionObj?.riskMultiplier;

  const sizeMultiplier = Number(sizeMultiplierRaw);

  return {
    permission: ["ALLOW", "REDUCE", "STAND_DOWN"].includes(permission)
      ? permission
      : "UNKNOWN",
    sizeMultiplier: Number.isFinite(sizeMultiplier) ? sizeMultiplier : null,
    reasonCodes: Array.isArray(permissionObj?.reasonCodes)
      ? permissionObj.reasonCodes
      : [],
  };
}

function normalizeMomentum(momentum = null) {
  return {
    alignment: safeUpper(momentum?.alignment, "MIXED"),
    momentumState: safeUpper(momentum?.momentumState, "UNKNOWN"),
    smi10m: {
      direction: safeUpper(momentum?.smi10m?.direction, "UNKNOWN"),
      cross: safeUpper(momentum?.smi10m?.cross, "NONE"),
      k: Number.isFinite(Number(momentum?.smi10m?.k))
        ? Number(momentum.smi10m.k)
        : null,
      d: Number.isFinite(Number(momentum?.smi10m?.d))
        ? Number(momentum.smi10m.d)
        : null,
    },
    smi1h: {
      direction: safeUpper(momentum?.smi1h?.direction, "UNKNOWN"),
      cross: safeUpper(momentum?.smi1h?.cross, "NONE"),
      k: Number.isFinite(Number(momentum?.smi1h?.k))
        ? Number(momentum.smi1h.k)
        : null,
      d: Number.isFinite(Number(momentum?.smi1h?.d))
        ? Number(momentum.smi1h.d)
        : null,
    },
    compressionSignal: {
      state: safeUpper(momentum?.compressionSignal?.state, "NONE"),
      quality: safeUpper(momentum?.compressionSignal?.quality, "NONE"),
      early: momentum?.compressionSignal?.early === true,
      tightness: Number.isFinite(Number(momentum?.compressionSignal?.tightness))
        ? Number(momentum.compressionSignal.tightness)
        : null,
    },
    decisionHint: {
      biasAssist: safeUpper(momentum?.decisionHint?.biasAssist, "NONE"),
      releaseAssist: safeUpper(momentum?.decisionHint?.releaseAssist, "NONE"),
      summary: momentum?.decisionHint?.summary || null,
    },
  };
}

function normalizeE3(engine3 = null) {
  return {
    stage: safeUpper(engine3?.stage, "IDLE"),
    armed: engine3?.armed === true,
    reactionScore: Number.isFinite(Number(engine3?.reactionScore))
      ? Number(engine3.reactionScore)
      : 0,
    structureState: safeUpper(engine3?.structureState, "HOLD"),
    confirmed: engine3?.confirmed === true,
    reasonCodes: Array.isArray(engine3?.reasonCodes) ? engine3.reasonCodes : [],
  };
}

function normalizeE4(engine4 = null) {
  return {
    volumeScore: Number.isFinite(Number(engine4?.volumeScore))
      ? Number(engine4.volumeScore)
      : 0,
    volumeConfirmed: engine4?.volumeConfirmed === true,
    pressureBias: safeUpper(engine4?.pressureBias, "NEUTRAL"),
    volumeRegime: safeUpper(engine4?.volumeRegime, "UNKNOWN"),
    state: safeUpper(engine4?.state, "NO_SIGNAL"),
    flags: engine4?.flags || {},
  };
}

function normalizeZoneContext(ctx = null) {
  return {
    zoneType: safeUpper(ctx?.zoneType, "UNKNOWN"),
    withinZone:
      ctx?.withinZone === true ||
      ctx?.insideZone === true ||
      ctx?.insideAllowedZone === true,
    validLocation:
      ctx?.validLocation === true
        ? true
        : ctx?.validLocation === false
        ? false
        : null,
    allowed:
      ctx?.allowed === true
        ? true
        : ctx?.allowed === false
        ? false
        : null,
    wrongZone: ctx?.wrongZone === true,
    requiresAllowedZone: ctx?.requiresAllowedZone === true,
    active: ctx?.active || null,
    nearest: ctx?.nearest || null,
    flags: ctx?.flags || null,
  };
}

function normalizeEngine16(engine16 = null) {
  const strategyType = normalizeStrategyType(engine16?.strategyType);
  const readinessLabel = safeUpper(engine16?.readinessLabel, "NO_SETUP");
  const direction = normalizeDirection(engine16?.direction, engine16);

  return {
    ok: engine16?.ok !== false,
    strategyType,
    readinessLabel,
    direction,
    exhaustionDetected: engine16?.exhaustionDetected === true,
    exhaustionActive: engine16?.exhaustionActive === true,
    exhaustionShort: engine16?.exhaustionShort === true,
    exhaustionLong: engine16?.exhaustionLong === true,
    hasPulledBack: engine16?.hasPulledBack === true,
    breakoutReady: engine16?.breakoutReady === true,
    breakdownReady: engine16?.breakdownReady === true,
    invalidated: engine16?.invalidated === true,
    insidePrimaryZone: engine16?.insidePrimaryZone === true,
    insideSecondaryZone: engine16?.insideSecondaryZone === true,
    wickRejectionLong: engine16?.wickRejectionLong === true,
    wickRejectionShort: engine16?.wickRejectionShort === true,
    context: safeUpper(engine16?.context, "NONE"),
    error: engine16?.error || null,
    reasonCodes: Array.isArray(engine16?.reasonCodes) ? engine16.reasonCodes : [],
  };
}

function normalizeEngine5(engine5 = null) {
  const total =
    Number(engine5?.scores?.total) ||
    Number(engine5?.total) ||
    Number(engine5?.score) ||
    0;

  return {
    total,
    grade: engine5?.scores?.label || engine5?.label || scoreToGrade(total),
    invalid: engine5?.invalid === true,
    perEngine: {
      engine1: Number(engine5?.scores?.engine1) || 0,
      engine2: Number(engine5?.scores?.engine2) || 0,
      engine3: Number(engine5?.scores?.engine3) || 0,
      engine4: Number(engine5?.scores?.engine4) || 0,
      compression: Number(engine5?.scores?.compression) || 0,
    },
    reasonCodes: Array.isArray(engine5?.reasonCodes) ? engine5.reasonCodes : [],
  };
}

/* -----------------------------
   Candidate resolution
------------------------------*/
export function resolveStrategyCandidates({ engine16 } = {}) {
  const e16 = normalizeEngine16(engine16);

  if (!e16.ok || e16.strategyType === "NONE" || e16.readinessLabel === "NO_SETUP") {
    return [];
  }

  return [
    {
      strategyType: e16.strategyType,
      direction: e16.direction,
      source: "ENGINE16",
      engine16: e16,
    },
  ];
}

export function pickWinningStrategy({ candidates = [], engine5, momentum } = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      strategyType: "NONE",
      direction: "NONE",
      priority: 0,
      source: "NONE",
      candidate: null,
    };
  }

  const e5 = normalizeEngine5(engine5);
  const mom = normalizeMomentum(momentum);

  let best = null;

  for (const c of candidates) {
    const type = normalizeStrategyType(c?.strategyType);
    const dir = normalizeDirection(c?.direction, c?.engine16);
    const base = BASE_PRIORITY[type] || 0;

    let priority = base;

    priority += clamp(Math.round((e5.total || 0) / 5), 0, 20);

    if (dir === "LONG" && mom.alignment === "BULLISH") priority += 8;
    if (dir === "SHORT" && mom.alignment === "BEARISH") priority += 8;
    if (dir === "LONG" && mom.alignment === "BEARISH") priority -= 10;
    if (dir === "SHORT" && mom.alignment === "BULLISH") priority -= 10;

    if (type === "EXHAUSTION" && c?.engine16?.exhaustionActive) priority += 5;

    const candidateScore = {
      strategyType: type,
      direction: dir,
      priority,
      source: c?.source || "ENGINE16",
      candidate: c,
    };

    if (!best || candidateScore.priority > best.priority) {
      best = candidateScore;
    }
  }

  return best || {
    strategyType: "NONE",
    direction: "NONE",
    priority: 0,
    source: "NONE",
    candidate: null,
  };
}

/* -----------------------------
   Gates / blockers
------------------------------*/
export function evaluateHardBlockers({
  winner,
  permission,
  zoneContext,
  engine16,
} = {}) {
  const blockers = [];
  const conflicts = [];

  const p = normalizePermission(permission);
  const z = normalizeZoneContext(zoneContext);
  const e16 = normalizeEngine16(engine16);

  if (!winner || winner.strategyType === "NONE") {
    blockers.push("NO_VALID_STRATEGY");
  }

  if (winner?.direction === "NONE") {
    blockers.push("NO_DIRECTION");
  }

  if (p.permission === "STAND_DOWN") {
    blockers.push("E6_STAND_DOWN");
  }

  if (e16.invalidated === true) {
    blockers.push("E16_INVALIDATED");
  }

  if (z.validLocation === false) {
    blockers.push("INVALID_LOCATION");
  }

  if (z.allowed === false) {
    blockers.push("ZONE_NOT_ALLOWED");
  }

  if (z.wrongZone === true) {
    blockers.push("WRONG_ZONE");
  }

  if (z.requiresAllowedZone === true && z.withinZone !== true) {
    blockers.push("OUTSIDE_REQUIRED_ZONE");
  }

  if (z.withinZone !== true && winner?.strategyType === "BREAKOUT") {
    conflicts.push("BREAKOUT_NOT_IN_ZONE");
  }

  if (z.withinZone !== true && winner?.strategyType === "BREAKDOWN") {
    conflicts.push("BREAKDOWN_NOT_IN_ZONE");
  }

  if (
    winner?.strategyType === "EXHAUSTION" &&
    e16.exhaustionDetected === true &&
    e16.exhaustionActive === false
  ) {
    blockers.push("EXHAUSTION_INACTIVE");
  }

  return {
    blockers,
    conflicts,
    hardBlocked: blockers.length > 0,
  };
}

export function evaluateQualityGate({ winner, engine5 } = {}) {
  const e5 = normalizeEngine5(engine5);

  let qualityGatePassed = false;
  let qualityBand = "WEAK";
  const reasonCodes = [];
  const blockers = [];

  if (e5.invalid) {
    blockers.push("E5_INVALID");
    return {
      qualityGatePassed: false,
      qualityBand: "INVALID",
      qualityScore: e5.total,
      qualityGrade: e5.grade,
      qualityBreakdown: e5.perEngine,
      reasonCodes,
      blockers,
    };
  }

  if (e5.total >= 80) {
    qualityGatePassed = true;
    qualityBand = "STRONG";
    reasonCodes.push("E5_SCORE_STRONG");
  } else if (e5.total >= 70) {
    qualityGatePassed = true;
    qualityBand = "TRADABLE";
    reasonCodes.push("E5_SCORE_GOOD");
  } else if (e5.total >= 60) {
    qualityGatePassed = false;
    qualityBand = "WATCH";
    reasonCodes.push("E5_SCORE_WATCH_ONLY");
    blockers.push("QUALITY_BELOW_TRADE_THRESHOLD");
  } else {
    qualityGatePassed = false;
    qualityBand = "WEAK";
    reasonCodes.push("E5_SCORE_WEAK");
    blockers.push("QUALITY_TOO_LOW");
  }

  return {
    qualityGatePassed,
    qualityBand,
    qualityScore: e5.total,
    qualityGrade: e5.grade,
    qualityBreakdown: e5.perEngine,
    reasonCodes,
    blockers,
  };
}

export function evaluateMomentumGate({
  strategyId,
  winner,
  momentum,
} = {}) {
  const mom = normalizeMomentum(momentum);
  const sid = safeUpper(strategyId, "");
  const dir = winner?.direction || "NONE";
  const type = winner?.strategyType || "NONE";

  let momentumGatePassed = false;
  const reasonCodes = [];
  const blockers = [];
  const conflicts = [];
  let bias = "NONE";

  const scalpMode = sid.includes("INTRADAY_SCALP");
  const swingMode = sid.includes("MINOR_SWING");
  const longMode = sid.includes("INTERMEDIATE_LONG");

  const smi10 = mom.smi10m.direction;
  const smi1h = mom.smi1h.direction;

  const isFastCountertrendType =
    type === "EXHAUSTION" || type === "REVERSAL";

  if (dir === "LONG") {
    if (mom.alignment === "BULLISH") {
      momentumGatePassed = true;
      bias = "LONG_PRIORITY";
      reasonCodes.push("E45_BULLISH_ALIGNED");
    } else if (isFastCountertrendType) {
      momentumGatePassed = true;
      bias = "LONG_COUNTERTREND";
      reasonCodes.push("COUNTERTREND_EXPECTED");
      reasonCodes.push("E45_COUNTERTREND_LONG_OK");

      if (smi10 === "UP") {
        reasonCodes.push("E45_10M_SUPPORTS_LONG");
      } else {
        conflicts.push("EARLY_LONG_WITHOUT_10M_CONFIRM");
      }

      if (smi1h !== "UP") {
        conflicts.push("HIGHER_TF_NOT_CONFIRMED");
      }
    } else {
      blockers.push("MOMENTUM_MISMATCH_LONG");
    }
  }

  if (dir === "SHORT") {
    if (mom.alignment === "BEARISH") {
      momentumGatePassed = true;
      bias = "SHORT_PRIORITY";
      reasonCodes.push("E45_BEARISH_ALIGNED");
    } else if (isFastCountertrendType) {
      momentumGatePassed = true;
      bias = "SHORT_COUNTERTREND";
      reasonCodes.push("COUNTERTREND_EXPECTED");
      reasonCodes.push("E45_COUNTERTREND_SHORT_OK");

      if (smi10 === "DOWN") {
        reasonCodes.push("E45_10M_SUPPORTS_SHORT");
      } else {
        conflicts.push("EARLY_SHORT_WITHOUT_10M_CONFIRM");
      }

      if (smi1h !== "DOWN") {
        conflicts.push("HIGHER_TF_NOT_CONFIRMED");
      }
    } else {
      blockers.push("MOMENTUM_MISMATCH_SHORT");
    }
  }

  if (dir === "NONE") {
    blockers.push("MOMENTUM_DIRECTION_NONE");
  }

  if (scalpMode) reasonCodes.push("MODE_SCALP");
  if (swingMode) reasonCodes.push("MODE_SWING");
  if (longMode) reasonCodes.push("MODE_INTERMEDIATE");

  return {
    momentumGatePassed,
    executionBias: VALID_BIAS.has(bias) ? bias : "NONE",
    reasonCodes,
    blockers,
    conflicts,
    alignment: mom.alignment,
    momentumState: mom.momentumState,
    smi10Direction: smi10,
    smi1hDirection: smi1h,
  };
}

export function evaluateTriggerReadiness({
  winner,
  engine3,
  engine4,
  qualityGate,
  momentumGate,
  hardBlockers,
} = {}) {
  const e3 = normalizeE3(engine3);
  const e4 = normalizeE4(engine4);

  const reasonCodes = [];
  const blockers = [];

  if (hardBlockers?.hardBlocked) {
    return {
      readinessLabel: "STAND_DOWN",
      entryStyle: "NONE",
      triggerConfirmed: false,
      reasonCodes: ["HARD_BLOCKED"],
      blockers: [...(hardBlockers?.blockers || [])],
    };
  }

  if (!winner || winner.strategyType === "NONE") {
    return {
      readinessLabel: "WAIT",
      entryStyle: "NONE",
      triggerConfirmed: false,
      reasonCodes: ["NO_STRATEGY"],
      blockers: ["NO_STRATEGY"],
    };
  }

  let readinessLabel = "WAIT";
  let entryStyle = "NONE";
  let triggerConfirmed = false;

  const qualityPass = qualityGate?.qualityGatePassed === true;
  const momentumPass = momentumGate?.momentumGatePassed === true;

  const isFastCountertrendType =
    winner.strategyType === "EXHAUSTION" || winner.strategyType === "REVERSAL";

  const weakButTrackableQuality =
    Number(qualityGate?.qualityScore ?? 0) >= 60;

  if (!qualityPass) {
    readinessLabel = "NEAR";
    if (weakButTrackableQuality) {
      reasonCodes.push("QUALITY_TRACKABLE_NOT_TRADEABLE");
    }
    blockers.push(...(qualityGate?.blockers || []));
    reasonCodes.push(...(qualityGate?.reasonCodes || []));
  } else {
    readinessLabel = "NEAR";
    reasonCodes.push(...(qualityGate?.reasonCodes || []));
  }

  if (!momentumPass) {
    blockers.push(...(momentumGate?.blockers || []));
    reasonCodes.push(...(momentumGate?.reasonCodes || []));
  } else {
    reasonCodes.push(...(momentumGate?.reasonCodes || []));
  }

  if (isFastCountertrendType && momentumPass) {
    if (readinessLabel === "WAIT" || readinessLabel === "NEAR") {
      readinessLabel = "ARMING";
      entryStyle = "EARLY_COUNTERTREND";
      reasonCodes.push("FAST_LANE_COUNTERTREND_SETUP");
    }
  }

  if (qualityPass) {
    if (e3.stage === "ARMED" || e3.armed === true) {
      readinessLabel = "ARMING";
      if (entryStyle === "NONE") entryStyle = "CONFIRMATION";
      reasonCodes.push("E3_ARMED");
    }

    if (
      (e3.stage === "TRIGGERED" || e3.stage === "CONFIRMED") &&
      (e4.volumeConfirmed === true || e4.volumeScore >= 7)
    ) {
      readinessLabel = "READY";
      entryStyle = "CONFIRMATION";
      reasonCodes.push("E3_TRIGGER_MATURE");
      reasonCodes.push("E4_VOLUME_SUPPORT");
    }

    if (
      (e3.stage === "CONFIRMED" || e3.confirmed === true) &&
      (e4.volumeConfirmed === true || e4.volumeScore >= 9)
    ) {
      readinessLabel = "CONFIRMED";
      entryStyle = "CONFIRMATION";
      triggerConfirmed = true;
      reasonCodes.push("E3_CONFIRMED");
      reasonCodes.push("E4_CONFIRMED");
    }
  }

  if (isFastCountertrendType) {
    if (e4.flags?.reversalExpansion) {
      reasonCodes.push("REVERSAL_VOLUME_PRESENT");
      if (readinessLabel === "NEAR") {
        readinessLabel = "ARMING";
        if (entryStyle === "NONE") entryStyle = "EARLY_COUNTERTREND";
      }
    }

    if (winner.direction === "SHORT" && e4.flags?.distributionDetected) {
      reasonCodes.push("DISTRIBUTION_SUPPORTS_SHORT");
    }

    if (winner.direction === "LONG" && e4.flags?.absorptionDetected) {
      reasonCodes.push("ABSORPTION_SUPPORTS_LONG");
    }

    if (
      readinessLabel === "NEAR" &&
      momentumPass &&
      (qualityPass || weakButTrackableQuality)
    ) {
      readinessLabel = "ARMING";
      if (entryStyle === "NONE") entryStyle = "EARLY_COUNTERTREND";
      reasonCodes.push("FAST_MARKET_EARLY_ARM");
    }
  }

  if (winner.strategyType === "BREAKOUT" || winner.strategyType === "BREAKDOWN") {
    if (e4.flags?.initiativeMoveConfirmed) {
      reasonCodes.push("INITIATIVE_VOLUME_PRESENT");
      if (readinessLabel === "ARMING") readinessLabel = "READY";
    } else if (qualityPass) {
      blockers.push("VOLUME_NOT_CONFIRMED");
    }
  }

  if (!VALID_READINESS.has(readinessLabel)) readinessLabel = "WAIT";

  return {
    readinessLabel,
    entryStyle,
    triggerConfirmed,
    reasonCodes,
    blockers,
  };
}

export function buildExecutionBias({
  winner,
  momentumGate,
  hardBlockers,
} = {}) {
  const bias = safeUpper(momentumGate?.executionBias, "NONE");

  if (VALID_BIAS.has(bias) && bias !== "NONE") {
    return bias;
  }

  if (hardBlockers?.hardBlocked) {
    if (winner?.direction === "LONG") return "LONG_COUNTERTREND";
    if (winner?.direction === "SHORT") return "SHORT_COUNTERTREND";
    return "NONE";
  }

  return "NONE";
}

export function buildFinalDecision({
  symbol = "SPY",
  strategyId = null,
  winner,
  engine16,
  engine5,
  momentum,
  permission,
  engine3,
  engine4,
  zoneContext,
} = {}) {
  const p = normalizePermission(permission);

  const hard = evaluateHardBlockers({
    winner,
    permission,
    zoneContext,
    engine16,
  });

  const quality = evaluateQualityGate({
    winner,
    engine5,
  });

  const mom = evaluateMomentumGate({
    strategyId,
    winner,
    momentum,
  });

  const trigger = evaluateTriggerReadiness({
    winner,
    engine3,
    engine4,
    qualityGate: quality,
    momentumGate: mom,
    hardBlockers: hard,
  });

  const executionBias = buildExecutionBias({
    winner,
    momentumGate: mom,
    hardBlockers: hard,
  });

  let action = "NO_ACTION";

  if (trigger.readinessLabel === "STAND_DOWN") {
    action = "BLOCKED";
  } else if (trigger.readinessLabel === "WAIT") {
    action = "NO_ACTION";
  } else if (trigger.readinessLabel === "NEAR" || trigger.readinessLabel === "ARMING") {
    action = "WATCH";
  } else if (trigger.readinessLabel === "READY") {
    action =
      p.permission === "REDUCE"
        ? "REDUCE_OK"
        : p.permission === "ALLOW"
        ? "WAIT"
        : "BLOCKED";
  } else if (trigger.readinessLabel === "CONFIRMED") {
    action =
      p.permission === "ALLOW"
        ? "ENTER_OK"
        : p.permission === "REDUCE"
        ? "REDUCE_OK"
        : "BLOCKED";
  }

  if (!VALID_ACTIONS.has(action)) action = "NO_ACTION";

  const reasonCodes = [
    ...(trigger.reasonCodes || []),
    ...(quality.reasonCodes || []),
    ...(mom.reasonCodes || []),
  ];

  const blockers = [
    ...(hard.blockers || []),
    ...(quality.blockers || []),
    ...(mom.blockers || []),
    ...(trigger.blockers || []),
  ];

  const out = {
    ok: true,
    engine: "engine15.decisionReferee.v1",
    symbol,
    strategyId,
    strategyType: winner?.strategyType || "NONE",
    direction: winner?.direction || "NONE",
    readinessLabel: trigger.readinessLabel,
    executionBias,
    action,
    priority: Number.isFinite(Number(winner?.priority)) ? Number(winner.priority) : 0,
    entryStyle: trigger.entryStyle || "NONE",
    reasonCodes: [...new Set(reasonCodes)],
    blockers: [...new Set(blockers)],
    conflicts: [...new Set([...(hard.conflicts || []), ...(mom.conflicts || [])])],
    qualityGatePassed: quality.qualityGatePassed === true,
    momentumGatePassed: mom.momentumGatePassed === true,
    permissionGatePassed: p.permission === "ALLOW" || p.permission === "REDUCE",
    qualityScore: quality.qualityScore,
    qualityGrade: quality.qualityGrade,
    qualityBand: quality.qualityBand,
    qualityBreakdown: quality.qualityBreakdown || {
      engine1: 0,
      engine2: 0,
      engine3: 0,
      engine4: 0,
      compression: 0,
    },
    permission: p.permission,
    sizeMultiplier: p.sizeMultiplier,
    debug: {
      hardBlockers: hard,
      quality,
      momentum: mom,
      trigger,
    },
  };

  return out;
}

/* -----------------------------
   Main entry
------------------------------*/
export function computeEngine15DecisionReferee({
  symbol = "SPY",
  strategyId = null,
  engine16 = null,
  engine5 = null,
  momentum = null,
  permission = null,
  engine3 = null,
  engine4 = null,
  zoneContext = null,
} = {}) {
  try {
    const candidates = resolveStrategyCandidates({ engine16 });

    const winner = pickWinningStrategy({
      candidates,
      engine5,
      momentum,
    });

    return buildFinalDecision({
      symbol,
      strategyId,
      winner,
      engine16,
      engine5,
      momentum,
      permission,
      engine3,
      engine4,
      zoneContext,
    });
  } catch (err) {
    return {
      ok: false,
      engine: "engine15.decisionReferee.v1",
      symbol,
      strategyId,
      strategyType: "NONE",
      direction: "NONE",
      readinessLabel: "WAIT",
      executionBias: "NONE",
      action: "NO_ACTION",
      priority: 0,
      entryStyle: "NONE",
      reasonCodes: ["ENGINE15_REFEREE_ERROR"],
      blockers: [String(err?.message || err)],
      conflicts: [],
      qualityGatePassed: false,
      momentumGatePassed: false,
      permissionGatePassed: false,
      qualityScore: 0,
      qualityGrade: "IGNORE",
      qualityBand: "INVALID",
      qualityBreakdown: {
        engine1: 0,
        engine2: 0,
        engine3: 0,
        engine4: 0,
        compression: 0,
      },
      permission: "UNKNOWN",
      sizeMultiplier: null,
      debug: {},
    };
  }
}

export default computeEngine15DecisionReferee;
