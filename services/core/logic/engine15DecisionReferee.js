// services/core/logic/engine15DecisionReferee.js
//
// Engine 15C — Decision Referee
//
// Engine 16C rewrite v8.1
//
// PRIMARY FIX IN THIS VERSION:
// - preserve lower-timeframe signal direction
// - higher-timeframe bias is a filter only
// - HTF bias can downgrade / align / countertrend-tag the setup
// - HTF bias must NOT flip the actual 10m trigger direction
//
// OTHER GOALS:
// - preserve current stable contracts
// - improve lifecycle truth for trigger / mature / completed
// - add freshEntryNow
// - add scalp summary for 10m trigger vs higher-timeframe bias
//
// IMPORTANT:
// - pure logic only
// - no route fanout
// - no Engine 6 redesign
// - no builder redesign here

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
  REVERSAL: 92,
  BREAKDOWN: 86,
  BREAKOUT: 82,
  PULLBACK: 76,
  CONTINUATION: 74,
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

function toNum(x, fb = null) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
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
  const s = safeUpper(x, "NONE");
  if (["LONG", "SHORT", "NONE"].includes(s)) return s;

  if (engine16?.exhaustionTriggerShort === true) return "SHORT";
  if (engine16?.exhaustionTriggerLong === true) return "LONG";
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
      k: toNum(momentum?.smi10m?.k),
      d: toNum(momentum?.smi10m?.d),
    },
    smi1h: {
      direction: safeUpper(momentum?.smi1h?.direction, "UNKNOWN"),
      cross: safeUpper(momentum?.smi1h?.cross, "NONE"),
      k: toNum(momentum?.smi1h?.k),
      d: toNum(momentum?.smi1h?.d),
    },
    compressionSignal: {
      state: safeUpper(momentum?.compressionSignal?.state, "NONE"),
      quality: safeUpper(momentum?.compressionSignal?.quality, "NONE"),
      early: momentum?.compressionSignal?.early === true,
      tightness: toNum(momentum?.compressionSignal?.tightness),
      releaseBarsAgo:
        momentum?.compressionSignal?.releaseBarsAgo == null
          ? null
          : toNum(momentum?.compressionSignal?.releaseBarsAgo),
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
    reactionScore: toNum(engine3?.reactionScore, 0),
    structureState: safeUpper(engine3?.structureState, "HOLD"),
    confirmed: engine3?.confirmed === true,
    reasonCodes: Array.isArray(engine3?.reasonCodes) ? engine3.reasonCodes : [],
  };
}

function normalizeE4(engine4 = null) {
  return {
    volumeScore: toNum(engine4?.volumeScore, 0),
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
    nearAllowedZone: ctx?.nearAllowedZone === true,
    meta: ctx?.meta || null,
    active: ctx?.active || null,
    nearest: ctx?.nearest || null,
    render: {
      negotiated: Array.isArray(ctx?.render?.negotiated) ? ctx.render.negotiated : [],
      institutional: Array.isArray(ctx?.render?.institutional) ? ctx.render.institutional : [],
      shelves: Array.isArray(ctx?.render?.shelves) ? ctx.render.shelves : [],
    },
  };
}

function normalizeEngine16(engine16 = null) {
  const rawStrategyType = normalizeStrategyType(engine16?.strategyType);
  const rawReadinessLabel = safeUpper(engine16?.readinessLabel, "NO_SETUP");

  const exhaustionEarly = engine16?.exhaustionEarly === true;
  const exhaustionEarlyShort = engine16?.exhaustionEarlyShort === true;
  const exhaustionEarlyLong = engine16?.exhaustionEarlyLong === true;

  const exhaustionTrigger = engine16?.exhaustionTrigger === true;
  const exhaustionTriggerShort = engine16?.exhaustionTriggerShort === true;
  const exhaustionTriggerLong = engine16?.exhaustionTriggerLong === true;

  let strategyType = rawStrategyType;
  let readinessLabel = rawReadinessLabel;

  if (exhaustionEarly && !exhaustionTrigger) {
    if (strategyType === "EXHAUSTION") strategyType = "NONE";
    if (readinessLabel === "EXHAUSTION_READY") readinessLabel = "NO_SETUP";
  }

  const direction = normalizeDirection(engine16?.direction, {
    ...engine16,
    exhaustionTriggerShort,
    exhaustionTriggerLong,
  });

  return {
    ok: engine16?.ok !== false,
    strategyType,
    rawStrategyType,
    readinessLabel,
    rawReadinessLabel,
    direction,
    context: safeUpper(engine16?.context, "NONE"),
    state: safeUpper(engine16?.state, "NONE"),

    exhaustionDetected: engine16?.exhaustionDetected === true,
    exhaustionActive: engine16?.exhaustionActive === true,
    exhaustionShort: engine16?.exhaustionShort === true,
    exhaustionLong: engine16?.exhaustionLong === true,
    exhaustionBarTime: engine16?.exhaustionBarTime || null,
    exhaustionBarPrice: toNum(engine16?.exhaustionBarPrice),

    exhaustionEarly,
    exhaustionEarlyShort,
    exhaustionEarlyLong,

    exhaustionTrigger,
    exhaustionTriggerShort,
    exhaustionTriggerLong,

    hasPulledBack: engine16?.hasPulledBack === true,
    breakoutReady: engine16?.breakoutReady === true,
    breakdownReady: engine16?.breakdownReady === true,
    invalidated: engine16?.invalidated === true,
    insidePrimaryZone: engine16?.insidePrimaryZone === true,
    insideSecondaryZone: engine16?.insideSecondaryZone === true,
    wickRejectionLong: engine16?.wickRejectionLong === true,
    wickRejectionShort: engine16?.wickRejectionShort === true,
    failedBreakout: engine16?.failedBreakout === true,
    failedBreakdown: engine16?.failedBreakdown === true,
    reversalDetected: engine16?.reversalDetected === true,
    trendContinuation: engine16?.trendContinuation === true,
    impulseVolumeConfirmed: engine16?.impulseVolumeConfirmed === true,
    signalTimes: engine16?.signalTimes || {},
    error: engine16?.error || null,
    reasonCodes: Array.isArray(engine16?.reasonCodes) ? engine16.reasonCodes : [],
  };
}

function normalizeEngine5(engine5 = null) {
  const total =
    Number(engine5?.scores?.total) ||
    Number(engine5?.total) ||
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

function isScalpStrategy(strategyId) {
  return String(strategyId || "").toLowerCase().includes("intraday_scalp");
}

function isSwingStrategy(strategyId) {
  return String(strategyId || "").toLowerCase().includes("minor_swing");
}

function isIntermediateStrategy(strategyId) {
  return String(strategyId || "").toLowerCase().includes("intermediate_long");
}

/* -----------------------------
   Direction ownership
------------------------------*/

function deriveSignalDirectionFromEngine16(engine16 = null) {
  const e16 = normalizeEngine16(engine16);

  if (e16.exhaustionTriggerShort) return "SHORT";
  if (e16.exhaustionTriggerLong) return "LONG";

  if (e16.strategyType === "EXHAUSTION") {
    if (e16.exhaustionShort) return "SHORT";
    if (e16.exhaustionLong) return "LONG";
    if (e16.wickRejectionShort) return "SHORT";
    if (e16.wickRejectionLong) return "LONG";
  }

  if (e16.strategyType === "BREAKDOWN" || e16.breakdownReady) return "SHORT";
  if (e16.strategyType === "BREAKOUT" || e16.breakoutReady) return "LONG";

  if (e16.strategyType === "REVERSAL") {
    if (e16.failedBreakout || e16.wickRejectionShort) return "SHORT";
    if (e16.failedBreakdown || e16.wickRejectionLong) return "LONG";
  }

  return e16.direction || "NONE";
}

/* -----------------------------
   HTF helpers
------------------------------*/

function inferHigherTimeframeExhaustion({ strategyId, engine16, momentum } = {}) {
  const sid = String(strategyId || "").toLowerCase();
  const e16 = normalizeEngine16(engine16);
  const mom = normalizeMomentum(momentum);

  let score = 0;
  let primaryExhaustionTF = null;
  const reasonCodes = [];

  if (!(e16.exhaustionTrigger === true || e16.strategyType === "EXHAUSTION")) {
    return { score, primaryExhaustionTF, reasonCodes };
  }

  if (sid.includes("intraday_scalp")) {
    if (
      (deriveSignalDirectionFromEngine16(e16) === "SHORT" && mom.smi1h.direction === "DOWN") ||
      (deriveSignalDirectionFromEngine16(e16) === "LONG" && mom.smi1h.direction === "UP")
    ) {
      score += 10;
      primaryExhaustionTF = "1H";
      reasonCodes.push("HTF_EXHAUSTION_ALIGNMENT_1H");
    }
  }

  if (sid.includes("minor_swing") || sid.includes("intermediate_long")) {
    score += 8;
    primaryExhaustionTF = "1H";
    reasonCodes.push("HTF_EXHAUSTION_CONTEXT_1H");
  }

  return { score, primaryExhaustionTF, reasonCodes };
}

function inferScalpBiasProxy({ strategyId, engine16, momentum } = {}) {
  const sid = String(strategyId || "").toLowerCase();
  const e16 = normalizeEngine16(engine16);
  const mom = normalizeMomentum(momentum);

  if (!sid.includes("intraday_scalp")) {
    return {
      higherTimeframeBias: "NONE",
      higherTimeframeBiasSource: "NOT_SCALP",
    };
  }

  if (e16.context === "LONG_CONTEXT") {
    return {
      higherTimeframeBias: "LONG",
      higherTimeframeBiasSource: "ENGINE16_CONTEXT_PROXY",
    };
  }

  if (e16.context === "SHORT_CONTEXT") {
    return {
      higherTimeframeBias: "SHORT",
      higherTimeframeBiasSource: "ENGINE16_CONTEXT_PROXY",
    };
  }

  if (mom.alignment === "BULLISH") {
    return {
      higherTimeframeBias: "LONG",
      higherTimeframeBiasSource: "MOMENTUM_ALIGNMENT_PROXY",
    };
  }

  if (mom.alignment === "BEARISH") {
    return {
      higherTimeframeBias: "SHORT",
      higherTimeframeBiasSource: "MOMENTUM_ALIGNMENT_PROXY",
    };
  }

  if (mom.smi1h.direction === "UP") {
    return {
      higherTimeframeBias: "LONG",
      higherTimeframeBiasSource: "SMI_1H_PROXY",
    };
  }

  if (mom.smi1h.direction === "DOWN") {
    return {
      higherTimeframeBias: "SHORT",
      higherTimeframeBiasSource: "SMI_1H_PROXY",
    };
  }

  return {
    higherTimeframeBias: "NONE",
    higherTimeframeBiasSource: "UNKNOWN_PROXY",
  };
}

function classifyScalpAlignment({ strategyId, signalDirection, engine16, momentum } = {}) {
  const dir = safeUpper(signalDirection, "NONE");
  const proxy = inferScalpBiasProxy({ strategyId, engine16, momentum });

  if (!isScalpStrategy(strategyId)) {
    return {
      alignmentState: "N/A",
      scalpMode: "N/A",
      higherTimeframeBias: proxy.higherTimeframeBias,
      higherTimeframeBiasSource: proxy.higherTimeframeBiasSource,
    };
  }

  if (dir === "NONE" || proxy.higherTimeframeBias === "NONE") {
    return {
      alignmentState: "UNKNOWN",
      scalpMode: "WAIT",
      higherTimeframeBias: proxy.higherTimeframeBias,
      higherTimeframeBiasSource: proxy.higherTimeframeBiasSource,
    };
  }

  if (dir === proxy.higherTimeframeBias) {
    return {
      alignmentState: "ALIGNED",
      scalpMode: "NORMAL",
      higherTimeframeBias: proxy.higherTimeframeBias,
      higherTimeframeBiasSource: proxy.higherTimeframeBiasSource,
    };
  }

  return {
    alignmentState: "COUNTERTREND",
    scalpMode: "REDUCED",
    higherTimeframeBias: proxy.higherTimeframeBias,
    higherTimeframeBiasSource: proxy.higherTimeframeBiasSource,
  };
}

/* -----------------------------
   Candidate resolution
------------------------------*/
export function resolveStrategyCandidates({ engine16 } = {}) {
  const e16 = normalizeEngine16(engine16);
  const signalDirection = deriveSignalDirectionFromEngine16(e16);

  if (e16.exhaustionTrigger === true) {
    return [
      {
        strategyType: "EXHAUSTION",
        direction: signalDirection,
        source: "ENGINE16",
        engine16: e16,
      },
    ];
  }

  if (e16.exhaustionEarly === true) {
    return [];
  }

  if (!e16.ok || e16.strategyType === "NONE" || e16.readinessLabel === "NO_SETUP") {
    return [];
  }

  return [
    {
      strategyType: e16.strategyType,
      direction: signalDirection,
      source: "ENGINE16",
      engine16: e16,
    },
  ];
}

export function pickWinningStrategy({
  candidates = [],
  engine5,
  momentum,
  strategyId,
} = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      strategyType: "NONE",
      direction: "NONE",
      priority: 0,
      source: "NONE",
      candidate: null,
      primaryExhaustionTF: null,
      htfReasonCodes: [],
    };
  }

  const e5 = normalizeEngine5(engine5);
  const mom = normalizeMomentum(momentum);

  let best = null;

  for (const c of candidates) {
    const type = normalizeStrategyType(c?.strategyType);
    const dirInitial = safeUpper(c?.direction, "NONE");
    const base = BASE_PRIORITY[type] || 0;

    let priority = base;
    priority += clamp(Math.round((e5.total || 0) / 5), 0, 20);

    if (dirInitial === "LONG" && mom.alignment === "BULLISH") priority += 8;
    if (dirInitial === "SHORT" && mom.alignment === "BEARISH") priority += 8;
    if (dirInitial === "LONG" && mom.alignment === "BEARISH") priority -= 8;
    if (dirInitial === "SHORT" && mom.alignment === "BULLISH") priority -= 8;

    if (
      type === "EXHAUSTION" &&
      (c?.engine16?.exhaustionTrigger === true || c?.engine16?.exhaustionActive)
    ) {
      priority += 5;
    }

    const htf = inferHigherTimeframeExhaustion({
      strategyId,
      engine16: c?.engine16,
      momentum,
    });

    priority += htf.score;

    const candidateScore = {
      strategyType: type,
      direction: dirInitial,
      priority,
      source: c?.source || "ENGINE16",
      candidate: c,
      primaryExhaustionTF: htf.primaryExhaustionTF,
      htfReasonCodes: htf.reasonCodes,
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
    primaryExhaustionTF: null,
    htfReasonCodes: [],
  };
}

/* -----------------------------
   Hard blockers
------------------------------*/
export function evaluateHardBlockers({
  winner,
  permission,
  zoneContext,
  engine16,
} = {}) {
  const blockers = [];
  const conflicts = [];
  const softBlockers = [];

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
    softBlockers.push("E6_STAND_DOWN");
  }

  if (e16.invalidated === true) {
    softBlockers.push("E16_INVALIDATED");
  }

  if (
    z.zoneType !== "UNKNOWN" &&
    ["NEGOTIATED", "INSTITUTIONAL", "SHELF"].includes(z.zoneType) === false
  ) {
    blockers.push("ZONE_TYPE_NOT_ALLOWED");
  }

  return {
    blockers: [...blockers, ...softBlockers],
    conflicts,
    softBlockers,
    hardBlocked: blockers.length > 0,
  };
}

/* -----------------------------
   Quality
------------------------------*/
export function evaluateQualityGate({ engine5 } = {}) {
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

/* -----------------------------
   Momentum + scalp bias
------------------------------*/
export function evaluateMomentumGate({
  strategyId,
  winner,
  momentum,
  engine16,
} = {}) {
  const mom = normalizeMomentum(momentum);
  const dir = safeUpper(winner?.direction, "NONE");
  const type = winner?.strategyType || "NONE";

  let momentumGatePassed = false;
  let reasonCodes = [];
  let blockers = [];
  let conflicts = [];
  let bias = "NONE";

  const scalp = classifyScalpAlignment({
    strategyId,
    signalDirection: dir,
    engine16,
    momentum,
  });

  if (dir === "LONG") {
    if (mom.alignment === "BULLISH") {
      momentumGatePassed = true;
      bias = "LONG_PRIORITY";
      reasonCodes.push("E45_BULLISH_ALIGNED");
    } else if (type === "EXHAUSTION" || type === "REVERSAL") {
      if (mom.smi10m.direction === "UP") {
        momentumGatePassed = true;
        bias = "LONG_COUNTERTREND";
        reasonCodes.push("COUNTERTREND_EXPECTED");
        reasonCodes.push("E45_COUNTERTREND_LONG_OK");
        reasonCodes.push("E45_10M_SUPPORTS_LONG");
        conflicts.push("HIGHER_TF_NOT_CONFIRMED");
      } else {
        blockers.push("MOMENTUM_MISMATCH_LONG");
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
    } else if (type === "EXHAUSTION" || type === "REVERSAL") {
      if (mom.smi10m.direction === "DOWN") {
        momentumGatePassed = true;
        bias = "SHORT_COUNTERTREND";
        reasonCodes.push("COUNTERTREND_EXPECTED");
        reasonCodes.push("E45_COUNTERTREND_SHORT_OK");
        reasonCodes.push("E45_10M_SUPPORTS_SHORT");
        conflicts.push("HIGHER_TF_NOT_CONFIRMED");
      } else {
        blockers.push("MOMENTUM_MISMATCH_SHORT");
      }
    } else {
      blockers.push("MOMENTUM_MISMATCH_SHORT");
    }
  }

  if (isScalpStrategy(strategyId)) {
    reasonCodes.push("MODE_SCALP");

    if (scalp.alignmentState === "ALIGNED") {
      reasonCodes.push("SCALP_HTF_ALIGNED");
      if (dir === "LONG" && bias === "NONE") bias = "LONG_PRIORITY";
      if (dir === "SHORT" && bias === "NONE") bias = "SHORT_PRIORITY";
    } else if (scalp.alignmentState === "COUNTERTREND") {
      reasonCodes.push("SCALP_COUNTERTREND_REDUCED");
      conflicts.push("SCALP_COUNTERTREND");

      if (dir === "LONG") bias = "LONG_COUNTERTREND";
      if (dir === "SHORT") bias = "SHORT_COUNTERTREND";
    }
  }

  if (isSwingStrategy(strategyId)) reasonCodes.push("MODE_SWING");
  if (isIntermediateStrategy(strategyId)) reasonCodes.push("MODE_INTERMEDIATE");

  return {
    momentumGatePassed,
    executionBias: VALID_BIAS.has(bias) ? bias : "NONE",
    reasonCodes,
    blockers,
    conflicts,
    alignment: mom.alignment,
    momentumState: mom.momentumState,
    smi10Direction: mom.smi10m.direction,
    smi1hDirection: mom.smi1h.direction,
    scalpSummary: scalp,
  };
}

/* -----------------------------
   Continuation promotion
------------------------------*/
function evaluateContinuationPromotion({
  winner,
  engine16,
  engine3,
  engine4,
  momentum,
  qualityGate,
} = {}) {
  const e16 = normalizeEngine16(engine16);
  const e3 = normalizeE3(engine3);
  const e4 = normalizeE4(engine4);
  const mom = normalizeMomentum(momentum);

  const reasonCodes = [];
  const conflicts = [];

  let promoted = false;
  let nextSetupType = "NONE";
  let promotedDirection = winner?.direction || "NONE";

  const pullbackCandidate =
    e16.strategyType === "PULLBACK" ||
    e16.hasPulledBack === true ||
    e16.readinessLabel === "PULLBACK_READY";

  const rejectionSupportsShort =
    promotedDirection === "SHORT" &&
    (
      e16.wickRejectionShort ||
      e4.flags?.distributionDetected ||
      e4.flags?.initiativeMoveConfirmed ||
      e3.structureState === "FAILURE"
    );

  const rejectionSupportsLong =
    promotedDirection === "LONG" &&
    (
      e16.wickRejectionLong ||
      e4.flags?.absorptionDetected ||
      e4.flags?.initiativeMoveConfirmed ||
      e3.structureState === "RECLAIM"
    );

  if (pullbackCandidate && promotedDirection === "SHORT" && rejectionSupportsShort) {
    promoted = true;
    nextSetupType = "CONTINUATION_SHORT";
    reasonCodes.push("PULLBACK_CONTINUATION_SHORT_PENDING");
  }

  if (pullbackCandidate && promotedDirection === "LONG" && rejectionSupportsLong) {
    promoted = true;
    nextSetupType = "CONTINUATION_LONG";
    reasonCodes.push("PULLBACK_CONTINUATION_LONG_PENDING");
  }

  if (
    pullbackCandidate &&
    promotedDirection === "SHORT" &&
    mom.smi10m.direction === "UP" &&
    mom.smi1h.direction === "DOWN"
  ) {
    conflicts.push("PULLBACK_BOUNCE_STILL_ACTIVE");
  }

  if (
    pullbackCandidate &&
    promotedDirection === "LONG" &&
    mom.smi10m.direction === "DOWN" &&
    mom.smi1h.direction === "UP"
  ) {
    conflicts.push("PULLBACK_DIP_STILL_ACTIVE");
  }

  return {
    promoted,
    nextSetupType,
    promotedDirection,
    reasonCodes,
    conflicts,
    qualityGatePassed: qualityGate?.qualityGatePassed === true,
  };
}

/* -----------------------------
   Setup chain
------------------------------*/
function buildSetupChain({
  winner,
  engine16,
  promotedStrategyType,
  nextSetupType,
  lifecycleStage,
} = {}) {
  const chain = [];
  const type = winner?.strategyType || "NONE";
  const e16 = normalizeEngine16(engine16);
  const dir = safeUpper(winner?.direction, "NONE");

  if (winner?.primaryExhaustionTF) {
    chain.push(`${winner.primaryExhaustionTF}_EXHAUSTION`);
  }

  if (e16.exhaustionEarly === true && e16.exhaustionTrigger !== true) {
    chain.push("EXHAUSTION_EARLY");
  }

  if (type === "EXHAUSTION") chain.push("EXHAUSTION");
  else if (type === "REVERSAL") chain.push("REVERSAL");
  else if (type === "BREAKDOWN") chain.push("BREAKDOWN");
  else if (type === "BREAKOUT") chain.push("BREAKOUT");

  if (e16.hasPulledBack || e16.strategyType === "PULLBACK" || e16.readinessLabel === "PULLBACK_READY") {
    chain.push("PULLBACK");
  }

  if (e16.insidePrimaryZone || e16.insideSecondaryZone) {
    chain.push("IN_TRIGGER_ZONE");
  }

  if (dir === "SHORT" && e16.wickRejectionShort) chain.push("SHORT_REJECTION_PRESENT");
  if (dir === "LONG" && e16.wickRejectionLong) chain.push("LONG_REJECTION_PRESENT");

  if (promotedStrategyType === "CONTINUATION") {
    chain.push("CONTINUATION_PENDING");
  } else if (nextSetupType !== "NONE") {
    chain.push(nextSetupType);
  } else if (type === "EXHAUSTION" && e16.exhaustionTrigger === true) {
    chain.push("TRIGGERED");
  }

  if (lifecycleStage === "TRIGGERED") chain.push("LIVE_TRIGGER");
  if (lifecycleStage === "MATURE") chain.push("MATURE");
  if (lifecycleStage === "COMPLETED") chain.push("COMPLETED");

  if (chain.length === 0) chain.push("BUILDING");
  return [...new Set(chain)];
}

function deriveNextSetupType({
  winner,
  engine16,
  promotedStrategyType,
  nextSetupType,
  lifecycle,
} = {}) {
  const e16 = normalizeEngine16(engine16);

  if (lifecycle?.lifecycleStage === "COMPLETED") {
    return "WAIT_FOR_NEW_SEQUENCE";
  }

  if (nextSetupType && nextSetupType !== "NONE") return nextSetupType;
  if (promotedStrategyType === "CONTINUATION") return "CONTINUATION_TRIGGER";

  if (winner?.strategyType === "EXHAUSTION") {
    if (e16.exhaustionTrigger === true) return "CONFIRM_FOLLOWTHROUGH";
    if (e16.exhaustionEarly === true) return "WAIT_FOR_TRIGGER";
    if (e16.hasPulledBack) return "TRIGGER_CONFIRM";
    return "PULLBACK";
  }

  if (winner?.strategyType === "REVERSAL") return "TRIGGER_CONFIRM";
  if (winner?.strategyType === "PULLBACK") return "CONTINUATION_TRIGGER";

  return "NONE";
}

/* -----------------------------
   Trigger readiness
------------------------------*/
export function evaluateTriggerReadiness({
  strategyId,
  winner,
  engine16,
  engine3,
  engine4,
  momentum,
  qualityGate,
  momentumGate,
  hardBlockers,
  lifecycle,
} = {}) {
  const e16 = normalizeEngine16(engine16);
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
      promotedStrategyType: winner?.strategyType || "NONE",
      nextSetupType: "NONE",
      setupChain: [],
      freshEntryNow: false,
    };
  }

  if (e16.exhaustionEarly === true && e16.exhaustionTrigger !== true) {
    return {
      readinessLabel: "NEAR",
      entryStyle: "EARLY_WARNING",
      triggerConfirmed: false,
      reasonCodes: ["EXHAUSTION_EARLY_WATCH"],
      blockers: [],
      promotedStrategyType: "NONE",
      nextSetupType: "WAIT_FOR_TRIGGER",
      setupChain: ["EXHAUSTION_EARLY", "WAIT_FOR_TRIGGER"],
      freshEntryNow: false,
    };
  }

  if (!winner || winner.strategyType === "NONE") {
    return {
      readinessLabel: "WAIT",
      entryStyle: "NONE",
      triggerConfirmed: false,
      reasonCodes: ["NO_STRATEGY"],
      blockers: ["NO_STRATEGY"],
      promotedStrategyType: "NONE",
      nextSetupType: "NONE",
      setupChain: [],
      freshEntryNow: false,
    };
  }

  const qualityPass = qualityGate?.qualityGatePassed === true;
  const momentumPass = momentumGate?.momentumGatePassed === true;

  let readinessLabel = "WAIT";
  let entryStyle = "NONE";
  let triggerConfirmed = false;
  let freshEntryNow = false;

  if (!qualityPass) {
    readinessLabel = "NEAR";
    blockers.push(...(qualityGate?.blockers || []));
    reasonCodes.push(...(qualityGate?.reasonCodes || []));
  } else {
    reasonCodes.push(...(qualityGate?.reasonCodes || []));
  }

  if (!momentumPass) {
    if (readinessLabel === "WAIT") readinessLabel = "NEAR";
    blockers.push(...(momentumGate?.blockers || []));
    reasonCodes.push(...(momentumGate?.reasonCodes || []));
  } else {
    reasonCodes.push(...(momentumGate?.reasonCodes || []));
  }

  if (Array.isArray(hardBlockers?.softBlockers) && hardBlockers.softBlockers.length) {
    blockers.push(...hardBlockers.softBlockers);
  }

  if (winner.strategyType === "EXHAUSTION" && e16.exhaustionTrigger === true) {
    if (qualityPass && momentumPass) {
      readinessLabel = "READY";
      entryStyle = "EXHAUSTION_TRIGGER";
      triggerConfirmed = true;
      freshEntryNow = true;
      reasonCodes.push("ENGINE16_EXHAUSTION_TRIGGER");
    } else {
      readinessLabel = "ARMING";
      entryStyle = "EXHAUSTION_TRIGGER_PENDING_FILTERS";
      reasonCodes.push("ENGINE16_EXHAUSTION_TRIGGER_PENDING");
      freshEntryNow = false;
    }
  }

  if (qualityPass && winner.strategyType !== "EXHAUSTION") {
    if (e3.stage === "ARMED" || e3.armed === true) {
      readinessLabel = "ARMING";
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
      freshEntryNow = true;
    }

    if (
      e3.stage === "CONFIRMED" &&
      (e4.volumeConfirmed === true || e4.volumeScore >= 9)
    ) {
      readinessLabel = "CONFIRMED";
      entryStyle = "CONFIRMATION";
      triggerConfirmed = true;
      reasonCodes.push("E3_CONFIRMED");
      reasonCodes.push("E4_CONFIRMED");
      freshEntryNow = true;
    }
  }

  if (winner.strategyType === "EXHAUSTION" || winner.strategyType === "REVERSAL") {
    if (e4.flags?.reversalExpansion) {
      reasonCodes.push("REVERSAL_VOLUME_PRESENT");
      if (readinessLabel === "NEAR" && qualityPass && e16.exhaustionTrigger !== true) {
        readinessLabel = "ARMING";
      }
    }
  }

  const promo = evaluateContinuationPromotion({
    winner,
    engine16,
    engine3,
    engine4,
    momentum,
    qualityGate,
  });

  let promotedStrategyType = winner.strategyType;
  let nextSetupType = "NONE";

  if (promo.promoted) {
    promotedStrategyType = "CONTINUATION";
    nextSetupType = promo.nextSetupType;
    reasonCodes.push(...promo.reasonCodes);

    if (readinessLabel === "NEAR") {
      readinessLabel = "ARMING";
      entryStyle = "EARLY_CONTINUATION";
    } else if (readinessLabel === "ARMING") {
      entryStyle = "EARLY_CONTINUATION";
    }
  }

  if (
    winner.strategyType === "EXHAUSTION" &&
    e16.hasPulledBack &&
    readinessLabel === "NEAR"
  ) {
    readinessLabel = "ARMING";
    entryStyle = "PULLBACK_BUILD";
    reasonCodes.push("HTF_EXHAUSTION_LTF_PULLBACK_BUILD");
  }

  if (isScalpStrategy(strategyId) && momentumGate?.scalpSummary?.alignmentState === "COUNTERTREND") {
    reasonCodes.push("SCALP_COUNTERTREND_REDUCED");
    if (readinessLabel === "CONFIRMED") {
      readinessLabel = "READY";
    }
  }

  if (lifecycle?.lifecycleStage === "TRIGGERED") {
    reasonCodes.push("LIFECYCLE_TRIGGERED");
  }

  if (lifecycle?.lifecycleStage === "MATURE") {
    freshEntryNow = false;
    if (readinessLabel === "CONFIRMED") readinessLabel = "READY";
  }

  if (!VALID_READINESS.has(readinessLabel)) readinessLabel = "WAIT";

  const setupChain = buildSetupChain({
    winner,
    engine16: e16,
    promotedStrategyType,
    nextSetupType,
    lifecycleStage: lifecycle?.lifecycleStage || "BUILDING",
  });

  nextSetupType = deriveNextSetupType({
    winner,
    engine16: e16,
    promotedStrategyType,
    nextSetupType,
    lifecycle,
  });

  return {
    readinessLabel,
    entryStyle,
    triggerConfirmed,
    reasonCodes,
    blockers,
    promotedStrategyType,
    nextSetupType,
    setupChain,
    freshEntryNow,
  };
}

/* -----------------------------
   Lifecycle helpers
------------------------------*/
function makeZoneCandidate(z, type, tpSlot) {
  return {
    id: z?.id ?? null,
    type,
    lo: toNum(z?.lo),
    hi: toNum(z?.hi),
    mid: toNum(z?.mid),
    strength: z?.strength ?? null,
    tpSlot,
    hit: false,
  };
}

function sortZonesForDirection(zones = [], direction = "NONE", signalPrice = null) {
  const sp = toNum(signalPrice);
  const dir = safeUpper(direction, "NONE");

  const cleaned = zones
    .filter((z) => z && Number.isFinite(z.lo) && Number.isFinite(z.hi))
    .map((z) => ({ ...z, mid: Number.isFinite(z.mid) ? z.mid : (z.lo + z.hi) / 2 }));

  if (!Number.isFinite(sp)) return cleaned;

  if (dir === "SHORT") {
    return cleaned.filter((z) => z.mid < sp).sort((a, b) => b.mid - a.mid);
  }

  if (dir === "LONG") {
    return cleaned.filter((z) => z.mid > sp).sort((a, b) => a.mid - b.mid);
  }

  return cleaned;
}

function isZoneHit(zone, direction, currentPrice) {
  if (!zone || !Number.isFinite(currentPrice)) return false;
  const dir = safeUpper(direction, "NONE");
  const lo = toNum(zone.lo);
  const hi = toNum(zone.hi);

  if (lo == null || hi == null) return false;

  if (dir === "SHORT") return currentPrice <= hi;
  if (dir === "LONG") return currentPrice >= lo;

  return false;
}

function dedupeZones(zones = []) {
  const out = [];
  const seen = new Set();

  for (const z of zones) {
    const key = [
      z?.id || "NO_ID",
      z?.type || "NO_TYPE",
      String(z?.lo ?? ""),
      String(z?.hi ?? ""),
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(z);
  }

  return out;
}

function extractCurrentPrice(zoneContext) {
  const zc = normalizeZoneContext(zoneContext);

  const price =
    toNum(zc?.meta?.current_price) ??
    toNum(zc?.meta?.currentPrice) ??
    toNum(zoneContext?.meta?.current_price) ??
    toNum(zoneContext?.meta?.currentPrice) ??
    null;

  if (!Number.isFinite(price) || price <= 0) return null;
  return price;
}

function getLifecycleThresholds(strategyId) {
  if (isScalpStrategy(strategyId)) {
    return {
      triggerWindowPts: 0.75,
    };
  }

  if (isSwingStrategy(strategyId)) {
    return {
      triggerWindowPts: 1.5,
    };
  }

  return {
    triggerWindowPts: 2.0,
  };
}

function buildLifecycle({
  strategyId,
  winner,
  engine16,
  zoneContext,
} = {}) {
  const e16 = normalizeEngine16(engine16);
  const zc = normalizeZoneContext(zoneContext);
  const direction = winner?.direction || "NONE";
  const thresholds = getLifecycleThresholds(strategyId);

  const signalPrice =
    toNum(e16.exhaustionBarPrice) ??
    toNum(zc?.active?.negotiated?.mid) ??
    toNum(zc?.active?.institutional?.mid) ??
    toNum(zc?.active?.shelf?.mid) ??
    null;

  const currentPrice = extractCurrentPrice(zoneContext);

  const ladders = [];
  const activeInst = zc?.active?.institutional;
  const activeNeg = zc?.active?.negotiated;
  const activeShelf = zc?.active?.shelf;

  if (activeInst) ladders.push(makeZoneCandidate(activeInst, "INSTITUTIONAL", 1));
  if (activeNeg) ladders.push(makeZoneCandidate(activeNeg, "NEGOTIATED", 2));
  if (activeShelf) ladders.push(makeZoneCandidate(activeShelf, safeUpper(activeShelf?.type, "SHELF"), 3));

  let tpIndex = ladders.length + 1;

  for (const z of zc.render.negotiated) {
    ladders.push(makeZoneCandidate(z, "NEGOTIATED", tpIndex++));
  }
  for (const z of zc.render.institutional) {
    ladders.push(makeZoneCandidate(z, "INSTITUTIONAL", tpIndex++));
  }
  for (const z of zc.render.shelves) {
    ladders.push(makeZoneCandidate(z, safeUpper(z?.type, "SHELF"), tpIndex++));
  }

  const path = sortZonesForDirection(dedupeZones(ladders), direction, signalPrice);

  for (const z of path) {
    z.hit = isZoneHit(z, direction, currentPrice);
  }

  const zonesHit = path.filter((z) => z.hit).length;
  const tp1Zone = path[0] || null;
  const tp2Zone = path[1] || null;

  const firstTargetHit = tp1Zone ? tp1Zone.hit === true : false;
  const secondTargetHit = tp2Zone ? tp2Zone.hit === true : false;

  const moveFromSignalPts =
    Number.isFinite(signalPrice) && Number.isFinite(currentPrice)
      ? Math.abs(currentPrice - signalPrice)
      : null;

  let lifecycleStage = "BUILDING";
  let runnerActive = false;
  let runnerExitTriggered = false;
  let runnerExitReason = null;
  let edgeRemainingPct = 100;
  let nextFocus = "WAIT_FOR_TRIGGER";
  let setupCompleted = false;

  const hasLiveSignal =
    e16.exhaustionTrigger === true ||
    e16.breakoutReady === true ||
    e16.breakdownReady === true ||
    e16.trendContinuation === true;

  if (hasLiveSignal) {
    lifecycleStage = "TRIGGERED";
    nextFocus = "LOOK_FOR_FOLLOWTHROUGH";
  }

  if (firstTargetHit && !secondTargetHit) {
    lifecycleStage = "PARTIALLY_COMPLETED";
    runnerActive = true;
    edgeRemainingPct = 66;
    nextFocus = "LOOK_FOR_CONTINUATION_TO_NEXT_ZONE";
  }

  if (firstTargetHit && secondTargetHit) {
    lifecycleStage = "MATURE";
    runnerActive = true;
    edgeRemainingPct = 33;
    nextFocus = "MANAGE_RUNNER";
  }

  if (
    lifecycleStage === "TRIGGERED" &&
    moveFromSignalPts != null &&
    moveFromSignalPts >= thresholds.triggerWindowPts &&
    path.length === 0
  ) {
    lifecycleStage = "MATURE";
    runnerActive = false;
    edgeRemainingPct = 33;
    nextFocus = "NO_FRESH_ENTRY";
  }

  const noSetupNow =
    e16.strategyType === "NONE" ||
    e16.readinessLabel === "NO_SETUP" ||
    e16.invalidated === true;

  const oppositeExhaustion =
    (direction === "SHORT" && e16.exhaustionLong === true) ||
    (direction === "LONG" && e16.exhaustionShort === true);

  if (lifecycleStage === "MATURE" && (noSetupNow || oppositeExhaustion)) {
    runnerActive = false;
    runnerExitTriggered = true;
    runnerExitReason = "RUNNER_EXIT_SETUP_CONTEXT_CHANGED";
    lifecycleStage = "COMPLETED";
    edgeRemainingPct = 0;
    setupCompleted = true;
    nextFocus = "LOOK_FOR_NEW_SETUP";
  }

  if (
    lifecycleStage === "MATURE" &&
    firstTargetHit &&
    secondTargetHit &&
    zonesHit >= 3
  ) {
    runnerActive = false;
    runnerExitTriggered = true;
    runnerExitReason = "RUNNER_EXIT_PATH_EXTENDED";
    lifecycleStage = "COMPLETED";
    edgeRemainingPct = 0;
    setupCompleted = true;
    nextFocus = "LOOK_FOR_NEW_SETUP";
  }

  if (
    (lifecycleStage === "TRIGGERED" || lifecycleStage === "MATURE") &&
    noSetupNow &&
    hasLiveSignal !== true
  ) {
    lifecycleStage = "COMPLETED";
    runnerActive = false;
    runnerExitTriggered = true;
    runnerExitReason = "SETUP_NO_LONGER_ACTIVE";
    edgeRemainingPct = 0;
    setupCompleted = true;
    nextFocus = "LOOK_FOR_NEW_SETUP";
  }

  const targetProgress01 =
    secondTargetHit ? 1 : firstTargetHit ? 0.7 : 0;

  const isFreshSetup =
    lifecycleStage === "BUILDING" ||
    lifecycleStage === "TRIGGERED";

  const entryWindowOpen =
    lifecycleStage === "BUILDING" ||
    lifecycleStage === "TRIGGERED";

  return {
    lifecycleStage,
    isFreshSetup,
    entryWindowOpen,
    signalPrice,
    currentPrice,
    barsSinceSignal: null,
    moveFromSignalPts,
    moveFromSignalAtr: null,
    zonesInPath: path,
    zonesHit,
    targetCount: Math.min(2, path.length),
    targetProgress01,
    firstTargetHit,
    secondTargetHit,
    tp1Zone: tp1Zone
      ? {
          id: tp1Zone.id,
          type: tp1Zone.type,
          lo: tp1Zone.lo,
          hi: tp1Zone.hi,
          mid: tp1Zone.mid,
          strength: tp1Zone.strength,
          tpSlot: tp1Zone.tpSlot,
        }
      : null,
    tp2Zone: tp2Zone
      ? {
          id: tp2Zone.id,
          type: tp2Zone.type,
          lo: tp2Zone.lo,
          hi: tp2Zone.hi,
          mid: tp2Zone.mid,
          strength: tp2Zone.strength,
          tpSlot: tp2Zone.tpSlot,
        }
      : null,
    tp1Reclaimed: false,
    block2Protected: false,
    block2ExitReason: null,
    runnerActive,
    runnerExitTriggered,
    runnerExitReason,
    ema10_30m: null,
    setupCompleted,
    edgeRemainingPct,
    nextFocus,
  };
}

function applyLifecycleOverride({
  trigger,
  lifecycle,
} = {}) {
  if (!lifecycle) return trigger;

  const out = { ...trigger };

  if (lifecycle.lifecycleStage === "COMPLETED") {
    out.readinessLabel = "STAND_DOWN";
    out.entryStyle = "NONE";
    out.triggerConfirmed = false;
    out.freshEntryNow = false;
    out.reasonCodes = [...new Set([...(out.reasonCodes || []), "RUNNER_EXIT_TRIGGERED"])];
  }

  if (lifecycle.lifecycleStage === "MATURE") {
    out.freshEntryNow = false;
    out.reasonCodes = [...new Set([...(out.reasonCodes || []), "SETUP_MATURE_NO_CHASE"])];
  }

  return out;
}

function buildSignalEvent({ winner, engine16 } = {}) {
  const e16 = normalizeEngine16(engine16);
  const resolvedType = normalizeStrategyType(winner?.strategyType || e16.strategyType);
  const resolvedDirection = safeUpper(winner?.direction, "NONE");

  let signalType = "NONE";
  let signalTime = null;
  let signalPrice = null;
  let signalSource = null;

  if (e16.exhaustionTrigger === true) {
    signalType = "EXHAUSTION";
    signalTime =
      e16?.signalTimes?.exhaustionTriggerTime ||
      e16?.signalTimes?.exhaustionTime ||
      e16?.exhaustionBarTime ||
      null;
    signalPrice = toNum(e16?.exhaustionBarPrice) ?? null;
    signalSource = "ENGINE16_EXHAUSTION_TRIGGER";
  } else if (resolvedType === "REVERSAL" || e16.reversalDetected === true) {
    signalType = "REVERSAL";
    signalTime = e16?.signalTimes?.reversalTime || null;
    signalPrice = null;
    signalSource = "ENGINE16_REVERSAL";
  } else if (resolvedType === "BREAKDOWN" || e16.breakdownReady === true) {
    signalType = "BREAKDOWN";
    signalTime = e16?.signalTimes?.breakdownReadyTime || null;
    signalPrice = null;
    signalSource = "ENGINE16_BREAKDOWN";
  } else if (resolvedType === "BREAKOUT" || e16.breakoutReady === true) {
    signalType = "BREAKOUT";
    signalTime = e16?.signalTimes?.breakoutReadyTime || null;
    signalPrice = null;
    signalSource = "ENGINE16_BREAKOUT";
  } else if (resolvedType === "CONTINUATION" || e16.trendContinuation === true) {
    signalType = "CONTINUATION";
    signalTime = e16?.signalTimes?.continuationTime || null;
    signalPrice = null;
    signalSource = "ENGINE16_CONTINUATION";
  }

  return {
    signalType,
    direction: resolvedDirection,
    signalTime,
    signalPrice,
    signalSource,
  };
}

function buildScalpSummary({
  strategyId,
  winner,
  engine16,
  momentumGate,
} = {}) {
  if (!isScalpStrategy(strategyId)) {
    return {
      enabled: false,
      higherTimeframeBias: "NONE",
      higherTimeframeBiasSource: "NOT_SCALP",
      triggerSignal: "NONE",
      triggerDirection: "NONE",
      alignmentState: "N/A",
      scalpMode: "N/A",
    };
  }

  const e16 = normalizeEngine16(engine16);
  const triggerSignal =
    winner?.strategyType && winner.strategyType !== "NONE"
      ? winner.strategyType
      : e16.strategyType;

  const scalp = momentumGate?.scalpSummary || {
    alignmentState: "UNKNOWN",
    scalpMode: "WAIT",
    higherTimeframeBias: "NONE",
    higherTimeframeBiasSource: "UNKNOWN_PROXY",
  };

  return {
    enabled: true,
    higherTimeframeBias: scalp.higherTimeframeBias || "NONE",
    higherTimeframeBiasSource: scalp.higherTimeframeBiasSource || "UNKNOWN_PROXY",
    triggerSignal: safeUpper(triggerSignal, "NONE"),
    triggerDirection: safeUpper(winner?.direction, "NONE"),
    alignmentState: scalp.alignmentState || "UNKNOWN",
    scalpMode: scalp.scalpMode || "WAIT",
  };
}

/* -----------------------------
   Final decision
------------------------------*/
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

  // IMPORTANT:
  // direction ownership stays with LTF Engine16 signal.
  // HTF is used only by alignment / bias filters later.
  const resolvedWinner = {
    ...winner,
    direction: safeUpper(winner?.direction, "NONE"),
  };

  const hard = evaluateHardBlockers({
    winner: resolvedWinner,
    permission,
    zoneContext,
    engine16,
  });

  const quality = evaluateQualityGate({ engine5 });

  const mom = evaluateMomentumGate({
    strategyId,
    winner: resolvedWinner,
    momentum,
    engine16,
  });

  const lifecycle = buildLifecycle({
    strategyId,
    winner: resolvedWinner,
    engine16,
    zoneContext,
  });

  const triggerBase = evaluateTriggerReadiness({
    strategyId,
    winner: resolvedWinner,
    engine16,
    engine3,
    engine4,
    momentum,
    qualityGate: quality,
    momentumGate: mom,
    hardBlockers: hard,
    lifecycle,
  });

  const signalEvent = buildSignalEvent({
    winner: resolvedWinner,
    engine16,
  });

  const trigger = applyLifecycleOverride({
    trigger: triggerBase,
    lifecycle,
  });

  const executionBias = VALID_BIAS.has(mom.executionBias) ? mom.executionBias : "NONE";

  let action = "NO_ACTION";

  if (lifecycle?.lifecycleStage === "COMPLETED") {
    action = "NO_ACTION";
  } else if (trigger.readinessLabel === "STAND_DOWN") {
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
    ...(resolvedWinner?.htfReasonCodes || []),
  ];

  const blockers = [
    ...(hard.blockers || []),
    ...(quality.blockers || []),
    ...(mom.blockers || []),
    ...(trigger.blockers || []),
  ];

  const conflicts = [
    ...(hard.conflicts || []),
    ...(mom.conflicts || []),
  ];

  const scalpSummary = buildScalpSummary({
    strategyId,
    winner: resolvedWinner,
    engine16,
    momentumGate: mom,
  });

  const freshEntryNow =
    trigger.freshEntryNow === true &&
    lifecycle?.entryWindowOpen === true &&
    lifecycle?.setupCompleted !== true &&
    lifecycle?.lifecycleStage !== "MATURE" &&
    lifecycle?.lifecycleStage !== "COMPLETED";

  return {
    ok: true,
    engine: "engine15.decisionReferee.v8.1",
    symbol,
    strategyId,
    strategyType: trigger.promotedStrategyType || resolvedWinner?.strategyType || "NONE",
    direction: resolvedWinner?.direction || "NONE",
    readinessLabel: trigger.readinessLabel,
    executionBias,
    action,
    freshEntryNow,
    priority: Number.isFinite(Number(resolvedWinner?.priority)) ? Number(resolvedWinner.priority) : 0),
    entryStyle: trigger.entryStyle || "NONE",
    reasonCodes: [...new Set(reasonCodes)],
    blockers: [...new Set(blockers)],
    conflicts: [...new Set(conflicts)],
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
    setupChain: Array.isArray(trigger.setupChain) ? trigger.setupChain : [],
    nextSetupType: trigger.nextSetupType || "NONE",
    primaryExhaustionTF: resolvedWinner?.primaryExhaustionTF || null,
    scalpSummary,
    signalEvent,
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
      strategyId,
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
      engine: "engine15.decisionReferee.v8.1",
      symbol,
      strategyId,
      strategyType: "NONE",
      direction: "NONE",
      readinessLabel: "WAIT",
      executionBias: "NONE",
      action: "NO_ACTION",
      freshEntryNow: false,
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
      setupChain: [],
      nextSetupType: "NONE",
      primaryExhaustionTF: null,
      scalpSummary: {
        enabled: false,
        higherTimeframeBias: "NONE",
        higherTimeframeBiasSource: "ERROR",
        triggerSignal: "NONE",
        triggerDirection: "NONE",
        alignmentState: "UNKNOWN",
        scalpMode: "WAIT",
      },
      signalEvent: {
        signalType: "NONE",
        direction: "NONE",
        signalTime: null,
        signalPrice: null,
        signalSource: null,
      },
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
        tp1Zone: null,
        tp2Zone: null,
        tp1Reclaimed: false,
        block2Protected: false,
        block2ExitReason: null,
        runnerActive: false,
        runnerExitTriggered: false,
        runnerExitReason: null,
        ema10_30m: null,
        setupCompleted: false,
        edgeRemainingPct: 100,
        nextFocus: "LOOK_FOR_NEW_SETUP",
      },
      debug: {},
    };
  }
}

export default computeEngine15DecisionReferee;
