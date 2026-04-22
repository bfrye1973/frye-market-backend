// services/core/logic/engine15DecisionReferee.js
//
// Engine 15C — Decision Referee
//
// v8.4
// - keeps Engine 16 exhaustion EARLY as advisory only
// - does NOT promote exhaustionEarly into a strategy candidate
// - prevents early-only exhaustion from collapsing into STAND_DOWN / BLOCKED
// - keeps exhaustionTrigger as the real tradable exhaustion event
// - adds Engine16 unavailable/skipped guard for Intermediate Swing
// - prevents fake BLOCKED / NO_VALID_STRATEGY / NO_DIRECTION when Engine 16 is skipped
// - preserves Engine16 EMA values for READY-stage momentum filter
// - uses lifecycle.currentPrice for current EMA filter contract
// - missing EMA/current price => WATCH (not hard block)
// - FIX: continuationTriggerShort/Long now carry real direction truth
// - continuationWatchShort/Long remain advisory only (not full trigger direction)
//
// Notes:
// - pure logic only
// - no route fanout
// - safe / defensive
// - does NOT replace Engine 6
// - does NOT place orders

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
  "WATCH",
  "ARMING",
  "READY",
  "CONFIRMED",
  "STAND_DOWN",
  "PREP",
  "TRIGGERED",
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
  "LONG_PREP",
  "SHORT_PREP",
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

  if (engine16?.continuationTriggerShort === true) return "SHORT";
  if (engine16?.continuationTriggerLong === true) return "LONG";

  if (engine16?.continuationWatchShort === true) return "SHORT";
  if (engine16?.continuationWatchLong === true) return "LONG";

  if (engine16?.prepBias === "SHORT_PREP") return "SHORT";
  if (engine16?.prepBias === "LONG_PREP") return "LONG";

  if (engine16?.executionBias === "SHORT_ONLY") return "SHORT";
  if (engine16?.executionBias === "LONG_ONLY") return "LONG";

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
    meta: ctx?.meta || null,
    active: ctx?.active || null,
    nearest: ctx?.nearest || null,
    macroLevelContext: ctx?.macroLevelContext || null,
    render: {
      negotiated: Array.isArray(ctx?.render?.negotiated) ? ctx.render.negotiated : [],
      institutional: Array.isArray(ctx?.render?.institutional) ? ctx.render.institutional : [],
      shelves: Array.isArray(ctx?.render?.shelves) ? ctx.render.shelves : [],
    },
  };
}

function normalizeEngine16(engine16 = null) {
  const strategyType = normalizeStrategyType(engine16?.strategyType);
  const readinessLabel = safeUpper(engine16?.readinessLabel, "NO_SETUP");
  const direction = normalizeDirection(engine16?.direction, engine16);
  const signalTimes = engine16?.signalTimes || {};

  return {
    ok: engine16?.ok !== false,
    skipped: engine16?.skipped === true,
    strategyType,
    readinessLabel,
    direction,
    prepBias: safeUpper(engine16?.prepBias, "NONE"),
    context: safeUpper(engine16?.context, "NONE"),
    state: safeUpper(engine16?.state, "NONE"),

    ema10: toNum(engine16?.ema10),
    ema20: toNum(engine16?.ema20),

    waveState:
      safeUpper(engine16?.waveState, "") ||
      safeUpper(engine16?.waveContext?.waveState, "UNKNOWN"),
    intermediatePhase:
      safeUpper(engine16?.intermediatePhase, "") ||
      safeUpper(engine16?.waveContext?.intermediatePhase, "") ||
      safeUpper(engine16?.engine2Context?.intermediate?.phase, ""),
    wavePrep:
      engine16?.wavePrep === true ||
      engine16?.waveContext?.wavePrep === true,

    exhaustionDetected: engine16?.exhaustionDetected === true,
    exhaustionActive: engine16?.exhaustionActive === true,

    exhaustionEarly: engine16?.exhaustionEarly === true,
    exhaustionTrigger: engine16?.exhaustionTrigger === true,

    exhaustionEarlyLong: engine16?.exhaustionEarlyLong === true,
    exhaustionEarlyShort: engine16?.exhaustionEarlyShort === true,
    exhaustionTriggerLong: engine16?.exhaustionTriggerLong === true,
    exhaustionTriggerShort: engine16?.exhaustionTriggerShort === true,

    exhaustionShort: engine16?.exhaustionShort === true,
    exhaustionLong: engine16?.exhaustionLong === true,

    exhaustionBarTime: engine16?.exhaustionBarTime || null,
    exhaustionBarPrice: toNum(engine16?.exhaustionBarPrice),

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

    continuationWatch: engine16?.continuationWatch === true,
    continuationWatchShort: engine16?.continuationWatchShort === true,
    continuationWatchLong: engine16?.continuationWatchLong === true,
    continuationTrigger: engine16?.continuationTrigger === true,
    continuationTriggerShort: engine16?.continuationTriggerShort === true,
    continuationTriggerLong: engine16?.continuationTriggerLong === true,

    signalTimes,
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

function inferHigherTimeframeExhaustion({ strategyId, engine16, momentum } = {}) {
  const sid = String(strategyId || "").toLowerCase();
  const e16 = normalizeEngine16(engine16);
  const mom = normalizeMomentum(momentum);

  let score = 0;
  let primaryExhaustionTF = null;
  const reasonCodes = [];

  if (e16.strategyType !== "EXHAUSTION" && e16.exhaustionTrigger !== true) {
    return { score, primaryExhaustionTF, reasonCodes };
  }

  if (sid.includes("intraday_scalp")) {
    if (
      (e16.direction === "SHORT" && mom.smi1h.direction === "DOWN") ||
      (e16.direction === "LONG" && mom.smi1h.direction === "UP")
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

function deriveDirectionFromHTFContext({ winner, engine16, momentum } = {}) {
  const current = safeUpper(winner?.direction, "NONE");
  if (current !== "NONE") return current;

  const e16 = normalizeEngine16(engine16);
  const mom = normalizeMomentum(momentum);

  if (e16.exhaustionTriggerShort) return "SHORT";
  if (e16.exhaustionTriggerLong) return "LONG";
  if (e16.exhaustionShort) return "SHORT";
  if (e16.exhaustionLong) return "LONG";

  if (e16.exhaustionTriggerShort) return "SHORT";
  if (e16.exhaustionTriggerLong) return "LONG";
  if (e16.exhaustionShort) return "SHORT";
  if (e16.exhaustionLong) return "LONG";

  if (e16.continuationTriggerShort) return "SHORT";
  if (e16.continuationTriggerLong) return "LONG";

  if (e16.continuationWatchShort) return "SHORT";
  if (e16.continuationWatchLong) return "LONG";

  if (e16.prepBias === "SHORT_PREP") return "SHORT";
  if (e16.prepBias === "LONG_PREP") return "LONG";

  if (e16.executionBias === "SHORT_ONLY") return "SHORT";
  if (e16.executionBias === "LONG_ONLY") return "LONG";

  if (e16.breakdownReady) return "SHORT";
  if (e16.breakoutReady) return "LONG";
  if (e16.wickRejectionShort) return "SHORT";
  if (e16.wickRejectionLong) return "LONG";
  
  if (e16.strategyType === "EXHAUSTION" || e16.exhaustionTrigger === true) {
    if (mom.smi1h.direction === "DOWN") return "SHORT";
    if (mom.smi1h.direction === "UP") return "LONG";
  }

  return "NONE";
}

function isEarlyExhaustionOnly(e16) {
  return e16?.exhaustionEarly === true && e16?.exhaustionTrigger !== true;
}

function getTriggerSignalTime(e16) {
  return (
    e16?.signalTimes?.exhaustionTriggerTime ||
    e16?.signalTimes?.exhaustionTime ||
    e16?.exhaustionBarTime ||
    null
  );
}

function getTriggerSignalPrice(e16) {
  return e16?.exhaustionBarPrice ?? null;
}

function macroMidpointHit({ zoneContext, currentPrice, direction } = {}) {
  const zc = normalizeZoneContext(zoneContext);
  const macro = zc?.macroLevelContext || {};
  const activeZone = macro?.activeZone || null;
  const mid = toNum(activeZone?.mid);
  const px = toNum(currentPrice);

  if (!Number.isFinite(mid) || !Number.isFinite(px)) return false;

  const dir = safeUpper(direction, "NONE");
  if (dir === "LONG") return px >= mid;
  if (dir === "SHORT") return px <= mid;
  return false;
}

function isIntermediateSwingStrategy(strategyId) {
  return safeUpper(strategyId).includes("MINOR_SWING");
}

function isEngine16Unavailable(engine16) {
  return !engine16 || engine16.skipped === true || engine16.ok !== true;
}

function isFinalCorrectionPrep(engine16 = null) {
  const e16 = normalizeEngine16(engine16);

  return (
    e16.wavePrep === true ||
    e16.waveState === "FINAL_CORRECTION" ||
    e16.intermediatePhase === "IN_C"
  );
}

function buildUnavailableIntermediateSwingDecision({
  symbol,
  strategyId,
  engine16,
} = {}) {
  const prep = isFinalCorrectionPrep(engine16);
  const readinessLabel = prep ? "PREP" : "WAIT";

  return {
    ok: true,
    engine: "engine15.decisionReferee.v8.4",
    symbol,
    strategyId,
    strategyType: "NONE",
    direction: "NONE",
    readinessLabel,
    executionBias: "NONE",
    action: "NO_ACTION",
    priority: 0,
    entryStyle: "NONE",
    freshEntryNow: false,
    reasonCodes: prep
      ? ["ENGINE16_UNAVAILABLE", "STRUCTURE_PREP_ONLY", "INTERMEDIATE_PREP"]
      : ["ENGINE16_UNAVAILABLE", "WAIT_FOR_W3_W5_STRUCTURE"],
    blockers: [],
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
    permission: "NONE",
    sizeMultiplier: 0,
    setupChain: prep ? ["INTERMEDIATE_PREP"] : [],
    nextSetupType: prep ? "WAIT_FOR_W3_TRIGGER" : "NONE",
    primaryExhaustionTF: null,
    signalEvent: {
      signalType: "NONE",
      direction: "NONE",
      signalTime: null,
      signalPrice: null,
      signalSource: null,
    },
    lifecycle: {
      lifecycleStage: "WAITING_STRUCTURE",
      isFreshSetup: false,
      entryWindowOpen: false,
      freshEntryNow: false,
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
      nextFocus: prep ? "WAIT_FOR_W3_TRIGGER" : "WAIT_FOR_W3_W5_STRUCTURE",
    },
    debug: {
      unavailableGuard: {
        triggered: true,
        engine16Skipped: engine16?.skipped === true,
        engine16Ok: engine16?.ok === true,
        waveState: safeUpper(engine16?.waveState || engine16?.waveContext?.waveState, "UNKNOWN"),
        intermediatePhase: safeUpper(engine16?.intermediatePhase || engine16?.waveContext?.intermediatePhase, "UNKNOWN"),
      },
    },
  };
}

/* -----------------------------
   Candidate resolution
------------------------------*/
export function resolveStrategyCandidates({ engine16 } = {}) {
  const e16 = normalizeEngine16(engine16);

  const hasContinuationTrigger =
    e16.continuationTrigger === true ||
    e16.continuationTriggerShort === true ||
    e16.continuationTriggerLong === true;

  const hasContinuationWatch =
    e16.continuationWatch === true ||
    e16.continuationWatchShort === true ||
    e16.continuationWatchLong === true;

  const hasExhaustionTrigger =
    e16.exhaustionTrigger === true ||
    e16.exhaustionTriggerShort === true ||
    e16.exhaustionTriggerLong === true;

  // 1️⃣ CONTINUATION TRIGGER (highest priority)
  if (hasContinuationTrigger) {
    return [
      {
        strategyType: "CONTINUATION",
        direction: normalizeDirection(e16.direction, e16),
        source: "ENGINE16_CONTINUATION_TRIGGER",
        engine16: e16,
      },
    ];
  }

  // 2️⃣ EXHAUSTION TRIGGER
  if (hasExhaustionTrigger) {
    return [
      {
        strategyType: "EXHAUSTION",
        direction: normalizeDirection(e16.direction, e16),
        source: "ENGINE16_EXHAUSTION_TRIGGER",
        engine16: e16,
      },
    ];
  }

  // 3️⃣ EARLY EXHAUSTION (ONLY if no continuation context)
  if (isEarlyExhaustionOnly(e16) && !hasContinuationWatch && e16.strategyType !== "CONTINUATION") {
    return [];
  }

  // 4️⃣ NO SETUP
  if (!e16.ok || e16.strategyType === "NONE" || e16.readinessLabel === "NO_SETUP") {
    return [];
  }

  // 5️⃣ DEFAULT
  return [
    {
      strategyType: e16.strategyType,
      direction: e16.direction,
      source: "ENGINE16",
      engine16: e16,
    },
  ];

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
    const dirInitial = normalizeDirection(c?.direction, c?.engine16);
    const base = BASE_PRIORITY[type] || 0;

    let priority = base;
    priority += clamp(Math.round((e5.total || 0) / 5), 0, 20);

    if (dirInitial === "LONG" && mom.alignment === "BULLISH") priority += 8;
    if (dirInitial === "SHORT" && mom.alignment === "BEARISH") priority += 8;
    if (dirInitial === "LONG" && mom.alignment === "BEARISH") priority -= 8;
    if (dirInitial === "SHORT" && mom.alignment === "BULLISH") priority -= 8;

    if (type === "EXHAUSTION" && c?.engine16?.exhaustionTrigger === true) priority += 10;
    if (type === "EXHAUSTION" && c?.engine16?.exhaustionActive) priority += 5;

    const htf = inferHigherTimeframeExhaustion({
      strategyId,
      engine16: c?.engine16,
      momentum,
    });

    priority += htf.score;

    const resolvedDirection =
      dirInitial !== "NONE"
        ? dirInitial
        : deriveDirectionFromHTFContext({
            winner: { direction: dirInitial },
            engine16: c?.engine16,
            momentum,
          });

    const candidateScore = {
      strategyType: type,
      direction: resolvedDirection,
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
  strategyId,
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

  const earlyOnly = isEarlyExhaustionOnly(e16);

  const continuationPrep =
    e16.strategyType === "CONTINUATION" &&
    (
      e16.continuationWatchShort === true ||
      e16.continuationWatchLong === true ||
      e16.prepBias === "SHORT_PREP" ||
      e16.prepBias === "LONG_PREP"
    );

  if (!earlyOnly && !continuationPrep) {
    if (winner?.strategyType && winner.strategyType !== "NONE") {
      if (winner?.direction === "NONE") {
        blockers.push("NO_DIRECTION");
      }
    }
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
    return {
      qualityGatePassed: false,
      qualityBand: "INVALID",
      qualityScore: e5.total,
      qualityGrade: e5.grade,
      qualityBreakdown: e5.perEngine,
      reasonCodes: ["E5_INVALID"],
      blockers: [],
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
  } else {
    qualityGatePassed = false;
    qualityBand = "WEAK";
    reasonCodes.push("E5_SCORE_WEAK");
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
   Momentum
------------------------------*/
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
  let reasonCodes = [];
  let blockers = [];
  let conflicts = [];
  let bias = "NONE";

  const scalpMode = sid.includes("INTRADAY_SCALP");
  const swingMode = sid.includes("MINOR_SWING");
  const longMode = sid.includes("INTERMEDIATE_LONG");

  const smi10 = mom.smi10m.direction;
  const smi1h = mom.smi1h.direction;

  if (dir === "LONG") {
    if (mom.alignment === "BULLISH") {
      momentumGatePassed = true;
      bias = "LONG_PRIORITY";
      reasonCodes.push("E45_BULLISH_ALIGNED");
    } else if (type === "EXHAUSTION" || type === "REVERSAL") {
      if (smi10 === "UP") {
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
      if (smi10 === "DOWN") {
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
} = {}) {
  const chain = [];
  const type = winner?.strategyType || "NONE";
  const e16 = normalizeEngine16(engine16);
  const dir = safeUpper(winner?.direction, "NONE");

  if (winner?.primaryExhaustionTF) {
    chain.push(`${winner.primaryExhaustionTF}_EXHAUSTION`);
  }

  if (e16.exhaustionEarly && !e16.exhaustionTrigger) {
    chain.push("EXHAUSTION_EARLY");
  }

  if (type === "EXHAUSTION") {
    chain.push("EXHAUSTION");
  } else if (type === "REVERSAL") {
    chain.push("REVERSAL");
  } else if (type === "BREAKDOWN") {
    chain.push("BREAKDOWN");
  } else if (type === "BREAKOUT") {
    chain.push("BREAKOUT");
  } else if (type === "CONTINUATION") {
    chain.push("CONTINUATION");
  }

  if (
    e16.hasPulledBack ||
    e16.strategyType === "PULLBACK" ||
    e16.readinessLabel === "PULLBACK_READY"
  ) {
    chain.push("PULLBACK");
  }

  if (e16.insidePrimaryZone || e16.insideSecondaryZone) {
    chain.push("IN_TRIGGER_ZONE");
  }

  if (dir === "SHORT" && e16.wickRejectionShort) {
    chain.push("SHORT_REJECTION_PRESENT");
  }
  if (dir === "LONG" && e16.wickRejectionLong) {
    chain.push("LONG_REJECTION_PRESENT");
  }

  if (e16.continuationTriggerShort) {
    chain.push("CONTINUATION_TRIGGER_SHORT");
  }
  if (e16.continuationTriggerLong) {
    chain.push("CONTINUATION_TRIGGER_LONG");
  }

  if (e16.continuationWatchShort) {
    chain.push("CONTINUATION_WATCH_SHORT");
  }
  if (e16.continuationWatchLong) {
    chain.push("CONTINUATION_WATCH_LONG");
  }

  if (promotedStrategyType === "CONTINUATION") {
    chain.push("CONTINUATION_PENDING");
  } else if (nextSetupType !== "NONE") {
    chain.push(nextSetupType);
  } else if (type === "EXHAUSTION" && e16.hasPulledBack) {
    chain.push("TRIGGER_PENDING");
  }

  if (chain.length === 0) chain.push("BUILDING");

  return [...new Set(chain)];
}

function deriveNextSetupType({
  winner,
  engine16,
  promotedStrategyType,
  nextSetupType,
} = {}) {
  const e16 = normalizeEngine16(engine16);

  if (e16.exhaustionEarly && !e16.exhaustionTrigger) return "WAIT_FOR_TRIGGER";
  if (nextSetupType && nextSetupType !== "NONE") return nextSetupType;
  if (promotedStrategyType === "CONTINUATION") return "CONTINUATION_TRIGGER";

  if (winner?.strategyType === "CONTINUATION") {
    if (e16.continuationTriggerShort || e16.continuationTriggerLong) {
      return "CONTINUATION_TRIGGER";
    }
    if (e16.continuationWatchShort || e16.continuationWatchLong) {
      return "WAIT_FOR_CONTINUATION_TRIGGER";
    }
  }

  if (winner?.strategyType === "EXHAUSTION") {
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
} = {}) {
  const e16 = normalizeEngine16(engine16);
  const e3 = normalizeE3(engine3);
  const e4 = normalizeE4(engine4);

  const reasonCodes = [];
  const blockers = [];

  const hasContinuationContext =
  winner?.strategyType === "CONTINUATION" ||
  e16.continuationTrigger === true ||
  e16.continuationTriggerShort === true ||
  e16.continuationTriggerLong === true ||
  e16.continuationWatch === true ||
  e16.continuationWatchShort === true ||
  e16.continuationWatchLong === true;

if (isEarlyExhaustionOnly(e16) && !hasContinuationContext) {
  return {
    readinessLabel: "WATCH",
    entryStyle: "EXHAUSTION_EARLY",
    triggerConfirmed: false,
    freshEntryNow: false,
    reasonCodes: ["EXHAUSTION_EARLY_ADVISORY"],
    blockers: Array.isArray(hardBlockers?.softBlockers) ? [...hardBlockers.softBlockers] : [],
    promotedStrategyType: "NONE",
    nextSetupType: "WAIT_FOR_TRIGGER",
    setupChain: ["EXHAUSTION_EARLY", "WAIT_FOR_TRIGGER"],
  };
}

  if (hardBlockers?.hardBlocked) {
    return {
      readinessLabel: "STAND_DOWN",
      entryStyle: "NONE",
      triggerConfirmed: false,
      freshEntryNow: false,
      reasonCodes: ["HARD_BLOCKED"],
      blockers: [...(hardBlockers?.blockers || [])],
      promotedStrategyType: winner?.strategyType || "NONE",
      nextSetupType: "NONE",
      setupChain: [],
    };
  }

  if (!winner || winner.strategyType === "NONE") {
    return {
      readinessLabel: "WAIT",
      entryStyle: "NONE",
      triggerConfirmed: false,
      freshEntryNow: false,
      reasonCodes: ["NO_SETUP"],
      blockers: [],
      promotedStrategyType: "NONE",
      nextSetupType: "WAIT_FOR_TRIGGER",
      setupChain: [],
    };
  }

  const qualityPass = qualityGate?.qualityGatePassed === true;
  const continuationPrep =
  winner?.strategyType === "CONTINUATION" &&
  (
    e16.continuationWatchShort === true ||
    e16.continuationWatchLong === true ||
    e16.prepBias === "SHORT_PREP" ||
    e16.prepBias === "LONG_PREP"
  );
  const momentumPass = momentumGate?.momentumGatePassed === true;

  let readinessLabel = "WAIT";
  let entryStyle = "NONE";
  let triggerConfirmed = false;
  let freshEntryNow = false;

  if (!qualityPass && !continuationPrep) {
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

  if (qualityPass) {
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
    }

    if (
      e3.stage === "CONFIRMED" &&
      (e4.volumeConfirmed === true || e4.volumeScore >= 9)
    ) {
      readinessLabel = "CONFIRMED";
      entryStyle = "CONFIRMATION";
      triggerConfirmed = true;
      freshEntryNow = true;
      reasonCodes.push("E3_CONFIRMED");
      reasonCodes.push("E4_CONFIRMED");
    }
  }

  if (winner.strategyType === "EXHAUSTION" || winner.strategyType === "REVERSAL") {
    if (e4.flags?.reversalExpansion) {
      reasonCodes.push("REVERSAL_VOLUME_PRESENT");
      if (readinessLabel === "NEAR" && qualityPass) readinessLabel = "ARMING";
    }
  }

  if (winner.strategyType === "EXHAUSTION" && e16.exhaustionTrigger === true) {
    readinessLabel = "READY";
    entryStyle = "EXHAUSTION_TRIGGER";
    triggerConfirmed = true;
    freshEntryNow = true;

    if (!qualityPass) {
      reasonCodes.push("E5_WEAK_BUT_EXHAUSTION_TRIGGER");
    }

    if (!momentumPass) {
      reasonCodes.push("MOMENTUM_WEAK_BUT_TRIGGER_VALID");
    }
  }

  if (winner.strategyType === "CONTINUATION" && e16.continuationTrigger === true) {
    readinessLabel = "READY";
    entryStyle = "CONTINUATION_TRIGGER";
    triggerConfirmed = true;
    freshEntryNow = true;
    reasonCodes.push("ENGINE16_CONTINUATION_TRIGGER");
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

  if (continuationPrep) {
    readinessLabel = "WATCH";
    entryStyle = "CONTINUATION_PREP";
    triggerConfirmed = false;
    freshEntryNow = false;

    if (e16.readinessLabel === "WAIT_FOR_MAGNET_RESOLUTION") {
      reasonCodes.push("ENGINE16_WAIT_FOR_MAGNET_RESOLUTION");
    }

    if (e16.continuationWatch === true) {
      reasonCodes.push("ENGINE16_CONTINUATION_WATCH");
    }
  }    

  const setupChain = buildSetupChain({
    winner,
    engine16: e16,
    promotedStrategyType,
    nextSetupType,
  });

  nextSetupType = deriveNextSetupType({
    winner,
    engine16: e16,
    promotedStrategyType,
    nextSetupType,
  });

  if (!VALID_READINESS.has(readinessLabel)) readinessLabel = "WAIT";

  return {
    readinessLabel,
    entryStyle,
    triggerConfirmed,
    freshEntryNow,
    reasonCodes,
    blockers,
    promotedStrategyType,
    nextSetupType,
    setupChain,
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
    return cleaned
      .filter((z) => z.mid < sp)
      .sort((a, b) => b.mid - a.mid);
  }

  if (dir === "LONG") {
    return cleaned
      .filter((z) => z.mid > sp)
      .sort((a, b) => a.mid - b.mid);
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

  return (
    toNum(zc?.meta?.current_price) ??
    toNum(zc?.meta?.currentPrice) ??
    toNum(zoneContext?.meta?.current_price) ??
    toNum(zoneContext?.meta?.currentPrice) ??
    null
  );
}

function getContinuationSignalTime(e16) {
  return (
    e16?.signalTimes?.continuationTriggerTime ||
    e16?.signalTimes?.continuationTime ||
    null
  );
}

function buildLifecycle({
  strategyId,
  winner,
  engine16,
  zoneContext,
} = {}) {
  const e16 = normalizeEngine16(engine16);
  const zc = normalizeZoneContext(zoneContext);

  const continuationSignalPrice =
    e16.continuationTriggerShort === true
      ? toNum(zc?.active?.negotiated?.hi) ??
        toNum(zc?.active?.institutional?.hi) ??
        toNum(zc?.active?.shelf?.hi) ??
        null
      : e16.continuationTriggerLong === true
        ? toNum(zc?.active?.negotiated?.lo) ??
          toNum(zc?.active?.institutional?.lo) ??
          toNum(zc?.active?.shelf?.lo) ??
          null
        : null;

  const signalPrice =
    getTriggerSignalPrice(e16) ??
    continuationSignalPrice ??
    toNum(zc?.active?.negotiated?.mid) ??
    toNum(zc?.active?.institutional?.mid) ??
    toNum(zc?.active?.shelf?.mid) ??
    null;

  const hasRealTrigger =
    e16.exhaustionTrigger === true ||
    e16.exhaustionTriggerShort === true ||
    e16.exhaustionTriggerLong === true ||
    e16.breakoutReady === true ||
    e16.breakdownReady === true ||
    e16.continuationTrigger === true ||
    e16.continuationTriggerShort === true ||
    e16.continuationTriggerLong === true;

  const currentPrice = extractCurrentPrice(zoneContext);

  let moveFromSignalPts = null;
  if (signalPrice != null && currentPrice != null) {
    moveFromSignalPts = Math.round((currentPrice - signalPrice) * 100) / 100;
  }

  const nextFocus = hasRealTrigger ? "WAIT_FOR_EXECUTION" : "WAIT_FOR_TRIGGER";

  return {
    lifecycleStage: "NO_TRADE",
    isFreshSetup: hasRealTrigger,
    entryWindowOpen: false,
    freshEntryNow: false,
    signalPrice,
    currentPrice,
    barsSinceSignal: null,
    moveFromSignalPts,
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

  return out;
}

function buildSignalEvent({ engine16, winner } = {}) {
  const e16 = normalizeEngine16(engine16);

  if (e16.exhaustionTrigger === true) {
    return {
      signalType: "EXHAUSTION",
      direction:
        e16.exhaustionTriggerShort ? "SHORT"
          : e16.exhaustionTriggerLong ? "LONG"
            : winner?.direction || "NONE",
      signalTime: getTriggerSignalTime(e16),
      signalPrice: getTriggerSignalPrice(e16),
      signalSource: "ENGINE16_EXHAUSTION_TRIGGER",
    };
  }

  if (e16.continuationTrigger === true) {
    return {
      signalType: "CONTINUATION",
      direction:
        e16.continuationTriggerShort ? "SHORT"
          : e16.continuationTriggerLong ? "LONG"
            : winner?.direction || "NONE",
      signalTime: getContinuationSignalTime(e16),
      signalPrice: null,
      signalSource: "ENGINE16_CONTINUATION_TRIGGER",
    };
  }

  return {
    signalType: "NONE",
    direction: "NONE",
    signalTime: null,
    signalPrice: null,
    signalSource: null,
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
  const e16 = normalizeEngine16(engine16);

  const resolvedWinner = {
    ...winner,
    direction: deriveDirectionFromHTFContext({ winner, engine16, momentum }),
  };

  const direction = safeUpper(resolvedWinner?.direction, "NONE");

  const hard = evaluateHardBlockers({
    strategyId,
    winner: resolvedWinner,
    permission,
    zoneContext,
    engine16,
  });

  if (safeUpper(resolvedWinner?.strategyType, "NONE") === "NONE") {
    hard.hardBlocked = false;
    hard.blockers = [];
  }

  const quality = evaluateQualityGate({
    engine5,
  });

  if (!resolvedWinner || resolvedWinner.strategyType === "NONE") {
    quality.blockers = [];
  }

  const mom = evaluateMomentumGate({
    strategyId,
    winner: resolvedWinner,
    momentum,
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
  });

  const lifecycle = buildLifecycle({
    strategyId,
    winner: resolvedWinner,
    engine16,
    zoneContext,
  });

  const trigger = applyLifecycleOverride({
    trigger: triggerBase,
    lifecycle,
  });

  let executionBias = VALID_BIAS.has(mom.executionBias) ? mom.executionBias : "NONE";

  const hasPriorityBias =
    executionBias === "SHORT_PRIORITY" ||
    executionBias === "LONG_PRIORITY" ||
    executionBias === "SHORT_COUNTERTREND" ||
    executionBias === "LONG_COUNTERTREND";

  if (!hasPriorityBias) {
    if (e16.prepBias === "SHORT_PREP" || e16.prepBias === "LONG_PREP") {
      executionBias = e16.prepBias;
    }
  }

  let action = "NO_ACTION";

  if (isEarlyExhaustionOnly(e16)) {
    action = "WATCH";
  } else if (lifecycle?.lifecycleStage === "COMPLETED") {
    action = "NO_ACTION";
  } else if (trigger.readinessLabel === "STAND_DOWN") {
    if (
      e16.readinessLabel === "PULLBACK_READY" ||
      e16.readinessLabel === "WATCH" ||
      e16.readinessLabel === "NEAR"
    ) {
      action = "WATCH";
    } else {
      action = "BLOCKED";
    }
  } else if (trigger.readinessLabel === "WAIT") {
    action = "NO_ACTION";
  } else if (
    trigger.readinessLabel === "WATCH" ||
    trigger.readinessLabel === "WATCH_FOR_SHORT" ||
    trigger.readinessLabel === "WATCH_FOR_LONG" ||
    trigger.readinessLabel === "NEAR" ||
    trigger.readinessLabel === "ARMING" ||
    trigger.readinessLabel === "PREP"
  ) {
    action = "WATCH";
  } else if (trigger.readinessLabel === "READY") {
    const ema10 = e16.ema10 ?? null;
    const ema20 = e16.ema20 ?? null;
    const price = lifecycle?.currentPrice ?? null;

    let emaFilterPass = false;

    if (direction === "SHORT") {
      emaFilterPass =
        (price !== null && ema10 !== null && price < ema10) ||
        (ema10 !== null && ema20 !== null && ema10 < ema20);
    }

    if (direction === "LONG") {
      emaFilterPass =
        (price !== null && ema10 !== null && price > ema10) ||
        (ema10 !== null && ema20 !== null && ema10 > ema20);
    }

    if (!emaFilterPass) {
      action = "WATCH";
    } else {
      action =
        p.permission === "REDUCE"
          ? "REDUCE_OK"
          : p.permission === "ALLOW"
            ? "ENTER_OK"
            : "BLOCKED";
    }
  } else if (
    trigger.readinessLabel === "CONFIRMED" ||
    trigger.readinessLabel === "TRIGGERED"
  ) {
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
  ...(mom.blockers || []),
  ...(trigger.blockers || []),
];
  const conflicts = [
    ...(hard.conflicts || []),
    ...(mom.conflicts || []),
  ];

  const signalEvent = buildSignalEvent({
    engine16: e16,
    winner: resolvedWinner,
  });

  return {
    ok: true,
    engine: "engine15.decisionReferee.v8.4",
    symbol,
    strategyId,
    strategyType: trigger.promotedStrategyType || resolvedWinner?.strategyType || "NONE",
    direction: resolvedWinner?.direction || "NONE",
    readinessLabel: trigger.readinessLabel,
    executionBias,
    action,
    priority: Number.isFinite(Number(resolvedWinner?.priority))
      ? Number(resolvedWinner.priority)
      : 0,
    entryStyle: trigger.entryStyle || "NONE",
    freshEntryNow: trigger.freshEntryNow === true,
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
    if (isIntermediateSwingStrategy(strategyId) && isEngine16Unavailable(engine16)) {
      return buildUnavailableIntermediateSwingDecision({
        symbol,
        strategyId,
        engine16,
      });
    }

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
      engine: "engine15.decisionReferee.v8.4",
      symbol,
      strategyId,
      strategyType: "NONE",
      direction: "NONE",
      readinessLabel: "WAIT",
      executionBias: "NONE",
      action: "NO_ACTION",
      priority: 0,
      entryStyle: "NONE",
      freshEntryNow: false,
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
      signalEvent: {
        signalType: "NONE",
        direction: "NONE",
        signalTime: null,
        signalPrice: null,
        signalSource: null,
      },
      lifecycle: {
        lifecycleStage: "NO_TRADE",
        isFreshSetup: false,
        entryWindowOpen: false,
        freshEntryNow: false,
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
        nextFocus: "LOOK_FOR_NEXT_SETUP",
      },
      debug: {},
    };
  }
}

export default computeEngine15DecisionReferee;
