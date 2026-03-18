// services/core/logic/engine15DecisionReferee.js
//
// Engine 15B — Decision Referee + Lifecycle v3
//
// Mission:
// - Engine 16 = pattern candidate
// - Engine 5 = quality validator
// - Engine 4.5 = directional assist
// - Engine 6 = risk gate
// - Engine 15B = final referee + setup lifecycle manager
//
// Engine 15B decides:
// - what strategy wins
// - what direction is favored
// - how ready it is
// - whether action is allowed now
// - whether the setup is fresh / mature / completed
// - what the next focus should be
//
// Safe lifecycle implementation:
// - trusts one primary Engine 16 candidate
// - uses full zone-path progression for lifecycle
// - uses ATR only as backup helper
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

const VALID_LIFECYCLE = new Set([
  "BUILDING",
  "LIVE",
  "PARTIALLY_COMPLETED",
  "MATURE",
  "COMPLETED",
  "EXPIRED",
  "MISSED",
  "INVALIDATED",
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

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
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

function normalizeRenderZone(z, fallbackType = "ZONE") {
  const lo = toNum(z?.lo);
  const hi = toNum(z?.hi);
  if (lo == null || hi == null) return null;

  return {
    id: z?.id || `${fallbackType}|${Math.min(lo, hi)}|${Math.max(lo, hi)}`,
    type: safeUpper(z?.type || z?.zoneType || fallbackType, fallbackType),
    lo: Math.min(lo, hi),
    hi: Math.max(lo, hi),
    mid: toNum(z?.mid) ?? ((Math.min(lo, hi) + Math.max(lo, hi)) / 2),
    strength: toNum(z?.strength),
  };
}

function normalizeZoneContext(ctx = null) {
  const renderNegotiatedRaw = Array.isArray(ctx?.render?.negotiated) ? ctx.render.negotiated : [];
  const renderInstitutionalRaw = Array.isArray(ctx?.render?.institutional) ? ctx.render.institutional : [];
  const renderShelvesRaw = Array.isArray(ctx?.render?.shelves) ? ctx.render.shelves : [];

  const renderNegotiated = renderNegotiatedRaw
    .map((z) => normalizeRenderZone(z, "NEGOTIATED"))
    .filter(Boolean);

  const renderInstitutional = renderInstitutionalRaw
    .map((z) => normalizeRenderZone(z, "INSTITUTIONAL"))
    .filter(Boolean);

  const renderShelves = renderShelvesRaw
    .map((z) => normalizeRenderZone(z, "SHELF"))
    .filter(Boolean);

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
    meta: ctx?.meta || null,
    flags: ctx?.flags || null,
    render: {
      negotiated: renderNegotiated,
      institutional: renderInstitutional,
      shelves: renderShelves,
    },
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
    state: safeUpper(engine16?.state, "NONE"),
    currentPrice:
      toNum(engine16?.currentPrice) ??
      toNum(engine16?.lastPrice) ??
      toNum(engine16?.price) ??
      toNum(engine16?.meta?.currentPrice) ??
      null,
    exhaustionBarPrice: toNum(engine16?.exhaustionBarPrice),
    exhaustionBarTime: engine16?.exhaustionBarTime || engine16?.signalTimes?.exhaustionTime || null,
    atr: toNum(engine16?.meta?.atr) ?? toNum(engine16?.meta?.atrValue) ?? toNum(engine16?.meta?.atr14) ?? null,
    currentDayHigh: toNum(engine16?.dayRange?.currentDayHigh),
    currentDayLow: toNum(engine16?.dayRange?.currentDayLow),
    sessionHigh: toNum(engine16?.sessionStructure?.regularSessionHigh) ?? toNum(engine16?.anchors?.sessionHigh),
    sessionLow: toNum(engine16?.sessionStructure?.regularSessionLow) ?? toNum(engine16?.anchors?.sessionLow),
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
    price: toNum(engine5?.price),
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

/* -----------------------------
   Lifecycle helpers
------------------------------*/
function extractCurrentPrice({ engine5, zoneContext, engine16 }) {
  return (
    toNum(engine5?.price) ??
    toNum(zoneContext?.meta?.current_price) ??
    toNum(zoneContext?.meta?.currentPrice) ??
    toNum(engine16?.currentPrice) ??
    null
  );
}

function parseHmmToMinutes(s) {
  if (!s || typeof s !== "string") return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function getBarsSinceSignal({ strategyId, signalTime }) {
  const mins = parseHmmToMinutes(signalTime);
  if (mins == null) return null;

  let barSize = 10;
  if (String(strategyId).includes("@1h")) barSize = 60;
  if (String(strategyId).includes("@4h")) barSize = 240;

  const now = new Date();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const delta = currentMinutes - mins;

  if (!Number.isFinite(delta) || delta < 0) return null;
  return Math.max(0, Math.floor(delta / barSize));
}

function zoneMid(z) {
  const lo = toNum(z?.lo);
  const hi = toNum(z?.hi);
  if (lo == null || hi == null) return null;
  return (lo + hi) / 2;
}

function containsPrice(z, price) {
  const p = toNum(price);
  const lo = toNum(z?.lo);
  const hi = toNum(z?.hi);
  if (p == null || lo == null || hi == null) return false;
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  return p >= a && p <= b;
}

function dedupeZones(list = []) {
  const out = [];
  const seen = new Set();

  for (const z of Array.isArray(list) ? list : []) {
    const normalized = normalizeRenderZone(z, z?.zoneType || z?.type || "ZONE");
    if (!normalized) continue;

    const key = normalized.id || `${normalized.type}|${normalized.lo}|${normalized.hi}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push(normalized);
  }

  return out;
}

function buildOrderedZonePath({
  direction,
  signalPrice,
  zoneContext,
}) {
  const activeZones = [];
  const nearestZones = [];

  if (zoneContext?.active?.negotiated) {
    activeZones.push({
      ...zoneContext.active.negotiated,
      zoneType: "NEGOTIATED",
    });
  }

  if (zoneContext?.active?.shelf) {
    activeZones.push({
      ...zoneContext.active.shelf,
      zoneType: "SHELF",
    });
  }

  if (zoneContext?.active?.institutional) {
    activeZones.push({
      ...zoneContext.active.institutional,
      zoneType: "INSTITUTIONAL",
    });
  }

  if (zoneContext?.nearest?.shelf) {
    nearestZones.push({
      ...zoneContext.nearest.shelf,
      zoneType: "SHELF",
    });
  }

  if (zoneContext?.nearest?.negotiated) {
    nearestZones.push({
      ...zoneContext.nearest.negotiated,
      zoneType: "NEGOTIATED",
    });
  }

  if (zoneContext?.nearest?.institutional) {
    nearestZones.push({
      ...zoneContext.nearest.institutional,
      zoneType: "INSTITUTIONAL",
    });
  }

  const renderNegotiated = Array.isArray(zoneContext?.render?.negotiated)
    ? zoneContext.render.negotiated
    : [];

  const renderInstitutional = Array.isArray(zoneContext?.render?.institutional)
    ? zoneContext.render.institutional
    : [];

  const renderShelves = Array.isArray(zoneContext?.render?.shelves)
    ? zoneContext.render.shelves
    : [];

  const all = dedupeZones([
    ...activeZones,
    ...nearestZones,
    ...renderNegotiated,
    ...renderInstitutional,
    ...renderShelves,
  ]);

  const s = toNum(signalPrice);
  if (s == null) return [];

  let filtered = [];

  if (direction === "SHORT") {
    filtered = all.filter((z) => {
      const lo = toNum(z.lo);
      const hi = toNum(z.hi);
      const mid = toNum(z.mid) ?? zoneMid(z);
      if (lo == null || hi == null || mid == null) return false;

      // keep zones below signal or overlapping just beneath it
      return mid < s || lo < s || hi < s;
    });

    filtered.sort((a, b) => {
      const ma = toNum(a.mid) ?? zoneMid(a);
      const mb = toNum(b.mid) ?? zoneMid(b);
      const da = ma == null ? 999999 : Math.abs(s - ma);
      const db = mb == null ? 999999 : Math.abs(s - mb);
      return da - db;
    });
  } else if (direction === "LONG") {
    filtered = all.filter((z) => {
      const lo = toNum(z.lo);
      const hi = toNum(z.hi);
      const mid = toNum(z.mid) ?? zoneMid(z);
      if (lo == null || hi == null || mid == null) return false;

      return mid > s || lo > s || hi > s;
    });

    filtered.sort((a, b) => {
      const ma = toNum(a.mid) ?? zoneMid(a);
      const mb = toNum(b.mid) ?? zoneMid(b);
      const da = ma == null ? 999999 : Math.abs(ma - s);
      const db = mb == null ? 999999 : Math.abs(mb - s);
      return da - db;
    });
  }

  const finalPath = [];
  const used = new Set();

  for (const z of filtered) {
    const key = z.id || `${z.type}|${z.lo}|${z.hi}`;
    if (used.has(key)) continue;
    used.add(key);
    finalPath.push({
      id: z.id,
      type: z.type,
      lo: z.lo,
      hi: z.hi,
      mid: toNum(z.mid) ?? zoneMid(z),
      strength: z.strength ?? null,
      tpSlot: finalPath.length + 1,
    });
    if (finalPath.length >= 8) break;
  }

  return finalPath;
}

function countZonesHit({ direction, currentPrice, zonesInPath }) {
  const p = toNum(currentPrice);
  if (p == null) return { zonesHit: 0, hitIds: [] };

  let zonesHit = 0;
  const hitIds = [];

  for (const z of Array.isArray(zonesInPath) ? zonesInPath : []) {
    const lo = toNum(z.lo);
    const hi = toNum(z.hi);
    if (lo == null || hi == null) continue;

    let hit = false;

    if (direction === "SHORT") {
      hit = p <= hi || containsPrice(z, p);
    } else if (direction === "LONG") {
      hit = p >= lo || containsPrice(z, p);
    }

    if (hit) {
      zonesHit += 1;
      hitIds.push(z.id);
    }
  }

  return { zonesHit, hitIds };
}

function calcMoveFromSignal({ direction, signalPrice, currentPrice, atr }) {
  const s = toNum(signalPrice);
  const p = toNum(currentPrice);
  const a = toNum(atr);

  if (s == null || p == null) {
    return {
      moveFromSignalPts: null,
      moveFromSignalAtr: null,
    };
  }

  const pts = direction === "SHORT" ? s - p : direction === "LONG" ? p - s : null;
  const atrMove = pts != null && a != null && a > 0 ? pts / a : null;

  return {
    moveFromSignalPts: pts,
    moveFromSignalAtr: atrMove,
  };
}

function estimateTargetProgress01({
  zonesHit,
  zonesInPath,
  moveFromSignalAtr,
}) {
  const targetCount = Math.min(2, Array.isArray(zonesInPath) ? zonesInPath.length : 0);

  if (targetCount <= 0) {
    if (moveFromSignalAtr == null) return 0;
    return clamp(moveFromSignalAtr / 1.25, 0, 1);
  }

  if (zonesHit >= 2) return 1;
  if (zonesHit === 1) return 0.7;

  if (moveFromSignalAtr == null) return 0;
  return clamp(moveFromSignalAtr / 1.25, 0, 0.69);
}

function determineLifecycle({
  strategyId,
  winner,
  engine16,
  engine5,
  zoneContext,
  readinessLabel,
  action,
}) {
  const currentPrice = extractCurrentPrice({ engine5, zoneContext, engine16 });
  const signalPrice =
    winner?.strategyType === "EXHAUSTION"
      ? toNum(engine16?.exhaustionBarPrice)
      : toNum(engine16?.currentPrice);

  const atr =
    toNum(engine16?.atr) ??
    toNum(engine16?.meta?.atr) ??
    toNum(zoneContext?.meta?.atr) ??
    null;

  const signalTime =
    winner?.strategyType === "EXHAUSTION"
      ? engine16?.exhaustionBarTime
      : null;

  const barsSinceSignal = getBarsSinceSignal({
    strategyId,
    signalTime,
  });

  const { moveFromSignalPts, moveFromSignalAtr } = calcMoveFromSignal({
    direction: winner?.direction,
    signalPrice,
    currentPrice,
    atr,
  });

  const zonesInPath = buildOrderedZonePath({
    direction: winner?.direction,
    signalPrice,
    zoneContext,
  });

  const { zonesHit, hitIds } = countZonesHit({
    direction: winner?.direction,
    currentPrice,
    zonesInPath,
  });

  const targetProgress01 = estimateTargetProgress01({
    zonesHit,
    zonesInPath,
    moveFromSignalAtr,
  });

  const firstTargetHit = zonesHit >= 1;
  const secondTargetHit = zonesHit >= 2;

  let lifecycleStage = "BUILDING";
  let isFreshSetup = true;
  let entryWindowOpen = false;
  let setupCompleted = false;
  let runnerActive = false;
  let nextFocus = "STAY_WITH_CURRENT_SETUP";

  if (engine16?.invalidated === true) {
    lifecycleStage = "INVALIDATED";
    isFreshSetup = false;
    entryWindowOpen = false;
    nextFocus = "LOOK_FOR_NEW_SETUP";
  } else if (
    readinessLabel === "WAIT" &&
    action === "NO_ACTION" &&
    (barsSinceSignal != null && barsSinceSignal >= 6) &&
    !firstTargetHit
  ) {
    lifecycleStage = "EXPIRED";
    isFreshSetup = false;
    entryWindowOpen = false;
    nextFocus = "LOOK_FOR_NEW_SETUP";
  } else if (secondTargetHit) {
    lifecycleStage = "MATURE";
    isFreshSetup = false;
    entryWindowOpen = false;
    runnerActive = true;
    nextFocus = "MANAGE_RUNNER";
  } else if (firstTargetHit) {
    lifecycleStage = "PARTIALLY_COMPLETED";
    isFreshSetup = false;
    entryWindowOpen = false;
    runnerActive = true;
    nextFocus = "LOOK_FOR_CONTINUATION_TO_NEXT_ZONE";
  } else if (
    (action === "WATCH" || action === "WAIT" || action === "ENTER_OK" || action === "REDUCE_OK") &&
    (readinessLabel === "ARMING" || readinessLabel === "READY" || readinessLabel === "CONFIRMED")
  ) {
    lifecycleStage = "LIVE";
    isFreshSetup = (moveFromSignalAtr == null || moveFromSignalAtr < 0.7) && !firstTargetHit;
    entryWindowOpen = isFreshSetup;
    nextFocus = "STAY_WITH_CURRENT_SETUP";
  } else {
    lifecycleStage = "BUILDING";
    isFreshSetup = false;
    entryWindowOpen = false;
    nextFocus = "WAIT_FOR_TRIGGER";
  }

  if (targetProgress01 >= 1 || (moveFromSignalAtr != null && moveFromSignalAtr >= 1.25)) {
    if (action === "ENTER_OK" || action === "REDUCE_OK" || action === "WATCH") {
      if (secondTargetHit) {
        lifecycleStage = "MATURE";
        runnerActive = true;
        nextFocus = "MANAGE_RUNNER";
      } else if (firstTargetHit) {
        lifecycleStage = "PARTIALLY_COMPLETED";
        runnerActive = true;
        nextFocus = "LOOK_FOR_CONTINUATION_TO_NEXT_ZONE";
      } else {
        lifecycleStage = "MISSED";
        isFreshSetup = false;
        entryWindowOpen = false;
        nextFocus = "LOOK_FOR_NEW_SETUP";
      }
    }
  }

  if (
    !firstTargetHit &&
    !secondTargetHit &&
    moveFromSignalAtr != null &&
    moveFromSignalAtr >= 1.25 &&
    lifecycleStage === "LIVE"
  ) {
    lifecycleStage = "MISSED";
    isFreshSetup = false;
    entryWindowOpen = false;
    nextFocus = "LOOK_FOR_NEW_SETUP";
  }

  if (
    (lifecycleStage === "PARTIALLY_COMPLETED" || lifecycleStage === "MATURE") &&
    runnerActive !== true
  ) {
    runnerActive = true;
  }

  if (lifecycleStage === "COMPLETED") {
    setupCompleted = true;
    isFreshSetup = false;
    entryWindowOpen = false;
    nextFocus = "LOOK_FOR_NEW_SETUP";
  }

  const edgeRemainingPct =
    lifecycleStage === "BUILDING" ? 100 :
    lifecycleStage === "LIVE" ? 100 :
    lifecycleStage === "PARTIALLY_COMPLETED" ? 66 :
    lifecycleStage === "MATURE" ? 33 :
    lifecycleStage === "COMPLETED" ? 0 :
    lifecycleStage === "MISSED" ? 0 :
    lifecycleStage === "EXPIRED" ? 0 :
    lifecycleStage === "INVALIDATED" ? 0 :
    0;

  return {
    lifecycleStage: VALID_LIFECYCLE.has(lifecycleStage) ? lifecycleStage : "BUILDING",
    isFreshSetup,
    entryWindowOpen,
    signalPrice,
    currentPrice,
    barsSinceSignal,
    moveFromSignalPts,
    moveFromSignalAtr,
    zonesInPath: zonesInPath.map((z) => ({
      ...z,
      hit: hitIds.includes(z.id),
    })),
    zonesHit,
    targetCount: Math.min(2, zonesInPath.length),
    targetProgress01,
    firstTargetHit,
    secondTargetHit,
    runnerActive,
    setupCompleted,
    edgeRemainingPct,
    nextFocus,
  };
}

function buildExecutionBias({
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

  const lifecycle = determineLifecycle({
    strategyId,
    winner,
    engine16: normalizeEngine16(engine16),
    engine5: normalizeEngine5(engine5),
    zoneContext: normalizeZoneContext(zoneContext),
    readinessLabel: trigger.readinessLabel,
    action,
  });

  if (lifecycle.lifecycleStage === "MISSED" || lifecycle.lifecycleStage === "EXPIRED") {
    action = "NO_ACTION";
  }
  if (lifecycle.lifecycleStage === "COMPLETED" || lifecycle.setupCompleted) {
    action = "NO_ACTION";
  }

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

  return {
    ok: true,
    engine: "engine15.decisionReferee.v3",
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
    lifecycle,
    debug: {
      hardBlockers: hard,
      quality,
      momentum: mom,
      trigger,
    },
  };
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
      engine: "engine15.decisionReferee.v3",
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
      lifecycle: {
        lifecycleStage: "BUILDING",
        isFreshSetup: false,
        entryWindowOpen: false,
        signalPrice: null,
        currentPrice: null,
        barsSinceSignal: null,
        moveFromSignalPts: null,
        moveFromSignalAtr: null,
        zonesInPath: [],
        zonesHit: 0,
        targetCount: 0,
        targetProgress01: 0,
        firstTargetHit: false,
        secondTargetHit: false,
        runnerActive: false,
        setupCompleted: false,
        edgeRemainingPct: 100,
        nextFocus: "LOOK_FOR_NEW_SETUP",
      },
      debug: {},
    };
  }
}

export default computeEngine15DecisionReferee;
